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
                        'https://www.googleapis.com/auth/userinfo.email',
                        'https://www.googleapis.com/auth/userinfo.profile',
                        'https://www.googleapis.com/auth/drive.file',
                        'https://www.googleapis.com/auth/documents',
                        'https://www.googleapis.com/auth/spreadsheets'
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
     * Create calendar event for budget review
     * POST /api/google/connections/:id/calendar/budget-review
     */
    static async createBudgetReviewEvent(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { id } = req.params;
            const { date, attendees } = req.body;

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

            const reviewDate = date ? new Date(date) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // Default: 1 week from now
            const endDate = new Date(reviewDate.getTime() + 60 * 60 * 1000); // 1 hour duration

            const result = await GoogleService.createCalendarEvent(
                connection,
                'CostKatana Budget Review',
                reviewDate,
                endDate,
                'Monthly budget review for AI cost optimization',
                attendees
            );

            loggingService.info('Created budget review calendar event', {
                userId,
                connectionId: id,
                eventId: result.eventId
            });

            res.json({
                success: true,
                data: result
            });
        } catch (error: any) {
            loggingService.error('Failed to create budget review event', {
                error: error.message
            });

            const standardError = GoogleErrors.fromGoogleError(error);
            res.status(standardError.httpStatus).json(GoogleErrors.formatError(standardError));
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
     * Get Gmail cost alerts
     * GET /api/google/connections/:id/gmail/alerts
     */
    static async getGmailAlerts(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const connectionId = req.params.id;
            const { limit = 20 } = req.query;

            if (!userId) {
                const error = GoogleErrors.AUTH_REQUIRED;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            if (!connectionId) {
                res.status(400).json({
                    success: false,
                    message: 'Missing connection ID'
                });
                return;
            }

            const connection = await GoogleConnection.findOne({
                _id: new mongoose.Types.ObjectId(connectionId),
                userId: new mongoose.Types.ObjectId(userId),
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                loggingService.warn('Google connection not found for Gmail alerts', {
                    userId,
                    connectionId
                });
                const error = GoogleErrors.CONNECTION_NOT_FOUND;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            // Search for billing/cost alert emails
            const query = 'subject:(billing OR cost OR usage OR alert OR invoice) newer_than:30d';
            const messages = await GoogleService.listGmailMessages(connection, query, parseInt(limit as string));

            loggingService.info('Retrieved Gmail cost alerts', {
                userId,
                connectionId,
                alertCount: messages.length
            });

            res.json({
                success: true,
                data: messages
            });
        } catch (error: any) {
            loggingService.error('Failed to get Gmail alerts', {
                error: error.message
            });

            const standardError = GoogleErrors.fromGoogleError(error);
            res.status(standardError.httpStatus).json(GoogleErrors.formatError(standardError));
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
     * Send email via Gmail
     * POST /api/google/gmail/send
     */
    static async sendEmail(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { to, subject, body, isHtml } = req.body;
            const connectionId = req.params.id; // Route uses :id, not :connectionId

            if (!to || !subject || !body) {
                res.status(400).json({
                    success: false,
                    message: 'Missing required fields: to, subject, body'
                });
                return;
            }

            if (!connectionId) {
                res.status(400).json({
                    success: false,
                    message: 'Missing connection ID'
                });
                return;
            }

            const connection = await GoogleConnection.findOne({
                _id: new mongoose.Types.ObjectId(connectionId),
                userId: new mongoose.Types.ObjectId(userId),
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                loggingService.warn('Google connection not found for send email', {
                    userId,
                    connectionId,
                    receivedId: req.params.id
                });
                const error = GoogleErrors.CONNECTION_NOT_FOUND;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            const result = await GoogleService.sendEmail(
                connection,
                to,
                subject,
                body,
                isHtml || false
            );

            res.json({
                success: true,
                data: result
            });

            loggingService.info('Sent email via Gmail', {
                userId,
                connectionId,
                to: Array.isArray(to) ? to.join(', ') : to
            });
        } catch (error: any) {
            const standardError = GoogleErrors.fromGoogleError(error);
            res.status(standardError.httpStatus).json(GoogleErrors.formatError(standardError));

            loggingService.error('Failed to send email', {
                userId: req.userId,
                error: error.message
            });
        }
    }

    /**
     * Search Gmail messages
     * GET /api/google/gmail/search
     */
    static async searchEmails(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { query, maxResults } = req.query;
            const connectionId = req.params.id; 

            if (!query) {
                res.status(400).json({
                    success: false,
                    message: 'Missing required query parameter: query'
                });
                return;
            }

            if (!connectionId) {
                res.status(400).json({
                    success: false,
                    message: 'Missing connection ID'
                });
                return;
            }

            loggingService.info('Searching Gmail messages', {
                userId,
                connectionId,
                query,
                maxResults
            });

            const connection = await GoogleConnection.findOne({
                _id: new mongoose.Types.ObjectId(connectionId),
                userId: new mongoose.Types.ObjectId(userId),
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                loggingService.warn('Google connection not found for Gmail search', {
                    userId,
                    connectionId,
                    receivedId: req.params.id,
                    allParams: req.params
                });
                const error = GoogleErrors.CONNECTION_NOT_FOUND;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            const messages = await GoogleService.searchGmailMessages(
                connection,
                query as string,
                maxResults ? parseInt(maxResults as string) : 20
            );

            res.json({
                success: true,
                data: { messages, count: messages.length }
            });

            loggingService.info('Searched Gmail messages', {
                userId,
                connectionId,
                query,
                resultsCount: messages.length
            });
        } catch (error: any) {
            const standardError = GoogleErrors.fromGoogleError(error);
            res.status(standardError.httpStatus).json(GoogleErrors.formatError(standardError));

            loggingService.error('Failed to search emails', {
                userId: req.userId,
                error: error.message
            });
        }
    }

    /**
     * Create Calendar event
     * POST /api/google/connections/:id/calendar/events
     */
    static async createEvent(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { id } = req.params;
            const { summary, start, end, description, attendees } = req.body;

            if (!userId) {
                const error = GoogleErrors.AUTH_REQUIRED;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            if (!summary || !start || !end) {
                res.status(400).json({
                    success: false,
                    message: 'Missing required fields: summary, start, end'
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

            const startDate = new Date(start);
            const endDate = new Date(end);

            const result = await GoogleService.createCalendarEvent(
                connection,
                summary,
                startDate,
                endDate,
                description,
                attendees
            );

            res.json({
                success: true,
                data: result
            });

            loggingService.info('Created Calendar event', {
                userId,
                connectionId: id,
                eventId: result.eventId
            });
        } catch (error: any) {
            const standardError = GoogleErrors.fromGoogleError(error);
            res.status(standardError.httpStatus).json(GoogleErrors.formatError(standardError));

            loggingService.error('Failed to create calendar event', {
                userId: req.userId,
                error: error.message
            });
        }
    }

    /**
     * List Calendar events
     * GET /api/google/calendar/events
     */
    static async listEvents(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { startDate, endDate, maxResults } = req.query;
            const { id } = req.params; // Changed from connectionId to id to match route parameter

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

            const events = await GoogleService.listCalendarEvents(
                connection,
                startDate ? new Date(startDate as string) : undefined,
                endDate ? new Date(endDate as string) : undefined,
                maxResults ? parseInt(maxResults as string) : 10
            );

            res.json({
                success: true,
                data: { events, count: events.length }
            });

            loggingService.info('Listed Calendar events', {
                userId,
                connectionId: id,
                eventsCount: events.length
            });
        } catch (error: any) {
            const standardError = GoogleErrors.fromGoogleError(error);
            res.status(standardError.httpStatus).json(GoogleErrors.formatError(standardError));

            loggingService.error('Failed to list calendar events', {
                userId: req.userId,
                error: error.message
            });
        }
    }

    /**
     * Update Calendar event
     * PATCH /api/google/calendar/events/:eventId
     */
    static async updateEvent(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { eventId, id } = req.params; // Changed from connectionId to id to match route parameter
            const updates = req.body;

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

            // Convert date strings to Date objects
            if (updates.start) updates.start = new Date(updates.start);
            if (updates.end) updates.end = new Date(updates.end);

            const result = await GoogleService.updateCalendarEvent(
                connection,
                eventId,
                updates
            );

            res.json({
                success: true,
                data: result
            });

            loggingService.info('Updated Calendar event', {
                userId,
                connectionId: id,
                eventId
            });
        } catch (error: any) {
            const standardError = GoogleErrors.fromGoogleError(error);
            res.status(standardError.httpStatus).json(GoogleErrors.formatError(standardError));

            loggingService.error('Failed to update calendar event', {
                userId: req.userId,
                error: error.message
            });
        }
    }

    /**
     * Delete Calendar event
     * DELETE /api/google/calendar/events/:eventId
     */
    static async deleteEvent(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { eventId, id } = req.params; // Changed from connectionId to id to match route parameter

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

            const result = await GoogleService.deleteCalendarEvent(connection, eventId);

            res.json({
                success: true,
                data: result
            });

            loggingService.info('Deleted Calendar event', {
                userId,
                connectionId: id,
                eventId
            });
        } catch (error: any) {
            const standardError = GoogleErrors.fromGoogleError(error);
            res.status(standardError.httpStatus).json(GoogleErrors.formatError(standardError));

            loggingService.error('Failed to delete calendar event', {
                userId: req.userId,
                error: error.message
            });
        }
    }

    /**
     * Upload file to Drive
     * POST /api/google/drive/upload
     */
    static async uploadFile(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { fileName, mimeType, fileContent, folderId } = req.body;
            const { connectionId } = req.params;

            if (!fileName || !mimeType || !fileContent) {
                res.status(400).json({
                    success: false,
                    message: 'Missing required fields: fileName, mimeType, fileContent'
                });
                return;
            }

            const connection = await GoogleConnection.findOne({
                _id: new mongoose.Types.ObjectId(connectionId),
                userId: new mongoose.Types.ObjectId(userId),
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                const error = GoogleErrors.CONNECTION_NOT_FOUND;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            const result = await GoogleService.uploadFileToDrive(
                connection,
                fileName,
                mimeType,
                fileContent,
                folderId
            );

            res.json({
                success: true,
                data: result
            });

            loggingService.info('Uploaded file to Drive', {
                userId,
                connectionId,
                fileName
            });
        } catch (error: any) {
            const standardError = GoogleErrors.fromGoogleError(error);
            res.status(standardError.httpStatus).json(GoogleErrors.formatError(standardError));

            loggingService.error('Failed to upload file', {
                userId: req.userId,
                error: error.message
            });
        }
    }

    /**
     * Share Drive file
     * POST /api/google/drive/share/:fileId
     */
    static async shareDriveFile(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { fileId, connectionId } = req.params;
            const { emailAddress, role } = req.body;

            if (!emailAddress) {
                res.status(400).json({
                    success: false,
                    message: 'Missing required field: emailAddress'
                });
                return;
            }

            const connection = await GoogleConnection.findOne({
                _id: new mongoose.Types.ObjectId(connectionId),
                userId: new mongoose.Types.ObjectId(userId),
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                const error = GoogleErrors.CONNECTION_NOT_FOUND;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            const result = await GoogleService.shareFile(
                connection,
                fileId,
                emailAddress,
                role || 'reader'
            );

            res.json({
                success: true,
                data: result
            });

            loggingService.info('Shared Drive file', {
                userId,
                connectionId,
                fileId,
                emailAddress
            });
        } catch (error: any) {
            const standardError = GoogleErrors.fromGoogleError(error);
            res.status(standardError.httpStatus).json(GoogleErrors.formatError(standardError));

            loggingService.error('Failed to share file', {
                userId: req.userId,
                error: error.message
            });
        }
    }

    /**
     * Create Drive folder
     * POST /api/google/drive/folder
     */
    static async createDriveFolder(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { folderName, parentFolderId } = req.body;
            const { connectionId } = req.params;

            if (!folderName) {
                res.status(400).json({
                    success: false,
                    message: 'Missing required field: folderName'
                });
                return;
            }

            const connection = await GoogleConnection.findOne({
                _id: new mongoose.Types.ObjectId(connectionId),
                userId: new mongoose.Types.ObjectId(userId),
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                const error = GoogleErrors.CONNECTION_NOT_FOUND;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            const result = await GoogleService.createFolder(
                connection,
                folderName,
                parentFolderId
            );

            res.json({
                success: true,
                data: result
            });

            loggingService.info('Created Drive folder', {
                userId,
                connectionId,
                folderName
            });
        } catch (error: any) {
            const standardError = GoogleErrors.fromGoogleError(error);
            res.status(standardError.httpStatus).json(GoogleErrors.formatError(standardError));

            loggingService.error('Failed to create folder', {
                userId: req.userId,
                error: error.message
            });
        }
    }

    // ===================================
    // READ APIs - View Google Services
    // ===================================

    /**
     * Get Gmail inbox
     * GET /api/google/gmail/inbox
     */
    static async getGmailInbox(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { connectionId } = req.query;
            const maxResults = parseInt(req.query.maxResults as string) || 20;

            const connection = await GoogleConnection.findOne({
                _id: new mongoose.Types.ObjectId(connectionId as string),
                userId: new mongoose.Types.ObjectId(userId),
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                const error = GoogleErrors.CONNECTION_NOT_FOUND;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            const messages = await GoogleService.searchGmailMessages(
                connection,
                'in:inbox',
                maxResults
            );

            res.json({
                success: true,
                data: messages
            });

            loggingService.info('Retrieved Gmail inbox', {
                userId,
                connectionId,
                messageCount: messages.length
            });
        } catch (error: any) {
            const standardError = GoogleErrors.fromGoogleError(error);
            res.status(standardError.httpStatus).json(GoogleErrors.formatError(standardError));

            loggingService.error('Failed to get Gmail inbox', {
                userId: req.userId,
                error: error.message
            });
        }
    }

    /**
     * Get single Gmail message
     * GET /api/google/gmail/:messageId
     */
    static async getGmailMessage(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { messageId } = req.params;
            const { connectionId } = req.query;

            const connection = await GoogleConnection.findOne({
                _id: new mongoose.Types.ObjectId(connectionId as string),
                userId: new mongoose.Types.ObjectId(userId),
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                const error = GoogleErrors.CONNECTION_NOT_FOUND;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            const message = await GoogleService.getGmailMessage(connection, messageId);

            res.json({
                success: true,
                data: message
            });

            loggingService.info('Retrieved Gmail message', {
                userId,
                connectionId,
                messageId
            });
        } catch (error: any) {
            const standardError = GoogleErrors.fromGoogleError(error);
            res.status(standardError.httpStatus).json(GoogleErrors.formatError(standardError));

            loggingService.error('Failed to get Gmail message', {
                userId: req.userId,
                error: error.message
            });
        }
    }

    /**
     * Get sheet data
     * GET /api/google/sheets/:sheetId/data
     */
    static async getSheetData(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { sheetId } = req.params;
            const { connectionId, range = 'Sheet1!A1:Z100' } = req.query;

            const connection = await GoogleConnection.findOne({
                _id: new mongoose.Types.ObjectId(connectionId as string),
                userId: new mongoose.Types.ObjectId(userId),
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                const error = GoogleErrors.CONNECTION_NOT_FOUND;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            const data = await GoogleService.getSheetValues(
                connection,
                sheetId,
                range as string
            );

            res.json({
                success: true,
                data: {
                    sheetId,
                    range,
                    values: data
                }
            });

            loggingService.info('Retrieved sheet data', {
                userId,
                connectionId,
                sheetId,
                rowCount: data.length
            });
        } catch (error: any) {
            const standardError = GoogleErrors.fromGoogleError(error);
            res.status(standardError.httpStatus).json(GoogleErrors.formatError(standardError));

            loggingService.error('Failed to get sheet data', {
                userId: req.userId,
                error: error.message
            });
        }
    }

    /**
     * Get document content
     * GET /api/google/docs/:docId/content
     */
    static async getDocContent(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { docId } = req.params;
            const { connectionId } = req.query;

            const connection = await GoogleConnection.findOne({
                _id: new mongoose.Types.ObjectId(connectionId as string),
                userId: new mongoose.Types.ObjectId(userId),
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                const error = GoogleErrors.CONNECTION_NOT_FOUND;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            const content = await GoogleService.readDocument(connection, docId);

            res.json({
                success: true,
                data: {
                    docId,
                    content
                }
            });

            loggingService.info('Retrieved document content', {
                userId,
                connectionId,
                docId,
                contentLength: content.length
            });
        } catch (error: any) {
            const standardError = GoogleErrors.fromGoogleError(error);
            res.status(standardError.httpStatus).json(GoogleErrors.formatError(standardError));

            loggingService.error('Failed to get document content', {
                userId: req.userId,
                error: error.message
            });
        }
    }

    /**
     * Get file preview/content from Drive
     * GET /api/google/drive/file/:fileId/preview
     */
    static async getDriveFilePreview(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { fileId } = req.params;
            const { connectionId } = req.query;

            const connection = await GoogleConnection.findOne({
                _id: new mongoose.Types.ObjectId(connectionId as string),
                userId: new mongoose.Types.ObjectId(userId),
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                const error = GoogleErrors.CONNECTION_NOT_FOUND;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            const file = await GoogleService.getDriveFile(connection, fileId);

            res.json({
                success: true,
                data: file
            });

            loggingService.info('Retrieved Drive file preview', {
                userId,
                connectionId,
                fileId
            });
        } catch (error: any) {
            const standardError = GoogleErrors.fromGoogleError(error);
            res.status(standardError.httpStatus).json(GoogleErrors.formatError(standardError));

            loggingService.error('Failed to get Drive file preview', {
                userId: req.userId,
                error: error.message
            });
        }
    }

    /**
     * List Google Docs Documents
     * GET /api/google/docs/list
     */
    static async listDocuments(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { connectionId, maxResults = 20 } = req.query;

            const connection = await GoogleConnection.findOne({
                _id: new mongoose.Types.ObjectId(connectionId as string),
                userId: new mongoose.Types.ObjectId(userId),
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                const error = GoogleErrors.CONNECTION_NOT_FOUND;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            const documents = await GoogleService.listDocuments(connection, parseInt(maxResults as string));

            res.json({
                success: true,
                data: documents
            });

            loggingService.info('Listed Google Documents', {
                userId,
                connectionId,
                count: documents.length
            });
        } catch (error: any) {
            const standardError = GoogleErrors.fromGoogleError(error);
            res.status(standardError.httpStatus).json(GoogleErrors.formatError(standardError));

            loggingService.error('Failed to list documents', {
                userId: req.userId,
                error: error.message
            });
        }
    }

    /**
     * List Google Sheets Spreadsheets
     * GET /api/google/sheets/list
     */
    static async listSpreadsheets(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { connectionId, maxResults = 20 } = req.query;

            const connection = await GoogleConnection.findOne({
                _id: new mongoose.Types.ObjectId(connectionId as string),
                userId: new mongoose.Types.ObjectId(userId),
                isActive: true
            }).select('+accessToken +refreshToken');

            if (!connection) {
                const error = GoogleErrors.CONNECTION_NOT_FOUND;
                res.status(error.httpStatus).json(GoogleErrors.formatError(error));
                return;
            }

            const spreadsheets = await GoogleService.listSpreadsheets(connection, parseInt(maxResults as string));

            res.json({
                success: true,
                data: spreadsheets
            });

            loggingService.info('Listed Google Spreadsheets', {
                userId,
                connectionId,
                count: spreadsheets.length
            });
        } catch (error: any) {
            const standardError = GoogleErrors.fromGoogleError(error);
            res.status(standardError.httpStatus).json(GoogleErrors.formatError(standardError));

            loggingService.error('Failed to list spreadsheets', {
                userId: req.userId,
                error: error.message
            });
        }
    }
}

