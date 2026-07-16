/**
 * Minimal structured logger + error-capture hook.
 *
 * - One JSON object per line to **stderr** (stdout is reserved for the stdio
 *   JSON-RPC protocol — logging to it corrupts the message stream).
 * - `captureError` emits a structured error line AND forwards to a registered
 *   sink (Sentry, wired by `initErrorTracking`). Kept dependency-free so any
 *   package can log without pulling in Sentry.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

type ErrorSink = (err: unknown, context?: LogFields) => void;

let errorSink: ErrorSink | null = null;

/** Register an error sink (e.g. Sentry). Apps call this once at startup. */
export function setErrorSink(sink: ErrorSink | null): void {
  errorSink = sink;
}

function emit(level: LogLevel, msg: string, fields?: LogFields): void {
  const record: Record<string, unknown> = { ts: new Date().toISOString(), level, msg };
  if (fields) for (const [k, v] of Object.entries(fields)) if (v !== undefined) record[k] = v;
  process.stderr.write(`${JSON.stringify(record)}\n`);
}

export const logger = {
  debug: (msg: string, fields?: LogFields): void => emit("debug", msg, fields),
  info: (msg: string, fields?: LogFields): void => emit("info", msg, fields),
  warn: (msg: string, fields?: LogFields): void => emit("warn", msg, fields),
  error: (msg: string, fields?: LogFields): void => emit("error", msg, fields),
};

/**
 * Log an error as a structured line and forward it to the error sink. Never
 * throws — a failing sink must not take down the request that reported the error.
 */
export function captureError(err: unknown, context?: LogFields): void {
  const message = err instanceof Error ? err.message : String(err);
  emit("error", message, {
    ...context,
    errorName: err instanceof Error ? err.name : typeof err,
    stack: err instanceof Error ? err.stack : undefined,
  });
  try {
    errorSink?.(err, context);
  } catch {
    /* the error sink must never throw */
  }
}
