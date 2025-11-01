import { BedrockEmbeddings } from '@langchain/community/embeddings/bedrock';
import { redisService } from './redis.service';
import { loggingService } from './logging.service';
import { fallbackVectorStoreService } from './fallbackVectorStore.service';

// Type-safe dynamic import for HNSWLib to handle Docker compatibility issues
interface HNSWLibInterface {
  fromTexts: (texts: string[], metadatas: any[], embeddings: any) => Promise<any>;
  fromDocuments: (documents: any[], embeddings: any) => Promise<any>;
  addVectors: (vectors: number[][], metadatas: any[]) => Promise<void>;
  similaritySearchVectorWithScore: (vector: number[], k: number) => Promise<any[]>;
  similaritySearch: (query: string, k: number) => Promise<any[]>;
  addDocuments: (documents: any[]) => Promise<void>;
  save: (directory: string) => Promise<void>;
  load: (directory: string, embeddings: any) => Promise<any>;
}

let HNSWLib: HNSWLibInterface | null = null;
try {
  const hnswlibModule = require('@langchain/community/vectorstores/hnswlib');
  HNSWLib = hnswlibModule.HNSWLib;
} catch (error) {
  loggingService.warn('⚠️ HNSWLib not available, using fallback vector store implementation');
  // Set to null to ensure fallback is used
  HNSWLib = null;
}

const SIMILARITY_THRESHOLD = 0.9;

// This is a simplified in-memory vector store. For production, use a persistent solution.
let vectorStore: HNSWLibInterface | null = null;

const initializeVectorStore = async () => {
  if (!HNSWLib) {
    loggingService.warn('⚠️ HNSWLib not available, skipping vector store initialization');
    return;
  }
  
  try {
    const embeddings = new BedrockEmbeddings({
      region: process.env.AWS_REGION ?? 'us-east-1',
    });
    vectorStore = await HNSWLib.fromTexts(
      ['initialization'],
      [[]],
      embeddings
    );
  } catch (error) {
    // Log error but don't throw - this is a non-blocking initialization
    loggingService.warn('⚠️ Vector store initialization failed (non-blocking):', { error: error instanceof Error ? error.message : String(error) });
  }
};

// Initialize vector store in background without blocking
setImmediate(() => {
  initializeVectorStore().catch(() => {
    // Ignore errors - already logged
  });
});

export const saveEmbedding = async (key: string, embedding: number[], response: unknown) => {
  if (!vectorStore || !HNSWLib) return;
  try {
    await vectorStore.addVectors([embedding], [{ pageContent: '', metadata: { key } }]);
    await redisService.client.set(`response:${key}`, JSON.stringify(response));
  } catch (error) {
    loggingService.error('❌ Failed to save embedding:', { error: error instanceof Error ? error.message : String(error) });
  }
};

export const findSimilar = async (embedding: number[]): Promise<unknown | null> => {
  if (!vectorStore || !HNSWLib) return null;

  try {
    const results = await vectorStore.similaritySearchVectorWithScore(embedding, 1);

    if (results.length > 0 && results[0][1] >= SIMILARITY_THRESHOLD) {
      const similarKey = results[0][0].metadata.key;
      const cachedResponse = await redisService.client.get(`response:${similarKey}`);
      return cachedResponse ? JSON.parse(cachedResponse) : null;
    }
  } catch (error) {
    loggingService.error('❌ Failed to find similar embeddings:', { error: error instanceof Error ? error.message : String(error) });
  }

  return null;
};

import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import * as fs from 'fs';
import * as path from 'path';
import mongoose from 'mongoose';

export class VectorStoreService {
    private vectorStore?: HNSWLibInterface;
    private embeddings: BedrockEmbeddings;
    private initialized = false;
    private hnswlibAvailable = false;

    constructor() {
        // Check if HNSWLib is available
        this.hnswlibAvailable = !!HNSWLib;
        if (!this.hnswlibAvailable) {
            loggingService.warn('⚠️ HNSWLib not available, using fallback vector store');
        }
        try {
            // Initialize AWS Bedrock embeddings with correct model ID
            this.embeddings = new BedrockEmbeddings({
                region: process.env.AWS_BEDROCK_REGION ?? 'us-east-1',
                model: 'amazon.titan-embed-text-v2:0',  // Updated to v2 with proper format
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
                },
                // Additional configuration to ensure proper API calls
                maxRetries: 3,
            });
            loggingService.info('✅ BedrockEmbeddings initialized with amazon.titan-embed-text-v2:0');
        } catch (error) {
            loggingService.error('❌ Failed to initialize BedrockEmbeddings v2:', { error: error instanceof Error ? error.message : String(error) });
            
            // Fallback to v1 if v2 fails
            try {
                loggingService.info('🔄 Trying fallback to titan-embed-text-v1:0...');
                this.embeddings = new BedrockEmbeddings({
                    region: process.env.AWS_BEDROCK_REGION ?? 'us-east-1',
                    model: 'amazon.titan-embed-text-v1:0',
                    credentials: {
                        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
                        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
                    },
                    maxRetries: 3,
                });
                loggingService.info('✅ BedrockEmbeddings fallback successful with v1:0');
            } catch (fallbackError) {
                loggingService.error('❌ All BedrockEmbeddings models failed:', { error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError) });
                
                // Final fallback - disable embeddings functionality
                loggingService.warn('⚠️ Running in degraded mode without embeddings');
                throw new Error('BedrockEmbeddings initialization completely failed - check AWS credentials and region');
            }
        }
    }

    /**
     * Initialize the vector store with documentation and knowledge base
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        if (!this.hnswlibAvailable) {
            loggingService.warn('⚠️ HNSWLib not available, initializing fallback vector store');
            await fallbackVectorStoreService.initialize();
            this.initialized = true;
            return;
        }

        try {
            loggingService.info('🧠 Initializing Agent Knowledge Base...');

            // Load and process documentation
            const documents = await this.loadDocumentation();
            
            // Test embeddings before creating vector store
            try {
                loggingService.info('🧪 Testing BedrockEmbeddings with sample text...');
                await this.embeddings.embedQuery("test");
                loggingService.info('✅ BedrockEmbeddings test successful');
            } catch (embeddingError) {
                loggingService.error('❌ BedrockEmbeddings test failed:', { error: embeddingError instanceof Error ? embeddingError.message : String(embeddingError) });
                throw new Error(`BedrockEmbeddings test failed: ${embeddingError instanceof Error ? embeddingError.message : 'Unknown error'}`);
            }
            
            // Create vector store from documents
            loggingService.info('📚 Creating vector store from documents...');
            if (HNSWLib) {
                this.vectorStore = await HNSWLib.fromDocuments(
                    documents,
                    this.embeddings
                );
            }

            this.initialized = true;
            loggingService.info(`✅ Agent Knowledge Base initialized with ${documents.length} documents`);
        } catch (error) {
            loggingService.error('❌ Failed to initialize vector store:', { error: error instanceof Error ? error.message : String(error) });
            loggingService.error('Error details:', { error: error instanceof Error ? error.message : String(error) });
            
            // Set a flag to indicate partial initialization
            this.initialized = false;
            throw new Error(`Vector store initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Load and chunk documentation files including knowledge base
     */
    private async loadDocumentation(): Promise<Document[]> {
        const documents: Document[] = [];
        
        // Define paths to documentation
        const docPaths = [
            // Backend documentation
            '../../API_DOCUMENTATION.md',
            '../../README.md',
            '../../OBSERVABILITY.md',
            '../../WEBHOOK_DOCUMENTATION.md',
            '../../docs/INTEGRATION_GUIDE.md',
            '../../docs/FINANCIAL_GOVERNANCE.md',
            '../../docs/PROACTIVE_INTELLIGENCE.md',
            '../../docs/EMAIL_CONFIGURATION.md',

            // Main knowledge base files
            '../../knowledge-base/README.md',
            '../../knowledge-base/costkatana-integration-guide.md',
            '../../knowledge-base/core-integration-guide.md',
            '../../knowledge-base/cli-integration-guide.md',
            '../../knowledge-base/python-integration-guide.md',
            '../../knowledge-base/faq-troubleshooting.md',
            '../../knowledge-base/migration-guide.md',

            // Knowledge Base subdirectories - include all relevant files
            '../../knowledge-base/cost-optimization/README.md',
            '../../knowledge-base/cost-optimization/AI_USAGE_OPTIMIZATION.md',
            '../../knowledge-base/cortex-optimization/CORTEX_ARCHITECTURE.md',
            '../../knowledge-base/cortex-optimization/IMPACT_ANALYTICS.md',
            '../../knowledge-base/multi-agent-workflows/README.md',
            '../../knowledge-base/predictive-analytics/README.md',
            '../../knowledge-base/security-monitoring/README.md',
            '../../knowledge-base/user-coaching/README.md',
            '../../knowledge-base/ai-insights/README.md',
            '../../knowledge-base/api-integration/README.md',
            '../../knowledge-base/data-analytics/README.md'
        ];

        // Text splitter for chunking documents
        const textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1000,
            chunkOverlap: 200,
        });

        // Load each documentation file
        for (const docPath of docPaths) {
            try {
                const fullPath = path.resolve(__dirname, docPath);
                loggingService.info(`🔍 Attempting to load: ${docPath}`);
                loggingService.info(`📍 Full resolved path: ${fullPath}`);
                
                if (fs.existsSync(fullPath)) {
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    const chunks = await textSplitter.createDocuments([content], [{ source: docPath }]);
                    documents.push(...chunks);
                    loggingService.info(`✅ Successfully loaded: ${docPath} (${chunks.length} chunks, ${content.length} characters)`);
                } else {
                    loggingService.warn(`⚠️  File not found: ${fullPath}`);
                }
            } catch (error) {
                loggingService.error(`❌ Failed to load ${docPath}:`, { error: error instanceof Error ? error.message : String(error) });
                loggingService.error(`   Full path attempted: ${path.resolve(__dirname, docPath)}`);
            }
        }

        // Add built-in knowledge about AI cost optimization
        const builtInKnowledge = [
            {
                content: `AI Cost Optimization Best Practices:
1. Use cheaper models for simple tasks (e.g., Claude 3 Haiku for basic queries)
2. Implement prompt compression to reduce token usage
3. Cache frequently used responses
4. Batch similar requests together
5. Monitor usage patterns to identify waste
6. Use context trimming for long conversations
7. Implement quality scoring to ensure model downgrades don't hurt performance`,
                metadata: { source: 'built-in-knowledge', type: 'best-practices' }
            },
            {
                content: `Model Selection Guidelines:
- GPT-4 Turbo: Complex reasoning, analysis, creative writing
- GPT-3.5 Turbo: General tasks, summarization, simple Q&A
- Claude 3 Opus: Advanced reasoning, research, complex analysis
- Claude 3 Sonnet: Balanced performance and cost
- Claude 3 Haiku: Fast responses, simple tasks, high volume
- Titan: Embeddings, basic text generation
- Cohere: Classification, summarization, embeddings`,
                metadata: { source: 'built-in-knowledge', type: 'model-guidelines' }
            }
        ];

        const builtInDocs = await textSplitter.createDocuments(
            builtInKnowledge.map(k => k.content),
            builtInKnowledge.map(k => k.metadata)
        );
        
        documents.push(...builtInDocs);
        
        // Log summary of loaded documents
        loggingService.info(`\n📚 Knowledge Base Loading Summary:`);
        loggingService.info(`   Total documents loaded: ${documents.length}`);
        loggingService.info(`   Built-in knowledge chunks: ${builtInDocs.length}`);
        loggingService.info(`   External documentation chunks: ${documents.length - builtInDocs.length}`);
        
        // Categorize loaded documents for summary
        const categories = this.categorizeLoadedDocuments(documents);
        loggingService.info(`   Document categories:`);
        Object.entries(categories).forEach(([category, count]) => {
            loggingService.info(`     - ${category}: ${count} chunks`);
        });
        
        return documents;
    }

    /**
     * Search the knowledge base for relevant information
     */
    async search(query: string, k: number = 5): Promise<Document[]> {
        if (!this.initialized) {
            loggingService.warn('Vector store not initialized. Returning empty results.');
            return [];
        }

        if (!this.hnswlibAvailable) {
            // Use fallback vector store
            return await fallbackVectorStoreService.search(query, k);
        }

        if (!this.vectorStore) {
            loggingService.warn('Vector store not available. Returning empty results.');
            return [];
        }

        try {
            const results = await this.vectorStore.similaritySearch(query, k);
            return results;
        } catch (error) {
            loggingService.error('Vector search failed:', { error: error instanceof Error ? error.message : String(error) });
            // Return empty results gracefully instead of throwing
            return [];
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
            loggingService.error('Embeddings test failed:', { error: error instanceof Error ? error.message : String(error) });
            return false;
        }
    }

    /**
     * Add new insights or learned knowledge to the vector store
     */
    async addKnowledge(content: string, metadata: Record<string, any> = {}): Promise<void> {
        if (!this.initialized || !this.vectorStore) {
            throw new Error('Vector store not initialized');
        }

        try {
            const document = new Document({
                pageContent: content,
                metadata: { 
                    ...metadata, 
                    timestamp: new Date().toISOString(),
                    type: 'learned-insight'
                }
            });

            await this.vectorStore.addDocuments([document]);
            loggingService.info('🧠 Added new knowledge to vector store');
        } catch (error) {
            loggingService.error('Failed to add knowledge:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Categorize loaded documents based on their metadata sources
     */
    private categorizeLoadedDocuments(documents: Document[]): Record<string, number> {
        const categories: Record<string, number> = {};
        documents.forEach(doc => {
            const source = doc.metadata.source || 'unknown';
            if (!categories[source]) {
                categories[source] = 0;
            }
            categories[source]++;
        });
        return categories;
    }

    /**
     * Save vector store to disk for persistence
     */
    async save(directory: string = './agent-knowledge'): Promise<void> {
        if (!this.initialized || !this.vectorStore) return;

        try {
            await this.vectorStore.save(directory);
            loggingService.info(`💾 Vector store saved to ${directory}`);
        } catch (error) {
            loggingService.error('Failed to save vector store:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Load vector store from disk
     */
    async load(directory: string = './agent-knowledge'): Promise<void> {
        try {
            if (HNSWLib) {
                this.vectorStore = await HNSWLib.load(directory, this.embeddings);
                this.initialized = true;
                loggingService.info(`📂 Vector store loaded from ${directory}`);
            }
        } catch (error) {
            loggingService.warn('Could not load existing vector store, will create new one');
            await this.initialize();
        }
    }

    /**
     * Get statistics about the knowledge base
     */
    getStats(): { initialized: boolean; documentsCount?: number } {
        return {
            initialized: this.initialized,
            documentsCount: this.initialized ? 1 : 0 // Simplified for now
        };
    }

    /**
     * Add document to MongoDB with embedding
     */
    async addToMongoDB(content: string, metadata: any, embedding?: number[]): Promise<string> {
        try {
            const { DocumentModel } = await import('../models/Document');
            
            // Generate embedding if not provided
            const embeddingVector = embedding || await this.embeddings.embedQuery(content);
            
            // Generate content hash
            const crypto = await import('crypto');
            const contentHash = crypto.createHash('sha256').update(content).digest('hex');
            
            // Create document
            const doc = new DocumentModel({
                content,
                contentHash,
                embedding: embeddingVector,
                metadata,
                chunkIndex: 0,
                totalChunks: 1,
                ingestedAt: new Date(),
                status: 'active',
                accessCount: 0
            });
            
            await doc.save();
            
            loggingService.info('Document added to MongoDB', {
                component: 'VectorStoreService',
                operation: 'addToMongoDB',
                documentId: doc._id
            });
            
            return (doc._id as mongoose.Types.ObjectId).toString();
        } catch (error) {
            loggingService.error('Failed to add document to MongoDB', {
                component: 'VectorStoreService',
                operation: 'addToMongoDB',
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    
    /**
     * Search MongoDB using vector similarity
     */
    async searchMongoDB(query: string, k: number = 5, filters: any = {}): Promise<Document[]> {
        try {
            loggingService.info('🔍 Starting MongoDB vector search', {
                component: 'VectorStoreService',
                operation: 'searchMongoDB',
                query: query.substring(0, 100),
                limit: k,
                filters
            });

            const { DocumentModel } = await import('../models/Document');
            
            // Generate query embedding
            const queryEmbedding = await this.embeddings.embedQuery(query);
            
            loggingService.info('✅ Query embedding generated', {
                component: 'VectorStoreService',
                dimensions: queryEmbedding.length
            });
            
            // Perform vector search using MongoDB aggregation
            // Note: This requires MongoDB Atlas Vector Search index to be set up
            const vectorIndexName = process.env.MONGODB_VECTOR_INDEX_NAME || 'document_vector_index';
            
            const pipeline: any[] = [
                {
                    $vectorSearch: {
                        index: vectorIndexName,
                        path: 'embedding',
                        queryVector: queryEmbedding,
                        numCandidates: k * 10,
                        limit: k,
                        filter: {
                            status: { $eq: 'active' },
                            ...filters
                        }
                    }
                },
                {
                    $project: {
                        content: 1,
                        metadata: 1,
                        score: { $meta: 'vectorSearchScore' }
                    }
                }
            ];
            
            loggingService.info('📊 Executing aggregation pipeline', {
                component: 'VectorStoreService',
                indexName: vectorIndexName,
                numCandidates: k * 10
            });
            
            const results = await DocumentModel.aggregate(pipeline);
            
            loggingService.info(`✅ MongoDB aggregation returned ${results.length} results`, {
                component: 'VectorStoreService'
            });
            
            // If no results from vector search, try manual cosine similarity fallback
            if (results.length === 0) {
                loggingService.warn('⚠️ Vector search returned 0 results, attempting fallback with cosine similarity', {
                    component: 'VectorStoreService',
                    operation: 'searchMongoDB'
                });
                
                return await this.searchMongoDBFallback(queryEmbedding, k, filters);
            }
            
            // Convert to LangChain Document format
            const documents = results.map((doc: any) => new Document({
                pageContent: doc.content,
                metadata: {
                    ...doc.metadata,
                    score: doc.score,
                    _id: doc._id.toString()
                }
            }));
            
            loggingService.info('✅ MongoDB vector search completed', {
                component: 'VectorStoreService',
                operation: 'searchMongoDB',
                resultsCount: documents.length,
                query: query.substring(0, 100)
            });
            
            return documents;
        } catch (error) {
            loggingService.error('❌ MongoDB vector search failed, attempting fallback', {
                component: 'VectorStoreService',
                operation: 'searchMongoDB',
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            
            // Fallback to manual cosine similarity if vector search fails
            try {
                const { DocumentModel } = await import('../models/Document');
                const queryEmbedding = await this.embeddings.embedQuery(query);
                return await this.searchMongoDBFallback(queryEmbedding, k, filters);
            } catch (fallbackError) {
                loggingService.error('❌ Fallback search also failed', {
                    component: 'VectorStoreService',
                    operation: 'searchMongoDBFallback',
                    error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
                });
                return [];
            }
        }
    }
    
    /**
     * Fallback search using manual cosine similarity calculation
     * Used when MongoDB Atlas Vector Search index is not available
     */
    private async searchMongoDBFallback(queryEmbedding: number[], k: number, filters: any = {}): Promise<Document[]> {
        try {
            loggingService.info('🔧 Using fallback cosine similarity search', {
                component: 'VectorStoreService',
                operation: 'searchMongoDBFallback',
                limit: k,
                filters
            });

            const { DocumentModel } = await import('../models/Document');
            
            // Build query with filters
            const query: any = {
                status: 'active',
                ...filters
            };
            
            // Get all documents matching filters (limit to reasonable number for performance)
            const candidateDocs = await DocumentModel.find(query)
                .select('content embedding metadata')
                .limit(1000) // Limit candidates to prevent performance issues
                .lean();
            
            if (candidateDocs.length === 0) {
                loggingService.warn('⚠️ No documents found matching filters', {
                    component: 'VectorStoreService',
                    operation: 'searchMongoDBFallback',
                    filters
                });
                return [];
            }
            
            loggingService.info(`📊 Computing cosine similarity for ${candidateDocs.length} candidates`, {
                component: 'VectorStoreService',
                operation: 'searchMongoDBFallback'
            });
            
            // Calculate cosine similarity for each document
            const scoredDocs = candidateDocs
                .filter((doc: any) => doc.embedding && doc.embedding.length > 0)
                .map((doc: any) => {
                    const similarity = this.cosineSimilarity(queryEmbedding, doc.embedding);
                    return {
                        doc,
                        similarity
                    };
                })
                .sort((a, b) => b.similarity - a.similarity) // Sort by similarity descending
                .slice(0, k); // Take top k results
            
            loggingService.info(`✅ Fallback search found ${scoredDocs.length} results`, {
                component: 'VectorStoreService',
                operation: 'searchMongoDBFallback',
                topScore: scoredDocs[0]?.similarity || 0
            });
            
            // Convert to LangChain Document format
            const documents = scoredDocs.map(({ doc, similarity }) => new Document({
                pageContent: doc.content,
                metadata: {
                    ...doc.metadata,
                    score: similarity,
                    _id: doc._id.toString(),
                    fallbackSearch: true
                }
            }));
            
            return documents;
        } catch (error) {
            loggingService.error('❌ Fallback search failed', {
                component: 'VectorStoreService',
                operation: 'searchMongoDBFallback',
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }
    
    /**
     * Calculate cosine similarity between two vectors
     */
    private cosineSimilarity(vecA: number[], vecB: number[]): number {
        if (vecA.length !== vecB.length) {
            throw new Error(`Vector dimensions don't match: ${vecA.length} vs ${vecB.length}`);
        }
        
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        
        const denominator = Math.sqrt(normA) * Math.sqrt(normB);
        if (denominator === 0) {
            return 0;
        }
        
        return dotProduct / denominator;
    }
    
    /**
     * Hybrid search: Try HNSWLib cache first, fallback to MongoDB
     */
    async searchHybrid(query: string, k: number = 5, filters: any = {}): Promise<Document[]> {
        try {
            // Try in-memory cache first (fast)
            if (this.initialized && this.vectorStore) {
                try {
                    const cacheResults = await this.vectorStore.similaritySearch(query, k);
                    if (cacheResults.length > 0) {
                        loggingService.info('Cache hit for vector search', {
                            component: 'VectorStoreService',
                            operation: 'searchHybrid',
                            source: 'cache'
                        });
                        return cacheResults;
                    }
                } catch (cacheError) {
                    loggingService.warn('Cache search failed, falling back to MongoDB', {
                        component: 'VectorStoreService',
                        error: cacheError instanceof Error ? cacheError.message : String(cacheError)
                    });
                }
            }
            
            // Fallback to MongoDB (persistent)
            loggingService.info('Using MongoDB for vector search', {
                component: 'VectorStoreService',
                operation: 'searchHybrid',
                source: 'mongodb'
            });
            
            return await this.searchMongoDB(query, k, filters);
        } catch (error) {
            loggingService.error('Hybrid search failed', {
                component: 'VectorStoreService',
                operation: 'searchHybrid',
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }
    
    /**
     * Sync frequently accessed documents to in-memory cache
     */
    async syncToMemory(limit: number = 100): Promise<void> {
        if (!this.hnswlibAvailable || !HNSWLib) {
            loggingService.warn('HNSWLib not available, skipping sync to memory');
            return;
        }
        
        try {
            const { DocumentModel } = await import('../models/Document');
            
            // Get most frequently accessed documents
            const documents = await DocumentModel.find({
                status: 'active'
            })
            .sort({ accessCount: -1, lastAccessedAt: -1 })
            .limit(limit);
            
            if (documents.length === 0) return;
            
            // Extract content and embeddings
            const texts = documents.map(d => d.content);
            const embeddings = documents.map(d => d.embedding);
            const metadatas = documents.map(d => ({ ...d.metadata, _id: (d._id as mongoose.Types.ObjectId).toString() }));
            
            // Add to HNSWLib
            if (!this.vectorStore) {
                this.vectorStore = await HNSWLib.fromTexts(
                    texts,
                    metadatas,
                    this.embeddings
                );
            } else {
                await this.vectorStore.addVectors(embeddings, metadatas);
            }
            
            loggingService.info('Synced documents to in-memory cache', {
                component: 'VectorStoreService',
                operation: 'syncToMemory',
                documentsCount: documents.length
            });
        } catch (error) {
            loggingService.error('Failed to sync to memory', {
                component: 'VectorStoreService',
                operation: 'syncToMemory',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

}

// Singleton instance
export const vectorStoreService = new VectorStoreService(); 