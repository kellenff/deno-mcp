import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/** Convert a Zod schema to a JSON Schema object for MCP tool inputSchema. */
export function toInputSchema(schema: z.ZodType): Record<string, unknown> {
  return zodToJsonSchema(schema) as Record<string, unknown>;
}

/** Parse tool input against a Zod schema, throwing on invalid input. */
export function parseInput<T extends z.ZodType>(
  schema: T,
  input: unknown,
): z.infer<T> {
  return schema.parse(input);
}
