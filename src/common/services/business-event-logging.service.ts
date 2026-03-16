import { Injectable } from '@nestjs/common';
import { LoggerService } from '../logger/logger.service';

export interface BusinessEventPayload {
  event: string;
  category: string;
  value?: number;
  currency?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Production-ready business event logging for analytics and monitoring.
 * Logs structured events via LoggerService; can be extended for CloudWatch/metrics.
 */
@Injectable()
export class BusinessEventLoggingService {
  private static readonly LOG_CATEGORY = 'business_event';

  constructor(private readonly logger: LoggerService) {}

  /**
   * Log a business event (alias for logBusiness for compatibility).
   */
  logEvent(payload: BusinessEventPayload): void {
    this.logBusiness(payload);
  }

  /**
   * Log a business event (mirrors Express loggingService.logBusiness).
   * Used for monitoring_operations, onboarding_operations, etc.
   */
  logBusiness(payload: BusinessEventPayload): void {
    const { event, category, value, currency, metadata = {} } = payload;
    this.logger.log(`[Business] ${category}: ${event}`, {
      type: 'business_event',
      event,
      category,
      ...(value !== undefined && { value }),
      ...(currency && { currency }),
      ...metadata,
    });
  }
}
