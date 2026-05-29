# deno-mcp

A Deno-native [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server SDK with a
sandboxing CLI.

Built for Deno from the ground up — Web Streams, no Node shims, secure by default.

## Features

- **Deno-native API** — `McpServer` with Zod-validated tools, resources, and prompts
- **Stdio transport** — newline-delimited JSON-RPC over stdin/stdout
- **Sandboxing CLI** — `deno-mcp run` forwards Deno permission flags with zero permissions by
  default
- **Secure by default** — no filesystem, network, or env access unless explicitly granted

## Quick start

### Library

```typescript
import { McpServer } from "jsr:@kellen/deno-mcp";
import { z } from "zod";

const server = new McpServer({ name: "echo", version: "0.1.0" });

server.tool("echo", {
  description: "Echo a message",
  input: z.object({ message: z.string() }),
  handler: ({ message }) => ({
    content: [{ type: "text", text: message }],
  }),
});

if (import.meta.main) {
  await server.serveStdio();
}
```

Run directly:

```bash
deno run --no-prompt examples/echo_server.ts
```

### CLI

Install globally:

```bash
deno install --allow-run -n deno-mcp ./cli.ts
```

Run a server with sandboxing:

```bash
# Secure default — no permissions
deno-mcp run ./examples/echo_server.ts

# Grant specific permissions
deno-mcp run --allow-read=./data --allow-env=HOME ./server.ts

# Use a permission set from deno.json (Deno 2.5+)
deno-mcp run -P=mcp ./server.ts

# Pass args to the server script
deno-mcp run ./server.ts -- --verbose
```

## Security model

| Principle          | Detail                                                                   |
| ------------------ | ------------------------------------------------------------------------ |
| Default deny       | `deno-mcp run` grants zero permissions unless you pass `--allow-*` flags |
| No prompts         | `--no-prompt` is always injected — MCP clients use non-TTY stdio         |
| Stdout is protocol | Never log to stdout; use `log()` from `@kellen/deno-mcp/log` (stderr)    |
| Warn on `-A`       | CLI warns when `--allow-all` is used                                     |

### Recommended permission sets

Add to your `deno.json`:

```json
{
  "permissions": {
    "mcp": {
      "read": ["./"],
      "env": true
    },
    "mcp-with-data": {
      "read": ["./", "./data"],
      "write": ["./data"],
      "env": true
    }
  }
}
```

Then run with `-P=mcp` or `-P=mcp-with-data`.

## Cursor / Claude Desktop integration

```json
{
  "mcpServers": {
    "echo": {
      "command": "deno-mcp",
      "args": ["run", "./examples/echo_server.ts"]
    }
  }
}
```

With permissions:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "deno-mcp",
      "args": ["run", "--allow-read=./data", "./server.ts"]
    }
  }
}
```

## API reference

### `McpServer`

```typescript
const server = new McpServer({
  name: "my-server",
  version: "1.0.0",
  instructions: "Optional usage instructions for the client",
});

// Register a tool
server.tool("name", {
  description: "...",
  input: z.object({ ... }),
  handler: (input) => ({ content: [{ type: "text", text: "..." }] }),
});

// Register a resource
server.resource({
  uri: "file:///example.txt",
  name: "example",
  handler: () => ({ contents: [{ uri: "...", text: "..." }] }),
});

// Register a prompt
server.prompt({
  name: "greeting",
  handler: (args) => ({
    messages: [{ role: "user", content: { type: "text", text: "..." } }],
  }),
});

// Serve over stdio
await server.serveStdio();
```

### Low-level exports

- `ProtocolHandler` — request routing without the high-level API
- `StdioTransport` — stdio transport for custom setups
- `ReadBuffer`, `serializeMessage`, `deserializeMessage` — protocol framing
- `McpError`, `ErrorCode` — JSON-RPC error handling

## Development

```bash
deno task test      # run tests
deno task lint      # lint
deno task fmt       # format
deno task dev       # watch echo server
deno task install-cli  # install deno-mcp globally
```

## Comparison

| Use case                                | Recommendation                     |
| --------------------------------------- | ---------------------------------- |
| Native Deno + sandboxing CLI            | **deno-mcp** (this package)        |
| Node API compatibility                  | `npm:@modelcontextprotocol/server` |
| Deno project dev tools (test, coverage) | `jsr:@udibo/deno-mcp`              |

## License

MIT
