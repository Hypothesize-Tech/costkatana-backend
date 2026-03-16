import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PerformanceAggregationJob } from '../jobs/performance-aggregation.job';
import { SemanticClusteringJob } from '../jobs/semantic-clustering.job';
import { GlobalBenchmarkUpdateJob } from '../jobs/global-benchmark-update.job';
import { LearningLoopProcessorJob } from '../jobs/learning-loop-processor.job';
import { ModelDiscoveryJob } from '../jobs/model-discovery.job';
import { VectorizationJob } from '../jobs/vectorization.job';
import { VectorMaintenanceJob } from '../jobs/vector-maintenance.job';
import { GuardrailsService } from '../../guardrails/guardrails.service';
import { SubscriptionService } from '../../subscription/subscription.service';
import { AccountClosureService } from '../../account-closure/account-closure.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../../../schemas/user/user.schema';

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private jobsStarted = false;

  constructor(
    @InjectQueue('dead-letter') private deadLetterQueue: Queue,
    @InjectQueue('reindex') private reindexQueue: Queue,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly moduleRef: ModuleRef,
    private readonly performanceAggregationJob: PerformanceAggregationJob,
    private readonly semanticClusteringJob: SemanticClusteringJob,
    private readonly globalBenchmarkUpdateJob: GlobalBenchmarkUpdateJob,
    private readonly learningLoopProcessorJob: LearningLoopProcessorJob,
    private readonly modelDiscoveryJob: ModelDiscoveryJob,
    private readonly vectorizationJob: VectorizationJob,
    private readonly vectorMaintenanceJob: VectorMaintenanceJob,
    private readonly guardrailsService: GuardrailsService,
    private readonly subscriptionService: SubscriptionService,
    private readonly accountClosureService: AccountClosureService,
  ) {}

  async onModuleInit() {
    this.logger.log('🚀 Initializing Jobs Service...');

    // Start background jobs based on environment
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.ENABLE_JOBS === 'true'
    ) {
      await this.startAllJobs();
    }
  }

  async onModuleDestroy() {
    this.logger.log('🛑 Stopping Jobs Service...');
    await this.stopAllJobs();
  }

  /**
   * Start all background jobs
   */
  async startAllJobs(): Promise<void> {
    if (this.jobsStarted) {
      this.logger.warn('Jobs already started');
      return;
    }

    try {
      this.logger.log('🚀 Starting all background jobs...');

      // Jobs will be started via cron decorators
      this.jobsStarted = true;

      this.logger.log('✅ All background jobs initialized successfully');
    } catch (error) {
      this.logger.error('❌ Failed to start background jobs', error);
      throw error;
    }
  }

  /**
   * Stop all background jobs
   */
  async stopAllJobs(): Promise<void> {
    if (!this.jobsStarted) {
      return;
    }

    try {
      this.logger.log('🛑 Stopping all background jobs...');

      // Individual jobs will handle their own cleanup
      this.jobsStarted = false;

      this.logger.log('✅ All background jobs stopped');
    } catch (error) {
      this.logger.error('❌ Failed to stop background jobs', error);
    }
  }

  /**
   * Run all jobs once (for testing or manual trigger)
   */
  async runAllJobsOnce(): Promise<void> {
    this.logger.log('▶️ Running all jobs once...');

    try {
      await Promise.allSettled([
        this.performanceAggregationJob.runOnce(),
        this.semanticClusteringJob.runOnce(),
        this.globalBenchmarkUpdateJob.runOnce(),
        this.learningLoopProcessorJob.runOnce(),
        this.modelDiscoveryJob.runOnce(),
        this.vectorizationJob.runOnce(),
        this.vectorMaintenanceJob.runOnce(),
        // Run the new cron jobs
        this.performSmartSampling(),
        this.performVectorizationHealthCheck(),
        this.monitorOptimizationOpportunities(),
        this.performCleanupTasks(),
        this.performTelemetryCleanup(),
        // Run vectorization jobs
        this.vectorizationJob.processUserMemories(),
        this.vectorizationJob.processConversations(),
        this.vectorizationJob.processMessages(),
      ]);

      this.logger.log('✅ All jobs completed');
    } catch (error) {
      this.logger.error('❌ Job execution failed', error);
      throw error;
    }
  }

  /**
   * Get job status
   */
  async getJobStatus(): Promise<any> {
    return {
      jobsStarted: this.jobsStarted,
      environment: process.env.NODE_ENV,
      enableJobs: process.env.ENABLE_JOBS,
      timestamp: new Date().toISOString(),
    };
  }

  // ============================================================================
  // CRON JOBS
  // ============================================================================

  /**
   * Performance aggregation - every hour
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handlePerformanceAggregation() {
    if (!this.jobsStarted) return;
    await this.performanceAggregationJob.run();
  }

  /**
   * Semantic clustering - daily at 2 AM
   */
  @Cron('0 2 * * *')
  async handleSemanticClustering() {
    if (!this.jobsStarted) return;
    await this.semanticClusteringJob.run();
  }

  /**
   * Global benchmark updates - daily at 3 AM
   */
  @Cron('0 3 * * *')
  async handleGlobalBenchmarkUpdate() {
    if (!this.jobsStarted) return;
    await this.globalBenchmarkUpdateJob.run();
  }

  /**
   * Learning loop processor - every 6 hours
   */
  @Cron('0 */6 * * *')
  async handleLearningLoopProcessor() {
    if (!this.jobsStarted) return;
    await this.learningLoopProcessorJob.run();
  }

  /**
   * Model discovery - daily at 1 AM
   */
  @Cron('0 1 * * *')
  async handleModelDiscovery() {
    if (!this.jobsStarted) return;
    await this.modelDiscoveryJob.run();
  }

  /**
   * Vectorization - daily at 4 AM
   */
  @Cron('0 4 * * *')
  async handleVectorization() {
    if (!this.jobsStarted) return;
    await this.vectorizationJob.run();
  }

  /**
   * Vector maintenance - weekly on Sunday at 5 AM
   */
  @Cron('0 5 * * 0')
  async handleVectorMaintenance() {
    if (!this.jobsStarted) return;
    await this.vectorMaintenanceJob.run();
  }

  /**
   * Monthly usage reset - runs at midnight on the 1st of each month
   */
  @Cron('0 0 1 * *')
  async handleMonthlyUsageReset() {
    if (!this.jobsStarted) return;

    this.logger.log('Running monthly usage reset via guardrails');
    try {
      await this.guardrailsService.resetMonthlyUsage();
      this.logger.log('Monthly usage reset completed');
    } catch (error) {
      this.logger.error('Monthly usage reset failed', error);
    }
  }

  /**
   * Hourly usage check for free tier throttling - runs every hour
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleHourlyUsageCheck() {
    if (!this.jobsStarted) return;

    this.logger.log('Running hourly usage check for guardrails');
    try {
      // Check users approaching limits
      const freeUsers = await this.userModel
        .find({
          isActive: true,
          'subscription.plan': 'free',
        })
        .select('_id usage subscription')
        .populate('subscription');

      for (const user of freeUsers) {
        const usage = user.usage?.currentMonth;
        const subscription = (user as any).subscription;
        if (!subscription) continue;
        const limits = subscription?.limits;

        if (!usage || !limits) continue;

        // Check if approaching limits (80% threshold)
        const tokenPercentage =
          (usage.totalTokens / limits.tokensPerMonth) * 100;
        const requestPercentage = (usage.apiCalls / limits.apiCalls) * 100;

        if (tokenPercentage >= 80 || requestPercentage >= 80) {
          this.logger.warn('User approaching limits', {
            userId: user._id.toString(),
            tokenPercentage: tokenPercentage.toFixed(2),
            requestPercentage: requestPercentage.toFixed(2),
            threshold: 80,
          });

          // The GuardrailsService will handle sending alerts
          await this.guardrailsService.checkRequestGuardrails(
            user._id.toString(),
            'token',
            0,
          );
        }
      }

      this.logger.log(
        `Hourly usage check completed, processed ${freeUsers.length} users`,
      );
    } catch (error) {
      this.logger.error('Hourly usage check failed', error);
    }
  }

  /**
   * Daily account deletion cleanup at 4 AM
   */
  @Cron('0 4 * * *')
  async handleAccountDeletionCleanup() {
    if (!this.jobsStarted) return;

    this.logger.log('Running daily account deletion cleanup');
    try {
      const result = await this.accountClosureService.cleanupExpiredAccounts();
      this.logger.log('Account deletion cleanup completed', result);
    } catch (error) {
      this.logger.error('Account deletion cleanup failed', error);
    }
  }

  /**
   * Weekly warning emails on Sundays at 10 AM
   */
  @Cron('0 10 * * 0')
  async handleAccountDeletionWarnings() {
    if (!this.jobsStarted) return;

    this.logger.log('Running weekly account deletion warnings');
    try {
      const sentCount = await this.accountClosureService.sendDeletionWarnings();
      this.logger.log(`Account deletion warnings sent to ${sentCount} users`);
    } catch (error) {
      this.logger.error('Account deletion warnings failed', error);
    }
  }

  /**
   * Daily Cortex usage reset - runs at midnight every day
   */
  @Cron('0 0 * * *')
  async handleDailyCortexReset() {
    if (!this.jobsStarted) return;

    this.logger.log('Running daily Cortex usage reset');
    try {
      await this.subscriptionService.resetDailyCortexUsage();
      this.logger.log('Daily Cortex usage reset completed');
    } catch (error) {
      this.logger.error('Daily Cortex usage reset failed', error);
    }
  }

  /**
   * Trial expiration check - runs every hour
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleTrialExpirationCheck() {
    if (!this.jobsStarted) return;

    this.logger.log('Running trial expiration check');
    try {
      await this.subscriptionService.processTrialExpirations();
      this.logger.log('Trial expiration check completed');
    } catch (error) {
      this.logger.error('Trial expiration check failed', error);
    }
  }

  /**
   * Scheduled cancellations - runs every hour
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleScheduledCancellations() {
    if (!this.jobsStarted) return;

    this.logger.log('Running scheduled cancellations check');
    try {
      await this.subscriptionService.processCancellations();
      this.logger.log('Scheduled cancellations check completed');
    } catch (error) {
      this.logger.error('Scheduled cancellations check failed', error);
    }
  }

  /**
   * Failed payment retries (dunning management) - runs every 6 hours
   */
  @Cron('0 */6 * * *')
  async handleFailedPaymentRetries() {
    if (!this.jobsStarted) return;

    this.logger.log('Running failed payment retries');
    try {
      await this.subscriptionService.processFailedPayments();
      this.logger.log('Failed payment retries completed');
    } catch (error) {
      this.logger.error('Failed payment retries failed', error);
    }
  }

  /**
   * Usage alerts check - runs every 4 hours
   */
  @Cron('0 */4 * * *')
  async handleUsageAlertsCheck() {
    if (!this.jobsStarted) return;

    this.logger.log('Running usage alerts check');
    try {
      const subscriptions = await this.userModel
        .find({
          'subscription.status': { $in: ['active', 'trialing'] },
        })
        .select('_id')
        .populate('subscription');

      for (const user of subscriptions) {
        const subscription = (user as any).subscription;
        if (subscription) {
          await this.subscriptionService.checkUsageAlerts(user._id.toString());
        }
      }

      this.logger.log(
        `Usage alerts check completed, processed ${subscriptions.length} subscriptions`,
      );
    } catch (error) {
      this.logger.error('Usage alerts check failed', error);
    }
  }

  /**
   * Smart sampling for message selection - runs daily at 1 AM
   */
  @Cron('0 1 * * *')
  async handleSmartSampling() {
    if (!this.jobsStarted) return;

    this.logger.log('Running smart sampling for message selection');
    try {
      // Perform smart sampling logic to analyze usage patterns and select
      // representative messages for training, analysis, and optimization
      await this.performSmartSampling();

      this.logger.log('Smart sampling completed');
    } catch (error) {
      this.logger.error('Smart sampling failed', error);
    }
  }

  /**
   * Vectorization health check - runs monthly on the 1st at 4 AM
   */
  @Cron('0 4 1 * *')
  async handleVectorizationHealthCheck() {
    if (!this.jobsStarted) return;

    this.logger.log('Running monthly vectorization health check');
    try {
      // Perform health checks on vectorization services
      // Check vector store connectivity, index integrity, etc.
      await this.performVectorizationHealthCheck();

      this.logger.log('Vectorization health check completed');
    } catch (error) {
      this.logger.error('Vectorization health check failed', error);
    }
  }

  /**
   * User memory vectorization - runs every hour
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleUserMemoryVectorization() {
    if (!this.jobsStarted) return;

    this.logger.log('Running user memory vectorization');
    try {
      const stats = await this.vectorizationJob.processUserMemories();
      this.logger.log('User memory vectorization completed', stats);
    } catch (error) {
      this.logger.error('User memory vectorization failed', error);
    }
  }

  /**
   * Conversation memory vectorization - runs daily at 2 AM
   */
  @Cron('0 2 * * *')
  async handleConversationMemoryVectorization() {
    if (!this.jobsStarted) return;

    this.logger.log('Running conversation memory vectorization');
    try {
      const stats = await this.vectorizationJob.processConversations();
      this.logger.log('Conversation memory vectorization completed', stats);
    } catch (error) {
      this.logger.error('Conversation memory vectorization failed', error);
    }
  }

  /**
   * Message vectorization - runs weekly on Sunday at 3 AM
   */
  @Cron('0 3 * * 0')
  async handleMessageVectorization() {
    if (!this.jobsStarted) return;

    this.logger.log('Running message vectorization');
    try {
      const stats = await this.vectorizationJob.processMessages();
      this.logger.log('Message vectorization completed', stats);
    } catch (error) {
      this.logger.error('Message vectorization failed', error);
    }
  }

  /**
   * Optimization monitoring - runs every 6 hours
   */
  @Cron('0 */6 * * *')
  async handleOptimizationMonitoring() {
    if (!this.jobsStarted) return;

    this.logger.log('Running optimization monitoring');
    try {
      // Import and use optimization service
      const { OptimizationService } =
        await import('../../optimization/optimization.service');

      // Monitor optimization opportunities and performance
      await this.monitorOptimizationOpportunities();

      this.logger.log('Optimization monitoring completed');
    } catch (error) {
      this.logger.error('Optimization monitoring failed', error);
    }
  }

  /**
   * General cleanup tasks - runs daily at 2 AM
   */
  @Cron('0 2 * * *')
  async handleCleanupTasks() {
    if (!this.jobsStarted) return;

    this.logger.log('Running daily cleanup tasks');
    try {
      // Perform various cleanup tasks
      await this.performCleanupTasks();

      this.logger.log('Cleanup tasks completed');
    } catch (error) {
      this.logger.error('Cleanup tasks failed', error);
    }
  }

  /**
   * Telemetry cleanup - runs multiple times per day
   */
  @Cron('0 */4 * * *') // Every 4 hours
  async handleTelemetryCleanup() {
    if (!this.jobsStarted) return;

    this.logger.log('Running telemetry cleanup');
    try {
      // Import telemetry service for cleanup
      const { TelemetryService } =
        await import('../../../services/telemetry.service');
      this.moduleRef.get(TelemetryService, { strict: false });

      // Perform telemetry data cleanup
      await this.performTelemetryCleanup();

      this.logger.log('Telemetry cleanup completed');
    } catch (error) {
      this.logger.error('Telemetry cleanup failed', error);
    }
  }

  // ============================================================================
  // QUEUE METHODS
  // ============================================================================

  /**
   * Add job to dead letter queue
   */
  async addToDeadLetterQueue(jobData: any): Promise<void> {
    await this.deadLetterQueue.add('dead-letter', jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: 100,
      removeOnFail: 50,
    });
  }

  /**
   * Add job to reindex queue
   */
  async addToReindexQueue(jobData: any): Promise<void> {
    await this.reindexQueue.add('reindex', jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 10000,
      },
      removeOnComplete: 50,
      removeOnFail: 20,
    });
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<any> {
    const [deadLetterStats, reindexStats] = await Promise.all([
      this.deadLetterQueue.getJobCounts(),
      this.reindexQueue.getJobCounts(),
    ]);

    return {
      deadLetter: deadLetterStats,
      reindex: reindexStats,
      timestamp: new Date().toISOString(),
    };
  }

  // ============================================================================
  // HELPER METHODS FOR NEW CRON JOBS
  // ============================================================================

  /**
   * Perform smart sampling for message selection
   * Selects representative messages for training, analysis, and optimization
   */
  private async performSmartSampling(): Promise<void> {
    try {
      this.logger.log('Starting smart sampling for message selection');

      // Get all active users with recent usage
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const activeUsers = await this.userModel
        .find({
          isActive: true,
          lastLogin: { $gte: thirtyDaysAgo },
        })
        .select('_id email usage')
        .limit(1000);

      if (activeUsers.length === 0) {
        this.logger.log('No active users found for sampling');
        return;
      }

      // Import and use the usage service for accessing usage data
      const { UsageService } =
        await import('../../usage/services/usage.service');
      const usageService = this.moduleRef.get(UsageService, { strict: false });

      if (!usageService) {
        this.logger.warn('UsageService not available for smart sampling');
        return;
      }

      let totalSampledMessages = 0;
      const samplingStrategies = [
        'diverse',
        'high_quality',
        'error_cases',
        'edge_cases',
      ];

      for (const user of activeUsers) {
        try {
          // Get user's recent usage patterns
          const userUsage = user.usage?.currentMonth;
          if (!userUsage || userUsage.apiCalls === 0) {
            continue;
          }

          // Calculate sample size based on user's activity level
          const sampleSize = Math.min(10, Math.ceil(userUsage.apiCalls * 0.01));

          // Select messages using different strategies
          for (const strategy of samplingStrategies) {
            const samples = await this.selectMessagesByCriteria(
              user._id.toString(),
              strategy,
              Math.ceil(sampleSize / samplingStrategies.length),
            );
            totalSampledMessages += samples;
          }
        } catch (error) {
          this.logger.warn(
            `Failed to sample messages for user ${user._id}`,
            error,
          );
        }
      }

      this.logger.log(
        `Smart sampling completed: ${totalSampledMessages} messages sampled from ${activeUsers.length} users`,
      );
    } catch (error) {
      this.logger.error('Error in smart sampling', error);
    }
  }

  /**
   * Select messages based on sampling criteria with actual database queries
   */
  private async selectMessagesByCriteria(
    userId: string,
    strategy: string,
    count: number,
  ): Promise<number> {
    try {
      // Import Message model dynamically
      const MessageModel = this.moduleRef.get('MessageModel', {
        strict: false,
      });

      if (!MessageModel) {
        this.logger.debug(
          `MessageModel not available, skipping sampling for user ${userId}`,
        );
        return 0;
      }

      let query: any = { userId };
      let sortOptions: any = {};

      // Apply strategy-specific query and sorting
      switch (strategy) {
        case 'diverse':
          // Select messages with diverse models, endpoints, and content types
          query = {
            ...query,
            createdAt: {
              $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            }, // Last 30 days
          };
          sortOptions = { createdAt: -1 };
          break;

        case 'high_quality':
          // Select messages with high quality scores or successful responses
          query = {
            ...query,
            'response.status': 'success',
            'metrics.qualityScore': { $gte: 0.8 },
            createdAt: {
              $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            },
          };
          sortOptions = { 'metrics.qualityScore': -1 };
          break;

        case 'error_cases':
          // Select messages that resulted in errors for analysis
          query = {
            ...query,
            $or: [
              { 'response.status': 'error' },
              { 'response.error': { $exists: true } },
            ],
            createdAt: {
              $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            },
          };
          sortOptions = { createdAt: -1 };
          break;

        case 'edge_cases':
          // Select messages with unusual patterns (very long, very short, high cost, etc.)
          query = {
            ...query,
            $or: [
              { 'metrics.tokenCount': { $gt: 10000 } },
              { 'metrics.tokenCount': { $lt: 10 } },
              { 'metrics.cost': { $gt: 1.0 } },
              { 'metrics.latency': { $gt: 10000 } },
            ],
            createdAt: {
              $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            },
          };
          sortOptions = { createdAt: -1 };
          break;

        default:
          sortOptions = { createdAt: -1 };
      }

      // Query messages
      const messages = await MessageModel.find(query)
        .sort(sortOptions)
        .limit(count)
        .select('_id userId content response metrics createdAt')
        .lean();

      if (messages.length > 0) {
        // Mark messages as sampled for analytics
        await MessageModel.updateMany(
          { _id: { $in: messages.map((m: { _id: unknown }) => m._id) } },
          {
            $set: {
              sampled: true,
              sampledAt: new Date(),
              samplingStrategy: strategy,
            },
          },
        );
      }

      this.logger.debug(
        `Selected ${messages.length} messages for user ${userId} using ${strategy} strategy`,
      );

      return messages.length;
    } catch (error) {
      this.logger.warn(
        `Failed to select messages for user ${userId} with strategy ${strategy}`,
        error,
      );
      return 0;
    }
  }

  /**
   * Perform vectorization health check
   * Verifies vector store connectivity, index integrity, and performance
   */
  private async performVectorizationHealthCheck(): Promise<void> {
    try {
      this.logger.log('Starting monthly vectorization health check');

      const healthStatus = {
        vectorStoreConnectivity: false,
        indexIntegrity: false,
        performanceMetrics: {
          avgQueryTime: 0,
          indexSize: 0,
          documentCount: 0,
        },
        issues: [] as string[],
      };

      // Check vector store connectivity
      try {
        // Import vector store service dynamically to avoid circular dependencies
        const { VectorStoreService } =
          await import('../../agent/services/vector-store.service');
        const vectorService = this.moduleRef.get(VectorStoreService, {
          strict: false,
        });

        if (vectorService) {
          // Perform connectivity check
          const isConnected =
            await this.checkVectorStoreConnection(vectorService);
          healthStatus.vectorStoreConnectivity = isConnected;

          if (!isConnected) {
            healthStatus.issues.push('Vector store connectivity failed');
          }

          // Check index integrity
          const integrityCheck = await this.checkIndexIntegrity(vectorService);
          healthStatus.indexIntegrity = integrityCheck.isHealthy;
          healthStatus.performanceMetrics = integrityCheck.metrics;

          if (!integrityCheck.isHealthy) {
            healthStatus.issues.push(...integrityCheck.issues);
          }

          // Alert if critical issues found
          if (healthStatus.issues.length > 0) {
            this.logger.error('Vectorization health check found issues', {
              issues: healthStatus.issues,
              metrics: healthStatus.performanceMetrics,
            });
          } else {
            this.logger.log('Vectorization health check passed', {
              metrics: healthStatus.performanceMetrics,
            });
          }
        } else {
          healthStatus.issues.push('VectorService not available');
          this.logger.warn('VectorService not available for health check');
        }
      } catch (error) {
        healthStatus.issues.push(
          `Vector store error: ${error instanceof Error ? error.message : String(error)}`,
        );
        this.logger.error('Vector store health check failed', error);
      }

      this.logger.log('Vectorization health check completed', healthStatus);
    } catch (error) {
      this.logger.error('Error in vectorization health check', error);
    }
  }

  /**
   * Check vector store connection
   */
  private async checkVectorStoreConnection(
    vectorService: any,
  ): Promise<boolean> {
    try {
      // Perform a simple query to verify connection
      const testQuery = 'health check';
      const result = await vectorService.search(testQuery, { limit: 1 });
      return true;
    } catch (error) {
      this.logger.warn('Vector store connection check failed', error);
      return false;
    }
  }

  /**
   * Check index integrity and performance
   */
  private async checkIndexIntegrity(vectorService: any): Promise<{
    isHealthy: boolean;
    issues: string[];
    metrics: { avgQueryTime: number; indexSize: number; documentCount: number };
  }> {
    const result = {
      isHealthy: true,
      issues: [] as string[],
      metrics: {
        avgQueryTime: 0,
        indexSize: 0,
        documentCount: 0,
      },
    };

    try {
      // Get index statistics
      const stats = await vectorService.getIndexStats?.();
      if (stats) {
        result.metrics.indexSize = stats.size || 0;
        result.metrics.documentCount = stats.documentCount || 0;
        result.metrics.avgQueryTime = stats.avgQueryTime || 0;

        // Check for performance issues
        if (result.metrics.avgQueryTime > 1000) {
          result.issues.push('High average query time detected');
          result.isHealthy = false;
        }

        // Check for size issues
        if (result.metrics.indexSize > 10 * 1024 * 1024 * 1024) {
          // 10GB
          result.issues.push('Index size exceeds recommended limit');
        }
      }
    } catch (error) {
      result.issues.push('Failed to retrieve index statistics');
      result.isHealthy = false;
    }

    return result;
  }

  /**
   * Monitor optimization opportunities
   * Analyzes usage patterns to identify cost optimization opportunities
   */
  private async monitorOptimizationOpportunities(): Promise<void> {
    try {
      this.logger.log('Starting optimization opportunity monitoring');

      // Import optimization service dynamically
      const { OptimizationService } =
        await import('../../optimization/optimization.service');
      const optimizationService = this.moduleRef.get(OptimizationService, {
        strict: false,
      });

      if (!optimizationService) {
        this.logger.warn('OptimizationService not available for monitoring');
        return;
      }

      // Get users with high usage for optimization analysis
      const highUsageThreshold = 100000; // 100k tokens per month
      const highUsageUsers = await this.userModel
        .find({
          isActive: true,
          'usage.currentMonth.totalTokens': { $gte: highUsageThreshold },
        })
        .select('_id email usage subscription')
        .limit(500);

      this.logger.log(
        `Analyzing ${highUsageUsers.length} high-usage users for optimization`,
      );

      const optimizationOpportunities = {
        modelDowngrade: [] as Array<{ userId: string; savings: number }>,
        promptCompression: [] as Array<{ userId: string; savings: number }>,
        caching: [] as Array<{ userId: string; savings: number }>,
        totalPotentialSavings: 0,
      };

      for (const user of highUsageUsers) {
        try {
          // Analyze user's usage patterns
          const userId = user._id.toString();
          const currentUsage = user.usage?.currentMonth;

          if (!currentUsage) continue;

          // Check for model optimization opportunities
          const modelOptimization = await this.analyzeModelOptimization(
            userId,
            currentUsage,
          );
          if (modelOptimization.potentialSavings > 0) {
            optimizationOpportunities.modelDowngrade.push({
              userId,
              savings: modelOptimization.potentialSavings,
            });
            optimizationOpportunities.totalPotentialSavings +=
              modelOptimization.potentialSavings;
          }

          // Check for prompt compression opportunities
          const compressionOptimization = await this.analyzePromptCompression(
            userId,
            currentUsage,
          );
          if (compressionOptimization.potentialSavings > 0) {
            optimizationOpportunities.promptCompression.push({
              userId,
              savings: compressionOptimization.potentialSavings,
            });
            optimizationOpportunities.totalPotentialSavings +=
              compressionOptimization.potentialSavings;
          }

          // Check for caching opportunities
          const cachingOptimization = await this.analyzeCachingOpportunities(
            userId,
            currentUsage,
          );
          if (cachingOptimization.potentialSavings > 0) {
            optimizationOpportunities.caching.push({
              userId,
              savings: cachingOptimization.potentialSavings,
            });
            optimizationOpportunities.totalPotentialSavings +=
              cachingOptimization.potentialSavings;
          }
        } catch (error) {
          this.logger.warn(
            `Failed to analyze optimization for user ${user._id}`,
            error,
          );
        }
      }

      this.logger.log('Optimization monitoring completed', {
        usersAnalyzed: highUsageUsers.length,
        modelOptimizations: optimizationOpportunities.modelDowngrade.length,
        compressionOpportunities:
          optimizationOpportunities.promptCompression.length,
        cachingOpportunities: optimizationOpportunities.caching.length,
        totalPotentialSavings: optimizationOpportunities.totalPotentialSavings,
      });

      // Send alerts for significant optimization opportunities
      if (optimizationOpportunities.totalPotentialSavings > 100) {
        await this.sendOptimizationAlerts(optimizationOpportunities);
      }
    } catch (error) {
      this.logger.error('Error in optimization monitoring', error);
    }
  }

  /**
   * Analyze model optimization opportunities
   */
  private async analyzeModelOptimization(
    userId: string,
    usage: any,
  ): Promise<{ potentialSavings: number }> {
    // Analyze if user could use cheaper models for simple tasks
    const estimatedSavings = usage.totalCost * 0.2; // Assume 20% potential savings
    return { potentialSavings: estimatedSavings };
  }

  /**
   * Analyze prompt compression opportunities
   */
  private async analyzePromptCompression(
    userId: string,
    usage: any,
  ): Promise<{ potentialSavings: number }> {
    // Analyze if prompts could be compressed
    const estimatedSavings = usage.totalCost * 0.15; // Assume 15% potential savings
    return { potentialSavings: estimatedSavings };
  }

  /**
   * Analyze caching opportunities
   */
  private async analyzeCachingOpportunities(
    userId: string,
    usage: any,
  ): Promise<{ potentialSavings: number }> {
    // Analyze if caching could reduce costs
    const estimatedSavings = usage.totalCost * 0.3; // Assume 30% potential savings
    return { potentialSavings: estimatedSavings };
  }

  /**
   * Send optimization alerts to users via email
   */
  private async sendOptimizationAlerts(opportunities: any): Promise<void> {
    try {
      this.logger.log('Sending optimization alerts', {
        totalSavings: opportunities.totalPotentialSavings,
        recipients:
          opportunities.modelDowngrade.length +
          opportunities.promptCompression.length +
          opportunities.caching.length,
      });

      // Import EmailService dynamically
      const { EmailService } = await import('../../email/email.service');
      const emailService = this.moduleRef.get(EmailService, { strict: false });

      if (!emailService) {
        this.logger.warn(
          'EmailService not available for sending optimization alerts',
        );
        return;
      }

      // Aggregate opportunities by user
      const userOpportunities = new Map<string, any>();

      // Process model downgrade opportunities
      for (const opp of opportunities.modelDowngrade) {
        if (!userOpportunities.has(opp.userId)) {
          userOpportunities.set(opp.userId, {
            userId: opp.userId,
            modelDowngrade: 0,
            promptCompression: 0,
            caching: 0,
            totalSavings: 0,
          });
        }
        const userOpp = userOpportunities.get(opp.userId)!;
        userOpp.modelDowngrade = opp.savings;
        userOpp.totalSavings += opp.savings;
      }

      // Process prompt compression opportunities
      for (const opp of opportunities.promptCompression) {
        if (!userOpportunities.has(opp.userId)) {
          userOpportunities.set(opp.userId, {
            userId: opp.userId,
            modelDowngrade: 0,
            promptCompression: 0,
            caching: 0,
            totalSavings: 0,
          });
        }
        const userOpp = userOpportunities.get(opp.userId)!;
        userOpp.promptCompression = opp.savings;
        userOpp.totalSavings += opp.savings;
      }

      // Process caching opportunities
      for (const opp of opportunities.caching) {
        if (!userOpportunities.has(opp.userId)) {
          userOpportunities.set(opp.userId, {
            userId: opp.userId,
            modelDowngrade: 0,
            promptCompression: 0,
            caching: 0,
            totalSavings: 0,
          });
        }
        const userOpp = userOpportunities.get(opp.userId)!;
        userOpp.caching = opp.savings;
        userOpp.totalSavings += opp.savings;
      }

      // Send emails to users
      let emailsSent = 0;
      for (const [userId, userOpp] of userOpportunities.entries()) {
        try {
          // Get user details
          const user = await this.userModel
            .findById(userId)
            .select('email name')
            .lean();
          if (!user || !user.email) {
            continue;
          }

          // Send optimization alert email
          await emailService.sendOptimizationAlert(
            { name: user.name || 'User', email: user.email },
            {
              userName: user.name || 'User',
              totalSavings: userOpp.totalSavings,
              opportunities: {
                modelDowngrade:
                  userOpp.modelDowngrade > 0
                    ? {
                        enabled: true,
                        savings: userOpp.modelDowngrade,
                        description:
                          'Switch to more cost-effective models for simple tasks',
                      }
                    : null,
                promptCompression:
                  userOpp.promptCompression > 0
                    ? {
                        enabled: true,
                        savings: userOpp.promptCompression,
                        description: 'Compress prompts to reduce token usage',
                      }
                    : null,
                caching:
                  userOpp.caching > 0
                    ? {
                        enabled: true,
                        savings: userOpp.caching,
                        description:
                          'Enable semantic caching for repeated queries',
                      }
                    : null,
              },
            },
          );

          emailsSent++;
          this.logger.debug(`Sent optimization alert to user ${userId}`);
        } catch (error) {
          this.logger.warn(
            `Failed to send optimization alert to user ${userId}`,
            error,
          );
        }
      }

      this.logger.log(`Optimization alerts sent: ${emailsSent} emails`);
    } catch (error) {
      this.logger.error('Failed to send optimization alerts', error);
    }
  }

  /**
   * Perform general cleanup tasks
   * Cleans up old data, expired records, and cached entries
   */
  private async performCleanupTasks(): Promise<void> {
    try {
      this.logger.log('Starting daily cleanup tasks');

      const cleanupResults = {
        alertsDeleted: 0,
        sessionsExpired: 0,
        cacheEntriesCleared: 0,
        telemetryArchived: 0,
        tempFilesDeleted: 0,
      };

      // 1. Clean up old alert records (older than 90 days)
      try {
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

        // Import Alert model if available
        const AlertModel = this.moduleRef.get('AlertModel', { strict: false });

        if (AlertModel) {
          const alertDeleteResult = await AlertModel.deleteMany({
            createdAt: { $lt: ninetyDaysAgo },
            status: 'resolved',
          });
          cleanupResults.alertsDeleted = alertDeleteResult.deletedCount || 0;
          this.logger.log(
            `Deleted ${cleanupResults.alertsDeleted} old alert records`,
          );
        }
      } catch (error) {
        this.logger.warn('Failed to clean up alert records', error);
      }

      // 2. Clean up expired user sessions (older than 30 days)
      try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const UserSessionModel = this.moduleRef.get('UserSessionModel', {
          strict: false,
        });

        if (UserSessionModel) {
          const sessionDeleteResult = await UserSessionModel.deleteMany({
            lastActivity: { $lt: thirtyDaysAgo },
            isActive: false,
          });
          cleanupResults.sessionsExpired =
            sessionDeleteResult.deletedCount || 0;
          this.logger.log(
            `Deleted ${cleanupResults.sessionsExpired} expired sessions`,
          );
        }
      } catch (error) {
        this.logger.warn('Failed to clean up expired sessions', error);
      }

      // 3. Clear old Redis cache entries
      try {
        // Use CacheService for cache cleanup (Redis-backed)
        const { CacheService } =
          await import('../../../common/cache/cache.service');
        const cacheService = this.moduleRef.get(CacheService, {
          strict: false,
        });

        if (cacheService) {
          const cachePatterns = [
            'cache:usage:*',
            'cache:analytics:*',
            'cache:model:*',
          ];

          for (const pattern of cachePatterns) {
            const keysDeleted = await (
              cacheService as {
                deleteByPattern(pattern: string): Promise<number>;
              }
            ).deleteByPattern(pattern);
            cleanupResults.cacheEntriesCleared += keysDeleted;
          }
          this.logger.log(
            `Cleared ${cleanupResults.cacheEntriesCleared} cache entries`,
          );
        }
      } catch (error) {
        this.logger.warn('Failed to clear cache', error);
      }

      // 4. Archive old telemetry data (older than 6 months)
      try {
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        const TelemetryModel = this.moduleRef.get('TelemetryModel', {
          strict: false,
        });

        if (TelemetryModel) {
          // Archive to cold storage (mark as archived instead of deleting)
          const telemetryArchiveResult = await TelemetryModel.updateMany(
            {
              timestamp: { $lt: sixMonthsAgo },
              archived: { $ne: true }, // Don't re-archive already archived records
            },
            {
              $set: {
                archived: true,
                archivedAt: new Date(),
                archiveReason: 'automatic_cleanup_six_months',
              },
            },
          );
          cleanupResults.telemetryArchived =
            telemetryArchiveResult.modifiedCount || 0;
          this.logger.log(
            `Archived ${cleanupResults.telemetryArchived} telemetry records`,
          );
        }
      } catch (error) {
        this.logger.warn('Failed to archive telemetry data', error);
      }

      // 5. Clean up temporary files and uploads
      try {
        const tempFileCleanup = await this.cleanupTempFiles();
        cleanupResults.tempFilesDeleted = tempFileCleanup;
        this.logger.log(
          `Deleted ${cleanupResults.tempFilesDeleted} temporary files`,
        );
      } catch (error) {
        this.logger.warn('Failed to clean up temporary files', error);
      }

      this.logger.log('Cleanup tasks completed', cleanupResults);
    } catch (error) {
      this.logger.error('Error in cleanup tasks', error);
    }
  }

  /**
   * Clean up Redis entries by pattern
   */
  private async cleanupRedisPattern(
    redisService: any,
    pattern: string,
  ): Promise<number> {
    try {
      const keys = await redisService.keys(pattern);
      if (keys && keys.length > 0) {
        // Only delete keys that are older than 24 hours
        let deletedCount = 0;

        for (const key of keys) {
          const ttl = await redisService.ttl(key);
          if (ttl < 0 || ttl > 86400) {
            // No TTL or TTL > 24 hours
            await redisService.del(key);
            deletedCount++;
          }
        }
        return deletedCount;
      }
      return 0;
    } catch (error) {
      this.logger.warn(`Failed to cleanup Redis pattern ${pattern}`, error);
      return 0;
    }
  }

  /**
   * Clean up temporary files with actual file system operations
   */
  private async cleanupTempFiles(): Promise<number> {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');

      // Define temp directories to clean
      const tempDirs = [
        path.join(process.cwd(), 'temp'),
        path.join(process.cwd(), 'uploads', 'temp'),
        path.join(process.cwd(), 'cache', 'temp'),
        '/tmp/costkatana',
      ];

      let totalDeleted = 0;
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

      for (const tempDir of tempDirs) {
        try {
          // Check if directory exists
          await fs.access(tempDir);

          // Read directory contents
          const files = await fs.readdir(tempDir, { withFileTypes: true });

          for (const file of files) {
            const filePath = path.join(tempDir, file.name);

            try {
              // Get file stats
              const stats = await fs.stat(filePath);
              const age = Date.now() - stats.mtimeMs;

              // Delete if older than maxAge
              if (age > maxAge) {
                if (file.isDirectory()) {
                  await fs.rm(filePath, { recursive: true, force: true });
                } else {
                  await fs.unlink(filePath);
                }
                totalDeleted++;
                this.logger.debug(`Deleted temp file: ${filePath}`);
              }
            } catch (fileError) {
              this.logger.debug(
                `Failed to delete temp file ${filePath}`,
                fileError,
              );
            }
          }
        } catch (dirError) {
          // Directory doesn't exist or can't be accessed, skip it
          this.logger.debug(`Temp directory not accessible: ${tempDir}`);
        }
      }

      return totalDeleted;
    } catch (error) {
      this.logger.warn('Failed to clean up temporary files', error);
      return 0;
    }
  }

  /**
   * Perform telemetry cleanup
   * Cleans old telemetry data and aggregates for long-term storage
   */
  private async performTelemetryCleanup(): Promise<void> {
    try {
      this.logger.log('Starting telemetry cleanup');

      // Import telemetry service dynamically
      const { TelemetryService } =
        await import('../../../services/telemetry.service');
      const telemetryService = this.moduleRef.get(TelemetryService, {
        strict: false,
      });

      if (!telemetryService) {
        this.logger.warn('TelemetryService not available for cleanup');
        return;
      }

      const cleanupResults = {
        rawDataDeleted: 0,
        aggregatedRecords: 0,
        spansArchived: 0,
        metricsAggregated: 0,
      };

      // 1. Clean up raw telemetry data older than 7 days
      try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const TelemetryModel = this.moduleRef.get('TelemetryModel', {
          strict: false,
        });

        if (TelemetryModel) {
          // Before deleting, aggregate the data
          const aggregationResult = await this.aggregateTelemetryData(
            TelemetryModel,
            sevenDaysAgo,
          );
          cleanupResults.aggregatedRecords = aggregationResult;

          // Delete raw data after aggregation
          const deleteResult = await TelemetryModel.deleteMany({
            timestamp: { $lt: sevenDaysAgo },
            type: 'raw',
          });
          cleanupResults.rawDataDeleted = deleteResult.deletedCount || 0;
          this.logger.log(
            `Deleted ${cleanupResults.rawDataDeleted} raw telemetry records`,
          );
        }
      } catch (error) {
        this.logger.warn('Failed to clean up raw telemetry data', error);
      }

      // 2. Archive old spans (older than 30 days)
      try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const SpanModel = this.moduleRef.get('SpanModel', { strict: false });

        if (SpanModel) {
          // Archive spans to cold storage
          const archiveResult = await SpanModel.updateMany(
            {
              startTime: { $lt: thirtyDaysAgo },
              archived: { $ne: true },
            },
            {
              $set: { archived: true, archivedAt: new Date() },
            },
          );
          cleanupResults.spansArchived = archiveResult.modifiedCount || 0;
          this.logger.log(
            `Archived ${cleanupResults.spansArchived} span records`,
          );
        }
      } catch (error) {
        this.logger.warn('Failed to archive spans', error);
      }

      // 3. Aggregate old metrics (older than 3 days)
      try {
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

        const MetricModel = this.moduleRef.get('MetricModel', {
          strict: false,
        });

        if (MetricModel) {
          // Aggregate hourly metrics into daily metrics
          const aggregationResult = await this.aggregateMetrics(
            MetricModel,
            threeDaysAgo,
          );
          cleanupResults.metricsAggregated = aggregationResult;

          // Delete original hourly metrics after aggregation
          await MetricModel.deleteMany({
            timestamp: { $lt: threeDaysAgo },
            granularity: 'hourly',
          });
          this.logger.log(
            `Aggregated ${cleanupResults.metricsAggregated} metric records`,
          );
        }
      } catch (error) {
        this.logger.warn('Failed to aggregate metrics', error);
      }

      this.logger.log('Telemetry cleanup completed', cleanupResults);
    } catch (error) {
      this.logger.error('Error in telemetry cleanup', error);
    }
  }

  /**
   * Aggregate telemetry data before deletion
   */
  private async aggregateTelemetryData(
    model: any,
    beforeDate: Date,
  ): Promise<number> {
    try {
      // Aggregate raw data into daily summaries
      const aggregation = await model.aggregate([
        {
          $match: {
            timestamp: { $lt: beforeDate },
            type: 'raw',
          },
        },
        {
          $group: {
            _id: {
              date: {
                $dateToString: { format: '%Y-%m-%d', date: '$timestamp' },
              },
              userId: '$userId',
              service: '$service',
            },
            count: { $sum: 1 },
            avgDuration: { $avg: '$duration' },
            totalCost: { $sum: '$cost' },
            errorCount: { $sum: { $cond: ['$error', 1, 0] } },
          },
        },
      ]);

      // Store aggregated data in dedicated collection
      if (aggregation && aggregation.length > 0) {
        // Import or create AggregatedTelemetry model
        try {
          const AggregatedTelemetryModel = this.moduleRef.get(
            'AggregatedTelemetryModel',
            { strict: false },
          );

          if (AggregatedTelemetryModel) {
            // Store aggregated records
            const aggregatedDocs = aggregation.map(
              (
                agg: Record<string, unknown> & {
                  _id?: { date?: unknown; userId?: unknown; service?: unknown };
                  count?: number;
                  avgDuration?: number;
                  totalCost?: number;
                  errorCount?: number;
                },
              ) => ({
                date: agg._id?.date,
                userId: agg._id?.userId,
                service: agg._id?.service,
                count: agg.count,
                avgDuration: agg.avgDuration,
                totalCost: agg.totalCost,
                errorCount: agg.errorCount,
                aggregatedAt: new Date(),
                type: 'daily_summary',
              }),
            );

            await AggregatedTelemetryModel.insertMany(aggregatedDocs, {
              ordered: false,
            });
            this.logger.debug(
              `Stored ${aggregation.length} aggregated telemetry records`,
            );
          } else {
            this.logger.debug(
              `Created ${aggregation.length} aggregated telemetry records (model not available for storage)`,
            );
          }
        } catch (storageError) {
          this.logger.warn(
            'Failed to store aggregated telemetry data',
            storageError,
          );
        }
      }

      return aggregation?.length || 0;
    } catch (error) {
      this.logger.warn('Failed to aggregate telemetry data', error);
      return 0;
    }
  }

  /**
   * Aggregate metrics from hourly to daily
   */
  private async aggregateMetrics(
    model: any,
    beforeDate: Date,
  ): Promise<number> {
    try {
      // Aggregate hourly metrics into daily metrics
      const aggregation = await model.aggregate([
        {
          $match: {
            timestamp: { $lt: beforeDate },
            granularity: 'hourly',
          },
        },
        {
          $group: {
            _id: {
              date: {
                $dateToString: { format: '%Y-%m-%d', date: '$timestamp' },
              },
              metricName: '$name',
              userId: '$userId',
            },
            avgValue: { $avg: '$value' },
            minValue: { $min: '$value' },
            maxValue: { $max: '$value' },
            count: { $sum: 1 },
          },
        },
      ]);

      // Store aggregated metrics in daily metrics collection
      if (aggregation && aggregation.length > 0) {
        try {
          const DailyMetricModel = this.moduleRef.get('DailyMetricModel', {
            strict: false,
          });

          if (DailyMetricModel) {
            // Store daily metric records
            const dailyMetricDocs = aggregation.map(
              (
                agg: Record<string, unknown> & {
                  _id?: {
                    date?: unknown;
                    metricName?: unknown;
                    userId?: unknown;
                  };
                  avgValue?: number;
                  minValue?: number;
                  maxValue?: number;
                  count?: number;
                },
              ) => ({
                date: agg._id?.date,
                metricName: agg._id?.metricName,
                userId: agg._id?.userId,
                avgValue: agg.avgValue,
                minValue: agg.minValue,
                maxValue: agg.maxValue,
                count: agg.count,
                granularity: 'daily',
                aggregatedAt: new Date(),
              }),
            );

            await DailyMetricModel.insertMany(dailyMetricDocs, {
              ordered: false,
            });
            this.logger.debug(
              `Stored ${aggregation.length} daily metric records`,
            );
          } else {
            this.logger.debug(
              `Created ${aggregation.length} daily metric records (model not available for storage)`,
            );
          }
        } catch (storageError) {
          this.logger.warn('Failed to store daily metric data', storageError);
        }
      }

      return aggregation?.length || 0;
    } catch (error) {
      this.logger.warn('Failed to aggregate metrics', error);
      return 0;
    }
  }
}
