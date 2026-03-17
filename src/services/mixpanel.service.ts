/**
 * Bridge: Re-exports MixpanelService for legacy Express middleware.
 * For NestJS usage, inject MixpanelService from CommonModule.
 */
export { MixpanelService } from '../common/services/mixpanel.service';

// Stub for legacy middleware - no-op when not injected
export const mixpanelService = {
  track: (_event: string, _props?: Record<string, unknown>, _distinctId?: string) => {},
  trackAnalyticsEvent: (_event: string, _data?: Record<string, unknown>) => {},
  trackFeatureUsage: (_a: string | Record<string, unknown>, _b?: Record<string, unknown>) => {},
  trackAuthEvent: (_a: string | Record<string, unknown>, _b?: Record<string, unknown>) => {},
  trackProjectEvent: (_a: string | Record<string, unknown>, _b?: Record<string, unknown>) => {},
  trackOptimization: (_a: string | Record<string, unknown>, _b?: Record<string, unknown>) => {},
  setUserProfile: (_userId: string, _props?: Record<string, unknown>) => {},
  trackError: (_a: string | Record<string, unknown>, _b?: Record<string, unknown>) => {},
  trackPerformance: (_a: string | Record<string, unknown>, _b?: Record<string, unknown>) => {},
};
