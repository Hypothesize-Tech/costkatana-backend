/**
 * Vector Recovery Service for NestJS
 * Provides index validation and recovery capabilities for FAISS indices
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  FaissVectorService,
  GLOBAL_INDEX_SOURCES,
  USER_INDEX_SOURCES,
  VectorSource,
} from './faiss-vector.service';
import { VectorStrategyService } from './vector-strategy.service';
import {
  Document,
  DocumentDocument,
} from '../../../schemas/document/document.schema';
import { SafeBedrockEmbeddingsService } from './safe-bedrock-embeddings.service';
import { Document as LangchainDocument } from '@langchain/core/documents';

interface ValidationReport {
  globalIndex: {
    isValid: boolean;
    documentCount: number;
    needsRebuild: boolean;
  };
  userIndices: Map<
    string,
    {
      isValid: boolean;
      documentCount: number;
      needsRebuild: boolean;
    }
  >;
  totalIndices: number;
  healthyIndices: number;
  corruptedIndices: string[];
  timestamp: Date;
}

@Injectable()
export class VectorRecoveryService {
  private readonly logger = new Logger(VectorRecoveryService.name);

  constructor(
    private faissVectorService: FaissVectorService,
    private vectorStrategyService: VectorStrategyService,
    private embeddingsService: SafeBedrockEmbeddingsService,
    @InjectModel('Document') private documentModel: Model<DocumentDocument>,
  ) {}

  /**
   * Validate all indices
   */
  async validateAllIndices(): Promise<ValidationReport> {
    this.logger.log('Starting comprehensive index validation');

    const report: ValidationReport = {
      globalIndex: await this.faissVectorService.getIndexHealth(),
      userIndices: new Map(),
      totalIndices: 0,
      healthyIndices: 0,
      corruptedIndices: [],
      timestamp: new Date(),
    };

    // Validate global index
    report.totalIndices = 1;
    if (report.globalIndex.isValid && !report.globalIndex.needsRebuild) {
      report.healthyIndices++;
    } else {
      report.corruptedIndices.push('global');
    }

    // Validate user indices by checking which users have documents
    const userIds = await this.getActiveUserIds();
    report.totalIndices += userIds.length;

    for (const userId of userIds) {
      try {
        const userHealth = await this.faissVectorService.getIndexHealth(userId);
        report.userIndices.set(userId, userHealth);

        if (userHealth.isValid && !userHealth.needsRebuild) {
          report.healthyIndices++;
        } else {
          report.corruptedIndices.push(`user:${userId}`);
        }
      } catch (error) {
        this.logger.warn(`Failed to validate user index for ${userId}`, {
          error: error instanceof Error ? error.message : String(error),
        });
        report.userIndices.set(userId, {
          isValid: false,
          documentCount: 0,
          needsRebuild: true,
        });
        report.corruptedIndices.push(`user:${userId}`);
      }
    }

    this.logger.log('Comprehensive index validation completed', {
      totalIndices: report.totalIndices,
      healthyIndices: report.healthyIndices,
      corruptedIndices: report.corruptedIndices.length,
      userIndicesValidated: userIds.length,
    });

    return report;
  }

  /**
   * Get list of active user IDs who have documents
   */
  private async getActiveUserIds(): Promise<string[]> {
    try {
      const userDocs = await this.documentModel
        .find({
          'metadata.source': { $in: USER_INDEX_SOURCES },
          status: 'active',
        })
        .distinct('metadata.userId')
        .lean();

      // Filter out null/undefined userIds and return unique list
      return userDocs.filter(
        (userId): userId is string =>
          !!(userId && typeof userId === 'string' && userId.trim().length > 0),
      );
    } catch (error) {
      this.logger.error('Failed to get active user IDs', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Rebuild global index from MongoDB source documents
   */
  async rebuildGlobalIndex(): Promise<void> {
    this.logger.log('Starting global index rebuild');

    try {
      // Query all global source documents from MongoDB
      const documents = await this.documentModel
        .find({
          'metadata.source': { $in: GLOBAL_INDEX_SOURCES },
          status: 'active',
        })
        .sort({ createdAt: -1 })
        .lean();

      this.logger.log(`Found ${documents.length} global documents to rebuild`);

      if (documents.length === 0) {
        this.logger.log('No global documents found, skipping rebuild');
        return;
      }

      // Convert to Langchain documents
      const langchainDocs = documents.map(
        (doc) =>
          new LangchainDocument({
            pageContent: doc.content,
            metadata: {
              id: doc._id.toString(),
              source: doc.metadata.source,
              sourceType: doc.metadata.sourceType,
              userId: doc.metadata.userId,
              projectId: doc.metadata.projectId,
              conversationId: doc.metadata.conversationId,
              documentId: doc.metadata.documentId,
              fileName: doc.metadata.fileName,
              filePath: doc.metadata.filePath,
              fileSize: doc.metadata.fileSize,
              fileType: doc.metadata.fileType,
              s3Key: doc.metadata.s3Key,
              s3Url: doc.metadata.s3Url,
              tags: doc.metadata.tags,
              language: doc.metadata.language,
              customMetadata: doc.metadata.customMetadata,
              domain: doc.metadata.domain,
              topic: doc.metadata.topic,
              topics: doc.metadata.topics,
              contentType: doc.metadata.contentType,
              importance: doc.metadata.importance,
              qualityScore: doc.metadata.qualityScore,
              technicalLevel: doc.metadata.technicalLevel,
              semanticTags: doc.metadata.semanticTags,
              relatedDocumentIds: doc.metadata.relatedDocumentIds,
              prerequisites: doc.metadata.prerequisites,
              version: doc.metadata.version,
              lastVerified: doc.metadata.lastVerified,
              deprecationDate: doc.metadata.deprecationDate,
              sectionTitle: doc.metadata.sectionTitle,
              sectionLevel: doc.metadata.sectionLevel,
              sectionPath: doc.metadata.sectionPath,
              precedingContext: doc.metadata.precedingContext,
              followingContext: doc.metadata.followingContext,
              containsCode: doc.metadata.containsCode,
              containsEquations: doc.metadata.containsEquations,
              containsLinks: doc.metadata.containsLinks,
              containsImages: doc.metadata.containsImages,
              chunkIndex: doc.chunkIndex,
              totalChunks: doc.totalChunks,
              parentDocumentId: doc.parentDocumentId?.toString(),
              ingestedAt: doc.ingestedAt,
              contentHash: doc.contentHash,
            },
          }),
      );

      // Clear existing global index
      await this.faissVectorService.clearAllIndices();

      // Add all documents to rebuild the index
      await this.faissVectorService.addDocuments(
        langchainDocs,
        'knowledge-base',
      );

      // Save the new index
      await this.faissVectorService.saveGlobalIndex();

      this.logger.log(
        `Successfully rebuilt global index with ${documents.length} documents`,
      );
    } catch (error) {
      this.logger.error('Failed to rebuild global index', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Global index rebuild failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Rebuild user index from MongoDB source documents
   */
  async rebuildUserIndex(userId: string): Promise<void> {
    this.logger.log('Starting user index rebuild', { userId });

    try {
      // Query all user source documents from MongoDB
      const documents = await this.documentModel
        .find({
          'metadata.userId': userId,
          'metadata.source': { $in: USER_INDEX_SOURCES },
          status: 'active',
        })
        .sort({ createdAt: -1 })
        .lean();

      this.logger.log(
        `Found ${documents.length} user documents to rebuild for user ${userId}`,
      );

      if (documents.length === 0) {
        this.logger.log(
          `No user documents found for ${userId}, clearing index`,
        );
        await this.faissVectorService.deleteUserIndex(userId);
        return;
      }

      // Convert to Langchain documents
      const langchainDocs = documents.map(
        (doc) =>
          new LangchainDocument({
            pageContent: doc.content,
            metadata: {
              id: doc._id.toString(),
              source: doc.metadata.source,
              sourceType: doc.metadata.sourceType,
              userId: doc.metadata.userId,
              projectId: doc.metadata.projectId,
              conversationId: doc.metadata.conversationId,
              documentId: doc.metadata.documentId,
              fileName: doc.metadata.fileName,
              filePath: doc.metadata.filePath,
              fileSize: doc.metadata.fileSize,
              fileType: doc.metadata.fileType,
              s3Key: doc.metadata.s3Key,
              s3Url: doc.metadata.s3Url,
              tags: doc.metadata.tags,
              language: doc.metadata.language,
              customMetadata: doc.metadata.customMetadata,
              domain: doc.metadata.domain,
              topic: doc.metadata.topic,
              topics: doc.metadata.topics,
              contentType: doc.metadata.contentType,
              importance: doc.metadata.importance,
              qualityScore: doc.metadata.qualityScore,
              technicalLevel: doc.metadata.technicalLevel,
              semanticTags: doc.metadata.semanticTags,
              relatedDocumentIds: doc.metadata.relatedDocumentIds,
              prerequisites: doc.metadata.prerequisites,
              version: doc.metadata.version,
              lastVerified: doc.metadata.lastVerified,
              deprecationDate: doc.metadata.deprecationDate,
              sectionTitle: doc.metadata.sectionTitle,
              sectionLevel: doc.metadata.sectionLevel,
              sectionPath: doc.metadata.sectionPath,
              precedingContext: doc.metadata.precedingContext,
              followingContext: doc.metadata.followingContext,
              containsCode: doc.metadata.containsCode,
              containsEquations: doc.metadata.containsEquations,
              containsLinks: doc.metadata.containsLinks,
              containsImages: doc.metadata.containsImages,
              chunkIndex: doc.chunkIndex,
              totalChunks: doc.totalChunks,
              parentDocumentId: doc.parentDocumentId?.toString(),
              ingestedAt: doc.ingestedAt,
              contentHash: doc.contentHash,
            },
          }),
      );

      // Delete existing user index
      await this.faissVectorService.deleteUserIndex(userId);

      // Get or create user index and add documents
      const userIndex = await this.faissVectorService.getUserIndex(userId);
      await userIndex.addDocuments(langchainDocs);

      // Save the new user index
      await this.faissVectorService.saveUserIndex(userId, userIndex);

      this.logger.log(
        `Successfully rebuilt user index for ${userId} with ${documents.length} documents`,
      );
    } catch (error) {
      this.logger.error('Failed to rebuild user index', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `User index rebuild failed for ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Rebuild all indices in background
   */
  async rebuildInBackground(): Promise<void> {
    this.logger.log('Starting background rebuild of all indices');

    try {
      // Rebuild global index in background
      setImmediate(async () => {
        try {
          await this.rebuildGlobalIndex();
          this.logger.log('Background global index rebuild completed');
        } catch (error) {
          this.logger.error('Background global index rebuild failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

      // Get all unique user IDs that have documents
      const userIds = await this.documentModel.distinct('metadata.userId', {
        'metadata.userId': { $exists: true, $ne: null },
        'metadata.source': { $in: USER_INDEX_SOURCES },
        status: 'active',
      });

      this.logger.log(
        `Found ${userIds.length} users with documents to rebuild`,
      );

      // Rebuild each user index in background with some delay between them
      userIds.forEach((userId, index) => {
        setTimeout(async () => {
          try {
            await this.rebuildUserIndex(userId);
            this.logger.log(
              `Background user index rebuild completed for ${userId}`,
            );
          } catch (error) {
            this.logger.error('Background user index rebuild failed', {
              userId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }, index * 5000); // 5 second delay between each user rebuild
      });

      this.logger.log('Background rebuild jobs queued successfully');
    } catch (error) {
      this.logger.error('Failed to queue background rebuild jobs', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Background rebuild queue failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Rebuild all user indices synchronously
   */
  async rebuildAllUserIndices(): Promise<void> {
    this.logger.log('Starting rebuild of all user indices');

    try {
      const userIds = await this.documentModel.distinct('metadata.userId', {
        'metadata.userId': { $exists: true, $ne: null },
        'metadata.source': { $in: USER_INDEX_SOURCES },
        status: 'active',
      });

      this.logger.log(`Rebuilding indices for ${userIds.length} users`);

      for (const userId of userIds) {
        await this.rebuildUserIndex(userId);
      }

      this.logger.log('All user indices rebuilt successfully');
    } catch (error) {
      this.logger.error('Failed to rebuild all user indices', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `All user indices rebuild failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Rebuild index for a specific source type
   */
  async rebuildSourceIndex(source: VectorSource): Promise<void> {
    this.logger.log(`Starting rebuild for source: ${source}`);

    try {
      if (GLOBAL_INDEX_SOURCES.includes(source)) {
        await this.rebuildGlobalIndex();
      } else if (USER_INDEX_SOURCES.includes(source)) {
        await this.rebuildAllUserIndices();
      } else {
        throw new Error(`Unknown source type: ${source}`);
      }

      this.logger.log(`Successfully rebuilt index for source: ${source}`);
    } catch (error) {
      this.logger.error('Failed to rebuild source index', {
        source,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Source index rebuild failed for ${source}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get rebuild statistics
   */
  async getRebuildStats(): Promise<{
    globalDocumentCount: number;
    userDocumentCount: number;
    userCount: number;
    sourceBreakdown: Record<string, number>;
  }> {
    try {
      const globalCount = await this.documentModel.countDocuments({
        'metadata.source': { $in: GLOBAL_INDEX_SOURCES },
        status: 'active',
      });

      const userCount = await this.documentModel.countDocuments({
        'metadata.userId': { $exists: true, $ne: null },
        'metadata.source': { $in: USER_INDEX_SOURCES },
        status: 'active',
      });

      const uniqueUserCount = await this.documentModel.distinct(
        'metadata.userId',
        {
          'metadata.userId': { $exists: true, $ne: null },
          'metadata.source': { $in: USER_INDEX_SOURCES },
          status: 'active',
        },
      );

      // Get breakdown by source
      const sourceBreakdown: Record<string, number> = {};
      const allSources = [...GLOBAL_INDEX_SOURCES, ...USER_INDEX_SOURCES];

      for (const source of allSources) {
        sourceBreakdown[source] = await this.documentModel.countDocuments({
          'metadata.source': source,
          status: 'active',
        });
      }

      return {
        globalDocumentCount: globalCount,
        userDocumentCount: userCount,
        userCount: uniqueUserCount.length,
        sourceBreakdown,
      };
    } catch (error) {
      this.logger.error('Failed to get rebuild stats', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Failed to get rebuild stats: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
