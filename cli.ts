#!/usr/bin/env -S deno run --allow-run

import { runCommand } from "./src/cli/run.ts";

const [subcommand, ...args] = Deno.args;

switch (subcommand) {
  case "run":
    Deno.exit(await runCommand(args));
    break;
  default:
    if (subcommand === undefined || subcommand === "--help" || subcommand === "-h") {
      console.error(`deno-mcp — Deno-native MCP server runner

Usage:
  deno-mcp run [deno-flags...] <entrypoint> [-- script-args...]

Commands:
  run    Run an MCP server with Deno sandboxing (secure by default)

Examples:
  deno-mcp run ./examples/echo_server.ts
  deno-mcp run --allow-read=./data ./server.ts
  deno-mcp run -P=mcp ./server.ts
`);
      Deno.exit(subcommand === undefined ? 1 : 0);
    }
    console.error(`Unknown command: ${subcommand}. Run 'deno-mcp --help' for usage.`);
    Deno.exit(1);
}
