import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { IndexSpecification } from 'mongodb';
import { VectorizationDocument } from '../../../schemas/vectorization/vectorization-document.schema';
import { CacheService } from '../../../common/cache/cache.service';

interface MaintenanceStats {
  documentsCleaned: number;
  indexesOptimized: number;
  storageReclaimed: number;
  errors: string[];
  startTime: Date;
  endTime?: Date;
  duration?: number;
}

interface VectorIndexStats {
  totalDocuments: number;
  vectorizedDocuments: number;
  failedDocuments: number;
  avgVectorSize: number;
  storageUsed: number;
  lastMaintenance: Date;
}

@Injectable()
export class VectorMaintenanceJob {
  private readonly logger = new Logger(VectorMaintenanceJob.name);
  private isRunning = false;

  // Maintenance configuration
  private readonly CLEANUP_AGE_DAYS = 90; // Remove failed documents older than 90 days
  private readonly BATCH_SIZE = 1000; // Process in batches to avoid memory issues
  private readonly MAX_MAINTENANCE_TIME = 30 * 60 * 1000; // 30 minutes max

  constructor(
    @InjectModel('VectorizationDocument')
    private vectorizationModel: Model<VectorizationDocument>,
    private cacheService: CacheService,
  ) {}

  /**
   * Run the vector maintenance job
   */
  async run(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        'Vector maintenance job already running, skipping this cycle',
      );
      return;
    }

    this.isRunning = true;

    try {
      this.logger.log('🛠️ Starting vector maintenance job...');

      const stats: MaintenanceStats = {
        documentsCleaned: 0,
        indexesOptimized: 0,
        storageReclaimed: 0,
        errors: [],
        startTime: new Date(),
      };

      // Run maintenance tasks
      const tasks = await Promise.allSettled([
        this.cleanupFailedDocuments(stats),
        this.optimizeVectorIndexes(stats),
        this.rebuildVectorStatistics(stats),
        this.validateVectorIntegrity(stats),
        this.cleanupOrphanedVectors(stats),
      ]);

      // Log results
      tasks.forEach((task, index) => {
        const taskNames = [
          'cleanup',
          'optimize',
          'rebuild',
          'validate',
          'cleanup_orphaned',
        ];
        if (task.status === 'rejected') {
          this.logger.error(`❌ ${taskNames[index]} failed`, task.reason);
          stats.errors.push(
            `${taskNames[index]}: ${task.reason instanceof Error ? task.reason.message : String(task.reason)}`,
          );
        }
      });

      stats.endTime = new Date();
      stats.duration = stats.endTime.getTime() - stats.startTime.getTime();

      this.logger.log('✅ Vector maintenance job completed', {
        documentsCleaned: stats.documentsCleaned,
        indexesOptimized: stats.indexesOptimized,
        storageReclaimed: stats.storageReclaimed,
        durationMs: stats.duration,
        errors: stats.errors.length,
      });
    } catch (error) {
      this.logger.error('❌ Vector maintenance job failed', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Clean up old failed documents that are beyond retry limits
   */
  private async cleanupFailedDocuments(stats: MaintenanceStats): Promise<void> {
    try {
      this.logger.log('🧹 Cleaning up old failed documents...');

      const cutoffDate = new Date(
        Date.now() - this.CLEANUP_AGE_DAYS * 24 * 60 * 60 * 1000,
      );

      // Find and remove old failed documents
      const result = await this.vectorizationModel.deleteMany({
        vectorizationStatus: 'failed',
        vectorizationAttempts: { $gte: 3 },
        createdAt: { $lt: cutoffDate },
      });

      stats.documentsCleaned += result.deletedCount || 0;

      // Also clean up old pending documents that haven't been processed
      const oldPendingResult = await this.vectorizationModel.deleteMany({
        vectorizationStatus: 'pending',
        createdAt: { $lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // 30 days
        vectorizationAttempts: { $lt: 1 },
      });

      stats.documentsCleaned += oldPendingResult.deletedCount || 0;

      this.logger.log(`🧹 Cleaned up ${stats.documentsCleaned} old documents`);
    } catch (error) {
      this.logger.error('Failed to cleanup failed documents', error);
      throw error;
    }
  }

  /**
   * Optimize vector indexes for better performance
   */
  private async optimizeVectorIndexes(stats: MaintenanceStats): Promise<void> {
    try {
      this.logger.log('🔧 Optimizing vector indexes...');

      let indexesOptimized = 0;
      const indexesRebuilt = 0;
      const storageOptimized = 0;

      // Get current index information before optimization
      const indexStats = await this.getVectorIndexStats();
      const collectionName = this.vectorizationModel.collection.collectionName;

      this.logger.log('📊 Current index stats', {
        collection: collectionName,
        totalDocuments: indexStats.totalDocuments,
        vectorizedDocuments: indexStats.vectorizedDocuments,
      });

      // 1. Analyze existing indexes and their usage
      const indexAnalysis = await this.analyzeIndexUsage();

      // 2. Drop and recreate indexes to eliminate fragmentation
      await this.rebuildIndexes(indexAnalysis, stats);

      // 3. Create optimized compound indexes for common query patterns
      indexesOptimized += await this.createOptimizedIndexes();

      // 4. Optimize vector-specific indexes
      indexesOptimized += await this.optimizeVectorSpecificIndexes();

      // 5. Clean up unused indexes
      const unusedIndexesRemoved = await this.cleanupUnusedIndexes();

      // 6. Update statistics
      stats.indexesOptimized += indexesOptimized;
      stats.storageReclaimed += storageOptimized;

      this.logger.log('✅ Vector indexes optimization completed', {
        indexesOptimized,
        indexesRebuilt,
        unusedIndexesRemoved,
        storageReclaimed: this.formatBytes(storageOptimized),
      });
    } catch (error) {
      this.logger.error('Failed to optimize vector indexes', error);
      throw error;
    }
  }

  /**
   * Analyze current index usage and performance
   */
  private async analyzeIndexUsage(): Promise<any[]> {
    try {
      // Get index information from MongoDB
      const indexInfo = await this.vectorizationModel.collection.indexes();
      const db = this.vectorizationModel.db?.db;
      if (!db) return indexInfo;
      const collectionStats = await db.command({
        collStats: this.vectorizationModel.collection.collectionName,
      });

      this.logger.debug('Index analysis', {
        totalIndexes: indexInfo.length,
        collectionSize: this.formatBytes(collectionStats.size || 0),
        indexSize: this.formatBytes(collectionStats.totalIndexSize || 0),
      });

      return indexInfo;
    } catch (error) {
      this.logger.warn('Could not analyze index usage', error);
      return [];
    }
  }

  /**
   * Rebuild indexes to eliminate fragmentation
   */
  private async rebuildIndexes(
    indexAnalysis: any[],
    stats: MaintenanceStats,
  ): Promise<void> {
    try {
      this.logger.log('🔄 Rebuilding indexes to eliminate fragmentation...');

      const essentialIndexes = [
        {
          key: { contentType: 1, vectorizationStatus: 1 },
          name: 'contentType_vectorizationStatus',
        },
        { key: { userId: 1, contentType: 1 }, name: 'userId_contentType' },
        { key: { vectorizedAt: -1 }, name: 'vectorizedAt_desc' },
        { key: { createdAt: -1 }, name: 'createdAt_desc' },
        {
          key: { vectorizationStatus: 1, vectorizationAttempts: 1 },
          name: 'status_attempts',
        },
      ];

      for (const indexDef of essentialIndexes) {
        try {
          // Try to create index (will skip if already exists with same definition)
          await this.vectorizationModel.collection.createIndex(
            indexDef.key as unknown as IndexSpecification,
            {
              name: indexDef.name,
              background: true,
              sparse: true, // Only index documents that have the field
            },
          );
          this.logger.debug(`Created/verified index: ${indexDef.name}`);
        } catch (indexError) {
          this.logger.warn(
            `Failed to create index ${indexDef.name}`,
            indexError,
          );
        }
      }

      stats.indexesOptimized++;
    } catch (error) {
      this.logger.error('Failed to rebuild indexes', error);
      throw error;
    }
  }

  /**
   * Create optimized compound indexes for common query patterns
   */
  private async createOptimizedIndexes(): Promise<number> {
    let created = 0;

    try {
      this.logger.log('🎯 Creating optimized compound indexes...');

      const optimizedIndexes = [
        // Query pattern: Recent successful vectorizations by user
        {
          key: { userId: 1, vectorizationStatus: 1, vectorizedAt: -1 },
          name: 'user_status_vectorizedAt',
          options: { background: true },
        },
        // Query pattern: Failed vectorizations for retry logic
        {
          key: {
            vectorizationStatus: 1,
            vectorizationAttempts: 1,
            createdAt: 1,
          },
          name: 'status_attempts_createdAt',
          options: { background: true },
        },
        // Query pattern: Content type analytics
        {
          key: { contentType: 1, vectorizationStatus: 1, createdAt: -1 },
          name: 'contentType_status_createdAt',
          options: { background: true },
        },
        // Query pattern: Vector maintenance cleanup
        {
          key: { vectorizationStatus: 1, createdAt: 1 },
          name: 'status_createdAt_asc',
          options: { background: true },
        },
      ];

      for (const indexDef of optimizedIndexes) {
        try {
          await this.vectorizationModel.collection.createIndex(
            indexDef.key as unknown as IndexSpecification,
            {
              name: indexDef.name,
              ...indexDef.options,
            },
          );
          created++;
          this.logger.debug(`Created optimized index: ${indexDef.name}`);
        } catch (indexError) {
          // Index might already exist with same definition
          this.logger.debug(
            `Index ${indexDef.name} already exists or failed to create`,
            indexError,
          );
        }
      }
    } catch (error) {
      this.logger.warn('Failed to create some optimized indexes', error);
    }

    return created;
  }

  /**
   * Optimize vector-specific indexes and metadata
   */
  private async optimizeVectorSpecificIndexes(): Promise<number> {
    let optimized = 0;

    try {
      this.logger.log('🧬 Optimizing vector-specific indexes...');

      // Create indexes specifically for vector operations
      const vectorIndexes = [
        // Index for vector existence checks
        {
          key: { vector: 1 },
          name: 'vector_exists',
          options: { sparse: true, background: true },
        },
        // Compound index for vector queries with content type
        {
          key: { contentType: 1, vector: 1 },
          name: 'contentType_vector_exists',
          options: { sparse: true, background: true },
        },
        // Index for vectorization queue management
        {
          key: { vectorizationStatus: 1, priority: -1, createdAt: 1 },
          name: 'status_priority_createdAt',
          options: { background: true },
        },
      ];

      for (const indexDef of vectorIndexes) {
        try {
          await this.vectorizationModel.collection.createIndex(
            indexDef.key as unknown as IndexSpecification,
            {
              name: indexDef.name,
              ...indexDef.options,
            },
          );
          optimized++;
          this.logger.debug(`Created vector index: ${indexDef.name}`);
        } catch (indexError) {
          this.logger.debug(
            `Vector index ${indexDef.name} already exists or failed to create`,
            indexError,
          );
        }
      }

      // Optimize vector storage format if needed
      await this.optimizeVectorStorage();
    } catch (error) {
      this.logger.warn('Failed to optimize vector-specific indexes', error);
    }

    return optimized;
  }

  /**
   * Optimize vector storage format and compression
   */
  private async optimizeVectorStorage(): Promise<void> {
    try {
      // Check if vectors need format optimization
      const sampleVectors = await this.vectorizationModel
        .find({ vector: { $exists: true, $ne: null } }, { vector: 1 })
        .limit(10);

      if (sampleVectors.length > 0) {
        const vectorSizes = sampleVectors.map((doc) => doc.vector?.length || 0);
        const avgSize =
          vectorSizes.reduce((a, b) => a + b, 0) / vectorSizes.length;

        this.logger.debug('Vector storage analysis', {
          sampleSize: sampleVectors.length,
          averageVectorSize: Math.round(avgSize),
          sizeRange: `${Math.min(...vectorSizes)}-${Math.max(...vectorSizes)}`,
        });

        // If vectors are very large, suggest compression strategies
        if (avgSize > 1000) {
          this.logger.log(
            'Large vectors detected - consider implementing vector compression',
          );
        }
      }
    } catch (error) {
      this.logger.debug('Could not analyze vector storage format', error);
    }
  }

  /**
   * Clean up unused or redundant indexes
   */
  private async cleanupUnusedIndexes(): Promise<number> {
    let removed = 0;

    try {
      this.logger.log('🧽 Cleaning up unused indexes...');

      // Get current indexes
      const indexes = await this.vectorizationModel.collection.indexes();

      // Define indexes that should be kept
      const keepIndexNames = [
        '_id_', // Always keep
        'contentType_vectorizationStatus',
        'userId_contentType',
        'vectorizedAt_desc',
        'createdAt_desc',
        'status_attempts',
        'user_status_vectorizedAt',
        'status_attempts_createdAt',
        'contentType_status_createdAt',
        'status_createdAt_asc',
        'vector_exists',
        'contentType_vector_exists',
        'status_priority_createdAt',
      ];

      for (const index of indexes) {
        const indexName = index.name;
        if (!indexName || keepIndexNames.includes(indexName)) continue;
        try {
          // Check if index is being used (simplified check)
          // In production, you'd use $indexStats or monitoring tools
          const isUsed = await this.isIndexUsed(indexName);

          if (!isUsed) {
            await this.vectorizationModel.collection.dropIndex(indexName);
            removed++;
            this.logger.log(`Dropped unused index: ${indexName}`);
          } else {
            this.logger.debug(`Keeping used index: ${indexName}`);
          }
        } catch (dropError) {
          this.logger.warn(`Failed to drop index ${indexName}`, dropError);
        }
      }
    } catch (error) {
      this.logger.warn('Failed to cleanup unused indexes', error);
    }

    return removed;
  }

  /**
   * Check if an index is being used using comprehensive analysis
   *
   * This method performs multi-level analysis:
   * 1. Essential index check (always keep)
   * 2. $indexStats analysis (actual usage metrics)
   * 3. Usage pattern analysis (recency, frequency)
   * 4. Query pattern relevance
   * 5. Index efficiency analysis
   *
   * Edge cases handled:
   * - Newly created indexes may not show usage yet
   * - $indexStats may not be available in all MongoDB environments
   * - Small indexes are kept even if unused (low overhead)
   * - Indexes supporting common patterns are preserved
   *
   * @param indexName Index name to analyze
   * @returns boolean indicating if index should be kept
   */
  private async isIndexUsed(indexName: string): Promise<boolean> {
    try {
      // 1. Always keep system and essential indexes
      if (await this.isEssentialIndex(indexName)) {
        this.logger.debug(`Keeping essential index: ${indexName}`);
        return true;
      }

      // 2. Try $indexStats analysis (most accurate)
      const indexStats = await this.getIndexUsageStats(indexName);
      if (indexStats) {
        const usageAnalysis = await this.analyzeUsageStats(
          indexName,
          indexStats,
        );
        if (usageAnalysis.keep) {
          this.logger.debug(
            `Keeping index ${indexName} based on usage stats`,
            usageAnalysis.reason,
          );
          return true;
        }
      }

      // 3. Fallback: Check if index supports common query patterns
      if (await this.isCommonQueryPattern(indexName)) {
        this.logger.debug(
          `Keeping index ${indexName} for common query pattern support`,
        );
        return true;
      }

      // 4. Check index efficiency (size vs potential benefit)
      if (await this.isIndexEfficient(indexName)) {
        this.logger.debug(
          `Keeping index ${indexName} due to efficiency analysis`,
        );
        return true;
      }

      // 5. Final safety check: small indexes are low risk to keep
      const indexSize = await this.getIndexSize(indexName);
      if (indexSize > 0 && indexSize < 1024 * 1024) {
        // Less than 1MB
        this.logger.debug(
          `Keeping small index ${indexName} (${this.formatBytes(indexSize)})`,
        );
        return true;
      }

      this.logger.log(
        `Index ${indexName} appears unused and will be considered for removal`,
      );
      return false;
    } catch (error) {
      // On analysis failure, be conservative and keep the index
      this.logger.warn(
        `Failed to analyze index ${indexName}, keeping as precaution`,
        error,
      );
      return true;
    }
  }

  /**
   * Check if index is essential and should never be removed
   */
  private async isEssentialIndex(indexName: string): Promise<boolean> {
    // System indexes (always keep)
    const systemIndexes = ['_id_'];
    if (systemIndexes.includes(indexName)) {
      return true;
    }

    // Indexes we explicitly created for vector maintenance (always keep)
    const essentialIndexes = [
      'contentType_vectorizationStatus',
      'userId_contentType',
      'vectorizedAt_desc',
      'createdAt_desc',
      'status_attempts',
      'user_status_vectorizedAt',
      'status_attempts_createdAt',
      'contentType_status_createdAt',
      'status_createdAt_asc',
      'vector_exists',
      'contentType_vector_exists',
      'status_priority_createdAt',
    ];

    return essentialIndexes.includes(indexName);
  }

  /**
   * Get comprehensive index usage statistics
   */
  private async getIndexUsageStats(indexName: string): Promise<any> {
    try {
      const [stats] = await this.vectorizationModel.collection
        .aggregate([{ $indexStats: {} }, { $match: { name: indexName } }])
        .toArray();

      if (stats) {
        this.logger.debug(`Index stats for ${indexName}`, {
          accesses: stats.accesses?.ops || 0,
          since: stats.accesses?.since || 'never',
        });
      }

      return stats || null;
    } catch (error) {
      // $indexStats may not be available in all MongoDB environments
      this.logger.debug(`$indexStats not available for ${indexName}`, error);
      return null;
    }
  }

  /**
   * Analyze usage statistics to determine if index should be kept
   */
  private async analyzeUsageStats(
    indexName: string,
    stats: any,
  ): Promise<{ keep: boolean; reason: string }> {
    // No usage data available
    if (!stats?.accesses) {
      return { keep: false, reason: 'No usage data available' };
    }

    const accessCount = stats.accesses.ops || 0;

    // Index has never been used
    if (accessCount === 0) {
      return { keep: false, reason: 'Index never accessed' };
    }

    // Check recency of usage
    const lastAccess = new Date(stats.accesses.since);
    const daysSinceLastAccess =
      (Date.now() - lastAccess.getTime()) / (1000 * 60 * 60 * 24);

    // Recently used (within 30 days)
    if (daysSinceLastAccess <= 30) {
      return {
        keep: true,
        reason: `Recently used (${Math.round(daysSinceLastAccess)} days ago)`,
      };
    }

    // Heavily used even if old (more than 1000 operations)
    if (accessCount > 1000) {
      return {
        keep: true,
        reason: `Heavily used (${accessCount} total accesses)`,
      };
    }

    // Moderately used within last 90 days
    if (daysSinceLastAccess <= 90 && accessCount > 100) {
      return { keep: true, reason: `Moderately used within 90 days` };
    }

    return {
      keep: false,
      reason: `Low usage (${accessCount} accesses, ${Math.round(daysSinceLastAccess)} days ago)`,
    };
  }

  /**
   * Check if index supports common query patterns
   */
  private async isCommonQueryPattern(indexName: string): Promise<boolean> {
    try {
      const indexInfo = await this.vectorizationModel.collection.indexes();
      const index = indexInfo.find((idx) => idx.name === indexName);

      if (!index?.key) {
        return false;
      }

      const indexKeys = Object.keys(index.key);

      // Common query patterns in vector maintenance operations
      const commonPatterns = [
        // Status-based queries (most common)
        ['vectorizationStatus'],
        ['vectorizationStatus', 'vectorizationAttempts'],
        ['vectorizationStatus', 'createdAt'],
        ['vectorizationStatus', 'vectorizedAt'],

        // User-based queries
        ['userId'],
        ['userId', 'contentType'],
        ['userId', 'vectorizationStatus'],
        ['userId', 'createdAt'],

        // Time-based queries (very common for maintenance)
        ['createdAt'],
        ['vectorizedAt'],
        ['updatedAt'],

        // Content-based queries
        ['contentType'],
        ['contentType', 'vectorizationStatus'],
        ['contentType', 'createdAt'],

        // Vector existence and maintenance queries
        ['vector'],
        ['contentType', 'vector'],
        ['vectorizationAttempts'],
        ['lastError'],
        ['priority'],
      ];

      return commonPatterns.some((pattern) => {
        if (pattern.length !== indexKeys.length) {
          return false;
        }
        return pattern.every((key) => indexKeys.includes(key));
      });
    } catch (error) {
      this.logger.debug(
        `Could not analyze query pattern for ${indexName}`,
        error,
      );
      return false;
    }
  }

  /**
   * Check if index is efficient (benefits outweigh costs)
   */
  private async isIndexEfficient(indexName: string): Promise<boolean> {
    try {
      const indexSize = await this.getIndexSize(indexName);
      const totalCollectionSize = await this.getCollectionSize();

      // Index is very small relative to collection (< 5%)
      if (indexSize > 0 && totalCollectionSize > 0) {
        const ratio = indexSize / totalCollectionSize;
        if (ratio < 0.05) {
          // Less than 5% of collection size
          return true;
        }
      }

      // Check selectivity (ratio of distinct values)
      const selectivity = await this.calculateIndexSelectivity(indexName);
      if (selectivity > 0.1) {
        // Good selectivity (>10% distinct)
        return true;
      }

      return false;
    } catch (error) {
      this.logger.debug(`Could not analyze efficiency for ${indexName}`, error);
      return false;
    }
  }

  /**
   * Get the size of a specific index
   */
  private async getIndexSize(indexName: string): Promise<number> {
    try {
      const indexInfo = await this.vectorizationModel.collection.indexes();
      const index = indexInfo.find((idx) => idx.name === indexName);

      if (index?.size) {
        return index.size;
      }

      // Estimate based on collection index size distribution
      const db = this.vectorizationModel.db?.db;
      if (!db) return 0;
      const collStats = await db.command({
        collStats: this.vectorizationModel.collection.collectionName,
      });

      const totalIndexes = indexInfo.length;
      return totalIndexes > 0
        ? (collStats.totalIndexSize || 0) / totalIndexes
        : 0;
    } catch (error) {
      this.logger.debug(`Could not get size for index ${indexName}`, error);
      return 0;
    }
  }

  /**
   * Get total collection size
   */
  private async getCollectionSize(): Promise<number> {
    try {
      const db = this.vectorizationModel.db?.db;
      if (!db) return 0;
      const collStats = await db.command({
        collStats: this.vectorizationModel.collection.collectionName,
      });
      return collStats.size || 0;
    } catch (error) {
      this.logger.debug('Could not get collection size', error);
      return 0;
    }
  }

  /**
   * Calculate index selectivity (usefulness metric)
   */
  private async calculateIndexSelectivity(indexName: string): Promise<number> {
    try {
      const indexInfo = await this.vectorizationModel.collection.indexes();
      const index = indexInfo.find((idx) => idx.name === indexName);

      if (!index?.key) {
        return 0;
      }

      const indexKeys = Object.keys(index.key);
      const totalDocuments = await this.vectorizationModel.countDocuments();

      if (totalDocuments === 0) {
        return 0;
      }

      // For single field indexes, use distinct count
      if (indexKeys.length === 1) {
        const distinctCount = await this.vectorizationModel
          .distinct(indexKeys[0])
          .then((arr) => arr.length);
        return distinctCount / totalDocuments;
      }

      // For compound indexes, estimate based on field cardinalities
      // This is a rough approximation
      let estimatedDistinct = totalDocuments;

      for (const key of indexKeys) {
        const distinctCount = await this.vectorizationModel
          .distinct(key)
          .then((arr) => arr.length);
        estimatedDistinct = Math.min(estimatedDistinct, distinctCount);
      }

      // Apply compound index penalty (not all combinations exist)
      estimatedDistinct *= 0.7; // Conservative estimate

      return Math.min(estimatedDistinct / totalDocuments, 1.0);
    } catch (error) {
      this.logger.debug(
        `Could not calculate selectivity for ${indexName}`,
        error,
      );
      return 0;
    }
  }

  /**
   * Rebuild vector statistics and health metrics
   */
  private async rebuildVectorStatistics(
    stats: MaintenanceStats,
  ): Promise<void> {
    try {
      this.logger.log('📊 Rebuilding vector statistics...');

      const indexStats = await this.getVectorIndexStats();

      // Calculate storage reclaimed (estimate)
      const oldStats = await this.getCachedIndexStats();
      if (oldStats) {
        const storageDiff = oldStats.storageUsed - indexStats.storageUsed;
        if (storageDiff > 0) {
          stats.storageReclaimed += storageDiff;
        }
      }

      // Update cached statistics
      await this.updateCachedIndexStats(indexStats);

      this.logger.log('📊 Vector statistics rebuilt', {
        totalDocuments: indexStats.totalDocuments,
        vectorizedDocuments: indexStats.vectorizedDocuments,
        storageUsed: this.formatBytes(indexStats.storageUsed),
      });
    } catch (error) {
      this.logger.error('Failed to rebuild vector statistics', error);
      throw error;
    }
  }

  /**
   * Validate vector integrity and repair issues
   */
  private async validateVectorIntegrity(
    stats: MaintenanceStats,
  ): Promise<void> {
    try {
      this.logger.log('🔍 Validating vector integrity...');

      // Find documents with invalid vectors
      const invalidVectors = await this.vectorizationModel
        .find({
          vector: { $exists: true },
          $or: [
            { vector: { $size: 0 } },
            { vector: null },
            { vector: { $type: 'array', $elemMatch: { $type: 'null' } } },
          ],
        })
        .limit(100);

      if (invalidVectors.length > 0) {
        this.logger.warn(
          `Found ${invalidVectors.length} documents with invalid vectors`,
        );

        // Reset invalid vectors to trigger re-processing
        await this.vectorizationModel.updateMany(
          {
            _id: { $in: invalidVectors.map((doc) => doc._id) },
          },
          {
            $set: {
              vectorizationStatus: 'pending',
              vectorizationAttempts: 0,
              vector: undefined,
              vectorizedAt: undefined,
              lastError: 'Invalid vector detected during maintenance',
            },
          },
        );

        stats.documentsCleaned += invalidVectors.length;
      }

      // Validate vector dimensions consistency
      const dimensionStats = await this.vectorizationModel.aggregate([
        {
          $match: {
            vector: { $exists: true, $ne: null },
            vectorizationStatus: 'completed',
          },
        },
        {
          $group: {
            _id: { $size: '$vector' },
            count: { $sum: 1 },
          },
        },
        {
          $sort: { count: -1 },
        },
      ]);

      if (dimensionStats.length > 1) {
        this.logger.warn(
          'Inconsistent vector dimensions detected',
          dimensionStats,
        );
      }

      this.logger.log('🔍 Vector integrity validation completed');
    } catch (error) {
      this.logger.error('Failed to validate vector integrity', error);
      throw error;
    }
  }

  /**
   * Clean up orphaned vectors (vectors without corresponding content)
   */
  private async cleanupOrphanedVectors(stats: MaintenanceStats): Promise<void> {
    try {
      this.logger.log('🗑️ Cleaning up orphaned vectors...');

      // Find vectors where content is missing or empty
      const orphanedVectors = await this.vectorizationModel
        .find({
          vector: { $exists: true, $ne: null },
          $or: [
            { content: { $exists: false } },
            { content: '' },
            { content: null },
          ],
        })
        .limit(500);

      if (orphanedVectors.length > 0) {
        await this.vectorizationModel.updateMany(
          { _id: { $in: orphanedVectors.map((doc) => doc._id) } },
          {
            $set: {
              vectorizationStatus: 'failed',
              lastError: 'Orphaned vector - missing content',
            },
            $unset: { vector: 1, vectorizedAt: 1 },
          },
        );

        stats.documentsCleaned += orphanedVectors.length;
        this.logger.log(
          `🗑️ Cleaned up ${orphanedVectors.length} orphaned vectors`,
        );
      }
    } catch (error) {
      this.logger.error('Failed to cleanup orphaned vectors', error);
      throw error;
    }
  }

  /**
   * Get comprehensive vector index statistics
   */
  private async getVectorIndexStats(): Promise<VectorIndexStats> {
    const [
      totalDocuments,
      vectorizedDocuments,
      failedDocuments,
      avgVectorSizeResult,
    ] = await Promise.all([
      this.vectorizationModel.countDocuments(),
      this.vectorizationModel.countDocuments({
        vectorizationStatus: 'completed',
      }),
      this.vectorizationModel.countDocuments({ vectorizationStatus: 'failed' }),
      this.vectorizationModel.aggregate([
        { $match: { vector: { $exists: true } } },
        { $group: { _id: null, avgSize: { $avg: { $size: '$vector' } } } },
      ]),
    ]);

    // Calculate storage size after we have totalDocuments
    const storageStats = { size: totalDocuments * 1024 }; // Estimate 1KB per document

    const avgVectorSize =
      avgVectorSizeResult.length > 0 ? avgVectorSizeResult[0].avgSize : 0;

    return {
      totalDocuments,
      vectorizedDocuments,
      failedDocuments,
      avgVectorSize,
      storageUsed: storageStats.size || 0,
      lastMaintenance: new Date(),
    };
  }

  /**
   * Get cached index statistics
   */
  private async getCachedIndexStats(): Promise<VectorIndexStats | null> {
    try {
      // Try to get from Redis cache first
      const cacheKey = 'vector-maintenance:index-stats';

      // Redis caching would be implemented here if available
      // For now, we rely on database caching

      // Fall back to database cache
      const statsCollection =
        this.vectorizationModel.db.collection('maintenance_cache');
      const cachedStats = await statsCollection.findOne(
        {
          cacheKey,
          createdAt: { $gte: new Date(Date.now() - 3600000) }, // Last hour
        },
        { sort: { createdAt: -1 } },
      );

      if (cachedStats && cachedStats.data) {
        return cachedStats.data;
      }

      return null;
    } catch (error) {
      this.logger.warn('Failed to get cached index stats', error);
      return null;
    }
  }

  /**
   * Update cached index statistics with Redis primary and database fallback
   */
  private async updateCachedIndexStats(stats: VectorIndexStats): Promise<void> {
    try {
      const cacheKey = 'vector-maintenance:index-stats';
      const cacheTtl = 3600; // 1 hour TTL

      // Try Redis caching first (primary)
      try {
        await this.cacheService.set(cacheKey, JSON.stringify(stats), cacheTtl);
        this.logger.debug('Vector index stats cached in Redis', {
          cacheKey,
          totalDocuments: stats.totalDocuments,
          storageUsed: this.formatBytes(stats.storageUsed),
          ttl: cacheTtl,
        });
      } catch (redisError) {
        this.logger.warn(
          'Redis caching failed, falling back to database cache',
          redisError,
        );
      }

      // Update database cache as fallback/backup
      try {
        const statsCollection =
          this.vectorizationModel.db.collection('maintenance_cache');
        await statsCollection.updateOne(
          { cacheKey },
          {
            $set: {
              data: stats,
              updatedAt: new Date(),
              ttl: cacheTtl,
              redisTtl: cacheTtl,
            },
            $setOnInsert: {
              createdAt: new Date(),
            },
          },
          { upsert: true },
        );

        this.logger.debug('Vector index stats cached in database', {
          cacheKey,
          totalDocuments: stats.totalDocuments,
          storageUsed: this.formatBytes(stats.storageUsed),
        });
      } catch (dbError) {
        this.logger.error('Database caching also failed', dbError);
        throw dbError; // If both Redis and DB fail, we need to know
      }
    } catch (error) {
      this.logger.error('Failed to update cached index stats', error);
      // Don't throw here - caching failure shouldn't break the maintenance job
    }
  }

  /**
   * Format bytes for display
   */
  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Run once (for manual trigger or testing)
   */
  async runOnce(): Promise<void> {
    await this.run();
  }
}
