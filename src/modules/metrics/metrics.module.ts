import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';

/**
 * Metrics module: cache and operational metrics API.
 * Exposes GET /metrics/cache (parity with Express metrics route).
 */
@Module({
  controllers: [MetricsController],
})
export class MetricsModule {}
