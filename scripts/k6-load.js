// k6 load test for the GEO Radar MCP HTTP tier.
//   BASE_URL=http://localhost:8080 MCP_API_KEY=secret k6 run scripts/k6-load.js
import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const API_KEY = __ENV.MCP_API_KEY || "";

export const options = {
  stages: [
    { duration: "20s", target: 20 }, // ramp up
    { duration: "40s", target: 20 }, // hold
    { duration: "10s", target: 0 }, // ramp down
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"], // <1% errors
    http_req_duration: ["p(95)<800"], // p95 under 800ms (healthz + init are cheap)
  },
};

const mcpHeaders = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  ...(API_KEY ? { authorization: `Bearer ${API_KEY}` } : {}),
};

function rpc(id, method, params) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params: params || {} });
}

export default function () {
  // 1. Liveness
  const health = http.get(`${BASE_URL}/healthz`);
  check(health, { "healthz 200": (r) => r.status === 200 });

  // 2. MCP initialize (stateless — no session reuse needed)
  const init = http.post(
    `${BASE_URL}/mcp`,
    rpc(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "k6", version: "0" },
    }),
    { headers: mcpHeaders },
  );
  check(init, { "initialize ok": (r) => r.status === 200 && r.body.includes("serverInfo") });

  // 3. tools/list
  const tools = http.post(`${BASE_URL}/mcp`, rpc(2, "tools/list"), { headers: mcpHeaders });
  check(tools, { "tools/list ok": (r) => r.status === 200 && r.body.includes("measure_share_of_voice") });

  sleep(1);
}
