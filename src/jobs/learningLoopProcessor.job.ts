import { LearningLoopService } from '../services/learningLoop.service';
import { loggingService } from '../services/logging.service';

/**
 * Learning Loop Processor Job
 * Processes pending recommendation outcomes and applies learning
 * Run frequency: Every 6 hours
 */
export class LearningLoopProcessorJob {
  private static isRunning = false;
  private static intervalId: NodeJS.Timeout | null = null;

  /**
   * Start the learning loop processor job
   */
  static start(intervalHours: number = 6): void {
    if (this.intervalId) {
      loggingService.warn('Learning loop processor job already running');
      return;
    }

    loggingService.info('🔁 Starting learning loop processor job', {
      intervalHours
    });

    // Run immediately on start
    setTimeout(() => this.run(), 30000); // 30 second delay

    // Schedule periodic runs
    this.intervalId = setInterval(
      () => this.run(),
      intervalHours * 60 * 60 * 1000
    );
  }

  /**
   * Stop the learning loop processor job
   */
  static stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      loggingService.info('Stopped learning loop processor job');
    }
  }

  /**
   * Run the learning loop processor job
   */
  static async run(): Promise<void> {
    if (this.isRunning) {
      loggingService.warn('Learning loop processor job already running, skipping this cycle');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      loggingService.info('🔄 Running learning loop processor job...');

      await LearningLoopService.processPendingOutcomes();

      const duration = Date.now() - startTime;
      loggingService.info('✅ Learning loop processor job completed', {
        durationMs: duration
      });
    } catch (error) {
      loggingService.error('❌ Learning loop processor job failed', {
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
if (process.env.NODE_ENV === 'production' && process.env.ENABLE_LEARNING_LOOP !== 'false') {
  LearningLoopProcessorJob.start();
}

