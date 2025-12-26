import { Response } from 'express';
import { GoogleService } from '../services/google.service';
import { GoogleIntegrationService } from '../services/googleIntegration.service';
import { GoogleConnection } from '../models/GoogleConnection';
import { GoogleExportAudit } from '../models/GoogleExportAudit';
import { loggingService } from '../services/logging.service';
import { GoogleErrors } from '../utils/googleErrors';
import mongoose from 'mongoose';

export class GoogleController {
    /**
     * Initialize OAuth flow
     * GET /api/google/auth
     */
    static async initiateOAuth(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            if (!userId) {
                loggingService.warn('Google OAuth initiation failed: User not authenticated', { 
                    hasAuthHeader: !!req.headers.authorization 
                });
                const error = GoogleErrors.AUTH_REQUIRED;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            // Validate Google OAuth configuration
            const clientId = process.env.GOOGLE_CLIENT_ID;
            const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
            
            if (!clientId || !clientSecret) {
                loggingService.error('Google OAuth configuration missing', { 
                    hasClientId: !!clientId,
                    hasClientSecret: !!clientSecret 
                });
                res.status(500).json({
                    success: false,
                    message: 'Google OAuth is not configured on the server. Please contact support.',
                    error: 'Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET'
                });
                return;
            }

            // Use OAuthService to generate proper OAuth URL with correct state format
            const { OAuthService } = await import('../services/oauth.service');
            const { authUrl, state } = OAuthService.initiateOAuth('google', userId);

            // Store state for validation (same as OAuthController)
            const { redisService } = await import('../services/redis.service');
            const stateKey = `oauth:state:${state}`;
            const stateData = {
                state,
                provider: 'google',
                timestamp: Date.now(),
                userId: userId,
            };
            
            try {
                await redisService.set(stateKey, stateData, 600); // 10 minutes
                loggingService.info('Google OAuth state stored successfully', { provider: 'google', stateKey });
            } catch (error: any) {
                loggingService.warn('Failed to store Google OAuth state, using session fallback', { 
                    error: error.message,
                    provider: 'google'
                });
                if (req.session) {
                    req.session.oauthState = stateData;
                }
            }

            loggingService.info('Google OAuth flow initiated successfully', { 
                userId,
                authUrlLength: authUrl.length,
                stateLength: state.length,
                hasClientId: !!clientId,
                callbackUrl: process.env.GOOGLE_CALLBACK_URL || `${process.env.BACKEND_URL || 'http://localhost:8000'}/api/auth/oauth/google/callback`
            });

            res.json({
                success: true,
                data: {
                    authUrl,
                    scopes: [
                        'openid',
                        'https://www.googleapis.com/auth/userinfo.email',
                        'https://www.googleapis.com/auth/userinfo.profile',
                        'https://www.googleapis.com/auth/drive.file'
                    ]
                }
            });
        } catch (error: any) {
            loggingService.error('Failed to initiate Google OAuth', {
                error: error.message,
                stack: error.stack,
                userId: req.userId,
                hasClientId: !!process.env.GOOGLE_CLIENT_ID,
                hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
                hasCallbackUrl: !!process.env.GOOGLE_CALLBACK_URL
            });

            res.status(500).json({
                success: false,
                message: 'Failed to initiate Google OAuth',
                error: error.message
            });
        }
    }

    /**
     * List user's Google connections
     * GET /api/google/connections
     */
    static async listConnections(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            if (!userId) {
                const error = GoogleErrors.AUTH_REQUIRED;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            // Check for all connections (including inactive) for debugging
            const allConnections = await GoogleConnection.find({ userId })
                .select('-accessToken -refreshToken')
                .sort({ createdAt: -1 });

            // Filter active connections
            const activeConnections = allConnections.filter(conn => conn.isActive);

            loggingService.info('Listed Google connections', {
                userId,
                activeCount: activeConnections.length,
                totalCount: allConnections.length,
                inactiveCount: allConnections.length - activeConnections.length
            });

            // If there are inactive connections, log them for debugging
            if (allConnections.length > activeConnections.length) {
                loggingService.warn('Found inactive Google connections', {
                    userId,
                    inactiveConnections: allConnections
                        .filter(conn => !conn.isActive)
                        .map(conn => ({
                            id: conn._id,
                            googleEmail: conn.googleEmail,
                            isActive: conn.isActive,
                            healthStatus: conn.healthStatus,
                            createdAt: conn.createdAt
                        }))
                });
            }

            res.json({
                success: true,
                data: activeConnections
            });
        } catch (error: any) {
            loggingService.error('Failed to list Google connections', {
                error: error.message,
                stack: error.stack
            });

            res.status(500).json({
                success: false,
                message: 'Failed to list Google connections',
                error: error.message
            });
        }
    }

    /**
     * Get connection details
     * GET /api/google/connections/:id
     */
    static async getConnection(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { id } = req.params;

            if (!userId) {
                const error = GoogleErrors.AUTH_REQUIRED;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            const connection = await GoogleConnection.findOne({
                _id: id,
                userId,
                isActive: true
            }).select('-accessToken -refreshToken');

            if (!connection) {
                const error = GoogleErrors.CONNECTION_NOT_FOUND;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            loggingService.info('Retrieved Google connection', {
                userId,
                connectionId: id
            });

            res.json({
                success: true,
                data: connection
            });
        } catch (error: any) {
            loggingService.error('Failed to get Google connection', {
                error: error.message
            });

            res.status(500).json({
                success: false,
                message: 'Failed to get Google connection',
                error: error.message
            });
        }
    }

    /**
     * Disconnect Google account
     * DELETE /api/google/connections/:id
     */
    static async disconnectConnection(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { id } = req.params;

            if (!userId) {
                const error = GoogleErrors.AUTH_REQUIRED;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            const connection = await GoogleConnection.findOne({
                _id: id,
                userId
            });

            if (!connection) {
                const error = GoogleErrors.CONNECTION_NOT_FOUND;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            connection.isActive = false;
            connection.healthStatus = 'error';
            await connection.save();

            loggingService.info('Disconnected Google connection', {
                userId,
                connectionId: id
            });

            res.json({
                success: true,
                message: 'Google connection disconnected successfully'
            });
        } catch (error: any) {
            loggingService.error('Failed to disconnect Google connection', {
                error: error.message
            });

            res.status(500).json({
                success: false,
                message: 'Failed to disconnect Google connection',
                error: error.message
            });
        }
    }

    /**
     * Check connection health
     * GET /api/google/connections/:id/health
     */
    static async checkConnectionHealth(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { id } = req.params;

            if (!userId) {
                const error = GoogleErrors.AUTH_REQUIRED;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            const connection = await GoogleConnection.findOne({
                _id: id,
                userId,
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                const error = GoogleErrors.CONNECTION_NOT_FOUND;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            const health = await GoogleService.checkConnectionHealth(connection);

            // Update connection health status
            if (connection.healthStatus !== health.status) {
                connection.healthStatus = health.status;
                await connection.save();
            }

            loggingService.info('Checked Google connection health', {
                userId,
                connectionId: id,
                healthy: health.healthy,
                status: health.status
            });

            res.json({
                success: true,
                data: health
            });
        } catch (error: any) {
            loggingService.error('Failed to check Google connection health', {
                error: error.message
            });

            res.status(500).json({
                success: false,
                message: 'Failed to check connection health',
                error: error.message
            });
        }
    }

    /**
     * List Drive files
     * GET /api/google/connections/:id/drive
     */
    static async listDriveFiles(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { id } = req.params;
            const { pageSize, pageToken, query, orderBy } = req.query;

            if (!userId) {
                const error = GoogleErrors.AUTH_REQUIRED;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            const connection = await GoogleConnection.findOne({
                _id: id,
                userId,
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                const error = GoogleErrors.CONNECTION_NOT_FOUND;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            // Check if connection has the correct scope for accessing all Drive files
            // Old connections might have 'drive.file' which only allows app-created files
            // New connections should have 'drive.readonly' or 'drive' for full access
            // If scope is empty/undefined, verify actual token scopes from Google
            let connectionScope = connection.scope || '';
            let hasFullDriveAccess = connectionScope.includes('drive.readonly') || 
                                    connectionScope.includes('https://www.googleapis.com/auth/drive.readonly') ||
                                    connectionScope.includes('https://www.googleapis.com/auth/drive');
            
            // If scope is empty, verify actual token scopes from Google API
            if (!connectionScope) {
                try {
                    const tokenInfo = await GoogleService.verifyTokenScopes(connection);
                    connectionScope = tokenInfo.scopes.join(' ');
                    hasFullDriveAccess = tokenInfo.hasFullDriveAccess;
                    
                    // Update stored scope if we got it from Google
                    if (connectionScope && !connection.scope) {
                        connection.scope = connectionScope;
                        await connection.save();
                        loggingService.info('Updated connection scope from token verification', {
                            userId,
                            connectionId: id
                        });
                    }
                } catch (error: any) {
                    loggingService.warn('Failed to verify token scopes, assuming limited scope', {
                        userId,
                        connectionId: id,
                        error: error.message
                    });
                }
            }
            
            // If scope is empty or contains drive.file but not drive.readonly, it's limited
            const hasLimitedScope = !connectionScope || 
                                   (!hasFullDriveAccess && (connectionScope.includes('drive.file') || connectionScope === ''));

            if (hasLimitedScope) {
                loggingService.warn('Google Drive connection has limited scope', {
                    userId,
                    connectionId: id,
                    scope: connectionScope || '(empty - old connection)',
                    scopeLength: connectionScope.length,
                    hasFullDriveAccess
                });
            }

            const result = await GoogleService.listDriveFiles(connection, {
                pageSize: pageSize ? parseInt(pageSize as string) : undefined,
                pageToken: pageToken as string,
                query: query as string,
                orderBy: orderBy as string
            });

            // Update connection drive files cache
            if (result.files.length > 0) {
                connection.driveFiles = result.files;
                connection.lastSyncedAt = new Date();
                await connection.save();
            }

            loggingService.info('Listed Google Drive files', {
                userId,
                connectionId: id,
                filesCount: result.files.length,
                hasFullAccess: hasFullDriveAccess
            });

            // If connection has limited scope (empty scope or drive.file without drive.readonly), add a warning
            if (hasLimitedScope) {
                loggingService.info('Drive files listed with limited scope - user may need to reconnect', {
                    userId,
                    connectionId: id,
                    filesCount: result.files.length,
                    scope: connectionScope || '(empty)',
                    hasFullAccess: false
                });
                
                res.json({
                    success: true,
                    data: result,
                    warning: {
                        code: 'LIMITED_DRIVE_SCOPE',
                        message: 'Your Google connection has limited Drive access. Only files exported from CostKatana are visible. Please reconnect your Google account to see all your Drive files.',
                        requiresReconnection: true,
                        scope: connectionScope || '(not stored - old connection)'
                    }
                });
                return;
            }

            res.json({
                success: true,
                data: result
            });
        } catch (error: any) {
            loggingService.error('Failed to list Google Drive files', {
                error: error.message
            });

            const standardError = GoogleErrors.fromGoogleError(error);
            res.status(standardError.httpStatus).json(GoogleErrors.formatError(standardError));
        }
    }

    /**
     * Get Drive file details
     * GET /api/google/connections/:id/drive/:fileId
     */
    static async getDriveFile(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { id, fileId } = req.params;

            if (!userId) {
                const error = GoogleErrors.AUTH_REQUIRED;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            const connection = await GoogleConnection.findOne({
                _id: id,
                userId,
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                const error = GoogleErrors.CONNECTION_NOT_FOUND;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            const file = await GoogleService.getDriveFile(connection, fileId);

            loggingService.info('Retrieved Google Drive file', {
                userId,
                connectionId: id,
                fileId
            });

            res.json({
                success: true,
                data: file
            });
        } catch (error: any) {
            loggingService.error('Failed to get Google Drive file', {
                error: error.message
            });

            const standardError = GoogleErrors.fromGoogleError(error);
            res.status(standardError.httpStatus).json(GoogleErrors.formatError(standardError));
        }
    }

    /**
     * Export cost data to Google Sheets
     * POST /api/google/export/cost-data
     */
    static async exportCostData(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { connectionId, startDate, endDate, projectId, redactionOptions } = req.body;

            if (!userId) {
                const error = GoogleErrors.AUTH_REQUIRED;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            if (!connectionId) {
                res.status(400).json({
                    success: false,
                    message: 'connectionId is required'
                });
                return;
            }

            const connection = await GoogleConnection.findOne({
                _id: connectionId,
                userId,
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                const error = GoogleErrors.CONNECTION_NOT_FOUND;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            const result = await GoogleIntegrationService.exportCostDataToSheets(connection, {
                userId,
                connectionId,
                startDate: startDate ? new Date(startDate) : undefined,
                endDate: endDate ? new Date(endDate) : undefined,
                projectId,
                redactionOptions
            });

            loggingService.info('Exported cost data to Google Sheets', {
                userId,
                connectionId,
                spreadsheetId: result.spreadsheetId
            });

            res.json({
                success: true,
                data: {
                    spreadsheetId: result.spreadsheetId,
                    spreadsheetUrl: result.spreadsheetUrl,
                    auditId: result.audit._id
                }
            });
        } catch (error: any) {
            loggingService.error('Failed to export cost data', {
                error: error.message
            });

            const standardError = GoogleErrors.fromGoogleError(error);
            res.status(standardError.httpStatus).json(GoogleErrors.formatError(standardError));
        }
    }

    /**
     * Create cost report in Google Docs
     * POST /api/google/export/report
     */
    static async createCostReport(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { connectionId, startDate, endDate, projectId, includeTopModels, includeRecommendations } = req.body;

            if (!userId) {
                const error = GoogleErrors.AUTH_REQUIRED;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            if (!connectionId) {
                res.status(400).json({
                    success: false,
                    message: 'connectionId is required'
                });
                return;
            }

            const connection = await GoogleConnection.findOne({
                _id: connectionId,
                userId,
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                const error = GoogleErrors.CONNECTION_NOT_FOUND;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            const result = await GoogleIntegrationService.createCostReportInDocs(connection, {
                userId,
                connectionId,
                startDate: startDate ? new Date(startDate) : undefined,
                endDate: endDate ? new Date(endDate) : undefined,
                projectId,
                includeTopModels: includeTopModels !== false,
                includeRecommendations: includeRecommendations !== false
            });

            loggingService.info('Created cost report in Google Docs', {
                userId,
                connectionId,
                documentId: result.documentId
            });

            res.json({
                success: true,
                data: {
                    documentId: result.documentId,
                    documentUrl: result.documentUrl,
                    auditId: result.audit._id
                }
            });
        } catch (error: any) {
            loggingService.error('Failed to create cost report', {
                error: error.message
            });

            const standardError = GoogleErrors.fromGoogleError(error);
            res.status(standardError.httpStatus).json(GoogleErrors.formatError(standardError));
        }
    }

    /**
     * Get export audits
     * GET /api/google/export/audits
     */
    static async getExportAudits(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { limit = 50, exportType, datasetType } = req.query;

            if (!userId) {
                const error = GoogleErrors.AUTH_REQUIRED;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            const query: any = { userId: new mongoose.Types.ObjectId(userId) };
            if (exportType) query.exportType = exportType;
            if (datasetType) query.datasetType = datasetType;

            const audits = await GoogleExportAudit.find(query)
                .sort({ exportedAt: -1 })
                .limit(parseInt(limit as string));

            loggingService.info('Retrieved Google export audits', {
                userId,
                count: audits.length
            });

            res.json({
                success: true,
                data: audits
            });
        } catch (error: any) {
            loggingService.error('Failed to get export audits', {
                error: error.message
            });

            res.status(500).json({
                success: false,
                message: 'Failed to get export audits',
                error: error.message
            });
        }
    }

    /**
     * Create Spreadsheet
     * POST /api/google/connections/:id/sheets
     */
    static async createSpreadsheet(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { id } = req.params;
            const { title } = req.body;

            if (!userId) {
                const error = GoogleErrors.AUTH_REQUIRED;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            if (!title) {
                res.status(400).json({
                    success: false,
                    message: 'Missing required field: title'
                });
                return;
            }

            const connection = await GoogleConnection.findOne({
                _id: new mongoose.Types.ObjectId(id),
                userId: new mongoose.Types.ObjectId(userId),
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                const error = GoogleErrors.CONNECTION_NOT_FOUND;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            const result = await GoogleService.createSpreadsheet(connection, title);

            res.json({
                success: true,
                data: result
            });

            loggingService.info('Created Google Spreadsheet', {
                userId,
                connectionId: id,
                spreadsheetId: result.spreadsheetId
            });
        } catch (error: any) {
            const standardError = GoogleErrors.fromGoogleError(error);
            res.status(standardError.httpStatus).json(GoogleErrors.formatError(standardError));

            loggingService.error('Failed to create spreadsheet', {
                userId: req.userId,
                error: error.message
            });
        }
    }

    /**
     * Create Document
     * POST /api/google/connections/:id/docs
     */
    static async createDocument(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { id } = req.params;
            const { title } = req.body;

            if (!userId) {
                const error = GoogleErrors.AUTH_REQUIRED;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            if (!title) {
                res.status(400).json({
                    success: false,
                    message: 'Missing required field: title'
                });
                return;
            }

            const connection = await GoogleConnection.findOne({
                _id: new mongoose.Types.ObjectId(id),
                userId: new mongoose.Types.ObjectId(userId),
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                const error = GoogleErrors.CONNECTION_NOT_FOUND;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            const result = await GoogleService.createDocument(connection, title);

            res.json({
                success: true,
                data: result
            });

            loggingService.info('Created Google Document', {
                userId,
                connectionId: id,
                documentId: result.documentId
            });
        } catch (error: any) {
            const standardError = GoogleErrors.fromGoogleError(error);
            res.status(standardError.httpStatus).json(GoogleErrors.formatError(standardError));

            loggingService.error('Failed to create document', {
                userId: req.userId,
                error: error.message
            });
        }
    }

    /**
     * Analyze cost trends with Gemini
     * POST /api/google/gemini/analyze
     */
    static async analyzeCostTrends(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { startDate, endDate } = req.body;

            if (!userId) {
                const error = GoogleErrors.AUTH_REQUIRED;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            const result = await GoogleIntegrationService.analyzeCostTrendsWithGemini(userId, {
                startDate: startDate ? new Date(startDate) : undefined,
                endDate: endDate ? new Date(endDate) : undefined
            });

            loggingService.info('Analyzed cost trends', {
                userId
            });

            res.json({
                success: true,
                data: result
            });
        } catch (error: any) {
            loggingService.error('Failed to analyze cost trends', {
                error: error.message
            });

            res.status(500).json({
                success: false,
                message: 'Failed to analyze cost trends',
                error: error.message
            });
        }
    }

    /**
     * Explain cost anomaly with Gemini
     * POST /api/google/gemini/explain-anomaly
     */
    static async explainCostAnomaly(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { anomalyData } = req.body;

            if (!userId) {
                const error = GoogleErrors.AUTH_REQUIRED;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            const result = await GoogleIntegrationService.explainCostAnomalyWithGemini(userId, anomalyData);

            loggingService.info('Explained cost anomaly', {
                userId
            });

            res.json({
                success: true,
                data: result
            });
        } catch (error: any) {
            loggingService.error('Failed to explain cost anomaly', {
                error: error.message
            });

            res.status(500).json({
                success: false,
                message: 'Failed to explain cost anomaly',
                error: error.message
            });
        }
    }

    /**
     * Generate optimization strategy with Gemini
     * POST /api/google/gemini/suggest-strategy
     */
    static async generateOptimizationStrategy(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { constraints } = req.body;

            if (!userId) {
                const error = GoogleErrors.AUTH_REQUIRED;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            const result = await GoogleIntegrationService.generateOptimizationStrategy(userId, constraints);

            loggingService.info('Generated optimization strategy', {
                userId,
                estimatedSavings: result.estimatedSavings
            });

            res.json({
                success: true,
                data: result
            });
        } catch (error: any) {
            loggingService.error('Failed to generate optimization strategy', {
                error: error.message
            });

            res.status(500).json({
                success: false,
                message: 'Failed to generate optimization strategy',
                error: error.message
            });
        }
    }

    /**
     * List spreadsheets accessible via picker
     * GET /api/google/connections/:id/spreadsheets
     */
    static async listSpreadsheets(req: any, res: Response): Promise<void> {
        try {
            const connectionId = req.params.id;
            const sheets = await GoogleService.listSpreadsheets(connectionId);
            res.json({ success: true, data: sheets });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * List documents accessible via picker
     * GET /api/google/connections/:id/documents
     */
    static async listDocuments(req: any, res: Response): Promise<void> {
        try {
            const connectionId = req.params.id;
            const docs = await GoogleService.listDocuments(connectionId);
            res.json({ success: true, data: docs });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * Get document content
     * GET /api/google/docs/:docId/content
     */
    static async getDocumentContent(req: any, res: Response): Promise<void> {
        try {
            const { docId } = req.params;
            const { connectionId } = req.query;
            const content = await GoogleService.getDocumentContent(String(connectionId), docId);
            res.json({ success: true, data: content });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * Get file from Drive link
     * POST /api/google/file-from-link
     * Body: { connectionId, linkOrId }
     */
    static async getFileFromLink(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id || req.user?._id?.toString();
            const { connectionId, linkOrId } = req.body;

            if (!userId) {
                const error = GoogleErrors.AUTH_REQUIRED;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            if (!connectionId) {
                res.status(400).json({
                    success: false,
                    error: 'connectionId is required'
                });
                return;
            }

            if (!linkOrId) {
                res.status(400).json({
                    success: false,
                    error: 'linkOrId is required (Google Drive link or file ID)'
                });
                return;
            }

            const connection = await GoogleConnection.findOne({
                _id: connectionId,
                userId
            }).select('+accessToken +refreshToken');

            if (!connection) {
                const error = GoogleErrors.CONNECTION_NOT_FOUND;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            // Extract file ID and get file metadata
            const fileMetadata = await GoogleService.getDriveFileFromLink(connection, linkOrId);

            // Determine file type
            const fileType = fileMetadata.mimeType?.includes('spreadsheet') ? 'sheets' :
                           fileMetadata.mimeType?.includes('document') ? 'docs' : 'drive';

            // Cache the file access
            await GoogleService.cacheFileAccess(
                userId,
                connectionId,
                fileMetadata.id,
                fileMetadata.name,
                fileType as 'drive' | 'sheets' | 'docs',
                fileMetadata.mimeType,
                'picker_selected',
                {
                    webViewLink: fileMetadata.webViewLink,
                    size: fileMetadata.size,
                    createdTime: fileMetadata.createdTime?.toString(),
                    modifiedTime: fileMetadata.modifiedTime?.toString(),
                    iconLink: fileMetadata.iconLink
                }
            );

            res.json({
                success: true,
                data: {
                    file: fileMetadata,
                    type: fileType,
                    message: 'File accessed successfully and added to your accessible files'
                }
            });
        } catch (error: any) {
            loggingService.error('Failed to get file from link', {
                error: error.message,
                stack: error.stack,
                errorCode: error.code
            });

            if (error.message.includes('Invalid Google Drive link')) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid Google Drive link or file ID format'
                });
            } else if (error.code === 404) {
                res.status(404).json({
                    success: false,
                    error: error.message || 'File not found'
                });
            } else if (error.code === 403) {
                res.status(403).json({
                    success: false,
                    error: error.message || 'Access denied'
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: error.message || 'Failed to access file'
                });
            }
        }
    }


    /**
     * Check file access
     * GET /api/google/file-access/check/:fileId
     */
    static async checkFileAccess(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id || req.user?._id?.toString();
            const { fileId } = req.params;

            if (!userId) {
                const error = GoogleErrors.AUTH_REQUIRED;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            if (!fileId) {
                res.status(400).json({
                    success: false,
                    error: 'fileId is required'
                });
                return;
            }

            // Check if user has access to this file
            const hasAccess = await GoogleService.checkFileAccess(userId, fileId);

            loggingService.info('Checked file access', {
                userId,
                fileId,
                hasAccess
            });

            res.json({
                success: true,
                hasAccess,
                fileId
            });
        } catch (error: any) {
            loggingService.error('Failed to check file access', {
                error: error.message
            });

            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
}