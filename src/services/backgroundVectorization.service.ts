import { loggingService } from './logging.service';
import { SafeBedrockEmbeddings, createSafeBedrockEmbeddings } from './safeBedrockEmbeddings';
import { UserMemory, ConversationMemory } from '../models/Memory';
import { Message } from '../models/Message';
import { redisService } from './redis.service';

export interface ProcessingStats {
    processed: number;
    success: number;
    failed: number;
    startTime: Date;
    endTime?: Date;
    duration?: number;
    errors: string[];
}

export interface HealthStats {
    embeddingService: 'healthy' | 'degraded' | 'error';
    vectorIndexes: 'optimal' | 'suboptimal' | 'error';
    storageUsage: {
        current: string;
        projected: string;
        userMemories: { total: number; vectorized: number; percentage: number };
        conversations: { total: number; vectorized: number; percentage: number };
        messages: { total: number; vectorized: number; percentage: number };
    };
    lastProcessing: {
        userMemories?: Date;
        conversations?: Date;
        messages?: Date;
    };
    currentlyProcessing: boolean;
}

export interface TimeEstimate {
    userMemories: { total: number; estimated: number };
    conversations: { total: number; estimated: number };
    messages: { total: number; estimated: number };
    totalEstimated: number;
}

/**
 * Background Vectorization Service
 * Handles automated vectorization of UserMemory, ConversationMemory, and high-value Messages
 * Runs independently via cron jobs without blocking user-facing APIs
 */
export class BackgroundVectorizationService {
    private static instance: BackgroundVectorizationService;
    private embeddings: SafeBedrockEmbeddings;
    private readonly BATCH_SIZE = 25;
    private readonly MAX_CONTENT_LENGTH = 8192;
    private readonly EMBEDDING_CACHE_TTL = 24 * 60 * 60; // 24 hours
    private readonly PROCESSING_LOCK_TTL = 60 * 60; // 1 hour
    
    private constructor() {
        this.embeddings = createSafeBedrockEmbeddings({
            model: 'amazon.titan-embed-text-v2:0'
        });
    }

    static getInstance(): BackgroundVectorizationService {
        if (!BackgroundVectorizationService.instance) {
            BackgroundVectorizationService.instance = new BackgroundVectorizationService();
        }
        return BackgroundVectorizationService.instance;
    }

    /**
     * Vectorize UserMemory records that haven't been processed
     */
    async vectorizeUserMemories(): Promise<ProcessingStats> {
        const lockKey = 'vectorization:lock:user_memories';
        const isLocked = await this.acquireProcessingLock(lockKey);
        
        if (!isLocked) {
            loggingService.warn('UserMemory vectorization already in progress, skipping');
            throw new Error('UserMemory vectorization already in progress');
        }

        const stats: ProcessingStats = {
            processed: 0,
            success: 0,
            failed: 0,
            startTime: new Date(),
            errors: []
        };

        try {
            loggingService.info('🧠 Starting UserMemory vectorization');
            
            // Find records that need vectorization
            const query = {
                isActive: true,
                $or: [
                    { semanticEmbedding: { $exists: false } },
                    { semanticEmbedding: { $size: 0 } },
                    { vectorizedAt: { $exists: false } }
                ]
            };

            const totalRecords = await UserMemory.countDocuments(query);
            loggingService.info(`📊 Found ${totalRecords} UserMemory records to vectorize`);

            let offset = 0;
            while (offset < totalRecords) {
                const batch = await UserMemory.find(query)
                    .skip(offset)
                    .limit(this.BATCH_SIZE)
                    .lean();

                if (batch.length === 0) break;

                const batchStats = await this.processBatchUserMemories(batch);
                stats.processed += batchStats.processed;
                stats.success += batchStats.success;
                stats.failed += batchStats.failed;
                stats.errors.push(...batchStats.errors);

                offset += this.BATCH_SIZE;
                
                // Brief pause to prevent overwhelming the system
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            stats.endTime = new Date();
            stats.duration = stats.endTime.getTime() - stats.startTime.getTime();
            
            await this.updateLastProcessingTime('userMemories');
            
            loggingService.info('✅ UserMemory vectorization completed', {
                processed: stats.processed,
                success: stats.success,
                failed: stats.failed,
                duration: stats.duration
            });

            return stats;
        } catch (error) {
            stats.endTime = new Date();
            stats.duration = stats.endTime.getTime() - stats.startTime.getTime();
            stats.errors.push(error instanceof Error ? error.message : String(error));
            
            loggingService.error('❌ UserMemory vectorization failed:', {
                error: error instanceof Error ? error.message : String(error),
                stats
            });
            
            throw error;
        } finally {
            await this.releaseProcessingLock(lockKey);
        }
    }

    /**
     * Vectorize ConversationMemory records
     */
    async vectorizeConversationMemories(): Promise<ProcessingStats> {
        const lockKey = 'vectorization:lock:conversations';
        const isLocked = await this.acquireProcessingLock(lockKey);
        
        if (!isLocked) {
            loggingService.warn('ConversationMemory vectorization already in progress, skipping');
            throw new Error('ConversationMemory vectorization already in progress');
        }

        const stats: ProcessingStats = {
            processed: 0,
            success: 0,
            failed: 0,
            startTime: new Date(),
            errors: []
        };

        try {
            loggingService.info('💬 Starting ConversationMemory vectorization');
            
            // Find records that need vectorization (enhance existing queryEmbedding, add responseEmbedding)
            const query = {
                isArchived: false,
                $or: [
                    { queryEmbedding: { $exists: false } },
                    { queryEmbedding: { $size: 0 } },
                    { responseEmbedding: { $exists: false } },
                    { responseEmbedding: { $size: 0 } },
                    { vectorizedAt: { $exists: false } }
                ]
            };

            const totalRecords = await ConversationMemory.countDocuments(query);
            loggingService.info(`📊 Found ${totalRecords} ConversationMemory records to vectorize`);

            let offset = 0;
            while (offset < totalRecords) {
                const batch = await ConversationMemory.find(query)
                    .skip(offset)
                    .limit(this.BATCH_SIZE)
                    .lean();

                if (batch.length === 0) break;

                const batchStats = await this.processBatchConversations(batch);
                stats.processed += batchStats.processed;
                stats.success += batchStats.success;
                stats.failed += batchStats.failed;
                stats.errors.push(...batchStats.errors);

                offset += this.BATCH_SIZE;
                
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            stats.endTime = new Date();
            stats.duration = stats.endTime.getTime() - stats.startTime.getTime();
            
            await this.updateLastProcessingTime('conversations');
            
            loggingService.info('✅ ConversationMemory vectorization completed', {
                processed: stats.processed,
                success: stats.success,
                failed: stats.failed,
                duration: stats.duration
            });

            return stats;
        } catch (error) {
            stats.endTime = new Date();
            stats.duration = stats.endTime.getTime() - stats.startTime.getTime();
            stats.errors.push(error instanceof Error ? error.message : String(error));
            
            loggingService.error('❌ ConversationMemory vectorization failed:', {
                error: error instanceof Error ? error.message : String(error),
                stats
            });
            
            throw error;
        } finally {
            await this.releaseProcessingLock(lockKey);
        }
    }

    /**
     * Vectorize high-value Messages (will integrate with SmartSamplingService)
     */
    async vectorizeHighValueMessages(): Promise<ProcessingStats> {
        const lockKey = 'vectorization:lock:messages';
        const isLocked = await this.acquireProcessingLock(lockKey);
        
        if (!isLocked) {
            loggingService.warn('Message vectorization already in progress, skipping');
            throw new Error('Message vectorization already in progress');
        }

        const stats: ProcessingStats = {
            processed: 0,
            success: 0,
            failed: 0,
            startTime: new Date(),
            errors: []
        };

        try {
            loggingService.info('📨 Starting high-value Message vectorization');
            
            // For now, find messages that have been marked for vectorization but not processed
            // This will be enhanced when SmartSamplingService is implemented
            const query = {
                learningValue: { $gt: 0.5 }, // High learning value
                isVectorized: false,
                fullContentStored: true
            };

            const totalRecords = await Message.countDocuments(query);
            loggingService.info(`📊 Found ${totalRecords} high-value Messages to vectorize`);

            let offset = 0;
            while (offset < totalRecords) {
                const batch = await Message.find(query)
                    .skip(offset)
                    .limit(this.BATCH_SIZE)
                    .lean();

                if (batch.length === 0) break;

                const batchStats = await this.processBatchMessages(batch);
                stats.processed += batchStats.processed;
                stats.success += batchStats.success;
                stats.failed += batchStats.failed;
                stats.errors.push(...batchStats.errors);

                offset += this.BATCH_SIZE;
                
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            stats.endTime = new Date();
            stats.duration = stats.endTime.getTime() - stats.startTime.getTime();
            
            await this.updateLastProcessingTime('messages');
            
            loggingService.info('✅ Message vectorization completed', {
                processed: stats.processed,
                success: stats.success,
                failed: stats.failed,
                duration: stats.duration
            });

            return stats;
        } catch (error) {
            stats.endTime = new Date();
            stats.duration = stats.endTime.getTime() - stats.startTime.getTime();
            stats.errors.push(error instanceof Error ? error.message : String(error));
            
            loggingService.error('❌ Message vectorization failed:', {
                error: error instanceof Error ? error.message : String(error),
                stats
            });
            
            throw error;
        } finally {
            await this.releaseProcessingLock(lockKey);
        }
    }

    /**
     * Get comprehensive health statistics
     */
    async getVectorizationHealth(): Promise<HealthStats> {
        try {
            // Check embedding service health
            let embeddingHealth: 'healthy' | 'degraded' | 'error' = 'healthy';
            try {
                await this.embeddings.embedQuery('health check');
            } catch (error) {
                embeddingHealth = 'error';
                loggingService.warn('Embedding service health check failed:', {
                    error: error instanceof Error ? error.message : String(error)
                });
            }

            // Get storage statistics
            const [
                totalUserMemories,
                vectorizedUserMemories,
                totalConversations,
                vectorizedConversations,
                totalMessages,
                vectorizedMessages
            ] = await Promise.all([
                UserMemory.countDocuments({}),
                UserMemory.countDocuments({ semanticEmbedding: { $exists: true, $ne: [] } }),
                ConversationMemory.countDocuments({}),
                ConversationMemory.countDocuments({ 
                    $or: [
                        { queryEmbedding: { $exists: true, $ne: [] } },
                        { responseEmbedding: { $exists: true, $ne: [] } }
                    ]
                }),
                Message.countDocuments({}),
                Message.countDocuments({ isVectorized: true })
            ]);

            // Get last processing times
            const lastProcessing = {
                userMemories: await this.getLastProcessingTime('userMemories'),
                conversations: await this.getLastProcessingTime('conversations'),
                messages: await this.getLastProcessingTime('messages')
            };

            // Check if currently processing
            const currentlyProcessing = await this.isCurrentlyProcessing();

            // Calculate storage usage (rough estimates)
            const vectorizedCount = vectorizedUserMemories + vectorizedConversations + vectorizedMessages;
            const currentStorageMB = Math.round((vectorizedCount * 4) / 1024); // 4KB per vector
            const totalPossible = totalUserMemories + totalConversations + (totalMessages * 0.1); // 10% of messages
            const projectedStorageMB = Math.round((totalPossible * 4) / 1024);

            // Check vector index health by verifying if vectorized data exists and structure is correct
            const vectorIndexHealth = await this.checkVectorIndexHealth();

            return {
                embeddingService: embeddingHealth,
                vectorIndexes: vectorIndexHealth,
                storageUsage: {
                    current: `${currentStorageMB} MB`,
                    projected: `${projectedStorageMB} MB`,
                    userMemories: {
                        total: totalUserMemories,
                        vectorized: vectorizedUserMemories,
                        percentage: totalUserMemories > 0 ? Math.round((vectorizedUserMemories / totalUserMemories) * 100) : 0
                    },
                    conversations: {
                        total: totalConversations,
                        vectorized: vectorizedConversations,
                        percentage: totalConversations > 0 ? Math.round((vectorizedConversations / totalConversations) * 100) : 0
                    },
                    messages: {
                        total: totalMessages,
                        vectorized: vectorizedMessages,
                        percentage: totalMessages > 0 ? Math.round((vectorizedMessages / totalMessages) * 100) : 0
                    }
                },
                lastProcessing,
                currentlyProcessing
            };
        } catch (error) {
            loggingService.error('Failed to get vectorization health:', {
                error: error instanceof Error ? error.message : String(error)
            });
            
            return {
                embeddingService: 'error',
                vectorIndexes: 'error',
                storageUsage: {
                    current: 'unknown',
                    projected: 'unknown',
                    userMemories: { total: 0, vectorized: 0, percentage: 0 },
                    conversations: { total: 0, vectorized: 0, percentage: 0 },
                    messages: { total: 0, vectorized: 0, percentage: 0 }
                },
                lastProcessing: {},
                currentlyProcessing: false
            };
        }
    }

    /**
     * Estimate processing time for pending vectorization
     */
    async estimateProcessingTime(): Promise<TimeEstimate> {
        try {
            const [pendingUserMemories, pendingConversations, pendingMessages] = await Promise.all([
                UserMemory.countDocuments({
                    isActive: true,
                    $or: [
                        { semanticEmbedding: { $exists: false } },
                        { semanticEmbedding: { $size: 0 } }
                    ]
                }),
                ConversationMemory.countDocuments({
                    isArchived: false,
                    $or: [
                        { queryEmbedding: { $exists: false } },
                        { queryEmbedding: { $size: 0 } },
                        { responseEmbedding: { $exists: false } },
                        { responseEmbedding: { $size: 0 } }
                    ]
                }),
                Message.countDocuments({
                    learningValue: { $gt: 0.5 },
                    isVectorized: false,
                    fullContentStored: true
                })
            ]);

            // Estimate processing time (rough calculations based on batch processing)
            const batchProcessingTime = 2; // seconds per batch
            const userMemoryTime = Math.ceil(pendingUserMemories / this.BATCH_SIZE) * batchProcessingTime;
            const conversationTime = Math.ceil(pendingConversations / this.BATCH_SIZE) * batchProcessingTime;
            const messageTime = Math.ceil(pendingMessages / this.BATCH_SIZE) * batchProcessingTime;

            return {
                userMemories: {
                    total: pendingUserMemories,
                    estimated: userMemoryTime
                },
                conversations: {
                    total: pendingConversations,
                    estimated: conversationTime
                },
                messages: {
                    total: pendingMessages,
                    estimated: messageTime
                },
                totalEstimated: userMemoryTime + conversationTime + messageTime
            };
        } catch (error) {
            loggingService.error('Failed to estimate processing time:', {
                error: error instanceof Error ? error.message : String(error)
            });
            
            return {
                userMemories: { total: 0, estimated: 0 },
                conversations: { total: 0, estimated: 0 },
                messages: { total: 0, estimated: 0 },
                totalEstimated: 0
            };
        }
    }

    /**
     * Process a batch of UserMemory records
     */
    private async processBatchUserMemories(batch: any[]): Promise<ProcessingStats> {
        const stats: ProcessingStats = {
            processed: batch.length,
            success: 0,
            failed: 0,
            startTime: new Date(),
            errors: []
        };

        try {
            // Generate embeddings for the batch
            const contents = batch.map(record => this.prepareContentForEmbedding(record.content));
            const embeddings = await this.generateBatchEmbeddings(contents);

            // Update records with embeddings
            const bulkOps = batch.map((record, index) => ({
                updateOne: {
                    filter: { _id: record._id },
                    update: {
                        $set: {
                            semanticEmbedding: embeddings[index],
                            vectorizedAt: new Date(),
                            semanticContent: contents[index]
                        }
                    }
                }
            }));

            const result = await UserMemory.bulkWrite(bulkOps);
            stats.success = result.modifiedCount;
            stats.failed = batch.length - result.modifiedCount;

        } catch (error) {
            stats.failed = batch.length;
            stats.errors.push(error instanceof Error ? error.message : String(error));
            loggingService.error('Batch processing failed for UserMemories:', {
                error: error instanceof Error ? error.message : String(error),
                batchSize: batch.length
            });
        }

        stats.endTime = new Date();
        stats.duration = stats.endTime.getTime() - stats.startTime.getTime();
        return stats;
    }

    /**
     * Process a batch of ConversationMemory records
     */
    private async processBatchConversations(batch: any[]): Promise<ProcessingStats> {
        const stats: ProcessingStats = {
            processed: batch.length,
            success: 0,
            failed: 0,
            startTime: new Date(),
            errors: []
        };

        try {
            // Prepare content for embedding (queries and responses)
            const queries = batch.map(record => this.prepareContentForEmbedding(record.query));
            const responses = batch.map(record => this.prepareContentForEmbedding(record.response));

            // Generate embeddings
            const [queryEmbeddings, responseEmbeddings] = await Promise.all([
                this.generateBatchEmbeddings(queries),
                this.generateBatchEmbeddings(responses)
            ]);

            // Update records with embeddings
            const bulkOps = batch.map((record, index) => ({
                updateOne: {
                    filter: { _id: record._id },
                    update: {
                        $set: {
                            queryEmbedding: queryEmbeddings[index],
                            responseEmbedding: responseEmbeddings[index],
                            vectorizedAt: new Date()
                        }
                    }
                }
            }));

            const result = await ConversationMemory.bulkWrite(bulkOps);
            stats.success = result.modifiedCount;
            stats.failed = batch.length - result.modifiedCount;

        } catch (error) {
            stats.failed = batch.length;
            stats.errors.push(error instanceof Error ? error.message : String(error));
            loggingService.error('Batch processing failed for ConversationMemories:', {
                error: error instanceof Error ? error.message : String(error),
                batchSize: batch.length
            });
        }

        stats.endTime = new Date();
        stats.duration = stats.endTime.getTime() - stats.startTime.getTime();
        return stats;
    }

    /**
     * Process a batch of Message records
     */
    private async processBatchMessages(batch: any[]): Promise<ProcessingStats> {
        const stats: ProcessingStats = {
            processed: batch.length,
            success: 0,
            failed: 0,
            startTime: new Date(),
            errors: []
        };

        try {
            // Prepare content for embedding (include attachment text if available)
            const contents = batch.map(record => {
                let content = this.prepareContentForEmbedding(record.contentPreview);
                
                // Add attachment text if available
                if (record.attachments && record.attachments.length > 0) {
                    const attachmentTexts = record.attachments
                        .filter((att: any) => att.extractedText)
                        .map((att: any) => att.extractedText)
                        .join(' ');
                    
                    if (attachmentTexts) {
                        content += ' ' + this.prepareContentForEmbedding(attachmentTexts);
                    }
                }
                
                return content;
            });

            const embeddings = await this.generateBatchEmbeddings(contents);

            // Update records with embeddings
            const bulkOps = batch.map((record, index) => ({
                updateOne: {
                    filter: { _id: record._id },
                    update: {
                        $set: {
                            semanticEmbedding: embeddings[index],
                            isVectorized: true
                        }
                    }
                }
            }));

            const result = await Message.bulkWrite(bulkOps);
            stats.success = result.modifiedCount;
            stats.failed = batch.length - result.modifiedCount;

        } catch (error) {
            stats.failed = batch.length;
            stats.errors.push(error instanceof Error ? error.message : String(error));
            loggingService.error('Batch processing failed for Messages:', {
                error: error instanceof Error ? error.message : String(error),
                batchSize: batch.length
            });
        }

        stats.endTime = new Date();
        stats.duration = stats.endTime.getTime() - stats.startTime.getTime();
        return stats;
    }

    /**
     * Generate embeddings for a batch of content
     */
    private async generateBatchEmbeddings(contents: string[]): Promise<number[][]> {
        try {
            // Filter out empty strings to prevent AWS Bedrock validation errors
            const validContents = contents.filter(c => c && c.trim().length > 0);
            
            if (validContents.length === 0) {
                loggingService.warn('No valid content to embed in batch, returning empty embeddings');
                return contents.map(() => []);
            }

            // Generate embeddings for valid content
            const embeddings = await this.embeddings.embedDocuments(validContents);
            
            // Map embeddings back to original content array (empty strings get empty embeddings)
            let embeddingIndex = 0;
            return contents.map(content => {
                if (content && content.trim().length > 0) {
                    return embeddings[embeddingIndex++];
                }
                return [];
            });
        } catch (error) {
            loggingService.error('Failed to generate batch embeddings:', {
                error: error instanceof Error ? error.message : String(error),
                batchSize: contents.length
            });
            
            // Return empty embeddings as fallback
            return contents.map(() => []);
        }
    }

    /**
     * Prepare content for embedding (truncate, clean)
     */
    private prepareContentForEmbedding(content: string): string {
        if (!content) return '';
        
        // Clean and truncate content
        const cleaned = content.trim().replace(/\s+/g, ' ');
        
        if (cleaned.length > this.MAX_CONTENT_LENGTH) {
            return cleaned.substring(0, this.MAX_CONTENT_LENGTH);
        }
        
        return cleaned;
    }

    /**
     * Acquire processing lock to prevent concurrent processing
     */
    private async acquireProcessingLock(lockKey: string): Promise<boolean> {
        try {
            // Check if lock already exists
            const exists = await redisService.exists(lockKey);
            if (exists) {
                return false;
            }
            
            // Set lock with TTL
            await redisService.set(lockKey, '1', this.PROCESSING_LOCK_TTL);
            return true;
        } catch (error) {
            loggingService.error('Failed to acquire processing lock:', {
                error: error instanceof Error ? error.message : String(error),
                lockKey
            });
            return false;
        }
    }

    /**
     * Release processing lock
     */
    private async releaseProcessingLock(lockKey: string): Promise<void> {
        try {
            await redisService.del(lockKey);
        } catch (error) {
            loggingService.error('Failed to release processing lock:', {
                error: error instanceof Error ? error.message : String(error),
                lockKey
            });
        }
    }

    /**
     * Update last processing time for a data type
     */
    private async updateLastProcessingTime(dataType: string): Promise<void> {
        try {
            const key = `vectorization:last_processing:${dataType}`;
            await redisService.set(key, new Date().toISOString(), this.EMBEDDING_CACHE_TTL);
        } catch (error) {
            loggingService.error('Failed to update last processing time:', {
                error: error instanceof Error ? error.message : String(error),
                dataType
            });
        }
    }

    /**
     * Get last processing time for a data type
     */
    private async getLastProcessingTime(dataType: string): Promise<Date | undefined> {
        try {
            const key = `vectorization:last_processing:${dataType}`;
            const result = await redisService.get(key);
            if (result && typeof result === 'string') {
                return new Date(result);
            }
            return undefined;
        } catch (error) {
            loggingService.error('Failed to get last processing time:', {
                error: error instanceof Error ? error.message : String(error),
                dataType
            });
            return undefined;
        }
    }

    /**
     * Check vector index health by verifying data structure and sample queries
     */
    private async checkVectorIndexHealth(): Promise<'optimal' | 'suboptimal' | 'error'> {
        try {
            // Check if we have vectorized data in each collection
            const [userMemorySample, conversationSample, messageSample] = await Promise.all([
                UserMemory.findOne({ semanticEmbedding: { $exists: true, $ne: [] } }).lean(),
                ConversationMemory.findOne({ 
                    $or: [
                        { queryEmbedding: { $exists: true, $ne: [] } },
                        { responseEmbedding: { $exists: true, $ne: [] } }
                    ]
                }).lean(),
                Message.findOne({ isVectorized: true, semanticEmbedding: { $exists: true, $ne: [] } }).lean()
            ]);

            // Verify embedding dimensions match expected (1024 for Titan v2)
            const issues: string[] = [];
            
            if (userMemorySample) {
                const embedding = userMemorySample.semanticEmbedding;
                if (Array.isArray(embedding) && embedding.length !== 1024) {
                    issues.push(`UserMemory embedding dimension mismatch: expected 1024, got ${embedding.length}`);
                }
            }

            if (conversationSample) {
                const queryEmbedding = conversationSample.queryEmbedding;
                const responseEmbedding = conversationSample.responseEmbedding;
                
                if (Array.isArray(queryEmbedding) && queryEmbedding.length !== 1024) {
                    issues.push(`ConversationMemory queryEmbedding dimension mismatch: expected 1024, got ${queryEmbedding.length}`);
                }
                if (Array.isArray(responseEmbedding) && responseEmbedding.length !== 1024) {
                    issues.push(`ConversationMemory responseEmbedding dimension mismatch: expected 1024, got ${responseEmbedding.length}`);
                }
            }

            if (messageSample) {
                const embedding = messageSample.semanticEmbedding;
                if (Array.isArray(embedding) && embedding.length !== 1024) {
                    issues.push(`Message embedding dimension mismatch: expected 1024, got ${embedding.length}`);
                }
            }

            // Check if we have vectorized data but no samples found (potential index issue)
            const [hasVectorizedUserMemories, hasVectorizedConversations, hasVectorizedMessages] = await Promise.all([
                UserMemory.countDocuments({ semanticEmbedding: { $exists: true, $ne: [] } }),
                ConversationMemory.countDocuments({ 
                    $or: [
                        { queryEmbedding: { $exists: true, $ne: [] } },
                        { responseEmbedding: { $exists: true, $ne: [] } }
                    ]
                }),
                Message.countDocuments({ isVectorized: true, semanticEmbedding: { $exists: true, $ne: [] } })
            ]);

            if ((hasVectorizedUserMemories > 0 && !userMemorySample) ||
                (hasVectorizedConversations > 0 && !conversationSample) ||
                (hasVectorizedMessages > 0 && !messageSample)) {
                issues.push('Vectorized data exists but samples cannot be retrieved - potential index corruption');
            }

            if (issues.length > 0) {
                loggingService.warn('Vector index health issues detected:', { issues });
                return issues.length > 2 ? 'error' : 'suboptimal';
            }

            return 'optimal';
        } catch (error) {
            loggingService.error('Failed to check vector index health:', {
                error: error instanceof Error ? error.message : String(error)
            });
            return 'error';
        }
    }

    /**
     * Check if any vectorization is currently processing
     */
    private async isCurrentlyProcessing(): Promise<boolean> {
        try {
            const locks = [
                'vectorization:lock:user_memories',
                'vectorization:lock:conversations',
                'vectorization:lock:messages'
            ];
            
            const results = await Promise.all(
                locks.map(lock => redisService.exists(lock))
            );
            
            return results.some(exists => exists === true);
        } catch (error) {
            loggingService.error('Failed to check processing status:', {
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }
}

// Export singleton instance
export const backgroundVectorizationService = BackgroundVectorizationService.getInstance();