/**
 * Ingestion Service for NestJS
 * Handles document ingestion from various sources with progress tracking and job management
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Model } from 'mongoose';
import {
  Document,
  DocumentDocument,
} from '../../../schemas/document/document.schema';
import {
  Conversation,
  ConversationDocument,
} from '../../../schemas/chat/conversation.schema';
import {
  ChatMessage,
  ChatMessageDocument,
} from '../../../schemas/chat/chat-message.schema';
import {
  Telemetry,
  TelemetryDocument,
} from '../../../schemas/core/telemetry.schema';
import {
  DocumentProcessorService,
  ProcessedDocument,
} from './document-processor.service';
import { VectorStrategyService } from './vector-strategy.service';
import { StorageService } from '../../../modules/storage/storage.service';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface IngestionResult {
  success: boolean;
  documentsIngested: number;
  errors: string[];
  duration: number;
}

export interface IngestionJob {
  id: string;
  type: 'knowledge-base' | 'conversations' | 'telemetry' | 'custom';
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  totalItems: number;
  processedItems: number;
  errors: string[];
  startedAt?: Date;
  completedAt?: Date;
}

export interface UploadProgress {
  uploadId: string;
  stage:
    | 'preparing'
    | 'extracting'
    | 'ocr'
    | 'chunking'
    | 'processing'
    | 'embedding'
    | 'storing'
    | 'complete'
    | 'error';
  progress: number;
  message: string;
  currentBatch?: number;
  totalBatches?: number;
  totalChunks?: number;
  processedChunks?: number;
  error?: string;
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private activeJobs: Map<string, IngestionJob> = new Map();

  constructor(
    @InjectModel(Document.name) private documentModel: Model<DocumentDocument>,
    @InjectModel(Conversation.name)
    private conversationModel: Model<ConversationDocument>,
    @InjectModel(ChatMessage.name)
    private chatMessageModel: Model<ChatMessageDocument>,
    @InjectModel(Telemetry.name)
    private telemetryModel: Model<TelemetryDocument>,
    private documentProcessor: DocumentProcessorService,
    private vectorStrategy: VectorStrategyService,
    private storageService: StorageService,
    private eventEmitter: EventEmitter2,
  ) {}

  /**
   * Subscribe to upload progress events
   */
  onProgress(
    uploadId: string,
    callback: (progress: UploadProgress) => void,
  ): void {
    this.eventEmitter.on(`progress:${uploadId}`, callback);
  }

  /**
   * Unsubscribe from upload progress events
   */
  offProgress(
    uploadId: string,
    callback: (progress: UploadProgress) => void,
  ): void {
    this.eventEmitter.off(`progress:${uploadId}`, callback);
  }

  /**
   * Emit progress update
   */
  emitProgress(progress: UploadProgress): void {
    this.eventEmitter.emit(`progress:${progress.uploadId}`, progress);
  }

  /**
   * Ingest knowledge base documents
   */
  async ingestKnowledgeBase(force: boolean = false): Promise<IngestionResult> {
    const startTime = Date.now();
    const jobId = this.createJob('knowledge-base');
    const errors: string[] = [];
    let documentsIngested = 0;

    try {
      // Quick check: Skip if knowledge base already populated (unless forced)
      if (!force) {
        const existingCount = await this.documentModel.countDocuments({
          'metadata.source': 'knowledge-base',
        });

        if (existingCount > 0) {
          this.logger.log(
            'Knowledge base already populated, skipping ingestion',
            {
              existingDocuments: existingCount,
            },
          );

          this.updateJob(jobId, {
            status: 'completed',
            completedAt: new Date(),
            processedItems: 0,
          });

          return {
            success: true,
            documentsIngested: 0,
            errors: [],
            duration: Date.now() - startTime,
          };
        }
      }

      this.logger.log('Starting knowledge base ingestion', {
        jobId,
        forced: force,
      });

      // Get knowledge base directory
      const knowledgeBasePath = path.resolve(process.cwd(), 'knowledge-base');
      const files = this.getAllFiles(knowledgeBasePath, ['.md', '.txt']);

      this.updateJob(jobId, {
        status: 'running',
        totalItems: files.length,
        startedAt: new Date(),
      });

      // Process each file
      for (let i = 0; i < files.length; i++) {
        try {
          const file = files[i];
          const relativePath = path.relative(knowledgeBasePath, file);

          // Check if already ingested (by content hash)
          const fileContent = fs.readFileSync(file, 'utf-8');
          const contentHash =
            this.documentProcessor.generateContentHash(fileContent);

          const existing = await this.documentModel.findOne({
            contentHash,
            'metadata.source': 'knowledge-base',
            'metadata.filePath': relativePath,
          });

          if (existing) {
            this.logger.log('Skipping already ingested file', {
              file: relativePath,
            });
            this.updateJob(jobId, { processedItems: i + 1 });
            continue;
          }

          // Process file
          const chunks = await this.documentProcessor.processFile(file, {
            source: 'knowledge-base',
            sourceType: path.extname(file).replace('.', ''),
            filePath: relativePath,
            tags: ['knowledge-base', 'documentation'],
          });

          // Ingest chunks
          await this.ingestChunks(chunks);
          documentsIngested += chunks.length;

          this.updateJob(jobId, { processedItems: i + 1 });
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          errors.push(`Error processing ${files[i]}: ${errorMsg}`);
          this.logger.error('Error processing knowledge base file', {
            file: files[i],
            error: errorMsg,
          });
        }
      }

      const duration = Date.now() - startTime;

      this.updateJob(jobId, {
        status: 'completed',
        completedAt: new Date(),
        errors,
      });

      this.logger.log('Knowledge base ingestion completed', {
        documentsIngested,
        duration,
        errors: errors.length,
      });

      return {
        success: true,
        documentsIngested,
        errors,
        duration,
      };
    } catch (error) {
      this.updateJob(jobId, {
        status: 'failed',
        completedAt: new Date(),
      });

      this.logger.error('Knowledge base ingestion failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        documentsIngested,
        errors: [
          ...errors,
          error instanceof Error ? error.message : String(error),
        ],
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Ingest user conversations
   */
  async ingestConversations(
    userId?: string,
    since?: Date,
  ): Promise<IngestionResult> {
    const startTime = Date.now();
    const jobId = this.createJob('conversations');
    const errors: string[] = [];
    let documentsIngested = 0;

    try {
      this.logger.log('Starting conversation ingestion', {
        userId,
        since,
      });

      // Query conversations
      const query: any = {};
      if (userId) query.userId = userId;
      if (since) query.createdAt = { $gte: since };

      const conversations = await this.conversationModel.find(query).limit(100); // Process in batches

      this.updateJob(jobId, {
        status: 'running',
        totalItems: conversations.length,
        startedAt: new Date(),
      });

      for (let i = 0; i < conversations.length; i++) {
        try {
          const conversation = conversations[i];

          // Get messages for this conversation
          const messages = await this.chatMessageModel
            .find({
              conversationId: conversation._id,
            })
            .sort({ createdAt: 1 });

          if (messages.length === 0) continue;

          // Check if already ingested
          const existing = await this.documentModel.findOne({
            'metadata.conversationId': conversation._id.toString(),
            'metadata.source': 'conversation',
          });

          if (existing && !since) {
            // Skip if already ingested and not doing incremental update
            this.updateJob(jobId, { processedItems: i + 1 });
            continue;
          }

          // Process conversation
          const chunks = await this.documentProcessor.processConversation(
            messages.map((m) => ({
              role: m.role,
              content: m.content,
              timestamp: m.createdAt,
            })),
            {
              source: 'conversation',
              sourceType: 'chat',
              userId: conversation.userId,
              conversationId: conversation._id.toString(),
              tags: ['conversation', 'chat', conversation.title || 'untitled'],
            },
          );

          // Remove old chunks if exists (for incremental updates)
          if (existing) {
            await this.documentModel.deleteMany({
              'metadata.conversationId': conversation._id.toString(),
              'metadata.source': 'conversation',
            });
          }

          // Ingest chunks
          await this.ingestChunks(chunks);
          documentsIngested += chunks.length;

          this.updateJob(jobId, { processedItems: i + 1 });
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          errors.push(
            `Error processing conversation ${conversations[i]._id}: ${errorMsg}`,
          );
        }
      }

      const duration = Date.now() - startTime;

      this.updateJob(jobId, {
        status: 'completed',
        completedAt: new Date(),
        errors,
      });

      this.logger.log('Conversation ingestion completed', {
        documentsIngested,
        duration,
        errors: errors.length,
      });

      return {
        success: true,
        documentsIngested,
        errors,
        duration,
      };
    } catch (error) {
      this.updateJob(jobId, {
        status: 'failed',
        completedAt: new Date(),
      });

      return {
        success: false,
        documentsIngested,
        errors: [
          ...errors,
          error instanceof Error ? error.message : String(error),
        ],
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Ingest telemetry data
   */
  async ingestTelemetry(
    userId?: string,
    since?: Date,
  ): Promise<IngestionResult> {
    const startTime = Date.now();
    const jobId = this.createJob('telemetry');
    const errors: string[] = [];
    let documentsIngested = 0;

    try {
      this.logger.log('Starting telemetry ingestion', {
        userId,
        since,
      });

      // Query telemetry with semantic content
      const query: any = {
        $or: [
          { semantic_content: { $exists: true, $ne: '' } },
          { cost_narrative: { $exists: true, $ne: '' } },
        ],
      };

      if (userId) query.user_id = userId;
      if (since) query.timestamp = { $gte: since };

      const telemetryRecords = await this.telemetryModel.find(query).limit(100);

      this.updateJob(jobId, {
        status: 'running',
        totalItems: telemetryRecords.length,
        startedAt: new Date(),
      });

      for (let i = 0; i < telemetryRecords.length; i++) {
        try {
          const record = telemetryRecords[i];

          // Check if already ingested
          const recordId = (record as any)._id?.toString();
          const existing = await this.documentModel.findOne({
            'metadata.customMetadata.telemetryId': recordId,
          });

          if (existing && !since) continue;

          // Process telemetry
          const chunks = await this.documentProcessor.processTelemetry(
            record.toObject(),
            {
              source: 'telemetry',
              sourceType: 'telemetry',
              userId: record.user_id,
              tags: [
                'telemetry',
                'cost-analysis',
                record.operation_name || 'unknown',
              ],
              customMetadata: {
                telemetryId: recordId,
                traceId: record.trace_id,
                operationName: record.operation_name,
              },
            },
          );

          if (chunks.length === 0) continue;

          // Ingest chunks
          await this.ingestChunks(chunks);
          documentsIngested += chunks.length;

          this.updateJob(jobId, { processedItems: i + 1 });
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          errors.push(
            `Error processing telemetry ${telemetryRecords[i]._id}: ${errorMsg}`,
          );
        }
      }

      const duration = Date.now() - startTime;

      this.updateJob(jobId, {
        status: 'completed',
        completedAt: new Date(),
        errors,
      });

      this.logger.log('Telemetry ingestion completed', {
        documentsIngested,
        duration,
        errors: errors.length,
      });

      return {
        success: true,
        documentsIngested,
        errors,
        duration,
      };
    } catch (error) {
      this.updateJob(jobId, {
        status: 'failed',
        completedAt: new Date(),
      });

      return {
        success: false,
        documentsIngested,
        errors: [
          ...errors,
          error instanceof Error ? error.message : String(error),
        ],
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Ingest chunks using vector strategy service
   */
  async ingestChunks(
    chunks: ProcessedDocument[],
    uploadId?: string,
  ): Promise<void> {
    this.logger.log('ingestChunks() called', {
      totalChunks: chunks.length,
      uploadId: uploadId || 'none',
      firstChunkSample: chunks[0]
        ? {
            userId: chunks[0].metadata.userId,
            documentId: chunks[0].metadata.documentId,
            fileName: chunks[0].metadata.fileName,
            source: chunks[0].metadata.source,
            contentLength: chunks[0].content.length,
          }
        : null,
    });

    const BATCH_SIZE = 10; // Process 10 chunks at a time
    const DELAY_MS = 200; // 200ms delay between batches

    try {
      const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);
      let totalInserted = 0;

      // Emit initial processing stage if uploadId is provided
      if (uploadId) {
        this.emitProgress({
          uploadId,
          stage: 'processing',
          progress: 35,
          message: `Starting to process ${chunks.length} chunks in ${totalBatches} batches`,
          currentBatch: 0,
          totalBatches,
          totalChunks: chunks.length,
          processedChunks: 0,
        });
      }

      for (let i = 0; i < totalBatches; i++) {
        this.logger.log(`Processing batch ${i + 1}/${totalBatches}`, {
          batch: i + 1,
          totalBatches,
        });

        const batchStart = i * BATCH_SIZE;
        const batchEnd = Math.min((i + 1) * BATCH_SIZE, chunks.length);
        const batchChunks = chunks.slice(batchStart, batchEnd);

        // Emit batch start progress (40-70% range for embedding phase)
        if (uploadId) {
          const progressPercentage = 40 + Math.round((i / totalBatches) * 30);
          this.emitProgress({
            uploadId,
            stage: 'embedding',
            progress: progressPercentage,
            message: `Generating embeddings for batch ${i + 1}/${totalBatches}`,
            currentBatch: i + 1,
            totalBatches,
            totalChunks: chunks.length,
            processedChunks: totalInserted,
          });
        }

        try {
          // Filter out empty chunks to prevent embedding validation errors
          const validBatchChunks = batchChunks.filter(
            (c) => c.content && c.content.trim().length > 0,
          );

          if (validBatchChunks.length === 0) {
            this.logger.warn(
              `Batch ${i + 1}/${totalBatches} skipped - all chunks are empty`,
              {
                batch: i + 1,
                skippedChunks: batchChunks.length,
              },
            );
            continue;
          }

          // Convert to LangChain documents for vector storage
          const langchainDocs = validBatchChunks.map((chunk) => ({
            pageContent: chunk.content.trim(),
            metadata: {
              ...chunk.metadata,
              chunkIndex: chunk.chunkIndex,
              totalChunks: chunk.totalChunks,
              contentHash: chunk.contentHash,
            },
          }));

          // Add to vector strategy (will route to appropriate stores based on config)
          await this.vectorStrategy.add(langchainDocs, {
            source: validBatchChunks[0].metadata.source as any,
            userId: validBatchChunks[0].metadata.userId,
            projectId: validBatchChunks[0].metadata.projectId,
            documentId: validBatchChunks[0].metadata.documentId,
          });

          totalInserted += validBatchChunks.length;

          this.logger.log(
            `Batch ${i + 1}/${totalBatches} ingested successfully`,
            {
              batchSize: batchChunks.length,
              inserted: validBatchChunks.length,
              expectedSize: batchChunks.length,
            },
          );

          // Emit batch completion progress (70-100% range for storing phase)
          if (uploadId) {
            const progressPercentage =
              70 + Math.round(((i + 1) / totalBatches) * 30);
            this.emitProgress({
              uploadId,
              stage: 'storing',
              progress: progressPercentage,
              message: `Stored batch ${i + 1}/${totalBatches} (${progressPercentage}% complete)`,
              currentBatch: i + 1,
              totalBatches,
              totalChunks: chunks.length,
              processedChunks: totalInserted,
            });
          }

          // Delay between batches to avoid throttling (except for last batch)
          if (i < totalBatches - 1) {
            await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
          }
        } catch (batchError: any) {
          this.logger.error(`Failed to ingest batch ${i + 1}/${totalBatches}`, {
            error:
              batchError instanceof Error
                ? batchError.message
                : String(batchError),
            batch: i + 1,
            totalBatches,
          });

          // Emit error progress
          if (uploadId) {
            this.emitProgress({
              uploadId,
              stage: 'error',
              progress: Math.round(((i + 1) / totalBatches) * 100),
              message: `Error processing batch ${i + 1}/${totalBatches}: ${batchError.message || 'Unknown error'}`,
              currentBatch: i + 1,
              totalBatches,
              totalChunks: chunks.length,
              processedChunks: totalInserted,
              error: batchError.message || 'Unknown error',
            });
          }

          // Continue with next batch instead of failing completely
        }
      }

      // Emit completion progress
      if (uploadId) {
        this.emitProgress({
          uploadId,
          stage: 'complete',
          progress: 100,
          message: `Successfully processed all ${totalBatches} batches (${totalInserted} chunks stored)`,
          currentBatch: totalBatches,
          totalBatches,
          totalChunks: chunks.length,
          processedChunks: totalInserted,
        });
      }

      this.logger.log('Chunks ingestion completed', {
        totalChunks: chunks.length,
        totalInserted,
      });
    } catch (error) {
      this.logger.error('Failed to ingest chunks', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  /**
   * Ingest file buffer (for uploads)
   */
  async ingestFileBuffer(
    buffer: Buffer,
    fileName: string,
    userId: string,
    metadata?: Partial<ProcessedDocument['metadata']>,
    uploadId?: string,
  ): Promise<IngestionResult & { documentId?: string }> {
    const startTime = Date.now();

    try {
      // Use documentId from metadata if provided (e.g. from file upload or ingestion controller)
      const documentId =
        metadata?.documentId || `doc_${Date.now()}_${uuidv4().substring(0, 9)}`;

      // Emit initial progress - document preparation
      if (uploadId) {
        this.emitProgress({
          uploadId,
          stage: 'preparing',
          progress: 0,
          message: 'Preparing document for processing...',
          totalChunks: 0,
          processedChunks: 0,
        });
      }

      // Emit progress - extracting text
      if (uploadId) {
        this.emitProgress({
          uploadId,
          stage: 'extracting',
          progress: 10,
          message: 'Extracting text from document...',
          totalChunks: 0,
          processedChunks: 0,
        });
      }

      // Process file buffer with documentId in metadata
      const chunks = await this.documentProcessor.processFileBuffer(
        buffer,
        fileName,
        {
          source: 'user-upload',
          userId,
          documentId,
          fileName,
          ...metadata,
        },
      );

      // Emit progress - text extracted, starting chunking
      if (uploadId) {
        this.emitProgress({
          uploadId,
          stage: 'chunking',
          progress: 30,
          message: `Text extracted successfully. Creating ${chunks.length} chunks...`,
          totalChunks: chunks.length,
          processedChunks: 0,
        });
      }

      // Ingest chunks with progress tracking
      this.logger.log('Routing to ingestion path', {
        chunksToIngest: chunks.length,
        userId,
      });

      await this.ingestChunks(chunks, uploadId);

      const duration = Date.now() - startTime;

      this.logger.log('File buffer ingested successfully', {
        fileName,
        userId,
        documentId,
        chunksCreated: chunks.length,
        duration,
      });

      return {
        success: true,
        documentsIngested: chunks.length,
        documentId,
        errors: [],
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      if (uploadId) {
        this.emitProgress({
          uploadId,
          stage: 'error',
          progress: 0,
          message:
            'Upload failed: ' +
            (error instanceof Error ? error.message : 'Unknown error'),
        });
      }

      this.logger.error('File buffer ingestion failed', {
        fileName,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        documentsIngested: 0,
        errors: [error instanceof Error ? error.message : String(error)],
        duration,
      };
    }
  }

  /**
   * Delete user document
   */
  async deleteDocument(documentId: string, userId: string): Promise<boolean> {
    try {
      // Verify ownership
      const doc = await this.documentModel.findOne({
        _id: documentId,
        'metadata.userId': userId,
      });

      if (!doc) {
        throw new Error('Document not found or access denied');
      }

      // Soft delete
      doc.status = 'deleted';
      await doc.save();

      this.logger.log('Document deleted successfully', {
        documentId,
        userId,
      });

      return true;
    } catch (error) {
      this.logger.error('Failed to delete document', {
        documentId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Get ingestion job status
   */
  getJobStatus(jobId: string): IngestionJob | null {
    return this.activeJobs.get(jobId) || null;
  }

  /**
   * Get all files recursively
   */
  private getAllFiles(dirPath: string, extensions: string[]): string[] {
    const files: string[] = [];

    if (!fs.existsSync(dirPath)) {
      this.logger.warn('Directory does not exist', { dirPath });
      return files;
    }

    const items = fs.readdirSync(dirPath);

    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        files.push(...this.getAllFiles(fullPath, extensions));
      } else if (extensions.some((ext) => item.endsWith(ext))) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Create a new job
   */
  private createJob(type: IngestionJob['type']): string {
    const jobId = `${type}-${Date.now()}-${uuidv4().substring(0, 7)}`;
    const job: IngestionJob = {
      id: jobId,
      type,
      status: 'pending',
      progress: 0,
      totalItems: 0,
      processedItems: 0,
      errors: [],
    };

    this.activeJobs.set(jobId, job);
    return jobId;
  }

  /**
   * Update job status
   */
  private updateJob(jobId: string, updates: Partial<IngestionJob>): void {
    const job = this.activeJobs.get(jobId);
    if (job) {
      Object.assign(job, updates);
      if (job.totalItems > 0) {
        job.progress = Math.round((job.processedItems / job.totalItems) * 100);
      }
    }
  }

  /**
   * List user's documents with pagination (from Document collection by metadata.userId)
   */
  async listUserDocuments(
    userId: string,
    options: {
      limit: number;
      skip: number;
      source?: string;
    },
  ): Promise<{ documents: any[]; total: number }> {
    const query: any = {
      'metadata.userId': userId,
      status: 'active',
    };
    if (options.source) {
      query['metadata.source'] = options.source;
    }

    const [documents, total] = await Promise.all([
      this.documentModel
        .aggregate([
          { $match: query },
          { $sort: { ingestedAt: -1 } },
          { $skip: options.skip },
          { $limit: options.limit },
          {
            $group: {
              _id: '$metadata.documentId',
              documentId: { $first: '$metadata.documentId' },
              fileName: { $first: '$metadata.fileName' },
              source: { $first: '$metadata.source' },
              sourceType: { $first: '$metadata.sourceType' },
              chunksCount: { $sum: 1 },
              ingestedAt: { $first: '$ingestedAt' },
            },
          },
          {
            $project: {
              _id: 0,
              documentId: '$_id',
              fileName: 1,
              source: 1,
              sourceType: 1,
              chunksCount: 1,
              ingestedAt: 1,
            },
          },
        ])
        .exec(),
      this.documentModel
        .aggregate([
          { $match: query },
          { $group: { _id: '$metadata.documentId' } },
          { $count: 'total' },
        ])
        .exec()
        .then((res) => res[0]?.total ?? 0),
    ]);

    return {
      documents: documents.map((d) => ({
        documentId: d.documentId,
        fileName: d.fileName,
        source: d.source,
        sourceType: d.sourceType,
        chunksCount: d.chunksCount,
        ingestedAt: d.ingestedAt,
      })),
      total,
    };
  }

  /**
   * List user's documents metadata only (for chat document picker)
   */
  async listUserDocumentsMetadata(userId: string): Promise<any[]> {
    const docs = await this.documentModel
      .aggregate([
        {
          $match: {
            'metadata.userId': userId,
            status: 'active',
            'metadata.documentId': { $exists: true, $ne: null },
          },
        },
        { $sort: { ingestedAt: -1 } },
        {
          $group: {
            _id: '$metadata.documentId',
            documentId: { $first: '$metadata.documentId' },
            fileName: { $first: '$metadata.fileName' },
            fileType: { $first: '$metadata.fileType' },
            source: { $first: '$metadata.source' },
            chunksCount: { $sum: 1 },
            ingestedAt: { $first: '$ingestedAt' },
          },
        },
        { $limit: 100 },
        {
          $project: {
            _id: 0,
            documentId: '$_id',
            fileName: 1,
            fileType: 1,
            source: 1,
            chunksCount: 1,
            ingestedAt: 1,
          },
        },
      ])
      .exec();

    return docs;
  }

  /**
   * Get document preview (first N chunks content combined)
   */
  async getDocumentPreview(
    documentId: string,
    userId: string,
    maxChunks: number,
  ): Promise<{
    content: string;
    chunksCount: number;
    fileName?: string;
  } | null> {
    const chunks = await this.documentModel
      .find({
        'metadata.documentId': documentId,
        'metadata.userId': userId,
        status: 'active',
      })
      .sort({ chunkIndex: 1 })
      .limit(maxChunks)
      .select('content metadata.fileName')
      .lean()
      .exec();

    if (!chunks || chunks.length === 0) {
      return null;
    }

    const content = chunks.map((c) => (c as any).content).join('\n\n');
    const fileName = (chunks[0] as any)?.metadata?.fileName;

    return {
      content,
      chunksCount: chunks.length,
      fileName,
    };
  }

  /**
   * Get ingestion statistics
   */
  async getStats(userId?: string): Promise<any> {
    try {
      const query: any = { status: 'active' };
      if (userId) {
        query['metadata.userId'] = userId;
      }

      const totalDocuments = await this.documentModel.countDocuments(query);
      const bySource = await this.documentModel.aggregate([
        { $match: query },
        { $group: { _id: '$metadata.source', count: { $sum: 1 } } },
      ]);

      const byUser = userId
        ? null
        : await this.documentModel.aggregate([
            {
              $match: {
                status: 'active',
                'metadata.userId': { $exists: true },
              },
            },
            { $group: { _id: '$metadata.userId', count: { $sum: 1 } } },
            { $limit: 10 },
          ]);

      return {
        totalDocuments,
        bySource: bySource.reduce(
          (acc, item) => {
            acc[item._id] = item.count;
            return acc;
          },
          {} as Record<string, number>,
        ),
        topUsers: byUser,
      };
    } catch (error) {
      this.logger.error('Failed to get ingestion stats', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
