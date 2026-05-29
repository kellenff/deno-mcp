import { ReadBuffer } from "../protocol/read_buffer.ts";
import { serializeMessage } from "../protocol/json_rpc.ts";
import type { JSONRPCMessage } from "../protocol/types.ts";
import type { Transport } from "./transport.ts";

export interface StdioTransportOptions {
  stdin?: ReadableStream<Uint8Array>;
  stdout?: WritableStream<Uint8Array>;
}

/**
 * MCP stdio transport using Deno stdin/stdout Web Streams.
 * Protocol messages go to stdout; logging must use stderr.
 */
export class StdioTransport implements Transport {
  private readonly readBuffer = new ReadBuffer();
  private readonly encoder = new TextEncoder();
  private started = false;
  private closed = false;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private readLoopPromise: Promise<void> | null = null;
  /** Serializes outbound writes to avoid concurrent writer lock errors. */
  private sendChain: Promise<void> = Promise.resolve();

  constructor(private readonly options: StdioTransportOptions = {}) {}

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  start(): Promise<void> {
    if (this.started) {
      throw new Error(
        "StdioTransport already started. connect() calls start() automatically.",
      );
    }
    this.started = true;

    const stdin = this.options.stdin ?? Deno.stdin.readable;
    this.reader = stdin.getReader();
    this.readLoopPromise = this.readLoop();
    return Promise.resolve();
  }

  private async readLoop(): Promise<void> {
    if (!this.reader) return;

    try {
      while (!this.closed) {
        const { done, value } = await this.reader.read();
        if (done) break;
        if (value) {
          this.processChunk(value);
        }
      }
    } catch (error) {
      if (!this.closed) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private processChunk(chunk: Uint8Array): void {
    this.readBuffer.append(chunk);
    while (true) {
      try {
        const message = this.readBuffer.readMessage();
        if (message === null) break;
        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.closed) {
      throw new Error("StdioTransport is closed");
    }

    const next = this.sendChain.then(() => this.writeMessage(message));
    this.sendChain = next.catch(() => {});
    await next;
  }

  private async writeMessage(message: JSONRPCMessage): Promise<void> {
    if (this.closed) {
      throw new Error("StdioTransport is closed");
    }

    const stdout = this.options.stdout ?? Deno.stdout.writable;
    const writer = stdout.getWriter();
    try {
      await writer.write(this.encoder.encode(serializeMessage(message)));
    } finally {
      writer.releaseLock();
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    await this.sendChain.catch(() => {});

    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {
        // ignore cancel errors
      }
      this.reader.releaseLock();
      this.reader = null;
    }

    if (this.readLoopPromise) {
      await this.readLoopPromise.catch(() => {});
      this.readLoopPromise = null;
    }

    this.readBuffer.clear();
    this.onclose?.();
  }
}
