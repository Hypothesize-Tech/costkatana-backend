/**
 * Google Workspace MCP Server
 * Operations for Drive, Sheets, and Docs (NO Gmail, NO Calendar)
 */

import { BaseIntegrationMCP } from './base-integration.mcp';
import { createToolSchema, createParameter, CommonParameters } from '../registry/tool-metadata';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4';
const DOCS_API_BASE = 'https://docs.googleapis.com/v1';

export class GoogleMCP extends BaseIntegrationMCP {
  constructor() {
    super('google', '1.0.0');
  }

  registerTools(): void {
    // ===== GOOGLE DRIVE OPERATIONS =====

    // Get file
    this.registerTool(
      createToolSchema(
        'drive_get_file',
        'google',
        'Get details of a specific file',
        'GET',
        [
          createParameter('fileId', 'string', 'File ID', { required: true }),
          createParameter('includeContent', 'boolean', 'Include file content', { default: false }),
        ],
        { requiredScopes: ['https://www.googleapis.com/auth/drive.file'] }
      ),
      async (params, context) => {
        const queryParams: any = {
          fields: 'id,name,mimeType,createdTime,modifiedTime,size,webViewLink,permissions',
        };

        const data = await this.makeRequest(
          context.connectionId,
          'GET',
          `${DRIVE_API_BASE}/files/${params.fileId}`,
          { params: queryParams, timeout: 300000 } // 5 minutes
        );

        return data;
      }
    );

    // Upload file
    this.registerTool(
      createToolSchema(
        'drive_upload_file',
        'google',
        'Upload a file to Google Drive',
        'POST',
        [
          createParameter('name', 'string', 'File name', { required: true }),
          createParameter('content', 'string', 'File content (text or base64)', { required: true }),
          createParameter('mimeType', 'string', 'MIME type', { default: 'text/plain' }),
          createParameter('folderId', 'string', 'Parent folder ID', { required: false }),
        ],
        { requiredScopes: ['https://www.googleapis.com/auth/drive.file'] }
      ),
      async (params, context) => {
        const metadata: any = {
          name: params.name,
          mimeType: params.mimeType || 'text/plain',
        };

        if (params.folderId) {
          metadata.parents = [params.folderId];
        }

        // Note: This is a simplified version. Full implementation would use multipart upload
        const data = await this.makeRequest(
          context.connectionId,
          'POST',
          `${DRIVE_API_BASE}/files?uploadType=multipart`,
          {
            body: {
              metadata,
              content: params.content,
            },
            timeout: 300000, // 5 minutes
          }
        );

        return data;
      }
    );

    // Update file
    this.registerTool(
      createToolSchema(
        'drive_update_file',
        'google',
        'Update an existing file',
        'PATCH',
        [
          createParameter('fileId', 'string', 'File ID', { required: true }),
          createParameter('name', 'string', 'New file name', { required: false }),
          createParameter('content', 'string', 'New content', { required: false }),
        ],
        { requiredScopes: ['https://www.googleapis.com/auth/drive.file'] }
      ),
      async (params, context) => {
        const { fileId, ...updates } = params;

        const data = await this.makeRequest(
          context.connectionId,
          'PATCH',
          `${DRIVE_API_BASE}/files/${fileId}`,
          { body: updates, timeout: 300000 } // 5 minutes
        );

        return data;
      }
    );

    // Delete file
    this.registerTool(
      createToolSchema(
        'drive_delete_file',
        'google',
        'Delete a file from Google Drive',
        'DELETE',
        [createParameter('fileId', 'string', 'File ID', { required: true })],
        {
          requiredScopes: ['https://www.googleapis.com/auth/drive.file'],
          dangerous: true,
        }
      ),
      async (params, context) => {
        await this.makeRequest(
          context.connectionId,
          'DELETE',
          `${DRIVE_API_BASE}/files/${params.fileId}`,
          { timeout: 300000 } // 5 minutes
        );

        return {
          success: true,
          message: `File ${params.fileId} deleted successfully`,
        };
      }
    );

    // Create folder
    this.registerTool(
      createToolSchema(
        'drive_create_folder',
        'google',
        'Create a folder in Google Drive',
        'POST',
        [
          createParameter('name', 'string', 'Folder name', { required: true }),
          createParameter('parentId', 'string', 'Parent folder ID', { required: false }),
        ],
        { requiredScopes: ['https://www.googleapis.com/auth/drive.file'] }
      ),
      async (params, context) => {
        const metadata: any = {
          name: params.name,
          mimeType: 'application/vnd.google-apps.folder',
        };

        if (params.parentId) {
          metadata.parents = [params.parentId];
        }

        const data = await this.makeRequest(
          context.connectionId,
          'POST',
          `${DRIVE_API_BASE}/files`,
          { body: metadata, timeout: 300000 } // 5 minutes
        );

        return data;
      }
    );

    // Share file
    this.registerTool(
      createToolSchema(
        'drive_share_file',
        'google',
        'Share a file with another user',
        'POST',
        [
          createParameter('fileId', 'string', 'File ID', { required: true }),
          createParameter('email', 'string', 'Email address to share with', { required: true }),
          createParameter('role', 'string', 'Permission role', {
            required: false,
            enum: ['reader', 'writer', 'commenter'],
            default: 'reader',
          }),
        ],
        { requiredScopes: ['https://www.googleapis.com/auth/drive.file'] }
      ),
      async (params, context) => {
        const body = {
          type: 'user',
          role: params.role || 'reader',
          emailAddress: params.email,
        };

        const data = await this.makeRequest(
          context.connectionId,
          'POST',
          `${DRIVE_API_BASE}/files/${params.fileId}/permissions`,
          { body, timeout: 300000 } // 5 minutes
        );

        return data;
      }
    );

    // ===== GOOGLE SHEETS OPERATIONS =====

    // Get spreadsheet values
    this.registerTool(
      createToolSchema(
        'sheets_get_values',
        'google',
        'Get values from a spreadsheet range',
        'GET',
        [
          createParameter('spreadsheetId', 'string', 'Spreadsheet ID', { required: true }),
          createParameter('range', 'string', 'Range (e.g., Sheet1!A1:B10)', { required: true }),
        ],
        { requiredScopes: ['https://www.googleapis.com/auth/drive.file'] }
      ),
      async (params, context) => {
        const data = await this.makeRequest(
          context.connectionId,
          'GET',
          `${SHEETS_API_BASE}/spreadsheets/${params.spreadsheetId}/values/${params.range}`,
          { timeout: 300000 } // 5 minutes
        );

        return data;
      }
    );

    // Update spreadsheet values
    this.registerTool(
      createToolSchema(
        'sheets_update_values',
        'google',
        'Update values in a spreadsheet range',
        'PUT',
        [
          createParameter('spreadsheetId', 'string', 'Spreadsheet ID', { required: true }),
          createParameter('range', 'string', 'Range (e.g., Sheet1!A1:B10)', { required: true }),
          createParameter('values', 'array', 'Values to write (2D array)', { required: true }),
        ],
        { requiredScopes: ['https://www.googleapis.com/auth/drive.file'] }
      ),
      async (params, context) => {
        const body = {
          values: params.values,
        };

        const data = await this.makeRequest(
          context.connectionId,
          'PUT',
          `${SHEETS_API_BASE}/spreadsheets/${params.spreadsheetId}/values/${params.range}?valueInputOption=RAW`,
          { body, timeout: 300000 } // 5 minutes
        );

        return data;
      }
    );

    // Append spreadsheet values
    this.registerTool(
      createToolSchema(
        'sheets_append_values',
        'google',
        'Append values to a spreadsheet',
        'POST',
        [
          createParameter('spreadsheetId', 'string', 'Spreadsheet ID', { required: true }),
          createParameter('range', 'string', 'Range (e.g., Sheet1!A:B)', { required: true }),
          createParameter('values', 'array', 'Values to append (2D array)', { required: true }),
        ],
        { requiredScopes: ['https://www.googleapis.com/auth/drive.file'] }
      ),
      async (params, context) => {
        const body = {
          values: params.values,
        };

        const data = await this.makeRequest(
          context.connectionId,
          'POST',
          `${SHEETS_API_BASE}/spreadsheets/${params.spreadsheetId}/values/${params.range}:append?valueInputOption=RAW`,
          { body, timeout: 300000 } // 5 minutes
        );

        return data;
      }
    );

    // ===== GOOGLE DOCS OPERATIONS =====

    // Get document
    this.registerTool(
      createToolSchema(
        'docs_get_document',
        'google',
        'Get content of a Google Doc',
        'GET',
        [createParameter('documentId', 'string', 'Document ID', { required: true })],
        { requiredScopes: ['https://www.googleapis.com/auth/drive.file'] }
      ),
      async (params, context) => {
        const data = await this.makeRequest(
          context.connectionId,
          'GET',
          `${DOCS_API_BASE}/documents/${params.documentId}`,
          { timeout: 300000 } // 5 minutes
        );

        return data;
      }
    );

    // Create document
    this.registerTool(
      createToolSchema(
        'docs_create_document',
        'google',
        'Create a new Google Doc',
        'POST',
        [
          CommonParameters.title,
          createParameter('content', 'string', 'Initial content', { required: false }),
        ],
        { requiredScopes: ['https://www.googleapis.com/auth/drive.file'] }
      ),
      async (params, context) => {
        const body: any = {
          title: params.title,
        };

        const data = await this.makeRequest(
          context.connectionId,
          'POST',
          `${DOCS_API_BASE}/documents`,
          { body, timeout: 300000 } // 5 minutes
        );

        // If content provided, insert it
        if (params.content) {
          await this.makeRequest(
            context.connectionId,
            'POST',
            `${DOCS_API_BASE}/documents/${data.documentId}:batchUpdate`,
            {
              body: {
                requests: [
                  {
                    insertText: {
                      location: { index: 1 },
                      text: params.content,
                    },
                  },
                ],
              },
              timeout: 300000, // 5 minutes
            }
          );
        }

        return data;
      }
    );
  }
}

// Initialize and register Google Workspace tools
export function initializeGoogleMCP(): void {
  const googleMCP = new GoogleMCP();
  googleMCP.registerTools();
}
