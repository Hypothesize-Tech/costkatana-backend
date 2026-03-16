import { Injectable, Logger } from '@nestjs/common';
import { SemanticPatternAnalyzerService } from '../../data-network-effects/services/semantic-pattern-analyzer.service';

@Injectable()
export class SemanticClusteringJob {
  private readonly logger = new Logger(SemanticClusteringJob.name);
  private isRunning = false;

  constructor(
    private readonly semanticAnalyzerService: SemanticPatternAnalyzerService,
  ) {}

  /**
   * Run the semantic clustering job
   */
  async run(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        'Semantic clustering job already running, skipping this cycle',
      );
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      this.logger.log('🔍 Running semantic clustering job...');

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const now = new Date();

      await this.semanticAnalyzerService.runClusteringAnalysis({
        startDate: thirtyDaysAgo,
        endDate: now,
        numClusters: 20,
      });

      const duration = Date.now() - startTime;
      this.logger.log('✅ Semantic clustering job completed', {
        durationMs: duration,
      });
    } catch (error) {
      this.logger.error('❌ Semantic clustering job failed', error);
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
