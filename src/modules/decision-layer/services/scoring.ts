import type { TriggerReason } from '../types/decision-context';

export interface ScoreInputs {
  priority: 'low' | 'medium' | 'high' | 'critical';
  impactUsd: number;
  createdAt: Date;
  confidence: number;
  reason: TriggerReason;
}

const PRIORITY_WEIGHT: Record<ScoreInputs['priority'], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Pure scoring function so the decision-ranking behavior can be unit tested
 * without standing up the full Nest module graph.
 *
 * The formula mirrors Vatsala's "frame importance, don't just calculate it":
 *   raw priority  ×  how recent the signal is  ×  whether it's spike-driven
 *                 ×  confidence  ×  normalized weekly-equivalent savings
 */
export function computeDecisionScore(input: ScoreInputs): number {
  const ageHours =
    (Date.now() - new Date(input.createdAt).getTime()) / (60 * 60 * 1000);
  const recencyBoost = ageHours < 24 ? 2.0 : ageHours < 168 ? 1.5 : 1.0;
  const spikeBoost =
    input.reason === 'cost_spike' || input.reason === 'budget_pacing'
      ? 1.5
      : 1.0;
  const confidenceMultiplier = Math.max(
    0.5,
    Math.min(1.2, 0.5 + input.confidence * 0.7),
  );
  return (
    PRIORITY_WEIGHT[input.priority] *
    recencyBoost *
    spikeBoost *
    confidenceMultiplier *
    Math.max(1, input.impactUsd / 4.33)
  );
}

/**
 * Applies the per-user acceptance-rate multiplier produced by the feedback
 * loop. High-acceptance users see more aggressive ranking; chronic
 * dismissers see suppressed scores so noise decays over time.
 */
export function applyAcceptanceMultiplier(
  score: number,
  acceptanceRate: number,
): number {
  const multiplier = 0.6 + Math.max(0, Math.min(1, acceptanceRate)) * 0.8;
  return score * multiplier;
}
