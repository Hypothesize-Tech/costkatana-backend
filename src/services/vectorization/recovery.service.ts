/**
 * Recovery Service for FAISS Indices
 * Rebuilds corrupted indices from MongoDB source of truth
 * Provides automatic recovery and validation capabilities
 */

import { SafeBedrockEmbeddings, createSafeBedrockEmbeddings } from '../safeBedrockEmbeddings';
import { Document as LangchainDocument } from '@langchain/core/documents';
import { loggingService } from '../logging.service';
import { faissVectorService } from './faiss.service';
import { DocumentModel } from '../../models/Document';
import {
  RecoveryProgress,
  ValidationReport,
  GLOBAL_INDEX_SOURCES,
  USER_INDEX_SOURCES,
  VectorSource
} from './types';

export class RecoveryService {
  private embeddings: SafeBedrockEmbeddings;
  private activeRecoveries: Map<string, RecoveryProgress> = new Map();
  private batchSize = 100;
  private maxConcurrentRecoveries = 3;

  constructor() {
    this.embeddings = createSafeBedrockEmbeddings({
      model: 'amazon.titan-embed-text-v2:0'
    });
  }

  /**
   * Rebuild the global FAISS index from MongoDB
   */
  async rebuildGlobalIndex(): Promise<void> {
    const recoveryId = 'global';
    
    if (this.activeRecoveries.has(recoveryId)) {
      loggingService.warn('Global index recovery already in progress', {
        component: 'RecoveryService'
      });
      return;
    }

    const progress: RecoveryProgress = {
      indexType: 'global',
      totalDocuments: 0,
      processedDocuments: 0,
      failedDocuments: 0,
      percentComplete: 0,
      status: 'in_progress',
      startTime: new Date()
    };

    this.activeRecoveries.set(recoveryId, progress);

    try {
      loggingService.info('Starting global index rebuild', {
        component: 'RecoveryService',
        operation: 'rebuildGlobalIndex'
      });

      // Clear existing global index
      await faissVectorService.clearAllIndices();

      // Count total documents
      const totalCount = await DocumentModel.countDocuments({
        'metadata.source': { $in: GLOBAL_INDEX_SOURCES },
        status: 'active'
      });

      progress.totalDocuments = totalCount;

      // Process in batches
      let processed = 0;
      let failed = 0;

      while (processed < totalCount) {
        try {
          // Fetch batch of documents
          const documents = await DocumentModel.find({
            'metadata.source': { $in: GLOBAL_INDEX_SOURCES },
            status: 'active'
          })
            .skip(processed)
            .limit(this.batchSize)
            .lean();

          if (documents.length === 0) break;

          // Convert to LangChain documents
          const langchainDocs: LangchainDocument[] = documents.map(doc => 
            new LangchainDocument({
              pageContent: doc.content,
              metadata: {
                ...doc.metadata,
                documentId: doc._id.toString(),
                chunkIndex: doc.chunkIndex,
                totalChunks: doc.totalChunks
              }
            })
          );

          // Add to FAISS index
          await faissVectorService.addDocuments(
            langchainDocs,
            documents[0].metadata.source as VectorSource
          );

          processed += documents.length;
          progress.processedDocuments = processed;
          progress.percentComplete = Math.round((processed / totalCount) * 100);
          
          loggingService.info('Global index rebuild progress', {
            component: 'RecoveryService',
            processed,
            total: totalCount,
            percentComplete: progress.percentComplete
          });

          // Update progress
          this.activeRecoveries.set(recoveryId, progress);

        } catch (error) {
          failed += this.batchSize;
          progress.failedDocuments = failed;
          
          loggingService.error('Batch processing failed during global rebuild', {
            component: 'RecoveryService',
            error: error instanceof Error ? error.message : String(error),
            processed,
            failed
          });
        }
      }

      // Flush write queue to ensure all documents are saved
      await faissVectorService.shutdown();
      await faissVectorService.initialize();

      progress.status = failed > 0 ? 'completed' : 'completed';
      progress.endTime = new Date();
      progress.percentComplete = 100;

      loggingService.info('Global index rebuild completed', {
        component: 'RecoveryService',
        totalDocuments: totalCount,
        processed,
        failed,
        duration: progress.endTime.getTime() - progress.startTime.getTime()
      });

    } catch (error) {
      progress.status = 'failed';
      progress.error = error instanceof Error ? error.message : String(error);
      progress.endTime = new Date();
      
      loggingService.error('Global index rebuild failed', {
        component: 'RecoveryService',
        error: progress.error
      });
      
      throw error;
    } finally {
      this.activeRecoveries.delete(recoveryId);
    }
  }

  /**
   * Rebuild a specific user's FAISS index from MongoDB
   */
  async rebuildUserIndex(userId: string): Promise<void> {
    const recoveryId = `user-${userId}`;
    
    if (this.activeRecoveries.has(recoveryId)) {
      loggingService.warn('User index recovery already in progress', {
        component: 'RecoveryService',
        userId
      });
      return;
    }

    const progress: RecoveryProgress = {
      userId,
      indexType: 'user',
      totalDocuments: 0,
      processedDocuments: 0,
      failedDocuments: 0,
      percentComplete: 0,
      status: 'in_progress',
      startTime: new Date()
    };

    this.activeRecoveries.set(recoveryId, progress);

    try {
      loggingService.info('Starting user index rebuild', {
        component: 'RecoveryService',
        operation: 'rebuildUserIndex',
        userId
      });

      // Delete existing user index
      await faissVectorService.deleteUserIndex(userId);

      // Count total documents for this user
      const totalCount = await DocumentModel.countDocuments({
        'metadata.userId': userId,
        'metadata.source': { $in: USER_INDEX_SOURCES },
        status: 'active'
      });

      progress.totalDocuments = totalCount;

      if (totalCount === 0) {
        loggingService.info('No documents found for user', {
          component: 'RecoveryService',
          userId
        });
        progress.status = 'completed';
        progress.endTime = new Date();
        return;
      }

      // Process in batches
      let processed = 0;
      let failed = 0;

      while (processed < totalCount) {
        try {
          // Fetch batch of documents
          const documents = await DocumentModel.find({
            'metadata.userId': userId,
            'metadata.source': { $in: USER_INDEX_SOURCES },
            status: 'active'
          })
            .skip(processed)
            .limit(this.batchSize)
            .lean();

          if (documents.length === 0) break;

          // Convert to LangChain documents
          const langchainDocs: LangchainDocument[] = documents.map(doc => 
            new LangchainDocument({
              pageContent: doc.content,
              metadata: {
                ...doc.metadata,
                documentId: doc._id.toString(),
                chunkIndex: doc.chunkIndex,
                totalChunks: doc.totalChunks
              }
            })
          );

          // Add to FAISS index
          await faissVectorService.addDocuments(
            langchainDocs,
            documents[0].metadata.source as VectorSource,
            userId
          );

          processed += documents.length;
          progress.processedDocuments = processed;
          progress.percentComplete = Math.round((processed / totalCount) * 100);
          
          loggingService.info('User index rebuild progress', {
            component: 'RecoveryService',
            userId,
            processed,
            total: totalCount,
            percentComplete: progress.percentComplete
          });

          // Update progress
          this.activeRecoveries.set(recoveryId, progress);

        } catch (error) {
          failed += this.batchSize;
          progress.failedDocuments = failed;
          
          loggingService.error('Batch processing failed during user rebuild', {
            component: 'RecoveryService',
            userId,
            error: error instanceof Error ? error.message : String(error),
            processed,
            failed
          });
        }
      }

      progress.status = failed > 0 ? 'completed' : 'completed';
      progress.endTime = new Date();
      progress.percentComplete = 100;

      loggingService.info('User index rebuild completed', {
        component: 'RecoveryService',
        userId,
        totalDocuments: totalCount,
        processed,
        failed,
        duration: progress.endTime!.getTime() - progress.startTime.getTime()
      });

    } catch (error) {
      progress.status = 'failed';
      progress.error = error instanceof Error ? error.message : String(error);
      progress.endTime = new Date();
      
      loggingService.error('User index rebuild failed', {
        component: 'RecoveryService',
        userId,
        error: progress.error
      });
      
      throw error;
    } finally {
      this.activeRecoveries.delete(recoveryId);
    }
  }

  /**
   * Validate all indices and return a report
   */
  async validateAllIndices(): Promise<ValidationReport> {
    const report: ValidationReport = {
      timestamp: new Date(),
      globalIndex: await faissVectorService.getIndexHealth(),
      userIndices: new Map(),
      totalIndices: 1, // Start with global
      healthyIndices: 0,
      corruptedIndices: [],
      rebuildRequired: [],
      recommendations: []
    };

    // Check global index
    if (report.globalIndex.isValid) {
      report.healthyIndices++;
    } else if (report.globalIndex.needsRebuild) {
      report.corruptedIndices.push('global');
      report.rebuildRequired.push('global');
      report.recommendations.push('Global index needs rebuild');
    }

    // Get all users with documents
    const usersWithDocs = await DocumentModel.distinct('metadata.userId', {
      'metadata.source': { $in: USER_INDEX_SOURCES },
      'metadata.userId': { $exists: true, $ne: null },
      status: 'active'
    });

    report.totalIndices += usersWithDocs.length;

    // Check each user's index
    for (const userId of usersWithDocs) {
      try {
        const userHealth = await faissVectorService.getIndexHealth(userId);
        report.userIndices.set(userId, userHealth);
        
        if (userHealth.isValid) {
          report.healthyIndices++;
        } else if (userHealth.needsRebuild) {
          report.corruptedIndices.push(`user-${userId}`);
          report.rebuildRequired.push(`user-${userId}`);
        }
        
        // Check document count discrepancy
        const mongoCount = await DocumentModel.countDocuments({
          'metadata.userId': userId,
          'metadata.source': { $in: USER_INDEX_SOURCES },
          status: 'active'
        });
        
        if (Math.abs(userHealth.documentCount - mongoCount) > mongoCount * 0.05) {
          report.recommendations.push(
            `User ${userId} index has document count mismatch (FAISS: ${userHealth.documentCount}, MongoDB: ${mongoCount})`
          );
        }
      } catch (error) {
        loggingService.error('Failed to validate user index', {
          component: 'RecoveryService',
          userId,
          error: error instanceof Error ? error.message : String(error)
        });
        report.corruptedIndices.push(`user-${userId}`);
      }
    }

    // Add general recommendations
    if (report.corruptedIndices.length > 0) {
      report.recommendations.push(
        `Found ${report.corruptedIndices.length} corrupted indices requiring rebuild`
      );
    }

    if (report.healthyIndices === report.totalIndices) {
      report.recommendations.push('All indices are healthy');
    }

    loggingService.info('Validation report generated', {
      component: 'RecoveryService',
      totalIndices: report.totalIndices,
      healthyIndices: report.healthyIndices,
      corruptedIndices: report.corruptedIndices.length
    });

    return report;
  }

  /**
   * Detect if an index is corrupted
   */
  async detectCorruption(indexPath: string): Promise<boolean> {
    try {
      const isUserIndex = indexPath.includes('/users/');
      const userId = isUserIndex ? indexPath.split('/users/')[1] : undefined;
      
      const health = await faissVectorService.getIndexHealth(userId);
      return !health.isValid || health.needsRebuild;
    } catch (error) {
      loggingService.error('Error detecting corruption', {
        component: 'RecoveryService',
        indexPath,
        error: error instanceof Error ? error.message : String(error)
      });
      return true; // Assume corrupted if we can't check
    }
  }

  /**
   * Rebuild all corrupted indices in background
   */
  async rebuildInBackground(): Promise<void> {
    loggingService.info('Starting background index rebuild', {
      component: 'RecoveryService'
    });

    const report = await this.validateAllIndices();
    
    if (report.rebuildRequired.length === 0) {
      loggingService.info('No indices require rebuild', {
        component: 'RecoveryService'
      });
      return;
    }

    // Process rebuilds with concurrency limit
    const rebuilds: Promise<void>[] = [];
    
    for (const indexId of report.rebuildRequired) {
      if (indexId === 'global') {
        rebuilds.push(this.rebuildGlobalIndex());
      } else if (indexId.startsWith('user-')) {
        const userId = indexId.replace('user-', '');
        rebuilds.push(this.rebuildUserIndex(userId));
      }
      
      // Limit concurrent rebuilds
      if (rebuilds.length >= this.maxConcurrentRecoveries) {
        await Promise.race(rebuilds);
        rebuilds.splice(0, 1);
      }
    }

    // Wait for remaining rebuilds
    await Promise.allSettled(rebuilds);
    
    loggingService.info('Background index rebuild completed', {
      component: 'RecoveryService',
      rebuiltIndices: report.rebuildRequired.length
    });
  }

  /**
   * Get recovery progress for a specific index
   */
  getRecoveryProgress(userId?: string): RecoveryProgress | undefined {
    const recoveryId = userId ? `user-${userId}` : 'global';
    return this.activeRecoveries.get(recoveryId);
  }

  /**
   * Get all active recoveries
   */
  getActiveRecoveries(): RecoveryProgress[] {
    return Array.from(this.activeRecoveries.values());
  }

  /**
   * Estimate time to rebuild an index
   */
  async estimateRebuildTime(userId?: string): Promise<number> {
    // Count documents
    const count = userId
      ? await DocumentModel.countDocuments({
          'metadata.userId': userId,
          'metadata.source': { $in: USER_INDEX_SOURCES },
          status: 'active'
        })
      : await DocumentModel.countDocuments({
          'metadata.source': { $in: GLOBAL_INDEX_SOURCES },
          status: 'active'
        });

    // Estimate: ~100 docs per second (including embedding generation)
    const estimatedSeconds = Math.ceil(count / 100);
    return estimatedSeconds * 1000; // Return in milliseconds
  }
}

// Export singleton instance
export const recoveryService = new RecoveryService();