import { assertEquals } from "@std/assert";
import { ReadBuffer } from "../src/protocol/read_buffer.ts";
import {
  deserializeMessage,
  MessageTooLargeError,
  serializeMessage,
} from "../src/protocol/json_rpc.ts";
import type { JSONRPCRequest } from "../src/protocol/types.ts";

const encoder = new TextEncoder();

Deno.test("ReadBuffer parses a complete message", () => {
  const buffer = new ReadBuffer();
  const request: JSONRPCRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "ping",
  };
  buffer.append(encoder.encode(serializeMessage(request)));
  const message = buffer.readMessage();
  assertEquals(message, request);
});

Deno.test("ReadBuffer handles partial chunks", () => {
  const buffer = new ReadBuffer();
  const line = serializeMessage({ jsonrpc: "2.0", id: 2, method: "ping" });
  const bytes = encoder.encode(line);

  buffer.append(bytes.subarray(0, 5));
  assertEquals(buffer.readMessage(), null);

  buffer.append(bytes.subarray(5));
  const message = buffer.readMessage();
  assertEquals((message as JSONRPCRequest).method, "ping");
});

Deno.test("ReadBuffer handles multiple messages", () => {
  const buffer = new ReadBuffer();
  const msg1 = serializeMessage({ jsonrpc: "2.0", id: 1, method: "a" });
  const msg2 = serializeMessage({ jsonrpc: "2.0", id: 2, method: "b" });
  buffer.append(encoder.encode(msg1 + msg2));

  assertEquals((buffer.readMessage() as JSONRPCRequest).method, "a");
  assertEquals((buffer.readMessage() as JSONRPCRequest).method, "b");
  assertEquals(buffer.readMessage(), null);
});

Deno.test("ReadBuffer skips non-JSON lines", () => {
  const buffer = new ReadBuffer();
  buffer.append(encoder.encode("not json\n"));
  buffer.append(encoder.encode(
    serializeMessage({ jsonrpc: "2.0", id: 1, method: "ping" }),
  ));
  const message = buffer.readMessage();
  assertEquals((message as JSONRPCRequest).method, "ping");
});

Deno.test("ReadBuffer strips CRLF line endings", () => {
  const buffer = new ReadBuffer();
  buffer.append(encoder.encode('{"jsonrpc":"2.0","id":1,"method":"ping"}\r\n'));
  const message = buffer.readMessage();
  assertEquals((message as JSONRPCRequest).method, "ping");
});

Deno.test("serializeMessage and deserializeMessage roundtrip", () => {
  const original = { jsonrpc: "2.0" as const, id: 42, method: "test", params: { a: 1 } };
  const line = serializeMessage(original);
  const parsed = deserializeMessage(line.trim());
  assertEquals(parsed, original);
});

Deno.test("ReadBuffer clear resets state", () => {
  const buffer = new ReadBuffer();
  buffer.append(encoder.encode('{"partial":'));
  buffer.clear();
  assertEquals(buffer.readMessage(), null);
});

Deno.test("ReadBuffer rejects oversized lines", () => {
  const buffer = new ReadBuffer();
  const oversized = "x".repeat(10 * 1024 * 1024 + 1);
  let threw = false;
  try {
    buffer.append(encoder.encode(oversized));
  } catch (error) {
    threw = error instanceof MessageTooLargeError;
  }
  assertEquals(threw, true);
});

Deno.test("deserializeMessage rejects invalid shapes", () => {
  const cases = [
    '{"jsonrpc":"2.0","id":1}',
    '{"jsonrpc":"2.0","id":1,"result":{},"error":{"code":1,"message":"x"}}',
  ];
  for (const line of cases) {
    let threw = false;
    try {
      deserializeMessage(line);
    } catch (error) {
      threw = error instanceof SyntaxError;
    }
    assertEquals(threw, true);
  }
});
