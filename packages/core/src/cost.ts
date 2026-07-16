import { MODEL_PRICING } from "./models";
import type { TokenUsage } from "./panelist";

/**
 * Tracks cumulative USD spend for a panel run and enforces a hard cap. Mock
 * models (not in MODEL_PRICING) contribute $0, so offline runs never trip the cap.
 */
export class CostMeter {
  private spentUsd = 0;

  constructor(private readonly capUsd: number) {}

  /** Would spending `estimateUsd` more push us over the cap? Check this BEFORE each call. */
  wouldExceed(estimateUsd: number): boolean {
    return this.spentUsd + estimateUsd > this.capUsd;
  }

  add(modelId: string, usage: TokenUsage): void {
    const pricing = MODEL_PRICING[modelId];
    if (!pricing) return; // unknown / mock model → no cost
    this.spentUsd +=
      (usage.inputTokens / 1_000_000) * pricing.inputPerM +
      (usage.outputTokens / 1_000_000) * pricing.outputPerM;
  }

  get total(): number {
    return this.spentUsd;
  }

  get cap(): number {
    return this.capUsd;
  }
}
