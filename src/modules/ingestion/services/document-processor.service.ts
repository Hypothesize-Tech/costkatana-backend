/**
 * Document Processor Service
 *
 * Processes various file formats and converts them into structured document chunks
 * with metadata enrichment for optimal RAG retrieval.
 */

import { Injectable, Logger } from '@nestjs/common';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { Document as LangchainDocument } from '@langchain/core/documents';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx';
import { CSVLoader } from '@langchain/community/document_loaders/fs/csv';
import { TextLoader } from 'langchain/document_loaders/fs/text';
import { JSONLoader } from 'langchain/document_loaders/fs/json';
import { MetadataEnrichmentService } from './metadata-enrichment.service';
import { SafeBedrockEmbeddingsService } from './safe-bedrock-embeddings.service';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Tesseract from 'tesseract.js';

export interface ProcessedDocument {
  content: string;
  contentHash: string;
  metadata: {
    source:
      | 'knowledge-base'
      | 'conversation'
      | 'telemetry'
      | 'user-upload'
      | 'activity';
    sourceType: string;
    userId?: string;
    projectId?: string;
    conversationId?: string;
    documentId?: string; // Unique document identifier for grouping chunks
    fileName?: string;
    filePath?: string;
    fileSize?: number;
    fileType?: string; // File extension or MIME type
    mimeType?: string; // MIME type (e.g. from upload)
    tags?: string[];
    language?: string;
    customMetadata?: Record<string, unknown>;

    // Enhanced semantic metadata (from enrichment)
    domain?: string;
    topic?: string;
    topics?: string[];
    contentType?: string;
    importance?: string;
    qualityScore?: number;
    technicalLevel?: string;
    semanticTags?: string[];
    relatedDocumentIds?: string[];
    prerequisites?: string[];
    version?: string;
    lastVerified?: Date;
    deprecationDate?: Date;
    sectionTitle?: string;
    sectionLevel?: number;
    sectionPath?: string[];
    precedingContext?: string;
    followingContext?: string;
    containsCode?: boolean;
    containsEquations?: boolean;
    containsLinks?: string[];
    containsImages?: boolean;
  };
  chunkIndex: number;
  totalChunks: number;
}

export interface ChunkingOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  strategy?: 'text' | 'code' | 'conversation' | 'html' | 'csv';
}

@Injectable()
export class DocumentProcessorService {
  private readonly logger = new Logger(DocumentProcessorService.name);
  private readonly textSplitter: RecursiveCharacterTextSplitter;
  private readonly codeSplitter: RecursiveCharacterTextSplitter;
  private readonly conversationSplitter: RecursiveCharacterTextSplitter;
  private readonly htmlSplitter: RecursiveCharacterTextSplitter;
  private readonly csvSplitter: RecursiveCharacterTextSplitter;

  constructor(
    private metadataEnrichmentService: MetadataEnrichmentService,
    private embeddingsService: SafeBedrockEmbeddingsService,
  ) {
    // Standard text splitter
    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });

    // Code-aware splitter (respects code structure)
    this.codeSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
      separators: [
        '\n\nclass ',
        '\n\nfunction ',
        '\n\nexport ',
        '\n\nimport ',
        '\n\n',
        '\n',
        ' ',
        '',
      ],
    });

    // Conversation splitter (preserves message boundaries)
    this.conversationSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
      separators: ['\n\nUser:', '\n\nAssistant:', '\n\n', '\n'],
    });

    // HTML splitter (preserves DOM structure)
    this.htmlSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
      separators: [
        '</section>',
        '</article>',
        '</div>',
        '</p>',
        '\n\n',
        '\n',
        ' ',
        '',
      ],
    });

    // CSV splitter (preserves rows and column context)
    this.csvSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
      separators: ['\n\n', '\n', ',', ' ', ''],
    });
  }

  /**
   * Process a file and return chunks with metadata
   */
  async processFile(
    filePath: string,
    metadata: Partial<ProcessedDocument['metadata']>,
  ): Promise<ProcessedDocument[]> {
    const startTime = Date.now();

    try {
      this.logger.log('Processing file for ingestion', {
        filePath,
        metadata,
      });

      // Read file content
      const content = fs.readFileSync(filePath, 'utf-8');
      const fileSize = fs.statSync(filePath).size;
      const fileName = path.basename(filePath);
      const sourceType = this.detectFileType(filePath);

      // Determine chunking strategy
      const strategy = this.determineChunkingStrategy(sourceType);

      // Process content
      const chunks = await this.processContent(
        content,
        {
          ...metadata,
          fileName,
          filePath,
          fileSize,
          sourceType,
        },
        { strategy },
      );

      const duration = Date.now() - startTime;

      this.logger.log('File processing completed', {
        filePath,
        chunksCreated: chunks.length,
        duration,
      });

      return chunks;
    } catch (error) {
      this.logger.error('File processing failed', {
        filePath,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
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
    options: ChunkingOptions = {},
  ): Promise<ProcessedDocument[]> {
    try {
      // Select appropriate splitter based on strategy
      const strategy = options.strategy ?? 'text';
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
          source: metadata.source ?? 'user-upload',
          sourceType: metadata.sourceType ?? 'text',
          userId: metadata.userId,
          projectId: metadata.projectId,
          conversationId: metadata.conversationId,
          documentId: metadata.documentId,
          fileName: metadata.fileName,
          filePath: metadata.filePath,
          fileSize: metadata.fileSize,
          tags: metadata.tags ?? [],
          language: metadata.language,
          customMetadata: metadata.customMetadata,
        },
        chunkIndex: index,
        totalChunks: docs.length,
      }));

      // Enrich each chunk with semantic metadata
      for (let i = 0; i < processedDocs.length; i++) {
        const chunk = processedDocs[i];

        try {
          // Build enrichment context
          const enrichmentContext = {
            userId: metadata.userId,
            projectId: metadata.projectId,
            source: metadata.source,
            existingTags: metadata.tags,
            fileName: metadata.fileName,
            language: metadata.language,
          };

          // For first chunk, do full enrichment
          // For subsequent chunks, do lighter enrichment (or inherit from first)
          if (i === 0 || chunk.content.length > 500) {
            const enrichmentResult =
              await this.metadataEnrichmentService.enrichMetadata(
                chunk.content,
                enrichmentContext,
              );

            // Merge enriched metadata
            chunk.metadata = {
              ...chunk.metadata,
              ...enrichmentResult.enrichedMetadata,
            };

            this.logger.debug('Chunk enriched with metadata', {
              chunkIndex: i,
              domain: enrichmentResult.enrichedMetadata.domain,
              topics: enrichmentResult.enrichedMetadata.topics?.length ?? 0,
            });
          } else if (i > 0) {
            // Inherit domain, topics, and technical level from first chunk
            const firstChunk = processedDocs[0];
            chunk.metadata = {
              ...chunk.metadata,
              domain: firstChunk.metadata.domain,
              topics: firstChunk.metadata.topics,
              technicalLevel: firstChunk.metadata.technicalLevel,
            };
          }

          // Add context preservation (preceding/following context)
          if (i > 0) {
            const prevChunk = processedDocs[i - 1];
            const lastSentence = this.getLastSentence(prevChunk.content);
            if (lastSentence) {
              chunk.metadata.precedingContext = lastSentence;
            }
          }

          if (i < processedDocs.length - 1) {
            const nextChunk = processedDocs[i + 1];
            const firstSentence = this.getFirstSentence(nextChunk.content);
            if (firstSentence) {
              chunk.metadata.followingContext = firstSentence;
            }
          }
        } catch (enrichmentError) {
          // Log error but continue processing
          this.logger.warn('Metadata enrichment failed for chunk', {
            chunkIndex: i,
            error:
              enrichmentError instanceof Error
                ? enrichmentError.message
                : String(enrichmentError),
          });
        }
      }

      this.logger.log('Content processing completed', {
        strategy,
        chunksCreated: processedDocs.length,
        contentLength: content.length,
        enrichmentApplied: true,
      });

      return processedDocs;
    } catch (error) {
      this.logger.error('Content processing failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  /**
   * Process conversation for RAG
   */
  async processConversation(
    messages: Array<{ role: string; content: string; timestamp?: Date }>,
    metadata: Partial<ProcessedDocument['metadata']>,
  ): Promise<ProcessedDocument[]> {
    try {
      // Format conversation as text
      const conversationText = messages
        .map(
          (msg) =>
            `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`,
        )
        .join('\n\n');

      // Add conversation-specific metadata
      const conversationMetadata = {
        ...metadata,
        source: 'conversation' as const,
        sourceType: 'chat',
        customMetadata: {
          messageCount: messages.length,
          firstMessageAt: messages[0]?.timestamp,
          lastMessageAt: messages[messages.length - 1]?.timestamp,
        },
      };

      return await this.processContent(conversationText, conversationMetadata, {
        strategy: 'conversation',
      });
    } catch (error) {
      this.logger.error('Conversation processing failed', {
        error: error instanceof Error ? error.message : String(error),
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
    metadata: Partial<ProcessedDocument['metadata']>,
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
          hasSemanticContent: !!telemetryData.semantic_content,
        },
      };

      return await this.processContent(content, telemetryMetadata);
    } catch (error) {
      this.logger.error('Telemetry processing failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Extract meaningful content from telemetry
   */
  private extractTelemetryContent(telemetryData: Record<string, any>): string {
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
        .map((r: { description: string }) => `- ${r.description}`)
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
      case 'html':
        return this.htmlSplitter;
      case 'csv':
        return this.csvSplitter;
      default:
        return this.textSplitter;
    }
  }

  /**
   * Determine chunking strategy based on file type
   */
  private determineChunkingStrategy(
    fileType: string,
  ): 'text' | 'code' | 'conversation' | 'html' | 'csv' {
    const codeExtensions = [
      'ts',
      'js',
      'tsx',
      'jsx',
      'py',
      'java',
      'cpp',
      'c',
      'go',
      'rs',
      'rb',
      'php',
      'swift',
      'kt',
      'scala',
      'r',
      'sql',
    ];
    const htmlExtensions = ['html', 'htm'];
    const csvExtensions = ['csv'];

    if (codeExtensions.includes(fileType)) {
      return 'code';
    }

    if (htmlExtensions.includes(fileType)) {
      return 'html';
    }

    if (csvExtensions.includes(fileType)) {
      return 'csv';
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
      const maxSize = 10 * 1024 * 1024; // 10MB

      if (stats.size > maxSize) {
        return {
          valid: false,
          error: `File size exceeds maximum allowed size of 10MB`,
        };
      }

      // Check if file is readable
      const content = fs.readFileSync(filePath, 'utf-8');
      if (!content || content.length === 0) {
        return {
          valid: false,
          error: 'File is empty or not readable',
        };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error:
          error instanceof Error ? error.message : 'File validation failed',
      };
    }
  }

  /**
   * Validate uploaded file buffer
   */
  validateFileBuffer(
    buffer: Buffer,
    fileName: string,
  ): { valid: boolean; error?: string } {
    // Increase max size for images
    const fileExt = path.extname(fileName).toLowerCase();
    const isImage = ['.png', '.jpg', '.jpeg', '.webp'].includes(fileExt);
    const maxSize = (isImage ? 25 : 10) * 1024 * 1024;

    if (buffer.length > maxSize) {
      return {
        valid: false,
        error: `File size exceeds maximum allowed size of ${isImage ? 25 : 10}MB`,
      };
    }

    // Extended allowed file types
    const allowedExtensions = [
      // Documents
      '.md',
      '.txt',
      '.pdf',
      '.doc',
      '.docx',
      '.rtf',
      // Data
      '.json',
      '.csv',
      '.xlsx',
      '.xls',
      '.xml',
      // Code
      '.ts',
      '.js',
      '.jsx',
      '.tsx',
      '.py',
      '.java',
      '.cpp',
      '.c',
      '.go',
      '.rs',
      '.rb',
      '.php',
      '.swift',
      '.kt',
      '.scala',
      '.r',
      '.sql',
      '.sh',
      '.bash',
      // Config
      '.yaml',
      '.yml',
      '.toml',
      '.ini',
      '.cfg',
      '.conf',
      // Web
      '.html',
      '.htm',
      // Images (for OCR)
      '.png',
      '.jpg',
      '.jpeg',
      '.webp',
      // Presentations
      '.pptx',
      '.ppt',
      // Logs
      '.log',
    ];
    const ext = path.extname(fileName).toLowerCase();

    if (!allowedExtensions.includes(ext)) {
      return {
        valid: false,
        error: `File type ${ext} is not supported. Allowed types: documents (pdf, docx, txt, md, rtf), data (csv, json, xlsx), code (js, ts, py, java, etc.), web (html), images (png, jpg, jpeg, webp)`,
      };
    }

    return { valid: true };
  }

  /**
   * Extract text using LangChain loaders
   */
  private async extractWithLangChainLoader(
    buffer: Buffer,
    fileExtension: string,
    fileName: string,
  ): Promise<LangchainDocument[]> {
    // Create temp file for loaders that need file paths
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `temp_${Date.now()}_${fileName}`);

    try {
      // Write buffer to temp file
      fs.writeFileSync(tempFilePath, buffer);

      let loader:
        | PDFLoader
        | DocxLoader
        | CSVLoader
        | TextLoader
        | JSONLoader
        | undefined;
      let documents: LangchainDocument[] = [];

      switch (fileExtension.toLowerCase()) {
        case 'pdf':
          loader = new PDFLoader(tempFilePath, {
            splitPages: true,
          });
          documents = await loader.load();
          break;

        case 'docx':
        case 'doc':
          loader = new DocxLoader(tempFilePath);
          documents = await loader.load();
          break;

        case 'csv':
          loader = new CSVLoader(tempFilePath, {
            column: undefined, // Load all columns
            separator: ',',
          });
          documents = await loader.load();
          break;

        case 'json':
          loader = new JSONLoader(tempFilePath);
          documents = await loader.load();
          break;

        case 'html':
        case 'htm': {
          // Read HTML content and use TextLoader with manual parsing
          const htmlContent = fs.readFileSync(tempFilePath, 'utf-8');
          // Use cheerio for HTML parsing
          const cheerio = await import('cheerio');
          const $ = cheerio.load(htmlContent);

          // Remove script and style elements
          $('script, style').remove();

          // Extract text content
          const textContent = $('body').text() || $.root().text();

          documents = [
            new LangchainDocument({
              pageContent: textContent.replace(/\s+/g, ' ').trim(),
              metadata: {
                source: fileName,
                fileType: 'html',
              },
            }),
          ];
          break;
        }

        case 'txt':
        case 'md':
        case 'markdown':
        case 'log':
        case 'js':
        case 'ts':
        case 'jsx':
        case 'tsx':
        case 'py':
        case 'java':
        case 'cpp':
        case 'c':
        case 'go':
        case 'rs':
        case 'rb':
        case 'php':
        case 'swift':
        case 'kt':
        case 'scala':
        case 'r':
        case 'sql':
        case 'sh':
        case 'bash':
        case 'yaml':
        case 'yml':
        case 'toml':
        case 'ini':
        case 'cfg':
        case 'conf':
          loader = new TextLoader(tempFilePath);
          documents = await loader.load();
          // Add language metadata for code files
          if (
            [
              'js',
              'ts',
              'jsx',
              'tsx',
              'py',
              'java',
              'cpp',
              'c',
              'go',
              'rs',
              'rb',
              'php',
              'swift',
              'kt',
              'scala',
              'r',
              'sql',
              'sh',
              'bash',
            ].includes(fileExtension)
          ) {
            documents.forEach((doc) => {
              doc.metadata.language = fileExtension;
              doc.metadata.fileType = 'code';
            });
          }
          break;

        case 'png':
        case 'jpg':
        case 'jpeg':
        case 'webp': {
          // Use Tesseract.js for OCR
          const {
            data: { text },
          } = await Tesseract.recognize(tempFilePath, 'eng', {
            logger: (m) => {
              if (m.status === 'recognizing text') {
                this.logger.log(
                  `OCR Progress: ${Math.round(m.progress * 100)}%`,
                );
              }
            },
          });

          documents = [
            new LangchainDocument({
              pageContent: text,
              metadata: {
                source: fileName,
                fileType: 'image',
                extractionMethod: 'OCR',
              },
            }),
          ];
          break;
        }

        case 'xlsx':
        case 'xls': {
          // Use xlsx for Excel extraction
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

          documents = [
            new LangchainDocument({
              pageContent: allText.trim(),
              metadata: {
                source: fileName,
                fileType: 'spreadsheet',
              },
            }),
          ];
          break;
        }

        case 'pptx':
        case 'ppt': {
          // Use adm-zip for PowerPoint extraction
          const AdmZip = await import('adm-zip');
          const zip = new AdmZip.default(buffer);
          const zipEntries = zip.getEntries();

          let allText = '';
          let slideNumber = 0;

          // Find all slide XML files
          const slideFiles = zipEntries
            .filter((entry) =>
              entry.entryName.match(/ppt\/slides\/slide\d+\.xml/),
            )
            .sort((a, b) => {
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
                .map((match) => match.replace(/<a:t[^>]*>([^<]+)<\/a:t>/, '$1'))
                .join(' ');

              allText += `\n\n=== Slide ${slideNumber} ===\n${slideText}`;
            }
          }

          documents = [
            new LangchainDocument({
              pageContent:
                allText.trim() || 'No text content found in presentation',
              metadata: {
                source: fileName,
                fileType: 'presentation',
              },
            }),
          ];
          break;
        }

        case 'rtf': {
          // Extract text from RTF using regex-based extraction
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
            .replace(/\\par\b/g, '\n') // Paragraphs to newlines
            .replace(/\\tab\b/g, '\t') // Tabs
            .replace(/\\line\b/g, '\n') // Line breaks
            .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => {
              // Convert hex characters
              return String.fromCharCode(parseInt(hex, 16));
            })
            .replace(/\\u(\d+)\?/g, (_, code) => {
              // Convert Unicode characters
              return String.fromCharCode(parseInt(code));
            })
            .replace(/\\[a-z]+(-?\d+)?\s?/gi, '') // Remove other control words
            .replace(/[{}]/g, '') // Remove braces
            .replace(/\\/g, '') // Remove remaining backslashes
            .replace(/\n{3,}/g, '\n\n') // Clean up multiple newlines
            .trim();

          // Validate extracted text
          if (text.length < 10) {
            throw new Error('Extracted RTF text too short or empty');
          }

          this.logger.log('RTF text extracted successfully', {
            originalSize: buffer.length,
            extractedLength: text.length,
          });

          documents = [
            new LangchainDocument({
              pageContent: text,
              metadata: {
                source: fileName,
                fileType: 'rtf',
              },
            }),
          ];
          break;
        }

        case 'xml': {
          // Parse XML and extract text content
          const xmlContent = buffer.toString('utf-8');
          const textFromXml = xmlContent
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          documents = [
            new LangchainDocument({
              pageContent: textFromXml,
              metadata: {
                source: fileName,
                fileType: 'xml',
              },
            }),
          ];
          break;
        }

        default:
          // Fallback to text loader
          loader = new TextLoader(tempFilePath);
          documents = await loader.load();
      }

      return documents;
    } finally {
      // Clean up temp file
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }
  }

  /**
   * Process file buffer (for uploads) using LangChain loaders
   */
  async processFileBuffer(
    buffer: Buffer,
    fileName: string,
    metadata: Partial<ProcessedDocument['metadata']>,
  ): Promise<ProcessedDocument[]> {
    try {
      // Validate buffer
      const validation = this.validateFileBuffer(buffer, fileName);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      const sourceType = this.detectFileType(fileName);
      const fileExtension = fileName.split('.').pop()?.toLowerCase() || '';

      this.logger.log('Processing file buffer with LangChain loaders', {
        fileName,
        fileExtension,
        sourceType,
        bufferSize: buffer.length,
      });

      // Extract documents using LangChain loaders
      const documents = await this.extractWithLangChainLoader(
        buffer,
        fileExtension,
        fileName,
      );

      // Combine all document content
      const combinedContent = documents
        .map((doc) => doc.pageContent)
        .join('\n\n');

      // Validate extracted content
      if (!combinedContent || combinedContent.trim().length === 0) {
        throw new Error('No text content could be extracted from the file');
      }

      if (combinedContent.length < 10) {
        throw new Error(
          `Extracted content too short (${combinedContent.length} characters). File may be corrupted or empty.`,
        );
      }

      // Check for binary corruption (contains lots of null bytes or non-printable chars)
      const nullBytes = (combinedContent.match(/\0/g) ?? []).length;
      const nullPercentage = (nullBytes / combinedContent.length) * 100;

      if (nullPercentage > 10) {
        throw new Error(
          `File appears corrupted (${nullPercentage.toFixed(1)}% null bytes). Please check the file and try again.`,
        );
      }

      // Check for readable text (at least 50% printable ASCII/Unicode characters)
      const printableChars = (
        combinedContent.match(/[\x20-\x7E\u00A0-\uFFFF]/g) ?? []
      ).length;
      const printablePercentage =
        (printableChars / combinedContent.length) * 100;

      if (printablePercentage < 50) {
        throw new Error(
          `File appears to contain binary data (only ${printablePercentage.toFixed(1)}% readable text). Please ensure you're uploading a text document.`,
        );
      }

      this.logger.log('Content extracted and validated successfully', {
        documentsExtracted: documents.length,
        contentLength: combinedContent.length,
        nullPercentage: nullPercentage.toFixed(2),
        printablePercentage: printablePercentage.toFixed(2),
        contentPreview: combinedContent.substring(0, 100).replace(/\s+/g, ' '),
      });

      // Determine chunking strategy based on file type
      const strategy = this.determineChunkingStrategy(sourceType);

      // Process each document and create chunks
      const allChunks: ProcessedDocument[] = [];

      for (const doc of documents) {
        const chunks = await this.processContent(
          doc.pageContent,
          {
            ...metadata,
            ...doc.metadata,
            fileName,
            fileSize: buffer.length,
            sourceType,
          },
          { strategy },
        );

        allChunks.push(...chunks);
      }

      this.logger.log('File buffer processing completed', {
        fileName,
        chunksCreated: allChunks.length,
        fileSize: buffer.length,
        avgChunkSize: Math.round(combinedContent.length / allChunks.length),
      });

      return allChunks;
    } catch (error) {
      this.logger.error('File buffer processing failed', {
        fileName,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  /**
   * Extract the last sentence from content for context preservation
   */
  private getLastSentence(content: string): string | null {
    try {
      // Match sentence ending with period, question mark, or exclamation
      const sentences = content.match(/[^.!?]+[.!?]+/g);
      if (sentences && sentences.length > 0) {
        return sentences[sentences.length - 1].trim();
      }
      // Fallback: return last 100 characters
      return content.substring(Math.max(0, content.length - 100)).trim();
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract the first sentence from content for context preservation
   */
  private getFirstSentence(content: string): string | null {
    try {
      // Match first sentence ending with period, question mark, or exclamation
      const match = content.match(/^[^.!?]+[.!?]+/);
      if (match) {
        return match[0].trim();
      }
      // Fallback: return first 100 characters
      return content.substring(0, Math.min(100, content.length)).trim();
    } catch (error) {
      return null;
    }
  }
}
