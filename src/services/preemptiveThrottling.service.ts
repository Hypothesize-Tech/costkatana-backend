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

// Proxy for legacy middleware - delegates to real instance when wired
type PreemptiveThrottlingInstance = InstanceType<
  typeof import('../common/services/preemptive-throttling.service').PreemptiveThrottlingService
>;

const fallbackCheckThrottling = async () => ({
  allowed: true,
  phase: 'normal' as const,
  action: 'monitor' as const,
  throttling_factor: 1,
  delay_ms: 0,
  retry_after: undefined as number | undefined,
  warning_message: undefined as string | undefined,
  metrics: {} as Record<string, unknown>,
  reasons: [] as string[],
});

const fallbackGetStatus = () => ({
  phase: 'normal' as const,
  action: 'monitor' as const,
  throttlingFactor: 1,
  throttling_factor: 1,
  phase_duration: 0,
  timestamp: Date.now(),
});

function adaptStatus(realStatus: {
  current_phase: string;
  current_action: string;
  throttling_factor: number;
  phase_start_time: number;
  [key: string]: unknown;
}) {
  return {
    phase: realStatus.current_phase,
    action: realStatus.current_action,
    throttlingFactor: realStatus.throttling_factor,
    throttling_factor: realStatus.throttling_factor,
    phase_duration: Date.now() - realStatus.phase_start_time,
    timestamp: Date.now(),
    ...realStatus,
  };
}

export const preemptiveThrottlingService = {
  checkThrottling: async (metadata?: unknown) =>
    _instance
      ? _instance.checkRequest(
          metadata as {
            userId?: string;
            priority?: 'low' | 'normal' | 'high' | 'critical';
            endpoint?: string;
            method?: string;
          },
        )
      : fallbackCheckThrottling(),
  getStatus: () =>
    _instance ? adaptStatus(_instance.getStatus()) : fallbackGetStatus(),
  forcePhaseChange: async (phase?: string, reason?: string) => {
    if (!_instance) return;
    if (phase === 'normal') {
      _instance.reset();
    }
    // Real service doesn't support forcing arbitrary phases; reset() clears to normal
  },
};
