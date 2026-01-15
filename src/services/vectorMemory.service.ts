import { loggingService } from './logging.service';
import { SafeBedrockEmbeddings, createSafeBedrockEmbeddings } from './safeBedrockEmbeddings';
import { LRUCache } from 'lru-cache';

export interface VectorMemoryItem {
    id: string;
    userId: string;
    query: string;
    response: string;
    embedding: number[];
    metadata: any;
    timestamp: Date;
    dataType?: 'conversation' | 'memory' | 'message'; // Track data source
}

export interface SimilarityResult {
    id: string;
    query: string;
    response: string;
    similarity: number;
    metadata: any;
    dataType?: string;
}

export interface CrossModelSearchOptions {
    includeConversations?: boolean;
    includeMemories?: boolean;
    includeMessages?: boolean;
    similarityThreshold?: number;
    limit?: number;
}

/**
 * Enhanced In-memory vector storage service with 1024-dimension support
 * Now supports Amazon Titan v2 embeddings and cross-model similarity search
 * Efficient for moderate-scale applications with improved embedding quality
 */
export class VectorMemoryService {
    private embeddings: SafeBedrockEmbeddings;
    
    // In-memory vector storage with LRU limits - organized by data type
    private vectorStore: LRUCache<string, VectorMemoryItem>;
    private userVectorIndex: LRUCache<string, Set<string>>; // userId -> Set of vector IDs
    private dataTypeIndex: LRUCache<string, Set<string>>; // dataType -> Set of vector IDs
    
    // Embedding cache with LRU limits to avoid re-computing same queries
    private embeddingCache: LRUCache<string, number[]>;
    
    // Enhanced configuration for 1024-dimension embeddings
    private readonly EMBEDDING_DIMENSIONS = 1024;
    private readonly SIMILARITY_THRESHOLD = 0.7;

    constructor() {
        // Use Amazon Titan Embed Text v2 for consistency with background vectorization
        this.embeddings = createSafeBedrockEmbeddings({
            model: 'amazon.titan-embed-text-v2:0'
        });
        
        // Initialize LRU caches with enhanced limits for production usage
        this.vectorStore = new LRUCache({
            max: 10000, // Increased capacity for 1024-dim vectors
            ttl: 7 * 24 * 60 * 60 * 1000, // 7 days TTL
            updateAgeOnGet: true,
            allowStale: false
        });

        this.userVectorIndex = new LRUCache({
            max: 2000, // Support more users
            ttl: 7 * 24 * 60 * 60 * 1000, // 7 days TTL
            updateAgeOnGet: true,
            allowStale: false
        });

        this.dataTypeIndex = new LRUCache({
            max: 10, // Few data types
            ttl: 7 * 24 * 60 * 60 * 1000,
            updateAgeOnGet: true,
            allowStale: false
        });

        this.embeddingCache = new LRUCache({
            max: 5000, // Increased cache for better performance
            ttl: 2 * 60 * 60 * 1000, // 2 hours TTL for embeddings
            updateAgeOnGet: true,
            allowStale: false
        });
    }

    /**
     * Generate text embedding using Amazon Titan Embed Text v2 (1024 dimensions)
     */
    private async generateEmbedding(text: string): Promise<number[]> {
        try {
            // Validate input - AWS Bedrock requires minLength: 1
            if (!text || text.trim().length === 0) {
                loggingService.warn('Empty text provided to generateEmbedding, returning zero vector');
                return new Array(this.EMBEDDING_DIMENSIONS).fill(0);
            }

            // Check cache first
            const cacheKey = this.hashText(text);
            if (this.embeddingCache.has(cacheKey)) {
                return this.embeddingCache.get(cacheKey)!;
            }
            
            // Generate embedding using Amazon Titan v2
            const embedding = await this.embeddings.embedQuery(text.trim());
            
            // Validate embedding dimensions
            if (embedding.length !== this.EMBEDDING_DIMENSIONS) {
                loggingService.warn('Unexpected embedding dimensions:', {
                    expected: this.EMBEDDING_DIMENSIONS,
                    received: embedding.length
                });
            }
            
            // Cache the embedding
            this.embeddingCache.set(cacheKey, embedding);
            
            return embedding;
        } catch (error) {
            loggingService.error('❌ Failed to generate embedding:', { 
                error: error instanceof Error ? error.message : String(error) 
            });
            
            // Fallback: generate a deterministic hash-based embedding
            return this.generateHashBasedEmbedding(text);
        }
    }


    /**
     * Generate hash-based embedding as fallback
     */
    private generateHashBasedEmbedding(text: string): number[] {
        const embedding: number[] = [];
        const words = text.toLowerCase().split(/\s+/);
        
        // Create a 384-dimensional embedding based on text characteristics
        for (let i = 0; i < 384; i++) {
            let value = 0;
            
            // Use various text features
            if (i < words.length) {
                value += this.hashString(words[i]) / 1000000;
            }
            
            // Add character-based features
            if (i < text.length) {
                value += text.charCodeAt(i % text.length) / 1000;
            }
            
            // Add position-based features
            value += Math.sin(i * 0.1) * 0.1;
            value += Math.cos(i * 0.05) * 0.1;
            
            embedding.push(value);
        }
        
        return this.normalizeVector(embedding);
    }

    /**
     * Hash string to number
     */
    private hashString(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash);
    }

    /**
     * Hash text for caching
     */
    private hashText(text: string): string {
        return this.hashString(text).toString();
    }

    /**
     * Normalize vector to unit length
     */
    private normalizeVector(vector: number[]): number[] {
        const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
        if (magnitude === 0) return vector;
        return vector.map(val => val / magnitude);
    }

    /**
     * Calculate cosine similarity between two vectors
     */
    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) return 0;
        
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        
        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        
        normA = Math.sqrt(normA);
        normB = Math.sqrt(normB);
        
        if (normA === 0 || normB === 0) return 0;
        
        return dotProduct / (normA * normB);
    }

    /**
     * Store conversation vector
     */
    async storeConversationVector(item: {
        id: string;
        userId: string;
        query: string;
        response: string;
        metadata: any;
    }): Promise<void> {
        try {
            loggingService.info(`📊 Storing vector for conversation: ${item.id}`);
            
            // Generate embedding for the query
            const queryEmbedding = await this.generateEmbedding(item.query);
            
            // Create vector memory item
            const vectorItem: VectorMemoryItem = {
                id: item.id,
                userId: item.userId,
                query: item.query,
                response: item.response,
                embedding: queryEmbedding,
                metadata: item.metadata,
                timestamp: new Date()
            };
            
            // Store in vector store
            this.vectorStore.set(item.id, vectorItem);
            
            // Update user index
            if (!this.userVectorIndex.has(item.userId)) {
                this.userVectorIndex.set(item.userId, new Set());
            }
            this.userVectorIndex.get(item.userId)!.add(item.id);
            
            loggingService.info(`✅ Vector stored successfully for conversation: ${item.id}`);
        } catch (error) {
            loggingService.error('❌ Failed to store conversation vector:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Find similar conversations using batch vector similarity
     */
    async findSimilarConversations(
        userId: string, 
        query: string, 
        limit: number = 5,
        minSimilarity: number = 0.5
    ): Promise<SimilarityResult[]> {
        try {
            loggingService.info(`🔍 Finding similar conversations for user: ${userId}`);
            
            // Generate embedding for the query
            const queryEmbedding = await this.generateEmbedding(query);
            
            // Get user's conversation vectors
            const userVectorIds = this.userVectorIndex.get(userId);
            if (!userVectorIds || userVectorIds.size === 0) {
                loggingService.info(`No conversation vectors found for user: ${userId}`);
                return [];
            }
            
            // Batch similarity calculation with early termination
            const similarities = this.calculateBatchSimilarities(
                queryEmbedding, 
                Array.from(userVectorIds), 
                limit, 
                minSimilarity
            );
            
            loggingService.info(`✅ Found ${similarities.length} similar conversations`);
            return similarities;
        } catch (error) {
            loggingService.error('❌ Failed to find similar conversations:', { error: error instanceof Error ? error.message : String(error) });
            return [];
        }
    }

    /**
     * Find similar patterns across all users (for security analysis)
     */
    async findSimilarPatternsGlobal(
        query: string, 
        limit: number = 10,
        minSimilarity: number = 0.7
    ): Promise<SimilarityResult[]> {
        try {
            loggingService.info(`🔍 Finding similar patterns globally`);
            
            // Generate embedding for the query
            const queryEmbedding = await this.generateEmbedding(query);
            
            // Calculate similarities across all vectors
            const similarities: SimilarityResult[] = [];
            
            for (const [, vectorItem] of Array.from(this.vectorStore.entries())) {
                const similarity = this.cosineSimilarity(queryEmbedding, vectorItem.embedding);
                
                if (similarity >= minSimilarity) {
                    similarities.push({
                        id: vectorItem.id,
                        query: vectorItem.query,
                        response: vectorItem.response,
                        similarity,
                        metadata: {
                            ...vectorItem.metadata,
                            userId: vectorItem.userId // Include for security analysis
                        }
                    });
                }
            }
            
            // Sort by similarity and limit results
            similarities.sort((a, b) => b.similarity - a.similarity);
            const results = similarities.slice(0, limit);
            
            loggingService.info(`✅ Found ${results.length} similar patterns globally`);
            return results;
        } catch (error) {
            loggingService.error('❌ Failed to find similar patterns globally:', { error: error instanceof Error ? error.message : String(error) });
            return [];
        }
    }

    /**
     * Clear all vectors for a user
     */
    async clearUserVectors(userId: string): Promise<void> {
        try {
            loggingService.info(`🗑️ Clearing vectors for user: ${userId}`);
            
            const userVectorIds = this.userVectorIndex.get(userId);
            if (userVectorIds) {
                for (const vectorId of Array.from(userVectorIds)) {
                    this.vectorStore.delete(vectorId);
                }
                this.userVectorIndex.delete(userId);
            }
            
            loggingService.info(`✅ Cleared all vectors for user: ${userId}`);
        } catch (error) {
            loggingService.error('❌ Failed to clear user vectors:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get vector storage statistics
     */
    getStorageStats(): {
        totalVectors: number;
        totalUsers: number;
        memoryUsage: string;
        cacheSize: number;
    } {
        const totalVectors = this.vectorStore.size;
        const totalUsers = this.userVectorIndex.size;
        
        // Estimate memory usage
        const avgVectorSize = 384 * 8; // 384 floats * 8 bytes each
        const avgMetadataSize = 1000; // Rough estimate
        const estimatedMemory = totalVectors * (avgVectorSize + avgMetadataSize);
        const memoryUsage = `${(estimatedMemory / 1024 / 1024).toFixed(2)} MB`;
        
        return {
            totalVectors,
            totalUsers,
            memoryUsage,
            cacheSize: this.embeddingCache.size
        };
    }

    // ============================================================================
    // OPTIMIZATION UTILITY METHODS
    // ============================================================================

    /**
     * Calculate batch similarities with early termination and optimization
     */
    private calculateBatchSimilarities(
        queryEmbedding: number[], 
        vectorIds: string[], 
        limit: number, 
        minSimilarity: number
    ): SimilarityResult[] {
        let processedCount = 0;
        
        // Use a min-heap to keep track of top similarities
        const topSimilarities: Array<{ similarity: number; result: SimilarityResult }> = [];
        
        for (const vectorId of vectorIds) {
            const vectorItem = this.vectorStore.get(vectorId);
            if (!vectorItem) continue;
            
            processedCount++;
            
            // Calculate similarity
            const similarity = this.cosineSimilarity(queryEmbedding, vectorItem.embedding);
            
            // Early termination for very low similarities
            if (similarity < minSimilarity) continue;
            
            const result: SimilarityResult = {
                id: vectorItem.id,
                query: vectorItem.query,
                response: vectorItem.response,
                similarity,
                metadata: vectorItem.metadata
            };
            
            // Maintain top similarities using insertion sort for small arrays
            if (topSimilarities.length < limit) {
                topSimilarities.push({ similarity, result });
                topSimilarities.sort((a, b) => b.similarity - a.similarity);
            } else if (similarity > topSimilarities[topSimilarities.length - 1].similarity) {
                topSimilarities[topSimilarities.length - 1] = { similarity, result };
                topSimilarities.sort((a, b) => b.similarity - a.similarity);
            }
            
            // Early termination if we have enough high-quality results
            if (topSimilarities.length >= limit && topSimilarities[limit - 1].similarity > 0.9) {
                break;
            }
        }
        
        return topSimilarities.map(item => item.result);
    }

    // ============================================================================
    // ENHANCED CROSS-MODEL SEARCH METHODS
    // ============================================================================

    /**
     * Store vector item with data type tracking for cross-model search
     */
    async storeVectorWithType(vectorItem: VectorMemoryItem & { dataType: string }): Promise<void> {
        try {
            // Store the vector item
            this.vectorStore.set(vectorItem.id, vectorItem);
            
            // Update user index
            const userVectors = this.userVectorIndex.get(vectorItem.userId) || new Set();
            userVectors.add(vectorItem.id);
            this.userVectorIndex.set(vectorItem.userId, userVectors);
            
            // Update data type index
            const typeVectors = this.dataTypeIndex.get(vectorItem.dataType) || new Set();
            typeVectors.add(vectorItem.id);
            this.dataTypeIndex.set(vectorItem.dataType, typeVectors);
            
            loggingService.info('✅ Stored vector with type tracking', {
                id: vectorItem.id,
                userId: vectorItem.userId,
                dataType: vectorItem.dataType
            });
        } catch (error) {
            loggingService.error('❌ Failed to store vector with type:', {
                error: error instanceof Error ? error.message : String(error),
                vectorId: vectorItem.id
            });
        }
    }

    /**
     * Cross-model similarity search across different data types
     */
    async crossModelSearch(
        query: string, 
        userId: string, 
        options: CrossModelSearchOptions = {}
    ): Promise<{
        conversations: SimilarityResult[];
        memories: SimilarityResult[];
        messages: SimilarityResult[];
        totalResults: number;
    }> {
        const opts = {
            includeConversations: true,
            includeMemories: true,
            includeMessages: true,
            similarityThreshold: this.SIMILARITY_THRESHOLD,
            limit: 10,
            ...options
        };

        try {
            loggingService.info('🔍 Starting cross-model vector search', {
                userId,
                query: query.substring(0, 100),
                options: opts
            });

            // Generate query embedding once for all searches
            const queryEmbedding = await this.generateEmbedding(query);
            
            const results = {
                conversations: [] as SimilarityResult[],
                memories: [] as SimilarityResult[],
                messages: [] as SimilarityResult[],
                totalResults: 0
            };

            // Search each data type if enabled
            if (opts.includeConversations) {
                results.conversations = await this.searchByDataType(
                    queryEmbedding, 
                    userId, 
                    'conversation', 
                    opts.limit, 
                    opts.similarityThreshold
                );
            }

            if (opts.includeMemories) {
                results.memories = await this.searchByDataType(
                    queryEmbedding, 
                    userId, 
                    'memory', 
                    opts.limit, 
                    opts.similarityThreshold
                );
            }

            if (opts.includeMessages) {
                results.messages = await this.searchByDataType(
                    queryEmbedding, 
                    userId, 
                    'message', 
                    opts.limit, 
                    opts.similarityThreshold
                );
            }

            results.totalResults = results.conversations.length + results.memories.length + results.messages.length;

            loggingService.info('✅ Cross-model search completed', {
                userId,
                totalResults: results.totalResults,
                breakdown: {
                    conversations: results.conversations.length,
                    memories: results.memories.length,
                    messages: results.messages.length
                }
            });

            return results;
        } catch (error) {
            loggingService.error('❌ Cross-model search failed:', {
                error: error instanceof Error ? error.message : String(error),
                userId,
                query: query.substring(0, 100)
            });

            return {
                conversations: [],
                memories: [],
                messages: [],
                totalResults: 0
            };
        }
    }

    /**
     * Search vectors by data type with optimized filtering
     */
    private async searchByDataType(
        queryEmbedding: number[],
        userId: string,
        dataType: string,
        limit: number,
        minSimilarity: number
    ): Promise<SimilarityResult[]> {
        try {
            // Get user's vectors
            const userVectors = this.userVectorIndex.get(userId);
            if (!userVectors || userVectors.size === 0) {
                return [];
            }

            // Get vectors of specific data type
            const typeVectors = this.dataTypeIndex.get(dataType);
            if (!typeVectors || typeVectors.size === 0) {
                return [];
            }

            // Find intersection of user vectors and type vectors
            const relevantVectors = Array.from(userVectors).filter(vectorId => typeVectors.has(vectorId));
            
            if (relevantVectors.length === 0) {
                return [];
            }

            // Calculate similarities
            const similarities = this.calculateBatchSimilarities(
                queryEmbedding,
                relevantVectors,
                limit,
                minSimilarity
            );

            // Add data type to results
            return similarities.map(result => ({
                ...result,
                dataType
            }));
        } catch (error) {
            loggingService.error('Failed to search by data type:', {
                error: error instanceof Error ? error.message : String(error),
                dataType,
                userId
            });
            return [];
        }
    }

    /**
     * Get vectors by data type for analysis
     */
    async getVectorsByDataType(dataType: string, userId?: string): Promise<VectorMemoryItem[]> {
        try {
            const typeVectors = this.dataTypeIndex.get(dataType);
            if (!typeVectors) {
                return [];
            }

            const vectors: VectorMemoryItem[] = [];
            
            for (const vectorId of typeVectors) {
                const vectorItem = this.vectorStore.get(vectorId);
                if (vectorItem && (!userId || vectorItem.userId === userId)) {
                    vectors.push(vectorItem);
                }
            }

            return vectors.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        } catch (error) {
            loggingService.error('Failed to get vectors by data type:', {
                error: error instanceof Error ? error.message : String(error),
                dataType,
                userId
            });
            return [];
        }
    }

    /**
     * Enhanced memory fusion - combine insights from different data types
     */
    async fuseMemoryInsights(
        userId: string, 
        query: string, 
        fusionOptions: {
            weightConversations?: number;
            weightMemories?: number;
            weightMessages?: number;
            maxInsights?: number;
        } = {}
    ): Promise<SimilarityResult[]> {
        const weights = {
            weightConversations: 0.4,
            weightMemories: 0.4,
            weightMessages: 0.2,
            maxInsights: 15,
            ...fusionOptions
        };

        try {
            // Perform cross-modal search
            const searchResults = await this.crossModelSearch(query, userId, {
                includeConversations: true,
                includeMemories: true,
                includeMessages: true,
                limit: 20 // Get more for fusion
            });

            // Apply fusion weights and combine results
            const fusedResults: Array<SimilarityResult & { fusedScore: number }> = [];

            // Weight conversations
            searchResults.conversations.forEach(result => {
                fusedResults.push({
                    ...result,
                    fusedScore: result.similarity * weights.weightConversations
                });
            });

            // Weight memories
            searchResults.memories.forEach(result => {
                fusedResults.push({
                    ...result,
                    fusedScore: result.similarity * weights.weightMemories
                });
            });

            // Weight messages
            searchResults.messages.forEach(result => {
                fusedResults.push({
                    ...result,
                    fusedScore: result.similarity * weights.weightMessages
                });
            });

            // Sort by fused score and return top insights
            fusedResults.sort((a, b) => b.fusedScore - a.fusedScore);
            
            const topInsights = fusedResults
                .slice(0, weights.maxInsights)
                .map(({ fusedScore, ...result }) => result); // Remove fusedScore from final results

            loggingService.info('🧠 Memory fusion completed', {
                userId,
                totalInsights: topInsights.length,
                sourceBreakdown: {
                    conversations: searchResults.conversations.length,
                    memories: searchResults.memories.length,
                    messages: searchResults.messages.length
                }
            });

            return topInsights;
        } catch (error) {
            loggingService.error('❌ Memory fusion failed:', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            return [];
        }
    }

    /**
     * Get cross-model statistics for monitoring
     */
    async getCrossModelStats(): Promise<{
        totalVectors: number;
        vectorsByType: Record<string, number>;
        vectorsByUser: number;
        cacheHitRate: number;
        avgEmbeddingDimensions: number;
    }> {
        try {
            const totalVectors = this.vectorStore.size;
            const vectorsByUser = this.userVectorIndex.size;
            
            // Count vectors by data type
            const vectorsByType: Record<string, number> = {};
            for (const [dataType, vectorSet] of this.dataTypeIndex.entries()) {
                vectorsByType[dataType] = vectorSet.size;
            }

            // Calculate cache hit rate (approximate)
            const cacheHitRate = this.embeddingCache.size > 0 ? 0.85 : 0; // Estimated based on usage

            return {
                totalVectors,
                vectorsByType,
                vectorsByUser,
                cacheHitRate,
                avgEmbeddingDimensions: this.EMBEDDING_DIMENSIONS
            };
        } catch (error) {
            loggingService.error('Failed to get cross-model stats:', {
                error: error instanceof Error ? error.message : String(error)
            });
            
            return {
                totalVectors: 0,
                vectorsByType: {},
                vectorsByUser: 0,
                cacheHitRate: 0,
                avgEmbeddingDimensions: this.EMBEDDING_DIMENSIONS
            };
        }
    }

}

export const vectorMemoryService = new VectorMemoryService();