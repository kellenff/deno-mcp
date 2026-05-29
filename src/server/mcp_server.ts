import { z } from "zod";
import { ErrorCode, McpError } from "../protocol/errors.ts";
import type {
  CallToolResult,
  GetPromptResult,
  Implementation,
  ReadResourceResult,
  ServerCapabilities,
} from "../protocol/types.ts";
import { ProtocolHandler } from "./protocol_handler.ts";
import { StdioTransport } from "../transport/stdio.ts";
import type { StdioTransportOptions } from "../transport/stdio.ts";
import { StreamableHttpServer } from "../transport/streamable_http.ts";
import type { StreamableHttpOptions } from "../transport/streamable_http.ts";
import type { Transport } from "../transport/transport.ts";
import { parseInput, toInputSchema } from "../util/schema.ts";

export interface McpServerOptions {
  name: string;
  version: string;
  capabilities?: ServerCapabilities;
  instructions?: string;
}

/** Options for {@link McpServer.serveHttp} (excluding session factory). */
export type McpServerHttpOptions = Omit<StreamableHttpOptions, "createSession">;

export interface ToolOptions<T extends z.ZodType> {
  description?: string;
  input: T;
  handler: (input: z.infer<T>) => CallToolResult | Promise<CallToolResult>;
  annotations?: Record<string, unknown>;
}

export interface ResourceOptions {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  handler: (uri: string) => ReadResourceResult | Promise<ReadResourceResult>;
}

export interface PromptOptions {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
  handler: (args: Record<string, string>) => GetPromptResult | Promise<GetPromptResult>;
}

/**
 * High-level MCP server with a Deno-native API.
 */
export class McpServer {
  private readonly handler: ProtocolHandler;

  constructor(options: McpServerOptions) {
    const serverInfo: Implementation = {
      name: options.name,
      version: options.version,
    };
    this.handler = new ProtocolHandler({
      serverInfo,
      capabilities: options.capabilities,
      instructions: options.instructions,
    });
  }

  /** Register a tool with Zod-validated input. */
  tool<T extends z.ZodType>(name: string, options: ToolOptions<T>): this {
    this.handler.registerTool({
      definition: {
        name,
        description: options.description,
        inputSchema: toInputSchema(options.input),
        ...(options.annotations ? { annotations: options.annotations } : {}),
      },
      handler: (args) => {
        try {
          const parsed = parseInput(options.input, args);
          return options.handler(parsed);
        } catch (error) {
          if (error instanceof z.ZodError) {
            throw new McpError(
              ErrorCode.InvalidParams,
              error.errors.map((issue) => {
                const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
                return `${path}${issue.message}`;
              }).join("; "),
            );
          }
          throw error;
        }
      },
    });
    return this;
  }

  /** Register a static resource. */
  resource(options: ResourceOptions): this {
    this.handler.registerResource({
      definition: {
        uri: options.uri,
        name: options.name,
        description: options.description,
        mimeType: options.mimeType,
      },
      handler: options.handler,
    });
    return this;
  }

  /** Register a prompt template. */
  prompt(options: PromptOptions): this {
    this.handler.registerPrompt({
      definition: {
        name: options.name,
        description: options.description,
        arguments: options.arguments,
      },
      handler: options.handler,
    });
    return this;
  }

  /** Connect to a transport and start serving. */
  async connect(transport: Transport): Promise<void> {
    await this.handler.connect(transport);
  }

  /** Clone handler registrations for an isolated HTTP session. */
  forkHandler(): ProtocolHandler {
    return this.handler.fork();
  }

  /** Serve over stdio with graceful shutdown on SIGINT/SIGTERM. */
  async serveStdio(options?: StdioTransportOptions): Promise<void> {
    const transport = new StdioTransport(options);
    await this.connect(transport);

    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      this.handler.close()
        .catch(() => {})
        .finally(() => Deno.exit(0));
    };

    Deno.addSignalListener("SIGINT", shutdown);
    Deno.addSignalListener("SIGTERM", shutdown);

    await new Promise<void>(() => {
      // Keep process alive until signal
    });
  }

  /**
   * Serve over Streamable HTTP (JSON response mode) with graceful shutdown
   * on SIGINT/SIGTERM. Requires --allow-net.
   */
  async serveHttp(options?: McpServerHttpOptions): Promise<void> {
    const httpServer = new StreamableHttpServer({
      ...options,
      createSession: () => this.handler.fork(),
    });
    httpServer.listen();

    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      httpServer.close()
        .catch(() => {})
        .finally(() => Deno.exit(0));
    };

    Deno.addSignalListener("SIGINT", shutdown);
    Deno.addSignalListener("SIGTERM", shutdown);

    await new Promise<void>(() => {
      // Keep process alive until signal
    });
  }
}
