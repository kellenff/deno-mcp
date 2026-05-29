import { assertEquals, assertExists } from "@std/assert";
import { buildDenoRunArgs } from "../src/cli/permissions.ts";
import { serializeMessage } from "../src/protocol/json_rpc.ts";
import type { JSONRPCResponse } from "../src/protocol/types.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function runEchoServer(args: string[]) {
  const command = new Deno.Command(Deno.execPath(), {
    args,
    stdin: "piped",
    stdout: "piped",
    stderr: "null",
  });
  return command.spawn();
}

async function handshakeAndEcho(
  child: Deno.ChildProcess,
): Promise<string> {
  const writer = child.stdin.getWriter();
  const reader = child.stdout.getReader();

  async function send(method: string, id: number, params?: unknown) {
    const msg = { jsonrpc: "2.0" as const, id, method, ...(params ? { params } : {}) };
    await writer.write(encoder.encode(serializeMessage(msg)));
  }

  async function readResponse(): Promise<JSONRPCResponse> {
    const buffer: number[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new Error("Stream closed before response");
      for (const byte of value) {
        buffer.push(byte);
        if (byte === 0x0a) {
          const line = decoder.decode(new Uint8Array(buffer)).trim();
          return JSON.parse(line) as JSONRPCResponse;
        }
      }
    }
  }

  await send("initialize", 1, {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test", version: "0.0.1" },
  });
  await readResponse();

  await writer.write(encoder.encode(
    serializeMessage({ jsonrpc: "2.0", method: "notifications/initialized" }),
  ));

  await send("tools/call", 2, {
    name: "echo",
    arguments: { message: "hello stdio" },
  });
  const callResponse = await readResponse();
  const text = (callResponse.result as { content: Array<{ text: string }> }).content[0].text;

  writer.releaseLock();
  await child.stdin.close();
  reader.releaseLock();
  await child.stdout.cancel();
  child.kill("SIGTERM");
  await child.status;

  return text;
}

Deno.test("stdio integration - echo server via deno run", async () => {
  const child = runEchoServer(["run", "--no-prompt", "examples/echo_server.ts"]);
  const text = await handshakeAndEcho(child);
  assertEquals(text, "hello stdio");
});

Deno.test("stdio integration - echo server via deno-mcp run", async () => {
  const denoArgs = buildDenoRunArgs({
    denoFlags: [],
    entrypoint: "examples/echo_server.ts",
    scriptArgs: [],
    allowAll: false,
  });
  const child = runEchoServer(denoArgs);
  const text = await handshakeAndEcho(child);
  assertEquals(text, "hello stdio");
});

Deno.test("stdio integration - response includes server name", async () => {
  const child = runEchoServer(["run", "--no-prompt", "examples/echo_server.ts"]);
  const writer = child.stdin.getWriter();
  const reader = child.stdout.getReader();

  await writer.write(encoder.encode(serializeMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "0.0.1" },
    },
  })));

  const buffer: number[] = [];
  while (true) {
    const { value } = await reader.read();
    for (const byte of value!) {
      buffer.push(byte);
      if (byte === 0x0a) break;
    }
    if (buffer.at(-1) === 0x0a) break;
  }

  const initResponse = JSON.parse(decoder.decode(new Uint8Array(buffer)).trim()) as JSONRPCResponse;
  assertExists(initResponse.result);
  assertEquals(
    (initResponse.result as { serverInfo: { name: string } }).serverInfo.name,
    "echo",
  );

  writer.releaseLock();
  await child.stdin.close();
  reader.releaseLock();
  await child.stdout.cancel();
  child.kill("SIGTERM");
  await child.status;
});
