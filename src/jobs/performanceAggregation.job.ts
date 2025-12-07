import { ModelPerformanceFingerprintService } from '../services/modelPerformanceFingerprint.service';
import { loggingService } from '../services/logging.service';

/**
 * Performance Aggregation Job
 * Continuously updates model performance fingerprints from telemetry data
 * Run frequency: Every hour
 */
export class PerformanceAggregationJob {
  private static isRunning = false;
  private static intervalId: NodeJS.Timeout | null = null;

  /**
   * Start the performance aggregation job
   */
  static start(intervalMinutes: number = 60): void {
    if (this.intervalId) {
      loggingService.warn('Performance aggregation job already running');
      return;
    }

    loggingService.info('📊 Starting performance aggregation job', {
      intervalMinutes
    });

    // Run immediately on start
    this.run();

    // Schedule periodic runs
    this.intervalId = setInterval(
      () => this.run(),
      intervalMinutes * 60 * 1000
    );
  }

  /**
   * Stop the performance aggregation job
   */
  static stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      loggingService.info('Stopped performance aggregation job');
    }
  }

  /**
   * Run the performance aggregation job
   */
  static async run(): Promise<void> {
    if (this.isRunning) {
      loggingService.warn('Performance aggregation job already running, skipping this cycle');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      loggingService.info('🔄 Running performance aggregation job...');

      await ModelPerformanceFingerprintService.updateAllModels();

      const duration = Date.now() - startTime;
      loggingService.info('✅ Performance aggregation job completed', {
        durationMs: duration
      });
    } catch (error) {
      loggingService.error('❌ Performance aggregation job failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Run once (for manual trigger or testing)
   */
  static async runOnce(): Promise<void> {
    await this.run();
  }
}

// Auto-start in production (can be controlled via env var)
if (process.env.NODE_ENV === 'production' && process.env.ENABLE_PERFORMANCE_AGGREGATION !== 'false') {
  PerformanceAggregationJob.start();
}

