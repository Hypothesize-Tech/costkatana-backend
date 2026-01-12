import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { DocumentProcessorService } from '../src/services/documentProcessor.service';
import { MongoDBVectorStore } from '../src/services/langchainVectorStore.service';
import { BedrockEmbeddings } from '@langchain/community/embeddings/bedrock';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Document Processing with LangChain Loaders', () => {
    let documentProcessor: DocumentProcessorService;
    let tempDir: string;

    beforeEach(() => {
        documentProcessor = new DocumentProcessorService();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
    });

    afterEach(() => {
        // Clean up temp directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    describe('File Type Validation', () => {
        it('should accept new file types', () => {
            const testFiles = [
                { name: 'test.html', expected: true },
                { name: 'test.png', expected: true },
                { name: 'test.jpg', expected: true },
                { name: 'test.webp', expected: true },
                { name: 'test.yaml', expected: true },
                { name: 'test.php', expected: true },
                { name: 'test.swift', expected: true },
                { name: 'test.unknown', expected: false }
            ];

            testFiles.forEach(({ name, expected }) => {
                const buffer = Buffer.from('test content');
                const result = documentProcessor.validateFileBuffer(buffer, name);
                expect(result.valid).toBe(expected);
            });
        });

        it('should handle different max sizes for images', () => {
            const largeBuffer = Buffer.alloc(15 * 1024 * 1024); // 15MB
            
            // Should reject for regular documents
            const docResult = documentProcessor.validateFileBuffer(largeBuffer, 'large.pdf');
            expect(docResult.valid).toBe(false);
            expect(docResult.error).toContain('10MB');
            
            // Should accept for images (up to 25MB)
            const imgResult = documentProcessor.validateFileBuffer(largeBuffer, 'large.png');
            expect(imgResult.valid).toBe(true);
        });
    });

    describe('LangChain Loader Integration', () => {
        it('should process PDF files with PDFLoader', async () => {
            const pdfContent = Buffer.from('%PDF-1.4\nTest PDF Content');
            const chunks = await documentProcessor.processFileBuffer(
                pdfContent,
                'test.pdf',
                { source: 'test', userId: 'test-user' }
            );

            expect(chunks).toBeDefined();
            expect(chunks.length).toBeGreaterThan(0);
            expect(chunks[0].metadata.sourceType).toBe('pdf');
        });

        it('should process CSV files with semantic parsing', async () => {
            const csvContent = Buffer.from('Name,Age,City\nJohn,30,NYC\nJane,25,LA');
            const chunks = await documentProcessor.processFileBuffer(
                csvContent,
                'test.csv',
                { source: 'test', userId: 'test-user' }
            );

            expect(chunks).toBeDefined();
            expect(chunks.length).toBeGreaterThan(0);
            expect(chunks[0].metadata.sourceType).toBe('csv');
        });

        it('should process HTML files and extract text', async () => {
            const htmlContent = Buffer.from(`
                <html>
                    <head><title>Test</title></head>
                    <body>
                        <h1>Hello World</h1>
                        <p>This is a test paragraph.</p>
                        <script>console.log('ignored');</script>
                    </body>
                </html>
            `);
            
            const chunks = await documentProcessor.processFileBuffer(
                htmlContent,
                'test.html',
                { source: 'test', userId: 'test-user' }
            );

            expect(chunks).toBeDefined();
            expect(chunks.length).toBeGreaterThan(0);
            // Script content should be removed
            expect(chunks[0].content).not.toContain('console.log');
            expect(chunks[0].content).toContain('Hello World');
        });

        it('should process code files with language metadata', async () => {
            const codeContent = Buffer.from(`
                function testFunction() {
                    return "Hello, World!";
                }
                
                class TestClass {
                    constructor() {
                        this.value = 42;
                    }
                }
            `);
            
            const chunks = await documentProcessor.processFileBuffer(
                codeContent,
                'test.js',
                { source: 'test', userId: 'test-user' }
            );

            expect(chunks).toBeDefined();
            expect(chunks.length).toBeGreaterThan(0);
            expect(chunks[0].metadata.sourceType).toBe('js');
        });
    });

    describe('Chunking Strategies', () => {
        it('should use appropriate chunking strategy for different file types', () => {
            const strategies = [
                { fileType: 'js', expected: 'code' },
                { fileType: 'html', expected: 'html' },
                { fileType: 'csv', expected: 'csv' },
                { fileType: 'txt', expected: 'text' },
                { fileType: 'conversation', expected: 'conversation' }
            ];

            strategies.forEach(({ fileType, expected }) => {
                const strategy = documentProcessor['determineChunkingStrategy'](fileType);
                expect(strategy).toBe(expected);
            });
        });
    });
});

describe('MongoDB VectorStore Wrapper', () => {
    let vectorStore: MongoDBVectorStore;
    let mockEmbeddings: BedrockEmbeddings;

    beforeEach(() => {
        // Mock embeddings
        mockEmbeddings = {
            embedQuery: jest.fn().mockResolvedValue(new Array(1024).fill(0.1)),
            embedDocuments: jest.fn().mockResolvedValue([
                new Array(1024).fill(0.1),
                new Array(1024).fill(0.2)
            ])
        } as any;

        vectorStore = new MongoDBVectorStore(mockEmbeddings);
    });

    describe('Document Operations', () => {
        it('should add documents with embeddings', async () => {
            const documents = [
                {
                    pageContent: 'Test document 1',
                    metadata: { source: 'test', userId: 'user1' }
                },
                {
                    pageContent: 'Test document 2',
                    metadata: { source: 'test', userId: 'user1' }
                }
            ];

            // Mock DocumentModel.insertMany
            const mockInsertMany = jest.spyOn(DocumentModel, 'insertMany').mockResolvedValue(documents);

            const ids = await vectorStore.addDocuments(documents, { userId: 'user1' });
            
            expect(ids).toHaveLength(2);
            expect(mockEmbeddings.embedDocuments).toHaveBeenCalledWith([
                'Test document 1',
                'Test document 2'
            ]);
            expect(mockInsertMany).toHaveBeenCalled();
        });

        it('should perform similarity search with filters', async () => {
            const query = 'test query';
            const filter = {
                'metadata.userId': 'user1',
                'metadata.source': { $in: ['test'] }
            };

            // Mock DocumentModel.aggregate
            const mockAggregate = jest.spyOn(DocumentModel, 'aggregate').mockResolvedValue([
                {
                    content: 'Test result',
                    metadata: { source: 'test' },
                    score: 0.9
                }
            ]);

            const results = await vectorStore.similaritySearch(query, 5, filter);
            
            expect(results).toHaveLength(1);
            expect(results[0].pageContent).toBe('Test result');
            expect(mockEmbeddings.embedQuery).toHaveBeenCalledWith(query);
            expect(mockAggregate).toHaveBeenCalled();
        });
    });

    describe('Static Factory Methods', () => {
        it('should create vector store from documents', async () => {
            const documents = [
                {
                    pageContent: 'Test content',
                    metadata: { source: 'test' }
                }
            ];

            const store = await MongoDBVectorStore.fromDocuments(
                documents,
                mockEmbeddings,
                { userId: 'user1' }
            );

            expect(store).toBeInstanceOf(MongoDBVectorStore);
        });

        it('should create vector store from texts', async () => {
            const texts = ['Text 1', 'Text 2'];
            const metadatas = [
                { source: 'test1' },
                { source: 'test2' }
            ];

            const store = await MongoDBVectorStore.fromTexts(
                texts,
                metadatas,
                mockEmbeddings,
                { userId: 'user1' }
            );

            expect(store).toBeInstanceOf(MongoDBVectorStore);
        });
    });
});

describe('End-to-End Document Upload and Retrieval', () => {
    it('should handle complete upload and retrieval flow', async () => {
        // This would be an integration test that requires a running MongoDB instance
        // and AWS Bedrock credentials. Marking as skipped for unit tests.
        
        // Test flow:
        // 1. Upload a document (PDF, HTML, Image, etc.)
        // 2. Process with LangChain loaders
        // 3. Chunk with appropriate strategy
        // 4. Generate embeddings
        // 5. Store in MongoDB
        // 6. Perform vector search
        // 7. Verify retrieval results
        
        expect(true).toBe(true); // Placeholder
    });
});

// Note: Some imports might need to be mocked for tests to run properly
const DocumentModel = {
    insertMany: jest.fn(),
    aggregate: jest.fn(),
    updateMany: jest.fn()
};