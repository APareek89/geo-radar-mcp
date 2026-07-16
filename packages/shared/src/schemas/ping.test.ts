import { describe, it, expect } from "vitest";
import { zodToJsonSchema } from "zod-to-json-schema";
import { PingInputSchema, PingOutputSchema } from "./ping";

describe("ping schemas", () => {
  it("accepts a valid input and rejects an over-long message", () => {
    expect(PingInputSchema.parse({ message: "hi" })).toEqual({ message: "hi" });
    expect(PingInputSchema.parse({})).toEqual({});
    expect(() => PingInputSchema.parse({ message: "x".repeat(501) })).toThrow();
  });

  it("derives a JSON Schema from the same Zod definition (single source of truth)", () => {
    const jsonSchema = zodToJsonSchema(PingInputSchema, "PingInput");
    // The derived schema must describe the same `message` field we validate against.
    const stringified = JSON.stringify(jsonSchema);
    expect(stringified).toContain("message");
  });

  it("validates a well-formed output record", () => {
    const ok = PingOutputSchema.parse({
      ok: true,
      echo: "pong",
      server: "geo-radar-mcp",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    });
    expect(ok.ok).toBe(true);
  });
});
