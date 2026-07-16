import { logger, setErrorSink } from "./logger";

/**
 * Initialize error tracking. Sentry is wired **only when `SENTRY_DSN` is set** —
 * otherwise this is a no-op and errors still go to the structured stderr log via
 * `captureError`. `@sentry/node` is imported dynamically so a DSN-less deploy pays
 * no init cost and the import can't crash startup.
 *
 * Returns true if Sentry was initialized.
 */
export async function initErrorTracking(): Promise<boolean> {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return false;
  try {
    const Sentry = await import("@sentry/node");
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? "production",
      // Error capture only by default; opt into tracing via SENTRY_TRACES_SAMPLE_RATE.
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0") || 0,
    });
    setErrorSink((err, context) => {
      Sentry.captureException(err, context ? { extra: context } : undefined);
    });
    logger.info("error tracking: sentry initialized", {
      env: process.env.NODE_ENV ?? "production",
    });
    return true;
  } catch (err) {
    logger.warn("error tracking: sentry init failed, continuing with stderr logging only", {
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
