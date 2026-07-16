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

Panel runs are the **bursty, slow** work (many LLM calls per run). Today the runner is in-process (`InProcessPanelRunner`); it sits behind a `PanelRunner` interface so P6 swaps in a BullMQ producer on the web tier and a consumer in `apps/worker` **without changing any tool contract**. `measure_share_of_voice` already returns a `report_id` and the client polls `get_report` — the async pattern is in place.

## Reliability knobs (P6)

- **Idempotency** — job id derived from `(brand, prompt_set, panel, date)` so retries don't double-charge.
- **Dead-letter queue** — jobs that exhaust retries land in a DLQ for inspection, not silent loss.
- **Per-key rate limiting** — Redis token bucket per provider key to stay under free-tier limits.
- **Cost caps** — `CostMeter` aborts a run before exceeding `PANEL_COST_CAP_USD_PER_RUN`; a global daily cap lives in Redis.

## Observability (P8)

- **`/healthz`** — liveness probe (Render `healthCheckPath`). ✅ implemented.
- **Structured stderr logs** — the server logs readiness/errors to stderr (stdout is reserved for the stdio protocol). ✅ implemented.
- **OpenTelemetry / Sentry** — env vars are **reserved** (`OTEL_EXPORTER_OTLP_ENDPOINT`, `SENTRY_DSN`) and the intended trace path is `request → enqueue → worker → LLM call`. ⏳ **the init code is a follow-up** — not yet wired. (Flagged by the FMEA as PRD/reality drift; tracked in `docs/FMEA-P3-P12.md`.)

## Load testing

[`scripts/k6-load.js`](./scripts/k6-load.js) drives the HTTP tier:

```bash
# start the server: MCP_TRANSPORT=http PORT=8080 MCP_API_KEY=secret node apps/mcp-server/dist/index.js
BASE_URL=http://localhost:8080 MCP_API_KEY=secret k6 run scripts/k6-load.js
```

It ramps virtual users hitting `/healthz` and `initialize` + `tools/list`, asserting p95 latency and error-rate thresholds. Point it at a deployed URL to validate autoscaling.

## Deploy

[`render.yaml`](./render.yaml) provisions web (autoscale 1→3) + worker + Postgres + Redis. Secrets (`ANTHROPIC_API_KEY`, etc.) are `sync: false` — set them in the Render dashboard. `MCP_API_KEY` is auto-generated.
