import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server";

/**
 * Contract test: drive the real server through a linked in-memory transport with a
 * real MCP client — exactly how Claude would call it, minus the OS pipe. This is the
 * seed of the tool-call eval suite the PRD's definition-of-done asks for.
 */
describe("ping tool", () => {
  it("lists ping and echoes the message with server identity", async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name)).toContain("ping");

    const res = await client.callTool({
      name: "ping",
      arguments: { message: "hello" },
    });

    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({
      ok: true,
      echo: "hello",
      server: "geo-radar-mcp",
    });

    await client.close();
    await server.close();
  });

  it("defaults the echo to \"pong\" when no message is given", async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const res = await client.callTool({ name: "ping", arguments: {} });
    expect(res.structuredContent).toMatchObject({ ok: true, echo: "pong" });

    await client.close();
    await server.close();
  });
});
