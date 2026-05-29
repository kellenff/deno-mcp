import { assertEquals, assertExists } from "@std/assert";
import { z } from "zod";
import { McpServer } from "../mod.ts";
import { StreamableHttpServer } from "../src/transport/streamable_http.ts";
import type { JSONRPCResponse } from "../src/protocol/types.ts";
import { ProtocolHandler } from "../src/server/protocol_handler.ts";

const MCP_ACCEPT = "application/json, text/event-stream";

async function drain(response: Response): Promise<void> {
  await response.text().catch(() => {});
}

function createEchoTemplate(): ProtocolHandler {
  const template = new ProtocolHandler({
    serverInfo: { name: "echo-http", version: "0.1.0" },
  });
  template.registerTool({
    definition: {
      name: "echo",
      description: "Echo a message",
      inputSchema: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
    },
    handler: ({ message }) => ({
      content: [{ type: "text", text: String(message) }],
    }),
  });
  return template;
}

async function startHttpServer(
  createSession: () => ProtocolHandler,
): Promise<StreamableHttpServer> {
  const http = new StreamableHttpServer({ port: 0, createSession });
  http.listen();
  await http.ready();
  return http;
}

function postMcp(
  url: string,
  body: unknown,
  sessionId?: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const reqHeaders: Record<string, string> = {
    Accept: MCP_ACCEPT,
    "Content-Type": "application/json",
    ...headers,
  };
  if (sessionId) {
    reqHeaders["Mcp-Session-Id"] = sessionId;
  }
  return fetch(url, {
    method: "POST",
    headers: reqHeaders,
    body: JSON.stringify(body),
  });
}

async function initializeSession(baseUrl: string): Promise<string> {
  const response = await postMcp(baseUrl, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.0.1" },
    },
  });

  assertEquals(response.status, 200);
  const sessionId = response.headers.get("Mcp-Session-Id");
  assertExists(sessionId);

  const initBody = await response.json() as JSONRPCResponse;
  assertExists(initBody.result);

  const initialized = await postMcp(
    baseUrl,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    sessionId,
  );
  assertEquals(initialized.status, 202);
  await drain(initialized);

  return sessionId;
}

Deno.test("HTTP - full handshake and tools/list", async () => {
  const template = createEchoTemplate();
  const http = await startHttpServer(() => template.fork());

  try {
    const sessionId = await initializeSession(http.url);

    const listResponse = await postMcp(
      http.url,
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      sessionId,
    );
    assertEquals(listResponse.status, 200);
    const listBody = await listResponse.json() as JSONRPCResponse;
    const tools = (listBody.result as { tools: Array<{ name: string }> }).tools;
    assertEquals(tools.length, 1);
    assertEquals(tools[0].name, "echo");
  } finally {
    await http.close();
  }
});

Deno.test("HTTP - echo tool call", async () => {
  const template = createEchoTemplate();
  const http = await startHttpServer(() => template.fork());

  try {
    const sessionId = await initializeSession(http.url);

    const callResponse = await postMcp(
      http.url,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "echo", arguments: { message: "hello http" } },
      },
      sessionId,
    );
    assertEquals(callResponse.status, 200);
    const callBody = await callResponse.json() as JSONRPCResponse;
    const content = (callBody.result as { content: Array<{ text: string }> }).content;
    assertEquals(content[0].text, "hello http");
  } finally {
    await http.close();
  }
});

Deno.test("HTTP - missing session on non-initialize returns 400", async () => {
  const http = await startHttpServer(() =>
    new ProtocolHandler({ serverInfo: { name: "t", version: "0.1.0" } })
  );

  try {
    const response = await postMcp(http.url, {
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
    });
    assertEquals(response.status, 400);
    await drain(response);
  } finally {
    await http.close();
  }
});

Deno.test("HTTP - unknown session returns 404", async () => {
  const http = await startHttpServer(() =>
    new ProtocolHandler({ serverInfo: { name: "t", version: "0.1.0" } })
  );

  try {
    const response = await postMcp(
      http.url,
      { jsonrpc: "2.0", id: 1, method: "ping" },
      "nonexistent-session-id",
    );
    assertEquals(response.status, 404);
    await drain(response);
  } finally {
    await http.close();
  }
});

Deno.test("HTTP - GET returns 405", async () => {
  const http = await startHttpServer(() =>
    new ProtocolHandler({ serverInfo: { name: "t", version: "0.1.0" } })
  );

  try {
    const response = await fetch(http.url, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
    });
    assertEquals(response.status, 405);
    await drain(response);
  } finally {
    await http.close();
  }
});

Deno.test("HTTP - DELETE terminates session", async () => {
  const template = createEchoTemplate();
  const http = await startHttpServer(() => template.fork());

  try {
    const sessionId = await initializeSession(http.url);

    const deleteResponse = await fetch(http.url, {
      method: "DELETE",
      headers: { "Mcp-Session-Id": sessionId },
    });
    assertEquals(deleteResponse.status, 200);
    await drain(deleteResponse);

    const afterDelete = await postMcp(
      http.url,
      { jsonrpc: "2.0", id: 4, method: "ping" },
      sessionId,
    );
    assertEquals(afterDelete.status, 404);
    await drain(afterDelete);
  } finally {
    await http.close();
  }
});

Deno.test("HTTP - foreign Origin returns 403", async () => {
  const http = await startHttpServer(() =>
    new ProtocolHandler({ serverInfo: { name: "t", version: "0.1.0" } })
  );

  try {
    const response = await postMcp(
      http.url,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "0.0.1" },
        },
      },
      undefined,
      { Origin: "https://evil.example.com" },
    );
    assertEquals(response.status, 403);
    await drain(response);
  } finally {
    await http.close();
  }
});

Deno.test("ProtocolHandler fork and processMessage", async () => {
  const parent = new ProtocolHandler({
    serverInfo: { name: "parent", version: "0.1.0" },
  });
  parent.registerTool({
    definition: { name: "ping-tool", inputSchema: { type: "object" } },
    handler: () => ({ content: [{ type: "text", text: "pong" }] }),
  });

  const session = parent.fork();

  const initResponse = await session.processMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "0.0.1" },
    },
  }) as JSONRPCResponse | null;
  assertExists(initResponse?.result);

  const notif = await session.processMessage({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  assertEquals(notif, null);

  const callResponse = await session.processMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "ping-tool", arguments: {} },
  }) as JSONRPCResponse | null;
  assertExists(callResponse?.result);
  const text = (callResponse!.result as { content: Array<{ text: string }> }).content[0].text;
  assertEquals(text, "pong");
});

Deno.test("McpServer handler fork via serveHttp factory", async () => {
  const mcp = new McpServer({ name: "echo-http", version: "0.1.0" });
  mcp.tool("echo", {
    input: z.object({ message: z.string() }),
    handler: ({ message }) => ({ content: [{ type: "text", text: message }] }),
  });

  const http = new StreamableHttpServer({
    port: 0,
    createSession: () => mcp.forkHandler(),
  });
  http.listen();
  await http.ready();

  try {
    const sessionId = await initializeSession(http.url);
    const callResponse = await postMcp(
      http.url,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "echo", arguments: { message: "via forkHandler" } },
      },
      sessionId,
    );
    assertEquals(callResponse.status, 200);
    const callBody = await callResponse.json() as JSONRPCResponse;
    const content = (callBody.result as { content: Array<{ text: string }> }).content;
    assertEquals(content[0].text, "via forkHandler");
  } finally {
    await http.close();
  }
});
