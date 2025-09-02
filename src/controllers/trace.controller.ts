import { Request, Response } from 'express';
import { traceService } from '../services/trace.service';
import { z } from 'zod';
import { loggingService } from '../services/logging.service';

// Validation schemas
const ListSessionsSchema = z.object({
    userId: z.string().optional(),
    label: z.string().optional(),
    from: z.string().optional().refine((val) => {
        if (!val) return true;
        // Accept various datetime formats
        const date = new Date(val);
        return !isNaN(date.getTime());
    }, { message: "Invalid date format" }),
    to: z.string().optional().refine((val) => {
        if (!val) return true;
        // Accept various datetime formats
        const date = new Date(val);
        return !isNaN(date.getTime());
    }, { message: "Invalid date format" }),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional()
});

const IngestTraceSchema = z.object({
    sessionId: z.string().optional(),
    parentId: z.string().optional(),
    name: z.string(),
    type: z.enum(['http', 'llm', 'tool', 'database', 'custom']).optional(),
    status: z.enum(['ok', 'error']).optional(),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().optional(),
    error: z.object({
        message: z.string(),
        stack: z.string().optional()
    }).optional(),
    aiModel: z.string().optional(),
    tokens: z.object({
        input: z.number(),
        output: z.number()
    }).optional(),
    costUSD: z.number().optional(),
    tool: z.string().optional(),
    resourceIds: z.array(z.string()).optional(),
    metadata: z.record(z.any()).optional()
});

class TraceController {
    /**
     * List sessions with filters
     * GET /api/v1/sessions
     */
    async listSessions(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const { userId, label, from, to, page, limit } = req.query;
        const userIdStr = userId as string;
        const labelStr = label as string;
        const fromStr = from as string;
        const toStr = to as string;
        const pageNum = page !== undefined ? Number(page) : undefined;
        const limitNum = limit !== undefined ? Number(limit) : undefined;

        try {
            loggingService.info('Session listing initiated', {
                requestId,
                userId: userIdStr,
                hasUserId: !!userIdStr,
                label: labelStr,
                hasLabel: !!labelStr,
                from: fromStr,
                hasFrom: !!fromStr,
                to: toStr,
                hasTo: !!toStr,
                page: pageNum,
                hasPage: pageNum !== undefined,
                limit: limitNum,
                hasLimit: limitNum !== undefined
            });

            const validation = ListSessionsSchema.safeParse(req.query);
            if (!validation.success) {
                loggingService.warn('Session listing failed - invalid query parameters', {
                    requestId,
                    userId: userIdStr,
                    label: labelStr,
                    from: fromStr,
                    to: toStr,
                    page: pageNum,
                    limit: limitNum,
                    validationErrors: validation.error.errors
                });

                return res.status(400).json({
                    success: false,
                    error: 'Invalid query parameters',
                    details: validation.error.errors
                });
            }

            const filters = {
                ...validation.data,
                from: validation.data.from ? new Date(validation.data.from) : undefined,
                to: validation.data.to ? new Date(validation.data.to) : undefined
            };

            const result = await traceService.listSessions(filters);
            const duration = Date.now() - startTime;

            loggingService.info('Sessions listed successfully', {
                requestId,
                duration,
                userId: userIdStr,
                label: labelStr,
                from: fromStr,
                to: toStr,
                page: pageNum,
                limit: limitNum,
                totalSessions: result.total,
                sessionsCount: result.sessions?.length || 0,
                hasResult: !!result
            });

            // Log business event
            loggingService.logBusiness({
                event: 'sessions_listed',
                category: 'trace',
                value: duration,
                metadata: {
                    userId: userIdStr,
                    label: labelStr,
                    hasDateRange: !!(fromStr && toStr),
                    page: pageNum,
                    limit: limitNum,
                    totalSessions: result.total,
                    sessionsCount: result.sessions?.length || 0
                }
            });

            return res.json({
                success: true,
                data: result
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Session listing failed', {
                requestId,
                userId: userIdStr,
                label: labelStr,
                from: fromStr,
                to: toStr,
                page: pageNum,
                limit: limitNum,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            return res.status(500).json({
                success: false,
                error: 'Failed to list sessions'
            });
        }
    }

    /**
     * Get session graph
     * GET /api/v1/sessions/:id/graph
     */
    async getSessionGraph(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const { id } = req.params;

        try {
            loggingService.info('Session graph retrieval initiated', {
                requestId,
                sessionId: id,
                hasSessionId: !!id
            });
            
            const graph = await traceService.getSessionGraph(id);
            const duration = Date.now() - startTime;
            
            loggingService.info('Session graph retrieved successfully', {
                requestId,
                duration,
                sessionId: id,
                hasGraph: !!graph
            });

            // Log business event
            loggingService.logBusiness({
                event: 'session_graph_retrieved',
                category: 'trace',
                value: duration,
                metadata: {
                    sessionId: id,
                    hasGraph: !!graph
                }
            });
            
            return res.json({
                success: true,
                data: graph
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Session graph retrieval failed', {
                requestId,
                sessionId: id,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            return res.status(500).json({
                success: false,
                error: 'Failed to get session graph'
            });
        }
    }

    /**
     * Get session details
     * GET /api/v1/sessions/:id/details
     */
    async getSessionDetails(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const { id } = req.params;

        try {
            loggingService.info('Session details retrieval initiated', {
                requestId,
                sessionId: id,
                hasSessionId: !!id
            });
            
            const details = await traceService.getSessionDetails(id);
            const duration = Date.now() - startTime;
            
            if (!details.session) {
                loggingService.warn('Session details retrieval failed - session not found', {
                    requestId,
                    sessionId: id
                });

                return res.status(404).json({
                    success: false,
                    error: 'Session not found'
                });
            }
            
            loggingService.info('Session details retrieved successfully', {
                requestId,
                duration,
                sessionId: id,
                hasDetails: !!details,
                hasSession: !!details.session
            });

            // Log business event
            loggingService.logBusiness({
                event: 'session_details_retrieved',
                category: 'trace',
                value: duration,
                metadata: {
                    sessionId: id,
                    hasDetails: !!details,
                    hasSession: !!details.session
                }
            });
            
            return res.json({
                success: true,
                data: details
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Session details retrieval failed', {
                requestId,
                sessionId: id,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            return res.status(500).json({
                success: false,
                error: 'Failed to get session details'
            });
        }
    }

    /**
     * Ingest trace data (for external services)
     * POST /api/v1/traces/ingest
     */
    async ingestTrace(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const { sessionId, parentId, name, type, status, startedAt, endedAt, error, aiModel, tokens, costUSD, tool, resourceIds, metadata } = req.body;

        try {
            loggingService.info('Trace ingestion initiated', {
                requestId,
                sessionId,
                hasSessionId: !!sessionId,
                parentId,
                hasParentId: !!parentId,
                name,
                hasName: !!name,
                type,
                hasType: !!type,
                status,
                hasStatus: !!status,
                startedAt,
                hasStartedAt: !!startedAt,
                endedAt,
                hasEndedAt: !!endedAt,
                hasError: !!error,
                aiModel,
                hasAiModel: !!aiModel,
                hasTokens: !!tokens,
                costUSD,
                hasCostUSD: costUSD !== undefined,
                tool,
                hasTool: !!tool,
                hasResourceIds: !!resourceIds,
                resourceIdsCount: Array.isArray(resourceIds) ? resourceIds.length : 0,
                hasMetadata: !!metadata
            });

            const validation = IngestTraceSchema.safeParse(req.body);
            if (!validation.success) {
                loggingService.warn('Trace ingestion failed - invalid trace data', {
                    requestId,
                    sessionId,
                    parentId,
                    name,
                    type,
                    validationErrors: validation.error.errors
                });

                return res.status(400).json({
                    success: false,
                    error: 'Invalid trace data',
                    details: validation.error.errors
                });
            }

            const data = validation.data;
            
            // Start span
            const trace = await traceService.startSpan({
                sessionId: data.sessionId,
                parentId: data.parentId,
                name: data.name,
                type: data.type,
                metadata: data.metadata
            });

            // If endedAt is provided, end the span immediately
            if (data.endedAt) {
                await traceService.endSpan(trace.traceId, {
                    status: data.status,
                    error: data.error && data.error.message ? {
                        message: data.error.message,
                        stack: data.error.stack
                    } : undefined,
                    aiModel: data.aiModel,
                    tokens: data.tokens && typeof data.tokens.input === 'number' && typeof data.tokens.output === 'number' ? {
                        input: data.tokens.input,
                        output: data.tokens.output
                    } : undefined,
                    costUSD: data.costUSD,
                    tool: data.tool,
                    resourceIds: data.resourceIds,
                    metadata: data.metadata
                });
            }

            const duration = Date.now() - startTime;

            loggingService.info('Trace ingested successfully', {
                requestId,
                duration,
                sessionId: data.sessionId,
                parentId: data.parentId,
                name: data.name,
                type: data.type,
                status: data.status,
                startedAt: data.startedAt,
                endedAt: data.endedAt,
                hasError: !!data.error,
                aiModel: data.aiModel,
                hasTokens: !!data.tokens,
                costUSD: data.costUSD,
                tool: data.tool,
                hasResourceIds: !!data.resourceIds,
                hasMetadata: !!data.metadata,
                traceId: trace.traceId
            });

            // Log business event
            loggingService.logBusiness({
                event: 'trace_ingested',
                category: 'trace',
                value: duration,
                metadata: {
                    sessionId: data.sessionId,
                    parentId: data.parentId,
                    name: data.name,
                    type: data.type,
                    status: data.status,
                    hasError: !!data.error,
                    aiModel: data.aiModel,
                    hasTokens: !!data.tokens,
                    costUSD: data.costUSD,
                    tool: data.tool,
                    hasResourceIds: !!data.resourceIds,
                    hasMetadata: !!data.metadata,
                    traceId: trace.traceId
                }
            });

            return res.json({
                success: true,
                data: {
                    traceId: trace.traceId,
                    sessionId: trace.sessionId
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Trace ingestion failed', {
                requestId,
                sessionId,
                parentId,
                name,
                type,
                status,
                startedAt,
                endedAt,
                hasError: !!error,
                aiModel,
                hasTokens: !!tokens,
                costUSD,
                tool,
                hasResourceIds: !!resourceIds,
                hasMetadata: !!metadata,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            return res.status(500).json({
                success: false,
                error: 'Failed to ingest trace'
            });
        }
    }

    /**
     * End a session
     * POST /api/v1/sessions/:id/end
     */
    async endSession(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const { id } = req.params;

        try {
            loggingService.info('Session ending initiated', {
                requestId,
                sessionId: id,
                hasSessionId: !!id
            });
            
            const session = await traceService.endSession(id);
            const duration = Date.now() - startTime;
            
            if (!session) {
                loggingService.warn('Session ending failed - session not found', {
                    requestId,
                    sessionId: id
                });

                return res.status(404).json({
                    success: false,
                    error: 'Session not found'
                });
            }
            
            loggingService.info('Session ended successfully', {
                requestId,
                duration,
                sessionId: id,
                hasSession: !!session
            });

            // Log business event
            loggingService.logBusiness({
                event: 'session_ended',
                category: 'trace',
                value: duration,
                metadata: {
                    sessionId: id,
                    hasSession: !!session
                }
            });
            
            return res.json({
                success: true,
                data: session
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Session ending failed', {
                requestId,
                sessionId: id,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            return res.status(500).json({
                success: false,
                error: 'Failed to end session'
            });
        }
    }

    /**
     * Get sessions summary
     * GET /api/v1/sessions/summary
     */
    async getSessionsSummary(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const { userId } = req.query;
        const userIdStr = userId as string;

        try {
            loggingService.info('Sessions summary retrieval initiated', {
                requestId,
                userId: userIdStr,
                hasUserId: !!userIdStr
            });
            
            const sessions = await traceService.listSessions({
                userId: userIdStr,
                limit: 100
            });
            
            // Calculate summary statistics
            const summary = {
                totalSessions: sessions.total,
                activeSessions: sessions.sessions.filter(s => s.status === 'active').length,
                completedSessions: sessions.sessions.filter(s => s.status === 'completed').length,
                errorSessions: sessions.sessions.filter(s => s.status === 'error').length,
                totalCost: sessions.sessions.reduce((sum, s) => sum + (s.summary?.totalCost || 0), 0),
                totalTokens: {
                    input: sessions.sessions.reduce((sum, s) => sum + (s.summary?.totalTokens?.input || 0), 0),
                    output: sessions.sessions.reduce((sum, s) => sum + (s.summary?.totalTokens?.output || 0), 0)
                },
                averageDuration: sessions.sessions
                    .filter(s => s.summary?.totalDuration)
                    .reduce((sum, s, _, arr) => sum + (s.summary?.totalDuration || 0) / arr.length, 0)
            };
            const duration = Date.now() - startTime;
            
            loggingService.info('Sessions summary retrieved successfully', {
                requestId,
                duration,
                userId: userIdStr,
                totalSessions: summary.totalSessions,
                activeSessions: summary.activeSessions,
                completedSessions: summary.completedSessions,
                errorSessions: summary.errorSessions,
                totalCost: summary.totalCost,
                totalTokensInput: summary.totalTokens.input,
                totalTokensOutput: summary.totalTokens.output,
                averageDuration: summary.averageDuration
            });

            // Log business event
            loggingService.logBusiness({
                event: 'sessions_summary_retrieved',
                category: 'trace',
                value: duration,
                metadata: {
                    userId: userIdStr,
                    totalSessions: summary.totalSessions,
                    activeSessions: summary.activeSessions,
                    completedSessions: summary.completedSessions,
                    errorSessions: summary.errorSessions,
                    totalCost: summary.totalCost,
                    totalTokensInput: summary.totalTokens.input,
                    totalTokensOutput: summary.totalTokens.output,
                    averageDuration: summary.averageDuration
                }
            });
            
            return res.json({
                success: true,
                data: summary
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Sessions summary retrieval failed', {
                requestId,
                userId: userIdStr,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            return res.status(500).json({
                success: false,
                error: 'Failed to get sessions summary'
            });
        }
    }
}

export const traceController = new TraceController();
