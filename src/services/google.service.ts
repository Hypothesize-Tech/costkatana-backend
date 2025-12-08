import { google } from 'googleapis';
import { IGoogleConnection, IGoogleDriveFile } from '../models/GoogleConnection';
import { loggingService } from './logging.service';
import { GoogleErrors} from '../utils/googleErrors';

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
     * Execute API call with retry logic
     */
    private static async executeWithRetry<T>(
        operation: () => Promise<T>,
        retryable: boolean = true
    ): Promise<T> {
        let lastError: any;

        for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
            try {
                return await operation();
            } catch (error: any) {
                lastError = error;
                const standardError = GoogleErrors.fromGoogleError(error);

                // Don't retry if error is not retryable
                if (!retryable || !GoogleErrors.isRetryable(standardError)) {
                    throw standardError;
                }

                // Don't retry on last attempt
                if (attempt === this.MAX_RETRIES - 1) {
                    throw standardError;
                }

                // Wait before retry with exponential backoff
                const delay = this.RETRY_DELAYS[attempt];
                loggingService.warn(`Google API call failed, retrying in ${delay}ms`, {
                    attempt: attempt + 1,
                    maxRetries: this.MAX_RETRIES,
                    error: error.message
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

            const response = await drive.files.list({
                pageSize: options?.pageSize || 100,
                pageToken: options?.pageToken,
                q: options?.query,
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
                filesCount: files.length
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
     * Gmail API: List messages
     */
    static async listGmailMessages(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        query?: string,
        maxResults: number = 10
    ): Promise<Array<{ id: string; threadId: string; snippet: string }>> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const gmail = google.gmail({ version: 'v1', auth });

            const response = await gmail.users.messages.list({
                userId: 'me',
                q: query,
                maxResults
            });

            const messages = response.data.messages || [];

            loggingService.info('Listed Gmail messages', {
                connectionId: connection._id,
                messageCount: messages.length,
                query
            });

            return messages.map(msg => ({
                id: msg.id!,
                threadId: msg.threadId!,
                snippet: ''
            }));
        });
    }

    /**
     * Slides API: Create presentation
     */
    static async createPresentation(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        title: string
    ): Promise<{ presentationId: string; presentationUrl: string }> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const slides = google.slides({ version: 'v1', auth });

            const response = await slides.presentations.create({
                requestBody: {
                    title
                }
            });

            const presentationId = response.data.presentationId!;
            const presentationUrl = `https://docs.google.com/presentation/d/${presentationId}/edit`;

            loggingService.info('Created Google Slides presentation', {
                connectionId: connection._id,
                presentationId,
                title
            });

            return { presentationId, presentationUrl };
        });
    }

    /**
     * Slides API: Add slide with text
     */
    static async addSlideWithText(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        presentationId: string,
        title: string,
        body: string
    ): Promise<void> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const slides = google.slides({ version: 'v1', auth });

            // Create a new slide
            const slideId = `slide_${Date.now()}`;
            const titleId = `title_${Date.now()}`;
            const bodyId = `body_${Date.now()}`;

            await slides.presentations.batchUpdate({
                presentationId,
                requestBody: {
                    requests: [
                        {
                            createSlide: {
                                objectId: slideId,
                                slideLayoutReference: {
                                    predefinedLayout: 'TITLE_AND_BODY'
                                }
                            }
                        },
                        {
                            insertText: {
                                objectId: titleId,
                                text: title
                            }
                        },
                        {
                            insertText: {
                                objectId: bodyId,
                                text: body
                            }
                        }
                    ]
                }
            });

            loggingService.info('Added slide to presentation', {
                connectionId: connection._id,
                presentationId,
                title
            });
        });
    }

    /**
     * Forms API: Create form
     */
    static async createForm(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        title: string,
        description?: string
    ): Promise<{ formId: string; formUrl: string; responderUri: string }> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const forms = google.forms({ version: 'v1', auth });

            const response = await forms.forms.create({
                requestBody: {
                    info: {
                        title,
                        documentTitle: title
                    }
                }
            });

            const formId = response.data.formId!;
            const formUrl = `https://docs.google.com/forms/d/${formId}/edit`;
            const responderUri = response.data.responderUri || `https://docs.google.com/forms/d/${formId}/viewform`;

            loggingService.info('Created Google Form', {
                connectionId: connection._id,
                formId,
                title
            });

            return { formId, formUrl, responderUri };
        });
    }

    /**
     * Forms API: Get form responses
     */
    static async getFormResponses(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        formId: string
    ): Promise<any[]> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const forms = google.forms({ version: 'v1', auth });

            const response = await forms.forms.responses.list({
                formId
            });

            const responses = response.data.responses || [];

            loggingService.info('Retrieved Google Form responses', {
                connectionId: connection._id,
                formId,
                responseCount: responses.length
            });

            return responses;
        });
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
    ): Promise<Array<{ id: string; subject: string; from: string; date: string; snippet: string }>> {
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
                const subject = headers.find(h => h.name === 'Subject')?.value || '(No Subject)';
                const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
                const date = headers.find(h => h.name === 'Date')?.value || '';

                detailedMessages.push({
                    id: message.id!,
                    subject,
                    from,
                    date,
                    snippet: details.data.snippet || ''
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
    ): Promise<Array<{ id: string; summary: string; start: string; end: string; description?: string }>> {
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
                start: event.start?.dateTime || event.start?.date || '',
                end: event.end?.dateTime || event.end?.date || '',
                description: event.description || undefined
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
     * Forms API: Add question to form
     */
    static async addFormQuestion(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        formId: string,
        questionText: string,
        questionType: 'TEXT' | 'PARAGRAPH_TEXT' | 'MULTIPLE_CHOICE' | 'CHECKBOX' | 'DROPDOWN' = 'TEXT',
        options?: string[]
    ): Promise<{ success: boolean; questionId: string }> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const forms = google.forms({ version: 'v1', auth });

            const questionItem: any = {
                title: questionText,
                questionItem: {
                    question: {
                        required: false,
                        [questionType === 'TEXT' || questionType === 'PARAGRAPH_TEXT' ? 'textQuestion' : 'choiceQuestion']: 
                            questionType === 'MULTIPLE_CHOICE' || questionType === 'CHECKBOX' || questionType === 'DROPDOWN' 
                                ? { 
                                    type: questionType,
                                    options: options?.map(opt => ({ value: opt })) || []
                                  }
                                : { paragraph: questionType === 'PARAGRAPH_TEXT' }
                    }
                }
            };

            const response = await forms.forms.batchUpdate({
                formId,
                requestBody: {
                    requests: [{
                        createItem: {
                            item: questionItem,
                            location: { index: 0 }
                        }
                    }]
                }
            });

            loggingService.info('Added question to Form', {
                connectionId: connection._id,
                formId,
                questionText
            });

            const questionId = response.data.replies?.[0]?.createItem?.questionId;
            return {
                success: true,
                questionId: Array.isArray(questionId) ? questionId[0] : (questionId || '')
            };
        });
    }

    /**
     * Slides API: Export presentation to PDF
     */
    static async exportPresentationToPDF(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        presentationId: string
    ): Promise<{ pdfUrl: string; fileId: string }> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const drive = google.drive({ version: 'v3', auth });

            // Export as PDF
            const response = await drive.files.export({
                fileId: presentationId,
                mimeType: 'application/pdf'
            }, {
                responseType: 'arraybuffer'
            });

            // Upload PDF to Drive
            const pdfFileName = `presentation-${presentationId}.pdf`;
            const uploadResponse = await drive.files.create({
                requestBody: {
                    name: pdfFileName,
                    mimeType: 'application/pdf'
                },
                media: {
                    mimeType: 'application/pdf',
                    body: Buffer.from(response.data as ArrayBuffer)
                },
                fields: 'id, webViewLink'
            });

            loggingService.info('Exported presentation to PDF', {
                connectionId: connection._id,
                presentationId,
                pdfFileId: uploadResponse.data.id
            });

            return {
                fileId: uploadResponse.data.id!,
                pdfUrl: uploadResponse.data.webViewLink!
            };
        });
    }

    /**
     * Slides API: Get presentation details
     */
    static async getPresentation(
        connection: IGoogleConnection & { decryptToken: () => string; decryptRefreshToken?: () => string | undefined },
        presentationId: string
    ): Promise<any> {
        return this.executeWithRetry(async () => {
            const auth = await this.createAuthenticatedClient(connection);
            const slides = google.slides({ version: 'v1', auth });

            const response = await slides.presentations.get({
                presentationId
            });

            loggingService.info('Retrieved presentation', {
                connectionId: connection._id,
                presentationId,
                slideCount: response.data.slides?.length || 0
            });

            return response.data;
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
}

