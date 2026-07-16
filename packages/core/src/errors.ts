/** A user-facing pipeline error whose message is safe to return to the MCP client. */
export class PanelRunError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "no_prompts"
      | "unknown_panelist"
      | "cost_cap_exceeded"
      | "workload_too_large"
      | "provider_error"
      | "internal",
  ) {
    super(message);
    this.name = "PanelRunError";
  }
}
