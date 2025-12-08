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
                filesCount: result.files.length
            });

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
     * Create QBR slides
     * POST /api/google/connections/:id/slides/qbr
     */
    static async createQBRSlides(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { id } = req.params;
            const { startDate, endDate, projectId } = req.body;

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

            const result = await GoogleIntegrationService.createQBRSlides(connection, {
                userId,
                connectionId: id,
                startDate: startDate ? new Date(startDate) : undefined,
                endDate: endDate ? new Date(endDate) : undefined,
                projectId
            });

            loggingService.info('Created QBR slides', {
                userId,
                connectionId: id,
                presentationId: result.presentationId
            });

            res.json({
                success: true,
                data: {
                    presentationId: result.presentationId,
                    presentationUrl: result.presentationUrl,
                    auditId: result.audit._id
                }
            });
        } catch (error: any) {
            loggingService.error('Failed to create QBR slides', {
                error: error.message
            });

            const standardError = GoogleErrors.fromGoogleError(error);
            res.status(standardError.httpStatus).json(GoogleErrors.formatError(standardError));
        }
    }

    /**
     * Create feedback form
     * POST /api/google/connections/:id/forms/create
     */
    static async createFeedbackForm(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { id } = req.params;
            const { title = 'AI Usage Feedback' } = req.body;

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

            const result = await GoogleIntegrationService.createFeedbackForm(
                connection,
                userId,
                id,
                title
            );

            loggingService.info('Created feedback form', {
                userId,
                connectionId: id,
                formId: result.formId
            });

            res.json({
                success: true,
                data: result
            });
        } catch (error: any) {
            loggingService.error('Failed to create feedback form', {
                error: error.message
            });

            const standardError = GoogleErrors.fromGoogleError(error);
            res.status(standardError.httpStatus).json(GoogleErrors.formatError(standardError));
        }
    }

    /**
     * Get form responses
     * GET /api/google/connections/:id/forms/:formId/responses
     */
    static async getFormResponses(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { id, formId } = req.params;

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

            const responses = await GoogleService.getFormResponses(connection, formId);

            loggingService.info('Retrieved form responses', {
                userId,
                connectionId: id,
                formId,
                responseCount: responses.length
            });

            res.json({
                success: true,
                data: responses
            });
        } catch (error: any) {
            loggingService.error('Failed to get form responses', {
                error: error.message
            });

            const standardError = GoogleErrors.fromGoogleError(error);
            res.status(standardError.httpStatus).json(GoogleErrors.formatError(standardError));
        }
    }

    /**
     * Get Gmail cost alerts
     * GET /api/google/connections/:id/gmail/alerts
     */
    static async getGmailAlerts(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { id } = req.params;
            const { limit = 20 } = req.query;

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

            // Search for billing/cost alert emails
            const query = 'subject:(billing OR cost OR usage OR alert OR invoice) newer_than:30d';
            const messages = await GoogleService.listGmailMessages(connection, query, parseInt(limit as string));

            loggingService.info('Retrieved Gmail cost alerts', {
                userId,
                connectionId: id,
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
}

