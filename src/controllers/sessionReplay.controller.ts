import { Request, Response } from 'express';
import { sessionReplayService } from '../services/sessionReplay.service';
import { z } from 'zod';
import { loggingService } from '../services/logging.service';

// Validation schemas
const ListSessionsSchema = z.object({
    userId: z.string().optional(),
    workspaceId: z.string().optional(),
    source: z.enum(['telemetry', 'manual', 'unified', 'in-app', 'integration']).optional(),
    from: z.string().optional().refine((val) => {
        if (!val) return true;
        const date = new Date(val);
        return !isNaN(date.getTime());
    }, { message: "Invalid date format" }),
    to: z.string().optional().refine((val) => {
        if (!val) return true;
        const date = new Date(val);
        return !isNaN(date.getTime());
    }, { message: "Invalid date format" }),
    status: z.enum(['active', 'completed', 'error']).optional(),
    hasErrors: z.coerce.boolean().optional(),
    minCost: z.coerce.number().optional(),
    maxCost: z.coerce.number().optional(),
    minTokens: z.coerce.number().optional(),
    maxTokens: z.coerce.number().optional(),
    minDuration: z.coerce.number().optional(),
    maxDuration: z.coerce.number().optional(),
    aiModel: z.string().optional(),
    searchQuery: z.string().optional(),
    appFeature: z.string().optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    sortBy: z.enum(['startedAt', 'totalCost', 'totalTokens', 'duration']).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional()
});

const AddSnapshotSchema = z.object({
    codeContext: z.object({
        filePath: z.string(),
        content: z.string(),
        language: z.string().optional()
    }).optional(),
    aiInteraction: z.object({
        model: z.string(),
        prompt: z.string(),
        response: z.string(),
        parameters: z.record(z.any()).optional(),
        tokens: z.object({
            input: z.number(),
            output: z.number()
        }).optional(),
        cost: z.number().optional()
    }).optional(),
    userAction: z.object({
        action: z.string(),
        details: z.any().optional()
    }).optional(),
    captureSystemMetrics: z.boolean().optional()
});

export class SessionReplayController {
    /**
     * Get session replay by ID
     * GET /api/v1/session-replay/:sessionId
     */
    async getSessionReplay(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const { sessionId } = req.params;

        try {
            loggingService.info('Session replay retrieval initiated', {
                requestId,
                sessionId,
                hasSessionId: !!sessionId
            });

            const session = await sessionReplayService.getSessionReplay(sessionId);
            const duration = Date.now() - startTime;

            if (!session) {
                loggingService.warn('Session replay retrieval failed - session not found', {
                    requestId,
                    sessionId
                });

                return res.status(404).json({
                    success: false,
                    error: 'Session not found'
                });
            }

            loggingService.info('Session replay retrieved successfully', {
                requestId,
                duration,
                sessionId,
                hasReplayData: !!session.replayData
            });

            // Log business event
            loggingService.logBusiness({
                event: 'session_replay_retrieved',
                category: 'replay',
                value: duration,
                metadata: {
                    sessionId,
                    hasReplayData: !!session.replayData
                }
            });

            return res.json({
                success: true,
                data: session
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;

            loggingService.error('Session replay retrieval failed', {
                requestId,
                sessionId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });

            return res.status(500).json({
                success: false,
                error: 'Failed to get session replay',
                message: error.message || 'Unknown error'
            });
        }
    }

    /**
     * List session replays with filters
     * GET /api/v1/session-replay/list
     */
    async listSessionReplays(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;

        try {
            // Validate query params
            const validatedQuery = ListSessionsSchema.parse(req.query);

            // Use authenticated user's ID if not specified
            const userId = validatedQuery.userId || (req as any).user?.userId || (req as any).user?._id?.toString();

            loggingService.info('Session replay list retrieval initiated', {
                requestId,
                filters: validatedQuery,
                authenticatedUserId: userId
            });

            const result = await sessionReplayService.listSessionReplays({
                userId,
                workspaceId: validatedQuery.workspaceId,
                source: validatedQuery.source,
                from: validatedQuery.from ? new Date(validatedQuery.from) : undefined,
                to: validatedQuery.to ? new Date(validatedQuery.to) : undefined,
                status: validatedQuery.status,
                hasErrors: validatedQuery.hasErrors,
                minCost: validatedQuery.minCost,
                maxCost: validatedQuery.maxCost,
                minTokens: validatedQuery.minTokens,
                maxTokens: validatedQuery.maxTokens,
                minDuration: validatedQuery.minDuration,
                maxDuration: validatedQuery.maxDuration,
                aiModel: validatedQuery.aiModel,
                searchQuery: validatedQuery.searchQuery,
                appFeature: validatedQuery.appFeature,
                page: validatedQuery.page,
                limit: validatedQuery.limit,
                sortBy: validatedQuery.sortBy,
                sortOrder: validatedQuery.sortOrder
            });

            const duration = Date.now() - startTime;

            loggingService.info('Session replay list retrieved successfully', {
                requestId,
                duration,
                total: result.total,
                page: result.page,
                totalPages: result.totalPages
            });

            // Log business event
            loggingService.logBusiness({
                event: 'session_replay_list_retrieved',
                category: 'replay',
                value: duration,
                metadata: {
                    total: result.total,
                    page: result.page
                }
            });

            return res.json({
                success: true,
                data: result.sessions,
                meta: {
                    total: result.total,
                    page: result.page,
                    totalPages: result.totalPages
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;

            if (error instanceof z.ZodError) {
                loggingService.warn('Session replay list retrieval failed - validation error', {
                    requestId,
                    errors: error.errors,
                    duration
                });

                return res.status(400).json({
                    success: false,
                    error: 'Validation failed',
                    details: error.errors
                });
            }

            loggingService.error('Session replay list retrieval failed', {
                requestId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });

            return res.status(500).json({
                success: false,
                error: 'Failed to list session replays',
                message: error.message || 'Unknown error'
            });
        }
    }

    /**
     * Add snapshot to session
     * POST /api/v1/session-replay/:sessionId/snapshot
     */
    async addSnapshot(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const { sessionId } = req.params;

        try {
            // Validate request body
            const validatedBody = AddSnapshotSchema.parse(req.body);

            loggingService.info('Adding snapshot to session', {
                requestId,
                sessionId,
                hasCodeContext: !!validatedBody.codeContext,
                hasAIInteraction: !!validatedBody.aiInteraction,
                hasUserAction: !!validatedBody.userAction
            });

            // Use inAppRecordingService for better AI interaction tracking
            const { inAppRecordingService } = await import('../services/inAppRecording.service');
            const { aiInteraction, userAction, codeContext, captureSystemMetrics } = validatedBody;

            // Record AI interaction with full metadata
            if (aiInteraction) {
                await inAppRecordingService.recordInteraction(sessionId, {
                    model: aiInteraction.model,
                    prompt: aiInteraction.prompt,
                    response: aiInteraction.response,
                    parameters: aiInteraction.parameters,
                    tokens: aiInteraction.tokens,
                    cost: aiInteraction.cost,
                    latency: req.body.latency,
                    provider: req.body.provider,
                    requestMetadata: req.body.requestMetadata,
                    responseMetadata: req.body.responseMetadata
                });
            }

            // Record user action
            if (userAction) {
                await inAppRecordingService.recordUserAction(sessionId, {
                    action: userAction.action,
                    details: userAction.details
                });
            }

            // Record code context
            if (codeContext) {
                await inAppRecordingService.recordCodeContext(sessionId, {
                    filePath: codeContext.filePath,
                    content: codeContext.content,
                    language: codeContext.language
                });
            }

            // Capture system metrics if requested
            if (captureSystemMetrics) {
                await inAppRecordingService.captureSystemMetrics(sessionId);
            }

            const duration = Date.now() - startTime;

            loggingService.info('Snapshot added successfully', {
                requestId,
                duration,
                sessionId
            });

            // Log business event
            loggingService.logBusiness({
                event: 'session_snapshot_added',
                category: 'replay',
                value: duration,
                metadata: {
                    sessionId,
                    hasCodeContext: !!validatedBody.codeContext,
                    hasAIInteraction: !!validatedBody.aiInteraction
                }
            });

            return res.json({
                success: true,
                message: 'Snapshot added successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;

            if (error instanceof z.ZodError) {
                loggingService.warn('Add snapshot failed - validation error', {
                    requestId,
                    sessionId,
                    errors: error.errors,
                    duration
                });

                return res.status(400).json({
                    success: false,
                    error: 'Validation failed',
                    details: error.errors
                });
            }

            loggingService.error('Add snapshot failed', {
                requestId,
                sessionId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });

            return res.status(500).json({
                success: false,
                error: 'Failed to add snapshot',
                message: error.message || 'Unknown error'
            });
        }
    }

    /**
     * Get session player data (optimized for frontend playback)
     * GET /api/v1/session-replay/:sessionId/player
     */
    async getSessionPlayer(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const { sessionId } = req.params;

        try {
            loggingService.info('Session player data retrieval initiated', {
                requestId,
                sessionId
            });

            const session = await sessionReplayService.getSessionReplay(sessionId);
            const duration = Date.now() - startTime;

            if (!session) {
                loggingService.warn('Session player data retrieval failed - session not found', {
                    requestId,
                    sessionId
                });

                return res.status(404).json({
                    success: false,
                    error: 'Session not found'
                });
            }

            // Transform data for player
            const playerData = {
                sessionId: session.sessionId,
                userId: session.userId,
                workspaceId: session.workspaceId,
                label: session.label,
                startedAt: session.startedAt,
                endedAt: session.endedAt,
                status: session.status,
                source: session.source,
                trackingEnabled: session.trackingEnabled,
                sessionReplayEnabled: session.sessionReplayEnabled,
                duration: session.endedAt 
                    ? session.endedAt.getTime() - session.startedAt.getTime()
                    : Date.now() - session.startedAt.getTime(),
                summary: session.summary,
                timeline: {
                    aiInteractions: session.replayData?.aiInteractions || [],
                    userActions: session.replayData?.userActions || [],
                    systemMetrics: session.replayData?.systemMetrics || []
                },
                codeSnapshots: session.replayData?.codeContext || [],
                trackingHistory: session.trackingHistory || []
            };

            loggingService.info('Session player data retrieved successfully', {
                requestId,
                duration,
                sessionId,
                aiInteractionsCount: playerData.timeline.aiInteractions.length,
                codeSnapshotsCount: playerData.codeSnapshots.length
            });

            // Log business event
            loggingService.logBusiness({
                event: 'session_player_data_retrieved',
                category: 'replay',
                value: duration,
                metadata: {
                    sessionId,
                    interactionsCount: playerData.timeline.aiInteractions.length
                }
            });

            return res.json({
                success: true,
                data: playerData
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;

            loggingService.error('Session player data retrieval failed', {
                requestId,
                sessionId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });

            return res.status(500).json({
                success: false,
                error: 'Failed to get session player data',
                message: error.message || 'Unknown error'
            });
        }
    }

    /**
     * Get session statistics
     * GET /api/v1/session-replay/stats
     */
    async getStats(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;

        try {
            const userId = (req as any).user?.userId || (req as any).user?._id?.toString();

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    error: 'User not authenticated'
                });
            }

            loggingService.info('Session stats retrieval initiated', {
                requestId,
                userId
            });

            const stats = await sessionReplayService.getSessionStats(userId);
            const duration = Date.now() - startTime;

            loggingService.info('Session stats retrieved successfully', {
                requestId,
                duration,
                totalSessions: stats.totalSessions
            });

            return res.json({
                success: true,
                data: stats
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;

            loggingService.error('Session stats retrieval failed', {
                requestId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });

            return res.status(500).json({
                success: false,
                error: 'Failed to get session stats',
                message: error.message || 'Unknown error'
            });
        }
    }

    /**
     * Export session data
     * POST /api/v1/session-replay/export/:sessionId
     */
    async exportSession(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const { sessionId } = req.params;
        const { format } = req.body;

        try {
            if (!format || !['json', 'csv'].includes(format)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid format. Must be "json" or "csv"'
                });
            }

            loggingService.info('Session export initiated', {
                requestId,
                sessionId,
                format
            });

            const data = await sessionReplayService.exportSession(sessionId, format);
            const duration = Date.now() - startTime;

            loggingService.info('Session exported successfully', {
                requestId,
                duration,
                sessionId,
                format
            });

            return res.json({
                success: true,
                data,
                format
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;

            loggingService.error('Session export failed', {
                requestId,
                sessionId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });

            return res.status(500).json({
                success: false,
                error: 'Failed to export session',
                message: error.message || 'Unknown error'
            });
        }
    }

    /**
     * Generate shareable link for session
     * POST /api/v1/session-replay/share/:sessionId
     */
    async shareSession(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const { sessionId } = req.params;
        const { accessLevel, expiresIn, password } = req.body;

        try {
            loggingService.info('Session share link generation initiated', {
                requestId,
                sessionId,
                accessLevel
            });

            const shareInfo = await sessionReplayService.shareSession(sessionId, {
                accessLevel,
                expiresIn,
                password
            });
            
            const duration = Date.now() - startTime;

            loggingService.info('Session share link generated successfully', {
                requestId,
                duration,
                sessionId,
                shareToken: shareInfo.shareToken
            });

            return res.json({
                success: true,
                data: shareInfo
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;

            loggingService.error('Session share link generation failed', {
                requestId,
                sessionId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });

            return res.status(500).json({
                success: false,
                error: 'Failed to generate share link',
                message: error.message || 'Unknown error'
            });
        }
    }

    /**
     * Start a new in-app recording session
     * POST /api/v1/session-replay/recording/start
     */
    async startRecording(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const { userId, feature, label, metadata } = req.body;

        try {
            loggingService.info('Starting in-app recording session', {
                requestId,
                userId,
                feature,
                label
            });

            const { inAppRecordingService } = await import('../services/inAppRecording.service');
            const sessionId = await inAppRecordingService.startRecording(userId, feature, { ...metadata, label });
            
            const duration = Date.now() - startTime;

            loggingService.info('In-app recording session started successfully', {
                requestId,
                duration,
                sessionId,
                userId,
                feature
            });

            return res.json({
                success: true,
                sessionId,
                message: 'Recording session started'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;

            loggingService.error('Failed to start recording session', {
                requestId,
                userId,
                feature,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });

            return res.status(500).json({
                success: false,
                error: 'Failed to start recording session',
                message: error.message || 'Unknown error'
            });
        }
    }

}

export const sessionReplayController = new SessionReplayController();

