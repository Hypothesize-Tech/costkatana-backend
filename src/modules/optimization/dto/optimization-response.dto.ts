import type { DecisionContext } from '../../decision-layer/types/decision-context';

export class OptimizationResultDto {
  id: string;
  userQuery: string;
  generatedAnswer: string;
  improvementPercentage: number;
  costSaved: number;
  tokensSaved: number;
  /** Raw token counts for original and optimized prompts */
  originalTokens?: number;
  optimizedTokens?: number;
  /** Raw cost for original and optimized prompts (USD) */
  originalCost?: number;
  optimizedCost?: number;
  suggestions: any[];
  metadata: any;
  cortexEnabled: boolean;
  cortexProcessingTime?: number;
  cortexSemanticIntegrity?: number;
  cortexTokenReduction?: any;
  cortexImpactMetrics?: any;
  /** True when tokens/cost increased; frontend uses for "Token Increase" / "Cost Increase" labels */
  isIncrease?: boolean;
  /** Network/request tracking (IP, userAgent, performance, etc.) when from frontend */
  requestTracking?: unknown;
  /** Model used for optimization (controller metadata) */
  model?: string;
  /** Service used (controller metadata) */
  service?: string;
  /** Cost savings amount (batch/summary) */
  costSavings?: number;
  /** Percentage savings (batch/summary/preview) */
  percentageSavings?: number;
  /** Token reduction (preview) */
  tokenReduction?: number;
  /** Original prompt (for listing) */
  prompt?: string;
  /** Decision-layer framing when the result itself is actionable */
  decision?: DecisionContext;
  /** Short narrative (headline + story) rendered on the result card */
  narrative?: { headline: string; story: string };
}
