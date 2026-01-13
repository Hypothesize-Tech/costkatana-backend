/**
 * FAISS Vector Service with Per-User Isolation
 * Manages global index for internal data and per-user indices for user data
 * FAISS stores DERIVED data only - MongoDB remains source of truth
 */

import { FaissStore } from '@langchain/community/vectorstores/faiss';
import { Document as LangchainDocument } from '@langchain/core/documents';
import { Embeddings } from '@langchain/core/embeddings';
import { createSafeBedrockEmbeddings } from '../safeBedrockEmbeddings';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { LRUCache } from 'lru-cache';
import { loggingService } from '../logging.service';
import { writeQueueService } from './writeQueue.service';
import {
  VectorSearchOptions,
  VectorSearchResult,
  IndexHealthStatus,
  FaissIndexConfig,
  WriteQueueItem,
  GLOBAL_INDEX_SOURCES,
  USER_INDEX_SOURCES,
  VectorSource
} from './types';

export class FaissVectorService {
  private embeddings: Embeddings;
  private config: FaissIndexConfig;
  private globalIndex?: FaissStore;
  private userIndices: LRUCache<string, FaissStore>;
  private indexChecksums: Map<string, string> = new Map();
  private isInitialized = false;

  constructor(embeddings?: Embeddings) {
    // Use provided embeddings or default to SafeBedrockEmbeddings
    this.embeddings = embeddings || createSafeBedrockEmbeddings({
      model: 'amazon.titan-embed-text-v2:0'
    });

    this.config = {
      indexPath: './data/faiss',
      maxLoadedIndices: parseInt('100'),
      writeBatchSize: parseInt('50'),
      writeBatchTimeoutMs: parseInt('5000'),
      autoSave: true
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
            loggingService.error('Failed to save user index on eviction', {
              component: 'FaissVectorService',
              userId: key,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      },
      ttl: 1000 * 60 * 60 // 1 hour TTL
    });

    // Set up write queue callback
    writeQueueService.setProcessBatchCallback(this.processBatch.bind(this));
  }

  /**
   * Initialize the service and load/create global index
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      loggingService.info('Initializing FAISS Vector Service', {
        component: 'FaissVectorService',
        config: this.config
      });

      // Ensure directories exist
      await this.ensureDirectories();

      // Load or create global index
      await this.loadOrCreateGlobalIndex();

      this.isInitialized = true;
      
      loggingService.info('FAISS Vector Service initialized successfully', {
        component: 'FaissVectorService',
        globalIndexLoaded: !!this.globalIndex
      });
    } catch (error) {
      loggingService.error('Failed to initialize FAISS Vector Service', {
        component: 'FaissVectorService',
        error: error instanceof Error ? error.message : String(error)
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
      path.join(this.config.indexPath, 'users')
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        loggingService.info('Created directory', {
          component: 'FaissVectorService',
          directory: dir
        });
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
          this.globalIndex = await FaissStore.load(globalPath, this.embeddings);
          loggingService.info('Global FAISS index loaded successfully', {
            component: 'FaissVectorService',
            path: globalPath
          });
        } else {
          loggingService.warn('Global index checksum validation failed, creating new index', {
            component: 'FaissVectorService',
            path: globalPath
          });
          this.globalIndex = await this.createNewIndex();
          await this.saveGlobalIndex();
        }
      } else {
        this.globalIndex = await this.createNewIndex();
        await this.saveGlobalIndex();
        loggingService.info('Created new global FAISS index', {
          component: 'FaissVectorService',
          path: globalPath
        });
      }
    } catch (error) {
      loggingService.error('Failed to load global index, creating new one', {
        component: 'FaissVectorService',
        error: error instanceof Error ? error.message : String(error)
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
          userIndex = await FaissStore.load(userPath, this.embeddings);
          loggingService.info('User FAISS index loaded', {
            component: 'FaissVectorService',
            userId,
            path: userPath
          });
        } else {
          loggingService.warn('User index checksum validation failed, creating new index', {
            component: 'FaissVectorService',
            userId,
            path: userPath
          });
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
        loggingService.info('Created new user FAISS index', {
          component: 'FaissVectorService',
          userId,
          path: userPath
        });
      }

      // Cache the index
      this.userIndices.set(userId, userIndex);
      return userIndex;
    } catch (error) {
      loggingService.error('Failed to load user index, creating new one', {
        component: 'FaissVectorService',
        userId,
        error: error instanceof Error ? error.message : String(error)
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
   * Create a new empty FAISS index
   */
  private async createNewIndex(): Promise<FaissStore> {
    // Create with a dummy document (FAISS requires at least one document)
    const dummyDoc = new LangchainDocument({
      pageContent: 'FAISS index initialized',
      metadata: { _dummy: true, timestamp: new Date().toISOString() }
    });
    
    return await FaissStore.fromDocuments([dummyDoc], this.embeddings);
  }

  /**
   * Add documents to the appropriate index
   */
  async addDocuments(
    documents: LangchainDocument[],
    source: VectorSource,
    userId?: string
  ): Promise<void> {
    // Enqueue for batch processing
    await writeQueueService.enqueue(documents, source, userId);
  }

  /**
   * Process a batch of write queue items
   */
  private async processBatch(items: WriteQueueItem[]): Promise<void> {
    // Group items by index (global vs user)
    const globalItems: LangchainDocument[] = [];
    const userItems = new Map<string, LangchainDocument[]>();

    for (const item of items) {
      if (GLOBAL_INDEX_SOURCES.includes(item.metadata.source)) {
        globalItems.push(...item.documents);
      } else if (USER_INDEX_SOURCES.includes(item.metadata.source) && item.userId) {
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
        
        loggingService.info('Added documents to global index', {
          component: 'FaissVectorService',
          documentCount: globalItems.length
        });
      } catch (error) {
        loggingService.error('Failed to add documents to global index', {
          component: 'FaissVectorService',
          documentCount: globalItems.length,
          error: error instanceof Error ? error.message : String(error)
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
        
        loggingService.info('Added documents to user index', {
          component: 'FaissVectorService',
          userId,
          documentCount: docs.length
        });
      } catch (error) {
        loggingService.error('Failed to add documents to user index', {
          component: 'FaissVectorService',
          userId,
          documentCount: docs.length,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }
  }

  /**
   * Search for similar documents
   */
  async search(
    query: string,
    options: VectorSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    const { k = 4, userId, filter, scoreThreshold = 0.0 } = options;

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
      const results = await index.similaritySearchWithScore(query, k, filter);

      // Filter dummy documents and apply score threshold
      const filteredResults: VectorSearchResult[] = results
        .filter(([doc, score]) => 
          !doc.metadata._dummy && 
          score >= scoreThreshold
        )
        .map(([doc, score]) => ({
          document: doc,
          score,
          documentId: doc.metadata.documentId
        }));

      loggingService.info('FAISS search completed', {
        component: 'FaissVectorService',
        query: query.substring(0, 50),
        userId,
        resultsFound: filteredResults.length,
        k
      });

      return filteredResults;
    } catch (error) {
      loggingService.error('FAISS search failed', {
        component: 'FaissVectorService',
        query: query.substring(0, 50),
        userId,
        error: error instanceof Error ? error.message : String(error)
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
    
    loggingService.info('Global index saved', {
      component: 'FaissVectorService',
      path: globalPath
    });
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
    
    loggingService.info('User index saved', {
      component: 'FaissVectorService',
      userId,
      path: userPath
    });
  }

  /**
   * Save index atomically (temp file → rename)
   */
  private async saveIndexAtomic(index: FaissStore, indexPath: string): Promise<void> {
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
        loggingService.warn('No checksum file found', {
          component: 'FaissVectorService',
          path: indexPath
        });
        return true; // Allow loading if no checksum exists (backwards compatibility)
      }
      
      const storedChecksum = fs.readFileSync(checksumFile, 'utf-8').trim();
      const currentChecksum = await this.calculateChecksum(indexPath);
      
      return storedChecksum === currentChecksum;
    } catch (error) {
      loggingService.error('Checksum validation failed', {
        component: 'FaissVectorService',
        path: indexPath,
        error: error instanceof Error ? error.message : String(error)
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
    
    let status: IndexHealthStatus = {
      indexPath,
      exists,
      isValid: false,
      documentCount: 0,
      sizeBytes: 0,
      needsRebuild: false
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
          status.documentCount = results.filter(doc => !doc.metadata._dummy).length;
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
      loggingService.info('User index deleted', {
        component: 'FaissVectorService',
        userId,
        path: userPath
      });
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
    
    loggingService.warn('All FAISS indices cleared', {
      component: 'FaissVectorService'
    });
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    loggingService.info('Shutting down FAISS Vector Service', {
      component: 'FaissVectorService'
    });
    
    // Flush write queue
    await writeQueueService.shutdown();
    
    // Save all cached indices
    for (const [userId, index] of this.userIndices.entries()) {
      try {
        await this.saveUserIndex(userId, index);
      } catch (error) {
        loggingService.error('Failed to save user index on shutdown', {
          component: 'FaissVectorService',
          userId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    
    // Save global index
    if (this.globalIndex) {
      await this.saveGlobalIndex();
    }
    
    // Clear cache
    this.userIndices.clear();
  }
}

// Export singleton instance
export const faissVectorService = new FaissVectorService();