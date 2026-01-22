/**
 * Type definitions for attachment processing
 */

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
