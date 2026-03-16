import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface IntegrationDeliveryEvent {
  integrationId: string;
  userId: string;
  type: string;
  success: boolean;
  responseTimeMs: number;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class IntegrationObservabilityService {
  private readonly logger = new Logger(IntegrationObservabilityService.name);
  private readonly deliveryCounts = new Map<
    string,
    { success: number; failure: number }
  >();

  constructor(private readonly eventEmitter: EventEmitter2) {}

  recordDelivery(event: IntegrationDeliveryEvent): void {
    const key = `${event.integrationId}:${event.type}`;
    const counts = this.deliveryCounts.get(key) ?? { success: 0, failure: 0 };
    if (event.success) counts.success += 1;
    else counts.failure += 1;
    this.deliveryCounts.set(key, counts);

    this.eventEmitter.emit('integration.delivery.recorded', event);
    this.logger.debug('Integration delivery recorded', {
      integrationId: event.integrationId,
      type: event.type,
      success: event.success,
      responseTimeMs: event.responseTimeMs,
    });
  }

  getDeliveryStats(integrationId: string): {
    success: number;
    failure: number;
    total: number;
  } {
    let success = 0;
    let failure = 0;
    for (const [key, counts] of this.deliveryCounts) {
      if (key.startsWith(`${integrationId}:`)) {
        success += counts.success;
        failure += counts.failure;
      }
    }
    return { success, failure, total: success + failure };
  }

  recordHealthCheck(
    integrationId: string,
    healthy: boolean,
    latencyMs: number,
  ): void {
    this.eventEmitter.emit('integration.health.checked', {
      integrationId,
      healthy,
      latencyMs,
    });
  }
}
