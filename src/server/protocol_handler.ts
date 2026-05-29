import { z } from "zod";
import { ErrorCode, McpError } from "../protocol/errors.ts";
import { isNotification, isRequest, isResponse } from "../protocol/json_rpc.ts";
import {
  type CallToolParams,
  type CallToolResult,
  type GetPromptParams,
  type GetPromptResult,
  type Implementation,
  type InitializeParams,
  type InitializeResult,
  type JSONRPCMessage,
  type JSONRPCRequest,
  type JSONRPCResponse,
  LATEST_PROTOCOL_VERSION,
  type Prompt,
  type ReadResourceParams,
  type ReadResourceResult,
  type RequestId,
  type Resource,
  type ServerCapabilities,
  SUPPORTED_PROTOCOL_VERSIONS,
  type Tool,
} from "../protocol/types.ts";
import type { Transport } from "../transport/transport.ts";

export type ToolHandler = (
  args: Record<string, unknown>,
) => CallToolResult | Promise<CallToolResult>;

export interface RegisteredTool {
  definition: Tool;
  handler: ToolHandler;
}

export type ResourceHandler = (
  uri: string,
) => ReadResourceResult | Promise<ReadResourceResult>;

export interface RegisteredResource {
  definition: Resource;
  handler: ResourceHandler;
}

export type PromptHandler = (
  args: Record<string, string>,
) => GetPromptResult | Promise<GetPromptResult>;

export interface RegisteredPrompt {
  definition: Prompt;
  handler: PromptHandler;
}

export interface ProtocolHandlerOptions {
  serverInfo: Implementation;
  capabilities?: ServerCapabilities;
  instructions?: string;
}

/**
 * Low-level MCP protocol handler. Routes JSON-RPC requests to registered
 * tools, resources, and prompts.
 */
export class ProtocolHandler {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly resources = new Map<string, RegisteredResource>();
  private readonly prompts = new Map<string, RegisteredPrompt>();
  private transport: Transport | null = null;
  private sessionInitialized = false;

  constructor(private readonly options: ProtocolHandlerOptions) {}

  registerTool(tool: RegisteredTool): void {
    this.tools.set(tool.definition.name, tool);
  }

  registerResource(resource: RegisteredResource): void {
    this.resources.set(resource.definition.uri, resource);
  }

  registerPrompt(prompt: RegisteredPrompt): void {
    this.prompts.set(prompt.definition.name, prompt);
  }

  /** Clone registrations into a fresh handler for an isolated HTTP session. */
  fork(): ProtocolHandler {
    const handler = new ProtocolHandler(this.options);
    for (const tool of this.tools.values()) {
      handler.registerTool(tool);
    }
    for (const resource of this.resources.values()) {
      handler.registerResource(resource);
    }
    for (const prompt of this.prompts.values()) {
      handler.registerPrompt(prompt);
    }
    return handler;
  }

  /**
   * Process a single inbound message and return an outbound JSON-RPC response,
   * or null for notifications and client responses (HTTP 202).
   */
  async processMessage(message: JSONRPCMessage): Promise<JSONRPCMessage | null> {
    if (isNotification(message)) {
      if (message.method === "notifications/initialized") {
        this.sessionInitialized = true;
      }
      return null;
    }

    if (isResponse(message)) {
      return null;
    }

    if (!isRequest(message)) return null;

    try {
      const result = await this.handleRequest(message as JSONRPCRequest);
      return { jsonrpc: "2.0", id: (message as JSONRPCRequest).id, result };
    } catch (error) {
      const mcpError = toMcpError(error);
      return {
        jsonrpc: "2.0",
        id: (message as JSONRPCRequest).id,
        error: mcpError.toJSONRPCError(),
      };
    }
  }

  async connect(transport: Transport): Promise<void> {
    this.transport = transport;
    transport.onmessage = (message) => {
      this.handleMessage(message).catch((error) => {
        transport.onerror?.(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    };
    transport.onclose = () => {
      this.transport = null;
    };
    await transport.start();
  }

  async close(): Promise<void> {
    await this.transport?.close();
    this.transport = null;
  }

  private async handleMessage(message: JSONRPCMessage): Promise<void> {
    if (isNotification(message)) {
      if (message.method === "notifications/initialized") {
        this.sessionInitialized = true;
      }
      return;
    }

    if (!isRequest(message)) return;

    try {
      const result = await this.handleRequest(message);
      await this.sendResponse(message.id, result);
    } catch (error) {
      const mcpError = toMcpError(error);
      await this.sendError(message.id, mcpError);
    }
  }

  private async handleRequest(request: JSONRPCRequest): Promise<unknown> {
    if (request.method !== "initialize" && !this.sessionInitialized) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "Server not initialized; complete the initialize handshake first",
      );
    }

    switch (request.method) {
      case "initialize":
        return this.handleInitialize(request.params as InitializeParams);
      case "ping":
        return {};
      case "tools/list":
        return { tools: [...this.tools.values()].map((t) => t.definition) };
      case "tools/call":
        return await this.handleCallTool(request.params as CallToolParams);
      case "resources/list":
        return { resources: [...this.resources.values()].map((r) => r.definition) };
      case "resources/read":
        return await this.handleReadResource(request.params as ReadResourceParams);
      case "prompts/list":
        return { prompts: [...this.prompts.values()].map((p) => p.definition) };
      case "prompts/get":
        return await this.handleGetPrompt(request.params as GetPromptParams);
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Method not found: ${request.method}`);
    }
  }

  private handleInitialize(params: InitializeParams): InitializeResult {
    const version = SUPPORTED_PROTOCOL_VERSIONS.includes(
        params.protocolVersion as typeof SUPPORTED_PROTOCOL_VERSIONS[number],
      )
      ? params.protocolVersion
      : LATEST_PROTOCOL_VERSION;

    const capabilities: ServerCapabilities = {
      tools: this.tools.size > 0 ? {} : undefined,
      resources: this.resources.size > 0 ? {} : undefined,
      prompts: this.prompts.size > 0 ? {} : undefined,
      ...this.options.capabilities,
    };

    return {
      protocolVersion: version,
      capabilities,
      serverInfo: this.options.serverInfo,
      ...(this.options.instructions ? { instructions: this.options.instructions } : {}),
    };
  }

  private async handleCallTool(params: CallToolParams): Promise<CallToolResult> {
    if (!params?.name || typeof params.name !== "string") {
      throw new McpError(ErrorCode.InvalidParams, "Tool name is required");
    }

    const tool = this.tools.get(params.name);
    if (!tool) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${params.name}`);
    }

    try {
      return await tool.handler(params.arguments ?? {});
    } catch (error) {
      if (error instanceof McpError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: message }],
        isError: true,
      };
    }
  }

  private async handleReadResource(
    params: ReadResourceParams,
  ): Promise<ReadResourceResult> {
    if (!params?.uri || typeof params.uri !== "string") {
      throw new McpError(ErrorCode.InvalidParams, "Resource uri is required");
    }

    const resource = this.resources.get(params.uri);
    if (!resource) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown resource: ${params.uri}`);
    }
    return await resource.handler(params.uri);
  }

  private async handleGetPrompt(params: GetPromptParams): Promise<GetPromptResult> {
    if (!params?.name || typeof params.name !== "string") {
      throw new McpError(ErrorCode.InvalidParams, "Prompt name is required");
    }

    const prompt = this.prompts.get(params.name);
    if (!prompt) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown prompt: ${params.name}`);
    }
    return await prompt.handler(params.arguments ?? {});
  }

  private async sendResponse(id: RequestId, result: unknown): Promise<void> {
    const response: JSONRPCResponse = { jsonrpc: "2.0", id, result };
    await this.transport?.send(response);
  }

  private async sendError(id: RequestId, error: McpError): Promise<void> {
    const response: JSONRPCResponse = {
      jsonrpc: "2.0",
      id,
      error: error.toJSONRPCError(),
    };
    await this.transport?.send(response);
  }
}

function toMcpError(error: unknown): McpError {
  if (error instanceof McpError) return error;
  if (error instanceof z.ZodError) {
    return new McpError(ErrorCode.InvalidParams, formatZodError(error));
  }
  return new McpError(
    ErrorCode.InternalError,
    error instanceof Error ? error.message : String(error),
  );
}

function formatZodError(error: z.ZodError): string {
  return error.errors.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  }).join("; ");
}
