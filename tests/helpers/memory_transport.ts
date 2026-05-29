import type { JSONRPCMessage } from "../../src/protocol/types.ts";
import type { Transport } from "../../src/transport/transport.ts";

export interface TestTransport extends Transport {
  sent: JSONRPCMessage[];
}

/** Create a linked pair of transports for bidirectional testing. */
export function createTransportPair(): [TestTransport, TestTransport] {
  const clientResponses: JSONRPCMessage[] = [];
  const serverResponses: JSONRPCMessage[] = [];

  const serverSide: TestTransport = {
    sent: serverResponses,
    onclose: undefined,
    onerror: undefined,
    onmessage: undefined,
    start() {
      return Promise.resolve();
    },
    send(message) {
      serverResponses.push(message);
      queueMicrotask(() => clientSide.onmessage?.(message));
      return Promise.resolve();
    },
    close() {
      serverSide.onclose?.();
      return Promise.resolve();
    },
  };

  const clientSide: TestTransport = {
    sent: clientResponses,
    onclose: undefined,
    onerror: undefined,
    onmessage: undefined,
    start() {
      return Promise.resolve();
    },
    send(message) {
      clientResponses.push(message);
      queueMicrotask(() => serverSide.onmessage?.(message));
      return Promise.resolve();
    },
    close() {
      clientSide.onclose?.();
      return Promise.resolve();
    },
  };

  return [clientSide, serverSide];
}

/** Wait for the next message received by a transport (via onmessage). */
export function waitForMessage(
  transport: TestTransport,
  timeoutMs = 1000,
): Promise<JSONRPCMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for message")), timeoutMs);
    const prev = transport.onmessage;
    transport.onmessage = (message) => {
      clearTimeout(timer);
      transport.onmessage = prev;
      prev?.(message);
      resolve(message);
    };
  });
}
