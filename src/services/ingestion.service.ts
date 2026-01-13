import { DocumentModel } from '../models/Document';
import { documentProcessorService, ProcessedDocument } from './documentProcessor.service';
import { SafeBedrockEmbeddings, createSafeBedrockEmbeddings } from './safeBedrockEmbeddings';
import { MongoDBVectorStore } from './langchainVectorStore.service';
import { Document as LangchainDocument } from '@langchain/core/documents';
import { loggingService } from './logging.service';
import { Conversation } from '../models/Conversation';
import { ChatMessage } from '../models/ChatMessage';
import { ITelemetry, Telemetry } from '../models/Telemetry';
import { vectorStrategyService } from './vectorization/vectorStrategy.service';
import { VectorSource } from './vectorization/types';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

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
    stage: 'preparing' | 'extracting' | 'ocr' | 'chunking' | 'processing' | 'embedding' | 'storing' | 'complete' | 'error';
    progress: number;
    message: string;
    currentBatch?: number;
    totalBatches?: number;
    totalChunks?: number;
    processedChunks?: number;
    error?: string;
}

export class IngestionService {
    private embeddings: SafeBedrockEmbeddings;
    private vectorStore?: MongoDBVectorStore;
    private initialized = false;
    private activeJobs: Map<string, IngestionJob> = new Map();
    private progressEmitter: EventEmitter = new EventEmitter();

    constructor() {
        this.embeddings = createSafeBedrockEmbeddings();
    }

    /**
     * Subscribe to upload progress events
     */
    onProgress(uploadId: string, callback: (progress: UploadProgress) => void): void {
        this.progressEmitter.on(`progress:${uploadId}`, callback);
    }

    /**
     * Unsubscribe from upload progress events
     */
    offProgress(uploadId: string, callback: (progress: UploadProgress) => void): void {
        this.progressEmitter.off(`progress:${uploadId}`, callback);
    }

    /**
     * Emit progress update
     */
    emitProgress(progress: UploadProgress): void {
        this.progressEmitter.emit(`progress:${progress.uploadId}`, progress);
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

            // Initialize MongoDB Vector Store wrapper (optional)
            // This is only used for backward compatibility
            // New code should use vectorStrategyService
            if (!process.env.ENABLE_FAISS_PRIMARY) {
                this.vectorStore = new MongoDBVectorStore(this.embeddings);
            }

            // Initialize vector strategy service if FAISS features are enabled
            if (process.env.ENABLE_FAISS_DUAL_WRITE === 'true' || 
                process.env.ENABLE_FAISS_SHADOW_READ === 'true' || 
                process.env.ENABLE_FAISS_PRIMARY === 'true') {
                await vectorStrategyService.initialize();
            }
            if (process.env.USE_LANGCHAIN_VECTORSTORE === 'true') {
                this.vectorStore = new MongoDBVectorStore(this.embeddings, {
                    indexName: process.env.MONGODB_VECTOR_INDEX_NAME || 'document_vector_index'
                });
                loggingService.info('✅ MongoDB VectorStore wrapper initialized', {
                    component: 'IngestionService',
                    operation: 'initialize'
                });
            }

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
    async ingestKnowledgeBase(force: boolean = false): Promise<IngestionResult> {
        const startTime = Date.now();
        const jobId = this.createJob('knowledge-base');
        const errors: string[] = [];
        let documentsIngested = 0;

        try {
            // Quick check: Skip if knowledge base already populated (unless forced)
            if (!force) {
                const existingCount = await DocumentModel.countDocuments({
                    'metadata.source': 'knowledge-base'
                });
                
                if (existingCount > 0) {
                    loggingService.info('✅ Knowledge base already populated, skipping ingestion', {
                        component: 'IngestionService',
                        operation: 'ingestKnowledgeBase',
                        existingDocuments: existingCount
                    });
                    
                    this.updateJob(jobId, {
                        status: 'completed',
                        completedAt: new Date(),
                        processedItems: 0
                    });
                    
                    return {
                        success: true,
                        documentsIngested: 0,
                        errors: [],
                        duration: Date.now() - startTime
                    };
                }
            }

            loggingService.info('Starting knowledge base ingestion', {
                component: 'IngestionService',
                operation: 'ingestKnowledgeBase',
                jobId,
                forced: force
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
     * Ingest chunks using LangChain VectorStore wrapper
     */
    private async ingestChunksWithLangChain(
        chunks: ProcessedDocument[],
        uploadId?: string,
        userId?: string
    ): Promise<void> {
        if (!this.vectorStore) {
            throw new Error('VectorStore not initialized');
        }

        try {
            const totalChunks = chunks.length;
            
            // Emit initial progress
            if (uploadId) {
                this.emitProgress({
                    uploadId,
                    stage: 'processing',
                    progress: 35,
                    message: `Processing ${totalChunks} chunks using LangChain`,
                    totalChunks,
                    processedChunks: 0
                });
            }

            // Convert ProcessedDocument to LangChain Document format
            // Filter out empty chunks to prevent embedding validation errors
            const validChunks = chunks.filter(chunk => 
                chunk.content && chunk.content.trim().length > 0
            );

            if (validChunks.length === 0) {
                loggingService.warn('No valid chunks to ingest (all chunks were empty)', {
                    component: 'IngestionService',
                    operation: 'ingestChunksWithLangChain',
                    totalChunks: chunks.length,
                    userId
                });
                return;
            }

            const langchainDocs = validChunks.map(chunk => new LangchainDocument({
                pageContent: chunk.content.trim(),
                metadata: {
                    ...chunk.metadata,
                    chunkIndex: chunk.chunkIndex,
                    totalChunks: chunk.totalChunks,
                    contentHash: chunk.contentHash
                }
            }));

            // Add documents to vector store
            await this.vectorStore.addDocuments(langchainDocs, {
                userId,
                projectId: validChunks[0]?.metadata?.projectId,
                documentId: validChunks[0]?.metadata?.documentId
            });

            // Emit completion progress
            if (uploadId) {
                this.emitProgress({
                    uploadId,
                    stage: 'complete',
                    progress: 100,
                    message: `Successfully processed ${totalChunks} chunks`,
                    totalChunks,
                    processedChunks: totalChunks
                });
            }

            loggingService.info('Chunks ingested with LangChain VectorStore', {
                component: 'IngestionService',
                operation: 'ingestChunksWithLangChain',
                totalChunks,
                userId
            });
        } catch (error) {
            if (uploadId) {
                this.emitProgress({
                    uploadId,
                    stage: 'error',
                    progress: 0,
                    message: 'Failed to ingest chunks: ' + (error instanceof Error ? error.message : 'Unknown error'),
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
            throw error;
        }
    }

    /**
     * Ingest custom document chunks with rate limiting
     */
    private async ingestChunks(chunks: ProcessedDocument[], uploadId?: string): Promise<void> {
        const BATCH_SIZE = 10; // Process 10 chunks at a time (increased from 5)
        const DELAY_MS = 200; // 200ms delay between batches (reduced from 1000ms)
        
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
                    processedChunks: 0
                });
            }

            for (let i = 0; i < totalBatches; i++) {
                const batchStart = i * BATCH_SIZE;
                const batchEnd = Math.min((i + 1) * BATCH_SIZE, chunks.length);
                const batchChunks = chunks.slice(batchStart, batchEnd);
                
                // Emit batch start progress (40-100% range, embedding phase takes 40-70%)
                if (uploadId) {
                    const progressPercentage = 40 + Math.round(((i) / totalBatches) * 30);
                    this.emitProgress({
                        uploadId,
                        stage: 'embedding',
                        progress: progressPercentage,
                        message: `Generating embeddings for batch ${i + 1}/${totalBatches}`,
                        currentBatch: i + 1,
                        totalBatches,
                        totalChunks: chunks.length,
                        processedChunks: totalInserted
                    });
                }

                try {
                    // Generate embeddings for this batch with retry logic
                    // Filter out empty chunks to prevent AWS Bedrock validation errors
                    const validBatchChunks = batchChunks.filter(c => 
                        c.content && c.content.trim().length > 0
                    );

                    if (validBatchChunks.length === 0) {
                        loggingService.warn(`Batch ${i + 1}/${totalBatches} skipped - all chunks are empty`, {
                            component: 'IngestionService',
                            operation: 'ingestChunks',
                            batch: i + 1,
                            skippedChunks: batchChunks.length
                        });
                        continue;
                    }

                    const contents = validBatchChunks.map(c => c.content.trim());
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

                    // Create document records using validBatchChunks
                    const documents = validBatchChunks.map((chunk, index) => ({
                        content: chunk.content.trim(),
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

                        // FAISS Dual-Write: If enabled, also write to FAISS
                        if (process.env.ENABLE_FAISS_DUAL_WRITE === 'true') {
                            try {
                                // Convert to LangChain documents for FAISS
                                const langchainDocs = documents.map(doc => new LangchainDocument({
                                    pageContent: doc.content,
                                    metadata: {
                                        ...doc.metadata,
                                        documentId: (doc as any)._id?.toString(),
                                        chunkIndex: doc.chunkIndex,
                                        totalChunks: doc.totalChunks
                                    }
                                }));

                                // Determine source type for routing
                                const source = (validBatchChunks[0]?.metadata?.source || 'user-upload') as VectorSource;
                                const userId = validBatchChunks[0]?.metadata?.userId;
                                const projectId = validBatchChunks[0]?.metadata?.projectId;

                                // Add to vector strategy (will route to FAISS)
                                await vectorStrategyService.add(langchainDocs, {
                                    source,
                                    userId,
                                    projectId,
                                    documentId: validBatchChunks[0]?.metadata?.documentId
                                });

                                loggingService.info('FAISS dual-write completed', {
                                    component: 'IngestionService',
                                    operation: 'ingestChunks',
                                    batch: i + 1,
                                    documentCount: langchainDocs.length,
                                    source,
                                    userId
                                });
                            } catch (faissError) {
                                // Log FAISS error but don't fail the batch (MongoDB is source of truth)
                                loggingService.error('FAISS dual-write failed (non-blocking)', {
                                    component: 'IngestionService',
                                    operation: 'ingestChunks',
                                    batch: i + 1,
                                    error: faissError instanceof Error ? faissError.message : String(faissError)
                                });
                            }
                        }

                        loggingService.info(`Batch ${i + 1}/${totalBatches} ingested successfully`, {
                            component: 'IngestionService',
                            operation: 'ingestChunks',
                            batchSize: batchChunks.length,
                            inserted: result.length,
                            expectedSize: documents.length
                        });
                        
                        // Emit batch completion progress (70-100% range for storing phase)
                        if (uploadId) {
                            const progressPercentage = 70 + Math.round(((i + 1) / totalBatches) * 30);
                            this.emitProgress({
                                uploadId,
                                stage: 'storing',
                                progress: progressPercentage,
                                message: `Stored batch ${i + 1}/${totalBatches} (${progressPercentage}% complete)`,
                                currentBatch: i + 1,
                                totalBatches,
                                totalChunks: chunks.length,
                                processedChunks: totalInserted
                            });
                        }

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
                        // Handle duplicate key errors gracefully (code 11000)
                        if (insertError.code === 11000 || insertError.writeErrors) {
                            const successfulInserts = documents.length - (insertError.writeErrors?.length || 0);
                            totalInserted += successfulInserts;
                            
                            const duplicates = insertError.writeErrors?.filter((e: any) => e.code === 11000).length || 0;
                            
                            loggingService.info(`Batch ${i + 1}/${totalBatches} completed with duplicates skipped`, {
                                component: 'IngestionService',
                                operation: 'ingestChunks',
                                batchSize: batchChunks.length,
                                inserted: successfulInserts,
                                duplicates,
                                expectedSize: documents.length
                            });
                        } else {
                            // For non-duplicate errors, log and continue
                            loggingService.error(`Insert failed for batch ${i + 1}/${totalBatches}`, {
                                component: 'IngestionService',
                                operation: 'ingestChunks',
                                error: insertError.message,
                                code: insertError.code,
                                writeErrors: insertError.writeErrors?.length || 0
                            });
                        }
                    }

                    // Delay between batches to avoid throttling (except for last batch)
                    if (i < totalBatches - 1) {
                        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
                    }

                } catch (batchError: any) {
                    // Only log non-duplicate errors
                    if (batchError.code !== 11000 && !batchError.message?.includes('duplicate key')) {
                        loggingService.error(`Failed to ingest batch ${i + 1}/${totalBatches}`, {
                            component: 'IngestionService',
                            operation: 'ingestChunks',
                            error: batchError instanceof Error ? batchError.message : String(batchError),
                            batch: i + 1,
                            totalBatches
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
                                error: batchError.message || 'Unknown error'
                            });
                        }
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
                    processedChunks: totalInserted
                });
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
        metadata?: Partial<ProcessedDocument['metadata']>,
        uploadId?: string
    ): Promise<IngestionResult & { documentId?: string }> {
        const startTime = Date.now();

        try {
            // Use documentId from metadata if provided, otherwise generate a new one
            const documentId = metadata?.documentId || `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            // Emit initial progress - document preparation
            if (uploadId) {
                this.emitProgress({
                    uploadId,
                    stage: 'preparing',
                    progress: 0,
                    message: 'Preparing document for processing...',
                    totalChunks: 0,
                    processedChunks: 0
                });
            }
            
            // Get file type from fileName
            const fileExtension = fileName.split('.').pop()?.toLowerCase() || 'unknown';
            
            // Emit progress - extracting text
            if (uploadId) {
                this.emitProgress({
                    uploadId,
                    stage: 'extracting',
                    progress: 10,
                    message: 'Extracting text from document...',
                    totalChunks: 0,
                    processedChunks: 0
                });
            }
            
            // Process file buffer with documentId in metadata
            const chunks = await documentProcessorService.processFileBuffer(buffer, fileName, {
                source: 'user-upload',
                userId,
                documentId,
                fileName,
                fileType: fileExtension,
                ...metadata
            });

            // Emit progress - text extracted, starting chunking
            if (uploadId) {
                this.emitProgress({
                    uploadId,
                    stage: 'chunking',
                    progress: 30,
                    message: `Text extracted successfully. Creating ${chunks.length} chunks...`,
                    totalChunks: chunks.length,
                    processedChunks: 0
                });
            }

            // Ingest chunks with progress tracking
            if (this.vectorStore && process.env.USE_LANGCHAIN_VECTORSTORE === 'true') {
                // Use LangChain VectorStore wrapper
                await this.ingestChunksWithLangChain(chunks, uploadId, userId);
            } else {
                // Use original ingestion method
                await this.ingestChunks(chunks, uploadId);
            }

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
            
            if (uploadId) {
                this.emitProgress({
                    uploadId,
                    stage: 'error',
                    progress: 0,
                    message: 'Upload failed: ' + (error instanceof Error ? error.message : 'Unknown error')
                });
            }
            
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

