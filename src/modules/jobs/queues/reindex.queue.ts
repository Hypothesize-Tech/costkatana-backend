import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { InjectQueue, Process, Processor } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection } from 'mongoose';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { isRedisEnabled } from '../../../config/redis';
import { calculateCost } from '../../../utils/pricing';

interface ReindexJobData {
  type: 'search' | 'vector' | 'cache' | 'external' | 'full';
  scope?: 'all' | 'users' | 'tenants' | 'projects';
  targetIds?: string[];
  priority?: 'low' | 'medium' | 'high';
  options?: {
    force?: boolean;
    batchSize?: number;
    timeout?: number;
    skipValidation?: boolean;
  };
}

interface ReindexStats {
  type: string;
  itemsProcessed: number;
  itemsSkipped: number;
  itemsFailed: number;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  errors: string[];
  metadata?: Record<string, any>;
}

@Injectable()
@Processor('reindex')
export class ReindexQueue implements OnModuleInit {
  private readonly logger = new Logger(ReindexQueue.name);

  // Configuration
  private readonly DEFAULT_BATCH_SIZE = 1000;
  private readonly MAX_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  private readonly RETRY_ATTEMPTS = 3;

  constructor(
    @InjectQueue('reindex') private queue: Queue,
    private readonly httpService: HttpService,
    @InjectConnection() private readonly connection: Connection,
    // Inject models that need reindexing
    @InjectModel('Usage') private usageModel: Model<any>,
    @InjectModel('Project') private projectModel: Model<any>,
    @InjectModel('User') private userModel: Model<any>,
    @InjectModel('VectorizationDocument')
    private vectorizationModel: Model<any>,
  ) {}

  async onModuleInit() {
    this.logger.log('🔄 Reindex Queue initialized');

    // Set up health check
    setInterval(() => this.healthCheck(), 5 * 60 * 1000); // Every 5 minutes
  }

  @Process('reindex')
  async handleReindex(job: Job<ReindexJobData>) {
    const startTime = Date.now();
    const { type, scope, targetIds, options } = job.data;

    this.logger.log('🔄 Processing reindex job', {
      jobId: job.id,
      type,
      scope,
      targetIds: targetIds?.length,
      options,
    });

    const stats: ReindexStats = {
      type,
      itemsProcessed: 0,
      itemsSkipped: 0,
      itemsFailed: 0,
      startTime: new Date(),
      errors: [],
    };

    try {
      switch (type) {
        case 'search':
          await this.reindexSearchIndexes(stats, scope, targetIds, options);
          break;

        case 'vector':
          await this.reindexVectorIndexes(stats, scope, targetIds, options);
          break;

        case 'cache':
          await this.refreshCaches(stats, scope, targetIds, options);
          break;

        case 'external':
          await this.syncExternalSystems(stats, scope, targetIds, options);
          break;

        case 'full':
          await this.performFullReindex(stats, scope, options);
          break;

        default:
          throw new Error(`Unknown reindex type: ${type}`);
      }

      stats.endTime = new Date();
      stats.duration = stats.endTime.getTime() - stats.startTime.getTime();

      this.logger.log('✅ Reindex job completed', {
        jobId: job.id,
        type,
        itemsProcessed: stats.itemsProcessed,
        itemsSkipped: stats.itemsSkipped,
        itemsFailed: stats.itemsFailed,
        durationMs: stats.duration,
      });

      // Store completion stats
      await this.storeReindexStats(stats);
    } catch (error) {
      this.logger.error('❌ Failed to process reindex job', {
        jobId: job.id,
        type,
        error: error instanceof Error ? error.message : String(error),
      });

      stats.endTime = new Date();
      stats.duration = stats.endTime.getTime() - stats.startTime.getTime();
      stats.errors.push(error instanceof Error ? error.message : String(error));

      await this.storeReindexStats(stats);
      throw error;
    }
  }

  /**
   * Reindex search indexes
   */
  private async reindexSearchIndexes(
    stats: ReindexStats,
    scope?: string,
    targetIds?: string[],
    options?: any,
  ): Promise<void> {
    this.logger.log('🔍 Reindexing search indexes...');

    const batchSize = options?.batchSize || this.DEFAULT_BATCH_SIZE;

    try {
      // Reindex users
      if (!scope || scope === 'all' || scope === 'users') {
        const userCount = await this.reindexCollection(
          this.userModel,
          'users',
          batchSize,
          stats,
          targetIds,
        );
        this.logger.log(`Reindexed ${userCount} users`);
      }

      // Reindex projects
      if (!scope || scope === 'all' || scope === 'projects') {
        const projectCount = await this.reindexCollection(
          this.projectModel,
          'projects',
          batchSize,
          stats,
          targetIds,
        );
        this.logger.log(`Reindexed ${projectCount} projects`);
      }

      // Reindex usage records
      if (!scope || scope === 'all') {
        const usageCount = await this.reindexCollection(
          this.usageModel,
          'usage',
          batchSize,
          stats,
          targetIds,
        );
        this.logger.log(`Reindexed ${usageCount} usage records`);
      }
    } catch (error) {
      this.logger.error('Failed to reindex search indexes', error);
      stats.errors.push(
        `Search reindex failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Reindex vector indexes
   */
  private async reindexVectorIndexes(
    stats: ReindexStats,
    scope?: string,
    targetIds?: string[],
    options?: any,
  ): Promise<void> {
    this.logger.log('🔄 Reindexing vector indexes...');

    try {
      // Update vector index mappings
      await this.updateVectorIndexMappings();

      // Reindex vectorized documents
      const batchSize = options?.batchSize || 500; // Smaller batches for vectors

      let processed = 0;
      let offset = 0;

      while (true) {
        const batch = await this.vectorizationModel
          .find({ vector: { $exists: true } })
          .skip(offset)
          .limit(batchSize)
          .exec();

        if (batch.length === 0) break;

        for (const doc of batch) {
          try {
            // Re-index the vector in the vector database
            await this.reindexVectorDocument(doc);
            processed++;
          } catch (error) {
            stats.itemsFailed++;
            stats.errors.push(
              `Vector reindex failed for doc ${doc._id}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }

        offset += batch.length;

        // Prevent infinite loops
        if (offset > 100000) {
          this.logger.warn('Vector reindex reached safety limit');
          break;
        }
      }

      stats.itemsProcessed = processed;
      this.logger.log(`Reindexed ${processed} vector documents`);
    } catch (error) {
      this.logger.error('Failed to reindex vector indexes', error);
      stats.errors.push(
        `Vector reindex failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Refresh cached data
   */
  private async refreshCaches(
    stats: ReindexStats,
    scope?: string,
    targetIds?: string[],
    options?: any,
  ): Promise<void> {
    this.logger.log('💾 Refreshing caches...');

    try {
      // Clear application caches
      await this.clearApplicationCaches();

      // Refresh computed aggregations
      if (!scope || scope === 'all') {
        await this.refreshAggregations(stats);
      }

      // Refresh specific user/project caches
      if (targetIds && targetIds.length > 0) {
        for (const id of targetIds) {
          await this.refreshEntityCache(id, stats);
        }
      }

      // Warm up frequently accessed caches
      await this.warmupCaches();

      this.logger.log('Caches refreshed successfully');
    } catch (error) {
      this.logger.error('Failed to refresh caches', error);
      stats.errors.push(
        `Cache refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Synchronize external systems
   */
  private async syncExternalSystems(
    stats: ReindexStats,
    scope?: string,
    targetIds?: string[],
    options?: any,
  ): Promise<void> {
    this.logger.log('🔗 Synchronizing external systems...');

    try {
      // Sync with external APIs
      const syncTasks = [
        this.syncWithExternalAPI('search-index', stats),
        this.syncWithExternalAPI('analytics', stats),
        this.syncWithExternalAPI('monitoring', stats),
      ];

      await Promise.allSettled(syncTasks);

      // Validate synchronization
      await this.validateExternalSync(stats);

      this.logger.log('External systems synchronized');
    } catch (error) {
      this.logger.error('Failed to sync external systems', error);
      stats.errors.push(
        `External sync failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Perform full reindex (all types)
   */
  private async performFullReindex(
    stats: ReindexStats,
    scope?: string,
    options?: any,
  ): Promise<void> {
    this.logger.log('🔄 Performing full reindex...');

    // Run all reindex types sequentially
    await this.reindexSearchIndexes(stats, scope, undefined, options);
    await this.reindexVectorIndexes(stats, scope, undefined, options);
    await this.refreshCaches(stats, scope, undefined, options);
    await this.syncExternalSystems(stats, scope, undefined, options);

    this.logger.log('Full reindex completed');
  }

  /**
   * Reindex a collection for search
   */
  private async reindexCollection(
    mongooseModel: Model<any>,
    collectionName: string,
    batchSize: number,
    stats: ReindexStats,
    targetIds?: string[],
  ): Promise<number> {
    let processed = 0;

    try {
      // Drop and recreate search indexes
      try {
        await mongooseModel.collection.dropIndexes();
      } catch (dropError) {
        this.logger.warn(
          `Failed to drop indexes for ${collectionName} (may not exist)`,
          {
            collectionName,
            error:
              dropError instanceof Error
                ? dropError.message
                : String(dropError),
          },
        );
      }

      // Reindex documents in batches
      let offset = 0;

      while (true) {
        const query: any = {};
        if (targetIds && targetIds.length > 0) {
          query._id = { $in: targetIds };
        }

        const batch = await mongooseModel
          .find(query)
          .skip(offset)
          .limit(batchSize)
          .exec();

        if (batch.length === 0) break;

        // Process batch with document-specific reindexing logic
        for (const doc of batch) {
          try {
            await this.reindexDocument(doc, collectionName, mongooseModel);
            processed++;
          } catch (error) {
            stats.itemsFailed++;
            stats.errors.push(
              `Failed to reindex document ${doc._id}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }

        offset += batch.length;
        stats.itemsProcessed += batch.length;
      }

      // Rebuild indexes from schema definitions (required when autoIndex is disabled)
      try {
        await mongooseModel.createIndexes();
        this.logger.log(`Rebuilt indexes for ${collectionName}`);
      } catch (indexError) {
        this.logger.warn(
          `Failed to rebuild indexes for ${collectionName} (schema indexes will apply on next sync)`,
          {
            collectionName,
            error:
              indexError instanceof Error
                ? indexError.message
                : String(indexError),
          },
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to reindex collection ${collectionName}`,
        error,
      );
      stats.errors.push(
        `Collection ${collectionName} reindex failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return processed;
  }

  /**
   * Reindex a specific document based on collection type
   */
  private async reindexDocument(
    doc: any,
    collectionName: string,
    mongooseModel: Model<any>,
  ): Promise<void> {
    switch (collectionName) {
      case 'users':
        await this.reindexUserDocument(doc);
        break;

      case 'projects':
        await this.reindexProjectDocument(doc);
        break;

      case 'usage':
        await this.reindexUsageDocument(doc);
        break;

      default:
        // Generic reindexing - just update timestamps
        await mongooseModel.updateOne(
          { _id: doc._id },
          {
            $set: {
              lastReindexed: new Date(),
              reindexVersion: (doc.reindexVersion || 0) + 1,
            },
          },
        );
    }
  }

  /**
   * Reindex user document
   */
  private async reindexUserDocument(doc: any): Promise<void> {
    // Update user search index, refresh cached data, etc.
    const userModel = this.userModel;

    // Recalculate derived fields if needed
    const updateData: any = {
      lastReindexed: new Date(),
      reindexVersion: (doc.reindexVersion || 0) + 1,
    };

    // Recalculate user activity metrics
    if (doc.createdAt) {
      const daysSinceCreation = Math.floor(
        (Date.now() - doc.createdAt.getTime()) / (24 * 60 * 60 * 1000),
      );
      updateData.accountAgeDays = daysSinceCreation;
    }

    await userModel.updateOne({ _id: doc._id }, { $set: updateData });
  }

  /**
   * Reindex project document
   */
  private async reindexProjectDocument(doc: any): Promise<void> {
    // Update project search index, refresh cached data, etc.
    const projectModel = this.projectModel;

    const updateData: any = {
      lastReindexed: new Date(),
      reindexVersion: (doc.reindexVersion || 0) + 1,
    };

    // Recalculate project metrics
    if (doc.createdAt) {
      const daysSinceCreation = Math.floor(
        (Date.now() - doc.createdAt.getTime()) / (24 * 60 * 60 * 1000),
      );
      updateData.projectAgeDays = daysSinceCreation;
    }

    await projectModel.updateOne({ _id: doc._id }, { $set: updateData });
  }

  /**
   * Reindex usage document
   */
  private async reindexUsageDocument(doc: any): Promise<void> {
    // Update usage analytics, refresh aggregations, etc.
    const usageModel = this.usageModel;

    const updateData: any = {
      lastReindexed: new Date(),
      reindexVersion: (doc.reindexVersion || 0) + 1,
    };

    // Recalculate derived metrics
    if (doc.inputTokens && doc.outputTokens) {
      updateData.totalTokens = doc.inputTokens + doc.outputTokens;
    }

    // Recalculate cost using current pricing (provider may be 'service' in Usage schema)
    const provider = doc.service ?? doc.provider;
    const inputTokens = doc.promptTokens ?? doc.inputTokens ?? 0;
    const outputTokens = doc.completionTokens ?? doc.outputTokens ?? 0;
    if (provider && doc.model && (inputTokens > 0 || outputTokens > 0)) {
      try {
        const recalculatedCost = calculateCost(
          inputTokens,
          outputTokens,
          provider,
          doc.model,
        );
        updateData.cost = recalculatedCost;
        updateData.costNeedsRecalculation = false;
      } catch (err) {
        this.logger.warn(
          `Could not recalculate cost for usage ${doc._id}: ${err instanceof Error ? err.message : String(err)}`,
        );
        updateData.costNeedsRecalculation = true;
      }
    } else {
      updateData.costNeedsRecalculation = false;
    }

    await usageModel.updateOne({ _id: doc._id }, { $set: updateData });
  }

  /**
   * Reindex a single vector document
   */
  private async reindexVectorDocument(doc: any): Promise<void> {
    // Validate vector data
    if (!doc.vector || !Array.isArray(doc.vector) || doc.vector.length === 0) {
      throw new Error('Invalid vector data');
    }

    try {
      // Update vector in vector database (Pinecone, Weaviate, Qdrant, etc.)
      if (process.env.VECTOR_DB_TYPE === 'pinecone') {
        await this.reindexPineconeVector(doc);
      } else if (process.env.VECTOR_DB_TYPE === 'weaviate') {
        await this.reindexWeaviateVector(doc);
      } else if (process.env.VECTOR_DB_TYPE === 'qdrant') {
        await this.reindexQdrantVector(doc);
      } else {
        // Default: update local vector index or cache
        await this.updateLocalVectorIndex(doc);
      }

      // Update metadata
      await this.vectorizationModel.updateOne(
        { _id: doc._id },
        {
          $set: {
            lastReindexedAt: new Date(),
            reindexVersion: (doc.reindexVersion || 0) + 1,
          },
        },
      );
    } catch (error) {
      this.logger.error('Failed to reindex vector document', {
        docId: doc._id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Reindex vector in Pinecone
   */
  private async reindexPineconeVector(doc: any): Promise<void> {
    const pineconeData = {
      id: doc._id.toString(),
      values: doc.vector,
      metadata: {
        contentType: doc.contentType,
        userId: doc.userId,
        tenantId: doc.tenantId,
        reindexedAt: new Date().toISOString(),
      },
    };

    await firstValueFrom(
      this.httpService.post(
        `${process.env.PINECONE_API_URL}/vectors/upsert`,
        {
          vectors: [pineconeData],
          namespace: process.env.PINECONE_NAMESPACE || 'default',
        },
        {
          headers: {
            'Api-Key': process.env.PINECONE_API_KEY,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      ),
    );
  }

  /**
   * Reindex vector in Weaviate
   */
  private async reindexWeaviateVector(doc: any): Promise<void> {
    const weaviateData = {
      class: 'VectorDocument',
      id: doc._id.toString(),
      properties: {
        contentType: doc.contentType,
        userId: doc.userId,
        tenantId: doc.tenantId,
        reindexedAt: new Date().toISOString(),
      },
      vector: doc.vector,
    };

    await firstValueFrom(
      this.httpService.post(
        `${process.env.WEAVIATE_URL}/v1/objects`,
        weaviateData,
        {
          headers: {
            Authorization: `Bearer ${process.env.WEAVIATE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      ),
    );
  }

  /**
   * Reindex vector in Qdrant
   */
  private async reindexQdrantVector(doc: any): Promise<void> {
    const qdrantData = {
      points: [
        {
          id: doc._id.toString(),
          vector: doc.vector,
          payload: {
            contentType: doc.contentType,
            userId: doc.userId,
            tenantId: doc.tenantId,
            reindexedAt: new Date().toISOString(),
          },
        },
      ],
    };

    await firstValueFrom(
      this.httpService.put(
        `${process.env.QDRANT_URL}/collections/${process.env.QDRANT_COLLECTION}/points`,
        qdrantData,
        {
          headers: {
            'api-key': process.env.QDRANT_API_KEY,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      ),
    );
  }

  /**
   * Update local vector index
   */
  private async updateLocalVectorIndex(doc: any): Promise<void> {
    // For local/development setups, update a local index or cache
    const indexCollection =
      this.vectorizationModel.db.collection('vector_index');

    await indexCollection.updateOne(
      { documentId: doc._id },
      {
        $set: {
          vector: doc.vector,
          contentType: doc.contentType,
          userId: doc.userId,
          tenantId: doc.tenantId,
          lastIndexed: new Date(),
          indexVersion: (doc.indexVersion || 0) + 1,
        },
      },
      { upsert: true },
    );
  }

  /**
   * Update vector index mappings
   */
  private async updateVectorIndexMappings(): Promise<void> {
    try {
      if (process.env.VECTOR_DB_TYPE === 'pinecone') {
        await this.updatePineconeMappings();
      } else if (process.env.VECTOR_DB_TYPE === 'weaviate') {
        await this.updateWeaviateMappings();
      } else if (process.env.VECTOR_DB_TYPE === 'qdrant') {
        await this.updateQdrantMappings();
      } else {
        await this.updateLocalMappings();
      }

      this.logger.log('✅ Vector index mappings updated');
    } catch (error) {
      this.logger.error('Failed to update vector index mappings', error);
      throw error;
    }
  }

  /**
   * Update Pinecone index mappings
   */
  private async updatePineconeMappings(): Promise<void> {
    // Pinecone doesn't require explicit mapping updates for metadata
    // But we can update index settings if needed
    const configData = {
      spec: {
        serverless: {
          cloud: process.env.PINECONE_CLOUD || 'aws',
          region: process.env.PINECONE_REGION || 'us-east-1',
        },
      },
      dimension: parseInt(process.env.VECTOR_DIMENSION || '1536'),
      metric: 'cosine',
      metadata_config: {
        indexed: ['contentType', 'userId', 'tenantId', 'reindexedAt'],
      },
    };

    await firstValueFrom(
      this.httpService.patch(
        `${process.env.PINECONE_API_URL}/indexes/${process.env.PINECONE_INDEX}`,
        configData,
        {
          headers: {
            'Api-Key': process.env.PINECONE_API_KEY,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      ),
    );
  }

  /**
   * Update Weaviate schema mappings
   */
  private async updateWeaviateMappings(): Promise<void> {
    const schemaUpdate = {
      class: 'VectorDocument',
      properties: [
        {
          name: 'contentType',
          dataType: ['string'],
          indexInverted: true,
        },
        {
          name: 'userId',
          dataType: ['string'],
          indexInverted: true,
        },
        {
          name: 'tenantId',
          dataType: ['string'],
          indexInverted: true,
        },
        {
          name: 'reindexedAt',
          dataType: ['date'],
          indexInverted: false,
        },
      ],
      vectorIndexConfig: {
        distance: 'cosine',
        efConstruction: 128,
        maxConnections: 64,
      },
    };

    await firstValueFrom(
      this.httpService.post(
        `${process.env.WEAVIATE_URL}/v1/schema`,
        schemaUpdate,
        {
          headers: {
            Authorization: `Bearer ${process.env.WEAVIATE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      ),
    );
  }

  /**
   * Update Qdrant collection mappings
   */
  private async updateQdrantMappings(): Promise<void> {
    const mappingUpdate = {
      optimizers_config: {
        deleted_threshold: 0.2,
        vacuum_min_vector_number: 1000,
        default_segment_number: 2,
        indexing_threshold: 20000,
      },
      wal_config: {
        wal_capacity_mb: 32,
        wal_segments_ahead: 2,
      },
    };

    await firstValueFrom(
      this.httpService.patch(
        `${process.env.QDRANT_URL}/collections/${process.env.QDRANT_COLLECTION}`,
        mappingUpdate,
        {
          headers: {
            'api-key': process.env.QDRANT_API_KEY,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      ),
    );
  }

  /**
   * Update local vector mappings
   */
  private async updateLocalMappings(): Promise<void> {
    // Create indexes for local vector collection
    const indexCollection =
      this.vectorizationModel.db.collection('vector_index');

    await indexCollection.createIndex({ 'metadata.contentType': 1 });
    await indexCollection.createIndex({ 'metadata.userId': 1 });
    await indexCollection.createIndex({ 'metadata.tenantId': 1 });
    await indexCollection.createIndex({ lastIndexed: -1 });
    await indexCollection.createIndex({ indexVersion: 1 });
  }

  /**
   * Clear application caches
   */
  private async clearApplicationCaches(): Promise<void> {
    const cacheClearResults = {
      redis: false,
      inMemory: false,
      apiResponses: false,
      aggregations: false,
      userCaches: false,
      projectCaches: false,
      systemCaches: false,
    };

    try {
      // 1. Clear Redis caches
      cacheClearResults.redis = await this.clearRedisCaches();

      // 2. Clear in-memory caches
      cacheClearResults.inMemory = await this.clearInMemoryCaches();

      // 3. Clear API response caches
      cacheClearResults.apiResponses = await this.clearApiResponseCaches();

      // 4. Clear computed aggregations cache
      cacheClearResults.aggregations = await this.clearAggregationCaches();

      // 5. Clear user-specific caches
      cacheClearResults.userCaches = await this.clearUserCaches();

      // 6. Clear project-specific caches
      cacheClearResults.projectCaches = await this.clearProjectCaches();

      // 7. Clear system-wide caches
      cacheClearResults.systemCaches = await this.clearSystemCaches();

      const successCount =
        Object.values(cacheClearResults).filter(Boolean).length;
      const totalCount = Object.keys(cacheClearResults).length;

      this.logger.log('🧹 Application caches cleared', {
        successRate: `${successCount}/${totalCount}`,
        results: cacheClearResults,
      });

      if (successCount < totalCount) {
        this.logger.warn('Some cache clearing operations failed', {
          failedOperations: Object.entries(cacheClearResults)
            .filter(([, success]) => !success)
            .map(([type]) => type),
        });
      }
    } catch (error) {
      this.logger.error('Failed to clear application caches', error);
      throw error;
    }
  }

  /**
   * Clear Redis caches
   */
  private async clearRedisCaches(): Promise<boolean> {
    try {
      if (!process.env.REDIS_URL && !process.env.REDIS_HOST) {
        this.logger.debug(
          'Redis not configured, skipping Redis cache clearing',
        );
        return true; // Not an error, just not configured
      }

      // Clear specific cache patterns instead of full flush
      const cachePatterns = [
        'cache:user:*',
        'cache:project:*',
        'cache:usage:*',
        'cache:api:*',
        'cache:aggregation:*',
        'cache:search:*',
        'cache:vector:*',
      ];

      // Clear Redis cache patterns
      try {
        // Import Redis client dynamically to avoid issues if not available
        const redis = require('redis');

        // Create Redis client
        const client = redis.createClient({
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          password: process.env.REDIS_PASSWORD,
          db: parseInt(process.env.REDIS_DB || '0'),
        });

        await client.connect();

        let totalKeysDeleted = 0;

        // Clear each cache pattern
        for (const pattern of cachePatterns) {
          try {
            const keys = await client.keys(pattern);
            if (keys.length > 0) {
              const deletedCount = await client.del(keys);
              totalKeysDeleted += deletedCount;
              this.logger.debug(
                `Cleared ${deletedCount} keys for pattern ${pattern}`,
              );
            }
          } catch (patternError) {
            this.logger.warn(
              `Failed to clear pattern ${pattern}`,
              patternError,
            );
          }
        }

        await client.quit();

        this.logger.debug('Redis cache patterns cleared', {
          patterns: cachePatterns.length,
          totalKeysDeleted,
        });
      } catch (redisError) {
        this.logger.warn(
          'Redis client not available, cache clearing skipped',
          redisError,
        );
        // Don't fail the entire operation if Redis is not available
      }

      return true;
    } catch (error) {
      this.logger.warn('Failed to clear Redis caches', error);
      return false;
    }
  }

  /**
   * Clear in-memory caches
   */
  private async clearInMemoryCaches(): Promise<boolean> {
    try {
      let clearedItems = 0;

      // 1. Clear Node.js require cache for cache-related modules (development only)
      if (process.env.NODE_ENV === 'development') {
        try {
          Object.keys(require.cache).forEach((key) => {
            // Only clear cache-related modules and temporary files
            if (
              key.includes('/cache/') ||
              key.includes('/temp/') ||
              key.includes('cache-manager') ||
              key.includes('memory-cache') ||
              key.match(/\.(cache|tmp|temp)$/)
            ) {
              delete require.cache[key];
              clearedItems++;
            }
          });
          this.logger.debug(`Cleared ${clearedItems} require cache entries`);
        } catch (cacheError) {
          this.logger.warn('Failed to clear require cache', cacheError);
        }
      }

      // 2. Clear global in-memory cache objects if they exist
      try {
        // Clear any global cache objects that might exist
        if (global && typeof global === 'object') {
          const cacheKeys = Object.keys(global).filter(
            (key) =>
              key.includes('cache') ||
              key.includes('Cache') ||
              key.endsWith('Cache'),
          );

          cacheKeys.forEach((key) => {
            try {
              delete (global as Record<string, unknown>)[key];
              clearedItems++;
            } catch (deleteError) {
              // Some global properties might not be deletable
            }
          });
        }
      } catch (globalError) {
        this.logger.warn('Failed to clear global cache objects', globalError);
      }

      // 3. Clear process-level cache if available
      try {
        if (process && typeof process === 'object' && process.env) {
          // Clear any process environment cache
          const envCacheKeys = Object.keys(process.env).filter(
            (key) => key.startsWith('CACHE_') || key.includes('_CACHE'),
          );

          envCacheKeys.forEach((key) => {
            delete process.env[key];
            clearedItems++;
          });
        }
      } catch (processError) {
        this.logger.warn(
          'Failed to clear process environment cache',
          processError,
        );
      }

      // 4. Force garbage collection if available (development only)
      if (process.env.NODE_ENV === 'development' && global.gc) {
        try {
          global.gc();
          this.logger.debug('Forced garbage collection');
        } catch (gcError) {
          // gc might not be available
        }
      }

      // 5. Clear any application-specific in-memory maps/sets
      try {
        // This would depend on your specific application, but here are common patterns:

        // Clear LRU cache instances (if using lru-cache)
        // Clear LRU cache instances (if using lru-cache)
        const lruCacheInstances = (global as any).lruCacheInstances;
        if (lruCacheInstances) {
          lruCacheInstances.forEach((cache: any) => {
            if (typeof cache.clear === 'function') {
              cache.clear();
              clearedItems++;
            }
          });
        }

        // Clear memory cache instances (if using memory-cache)
        const memoryCacheInstances = (global as any).memoryCacheInstances;
        if (memoryCacheInstances) {
          memoryCacheInstances.forEach((cache: any) => {
            if (typeof cache.clear === 'function') {
              cache.clear();
              clearedItems++;
            }
          });
        }

        // Clear Map/Set instances that might be used for caching
        const cacheMaps = (global as any).cacheMaps;
        if (cacheMaps) {
          cacheMaps.forEach((map: Map<any, any>) => {
            map.clear();
            clearedItems++;
          });
        }

        const cacheSets = (global as any).cacheSets;
        if (cacheSets) {
          cacheSets.forEach((set: Set<any>) => {
            set.clear();
            clearedItems++;
          });
        }
      } catch (appCacheError) {
        this.logger.warn(
          'Failed to clear application-specific caches',
          appCacheError,
        );
      }

      // 6. Clear V8 heap cache if available
      // V8 optimization hints removed - experimental and not widely available

      this.logger.log(`🧠 Cleared ${clearedItems} in-memory cache items`);
      return true;
    } catch (error) {
      this.logger.error('Failed to clear in-memory caches', error);
      return false;
    }
  }

  /**
   * Clear user-specific caches
   */
  private async clearUserCaches(): Promise<boolean> {
    try {
      const userCacheCollection =
        this.vectorizationModel.db.collection('user_cache');

      // Remove all user caches (they will be rebuilt on next access)
      const result = await userCacheCollection.deleteMany({});

      this.logger.debug('User caches cleared', {
        removed: result.deletedCount || 0,
      });

      return true;
    } catch (error) {
      this.logger.warn('Failed to clear user caches', error);
      return false;
    }
  }

  /**
   * Clear project-specific caches
   */
  private async clearProjectCaches(): Promise<boolean> {
    try {
      const projectCacheCollection =
        this.vectorizationModel.db.collection('project_cache');

      // Remove all project caches
      const result = await projectCacheCollection.deleteMany({});

      this.logger.debug('Project caches cleared', {
        removed: result.deletedCount || 0,
      });

      return true;
    } catch (error) {
      this.logger.warn('Failed to clear project caches', error);
      return false;
    }
  }

  /**
   * Clear system-wide caches
   */
  private async clearSystemCaches(): Promise<boolean> {
    try {
      const systemCacheCollection =
        this.vectorizationModel.db.collection('system_cache');

      // Remove all system caches except critical ones
      const result = await systemCacheCollection.deleteMany({
        type: { $ne: 'critical_config' }, // Keep critical config
      });

      this.logger.debug('System caches cleared', {
        removed: result.deletedCount || 0,
      });

      return true;
    } catch (error) {
      this.logger.warn('Failed to clear system caches', error);
      return false;
    }
  }

  /**
   * Clear API response caches
   */
  private async clearApiResponseCaches(): Promise<boolean> {
    try {
      // Clear cached API responses
      const cacheCollection =
        this.vectorizationModel.db.collection('api_cache');

      // Remove expired cache entries
      const expiredCount = await cacheCollection.deleteMany({
        expiresAt: { $lt: new Date() },
      });

      // For full reindex, also clear all cache entries
      const allCount = await cacheCollection.deleteMany({});

      this.logger.debug('API response caches cleared', {
        expiredRemoved: expiredCount.deletedCount || 0,
        totalRemoved: allCount.deletedCount || 0,
      });

      return true;
    } catch (error) {
      this.logger.warn('Failed to clear API response caches', error);
      return false;
    }
  }

  /**
   * Clear computed aggregations cache
   */
  private async clearAggregationCaches(): Promise<boolean> {
    try {
      // Clear cached aggregations
      const aggregationCollection =
        this.vectorizationModel.db.collection('aggregation_cache');

      // For reindex, clear all aggregations (they will be rebuilt)
      const result = await aggregationCollection.deleteMany({});

      this.logger.debug('Aggregation caches cleared', {
        aggregationsRemoved: result.deletedCount || 0,
      });

      return true;
    } catch (error) {
      this.logger.warn('Failed to clear aggregation caches', error);
      return false;
    }
  }

  /**
   * Refresh computed aggregations
   */
  private async refreshAggregations(stats: ReindexStats): Promise<void> {
    try {
      // Refresh user usage aggregations
      await this.refreshUserAggregations();

      // Refresh project usage aggregations
      await this.refreshProjectAggregations();

      // Refresh system-wide metrics
      await this.refreshSystemMetrics();

      this.logger.log('📊 Computed aggregations refreshed');
    } catch (error) {
      this.logger.error('Failed to refresh aggregations', error);
      throw error;
    }
  }

  /**
   * Refresh cache for a specific entity
   */
  private async refreshEntityCache(
    entityId: string,
    stats: ReindexStats,
  ): Promise<void> {
    try {
      // Determine entity type and refresh appropriate caches
      const isUserId = entityId.startsWith('user_') || entityId.length === 24; // MongoDB ObjectId length
      const isProjectId =
        entityId.startsWith('proj_') || entityId.length === 24;

      if (isUserId) {
        await this.refreshUserCache(entityId);
      } else if (isProjectId) {
        await this.refreshProjectCache(entityId);
      } else {
        // Generic entity cache refresh
        await this.refreshGenericEntityCache(entityId);
      }

      this.logger.debug(`Entity cache refreshed for ${entityId}`);
    } catch (error) {
      this.logger.warn(`Failed to refresh cache for entity ${entityId}`, error);
      stats.errors.push(
        `Entity cache refresh failed for ${entityId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Warm up frequently accessed caches
   */
  private async warmupCaches(): Promise<void> {
    try {
      // Identify frequently accessed data
      const frequentUsers = await this.getFrequentUsers();
      const frequentProjects = await this.getFrequentProjects();

      // Pre-populate caches for frequent entities
      for (const userId of frequentUsers.slice(0, 10)) {
        // Top 10
        await this.refreshUserCache(userId);
      }

      for (const projectId of frequentProjects.slice(0, 5)) {
        // Top 5
        await this.refreshProjectCache(projectId);
      }

      // Warm up system-wide caches
      await this.warmupSystemCaches();

      this.logger.log('🔥 Frequently accessed caches warmed up');
    } catch (error) {
      this.logger.error('Failed to warm up caches', error);
      throw error;
    }
  }

  /**
   * Refresh user usage aggregations
   */
  private async refreshUserAggregations(): Promise<void> {
    const aggregationCollection =
      this.vectorizationModel.db.collection('user_aggregations');

    // Run complex aggregation pipeline to calculate user metrics
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const userAggregations = await this.vectorizationModel.db
      .collection('usage')
      .aggregate([
        {
          $match: {
            timestamp: { $gte: thirtyDaysAgo },
          },
        },
        {
          $group: {
            _id: '$userId',
            totalRequests: { $sum: 1 },
            totalTokens: { $sum: '$totalTokens' },
            totalCost: { $sum: '$cost' },
            avgLatency: { $avg: '$latencyMs' },
            lastActivity: { $max: '$timestamp' },
            firstActivity: { $min: '$timestamp' },
            uniqueProjects: { $addToSet: '$projectId' },
            uniqueModels: { $addToSet: '$model' },
            uniqueProviders: { $addToSet: '$provider' },
            dailyStats: {
              $push: {
                date: {
                  $dateToString: { format: '%Y-%m-%d', date: '$timestamp' },
                },
                tokens: '$totalTokens',
                cost: '$cost',
              },
            },
          },
        },
        {
          $addFields: {
            uniqueProjectCount: { $size: '$uniqueProjects' },
            uniqueModelCount: { $size: '$uniqueModels' },
            uniqueProviderCount: { $size: '$uniqueProviders' },
            activityPeriodDays: {
              $divide: [
                { $subtract: ['$lastActivity', '$firstActivity'] },
                1000 * 60 * 60 * 24,
              ],
            },
            avgDailyRequests: {
              $divide: ['$totalRequests', { $max: [1, '$activityPeriodDays'] }],
            },
            avgDailyTokens: {
              $divide: ['$totalTokens', { $max: [1, '$activityPeriodDays'] }],
            },
            avgDailyCost: {
              $divide: ['$totalCost', { $max: [1, '$activityPeriodDays'] }],
            },
          },
        },
        {
          $project: {
            userId: '$_id',
            totalRequests: 1,
            totalTokens: 1,
            totalCost: 1,
            avgLatency: 1,
            lastActivity: 1,
            firstActivity: 1,
            uniqueProjectCount: 1,
            uniqueModelCount: 1,
            uniqueProviderCount: 1,
            activityPeriodDays: 1,
            avgDailyRequests: 1,
            avgDailyTokens: 1,
            avgDailyCost: 1,
            lastRefreshed: new Date(),
            refreshVersion: 1,
          },
        },
      ])
      .toArray();

    // Upsert aggregations for each user
    for (const aggregation of userAggregations) {
      await aggregationCollection.updateOne(
        { userId: aggregation.userId },
        {
          $set: aggregation,
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true },
      );
    }

    this.logger.debug(
      `Refreshed aggregations for ${userAggregations.length} users`,
    );
  }

  /**
   * Refresh project usage aggregations
   */
  private async refreshProjectAggregations(): Promise<void> {
    const aggregationCollection = this.vectorizationModel.db.collection(
      'project_aggregations',
    );

    // Run aggregation pipeline for project metrics
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const projectAggregations = await this.vectorizationModel.db
      .collection('usage')
      .aggregate([
        {
          $match: {
            projectId: { $exists: true, $ne: null },
            timestamp: { $gte: thirtyDaysAgo },
          },
        },
        {
          $group: {
            _id: '$projectId',
            totalRequests: { $sum: 1 },
            totalTokens: { $sum: '$totalTokens' },
            totalCost: { $sum: '$cost' },
            avgLatency: { $avg: '$latencyMs' },
            lastActivity: { $max: '$timestamp' },
            firstActivity: { $min: '$timestamp' },
            uniqueUsers: { $addToSet: '$userId' },
            uniqueModels: { $addToSet: '$model' },
            uniqueProviders: { $addToSet: '$provider' },
            costByModel: {
              $push: {
                model: '$model',
                cost: '$cost',
                tokens: '$totalTokens',
              },
            },
          },
        },
        {
          $addFields: {
            uniqueUserCount: { $size: '$uniqueUsers' },
            uniqueModelCount: { $size: '$uniqueModels' },
            uniqueProviderCount: { $size: '$uniqueProviders' },
            activityPeriodDays: {
              $divide: [
                { $subtract: ['$lastActivity', '$firstActivity'] },
                1000 * 60 * 60 * 24,
              ],
            },
            avgDailyRequests: {
              $divide: ['$totalRequests', { $max: [1, '$activityPeriodDays'] }],
            },
            avgDailyTokens: {
              $divide: ['$totalTokens', { $max: [1, '$activityPeriodDays'] }],
            },
            avgDailyCost: {
              $divide: ['$totalCost', { $max: [1, '$activityPeriodDays'] }],
            },
          },
        },
        {
          $project: {
            projectId: '$_id',
            totalRequests: 1,
            totalTokens: 1,
            totalCost: 1,
            avgLatency: 1,
            lastActivity: 1,
            firstActivity: 1,
            uniqueUserCount: 1,
            uniqueModelCount: 1,
            uniqueProviderCount: 1,
            activityPeriodDays: 1,
            avgDailyRequests: 1,
            avgDailyTokens: 1,
            avgDailyCost: 1,
            lastRefreshed: new Date(),
            refreshVersion: 1,
          },
        },
      ])
      .toArray();

    // Upsert aggregations for each project
    for (const aggregation of projectAggregations) {
      await aggregationCollection.updateOne(
        { projectId: aggregation.projectId },
        {
          $set: aggregation,
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true },
      );
    }

    this.logger.debug(
      `Refreshed aggregations for ${projectAggregations.length} projects`,
    );
  }

  /**
   * Refresh system-wide metrics
   */
  private async refreshSystemMetrics(): Promise<void> {
    const metricsCollection =
      this.vectorizationModel.db.collection('system_metrics');

    const systemMetrics = {
      totalUsers: await this.vectorizationModel.db
        .collection('users')
        .countDocuments(),
      totalProjects: await this.vectorizationModel.db
        .collection('projects')
        .countDocuments(),
      totalRequests: await this.vectorizationModel.db
        .collection('usage')
        .countDocuments(),
      lastRefreshed: new Date(),
    };

    await metricsCollection.updateOne(
      { type: 'system_overview' },
      { $set: systemMetrics },
      { upsert: true },
    );
  }

  /**
   * Refresh user-specific cache
   */
  private async refreshUserCache(userId: string): Promise<void> {
    // Clear and refresh user-specific caches
    const userCacheCollection =
      this.vectorizationModel.db.collection('user_cache');

    // Remove old cache entries
    await userCacheCollection.deleteMany({
      userId,
      createdAt: { $lt: new Date(Date.now() - 60 * 60 * 1000) }, // Older than 1 hour
    });

    // Refresh with fresh data would go here
  }

  /**
   * Refresh project-specific cache
   */
  private async refreshProjectCache(projectId: string): Promise<void> {
    const projectCacheCollection =
      this.vectorizationModel.db.collection('project_cache');

    await projectCacheCollection.deleteMany({
      projectId,
      createdAt: { $lt: new Date(Date.now() - 60 * 60 * 1000) },
    });
  }

  /**
   * Refresh generic entity cache
   */
  private async refreshGenericEntityCache(entityId: string): Promise<void> {
    const genericCacheCollection =
      this.vectorizationModel.db.collection('entity_cache');

    await genericCacheCollection.deleteMany({
      entityId,
      createdAt: { $lt: new Date(Date.now() - 60 * 60 * 1000) },
    });
  }

  /**
   * Get frequently accessed users
   */
  private async getFrequentUsers(): Promise<string[]> {
    try {
      // Analyze usage patterns to find most active users in the last 7 days
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const frequentUsers = await this.vectorizationModel.db
        .collection('usage')
        .aggregate([
          {
            $match: {
              timestamp: { $gte: sevenDaysAgo },
            },
          },
          {
            $group: {
              _id: '$userId',
              requestCount: { $sum: 1 },
              totalTokens: { $sum: '$totalTokens' },
              lastActivity: { $max: '$timestamp' },
            },
          },
          {
            $sort: { requestCount: -1, totalTokens: -1 },
          },
          {
            $limit: 10,
          },
        ])
        .toArray();

      return frequentUsers.map((user) => user._id).filter(Boolean);
    } catch (error) {
      this.logger.warn(
        'Failed to get frequent users, using database fallback',
        error,
      );
      // Fallback to actual users from database
      try {
        const users = await this.userModel
          .find({ isActive: { $ne: false } }) // Get active users
          .sort({ createdAt: -1 }) // Most recent first
          .limit(10) // Limit to prevent too many
          .select('_id')
          .exec();

        const userIds = users
          .map((user) => user._id?.toString())
          .filter(Boolean);
        if (userIds.length > 0) {
          return userIds;
        }
      } catch (fallbackError) {
        this.logger.error(
          'Database fallback for users also failed',
          fallbackError,
        );
      }

      // Final fallback - empty array (better than fake data)
      return [];
    }
  }

  /**
   * Get frequently accessed projects
   */
  private async getFrequentProjects(): Promise<string[]> {
    try {
      // Analyze project access patterns
      const frequentProjects = await this.vectorizationModel.db
        .collection('usage')
        .aggregate([
          {
            $match: {
              projectId: { $exists: true, $ne: null },
              timestamp: {
                $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
              },
            },
          },
          {
            $group: {
              _id: '$projectId',
              requestCount: { $sum: 1 },
              uniqueUsers: { $addToSet: '$userId' },
            },
          },
          {
            $addFields: {
              userCount: { $size: '$uniqueUsers' },
            },
          },
          {
            $sort: { requestCount: -1, userCount: -1 },
          },
          {
            $limit: 5,
          },
        ])
        .toArray();

      return frequentProjects.map((project) => project._id).filter(Boolean);
    } catch (error) {
      this.logger.warn(
        'Failed to get frequent projects, using database fallback',
        error,
      );
      // Fallback to actual projects from database
      try {
        const projects = await this.projectModel
          .find({}) // Get all projects
          .sort({ createdAt: -1 }) // Most recent first
          .limit(5) // Limit to prevent too many
          .select('_id')
          .exec();

        const projectIds = projects
          .map((project) => project._id?.toString())
          .filter(Boolean);
        if (projectIds.length > 0) {
          return projectIds;
        }
      } catch (fallbackError) {
        this.logger.error(
          'Database fallback for projects also failed',
          fallbackError,
        );
      }

      // Final fallback - empty array (better than fake data)
      return [];
    }
  }

  /**
   * Warm up system-wide caches
   */
  private async warmupSystemCaches(): Promise<void> {
    // Pre-populate system-wide cache entries
    const systemCacheCollection =
      this.vectorizationModel.db.collection('system_cache');

    const systemData = {
      appVersion: process.env.APP_VERSION || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      lastCacheWarmup: new Date(),
      cacheEntries: [
        'system_config',
        'feature_flags',
        'pricing_tiers',
        'supported_models',
      ],
    };

    await systemCacheCollection.updateOne(
      { type: 'system_overview' },
      { $set: systemData },
      { upsert: true },
    );
  }

  /**
   * Sync with external API
   */
  private async syncWithExternalAPI(
    system: string,
    stats: ReindexStats,
  ): Promise<void> {
    try {
      switch (system) {
        case 'search-index':
          await this.syncSearchIndex();
          break;

        case 'analytics':
          await this.syncAnalyticsPlatform();
          break;

        case 'monitoring':
          await this.syncMonitoringSystem();
          break;

        default:
          this.logger.warn(`Unknown external system: ${system}`);
      }

      this.logger.debug(`Synchronized with external ${system} system`);
    } catch (error) {
      stats.errors.push(
        `External sync ${system} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Validate external system synchronization
   */
  private async validateExternalSync(stats: ReindexStats): Promise<void> {
    try {
      // Validate search index sync
      await this.validateSearchIndexSync();

      // Validate analytics sync
      await this.validateAnalyticsSync();

      // Validate monitoring sync
      await this.validateMonitoringSync();

      this.logger.log('✅ External sync validation completed');
    } catch (error) {
      this.logger.error('External sync validation failed', error);
      stats.errors.push(
        `External sync validation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Sync with search index service
   */
  private async syncSearchIndex(): Promise<void> {
    if (!process.env.SEARCH_API_URL) {
      this.logger.debug('Search API not configured, skipping sync');
      return;
    }

    const syncData = {
      operation: 'full_reindex',
      timestamp: new Date(),
      collections: ['users', 'projects', 'usage', 'vectorization_documents'],
    };

    await firstValueFrom(
      this.httpService.post(`${process.env.SEARCH_API_URL}/sync`, syncData, {
        headers: {
          Authorization: `Bearer ${process.env.SEARCH_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }),
    );
  }

  /**
   * Sync with analytics platform
   */
  private async syncAnalyticsPlatform(): Promise<void> {
    if (!process.env.ANALYTICS_API_URL) {
      this.logger.debug('Analytics API not configured, skipping sync');
      return;
    }

    // Sync key metrics and aggregations
    const analyticsData = {
      syncType: 'reindex',
      metrics: [
        'user_engagement',
        'api_usage',
        'cost_analysis',
        'performance_metrics',
      ],
      timestamp: new Date(),
    };

    await firstValueFrom(
      this.httpService.post(
        `${process.env.ANALYTICS_API_URL}/sync`,
        analyticsData,
        {
          headers: {
            Authorization: `Bearer ${process.env.ANALYTICS_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      ),
    );
  }

  /**
   * Sync with monitoring system
   */
  private async syncMonitoringSystem(): Promise<void> {
    if (!process.env.MONITORING_API_URL) {
      this.logger.debug('Monitoring API not configured, skipping sync');
      return;
    }

    const monitoringData = {
      event: 'reindex_completed',
      timestamp: new Date(),
      metadata: {
        reindexType: 'full',
        collectionsAffected: [
          'users',
          'projects',
          'usage',
          'vectorization_documents',
        ],
      },
    };

    await firstValueFrom(
      this.httpService.post(
        `${process.env.MONITORING_API_URL}/events`,
        monitoringData,
        {
          headers: {
            Authorization: `Bearer ${process.env.MONITORING_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      ),
    );
  }

  /**
   * Validate search index synchronization
   */
  private async validateSearchIndexSync(): Promise<void> {
    if (!process.env.SEARCH_API_URL) return;

    const response = await firstValueFrom(
      this.httpService.get(`${process.env.SEARCH_API_URL}/health`, {
        timeout: 10000,
      }),
    );

    if (response.data.status !== 'healthy') {
      throw new Error('Search index sync validation failed');
    }
  }

  /**
   * Validate analytics synchronization
   */
  private async validateAnalyticsSync(): Promise<void> {
    if (!process.env.ANALYTICS_API_URL) return;

    const response = await firstValueFrom(
      this.httpService.get(`${process.env.ANALYTICS_API_URL}/status`, {
        timeout: 10000,
      }),
    );

    if (response.data.sync_status !== 'completed') {
      throw new Error('Analytics sync validation failed');
    }
  }

  /**
   * Validate monitoring synchronization
   */
  private async validateMonitoringSync(): Promise<void> {
    if (!process.env.MONITORING_API_URL) return;

    // Send a test event to validate monitoring is working
    const testEvent = {
      event: 'sync_validation_test',
      timestamp: new Date(),
      level: 'info',
    };

    await firstValueFrom(
      this.httpService.post(
        `${process.env.MONITORING_API_URL}/events`,
        testEvent,
        {
          headers: {
            Authorization: `Bearer ${process.env.MONITORING_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        },
      ),
    );
  }

  /**
   * Store reindex statistics
   */
  private async storeReindexStats(stats: ReindexStats): Promise<void> {
    try {
      const statsCollection =
        this.vectorizationModel.db.collection('reindex_stats');

      // Store the reindex run statistics
      await statsCollection.insertOne({
        ...stats,
        serverInfo: {
          hostname: require('os').hostname(),
          platform: process.platform,
          nodeVersion: process.version,
        },
        environment: process.env.NODE_ENV || 'development',
      });

      // Update rolling statistics
      await this.updateRollingStats(stats);

      // Check for performance regressions
      await this.checkPerformanceRegressions(stats);

      this.logger.debug('Reindex stats stored and analyzed', {
        type: stats.type,
        duration: stats.duration,
        itemsProcessed: stats.itemsProcessed,
      });
    } catch (error) {
      this.logger.warn('Failed to store reindex stats', error);
    }
  }

  /**
   * Update rolling statistics for trend analysis
   */
  private async updateRollingStats(stats: ReindexStats): Promise<void> {
    try {
      const rollingStatsCollection = this.vectorizationModel.db.collection(
        'reindex_rolling_stats',
      );

      // Keep last 30 days of daily stats
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      // Remove old stats
      await rollingStatsCollection.deleteMany({
        date: { $lt: thirtyDaysAgo },
      });

      // Get today's date key
      const todayKey = new Date().toISOString().split('T')[0];

      // Update or insert today's stats
      await rollingStatsCollection.updateOne(
        { date: todayKey, type: stats.type },
        {
          $inc: {
            totalRuns: 1,
            totalItemsProcessed: stats.itemsProcessed,
            totalDuration: stats.duration || 0,
            totalErrors: stats.errors.length,
          },
          $set: {
            lastRun: new Date(),
            averageDuration: 0, // Will be calculated
            averageItemsProcessed: 0, // Will be calculated
            errorRate: 0, // Will be calculated
          },
        },
        { upsert: true },
      );

      // Recalculate averages for today
      const todayStats = await rollingStatsCollection.findOne({
        date: todayKey,
        type: stats.type,
      });
      if (todayStats) {
        const avgDuration = todayStats.totalDuration / todayStats.totalRuns;
        const avgItemsProcessed =
          todayStats.totalItemsProcessed / todayStats.totalRuns;
        const errorRate = (todayStats.totalErrors / todayStats.totalRuns) * 100;

        await rollingStatsCollection.updateOne(
          { date: todayKey, type: stats.type },
          {
            $set: {
              averageDuration: Math.round(avgDuration),
              averageItemsProcessed: Math.round(avgItemsProcessed),
              errorRate: Math.round(errorRate * 100) / 100,
            },
          },
        );
      }
    } catch (error) {
      this.logger.warn('Failed to update rolling stats', error);
    }
  }

  /**
   * Check for performance regressions
   */
  private async checkPerformanceRegressions(
    stats: ReindexStats,
  ): Promise<void> {
    try {
      const rollingStatsCollection = this.vectorizationModel.db.collection(
        'reindex_rolling_stats',
      );

      // Get last 7 days of stats for comparison
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const recentStats = await rollingStatsCollection
        .find({
          type: stats.type,
          date: { $gte: sevenDaysAgo.toISOString().split('T')[0] },
        })
        .sort({ date: -1 })
        .limit(7)
        .toArray();

      if (recentStats.length < 2) {
        return; // Not enough data for comparison
      }

      // Calculate baseline (average of previous 6 days, excluding today)
      const baselineStats = recentStats.slice(1); // Exclude most recent (today)
      const avgBaselineDuration =
        baselineStats.reduce((sum, stat) => sum + stat.averageDuration, 0) /
        baselineStats.length;
      const avgBaselineItems =
        baselineStats.reduce(
          (sum, stat) => sum + stat.averageItemsProcessed,
          0,
        ) / baselineStats.length;

      // Check for regressions
      const durationRegression =
        stats.duration && stats.duration > avgBaselineDuration * 1.5; // 50% slower
      const throughputRegression =
        stats.itemsProcessed < avgBaselineItems * 0.7; // 30% less throughput

      if (durationRegression || throughputRegression) {
        this.logger.warn('Performance regression detected', {
          type: stats.type,
          currentDuration: stats.duration,
          baselineDuration: Math.round(avgBaselineDuration),
          currentItems: stats.itemsProcessed,
          baselineItems: Math.round(avgBaselineItems),
          durationRegression,
          throughputRegression,
        });

        // Could trigger alerts or create performance analysis tickets
        await this.createPerformanceAlert(stats, {
          durationRegression,
          throughputRegression,
          baselineDuration: avgBaselineDuration,
          baselineItems: avgBaselineItems,
        });
      }
    } catch (error) {
      this.logger.warn('Failed to check performance regressions', error);
    }
  }

  /**
   * Create performance alert
   */
  private async createPerformanceAlert(
    stats: ReindexStats,
    regressionData: any,
  ): Promise<void> {
    try {
      const alertCollection =
        this.vectorizationModel.db.collection('performance_alerts');

      await alertCollection.insertOne({
        type: 'reindex_performance_regression',
        reindexType: stats.type,
        timestamp: new Date(),
        regressionData,
        stats: {
          duration: stats.duration,
          itemsProcessed: stats.itemsProcessed,
          errors: stats.errors.length,
        },
        status: 'active',
        severity:
          regressionData.durationRegression &&
          regressionData.throughputRegression
            ? 'high'
            : 'medium',
      });

      this.logger.log('Performance alert created for reindex regression');
    } catch (error) {
      this.logger.warn('Failed to create performance alert', error);
    }
  }

  /**
   * Health check for reindex queue
   */
  private async healthCheck(): Promise<void> {
    if (!isRedisEnabled()) {
      return;
    }
    try {
      const waiting = await this.queue.getWaiting();
      const active = await this.queue.getActive();
      const completed = await this.queue.getCompleted();
      const failed = await this.queue.getFailed();

      this.logger.log('Reindex queue health check', {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
      });

      // Alert if too many failed jobs
      if (failed.length > 10) {
        this.logger.warn('High number of failed reindex jobs detected', {
          failedCount: failed.length,
        });
      }
    } catch (error) {
      this.logger.error('Reindex queue health check failed', error);
    }
  }
}
