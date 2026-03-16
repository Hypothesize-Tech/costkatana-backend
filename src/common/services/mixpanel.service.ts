import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../logger/logger.service';

// Lazy-load mixpanel to avoid init when token is missing
let mixpanelClient: import('mixpanel').Mixpanel | null = null;
let mixpanelInitialized = false;

function getMixpanel(
  configService: ConfigService,
): import('mixpanel').Mixpanel | null {
  if (mixpanelInitialized) return mixpanelClient;
  mixpanelInitialized = true;
  const token = configService.get<string>('MIXPANEL_TOKEN');
  if (!token || configService.get<string>('NODE_ENV') === 'test') {
    mixpanelClient = null;
    return null;
  }
  try {
    const mixpanel = require('mixpanel');
    mixpanelClient = mixpanel.init(token, {
      debug: configService.get<string>('NODE_ENV') === 'development',
      host: 'api.mixpanel.com',
    });
    return mixpanelClient;
  } catch {
    mixpanelClient = null;
    return null;
  }
}

@Injectable()
export class MixpanelService {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Track a custom event. No-op if Mixpanel is not configured.
   */
  track(
    event: string,
    properties: Record<string, unknown> = {},
    distinctId?: string,
  ): void {
    const client = getMixpanel(this.configService);
    if (!client) return;
    try {
      const props = {
        ...properties,
        timestamp: new Date().toISOString(),
        environment:
          this.configService.get<string>('NODE_ENV') || 'development',
        ...(distinctId ? { distinct_id: distinctId } : {}),
      };
      client.track(event, props);
    } catch (error) {
      this.logger.warn('Mixpanel track failed', {
        event,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Track analytics/dashboard events (mirrors Express mixpanelService.trackAnalyticsEvent).
   */
  trackAnalyticsEvent(
    event:
      | 'dashboard_viewed'
      | 'report_generated'
      | 'export_requested'
      | 'filter_applied'
      | 'chart_interacted'
      | 'data_refreshed',
    data: {
      userId: string;
      projectId?: string;
      reportType?: string;
      dateRange?: string;
      filters?: Record<string, unknown>;
      page: string;
      component: string;
      metadata?: Record<string, unknown>;
    },
  ): void {
    this.track(
      `Analytics ${event}`,
      {
        ...data,
        event_type: 'analytics',
        page_category: data.page?.includes('/analytics')
          ? 'analytics'
          : 'other',
        component_category: data.component || 'component',
      },
      data.userId,
    );
  }
}
