import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Document } from '@langchain/core/documents';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import {
  SafeBedrockEmbeddings,
  createSafeBedrockEmbeddings,
} from './safe-bedrock-embeddings';

export interface VectorStoreStats {
  documents: number;
  chunks: number;
  lastUpdated?: Date;
  initialized: boolean;
}

interface SearchResult {
  content: string;
  metadata: any;
  score: number;
}

let vectorStoreServiceInstance: VectorStoreService | null = null;

export function getVectorStoreService(): VectorStoreService {
  if (!vectorStoreServiceInstance) {
    throw new Error(
      'VectorStoreService not initialized. Ensure AgentModule is imported.',
    );
  }
  return vectorStoreServiceInstance;
}

/**
 * Vector Store Service
 * Handles vector embeddings and similarity search for knowledge base and RAG
 * Ported from Express VectorStoreService with NestJS patterns
 */
@Injectable()
export class VectorStoreService implements OnModuleInit {
  private readonly logger = new Logger(VectorStoreService.name);
  private initialized = false;
  private vectorStore: any = null;
  private hnswlibAvailable = false;
  private embeddings: SafeBedrockEmbeddings;

  // Simple in-memory storage as fallback
  private documentStore: Map<
    string,
    { content: string; embedding: number[]; metadata: any }
  > = new Map();
  private readonly SIMILARITY_THRESHOLD = 0.9;

  constructor() {
    vectorStoreServiceInstance = this;
    // Initialize embeddings
    try {
      this.embeddings = createSafeBedrockEmbeddings({
        model: 'amazon.titan-embed-text-v2:0',
      });
      this.logger.log(
        '✅ SafeBedrockEmbeddings initialized with amazon.titan-embed-text-v2:0',
      );
    } catch (error: any) {
      this.logger.error(
        '❌ Failed to initialize SafeBedrockEmbeddings v2:',
        error.message,
      );
      try {
        this.logger.log('🔄 Trying fallback to titan-embed-text-v1:0...');
        this.embeddings = createSafeBedrockEmbeddings({
          model: 'amazon.titan-embed-text-v1:0',
        });
        this.logger.log(
          '✅ SafeBedrockEmbeddings fallback successful with v1:0',
        );
      } catch (fallbackError: any) {
        this.logger.error(
          '❌ All SafeBedrockEmbeddings models failed:',
          fallbackError.message,
        );
        throw new Error(
          'SafeBedrockEmbeddings initialization completely failed',
        );
      }
    }

    // Check if HNSWLib is available
    try {
      require('@langchain/community/vectorstores/hnswlib');
      this.hnswlibAvailable = true;
    } catch (error) {
      this.logger.warn(
        '⚠️ HNSWLib not available, using simplified in-memory vector store',
      );
      this.hnswlibAvailable = false;
    }
  }

  async onModuleInit(): Promise<void> {
    await this.initialize();
  }

  /**
   * Initialize the vector store with documentation and knowledge base
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      if (!this.hnswlibAvailable) {
        this.logger.warn(
          'HNSWLib not available, using simplified in-memory vector store',
        );
        this.initialized = true;
        return;
      }

      // Initialize HNSWLib vector store with embeddings
      const initialDocs = await this.createInitialDocuments();
      if (initialDocs.length > 0) {
        const HNSWLib = (
          await import('@langchain/community/vectorstores/hnswlib')
        ).HNSWLib;
        this.vectorStore = await HNSWLib.fromDocuments(
          initialDocs,
          this.embeddings,
        );
        this.logger.log('Vector store initialized with HNSWLib');
      } else {
        // Create empty vector store
        const HNSWLib = (
          await import('@langchain/community/vectorstores/hnswlib')
        ).HNSWLib;
        this.vectorStore = await HNSWLib.fromTexts(
          ['initialization'],
          [{}],
          this.embeddings,
        );
        this.logger.log('Vector store initialized (empty) with HNSWLib');
      }

      this.initialized = true;
      this.logger.log('Vector store initialized successfully');
    } catch (error: any) {
      this.logger.error('Failed to initialize vector store', {
        error: error.message,
      });
      // Continue without vector store - non-blocking
      this.initialized = true;
    }
  }

  private async createInitialDocuments(): Promise<Document[]> {
    // Create initial documents with CostKatana knowledge
    const docs: Document[] = [];

    try {
      // Basic CostKatana knowledge documents
      const knowledgeBase = [
        {
          content:
            'CostKatana is an AI cost optimization platform that helps developers monitor, analyze, and optimize their AI API costs across multiple providers including OpenAI, Anthropic, AWS Bedrock, and Google.',
          metadata: { source: 'platform_overview', type: 'general' },
        },
        {
          content:
            'The platform provides real-time monitoring of AI usage, cost analytics, predictive spending forecasts, and automated optimization recommendations.',
          metadata: { source: 'platform_features', type: 'features' },
        },
        {
          content:
            'Key optimization strategies include prompt compression, context trimming, model switching, semantic caching, and intelligent model routing.',
          metadata: { source: 'optimization_strategies', type: 'optimization' },
        },
      ];

      for (const item of knowledgeBase) {
        docs.push(
          new Document({
            pageContent: item.content,
            metadata: item.metadata,
          }),
        );
      }
    } catch (error: any) {
      this.logger.warn('Failed to create initial documents', {
        error: error.message,
      });
    }

    return docs;
  }

  /**
   * Generate embedding vector for a single text (for context embedding, RAG, etc.).
   * Uses Bedrock Titan when available; returns zero vector on failure.
   */
  async embedText(text: string): Promise<number[]> {
    if (!this.embeddings) {
      this.logger.warn('Embeddings not initialized, returning zero vector');
      return new Array(1024).fill(0);
    }
    try {
      return await this.embeddings.embedQuery(text);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('embedText failed', { error: message });
      return new Array(1024).fill(0);
    }
  }

  /**
   * Search for similar content in the knowledge base
   */
  async search(query: string, k: number = 5): Promise<SearchResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      if (this.hnswlibAvailable && this.vectorStore) {
        // Use HNSWLib similarity search
        const results = await this.vectorStore.similaritySearchWithScore(
          query,
          k,
        );
        return results.map(([doc, score]: [any, number]) => ({
          content: doc.pageContent,
          metadata: doc.metadata,
          score: score,
        }));
      } else {
        // Enhanced keyword-based search as fallback
        const results: SearchResult[] = [];
        const queryWords = query
          .toLowerCase()
          .split(/\s+/)
          .filter((word) => word.length > 2);

        for (const [key, doc] of this.documentStore.entries()) {
          const contentLower = doc.content.toLowerCase();
          let matchScore = 0;
          let matches = 0;

          for (const word of queryWords) {
            if (contentLower.includes(word)) {
              matches++;
              matchScore += word.length; // Longer words get higher score
            }
          }

          if (matches > 0) {
            const score = Math.min(
              matches / queryWords.length + matchScore / 100,
              1,
            );
            results.push({
              content: doc.content,
              metadata: doc.metadata,
              score: score,
            });
          }
        }

        // Sort by score and return top k
        return results.sort((a, b) => b.score - a.score).slice(0, k);
      }
    } catch (error: any) {
      this.logger.error('Error searching vector store', {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Search for code snippets specifically
   */
  async searchCodeSnippets(
    query: string,
    k: number = 5,
  ): Promise<SearchResult[]> {
    try {
      const results = await this.search(query, k);
      // Filter for code-related content
      return results.filter(
        (result) =>
          result.metadata?.type === 'code' ||
          result.content.includes('```') ||
          result.metadata?.language,
      );
    } catch (error: any) {
      this.logger.error('Error searching code snippets', {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Search MongoDB-related content
   */
  async searchMongoDB(query: string, k: number = 5): Promise<SearchResult[]> {
    try {
      const results = await this.search(query, k);
      return results.filter(
        (result) =>
          result.metadata?.type === 'mongodb' ||
          result.content.toLowerCase().includes('mongodb') ||
          result.content.toLowerCase().includes('mongoose'),
      );
    } catch (error: any) {
      this.logger.error('Error searching MongoDB content', {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Hybrid search combining multiple strategies
   */
  async searchHybrid(query: string, k: number = 5): Promise<SearchResult[]> {
    try {
      const vectorResults = await this.search(query, Math.floor(k / 2));
      const codeResults = await this.searchCodeSnippets(
        query,
        Math.floor(k / 4),
      );
      const mongoResults = await this.searchMongoDB(query, Math.floor(k / 4));

      // Combine and deduplicate results
      const allResults = [...vectorResults, ...codeResults, ...mongoResults];
      const uniqueResults = new Map<string, SearchResult>();

      for (const result of allResults) {
        const key = result.content.substring(0, 100); // Simple deduplication key
        if (!uniqueResults.has(key)) {
          uniqueResults.set(key, result);
        }
      }

      return Array.from(uniqueResults.values()).slice(0, k);
    } catch (error: any) {
      this.logger.error('Error performing hybrid search', {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Add knowledge content to the vector store
   */
  async addKnowledge(content: string, metadata: any = {}): Promise<void> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      // Split content into chunks for better retrieval
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
      });

      const docs = await splitter.createDocuments([content], [metadata]);

      if (this.hnswlibAvailable && this.vectorStore) {
        // Add to HNSWLib vector store
        await this.vectorStore.addDocuments(docs);
        this.logger.debug('Knowledge added to HNSWLib vector store', {
          chunks: docs.length,
          source: metadata.source,
        });
      } else {
        // Add to in-memory fallback store with real embeddings
        for (const doc of docs) {
          const embedding = await this.embedText(doc.pageContent);
          const key = `${metadata.source || 'unknown'}_${Date.now()}_${Math.random()}`;
          this.documentStore.set(key, {
            content: doc.pageContent,
            embedding,
            metadata: doc.metadata,
          });
        }
        this.logger.debug('Knowledge added to in-memory vector store', {
          chunks: docs.length,
          source: metadata.source,
        });
      }
    } catch (error: any) {
      this.logger.error('Error adding knowledge to vector store', {
        error: error.message,
      });
    }
  }

  /**
   * Add content to MongoDB collection (for MongoDB-specific vector search)
   */
  async addToMongoDB(
    content: string,
    collection: string,
    metadata: any = {},
  ): Promise<void> {
    try {
      // Split content into chunks for better vector search
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
      });

      const docs = await splitter.createDocuments(
        [content],
        [
          {
            ...metadata,
            collection,
            type: 'mongodb',
            source: 'mongodb_collection',
            addedAt: new Date().toISOString(),
          },
        ],
      );

      if (this.hnswlibAvailable && this.vectorStore) {
        // Add to HNSWLib vector store with MongoDB-specific metadata
        await this.vectorStore.addDocuments(docs);
        this.logger.debug(
          'Content added to MongoDB vector collection via HNSWLib',
          {
            collection,
            chunks: docs.length,
            contentLength: content.length,
          },
        );
      } else {
        // Add to in-memory fallback store with real embeddings
        for (const doc of docs) {
          const embedding = await this.embedText(doc.pageContent);
          const key = `mongodb_${collection}_${Date.now()}_${Math.random()}`;
          this.documentStore.set(key, {
            content: doc.pageContent,
            embedding,
            metadata: {
              ...doc.metadata,
              vectorStoreKey: key,
              storageType: 'in_memory_fallback',
            },
          });
        }
        this.logger.debug(
          'Content added to MongoDB vector collection (in-memory)',
          {
            collection,
            chunks: docs.length,
            contentLength: content.length,
          },
        );
      }

      // Update stats
      this.logger.debug('MongoDB content indexing completed', {
        collection,
        totalChunks: docs.length,
        averageChunkSize: Math.round(content.length / docs.length),
      });
    } catch (error: any) {
      this.logger.error('Error adding content to MongoDB vector collection', {
        error: error.message,
        collection,
        contentLength: content.length,
      });
      throw error; // Re-throw to allow caller to handle
    }
  }

  /**
   * Sync vector store to memory (for distributed deployments)
   */
  async syncToMemory(): Promise<void> {
    try {
      // This would sync vector store to Redis/memory cache in production
      this.logger.debug('Vector store sync to memory completed');
    } catch (error: any) {
      this.logger.error('Error syncing vector store to memory', {
        error: error.message,
      });
    }
  }

  /**
   * Get vector store statistics
   */
  getStats(): VectorStoreStats {
    return {
      documents: this.documentStore.size,
      chunks: this.documentStore.size, // Simplified
      lastUpdated: new Date(),
      initialized: this.initialized,
    };
  }

  /**
   * Clear all stored data (for testing/maintenance)
   */
  clear(): void {
    this.documentStore.clear();
    this.vectorStore = null;
    this.initialized = false;
    this.logger.log('Vector store cleared');
  }
}
