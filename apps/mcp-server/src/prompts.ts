import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const userMessage = (text: string) => ({
  messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
});

/** Registers the MCP prompts (guided multi-tool workflows the agent can invoke). */
export function registerPrompts(server: McpServer): void {
  // run_full_geo_audit — orchestrate the full measurement + analysis
  server.registerPrompt(
    "run_full_geo_audit",
    {
      title: "Run full GEO audit",
      description: "Guided end-to-end GEO audit for a brand across the tool suite.",
      argsSchema: {
        brand: z.string().describe("The brand to audit."),
        competitors: z.string().describe("Comma-separated competitor names."),
        prompt_set_id: z.string().optional().describe("Optional built-in prompt set id (e.g. demo)."),
      },
    },
    ({ brand, competitors, prompt_set_id }) =>
      userMessage(
        `Run a full GEO audit for "${brand}" vs competitors [${competitors}].\n` +
          `1. Call measure_share_of_voice (brand="${brand}", competitors=[${competitors}]` +
          `${prompt_set_id ? `, prompt_set_id="${prompt_set_id}"` : ", with a set of buyer-intent prompts"}) and keep the report_id.\n` +
          `2. Call track_citations with that report_id.\n` +
          `3. Call sentiment_scan with that report_id.\n` +
          `4. If the user supplied ground-truth facts, call detect_hallucinations with that report_id and the facts.\n` +
          `5. Summarize: share of voice, where competitors are cited instead of us, sentiment, and any hallucinations — with concrete GEO recommendations.`,
      ),
  );

  // draft_reputation_defense_brief — for a detected hallucination
  server.registerPrompt(
    "draft_reputation_defense_brief",
    {
      title: "Draft reputation-defense brief",
      description: "Draft a correction brief for a false/outdated claim an AI made about the brand.",
      argsSchema: {
        brand: z.string().describe("The brand."),
        claim: z.string().describe("The false/outdated claim the AI stated."),
        fact: z.string().describe("The ground-truth fact it contradicts."),
      },
    },
    ({ brand, claim, fact }) =>
      userMessage(
        `An AI assistant stated a false/outdated claim about "${brand}":\n` +
          `CLAIM: "${claim}"\nTRUTH: "${fact}"\n\n` +
          `Draft a concise reputation-defense brief: (1) the correction, (2) 2-3 authoritative sources/pages we should publish or update so AI answers cite the correct fact, (3) a suggested FAQ/schema snippet, and (4) a one-line outreach note. Keep it factual and non-defensive.`,
      ),
  );

  // weekly_sov_report — summarize the trend
  server.registerPrompt(
    "weekly_sov_report",
    {
      title: "Weekly SoV report",
      description: "Summarize a brand's share-of-voice trend for the week.",
      argsSchema: {
        brand: z.string().describe("The brand."),
      },
    },
    ({ brand }) =>
      userMessage(
        `Produce a weekly GEO share-of-voice report for "${brand}".\n` +
          `1. Read the resource history://sov?brand=${encodeURIComponent(brand)}&range=7d for the trend.\n` +
          `2. Read brand://config for the competitor set.\n` +
          `3. Summarize: current SoV, week-over-week change, notable competitor movements, and 2-3 recommended actions.`,
      ),
  );
}
