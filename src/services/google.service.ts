import { google } from 'googleapis';
import { IGoogleConnection, IGoogleDriveFile } from '../models/GoogleConnection';
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

    // Required OAuth scopes for each operation
    // Note: gmail.modify and gmail.compose removed (not used in codebase)
    private static readonly REQUIRED_SCOPES: Record<string, string> = {
        'gmail.send': 'https://www.googleapis.com/auth/gmail.send',
        'gmail.read': 'https://www.googleapis.com/auth/gmail.readonly',
        'calendar': 'https://www.googleapis.com/auth/calendar',
        'calendar.readonly': 'https://www.googleapis.com/auth/calendar.readonly',
        'calendar.events': 'https://www.googleapis.com/auth/calendar.events',
        'drive': 'https://www.googleapis.com/auth/drive',
        'drive.file': 'https://www.googleapis.com/auth/drive.file',
        'drive.readonly': 'https://www.googleapis.com/auth/drive.readonly',
        'drive.metadata.readonly': 'https://www.googleapis.com/auth/drive.metadata.readonly',
        'documents': 'https://www.googleapis.com/auth/documents',
        'documents.readonly': 'https://www.googleapis.com/auth/documents.readonly',
        'spreadsheets': 'https://www.googleapis.com/auth/spreadsheets',
        'spreadsheets.readonly': 'https://www.googleapis.com/auth/spreadsheets.readonly'
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
            gmail: {
                send: ['gmail.send'],
                read: ['gmail.read'],
                search: ['gmail.read'],
                list: ['gmail.read']
            },
            calendar: {
                create: ['calendar'],
                update: ['calendar'],
                delete: ['calendar'],
                list: ['calendar.readonly'],
                search: ['calendar.readonly']
            },
            drive: {
                search: ['drive.readonly'],
                list: ['drive.readonly'],
                upload: ['drive'],
                delete: ['drive'],
                share: ['drive']
            },
            gdocs: {
                read: ['documents.readonly'],
                create: ['documents'],
                update: ['documents']
            },
            sheets: {
                read: ['spreadsheets.readonly'],
                create: ['spreadsheets'],
                update: ['spreadsheets']
            }
        };

        const serviceScopes = scopeMap[service.toLowerCase()] || {};
        return serviceScopes[operation.toLowerCase()] || ['drive']; // Default to drive scope
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
     * Drive API: Get file metadata
     */
    static async getDriveFile(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        fileId: string
    ): Promise<IGoogleDriveFile> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const drive = google.drive({ version: 'v3', auth });

            const response = await drive.files.get({
                fileId,
                fields: 'id, name, mimeType, webViewLink, iconLink, createdTime, modifiedTime, size, parents'
            });

            const file = response.data;

            loggingService.info('Retrieved Google Drive file', {
                connectionId: connection._id,
                fileId,
                fileName: file.name
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
     * Calendar API: Create calendar event
     */
    static async createCalendarEvent(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        summary: string,
        start: Date,
        end: Date,
        description?: string,
        attendees?: string[]
    ): Promise<{ eventId: string; eventLink: string }> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const calendar = google.calendar({ version: 'v3', auth });

            const event = {
                summary,
                description,
                start: {
                    dateTime: start.toISOString(),
                    timeZone: 'UTC'
                },
                end: {
                    dateTime: end.toISOString(),
                    timeZone: 'UTC'
                },
                attendees: attendees?.map(email => ({ email }))
            };

            const response = await calendar.events.insert({
                calendarId: 'primary',
                requestBody: event
            });

            const eventId = response.data.id!;
            const eventLink = response.data.htmlLink!;

            loggingService.info('Created Google Calendar event', {
                connectionId: connection._id,
                eventId,
                summary
            });

            return { eventId, eventLink };
        });
    }

    /**
     * Decode RFC 2047 MIME-encoded headers (e.g., non-ASCII subjects/names)
     */
    private static decodeMIMEHeader(header: string): string {
        if (!header) return header;
        
        try {
            // Handle =?charset?encoding?text?= format
            const mimePattern = /=\?([^?]+)\?([BQbq])\?([^?]+)\?=/g;
            
            return header.replace(mimePattern, (match, charset, encoding, text) => {
                try {
                    if (encoding.toUpperCase() === 'B') {
                        // Base64 encoding
                        return Buffer.from(text, 'base64').toString('utf-8');
                    } else if (encoding.toUpperCase() === 'Q') {
                        // Quoted-printable encoding
                        const decoded = text
                            .replace(/_/g, ' ')
                            .replace(/=([0-9A-F]{2})/g, (_: any, hex: string) => 
                                String.fromCharCode(parseInt(hex, 16))
                            );
                        return decoded;
                    }
                    return match;
                } catch (e) {
                    return match;
                }
            });
        } catch (error) {
            loggingService.warn('Failed to decode MIME header', { header, error });
            return header;
        }
    }

    /**
     * Extract clean email address from "Name <email>" format
     */
    private static extractEmail(fromField: string): { name: string; email: string } {
        if (!fromField) return { name: 'Unknown', email: '' };
        
        const match = fromField.match(/(.+?)\s*<(.+?)>/);
        if (match) {
            return {
                name: this.decodeMIMEHeader(match[1].trim().replace(/^["']|["']$/g, '')),
                email: match[2].trim()
            };
        }
        
        // If no angle brackets, treat entire string as email
        return { name: '', email: fromField.trim() };
    }

    /**
     * Clean HTML snippet for display
     */
    private static cleanSnippet(snippet: string): string {
        if (!snippet) return '';
        
        return snippet
            .replace(/<[^>]+>/g, '') // Remove HTML tags
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/\s+/g, ' ') // Collapse whitespace
            .trim()
            .substring(0, 200); // Limit length
    }

    /**
     * Gmail API: List messages with full details
     */
    static async listGmailMessages(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        query: string = 'is:inbox',
        maxResults: number = 20,
        includeSpam: boolean = false,
        includeTrashed: boolean = false
    ): Promise<Array<{ 
        id: string; 
        threadId: string; 
        subject: string; 
        from: string; 
        fromName: string;
        fromEmail: string;
        to?: string;
        date: string; 
        snippet: string; 
        labels: string[];
        isUnread: boolean;
    }>> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const gmail = google.gmail({ version: 'v1', auth });

            // Build query with spam/trash filters
            let finalQuery = query;
            if (!includeSpam && !finalQuery.includes('in:spam')) {
                finalQuery += ' -in:spam';
            }
            if (!includeTrashed && !finalQuery.includes('in:trash')) {
                finalQuery += ' -in:trash';
            }

            const response = await gmail.users.messages.list({
                userId: 'me',
                q: finalQuery,
                maxResults
            });

            const messages = response.data.messages || [];
            const detailedMessages = [];

            for (const message of messages) {
                try {
                    const details = await gmail.users.messages.get({
                        userId: 'me',
                        id: message.id!,
                        format: 'metadata',
                        metadataHeaders: ['From', 'Subject', 'Date', 'To']
                    });

                    const headers = details.data.payload?.headers || [];
                    const rawSubject = headers.find(h => h.name === 'Subject')?.value || '(No subject)';
                    const rawFrom = headers.find(h => h.name === 'From')?.value || 'Unknown';
                    const to = headers.find(h => h.name === 'To')?.value;
                    const date = headers.find(h => h.name === 'Date')?.value || '';
                    
                    // Decode MIME-encoded headers
                    const subject = this.decodeMIMEHeader(rawSubject);
                    const fromParsed = this.extractEmail(rawFrom);
                    const labels = details.data.labelIds || [];
                    const isUnread = labels.includes('UNREAD');

                    detailedMessages.push({
                        id: message.id!,
                        threadId: message.threadId || details.data.threadId || message.id!,
                        subject,
                        from: `${fromParsed.name || fromParsed.email}`,
                        fromName: fromParsed.name || fromParsed.email,
                        fromEmail: fromParsed.email,
                        to: to || undefined,
                        date,
                        snippet: this.cleanSnippet(details.data.snippet || ''),
                        labels,
                        isUnread
                    });
                } catch (error: any) {
                    loggingService.warn('Failed to fetch message details', {
                        messageId: message.id,
                        error: error.message
                    });
                    // Skip messages that fail to load instead of failing entire request
                }
            }

            loggingService.info('Listed Gmail messages with details', {
                connectionId: connection._id,
                messageCount: detailedMessages.length,
                query: finalQuery
            });

            return detailedMessages;
        }, true, 'gmail', 'list');
    }

    /**
     * Gmail API: Get message
     */
    static async getGmailMessage(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        messageId: string
    ): Promise<{ id: string; subject: string; from: string; date: string; body: string }> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const gmail = google.gmail({ version: 'v1', auth });

            const response = await gmail.users.messages.get({
                userId: 'me',
                id: messageId,
                format: 'full'
            });

            const message = response.data;
            const headers = message.payload?.headers || [];
            const subject = headers.find(h => h.name === 'Subject')?.value || '';
            const from = headers.find(h => h.name === 'From')?.value || '';
            const date = headers.find(h => h.name === 'Date')?.value || '';

            // Extract body
            let body = '';
            if (message.payload?.parts) {
                const textPart = message.payload.parts.find(p => p.mimeType === 'text/plain');
                if (textPart?.body?.data) {
                    body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
                }
            } else if (message.payload?.body?.data) {
                body = Buffer.from(message.payload.body.data, 'base64').toString('utf-8');
            }

            loggingService.info('Retrieved Gmail message', {
                connectionId: connection._id,
                messageId,
                subject
            });

            return { id: messageId, subject, from, date, body };
        });
    }

    /**
     * Gmail API: Send email
     */
    static async sendEmail(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        to: string | string[],
        subject: string,
        body: string,
        isHtml: boolean = false
    ): Promise<{ messageId: string; success: boolean }> {
        // Verify Gmail send scope before attempting to send
        const scopeValidation = await this.validateScopes(connection, ['gmail.send']);
        if (!scopeValidation.valid) {
            throw new Error('Gmail send permission is missing. Please reconnect your Google account with send permissions.');
        }

        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const gmail = google.gmail({ version: 'v1', auth });

            const recipients = Array.isArray(to) ? to.join(', ') : to;
            const messageParts = [
                `To: ${recipients}`,
                `Subject: ${subject}`,
                `Content-Type: ${isHtml ? 'text/html' : 'text/plain'}; charset=utf-8`,
                '',
                body
            ];

            const message = messageParts.join('\n');
            const encodedMessage = Buffer.from(message)
                .toString('base64')
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');

            const response = await gmail.users.messages.send({
                userId: 'me',
                requestBody: {
                    raw: encodedMessage
                }
            });

            loggingService.info('Sent Gmail message', {
                connectionId: connection._id,
                messageId: response.data.id,
                to: recipients,
                subject
            });

            return {
                messageId: response.data.id!,
                success: true
            };
        });
    }

    /**
     * Gmail API: Search emails
     */
    static async searchGmailMessages(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        query: string,
        maxResults: number = 20
    ): Promise<Array<{ id: string; threadId?: string; subject: string; from: string; date: string; snippet: string }>> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const gmail = google.gmail({ version: 'v1', auth });

            const response = await gmail.users.messages.list({
                userId: 'me',
                q: query,
                maxResults
            });

            const messages = response.data.messages || [];
            const detailedMessages = [];

            for (const message of messages) {
                const details = await gmail.users.messages.get({
                    userId: 'me',
                    id: message.id!,
                    format: 'metadata',
                    metadataHeaders: ['From', 'Subject', 'Date']
                });

                const headers = details.data.payload?.headers || [];
                const rawSubject = headers.find(h => h.name === 'Subject')?.value || '(No subject)';
                const rawFrom = headers.find(h => h.name === 'From')?.value || 'Unknown';
                const date = headers.find(h => h.name === 'Date')?.value || '';

                // Decode MIME-encoded headers
                const subject = this.decodeMIMEHeader(rawSubject);
                const fromParsed = this.extractEmail(rawFrom);

                // Convert null to undefined for threadId to match return type (string | undefined, not string | null | undefined)
                const rawThreadId = message.threadId ?? details.data.threadId;
                const threadId: string | undefined = rawThreadId === null ? undefined : rawThreadId;
                
                detailedMessages.push({
                    id: message.id!,
                    threadId,
                    subject,
                    from: `${fromParsed.name || fromParsed.email}`,
                    date,
                    snippet: this.cleanSnippet(details.data.snippet || '')
                });
            }

            loggingService.info('Searched Gmail messages', {
                connectionId: connection._id,
                query,
                resultsCount: detailedMessages.length
            });

            return detailedMessages;
        });
    }

    /**
     * Calendar API: List events
     */
    static async listCalendarEvents(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        startDate?: Date,
        endDate?: Date,
        maxResults: number = 10
    ): Promise<Array<{ 
        id: string; 
        summary: string; 
        start: { dateTime?: string; date?: string }; 
        end: { dateTime?: string; date?: string }; 
        description?: string;
        location?: string;
        htmlLink?: string;
        attendees?: Array<{ email: string; displayName?: string }>;
    }>> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const calendar = google.calendar({ version: 'v3', auth });

            const response = await calendar.events.list({
                calendarId: 'primary',
                timeMin: startDate?.toISOString(),
                timeMax: endDate?.toISOString(),
                maxResults,
                singleEvents: true,
                orderBy: 'startTime'
            });

            const events = (response.data.items || []).map(event => ({
                id: event.id!,
                summary: event.summary || '(No Title)',
                start: {
                    dateTime: event.start?.dateTime || undefined,
                    date: event.start?.date || undefined
                },
                end: {
                    dateTime: event.end?.dateTime || undefined,
                    date: event.end?.date || undefined
                },
                description: event.description || undefined,
                location: event.location || undefined,
                htmlLink: event.htmlLink || undefined,
                attendees: event.attendees?.map((a: any) => ({
                    email: a.email,
                    displayName: a.displayName || a.email
                })) || undefined
            }));

            loggingService.info('Listed Calendar events', {
                connectionId: connection._id,
                eventsCount: events.length
            });

            return events;
        });
    }

    /**
     * Calendar API: Update event
     */
    static async updateCalendarEvent(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        eventId: string,
        updates: {
            summary?: string;
            description?: string;
            start?: Date;
            end?: Date;
            attendees?: string[];
        }
    ): Promise<{ eventId: string; success: boolean }> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const calendar = google.calendar({ version: 'v3', auth });

            const updateBody: any = {};
            if (updates.summary) updateBody.summary = updates.summary;
            if (updates.description) updateBody.description = updates.description;
            if (updates.start) {
                updateBody.start = {
                    dateTime: updates.start.toISOString(),
                    timeZone: 'UTC'
                };
            }
            if (updates.end) {
                updateBody.end = {
                    dateTime: updates.end.toISOString(),
                    timeZone: 'UTC'
                };
            }
            if (updates.attendees) {
                updateBody.attendees = updates.attendees.map(email => ({ email }));
            }

            await calendar.events.patch({
                calendarId: 'primary',
                eventId,
                requestBody: updateBody
            });

            loggingService.info('Updated Calendar event', {
                connectionId: connection._id,
                eventId
            });

            return { eventId, success: true };
        });
    }

    /**
     * Calendar API: Delete event
     */
    static async deleteCalendarEvent(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        eventId: string
    ): Promise<{ success: boolean }> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const calendar = google.calendar({ version: 'v3', auth });

            await calendar.events.delete({
                calendarId: 'primary',
                eventId
            });

            loggingService.info('Deleted Calendar event', {
                connectionId: connection._id,
                eventId
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
        
        // Upsert file access record
        await GoogleFileAccess.findOneAndUpdate(
            { userId, fileId },
            {
                userId,
                connectionId,
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
        
        const access = await GoogleFileAccess.findOne({ userId, fileId });
        
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
     */
    static async getAccessibleFiles(
        userId: string,
        connectionId: string,
        fileType?: 'docs' | 'sheets' | 'drive'
    ): Promise<any[]> {
        const { GoogleFileAccess } = await import('../models/GoogleFileAccess');
        
        const query: any = { userId, connectionId };
        if (fileType) {
            query.fileType = fileType;
        }
        
        const files = await GoogleFileAccess.find(query)
            .sort({ lastAccessedAt: -1 })
            .limit(50);
        
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

}


