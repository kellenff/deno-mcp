import { buildDenoRunArgs, parseRunArgs } from "./permissions.ts";

function printUsage(): void {
  console.error(`Usage: deno-mcp run [deno-flags...] <entrypoint> [-- script-args...]

Run an MCP server script with Deno sandboxing (secure by default).

Examples:
  deno-mcp run ./server.ts
  deno-mcp run --allow-read=./data ./server.ts
  deno-mcp run -P=mcp ./server.ts
  deno-mcp run ./server.ts -- --verbose

Deno permission flags are forwarded before the entrypoint.
--no-prompt is always injected (MCP clients use non-TTY stdio).
`);
}

export async function runCommand(args: string[]): Promise<number> {
  if (args.length === 0) {
    printUsage();
    return 1;
  }

  let parsed;
  try {
    parsed = parseRunArgs(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printUsage();
    return 1;
  }

  if (parsed.allowAll) {
    console.error(
      "Warning: --allow-all grants full permissions. Prefer explicit --allow-* flags.",
    );
  }

  const denoArgs = buildDenoRunArgs(parsed);

  const command = new Deno.Command(Deno.execPath(), {
    args: denoArgs,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const { code, signal } = await command.output();

  if (signal) {
    return 1;
  }

  return code ?? 1;
}
