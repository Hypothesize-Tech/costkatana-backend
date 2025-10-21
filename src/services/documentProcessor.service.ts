import { Document } from '@langchain/core/documents';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { loggingService } from './logging.service';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface ProcessedDocument {
    content: string;
    contentHash: string;
    metadata: {
        source: 'knowledge-base' | 'conversation' | 'telemetry' | 'user-upload' | 'activity';
        sourceType: string;
        userId?: string;
        projectId?: string;
        conversationId?: string;
        fileName?: string;
        filePath?: string;
        fileSize?: number;
        fileType?: string;        // File extension or MIME type
        documentId?: string;      // Unique document identifier for grouping chunks
        tags?: string[];
        language?: string;
        customMetadata?: Record<string, any>;
    };
    chunkIndex: number;
    totalChunks: number;
}

export interface ChunkingOptions {
    chunkSize?: number;
    chunkOverlap?: number;
    strategy?: 'text' | 'code' | 'conversation';
}

export class DocumentProcessorService {
    private textSplitter: RecursiveCharacterTextSplitter;
    private codeSplitter: RecursiveCharacterTextSplitter;
    private conversationSplitter: RecursiveCharacterTextSplitter;

    constructor() {
        // Standard text splitter
        this.textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: parseInt(process.env.RAG_CHUNK_SIZE || '1000'),
            chunkOverlap: parseInt(process.env.RAG_CHUNK_OVERLAP || '200'),
        });

        // Code-aware splitter (respects code structure)
        this.codeSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: parseInt(process.env.RAG_CHUNK_SIZE || '1000'),
            chunkOverlap: parseInt(process.env.RAG_CHUNK_OVERLAP || '200'),
            separators: ['\n\nclass ', '\n\nfunction ', '\n\nexport ', '\n\nimport ', '\n\n', '\n', ' ', '']
        });

        // Conversation splitter (preserves message boundaries)
        this.conversationSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: parseInt(process.env.RAG_CHUNK_SIZE || '1000'),
            chunkOverlap: parseInt(process.env.RAG_CHUNK_OVERLAP || '200'),
            separators: ['\n\nUser:', '\n\nAssistant:', '\n\n', '\n']
        });
    }

    /**
     * Process a file and return chunks with metadata
     */
    async processFile(
        filePath: string,
        metadata: Partial<ProcessedDocument['metadata']>
    ): Promise<ProcessedDocument[]> {
        const startTime = Date.now();

        try {
            loggingService.info('Processing file for ingestion', {
                component: 'DocumentProcessorService',
                operation: 'processFile',
                filePath,
                metadata
            });

            // Read file content
            const content = fs.readFileSync(filePath, 'utf-8');
            const fileSize = fs.statSync(filePath).size;
            const fileName = path.basename(filePath);
            const sourceType = this.detectFileType(filePath);

            // Determine chunking strategy
            const strategy = this.determineChunkingStrategy(sourceType);

            // Process content
            const chunks = await this.processContent(content, {
                ...metadata,
                fileName,
                filePath,
                fileSize,
                sourceType
            }, { strategy });

            const duration = Date.now() - startTime;

            loggingService.info('File processing completed', {
                component: 'DocumentProcessorService',
                operation: 'processFile',
                filePath,
                chunksCreated: chunks.length,
                duration
            });

            return chunks;
        } catch (error) {
            loggingService.error('File processing failed', {
                component: 'DocumentProcessorService',
                operation: 'processFile',
                filePath,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            throw error;
        }
    }

    /**
     * Process content directly (for strings, conversations, etc.)
     */
    async processContent(
        content: string,
        metadata: Partial<ProcessedDocument['metadata']>,
        options: ChunkingOptions = {}
    ): Promise<ProcessedDocument[]> {
        try {
            // Select appropriate splitter based on strategy
            const strategy = options.strategy || 'text';
            const splitter = this.getSplitter(strategy);

            // Create documents
            const docs = await splitter.createDocuments([content]);

            // Generate content hash for deduplication
            const baseHash = this.generateContentHash(content);

            // Convert to ProcessedDocument format
            const processedDocs: ProcessedDocument[] = docs.map((doc, index) => ({
                content: doc.pageContent,
                contentHash: this.generateContentHash(doc.pageContent + baseHash), // Unique hash per chunk
                metadata: {
                    source: metadata.source || 'user-upload',
                    sourceType: metadata.sourceType || 'text',
                    userId: metadata.userId,
                    projectId: metadata.projectId,
                    conversationId: metadata.conversationId,
                    fileName: metadata.fileName,
                    filePath: metadata.filePath,
                    fileSize: metadata.fileSize,
                    tags: metadata.tags || [],
                    language: metadata.language,
                    customMetadata: metadata.customMetadata
                },
                chunkIndex: index,
                totalChunks: docs.length
            }));

            loggingService.info('Content processing completed', {
                component: 'DocumentProcessorService',
                operation: 'processContent',
                strategy,
                chunksCreated: processedDocs.length,
                contentLength: content.length
            });

            return processedDocs;
        } catch (error) {
            loggingService.error('Content processing failed', {
                component: 'DocumentProcessorService',
                operation: 'processContent',
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            throw error;
        }
    }

    /**
     * Process conversation for RAG
     */
    async processConversation(
        messages: Array<{ role: string; content: string; timestamp?: Date }>,
        metadata: Partial<ProcessedDocument['metadata']>
    ): Promise<ProcessedDocument[]> {
        try {
            // Format conversation as text
            const conversationText = messages
                .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
                .join('\n\n');

            // Add conversation-specific metadata
            const conversationMetadata = {
                ...metadata,
                source: 'conversation' as const,
                sourceType: 'chat',
                customMetadata: {
                    messageCount: messages.length,
                    firstMessageAt: messages[0]?.timestamp,
                    lastMessageAt: messages[messages.length - 1]?.timestamp
                }
            };

            return await this.processContent(conversationText, conversationMetadata, {
                strategy: 'conversation'
            });
        } catch (error) {
            loggingService.error('Conversation processing failed', {
                component: 'DocumentProcessorService',
                operation: 'processConversation',
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Process telemetry data for RAG
     */
    async processTelemetry(
        telemetryData: {
            semantic_content?: string;
            cost_narrative?: string;
            operation_name?: string;
            [key: string]: any;
        },
        metadata: Partial<ProcessedDocument['metadata']>
    ): Promise<ProcessedDocument[]> {
        try {
            // Extract meaningful content from telemetry
            const content = this.extractTelemetryContent(telemetryData);

            if (!content || content.length < 50) {
                // Skip telemetry with insufficient content
                return [];
            }

            const telemetryMetadata = {
                ...metadata,
                source: 'telemetry' as const,
                sourceType: 'telemetry',
                customMetadata: {
                    operationName: telemetryData.operation_name,
                    hasCostNarrative: !!telemetryData.cost_narrative,
                    hasSemanticContent: !!telemetryData.semantic_content
                }
            };

            return await this.processContent(content, telemetryMetadata);
        } catch (error) {
            loggingService.error('Telemetry processing failed', {
                component: 'DocumentProcessorService',
                operation: 'processTelemetry',
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Extract meaningful content from telemetry
     */
    private extractTelemetryContent(telemetryData: any): string {
        const parts: string[] = [];

        if (telemetryData.operation_name) {
            parts.push(`Operation: ${telemetryData.operation_name}`);
        }

        if (telemetryData.semantic_content) {
            parts.push(telemetryData.semantic_content);
        }

        if (telemetryData.cost_narrative) {
            parts.push(`Cost Analysis: ${telemetryData.cost_narrative}`);
        }

        if (telemetryData.cost_analysis?.cost_story) {
            parts.push(`Cost Story: ${telemetryData.cost_analysis.cost_story}`);
        }

        if (telemetryData.cost_analysis?.optimization_recommendations) {
            const recs = telemetryData.cost_analysis.optimization_recommendations
                .map((r: any) => `- ${r.description}`)
                .join('\n');
            parts.push(`Optimization Recommendations:\n${recs}`);
        }

        return parts.join('\n\n');
    }

    /**
     * Get appropriate splitter based on strategy
     */
    private getSplitter(strategy: string): RecursiveCharacterTextSplitter {
        switch (strategy) {
            case 'code':
                return this.codeSplitter;
            case 'conversation':
                return this.conversationSplitter;
            default:
                return this.textSplitter;
        }
    }

    /**
     * Determine chunking strategy based on file type
     */
    private determineChunkingStrategy(fileType: string): 'text' | 'code' | 'conversation' {
        const codeExtensions = ['ts', 'js', 'tsx', 'jsx', 'py', 'java', 'cpp', 'c', 'go', 'rs', 'rb'];
        
        if (codeExtensions.includes(fileType)) {
            return 'code';
        }

        if (fileType === 'chat' || fileType === 'conversation') {
            return 'conversation';
        }

        return 'text';
    }

    /**
     * Detect file type from extension
     */
    private detectFileType(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase().replace('.', '');
        return ext || 'unknown';
    }

    /**
     * Generate content hash for deduplication
     */
    generateContentHash(content: string): string {
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    /**
     * Validate file size and type
     */
    validateFile(filePath: string): { valid: boolean; error?: string } {
        try {
            const stats = fs.statSync(filePath);
            const maxSize = parseInt(process.env.MAX_DOCUMENT_SIZE_MB || '10') * 1024 * 1024; // Convert MB to bytes

            if (stats.size > maxSize) {
                return {
                    valid: false,
                    error: `File size exceeds maximum allowed size of ${process.env.MAX_DOCUMENT_SIZE_MB || '10'}MB`
                };
            }

            // Check if file is readable
            const content = fs.readFileSync(filePath, 'utf-8');
            if (!content || content.length === 0) {
                return {
                    valid: false,
                    error: 'File is empty or not readable'
                };
            }

            return { valid: true };
        } catch (error) {
            return {
                valid: false,
                error: error instanceof Error ? error.message : 'File validation failed'
            };
        }
    }

    /**
     * Validate uploaded file buffer
     */
    validateFileBuffer(buffer: Buffer, fileName: string): { valid: boolean; error?: string } {
        const maxSize = parseInt(process.env.MAX_DOCUMENT_SIZE_MB || '10') * 1024 * 1024;

        if (buffer.length > maxSize) {
            return {
                valid: false,
                error: `File size exceeds maximum allowed size of ${process.env.MAX_DOCUMENT_SIZE_MB || '10'}MB`
            };
        }

        // Check allowed file types
        const allowedExtensions = ['.md', '.txt', '.pdf', '.json', '.csv', '.ts', '.js', '.py', '.java', '.cpp', '.go', '.rs', '.rb', '.doc', '.docx'];
        const ext = path.extname(fileName).toLowerCase();

        if (!allowedExtensions.includes(ext)) {
            return {
                valid: false,
                error: `File type ${ext} is not supported. Allowed types: ${allowedExtensions.join(', ')}`
            };
        }

        return { valid: true };
    }

    /**
     * Process file buffer (for uploads)
     */
    async processFileBuffer(
        buffer: Buffer,
        fileName: string,
        metadata: Partial<ProcessedDocument['metadata']>
    ): Promise<ProcessedDocument[]> {
        try {
            // Validate buffer
            const validation = this.validateFileBuffer(buffer, fileName);
            if (!validation.valid) {
                throw new Error(validation.error);
            }

            // Convert buffer to string
            const content = buffer.toString('utf-8');
            const sourceType = this.detectFileType(fileName);

            // Determine chunking strategy
            const strategy = this.determineChunkingStrategy(sourceType);

            // Process content
            const chunks = await this.processContent(content, {
                ...metadata,
                fileName,
                fileSize: buffer.length,
                sourceType
            }, { strategy });

            loggingService.info('File buffer processing completed', {
                component: 'DocumentProcessorService',
                operation: 'processFileBuffer',
                fileName,
                chunksCreated: chunks.length,
                fileSize: buffer.length
            });

            return chunks;
        } catch (error) {
            loggingService.error('File buffer processing failed', {
                component: 'DocumentProcessorService',
                operation: 'processFileBuffer',
                fileName,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
}

// Singleton instance
export const documentProcessorService = new DocumentProcessorService();

