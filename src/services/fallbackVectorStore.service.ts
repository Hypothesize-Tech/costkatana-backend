import { SafeBedrockEmbeddings, createSafeBedrockEmbeddings } from './safeBedrockEmbeddings';
import { loggingService } from './logging.service';

/**
 * Fallback vector store implementation that doesn't require hnswlib-node
 * This is used when hnswlib-node fails to load in Docker environments
 */
export class FallbackVectorStoreService {
    private embeddings: SafeBedrockEmbeddings;
    private initialized = false;
    private documents: Array<{ content: string; metadata: Record<string, unknown>; embedding?: number[] }> = [];

    constructor() {
        try {
            // Initialize AWS Bedrock embeddings with SafeBedrockEmbeddings wrapper
            this.embeddings = createSafeBedrockEmbeddings({
                model: 'amazon.titan-embed-text-v2:0'
            });
            loggingService.info('✅ Fallback Vector Store initialized with SafeBedrockEmbeddings');
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
            // Validate query before embedding
            if (!query || query.trim().length === 0) {
                loggingService.warn('Empty query provided to fallback vector search');
                return [];
            }

            // Generate embedding for the query
            const queryEmbedding = await this.embeddings.embedQuery(query.trim());
            
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
            let addedCount = 0;
            for (const doc of documents) {
                // Validate content before embedding
                if (!doc.pageContent || doc.pageContent.trim().length === 0) {
                    loggingService.warn('Empty document content, skipping in fallback vector store');
                    continue;
                }
                const embedding = await this.embeddings.embedQuery(doc.pageContent.trim());
                this.documents.push({
                    content: doc.pageContent.trim(),
                    metadata: doc.metadata,
                    embedding: embedding
                });
                addedCount++;
            }
            loggingService.info(`📚 Added ${addedCount} documents to fallback vector store (${documents.length - addedCount} skipped)`);
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
