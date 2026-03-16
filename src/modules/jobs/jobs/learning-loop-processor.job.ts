import { Injectable, Logger } from '@nestjs/common';
import { LearningLoopService } from '../../data-network-effects/services/learning-loop.service';

@Injectable()
export class LearningLoopProcessorJob {
  private readonly logger = new Logger(LearningLoopProcessorJob.name);
  private isRunning = false;

  constructor(private readonly learningLoopService: LearningLoopService) {}

  /**
   * Run the learning loop processor job
   */
  async run(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        'Learning loop processor job already running, skipping this cycle',
      );
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      this.logger.log('🧠 Running learning loop processor job...');

      await this.learningLoopService.processPendingOutcomes();

      const duration = Date.now() - startTime;
      this.logger.log('✅ Learning loop processor job completed', {
        durationMs: duration,
      });
    } catch (error) {
      this.logger.error('❌ Learning loop processor job failed', error);
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
