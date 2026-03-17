/**
 * Write Queue Service for FAISS in NestJS
 * Implements single-writer pattern to prevent corruption
 * Batches writes for efficiency and processes sequentially
 */

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Document as LangchainDocument } from '@langchain/core/documents';
import { v4 as uuidv4 } from 'uuid';
import type { FaissVectorService, VectorSource } from './faiss-vector.service';

interface WriteQueueItem {
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

interface WriteQueueStats {
  queueDepth: number;
  batchesProcessed: number;
  documentsProcessed: number;
  failedWrites: number;
  averageProcessingTime: number;
  isProcessing: boolean;
  lastProcessedAt?: Date;
}

@Injectable()
export class VectorWriteQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(VectorWriteQueueService.name);
  private queue: WriteQueueItem[] = [];
  private isProcessing = false;
  private stats: WriteQueueStats = {
    queueDepth: 0,
    batchesProcessed: 0,
    documentsProcessed: 0,
    failedWrites: 0,
    averageProcessingTime: 0,
    isProcessing: false,
  };

  private batchSize: number;
  private batchTimeoutMs: number;
  private batchTimer?: NodeJS.Timeout;
  private processingTimes: number[] = [];
  private maxProcessingTimeSamples = 100;

  constructor(
    private configService: ConfigService,
    @Inject(
      forwardRef(() => require('./faiss-vector.service').FaissVectorService),
    )
    private faissVectorService: FaissVectorService,
  ) {
    this.batchSize = parseInt(this.configService.get('FAISS_BATCH_SIZE', '50'));
    this.batchTimeoutMs = parseInt(
      this.configService.get('FAISS_BATCH_TIMEOUT_MS', '5000'),
    );
  }

  onModuleDestroy() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }
  }

  /**
   * Enqueue documents for writing to FAISS
   */
  async enqueue(
    documents: LangchainDocument[],
    source: VectorSource,
    userId?: string,
  ): Promise<string> {
    const itemId = uuidv4();

    // Validate user isolation
    if (['conversation', 'user-upload'].includes(source) && !userId) {
      throw new Error(`User ID required for source: ${source}`);
    }

    if (
      ['knowledge-base', 'telemetry', 'activity'].includes(source) &&
      userId
    ) {
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
    this.stats.queueDepth = this.queue.length;

    this.logger.log('Documents enqueued for FAISS write', {
      itemId,
      documentCount: documents.length,
      source,
      userId,
      queueDepth: this.stats.queueDepth,
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

    this.isProcessing = true;
    this.stats.isProcessing = true;
    const startTime = Date.now();

    // Extract batch (up to batchSize items)
    const batch = this.queue.splice(0, this.batchSize);
    this.stats.queueDepth = this.queue.length;

    try {
      this.logger.log('Processing write batch', {
        batchSize: batch.length,
        remainingQueue: this.stats.queueDepth,
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
          await this.processUserBatch(userItems);
        } catch (error) {
          this.logger.error('Failed to process user batch', {
            userKey,
            itemCount: userItems.length,
            error: error instanceof Error ? error.message : String(error),
          });

          // Retry failed items
          await this.retryFailedItems(userItems);
        }
      }

      // Update processing time stats
      const processingTime = Date.now() - startTime;
      this.updateProcessingTimeStats(processingTime);
      this.stats.lastProcessedAt = new Date();

      this.logger.log('Write batch processed successfully', {
        batchSize: batch.length,
        processingTime,
        averageTime: this.stats.averageProcessingTime,
      });
    } catch (error) {
      this.logger.error('Critical error processing write batch', {
        error: error instanceof Error ? error.message : String(error),
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
   * Process a batch for a specific user
   */
  private async processUserBatch(items: WriteQueueItem[]): Promise<void> {
    // Process the batch using FAISS service
    await this.faissVectorService.processBatchForWriteQueue(items);

    // Update stats
    this.stats.batchesProcessed++;
    this.stats.documentsProcessed += items.reduce(
      (sum, item) => sum + item.documents.length,
      0,
    );
  }

  /**
   * Retry failed items with exponential backoff
   */
  private async retryFailedItems(items: WriteQueueItem[]): Promise<void> {
    for (const item of items) {
      item.metadata.retryCount++;

      if (item.metadata.retryCount < item.metadata.maxRetries) {
        // Calculate exponential backoff delay
        const delay = Math.min(
          1000 * Math.pow(2, item.metadata.retryCount),
          30000,
        );

        this.logger.log('Scheduling retry for failed write', {
          itemId: item.id,
          retryCount: item.metadata.retryCount,
          delay,
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
        this.logger.error('Write item exceeded max retries', {
          itemId: item.id,
          userId: item.userId,
          documentCount: item.documents.length,
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
      this.logger.log('Batch timeout reached, processing queue', {
        queueDepth: this.queue.length,
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
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * Clear the queue (discard all pending items)
   */
  clear(): void {
    this.clearBatchTimer();
    this.queue = [];
    this.stats.queueDepth = 0;

    this.logger.warn('Write queue cleared');
  }
}
