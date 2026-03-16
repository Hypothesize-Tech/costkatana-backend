import { Injectable, Logger } from '@nestjs/common';
import { GoogleService } from './google.service';
import type { GoogleConnectionWithTokens } from './utils/google-connection-tokens';

export type GoogleCommandType =
  | 'list_docs'
  | 'list_sheets'
  | 'list_files'
  | 'get_file_content'
  | 'create_doc'
  | 'create_sheet'
  | 'export_doc';

export interface GoogleCommandResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

@Injectable()
export class GoogleCommandService {
  private readonly logger = new Logger(GoogleCommandService.name);

  constructor(private readonly googleService: GoogleService) {}

  async execute(
    connection: GoogleConnectionWithTokens,
    command: GoogleCommandType,
    params: Record<string, unknown> = {},
  ): Promise<GoogleCommandResult> {
    try {
      switch (command) {
        case 'list_docs':
          return {
            success: true,
            data: await this.googleService.listDocuments(
              connection,
              (params.maxResults as number) ?? 20,
            ),
          };
        case 'list_sheets':
          return {
            success: true,
            data: await this.googleService.listSpreadsheets(
              connection,
              (params.maxResults as number) ?? 20,
            ),
          };
        case 'list_files':
          return {
            success: true,
            data: await this.googleService.listDriveFiles(connection, {
              pageSize: (params.pageSize as number) ?? 50,
              query: params.query as string | undefined,
            }),
          };
        case 'get_file_content': {
          const fileId = params.fileId as string;
          const mimeType =
            (params.mimeType as string) ??
            'application/vnd.google-apps.document';
          const content = await this.googleService.getDriveFileContent(
            connection,
            fileId,
            mimeType,
          );
          return { success: true, data: { content } };
        }
        case 'create_doc': {
          const title = (params.title as string) ?? 'Untitled';
          const result = await this.googleService.createDocument(
            connection,
            title,
          );
          return { success: true, data: result };
        }
        case 'create_sheet': {
          const title = (params.title as string) ?? 'Untitled';
          const data = params.data as string[][] | undefined;
          const result = await this.googleService.createSpreadsheet(
            connection,
            title,
            data,
          );
          return { success: true, data: result };
        }
        case 'export_doc': {
          const documentId = params.documentId as string;
          const result = await this.googleService.getDocumentContent(
            String(connection._id),
            documentId,
          );
          return { success: result.success, data: { content: result.content } };
        }
        default:
          return {
            success: false,
            error: `Unknown command: ${command}`,
          };
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn('Google command failed', { command, error: message });
      return { success: false, error: message };
    }
  }
}
