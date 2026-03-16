import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Telemetry,
  TelemetryDocument,
} from '../../../schemas/core/telemetry.schema';

export interface TelemetryCleanupResult {
  deletedCount: number;
  olderThan: Date;
  durationMs: number;
}

@Injectable()
export class TelemetryCleanupService {
  private readonly logger = new Logger(TelemetryCleanupService.name);

  constructor(
    @InjectModel(Telemetry.name)
    private readonly telemetryModel: Model<TelemetryDocument>,
  ) {}

  /**
   * Delete telemetry documents older than the given date.
   * MongoDB TTL index may also remove by timestamp; this allows manual cleanup or stricter retention.
   */
  async deleteOlderThan(olderThan: Date): Promise<TelemetryCleanupResult> {
    const start = Date.now();
    const result = await this.telemetryModel
      .deleteMany({ timestamp: { $lt: olderThan } })
      .exec();
    const deletedCount = result.deletedCount ?? 0;
    this.logger.log('Telemetry cleanup completed', {
      deletedCount,
      olderThan: olderThan.toISOString(),
      durationMs: Date.now() - start,
    });
    return {
      deletedCount,
      olderThan,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Run cleanup using retention days (e.g. 7).
   */
  async runRetentionCleanup(
    retentionDays: number = 7,
  ): Promise<TelemetryCleanupResult> {
    const olderThan = new Date(
      Date.now() - retentionDays * 24 * 60 * 60 * 1000,
    );
    return this.deleteOlderThan(olderThan);
  }
}
