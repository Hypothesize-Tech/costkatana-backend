import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Header,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { GoogleConnection } from '../../schemas/integration/google-connection.schema';
import { GoogleExportAudit } from '../../schemas/integration/google-export-audit.schema';
import { GoogleService } from './google.service';
import { GoogleExportIntegrationService } from './google-export-integration.service';
import { GoogleErrors } from './utils/google-errors';
import { OAuthService } from '../oauth/oauth.service';
import type { GoogleConnectionWithTokens } from './utils/google-connection-tokens';

@Controller('api/google')
@UseGuards(JwtAuthGuard)
export class GoogleController {
  constructor(
    private readonly googleService: GoogleService,
    private readonly googleExportIntegration: GoogleExportIntegrationService,
    private readonly oauthService: OAuthService,
    @InjectModel(GoogleConnection.name)
    private readonly googleConnectionModel: Model<GoogleConnection>,
    @InjectModel(GoogleExportAudit.name)
    private readonly googleExportAuditModel: Model<GoogleExportAudit>,
  ) {}

  @Get('auth')
  async initiateOAuth(@CurrentUser('id') userId: string) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new BadRequestException(
        'Google OAuth is not configured on the server. Please contact support.',
      );
    }
    const { authUrl } = await this.oauthService.initiateOAuth('google', userId);
    return {
      success: true,
      data: {
        authUrl,
        scopes: [
          'openid',
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/drive.file',
        ],
      },
    };
  }

  @Get('connections')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @Header('Pragma', 'no-cache')
  async listConnections(@CurrentUser('id') userId: string) {
    const allConnections = await this.googleConnectionModel
      .find({ userId })
      .select(
        '-accessToken -refreshToken -encryptedAccessToken -encryptedRefreshToken',
      )
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    const activeConnections = allConnections.filter(
      (c: any) => c.isActive !== false,
    );
    return { success: true, data: activeConnections };
  }

  @Get('connections/:id')
  async getConnection(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    const connection = await this.googleConnectionModel
      .findOne({ _id: id, userId, isActive: true })
      .select(
        '-accessToken -refreshToken -encryptedAccessToken -encryptedRefreshToken',
      )
      .lean()
      .exec();
    if (!connection) {
      throw new BadRequestException(
        GoogleErrors.formatError(GoogleErrors.CONNECTION_NOT_FOUND).error
          .message,
      );
    }
    return { success: true, data: connection };
  }

  @Delete('connections/:id')
  async disconnectConnection(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    // Use updateOne to avoid Mongoose validation on full document
    // (can fail when required fields are missing in corrupted/legacy records)
    const result = await this.googleConnectionModel.updateOne(
      { _id: id, userId },
      { $set: { isActive: false, healthStatus: 'error' } },
    );

    if (result.matchedCount === 0) {
      throw new BadRequestException(
        GoogleErrors.formatError(GoogleErrors.CONNECTION_NOT_FOUND).error
          .message,
      );
    }

    return {
      success: true,
      message: 'Google connection disconnected successfully',
    };
  }

  @Get('connections/:id/health')
  async checkConnectionHealth(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    const connection = await this.getConnectionWithTokens(id, userId);
    const health = await this.googleService.checkConnectionHealth(connection);
    if ((connection as any).healthStatus !== health.status) {
      (connection as any).healthStatus = health.status;
      await connection.save();
    }
    return { success: true, data: health };
  }

  @Get('connections/:id/drive')
  async listDriveFiles(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query('pageSize') pageSize?: string,
    @Query('pageToken') pageToken?: string,
    @Query('query') query?: string,
    @Query('orderBy') orderBy?: string,
  ) {
    const connection = await this.getConnectionWithTokens(id, userId);
    let connectionScope = (connection as any).scope ?? '';
    let hasFullDriveAccess =
      connectionScope.includes('drive.readonly') ||
      connectionScope.includes(
        'https://www.googleapis.com/auth/drive.readonly',
      ) ||
      connectionScope.includes('https://www.googleapis.com/auth/drive');
    if (!connectionScope) {
      try {
        const tokenInfo =
          await this.googleService.verifyTokenScopes(connection);
        connectionScope = tokenInfo.scopes.join(' ');
        hasFullDriveAccess = tokenInfo.hasFullDriveAccess;
      } catch {
        // ignore
      }
    }
    const result = await this.googleService.listDriveFiles(connection, {
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      pageToken: pageToken ?? undefined,
      query: query ?? undefined,
      orderBy: orderBy ?? undefined,
    });
    const hasLimitedScope =
      !connectionScope ||
      (!hasFullDriveAccess &&
        (connectionScope.includes('drive.file') || connectionScope === ''));
    if (hasLimitedScope) {
      return {
        success: true,
        data: result,
        warning: {
          code: 'LIMITED_DRIVE_SCOPE',
          message:
            'Your Google connection has limited Drive access. Please reconnect to see all Drive files.',
          requiresReconnection: true,
          scope: connectionScope || '(not stored)',
        },
      };
    }
    return { success: true, data: result };
  }

  @Get('connections/:id/drive/:fileId')
  async getDriveFile(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('fileId') fileId: string,
  ) {
    const connection = await this.getConnectionWithTokens(id, userId);
    const file = await this.googleService.getDriveFile(connection, fileId);
    return { success: true, data: file };
  }

  @Post('export/cost-data')
  async exportCostData(
    @CurrentUser('id') userId: string,
    @Body()
    body: {
      connectionId: string;
      startDate?: string;
      endDate?: string;
      projectId?: string;
      redactionOptions?: {
        maskEmails?: boolean;
        removePrompts?: boolean;
        aggregateByTeam?: boolean;
      };
    },
  ) {
    if (!body.connectionId)
      throw new BadRequestException('connectionId is required');
    const connection = await this.getConnectionWithTokens(
      body.connectionId,
      userId,
    );
    const result = await this.googleExportIntegration.exportCostDataToSheets(
      connection,
      {
        userId,
        connectionId: body.connectionId,
        startDate: body.startDate ? new Date(body.startDate) : undefined,
        endDate: body.endDate ? new Date(body.endDate) : undefined,
        projectId: body.projectId,
        redactionOptions: body.redactionOptions,
      },
    );
    return {
      success: true,
      data: {
        spreadsheetId: result.spreadsheetId,
        spreadsheetUrl: result.spreadsheetUrl,
        auditId: (result.audit as { _id?: unknown })._id,
      },
    };
  }

  @Post('export/report')
  async createCostReport(
    @CurrentUser('id') userId: string,
    @Body()
    body: {
      connectionId: string;
      startDate?: string;
      endDate?: string;
      projectId?: string;
      includeTopModels?: boolean;
      includeRecommendations?: boolean;
    },
  ) {
    if (!body.connectionId)
      throw new BadRequestException('connectionId is required');
    const connection = await this.getConnectionWithTokens(
      body.connectionId,
      userId,
    );
    const result = await this.googleExportIntegration.createCostReportInDocs(
      connection,
      {
        userId,
        connectionId: body.connectionId,
        startDate: body.startDate ? new Date(body.startDate) : undefined,
        endDate: body.endDate ? new Date(body.endDate) : undefined,
        projectId: body.projectId,
        includeTopModels: body.includeTopModels !== false,
        includeRecommendations: body.includeRecommendations !== false,
      },
    );
    return {
      success: true,
      data: {
        documentId: result.documentId,
        documentUrl: result.documentUrl,
        auditId: (result.audit as { _id?: unknown })._id,
      },
    };
  }

  @Get('export/audits')
  async getExportAudits(
    @CurrentUser('id') userId: string,
    @Query('limit') limit = '50',
    @Query('exportType') exportType?: string,
    @Query('datasetType') datasetType?: string,
  ): Promise<{ success: boolean; data: unknown[] }> {
    const query: any = {
      userId: new (await import('mongoose')).Types.ObjectId(userId),
    };
    if (exportType) query.exportType = exportType;
    if (datasetType) query.datasetType = datasetType;
    const audits = await this.googleExportAuditModel
      .find(query)
      .sort({ exportedAt: -1 })
      .limit(parseInt(limit, 10))
      .lean()
      .exec();
    return { success: true, data: audits };
  }

  @Post('connections/:id/sheets')
  async createSpreadsheet(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body('title') title: string,
  ) {
    if (!title) throw new BadRequestException('Missing required field: title');
    const connection = await this.getConnectionWithTokens(id, userId);
    const result = await this.googleService.createSpreadsheet(
      connection,
      title,
    );
    return { success: true, data: result };
  }

  @Post('connections/:id/docs')
  async createDocument(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body('title') title: string,
  ) {
    if (!title) throw new BadRequestException('Missing required field: title');
    const connection = await this.getConnectionWithTokens(id, userId);
    const result = await this.googleService.createDocument(connection, title);
    return { success: true, data: result };
  }

  @Post('gemini/analyze')
  async analyzeCostTrends(
    @CurrentUser('id') userId: string,
    @Body() body: { startDate?: string; endDate?: string },
  ) {
    const result =
      await this.googleExportIntegration.analyzeCostTrendsWithGemini(userId, {
        startDate: body.startDate ? new Date(body.startDate) : undefined,
        endDate: body.endDate ? new Date(body.endDate) : undefined,
      });
    return { success: true, data: result };
  }

  @Post('gemini/explain-anomaly')
  async explainCostAnomaly(
    @CurrentUser('id') userId: string,
    @Body() body: { anomalyData: Record<string, unknown> },
  ) {
    const result =
      await this.googleExportIntegration.explainCostAnomalyWithGemini(
        userId,
        body.anomalyData ?? {},
      );
    return { success: true, data: result };
  }

  @Post('gemini/suggest-strategy')
  async generateOptimizationStrategy(
    @CurrentUser('id') userId: string,
    @Body()
    body: {
      constraints?: { maxBudget?: number; preferredProviders?: string[] };
    },
  ) {
    const result =
      await this.googleExportIntegration.generateOptimizationStrategy(
        userId,
        body.constraints,
      );
    return { success: true, data: result };
  }

  @Get('connections/:id/spreadsheets')
  async listSpreadsheets(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    const connection = await this.getConnectionWithTokens(id, userId);
    const sheets = await this.googleService.listSpreadsheets(connection);
    return { success: true, data: sheets };
  }

  @Get('connections/:id/documents')
  async listDocuments(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    const connection = await this.getConnectionWithTokens(id, userId);
    const docs = await this.googleService.listDocuments(connection);
    return { success: true, data: docs };
  }

  @Get('docs/list')
  async listDocumentsBackward(
    @CurrentUser('id') userId: string,
    @Query('connectionId') connectionId: string,
  ) {
    if (!connectionId) throw new BadRequestException('connectionId required');
    const connection = await this.getConnectionWithTokens(connectionId, userId);
    const docs = await this.googleService.listDocuments(connection);
    return { success: true, data: docs };
  }

  @Get('sheets/list')
  async listSpreadsheetsBackward(
    @CurrentUser('id') userId: string,
    @Query('connectionId') connectionId: string,
  ) {
    if (!connectionId) throw new BadRequestException('connectionId required');
    const connection = await this.getConnectionWithTokens(connectionId, userId);
    const sheets = await this.googleService.listSpreadsheets(connection);
    return { success: true, data: sheets };
  }

  @Get('docs/:docId/content')
  async getDocumentContent(
    @Param('docId') docId: string,
    @Query('connectionId') connectionId?: string,
  ) {
    if (!connectionId)
      throw new BadRequestException(
        'connectionId required for document content',
      );
    const content = await this.googleService.getDocumentContent(
      connectionId,
      docId,
    );
    return { success: true, data: content };
  }

  @Get('drive/files')
  async listDriveFilesNoId(
    @CurrentUser('id') userId: string,
    @Query('connectionId') connectionId: string,
  ) {
    if (!connectionId) throw new BadRequestException('connectionId required');
    const connection = await this.getConnectionWithTokens(connectionId, userId);
    const result = await this.googleService.listDriveFiles(connection);
    return { success: true, data: result };
  }

  @Post('file-from-link')
  async getFileFromLink(
    @CurrentUser('id') userId: string,
    @Body() body: { connectionId: string; linkOrId: string },
  ) {
    if (!body.connectionId)
      throw new BadRequestException('connectionId is required');
    if (!body.linkOrId)
      throw new BadRequestException(
        'linkOrId is required (Google Drive link or file ID)',
      );
    const connection = await this.getConnectionWithTokens(
      body.connectionId,
      userId,
    );
    const fileMetadata = await this.googleService.getDriveFileFromLink(
      connection,
      body.linkOrId,
    );
    const fileType = fileMetadata.mimeType?.includes('spreadsheet')
      ? 'sheets'
      : fileMetadata.mimeType?.includes('document')
        ? 'docs'
        : 'drive';
    await this.googleService.cacheFileAccess(
      userId,
      body.connectionId,
      fileMetadata.id,
      fileMetadata.name,
      fileType,
      fileMetadata.mimeType,
      'picker_selected',
      {
        webViewLink: fileMetadata.webViewLink,
        size: fileMetadata.size,
        createdTime: fileMetadata.createdTime?.toISOString(),
        modifiedTime: fileMetadata.modifiedTime?.toISOString(),
        iconLink: fileMetadata.iconLink,
      },
    );
    return {
      success: true,
      data: {
        file: fileMetadata,
        type: fileType,
        message:
          'File accessed successfully and added to your accessible files',
      },
    };
  }

  @Get('file-access/check/:fileId')
  async checkFileAccess(
    @CurrentUser('id') userId: string,
    @Param('fileId') fileId: string,
  ) {
    const hasAccess = await this.googleService.checkFileAccess(userId, fileId);
    return { success: true, hasAccess, fileId };
  }

  @Get('connections/:id/accessible-files')
  async getAccessibleFiles(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query('fileType') fileType?: 'docs' | 'sheets' | 'drive',
  ) {
    const connection = await this.googleConnectionModel
      .findOne({ _id: id, userId, isActive: true })
      .lean()
      .exec();
    if (!connection) {
      throw new BadRequestException(
        GoogleErrors.formatError(GoogleErrors.CONNECTION_NOT_FOUND).error
          .message,
      );
    }
    const files = await this.googleService.getAccessibleFiles(
      userId,
      id,
      fileType,
    );
    return { success: true, data: files };
  }

  private async getConnectionWithTokens(
    connectionId: string,
    userId: string,
  ): Promise<GoogleConnectionWithTokens & { save: () => Promise<unknown> }> {
    const connection = await this.googleConnectionModel
      .findOne({ _id: connectionId, userId, isActive: true })
      .select(
        '+accessToken +refreshToken +encryptedAccessToken +encryptedRefreshToken',
      )
      .exec();
    if (!connection) {
      throw new BadRequestException(
        GoogleErrors.formatError(GoogleErrors.CONNECTION_NOT_FOUND).error
          .message,
      );
    }
    return connection as unknown as GoogleConnectionWithTokens & {
      save: () => Promise<unknown>;
    };
  }
}
