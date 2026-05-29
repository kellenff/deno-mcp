import type { JSONRPCMessage } from "./types.ts";
import { deserializeMessage, MAX_MESSAGE_LINE_BYTES, MessageTooLargeError } from "./json_rpc.ts";

/**
 * Buffers a continuous stdio stream into discrete JSON-RPC messages.
 */
export class ReadBuffer {
  private buffer = new Uint8Array(0);
  private readonly decoder = new TextDecoder();

  append(chunk: Uint8Array): void {
    if (this.buffer.length + chunk.length > MAX_MESSAGE_LINE_BYTES) {
      throw new MessageTooLargeError(MAX_MESSAGE_LINE_BYTES);
    }

    if (this.buffer.length === 0) {
      this.buffer = new Uint8Array(chunk);
      return;
    }
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;
  }

  readMessage(): JSONRPCMessage | null {
    while (this.buffer.length > 0) {
      const newlineIndex = this.indexOfNewline(this.buffer);
      if (newlineIndex === -1) {
        if (this.buffer.length > MAX_MESSAGE_LINE_BYTES) {
          throw new MessageTooLargeError(MAX_MESSAGE_LINE_BYTES);
        }
        return null;
      }

      if (newlineIndex > MAX_MESSAGE_LINE_BYTES) {
        throw new MessageTooLargeError(MAX_MESSAGE_LINE_BYTES);
      }

      const lineBytes = this.buffer.subarray(0, newlineIndex);
      this.buffer = this.buffer.subarray(newlineIndex + 1);

      let line = this.decoder.decode(lineBytes);
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }

      if (line.length === 0) {
        continue;
      }

      try {
        return deserializeMessage(line);
      } catch (error) {
        if (error instanceof SyntaxError) {
          continue;
        }
        throw error;
      }
    }
    return null;
  }

  clear(): void {
    this.buffer = new Uint8Array(0);
  }

  private indexOfNewline(buffer: Uint8Array): number {
    for (let i = 0; i < buffer.length; i++) {
      if (buffer[i] === 0x0a) {
        return i;
      }
    }
    return -1;
  }
}
