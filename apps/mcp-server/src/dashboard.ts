import type { Express, Request, Response } from "express";
import { SERVER_VERSION } from "@geo-radar/shared";
import {
  InProcessPanelRunner,
  buildReport,
  computeCitations,
  computeSentiment,
  type AnalysisAnswer,
} from "@geo-radar/core";
import type { ServerRuntime } from "./runtime";

/**
 * Companion dashboard (P9) — a polished single-page app served by the HTTP tier,
 * plus a small read/demo JSON API. Read endpoints and the demo audit are
 * unauthenticated on purpose so the hosted demo works in a browser; the demo audit
 * always uses the free mock pipeline (real audits go through the authed MCP tools).
 */
export function registerDashboard(app: Express, runtime: ServerRuntime): void {
  const { store } = runtime;
  const demoRunner = new InProcessPanelRunner(store, { costCapUsd: 1, forceMock: true });

  const toAnalysis = (answers: { prompt: string; rawAnswer: string; citedDomains: string[]; sentiment: AnalysisAnswer["sentiment"] }[]): AnalysisAnswer[] =>
    answers.map((a) => ({ prompt: a.prompt, rawAnswer: a.rawAnswer, citedDomains: a.citedDomains, sentiment: a.sentiment }));

  app.get("/api/brands", async (_req, res) => res.json(await store.listBrands()));

  app.get("/api/sov", async (req: Request, res: Response) => {
    const brand = String(req.query.brand ?? "");
    if (!brand) return res.status(400).json({ error: "brand required" });
    res.json(await store.getSovHistory(brand, Number(req.query.range ?? 90) || 90));
  });

  // Free demo audit (mock pipeline).
  app.post("/api/audit", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      brand?: string;
      competitors?: string[];
      prompt_set_id?: string;
      brand_domains?: string[];
    };
    try {
      const report = await demoRunner.run({
        brand: body.brand || "PixelBin",
        competitors: body.competitors?.length ? body.competitors : ["Photoroom", "remove.bg", "Cloudinary"],
        brand_domains: body.brand_domains ?? ["pixelbin.io"],
        prompt_set_id: body.prompt_set_id || "demo",
      });
      const full = await buildReport(store, report.report_id);
      res.json(full);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/report/:id", async (req, res) => {
    const full = await buildReport(store, req.params.id);
    if (!full) return res.status(404).json({ error: "not found" });
    res.json(full);
  });

  app.get("/api/citations/:id", async (req, res) => {
    const r = await store.getReport(req.params.id);
    if (!r) return res.status(404).json({ error: "not found" });
    res.json(computeCitations(req.params.id, r.brand, toAnalysis(r.answers), r.brandDomains));
  });

  app.get("/api/sentiment/:id", async (req, res) => {
    const r = await store.getReport(req.params.id);
    if (!r) return res.status(404).json({ error: "not found" });
    res.json(computeSentiment(req.params.id, r.brand, toAnalysis(r.answers)));
  });

  app.get("/", (_req, res) => res.type("html").send(HTML));
}

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>GEO Radar</title>
<style>
:root{--bg:#0B0D10;--panel:#0f1216;--card:#14171C;--accent:#635BFF;--accent2:#8b85ff;--pos:#2FBF71;--warn:#E0A32E;--danger:#E5484D;--text:#E6E8EB;--muted:#8A9099;--border:#20242b}
*{box-sizing:border-box}html,body{margin:0;height:100%}body{background:var(--bg);color:var(--text);font:14px/1.55 Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex}
a{color:var(--accent2);text-decoration:none}
.side{width:232px;flex:0 0 232px;background:var(--panel);border-right:1px solid var(--border);padding:18px 12px;display:flex;flex-direction:column;gap:4px;height:100vh;position:sticky;top:0}
.brandmark{font-weight:700;font-size:16px;padding:6px 10px 14px}.brandmark b{color:var(--accent)}
.nav{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:9px;color:var(--muted);cursor:pointer;font-weight:500}
.nav:hover{background:#161a20;color:var(--text)}.nav.active{background:#1b2030;color:#fff}
.nav .dot{width:7px;height:7px;border-radius:99px;background:currentColor;opacity:.6}
.side .foot{margin-top:auto;color:var(--muted);font-size:11px;padding:10px}
.main{flex:1;min-width:0;height:100vh;overflow:auto}
.top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 28px;border-bottom:1px solid var(--border);position:sticky;top:0;background:rgba(11,13,16,.85);backdrop-filter:blur(8px);z-index:5}
.top h1{font-size:18px;margin:0}.top .sub{color:var(--muted);font-size:12px}
.btn{background:var(--accent);color:#fff;border:none;border-radius:9px;padding:9px 16px;font:600 13px Inter;cursor:pointer}
.btn:hover{background:var(--accent2)}.btn[disabled]{opacity:.6;cursor:default}
.wrap{padding:24px 28px;max-width:1100px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px}
.kpi .n{font-size:30px;font-weight:700;letter-spacing:-.5px}.kpi .l{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.5px;margin-top:2px}
.kpi .d{font-size:12px;margin-top:6px}.up{color:var(--pos)}.down{color:var(--danger)}
h3{margin:2px 0 12px;font-size:14px}.section{margin-top:22px}
.row{display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--border)}.row:last-child{border:0}
.row .name{width:150px;flex:0 0 150px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar{flex:1;height:10px;background:#1c212a;border-radius:6px;overflow:hidden}.bar>i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2))}
.bar.alt>i{background:#2a3040}.pct{width:70px;text-align:right;color:var(--muted);font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--border);font-size:13px}th{color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.4px}
.tag{display:inline-block;background:#1b2030;border:1px solid var(--border);border-radius:99px;padding:2px 9px;margin:2px 3px 2px 0;font-size:12px}
.tag.pos{color:var(--pos);border-color:#1e3a2a}.tag.neg{color:var(--danger);border-color:#3a1e22}.tag.neu{color:var(--muted)}
.tag.you{background:#211d4d;border-color:#3a337a;color:#c4bfff}
pre{background:#0c0f13;border:1px solid var(--border);border-radius:10px;padding:14px;overflow:auto;font-size:12px;margin:8px 0}code{color:var(--pos)}
.muted{color:var(--muted)}.empty{color:var(--muted);padding:20px;text-align:center}
.hide{display:none}.spin{display:inline-block;width:14px;height:14px;border:2px solid #fff5;border-top-color:#fff;border-radius:99px;animation:s .7s linear infinite;vertical-align:-2px}@keyframes s{to{transform:rotate(360deg)}}
.feed .q{font-weight:600}.feed .a{color:var(--muted);font-size:12px}
</style></head><body>
<aside class="side">
 <div class="brandmark">GEO&nbsp;<b>Radar</b></div>
 <div class="nav active" data-v="overview"><span class="dot"></span>Overview</div>
 <div class="nav" data-v="citations"><span class="dot"></span>Citations</div>
 <div class="nav" data-v="competitors"><span class="dot"></span>Competitors</div>
 <div class="nav" data-v="hallucinations"><span class="dot"></span>Hallucinations</div>
 <div class="nav" data-v="connect"><span class="dot"></span>Connect (MCP)</div>
 <div class="nav" data-v="guide"><span class="dot"></span>How it is built</div>
 <div class="foot">v${SERVER_VERSION} · demo audits use the free mock panel</div>
</aside>
<div class="main">
 <div class="top"><div><h1 id="title">Overview</h1><div class="sub" id="ctx">No audit loaded yet</div></div>
  <button class="btn" id="run">▶ Run demo audit</button></div>
 <div class="wrap" id="view"></div>
</div>
<script>
const TOOLS=["measure_share_of_voice","get_report","track_citations","sentiment_scan","detect_hallucinations","compare_to_competitor","attribute_ai_traffic","ping"];
const S={report:null,cit:null,sen:null,view:"overview"};
const $=s=>document.querySelector(s);const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const pct=n=>(n*100).toFixed(1)+'%';
function barRow(name,val,alt){const w=Math.round((val||0)*100);return '<div class="row"><div class="name">'+esc(name)+'</div><div class="bar'+(alt?' alt':'')+'"><i style="width:'+w+'%"></i></div><div class="pct">'+pct(val||0)+'</div></div>';}
function sovBars(){const sov=[...S.report.share_of_voice].sort((a,b)=>b.sov-a.sov);const top=sov[0]?.brand;return sov.map(e=>barRow(e.brand+' ('+e.mentions+')',e.sov,e.brand!==top&&e.brand!==S.report.brand)).join('');}

const VIEWS={
 overview(){if(!S.report)return empty();const r=S.report,c=S.cit,s=S.sen;
  const primary=r.share_of_voice.find(e=>e.brand===r.brand);
  const kpi=[['Share of voice',primary?pct(primary.sov):'—','of tracked mentions'],
   ['Mentions',String(primary?primary.mentions:0),'answers naming you'],
   ['Citation share',c?pct(c.your_citation_share):'—',(c?c.your_citations:0)+'/'+(c?c.total_citations:0)+' citations'],
   ['Sentiment',s&&s.sentiment_score!==null?s.sentiment_score.toFixed(2):'—','mean +1/0/-1']];
  const feed=r.answers.slice(0,6).map(a=>'<div class="row feed"><div style="flex:1"><div class="q">'+esc(a.prompt)+'</div><div class="a">'+(a.mentions.map(m=>'<span class="tag'+(m===r.brand?' you':'')+'">'+esc(m)+'</span>').join('')||'<span class="muted">no brands</span>')+'</div></div><span class="tag '+({positive:'pos',negative:'neg',neutral:'neu'}[a.sentiment]||'neu')+'">'+esc(a.sentiment||'n/a')+'</span></div>').join('');
  return '<div class="grid">'+kpi.map(([l,n,d])=>'<div class="card kpi"><div class="n">'+n+'</div><div class="l">'+l+'</div><div class="d muted">'+d+'</div></div>').join('')+'</div>'+
   '<div class="section card"><h3>Share of voice</h3>'+sovBars()+'</div>'+
   '<div class="section card"><h3>Recent AI answers</h3>'+feed+'</div>';},

 citations(){if(!S.cit)return empty();const c=S.cit;
  const share='<div class="section card"><h3>Citation share</h3>'+barRow('Your domains',c.your_citation_share)+barRow('Everyone else',1-(c.your_citation_share||0),true)+'</div>';
  const dom='<div class="section card"><h3>Cited domains</h3><table><thead><tr><th>Domain</th><th>Cites</th><th>Owner</th></tr></thead><tbody>'+(c.by_domain.length?c.by_domain.map(d=>'<tr><td>'+esc(d.domain)+'</td><td>'+d.count+'</td><td>'+(d.is_yours?'<span class="tag you">you</span>':'<span class="muted">competitor/other</span>')+'</td></tr>').join(''):'<tr><td colspan=3 class="muted">none</td></tr>')+'</tbody></table></div>';
  const gap='<div class="section card"><h3>Gap — cited someone else, not you</h3>'+(c.competitor_gap.length?'<table><thead><tr><th>Prompt</th><th>Cited</th></tr></thead><tbody>'+c.competitor_gap.map(g=>'<tr><td>'+esc(g.prompt)+'</td><td class="muted">'+esc(g.cited_domains.join(', '))+'</td></tr>').join('')+'</tbody></table>':'<div class="muted">No gap — every citing answer referenced one of your domains. 🎉</div>')+'</div>';
  return share+dom+gap;},

 competitors(){if(!S.report)return empty();const r=S.report;const you=r.share_of_voice.find(e=>e.brand===r.brand);
  const cards=r.share_of_voice.filter(e=>e.brand!==r.brand).map(e=>{const win=(you?.sov||0)>=e.sov;return '<div class="card"><h3>'+esc(r.brand)+' vs '+esc(e.brand)+'</h3>'+barRow(r.brand,you?.sov||0)+barRow(e.brand,e.sov,true)+'<div class="d muted" style="margin-top:8px">'+(win?'<span class="up">You lead</span>':'<span class="down">They lead</span>')+' on share of voice</div></div>';}).join('');
  return '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">'+cards+'</div>';},

 hallucinations(){if(!S.report)return empty();
  return '<div class="card"><h3>Hallucinations</h3><p class="muted">The demo panel is mocked, so there are no hallucinations to flag. With a real panel, call the <code>detect_hallucinations</code> tool with a <b>facts[]</b> list — it flags false/outdated claims about your brand, the fact each contradicts, and a severity.</p><pre><code>detect_hallucinations({ report_id: "'+esc(S.report.report_id)+'", facts: ["Founded in 2019", "Free tier includes 100 credits"] })</code></pre></div>';},

 connect(){return '<div class="card"><h3>Add to Claude Desktop / Code (stdio)</h3><pre><code>{\\n  "mcpServers": {\\n    "geo-radar": {\\n      "command": "node",\\n      "args": ["/path/to/geo-radar-mcp/apps/mcp-server/dist/index.js"],\\n      "env": { "ANTHROPIC_API_KEY": "sk-ant-...", "GEO_STORE": "memory" }\\n    }\\n  }\\n}</code></pre><h3>Hosted (HTTP)</h3><pre><code>POST '+location.origin+'/mcp    Authorization: Bearer &lt;token&gt;</code></pre><h3>Tools</h3><div>'+TOOLS.map(t=>'<span class="tag">'+t+'</span>').join('')+'</div></div>';},
 guide(){return '<div class="card"><h3>What is an MCP server?</h3>'+
  '<p class="muted">MCP (Model Context Protocol) is a standard that lets an AI app such as Claude call your code and read your data through one interface. Claude is the <b>client</b>; this project is the <b>server</b>. It ships all three MCP capabilities.</p>'+
  '<table><thead><tr><th>Primitive</th><th>What</th><th>Examples here</th><th>Code</th></tr></thead><tbody>'+
  '<tr><td><b>Tools</b></td><td class="muted">actions the AI calls</td><td class="muted">measure_share_of_voice, track_citations, detect_hallucinations</td><td><code>apps/mcp-server/src/tools/</code></td></tr>'+
  '<tr><td><b>Resources</b></td><td class="muted">data the AI reads by URI</td><td class="muted">prompts://library, brand://config, reports://{id}, history://sov</td><td><code>apps/mcp-server/src/resources.ts</code></td></tr>'+
  '<tr><td><b>Prompts</b></td><td class="muted">guided workflows</td><td class="muted">run_full_geo_audit, weekly_sov_report</td><td><code>apps/mcp-server/src/prompts.ts</code></td></tr>'+
  '</tbody></table></div>'+
  '<div class="section card"><h3>What happens when a tool is called</h3><ol class="muted">'+
  '<li>Claude picks a tool and sends an MCP call.</li>'+
  '<li><b>Transport</b> carries it \\u2014 stdio locally, streamable-HTTP when hosted. <code>index.ts</code></li>'+
  '<li><b>Auth</b> (HTTP only) checks a bearer token or OAuth JWT. <code>auth.ts</code></li>'+
  '<li>The SDK <b>validates</b> args against a Zod schema (one source of truth). <code>packages/shared/src/schemas/</code></li>'+
  '<li>The handler runs; a measurement calls the <b>PanelRunner</b>. <code>packages/core/src/runner.ts</code></li>'+
  '<li>Pipeline per prompt x model: <b>panelist</b> (an LLM answers) then <b>parser</b> (an LLM extracts brands/citations/sentiment) then <b>cost gate</b> then <b>scoring</b> then <b>store</b>.</li>'+
  '<li>A structured JSON result returns to Claude.</li></ol></div>'+
  '<div class="section card"><h3>File map</h3><table><tbody>'+
  '<tr><td><code>packages/shared/src/schemas</code></td><td class="muted">Zod schemas = single source of truth for every tool input/output</td></tr>'+
  '<tr><td><code>apps/mcp-server/src/server.ts</code></td><td class="muted">Registers 8 tools + 4 resources + 3 prompts</td></tr>'+
  '<tr><td><code>apps/mcp-server/src/tools/</code></td><td class="muted">One thin file per tool</td></tr>'+
  '<tr><td><code>packages/core/src/runner.ts</code></td><td class="muted">The panel pipeline orchestrator (the heart)</td></tr>'+
  '<tr><td><code>packages/core/src/panelist.ts / parser.ts</code></td><td class="muted">Ask an LLM a question / turn its answer into structured data</td></tr>'+
  '<tr><td><code>packages/core/src/scoring.ts / cost.ts</code></td><td class="muted">Deterministic share-of-voice math + the cost cap</td></tr>'+
  '<tr><td><code>packages/core/src/queue.ts + apps/worker</code></td><td class="muted">Optional Redis/BullMQ scale path</td></tr>'+
  '<tr><td><code>packages/db/src/*</code></td><td class="muted">Postgres tables/queries (Drizzle) + an in-memory store for tests</td></tr>'+
  '</tbody></table></div>';}
};
function empty(){return '<div class="card empty">No audit loaded. Click <b>▶ Run demo audit</b> to populate the dashboard.</div>';}
function render(){$('#view').innerHTML=VIEWS[S.view]();$('#title').textContent=S.view[0].toUpperCase()+S.view.slice(1);
 $('#ctx').textContent=S.report?('Report '+S.report.report_id.slice(0,8)+' · '+S.report.brand+' · '+S.report.answers.length+' answers'):'No audit loaded yet';}
document.querySelectorAll('.nav').forEach(n=>n.onclick=()=>{document.querySelectorAll('.nav').forEach(x=>x.classList.remove('active'));n.classList.add('active');S.view=n.dataset.v;render();});
$('#run').onclick=async()=>{const b=$('#run');b.disabled=true;b.innerHTML='<span class="spin"></span> Running…';
 try{const rep=await (await fetch('./api/audit',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json();
  S.report=rep;S.cit=await (await fetch('./api/citations/'+rep.report_id)).json();S.sen=await (await fetch('./api/sentiment/'+rep.report_id)).json();render();}
 catch(e){$('#view').innerHTML='<div class="card empty">'+esc(e)+'</div>';}
 b.disabled=false;b.textContent='▶ Run demo audit';};
render();
</script></body></html>`;
