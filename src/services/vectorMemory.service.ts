import { loggingService } from './logging.service';
import { ChatBedrockConverse } from "@langchain/aws";
import { HumanMessage } from "@langchain/core/messages";

export interface VectorMemoryItem {
    id: string;
    userId: string;
    query: string;
    response: string;
    embedding: number[];
    metadata: any;
    timestamp: Date;
}

export interface SimilarityResult {
    id: string;
    query: string;
    response: string;
    similarity: number;
    metadata: any;
}

/**
 * In-memory vector storage service using JavaScript built-ins
 * Efficient for moderate-scale applications without external dependencies
 */
export class VectorMemoryService {
    private embeddingAgent: ChatBedrockConverse;
    
    // In-memory vector storage (JavaScript Map for O(1) access)
    private vectorStore = new Map<string, VectorMemoryItem>();
    private userVectorIndex = new Map<string, Set<string>>(); // userId -> Set of vector IDs
    
    // Embedding cache to avoid re-computing same queries
    private embeddingCache = new Map<string, number[]>();

    constructor() {
        this.embeddingAgent = new ChatBedrockConverse({
            model: "amazon.nova-pro-v1:0",
            region: process.env.AWS_REGION || 'us-east-1',
            temperature: 0.0, // Deterministic for embeddings
            maxTokens: 1000,
        });
        
        // Clean up embedding cache periodically
        setInterval(() => this.cleanupEmbeddingCache(), 60 * 60 * 1000); // Every hour
    }

    /**
     * Generate text embedding using AI model
     */
    private async generateEmbedding(text: string): Promise<number[]> {
        try {
            // Check cache first
            const cacheKey = this.hashText(text);
            if (this.embeddingCache.has(cacheKey)) {
                return this.embeddingCache.get(cacheKey)!;
            }
            
            // Generate embedding using AI model
            const embeddingPrompt = `Generate a numerical vector representation (embedding) for this text. 
            Return exactly 384 numbers separated by commas, representing semantic meaning:
            
            Text: "${text}"
            
            Return only the numbers, no other text.`;
            
            const response = await this.embeddingAgent.invoke([new HumanMessage(embeddingPrompt)]);
            const embeddingText = response.content.toString();
            
            // Parse the embedding
            const embedding = this.parseEmbedding(embeddingText);
            
            // Cache the embedding
            this.embeddingCache.set(cacheKey, embedding);
            
            return embedding;
        } catch (error) {
            loggingService.error('❌ Failed to generate embedding:', { error: error instanceof Error ? error.message : String(error) });
            // Fallback: generate a simple hash-based embedding
            return this.generateHashBasedEmbedding(text);
        }
    }

    /**
     * Parse embedding from AI response
     */
    private parseEmbedding(embeddingText: string): number[] {
        try {
            // Extract numbers from the response
            const numbers = embeddingText.match(/-?\d+\.?\d*/g);
            if (numbers && numbers.length >= 100) {
                const embedding = numbers.slice(0, 384).map(n => parseFloat(n));
                return this.normalizeVector(embedding);
            } else {
                throw new Error('Invalid embedding format');
            }
        } catch (error) {
            loggingService.warn('⚠️ Failed to parse AI embedding, using fallback');
            return this.generateHashBasedEmbedding(embeddingText);
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
     * Find similar conversations using vector similarity
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
            
            // Calculate similarities
            const similarities: SimilarityResult[] = [];
            
            for (const vectorId of userVectorIds) {
                const vectorItem = this.vectorStore.get(vectorId);
                if (!vectorItem) continue;
                
                const similarity = this.cosineSimilarity(queryEmbedding, vectorItem.embedding);
                
                if (similarity >= minSimilarity) {
                    similarities.push({
                        id: vectorItem.id,
                        query: vectorItem.query,
                        response: vectorItem.response,
                        similarity,
                        metadata: vectorItem.metadata
                    });
                }
            }
            
            // Sort by similarity and limit results
            similarities.sort((a, b) => b.similarity - a.similarity);
            const results = similarities.slice(0, limit);
            
            loggingService.info(`✅ Found ${results.length} similar conversations`);
            return results;
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
            
            for (const [, vectorItem] of this.vectorStore.entries()) {
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
                for (const vectorId of userVectorIds) {
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

    /**
     * Clean up expired embedding cache
     */
    private cleanupEmbeddingCache(): void {
        // For simplicity, clear all cache periodically
        // In production, you might want to track timestamps
        if (this.embeddingCache.size > 10000) {
            this.embeddingCache.clear();
            loggingService.info('🧹 Cleared embedding cache');
        }
    }
}

export const vectorMemoryService = new VectorMemoryService();