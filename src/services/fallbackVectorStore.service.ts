import { BedrockEmbeddings } from '@langchain/community/embeddings/bedrock';
import { loggingService } from './logging.service';

/**
 * Fallback vector store implementation that doesn't require hnswlib-node
 * This is used when hnswlib-node fails to load in Docker environments
 */
export class FallbackVectorStoreService {
    private embeddings: BedrockEmbeddings;
    private initialized = false;
    private documents: Array<{ content: string; metadata: Record<string, unknown>; embedding?: number[] }> = [];

    constructor() {
        try {
            // Initialize AWS Bedrock embeddings with correct model ID
            this.embeddings = new BedrockEmbeddings({
                region: process.env.AWS_BEDROCK_REGION ?? 'us-east-1',
                model: 'amazon.titan-embed-text-v2:0',
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
                },
                maxRetries: 3,
            });
            loggingService.info('✅ Fallback Vector Store initialized with BedrockEmbeddings');
        } catch (error) {
            loggingService.error('❌ Failed to initialize Fallback Vector Store:', { error: error instanceof Error ? error.message : String(error) });
            throw new Error('Fallback Vector Store initialization failed');
        }
    }

    /**
     * Initialize the fallback vector store
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            loggingService.info('🧠 Initializing Fallback Vector Store...');
            
            // Test embeddings
            await this.embeddings.embedQuery("test");
            loggingService.info('✅ Fallback Vector Store embeddings test successful');
            
            this.initialized = true;
            loggingService.info('✅ Fallback Vector Store initialized successfully');
        } catch (error) {
            loggingService.error('❌ Failed to initialize fallback vector store:', { error: error instanceof Error ? error.message : String(error) });
            throw new Error(`Fallback vector store initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Search the knowledge base for relevant information
     */
    async search(query: string, k: number = 5): Promise<Array<{ pageContent: string; metadata: Record<string, unknown>; similarity: number }>> {
        if (!this.initialized) {
            loggingService.warn('Fallback vector store not initialized. Returning empty results.');
            return [];
        }

        try {
            // Generate embedding for the query
            const queryEmbedding = await this.embeddings.embedQuery(query);
            
            // Simple similarity search using cosine similarity
            const results = this.documents
                .filter(doc => doc.embedding)
                .map(doc => ({
                    pageContent: doc.content,
                    metadata: doc.metadata,
                    similarity: this.cosineSimilarity(queryEmbedding, doc.embedding!)
                }))
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, k)
                .filter(result => result.similarity > 0.7); // Similarity threshold

            return results;
        } catch (error) {
            loggingService.error('Fallback vector search failed:', { error: error instanceof Error ? error.message : String(error) });
            return [];
        }
    }

    /**
     * Add documents to the fallback vector store
     */
    async addDocuments(documents: Array<{ pageContent: string; metadata: Record<string, unknown> }>): Promise<void> {
        if (!this.initialized) {
            loggingService.warn('Fallback vector store not initialized. Cannot add documents.');
            return;
        }

        try {
            for (const doc of documents) {
                const embedding = await this.embeddings.embedQuery(doc.pageContent);
                this.documents.push({
                    content: doc.pageContent,
                    metadata: doc.metadata,
                    embedding: embedding
                });
            }
            loggingService.info(`📚 Added ${documents.length} documents to fallback vector store`);
        } catch (error) {
            loggingService.error('Failed to add documents to fallback vector store:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Test if embeddings are working
     */
    async testEmbeddings(): Promise<boolean> {
        try {
            await this.embeddings.embedQuery("test");
            return true;
        } catch (error) {
            loggingService.error('Fallback embeddings test failed:', { error: error instanceof Error ? error.message : String(error) });
            return false;
        }
    }

    /**
     * Get statistics about the fallback vector store
     */
    getStats(): { initialized: boolean; documentsCount: number } {
        return {
            initialized: this.initialized,
            documentsCount: this.documents.length
        };
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
        
        if (normA === 0 || normB === 0) return 0;
        
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
}

// Singleton instance
export const fallbackVectorStoreService = new FallbackVectorStoreService();
