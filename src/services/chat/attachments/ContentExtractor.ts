/**
 * Content Extractor
 * Extracts text content from uploaded files and Google Drive files
 */

import { loggingService } from '@services/logging.service';
import { GoogleService } from '@services/google.service';
import { TextExtractionService } from '@services/textExtraction.service';
import type { AttachmentInput } from './types/attachment.types';

export class ContentExtractor {
    /**
     * Extract content from uploaded file
     */
    static async extractFromUploadedFile(
        attachment: AttachmentInput,
        userId: string
    ): Promise<string> {
        try {
            const { UploadedFile } = await import('../../../models/UploadedFile');
            const uploadedFile = await UploadedFile.findById(attachment.fileId);
            
            if (!uploadedFile) {
                loggingService.warn('Uploaded file not found in database', {
                    fileId: attachment.fileId,
                    fileName: attachment.fileName,
                    userId
                });
                return '';
            }

            // Check if we already have extracted text
            if (uploadedFile.extractedText && uploadedFile.extractedText.trim()) {
                loggingService.info('Retrieved uploaded file content from database', {
                    fileName: attachment.fileName,
                    fileId: attachment.fileId,
                    contentLength: uploadedFile.extractedText.length,
                    userId
                });
                return uploadedFile.extractedText;
            }

            // Extract text from S3 file if not already extracted
            try {
                const textExtractor = new TextExtractionService();
                const extractionResult = await textExtractor.extractTextFromS3(
                    uploadedFile.s3Key,
                    uploadedFile.fileType,
                    uploadedFile.fileName
                );
                
                if (extractionResult.success && extractionResult.text) {
                    const extractedContent = extractionResult.text;
                    
                    // Save extracted text for future use
                    uploadedFile.extractedText = extractedContent;
                    await uploadedFile.save();
                    
                    loggingService.info('Extracted and saved uploaded file content', {
                        fileName: attachment.fileName,
                        fileId: attachment.fileId,
                        s3Key: uploadedFile.s3Key,
                        contentLength: extractedContent.length,
                        userId
                    });
                    
                    return extractedContent;
                }
                
                loggingService.warn('Failed to extract text from uploaded file', {
                    fileName: attachment.fileName,
                    fileId: attachment.fileId,
                    error: extractionResult.error,
                    userId
                });
                return '';
                
            } catch (extractError) {
                loggingService.error('Error extracting text from uploaded file', {
                    fileName: attachment.fileName,
                    fileId: attachment.fileId,
                    error: extractError instanceof Error ? extractError.message : String(extractError),
                    userId
                });
                return '';
            }
        } catch (error) {
            loggingService.error('Failed to fetch uploaded file', {
                fileName: attachment.fileName,
                fileId: attachment.fileId,
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            return '';
        }
    }

    /**
     * Extract content from Google Drive file
     */
    static async extractFromGoogleFile(
        attachment: AttachmentInput,
        userId: string
    ): Promise<string> {
        if (!attachment.googleFileId || !attachment.connectionId) {
            return '';
        }

        try {
            const { GoogleConnection } = await import('../../../models/GoogleConnection');
            const connection = await GoogleConnection.findById(attachment.connectionId);
            
            if (!connection || !connection.isActive) {
                return '';
            }

            let extractedContent = '';

            if (attachment.mimeType === 'application/vnd.google-apps.document') {
                extractedContent = await GoogleService.readDocument(connection, attachment.googleFileId);
            } else if (attachment.mimeType === 'application/vnd.google-apps.spreadsheet') {
                const sheetData = await GoogleService.readSpreadsheet(
                    connection,
                    attachment.googleFileId,
                    'Sheet1!A1:Z100'
                );
                if (Array.isArray(sheetData)) {
                    extractedContent = sheetData
                        .map((row: any[]) => (Array.isArray(row) ? row.join('\t') : ''))
                        .join('\n') || '';
                }
            }
            
            if (extractedContent) {
                loggingService.info('Retrieved Google file content for chat', {
                    fileName: attachment.fileName,
                    fileId: attachment.googleFileId,
                    mimeType: attachment.mimeType,
                    contentLength: extractedContent.length,
                    userId
                });
            }

            return extractedContent;
            
        } catch (error) {
            loggingService.warn('Failed to fetch Google file content', {
                fileName: attachment.fileName,
                fileId: attachment.googleFileId,
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            return '';
        }
    }
}
