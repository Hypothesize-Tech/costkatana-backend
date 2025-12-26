import pdfParse from 'pdf-parse';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { loggingService } from './logging.service';

interface ExtractionResult {
  text: string;
  success: boolean;
  error?: string;
}

class TextExtractionService {
  /**
   * Determine file type from filename
   */
  getFileType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || 'unknown';
    return ext;
  }

  /**
   * Check if file type supports text extraction
   */
  supportsTextExtraction(fileType: string): boolean {
    const supportedTypes = ['pdf', 'docx', 'xlsx', 'csv', 'txt', 'md', 'js', 'ts', 'tsx', 'jsx', 'py', 'java', 'cpp', 'c', 'h', 'go', 'rs', 'rb', 'php', 'html', 'css', 'json', 'xml', 'yaml', 'yml'];
    return supportedTypes.includes(fileType.toLowerCase());
  }

  /**
   * Extract text from any supported file type
   */
  async extractText(buffer: Buffer, fileType: string, filename: string): Promise<ExtractionResult> {
    try {
      switch (fileType.toLowerCase()) {
        case 'pdf':
          return await this.extractFromPDF(buffer);
        case 'docx':
          return await this.extractFromDOCX(buffer);
        case 'xlsx':
          return await this.extractFromXLSX(buffer);
        case 'csv':
          return await this.extractFromCSV(buffer);
        case 'txt':
        case 'md':
        case 'js':
        case 'ts':
        case 'tsx':
        case 'jsx':
        case 'py':
        case 'java':
        case 'cpp':
        case 'c':
        case 'h':
        case 'go':
        case 'rs':
        case 'rb':
        case 'php':
        case 'html':
        case 'css':
        case 'json':
        case 'xml':
        case 'yaml':
        case 'yml':
          return await this.extractFromText(buffer);
        default:
          return {
            text: '',
            success: false,
            error: `Unsupported file type: ${fileType}`,
          };
      }
    } catch (error) {
      loggingService.error('Text extraction failed', {
        error,
        fileType,
        filename,
      });
      return {
        text: '',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Extract text from PDF
   */
  private async extractFromPDF(buffer: Buffer): Promise<ExtractionResult> {
    try {
      const data = await pdfParse(buffer);
      return {
        text: data.text,
        success: true,
      };
    } catch (error) {
      loggingService.error('PDF extraction failed', { error });
      return {
        text: '',
        success: false,
        error: error instanceof Error ? error.message : 'PDF extraction failed',
      };
    }
  }

  /**
   * Extract text from DOCX
   */
  private async extractFromDOCX(buffer: Buffer): Promise<ExtractionResult> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return {
        text: result.value,
        success: true,
      };
    } catch (error) {
      loggingService.error('DOCX extraction failed', { error });
      return {
        text: '',
        success: false,
        error: error instanceof Error ? error.message : 'DOCX extraction failed',
      };
    }
  }

  /**
   * Extract text from XLSX
   */
  private async extractFromXLSX(buffer: Buffer): Promise<ExtractionResult> {
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      let text = '';

      workbook.SheetNames.forEach((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        text += `\n=== Sheet: ${sheetName} ===\n`;
        text += XLSX.utils.sheet_to_csv(sheet);
        text += '\n';
      });

      return {
        text: text.trim(),
        success: true,
      };
    } catch (error) {
      loggingService.error('XLSX extraction failed', { error });
      return {
        text: '',
        success: false,
        error: error instanceof Error ? error.message : 'XLSX extraction failed',
      };
    }
  }

  /**
   * Extract text from CSV
   */
  private async extractFromCSV(buffer: Buffer): Promise<ExtractionResult> {
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const text = XLSX.utils.sheet_to_csv(firstSheet);

      return {
        text,
        success: true,
      };
    } catch (error) {
      loggingService.error('CSV extraction failed', { error });
      return {
        text: '',
        success: false,
        error: error instanceof Error ? error.message : 'CSV extraction failed',
      };
    }
  }

  /**
   * Extract text from plain text files
   */
  private async extractFromText(buffer: Buffer): Promise<ExtractionResult> {
    try {
      const text = buffer.toString('utf-8');
      return {
        text,
        success: true,
      };
    } catch (error) {
      loggingService.error('Text extraction failed', { error });
      return {
        text: '',
        success: false,
        error: error instanceof Error ? error.message : 'Text extraction failed',
      };
    }
  }

  /**
   * Extract text from a file stored in S3
   */
  async extractTextFromS3(s3Key: string, fileType: string, filename: string): Promise<ExtractionResult> {
    try {
      const { S3Service } = await import('./s3.service');
      const buffer = await S3Service.getFileBuffer(s3Key);
      return await this.extractText(buffer, fileType, filename);
    } catch (error) {
      loggingService.error('Failed to extract text from S3', {
        error,
        s3Key,
        fileType,
        filename,
      });
      return {
        text: '',
        success: false,
        error: error instanceof Error ? error.message : 'Failed to extract text from S3',
      };
    }
  }

  /**
   * Get appropriate icon for file type
   */
  getFileIcon(fileType: string): string {
    const iconMap: Record<string, string> = {
      pdf: 'DocumentTextIcon',
      docx: 'DocumentTextIcon',
      doc: 'DocumentTextIcon',
      xlsx: 'TableCellsIcon',
      xls: 'TableCellsIcon',
      csv: 'TableCellsIcon',
      txt: 'DocumentIcon',
      md: 'DocumentIcon',
      js: 'CodeBracketIcon',
      ts: 'CodeBracketIcon',
      tsx: 'CodeBracketIcon',
      jsx: 'CodeBracketIcon',
      py: 'CodeBracketIcon',
      java: 'CodeBracketIcon',
      cpp: 'CodeBracketIcon',
      c: 'CodeBracketIcon',
      jpg: 'PhotoIcon',
      jpeg: 'PhotoIcon',
      png: 'PhotoIcon',
      gif: 'PhotoIcon',
      webp: 'PhotoIcon',
      svg: 'PhotoIcon',
      zip: 'ArchiveBoxIcon',
      rar: 'ArchiveBoxIcon',
      tar: 'ArchiveBoxIcon',
      gz: 'ArchiveBoxIcon',
      mp4: 'VideoCameraIcon',
      mov: 'VideoCameraIcon',
      avi: 'VideoCameraIcon',
      mp3: 'MusicalNoteIcon',
      wav: 'MusicalNoteIcon',
    };

    return iconMap[fileType.toLowerCase()] || 'DocumentIcon';
  }

  /**
   * Format file size for display
   */
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }
}

export const textExtractionService = new TextExtractionService();

