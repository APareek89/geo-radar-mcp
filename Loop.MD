# Loop.MD — GEO Radar MCP
status: off
# (User chose to run evals manually — they'll say when. Re-offer only if asked.)

> AGENT INSTRUCTION — read every session and obey:
> - While `status: waiting_for_first_draft`: the moment the first working draft exists
>   (core path runs end-to-end once — demo-able, not just compiling), ASK the user:
>   "First draft is working. Want me to turn on the Loop? I'll run every eval below
>   after each change, show per-eval pass/fail, and keep finetuning until they pass."
>   Set `status: offered` when asked; `on` or `off` per the answer. Re-ask an
>   unanswered `offered` once at next session start.
> - While `status: on`: after each meaningful change run cheapest checks first
>   (typecheck/tests), then execute EVERY eval below for real (run the app — never
>   predict from code), report a per-eval ✅/❌ table including regressions, fix, repeat.
> - Paid/slow checks: write a one-line hypothesis in the run journal BEFORE running;
>   reproduce failures as free checks; one paid confirmation per hypothesis.

## Goal
A production-grade MCP server that measures a brand's AI share-of-voice, citations,
sentiment, and hallucinations across a panel of cheap LLMs — returning trustworthy,
reproducible reports via MCP tools/resources/prompts. "Done" = all 3 MCP primitives,
stdio + HTTP, JSON Schema 2020-12 per tool, async `report_id` pattern, cost cap enforced,
and a seeded demo anyone can try in 60 seconds.

## Evals
<USER: replace/extend these EXAMPLES with your real questions and expected answers.
These are the yardstick the loop finetunes against.>

| # | Input (question / action / call) | Expected (answer / behavior / output) |
|---|----------------------------------|----------------------------------------|
| 1 | (EXAMPLE) Call `ping` with `{message:"hi"}` | `{ok:true, echo:"hi", server:"geo-radar-mcp", version, timestamp}`; `ping` appears in `tools/list` |
| 2 | (EXAMPLE) `measure_share_of_voice` with brand + 2 competitors + 3 prompts, panel=[haiku] | Returns a `report_id` immediately; `get_report(report_id)` yields SoV per brand + per-prompt breakdown, SoV values in [0,1] summing sensibly |
| 3 | (EXAMPLE) Parse an answer mentioning the brand once and a competitor twice | Extracted `mentions` reflect 1 vs 2; SoV for the brand < the competitor for that prompt |
| 4 | (EXAMPLE) `detect_hallucinations` with fact "founded in 2019" vs an answer claiming "founded in 2010" | Flags the contradiction, names which fact it contradicts, assigns a severity |
| 5 | (EXAMPLE — negative) `measure_share_of_voice` with no panelist key configured | Clear, structured error; server stays up; nothing spent |
| 6 | (EXAMPLE — guardrail) A run projected to exceed `PANEL_COST_CAP_USD_PER_RUN` | Aborts before spending; returns a cost-cap error |

## Run journal (paid/slow checks only)
| Date | Hypothesis (changed X, expect eval N to flip because W) | Result |
|------|----------------------------------------------------------|--------|
