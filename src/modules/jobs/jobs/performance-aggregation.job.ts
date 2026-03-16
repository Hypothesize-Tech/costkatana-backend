import { Injectable, Logger } from '@nestjs/common';
import { ModelPerformanceFingerprintService } from '../../data-network-effects/services/model-performance-fingerprint.service';

@Injectable()
export class PerformanceAggregationJob {
  private readonly logger = new Logger(PerformanceAggregationJob.name);
  private isRunning = false;

  constructor(
    private readonly modelPerformanceService: ModelPerformanceFingerprintService,
  ) {}

  /**
   * Run the performance aggregation job
   */
  async run(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        'Performance aggregation job already running, skipping this cycle',
      );
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      this.logger.log('🔄 Running performance aggregation job...');

      await this.modelPerformanceService.updateAllModels();

      const duration = Date.now() - startTime;
      this.logger.log('✅ Performance aggregation job completed', {
        durationMs: duration,
      });
    } catch (error) {
      this.logger.error('❌ Performance aggregation job failed', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Run once (for manual trigger or testing)
   */
  async runOnce(): Promise<void> {
    await this.run();
  }
}
