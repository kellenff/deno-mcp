import { deserializeMessage, isRequest } from "../protocol/json_rpc.ts";
import { SUPPORTED_PROTOCOL_VERSIONS } from "../protocol/types.ts";
import type { JSONRPCMessage } from "../protocol/types.ts";
import type { ProtocolHandler } from "../server/protocol_handler.ts";

const SESSION_HEADER = "Mcp-Session-Id";
const PROTOCOL_VERSION_HEADER = "MCP-Protocol-Version";

export interface StreamableHttpOptions {
  /** Hostname to bind. Defaults to 127.0.0.1 for local-only access. */
  hostname?: string;
  /** Port to listen on. Use 0 for an ephemeral port. Defaults to 3000. */
  port?: number;
  /** MCP endpoint path. Defaults to /mcp. */
  path?: string;
  /** Allowed Origin header values. Defaults to localhost origins. */
  allowedOrigins?: string[];
  /** Factory for a new per-session protocol handler. */
  createSession: () => ProtocolHandler;
}

const DEFAULT_ALLOWED_ORIGINS = [
  "http://127.0.0.1",
  "http://localhost",
  "https://127.0.0.1",
  "https://localhost",
];

/**
 * MCP Streamable HTTP server (JSON response mode).
 * Supports POST for client messages, GET returns 405, DELETE terminates sessions.
 */
export class StreamableHttpServer {
  private readonly sessions = new Map<string, ProtocolHandler>();
  private readonly hostname: string;
  private readonly port: number;
  private readonly path: string;
  private readonly allowedOrigins: Set<string>;
  private readonly createSession: () => ProtocolHandler;
  private httpServer: Deno.HttpServer | null = null;
  private actualPort: number | null = null;
  private listenReady: Promise<void> | null = null;

  constructor(options: StreamableHttpOptions) {
    this.hostname = options.hostname ?? "127.0.0.1";
    this.port = options.port ?? 3000;
    this.path = normalizePath(options.path ?? "/mcp");
    this.allowedOrigins = new Set(options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS);
    this.createSession = options.createSession;
  }

  /** Base URL after listen() (e.g. http://127.0.0.1:3000/mcp). */
  get url(): string {
    if (this.actualPort === null) {
      throw new Error("StreamableHttpServer is not listening");
    }
    return `http://${this.hostname}:${this.actualPort}${this.path}`;
  }

  /** Start the HTTP server. Returns the Deno.HttpServer handle. */
  listen(): Deno.HttpServer {
    if (this.httpServer) {
      throw new Error("StreamableHttpServer already listening");
    }

    this.listenReady = new Promise((resolve) => {
      this.httpServer = Deno.serve(
        {
          hostname: this.hostname,
          port: this.port,
          onListen: ({ port }) => {
            this.actualPort = port;
            resolve();
          },
        },
        (request) => this.handleRequest(request),
      );
    });

    return this.httpServer!;
  }

  /** Wait until the server is bound and {@link url} is available. */
  async ready(): Promise<void> {
    if (!this.listenReady) {
      throw new Error("StreamableHttpServer is not listening");
    }
    await this.listenReady;
  }

  /** Shut down the server and clear all sessions. */
  async close(): Promise<void> {
    this.sessions.clear();
    if (this.httpServer) {
      await this.httpServer.shutdown();
      this.httpServer = null;
      this.actualPort = null;
    }
  }

  private handleRequest(request: Request): Response | Promise<Response> {
    const url = new URL(request.url);
    if (normalizePath(url.pathname) !== this.path) {
      return new Response("Not Found", { status: 404 });
    }

    const originError = this.validateOrigin(request);
    if (originError) return originError;

    switch (request.method) {
      case "POST":
        return this.handlePost(request);
      case "GET":
        return new Response("Method Not Allowed", { status: 405 });
      case "DELETE":
        return this.handleDelete(request);
      default:
        return new Response("Method Not Allowed", { status: 405 });
    }
  }

  private validateOrigin(request: Request): Response | null {
    const origin = request.headers.get("Origin");
    if (!origin) return null;

    if (!this.allowedOrigins.has(origin)) {
      return new Response("Forbidden", { status: 403 });
    }
    return null;
  }

  private validateProtocolVersion(request: Request): Response | null {
    const version = request.headers.get(PROTOCOL_VERSION_HEADER);
    if (!version) return null;

    if (
      !SUPPORTED_PROTOCOL_VERSIONS.includes(
        version as typeof SUPPORTED_PROTOCOL_VERSIONS[number],
      )
    ) {
      return new Response("Bad Request", { status: 400 });
    }
    return null;
  }

  private validateAccept(request: Request): Response | null {
    const accept = request.headers.get("Accept") ?? "";
    if (
      !accept.includes("application/json") ||
      !accept.includes("text/event-stream")
    ) {
      return new Response("Bad Request", { status: 400 });
    }
    return null;
  }

  private async handlePost(request: Request): Promise<Response> {
    const acceptError = this.validateAccept(request);
    if (acceptError) return acceptError;

    const versionError = this.validateProtocolVersion(request);
    if (versionError) return versionError;

    let message: JSONRPCMessage;
    try {
      const body = await request.text();
      message = deserializeMessage(body.trim());
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    const sessionId = request.headers.get(SESSION_HEADER);
    const isInitialize = isRequest(message) && message.method === "initialize";

    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return new Response("Not Found", { status: 404 });
      }
      return this.processAndRespond(session, message);
    }

    if (!isInitialize) {
      return new Response("Bad Request", { status: 400 });
    }

    const newSessionId = crypto.randomUUID();
    const session = this.createSession();
    this.sessions.set(newSessionId, session);

    const response = await this.processAndRespond(session, message);
    const headers = new Headers(response.headers);
    headers.set(SESSION_HEADER, newSessionId);
    return new Response(response.body, {
      status: response.status,
      headers,
    });
  }

  private handleDelete(request: Request): Response {
    const versionError = this.validateProtocolVersion(request);
    if (versionError) return versionError;

    const sessionId = request.headers.get(SESSION_HEADER);
    if (!sessionId || !this.sessions.has(sessionId)) {
      return new Response("Not Found", { status: 404 });
    }

    this.sessions.delete(sessionId);
    return new Response(null, { status: 200 });
  }

  private async processAndRespond(
    session: ProtocolHandler,
    message: JSONRPCMessage,
  ): Promise<Response> {
    const response = await session.processMessage(message);

    if (response === null) {
      return new Response(null, { status: 202 });
    }

    return Response.json(response, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
}

function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }
  return path;
}
