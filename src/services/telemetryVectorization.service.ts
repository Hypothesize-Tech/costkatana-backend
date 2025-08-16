import { logger } from '../utils/logger';
import { embeddingsService } from './embeddings.service';
import { Telemetry } from '../models/Telemetry';
import { redisService } from './redis.service';

export interface VectorizationJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  totalRecords: number;
  processedRecords: number;
  startTime: Date;
  endTime?: Date;
  error?: string;
}

export class TelemetryVectorizationService {
  private static instance: TelemetryVectorizationService;
  private currentJob: VectorizationJob | null = null;
  private readonly BATCH_SIZE = 10;
  private readonly JOB_STATUS_KEY = 'vectorization:job:status';

  private constructor() {}

  static getInstance(): TelemetryVectorizationService {
    if (!TelemetryVectorizationService.instance) {
      TelemetryVectorizationService.instance = new TelemetryVectorizationService();
    }
    return TelemetryVectorizationService.instance;
  }

  /**
   * Start vectorization of telemetry data
   */
  async startVectorization(options?: {
    timeframe?: string;
    tenant_id?: string;
    workspace_id?: string;
    forceReprocess?: boolean;
  }): Promise<VectorizationJob> {
    if (this.currentJob && this.currentJob.status === 'processing') {
      throw new Error('Vectorization job already in progress');
    }

    const jobId = `vectorization_${Date.now()}`;
    
    // Build query for records to vectorize
    const query: any = {};
    
    if (options?.timeframe) {
      const timeMs = this.parseTimeframe(options.timeframe);
      query.timestamp = { $gte: new Date(Date.now() - timeMs) };
    }
    
    if (options?.tenant_id) {
      query.tenant_id = options.tenant_id;
    }
    
    if (options?.workspace_id) {
      query.workspace_id = options.workspace_id;
    }

    // Only process records without embeddings unless forced
    if (!options?.forceReprocess) {
      query.semantic_embedding = { $exists: false };
    }

    const totalRecords = await Telemetry.countDocuments(query);

    this.currentJob = {
      id: jobId,
      status: 'pending',
      totalRecords,
      processedRecords: 0,
      startTime: new Date()
    };

    // Save job status to Redis
    await this.saveJobStatus();

    // Start processing asynchronously
    this.processVectorization(query).catch(error => {
      logger.error('Vectorization job failed:', error);
      if (this.currentJob) {
        this.currentJob.status = 'failed';
        this.currentJob.error = error.message;
        this.currentJob.endTime = new Date();
        this.saveJobStatus();
      }
    });

    return this.currentJob;
  }

  /**
   * Get current vectorization job status
   */
  async getJobStatus(): Promise<VectorizationJob | null> {
    if (this.currentJob) {
      return this.currentJob;
    }

    // Try to load from Redis
    try {
      const cached = await redisService.client.get(this.JOB_STATUS_KEY);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      logger.warn('Failed to get job status from Redis:', error);
      return null;
    }
  }

  /**
   * Process vectorization in batches
   */
  private async processVectorization(query: any): Promise<void> {
    if (!this.currentJob) return;

    this.currentJob.status = 'processing';
    await this.saveJobStatus();

    try {
      let skip = 0;
      let hasMore = true;

      while (hasMore && this.currentJob.status === 'processing') {
        const batch = await Telemetry.find(query)
          .sort({ timestamp: -1 })
          .limit(this.BATCH_SIZE)
          .skip(skip)
          .lean();

        if (batch.length === 0) {
          hasMore = false;
          break;
        }

        // Process batch
        await this.processBatch(batch);

        skip += this.BATCH_SIZE;
        this.currentJob.processedRecords = Math.min(skip, this.currentJob.totalRecords);
        
        // Update status every batch
        await this.saveJobStatus();

        // Small delay to prevent overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (this.currentJob.status === 'processing') {
        this.currentJob.status = 'completed';
        this.currentJob.endTime = new Date();
        await this.saveJobStatus();
      }

      logger.info(`Vectorization completed: ${this.currentJob.processedRecords}/${this.currentJob.totalRecords} records`);
    } catch (error) {
      logger.error('Vectorization processing failed:', error);
      if (this.currentJob) {
        this.currentJob.status = 'failed';
        this.currentJob.error = error instanceof Error ? error.message : 'Unknown error';
        this.currentJob.endTime = new Date();
        await this.saveJobStatus();
      }
    }
  }

  /**
   * Process a batch of telemetry records
   */
  private async processBatch(batch: any[]): Promise<void> {
    const promises = batch.map(async (record) => {
      try {
        // Generate embedding and cost narrative
        const [embeddingResult, costNarrative] = await Promise.all([
          embeddingsService.generateTelemetryEmbedding(record),
          embeddingsService.generateCostNarrative(record)
        ]);

        // Update the record with vector data
        await Telemetry.updateOne(
          { _id: record._id },
          {
            $set: {
              semantic_embedding: embeddingResult.embedding,
              semantic_content: embeddingResult.text,
              cost_narrative: costNarrative
            }
          }
        );

        return { success: true, id: record._id };
      } catch (error) {
        logger.error(`Failed to vectorize record ${record._id}:`, error);
        return { success: false, id: record._id, error };
      }
    });

    const results = await Promise.allSettled(promises);
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.length - successful;

    if (failed > 0) {
      logger.warn(`Batch processing: ${successful} successful, ${failed} failed`);
    }
  }

  /**
   * Vectorize a single telemetry record
   */
  async vectorizeSingleRecord(recordId: string): Promise<boolean> {
    try {
      const record = await Telemetry.findById(recordId).lean();
      if (!record) {
        throw new Error('Record not found');
      }

      const [embeddingResult, costNarrative] = await Promise.all([
        embeddingsService.generateTelemetryEmbedding(record),
        embeddingsService.generateCostNarrative(record)
      ]);

      await Telemetry.updateOne(
        { _id: recordId },
        {
          $set: {
            semantic_embedding: embeddingResult.embedding,
            semantic_content: embeddingResult.text,
            cost_narrative: costNarrative
          }
        }
      );

      return true;
    } catch (error) {
      logger.error(`Failed to vectorize single record ${recordId}:`, error);
      return false;
    }
  }

  /**
   * Get vectorization statistics
   */
  async getVectorizationStats(options?: {
    tenant_id?: string;
    workspace_id?: string;
  }): Promise<{
    total_records: number;
    vectorized_records: number;
    vectorization_rate: number;
    avg_embedding_dimensions: number;
    last_vectorized: Date | null;
  }> {
    const query: any = {};
    
    if (options?.tenant_id) {
      query.tenant_id = options.tenant_id;
    }
    
    if (options?.workspace_id) {
      query.workspace_id = options.workspace_id;
    }

    const [totalRecords, vectorizedRecords, lastVectorized] = await Promise.all([
      Telemetry.countDocuments(query),
      Telemetry.countDocuments({ ...query, semantic_embedding: { $exists: true } }),
      Telemetry.findOne(
        { ...query, semantic_embedding: { $exists: true } },
        {},
        { sort: { updatedAt: -1 } }
      )
    ]);

    // Get average embedding dimensions
    const sampleEmbedding = await Telemetry.findOne(
      { ...query, semantic_embedding: { $exists: true } },
      { semantic_embedding: 1 }
    );

    const avgDimensions = sampleEmbedding?.semantic_embedding?.length || 0;

    return {
      total_records: totalRecords,
      vectorized_records: vectorizedRecords,
      vectorization_rate: totalRecords > 0 ? (vectorizedRecords / totalRecords) * 100 : 0,
      avg_embedding_dimensions: avgDimensions,
      last_vectorized: (lastVectorized as any)?.updatedAt || null
    };
  }

  /**
   * Cancel current vectorization job
   */
  async cancelVectorization(): Promise<boolean> {
    if (this.currentJob && this.currentJob.status === 'processing') {
      this.currentJob.status = 'failed';
      this.currentJob.error = 'Cancelled by user';
      this.currentJob.endTime = new Date();
      await this.saveJobStatus();
      return true;
    }
    return false;
  }

  /**
   * Save job status to Redis
   */
  private async saveJobStatus(): Promise<void> {
    if (!this.currentJob) return;

    try {
      await redisService.client.setEx(
        this.JOB_STATUS_KEY,
        3600, // 1 hour TTL
        JSON.stringify(this.currentJob)
      );
    } catch (error) {
      logger.warn('Failed to save job status to Redis:', error);
    }
  }

  /**
   * Parse timeframe string to milliseconds
   */
  private parseTimeframe(timeframe: string): number {
    const timeMap: Record<string, number> = {
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '3h': 3 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000
    };

    return timeMap[timeframe] || timeMap['1h'];
  }
}

export const telemetryVectorizationService = TelemetryVectorizationService.getInstance();


