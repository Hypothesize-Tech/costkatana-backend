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
    loggingService.error('❌ Failed to initialize vector store:', { error: error instanceof Error ? error.message : String(error) });
  }
};

void initializeVectorStore();

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

}

// Singleton instance
export const vectorStoreService = new VectorStoreService(); 