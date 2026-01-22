/**
 * File Type Detector
 * Determines the display type for various file formats
 */

export class FileTypeDetector {
    /**
     * Determine display file type from MIME type
     */
    static getDisplayType(mimeType: string, fileType: string): string {
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
    static formatFileSize(bytes: number): string {
        if (bytes < 1024) {
            return `${bytes} B`;
        }
        if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`;
        }
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
}
