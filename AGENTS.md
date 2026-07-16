# GEO Radar MCP — agent guide

Open-source **MCP server** that measures a brand's AI share-of-voice, citations,
sentiment, and hallucinations across a panel of cheap LLMs. Full plan:
[`GEO-Radar-MCP-PRD.md`](./GEO-Radar-MCP-PRD.md). Current state: [`Handoff.MD`](./Handoff.MD).

## Build discipline (from the PRD)
- Follow **PRD §11** one prompt at a time; **teach plain-English-then-technical**, show
  the diff + a one-line "how to verify", and **pause for the user's OK** between steps (§0b).
- Never print secret *values* — only check presence. `.env.example` ships blank.
- Build only inside this folder.

## Stack (approved)
TypeScript · `@modelcontextprotocol/sdk` · **Vercel AI SDK** (panelists + structured
parse) · **Drizzle ORM** on Postgres · **Zod → JSON Schema 2020-12** (single source of
truth) · **pnpm + Turborepo** monorepo · BullMQ/Redis **deferred to P6** behind a
`PanelRunner` interface. v1 panelists: Haiku (+ parser/scorer) · Gemini · Groq · Perplexity.

## Layout
- `apps/mcp-server` — MCP server (stdio now; HTTP + OAuth at P7)
- `packages/shared` — Zod schemas / types
- `packages/db` — Drizzle schema/queries _(P2+)_ · `apps/worker` _(P6)_ · `apps/dashboard` _(P9)_
- `docs/mermaid` + `docs/ARCHITECTURE_FLOW.md` — architecture diagrams

## Power Coding (auto — do not remove without asking the user)
At session start read Handoff.MD; open with its pending points. Update Handoff.MD
after major changes and when ~10% of context remains (then tell the user to start a
fresh session with: "Refer to Handoff.MD in /Users/anandpareek/Documents/Projects/geo-radar-mcp and begin").
Log flow changes / user-reported bugs with root cause in Learning.MD.
Read Loop.MD every session and obey its `status:` machine — when the first working
draft is done, ASK the user whether to turn the loop on; while `status: on`, run the
Loop.MD evals after every meaningful change and report per-eval pass/fail.
Keep docs/mermaid/*.mmd current when the flow changes (see docs/ARCHITECTURE_FLOW.md).
Obey .power-coding/config.json FMEA triggers: smart_suggest is ON — watch for signals
(new API integrations, async/queue, OAuth, error-handling, 200+ line diffs, migrations)
and suggest an FMEA scan at a natural pause (never twice for the same change-set). Run
`power-coding fmea` on request. The config's failure_categories list is the mandatory
checklist; prd_path is GEO-Radar-MCP-PRD.md.
