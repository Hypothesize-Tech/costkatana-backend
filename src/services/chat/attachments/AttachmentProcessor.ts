/**
 * Attachment Processor
 * Main orchestrator for processing chat attachments
 */

import { loggingService } from '@services/logging.service';
import { ContentExtractor } from './ContentExtractor';
import { FileFormatter } from './FileFormatter';
import type {
    AttachmentInput,
    ProcessedAttachment,
    AttachmentProcessingResult
} from './types/attachment.types';

export class AttachmentProcessor {
    /**
     * Process attachments - format file metadata for AI and fetch file content
     * Frontend already provides instruction context about analyzing files
     */
    static async processAttachments(
        attachments: AttachmentInput[],
        userId: string
    ): Promise<AttachmentProcessingResult> {
        const processedAttachments: ProcessedAttachment[] = [];
        const formattedParts: string[] = [];

        for (const attachment of attachments) {
            try {
                // Extract file content based on type
                let extractedContent = '';
                
                if (attachment.type === 'uploaded' && attachment.fileId) {
                    extractedContent = await ContentExtractor.extractFromUploadedFile(
                        attachment,
                        userId
                    );
                } else if (attachment.type === 'google') {
                    extractedContent = await ContentExtractor.extractFromGoogleFile(
                        attachment,
                        userId
                    );
                }

                // Format attachment for display
                const formattedInfo = FileFormatter.formatAttachment(
                    attachment,
                    extractedContent
                );
                formattedParts.push(formattedInfo);

                // Create processed attachment with extracted content
                const processedAttachment: ProcessedAttachment = {
                    ...attachment,
                    ...(extractedContent && { extractedContent })
                };
                processedAttachments.push(processedAttachment);

            } catch (error) {
                loggingService.error('Failed to process attachment metadata', {
                    attachment,
                    error,
                    userId
                });
                // Include original attachment even if processing failed
                processedAttachments.push(attachment);
            }
        }

        // Build context string from formatted parts
        const contextString = FileFormatter.buildContextString(formattedParts);

        return {
            processedAttachments,
            contextString
        };
    }
}
