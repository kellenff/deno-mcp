/** Deno permission and runtime flags recognized by `deno-mcp run`. */
export const PERMISSION_FLAGS = new Set([
  "--allow-all",
  "-A",
  "--allow-read",
  "-R",
  "--allow-write",
  "-W",
  "--allow-net",
  "--allow-env",
  "--allow-run",
  "--allow-sys",
  "--allow-ffi",
  "--allow-import",
  "--deny-read",
  "--deny-write",
  "--deny-net",
  "--deny-env",
  "--deny-run",
  "--deny-sys",
  "--deny-ffi",
  "--deny-import",
  "--no-prompt",
  "--watch",
]);

/** Flags that take a value (either `--flag=value` or `--flag value`). */
export const VALUE_FLAGS = new Set([
  "--allow-read",
  "-R",
  "--allow-write",
  "-W",
  "--allow-net",
  "--allow-env",
  "--allow-run",
  "--allow-sys",
  "--allow-ffi",
  "--allow-import",
  "--deny-read",
  "--deny-write",
  "--deny-net",
  "--deny-env",
  "--deny-run",
  "--deny-sys",
  "--deny-ffi",
  "--deny-import",
  "--config",
  "-c",
  "--permission-set",
  "-P",
]);

export interface ParsedRunArgs {
  /** Deno runtime flags to pass before the entrypoint. */
  denoFlags: string[];
  /** Server entrypoint script path. */
  entrypoint: string;
  /** Arguments passed to the server script. */
  scriptArgs: string[];
  /** Whether --allow-all / -A was used. */
  allowAll: boolean;
}

/**
 * Parse `deno-mcp run` arguments into Deno flags, entrypoint, and script args.
 *
 * Usage: deno-mcp run [deno-flags...] <entrypoint> [-- script-args...]
 */
export function parseRunArgs(args: string[]): ParsedRunArgs {
  const denoFlags: string[] = [];
  let entrypoint: string | undefined;
  const scriptArgs: string[] = [];
  let allowAll = false;
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg === "--") {
      if (entrypoint !== undefined) {
        scriptArgs.push(...args.slice(i + 1));
      }
      break;
    }

    if (entrypoint === undefined && isDenoFlag(arg)) {
      const flag = baseFlag(arg);
      if (arg === "--allow-all" || arg === "-A") {
        allowAll = true;
      }

      // -P without value followed by an entrypoint is a common mistake
      if (
        (flag === "-P" || flag === "--permission-set") &&
        !arg.includes("=") &&
        i + 1 < args.length &&
        looksLikeEntrypoint(args[i + 1])
      ) {
        throw new Error(
          "-P requires a permission set name (e.g. -P=mcp). " +
            "To run a server without a permission set, omit -P: deno-mcp run " +
            args[i + 1],
        );
      }

      denoFlags.push(arg);

      // Handle --flag=value form
      if (arg.includes("=")) {
        i++;
        continue;
      }

      // Handle --flag value form for value-taking flags
      if (VALUE_FLAGS.has(flag) && i + 1 < args.length && !args[i + 1].startsWith("-")) {
        denoFlags.push(args[i + 1]);
        i += 2;
        continue;
      }

      i++;
      continue;
    }

    if (entrypoint === undefined && (arg === "--config" || arg === "-c")) {
      denoFlags.push(arg);
      if (i + 1 < args.length) {
        denoFlags.push(args[i + 1]);
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    if (entrypoint === undefined) {
      entrypoint = arg;
      i++;
      continue;
    }

    scriptArgs.push(arg);
    i++;
  }

  if (!entrypoint) {
    throw new Error(
      "Missing entrypoint. Usage: deno-mcp run [deno-flags...] <entrypoint> [-- script-args...]",
    );
  }

  return { denoFlags, entrypoint, scriptArgs, allowAll };
}

/** Check if an argument is a Deno permission or runtime flag. */
function isDenoFlag(arg: string): boolean {
  if (PERMISSION_FLAGS.has(arg)) return true;
  if (isPermissionSetFlag(arg)) return true;
  if (arg.startsWith("--allow-") || arg.startsWith("--deny-")) return true;
  if (arg === "--config" || arg === "-c" || arg === "--watch") return true;
  return false;
}

/** Extract the base flag name from `--flag=value` form. */
function baseFlag(arg: string): string {
  const eqIndex = arg.indexOf("=");
  return eqIndex === -1 ? arg : arg.slice(0, eqIndex);
}

function isPermissionSetFlag(arg: string): boolean {
  return arg === "--permission-set" || arg === "-P" ||
    arg.startsWith("--permission-set=") || arg.startsWith("-P=");
}

function looksLikeEntrypoint(arg: string): boolean {
  return /\.(tsx?|jsx?|mts|mjs)$/.test(arg) ||
    arg.startsWith("jsr:") ||
    arg.startsWith("npm:") ||
    arg.startsWith("./") ||
    arg.startsWith("../") ||
    arg.startsWith("/");
}

export function buildDenoRunArgs(parsed: ParsedRunArgs): string[] {
  const args = ["run", "--no-prompt"];

  // Avoid duplicate --no-prompt if user passed it
  const filteredFlags = parsed.denoFlags.filter((f) => f !== "--no-prompt");
  args.push(...filteredFlags, parsed.entrypoint, ...parsed.scriptArgs);

  return args;
}
