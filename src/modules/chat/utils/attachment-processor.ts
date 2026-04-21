import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LoggerService } from '../../../common/logger/logger.service';
import { StorageService } from '../../storage/storage.service';
import { GoogleService } from '../../google/google.service';
import { TextExtractionService } from '../../utils/services/text-extraction.service';
import {
  UploadedFile,
  UploadedFileDocument,
} from '../../../schemas/misc/uploaded-file.schema';

export interface AttachmentInput {
  type: 'uploaded' | 'google';
  fileId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileType: string;
  url: string;
  googleFileId?: string;
  connectionId?: string;
  webViewLink?: string;
  modifiedTime?: string;
  createdTime?: string;
}

export interface ProcessedAttachment extends AttachmentInput {
  extractedContent?: string;
}

export interface AttachmentProcessingResult {
  processedAttachments: ProcessedAttachment[];
  contextString: string;
}

@Injectable()
export class AttachmentProcessor {
  private static readonly TEXT_MIME_TYPES = [
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/json',
  ];

  constructor(
    private readonly loggingService: LoggerService,
    private readonly storageService: StorageService,
    private readonly googleService: GoogleService,
    private readonly textExtractionService: TextExtractionService,
    @InjectModel(UploadedFile.name)
    private readonly uploadedFileModel: Model<UploadedFileDocument>,
  ) {}

  /**
   * Process attachments - format file metadata for AI and fetch file content
   * Frontend already provides instruction context about analyzing files
   */
  async processAttachments(
    attachments: AttachmentInput[],
    userId: string,
  ): Promise<AttachmentProcessingResult> {
    const processedAttachments: ProcessedAttachment[] = [];
    const formattedParts: string[] = [];

    for (const attachment of attachments) {
      try {
        // Extract file content based on type
        let extractedContent = '';

        if (attachment.type === 'uploaded' && attachment.fileId) {
          extractedContent = await this.extractFromUploadedFile(
            attachment,
            userId,
          );
        } else if (attachment.type === 'google') {
          extractedContent = await this.extractFromGoogleFile(
            attachment,
            userId,
          );
        }

        // Format attachment for display
        const formattedInfo = this.formatAttachment(
          attachment,
          extractedContent,
        );
        formattedParts.push(formattedInfo);

        // Create processed attachment with extracted content
        const processedAttachment: ProcessedAttachment = {
          ...attachment,
          ...(extractedContent && { extractedContent }),
        };
        processedAttachments.push(processedAttachment);
      } catch (error) {
        this.loggingService.error('Failed to process attachment metadata', {
          attachment,
          error: error instanceof Error ? error.message : String(error),
          userId,
        });
        // Include original attachment even if processing failed
        processedAttachments.push(attachment);
      }
    }

    // Build context string from formatted parts
    const contextString = this.buildContextString(formattedParts);

    return {
      processedAttachments,
      contextString,
    };
  }

  /**
   * Extract content from uploaded file (S3). Uses stored extractedText when available; otherwise extracts text from binary files and saves back to database.
   */
  private async extractFromUploadedFile(
    attachment: AttachmentInput,
    userId: string,
  ): Promise<string> {
    try {
      const fileId = attachment.fileId;
      const doc = await this.uploadedFileModel
        .findOne({
          _id: new Types.ObjectId(fileId),
          userId: new Types.ObjectId(userId),
        })
        .exec();

      if (!doc) {
        this.loggingService.warn('Uploaded file not found for extraction', {
          fileId,
          userId,
          fileName: attachment.fileName,
        });
        return '';
      }

      // Check if we already have extracted text
      if (doc.extractedText && doc.extractedText.trim()) {
        this.loggingService.info(
          'Retrieved uploaded file content from database',
          {
            fileName: attachment.fileName,
            fileId,
            contentLength: doc.extractedText.length,
            userId,
          },
        );
        return doc.extractedText;
      }

      // Extract text from S3 file if not already extracted
      try {
        const fileType = this.textExtractionService.getFileType(
          attachment.fileName,
        );
        const extractionResult =
          await this.textExtractionService.extractTextFromS3(
            doc.s3Key,
            fileType,
            attachment.fileName,
          );

        if (extractionResult.success && extractionResult.text) {
          const extractedContent = extractionResult.text;

          // Save extracted text for future use
          doc.extractedText = extractedContent;
          await doc.save();

          this.loggingService.info(
            'Extracted and saved uploaded file content',
            {
              fileName: attachment.fileName,
              fileId,
              s3Key: doc.s3Key,
              contentLength: extractedContent.length,
              userId,
            },
          );

          return extractedContent;
        }

        this.loggingService.warn('Failed to extract text from uploaded file', {
          fileName: attachment.fileName,
          fileId,
          error: extractionResult.error,
          userId,
        });
        return '';
      } catch (extractError) {
        this.loggingService.error('Error extracting text from uploaded file', {
          fileName: attachment.fileName,
          fileId,
          error:
            extractError instanceof Error
              ? extractError.message
              : String(extractError),
          userId,
        });
        return '';
      }
    } catch (error) {
      this.loggingService.error('Failed to fetch uploaded file', {
        fileName: attachment.fileName,
        fileId: attachment.fileId,
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      return '';
    }
  }

  /**
   * Extract content from Google Drive file via Drive API (export for Docs/Sheets, get for others).
   */
  private async extractFromGoogleFile(
    attachment: AttachmentInput,
    userId: string,
  ): Promise<string> {
    try {
      const connection = await this.googleService.getConnectionForUser(userId);
      if (!connection) {
        this.loggingService.warn('No Google connection for user', {
          userId,
          fileName: attachment.fileName,
        });
        return '';
      }

      const fileId = attachment.googleFileId || attachment.fileId;
      const content = await this.googleService.getDriveFileContent(
        connection,
        fileId,
        attachment.mimeType,
      );
      return content ?? '';
    } catch (error) {
      this.loggingService.error(
        'Failed to extract content from Google Drive file',
        {
          fileName: attachment.fileName,
          googleFileId: attachment.googleFileId,
          error: error instanceof Error ? error.message : String(error),
          userId,
        },
      );
      return '';
    }
  }

  /**
   * Format attachment for display in context
   */
  private formatAttachment(
    attachment: AttachmentInput,
    extractedContent: string,
  ): string {
    const displayFileType = this.getDisplayType(
      attachment.mimeType,
      attachment.fileType,
    );
    const fileInfo = [
      `📎 **${attachment.fileName}**`,
      `Type: ${displayFileType}`,
      `Size: ${this.formatFileSize(attachment.fileSize)}`,
      `MIME: ${attachment.mimeType}`,
    ];

    if (attachment.createdTime) {
      fileInfo.push(
        `Created: ${new Date(attachment.createdTime).toLocaleDateString()}`,
      );
    }

    if (extractedContent) {
      const preview =
        extractedContent.length > 200
          ? extractedContent.substring(0, 200) + '...'
          : extractedContent;
      fileInfo.push(`\nContent Preview:\n${preview}`);
    } else {
      fileInfo.push(`Content: Available for analysis`);
    }

    return fileInfo.join('\n');
  }

  /**
   * Build context string from formatted parts
   */
  private buildContextString(formattedParts: string[]): string {
    if (formattedParts.length === 0) {
      return '';
    }

    const header = `## Attached Files (${formattedParts.length})\n\n`;
    const content = formattedParts.join('\n\n---\n\n');

    return header + content;
  }

  /**
   * Determine display file type from MIME type
   */
  private getDisplayType(mimeType: string, fileType: string): string {
    if (mimeType.includes('document')) {
      return 'Google Docs';
    }
    if (mimeType.includes('spreadsheet')) {
      return 'Google Sheets';
    }
    if (mimeType.includes('presentation')) {
      return 'Google Slides';
    }
    if (mimeType === 'application/pdf') {
      return 'PDF';
    }
    if (mimeType.includes('word')) {
      return 'Word';
    }
    if (mimeType.includes('excel')) {
      return 'Excel';
    }
    return fileType;
  }

  /**
   * Format file size in human-readable format
   */
  private formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  /**
   * Validate attachment types and sizes
   */
  validateAttachment(attachment: AttachmentInput): {
    valid: boolean;
    error?: string;
  } {
    // Check file size (max 50MB)
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (attachment.fileSize > maxSize) {
      return {
        valid: false,
        error: `File size (${this.formatFileSize(attachment.fileSize)}) exceeds maximum allowed size (50MB)`,
      };
    }

    // Check supported file types
    const supportedTypes = [
      'text/plain',
      'text/markdown',
      'text/csv',
      'application/json',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.google-apps.document',
      'application/vnd.google-apps.spreadsheet',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
    ];

    if (!supportedTypes.includes(attachment.mimeType)) {
      return {
        valid: false,
        error: `Unsupported file type: ${attachment.mimeType}`,
      };
    }

    return { valid: true };
  }

  /**
   * Get attachment statistics for logging
   */
  getAttachmentStats(attachments: AttachmentInput[]): {
    totalFiles: number;
    totalSize: number;
    types: Record<string, number>;
  } {
    const stats = {
      totalFiles: attachments.length,
      totalSize: attachments.reduce((sum, att) => sum + att.fileSize, 0),
      types: {} as Record<string, number>,
    };

    attachments.forEach((att) => {
      stats.types[att.fileType] = (stats.types[att.fileType] || 0) + 1;
    });

    return stats;
  }
}
