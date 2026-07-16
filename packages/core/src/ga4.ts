import { BetaAnalyticsDataClient } from "@google-analytics/data";
import type { AttributeAiTrafficInput, AttributeAiTrafficOutput } from "@geo-radar/shared";
import { PanelRunError } from "./errors";

/** Hostname fragments → the AI engine we attribute them to. */
const AI_ENGINES: { match: string; engine: string }[] = [
  { match: "chatgpt.com", engine: "ChatGPT" },
  { match: "chat.openai.com", engine: "ChatGPT" },
  { match: "openai.com", engine: "ChatGPT" },
  { match: "perplexity.ai", engine: "Perplexity" },
  { match: "gemini.google.com", engine: "Gemini" },
  { match: "bard.google.com", engine: "Gemini" },
  { match: "claude.ai", engine: "Claude" },
  { match: "copilot.microsoft.com", engine: "Copilot" },
  { match: "bing.com/chat", engine: "Copilot" },
  { match: "you.com", engine: "You.com" },
];

function classify(source: string): string | null {
  const s = source.toLowerCase();
  for (const { match, engine } of AI_ENGINES) if (s.includes(match)) return engine;
  return null;
}

function makeClient(): BetaAnalyticsDataClient {
  const raw = process.env.GA4_SERVICE_ACCOUNT_JSON;
  if (raw) {
    const credentials = JSON.parse(raw) as { client_email: string; private_key: string };
    return new BetaAnalyticsDataClient({ credentials });
  }
  // Falls back to Application Default Credentials (ADC).
  return new BetaAnalyticsDataClient();
}

/**
 * Attribute referral sessions/conversions arriving from AI-engine hostnames —
 * the "AI visibility → funnel" bridge. Requires a GA4 property + credentials.
 */
export async function attributeAiTraffic(
  input: AttributeAiTrafficInput,
): Promise<AttributeAiTrafficOutput> {
  const propertyId = input.ga4_property_id ?? process.env.GA4_PROPERTY_ID;
  if (!propertyId) {
    throw new PanelRunError(
      "GA4 not configured: set GA4_PROPERTY_ID (and GA4_SERVICE_ACCOUNT_JSON or ADC).",
      "provider_error",
    );
  }
  const start = input.start_date ?? "28daysAgo";
  const end = input.end_date ?? "today";

  const client = makeClient();
  const [resp] = await client.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate: start, endDate: end }],
    dimensions: [{ name: "sessionSource" }],
    metrics: [{ name: "sessions" }, { name: "conversions" }],
    limit: 250,
  });

  const rows: AttributeAiTrafficOutput["by_engine"] = [];
  let totalSessions = 0;
  let totalConversions = 0;
  for (const row of resp.rows ?? []) {
    const source = row.dimensionValues?.[0]?.value ?? "";
    const engine = classify(source);
    if (!engine) continue;
    const sessions = Number(row.metricValues?.[0]?.value ?? 0);
    const conversions = Number(row.metricValues?.[1]?.value ?? 0);
    rows.push({ engine, source, sessions, conversions });
    totalSessions += sessions;
    totalConversions += conversions;
  }
  rows.sort((a, b) => b.sessions - a.sessions);

  return {
    property_id: propertyId,
    date_range: { start, end },
    by_engine: rows,
    total_ai_sessions: totalSessions,
    total_ai_conversions: totalConversions,
  };
}
