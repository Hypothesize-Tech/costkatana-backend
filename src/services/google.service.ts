import { google } from 'googleapis';
import mongoose from 'mongoose';
import { GoogleConnection, IGoogleConnection, IGoogleDriveFile } from '../models/GoogleConnection';
import { loggingService } from './logging.service';
import { GoogleErrors} from '../utils/googleErrors';
import { parseGoogleApiError, isRetryableError, getRetryDelay } from '../utils/googleErrorHandler';

export interface GoogleAuthConfig {
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
}

export interface GoogleTokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    token_type: string;
}

export interface GoogleUserInfo {
    id: string;
    email: string;
    verified_email: boolean;
    name?: string;
    given_name?: string;
    family_name?: string;
    picture?: string;
    locale?: string;
    hd?: string; // Hosted domain (for Google Workspace accounts)
}

export class GoogleService {
    private static config: GoogleAuthConfig = {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        redirectUri: process.env.GOOGLE_CALLBACK_URL || `${process.env.BACKEND_URL || 'http://localhost:8000'}/api/auth/oauth/google/callback`
    };

    private static readonly MAX_RETRIES = 3;
    private static readonly RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff
    private static readonly REQUIRED_SCOPES: Record<string, string> = {
        'profile': 'https://www.googleapis.com/auth/userinfo.profile',
        'email': 'https://www.googleapis.com/auth/userinfo.email',
        'drive.file': 'https://www.googleapis.com/auth/drive.file'  // Access files created by app or explicitly shared
    };

    /**
     * Create OAuth2 client
     */
    private static createOAuth2Client() {
        return new google.auth.OAuth2(
            this.config.clientId,
            this.config.clientSecret,
            this.config.redirectUri
        );
    }

    /**
     * Create authenticated OAuth2 client from connection
     */
    private static async createAuthenticatedClient(connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined }) {
        const oauth2Client = this.createOAuth2Client();
        const accessToken = connection.decryptToken();
        const refreshToken = connection.decryptRefreshToken?.();

        oauth2Client.setCredentials({
            access_token: accessToken,
            refresh_token: refreshToken
        });

        // Check if token is expired and refresh if needed
        if (connection.expiresAt && new Date() >= connection.expiresAt) {
            try {
                const { credentials } = await oauth2Client.refreshAccessToken();
                if (credentials.access_token) {
                    connection.accessToken = connection.encryptToken(credentials.access_token);
                    if (credentials.refresh_token) {
                        connection.refreshToken = connection.encryptToken(credentials.refresh_token);
                    }
                    if (credentials.expiry_date) {
                        connection.expiresAt = new Date(credentials.expiry_date);
                    }
                    connection.healthStatus = 'healthy';
                    await connection.save();

                    loggingService.info('Google token refreshed successfully', {
                        connectionId: connection._id,
                        userId: connection.userId
                    });
                }
            } catch (error: any) {
                loggingService.error('Failed to refresh Google token', {
                    connectionId: connection._id,
                    userId: connection.userId,
                    error: error.message
                });
                connection.healthStatus = 'needs_reconnect';
                await connection.save();
                throw GoogleErrors.TOKEN_REFRESH_FAILED;
            }
        }

        return oauth2Client;
    }

    /**
     * Verify token scopes by calling Google's tokeninfo endpoint
     * This helps detect actual scopes even if not stored in database
     */
    static async verifyTokenScopes(connection: IGoogleConnection & { decryptToken: () => string }): Promise<{ scopes: string[]; hasFullDriveAccess: boolean }> {
        try {
            const accessToken = connection.decryptToken();
            const response = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
            
            if (!response.ok) {
                loggingService.warn('Failed to verify token scopes', {
                    connectionId: connection._id,
                    status: response.status
                });
                return { scopes: [], hasFullDriveAccess: false };
            }

            const tokenInfo = await response.json() as { scope?: string; [key: string]: any };
            const scopes = (tokenInfo.scope || '').split(' ').filter((s: string) => s.length > 0);
            
            const hasFullDriveAccess = scopes.some((scope: string) => 
                scope.includes('drive.readonly') || 
                scope.includes('https://www.googleapis.com/auth/drive.readonly') ||
                scope.includes('https://www.googleapis.com/auth/drive')
            );

            loggingService.info('Verified token scopes', {
                connectionId: connection._id,
                scopesCount: scopes.length,
                hasFullDriveAccess,
                scopes: scopes.slice(0, 5) // Log first 5 scopes
            });

            return { scopes, hasFullDriveAccess };
        } catch (error: any) {
            loggingService.error('Error verifying token scopes', {
                connectionId: connection._id,
                error: error.message
            });
            return { scopes: [], hasFullDriveAccess: false };
        }
    }

    /**
     * Validate if connection has required OAuth scopes
     */
    static async validateScopes(
        connection: IGoogleConnection,
        requiredScopes: string[]
    ): Promise<{ valid: boolean; missing: string[] }> {
        const connectionScopes = connection.scope?.split(' ') || [];
        const missing: string[] = [];

        for (const scope of requiredScopes) {
            const scopeUrl = this.REQUIRED_SCOPES[scope] || scope;
            if (!connectionScopes.includes(scopeUrl)) {
                missing.push(scope);
            }
        }

        if (missing.length > 0) {
            loggingService.warn('Missing OAuth scopes', {
                connectionId: connection._id,
                userId: connection.userId,
                requiredScopes,
                missingScopes: missing
            });
        }

        return {
            valid: missing.length === 0,
            missing
        };
    }

    /**
     * Get required scopes for an operation
     */
    static getRequiredScopes(service: string, operation: string): string[] {
        const scopeMap: Record<string, Record<string, string[]>> = {
            drive: {
                search: ['drive.file'],
                list: ['drive.file'],
                upload: ['drive.file'],
                delete: ['drive.file'],
                share: ['drive.file']
            },
            gdocs: {
                read: ['drive.file'],
                create: ['drive.file'],
                update: ['drive.file']
            },
            sheets: {
                read: ['drive.file'],
                create: ['drive.file'],
                update: ['drive.file']
            }
        };

        const serviceScopes = scopeMap[service.toLowerCase()] || {};
        return serviceScopes[operation.toLowerCase()] || ['drive.file']; // Default to drive.file scope
    }

    /**
     * Execute API call with retry logic and enhanced error handling
     */
    private static async executeWithRetry<T>(
        operation: () => Promise<T>,
        retryable: boolean = true,
        service: string = 'google',
        operationName: string = 'api_call'
    ): Promise<T> {
        let lastError: any;

        for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
            try {
                return await operation();
            } catch (error: any) {
                lastError = error;
                
                // Use new error handler to parse the error
                const parsedError = parseGoogleApiError(error, service, operationName);
                
                // Check if error is retryable using new error handler
                const shouldRetry = retryable && isRetryableError(parsedError.type);

                // Don't retry if error is not retryable
                if (!shouldRetry) {
                    loggingService.error('Google API error (not retryable)', {
                        service,
                        operation: operationName,
                        errorType: parsedError.type,
                        message: parsedError.userMessage
                    });
                    throw error; // Throw original error for compatibility
                }

                // Don't retry on last attempt
                if (attempt === this.MAX_RETRIES - 1) {
                    loggingService.error('Google API error (max retries exceeded)', {
                        service,
                        operation: operationName,
                        attempts: this.MAX_RETRIES,
                        errorType: parsedError.type,
                        message: parsedError.userMessage
                    });
                    throw error;
                }

                // Calculate retry delay (respects Retry-After header if present)
                const delay = getRetryDelay(attempt, parsedError.retryAfter);
                
                loggingService.warn(`Google API call failed, retrying in ${delay}ms`, {
                    service,
                    operation: operationName,
                    attempt: attempt + 1,
                    maxRetries: this.MAX_RETRIES,
                    errorType: parsedError.type,
                    retryAfter: parsedError.retryAfter
                });
                
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw GoogleErrors.fromGoogleError(lastError);
    }

    /**
     * Get authenticated user info from Google
     */
    static async getAuthenticatedUser(accessToken: string): Promise<GoogleUserInfo> {
        return this.executeWithRetry(async () => {
            const oauth2Client = this.createOAuth2Client();
            oauth2Client.setCredentials({ access_token: accessToken });

            const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
            const { data } = await oauth2.userinfo.get();

            loggingService.info('Retrieved Google user info', {
                email: data.email,
                domain: data.hd
            });

            return {
                id: data.id!,
                email: data.email!,
                verified_email: data.verified_email ?? false,
                name: data.name || undefined,
                given_name: data.given_name || undefined,
                family_name: data.family_name || undefined,
                picture: data.picture || undefined,
                locale: data.locale || undefined,
                hd: data.hd || undefined
            };
        });
    }

    /**
     * Exchange authorization code for tokens
     */
    static async exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
        return this.executeWithRetry(async () => {
            const oauth2Client = this.createOAuth2Client();
            const { tokens } = await oauth2Client.getToken(code);

            if (!tokens.access_token) {
                throw new Error('No access token received from Google');
            }

            loggingService.info('Google OAuth tokens exchanged successfully');

            return {
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token || undefined,
                expires_in: tokens.expiry_date ? Math.floor((tokens.expiry_date - Date.now()) / 1000) : 3600,
                scope: tokens.scope || '',
                token_type: tokens.token_type || 'Bearer'
            };
        }, false); // Don't retry token exchange
    }

    /**
     * Drive API: List files
     */
    static async listDriveFiles(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        options?: {
            pageSize?: number;
            pageToken?: string;
            query?: string;
            orderBy?: string;
        }
    ): Promise<{ files: IGoogleDriveFile[]; nextPageToken?: string }> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const drive = google.drive({ version: 'v3', auth });

            // Default query excludes trashed files unless explicitly included in user query
            // IMPORTANT: This lists ALL personal files, not just app-created ones
            // Requires 'drive.readonly' scope (not 'drive.file' which only allows app-created files)
            // Users with old 'drive.file' scope need to reconnect to see personal files
            let query = options?.query;
            if (!query) {
                // No app-only filters - lists all user's Drive files
                query = "trashed=false";
            } else if (!query.includes('trashed')) {
                // If user provided a query but didn't specify trashed status, exclude trashed files
                query = `(${query}) and trashed=false`;
            }

            const response = await drive.files.list({
                pageSize: options?.pageSize || 50,
                pageToken: options?.pageToken,
                q: query,
                orderBy: options?.orderBy || 'modifiedTime desc',
                fields: 'nextPageToken, files(id, name, mimeType, webViewLink, iconLink, createdTime, modifiedTime, size, parents)'
            });

            const files: IGoogleDriveFile[] = (response.data.files || []).map(file => ({
                id: file.id!,
                name: file.name!,
                mimeType: file.mimeType!,
                webViewLink: file.webViewLink || undefined,
                iconLink: file.iconLink || undefined,
                createdTime: file.createdTime ? new Date(file.createdTime) : undefined,
                modifiedTime: file.modifiedTime ? new Date(file.modifiedTime) : undefined,
                size: file.size ? parseInt(file.size) : undefined,
                parents: file.parents || undefined
            }));

            loggingService.info('Listed Google Drive files', {
                connectionId: connection._id,
                filesCount: files.length,
                query: query.substring(0, 100), // Log first 100 chars of query for debugging
                hasPersonalFiles: files.length > 0 // Indicates if any files were returned
            });

            return {
                files,
                nextPageToken: response.data.nextPageToken || undefined
            };
        });
    }

    /**
     * Extract file ID from various Google Drive link formats
     * Supports:
     * - https://drive.google.com/file/d/FILE_ID/view
     * - https://drive.google.com/open?id=FILE_ID
     * - https://docs.google.com/document/d/FILE_ID/edit
     * - https://docs.google.com/spreadsheets/d/FILE_ID/edit
     * - https://docs.google.com/presentation/d/FILE_ID/edit
     * - Direct file ID
     */
    static extractFileIdFromLink(linkOrId: string): string | null {
        // If it's already just a file ID (alphanumeric with dashes/underscores)
        if (/^[a-zA-Z0-9_-]+$/.test(linkOrId) && linkOrId.length > 20) {
            return linkOrId;
        }

        // Pattern 1: /file/d/FILE_ID/ or /d/FILE_ID/
        const pattern1 = /\/(?:file\/d|d|folders)\/([a-zA-Z0-9_-]+)/;
        const match1 = linkOrId.match(pattern1);
        if (match1) {
            return match1[1];
        }

        // Pattern 2: ?id=FILE_ID or &id=FILE_ID
        const pattern2 = /[?&]id=([a-zA-Z0-9_-]+)/;
        const match2 = linkOrId.match(pattern2);
        if (match2) {
            return match2[1];
        }

        // Pattern 3: Google Docs/Sheets/Slides URLs
        const pattern3 = /\/(document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/;
        const match3 = linkOrId.match(pattern3);
        if (match3) {
            return match3[2];
        }

        return null;
    }

    /**
     * Drive API: Get file metadata from link or ID
     * Supports public links and files shared with the authenticated user
     */
    static async getDriveFileFromLink(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        linkOrId: string
    ): Promise<IGoogleDriveFile> {
        const fileId = this.extractFileIdFromLink(linkOrId);
        
        if (!fileId) {
            throw new Error('Invalid Google Drive link or file ID');
        }

        loggingService.info('Accessing file from link', {
            connectionId: connection._id,
            linkProvided: linkOrId.substring(0, 50) + '...',
            extractedFileId: fileId
        });

        return this.getDriveFile(connection, fileId);
    }

    /**
     * Drive API: Get file metadata
     * Supports files owned by user, shared with user, and publicly accessible files
     */
    static async getDriveFile(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        fileId: string
    ): Promise<IGoogleDriveFile> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const drive = google.drive({ version: 'v3', auth });

            // Try multiple times with different options due to Google's permission propagation delay
            const attempts = [
                // Attempt 1: Standard request with all drives support
                { supportsAllDrives: true, acknowledgeAbuse: true },
                // Attempt 2: Without acknowledgeAbuse
                { supportsAllDrives: true },
                // Attempt 3: Standard request
                {}
            ];

            let lastError: any;

            for (let i = 0; i < attempts.length; i++) {
                try {
                    const options = attempts[i];
                    loggingService.info(`Attempting to fetch file (attempt ${i + 1}/${attempts.length})`, {
                        connectionId: connection._id,
                        fileId,
                        options
                    });

                    const response = await drive.files.get({
                        fileId,
                        fields: 'id, name, mimeType, webViewLink, iconLink, createdTime, modifiedTime, size, parents, capabilities, permissions, shared, ownedByMe',
                        ...options
                    });

                    const file = response.data;

                    loggingService.info('Retrieved Google Drive file', {
                        connectionId: connection._id,
                        fileId,
                        fileName: file.name,
                        isShared: file.shared,
                        ownedByMe: file.ownedByMe,
                        hasPermissions: !!file.permissions && file.permissions.length > 0,
                        permissionsCount: file.permissions?.length || 0,
                        attemptNumber: i + 1
                    });

                    return {
                        id: file.id!,
                        name: file.name!,
                        mimeType: file.mimeType!,
                        webViewLink: file.webViewLink || undefined,
                        iconLink: file.iconLink || undefined,
                        createdTime: file.createdTime ? new Date(file.createdTime) : undefined,
                        modifiedTime: file.modifiedTime ? new Date(file.modifiedTime) : undefined,
                        size: file.size ? parseInt(file.size) : undefined,
                        parents: file.parents || undefined
                    };
                } catch (error: any) {
                    lastError = error;
                    loggingService.warn(`Attempt ${i + 1} failed`, {
                        connectionId: connection._id,
                        fileId,
                        errorCode: error.code,
                        errorMessage: error.message
                    });

                    // If it's not a 404 or 403, break early
                    if (error.code !== 404 && error.code !== 403) {
                        break;
                    }

                    // Wait a bit before next attempt (only between attempts, not after last one)
                    if (i < attempts.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)));
                    }
                }
            }

            // All attempts failed, throw the last error with helpful message
            const error = lastError;
            if (error.code === 404) {
                loggingService.warn('Google Drive file not found after all attempts', {
                    connectionId: connection._id,
                    fileId,
                    userEmail: connection.googleEmail,
                    error: error.message
                });
                throw Object.assign(
                    new Error(`File not found. Please ensure:\n1. The file exists\n2. The file is shared with ${connection.googleEmail}\n3. Or set sharing to "Anyone with the link can view" AND share directly with ${connection.googleEmail}\n\n💡 Note: Google permissions can take 1-2 minutes to propagate. Please wait and try again.`),
                    { code: 404 }
                );
            } else if (error.code === 403) {
                loggingService.warn('Google Drive file access denied after all attempts', {
                    connectionId: connection._id,
                    fileId,
                    userEmail: connection.googleEmail,
                    error: error.message
                });
                throw Object.assign(
                    new Error(`Access denied. The file owner needs to share this file with your email: ${connection.googleEmail}\n\nNote: "Anyone with the link" is not enough for API access. Please ask the file owner to explicitly add ${connection.googleEmail} as a viewer.\n\n💡 Tip: After sharing, wait 1-2 minutes for Google permissions to propagate, then try again.`),
                    { code: 403 }
                );
            } else {
                loggingService.error('Failed to get Google Drive file', {
                    connectionId: connection._id,
                    fileId,
                    error: error.message,
                    errorCode: error.code
                });
                throw error;
            }
        });
    }

    /**
     * Sheets API: Create spreadsheet
     */
    static async createSpreadsheet(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        title: string,
        data?: any[][]
    ): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const sheets = google.sheets({ version: 'v4', auth });

            // Create spreadsheet
            const createResponse = await sheets.spreadsheets.create({
                requestBody: {
                    properties: {
                        title
                    }
                }
            });

            const spreadsheetId = createResponse.data.spreadsheetId!;
            const spreadsheetUrl = createResponse.data.spreadsheetUrl!;

            // Add data if provided
            if (data && data.length > 0) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: 'Sheet1!A1',
                    valueInputOption: 'RAW',
                    requestBody: {
                        values: data
                    }
                });
            }

            loggingService.info('Created Google Spreadsheet', {
                connectionId: connection._id,
                spreadsheetId,
                title,
                rowCount: data?.length || 0
            });

            // Share the spreadsheet with the authenticated user
            try {
                await this.shareFileWithUser(connection, spreadsheetId);
            } catch (shareError: any) {
                loggingService.warn('Failed to auto-share spreadsheet with user', {
                    spreadsheetId,
                    error: shareError.message
                });
                // Don't fail the entire operation if sharing fails
            }

            // Auto-cache the created spreadsheet
            await this.cacheFileAccess(
                connection.userId.toString(),
                connection._id.toString(),
                spreadsheetId,
                title,
                'sheets',
                'application/vnd.google-apps.spreadsheet',
                'app_created',
                { webViewLink: spreadsheetUrl }
            );

            return { spreadsheetId, spreadsheetUrl };
        });
    }

    /**
     * Sheets API: Append rows to spreadsheet
     */
    static async appendToSpreadsheet(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        spreadsheetId: string,
        range: string,
        values: any[][]
    ): Promise<void> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const sheets = google.sheets({ version: 'v4', auth });

            await sheets.spreadsheets.values.append({
                spreadsheetId,
                range,
                valueInputOption: 'RAW',
                requestBody: {
                    values
                }
            });

            loggingService.info('Appended to Google Spreadsheet', {
                connectionId: connection._id,
                spreadsheetId,
                range,
                rowCount: values.length
            });
        });
    }

    /**
     * Sheets API: Read spreadsheet
     */
    static async readSpreadsheet(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        spreadsheetId: string,
        range: string
    ): Promise<any[][]> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const sheets = google.sheets({ version: 'v4', auth });

            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range
            });

            const values = response.data.values || [];

            loggingService.info('Read Google Spreadsheet', {
                connectionId: connection._id,
                spreadsheetId,
                range,
                rowCount: values.length
            });

            return values;
        });
    }

    /**
     * Docs API: Create document
     */
    static async createDocument(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        title: string
    ): Promise<{ documentId: string; documentUrl: string }> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const docs = google.docs({ version: 'v1', auth });

            const response = await docs.documents.create({
                requestBody: {
                    title
                }
            });

            const documentId = response.data.documentId!;
            const documentUrl = `https://docs.google.com/document/d/${documentId}/edit`;

            loggingService.info('Created Google Document', {
                connectionId: connection._id,
                documentId,
                title
            });

            // Share the document with the authenticated user
            try {
                await this.shareFileWithUser(connection, documentId);
            } catch (shareError: any) {
                loggingService.warn('Failed to auto-share document with user', {
                    documentId,
                    error: shareError.message
                });
                // Don't fail the entire operation if sharing fails
            }

            // Auto-cache the created document
            await this.cacheFileAccess(
                connection.userId.toString(),
                connection._id.toString(),
                documentId,
                title,
                'docs',
                'application/vnd.google-apps.document',
                'app_created',
                { webViewLink: documentUrl }
            );

            return { documentId, documentUrl };
        });
    }

    /**
     * Docs API: Insert text into document
     */
    static async insertTextIntoDocument(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        documentId: string,
        text: string,
        index: number = 1
    ): Promise<void> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const docs = google.docs({ version: 'v1', auth });

            await docs.documents.batchUpdate({
                documentId,
                requestBody: {
                    requests: [
                        {
                            insertText: {
                                location: { index },
                                text
                            }
                        }
                    ]
                }
            });

            loggingService.info('Inserted text into Google Document', {
                connectionId: connection._id,
                documentId,
                textLength: text.length
            });
        });
    }

    /**
     * Sheets API: Get cell values from a range
     */
    static async getSheetValues(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        spreadsheetId: string,
        range: string
    ): Promise<any[][]> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const sheets = google.sheets({ version: 'v4', auth });

            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range
            });

            loggingService.info('Retrieved sheet values', {
                connectionId: connection._id,
                spreadsheetId,
                range,
                rowCount: response.data.values?.length || 0
            });

            return response.data.values || [];
        });
    }

    /**
     * Sheets API: Update cell values in a range
     */
    static async updateSheetValues(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        spreadsheetId: string,
        range: string,
        values: any[][]
    ): Promise<{ updatedCells: number; updatedRows: number }> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const sheets = google.sheets({ version: 'v4', auth });

            const response = await sheets.spreadsheets.values.update({
                spreadsheetId,
                range,
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values
                }
            });

            loggingService.info('Updated sheet values', {
                connectionId: connection._id,
                spreadsheetId,
                range,
                updatedCells: response.data.updatedCells,
                updatedRows: response.data.updatedRows
            });

            return {
                updatedCells: response.data.updatedCells || 0,
                updatedRows: response.data.updatedRows || 0
            };
        });
    }

    /**
     * Docs API: Read document
     */
    static async readDocument(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        documentId: string
    ): Promise<string> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const docs = google.docs({ version: 'v1', auth });

            const response = await docs.documents.get({ documentId });

            // Extract text from document
            let text = '';
            const content = response.data.body?.content || [];
            for (const element of content) {
                if (element.paragraph) {
                    const paragraph = element.paragraph;
                    for (const textElement of paragraph.elements || []) {
                        if (textElement.textRun) {
                            text += textElement.textRun.content || '';
                        }
                    }
                }
            }

            loggingService.info('Read Google Document', {
                connectionId: connection._id,
                documentId,
                textLength: text.length
            });

            return text;
        });
    }

    /**
     * Docs API: Insert text into document
     */
    static async insertTextInDocument(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        documentId: string,
        text: string,
        index: number = 1
    ): Promise<{ success: boolean }> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const docs = google.docs({ version: 'v1', auth });

            await docs.documents.batchUpdate({
                documentId,
                requestBody: {
                    requests: [{
                        insertText: {
                            location: { index },
                            text
                        }
                    }]
                }
            });

            loggingService.info('Inserted text into Google Document', {
                connectionId: connection._id,
                documentId,
                textLength: text.length
            });

            return { success: true };
        });
    }

    /**
     * Drive API: Upload file
     */
    static async uploadFileToDrive(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        fileName: string,
        mimeType: string,
        fileContent: Buffer | string,
        folderId?: string
    ): Promise<{ fileId: string; fileUrl: string }> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const drive = google.drive({ version: 'v3', auth });

            const fileMetadata: any = {
                name: fileName,
                mimeType
            };

            if (folderId) {
                fileMetadata.parents = [folderId];
            }

            const response = await drive.files.create({
                requestBody: fileMetadata,
                media: {
                    mimeType,
                    body: typeof fileContent === 'string' ? fileContent : fileContent.toString()
                },
                fields: 'id, webViewLink'
            });

            loggingService.info('Uploaded file to Drive', {
                connectionId: connection._id,
                fileId: response.data.id,
                fileName
            });

            return {
                fileId: response.data.id!,
                fileUrl: response.data.webViewLink!
            };
        });
    }

    /**
     * Drive API: Share file
     */
    static async shareFile(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        fileId: string,
        emailAddress: string,
        role: 'reader' | 'writer' | 'commenter' = 'reader'
    ): Promise<{ success: boolean; permissionId: string }> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const drive = google.drive({ version: 'v3', auth });

            const response = await drive.permissions.create({
                fileId,
                requestBody: {
                    type: 'user',
                    role,
                    emailAddress
                },
                fields: 'id'
            });

            loggingService.info('Shared Drive file', {
                connectionId: connection._id,
                fileId,
                emailAddress,
                role
            });

            return {
                success: true,
                permissionId: response.data.id!
            };
        });
    }

    /**
     * Drive API: Share file with the authenticated user
     */
    static async shareFileWithUser(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        fileId: string,
        role: 'reader' | 'writer' | 'commenter' = 'writer'
    ): Promise<{ success: boolean; permissionId: string }> {
        return this.executeWithRetry(async () => {
            // Get user's email from their Google account
            const auth = await this.createAuthenticatedClient(connection);
            const oauth2 = google.oauth2({ version: 'v2', auth });
            
            const userInfo = await oauth2.userinfo.get();
            const userEmail = userInfo.data.email;
            
            if (!userEmail) {
                throw new Error('Could not retrieve user email from Google account');
            }

            // Share the file with the user
            const drive = google.drive({ version: 'v3', auth });

            const response = await drive.permissions.create({
                fileId,
                requestBody: {
                    type: 'user',
                    role,
                    emailAddress: userEmail
                },
                fields: 'id'
            });

            loggingService.info('Shared file with authenticated user', {
                connectionId: connection._id,
                fileId,
                userEmail,
                role
            });

            return {
                success: true,
                permissionId: response.data.id!
            };
        });
    }

    /**
     * Drive API: Create folder
     */
    static async createFolder(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        folderName: string,
        parentFolderId?: string
    ): Promise<{ folderId: string; folderUrl: string }> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const drive = google.drive({ version: 'v3', auth });

            const fileMetadata: any = {
                name: folderName,
                mimeType: 'application/vnd.google-apps.folder'
            };

            if (parentFolderId) {
                fileMetadata.parents = [parentFolderId];
            }

            const response = await drive.files.create({
                requestBody: fileMetadata,
                fields: 'id, webViewLink'
            });

            loggingService.info('Created Drive folder', {
                connectionId: connection._id,
                folderId: response.data.id,
                folderName
            });

            return {
                folderId: response.data.id!,
                folderUrl: response.data.webViewLink!
            };
        });
    }

    /**
     * Check connection health
     */
    static async checkConnectionHealth(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined }
    ): Promise<{ healthy: boolean; status: 'healthy' | 'needs_reconnect' | 'error'; message: string }> {
        try {
            // Try to get user info to verify token is valid
            const accessToken = connection.decryptToken();
            await this.getAuthenticatedUser(accessToken);

            return {
                healthy: true,
                status: 'healthy',
                message: 'Connection is healthy'
            };
        } catch (error: any) {
            const standardError = GoogleErrors.fromGoogleError(error);

            if (standardError.code === 'GOOGLE_TOKEN_EXPIRED') {
                return {
                    healthy: false,
                    status: 'needs_reconnect',
                    message: 'Token expired, reconnection required'
                };
            }

            return {
                healthy: false,
                status: 'error',
                message: standardError.userMessage
            };
        }
    }

    /**
     * List Google Docs Documents
     */
    static async listDocuments(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        maxResults: number = 20
    ): Promise<Array<{ id: string; name: string; createdTime: string; modifiedTime: string; webViewLink: string }>> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const drive = google.drive({ version: 'v3', auth });

            const response = await drive.files.list({
                q: "mimeType='application/vnd.google-apps.document' and trashed=false",
                pageSize: maxResults,
                fields: 'files(id,name,createdTime,modifiedTime,webViewLink)',
                orderBy: 'modifiedTime desc'
            });

            loggingService.info('Listed Google Documents', {
                connectionId: connection._id,
                count: response.data.files?.length || 0
            });

            return response.data.files?.map(file => ({
                id: file.id!,
                name: file.name!,
                createdTime: file.createdTime!,
                modifiedTime: file.modifiedTime!,
                webViewLink: file.webViewLink!
            })) || [];
        });
    }

    /**
     * List Google Sheets Spreadsheets
     */
    static async listSpreadsheets(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        maxResults: number = 20
    ): Promise<Array<{ id: string; name: string; createdTime: string; modifiedTime: string; webViewLink: string }>> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const drive = google.drive({ version: 'v3', auth });

            const response = await drive.files.list({
                q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
                pageSize: maxResults,
                fields: 'files(id,name,createdTime,modifiedTime,webViewLink)',
                orderBy: 'modifiedTime desc'
            });

            loggingService.info('Listed Google Spreadsheets', {
                connectionId: connection._id,
                count: response.data.files?.length || 0
            });

            return response.data.files?.map(file => ({
                id: file.id!,
                name: file.name!,
                createdTime: file.createdTime!,
                modifiedTime: file.modifiedTime!,
                webViewLink: file.webViewLink!
            })) || [];
        });
    }

    /**
     * Cache file access from picker selection or app creation
     */
    static async cacheFileAccess(
        userId: string,
        connectionId: string,
        fileId: string,
        fileName: string,
        fileType: 'docs' | 'sheets' | 'drive',
        mimeType: string,
        accessMethod: 'app_created' | 'picker_selected',
        metadata?: {
            webViewLink?: string;
            size?: number;
            createdTime?: string;
            modifiedTime?: string;
            iconLink?: string;
        }
    ): Promise<void> {
        const { GoogleFileAccess } = await import('../models/GoogleFileAccess');
        
        // Convert to ObjectId
        const userObjectId = new mongoose.Types.ObjectId(userId);
        const connectionObjectId = new mongoose.Types.ObjectId(connectionId);
        
        // Upsert file access record
        await GoogleFileAccess.findOneAndUpdate(
            { userId: userObjectId, fileId },
            {
                userId: userObjectId,
                connectionId: connectionObjectId,
                fileId,
                fileName,
                fileType,
                mimeType,
                accessMethod,
                lastAccessedAt: new Date(),
                webViewLink: metadata?.webViewLink,
                metadata: {
                    size: metadata?.size,
                    createdTime: metadata?.createdTime,
                    modifiedTime: metadata?.modifiedTime,
                    iconLink: metadata?.iconLink
                }
            },
            { upsert: true, new: true }
        );

        loggingService.info('Cached file access', {
            userId,
            fileId,
            fileName,
            accessMethod
        });
    }

    /**
     * Check if user has access to a file
     */
    static async checkFileAccess(
        userId: string,
        fileId: string
    ): Promise<boolean> {
        const { GoogleFileAccess } = await import('../models/GoogleFileAccess');
        
        const userObjectId = new mongoose.Types.ObjectId(userId);
        const access = await GoogleFileAccess.findOne({ userId: userObjectId, fileId });
        
        if (access) {
            // Update last accessed time
            access.lastAccessedAt = new Date();
            await access.save();
            return true;
        }
        
        return false;
    }

    /**
     * Get accessible files for user
     * Used internally by other services (chat, retrieval, integrationChat)
     */
    static async getAccessibleFiles(
        userId: string,
        connectionId: string,
        fileType?: 'docs' | 'sheets' | 'drive'
    ): Promise<any[]> {
        const { GoogleFileAccess } = await import('../models/GoogleFileAccess');
        
        // Convert to ObjectId
        const userObjectId = new mongoose.Types.ObjectId(userId);
        const connectionObjectId = new mongoose.Types.ObjectId(connectionId);
        
        const query: any = { userId: userObjectId, connectionId: connectionObjectId };
        if (fileType) {
            query.fileType = fileType;
        }
        
        loggingService.info('Querying GoogleFileAccess collection', {
            userId,
            connectionId,
            fileType,
            query: JSON.stringify(query)
        });
        
        const files = await GoogleFileAccess.find(query)
            .sort({ lastAccessedAt: -1 })
            .limit(50);
        
        loggingService.info('GoogleFileAccess query result', {
            userId,
            connectionId,
            fileType,
            filesFound: files.length
        });
        
        return files.map(file => ({
            id: file.fileId,
            name: file.fileName,
            mimeType: file.mimeType,
            webViewLink: file.webViewLink,
            iconLink: file.metadata?.iconLink,
            createdTime: file.metadata?.createdTime,
            modifiedTime: file.metadata?.modifiedTime,
            size: file.metadata?.size,
            accessMethod: file.accessMethod,
            lastAccessedAt: file.lastAccessedAt
        }));
    }

    /**
     * Search accessible files by name
     * Used internally by integrationChat service
     */
    static async searchAccessibleFiles(
        userId: string,
        connectionId: string,
        searchQuery: string,
        fileType?: 'docs' | 'sheets' | 'drive'
    ): Promise<any[]> {
        const { GoogleFileAccess } = await import('../models/GoogleFileAccess');
        
        const query: any = {
            userId,
            connectionId,
            fileName: { $regex: searchQuery, $options: 'i' }
        };
        
        if (fileType) {
            query.fileType = fileType;
        }
        
        const files = await GoogleFileAccess.find(query)
            .sort({ lastAccessedAt: -1 })
            .limit(20);
        
        return files.map(file => ({
            id: file.fileId,
            name: file.fileName,
            mimeType: file.mimeType,
            webViewLink: file.webViewLink,
            accessMethod: file.accessMethod,
            lastAccessedAt: file.lastAccessedAt
        }));
    }

    /**
     * Cleanup old file access records (older than 90 days)
     */
    static async cleanupOldFileAccess(): Promise<number> {
        const { GoogleFileAccess } = await import('../models/GoogleFileAccess');
        
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        
        const result = await GoogleFileAccess.deleteMany({
            lastAccessedAt: { $lt: ninetyDaysAgo }
        });
        
        loggingService.info('Cleaned up old file access records', {
            deletedCount: result.deletedCount
        });
        
        return result.deletedCount || 0;
    }

    /**
     * DISABLED METHODS - Gmail and Calendar features removed (using drive.file scope only)
     * These methods exist for backward compatibility but return errors
     */
    static async sendEmail(...args: any[]): Promise<any> {
        throw new Error('Gmail features disabled - using drive.file scope only');
    }

    static async searchGmailMessages(...args: any[]): Promise<any> {
        throw new Error('Gmail features disabled - using drive.file scope only');
    }

    static async listGmailMessages(...args: any[]): Promise<any> {
        throw new Error('Gmail features disabled - using drive.file scope only');
    }

    static async listCalendarEvents(...args: any[]): Promise<any> {
        throw new Error('Calendar features disabled - using drive.file scope only');
    }

    static async createCalendarEvent(...args: any[]): Promise<any> {
        throw new Error('Calendar features disabled - using drive.file scope only');
    }

    static async updateCalendarEvent(...args: any[]): Promise<any> {
        throw new Error('Calendar features disabled - using drive.file scope only');
    }

    static async deleteCalendarEvent(...args: any[]): Promise<any> {
        throw new Error('Calendar features disabled - using drive.file scope only');
    }

    static async getDocumentContent(connectionId: string, docId: string): Promise<any> {
        // This method should still work for files accessible via drive.file scope
        const connection = await GoogleConnection.findById(connectionId);
        if (!connection) {
            throw new Error('Connection not found');
        }
        // Implement actual document reading here
        return { success: true, content: '' };
    }

    static async getTokens(connectionId: string): Promise<any> {
        const connection = await GoogleConnection.findById(connectionId).select('+accessToken +refreshToken');
        if (!connection) {
            throw new Error('Connection not found');
        }

        // Refresh token if expired
        await this.createAuthenticatedClient(connection);

        // Reload connection to get potentially refreshed token
        const refreshedConnection = await GoogleConnection.findById(connectionId).select('+accessToken +refreshToken');
        if (!refreshedConnection) {
            throw new Error('Connection not found after refresh');
        }

        // Decrypt tokens before returning
        return {
            accessToken: refreshedConnection.decryptToken(),
            refreshToken: refreshedConnection.decryptRefreshToken?.()
        };
    }

}


