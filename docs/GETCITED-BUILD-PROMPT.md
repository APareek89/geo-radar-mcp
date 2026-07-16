# GetCited — build prompt (separate project; reuses geo-radar-mcp as reference)

> **Where to run:** start a fresh Claude Code session **in a NEW folder**
> `/Users/anandpareek/Documents/Projects/GetCited`. Reference the existing project at
> `/Users/anandpareek/Documents/Projects/geo-radar-mcp` (read-only) to **port + adapt** its proven code and to
> copy env-var *names/values*. Do NOT edit geo-radar-mcp. Work **one phase at a time**, keep the build green,
> commit to a **new PRIVATE** repo, and keep a `HANDOFF.md` in GetCited updated.

> **Kickoff line to paste:** "Create a new project in /Users/anandpareek/Documents/Projects/GetCited following
> docs/GETCITED-BUILD-PROMPT.md (copied from the geo-radar-mcp repo). Read the reference project at
> /Users/anandpareek/Documents/Projects/geo-radar-mcp to port the GEO pipeline. Build Phase 1. Keep it private."

---

## 0. Vision

**GetCited** tells a brand whether AI assistants recommend/cite them, **and turns that into a costed, committed
action plan** — "you have $400 and 2 people; here's exactly where to spend it (paid blog, a YouTube mention, 3
comparison pages…), and if you do it all you'll go from 5% → ~22% AI citation share in ~8 weeks." The plan and
its target are **grounded in how competitors are actually cited** (we crawl and categorize their citations),
not vibes.

Two modes: **We Serve** (our keys/infra) and **Self Serve** (user brings keys / self-hosts).

---

## 1. Reuse map — port these FROM geo-radar-mcp (read them, adapt into GetCited `lib/geo/`)

The measurement engine is proven; port the logic (adapt for per-user keys + Supabase, drop the MCP-server bits):
| From geo-radar-mcp | Into GetCited | Notes |
|---|---|---|
| `packages/core/src/{panelist,parser,providers,models,scoring,cost,prompt-library,analysis}.ts` | `lib/geo/*` | the panel pipeline (real-if-key-else-mock) — **make provider keys a per-call param, not process.env** |
| `packages/core/src/{compare,report,errors}.ts` | `lib/geo/*` | scoring/report helpers |
| `packages/shared/src/schemas/*` | `lib/geo/schemas/*` | Zod I/O shapes |
| `packages/db/src/schema.ts` | `lib/db/schema.ts` | Drizzle tables → run on **Supabase Postgres** |
| `.env` values | `.env.local` | copy the *values* you have: `ANTHROPIC_API_KEY`, `PERPLEXITY_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `PANEL_COST_CAP_USD_PER_RUN` |

**Do not port:** `apps/mcp-server`, `apps/worker`, the MCP OAuth/transport, Render/GCP config. GetCited is a
web app; it calls the ported pipeline directly (server-side). (Optionally expose an MCP endpoint later.)

---

## 2. Tech stack (decided — don't re-litigate)

- **Next.js (App Router, TS) on Vercel** · **Tailwind + shadcn/ui + Framer Motion + lucide-react** · **Recharts**.
- **Supabase** = Postgres (via Drizzle) + **Auth** (email + Google) + **Storage** (generated reports). **No GCP.**
- **Vercel AI SDK (`ai`)** for the Agent-Mode streaming chat with tool-calls into `lib/geo`.
- **Crawler: Firecrawl** (LLM-ready crawl/scrape, has a free tier) with a plain `fetch`+readability fallback.
- Reports: **HTML (interactive)** always; **PDF** via `@react-pdf` or Playwright; **Excel** via `exceljs`.

---

## 3. APIs — must-have vs optional (each field in the UI gets a "?" tooltip; copy below)

**Must-have (v1):**
- **Anthropic (Claude)** — *"Runs the assistant, parses AI answers, and writes the action plan. Required."*
- **Supabase** — *"Auth + stores your config, plans, crawl evidence, and reports so trends and progress work."*

**Strongly recommended:**
- **Perplexity** — *"A real, web-grounded AI-search panelist that returns the actual pages AI cites — the evidence the plan is built on."*
- **Firecrawl** — *"Crawls competitors' cited pages and your backlinks so the plan is grounded in where citations really come from."*

**Optional — more coverage / better ROI math:**
- **Gemini**, **Groq** — *"Extra AI panelists (free/cheap tiers) for wider share-of-voice coverage."*
- **Google Search Console** (free) — *"Your real search queries + traffic; sharpens the query list and the traffic projection."*
- **GA4** — *"Ties AI visibility to real sessions & conversions — the 'did it work' number."*
- **YouTube Data API** (free quota) — *"Finds creators/videos already mentioning competitors, for the 'YouTube mention' tactic."*
- **Ahrefs / Semrush** (premium, BYO) — *"Backlink/citation data at scale — who links to competitors — for a stronger evidence base."*

Show a **cost chip** on each (`~cents`, `free tier`, `$$$`) so users choose sensibly.

---

## 4. THE CORE DIFFERENTIATOR — the budget→plan scoring engine (`lib/geo/plan.ts`)

This is what makes it a product. Build it transparent and tunable.

**Step 1 — Evidence (crawl competitors' citations).** From the AI-answer citations (+ Perplexity + optional
Ahrefs), collect the URLs that cite each competitor and **categorize each source**:
`roundup/listicle · review-platform (G2/Capterra/ProductHunt) · editorial/news/PR · youtube · reddit/forum ·
owned (comparison pages/blog/docs) · social`. Produce a **citation profile** per competitor (count per type).

**Step 2 — Gap.** Your citation profile vs the leader's → the biggest deficits (e.g. "0 roundups vs 8", "no
review-site presence", "2 comparison pages vs 11").

**Step 3 — Tactic library** (ships with tunable defaults; each tactic = cost, effort in person-hours, lead
time, and an evidence-weighted **citation-lift** toward specific source types):

| Tactic | Cost (USD) | Effort (hrs) | Lead | Lifts |
|---|---|---|---|---|
| Sponsored/guest post on a niche blog | 150–400 | 4–8 | 2–4 wk | editorial |
| Get into a "best X" roundup (outreach±paid) | 0–500 | 6–12 | 3–8 wk | roundup (high) |
| G2/Capterra/ProductHunt profile + seed reviews | 0 (+incentives) | 10–20 | 2–6 wk | review (high, B2B) |
| Sponsor a YouTube review/mention | 200–1000 | 3–6 | 2–4 wk | youtube |
| Publish "X vs Y" comparison pages (per 3) | 0 (content) | 12–24 | 1–3 wk | owned (high) |
| 10–15 genuine Reddit/community answers | 0 | 8–15 | ongoing | reddit |
| Digital PR / HARO responses | 0–300 | 6–12 | 3–8 wk | editorial/news |
| FAQ + Product schema + llms.txt on your pages | 0 | 4–8 | 1 wk | foundational multiplier |

**Step 4 — Capacity + allocation.** person-hours = `teamSize × timelineWeeks × ~25 productive hrs/wk`. Given
`budget` and person-hours, run a **greedy knapsack**: pick tactics with the highest *citation-lift per
(normalized cost + effort)*, **prioritized to fill the Step-2 gaps**, until budget or hours run out. Output the
chosen tactic list with per-tactic cost/effort and *what gap it closes*.

**Step 5 — Target/projection (`projectImpact()`).** Sum the selected tactics' lift → projected new **citation
share** → map to **traffic** (category search volume × position CTR; use GSC if connected, else stated
assumptions) → **conversions** (× assumed CVR). Return
`{ targetCitationShare, projectedTrafficUplift, projectedConversions, timelineWeeks, tactics[], assumptions[],
confidence }`. **Confidence is `high` only when grounded by real data (GSC/Perplexity/Ahrefs); otherwise
`medium/low`, and every assumption is listed.** Frame it as a **modeled projection, not a guarantee** (honest).

**Worked example the engine should be able to produce** ($400, 2 people, 8 weeks ≈ 400 person-hrs):
> Gaps: 0 roundups, no review presence, thin comparison pages. Plan: publish 3 "vs" pages (owned, ~60h), seed
> G2+Capterra (~40h), 2 sponsored niche posts ($300, ~30h), 15 Reddit answers (~40h), schema+llms.txt (~20h),
> 1 small YouTube mention ($100, ~15h). Spend $400, ~205h of 400. **Projected: citation share 5% → ~22% in
> 8–10 wks; ≈ +N AI-referred sessions/mo; confidence medium (assumptions listed).**

---

## 5. Crawling (`lib/geo/crawl.ts`)
- `crawlCitations(urls)` → for each cited/competitor/backlink URL: fetch readable content + classify the source
  type (Step 1) + extract signals (does it mention you? the competitor? what claims?). Firecrawl first,
  `fetch`+readability fallback. Cache results in Supabase (avoid re-crawling; respect robots + rate limits).
- Used by: Diagnose (why competitors win), Plan (evidence), Track (verify backlinks/Reddit posts the user did).

---

## 6. Product surface (We Serve / Self Serve)

**Left nav:** Configure · GEO Assistant · Dashboard. (Self Serve adds a **Configure Platform** sub-tab.)

**Configure (versioned, saved per user, reconciled):** Brand URL, optional description, competitor URLs ×5 +
"＋", a **"Suggest competitors"** button, a **"Fetch queries"** button (Claude-generated + Google-Suggest/
Perplexity grounded; editable list), **Budget (USD)** and **Team size (count)**.

**GEO Assistant → [ MCP ] | [ Agent Mode ]:**
- **MCP page:** how to connect the (optional) MCP endpoint, tools, examples.
- **Agent Mode:** Claude-Code-style streaming chat + **model selector** + visible **tool-call cards** +
  downloadable **artifacts**. Four **starter cards** (multi-select; skippable — free-text still works):

  | Card | Title | Does | Output |
  |---|---|---|---|
  | 1 | **Where do I stand?** (Benchmark) | SoV + citations + sentiment on the config | standing |
  | 2 | **Why am I here?** (Diagnose) | crawl + categorize competitor citations; where/why they win | gap analysis |
  | 3 | **Where can I get to?** (Plan) | §4 engine → costed plan + committed target | plan + projection → **PDF/Excel/HTML** |
  | 4 | **How am I progressing?** (Track) | pull prior plan; ask what's done / upload update; crawl evidence (backlinks, Reddit) | before→after + impact + pending |

  Cards 1–3: user asks a question **or** hits **"Go"**; missing inputs are **asked as chat questions**. Plan
  output asks **format** then generates a **structured, downloadable report** (with the projection + assumptions).
  Card 4 diffs against the last plan and verifies via crawling.

**Self Serve → Configure Platform** (three options, same as before):
1. **Trust us (BYO keys):** model + key fields. Default **session keys** (browser localStorage, sent per
   request, **never persisted**); explicit opt-in **"Store encrypted"** → AES-GCM in Supabase, never logged.
2. **Own instance:** sharp Render/Vercel steps **+ one-click Deploy button** → provider → sign in → env page →
   deploy → paste URL back.
3. **Code base:** download-repo → GitHub → deploy steps + link.

**Dashboard:** KPI cards (SoV %, citation share %, sentiment, hallucinations, each w/ delta) · SoV trend chart ·
competitor leaderboard · **active plan & % complete (projected vs actual)** · recent reports/downloads · config
summary + alert chips · empty-state → "Run your first benchmark".

---

## 7. Data model (Drizzle on Supabase; enable **RLS** so users see only their rows)
`profiles` (↔ Supabase `auth.users`) · `configs` (versioned: brand, description, competitors[], queries[],
budget, team_size, mode, platform_option, instance_url?) · `api_keys` (encrypted, opt-in) · `runs`/`answers`/
`sov_history`/`hallucinations` (ported) · `citations` (crawled evidence: url, source_type, cites_competitor,
signals) · `plans` (tactics[] + projection JSON + config_version) · `progress_snapshots` · `reports` (format +
Storage URL). Everything keyed by `user_id`.

---

## 8. UI/UX ("awesome")
Dark, editorial, Linear/Vercel-clean. Tokens: bg `#0B0D10`, card `#14171C`, accent `#635BFF`, pos `#2FBF71`,
warn `#E0A32E`, danger `#E5484D`, text `#E6E8EB`, muted `#8A9099`, Inter. rounded-2xl cards, subtle borders,
Framer-Motion micro-interactions. **Landing:** hero "Get cited by AI. Know exactly what to do." + We Serve /
Self Serve split + a live free **mock** audit. **Agent Mode** feels like Claude Code (streaming, tool-call
cards, artifact chips, model picker, the 4 starter cards as a grid above the composer). Design every state
(empty/loading-skeleton/running-with-progress/error/success). Responsive + accessible + dark by default.

---

## 9. Build in PHASES (each: green build + tests for new logic + commit to the private GetCited repo + HANDOFF.md)
1. **Scaffold + reuse-port + Configure.** Next.js + Tailwind + shadcn; Supabase Auth + schema/migrations; port
   `lib/geo` pipeline (per-user keys); landing + Configure (fields, ＋, budget, team) + `suggest_queries` +
   `discover_competitors`.
2. **GEO Assistant: Agent Mode chat + MCP page.** Vercel AI SDK streaming chat calling `lib/geo` tools; tool-call
   cards; model selector.
3. **Crawling + the scoring engine + cards + reports.** `crawl.ts`, `plan.ts` (§4) + `projectImpact()`,
   `generate_report` (PDF/Excel/HTML); wire cards 1–4; Go/question; ask-for-format; the projection UI.
4. **Self Serve: Configure Platform (3 options) + BYOK** (session vs encrypted-stored keys; one-click deploy).
5. **Dashboard** (KPIs, trend, leaderboard, active plan/progress, alerts, downloads).

## 10. Guardrails
New repo **PRIVATE**; commit locally, don't publish/public. After each phase: build + typecheck + tests green;
new logic (esp. `plan.ts` allocation + `projectImpact`) gets unit tests with mock inputs. **Never log/expose API
keys.** Be **honest** about projections (modeled, assumptions listed, confidence band). Respect robots.txt + rate
limits when crawling. Ask the user before any paid/live external call inside a build step.
```
