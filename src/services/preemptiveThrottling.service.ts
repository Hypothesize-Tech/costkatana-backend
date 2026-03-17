/**
 * Bridge: Re-exports PreemptiveThrottlingService for legacy Express middleware.
 * For NestJS usage, inject PreemptiveThrottlingService from CommonModule.
 */
export {
  PreemptiveThrottlingService,
  type ThrottlingPhase,
  type ThrottlingAction,
} from '../common/services/preemptive-throttling.service';

// Lazy singleton for legacy Express middleware (no Nest DI context)
let _instance: InstanceType<
  typeof import('../common/services/preemptive-throttling.service').PreemptiveThrottlingService
> | null = null;

export function getPreemptiveThrottlingInstance() {
  return _instance;
}

export function setPreemptiveThrottlingInstance(
  instance: InstanceType<
    typeof import('../common/services/preemptive-throttling.service').PreemptiveThrottlingService
  >,
) {
  _instance = instance;
}

// Stub for legacy middleware - methods no-op when not injected
export const preemptiveThrottlingService = {
  checkThrottling: async (_metadata?: unknown) => ({
    allowed: true,
    phase: 'normal' as const,
    action: 'monitor' as const,
    throttling_factor: 1,
    delay_ms: 0,
    retry_after: undefined as number | undefined,
    warning_message: undefined as string | undefined,
    metrics: {} as Record<string, unknown>,
    reasons: [] as string[],
  }),
  getStatus: () => ({
    phase: 'normal' as const,
    action: 'monitor' as const,
    throttlingFactor: 1,
    throttling_factor: 1,
    phase_duration: 0,
    timestamp: Date.now(),
  }),
  forcePhaseChange: async (_phase?: string, _reason?: string) => {},
};
