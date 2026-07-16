import { z } from "zod";

/**
 * `ping` — a trivial health-check tool. It proves the transport wiring end-to-end
 * (client → transport → server → handler → back) before we add any provider calls.
 *
 * We keep the Zod schema here in the shared package so it is the SINGLE source of
 * truth: the MCP server uses it for runtime validation, and `zod-to-json-schema`
 * derives the published JSON Schema 2020-12 from the very same definition.
 */
export const PingInputSchema = z
  .object({
    message: z
      .string()
      .max(500)
      .optional()
      .describe("Optional message to echo back. Defaults to \"pong\"."),
  })
  .describe("Input for the ping health-check tool.");

export type PingInput = z.infer<typeof PingInputSchema>;

export const PingOutputSchema = z
  .object({
    ok: z.literal(true),
    echo: z.string().describe("The echoed message (or \"pong\")."),
    server: z.string().describe("Server name."),
    version: z.string().describe("Server version."),
    timestamp: z.string().describe("ISO-8601 timestamp when the ping was handled."),
  })
  .describe("Output of the ping health-check tool.");

export type PingOutput = z.infer<typeof PingOutputSchema>;
