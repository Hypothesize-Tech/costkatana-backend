import {
  applyAcceptanceMultiplier,
  computeDecisionScore,
} from '../services/scoring';

describe('decision-layer scoring', () => {
  const now = Date.now();
  const recent = new Date(now - 2 * 60 * 60 * 1000); // 2h ago
  const stale = new Date(now - 30 * 24 * 60 * 60 * 1000); // 30d ago

  it('ranks a recent spike above a comparably-sized stale suggestion', () => {
    // The 3× boost for recency+spike is intentional: anything recent+spike
    // that costs the same as a stale item should jump it. We verify the
    // boost outweighs a 2× larger but stale item. A 3× stale item ties
    // by design — see note in scoring.ts.
    const spike = computeDecisionScore({
      priority: 'high',
      impactUsd: 40,
      createdAt: recent,
      confidence: 0.8,
      reason: 'cost_spike',
    });
    const staleDouble = computeDecisionScore({
      priority: 'high',
      impactUsd: 80,
      createdAt: stale,
      confidence: 0.8,
      reason: 'model_overspend',
    });
    expect(spike).toBeGreaterThan(staleDouble);
  });

  it('respects priority ordering when timing is held constant', () => {
    const critical = computeDecisionScore({
      priority: 'critical',
      impactUsd: 50,
      createdAt: recent,
      confidence: 0.7,
      reason: 'periodic_review',
    });
    const low = computeDecisionScore({
      priority: 'low',
      impactUsd: 50,
      createdAt: recent,
      confidence: 0.7,
      reason: 'periodic_review',
    });
    expect(critical).toBeGreaterThan(low);
  });

  it('tempers low-acceptance users so noise decays', () => {
    const raw = 100;
    const highAcceptance = applyAcceptanceMultiplier(raw, 0.9);
    const lowAcceptance = applyAcceptanceMultiplier(raw, 0.1);
    expect(highAcceptance).toBeGreaterThan(lowAcceptance);
  });

  it('clamps extreme acceptance rates to sane bounds', () => {
    const raw = 100;
    const clampedHigh = applyAcceptanceMultiplier(raw, 5);
    const clampedLow = applyAcceptanceMultiplier(raw, -1);
    // Max multiplier = 0.6 + 1 * 0.8 = 1.4
    expect(clampedHigh).toBeCloseTo(raw * 1.4, 5);
    // Min multiplier = 0.6 + 0 * 0.8 = 0.6
    expect(clampedLow).toBeCloseTo(raw * 0.6, 5);
  });

  it('applies spike and budget-pacing boost equally', () => {
    const spike = computeDecisionScore({
      priority: 'high',
      impactUsd: 30,
      createdAt: recent,
      confidence: 0.7,
      reason: 'cost_spike',
    });
    const pacing = computeDecisionScore({
      priority: 'high',
      impactUsd: 30,
      createdAt: recent,
      confidence: 0.7,
      reason: 'budget_pacing',
    });
    expect(spike).toBeCloseTo(pacing, 5);
  });

  it('is a pure function — same inputs → same score', () => {
    const inputs = {
      priority: 'medium' as const,
      impactUsd: 25,
      createdAt: recent,
      confidence: 0.6,
      reason: 'caching_opportunity' as const,
    };
    expect(computeDecisionScore(inputs)).toEqual(
      computeDecisionScore(inputs),
    );
  });
});
