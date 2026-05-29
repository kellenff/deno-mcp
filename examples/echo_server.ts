import { McpServer } from "../mod.ts";
import { z } from "zod";

const server = new McpServer({
  name: "echo",
  version: "0.1.0",
  instructions: "A minimal echo MCP server.",
});

server.tool("echo", {
  description: "Echo a message back to the caller",
  input: z.object({
    message: z.string().describe("The message to echo"),
  }),
  handler: ({ message }) => ({
    content: [{ type: "text", text: message }],
  }),
});

if (import.meta.main) {
  await server.serveStdio();
}
