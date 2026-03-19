/**
 * Bridge: Re-exports MixpanelService for legacy Express middleware.
 * For NestJS usage, inject MixpanelService from CommonModule.
 */
export { MixpanelService } from '../common/services/mixpanel.service';

import type { MixpanelService as MixpanelServiceType } from '../common/services/mixpanel.service';

let _mixpanelInstance: MixpanelServiceType | null = null;

export function setMixpanelInstance(instance: MixpanelServiceType): void {
  _mixpanelInstance = instance;
}

const noop = () => {};
export const mixpanelService = {
  track: (event: string, props?: Record<string, unknown>, distinctId?: string) =>
    _mixpanelInstance ? _mixpanelInstance.track(event, props, distinctId) : noop(),
  trackAnalyticsEvent: (event: string, data?: Record<string, unknown>) =>
    _mixpanelInstance ? _mixpanelInstance.trackAnalyticsEvent(event, data) : noop(),
  trackFeatureUsage: (a: string | Record<string, unknown>, b?: Record<string, unknown>) =>
    _mixpanelInstance ? _mixpanelInstance.trackFeatureUsage(a, b) : noop(),
  trackAuthEvent: (a: string | Record<string, unknown>, b?: Record<string, unknown>) =>
    _mixpanelInstance ? _mixpanelInstance.trackAuthEvent(a, b) : noop(),
  trackProjectEvent: (a: string | Record<string, unknown>, b?: Record<string, unknown>) =>
    _mixpanelInstance ? _mixpanelInstance.trackProjectEvent(a, b) : noop(),
  trackOptimization: (a: string | Record<string, unknown>, b?: Record<string, unknown>) =>
    _mixpanelInstance ? _mixpanelInstance.trackOptimization(a, b) : noop(),
  setUserProfile: (userId: string, props?: Record<string, unknown>) =>
    _mixpanelInstance ? _mixpanelInstance.setUserProfile(userId, props) : noop(),
  trackError: (a: string | Record<string, unknown>, b?: Record<string, unknown>) =>
    _mixpanelInstance ? _mixpanelInstance.trackError(a, b) : noop(),
  trackPerformance: (a: string | Record<string, unknown>, b?: Record<string, unknown>) =>
    _mixpanelInstance ? _mixpanelInstance.trackPerformance(a, b) : noop(),
};
