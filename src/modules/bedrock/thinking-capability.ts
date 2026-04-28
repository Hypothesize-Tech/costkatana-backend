/**
 * Thinking (Extended Reasoning) capability registry for Claude on Bedrock.
 *
 * Bedrock exposes two reasoning modes:
 *   - 'adaptive' — Claude decides how much to think. Config:
 *       { thinking: { type: 'adaptive', effort: 'low'|'medium'|'high'|'max' } }
 *     Supported on Opus 4.6 / 4.7 and Sonnet 4.6.
 *   - 'enabled'  — fixed token budget. Config:
 *       { thinking: { type: 'enabled', budget_tokens: N } }
 *     Supported on Sonnet 3.7 / 4 / 4.5 and Opus 4 / 4.1.
 */

export type ThinkingCapability = 'adaptive' | 'enabled' | 'none';
export type ThinkingEffort = 'low' | 'medium' | 'high' | 'max';

export interface ThinkingOptions {
  enabled: boolean;
  effort?: ThinkingEffort;
  budgetTokens?: number;
}

const ADAPTIVE_SUBSTRINGS = [
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
];

const ENABLED_SUBSTRINGS = [
  'claude-sonnet-4-5',
  'claude-opus-4-5',
  'claude-opus-4-1',
  'claude-sonnet-4',
  'claude-opus-4',
  'claude-3-7-sonnet',
];

export function getThinkingCapability(modelId: string): ThinkingCapability {
  if (!modelId) return 'none';
  const id = modelId.toLowerCase();
  if (ADAPTIVE_SUBSTRINGS.some((s) => id.includes(s))) return 'adaptive';
  // Order matters: check adaptive first so opus-4-6 isn't matched by opus-4.
  if (ENABLED_SUBSTRINGS.some((s) => id.includes(s))) return 'enabled';
  return 'none';
}

export function supportsThinking(modelId: string): boolean {
  return getThinkingCapability(modelId) !== 'none';
}

export function defaultBudgetForModel(modelId: string): number {
  const cap = getThinkingCapability(modelId);
  if (cap !== 'enabled') return 0;
  if (modelId.includes('opus')) return 8000;
  return 4000;
}

/**
 * Dynamically compute a sensible thinking budget based on the prompt and the
 * model's output pricing. Thinking tokens are billed as output tokens, so a
 * wider budget on an expensive model costs dramatically more than on a cheap
 * one. We scale budget inversely with the model's output price.
 *
 * Heuristic:
 *   1. Base budget scales with input-token estimate (~2× input).
 *   2. Boost when the prompt contains planning/reasoning cues.
 *   3. Price-aware scale factor: inverse-proportional to $/1M output tokens.
 *      Anchor the cheap end at $3/1M (~Sonnet 4.x) with factor 1.0; a model
 *      at $15/1M (Opus 4.x) gets factor 0.6, capping runaway cost.
 *   4. Clamp to [2000, min(24000, modelMaxTokens − 1024)] so the response
 *      always has room and a single burst can't eclipse the answer budget.
 *
 * @param modelId           Bedrock model id (e.g. anthropic.claude-sonnet-4-5-…).
 * @param prompt            The user prompt text (used for length + cue heuristic).
 * @param modelMaxTokens    Max_tokens cap for this model (per bedrock service).
 * @param outputPricePer1M  Optional $/1M output-token price. Pass from caller
 *                          (BedrockService resolves via the pricing registry).
 */
export function computeDynamicBudget(
  modelId: string,
  prompt: string,
  modelMaxTokens: number,
  outputPricePer1M?: number,
): number {
  const cap = getThinkingCapability(modelId);
  if (cap !== 'enabled') return 0;

  const approxInputTokens = Math.max(100, Math.ceil((prompt?.length || 0) / 4));
  let budget = Math.round(approxInputTokens * 2);

  const lowered = (prompt || '').toLowerCase();
  const reasoningCues = [
    'plan',
    'design',
    'architect',
    'prove',
    'derive',
    'optimize',
    'analyze',
    'compare',
    'evaluate',
    'trade-off',
    'why',
    'reason',
    'debug',
    'investigate',
    'strategy',
  ];
  const cueHits = reasoningCues.filter((cue) => lowered.includes(cue)).length;
  if (cueHits > 0) {
    budget = Math.round(budget * (1 + Math.min(cueHits, 4) * 0.25));
  }

  // Price-aware scaling: thinking tokens bill as output, so scale budget
  // inversely with output price. Anchor at $3/1M (=Sonnet 4.x list price).
  if (typeof outputPricePer1M === 'number' && outputPricePer1M > 0) {
    const anchor = 3;
    const scale = Math.max(0.25, Math.min(1.5, anchor / outputPricePer1M));
    budget = Math.round(budget * scale);
  }

  const floor = 2000;
  const hardCap = 24000;
  const ceiling = Math.max(floor + 512, Math.min(hardCap, modelMaxTokens - 1024));
  return Math.max(floor, Math.min(budget, ceiling));
}
