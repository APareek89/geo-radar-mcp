# GetCited — build prompt (feed this to a fresh Claude Code session)

> How to use: start a new session with
> **"Refer to Handoff.MD in /Users/anandpareek/Documents/Projects/geo-radar-mcp and begin,
> then read docs/GETCITED-BUILD-PROMPT.md and build Phase 1."**
> Work **one phase at a time**, keep `pnpm typecheck && pnpm test && pnpm build` green, commit to the
> **private** repo after each phase (do NOT publish or make public), and update Handoff.MD.

---

## 0. What we're building & why

**GetCited** is the product face of the existing GEO Radar MCP. It measures whether AI assistants
(ChatGPT, Perplexity, Claude, Google AI Overviews) recommend and cite a brand, **and — the actual value —
turns that into a costed, committed action plan and tracks progress against it.**

It has **two modes**:
- **We Serve** — we run everything on our keys/infra; the user just configures + uses the assistant.
- **Self Serve** — the user brings their own API keys (or self-hosts), so our marginal cost ≈ hosting only.

**Reuse, don't rebuild:** the measurement pipeline, scoring, stores, and MCP tools already exist in
`packages/core`, `packages/db`, `packages/shared`, `apps/mcp-server`. GetCited is a **new Next.js app
(`apps/web`)** plus a handful of **new GEO capabilities** (tools) added to `packages/core` and exposed both
as MCP tools and inside the web "Agent Mode".

---

## 1. Tech decisions (made for you — don't re-litigate)

| Concern | Decision | Why |
|---|---|---|
| Web app | **Next.js (App Router) + TypeScript** in `apps/web`, deploy on **Vercel** | user asked for Vercel; SSR + API routes + streaming chat |
| UI kit | **Tailwind CSS + shadcn/ui + Framer Motion + lucide-react** | fast, polished, accessible; "awesome UI/UX" |
| Charts | **Recharts** (or visx) | SoV bars, trend lines |
| DB | **Supabase Postgres** — point the existing `DATABASE_URL`/Drizzle at it; keep `packages/db` as the schema owner | Supabase IS Postgres, so DrizzleStore already works; add new tables via Drizzle migrations |
| Web auth (users) | **Supabase Auth** (email + Google) | separate from the MCP OAuth; gives a stable `user_id` to key config/plans/keys |
| Agent (Agent Mode) | **Vercel AI SDK** (`ai`) streaming chat, tool-calling into `@geo-radar/core` | reuse the pipeline as tools; Claude is the model |
| Reports | server-side **HTML → PDF** (e.g. Playwright/`@react-pdf`), **Excel** (`exceljs`), **interactive HTML** | user picks format |
| Secrets (BYOK) | see §7 — session keys (browser-held, sent per request, never stored) OR opt-in encrypted storage | user's stated preference |
| Scraping | a `web_fetch`/scrape capability (start with `fetch` + readability; upgrade to a scraper API later) | needed for competitor cited pages + progress verification |

**Keep the monorepo.** Add `apps/web`. Do NOT fork the MCP server — the website talks to the same
`@geo-radar/core` logic directly (server-side) and can also point users at the hosted `/mcp`.

---

## 2. Must-have vs optional APIs (with the "?" tooltip copy for the UI)

Every key field in the UI gets a **"?" tooltip** explaining *why*. Use this copy:

**Must-have (v1):**
- **Anthropic (Claude)** — *"Powers the GEO assistant, the answer parser, and the action-plan writer. Required."*

**Strongly recommended:**
- **Perplexity** — *"Adds a real, web-grounded AI-search panelist with real citations — far more trustworthy than a model guessing from memory."*
- **Supabase** — *"Stores your config, plans, and progress so trends and 'how am I doing vs the plan' work."* (we-serve: ours; self-serve: theirs)

**Optional panelists (more coverage, cheap/free tiers):**
- **Gemini** — *"A free-tier Google panelist — widens the AI panel we sample."*
- **Groq (Llama)** — *"A fast, cheap open-model panelist for extra coverage."*

**Optional data (ROI + accuracy):**
- **GA4 (property id + service account)** — *"Ties AI visibility to real traffic & conversions — the 'did it actually work' number."*
- **Google Search Console** — *"Real queries people search + your current traffic; grounds the query list and the ROI projection."* (free)

Show a small **cost/impact chip** next to each ("~cents/audit", "free tier", "$$$") so users choose wisely.

---

## 3. Information architecture

```
GetCited
├── Landing page  → two big choices: [ We Serve ]   [ Self Serve ]
├── (auth: Supabase login/signup)
└── App shell (left nav)
    ├── Configure          (We Serve: one screen · Self Serve: two sub-tabs)
    ├── GEO Assistant       → [ MCP ]  |  [ Agent Mode ]
    └── Dashboard
```

---

## 4. WE SERVE

### 4A. Configure  (route `/app/configure`)
State is **saved per user** and **versioned** — every change is recorded and **reconciled** so the GEO
Assistant (4B) and the projections always use the latest config, and Track (card 4) can diff against the
config/plan that was active when a plan was made.

1. **Brand & competitors**
   - `Brand website URL` (required), `Business/products description` (optional, textarea),
     `Competitor URL` × **5 visible fields + a "＋ Add" button** (grow the list).
   - A **"Suggest competitors"** button → calls the new `discover_competitors` capability (from the brand
     URL + description) → user can accept/edit. (So a user who only has their own URL isn't stuck.)
2. **Query Fetcher** — a **"Fetch queries"** button → generates the buyer-intent queries to test.
   - **How:** default = Claude Haiku generates from the description + inferred category; **ground** it with
     **Google Autocomplete/Suggest (free)** and, if a Perplexity key exists, real "people also ask". Return
     ~15–25 queries. User can **edit / add / delete** each (inline chips or a table). Save the final set.
3. **Budget & team**
   - `Budget` (USD, number), `Team size` (humans available for GEO, count).
   - Copy under it: *"We use this to size the action plan — what's realistically achievable, and by when."*

> On save, kick off (or offer) a **baseline benchmark** so the Dashboard has data. Persist:
> config version, brand, competitors, queries, budget, team.

### 4B. GEO Assistant  (route `/app/assistant`)
Landing with **two cards**: **MCP (Explore in your project)** and **Agent Mode**.

**4B-i. MCP page** (`/app/assistant/mcp`)
- How to connect (copy-paste the hosted `https://<host>/mcp` URL + the Connect flow), the **tool list with
  descriptions & example calls**, resources, prompts, and "what to ask". Basically the Connect page, richer.

**4B-ii. Agent Mode** (`/app/assistant/agent`) — a **Claude-Code-style chat**:
- **Prompt composer** with a **model selector** (v1: Claude models; later Groq/Gemini), streaming responses,
  visible **tool-call cards** (show which GEO tool ran + a peek at results), and **downloadable artifacts**.
- **Starter cards** (multi-select; user can pick several, or none). Renamed for clarity:

  | Card | Title (UI) | What it does | Output |
  |---|---|---|---|
  | 1 | **Where do I stand?** (Benchmark) | Run share-of-voice + citations + sentiment on the configured brand/competitors/queries | current standing |
  | 2 | **Why am I here?** (Diagnose) | Explain the gaps: which competitors win on which queries, and which sources/pages get cited instead of you (scrape those pages) | gap analysis |
  | 3 | **Where can I get to?** (Plan) | Turn the diagnosis + budget + team into a prioritized action plan **with a committed target** (expected citation/traffic/conversion uplift, timeline, assumptions & confidence) | action plan + projection → downloadable |
  | 4 | **How am I progressing?** (Track) | Compare against the last plan; ask what's been done (or upload an updated plan); scrape evidence (backlinks, Reddit posts, new pages) → before/after impact + what's still pending | progress report |

- **Behaviour:**
  - Skipping a card still works — the agent uses the same underlying tools driven by the user's free-text.
  - Cards 1–3: user can **ask a question** or just hit **"Go"**. Any missing required input (e.g. no queries
    yet) is **asked as a chat question**, not a dead-end.
  - For **solution/plan output (card 3)**: after generating, ask **"How do you want it?" → PDF · Excel ·
    interactive HTML**, then produce a **structured, downloadable report**. The plan **must** include a clearly
    labeled **projected impact** (traffic/conversions if all steps are done) with **stated assumptions + a
    confidence level** — framed as a *modeled projection, not a guarantee* (be honest; see §6).
  - **Card 4 (Track):** the agent pulls the prior plan, asks the user to **upload the updated plan** or answers
    questions ("how many backlinks did you get? which Reddit threads?"), **scrapes** the cited/backlink pages it
    can reach, then reports **where they were → where they are, the impact of each action, and what's pending**.

> MCP path uses the **same tools**; the only difference is Agent Mode **auto-shapes the output to the query**
> and **asks for required inputs as questions**. Keep one tool layer; the web app is just a nicer driver.

### 4C. Dashboard  (route `/app/dashboard`) — *(figured out for you)*
A home for the user's GEO program:
- **KPI cards:** current AI Share of Voice %, Citation share %, Sentiment score, Hallucinations flagged — each
  with a 7/30-day delta.
- **Trend chart:** SoV over time (you vs each competitor) from `sov_history`.
- **Competitor leaderboard:** who leads on which queries.
- **Active plan & progress:** the current action plan, % complete, projected vs actual uplift.
- **Recent runs & downloads:** last benchmarks/reports with re-download.
- **Config summary + alerts:** brand/competitors/budget/team at a glance; alert chips ("SoV dropped 12% this
  week", "Competitor Z overtook you on 'best X'").
- Empty state → guided "Run your first benchmark".

---

## 5. SELF SERVE

Identical to We Serve **except Configure has two sub-tabs**: **Configure Context** and **Configure Platform**.

- **Configure Context** = the same fields as 4A (brand, competitors, query fetcher, budget, team).
- **Configure Platform** = *how* their audits run. Three options (radio/cards):

  **Option 1 — Trust us (managed, BYO keys).** Model selection + API-key fields (Claude required; Perplexity/
  Gemini/Groq optional; each with the "?" tooltip from §2).
  - **Key handling (make this explicit in the UI):** default = **session keys** — kept in the browser
    (localStorage), sent per request, **never persisted server-side**, used transiently to run the audit.
    A clearly-labeled **opt-in checkbox "Store my keys (encrypted)"** persists them **encrypted at rest** in
    Supabase (AES-GCM; never logged) so they don't have to re-enter them. Explain the trade-off in one line.
  **Option 2 — Own instance (one-click).** Sharp, step-by-step to deploy their own on **Render or Vercel**,
    **plus a one-click "Deploy" button** (Render Deploy-to-Render / Vercel Deploy button) → they land on the
    provider → sign in → env-vars page (pre-filled keys list with the "?" help) → deploy. Then they paste their
    new URL back into GetCited to use it.
  **Option 3 — Code base (DIY).** Detailed but sharp steps: download the repo (provide a link), push to their
    GitHub, deploy. Link to `docs/HOSTING.md`.

Persist which platform option is active per user so the assistant routes calls correctly (our keys vs theirs
vs their instance URL).

---

## 6. The projection / "committed target" (be honest)

Card 3's headline promise ("if you do all this, you'll reach X traffic/conversions") must be a **modeled
projection with visible assumptions and a confidence band — not a guarantee.** Build a small, transparent
`projectImpact()` in `packages/core`:
- Inputs: current SoV/citation gap, budget, team size, competitor cited-source difficulty, (optional) GSC/GA4
  baselines.
- Output: `{ targetCitationShare, projectedTrafficUplift, projectedConversions, timelineWeeks, assumptions[],
  confidence: "low|medium|high" }`.
- Always render the assumptions and confidence next to the number. In the report, add a one-line disclaimer.
  This keeps it credible instead of snake-oil.

---

## 7. New capabilities to build (in `packages/core`, exposed as MCP tools + used by Agent Mode)

Follow the existing tool pattern (schema in `packages/shared`, logic in `packages/core`, registration in
`apps/mcp-server/src/tools`, a test, real-if-key-else-mock). Add:
1. `suggest_queries(brand, description?, category?, count?)` → buyer-intent queries (Claude + Google Suggest/Perplexity grounding).
2. `discover_competitors(brand, domain?, category?, max?)` → grounded competitor list.
3. `build_action_plan(report_id, budget, teamSize, …)` → prioritized GEO plan + `projectImpact()` output.
4. `track_progress(plan_id, evidence|answers)` → scrape backlinks/pages, diff vs plan, before/after + pending.
5. `web_fetch(url)` / `scrape_page(url)` → readable text of a page (competitor cited pages, backlink verification).
6. `generate_report(payload, format: pdf|xlsx|html)` → downloadable artifact (store in Supabase Storage).

These make the "cards" real. Each is also a genuine MCP tool, so the MCP path and Agent Mode share one engine.

---

## 8. Data model additions (Drizzle migrations on the Supabase Postgres)

- `users` — from Supabase Auth (reference `auth.users` id).
- `configs` — per user, **versioned**: brand_url, description, competitors[], queries[], budget, team_size,
  mode (we_serve|self_serve), platform_option, instance_url?, created_at.
- `api_keys` — per user, **encrypted**, opt-in (provider, ciphertext, created_at). Never returned in plaintext.
- `plans` — generated action plans + projection JSON, linked to a config version + a report_id.
- `progress_snapshots` — card-4 tracking events (what was done, scraped evidence, measured deltas).
- `reports` — metadata + storage URL for generated PDF/Excel/HTML.
Everything keyed by `user_id`. Enforce **row-level security** (Supabase RLS) so users only see their own rows.

---

## 9. UI/UX direction ("awesome")

- **Aesthetic:** dark, editorial, Linear/Vercel-clean. Reuse the existing tokens (bg `#0B0D10`, card `#14171C`,
  accent indigo `#635BFF`, positive `#2FBF71`, warn `#E0A32E`, danger `#E5484D`, text `#E6E8EB`, muted
  `#8A9099`, Inter). Generous spacing, rounded-2xl cards, subtle borders, soft shadows, micro-interactions
  (Framer Motion) on cards/buttons/tool-call reveals.
- **Landing:** bold hero ("Get cited by AI. Know exactly how."), a crisp **We Serve / Self Serve** split, a live
  mini-demo (the free mock audit), social-proof/logos placeholder, and a "how it works" 3-step.
- **App shell:** left nav (Configure · GEO Assistant · Dashboard), top bar (brand selector, account).
- **Agent Mode:** feels like Claude Code — message stream, streaming tokens, **tool-call cards** (icon + tool
  name + collapsible result), **artifact chips** (downloadable report), a model picker, and the 4 starter cards
  as a dismissible grid above the composer.
- **States:** design empty / loading (skeletons) / running (progress + which panelist) / error (which provider,
  retry) / success for every screen.
- Fully responsive; keyboard-accessible; dark by default (optional light later).

---

## 10. Build in PHASES (each must stay green + committed to the private repo)

- **Phase 1 — Scaffold + Configure (We Serve).** `apps/web` Next.js + Tailwind + shadcn; Supabase auth; landing
  with We Serve/Self Serve; the Configure screen (fields, ＋, budget, team) persisting to Supabase; the DB
  migrations (§8). Ship the `suggest_queries` + `discover_competitors` tools so Configure's buttons work.
- **Phase 2 — GEO Assistant: MCP page + Agent Mode chat.** Streaming chat via Vercel AI SDK calling
  `@geo-radar/core` tools; tool-call cards; model selector; the MCP how-to page.
- **Phase 3 — The 4 cards + reports + projection.** `build_action_plan` + `projectImpact()` + `generate_report`
  (PDF/Excel/HTML) + `track_progress` + `web_fetch`. Wire the cards; "Go" vs question; ask-for-format.
- **Phase 4 — Self Serve: Configure Platform (3 options) + BYOK.** Session vs stored (encrypted) keys; one-click
  deploy buttons; the DIY code-base steps; route audits to the right keys/instance.
- **Phase 5 — Dashboard.** KPIs, trend, leaderboard, active plan/progress, alerts, downloads.

## 11. Guardrails
- Repo stays **PRIVATE**; commit to origin, do NOT publish/public. Loop stays OFF.
- After each phase: `pnpm typecheck && pnpm test && pnpm build` green; add tests for new tools (mock mode,
  offline); update `Handoff.MD` + `docs/mermaid`. Never log or expose API keys. Be honest about projections
  (§6). Ask the user before any paid/live external call in a build step.
```
