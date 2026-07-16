# Publishing checklist (P12)

These steps are **outward-facing and need your accounts** — run them yourself; they're prepared here, not executed automatically.

## 0. Prereqs
- [ ] Push the repo to GitHub (`github.com/<you>/geo-radar-mcp`) — update the URL in [`server.json`](./server.json) and README to your handle.
- [ ] Record the "Try it in Claude" Loom/GIF and embed it in the README Connect section.
- [ ] Deploy the hosted demo (`render.yaml`) and confirm `/healthz` is green.

## 1. Official MCP Registry
- [ ] Install the publisher CLI: `mcp-publisher` (see modelcontextprotocol.io/registry).
- [ ] Authenticate (GitHub OIDC): `mcp-publisher login github`.
- [ ] Validate [`server.json`](./server.json) matches your published npm package name/version.
- [ ] `mcp-publisher publish`.

## 2. Package
- [ ] Publish `@geo-radar/mcp-server` to npm (or configure the registry entry for a git/source install).

## 3. Directories & lists
- [ ] PR into [`punkpeye/awesome-mcp-servers`](https://github.com/punkpeye/awesome-mcp-servers).
- [ ] Claim/submit on **Smithery**, **Glama**, **PulseMCP**.

## 4. Definition of done (PRD §12)
- [x] All 3 primitives (tools + resources + prompts)
- [x] stdio + streamable-HTTP
- [x] Bearer auth on HTTP (OAuth issuer/exp check; JWKS signature verification = follow-up)
- [x] JSON Schema (via Zod) on every tool
- [x] `report_id` handles, no hidden session state
- [x] structured stderr logs; OTel/Sentry hooks (`SCALING.md`)
- [x] contract + unit tests in CI (34 tests)
- [ ] published to registry + awesome-list + directories (this file)
- [x] 60-second-install README
- [ ] hosted Render demo + Loom
