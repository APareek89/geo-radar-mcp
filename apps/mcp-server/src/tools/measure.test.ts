import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MemoryStore } from "@geo-radar/db";
import { InProcessPanelRunner, ALLOW_ALL_QUOTA, type QuotaEnforcer } from "@geo-radar/core";
import { createServer } from "../server";
import type { ServerRuntime } from "../runtime";

function mockRuntime(quota: QuotaEnforcer = ALLOW_ALL_QUOTA): ServerRuntime {
  const store = new MemoryStore();
  const runner = new InProcessPanelRunner(store, { costCapUsd: 1, forceMock: true });
  return { store, runner, quota };
}

async function connect(runtime: ServerRuntime) {
  const server = createServer(runtime);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { server, client };
}

describe("measure_share_of_voice + get_report (mock pipeline)", () => {
  it("lists the tools and returns a share-of-voice report, retrievable via get_report", async () => {
    const { server, client } = await connect(mockRuntime());

    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["ping", "measure_share_of_voice", "get_report"]));

    const measured = await client.callTool({
      name: "measure_share_of_voice",
      arguments: {
        brand: "PixelBin",
        competitors: ["Photoroom", "Remove.bg"],
        prompt_set_id: "demo",
        panel: ["haiku"],
      },
    });
    expect(measured.isError).toBeFalsy();
    const report = measured.structuredContent as Record<string, unknown>;
    expect(report.status).toBe("completed");
    expect(report.answer_count).toBe(4);
    const reportId = report.report_id as string;
    expect(reportId).toBeTruthy();

    const fetched = await client.callTool({
      name: "get_report",
      arguments: { report_id: reportId },
    });
    expect(fetched.isError).toBeFalsy();
    const full = fetched.structuredContent as Record<string, unknown>;
    expect(full.status).toBe("completed");
    expect((full.answers as unknown[]).length).toBe(4);

    await client.close();
    await server.close();
  });

  it("returns a tool error (not a crash) for an unknown report_id", async () => {
    const { server, client } = await connect(mockRuntime());
    const res = await client.callTool({
      name: "get_report",
      arguments: { report_id: "does-not-exist" },
    });
    expect(res.isError).toBe(true);
    await client.close();
    await server.close();
  });

  it("accepts a multi-provider panel (gemini/groq run as mock without keys)", async () => {
    const { server, client } = await connect(mockRuntime());
    const res = await client.callTool({
      name: "measure_share_of_voice",
      arguments: { brand: "A", competitors: ["B"], prompts: ["x"], panel: ["haiku", "gemini"] },
    });
    expect(res.isError).toBeFalsy();
    expect((res.structuredContent as { answer_count: number }).answer_count).toBe(2);
    await client.close();
    await server.close();
  });

  it("blocks the run (no spend) when the per-user quota is exhausted", async () => {
    const denyQuota = {
      check: async () => ({ allowed: false, reason: "user" as const, remainingUser: 0 }),
      close: async () => {},
    };
    const { server, client } = await connect(mockRuntime(denyQuota));
    const res = await client.callTool({
      name: "measure_share_of_voice",
      arguments: { brand: "A", competitors: ["B"], prompts: ["x"], panel: ["haiku"] },
    });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toMatch(/daily run limit/i);
    await client.close();
    await server.close();
  });
});
