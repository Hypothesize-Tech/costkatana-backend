/**
 * Write Queue Service for FAISS
 * Implements single-writer pattern to prevent corruption
 * Batches writes for efficiency and processes sequentially
 */

import { Document as LangchainDocument } from '@langchain/core/documents';
import { v4 as uuidv4 } from 'uuid';
import { loggingService } from '../logging.service';
import { 
  WriteQueueItem, 
  WriteQueueStats, 
  VectorSource,
  GLOBAL_INDEX_SOURCES,
  USER_INDEX_SOURCES 
} from './types';

export class WriteQueueService {
  private queue: WriteQueueItem[] = [];
  private isProcessing = false;
  private stats: WriteQueueStats = {
    queueDepth: 0,
    batchesProcessed: 0,
    documentsProcessed: 0,
    failedWrites: 0,
    averageProcessingTime: 0,
    isProcessing: false
  };
  
  private batchSize: number;
  private batchTimeoutMs: number;
  private batchTimer?: NodeJS.Timeout;
  private processingTimes: number[] = [];
  private maxProcessingTimeSamples = 100;
  
  // Callback for processing batches (injected by FAISS service)
  private processBatchCallback?: (items: WriteQueueItem[]) => Promise<void>;

  constructor(
    batchSize: number = parseInt('50'),
    batchTimeoutMs: number = parseInt('5000')
  ) {
    this.batchSize = batchSize;
    this.batchTimeoutMs = batchTimeoutMs;
  }

  /**
   * Set the callback for processing batches
   */
  setProcessBatchCallback(callback: (items: WriteQueueItem[]) => Promise<void>) {
    this.processBatchCallback = callback;
  }

  /**
   * Enqueue documents for writing to FAISS
   */
  async enqueue(
    documents: LangchainDocument[],
    source: VectorSource,
    userId?: string
  ): Promise<string> {
    const itemId = uuidv4();
    
    // Validate user isolation
    if (USER_INDEX_SOURCES.includes(source) && !userId) {
      throw new Error(`User ID required for source: ${source}`);
    }
    
    if (GLOBAL_INDEX_SOURCES.includes(source) && userId) {
      loggingService.warn('User ID provided for global index source, will be ignored', {
        component: 'WriteQueueService',
        source,
        userId
      });
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
        maxRetries: 3
      }
    };

    this.queue.push(item);
    this.stats.queueDepth = this.queue.length;

    loggingService.info('Documents enqueued for FAISS write', {
      component: 'WriteQueueService',
      operation: 'enqueue',
      itemId,
      documentCount: documents.length,
      source,
      userId,
      queueDepth: this.stats.queueDepth
    });

    // Start processing if batch size reached
    if (this.queue.length >= this.batchSize) {
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

    if (!this.processBatchCallback) {
      loggingService.error('No process batch callback set', {
        component: 'WriteQueueService',
        operation: 'processBatch'
      });
      return;
    }

    this.isProcessing = true;
    this.stats.isProcessing = true;
    const startTime = Date.now();

    // Extract batch (up to batchSize items)
    const batch = this.queue.splice(0, this.batchSize);
    this.stats.queueDepth = this.queue.length;

    try {
      loggingService.info('Processing write batch', {
        component: 'WriteQueueService',
        operation: 'processBatch',
        batchSize: batch.length,
        remainingQueue: this.stats.queueDepth
      });

      // Group by user for isolation
      const userBatches = new Map<string | undefined, WriteQueueItem[]>();
      
      for (const item of batch) {
        const key = item.userId ?? 'global';
        if (!userBatches.has(key)) {
          userBatches.set(key, []);
        }
        userBatches.get(key)!.push(item);
      }

      // Process each user's batch separately (isolation)
      for (const [userKey, userItems] of userBatches) {
        try {
          await this.processBatchCallback(userItems);
          
          // Update stats
          this.stats.batchesProcessed++;
          this.stats.documentsProcessed += userItems.reduce(
            (sum, item) => sum + item.documents.length, 
            0
          );
        } catch (error) {
          loggingService.error('Failed to process user batch', {
            component: 'WriteQueueService',
            operation: 'processBatch',
            userKey,
            itemCount: userItems.length,
            error: error instanceof Error ? error.message : String(error)
          });

          // Retry failed items
          await this.retryFailedItems(userItems);
        }
      }

      // Update processing time stats
      const processingTime = Date.now() - startTime;
      this.updateProcessingTimeStats(processingTime);
      this.stats.lastProcessedAt = new Date();

      loggingService.info('Write batch processed successfully', {
        component: 'WriteQueueService',
        operation: 'processBatch',
        batchSize: batch.length,
        processingTime,
        averageTime: this.stats.averageProcessingTime
      });

    } catch (error) {
      loggingService.error('Critical error processing write batch', {
        component: 'WriteQueueService',
        operation: 'processBatch',
        error: error instanceof Error ? error.message : String(error)
      });

      // Put items back in queue for retry
      this.queue.unshift(...batch);
      this.stats.queueDepth = this.queue.length;
      this.stats.failedWrites += batch.length;
    } finally {
      this.isProcessing = false;
      this.stats.isProcessing = false;

      // Process next batch if queue has items
      if (this.queue.length > 0) {
        if (this.queue.length >= this.batchSize) {
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
   * Retry failed items with exponential backoff
   */
  private async retryFailedItems(items: WriteQueueItem[]): Promise<void> {
    for (const item of items) {
      item.metadata.retryCount++;
      
      if (item.metadata.retryCount < item.metadata.maxRetries) {
        // Calculate exponential backoff delay
        const delay = Math.min(1000 * Math.pow(2, item.metadata.retryCount), 30000);
        
        loggingService.info('Scheduling retry for failed write', {
          component: 'WriteQueueService',
          operation: 'retryFailedItems',
          itemId: item.id,
          retryCount: item.metadata.retryCount,
          delay
        });

        // Re-enqueue with delay
        setTimeout(() => {
          this.queue.push(item);
          this.stats.queueDepth = this.queue.length;
          
          if (!this.isProcessing && this.queue.length >= this.batchSize) {
            this.processBatch();
          }
        }, delay);
      } else {
        loggingService.error('Write item exceeded max retries', {
          component: 'WriteQueueService',
          operation: 'retryFailedItems',
          itemId: item.id,
          userId: item.userId,
          documentCount: item.documents.length
        });
        
        this.stats.failedWrites++;
      }
    }
  }

  /**
   * Update processing time statistics
   */
  private updateProcessingTimeStats(processingTime: number): void {
    this.processingTimes.push(processingTime);
    
    if (this.processingTimes.length > this.maxProcessingTimeSamples) {
      this.processingTimes.shift();
    }
    
    this.stats.averageProcessingTime = 
      this.processingTimes.reduce((sum, time) => sum + time, 0) / 
      this.processingTimes.length;
  }

  /**
   * Reset the batch timer
   */
  private resetBatchTimer(): void {
    this.clearBatchTimer();
    
    this.batchTimer = setTimeout(() => {
      loggingService.info('Batch timeout reached, processing queue', {
        component: 'WriteQueueService',
        queueDepth: this.queue.length
      });
      this.processBatch();
    }, this.batchTimeoutMs);
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
   * Get queue statistics
   */
  getStats(): WriteQueueStats {
    return { ...this.stats };
  }

  /**
   * Flush the queue (process all pending items immediately)
   */
  async flush(): Promise<void> {
    this.clearBatchTimer();
    
    while (this.queue.length > 0) {
      await this.processBatch();
      // Wait a bit between batches to prevent overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Clear the queue (discard all pending items)
   */
  clear(): void {
    this.clearBatchTimer();
    this.queue = [];
    this.stats.queueDepth = 0;
    
    loggingService.warn('Write queue cleared', {
      component: 'WriteQueueService',
      operation: 'clear'
    });
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    loggingService.info('Shutting down write queue service', {
      component: 'WriteQueueService',
      operation: 'shutdown',
      pendingItems: this.queue.length
    });

    this.clearBatchTimer();
    
    // Process remaining items
    if (this.queue.length > 0) {
      await this.flush();
    }
  }
}

// Export singleton instance
export const writeQueueService = new WriteQueueService();