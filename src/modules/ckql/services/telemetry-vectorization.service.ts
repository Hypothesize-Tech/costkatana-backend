import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Telemetry,
  TelemetryDocument,
} from '../../../schemas/core/telemetry.schema';
import { EmbeddingsService } from '../../notebook/services/embeddings.service';
import { CacheService } from '../../../common/cache/cache.service';

export interface VectorizationJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  totalRecords: number;
  processedRecords: number;
  startTime: Date;
  endTime?: Date;
  error?: string;
}

/**
 * Telemetry vectorization: batch-generate semantic_embedding and cost_narrative
 * for Telemetry documents using EmbeddingsService. Job status persisted in cache (Redis).
 */
@Injectable()
export class TelemetryVectorizationService {
  private readonly logger = new Logger(TelemetryVectorizationService.name);
  private currentJob: VectorizationJob | null = null;
  private readonly BATCH_SIZE = 10;
  private readonly JOB_STATUS_KEY = 'vectorization:job:status';
  private readonly ENABLED =
    process.env.ENABLE_TELEMETRY_VECTORIZATION === 'true';

  constructor(
    @InjectModel(Telemetry.name)
    private readonly telemetryModel: Model<TelemetryDocument>,
    private readonly embeddingsService: EmbeddingsService,
    private readonly cacheService: CacheService,
  ) {
    if (!this.ENABLED) {
      this.logger.log(
        'Telemetry vectorization is DISABLED (set ENABLE_TELEMETRY_VECTORIZATION=true to enable)',
      );
    }
  }

  async startVectorization(options?: {
    timeframe?: string;
    tenant_id?: string;
    workspace_id?: string;
    forceReprocess?: boolean;
  }): Promise<VectorizationJob> {
    if (!this.ENABLED) {
      throw new Error(
        'Telemetry vectorization is disabled. Enable with ENABLE_TELEMETRY_VECTORIZATION=true',
      );
    }

    if (this.currentJob && this.currentJob.status === 'processing') {
      throw new Error('Vectorization job already in progress');
    }

    const jobId = `vectorization_${Date.now()}`;
    const query: Record<string, unknown> = {};

    if (options?.timeframe) {
      const timeMs = this.parseTimeframe(options.timeframe);
      query.timestamp = { $gte: new Date(Date.now() - timeMs) };
    }
    if (options?.tenant_id) query.tenant_id = options.tenant_id;
    if (options?.workspace_id) query.workspace_id = options.workspace_id;
    if (!options?.forceReprocess) {
      query.semantic_embedding = { $exists: false };
    }

    const totalRecords = await this.telemetryModel.countDocuments(query);

    this.currentJob = {
      id: jobId,
      status: 'pending',
      totalRecords,
      processedRecords: 0,
      startTime: new Date(),
    };

    await this.saveJobStatus();

    this.processVectorization(query).catch((error) => {
      this.logger.error('Vectorization job failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      if (this.currentJob) {
        this.currentJob.status = 'failed';
        this.currentJob.error =
          error instanceof Error ? error.message : String(error);
        this.currentJob.endTime = new Date();
        this.saveJobStatus();
      }
    });

    return this.currentJob;
  }

  async getJobStatus(): Promise<VectorizationJob | null> {
    if (this.currentJob) return this.currentJob;
    try {
      const cached = await this.cacheService.get<VectorizationJob>(
        this.JOB_STATUS_KEY,
      );
      return cached ?? null;
    } catch (error) {
      this.logger.warn('Failed to get job status from cache', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async processVectorization(
    query: Record<string, unknown>,
  ): Promise<void> {
    if (!this.currentJob) return;

    this.currentJob.status = 'processing';
    await this.saveJobStatus();

    try {
      let skip = 0;
      let hasMore = true;

      while (hasMore && this.currentJob.status === 'processing') {
        const batch = await this.telemetryModel
          .find(query)
          .sort({ timestamp: -1 })
          .limit(this.BATCH_SIZE)
          .skip(skip)
          .lean()
          .exec();

        if (batch.length === 0) {
          hasMore = false;
          break;
        }

        await this.processBatch(batch as TelemetryDocument[]);
        skip += this.BATCH_SIZE;
        this.currentJob.processedRecords = Math.min(
          skip,
          this.currentJob.totalRecords,
        );
        await this.saveJobStatus();
        await new Promise((r) => setTimeout(r, 100));
      }

      if (this.currentJob.status === 'processing') {
        this.currentJob.status = 'completed';
        this.currentJob.endTime = new Date();
        await this.saveJobStatus();
      }

      this.logger.log(
        `Vectorization completed: ${this.currentJob.processedRecords}/${this.currentJob.totalRecords} records`,
      );
    } catch (error) {
      this.logger.error('Vectorization processing failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      if (this.currentJob) {
        this.currentJob.status = 'failed';
        this.currentJob.error =
          error instanceof Error ? error.message : 'Unknown error';
        this.currentJob.endTime = new Date();
        await this.saveJobStatus();
      }
    }
  }

  private async processBatch(batch: TelemetryDocument[]): Promise<void> {
    const promises = batch.map(async (record) => {
      try {
        const [embeddingResult, costNarrative] = await Promise.all([
          this.embeddingsService.generateTelemetryEmbedding(record),
          this.embeddingsService.generateCostNarrative(record),
        ]);

        await this.telemetryModel.updateOne(
          { _id: record._id },
          {
            $set: {
              semantic_embedding: embeddingResult.embedding,
              semantic_content: embeddingResult.text,
              cost_narrative: costNarrative,
            },
          },
        );
        return { success: true, id: record._id };
      } catch (error) {
        this.logger.error(`Failed to vectorize record ${record._id}`, {
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, id: record._id, error };
      }
    });

    const results = await Promise.allSettled(promises);
    const successful = results.filter(
      (r) => r.status === 'fulfilled' && r.value.success,
    ).length;
    const failed = results.length - successful;
    if (failed > 0) {
      this.logger.warn(
        `Batch processing: ${successful} successful, ${failed} failed`,
      );
    }
  }

  async vectorizeSingleRecord(recordId: string): Promise<boolean> {
    try {
      const record = await this.telemetryModel.findById(recordId).lean().exec();
      if (!record) throw new Error('Record not found');

      const [embeddingResult, costNarrative] = await Promise.all([
        this.embeddingsService.generateTelemetryEmbedding(record),
        this.embeddingsService.generateCostNarrative(record),
      ]);

      await this.telemetryModel.updateOne(
        { _id: recordId },
        {
          $set: {
            semantic_embedding: embeddingResult.embedding,
            semantic_content: embeddingResult.text,
            cost_narrative: costNarrative,
          },
        },
      );
      return true;
    } catch (error) {
      this.logger.error(`Failed to vectorize single record ${recordId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

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
    const query: Record<string, string> = {};
    if (options?.tenant_id) query.tenant_id = options.tenant_id;
    if (options?.workspace_id) query.workspace_id = options.workspace_id;

    const [totalRecords, vectorizedRecords, lastVectorized, sampleEmbedding] =
      await Promise.all([
        this.telemetryModel.countDocuments(query),
        this.telemetryModel.countDocuments({
          ...query,
          semantic_embedding: { $exists: true },
        }),
        this.telemetryModel
          .findOne(
            { ...query, semantic_embedding: { $exists: true } },
            {},
            { sort: { updatedAt: -1 } },
          )
          .lean()
          .exec(),
        this.telemetryModel
          .findOne(
            { ...query, semantic_embedding: { $exists: true } },
            { semantic_embedding: 1 },
          )
          .lean()
          .exec(),
      ]);

    const avgDimensions =
      (sampleEmbedding as { semantic_embedding?: number[] })?.semantic_embedding
        ?.length ?? 0;
    const last = lastVectorized as { updatedAt?: Date } | null;

    return {
      total_records: totalRecords,
      vectorized_records: vectorizedRecords,
      vectorization_rate:
        totalRecords > 0 ? (vectorizedRecords / totalRecords) * 100 : 0,
      avg_embedding_dimensions: avgDimensions,
      last_vectorized: last?.updatedAt ?? null,
    };
  }

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

  private async saveJobStatus(): Promise<void> {
    if (!this.currentJob) return;
    try {
      await this.cacheService.set(this.JOB_STATUS_KEY, this.currentJob, 3600);
    } catch (error) {
      this.logger.warn('Failed to save job status to cache', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private parseTimeframe(timeframe: string): number {
    const timeMap: Record<string, number> = {
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '3h': 3 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
    };
    return timeMap[timeframe] ?? timeMap['1h'];
  }
}
