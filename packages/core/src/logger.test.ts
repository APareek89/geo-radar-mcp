import { describe, it, expect, vi, afterEach } from "vitest";
import { logger, captureError, setErrorSink } from "./logger";

/** Capture what the logger writes to stderr for one call. */
function captureStderr(fn: () => void): string {
  const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    fn();
    return spy.mock.calls.map((c) => String(c[0])).join("");
  } finally {
    spy.mockRestore();
  }
}

describe("logger", () => {
  afterEach(() => setErrorSink(null));

  it("emits one JSON line per call with ts/level/msg and extra fields", () => {
    const out = captureStderr(() => logger.info("hello", { port: 8080 }));
    expect(out.endsWith("\n")).toBe(true);
    const rec = JSON.parse(out.trim());
    expect(rec).toMatchObject({ level: "info", msg: "hello", port: 8080 });
    expect(typeof rec.ts).toBe("string");
  });

  it("omits undefined fields", () => {
    const out = captureStderr(() => logger.warn("w", { a: 1, b: undefined }));
    const rec = JSON.parse(out.trim());
    expect(rec).toMatchObject({ a: 1 });
    expect("b" in rec).toBe(false);
  });

  it("captureError logs a structured error and forwards to the sink", () => {
    const sink = vi.fn();
    setErrorSink(sink);
    const err = new Error("boom");
    const out = captureStderr(() => captureError(err, { route: "/mcp" }));
    const rec = JSON.parse(out.trim());
    expect(rec).toMatchObject({ level: "error", msg: "boom", route: "/mcp", errorName: "Error" });
    expect(sink).toHaveBeenCalledWith(err, { route: "/mcp" });
  });

  it("never throws even if the sink throws", () => {
    setErrorSink(() => {
      throw new Error("sink exploded");
    });
    expect(() =>
      captureStderr(() => captureError(new Error("x"))),
    ).not.toThrow();
  });
});
