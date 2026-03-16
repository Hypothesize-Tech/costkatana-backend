import { Injectable, Logger } from '@nestjs/common';
import { GlobalBenchmarksService } from '../../data-network-effects/services/global-benchmarks.service';

@Injectable()
export class GlobalBenchmarkUpdateJob {
  private readonly logger = new Logger(GlobalBenchmarkUpdateJob.name);
  private isRunning = false;

  constructor(
    private readonly globalBenchmarksService: GlobalBenchmarksService,
  ) {}

  /**
   * Run the global benchmark update job
   */
  async run(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        'Global benchmark update job already running, skipping this cycle',
      );
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      this.logger.log('🌍 Running global benchmark update job...');

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const now = new Date();

      await this.globalBenchmarksService.generateGlobalBenchmark({
        startDate: thirtyDaysAgo,
        endDate: now,
      });

      const duration = Date.now() - startTime;
      this.logger.log('✅ Global benchmark update job completed', {
        durationMs: duration,
      });
    } catch (error) {
      this.logger.error('❌ Global benchmark update job failed', error);
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
