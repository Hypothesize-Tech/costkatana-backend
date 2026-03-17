/**
 * Data Network Effects Background Jobs
 * Centralized export for all background jobs
 */

import { PerformanceAggregationJob } from './performanceAggregation.job';
import { SemanticClusteringJob } from './semanticClustering.job';
import { GlobalBenchmarkUpdateJob } from './globalBenchmarkUpdate.job';
import { LearningLoopProcessorJob } from './learningLoopProcessor.job';
import { loggingService } from '../common/services/logging.service';

/**
 * Start all Data Network Effects jobs
 */
export function startDataNetworkEffectsJobs(): void {
  loggingService.info('🚀 Starting Data Network Effects background jobs...');

  try {
    // Start performance aggregation (every hour)
    PerformanceAggregationJob.start(60);

    // Start semantic clustering (daily)
    SemanticClusteringJob.start(24);

    // Start global benchmark updates (daily)
    GlobalBenchmarkUpdateJob.start(24);

    // Start learning loop processor (every 6 hours)
    LearningLoopProcessorJob.start(6);

    loggingService.info(
      '✅ All Data Network Effects jobs started successfully',
    );
  } catch (error) {
    loggingService.error('❌ Failed to start Data Network Effects jobs', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Stop all Data Network Effects jobs
 */
export function stopDataNetworkEffectsJobs(): void {
  loggingService.info('🛑 Stopping Data Network Effects background jobs...');

  PerformanceAggregationJob.stop();
  SemanticClusteringJob.stop();
  GlobalBenchmarkUpdateJob.stop();
  LearningLoopProcessorJob.stop();

  loggingService.info('✅ All Data Network Effects jobs stopped');
}

/**
 * Run all jobs once (for testing or manual trigger)
 */
export async function runAllJobsOnce(): Promise<void> {
  loggingService.info('▶️  Running all Data Network Effects jobs once...');

  try {
    await PerformanceAggregationJob.runOnce();
    await SemanticClusteringJob.runOnce();
    await GlobalBenchmarkUpdateJob.runOnce();
    await LearningLoopProcessorJob.runOnce();

    loggingService.info('✅ All jobs completed');
  } catch (error) {
    loggingService.error('❌ Job execution failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Export individual jobs
export {
  PerformanceAggregationJob,
  SemanticClusteringJob,
  GlobalBenchmarkUpdateJob,
  LearningLoopProcessorJob,
};
