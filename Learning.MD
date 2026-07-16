# Learning.MD — GEO Radar MCP
> AGENT: add an entry whenever the basic flow changes, the user reports a bug or gives
> corrective feedback, or something took real time to figure out. CHECK THIS FILE FIRST
> before debugging — the answer may already be here. Plain language; first use of any
> technical term gets a one-line bracket explanation.

<!-- Newest first. Entry format:

## <YYYY-MM-DD> — <one-line title>
**What happened:** <the change, bug, or feedback>
**Root cause:** <in plain language — what was actually wrong, not just what was edited>
**Watch for later:** <the symptom that means this is happening again>
-->

## 2026-07-16 — Secrets keep landing in the committed .env.example (2nd time)
**What happened:** A live GCP `postgres` password (the GCP postgres password) was found in `.env.example` (tracked) by the FMEA scan — plus a malformed doubled `DATABASE_URL=DATABASE_URL=`. Earlier the same file had a real `ANTHROPIC_API_KEY`. `.env.example` is the committed template and must ship blank/placeholder only.
**Root cause:** Real values get pasted into `.env.example` instead of `.env` (the gitignored file). `.env.example` can't be gitignored (it's the template), so nothing catches this automatically.
**Fix + watch for later:** Restored the safe placeholder (`postgresql://geo:geo@localhost:5432/geo_radar`); real value stays in `.env`. **Before any git commit, grep the tracked files for secret-shaped strings** (`sk-ant-`, real passwords in DATABASE_URL, `PRIVATE KEY`). Consider a pre-commit hook (e.g. gitleaks) as a durable guard. Any value the user pastes into `.env.example` should be moved to `.env` and the template re-blanked.

## 2026-07-16 — pnpm 11 refuses ignored build scripts (turbo install check fails)
**What happened:** After adding bullmq + @google-analytics/data, `pnpm install` exited 1 with `ERR_PNPM_IGNORED_BUILDS` (msgpackr-extract, protobufjs), which made `turbo run` fail its dependency-status check before any task ran.
**Root cause:** pnpm 11 won't silently skip dependency build scripts; a linter had written placeholder values (`set this to true or false`) into `allowBuilds:` in pnpm-workspace.yaml, which are invalid.
**Fix:** Set `allowBuilds: { msgpackr-extract: false, protobufjs: false }` (they're optional native accelerators with pure-JS fallbacks — no need to compile). `pnpm install` then exits 0 and turbo runs.
**Watch for later:** Any new dep with a postinstall/native build will trip this — add it to `allowBuilds` (true to compile, false to skip) in pnpm-workspace.yaml.

## 2026-07-16 — Wiring the app to GCP Cloud SQL (gotchas)
**What happened:** Connected the server to a real GCP Cloud SQL Postgres and ran the full pipeline live.
**Gotchas / root causes:**
- `gcloud components install cloud-sql-proxy` reports success but the v2 binary isn't on PATH; it lives at `/opt/homebrew/share/google-cloud-sdk/bin/cloud-sql-proxy`. Call it by full path.
- The proxy authenticated cleanly with `--token="$(gcloud auth print-access-token)"` (avoids relying on ADC being the right identity).
- Create the database + app user via the **Cloud SQL Admin API** (`gcloud sql databases create`, `gcloud sql users create`) — this uses your gcloud identity, so you never need the `postgres` superuser password.
- Cloud SQL enforces a **password min-length**; the `.env` placeholder `geo:geo` failed with `INVALID_PASSWORD: password is not long enough`. Generated a strong one and wrote it to `.env`.
- A Cloud SQL user created via gcloud is a member of `cloudsqlsuperuser`, so it CAN create tables in the `public` schema — the PG15 public-schema lockdown did not bite; `drizzle-kit migrate` succeeded as `geo`.
**Watch for later:** If `pnpm start:mcp` errors connecting to `localhost:5432`, the GCP instance is Stopped or the proxy isn't running — start both, or use `GEO_STORE=memory` for offline dev.

## 2026-07-15 — Docker registry pulls blocked by corp proxy → verify Postgres with pglite
**What happened:** `docker compose up` failed to pull `postgres:16-alpine` / `redis:7-alpine` with `Error response from daemon: missing or empty Content-Length header`. Blocked live verification of the `DrizzleStore`.
**Root cause:** The corporate MITM proxy strips/rewrites the Content-Length header on Docker registry responses (same TLS-interception issue the global CLAUDE.md flags for browser downloads). Not a code problem.
**Fix:** Verify the real database path with **pglite** (`@electric-sql/pglite` + `drizzle-orm/pglite`) instead of Docker — an embedded PG16 that runs the actual migration + SQL in-process, no registry pull. Required making `DbHandle` driver-agnostic (`{ db: PgDatabase<any,any,any>; close }`) so `DrizzleStore` accepts both node-postgres and pglite. Test: `packages/db/src/drizzle-store.test.ts`.
**Watch for later:** Any `docker pull` failing with a Content-Length error → it's the proxy, not the image/tag. For a *running persistent* DB (not just tests), use a cloud Postgres URL in `DATABASE_URL` (Supabase/Neon) — no Docker needed. For tests/CI, pglite is the durable answer.

## 2026-07-15 — zod bump + AI SDK peer requirement
**What happened:** Adding `ai@7` + `@ai-sdk/anthropic@4` required bumping `zod` from `^3.23.8` to `^3.25.76` (their peer range). Also `zod-to-json-schema` in this version rejects `target: "jsonSchema2020-12"` (valid targets are jsonSchema7 / 2019-09 / openApi3) — pass a name string instead.
**Root cause:** Peer-dependency range mismatch surfaces only at typecheck/runtime, not install (pnpm warns, doesn't fail).
**Watch for later:** If AI SDK calls error oddly or types drift, check the installed `zod` still satisfies the AI SDK peer range. AI SDK v5+ usage fields are `inputTokens`/`outputTokens` (not `promptTokens`/`completionTokens`); `normalizeUsage()` in `panelist.ts` guards this.

## 2026-07-15 — Project scaffolded (P1)
**What happened:** Set up the monorepo and the stdio MCP server with a `ping` tool.
**Root cause:** N/A — greenfield scaffold from the PRD.
**Watch for later:** The MCP SDK's tool-registration API has changed across versions
(`server.tool(...)` in older, `server.registerTool(name, {inputSchema, outputSchema}, handler)`
in newer). If `tools/list` or `callTool` fails after an SDK bump, check that method name and
whether `inputSchema` expects a Zod *raw shape* (`.shape`) vs a full `ZodObject`.
