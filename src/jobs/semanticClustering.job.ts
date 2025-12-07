import { SemanticPatternAnalyzerService } from '../services/semanticPatternAnalyzer.service';
import { loggingService } from '../services/logging.service';

/**
 * Semantic Clustering Job
 * Periodically discovers patterns in request data using embeddings
 * Run frequency: Daily
 */
export class SemanticClusteringJob {
  private static isRunning = false;
  private static intervalId: NodeJS.Timeout | null = null;

  /**
   * Start the semantic clustering job
   */
  static start(intervalHours: number = 24): void {
    if (this.intervalId) {
      loggingService.warn('Semantic clustering job already running');
      return;
    }

    loggingService.info('🔍 Starting semantic clustering job', {
      intervalHours
    });

    // Run immediately on start (with delay to allow system to stabilize)
    setTimeout(() => this.run(), 60000); // 1 minute delay

    // Schedule periodic runs
    this.intervalId = setInterval(
      () => this.run(),
      intervalHours * 60 * 60 * 1000
    );
  }

  /**
   * Stop the semantic clustering job
   */
  static stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      loggingService.info('Stopped semantic clustering job');
    }
  }

  /**
   * Run the semantic clustering job
   */
  static async run(): Promise<void> {
    if (this.isRunning) {
      loggingService.warn('Semantic clustering job already running, skipping this cycle');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      loggingService.info('🔄 Running semantic clustering job...');

      // Analyze last 30 days of data
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

      const clusters = await SemanticPatternAnalyzerService.runClusteringAnalysis({
        startDate,
        endDate,
        numClusters: 20
      });

      const duration = Date.now() - startTime;
      loggingService.info('✅ Semantic clustering job completed', {
        clustersCreated: clusters.length,
        durationMs: duration
      });

      // Log high-value insights
      const highValueClusters = clusters.filter(
        c => c.optimization.totalEstimatedSavings > 5
      );

      if (highValueClusters.length > 0) {
        loggingService.info('💡 High-value optimization opportunities discovered', {
          count: highValueClusters.length,
          totalPotentialSavings: highValueClusters.reduce(
            (sum, c) => sum + c.optimization.totalEstimatedSavings,
            0
          ).toFixed(2)
        });
      }
    } catch (error) {
      loggingService.error('❌ Semantic clustering job failed', {
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
if (process.env.NODE_ENV === 'production' && process.env.ENABLE_SEMANTIC_CLUSTERING !== 'false') {
  SemanticClusteringJob.start();
}

