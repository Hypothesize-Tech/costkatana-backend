import { DocumentModel } from '../models/Document';
import { documentProcessorService, ProcessedDocument } from './documentProcessor.service';
import { BedrockEmbeddings } from '@langchain/community/embeddings/bedrock';
import { loggingService } from './logging.service';
import { Conversation } from '../models/Conversation';
import { ChatMessage } from '../models/ChatMessage';
import { ITelemetry, Telemetry } from '../models/Telemetry';
import * as fs from 'fs';
import * as path from 'path';

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

export class IngestionService {
    private embeddings: BedrockEmbeddings;
    private initialized = false;
    private activeJobs: Map<string, IngestionJob> = new Map();

    constructor() {
        this.embeddings = new BedrockEmbeddings({
            region: process.env.AWS_BEDROCK_REGION || 'us-east-1',
            model: process.env.RAG_EMBEDDING_MODEL || 'amazon.titan-embed-text-v2:0',
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
            },
            maxRetries: 3,
        });
    }

    /**
     * Initialize the ingestion service
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            loggingService.info('Initializing Ingestion Service', {
                component: 'IngestionService',
                operation: 'initialize'
            });

            // Test embeddings
            await this.embeddings.embedQuery('test');

            this.initialized = true;
            loggingService.info('✅ Ingestion Service initialized successfully', {
                component: 'IngestionService',
                operation: 'initialize'
            });
        } catch (error) {
            loggingService.error('Failed to initialize Ingestion Service', {
                component: 'IngestionService',
                operation: 'initialize',
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Ingest knowledge base documents
     */
    async ingestKnowledgeBase(): Promise<IngestionResult> {
        const startTime = Date.now();
        const jobId = this.createJob('knowledge-base');
        const errors: string[] = [];
        let documentsIngested = 0;

        try {
            loggingService.info('Starting knowledge base ingestion', {
                component: 'IngestionService',
                operation: 'ingestKnowledgeBase',
                jobId
            });

            // Get knowledge base directory
            const knowledgeBasePath = path.resolve(__dirname, '../../knowledge-base');
            const files = this.getAllFiles(knowledgeBasePath, ['.md', '.txt']);

            this.updateJob(jobId, {
                status: 'running',
                totalItems: files.length,
                startedAt: new Date()
            });

            // Process each file
            for (let i = 0; i < files.length; i++) {
                try {
                    const file = files[i];
                    const relativePath = path.relative(knowledgeBasePath, file);

                    // Check if already ingested (by content hash)
                    const fileContent = fs.readFileSync(file, 'utf-8');
                    const contentHash = documentProcessorService.generateContentHash(fileContent);

                    const existing = await DocumentModel.findOne({
                        contentHash,
                        'metadata.source': 'knowledge-base',
                        'metadata.filePath': relativePath
                    });

                    if (existing) {
                        loggingService.info('Skipping already ingested file', {
                            component: 'IngestionService',
                            file: relativePath
                        });
                        this.updateJob(jobId, { processedItems: i + 1 });
                        continue;
                    }

                    // Process file
                    const chunks = await documentProcessorService.processFile(file, {
                        source: 'knowledge-base',
                        sourceType: path.extname(file).replace('.', ''),
                        filePath: relativePath,
                        tags: ['knowledge-base', 'documentation']
                    });

                    // Ingest chunks
                    await this.ingestChunks(chunks);
                    documentsIngested += chunks.length;

                    this.updateJob(jobId, { processedItems: i + 1 });
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    errors.push(`Error processing ${files[i]}: ${errorMsg}`);
                    loggingService.error('Error processing knowledge base file', {
                        component: 'IngestionService',
                        file: files[i],
                        error: errorMsg
                    });
                }
            }

            const duration = Date.now() - startTime;

            this.updateJob(jobId, {
                status: 'completed',
                completedAt: new Date(),
                errors
            });

            loggingService.info('Knowledge base ingestion completed', {
                component: 'IngestionService',
                operation: 'ingestKnowledgeBase',
                documentsIngested,
                duration,
                errors: errors.length
            });

            return {
                success: true,
                documentsIngested,
                errors,
                duration
            };
        } catch (error) {
            this.updateJob(jobId, {
                status: 'failed',
                completedAt: new Date()
            });

            loggingService.error('Knowledge base ingestion failed', {
                component: 'IngestionService',
                operation: 'ingestKnowledgeBase',
                error: error instanceof Error ? error.message : String(error)
            });

            return {
                success: false,
                documentsIngested,
                errors: [...errors, error instanceof Error ? error.message : String(error)],
                duration: Date.now() - startTime
            };
        }
    }

    /**
     * Ingest user conversations
     */
    async ingestConversations(userId?: string, since?: Date): Promise<IngestionResult> {
        const startTime = Date.now();
        const jobId = this.createJob('conversations');
        const errors: string[] = [];
        let documentsIngested = 0;

        try {
            loggingService.info('Starting conversation ingestion', {
                component: 'IngestionService',
                operation: 'ingestConversations',
                userId,
                since
            });

            // Query conversations
            const query: any = {};
            if (userId) query.userId = userId;
            if (since) query.createdAt = { $gte: since };

            const conversations = await Conversation.find(query).limit(100); // Process in batches

            this.updateJob(jobId, {
                status: 'running',
                totalItems: conversations.length,
                startedAt: new Date()
            });

            for (let i = 0; i < conversations.length; i++) {
                try {
                    const conversation = conversations[i];

                    // Get messages for this conversation
                    const messages = await ChatMessage.find({
                        conversationId: conversation._id
                    }).sort({ createdAt: 1 });

                    if (messages.length === 0) continue;

                    // Check if already ingested
                    const existing = await DocumentModel.findOne({
                        'metadata.conversationId': conversation._id.toString(),
                        'metadata.source': 'conversation'
                    });

                    if (existing && !since) {
                        // Skip if already ingested and not doing incremental update
                        this.updateJob(jobId, { processedItems: i + 1 });
                        continue;
                    }

                    // Process conversation
                    const chunks = await documentProcessorService.processConversation(
                        messages.map(m => ({
                            role: m.role,
                            content: m.content,
                            timestamp: m.createdAt
                        })),
                        {
                            source: 'conversation',
                            sourceType: 'chat',
                            userId: conversation.userId,
                            conversationId: conversation._id.toString(),
                            tags: ['conversation', 'chat', conversation.title || 'untitled']
                        }
                    );

                    // Remove old chunks if exists (for incremental updates)
                    if (existing) {
                        await DocumentModel.deleteMany({
                            'metadata.conversationId': conversation._id.toString(),
                            'metadata.source': 'conversation'
                        });
                    }

                    // Ingest chunks
                    await this.ingestChunks(chunks);
                    documentsIngested += chunks.length;

                    this.updateJob(jobId, { processedItems: i + 1 });
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    errors.push(`Error processing conversation ${conversations[i]._id}: ${errorMsg}`);
                }
            }

            const duration = Date.now() - startTime;

            this.updateJob(jobId, {
                status: 'completed',
                completedAt: new Date(),
                errors
            });

            loggingService.info('Conversation ingestion completed', {
                component: 'IngestionService',
                operation: 'ingestConversations',
                documentsIngested,
                duration,
                errors: errors.length
            });

            return {
                success: true,
                documentsIngested,
                errors,
                duration
            };
        } catch (error) {
            this.updateJob(jobId, {
                status: 'failed',
                completedAt: new Date()
            });

            return {
                success: false,
                documentsIngested,
                errors: [...errors, error instanceof Error ? error.message : String(error)],
                duration: Date.now() - startTime
            };
        }
    }

    /**
     * Ingest telemetry data
     */
    async ingestTelemetry(userId?: string, since?: Date): Promise<IngestionResult> {
        const startTime = Date.now();
        const jobId = this.createJob('telemetry');
        const errors: string[] = [];
        let documentsIngested = 0;

        try {
            loggingService.info('Starting telemetry ingestion', {
                component: 'IngestionService',
                operation: 'ingestTelemetry',
                userId,
                since
            });

            // Query telemetry with semantic content
            const query: any = {
                $or: [
                    { semantic_content: { $exists: true, $ne: '' } },
                    { cost_narrative: { $exists: true, $ne: '' } }
                ]
            };

            if (userId) query.user_id = userId;
            if (since) query.timestamp = { $gte: since };

            const telemetryRecords = await Telemetry.find(query).limit(100);

            this.updateJob(jobId, {
                status: 'running',
                totalItems: telemetryRecords.length,
                startedAt: new Date()
            });

            for (let i = 0; i < telemetryRecords.length; i++) {
                try {
                    const record = telemetryRecords[i] as ITelemetry;

                    // Check if already ingested
                    const recordId = (record as any)._id?.toString();
                    const existing = await DocumentModel.findOne({
                        'metadata.customMetadata.telemetryId': recordId
                    });

                    if (existing && !since) continue;

                    // Process telemetry
                    const chunks = await documentProcessorService.processTelemetry(
                        record.toObject(),
                        {
                            source: 'telemetry',
                            sourceType: 'telemetry',
                            userId: record.user_id,
                            tags: ['telemetry', 'cost-analysis', record.operation_name || 'unknown'],
                            customMetadata: {
                                telemetryId: recordId,
                                traceId: record.trace_id,
                                operationName: record.operation_name
                            }
                        }
                    );

                    if (chunks.length === 0) continue;

                    // Ingest chunks
                    await this.ingestChunks(chunks);
                    documentsIngested += chunks.length;

                    this.updateJob(jobId, { processedItems: i + 1 });
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    errors.push(`Error processing telemetry ${telemetryRecords[i]._id}: ${errorMsg}`);
                }
            }

            const duration = Date.now() - startTime;

            this.updateJob(jobId, {
                status: 'completed',
                completedAt: new Date(),
                errors
            });

            loggingService.info('Telemetry ingestion completed', {
                component: 'IngestionService',
                operation: 'ingestTelemetry',
                documentsIngested,
                duration,
                errors: errors.length
            });

            return {
                success: true,
                documentsIngested,
                errors,
                duration
            };
        } catch (error) {
            this.updateJob(jobId, {
                status: 'failed',
                completedAt: new Date()
            });

            return {
                success: false,
                documentsIngested,
                errors: [...errors, error instanceof Error ? error.message : String(error)],
                duration: Date.now() - startTime
            };
        }
    }

    /**
     * Ingest custom document chunks with rate limiting
     */
    private async ingestChunks(chunks: ProcessedDocument[]): Promise<void> {
        const BATCH_SIZE = 5; // Process 5 chunks at a time to avoid throttling
        const DELAY_MS = 1000; // 1 second delay between batches
        
        try {
            const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);
            let totalInserted = 0;

            for (let i = 0; i < totalBatches; i++) {
                const batchStart = i * BATCH_SIZE;
                const batchEnd = Math.min((i + 1) * BATCH_SIZE, chunks.length);
                const batchChunks = chunks.slice(batchStart, batchEnd);

                try {
                    // Generate embeddings for this batch with retry logic
                    const contents = batchChunks.map(c => c.content);
                    let embeddings: number[][] | null = null;
                    let retryCount = 0;
                    const maxRetries = 3;

                    while (retryCount < maxRetries && !embeddings) {
                        try {
                            embeddings = await this.embeddings.embedDocuments(contents);
                        } catch (embeddingError: any) {
                            if (embeddingError.message?.includes('Throttling') || embeddingError.$metadata?.httpStatusCode === 429) {
                                retryCount++;
                                const delay = Math.min(1000 * Math.pow(2, retryCount), 10000); // Exponential backoff, max 10s
                                loggingService.warn(`Throttled by AWS Bedrock, retrying after ${delay}ms (attempt ${retryCount}/${maxRetries})`, {
                                    component: 'IngestionService',
                                    operation: 'ingestChunks',
                                    batch: i + 1,
                                    totalBatches
                                });
                                await new Promise(resolve => setTimeout(resolve, delay));
                            } else {
                                throw embeddingError;
                            }
                        }
                    }

                    if (!embeddings) {
                        throw new Error(`Failed to generate embeddings after ${maxRetries} retries`);
                    }

                    // Create document records
                    const documents = batchChunks.map((chunk, index) => ({
                        content: chunk.content,
                        contentHash: chunk.contentHash,
                        embedding: embeddings![index],
                        metadata: chunk.metadata,
                        chunkIndex: chunk.chunkIndex,
                        totalChunks: chunk.totalChunks,
                        ingestedAt: new Date(),
                        status: 'active',
                        accessCount: 0
                    }));

                    // Insert this batch
                    try {
                        const result = await DocumentModel.insertMany(documents, { ordered: false });
                        totalInserted += result.length;

                        loggingService.info(`Batch ${i + 1}/${totalBatches} ingested successfully`, {
                            component: 'IngestionService',
                            operation: 'ingestChunks',
                            batchSize: batchChunks.length,
                            inserted: result.length,
                            expectedSize: documents.length
                        });

                        // Log warning if inserted count doesn't match
                        if (result.length !== documents.length) {
                            loggingService.warn(`Inserted count mismatch`, {
                                component: 'IngestionService',
                                operation: 'ingestChunks',
                                expected: documents.length,
                                actual: result.length
                            });
                        }
                    } catch (insertError: any) {
                        loggingService.error(`Insert failed for batch ${i + 1}/${totalBatches}`, {
                            component: 'IngestionService',
                            operation: 'ingestChunks',
                            error: insertError.message,
                            code: insertError.code,
                            writeErrors: insertError.writeErrors?.length || 0,
                            sampleError: insertError.writeErrors?.[0]
                        });
                        throw insertError;
                    }

                    // Delay between batches to avoid throttling (except for last batch)
                    if (i < totalBatches - 1) {
                        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
                    }

                } catch (batchError: any) {
                    loggingService.error(`Failed to ingest batch ${i + 1}/${totalBatches}`, {
                        component: 'IngestionService',
                        operation: 'ingestChunks',
                        error: batchError instanceof Error ? batchError.message : String(batchError),
                        batch: i + 1,
                        totalBatches
                    });
                    
                    // Continue with next batch instead of failing completely
                    if (batchError.writeErrors) {
                        loggingService.error('Bulk write errors during insertion', {
                            component: 'IngestionService',
                            errorCount: batchError.writeErrors.length,
                            firstError: batchError.writeErrors[0]
                        });
                    }
                }
            }

            loggingService.info('Chunks ingestion completed', {
                component: 'IngestionService',
                operation: 'ingestChunks',
                totalChunks: chunks.length,
                totalInserted
            });

        } catch (error) {
            loggingService.error('Failed to ingest chunks', {
                component: 'IngestionService',
                operation: 'ingestChunks',
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
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
        metadata?: Partial<ProcessedDocument['metadata']>
    ): Promise<IngestionResult & { documentId?: string }> {
        const startTime = Date.now();

        try {
            // Generate unique document ID for this file
            const documentId = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            // Get file type from fileName
            const fileExtension = fileName.split('.').pop()?.toLowerCase() || 'unknown';
            
            // Process file buffer with documentId in metadata
            const chunks = await documentProcessorService.processFileBuffer(buffer, fileName, {
                source: 'user-upload',
                userId,
                documentId,
                fileName,
                fileType: fileExtension,
                ...metadata
            });

            // Ingest chunks
            await this.ingestChunks(chunks);

            const duration = Date.now() - startTime;

            loggingService.info('File buffer ingested successfully', {
                component: 'IngestionService',
                operation: 'ingestFileBuffer',
                fileName,
                userId,
                documentId,
                chunksCreated: chunks.length,
                duration
            });

            return {
                success: true,
                documentsIngested: chunks.length,
                documentId,
                errors: [],
                duration
            };
        } catch (error) {
            const duration = Date.now() - startTime;
            loggingService.error('File buffer ingestion failed', {
                component: 'IngestionService',
                operation: 'ingestFileBuffer',
                fileName,
                userId,
                error: error instanceof Error ? error.message : String(error)
            });

            return {
                success: false,
                documentsIngested: 0,
                errors: [error instanceof Error ? error.message : String(error)],
                duration
            };
        }
    }

    /**
     * Delete user document
     */
    async deleteDocument(documentId: string, userId: string): Promise<boolean> {
        try {
            // Verify ownership
            const doc = await DocumentModel.findOne({
                _id: documentId,
                'metadata.userId': userId
            });

            if (!doc) {
                throw new Error('Document not found or access denied');
            }

            // Soft delete
            doc.status = 'deleted';
            await doc.save();

            loggingService.info('Document deleted successfully', {
                component: 'IngestionService',
                operation: 'deleteDocument',
                documentId,
                userId
            });

            return true;
        } catch (error) {
            loggingService.error('Failed to delete document', {
                component: 'IngestionService',
                operation: 'deleteDocument',
                documentId,
                userId,
                error: error instanceof Error ? error.message : String(error)
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

        const items = fs.readdirSync(dirPath);

        for (const item of items) {
            const fullPath = path.join(dirPath, item);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                files.push(...this.getAllFiles(fullPath, extensions));
            } else if (extensions.some(ext => item.endsWith(ext))) {
                files.push(fullPath);
            }
        }

        return files;
    }

    /**
     * Create a new job
     */
    private createJob(type: IngestionJob['type']): string {
        const jobId = `${type}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const job: IngestionJob = {
            id: jobId,
            type,
            status: 'pending',
            progress: 0,
            totalItems: 0,
            processedItems: 0,
            errors: []
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
     * Get ingestion statistics
     */
    async getStats(userId?: string): Promise<any> {
        try {
            const query: any = { status: 'active' };
            if (userId) {
                query['metadata.userId'] = userId;
            }

            const totalDocuments = await DocumentModel.countDocuments(query);
            const bySource = await DocumentModel.aggregate([
                { $match: query },
                { $group: { _id: '$metadata.source', count: { $sum: 1 } } }
            ]);

            const byUser = userId ? null : await DocumentModel.aggregate([
                { $match: { status: 'active', 'metadata.userId': { $exists: true } } },
                { $group: { _id: '$metadata.userId', count: { $sum: 1 } } },
                { $limit: 10 }
            ]);

            return {
                totalDocuments,
                bySource: bySource.reduce((acc, item) => {
                    acc[item._id] = item.count;
                    return acc;
                }, {} as Record<string, number>),
                topUsers: byUser
            };
        } catch (error) {
            loggingService.error('Failed to get ingestion stats', {
                component: 'IngestionService',
                operation: 'getStats',
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
}

// Singleton instance
export const ingestionService = new IngestionService();

