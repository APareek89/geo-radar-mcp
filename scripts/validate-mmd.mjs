#!/usr/bin/env node
// validate-mmd.mjs — check that every .mmd file parses.
// Deep check: uses Mermaid's own parser (needs `mermaid` + `jsdom`). It tries the project's
// node_modules first, then a one-off temp install; if neither works (offline/proxy) it falls
// back to a lightweight STRUCTURAL lint so you still get a signal.
// Usage:  node validate-mmd.mjs <mmdDir>
import { readdirSync, readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const mmdDir = process.argv[2] || "docs/mermaid";
const files = readdirSync(mmdDir).filter((f) => f.endsWith(".mmd")).sort();
if (!files.length) { console.error(`no .mmd files in ${mmdDir}`); process.exit(1); }

// ---- structural lint (always available, no deps) ----
const DIAGRAM_KEYWORDS = /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|mindmap|timeline|gitGraph|quadrantChart|xychart)/;
function structuralLint(code) {
  const problems = [];
  const firstReal = code.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("%%"));
  if (!firstReal || !DIAGRAM_KEYWORDS.test(firstReal)) problems.push("does not start with a diagram type (flowchart/graph/…)");
  const q = (code.match(/"/g) || []).length;
  if (q % 2 !== 0) problems.push("odd number of double-quotes (an unclosed label?)");
  return problems;
}

// ---- try to load mermaid + jsdom for the deep parse ----
// ORDER MATTERS: set up the JSDOM window/document BEFORE importing mermaid — mermaid initialises
// DOMPurify against the global window at import time, and fails ("DOMPurify.sanitize is not a
// function") if the DOM isn't there yet.
async function loadDeps(resolveFromDir) {
  const req = createRequire(join(resolveFromDir, "x.js"));
  const { JSDOM } = await import(pathToFileURL(req.resolve("jsdom")));
  const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  try { Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true }); } catch {}
  const mermaid = (await import(pathToFileURL(req.resolve("mermaid")))).default; // AFTER the DOM globals
  mermaid.initialize({ startOnLoad: false, securityLevel: "loose" });
  return { mermaid };
}
async function getDeps() {
  try { return await loadDeps(process.cwd()); } catch {}
  try {
    const tmp = mkdtempSync(join(tmpdir(), "mmv-"));
    writeFileSync(join(tmp, "package.json"), "{}");
    console.log("installing mermaid + jsdom for validation (one-off)…");
    execSync("npm install mermaid@11 jsdom --no-audit --no-fund --loglevel=error", { cwd: tmp, stdio: "ignore" });
    return await loadDeps(tmp);
  } catch { return null; }
}

const deps = await getDeps();
let bad = 0;

if (deps) {
  for (const f of files) {
    try { await deps.mermaid.parse(readFileSync(join(mmdDir, f), "utf8")); console.log(`  ✓ ${f}`); }
    catch (e) { bad++; console.log(`  ✗ ${f} → ${String(e.message || e).split("\n")[0]}`); }
  }
} else {
  console.log("(deep parse unavailable — running structural lint only; open the HTML viewer to confirm rendering)");
  for (const f of files) {
    const problems = structuralLint(readFileSync(join(mmdDir, f), "utf8"));
    if (problems.length) { bad++; console.log(`  ✗ ${f} → ${problems.join("; ")}`); }
    else console.log(`  ✓ ${f} (structural)`);
  }
}

console.log(`\n${files.length - bad}/${files.length} ok`);
process.exit(bad ? 1 : 0);
