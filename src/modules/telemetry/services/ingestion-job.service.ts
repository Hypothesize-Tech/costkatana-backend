import { Injectable, Logger } from '@nestjs/common';
import { TelemetryCleanupService } from './telemetry-cleanup.service';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class IngestionJobService {
  private readonly logger = new Logger(IngestionJobService.name);

  constructor(private readonly telemetryCleanup: TelemetryCleanupService) {}

  /**
   * Run telemetry retention cleanup daily at 2 AM.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async runTelemetryCleanup(): Promise<void> {
    this.logger.log('Running scheduled telemetry cleanup');
    try {
      const result = await this.telemetryCleanup.runRetentionCleanup(7);
      this.logger.log('Scheduled telemetry cleanup completed', {
        deletedCount: result.deletedCount,
        durationMs: result.durationMs,
      });
    } catch (e) {
      this.logger.error('Scheduled telemetry cleanup failed', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
