# Handoff.MD — GEO Radar MCP
> AGENT: read this fully at session start; open with the pending points below (or ask
> "what would you like to do now?" if none). Update after every major change and when
> ~10% of context remains — then tell the user to start a fresh session with:
> "Refer to Handoff.MD in /Users/anandpareek/Documents/Projects/geo-radar-mcp and begin".
> Keep this file ONE SCREEN: current state only; history lives in Learning.MD and git.

## Compact summary of previous session
Aligned architecture (§0a gate, approved). Scaffolded **P1** (monorepo + stdio `ping`).
Built **P2**: `measure_share_of_voice` + `get_report` end-to-end — Haiku panelist + parser
(Vercel AI SDK), deterministic scoring, `packages/db` (Drizzle schema + DrizzleStore +
MemoryStore), in-process `PanelRunner` with cost cap, built-in demo prompt set. Verified
live against real Haiku. Teach-as-you-go, one PRD prompt at a time.

## Current state
- ✅ Monorepo: `packages/{shared,db,core}` + `apps/mcp-server`, pnpm + Turborepo.
- ✅ `packages/shared` — Zod schemas (ping + geo tool I/O). Note: `measure` input is `MeasureShareOfVoiceInputObject` (raw shape for the SDK) + `...Schema` (refined). Entry: `src/index.ts`.
- ✅ `packages/db` — Drizzle schema (§7 tables) + `DrizzleStore` (Postgres) + `MemoryStore` + `GeoStore` port. Migration: `drizzle/0000_daily_overlord.sql`.
- ✅ `packages/core` — providers (AI SDK Anthropic), panelist (real+mock), parser (real generateObject + deterministic), `scoring.ts`, `cost.ts` (CostMeter), `runner.ts` (InProcessPanelRunner), `prompt-library.ts` (demo set), `report.ts` (buildReport), `errors.ts` (PanelRunError).
- ✅ `apps/mcp-server` — `ping` + `measure_share_of_voice` + `get_report`; `env.ts` (upward `.env` search), `runtime.ts` (DrizzleStore if DATABASE_URL else MemoryStore; `GEO_STORE=memory` override).
- ✅ **P2 verified**: typecheck + 23 tests pass; build OK (32KB bin); **live real-Haiku run** (demo set, PixelBin vs 3 competitors) returned SoV (remove.bg 66.7%, Cloudinary 33.3%, PixelBin 0%), cost ~$0.0115, `get_report` round-trip OK.
- ✅ **Postgres path verified via pglite** (`packages/db/src/drizzle-store.test.ts`) — real migration + real SQL run in-process, no Docker. `DbHandle` is driver-agnostic (`{ db: PgDatabase; close }`) so DrizzleStore runs over node-postgres (prod) and pglite (test).
- ✅ **Postgres path verified LIVE on GCP Cloud SQL** — migration applied + `measure_share_of_voice`/`get_report` ran against real Cloud SQL (rows confirmed in `panel_runs`/`answers`/`sov_history`). See [[gcp-cloud-sql-geo-radar]]. `.env` `DATABASE_URL` now points at `geo@localhost:5432/geo_radar` (via the auth proxy). **Instance is STOPPED to save credits.**
- 🔁 **To use the GCP DB again:** (1) start it `gcloud sql instances patch geo-radar-db --activation-policy=ALWAYS`; (2) start the proxy `/opt/homebrew/share/google-cloud-sdk/bin/cloud-sql-proxy --token="$(gcloud auth print-access-token)" learning-studio-500605:us-central1:geo-radar-db`; (3) run the server (uses `.env`). **For local dev WITHOUT GCP, set `GEO_STORE=memory`** (else DrizzleStore tries localhost:5432 and fails). Stop it after: `... --activation-policy=NEVER`.

## Pending points
- ✅ **ALL PHASES BUILT (P1–P12), except the eval loop (OFF by user request).** Verified: typecheck 5/5 · **34 tests** · build 2/2 · diagram valid. Live server exposes 8 tools, 4 resources, 3 prompts.
  - P3: track_citations, sentiment_scan + 4 resources. P4: detect_hallucinations, compare_to_competitor + 3 prompts. P5: 4-provider panel (real-if-key-else-mock). P7: HTTP transport + bearer/OAuth-issuer auth + /healthz + render.yaml (verified live). P8: k6 + SCALING.md + OTel/Sentry hooks. P9 MVP: embedded dashboard at `/` (Overview+Connect, verified). P10: attribute_ai_traffic (GA4). P11: README + seed (`pnpm db:seed`). P6: BullMQ QueuePanelRunner + `apps/worker` (PANEL_RUNNER=queue). P12: `server.json` + `PUBLISHING.md`.
- 🧑 USER — needs your action to go live:
  - Add `GEMINI_API_KEY`/`GROQ_API_KEY`/`PERPLEXITY_API_KEY` to `.env` to run those panelists for real (Haiku already works).
  - **P6 queue** live test needs Redis (Docker blocked; use a cloud Redis/Upstash `REDIS_URL`, then `PANEL_RUNNER=queue`).
  - **P10 GA4** needs `GA4_PROPERTY_ID` + `GA4_SERVICE_ACCOUNT_JSON`.
  - **P12 publish** needs your GitHub/npm/registry accounts (see `PUBLISHING.md`).
- 🤖 AGENT — remaining follow-ups (not blockers): full Next.js/Vercel dashboard per PRD §8 (current is an embedded MVP); OAuth JWKS signature verification (issuer/exp done); persist hallucination flags to the `hallucinations` table (currently returned, not stored).
- ✅ **Front end upgraded** — polished multi-view dashboard at `/` (Overview KPIs + SoV bars + answer feed, Citations, Competitors, Hallucinations, Connect) with a free **▶ Run demo audit** (mock) and read/analyze API (`/api/{brands,sov,audit,report/:id,citations/:id,sentiment/:id}`). Verified live.
- ✅ **Auth upgraded** — `apps/mcp-server/src/auth.ts`: bearer API key OR **OAuth JWT with real JWKS signature verification** (`jose`) + iss/exp/aud; RFC 9728 `/.well-known/oauth-protected-resource` metadata; 401 carries `WWW-Authenticate` resource_metadata. Env: `MCP_API_KEY`, `OAUTH_ISSUER`, `OAUTH_JWKS_URI`, `OAUTH_AUDIENCE`.
- ✅ **FMEA ran** (background agent) → `docs/FMEA-P3-P12.md` (22 modes: 5 P0, 8 P1, 9 P2). **P0s fixed:** (1) live DB password removed from committed `.env.example` [SECURITY]; (2) OAuth signature verification (auth.ts JWKS); (3) `finishRun` wrapped in a DB transaction; (4) queue `attempts:1` (no 3× LLM re-spend); (5) workload ceiling `MAX_PANELIST_CALLS=240`.
- ✅ **Remote OAuth + "Connect & log in" from Claude built** — delegated to **WorkOS AuthKit** (issuer/DCR/login) with our server as the OAuth *resource server*: `auth.ts` discovers the JWKS from the issuer's AS metadata, verifies signature/iss/exp/aud; protected-resource metadata advertises the AuthKit issuer; `trust proxy` for https behind Render. Runbook: `docs/HOSTING.md`. Env: `OAUTH_ISSUER` (AuthKit domain) + `OAUTH_AUDIENCE` (public MCP URL). Live end-to-end needs the user's WorkOS account + Render deploy.
- ✅ **Dashboard "How it is built" crash course** added; **hallucination flags now persist** to the DB.
- 🤖 AGENT — **remaining FMEA items** (still open): wire real OTel/Sentry; QueuePanelRunner fire-and-forget; per-provider rate limiting; unique index on `brands(name,owner)` for the find-or-create race; gate dashboard `/api/*` for prod.
- 🧑 USER: **rotate the GCP `postgres` password** (the GCP postgres password) — it was in the tracked `.env.example` before I removed it, so treat it as exposed. Also add `GEMINI/GROQ/PERPLEXITY` keys / GA4 creds / Redis to go fully live.
- Nothing committed to git yet. GCP Cloud SQL path proven live ([[gcp-cloud-sql-geo-radar]]).

## Key decisions / constraints (approved this session)
- **Stack:** TypeScript + `@modelcontextprotocol/sdk`. Approved 5 tweaks over the PRD:
  (1) **Vercel AI SDK** for panelists + structured parsing; (2) **Drizzle ORM** on Postgres;
  (3) **defer BullMQ/Redis to P6** behind a `PanelRunner` interface (local v1 uses a
  DB-status async pattern); (4) **Zod → JSON Schema 2020-12** single source of truth;
  (5) **pnpm + Turborepo monorepo**.
- **v1 panelists:** Claude Haiku (always on — also the parser/scorer) + Gemini + Groq + Perplexity.
- **Local infra:** docker-compose (Postgres + Redis) AND cloud config for the hosted deploy.
- **Build discipline:** follow PRD §11 one prompt at a time, teach plain-English-then-technical, pause for OK between steps (PRD §0b). Build ONLY in this folder.
- **Secrets:** never print values; only check presence. `.env.example` ships blank.
