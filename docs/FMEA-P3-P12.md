# 🔍 FMEA Analysis — GEO Radar MCP (P3–P12)

**Scan scope**: ~30 source files across `packages/core`, `packages/db`, `apps/mcp-server`, `apps/worker`, plus `render.yaml` / `.env.example` · **Product context**: open-source MCP server measuring AI share-of-voice / citations / sentiment / hallucinations across a cheap LLM panel behind a cost cap, with a BullMQ queue+worker, multi-provider adapters, Postgres via Drizzle, streamable-HTTP + bearer/OAuth auth, GA4 tie-in, and an unauthenticated dashboard (`GEO-Radar-MCP-PRD.md`, `docs/ARCHITECTURE_FLOW.md`).

**Failure modes found**: 22 (5 🔴 P0, 8 🟡 P1, 9 🟢 P2)

### Top 3 risks
1. **Live Postgres password committed in `.env.example`** (`DATABASE_URL=DATABASE_URL=postgresql://postgres:<REDACTED>@localhost:5432/geo_radar`) — a real secret in a repo about to be published open-source, plus the line is malformed (double `DATABASE_URL=`). RPN 448.
2. **BullMQ retries are non-idempotent** — every retry re-runs the whole pipeline (`beginRun` → fresh LLM calls → new `sov_history` row), so a transient provider error triple-charges the API budget and writes 3 orphan run rows + 3 duplicate history points. Cost cap is per-attempt, not per-job. RPN 336.
3. **OAuth "validation" does no signature verification** — `validateIssuer` only base64-decodes the JWT and checks `iss`/`exp`, so any attacker can forge a token and call every tool (real API spend). PRD sells this as the senior "security signal." RPN 294.

---

| # | Component | Failure Mode | Effect | Root Cause | S | O | D | RPN | Priority |
|---|-----------|--------------|--------|------------|---|---|---|-----|----------|
| 1 | `.env.example` | Real-looking Postgres password `<REDACTED>` committed; line also malformed (`DATABASE_URL=DATABASE_URL=…`) | Credential leak the moment the repo is published; also every reader's first `cp .env.example .env` yields a broken connection string | Secret pasted into the committed template instead of left blank; PRD §9 says `.env.example` ships blank / never print secret values | 8 | 8 | 7 | 448 | 🔴 P0 |
| 2 | `queue.ts` + `runner.ts` | BullMQ job retried (`attempts: 3`) re-executes the full pipeline: new `beginRun`, fresh panelist + parser LLM calls, new `sov_history` row | Up to 3× real API spend on one transient error; duplicate/ orphan `panel_runs` and inflated SoV time-series; cost cap enforced per attempt not per job | `runner.run()` is not idempotent — no dedupe key, no "already ran" guard; each attempt starts a brand-new run | 8 | 6 | 7 | 336 | 🔴 P0 |
| 3 | `http.ts` `validateIssuer` | JWT accepted with no signature verification — only `iss`/`exp` decoded from an unverified payload | Full auth bypass on hosted HTTP: forged token unlocks every tool → attacker burns your ANTHROPIC/GEMINI/GROQ/PERPLEXITY budget | JWKS signature check deferred as a "follow-up hook"; base64 payload is attacker-controlled | 9 | 5 | 7 | 294 | 🔴 P0 |
| 4 | `drizzle-store.ts` `finishRun` | Three sequential writes (insert answers → update run→completed → insert sov_history) with **no transaction** | If the process/worker dies mid-way: answers with the run stuck `running`, or a completed run with no history point (or vice-versa) → corrupt/partial reports | Multi-step write not wrapped in `db.transaction()`; worker SIGTERM/OOM lands right in this window | 7 | 5 | 7 | 245 | 🔴 P0 |
| 5 | `runner.ts` + `geo.ts` schema | Unbounded panel size: 50 prompts × 5 runs × 4 panelists = 1000 panelist + 1000 parser calls in **one** synchronous run | One call can hang for minutes, exhaust provider rate limits, and (queue mode) block the HTTP request the whole time; noisy-neighbor across concurrency=4 | No cap on `prompts.length × runs × panel.length`; cost cap only stops *spend*, not call volume or wall-clock | 7 | 5 | 6 | 210 | 🔴 P0 |
| 6 | `dashboard.ts` | `/api/brands` and `/api/sov?brand=` are unauthenticated and un-scoped by owner | Any visitor enumerates every tracked brand + its SoV history across all owners (data leak / competitive intel) | Read endpoints intentionally open for the demo; `getSovHistory` matches brand by name only, ignoring `owner` | 6 | 7 | 4 | 168 | 🟡 P1 |
| 7 | `providers.ts` + `panelist.ts` | Provider timeout / 429 / 5xx mid-run throws `provider_error`; the whole run fails after partial spend | User gets nothing back for a run that already cost money; a rate-limited Groq/Perplexity kills an otherwise-good multi-panelist audit | No per-call retry/backoff, no timeout, no per-panelist isolation — one bad answer aborts the entire loop | 6 | 6 | 4 | 144 | 🟡 P1 |
| 8 | `cost.ts` + `runner.ts` | Cost cap uses a flat `REAL_CALL_COST_ESTIMATE_USD=0.01` pre-check and post-hoc token pricing; a long answer (600 out-tokens ×4 panelists) can overrun the estimate | Actual spend on a single iteration exceeds the projected step, so a run can finish slightly over the "hard" `PANEL_COST_CAP_USD_PER_RUN` | `wouldExceed(estimate*2)` guards the *next* pair with a rough constant, not the *actual* cost, which is only known after the call | 6 | 6 | 4 | 144 | 🟡 P1 |
| 9 | apps + `render.yaml` | No OTel traces, no Sentry, no structured logs anywhere — only `process.stderr.write` | If a run fails at 3am you learn from a user report; no request→enqueue→worker→LLM trace despite PRD §6/§8/§12 and Handoff claiming "OTel/Sentry hooks" | `SENTRY_DSN`/`OTEL_*` are read nowhere in code; observability was documented but not implemented | 6 | 6 | 4 | 144 | 🟡 P1 |
| 10 | `queue.ts` | `QueuePanelRunner.run` does `job.waitUntilFinished()` — the HTTP request blocks for the entire (up to 2000-call) run | Defeats the PRD's whole async/`202-style report_id` design; long requests time out at the load balancer, client sees a 5xx while the worker keeps spending | Queue runner awaits completion instead of returning `report_id` immediately (noted as a follow-up in the file) | 6 | 5 | 4 | 120 | 🟡 P1 |
| 11 | `drizzle-store.ts` `beginRun` | Find-or-create brand is read-then-insert with no unique constraint / no transaction; two concurrent runs for a new brand race | Duplicate `brands` rows for the same (name, owner); `sov_history` then splits across two ids, and `getSovHistory` (matches by name, sums ids) silently double-counts | Non-atomic upsert; schema has no unique index on `(name, owner)`; workers run `concurrency: 4` | 6 | 4 | 5 | 120 | 🟡 P1 |
| 12 | `http.ts` `requireAuth` | If neither `MCP_API_KEY` nor `OAUTH_ISSUER` is set, the server serves `/mcp` fully open (only a code comment, no startup warning) | A misconfigured prod deploy (secret not synced in Render) silently exposes all tools with no auth and no log line | "Local dev: no auth configured" path `next()`s with no warning; `render.yaml` generates `MCP_API_KEY` but a bad deploy can drop it | 7 | 3 | 5 | 105 | 🟡 P1 |
| 13 | `http.ts` API-key compare | `token === apiKey` is a non-constant-time string compare | Bearer/API key is theoretically brute-forceable via timing on a hosted endpoint | Plain `===` instead of `crypto.timingSafeEqual` | 5 | 4 | 5 | 100 | 🟡 P1 |
| 14 | `runtime.ts` + `queue.ts` | `PANEL_RUNNER=queue` set but `REDIS_URL` missing → silently falls back to in-process; or Redis down → BullMQ connection errors are unhandled | Operator thinks work is queued/scaled but it runs in the web tier (or crashes); no signal either way | Silent `&&` fallback in `buildRuntime`; no Redis health check or connection error handler | 5 | 4 | 5 | 100 | 🟡 P1 |
| 15 | `ga4.ts` | `JSON.parse(process.env.GA4_SERVICE_ACCOUNT_JSON)` unguarded; GA4 API errors surface as `provider_error` | Malformed service-account JSON throws a raw parse error to the client; GA4 quota/permission errors are opaque | No try/catch around the parse; no typed handling of Google API error shapes | 4 | 5 | 4 | 80 | 🟢 P2 |
| 16 | `parser.ts` (Anthropic) | `generateObject` may return brands/domains outside the candidate list or malformed; only a lowercase-set filter guards brands, none guards domains | Cited-domain garbage (or hallucinated URLs) flows into citation share and the `competitor_gap` table | LLM structured output trusted for `cited_domains`; no domain-shape validation on the real-parser path | 4 | 5 | 4 | 80 | 🟢 P2 |
| 17 | `schema.ts` `panel_runs.status` | No `queued` row is ever written; runs go straight to `running` in `beginRun`; queue mode still shows `running` while enqueued | The `queued` state the PRD's async story and the dashboard "queue position" depend on never appears; status is misleading | `beginRun` hardcodes `status: "running"`; enqueue path doesn't create a `queued` row first | 4 | 5 | 4 | 80 | 🟢 P2 |
| 18 | `env.ts` / `seed.ts` | `PANEL_COST_CAP_USD_PER_RUN` parsed as `Number(...) || 1`; a `0` cap silently becomes `1` | Operator who sets cap to `0` (freeze spend) actually authorizes $1/run | `|| 1` treats the legitimate `0` as falsy | 5 | 3 | 5 | 75 | 🟢 P2 |
| 19 | `report_id` handles | PRD §12 promises "scoped `report_id` handles with expiry"; report ids are raw UUIDs, never expire, and any id is readable via `get_report`/`reports://{id}` with no scoping | Anyone who guesses/leaks a report UUID reads its full answers; no expiry means unbounded growth | Expiry + scoping in the DoD checklist not implemented | 5 | 3 | 5 | 75 | 🟢 P2 |
| 20 | `queue.ts` DLQ | `removeOnFail: 5000` is called a "dead-letter queue," but there's no DLQ consumer/alert; failed jobs just sit until evicted | A run that fails all 3 attempts is silently lost; nobody is notified; `noeviction` Redis fills over time | DLQ is only a retention window, not a handled queue | 4 | 4 | 4 | 64 | 🟢 P2 |
| 21 | `resources.ts` `parseRange` | `history://sov?range=` accepts only `Nd`; anything else silently defaults to 30 days | User asks for `range=7` (no `d`) or `1w` and silently gets 30 days of data | Regex `^(\d+)d$` with silent fallback, no error | 3 | 5 | 4 | 60 | 🟢 P2 |
| 22 | `runner.ts` `resolvePanel` | Duplicate panelist ids in `panel` (e.g. `["haiku","haiku"]`) aren't de-duped | Silent double-counting of that model's answers → skewed SoV, doubled cost | No dedupe on the resolved panel array | 3 | 4 | 4 | 48 | 🟢 P2 |

---

### 🔴 P0 — Fix before merge / before publishing
1. **Blank the secret in `.env.example`** — set `DATABASE_URL=` (single key, empty), rotate the leaked `<REDACTED>` credential immediately, and `git rm --cached` any history if it was ever committed. Add a CI grep that fails on a non-empty value in `.env.example`. (#1)
2. **Make the worker job idempotent** — pass a deterministic `jobId` (hash of `input`) to `queue.add`, and have `runner.run` short-circuit if a completed run for that key exists; move the cost meter to per-*job* not per-attempt so retries can't re-charge. (#2)
3. **Verify JWT signatures in `validateIssuer`** — use `jose`'s `createRemoteJWKSet` + `jwtVerify` against the issuer's JWKS (and validate `aud`), not a base64 decode; until then, do not advertise OAuth as supported. (#3)
4. **Wrap `finishRun` in a transaction** — `await db.transaction(tx => { insert answers; update run; insert sov_history })` so the run is all-or-nothing; the same guard protects the retry path. (#4)
5. **Bound the panel workload** — reject (or chunk) runs where `prompts.length × (runs) × panel.length` exceeds a hard ceiling (e.g. 200 answers), and add a per-call timeout to `generateText`/`generateObject`. (#5)

### 🟡 P1 — Fix this sprint
- Scope the dashboard read API by owner and/or require the bearer token on `/api/*` (#6).
- Add per-call retry+timeout and isolate panelist failures so one 429 doesn't abort the run — collect partial results (#7).
- Base the cost pre-check on measured running total plus a conservative max-output estimate, and cap `maxOutputTokens` accordingly (#8).
- Wire `SENTRY_DSN` + OTel (request→enqueue→worker→LLM span) or drop the claim from PRD/Handoff so the DoD is honest (#9).
- Make `QueuePanelRunner` return `report_id` immediately and let the client poll `get_report` (the intended async contract) (#10).
- Add a unique index on `brands(name, owner)` and do the find-or-create inside a transaction / `onConflictDoNothing` (#11).
- Log a loud startup warning when `/mcp` is unauthenticated (#12); use `crypto.timingSafeEqual` for the API-key compare (#13); warn + fail fast when `PANEL_RUNNER=queue` but Redis is missing/unreachable (#14).

### 🟢 P2 — Track / next sprint
- Guard `GA4_SERVICE_ACCOUNT_JSON` parse (#15); validate LLM-returned `cited_domains` shape (#16); write a real `queued` status row (#17); allow `0` as a valid cost cap (#18); add `report_id` expiry/scoping per the DoD (#19); add a real DLQ consumer + alert (#20); error on malformed `range` instead of silent 30d (#21); dedupe the resolved panel (#22).

---

**Coverage**: 12/12 categories checked.
- **unhandled_error_paths** — #7, #15 (provider/GA4 errors abort or leak raw messages).
- **external_dependency_failures** — #7, #14 (provider 429/5xx, Redis down).
- **race_conditions_and_state** — #11 (concurrent find-or-create brand race).
- **resource_exhaustion** — #5, #10, #20 (unbounded panel product; blocking request; `noeviction` Redis growth).
- **security_access_control** — #3, #6, #12, #13, #19 (JWT bypass, open dashboard, open `/mcp`, timing compare, unscoped report ids).
- **data_integrity_partial_writes** — #4, #11 (non-transactional `finishRun`, duplicate brand rows).
- **observability_gaps** — #9, #12, #20 (no OTel/Sentry, silent open auth, silent DLQ loss).
- **scale_and_load_failures** — #5, #10 (2000 calls/run; blocking HTTP under load).
- **billing_credit_mismatches** — #1 (leaked DB cred → infra abuse), #6 (data exfil). Money-vs-value: closest match is the cost/retry axis below; no direct user-billing path exists in v1 (product spends its own API budget, doesn't charge users) — noted as **largely n/a** but the spend-side analogues are #2/#8.
- **retry_idempotency_issues** — #2, #8 (non-idempotent retry double-charge; cost cap per-attempt).
- **config_feature_flag_drift** — #12, #14, #18 (auth-off fork, queue-vs-inprocess silent fallback, `0`-cap coercion).
- **edge_cases_from_prd** — #10 (async `report_id` contract), #17 (`queued` state), #19 (scoped/expiring handles), #9 (OTel/structured logs) — promised in PRD §6/§8/§12, not delivered.

*No issues found requiring their own row in:* none — every category surfaced at least one mode. The `billing_credit_mismatches` category has no direct end-user-billing failure (v1 charges no users), so it maps to the API-spend analogues rather than a distinct money-moves-but-value-doesn't row.
