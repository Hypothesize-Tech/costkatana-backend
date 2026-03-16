/**
 * Fallback Vector Store Service for NestJS
 * In-memory vector store implementation that doesn't require hnswlib-node
 * Used when FAISS is unavailable in Docker environments
 */

import { Injectable, Logger } from '@nestjs/common';
import { Document as LangchainDocument } from '@langchain/core/documents';
import { SafeBedrockEmbeddingsService } from './safe-bedrock-embeddings.service';

@Injectable()
export class FallbackVectorStoreService {
  private readonly logger = new Logger(FallbackVectorStoreService.name);
  private initialized = false;
  private documents: Array<{
    content: string;
    metadata: Record<string, unknown>;
    embedding?: number[];
  }> = [];

  constructor(
    private readonly embeddingsService: SafeBedrockEmbeddingsService,
  ) {}

  /**
   * Initialize the fallback vector store
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.logger.log('🧠 Initializing Fallback Vector Store...');

      // Test embeddings
      await this.embeddingsService.embedQuery('test');
      this.logger.log('✅ Fallback Vector Store embeddings test successful');

      this.initialized = true;
      this.logger.log('✅ Fallback Vector Store initialized successfully');
    } catch (error) {
      this.logger.error('❌ Failed to initialize fallback vector store', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Fallback vector store initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Search the knowledge base for relevant information
   */
  async search(
    query: string,
    k: number = 5,
  ): Promise<
    Array<{
      pageContent: string;
      metadata: Record<string, unknown>;
      similarity: number;
    }>
  > {
    if (!this.initialized) {
      this.logger.warn(
        'Fallback vector store not initialized. Returning empty results.',
      );
      return [];
    }

    try {
      // Validate query before embedding
      if (!query || query.trim().length === 0) {
        this.logger.warn('Empty query provided to fallback vector search');
        return [];
      }

      // Generate embedding for the query
      const queryEmbedding = await this.embeddingsService.embedQuery(
        query.trim(),
      );

      // Simple similarity search using cosine similarity
      const results = this.documents
        .filter((doc) => doc.embedding)
        .map((doc) => ({
          pageContent: doc.content,
          metadata: doc.metadata,
          similarity: this.cosineSimilarity(queryEmbedding, doc.embedding!),
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, k)
        .filter((result) => result.similarity > 0.7); // Similarity threshold

      return results;
    } catch (error) {
      this.logger.error('Fallback vector search failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Add documents to the fallback vector store
   */
  async addDocuments(documents: LangchainDocument[]): Promise<void> {
    if (!this.initialized) {
      this.logger.warn(
        'Fallback vector store not initialized. Cannot add documents.',
      );
      return;
    }

    try {
      let addedCount = 0;
      for (const doc of documents) {
        // Validate content before embedding
        if (!doc.pageContent || doc.pageContent.trim().length === 0) {
          this.logger.warn(
            'Empty document content, skipping in fallback vector store',
          );
          continue;
        }

        const embedding = await this.embeddingsService.embedQuery(
          doc.pageContent.trim(),
        );
        this.documents.push({
          content: doc.pageContent.trim(),
          metadata: doc.metadata || {},
          embedding: embedding,
        });
        addedCount++;
      }
      this.logger.log(
        `📚 Added ${addedCount} documents to fallback vector store (${documents.length - addedCount} skipped)`,
      );
    } catch (error) {
      this.logger.error('Failed to add documents to fallback vector store', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Test if embeddings are working
   */
  async testEmbeddings(): Promise<boolean> {
    try {
      await this.embeddingsService.embedQuery('test');
      return true;
    } catch (error) {
      this.logger.error('Fallback embeddings test failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Get statistics about the fallback vector store
   */
  getStats(): { initialized: boolean; documentsCount: number } {
    return {
      initialized: this.initialized,
      documentsCount: this.documents.length,
    };
  }

  /**
   * Clear all documents
   */
  clear(): void {
    this.documents = [];
    this.logger.log('Fallback vector store cleared');
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
