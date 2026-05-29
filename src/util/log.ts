/** Write log messages to stderr. Never use stdout — it carries MCP protocol data. */
export function log(...args: unknown[]): void {
  const message = args.map((arg) => typeof arg === "string" ? arg : Deno.inspect(arg)).join(" ");
  Deno.stderr.writeSync(new TextEncoder().encode(message + "\n"));
}
