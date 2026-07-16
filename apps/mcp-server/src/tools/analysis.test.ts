import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MemoryStore } from "@geo-radar/db";
import { InProcessPanelRunner } from "@geo-radar/core";
import { createServer } from "../server";
import type { ServerRuntime } from "../runtime";

async function connect() {
  const store = new MemoryStore();
  const runtime: ServerRuntime = {
    store,
    runner: new InProcessPanelRunner(store, { costCapUsd: 1, forceMock: true }),
  };
  const server = createServer(runtime);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { server, client };
}

async function makeReport(client: Client): Promise<string> {
  const res = await client.callTool({
    name: "measure_share_of_voice",
    arguments: { brand: "PixelBin", competitors: ["Photoroom", "Remove.bg"], prompt_set_id: "demo", brand_domains: ["pixelbin.io"] },
  });
  return (res.structuredContent as { report_id: string }).report_id;
}

describe("P3/P4 tools, resources, prompts (mock)", () => {
  it("exposes all three MCP primitives", async () => {
    const { server, client } = await connect();
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(
      expect.arrayContaining([
        "ping",
        "measure_share_of_voice",
        "get_report",
        "track_citations",
        "sentiment_scan",
        "detect_hallucinations",
        "compare_to_competitor",
      ]),
    );
    const resources = (await client.listResources()).resources.map((r) => r.uri);
    expect(resources).toEqual(expect.arrayContaining(["prompts://library", "brand://config"]));
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
    expect(prompts).toEqual(
      expect.arrayContaining(["run_full_geo_audit", "draft_reputation_defense_brief", "weekly_sov_report"]),
    );
    await client.close();
    await server.close();
  });

  it("track_citations + sentiment_scan analyze a stored report", async () => {
    const { server, client } = await connect();
    const reportId = await makeReport(client);

    const cite = await client.callTool({ name: "track_citations", arguments: { report_id: reportId } });
    expect(cite.isError).toBeFalsy();
    const c = cite.structuredContent as { total_citations: number; your_citation_share: number };
    expect(c.total_citations).toBeGreaterThan(0);
    expect(c.your_citation_share).toBeGreaterThanOrEqual(0);

    const sent = await client.callTool({ name: "sentiment_scan", arguments: { report_id: reportId } });
    expect(sent.isError).toBeFalsy();
    const s = sent.structuredContent as {
      distribution: { positive: number; neutral: number; negative: number };
    };
    expect(s.distribution.positive + s.distribution.neutral + s.distribution.negative).toBe(4);

    await client.close();
    await server.close();
  });

  it("detect_hallucinations returns checked count (mock → no flags)", async () => {
    const { server, client } = await connect();
    const reportId = await makeReport(client);
    const res = await client.callTool({
      name: "detect_hallucinations",
      arguments: { report_id: reportId, facts: ["PixelBin was founded in 2019."] },
    });
    expect(res.isError).toBeFalsy();
    const h = res.structuredContent as { checked_answers: number; flagged: unknown[] };
    expect(h.checked_answers).toBe(4);
    expect(Array.isArray(h.flagged)).toBe(true);
    await client.close();
    await server.close();
  });

  it("compare_to_competitor runs a head-to-head", async () => {
    const { server, client } = await connect();
    const res = await client.callTool({
      name: "compare_to_competitor",
      arguments: { brand_a: "PixelBin", brand_b: "Photoroom", prompt_set_id: "demo" },
    });
    expect(res.isError).toBeFalsy();
    const cmp = res.structuredContent as { share_of_voice: unknown[]; winner: string | null };
    expect(cmp.share_of_voice).toHaveLength(2);
    await client.close();
    await server.close();
  });

  it("reads prompts://library and a reports://{id} resource", async () => {
    const { server, client } = await connect();
    const reportId = await makeReport(client);

    const lib = await client.readResource({ uri: "prompts://library" });
    const libText = (lib.contents[0] as { text: string }).text;
    expect(JSON.parse(libText).some((s: { id: string }) => s.id === "demo")).toBe(true);

    const rep = await client.readResource({ uri: `reports://${reportId}` });
    const repText = (rep.contents[0] as { text: string }).text;
    expect(JSON.parse(repText).status).toBe("completed");

    await client.close();
    await server.close();
  });

  it("expands the run_full_geo_audit prompt", async () => {
    const { server, client } = await connect();
    const p = await client.getPrompt({
      name: "run_full_geo_audit",
      arguments: { brand: "PixelBin", competitors: "Photoroom,Remove.bg" },
    });
    const text = p.messages[0]!.content.type === "text" ? p.messages[0]!.content.text : "";
    expect(text).toContain("measure_share_of_voice");
    expect(text).toContain("track_citations");
    await client.close();
    await server.close();
  });
});
