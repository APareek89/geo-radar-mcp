# GEO Radar MCP — Architecture Flow

Honest, granular diagrams of the **real runtime flow**. A person who can't read the code
should be able to debug from these. Update the `.mmd` in the same session as any
structural change — the git diff of the `.mmd` _is_ the change highlight.

- **Built (P1):** stdio transport + `ping`.
- **Built (P2):** `measure_share_of_voice` + `get_report` — in-process `PanelRunner`, Haiku panelist + parser (Vercel AI SDK), deterministic scoring, `DrizzleStore`/`MemoryStore`.
- **Intended — not yet built:** BullMQ queue/worker (P6), streamable-HTTP + OAuth (P7), Gemini/Groq/Perplexity panelists (P5).

Regenerate the standalone viewer: `pnpm diagrams:build` → open `docs/architecture-flow.html`.
Validate syntax: `pnpm diagrams:validate`.

## Legend

| Label | Meaning |
|---|---|
| `[AGENT · <model>]` | an LLM makes the decision/generation |
| `[FUNCTION]` | deterministic code, no model |
| `[LIBRARY · <name>]` | an external library does the work |
| `[DATA · <store>]` | a store/table being read or written |

## Master flow

```mermaid
flowchart TD
  client["MCP client · Claude Desktop/Code<br/>[FUNCTION]<br/>in: user asks for GEO metrics<br/>out: MCP tool call"]:::term
  transport["Transport · stdio (P1) | streamable-HTTP (P7)<br/>[LIBRARY · @modelcontextprotocol/sdk]<br/>in: tool-call bytes<br/>out: routed request"]:::data
  validate["Validate input<br/>[FUNCTION · zod schema from packages/shared]<br/>in: raw args<br/>out: typed args | error"]:::fn
  heavy{"Heavy tool?<br/>[FUNCTION]"}:::dec
  ping["ping / get_report · light<br/>[FUNCTION]<br/>in: typed args<br/>out: immediate result"]:::fn
  done["Immediate result to client<br/>[FUNCTION]"]:::term
  enqueue["Create panel_run · status=queued<br/>[FUNCTION]<br/>in: brand + prompts + panel<br/>out: report_id"]:::fn
  returnid["Return report_id · 202-style<br/>[FUNCTION]<br/>out: report_id"]:::term
  runner["PanelRunner<br/>[FUNCTION · in-process P2-P5 · BullMQ worker P6+]<br/>in: report_id<br/>out: one job per prompt x model"]:::fn
  costgate{"Cost cap<br/>[FUNCTION · projected <= PANEL_COST_CAP_USD_PER_RUN]"}:::dec
  abort["Abort · cost-cap error<br/>[FUNCTION]<br/>out: error, nothing spent"]:::term
  panelist["Panelist answer<br/>[AGENT · Haiku | Gemini | Groq | Perplexity]<br/>in: buyer-intent prompt<br/>out: raw answer text"]:::agent
  parse["Extract mentions / cited domains / sentiment<br/>[AGENT · Haiku · structured output]<br/>in: raw answer<br/>out: parsed record"]:::agent
  score["Score SoV / citation share / sentiment / hallucinations<br/>[FUNCTION]<br/>in: parsed answers (+ facts)<br/>out: metrics"]:::fn
  store["Persist answers + sov_history row<br/>[DATA · Postgres]<br/>in: metrics<br/>out: stored report"]:::data
  report["get_report(report_id)<br/>[FUNCTION]<br/>in: report_id<br/>out: full report"]:::term

  client --> transport --> validate --> heavy
  heavy -->|"no · ping/get_report"| ping --> done
  heavy -->|"yes · measure/track/detect/compare"| enqueue --> returnid
  enqueue --> runner --> costgate
  costgate -->|"over cap"| abort
  costgate -->|"under cap"| panelist --> parse --> score --> store
  store -.->|"agent polls report_id"| report

  classDef agent fill:#dbeafe,stroke:#2563eb,color:#0b2a5b;
  classDef fn fill:#dcfce7,stroke:#16a34a,color:#052e16;
  classDef dec fill:#f3e8ff,stroke:#9333ea,color:#2a0a4a;
  classDef term fill:#e5e7eb,stroke:#6b7280,color:#111827;
  classDef ask fill:#cffafe,stroke:#0891b2,color:#083344;
  classDef data fill:#ede9fe,stroke:#7c3aed,color:#2a0a4a;
```

## Gates at a glance

| Gate | Enforcer | Threshold |
|---|---|---|
| Heavy vs light routing | FUNCTION | tool name ∈ {measure, track, detect, compare} → async |
| Cost cap | FUNCTION | projected run cost ≤ `PANEL_COST_CAP_USD_PER_RUN` |
| report_id validity | FUNCTION | scoped handle with expiry (no hidden session state) |

## File index (stage → file)

| Stage | File |
|---|---|
| Transport / entry (stdio) | `apps/mcp-server/src/index.ts` |
| Env loading + runtime wiring | `apps/mcp-server/src/env.ts` · `runtime.ts` |
| Server factory + tool registration | `apps/mcp-server/src/server.ts` |
| Tools | `apps/mcp-server/src/tools/{ping,measure-share-of-voice,get-report}.ts` |
| Shared Zod schemas | `packages/shared/src/schemas/` |
| Panelist / parser / scoring / cost / runner | `packages/core/src/` |
| Prompt library (built-ins + demo seed) | `packages/core/src/prompt-library.ts` |
| Drizzle schema + stores (Postgres / in-memory) | `packages/db/src/` |
| BullMQ worker | _P6 (not yet built)_ |
