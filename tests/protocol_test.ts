import { assertEquals, assertExists } from "@std/assert";
import { z } from "zod";
import { McpServer } from "../mod.ts";
import { createTransportPair, waitForMessage } from "./helpers/memory_transport.ts";
import type { JSONRPCRequest, JSONRPCResponse } from "../src/protocol/types.ts";

async function initialize(
  client: ReturnType<typeof createTransportPair>[0],
): Promise<JSONRPCResponse> {
  const request: JSONRPCRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.0.1" },
    },
  };

  const responsePromise = waitForMessage(client);
  await client.send(request);
  return await responsePromise as JSONRPCResponse;
}

async function completeHandshake(
  client: ReturnType<typeof createTransportPair>[0],
): Promise<JSONRPCResponse> {
  const response = await initialize(client);
  await client.send({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  return response;
}

Deno.test("ProtocolHandler initialize handshake", async () => {
  const [clientTransport, serverTransport] = createTransportPair();

  const mcpServer = new McpServer({ name: "test", version: "0.1.0" });
  await mcpServer.connect(serverTransport);

  const response = await initialize(clientTransport);
  assertEquals(
    (response.result as { serverInfo: { name: string; version: string } }).serverInfo,
    { name: "test", version: "0.1.0" },
  );
  assertExists((response.result as { protocolVersion: string }).protocolVersion);
});

Deno.test("ProtocolHandler rejects requests before initialized notification", async () => {
  const [clientTransport, serverTransport] = createTransportPair();

  const mcpServer = new McpServer({ name: "test", version: "0.1.0" });
  await mcpServer.connect(serverTransport);
  await initialize(clientTransport);

  const errorPromise = waitForMessage(clientTransport);
  await clientTransport.send({ jsonrpc: "2.0", id: 2, method: "ping" });
  const response = await errorPromise as JSONRPCResponse;

  assertExists(response.error);
  assertEquals(response.error?.code, -32600);
});

Deno.test("ProtocolHandler tools/list and tools/call", async () => {
  const [clientTransport, serverTransport] = createTransportPair();

  const mcpServer = new McpServer({ name: "test", version: "0.1.0" });
  mcpServer.tool("greet", {
    description: "Greet someone",
    input: z.object({ name: z.string() }),
    handler: ({ name }) => ({
      content: [{ type: "text", text: `Hello, ${name}!` }],
    }),
  });

  await mcpServer.connect(serverTransport);
  await completeHandshake(clientTransport);

  const listPromise = waitForMessage(clientTransport);
  await clientTransport.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const listResponse = await listPromise as JSONRPCResponse;

  const tools = (listResponse.result as { tools: Array<{ name: string }> }).tools;
  assertEquals(tools.length, 1);
  assertEquals(tools[0].name, "greet");

  const callPromise = waitForMessage(clientTransport);
  await clientTransport.send({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "greet", arguments: { name: "World" } },
  });
  const callResponse = await callPromise as JSONRPCResponse;

  const content = (callResponse.result as { content: Array<{ text: string }> }).content;
  assertEquals(content[0].text, "Hello, World!");
});

Deno.test("ProtocolHandler returns InvalidParams for bad tool input", async () => {
  const [clientTransport, serverTransport] = createTransportPair();

  const mcpServer = new McpServer({ name: "test", version: "0.1.0" });
  mcpServer.tool("greet", {
    input: z.object({ name: z.string() }),
    handler: ({ name }) => ({
      content: [{ type: "text", text: name }],
    }),
  });

  await mcpServer.connect(serverTransport);
  await completeHandshake(clientTransport);

  const errorPromise = waitForMessage(clientTransport);
  await clientTransport.send({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "greet", arguments: { name: 123 } },
  });
  const response = await errorPromise as JSONRPCResponse;

  assertExists(response.error);
  assertEquals(response.error?.code, -32602);
});

Deno.test("ProtocolHandler returns isError for tool handler failures", async () => {
  const [clientTransport, serverTransport] = createTransportPair();

  const mcpServer = new McpServer({ name: "test", version: "0.1.0" });
  mcpServer.tool("fail", {
    input: z.object({}),
    handler: () => {
      throw new Error("tool broke");
    },
  });

  await mcpServer.connect(serverTransport);
  await completeHandshake(clientTransport);

  const callPromise = waitForMessage(clientTransport);
  await clientTransport.send({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "fail", arguments: {} },
  });
  const response = await callPromise as JSONRPCResponse;

  assertExists(response.result);
  const result = response.result as { content: Array<{ text: string }>; isError: boolean };
  assertEquals(result.isError, true);
  assertEquals(result.content[0].text, "tool broke");
});

Deno.test("ProtocolHandler returns error for unknown tool", async () => {
  const [clientTransport, serverTransport] = createTransportPair();

  const mcpServer = new McpServer({ name: "test", version: "0.1.0" });
  await mcpServer.connect(serverTransport);
  await completeHandshake(clientTransport);

  const errorPromise = waitForMessage(clientTransport);
  await clientTransport.send({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: { name: "nonexistent" },
  });
  const response = await errorPromise as JSONRPCResponse;

  assertExists(response.error);
  assertEquals(response.error?.code, -32602);
});

Deno.test("ProtocolHandler ping after handshake", async () => {
  const [clientTransport, serverTransport] = createTransportPair();

  const mcpServer = new McpServer({ name: "test", version: "0.1.0" });
  await mcpServer.connect(serverTransport);
  await completeHandshake(clientTransport);

  const pingPromise = waitForMessage(clientTransport);
  await clientTransport.send({ jsonrpc: "2.0", id: 7, method: "ping" });
  const response = await pingPromise as JSONRPCResponse;

  assertEquals(response.result, {});
});

Deno.test("ProtocolHandler resources/list and resources/read", async () => {
  const [clientTransport, serverTransport] = createTransportPair();

  const mcpServer = new McpServer({ name: "test", version: "0.1.0" });
  mcpServer.resource({
    uri: "file:///hello.txt",
    name: "hello",
    handler: () => ({
      contents: [{ uri: "file:///hello.txt", text: "Hello, resource!" }],
    }),
  });

  await mcpServer.connect(serverTransport);
  await completeHandshake(clientTransport);

  const listPromise = waitForMessage(clientTransport);
  await clientTransport.send({ jsonrpc: "2.0", id: 8, method: "resources/list" });
  const listResponse = await listPromise as JSONRPCResponse;

  const resources = (listResponse.result as { resources: Array<{ uri: string }> }).resources;
  assertEquals(resources[0].uri, "file:///hello.txt");

  const readPromise = waitForMessage(clientTransport);
  await clientTransport.send({
    jsonrpc: "2.0",
    id: 9,
    method: "resources/read",
    params: { uri: "file:///hello.txt" },
  });
  const readResponse = await readPromise as JSONRPCResponse;

  const contents = (readResponse.result as { contents: Array<{ text: string }> }).contents;
  assertEquals(contents[0].text, "Hello, resource!");
});

Deno.test("ProtocolHandler prompts/list and prompts/get", async () => {
  const [clientTransport, serverTransport] = createTransportPair();

  const mcpServer = new McpServer({ name: "test", version: "0.1.0" });
  mcpServer.prompt({
    name: "greeting",
    description: "A greeting prompt",
    handler: (args) => ({
      messages: [{
        role: "user",
        content: { type: "text", text: `Hello, ${args.name ?? "stranger"}!` },
      }],
    }),
  });

  await mcpServer.connect(serverTransport);
  await completeHandshake(clientTransport);

  const listPromise = waitForMessage(clientTransport);
  await clientTransport.send({ jsonrpc: "2.0", id: 10, method: "prompts/list" });
  const listResponse = await listPromise as JSONRPCResponse;

  const prompts = (listResponse.result as { prompts: Array<{ name: string }> }).prompts;
  assertEquals(prompts[0].name, "greeting");

  const getPromise = waitForMessage(clientTransport);
  await clientTransport.send({
    jsonrpc: "2.0",
    id: 11,
    method: "prompts/get",
    params: { name: "greeting", arguments: { name: "Alice" } },
  });
  const getResponse = await getPromise as JSONRPCResponse;

  const messages = (getResponse.result as {
    messages: Array<{ content: { text: string } }>;
  }).messages;
  assertEquals(messages[0].content.text, "Hello, Alice!");
});

Deno.test("StdioTransport serializes concurrent sends", async () => {
  const chunks: Uint8Array[] = [];
  let locked = false;

  const stdout = new WritableStream<Uint8Array>({
    write(chunk) {
      if (locked) {
        throw new Error("Concurrent write detected");
      }
      locked = true;
      chunks.push(chunk);
      return new Promise((resolve) => {
        setTimeout(() => {
          locked = false;
          resolve();
        }, 5);
      });
    },
  });

  const { StdioTransport } = await import("../src/transport/stdio.ts");
  const transport = new StdioTransport({ stdout });

  await Promise.all([
    transport.send({ jsonrpc: "2.0", id: 1, result: { a: 1 } }),
    transport.send({ jsonrpc: "2.0", id: 2, result: { b: 2 } }),
    transport.send({ jsonrpc: "2.0", id: 3, result: { c: 3 } }),
  ]);

  assertEquals(chunks.length, 3);
  await transport.close();
});
