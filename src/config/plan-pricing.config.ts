/**
 * Fallback plan pricing when payment gateway lookup fails.
 * Supports env override: PLAN_PRICE_FREE, PLAN_PRICE_STARTER, PLAN_PRICE_PROFESSIONAL, PLAN_PRICE_ENTERPRISE
 */

export type PlanName = 'free' | 'starter' | 'professional' | 'enterprise';

const DEFAULT_PLAN_PRICES: Record<PlanName, number> = {
  free: 0,
  starter: 29,
  professional: 99,
  enterprise: 299,
};

/**
 * Get plan price or null if plan is unknown (caller should throw NotFoundError).
 * Supports env override: PLAN_PRICE_FREE, PLAN_PRICE_STARTER, PLAN_PRICE_PROFESSIONAL, PLAN_PRICE_ENTERPRISE
 */
export function getPlanPriceOrNull(
  plan: string,
  envOverride?: Record<string, string>,
): number | null {
  const key = plan?.toLowerCase?.();
  if (!key || !plan) return null;
  const env = envOverride ?? process.env;
  const envKey = `PLAN_PRICE_${key.toUpperCase().replace(/-/g, '_')}`;
  const envValue = env[envKey];
  if (envValue != null && envValue !== '') {
    const parsed = parseFloat(envValue);
    if (!Number.isNaN(parsed) && parsed >= 0) return parsed;
  }
  const price = DEFAULT_PLAN_PRICES[key as PlanName];
  return price !== undefined ? price : null;
}
