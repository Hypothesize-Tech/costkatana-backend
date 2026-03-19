/**
 * FAISS Vector Service for NestJS
 * Manages global index for internal data and per-user indices for user data
 * FAISS stores DERIVED data only - MongoDB remains source of truth
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FaissStore } from '@langchain/community/vectorstores/faiss';
import { Document as LangchainDocument } from '@langchain/core/documents';
import { SafeBedrockEmbeddingsService } from './safe-bedrock-embeddings.service';
import type { VectorWriteQueueService } from './vector-write-queue.service';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { LRUCache } from 'lru-cache';

export const DERIVED_VECTOR_SOURCES = [
  'knowledge-base', // Global index - rebuildable from /knowledge-base/
  'telemetry', // Global index - rebuildable from MongoDB
  'activity', // Global index - rebuildable from MongoDB
  'conversation', // Per-user index - rebuildable from MongoDB
  'user-upload', // Per-user index - rebuildable from MongoDB + S3
] as const;

export type VectorSource = (typeof DERIVED_VECTOR_SOURCES)[number];

// Sources that go to global index (internal/system data)
export const GLOBAL_INDEX_SOURCES: VectorSource[] = [
  'knowledge-base',
  'telemetry',
  'activity',
];

// Sources that go to per-user indices (user-owned data)
export const USER_INDEX_SOURCES: VectorSource[] = [
  'conversation',
  'user-upload',
];

/** Sentinel marker for FAISS index initialization - FAISS requires ≥1 doc to create. Filter at query time. */
export const FAISS_SENTINEL_MARKER = '_faiss_sentinel' as const;

/** Check if a document is the FAISS init sentinel (must be filtered from search results). Supports legacy _dummy marker. */
export function isFaissSentinelDocument(doc: {
  metadata?: Record<string, unknown>;
}): boolean {
  const m = doc.metadata;
  return m?.[FAISS_SENTINEL_MARKER] === true || m?._dummy === true;
}

export interface VectorSearchOptions {
  k?: number; // Number of results to return
  filter?: Record<string, any>; // Metadata filters
  userId?: string; // User ID for isolation
  scoreThreshold?: number; // Minimum similarity score
  includeScores?: boolean; // Include similarity scores
}

export interface VectorSearchResult {
  document: LangchainDocument;
  score: number;
  documentId?: string;
}

export interface IndexHealthStatus {
  indexPath: string;
  exists: boolean;
  isValid: boolean;
  documentCount: number;
  sizeBytes: number;
  lastModified?: Date;
  lastValidation?: Date;
  needsRebuild: boolean;
  error?: string;
}

export interface WriteQueueItem {
  id: string;
  userId?: string;
  documents: LangchainDocument[];
  metadata: {
    source: VectorSource;
    timestamp: Date;
    retryCount: number;
    maxRetries: number;
  };
}

export interface FaissIndexConfig {
  indexPath: string;
  maxLoadedIndices: number;
  writeBatchSize: number;
  writeBatchTimeoutMs: number;
  autoSave: boolean;
  compressionLevel?: number;
}

@Injectable()
export class FaissVectorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FaissVectorService.name);
  private globalIndex?: FaissStore;
  private userIndices: LRUCache<string, FaissStore>;
  private indexChecksums: Map<string, string> = new Map();
  private isInitialized = false;
  private readonly config: FaissIndexConfig;

  // Write queue implementation
  private queue: WriteQueueItem[] = [];
  private isProcessing = false;
  private batchTimer?: NodeJS.Timeout;
  private processingTimes: number[] = [];
  private maxProcessingTimeSamples = 100;

  constructor(
    private configService: ConfigService,
    private embeddingsService: SafeBedrockEmbeddingsService,
    @Inject(
      forwardRef(
        () => require('./vector-write-queue.service').VectorWriteQueueService,
      ),
    )
    private writeQueueService: VectorWriteQueueService,
  ) {
    this.config = {
      indexPath: this.configService.get<string>(
        'FAISS_INDEX_PATH',
        './data/faiss',
      ),
      maxLoadedIndices: this.configService.get<number>(
        'FAISS_MAX_LOADED_INDICES',
        100,
      ),
      writeBatchSize: this.configService.get<number>(
        'FAISS_WRITE_BATCH_SIZE',
        50,
      ),
      writeBatchTimeoutMs: this.configService.get<number>(
        'FAISS_WRITE_BATCH_TIMEOUT_MS',
        5000,
      ),
      autoSave: this.configService.get<boolean>('FAISS_AUTO_SAVE', true),
    };

    // LRU cache for user indices (max 100 loaded in memory)
    this.userIndices = new LRUCache<string, FaissStore>({
      max: this.config.maxLoadedIndices,
      dispose: async (value, key) => {
        // Save index before removing from cache
        if (this.config.autoSave) {
          try {
            await this.saveUserIndex(key, value);
          } catch (error) {
            this.logger.error(
              `Failed to save user index on eviction for ${key}`,
              {
                error: error instanceof Error ? error.message : String(error),
              },
            );
          }
        }
      },
      ttl: 1000 * 60 * 60, // 1 hour TTL
    });
  }

  async onModuleInit(): Promise<void> {
    await this.initialize();
  }

  async onModuleDestroy(): Promise<void> {
    await this.shutdown();
  }

  /**
   * Initialize the service and load/create global index
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      this.logger.log('Initializing FAISS Vector Service', {
        config: this.config,
      });

      // Ensure directories exist
      await this.ensureDirectories();

      // Load or create global index
      await this.loadOrCreateGlobalIndex();

      this.isInitialized = true;

      this.logger.log('FAISS Vector Service initialized successfully', {
        globalIndexLoaded: !!this.globalIndex,
      });
    } catch (error) {
      this.logger.error('Failed to initialize FAISS Vector Service', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Ensure required directories exist
   */
  private async ensureDirectories(): Promise<void> {
    const dirs = [
      this.config.indexPath,
      path.join(this.config.indexPath, 'global'),
      path.join(this.config.indexPath, 'users'),
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        this.logger.log('Created directory', { directory: dir });
      }
    }
  }

  /**
   * Load or create the global index
   */
  private async loadOrCreateGlobalIndex(): Promise<void> {
    const globalPath = path.join(this.config.indexPath, 'global');
    const indexFile = path.join(globalPath, 'faiss.index');

    try {
      if (fs.existsSync(indexFile)) {
        // Validate checksum before loading
        if (await this.validateChecksum(globalPath)) {
          this.globalIndex = await FaissStore.load(
            globalPath,
            this.embeddingsService,
          );
          this.logger.log('Global FAISS index loaded successfully', {
            path: globalPath,
          });
        } else {
          this.logger.warn(
            'Global index checksum validation failed, creating new index',
            { path: globalPath },
          );
          this.globalIndex = await this.createNewIndex();
          await this.saveGlobalIndex();
        }
      } else {
        this.globalIndex = await this.createNewIndex();
        await this.saveGlobalIndex();
        this.logger.log('Created new global FAISS index', { path: globalPath });
      }
    } catch (error) {
      this.logger.error('Failed to load global index, creating new one', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.globalIndex = await this.createNewIndex();
      await this.saveGlobalIndex();
    }
  }

  /**
   * Get or load a user's FAISS index
   */
  async getUserIndex(userId: string): Promise<FaissStore> {
    if (!userId) {
      throw new Error('User ID is required for user index');
    }

    // Check cache first
    if (this.userIndices.has(userId)) {
      return this.userIndices.get(userId)!;
    }

    // Load from disk or create new
    const userPath = path.join(this.config.indexPath, 'users', userId);
    const indexFile = path.join(userPath, 'faiss.index');

    let userIndex: FaissStore;

    try {
      if (fs.existsSync(indexFile)) {
        // Validate checksum before loading
        if (await this.validateChecksum(userPath)) {
          userIndex = await FaissStore.load(userPath, this.embeddingsService);
          this.logger.log('User FAISS index loaded', {
            userId,
            path: userPath,
          });
        } else {
          this.logger.warn(
            'User index checksum validation failed, creating new index',
            { userId, path: userPath },
          );
          userIndex = await this.createNewIndex();
          await this.saveUserIndex(userId, userIndex);
        }
      } else {
        // Create new user index
        if (!fs.existsSync(userPath)) {
          fs.mkdirSync(userPath, { recursive: true });
        }
        userIndex = await this.createNewIndex();
        await this.saveUserIndex(userId, userIndex);
        this.logger.log('Created new user FAISS index', {
          userId,
          path: userPath,
        });
      }

      // Cache the index
      this.userIndices.set(userId, userIndex);
      return userIndex;
    } catch (error) {
      this.logger.error('Failed to load user index, creating new one', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      userIndex = await this.createNewIndex();
      this.userIndices.set(userId, userIndex);
      return userIndex;
    }
  }

  /**
   * Get the global index
   */
  async getGlobalIndex(): Promise<FaissStore> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    if (!this.globalIndex) {
      throw new Error('Global index not initialized');
    }
    return this.globalIndex;
  }

  /**
   * Create a new empty FAISS index.
   * FAISS/LangChain requires at least one document to create an index.
   * We use a sentinel document marked with FAISS_SENTINEL_MARKER; filter via isFaissSentinelDocument() at query time.
   */
  private async createNewIndex(): Promise<FaissStore> {
    const sentinelDoc = new LangchainDocument({
      pageContent: '',
      metadata: {
        [FAISS_SENTINEL_MARKER]: true,
        _createdAt: new Date().toISOString(),
      },
    });
    return await FaissStore.fromDocuments(
      [sentinelDoc],
      this.embeddingsService,
    );
  }

  /**
   * Add documents to the appropriate index via write queue
   */
  async addDocuments(
    documents: LangchainDocument[],
    source: VectorSource,
    userId?: string,
  ): Promise<void> {
    // Use the centralized write queue service for batch processing
    await this.writeQueueService.enqueue(documents, source, userId);
  }

  /**
   * Process a batch of documents (called by WriteQueueService)
   */
  async processBatchForWriteQueue(batchItems: any[]): Promise<void> {
    // Group items by index (global vs user)
    const globalItems: LangchainDocument[] = [];
    const userItems = new Map<string, LangchainDocument[]>();

    for (const item of batchItems) {
      if (GLOBAL_INDEX_SOURCES.includes(item.metadata.source)) {
        globalItems.push(...item.documents);
      } else if (
        USER_INDEX_SOURCES.includes(item.metadata.source) &&
        item.userId
      ) {
        if (!userItems.has(item.userId)) {
          userItems.set(item.userId, []);
        }
        userItems.get(item.userId)!.push(...item.documents);
      }
    }

    // Process global items
    if (globalItems.length > 0) {
      await this.addToGlobalIndex(globalItems);
    }

    // Process user items
    for (const [userId, docs] of userItems) {
      await this.addToUserIndex(userId, docs);
    }
  }

  /**
   * Add documents to the global FAISS index
   */
  private async addToGlobalIndex(
    globalItems: LangchainDocument[],
  ): Promise<void> {
    const globalIndex = await this.getGlobalIndex();
    await globalIndex.addDocuments(globalItems);
    if (this.config.autoSave) {
      await this.saveGlobalIndex();
    }
    this.logger.debug('Added documents to global index', {
      documentCount: globalItems.length,
    });
  }

  /**
   * Add documents to a user's FAISS index
   */
  private async addToUserIndex(
    userId: string,
    docs: LangchainDocument[],
  ): Promise<void> {
    const userIndex = await this.getUserIndex(userId);
    await userIndex.addDocuments(docs);
    if (this.config.autoSave) {
      await this.saveUserIndex(userId, userIndex);
    }
    this.logger.debug('Added documents to user index', {
      userId,
      documentCount: docs.length,
    });
  }

  /**
   * Enqueue documents for writing to FAISS
   */
  private async enqueue(
    documents: LangchainDocument[],
    source: VectorSource,
    userId?: string,
  ): Promise<string> {
    const itemId = crypto.randomUUID();

    // Validate user isolation
    if (USER_INDEX_SOURCES.includes(source) && !userId) {
      throw new Error(`User ID required for source: ${source}`);
    }

    if (GLOBAL_INDEX_SOURCES.includes(source) && userId) {
      this.logger.warn(
        'User ID provided for global index source, will be ignored',
        {
          source,
          userId,
        },
      );
      userId = undefined;
    }

    const item: WriteQueueItem = {
      id: itemId,
      userId,
      documents,
      metadata: {
        source,
        timestamp: new Date(),
        retryCount: 0,
        maxRetries: 3,
      },
    };

    this.queue.push(item);

    this.logger.log('Documents enqueued for FAISS write', {
      itemId,
      documentCount: documents.length,
      source,
      userId,
      queueDepth: this.queue.length,
    });

    // Start processing if batch size reached
    if (this.queue.length >= this.config.writeBatchSize) {
      this.clearBatchTimer();
      await this.processBatch();
    } else {
      // Set timer for batch timeout
      this.resetBatchTimer();
    }

    return itemId;
  }

  /**
   * Process a batch of write queue items
   */
  private async processBatch(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const startTime = Date.now();

    // Extract batch (up to batchSize items)
    const batch = this.queue.splice(0, this.config.writeBatchSize);

    try {
      this.logger.log('Processing write batch', {
        batchSize: batch.length,
        remainingQueue: this.queue.length,
      });

      // Group items by index (global vs user)
      const globalItems: LangchainDocument[] = [];
      const userItems = new Map<string, LangchainDocument[]>();

      for (const item of batch) {
        if (GLOBAL_INDEX_SOURCES.includes(item.metadata.source)) {
          globalItems.push(...item.documents);
        } else if (
          USER_INDEX_SOURCES.includes(item.metadata.source) &&
          item.userId
        ) {
          if (!userItems.has(item.userId)) {
            userItems.set(item.userId, []);
          }
          userItems.get(item.userId)!.push(...item.documents);
        }
      }

      // Process global items
      if (globalItems.length > 0) {
        try {
          const globalIndex = await this.getGlobalIndex();
          await globalIndex.addDocuments(globalItems);

          if (this.config.autoSave) {
            await this.saveGlobalIndex();
          }

          this.logger.log('Added documents to global index', {
            documentCount: globalItems.length,
          });
        } catch (error) {
          this.logger.error('Failed to add documents to global index', {
            documentCount: globalItems.length,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      }

      // Process user items
      for (const [userId, docs] of userItems) {
        try {
          const userIndex = await this.getUserIndex(userId);
          await userIndex.addDocuments(docs);

          if (this.config.autoSave) {
            await this.saveUserIndex(userId, userIndex);
          }

          this.logger.log('Added documents to user index', {
            userId,
            documentCount: docs.length,
          });
        } catch (error) {
          this.logger.error('Failed to add documents to user index', {
            userId,
            documentCount: docs.length,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      }

      // Update processing time stats
      const processingTime = Date.now() - startTime;
      this.updateProcessingTimeStats(processingTime);

      this.logger.log('Write batch processed successfully', {
        batchSize: batch.length,
        processingTime,
      });
    } catch (error) {
      this.logger.error('Critical error processing write batch', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Put items back in queue for retry
      this.queue.unshift(...batch);
    } finally {
      this.isProcessing = false;

      // Process next batch if queue has items
      if (this.queue.length > 0) {
        if (this.queue.length >= this.config.writeBatchSize) {
          // Process immediately if batch size reached
          setImmediate(() => this.processBatch());
        } else {
          // Reset timer for remaining items
          this.resetBatchTimer();
        }
      }
    }
  }

  /**
   * Search for similar documents
   */
  async search(
    query: string,
    options: VectorSearchOptions = {},
  ): Promise<VectorSearchResult[]> {
    const { k = 4, userId, scoreThreshold = 0.0 } = options;

    try {
      // Determine which index to search
      let index: FaissStore;
      if (userId) {
        // Search user index
        index = await this.getUserIndex(userId);
      } else {
        // Search global index
        index = await this.getGlobalIndex();
      }

      // Perform similarity search with scores
      const results = await index.similaritySearchWithScore(query, k);

      // Filter sentinel document and apply score threshold
      const filteredResults: VectorSearchResult[] = results
        .filter(
          ([doc, score]) =>
            !isFaissSentinelDocument(doc) && score >= scoreThreshold,
        )
        .map(([doc, score]) => ({
          document: doc,
          score,
          documentId: doc.metadata.documentId,
        }));

      this.logger.log('FAISS search completed', {
        query: query.substring(0, 50),
        userId,
        resultsFound: filteredResults.length,
        k,
      });

      return filteredResults;
    } catch (error) {
      this.logger.error('FAISS search failed', {
        query: query.substring(0, 50),
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Save global index with atomic write
   */
  async saveGlobalIndex(): Promise<void> {
    if (!this.globalIndex) return;

    const globalPath = path.join(this.config.indexPath, 'global');
    await this.saveIndexAtomic(this.globalIndex, globalPath);

    this.logger.log('Global index saved', { path: globalPath });
  }

  /**
   * Save user index with atomic write
   */
  async saveUserIndex(userId: string, index: FaissStore): Promise<void> {
    const userPath = path.join(this.config.indexPath, 'users', userId);

    if (!fs.existsSync(userPath)) {
      fs.mkdirSync(userPath, { recursive: true });
    }

    await this.saveIndexAtomic(index, userPath);

    this.logger.log('User index saved', { userId, path: userPath });
  }

  /**
   * Save index atomically (temp file → rename)
   */
  private async saveIndexAtomic(
    index: FaissStore,
    indexPath: string,
  ): Promise<void> {
    const tempPath = `${indexPath}_temp_${Date.now()}`;

    try {
      // Save to temp location
      await index.save(tempPath);

      // Calculate checksum
      const checksum = await this.calculateChecksum(tempPath);
      fs.writeFileSync(path.join(tempPath, 'checksum.txt'), checksum);

      // Atomic rename (move temp to final)
      if (fs.existsSync(indexPath)) {
        // Backup existing index
        const backupPath = `${indexPath}_backup`;
        if (fs.existsSync(backupPath)) {
          fs.rmSync(backupPath, { recursive: true, force: true });
        }
        fs.renameSync(indexPath, backupPath);
      }

      fs.renameSync(tempPath, indexPath);
      this.indexChecksums.set(indexPath, checksum);
    } catch (error) {
      // Clean up temp directory on failure
      if (fs.existsSync(tempPath)) {
        fs.rmSync(tempPath, { recursive: true, force: true });
      }
      throw error;
    }
  }

  /**
   * Validate index integrity using checksum
   */
  async validateIndex(userId?: string): Promise<boolean> {
    const indexPath = userId
      ? path.join(this.config.indexPath, 'users', userId)
      : path.join(this.config.indexPath, 'global');

    return await this.validateChecksum(indexPath);
  }

  /**
   * Validate checksum for an index
   */
  private async validateChecksum(indexPath: string): Promise<boolean> {
    try {
      const checksumFile = path.join(indexPath, 'checksum.txt');

      if (!fs.existsSync(checksumFile)) {
        this.logger.warn('No checksum file found', { path: indexPath });
        return true; // Allow loading if no checksum exists (backwards compatibility)
      }

      const storedChecksum = fs.readFileSync(checksumFile, 'utf-8').trim();
      const currentChecksum = await this.calculateChecksum(indexPath);

      return storedChecksum === currentChecksum;
    } catch (error) {
      this.logger.error('Checksum validation failed', {
        path: indexPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Calculate checksum for an index directory
   */
  private async calculateChecksum(indexPath: string): Promise<string> {
    const indexFile = path.join(indexPath, 'faiss.index');

    if (!fs.existsSync(indexFile)) {
      throw new Error(`Index file not found: ${indexFile}`);
    }

    const fileBuffer = fs.readFileSync(indexFile);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
  }

  /**
   * Get health status for an index
   */
  async getIndexHealth(userId?: string): Promise<IndexHealthStatus> {
    const indexPath = userId
      ? path.join(this.config.indexPath, 'users', userId)
      : path.join(this.config.indexPath, 'global');

    const indexFile = path.join(indexPath, 'faiss.index');
    const exists = fs.existsSync(indexFile);

    const status: IndexHealthStatus = {
      indexPath,
      exists,
      isValid: false,
      documentCount: 0,
      sizeBytes: 0,
      needsRebuild: false,
    };

    if (exists) {
      try {
        const stats = fs.statSync(indexFile);
        status.sizeBytes = stats.size;
        status.lastModified = stats.mtime;
        status.isValid = await this.validateChecksum(indexPath);

        // Try to load and get document count
        try {
          const index = userId
            ? await this.getUserIndex(userId)
            : await this.getGlobalIndex();

          // Estimate document count (FAISS doesn't expose this directly)
          // We'll search with a dummy query and high k to estimate
          const results = await index.similaritySearch('', 1000);
          status.documentCount = results.filter(
            (doc) => !isFaissSentinelDocument(doc),
          ).length;
        } catch {
          // Can't load index
          status.needsRebuild = true;
        }

        status.needsRebuild = !status.isValid;
      } catch (error) {
        status.error = error instanceof Error ? error.message : String(error);
        status.needsRebuild = true;
      }
    } else {
      status.needsRebuild = false; // No index to rebuild
    }

    return status;
  }

  /**
   * Delete a user's index
   */
  async deleteUserIndex(userId: string): Promise<void> {
    // Remove from cache
    this.userIndices.delete(userId);

    // Delete from disk
    const userPath = path.join(this.config.indexPath, 'users', userId);

    if (fs.existsSync(userPath)) {
      fs.rmSync(userPath, { recursive: true, force: true });
      this.logger.log('User index deleted', { userId, path: userPath });
    }
  }

  /**
   * Clear all indices (use with caution!)
   */
  async clearAllIndices(): Promise<void> {
    // Clear cache
    this.userIndices.clear();

    // Reset global index
    this.globalIndex = await this.createNewIndex();
    await this.saveGlobalIndex();

    // Clear user indices directory
    const usersPath = path.join(this.config.indexPath, 'users');
    if (fs.existsSync(usersPath)) {
      fs.rmSync(usersPath, { recursive: true, force: true });
      fs.mkdirSync(usersPath, { recursive: true });
    }

    this.logger.warn('All FAISS indices cleared');
  }

  /**
   * Update processing time statistics
   */
  private updateProcessingTimeStats(processingTime: number): void {
    this.processingTimes.push(processingTime);

    if (this.processingTimes.length > this.maxProcessingTimeSamples) {
      this.processingTimes.shift();
    }
  }

  /**
   * Reset the batch timer
   */
  private resetBatchTimer(): void {
    this.clearBatchTimer();

    this.batchTimer = setTimeout(() => {
      this.logger.log('Batch timeout reached, processing queue', {
        queueDepth: this.queue.length,
      });
      this.processBatch();
    }, this.config.writeBatchTimeoutMs);
  }

  /**
   * Clear the batch timer
   */
  private clearBatchTimer(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = undefined;
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    this.logger.log('Shutting down FAISS Vector Service');

    // Flush write queue
    this.clearBatchTimer();

    // Process remaining items
    if (this.queue.length > 0) {
      await this.flushQueue();
    }

    // Save all cached indices
    for (const [userId, index] of this.userIndices.entries()) {
      try {
        await this.saveUserIndex(userId, index);
      } catch (error) {
        this.logger.error(
          `Failed to save user index on shutdown for ${userId}`,
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    // Save global index
    if (this.globalIndex) {
      await this.saveGlobalIndex();
    }

    // Clear cache
    this.userIndices.clear();
  }

  /**
   * Flush the queue (process all pending items immediately)
   */
  private async flushQueue(): Promise<void> {
    while (this.queue.length > 0) {
      await this.processBatch();
      // Wait a bit between batches to prevent overwhelming the system
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
