# GEO Radar MCP — Product Requirements Document (PRD) + Claude Code Build Guide

**Version:** 1.0 · **Owner:** Anand Pareek · **Status:** Ready to build
**One-liner:** *SEO measured Google. GEO Radar measures whether ChatGPT, Perplexity, Claude, and Google AI Overviews recommend **you** — share-of-voice, citations, sentiment, and hallucinations — wired to your funnel. An open-source MCP server, live on the Anthropic registry.*

---

## 0. HOW CLAUDE CODE SHOULD USE THIS DOCUMENT (read first)

> **a) ALIGN THE ARCHITECTURE WITH ME BEFORE WRITING ANY CODE.**
> Before you touch a file: (1) read this whole PRD, (2) restate the architecture back to me in your own words, (3) list the concrete tech choices you propose (language, MCP SDK, queue, DB) and *flag anything you'd do differently and why*, (4) print the **`.env` / secrets checklist** from §9 and ask me to confirm which providers I want to enable for v1. **Do not scaffold until I reply "architecture approved."**
>
> **b) EXECUTE PROMPTS ONE AT A TIME, TEACHING AS YOU GO.**
> Work through the build sequence in §11 one prompt at a time. **Before each step**, explain in *plain English first, then the technical terms* — what you're about to do, why it matters, and how it works (e.g., "we're adding a *queue* so the website stays fast while slow AI calls happen in the background — technically a Redis-backed BullMQ producer/consumer"). After each step, show me the diff and a one-line "what changed / how to verify." Pause for my OK before the next step. The goal is that I *learn the stack*, not just receive code.
>
> **c) THE COMPLETE UI/UX IS SPECIFIED IN §8.** Build the companion dashboard to that spec.

---

## 1. Problem & why now

Buyers increasingly ask an LLM ("best background remover for e-commerce?") instead of Googling. Whether an AI **recommends your brand, cites your domain, or hallucinates about you** is now a real acquisition channel — and almost nothing measures it. GEO (Generative Engine Optimization) is the fastest-growing, least-tooled slice of search: existing tools are mostly read-only data retrieval, and **none tie AI visibility to business outcomes**. That gap is the wedge.

**Portfolio purpose:** a *true* MCP server (a live capability bridge, not a code dump), uniquely tied to Anand's growth/SEO/analytics edge, installable by anyone (→ GitHub stars = social proof), cheap to run, and meta-relevant to Anthropic/OpenAI (it measures LLM behavior). It demonstrates: MCP mastery (all 3 primitives + dual transport + auth), evals-of-model-outputs, a scale-ready architecture, and product-analytics thinking.

## 2. Target users

- **Growth/SEO leads & founders** who want "our AI share-of-voice vs competitors, over time."
- **Agencies** running GEO for clients.
- **AI agents** (the MCP consumer): any Claude/LLM client that wants to *pull GEO metrics as tools* inside a workflow.

## 3. What it does (core concepts)

| Concept | Definition |
|---|---|
| **AI-answer panel** | We ask a rotating panel of cheap LLMs a bank of **buyer-intent prompts** ("best X for Y") and capture their answers. |
| **Share of Voice (SoV)** | % of panel answers that mention your brand vs named competitors. |
| **Citations** | Which of your domains/pages the AI answers cite (or which competitor domains they cite instead). |
| **Sentiment** | How your brand is characterized when mentioned (positive/neutral/negative + why). |
| **Hallucination detection** | False/outdated claims about your brand in AI answers, scored against a facts list you provide. |
| **AI-traffic attribution** | Optional GA4 tie-in: referral traffic arriving from AI engines → the "AI visibility → funnel" bridge nobody ships. |

## 4. The MCP server (this is the heart of the product)

A **production-grade** MCP server exposing all three primitives. (Most servers only ship tools — resources + prompts are the maturity signal.)

### 4.1 Tools (actions the agent can call)
Each ships a full **JSON Schema 2020-12**.

| Tool | Input (summary) | Returns |
|---|---|---|
| `measure_share_of_voice` | `brand`, `competitors[]`, `prompts[]` (or a saved `prompt_set_id`), `panel[]` (models), `runs` | `report_id`, SoV per brand, per-prompt breakdown |
| `track_citations` | `brand`, `domains[]`, `prompt_set_id` | cited domains + frequency, your-vs-competitor citation share |
| `detect_hallucinations` | `brand`, `facts[]` (ground-truth statements), `prompt_set_id` | flagged claims + which fact each contradicts + severity |
| `sentiment_scan` | `brand`, `prompt_set_id` | sentiment distribution + representative quotes |
| `compare_to_competitor` | `brand_a`, `brand_b`, `prompt_set_id` | head-to-head SoV, citations, sentiment |
| `attribute_ai_traffic` | `ga4_property_id`, `date_range` | sessions/conversions from AI-engine referrers (chatgpt.com, perplexity.ai, etc.) |
| `get_report` | `report_id` | full stored report (for async retrieval) |

**Async pattern:** heavy tools return a `report_id` immediately (`202`-style) and enqueue a panel run; the agent calls `get_report(report_id)` to fetch results. This keeps the server responsive and is the scale story (see §6).

### 4.2 Resources (data the agent can read)
`brand://config` (brands + competitors) · `prompts://library` (buyer-intent prompt sets) · `reports://{report_id}` · `history://sov?brand=…&range=…` (time-series so trends work).

### 4.3 Prompts (guided workflows the agent can invoke)
`run_full_geo_audit` · `draft_reputation_defense_brief` (for a detected hallucination) · `weekly_sov_report`.

### 4.4 Transports & auth
- **stdio** (local, for Claude Desktop/Code) — zero-config.
- **streamable-HTTP** (remote, hosted on Render) — **OAuth 2.1 / OIDC** with issuer validation for the hosted mode; API-key for local. Correct auth is a deliberate senior/security signal.

## 5. How the measurement works (cheap by design)

1. **Panelists:** query a rotating panel of cheap models as "AI search panelists" — **Claude Haiku**, **Gemini free tier**, **Groq (Llama)**. Optionally sample *real* engines via **Perplexity's low-cost API** and public sources (DuckDuckGo HTML, Google Suggest, AI-Overview sampling).
2. **Parse:** a Haiku-class model extracts brand mentions, cited domains, and sentiment from each answer (structured output).
3. **Score:** compute SoV, citation share, sentiment distribution, hallucination flags; write a time-series row to Postgres.
4. **Attribute (optional):** read GA4 for referrals from AI-engine hostnames.

No enterprise API required → fits the cost constraint (ships with a **seeded demo Postgres** so anyone can try it instantly).

## 6. Architecture (scale-ready — "scales by adding instances")

```
Claude / MCP client ──(stdio | streamable-HTTP)──▶ MCP SERVER (stateless, N instances on Render)
                                                        │ enqueue panel run
                                                        ▼
                                                   QUEUE (Redis + BullMQ)
                                                        │
                                                        ▼
                                       PANEL WORKERS (M instances) ── call cheap LLM panel,
                                                        │              parse, score
                                        ┌───────────────┼───────────────┐
                                        ▼               ▼               ▼
                                  Postgres          Redis cache     (GA4 API, optional)
                              (SoV time-series)   (dedupe, rate-limit)
```
- **Stateless MCP tier** → scale by instance count behind Render's load balancer.
- **Panel runs are the bursty/slow work** → decoupled into workers via a queue (add workers to track more brands/prompts). Idempotent workers, dead-letter queue, per-key rate limiting, cost caps.
- **Postgres** is the only stateful tier (SoV history); **Redis** for cache + rate-limit + queue.
- Deploy artifacts to include: `render.yaml` (web + worker + keyvalue + db, autoscaling), `/healthz`, OpenTelemetry traces (request → enqueue → worker → LLM call), a k6 load test.

## 7. Data model (Postgres)

`brands(id, name, domains[], owner)` · `competitors(brand_id, name, domains[])` · `prompt_sets(id, name, prompts[])` · `panel_runs(id, brand_id, prompt_set_id, panel[], status, created_at)` · `answers(id, run_id, model, prompt, raw_answer, mentions[], cited_domains[], sentiment)` · `sov_history(brand_id, date, sov, citation_share, sentiment_score)` · `hallucinations(id, run_id, claim, contradicts_fact, severity)`.

## 8. COMPLETE UI/UX — the companion "GEO Radar" dashboard

A small Next.js dashboard + hosted MCP demo. Dark, data-dense, Vercel/Linear-clean. Design tokens: near-black bg `#0B0D10`, card `#14171C`, accent indigo `#635BFF`, positive `#2FBF71`, warning `#E0A32E`, danger `#E5484D`, text `#E6E8EB` / muted `#8A9099`, font = Inter / system stack.

**Global layout:** left sidebar (logo, nav) + top bar (brand selector, date range, "Run audit" button).

**Sidebar nav:** Overview · Prompts & SoV · Citations · Competitors · Hallucinations · AI Traffic · Connect (MCP) · Settings.

1. **Overview** — 4 KPI cards: *Share of Voice %* (with 7d delta), *Mentions (7d)*, *Citation share %*, *Hallucinations flagged*. Below: a **SoV-over-time line chart** (you vs each competitor). A "recent AI answers" feed (prompt → which brands were mentioned, one-line sentiment).
2. **Prompts & SoV** — table of the buyer-intent prompt bank: prompt · times run · your mention rate · top competitor mentioned. Add/edit prompts. Click a prompt → drawer with the actual panel answers.
3. **Citations** — which of *your* domains/pages get cited vs competitor domains; a bar chart of citation share; a table of "answers that cited a competitor instead of you" (the actionable gap).
4. **Competitors** — head-to-head cards (you vs each competitor): SoV, citation share, sentiment; a radar/bar comparison.
5. **Hallucinations** — feed of detected false/outdated claims about your brand, each with: the claim, the fact it contradicts, severity, and a **"Draft reputation-defense brief"** button (invokes the MCP prompt).
6. **AI Traffic** (optional/GA4-gated) — sessions & conversions from AI-engine referrers over time; the "AI visibility → funnel" chart.
7. **Connect (MCP)** — the money page for the portfolio: copy-paste blocks to add the server to Claude Desktop/Code (stdio) and the hosted URL (HTTP), a live "Try it in Claude" GIF, and the tool list with example calls.
8. **Settings** — brand + competitors + domains, prompt sets, panel model selection (toggle Haiku/Gemini/Groq/Perplexity), cost caps, GA4 connection, API keys.

**States to design:** empty (no brand yet → guided setup), running (panel run in progress with a progress bar + queue position), error (provider failed → which panelist, retry), and the seeded-demo state (pre-loaded brand so a visitor sees value in 5 seconds).

## 9. `.env` / SECRETS CHECKLIST (Claude Code: print this and confirm before building)

**Required (v1 minimum, all free/cheap):**
- `ANTHROPIC_API_KEY` — Haiku, used for parsing/scoring + as a panelist. *(cheap; ~cents per audit)*
- `DATABASE_URL` — Postgres (Supabase free or Render Postgres).
- `REDIS_URL` — Render Key Value / Upstash free (queue + cache + rate-limit).

**Recommended panelists (free tiers — enable ≥1):**
- `GEMINI_API_KEY` — Google AI Studio free tier panelist.
- `GROQ_API_KEY` — free-tier Llama panelist (fast/cheap).
- `OPENAI_API_KEY` — optional GPT panelist.

**Optional (unlock features):**
- `PERPLEXITY_API_KEY` — sample *real* AI-search answers (low cost).
- `GA4_PROPERTY_ID` + `GA4_SERVICE_ACCOUNT_JSON` (or ADC) — enables `attribute_ai_traffic`.

**Hosted HTTP mode (only when publishing the remote server):**
- `OAUTH_ISSUER`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` — OAuth 2.1 for streamable-HTTP.
- `MCP_TRANSPORT` = `stdio` | `http`.
- `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT` — observability (free tiers).
- `PANEL_COST_CAP_USD_PER_RUN` — hard spend guardrail.

> Claude Code: never print secret *values*; only check presence. Provide a committed `.env.example` with these keys and blank values.

## 10. Tech stack (proposed — confirm in the alignment step)

- **Language/SDK:** TypeScript + the official **`@modelcontextprotocol/sdk`** (best client compatibility; Node deploys cleanly on Render). *(Python + `mcp` is acceptable if you prefer — flag it.)*
- **Queue:** BullMQ + Redis. **DB:** Postgres (Supabase/Render). **Dashboard:** Next.js on Vercel. **Server host:** Render (web + worker).
- **Observability:** OpenTelemetry + Sentry (free tiers).

## 11. BUILD SEQUENCE (Claude Code: one prompt at a time, teach-as-you-go per §0b)

**Phase 0 — Align & scaffold**
- P0: Restate the architecture + tech choices back to me; print the `.env` checklist; wait for "architecture approved."
- P1: Scaffold the repo: MCP server (stdio) with a single trivial tool (`ping`), `.env.example`, README skeleton, test runner, CI.

**Phase 1 — Core MCP (local, stdio)**
- P2: Implement `measure_share_of_voice` end-to-end against ONE panelist (Haiku): prompt bank → answers → parse mentions → SoV → store in Postgres → return `report_id` + summary. Explain the panelist/parse/score pipeline.
- P3: Add `get_report`, `track_citations`, `sentiment_scan`. Add the **resources** (`brand://config`, `prompts://library`, `history://sov`).
- P4: Add `detect_hallucinations` + `compare_to_competitor`. Add the **prompts** (`run_full_geo_audit`, `draft_reputation_defense_brief`, `weekly_sov_report`).
- P5: Multi-panelist support (Gemini/Groq) with a rotating panel + per-provider adapters + cost cap.

**Phase 2 — Scale-ready & remote**
- P6: Introduce the queue + worker (panel runs move to BullMQ workers; tools enqueue and return `report_id`). Idempotency + DLQ + rate limiting.
- P7: Add streamable-HTTP transport + OAuth 2.1; `/healthz`; `render.yaml` (web+worker+keyvalue+db, autoscaling). Deploy to Render.
- P8: Observability (OTel traces + Sentry) + a k6 load test + `SCALING.md`.

**Phase 3 — Dashboard & optional GA4**
- P9: Build the Next.js dashboard per §8 (Overview → Connect first — they carry the demo). 
- P10: `attribute_ai_traffic` via GA4 (optional/gated).

**Phase 4 — Ship & distribute**
- P11: Tests + tool-call eval suite; strong README (60-sec install, copy-paste config, tool table, GIF); seed the demo Postgres.
- P12: Publish to the **official MCP Registry**, PR into `punkpeye/awesome-mcp-servers`, claim Smithery/Glama/PulseMCP; record the "Try it in Claude" Loom.

## 12. Production-grade MCP checklist (definition of done)
☐ All 3 primitives (tools + resources + prompts) ☐ stdio + streamable-HTTP ☐ OAuth 2.1 on HTTP ☐ JSON Schema 2020-12 on every tool ☐ scoped `report_id` handles with expiry (no hidden session state) ☐ OTel + structured logs ☐ contract tests + a tool-call eval suite in CI ☐ published to registry + awesome-list + directories ☐ 60-second-install README ☐ hosted Render demo + Loom.

## 13. Success metrics
- **Portfolio:** GitHub stars (target ≥ 250 in 60 days for a hot niche), registry installs, ≥1 external contributor, the awesome-list merge.
- **Product:** brands tracked, audits run, hallucinations surfaced, AI-traffic sessions attributed.

## 14. Out of scope (v1) / future
Out: writing/optimizing content, auto-fixing pages, paid enterprise connectors. Future: `pSEO pickup` (does my programmatic content get cited?), a GEO/SEO bundle, agent-to-agent "reputation defense" automation, scheduled weekly reports via cron.

---
*This PRD is intentionally buildable in ~5–7 focused days with Claude Code. Start at §11 P0 — but only after the §0a architecture alignment.*
