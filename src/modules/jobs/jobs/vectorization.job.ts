import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

interface ProcessingStats {
  processed: number;
  success: number;
  failed: number;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  errors: string[];
  skipped?: number;
}

interface VectorizationDocument {
  _id: string;
  content: string;
  contentType:
    | 'user_memory'
    | 'conversation'
    | 'message'
    | 'document'
    | 'telemetry';
  userId?: string;
  tenantId?: string;
  metadata?: Record<string, any>;
  vectorizedAt?: Date;
  vector?: number[];
  vectorizationStatus: 'pending' | 'processing' | 'completed' | 'failed';
  vectorizationAttempts: number;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface EmbeddingRequest {
  input: string | string[];
  model?: string;
  user?: string;
}

interface EmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
    object: string;
  }>;
  model: string;
  object: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

@Injectable()
export class VectorizationJob {
  private readonly logger = new Logger(VectorizationJob.name);
  private isRunning = false;

  // Configuration constants
  private readonly BATCH_SIZE = 25;
  private readonly MAX_CONTENT_LENGTH = 8192;
  private readonly MAX_RETRIES = 3;
  private readonly EMBEDDING_MODEL = 'text-embedding-3-small';
  private readonly PROCESSING_TIMEOUT = 300000; // 5 minutes

  constructor(
    @InjectModel('VectorizationDocument')
    private vectorizationModel: Model<VectorizationDocument>,
    private readonly httpService: HttpService,
  ) {}

  /**
   * Run the vectorization job
   */
  async run(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        'Vectorization job already running, skipping this cycle',
      );
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      this.logger.log('🔄 Starting vectorization job...');

      // Process different types of content
      const results = await Promise.allSettled([
        this.processUserMemories(),
        this.processConversations(),
        this.processMessages(),
        this.processDocuments(),
        this.processTelemetryData(),
      ]);

      let totalProcessed = 0;
      let totalSuccess = 0;
      let totalFailed = 0;
      let totalSkipped = 0;
      const allErrors: string[] = [];

      results.forEach((result, index) => {
        const contentTypes = [
          'user_memories',
          'conversations',
          'messages',
          'documents',
          'telemetry',
        ];
        const contentType = contentTypes[index];

        if (result.status === 'fulfilled') {
          const stats = result.value;
          totalProcessed += stats.processed;
          totalSuccess += stats.success;
          totalFailed += stats.failed;
          totalSkipped += stats.skipped || 0;

          this.logger.log(`✅ ${contentType} vectorization completed`, {
            processed: stats.processed,
            success: stats.success,
            failed: stats.failed,
            skipped: stats.skipped || 0,
            duration: stats.duration,
          });
        } else {
          totalFailed += 1;
          allErrors.push(`${contentType}: ${result.reason}`);
          this.logger.error(
            `❌ ${contentType} vectorization failed`,
            result.reason,
          );
        }
      });

      const duration = Date.now() - startTime;
      this.logger.log('✅ Vectorization job completed', {
        totalProcessed,
        totalSuccess,
        totalFailed,
        totalSkipped,
        durationMs: duration,
        errors: allErrors.length > 0 ? allErrors : undefined,
      });

      // Update vectorization health status
      await this.updateVectorizationHealth();
    } catch (error) {
      this.logger.error('❌ Vectorization job failed', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Process pending user memories
   */
  async processUserMemories(): Promise<ProcessingStats> {
    return this.processContentType('user_memory', {
      vectorizedAt: { $exists: false },
      vectorizationStatus: { $ne: 'completed' },
      vectorizationAttempts: { $lt: this.MAX_RETRIES },
    });
  }

  /**
   * Process pending conversations
   */
  async processConversations(): Promise<ProcessingStats> {
    return this.processContentType('conversation', {
      vectorizedAt: { $exists: false },
      vectorizationStatus: { $ne: 'completed' },
      vectorizationAttempts: { $lt: this.MAX_RETRIES },
    });
  }

  /**
   * Process pending messages
   */
  async processMessages(): Promise<ProcessingStats> {
    return this.processContentType('message', {
      vectorizedAt: { $exists: false },
      vectorizationStatus: { $ne: 'completed' },
      vectorizationAttempts: { $lt: this.MAX_RETRIES },
      // Only vectorize high-value messages
      'metadata.importance': { $gte: 0.7 },
    });
  }

  /**
   * Process pending documents
   */
  private async processDocuments(): Promise<ProcessingStats> {
    return this.processContentType('document', {
      vectorizedAt: { $exists: false },
      vectorizationStatus: { $ne: 'completed' },
      vectorizationAttempts: { $lt: this.MAX_RETRIES },
    });
  }

  /**
   * Process pending telemetry data
   */
  private async processTelemetryData(): Promise<ProcessingStats> {
    return this.processContentType('telemetry', {
      vectorizedAt: { $exists: false },
      vectorizationStatus: { $ne: 'completed' },
      vectorizationAttempts: { $lt: this.MAX_RETRIES },
      // Only vectorize telemetry with sufficient data points
      'metadata.dataPoints': { $gte: 10 },
    });
  }

  /**
   * Generic content processing method
   */
  private async processContentType(
    contentType: string,
    query: Record<string, any>,
  ): Promise<ProcessingStats> {
    const stats: ProcessingStats = {
      processed: 0,
      success: 0,
      failed: 0,
      startTime: new Date(),
      errors: [],
    };

    try {
      this.logger.log(`📄 Processing ${contentType} documents...`);

      // Find documents to process
      const documents = await this.vectorizationModel
        .find({
          contentType,
          ...query,
          // Skip documents that are too old or too large
          createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // Last 30 days
          content: { $exists: true, $ne: '' },
        })
        .sort({ createdAt: -1 })
        .limit(100) // Process in batches
        .exec();

      if (documents.length === 0) {
        this.logger.log(`ℹ️ No ${contentType} documents to process`);
        stats.endTime = new Date();
        stats.duration = stats.endTime.getTime() - stats.startTime.getTime();
        return stats;
      }

      this.logger.log(
        `📄 Found ${documents.length} ${contentType} documents to process`,
      );

      // Process in batches
      const batches = this.chunkArray(documents, this.BATCH_SIZE);

      for (const batch of batches) {
        try {
          await this.processBatch(batch, stats);
        } catch (error) {
          this.logger.error(`Failed to process ${contentType} batch`, error);
          stats.errors.push(
            `Batch processing failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        // Rate limiting between batches
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error) {
      this.logger.error(`Failed to process ${contentType}`, error);
      stats.errors.push(error instanceof Error ? error.message : String(error));
    }

    stats.endTime = new Date();
    stats.duration = stats.endTime.getTime() - stats.startTime.getTime();

    return stats;
  }

  /**
   * Process a batch of documents
   */
  private async processBatch(
    documents: VectorizationDocument[],
    stats: ProcessingStats,
  ): Promise<void> {
    // Prepare texts for embedding
    const texts = documents.map((doc) => {
      let text = doc.content;

      // Truncate if too long
      if (text.length > this.MAX_CONTENT_LENGTH) {
        text = text.substring(0, this.MAX_CONTENT_LENGTH) + '...';
      }

      // Add metadata context if available
      if (doc.metadata?.context) {
        text = `${doc.metadata.context}: ${text}`;
      }

      return text;
    });

    try {
      // Generate embeddings
      const embeddings = await this.generateEmbeddings(texts);

      // Update documents with embeddings
      for (let i = 0; i < documents.length; i++) {
        const doc = documents[i];
        const embedding = embeddings[i];

        try {
          await this.vectorizationModel.updateOne(
            { _id: doc._id },
            {
              $set: {
                vector: embedding,
                vectorizedAt: new Date(),
                vectorizationStatus: 'completed',
                updatedAt: new Date(),
              },
              $unset: {
                lastError: 1,
              },
            },
          );

          stats.success++;
        } catch (error) {
          await this.vectorizationModel.updateOne(
            { _id: doc._id },
            {
              $set: {
                vectorizationStatus: 'failed',
                lastError:
                  error instanceof Error ? error.message : String(error),
                vectorizationAttempts: (doc.vectorizationAttempts || 0) + 1,
                updatedAt: new Date(),
              },
            },
          );

          stats.failed++;
          stats.errors.push(
            `Document ${doc._id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        stats.processed++;
      }
    } catch (error) {
      this.logger.error('Failed to generate embeddings for batch', error);

      // Mark all documents in batch as failed
      for (const doc of documents) {
        try {
          await this.vectorizationModel.updateOne(
            { _id: doc._id },
            {
              $set: {
                vectorizationStatus: 'failed',
                lastError:
                  error instanceof Error ? error.message : String(error),
                vectorizationAttempts: (doc.vectorizationAttempts || 0) + 1,
                updatedAt: new Date(),
              },
            },
          );
        } catch (updateError) {
          this.logger.error(
            `Failed to update document ${doc._id} status`,
            updateError,
          );
        }
      }

      stats.failed += documents.length;
      stats.processed += documents.length;
      stats.errors.push(
        `Batch embedding failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Generate embeddings for a batch of texts
   */
  private async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    const request: EmbeddingRequest = {
      input: texts,
      model: this.EMBEDDING_MODEL,
      user: 'cost-katana-vectorization',
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post<EmbeddingResponse>(
          'https://api.openai.com/v1/embeddings',
          request,
          {
            headers: {
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              'Content-Type': 'application/json',
            },
            timeout: this.PROCESSING_TIMEOUT,
          },
        ),
      );

      if (!response.data?.data || !Array.isArray(response.data.data)) {
        throw new Error('Invalid embedding response format');
      }

      // Sort by index to ensure correct order
      const sortedEmbeddings = response.data.data
        .sort((a, b) => a.index - b.index)
        .map((item) => item.embedding);

      this.logger.log(`✅ Generated ${sortedEmbeddings.length} embeddings`, {
        model: response.data.model,
        tokens: response.data.usage.total_tokens,
      });

      return sortedEmbeddings;
    } catch (error) {
      this.logger.error('Failed to generate embeddings', error);

      if (error.response?.status === 429) {
        throw new Error('OpenAI API rate limit exceeded');
      } else if (error.response?.status === 401) {
        throw new Error('OpenAI API authentication failed');
      } else if (error.response?.status >= 500) {
        throw new Error('OpenAI API server error');
      }

      throw error;
    }
  }

  /**
   * Update vectorization health status
   */
  private async updateVectorizationHealth(): Promise<void> {
    try {
      // Calculate health metrics
      const totalDocuments = await this.vectorizationModel
        .countDocuments()
        .exec();
      const completedDocuments = await this.vectorizationModel
        .countDocuments({
          vectorizationStatus: 'completed',
        })
        .exec();
      const failedDocuments = await this.vectorizationModel
        .countDocuments({
          vectorizationStatus: 'failed',
        })
        .exec();
      const pendingDocuments = await this.vectorizationModel
        .countDocuments({
          vectorizationStatus: 'pending',
        })
        .exec();

      const completionRate =
        totalDocuments > 0 ? (completedDocuments / totalDocuments) * 100 : 0;
      const failureRate =
        totalDocuments > 0 ? (failedDocuments / totalDocuments) * 100 : 0;

      // Determine health status
      let healthStatus: 'healthy' | 'degraded' | 'error' = 'healthy';
      if (failureRate > 20 || pendingDocuments > 1000) {
        healthStatus = 'degraded';
      }
      if (failureRate > 50 || pendingDocuments > 5000) {
        healthStatus = 'error';
      }

      // Create health status document
      const healthStatusDoc = {
        service: 'vectorization',
        timestamp: new Date(),
        metrics: {
          totalDocuments,
          completedDocuments,
          failedDocuments,
          pendingDocuments,
          completionRate,
          failureRate,
          healthStatus,
        },
        performance: await this.calculatePerformanceMetrics(),
        recommendations: this.generateHealthRecommendations(
          healthStatus,
          failureRate,
          pendingDocuments,
        ),
      };

      // Store in health monitoring collection
      try {
        const healthCollection =
          this.vectorizationModel.db.collection('service_health');
        await healthCollection.updateOne(
          { service: 'vectorization' },
          {
            $set: healthStatusDoc,
            $setOnInsert: { createdAt: new Date() },
            $currentDate: { updatedAt: true },
          },
          { upsert: true },
        );

        // Also update Redis cache for fast access (if available)
        try {
          // This would use a Redis service if available
          // await this.redisService.setex('vectorization:health', 300, JSON.stringify(healthStatusDoc));
        } catch (cacheError) {
          // Redis not available, continue without caching
        }
      } catch (dbError) {
        this.logger.warn(
          'Failed to store vectorization health in database',
          dbError,
        );
      }

      this.logger.log('📊 Vectorization health updated', {
        totalDocuments,
        completedDocuments,
        failedDocuments,
        pendingDocuments,
        completionRate: `${completionRate.toFixed(1)}%`,
        failureRate: `${failureRate.toFixed(1)}%`,
        healthStatus,
        recommendations: healthStatusDoc.recommendations,
      });
    } catch (error) {
      this.logger.error('Failed to update vectorization health', error);
    }
  }

  /**
   * Split array into chunks
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Calculate performance metrics from recent job runs
   */
  private async calculatePerformanceMetrics(): Promise<{
    avgProcessingTime: number;
    throughputPerHour: number;
    errorRateTrend: 'increasing' | 'decreasing' | 'stable';
  }> {
    try {
      // Get recent job execution data from a job tracking collection
      const jobStatsCollection = this.vectorizationModel.db.collection(
        'job_execution_stats',
      );

      // Get last 10 job runs
      const recentJobs = await jobStatsCollection
        .find({ jobName: 'vectorization' })
        .sort({ completedAt: -1 })
        .limit(10)
        .toArray();

      if (recentJobs.length === 0) {
        return {
          avgProcessingTime: 0,
          throughputPerHour: 0,
          errorRateTrend: 'stable',
        };
      }

      // Calculate average processing time
      const totalProcessingTime = recentJobs.reduce(
        (sum, job) => sum + (job.durationMs || 0),
        0,
      );
      const avgProcessingTime = Math.round(
        totalProcessingTime / recentJobs.length,
      );

      // Calculate throughput (documents per hour)
      const totalDocuments = recentJobs.reduce(
        (sum, job) => sum + (job.documentsProcessed || 0),
        0,
      );
      const totalHours = recentJobs.reduce(
        (sum, job) => sum + (job.durationMs || 0) / (1000 * 60 * 60),
        0,
      );
      const throughputPerHour =
        totalHours > 0 ? Math.round(totalDocuments / totalHours) : 0;

      // Calculate error rate trend
      const errorRates = recentJobs.map(
        (job) =>
          ((job.failedDocuments || 0) /
            ((job.documentsProcessed || 0) + (job.failedDocuments || 0))) *
          100,
      );
      const errorRateTrend = this.calculateTrend(errorRates);

      return {
        avgProcessingTime,
        throughputPerHour,
        errorRateTrend,
      };
    } catch (error) {
      this.logger.warn('Failed to calculate performance metrics', error);
      return {
        avgProcessingTime: 0,
        throughputPerHour: 0,
        errorRateTrend: 'stable',
      };
    }
  }

  /**
   * Calculate trend from an array of values
   */
  private calculateTrend(
    values: number[],
  ): 'increasing' | 'decreasing' | 'stable' {
    if (values.length < 3) return 'stable';

    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));

    const firstAvg =
      firstHalf.reduce((sum, v) => sum + v, 0) / firstHalf.length;
    const secondAvg =
      secondHalf.reduce((sum, v) => sum + v, 0) / secondHalf.length;

    const change = (secondAvg - firstAvg) / Math.abs(firstAvg || 1);

    if (change > 0.1) return 'increasing';
    if (change < -0.1) return 'decreasing';
    return 'stable';
  }

  /**
   * Generate health recommendations based on current status
   */
  private generateHealthRecommendations(
    healthStatus: string,
    failureRate: number,
    pendingDocuments: number,
  ): string[] {
    const recommendations: string[] = [];

    if (healthStatus === 'error') {
      recommendations.push(
        'CRITICAL: Vectorization service is in error state - manual intervention required',
      );
      recommendations.push('Check API key validity and rate limits');
      recommendations.push('Review recent error logs for patterns');
    } else if (healthStatus === 'degraded') {
      recommendations.push(
        'Vectorization service is degraded - monitor closely',
      );
    }

    if (failureRate > 20) {
      recommendations.push(
        'High failure rate detected - review embedding API configuration',
      );
      recommendations.push('Consider implementing circuit breaker pattern');
    }

    if (pendingDocuments > 1000) {
      recommendations.push(
        'Large backlog of pending documents - consider increasing batch size or processing capacity',
      );
      recommendations.push('Review vectorization job scheduling frequency');
    }

    if (recommendations.length === 0) {
      recommendations.push('Vectorization service operating normally');
    }

    return recommendations;
  }

  /**
   * Run once (for manual trigger or testing)
   */
  async runOnce(): Promise<void> {
    await this.run();
  }
}
