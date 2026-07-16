# GEO Radar MCP

**SEO measured Google. GEO Radar measures whether ChatGPT, Perplexity, Claude, and Google AI Overviews recommend _you_** — your AI share-of-voice, citations, sentiment, and hallucinations, across a panel of cheap LLMs.

An open-source **[Model Context Protocol](https://modelcontextprotocol.io) (MCP)** server. Ships all three MCP primitives (tools + resources + prompts) over **stdio** (local) and **streamable-HTTP** (remote).

> Status: v1 core complete — the 7 measurement tools, 4 resources, and 3 prompts run end-to-end. See [`Handoff.MD`](./Handoff.MD) for exact phase status.

## What it does

You give it a brand + competitors + buyer-intent prompts. It asks a panel of AI models, reads their answers, and computes:

- **Share of Voice** — % of answers that recommend you vs named competitors
- **Citations** — which domains the answers cite (yours vs the competitor gap)
- **Sentiment** — how you're characterized, with representative quotes
- **Hallucinations** — false/outdated claims about you, scored against a facts list

## 60-second install (local, stdio)

```bash
git clone <this-repo> geo-radar-mcp && cd geo-radar-mcp
corepack enable && pnpm install && pnpm build
cp .env.example .env      # add ANTHROPIC_API_KEY (required)
```

Add to **Claude Desktop** (`claude_desktop_config.json`) or Claude Code:

```json
{
  "mcpServers": {
    "geo-radar": {
      "command": "node",
      "args": ["/absolute/path/to/geo-radar-mcp/apps/mcp-server/dist/index.js"],
      "env": { "ANTHROPIC_API_KEY": "sk-ant-...", "GEO_STORE": "memory" }
    }
  }
}
```

`GEO_STORE=memory` runs without a database (data isn't persisted). For persistence set `DATABASE_URL` to a Postgres and run `pnpm --filter @geo-radar/db db:migrate`.

## Tools

| Tool | Input | Returns |
|---|---|---|
| `measure_share_of_voice` | brand, competitors[], prompts[] or prompt_set_id, panel[], runs | `report_id`, SoV per brand, per-prompt breakdown |
| `get_report` | report_id | full stored report |
| `track_citations` | report_id, brand_domains[] | cited domains, your-vs-competitor share, the gap |
| `sentiment_scan` | report_id | sentiment distribution + quotes |
| `detect_hallucinations` | report_id, facts[] | flagged claims + contradicted fact + severity |
| `compare_to_competitor` | brand_a, brand_b, prompts/prompt_set_id | head-to-head SoV, citations, sentiment, winner |
| `ping` | message? | health check |

**Resources:** `prompts://library` · `brand://config` · `reports://{report_id}` · `history://sov{?brand,range}`
**Prompts:** `run_full_geo_audit` · `draft_reputation_defense_brief` · `weekly_sov_report`

## Example

```
measure_share_of_voice(brand="PixelBin", competitors=["Photoroom","remove.bg"], prompt_set_id="demo")
→ { report_id, share_of_voice: [{brand:"remove.bg", sov:0.67}, {brand:"PixelBin", sov:0.0}], ... }
get_report(report_id) → full answers, citations, sentiment
```

## Panel (v1)

Claude **Haiku** (also the parser/scorer) · **Gemini** Flash · **Groq** Llama · **Perplexity** Sonar. Each runs for real only when its API key is set (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `PERPLEXITY_API_KEY`); otherwise a deterministic mock keeps everything working offline. A per-run **cost cap** (`PANEL_COST_CAP_USD_PER_RUN`) aborts before overspending.

## Remote (HTTP) mode

```bash
MCP_TRANSPORT=http PORT=8080 MCP_API_KEY=your-secret node apps/mcp-server/dist/index.js
# POST /mcp (Bearer auth) · GET /healthz
```

Deploy with the included [`render.yaml`](./render.yaml) (web + worker + Postgres + Redis, autoscaling). See [`SCALING.md`](./SCALING.md).

## Develop

```bash
pnpm dev:mcp        # run the stdio server (tsx watch)
pnpm test           # 34 tests, all offline (mock panel + pglite Postgres)
pnpm typecheck
pnpm diagrams:build # regenerate docs/architecture-flow.html
```

Monorepo: `apps/mcp-server` · `packages/{shared,core,db}`. Architecture: [`docs/ARCHITECTURE_FLOW.md`](./docs/ARCHITECTURE_FLOW.md).

## License

MIT.
