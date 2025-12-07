import { GlobalBenchmarksService } from '../services/globalBenchmarks.service';
import { loggingService } from '../services/logging.service';

/**
 * Global Benchmark Update Job
 * Periodically generates privacy-preserving benchmarks across all tenants
 * Run frequency: Daily
 */
export class GlobalBenchmarkUpdateJob {
  private static isRunning = false;
  private static intervalId: NodeJS.Timeout | null = null;

  /**
   * Start the global benchmark update job
   */
  static start(intervalHours: number = 24): void {
    if (this.intervalId) {
      loggingService.warn('Global benchmark update job already running');
      return;
    }

    loggingService.info('🌍 Starting global benchmark update job', {
      intervalHours
    });

    // Run immediately on start (with delay to allow system to stabilize)
    setTimeout(() => this.run(), 120000); // 2 minute delay

    // Schedule periodic runs
    this.intervalId = setInterval(
      () => this.run(),
      intervalHours * 60 * 60 * 1000
    );
  }

  /**
   * Stop the global benchmark update job
   */
  static stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      loggingService.info('Stopped global benchmark update job');
    }
  }

  /**
   * Run the global benchmark update job
   */
  static async run(): Promise<void> {
    if (this.isRunning) {
      loggingService.warn('Global benchmark update job already running, skipping this cycle');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      loggingService.info('🔄 Running global benchmark update job...');

      await GlobalBenchmarksService.generateAllBenchmarks();

      const duration = Date.now() - startTime;
      loggingService.info('✅ Global benchmark update job completed', {
        durationMs: duration
      });
    } catch (error) {
      loggingService.error('❌ Global benchmark update job failed', {
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
if (process.env.NODE_ENV === 'production' && process.env.ENABLE_GLOBAL_BENCHMARKS !== 'false') {
  GlobalBenchmarkUpdateJob.start();
}

