# Scaling GEO Radar MCP

The design goal: **scale by adding instances**, with one small stateful tier.

```
MCP clients ──(stdio | streamable-HTTP)──▶ MCP WEB TIER (stateless, N instances)
                                                 │ enqueue panel run, return report_id
                                                 ▼
                                            QUEUE (Redis + BullMQ)
                                                 │
                                                 ▼
                                    PANEL WORKERS (M instances) ── call LLM panel,
                                                 │                  parse, score
                                   ┌─────────────┼─────────────┐
                                   ▼             ▼             ▼
                              Postgres       Redis cache   (GA4, optional)
                          (SoV time-series) (dedupe/rate-limit)
```

## Tiers

| Tier | Scales by | State |
|---|---|---|
| **MCP web** | instance count (behind Render's LB) | **stateless** — each HTTP request builds a fresh server+transport (`sessionIdGenerator: undefined`); `report_id` handles carry no hidden session state |
| **Panel workers** | worker count | stateless; work lives in the queue |
| **Queue / cache / rate-limit** | Redis (managed) | ephemeral |
| **Postgres** | vertical + read replicas | the **only** durable tier (SoV history) |

## Why the queue

Panel runs are the **bursty, slow** work (many LLM calls per run). The runner sits behind a `PanelRunner` interface: `InProcessPanelRunner` runs synchronously (default), and `QueuePanelRunner` (`PANEL_RUNNER=queue` + `REDIS_URL`) is a **fire-and-forget** BullMQ producer — it validates the request, creates the run row, enqueues the job, and returns `{ status: "queued", report_id }` **immediately** (no blocking on the multi-minute run). A worker in `apps/worker` finishes that same run row; the client polls `get_report(report_id)` until `status` is `completed`/`failed`. Both runners return the identical output shape, so the tool contract is unchanged.

## Reliability knobs (P6)

- **Idempotency** — job id derived from `(brand, prompt_set, panel, date)` so retries don't double-charge.
- **Dead-letter queue** — jobs that exhaust retries land in a DLQ for inspection, not silent loss.
- **Per-provider rate limiting** — Redis token bucket keyed by provider (anthropic/google/groq/perplexity), shared across web + worker instances, applied before every real upstream call (`packages/core/src/rate-limit.ts`). Active when `REDIS_URL` is set; disable with `PROVIDER_RATE_LIMIT=off`. Tune `PROVIDER_RATE_LIMIT_RPS` (default 5), `_BURST` (10), `_MAX_WAIT_MS` (30000). Fails **open** on Redis errors so a limiter outage never blocks work. ✅ implemented.
- **Cost caps** — `CostMeter` aborts a run before exceeding `PANEL_COST_CAP_USD_PER_RUN`; a global daily cap lives in Redis.

## Observability (P8)

- **`/healthz`** — liveness probe (Render `healthCheckPath`). ✅ implemented.
- **Structured JSON logs** — `logger` (`packages/core/src/logger.ts`) emits one JSON object per line to **stderr** (`{ts, level, msg, ...fields}`; stdout is reserved for the stdio JSON-RPC protocol). Server startup, OAuth mode, and worker job lifecycle all log through it. ✅ implemented.
- **Sentry error capture** — `captureError(err, context)` logs a structured error line **and** forwards to Sentry. `initErrorTracking()` (called from both app entrypoints) wires Sentry **only when `SENTRY_DSN` is set** (`@sentry/node` is dynamically imported; DSN-less deploys pay nothing and can't crash on init). Wired into the `/mcp` error handler and the worker `failed`/startup paths. Optional `SENTRY_TRACES_SAMPLE_RATE` (default 0) enables tracing. ✅ implemented.
- **OpenTelemetry** — `OTEL_EXPORTER_OTLP_ENDPOINT` remains reserved for a future trace path (`request → enqueue → worker → LLM call`); Sentry covers error capture today. ⏳ follow-up.

## Load testing

[`scripts/k6-load.js`](./scripts/k6-load.js) drives the HTTP tier:

```bash
# start the server: MCP_TRANSPORT=http PORT=8080 MCP_API_KEY=secret node apps/mcp-server/dist/index.js
BASE_URL=http://localhost:8080 MCP_API_KEY=secret k6 run scripts/k6-load.js
```

It ramps virtual users hitting `/healthz` and `initialize` + `tools/list`, asserting p95 latency and error-rate thresholds. Point it at a deployed URL to validate autoscaling.

## Deploy

[`render.yaml`](./render.yaml) provisions web (autoscale 1→3) + worker + Postgres + Redis. Secrets (`ANTHROPIC_API_KEY`, etc.) are `sync: false` — set them in the Render dashboard. `MCP_API_KEY` is auto-generated.
