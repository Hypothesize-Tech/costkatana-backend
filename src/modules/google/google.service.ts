import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { google, docs_v1 } from 'googleapis';
import { GoogleConnection } from '../../schemas/integration/google-connection.schema';
import { GoogleFileAccess } from '../../schemas/integration/google-file-access.schema';
import { GoogleErrors } from './utils/google-errors';
import {
  parseGoogleApiError,
  isRetryableError,
  getRetryDelay,
} from './utils/google-error-handler';
import {
  getDecryptedAccessToken,
  getDecryptedRefreshToken,
  GoogleConnectionWithTokens,
} from './utils/google-connection-tokens';
import { EncryptionService } from '../../utils/encryption';

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
  hd?: string;
}

export interface IGoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  iconLink?: string;
  createdTime?: Date;
  modifiedTime?: Date;
  size?: number;
  parents?: string[];
}

@Injectable()
export class GoogleService {
  private readonly logger = new Logger(GoogleService.name);
  private readonly MAX_RETRIES = 3;

  constructor(
    private readonly configService: ConfigService,
    @InjectModel(GoogleConnection.name)
    private readonly googleConnectionModel: Model<GoogleConnection>,
    @InjectModel(GoogleFileAccess.name)
    private readonly googleFileAccessModel: Model<GoogleFileAccess>,
  ) {}

  private getConfig(): GoogleAuthConfig {
    const backendUrl =
      this.configService.get<string>('BACKEND_URL') ?? 'http://localhost:8000';
    return {
      clientId: this.configService.get<string>('GOOGLE_CLIENT_ID'),
      clientSecret: this.configService.get<string>('GOOGLE_CLIENT_SECRET'),
      redirectUri:
        this.configService.get<string>('GOOGLE_CALLBACK_URL') ??
        `${backendUrl}/api/auth/oauth/google/callback`,
    };
  }

  private createOAuth2Client() {
    const config = this.getConfig();
    return new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      config.redirectUri,
    );
  }

  private async createAuthenticatedClient(
    connection: GoogleConnectionWithTokens,
  ) {
    const oauth2Client = this.createOAuth2Client();
    const accessToken = getDecryptedAccessToken(connection);
    const refreshToken = getDecryptedRefreshToken(connection);
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (connection.expiresAt && new Date() >= new Date(connection.expiresAt)) {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        if (credentials.access_token) {
          const combined = EncryptionService.encryptToCombinedFormat(
            credentials.access_token,
          );
          (connection as any).accessToken = combined;
          if (credentials.refresh_token) {
            (connection as any).refreshToken =
              EncryptionService.encryptToCombinedFormat(
                credentials.refresh_token,
              );
          }
          if (credentials.expiry_date) {
            (connection as any).expiresAt = new Date(credentials.expiry_date);
          }
          (connection as any).healthStatus = 'healthy';
          await connection.save();
          this.logger.log(
            `Google token refreshed for connection ${connection._id}`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Failed to refresh Google token: ${error instanceof Error ? error.message : String(error)}`,
        );
        (connection as any).healthStatus = 'needs_reconnect';
        await connection.save();
        throw GoogleErrors.TOKEN_REFRESH_FAILED;
      }
    }
    return oauth2Client;
  }

  async verifyTokenScopes(
    connection: GoogleConnectionWithTokens,
  ): Promise<{ scopes: string[]; hasFullDriveAccess: boolean }> {
    try {
      const accessToken = getDecryptedAccessToken(connection);
      const response = await fetch(
        `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
      );
      if (!response.ok) {
        this.logger.warn('Failed to verify token scopes', {
          connectionId: connection._id,
          status: response.status,
        });
        return { scopes: [], hasFullDriveAccess: false };
      }
      const tokenInfo = (await response.json()) as { scope?: string };
      const scopes = (tokenInfo.scope ?? '')
        .split(' ')
        .filter((s: string) => s.length > 0);
      const hasFullDriveAccess = scopes.some(
        (s: string) =>
          s.includes('drive.readonly') ||
          s.includes('https://www.googleapis.com/auth/drive.readonly') ||
          s.includes('https://www.googleapis.com/auth/drive'),
      );
      return { scopes, hasFullDriveAccess };
    } catch (error) {
      this.logger.error(
        `Error verifying token scopes: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { scopes: [], hasFullDriveAccess: false };
    }
  }

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    retryable = true,
    service = 'google',
    operationName = 'api_call',
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const parsed = parseGoogleApiError(
          error,
          service,
          operationName,
          this.logger,
        );
        const shouldRetry = retryable && isRetryableError(parsed.type);
        if (!shouldRetry) throw error;
        if (attempt === this.MAX_RETRIES - 1) throw error;
        const delay = getRetryDelay(attempt, parsed.retryAfter);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw GoogleErrors.fromGoogleError(lastError);
  }

  async getAuthenticatedUser(accessToken: string): Promise<GoogleUserInfo> {
    return this.executeWithRetry(async () => {
      const oauth2Client = this.createOAuth2Client();
      oauth2Client.setCredentials({ access_token: accessToken });
      const oauth2 = google.oauth2({
        version: 'v2',
        auth: oauth2Client,
      });
      const { data } = await oauth2.userinfo.get();
      return {
        id: data.id!,
        email: data.email!,
        verified_email: data.verified_email ?? false,
        name: data.name ?? undefined,
        given_name: data.given_name ?? undefined,
        family_name: data.family_name ?? undefined,
        picture: data.picture ?? undefined,
        locale: data.locale ?? undefined,
        hd: data.hd ?? undefined,
      };
    });
  }

  async listDriveFiles(
    connection: GoogleConnectionWithTokens,
    options?: {
      pageSize?: number;
      pageToken?: string;
      query?: string;
      orderBy?: string;
    },
  ): Promise<{ files: IGoogleDriveFile[]; nextPageToken?: string }> {
    return this.executeWithRetry(async () => {
      const auth = await this.createAuthenticatedClient(connection);
      const drive = google.drive({ version: 'v3', auth });
      let query = options?.query ?? 'trashed=false';
      if (options?.query && !options.query.includes('trashed')) {
        query = `(${options.query}) and trashed=false`;
      }
      const response = await drive.files.list({
        pageSize: options?.pageSize ?? 50,
        pageToken: options?.pageToken,
        q: query,
        orderBy: options?.orderBy ?? 'modifiedTime desc',
        fields:
          'nextPageToken, files(id, name, mimeType, webViewLink, iconLink, createdTime, modifiedTime, size, parents)',
      });
      const files: IGoogleDriveFile[] = (response.data.files ?? []).map(
        (file) => ({
          id: file.id!,
          name: file.name!,
          mimeType: file.mimeType!,
          webViewLink: file.webViewLink ?? undefined,
          iconLink: file.iconLink ?? undefined,
          createdTime: file.createdTime
            ? new Date(file.createdTime)
            : undefined,
          modifiedTime: file.modifiedTime
            ? new Date(file.modifiedTime)
            : undefined,
          size: file.size ? parseInt(file.size, 10) : undefined,
          parents: file.parents ?? undefined,
        }),
      );
      return {
        files,
        nextPageToken: response.data.nextPageToken ?? undefined,
      };
    });
  }

  extractFileIdFromLink(linkOrId: string): string | null {
    if (/^[a-zA-Z0-9_-]+$/.test(linkOrId) && linkOrId.length > 20) {
      return linkOrId;
    }
    const pattern1 = /\/(?:file\/d|d|folders)\/([a-zA-Z0-9_-]+)/;
    const match1 = linkOrId.match(pattern1);
    if (match1) return match1[1];
    const pattern2 = /[?&]id=([a-zA-Z0-9_-]+)/;
    const match2 = linkOrId.match(pattern2);
    if (match2) return match2[1];
    const pattern3 =
      /\/(document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/;
    const match3 = linkOrId.match(pattern3);
    if (match3) return match3[2];
    return null;
  }

  async getDriveFileFromLink(
    connection: GoogleConnectionWithTokens,
    linkOrId: string,
  ): Promise<IGoogleDriveFile> {
    const fileId = this.extractFileIdFromLink(linkOrId);
    if (!fileId) throw new Error('Invalid Google Drive link or file ID');
    return this.getDriveFile(connection, fileId);
  }

  async getDriveFile(
    connection: GoogleConnectionWithTokens,
    fileId: string,
  ): Promise<IGoogleDriveFile> {
    return this.executeWithRetry(async () => {
      const auth = await this.createAuthenticatedClient(connection);
      const drive = google.drive({ version: 'v3', auth });
      const attempts = [
        { supportsAllDrives: true, acknowledgeAbuse: true },
        { supportsAllDrives: true },
        {},
      ];
      let lastError: unknown;
      for (let i = 0; i < attempts.length; i++) {
        try {
          const response = await drive.files.get({
            fileId,
            fields:
              'id, name, mimeType, webViewLink, iconLink, createdTime, modifiedTime, size, parents, capabilities, permissions, shared, ownedByMe',
            ...attempts[i],
          });
          const file = response.data;
          return {
            id: file.id!,
            name: file.name!,
            mimeType: file.mimeType!,
            webViewLink: file.webViewLink ?? undefined,
            iconLink: file.iconLink ?? undefined,
            createdTime: file.createdTime
              ? new Date(file.createdTime)
              : undefined,
            modifiedTime: file.modifiedTime
              ? new Date(file.modifiedTime)
              : undefined,
            size: file.size ? parseInt(file.size, 10) : undefined,
            parents: file.parents ?? undefined,
          };
        } catch (error) {
          lastError = error;
          const err = error as { code?: number };
          if (err.code !== 404 && err.code !== 403) break;
          if (i < attempts.length - 1) {
            await new Promise((r) => setTimeout(r, 500 * (i + 1)));
          }
        }
      }
      const err = lastError as { code?: number; message?: string };
      const conn = connection as { googleEmail?: string };
      if (err.code === 404) {
        throw Object.assign(
          new Error(
            `File not found. Ensure the file exists and is shared with ${conn.googleEmail ?? 'your email'}.`,
          ),
          { code: 404 },
        );
      }
      if (err.code === 403) {
        throw Object.assign(
          new Error(
            `Access denied. Share the file with ${conn.googleEmail ?? 'your email'}.`,
          ),
          { code: 403 },
        );
      }
      throw lastError;
    });
  }

  /**
   * Get an active Google connection for a user (with tokens) for use in attachment/content flows.
   */
  async getConnectionForUser(
    userId: string,
  ): Promise<GoogleConnectionWithTokens | null> {
    const connection = await this.googleConnectionModel
      .findOne({
        userId,
        isActive: true,
        status: 'active',
      })
      .select(
        '+encryptedAccessToken +encryptedRefreshToken +accessToken +refreshToken',
      )
      .exec();
    return connection as unknown as GoogleConnectionWithTokens | null;
  }

  /**
   * Get file content as text for AI context. Exports Google Docs/Sheets to text; downloads binary for other types and decodes when possible.
   */
  async getDriveFileContent(
    connection: GoogleConnectionWithTokens,
    fileId: string,
    mimeType: string,
  ): Promise<string> {
    return this.executeWithRetry(async () => {
      const auth = await this.createAuthenticatedClient(connection);
      const drive = google.drive({ version: 'v3', auth });
      const opts = { supportsAllDrives: true };

      const googleAppDocs = 'application/vnd.google-apps.document';
      const googleAppSheets = 'application/vnd.google-apps.spreadsheet';

      if (mimeType === googleAppDocs) {
        const res = await drive.files.export({
          fileId,
          mimeType: 'text/plain',
          ...opts,
        });
        const data = res.data as string | Buffer | undefined;
        if (typeof data === 'string') return data;
        if (Buffer.isBuffer(data)) return data.toString('utf-8');
        return String(data ?? '');
      }

      if (mimeType === googleAppSheets) {
        const res = await drive.files.export({
          fileId,
          mimeType: 'text/csv',
          ...opts,
        });
        const data = res.data as string | Buffer | undefined;
        if (typeof data === 'string') return data;
        if (Buffer.isBuffer(data)) return data.toString('utf-8');
        return String(data ?? '');
      }

      const res = await drive.files.get({
        fileId,
        alt: 'media',
        ...opts,
      });
      const data = res.data as string | Buffer | undefined;
      if (typeof data === 'string') return data;
      if (Buffer.isBuffer(data)) return data.toString('utf-8');
      return String(data ?? '');
    });
  }

  async createSpreadsheet(
    connection: GoogleConnectionWithTokens,
    title: string,
    data?: string[][],
  ): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
    return this.executeWithRetry(async () => {
      const auth = await this.createAuthenticatedClient(connection);
      const sheets = google.sheets({ version: 'v4', auth });
      const createResponse = await sheets.spreadsheets.create({
        requestBody: { properties: { title } },
      });
      const spreadsheetId = createResponse.data.spreadsheetId!;
      const spreadsheetUrl = createResponse.data.spreadsheetUrl!;
      if (data && data.length > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: 'Sheet1!A1',
          valueInputOption: 'RAW',
          requestBody: { values: data },
        });
      }
      try {
        await this.shareFileWithUser(connection, spreadsheetId);
      } catch (e) {
        this.logger.warn(
          `Failed to auto-share spreadsheet: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      await this.cacheFileAccess(
        String(connection.userId),
        String(connection._id),
        spreadsheetId,
        title,
        'sheets',
        'application/vnd.google-apps.spreadsheet',
        'app_created',
        { webViewLink: spreadsheetUrl },
      );
      return { spreadsheetId, spreadsheetUrl };
    });
  }

  /**
   * Get spreadsheet cell values as text (for RAG/context).
   */
  async getSpreadsheetContent(
    connectionId: string,
    spreadsheetId: string,
    range = 'Sheet1!A1:Z100',
  ): Promise<string[][] | null> {
    const connection = await this.googleConnectionModel
      .findById(connectionId)
      .select(
        '+accessToken +refreshToken +encryptedAccessToken +encryptedRefreshToken',
      )
      .exec();
    if (!connection) return null;
    const conn = connection as unknown as GoogleConnectionWithTokens & {
      save: () => Promise<unknown>;
    };
    try {
      return await this.executeWithRetry(async () => {
        const auth = await this.createAuthenticatedClient(conn);
        const sheets = google.sheets({ version: 'v4', auth });
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range,
        });
        const values = response.data.values;
        return (values as string[][]) ?? null;
      });
    } catch {
      return null;
    }
  }

  async createDocument(
    connection: GoogleConnectionWithTokens,
    title: string,
  ): Promise<{ documentId: string; documentUrl: string }> {
    return this.executeWithRetry(async () => {
      const auth = await this.createAuthenticatedClient(connection);
      const docs = google.docs({ version: 'v1', auth });
      const response = await docs.documents.create({
        requestBody: { title },
      });
      const documentId = response.data.documentId!;
      const documentUrl = `https://docs.google.com/document/d/${documentId}/edit`;
      try {
        await this.shareFileWithUser(connection, documentId);
      } catch (e) {
        this.logger.warn(
          `Failed to auto-share document: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      await this.cacheFileAccess(
        String(connection.userId),
        String(connection._id),
        documentId,
        title,
        'docs',
        'application/vnd.google-apps.document',
        'app_created',
        { webViewLink: documentUrl },
      );
      return { documentId, documentUrl };
    });
  }

  async shareFileWithUser(
    connection: GoogleConnectionWithTokens,
    fileId: string,
    role: 'reader' | 'writer' | 'commenter' = 'writer',
  ): Promise<{ success: boolean; permissionId: string }> {
    return this.executeWithRetry(async () => {
      const auth = await this.createAuthenticatedClient(connection);
      const oauth2 = google.oauth2({ version: 'v2', auth });
      const userInfo = await oauth2.userinfo.get();
      const userEmail = userInfo.data.email;
      if (!userEmail) throw new Error('Could not retrieve user email');
      const drive = google.drive({ version: 'v3', auth });
      const response = await drive.permissions.create({
        fileId,
        requestBody: { type: 'user', role, emailAddress: userEmail },
        fields: 'id',
      });
      return {
        success: true,
        permissionId: response.data.id!,
      };
    });
  }

  async createFolder(
    connection: GoogleConnectionWithTokens,
    name: string,
    parentId?: string,
  ): Promise<{ id: string; name: string; webViewLink?: string }> {
    return this.executeWithRetry(async () => {
      const auth = await this.createAuthenticatedClient(connection);
      const drive = google.drive({ version: 'v3', auth });
      const body: { name: string; mimeType: string; parents?: string[] } = {
        name,
        mimeType: 'application/vnd.google-apps.folder',
      };
      if (parentId) body.parents = [parentId];
      const response = await drive.files.create({
        requestBody: body,
        fields: 'id, name, webViewLink',
      });
      const id = response.data.id!;
      const webViewLink = `https://drive.google.com/drive/folders/${id}`;
      return {
        id,
        name: response.data.name ?? name,
        webViewLink: response.data.webViewLink ?? webViewLink,
      };
    });
  }

  async appendToSpreadsheet(
    connection: GoogleConnectionWithTokens,
    spreadsheetId: string,
    values: string[][],
    range = 'Sheet1',
  ): Promise<{ updatedRows: number }> {
    return this.executeWithRetry(async () => {
      const auth = await this.createAuthenticatedClient(connection);
      const sheets = google.sheets({ version: 'v4', auth });
      const response = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${range}!A:Z`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values },
      });
      const updatedRows = response.data.updates?.updatedRows ?? values.length;
      return { updatedRows };
    });
  }

  async updateSpreadsheet(
    connection: GoogleConnectionWithTokens,
    spreadsheetId: string,
    range: string,
    values: string[][],
  ): Promise<{ updatedCells: number }> {
    return this.executeWithRetry(async () => {
      const auth = await this.createAuthenticatedClient(connection);
      const sheets = google.sheets({ version: 'v4', auth });
      const response = await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values },
      });
      const updatedCells = response.data.updatedCells ?? values.flat().length;
      return { updatedCells };
    });
  }

  async formatCostReportDocument(
    connection: GoogleConnectionWithTokens,
    documentId: string,
    data: {
      title: string;
      generatedDate: Date;
      startDate?: Date;
      endDate?: Date;
      summary: {
        totalCost: number;
        totalTokens: number;
        totalRequests: number;
        averageCost: number;
      };
      topModels: Array<{
        _id?: string;
        totalCost: number;
        requests: number;
        avgCost: number;
      }>;
      costByDate: Array<{
        _id: string;
        dailyCost: number;
        dailyRequests: number;
      }>;
      includeRecommendations: boolean;
    },
  ): Promise<void> {
    return this.executeWithRetry(async () => {
      const auth = await this.createAuthenticatedClient(connection);
      const docs = google.docs({ version: 'v1', auth });
      const requests: docs_v1.Schema$Request[] = [];
      let currentIndex = 1;
      const addText = (text: string) => {
        requests.push({
          insertText: { location: { index: currentIndex }, text },
        });
        currentIndex += text.length;
        return { start: currentIndex - text.length, end: currentIndex };
      };

      addText('COST KATANA\n');
      addText(`${data.title}\n\n`);
      const dateStr = `${data.startDate ? data.startDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'All time'} - ${data.endDate ? data.endDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Present'}`;
      addText(
        `Report Period: ${dateStr}\nGenerated: ${data.generatedDate.toLocaleString()}\n\n`,
      );
      addText('EXECUTIVE SUMMARY\n\n');
      addText(`Total AI Costs: $${data.summary.totalCost.toFixed(2)}\n`);
      addText(`Total Requests: ${data.summary.totalRequests}\n`);
      addText(`Total Tokens: ${data.summary.totalTokens}\n`);
      addText(
        `Avg Cost per Request: $${data.summary.averageCost.toFixed(4)}\n\n`,
      );
      if (data.topModels?.length) {
        addText('TOP MODELS BY COST\n\n');
        data.topModels.forEach((model, i) => {
          addText(
            `${i + 1}. ${model._id ?? 'Unknown'} - $${model.totalCost.toFixed(2)} (${model.requests} requests)\n`,
          );
        });
        addText('\n');
      }
      if (data.costByDate?.length) {
        addText('DAILY COST TRENDS\n\n');
        data.costByDate.slice(-7).forEach((day) => {
          addText(
            `${day._id} $${day.dailyCost.toFixed(2)} ${day.dailyRequests} requests\n`,
          );
        });
        addText('\n');
      }
      if (data.includeRecommendations) {
        addText(
          'RECOMMENDATIONS: Enable Cortex optimization, semantic caching, budget alerts.\n\n',
        );
      }
      addText('Generated by Cost Katana - https://costkatana.com\n');
      await docs.documents.batchUpdate({
        documentId,
        requestBody: { requests },
      });
    });
  }

  async listDocuments(
    connection: GoogleConnectionWithTokens,
    maxResults = 20,
  ): Promise<
    Array<{
      id: string;
      name: string;
      createdTime: string;
      modifiedTime: string;
      webViewLink: string;
    }>
  > {
    return this.executeWithRetry(async () => {
      const auth = await this.createAuthenticatedClient(connection);
      const drive = google.drive({ version: 'v3', auth });
      const response = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.document' and trashed=false",
        pageSize: maxResults,
        fields: 'files(id,name,createdTime,modifiedTime,webViewLink)',
        orderBy: 'modifiedTime desc',
      });
      return (response.data.files ?? []).map((file) => ({
        id: file.id!,
        name: file.name!,
        createdTime: file.createdTime!,
        modifiedTime: file.modifiedTime!,
        webViewLink: file.webViewLink!,
      }));
    });
  }

  async listSpreadsheets(
    connection: GoogleConnectionWithTokens,
    maxResults = 20,
  ): Promise<
    Array<{
      id: string;
      name: string;
      createdTime: string;
      modifiedTime: string;
      webViewLink: string;
    }>
  > {
    return this.executeWithRetry(async () => {
      const auth = await this.createAuthenticatedClient(connection);
      const drive = google.drive({ version: 'v3', auth });
      const response = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
        pageSize: maxResults,
        fields: 'files(id,name,createdTime,modifiedTime,webViewLink)',
        orderBy: 'modifiedTime desc',
      });
      return (response.data.files ?? []).map((file) => ({
        id: file.id!,
        name: file.name!,
        createdTime: file.createdTime!,
        modifiedTime: file.modifiedTime!,
        webViewLink: file.webViewLink!,
      }));
    });
  }

  async getDocumentContent(
    connectionId: string,
    docId: string,
  ): Promise<{ success: boolean; content: string }> {
    const connection = await this.googleConnectionModel
      .findById(connectionId)
      .select(
        '+accessToken +refreshToken +encryptedAccessToken +encryptedRefreshToken',
      )
      .exec();
    if (!connection) throw new Error('Connection not found');
    const conn = connection as unknown as GoogleConnectionWithTokens & {
      save: () => Promise<unknown>;
    };
    return this.executeWithRetry(async () => {
      const auth = await this.createAuthenticatedClient(conn);
      const docs = google.docs({ version: 'v1', auth });
      const response = await docs.documents.get({ documentId: docId });
      let text = '';
      const content = response.data.body?.content ?? [];
      for (const element of content) {
        if (element.paragraph) {
          for (const el of element.paragraph.elements ?? []) {
            if (el.textRun?.content) text += el.textRun.content;
          }
        }
      }
      return { success: true, content: text };
    });
  }

  async cacheFileAccess(
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
    },
  ): Promise<void> {
    const { Types } = await import('mongoose');
    const userObjectId = new Types.ObjectId(userId);
    const connectionObjectId = new Types.ObjectId(connectionId);
    await this.googleFileAccessModel.findOneAndUpdate(
      { userId: userObjectId, fileId },
      {
        $set: {
          userId: userObjectId,
          googleConnectionId: connectionObjectId,
          connectionId: connectionObjectId,
          fileId,
          fileName,
          fileType,
          mimeType,
          accessMethod,
          lastAccessedAt: new Date(),
          lastAccessed: new Date(),
          webViewLink: metadata?.webViewLink,
          metadata: {
            size: metadata?.size,
            createdTime: metadata?.createdTime,
            modifiedTime: metadata?.modifiedTime,
            iconLink: metadata?.iconLink,
          },
          fileMetadata: {
            fileId,
            name: fileName,
            mimeType,
            size: metadata?.size ?? 0,
            modifiedTime: new Date(),
            webViewLink: metadata?.webViewLink,
          },
        },
      },
      { upsert: true, new: true },
    );
  }

  async checkFileAccess(userId: string, fileId: string): Promise<boolean> {
    const { Types } = await import('mongoose');
    const userObjectId = new Types.ObjectId(userId);
    const access = await this.googleFileAccessModel
      .findOne({ userId: userObjectId, fileId })
      .exec();
    if (access) {
      access.lastAccessedAt = new Date();
      access.lastAccessed = new Date();
      await access.save();
      return true;
    }
    return false;
  }

  async getAccessibleFiles(
    userId: string,
    connectionId: string,
    fileType?: 'docs' | 'sheets' | 'drive',
  ): Promise<unknown[]> {
    const { Types } = await import('mongoose');
    const userObjectId = new Types.ObjectId(userId);
    const connectionObjectId = new Types.ObjectId(connectionId);
    const query: Record<string, unknown> = {
      userId: userObjectId,
      $or: [
        { googleConnectionId: connectionObjectId },
        { connectionId: connectionObjectId },
      ],
    };
    if (fileType) query.fileType = fileType;
    const files = await this.googleFileAccessModel
      .find(query)
      .sort({ lastAccessedAt: -1 })
      .limit(50)
      .lean()
      .exec();
    return files.map((f: any) => ({
      id: f.fileId ?? f.fileMetadata?.fileId,
      name: f.fileName ?? f.fileMetadata?.name,
      mimeType: f.mimeType ?? f.fileMetadata?.mimeType,
      webViewLink: f.webViewLink ?? f.fileMetadata?.webViewLink,
      iconLink: f.metadata?.iconLink,
      createdTime: f.metadata?.createdTime,
      modifiedTime: f.metadata?.modifiedTime,
      size: f.metadata?.size,
      accessMethod: f.accessMethod,
      lastAccessedAt: f.lastAccessedAt ?? f.lastAccessed,
    }));
  }

  async checkConnectionHealth(connection: GoogleConnectionWithTokens): Promise<{
    healthy: boolean;
    status: 'healthy' | 'needs_reconnect' | 'error';
    message: string;
  }> {
    try {
      const accessToken = getDecryptedAccessToken(connection);
      await this.getAuthenticatedUser(accessToken);
      return {
        healthy: true,
        status: 'healthy',
        message: 'Connection is healthy',
      };
    } catch (error) {
      const standardError = GoogleErrors.fromGoogleError(error);
      if (standardError.code === 'GOOGLE_TOKEN_EXPIRED') {
        return {
          healthy: false,
          status: 'needs_reconnect',
          message: 'Token expired, reconnection required',
        };
      }
      return {
        healthy: false,
        status: 'error',
        message: standardError.userMessage,
      };
    }
  }

  /**
   * Send email via Gmail API. Requires gmail.send scope.
   */
  async sendGmail(
    connection: GoogleConnectionWithTokens,
    params: {
      to: string;
      subject: string;
      body: string;
      cc?: string;
      bcc?: string;
    },
  ): Promise<{ messageId: string; threadId: string }> {
    return this.executeWithRetry(
      async () => {
        const auth = await this.createAuthenticatedClient(connection);
        const gmail = google.gmail({ version: 'v1', auth });
        const utf8Subject = `=?utf-8?B?${Buffer.from(params.subject, 'utf-8').toString('base64')}?=`;
        const raw = [
          `To: ${params.to}`,
          params.cc ? `Cc: ${params.cc}` : '',
          params.bcc ? `Bcc: ${params.bcc}` : '',
          `Subject: ${utf8Subject}`,
          'MIME-Version: 1.0',
          'Content-Type: text/plain; charset=utf-8',
          '',
          params.body,
        ]
          .filter(Boolean)
          .join('\r\n');
        const encoded = Buffer.from(raw)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
        const { data } = await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw: encoded },
        });
        return {
          messageId: data.id!,
          threadId: data.threadId!,
        };
      },
      true,
      'gmail',
      'send',
    );
  }

  /**
   * List calendar events. Requires calendar.readonly or calendar scope.
   */
  async listCalendarEvents(
    connection: GoogleConnectionWithTokens,
    params: {
      calendarId?: string;
      timeMin?: Date;
      timeMax?: Date;
      maxResults?: number;
    } = {},
  ): Promise<
    Array<{
      id: string;
      summary?: string;
      start?: string;
      end?: string;
      htmlLink?: string;
    }>
  > {
    return this.executeWithRetry(
      async () => {
        const auth = await this.createAuthenticatedClient(connection);
        const calendar = google.calendar({ version: 'v3', auth });
        const { data } = await calendar.events.list({
          calendarId: params.calendarId ?? 'primary',
          timeMin: params.timeMin?.toISOString(),
          timeMax: params.timeMax?.toISOString(),
          maxResults: params.maxResults ?? 20,
          singleEvents: true,
          orderBy: 'startTime',
        });
        return (data.items ?? []).map((e) => ({
          id: e.id!,
          summary: e.summary,
          start: e.start?.dateTime ?? e.start?.date,
          end: e.end?.dateTime ?? e.end?.date,
          htmlLink: e.htmlLink,
        }));
      },
      true,
      'calendar',
      'list',
    );
  }
}
