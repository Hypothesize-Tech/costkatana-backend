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
            chunkSize: parseInt(process.env.RAG_CHUNK_SIZE ?? '1000'),
            chunkOverlap: parseInt(process.env.RAG_CHUNK_OVERLAP ?? '200'),
        });

        // Code-aware splitter (respects code structure)
        this.codeSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: parseInt(process.env.RAG_CHUNK_SIZE ?? '1000'),
            chunkOverlap: parseInt(process.env.RAG_CHUNK_OVERLAP ?? '200'),
            separators: ['\n\nclass ', '\n\nfunction ', '\n\nexport ', '\n\nimport ', '\n\n', '\n', ' ', '']
        });

        // Conversation splitter (preserves message boundaries)
        this.conversationSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: parseInt(process.env.RAG_CHUNK_SIZE ?? '1000'),
            chunkOverlap: parseInt(process.env.RAG_CHUNK_OVERLAP ?? '200'),
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
                    documentId: metadata.documentId, 
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
     * Extract text from DOCX buffer
     */
    private async extractDocxText(buffer: Buffer): Promise<string> {
        try {
            // Try to use mammoth if available
            try {
                const mammoth = await import('mammoth');
                const result = await mammoth.extractRawText({ buffer });
                return result.value;
            } catch (mammothError) {
                loggingService.warn('Mammoth not available, trying alternative extraction', {
                    component: 'DocumentProcessorService',
                    operation: 'extractDocxText',
                    error: mammothError instanceof Error ? mammothError.message : String(mammothError)
                });
            }

            // Fallback: Try manual ZIP extraction
            try {
                const AdmZip = await import('adm-zip');
                const zip = new AdmZip.default(buffer);
                const zipEntries = zip.getEntries();
                
                // Find document.xml file in the DOCX
                const documentXml = zipEntries.find(entry => entry.entryName === 'word/document.xml');
                if (documentXml) {
                    const xmlContent = documentXml.getData().toString('utf8');
                    // Extract text from XML (simple regex-based extraction)
                    const textMatches = xmlContent.match(/<w:t[^>]*>([^<]+)<\/w:t>/g);
                    if (textMatches) {
                        return textMatches
                            .map(match => match.replace(/<w:t[^>]*>([^<]+)<\/w:t>/, '$1'))
                            .join(' ');
                    }
                }
            } catch (zipError) {
                loggingService.warn('ZIP extraction failed', {
                    component: 'DocumentProcessorService',
                    operation: 'extractDocxText',
                    error: zipError instanceof Error ? zipError.message : String(zipError)
                });
            }

            throw new Error('Failed to extract text from DOCX file. Please install mammoth: npm install mammoth');
        } catch (error) {
            loggingService.error('DOCX text extraction failed', {
                component: 'DocumentProcessorService',
                operation: 'extractDocxText',
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Extract text from PDF buffer
     */
    private async extractPdfText(buffer: Buffer): Promise<string> {
        try {
            // Try to use pdf-parse if available
            try {
                const pdfParse = await import('pdf-parse');
                const data = await pdfParse.default(buffer);
                return data.text;
            } catch (pdfError) {
                loggingService.error('PDF parsing failed', {
                    component: 'DocumentProcessorService',
                    operation: 'extractPdfText',
                    error: pdfError instanceof Error ? pdfError.message : String(pdfError)
                });
                throw new Error('Failed to extract text from PDF file. Please install pdf-parse: npm install pdf-parse');
            }
        } catch (error) {
            loggingService.error('PDF text extraction failed', {
                component: 'DocumentProcessorService',
                operation: 'extractPdfText',
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Extract text from Excel buffer (xlsx, xls)
     */
    private async extractExcelText(buffer: Buffer): Promise<string> {
        try {
            const XLSX = await import('xlsx');
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            
            let allText = '';
            
            // Iterate through all sheets
            workbook.SheetNames.forEach((sheetName) => {
                const sheet = workbook.Sheets[sheetName];
                
                // Add sheet name as header
                allText += `\n\n=== Sheet: ${sheetName} ===\n\n`;
                
                // Convert sheet to text (CSV format for better readability)
                const csvText = XLSX.utils.sheet_to_csv(sheet);
                allText += csvText;
            });
            
            return allText.trim();
        } catch (error) {
            loggingService.error('Excel text extraction failed', {
                component: 'DocumentProcessorService',
                operation: 'extractExcelText',
                error: error instanceof Error ? error.message : String(error)
            });
            throw new Error('Failed to extract text from Excel file. Please install xlsx: npm install xlsx');
        }
    }

    /**
     * Extract text from PowerPoint buffer (pptx)
     */
    private async extractPptxText(buffer: Buffer): Promise<string> {
        try {
            const AdmZip = await import('adm-zip');
            const zip = new AdmZip.default(buffer);
            const zipEntries = zip.getEntries();
            
            let allText = '';
            let slideNumber = 0;
            
            // Find all slide XML files
            const slideFiles = zipEntries.filter(entry => 
                entry.entryName.match(/ppt\/slides\/slide\d+\.xml/)
            ).sort((a, b) => {
                const aNum = parseInt(a.entryName.match(/\d+/)?.[0] ?? '0');
                const bNum = parseInt(b.entryName.match(/\d+/)?.[0] ?? '0');
                return aNum - bNum;
            });
            
            for (const slideFile of slideFiles) {
                slideNumber++;
                const xmlContent = slideFile.getData().toString('utf8');
                
                // Extract text from XML (p:txBody elements contain text)
                const textMatches = xmlContent.match(/<a:t[^>]*>([^<]+)<\/a:t>/g);
                if (textMatches) {
                    const slideText = textMatches
                        .map(match => match.replace(/<a:t[^>]*>([^<]+)<\/a:t>/, '$1'))
                        .join(' ');
                    
                    allText += `\n\n=== Slide ${slideNumber} ===\n${slideText}`;
                }
            }
            
            return allText.trim() || 'No text content found in presentation';
        } catch (error) {
            loggingService.error('PowerPoint text extraction failed', {
                component: 'DocumentProcessorService',
                operation: 'extractPptxText',
                error: error instanceof Error ? error.message : String(error)
            });
            throw new Error('Failed to extract text from PowerPoint file');
        }
    }

    /**
     * Extract text from RTF buffer using regex-based extraction
     */
    private async extractRtfText(buffer: Buffer): Promise<string> {
        try {
            const rtfContent = buffer.toString('utf-8');
            
            // RTF text extraction using regex patterns
            // Remove header/font/color tables
            let text = rtfContent
                .replace(/\{\\fonttbl[^}]*\}/g, '')
                .replace(/\{\\colortbl[^}]*\}/g, '')
                .replace(/\{\\stylesheet[^}]*\}/g, '')
                .replace(/\{\\info[^}]*\}/g, '');
            
            // Remove RTF control words and symbols
            text = text
                .replace(/\\par\b/g, '\n')              // Paragraphs to newlines
                .replace(/\\tab\b/g, '\t')              // Tabs
                .replace(/\\line\b/g, '\n')             // Line breaks
                .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => {
                    // Convert hex characters
                    return String.fromCharCode(parseInt(hex, 16));
                })
                .replace(/\\u(\d+)\?/g, (_, code) => {
                    // Convert Unicode characters
                    return String.fromCharCode(parseInt(code));
                })
                .replace(/\\[a-z]+(-?\d+)?\s?/gi, '')  // Remove other control words
                .replace(/[{}]/g, '')                    // Remove braces
                .replace(/\\/g, '')                      // Remove remaining backslashes
                .replace(/\n{3,}/g, '\n\n')             // Clean up multiple newlines
                .trim();
            
            // Validate extracted text
            if (text.length < 10) {
                throw new Error('Extracted RTF text too short or empty');
            }
            
            loggingService.info('RTF text extracted successfully', {
                component: 'DocumentProcessorService',
                operation: 'extractRtfText',
                originalSize: buffer.length,
                extractedLength: text.length
            });
            
            return text;
        } catch (error) {
            loggingService.error('RTF text extraction failed', {
                component: 'DocumentProcessorService',
                operation: 'extractRtfText',
                error: error instanceof Error ? error.message : String(error)
            });
            throw new Error('Failed to extract text from RTF file. The file may be corrupted or use an unsupported RTF version. Please convert to .docx or .txt first.');
        }
    }

    /**
     * Extract text from various file formats
     */
    private async extractTextFromBuffer(buffer: Buffer, fileExtension: string): Promise<string> {
        loggingService.info('Starting text extraction', {
            component: 'DocumentProcessorService',
            operation: 'extractTextFromBuffer',
            fileExtension,
            bufferSize: buffer.length
        });

        let content: string;

        switch (fileExtension) {
            case 'docx':
                content = await this.extractDocxText(buffer);
                break;

            case 'pdf':
                content = await this.extractPdfText(buffer);
                break;

            case 'xlsx':
            case 'xls':
                content = await this.extractExcelText(buffer);
                break;

            case 'pptx':
                content = await this.extractPptxText(buffer);
                break;

            case 'rtf':
                content = await this.extractRtfText(buffer);
                break;

            case 'txt':
            case 'md':
            case 'markdown':
            case 'csv':
            case 'json':
            case 'xml':
            case 'html':
            case 'htm':
            case 'log':
                // Plain text files - safe to use UTF-8
                content = buffer.toString('utf-8');
                break;

            case 'doc':
                throw new Error('Legacy .doc format not supported. Please convert to .docx first.');

            case 'ppt':
                throw new Error('Legacy .ppt format not supported. Please convert to .pptx first.');

            default:
                // Try UTF-8 as last resort with validation
                loggingService.warn('Unknown file extension, attempting UTF-8 extraction', {
                    component: 'DocumentProcessorService',
                    operation: 'extractTextFromBuffer',
                    fileExtension
                });
                content = buffer.toString('utf-8');
        } 

        return content;
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

            const sourceType = this.detectFileType(fileName);
            const fileExtension = fileName.split('.').pop()?.toLowerCase() || '';
            
            loggingService.info('Processing file buffer', {
                component: 'DocumentProcessorService',
                operation: 'processFileBuffer',
                fileName,
                fileExtension,
                sourceType,
                bufferSize: buffer.length
            });

            // Extract text using centralized method
            const content = await this.extractTextFromBuffer(buffer, fileExtension);

            // Validate extracted content
            if (!content || content.trim().length === 0) {
                throw new Error('No text content could be extracted from the file');
            }

            if (content.length < 10) {
                throw new Error(`Extracted content too short (${content.length} characters). File may be corrupted or empty.`);
            }

            // Check for binary corruption (contains lots of null bytes or non-printable chars)
            const nullBytes = (content.match(/\u0000/g) || []).length;
            const nullPercentage = (nullBytes / content.length) * 100;
            
            if (nullPercentage > 10) {
                throw new Error(`File appears corrupted (${nullPercentage.toFixed(1)}% null bytes). Please check the file and try again.`);
            }

            // Check for readable text (at least 50% printable ASCII/Unicode characters)
            const printableChars = (content.match(/[\x20-\x7E\u00A0-\uFFFF]/g) || []).length;
            const printablePercentage = (printableChars / content.length) * 100;
            
            if (printablePercentage < 50) {
                throw new Error(`File appears to contain binary data (only ${printablePercentage.toFixed(1)}% readable text). Please ensure you're uploading a text document.`);
            }

            loggingService.info('Content extracted and validated successfully', {
                component: 'DocumentProcessorService',
                operation: 'processFileBuffer',
                contentLength: content.length,
                nullPercentage: nullPercentage.toFixed(2),
                printablePercentage: printablePercentage.toFixed(2),
                contentPreview: content.substring(0, 100).replace(/\s+/g, ' ')
            });

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
                fileSize: buffer.length,
                avgChunkSize: Math.round(content.length / chunks.length)
            });

            return chunks;
        } catch (error) {
            loggingService.error('File buffer processing failed', {
                component: 'DocumentProcessorService',
                operation: 'processFileBuffer',
                fileName,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            throw error;
        }
    }
}

// Singleton instance
export const documentProcessorService = new DocumentProcessorService();

