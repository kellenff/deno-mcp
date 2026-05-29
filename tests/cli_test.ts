import { assertEquals } from "@std/assert";
import { buildDenoRunArgs, parseRunArgs } from "../src/cli/permissions.ts";

Deno.test("parseRunArgs - basic entrypoint only", () => {
  const parsed = parseRunArgs(["./server.ts"]);
  assertEquals(parsed.entrypoint, "./server.ts");
  assertEquals(parsed.denoFlags, []);
  assertEquals(parsed.scriptArgs, []);
  assertEquals(parsed.allowAll, false);
});

Deno.test("parseRunArgs - permission flags before entrypoint", () => {
  const parsed = parseRunArgs([
    "--allow-read=./data",
    "--allow-env=HOME",
    "./server.ts",
  ]);
  assertEquals(parsed.denoFlags, ["--allow-read=./data", "--allow-env=HOME"]);
  assertEquals(parsed.entrypoint, "./server.ts");
});

Deno.test("parseRunArgs - permission set flag", () => {
  const parsed = parseRunArgs(["-P=mcp", "./server.ts"]);
  assertEquals(parsed.denoFlags, ["-P=mcp"]);
  assertEquals(parsed.entrypoint, "./server.ts");
});

Deno.test("parseRunArgs - allow-all warns flag", () => {
  const parsed = parseRunArgs(["-A", "./server.ts"]);
  assertEquals(parsed.allowAll, true);
  assertEquals(parsed.denoFlags, ["-A"]);
});

Deno.test("parseRunArgs - script args after --", () => {
  const parsed = parseRunArgs(["./server.ts", "--", "--verbose", "extra"]);
  assertEquals(parsed.entrypoint, "./server.ts");
  assertEquals(parsed.scriptArgs, ["--verbose", "extra"]);
});

Deno.test("parseRunArgs - script args without --", () => {
  const parsed = parseRunArgs(["./server.ts", "arg1", "arg2"]);
  assertEquals(parsed.scriptArgs, ["arg1", "arg2"]);
});

Deno.test("parseRunArgs - value flags with separate value", () => {
  const parsed = parseRunArgs(["--allow-read", "./data", "./server.ts"]);
  assertEquals(parsed.denoFlags, ["--allow-read", "./data"]);
  assertEquals(parsed.entrypoint, "./server.ts");
});

Deno.test("parseRunArgs - config flag", () => {
  const parsed = parseRunArgs(["--config", "deno.json", "./server.ts"]);
  assertEquals(parsed.denoFlags, ["--config", "deno.json"]);
});

Deno.test("parseRunArgs - missing entrypoint throws", () => {
  let threw = false;
  try {
    parseRunArgs(["--allow-read"]);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("parseRunArgs - bare -P before entrypoint throws helpful error", () => {
  let message = "";
  try {
    parseRunArgs(["-P", "./server.ts"]);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertEquals(message.includes("-P=mcp"), true);
  assertEquals(message.includes("./server.ts"), true);
});

Deno.test("buildDenoRunArgs always includes --no-prompt", () => {
  const args = buildDenoRunArgs({
    denoFlags: [],
    entrypoint: "./server.ts",
    scriptArgs: [],
    allowAll: false,
  });
  assertEquals(args[0], "run");
  assertEquals(args[1], "--no-prompt");
  assertEquals(args[2], "./server.ts");
});

Deno.test("buildDenoRunArgs forwards flags and script args", () => {
  const args = buildDenoRunArgs({
    denoFlags: ["--allow-read=./data"],
    entrypoint: "./server.ts",
    scriptArgs: ["--verbose"],
    allowAll: false,
  });
  assertEquals(args, ["run", "--no-prompt", "--allow-read=./data", "./server.ts", "--verbose"]);
});

Deno.test("buildDenoRunArgs deduplicates --no-prompt", () => {
  const args = buildDenoRunArgs({
    denoFlags: ["--no-prompt", "--allow-read"],
    entrypoint: "./server.ts",
    scriptArgs: [],
    allowAll: false,
  });
  const noPromptCount = args.filter((a) => a === "--no-prompt").length;
  assertEquals(noPromptCount, 1);
});
