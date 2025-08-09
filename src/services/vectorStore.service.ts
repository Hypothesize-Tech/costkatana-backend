import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { BedrockEmbeddings } from "@langchain/aws";
import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import * as fs from 'fs';
import * as path from 'path';

export class VectorStoreService {
    private vectorStore?: HNSWLib;
    private embeddings: BedrockEmbeddings;
    private initialized = false;

    constructor() {
        try {
            // Initialize AWS Bedrock embeddings with correct model ID
            this.embeddings = new BedrockEmbeddings({
                region: process.env.AWS_BEDROCK_REGION || 'us-east-1',
                model: 'amazon.titan-embed-text-v2:0',  // Updated to v2 with proper format
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
                },
                // Additional configuration to ensure proper API calls
                maxRetries: 3,
            });
            console.log('✅ BedrockEmbeddings initialized with amazon.titan-embed-text-v2:0');
        } catch (error) {
            console.error('❌ Failed to initialize BedrockEmbeddings v2:', error);
            
            // Fallback to v1 if v2 fails
            try {
                console.log('🔄 Trying fallback to titan-embed-text-v1:0...');
                this.embeddings = new BedrockEmbeddings({
                    region: process.env.AWS_BEDROCK_REGION || 'us-east-1',
                    model: 'amazon.titan-embed-text-v1:0',
                    credentials: {
                        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
                    },
                    maxRetries: 3,
                });
                console.log('✅ BedrockEmbeddings fallback successful with v1:0');
            } catch (fallbackError) {
                console.error('❌ All BedrockEmbeddings models failed:', fallbackError);
                
                // Final fallback - disable embeddings functionality
                console.warn('⚠️ Running in degraded mode without embeddings');
                throw new Error('BedrockEmbeddings initialization completely failed - check AWS credentials and region');
            }
        }
    }

    /**
     * Initialize the vector store with documentation and knowledge base
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            console.log('🧠 Initializing Agent Knowledge Base...');

            // Load and process documentation
            const documents = await this.loadDocumentation();
            
            // Test embeddings before creating vector store
            try {
                console.log('🧪 Testing BedrockEmbeddings with sample text...');
                await this.embeddings.embedQuery("test");
                console.log('✅ BedrockEmbeddings test successful');
            } catch (embeddingError) {
                console.error('❌ BedrockEmbeddings test failed:', embeddingError);
                throw new Error(`BedrockEmbeddings test failed: ${embeddingError instanceof Error ? embeddingError.message : 'Unknown error'}`);
            }
            
            // Create vector store from documents
            console.log('📚 Creating vector store from documents...');
            this.vectorStore = await HNSWLib.fromDocuments(
                documents,
                this.embeddings
            );

            this.initialized = true;
            console.log(`✅ Agent Knowledge Base initialized with ${documents.length} documents`);
        } catch (error) {
            console.error('❌ Failed to initialize vector store:', error);
            console.error('Error details:', error);
            
            // Set a flag to indicate partial initialization
            this.initialized = false;
            throw new Error(`Vector store initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Load and chunk documentation files
     */
    private async loadDocumentation(): Promise<Document[]> {
        const documents: Document[] = [];
        
        // Define paths to documentation
        const docPaths = [
            '../docs/API.md',
            '../docs/EXAMPLES.md', 
            '../docs/PROMPT_OPTIMIZATION.md',
            '../../ai-cost-optimizer-backend/API_DOCUMENTATION.md',
            '../../ai-cost-optimizer-backend/docs/INTEGRATION_GUIDE.md',
            '../../ai-cost-optimizer-backend/docs/FINANCIAL_GOVERNANCE.md',
            '../../ai-cost-optimizer-backend/docs/PROACTIVE_INTELLIGENCE.md',
            '../../ai-cost-optimizer-backend/docs/EMAIL_CONFIGURATION.md'
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
                if (fs.existsSync(fullPath)) {
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    const chunks = await textSplitter.createDocuments([content], [{ source: docPath }]);
                    documents.push(...chunks);
                    console.log(`📄 Loaded: ${docPath} (${chunks.length} chunks)`);
                }
            } catch (error) {
                console.warn(`⚠️  Failed to load ${docPath}:`, error);
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
        return documents;
    }

    /**
     * Search the knowledge base for relevant information
     */
    async search(query: string, k: number = 5): Promise<Document[]> {
        if (!this.initialized || !this.vectorStore) {
            console.warn('Vector store not initialized. Returning empty results.');
            return [];
        }

        try {
            const results = await this.vectorStore.similaritySearch(query, k);
            return results;
        } catch (error) {
            console.error('Vector search failed:', error);
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
            console.error('Embeddings test failed:', error);
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
            console.log('🧠 Added new knowledge to vector store');
        } catch (error) {
            console.error('Failed to add knowledge:', error);
        }
    }

    /**
     * Save vector store to disk for persistence
     */
    async save(directory: string = './agent-knowledge'): Promise<void> {
        if (!this.initialized || !this.vectorStore) return;

        try {
            await this.vectorStore.save(directory);
            console.log(`💾 Vector store saved to ${directory}`);
        } catch (error) {
            console.error('Failed to save vector store:', error);
        }
    }

    /**
     * Load vector store from disk
     */
    async load(directory: string = './agent-knowledge'): Promise<void> {
        try {
            this.vectorStore = await HNSWLib.load(directory, this.embeddings);
            this.initialized = true;
            console.log(`📂 Vector store loaded from ${directory}`);
        } catch (error) {
            console.warn('Could not load existing vector store, will create new one');
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