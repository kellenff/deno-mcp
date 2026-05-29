import type { JSONRPCMessage } from "./types.ts";

/** Maximum line length for a single JSON-RPC message (10 MiB). */
export const MAX_MESSAGE_LINE_BYTES = 10 * 1024 * 1024;

export class MessageTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`JSON-RPC message exceeds maximum line length of ${maxBytes} bytes`);
    this.name = "MessageTooLargeError";
  }
}

export function deserializeMessage(line: string): JSONRPCMessage {
  if (line.length > MAX_MESSAGE_LINE_BYTES) {
    throw new MessageTooLargeError(MAX_MESSAGE_LINE_BYTES);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    if (error instanceof SyntaxError) throw error;
    throw new SyntaxError("Invalid JSON");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new SyntaxError("Invalid JSON-RPC message: expected object");
  }

  const msg = parsed as Record<string, unknown>;
  if (msg.jsonrpc !== "2.0") {
    throw new SyntaxError("Invalid JSON-RPC message: jsonrpc must be '2.0'");
  }

  const hasMethod = "method" in msg && typeof msg.method === "string";
  const hasId = "id" in msg && msg.id !== undefined && msg.id !== null;
  const hasResult = "result" in msg;
  const hasError = "error" in msg;

  if (hasMethod && hasId) {
    return parsed as JSONRPCMessage;
  }

  if (hasMethod && !hasId) {
    return parsed as JSONRPCMessage;
  }

  if (!hasMethod && hasId && (hasResult || hasError)) {
    if (hasResult && hasError) {
      throw new SyntaxError("Invalid JSON-RPC response: result and error are mutually exclusive");
    }
    return parsed as JSONRPCMessage;
  }

  throw new SyntaxError("Invalid JSON-RPC message: unrecognized shape");
}

export function serializeMessage(message: JSONRPCMessage): string {
  return JSON.stringify(message) + "\n";
}

export function isRequest(
  message: JSONRPCMessage,
): message is JSONRPCMessage & { id: string | number; method: string } {
  return "method" in message && "id" in message;
}

export function isNotification(
  message: JSONRPCMessage,
): message is JSONRPCMessage & { method: string } {
  return "method" in message && !("id" in message);
}

export function isResponse(
  message: JSONRPCMessage,
): message is JSONRPCMessage & { id: string | number } {
  return !("method" in message) && "id" in message;
}
