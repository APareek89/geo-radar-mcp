#!/usr/bin/env node
// build-html.mjs — turn a folder of .mmd files into ONE standalone, zoomable HTML viewer.
// Dependency-free: Mermaid is loaded from a CDN in the browser, so this needs no npm install.
// Usage:  node build-html.mjs <mmdDir> <outHtml>
//   e.g.  node build-html.mjs docs/mermaid docs/architecture-flow.html
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [, , mmdDir = "docs/mermaid", outHtml = "docs/architecture-flow.html"] = process.argv;

const files = readdirSync(mmdDir).filter((f) => f.endsWith(".mmd")).sort();
if (!files.length) { console.error(`no .mmd files in ${mmdDir}`); process.exit(1); }

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sections = files.map((f) => {
  const code = readFileSync(join(mmdDir, f), "utf8");
  const title = (code.match(/^%%\s*(.+)$/m)?.[1] ?? f).trim();
  return `<h2>${esc(title)}</h2>\n<pre class="mermaid">${esc(code)}</pre>`;
}).join("\n");

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Architecture Flow</title>
<style>
 body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:1100px;margin:0 auto;padding:24px 20px 80px;color:#1f2937;background:#fafafa}
 h1{border-bottom:2px solid #e5e7eb;padding-bottom:8px}
 h2{margin-top:36px;border-top:1px solid #e5e7eb;padding-top:18px;color:#111827}
 pre.mermaid{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:14px 0 28px;overflow:auto;text-align:center}
 .hint{position:sticky;top:0;background:#fff8e1;border:1px solid #f0d264;border-radius:6px;padding:8px 12px;font-size:13px;color:#5a4a00;margin-bottom:16px}
 .mermaid svg{max-width:100%;height:auto}
</style></head><body>
<div class="hint">Tip: use Ctrl/Cmd + scroll or browser zoom to enlarge a diagram.</div>
<h1>Architecture Flow</h1>
${sections}
<script type="module">
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
mermaid.initialize({ startOnLoad:false, securityLevel:"loose", theme:"base",
  themeVariables:{ fontFamily:"-apple-system, Segoe UI, Roboto, sans-serif", fontSize:"14px" } });
await mermaid.run({ querySelector:"pre.mermaid" });
</script>
</body></html>`;

writeFileSync(outHtml, html);
console.log(`wrote ${outHtml} (${files.length} diagrams). Open it in a browser.`);
