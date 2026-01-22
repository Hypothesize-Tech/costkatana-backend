/**
 * File Formatter
 * Formats file metadata and content for display
 */

import type { AttachmentInput } from './types/attachment.types';
import { FileTypeDetector } from './FileTypeDetector';

export class FileFormatter {
    private static readonly MAX_CONTENT_LENGTH = 3000;

    /**
     * Format attachment metadata and content for display
     */
    static formatAttachment(
        attachment: AttachmentInput,
        extractedContent: string
    ): string {
        const displayFileType = FileTypeDetector.getDisplayType(
            attachment.mimeType,
            attachment.fileType
        );
        const formattedSize = FileTypeDetector.formatFileSize(attachment.fileSize);

        const fileInfoLines = [
            `📎 **${attachment.fileName}**`,
            `   ${displayFileType} | ${formattedSize}`,
            `   URL: ${attachment.url}`
        ];

        if (attachment.modifiedTime) {
            fileInfoLines.push(
                `   Modified: ${new Date(attachment.modifiedTime).toLocaleDateString()}`
            );
        }

        if (extractedContent && extractedContent.trim()) {
            const truncatedContent = this.truncateContent(extractedContent);
            fileInfoLines.push('');
            fileInfoLines.push('📄 **File Content:**');
            fileInfoLines.push(truncatedContent);
        }

        return fileInfoLines.join('\n');
    }

    /**
     * Truncate content if too long
     */
    private static truncateContent(content: string): string {
        if (content.length > this.MAX_CONTENT_LENGTH) {
            return content.substring(0, this.MAX_CONTENT_LENGTH) + '...';
        }
        return content;
    }

    /**
     * Build context string from multiple formatted attachments
     */
    static buildContextString(formattedParts: string[]): string {
        if (formattedParts.length === 0) {
            return '';
        }
        return `\n\n📁 **Attached Files:**\n\n${formattedParts.join('\n\n')}\n`;
    }
}
