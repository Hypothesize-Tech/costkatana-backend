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
    status: z.enum(['active', 'completed', 'error']).optional(),
    source: z.enum(['telemetry', 'manual', 'unified', 'in-app', 'integration']).optional(),
    minCost: z.coerce.number().min(0).optional(),
    maxCost: z.coerce.number().min(0).optional(),
    minSpans: z.coerce.number().int().min(0).optional(),
    maxSpans: z.coerce.number().int().min(0).optional(),
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
    // Background processing queue
    private static backgroundQueue: Array<() => Promise<void>> = [];
    private static backgroundProcessor?: NodeJS.Timeout;
    
    // Circuit breaker for database operations
    private static dbFailureCount: number = 0;
    private static readonly MAX_DB_FAILURES = 5;
    private static readonly CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minutes
    private static lastDbFailureTime: number = 0;
    
    // Request timeout configuration
    private static readonly SUMMARY_TIMEOUT = 15000; // 15 seconds for summary calculations
    
    /**
     * Initialize background processor
     */
    static {
        this.startBackgroundProcessor();
    }
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
                label: labelStr,
                page: pageNum,
                limit: limitNum
            });

            // Check circuit breaker before proceeding
            if (TraceController.isDbCircuitBreakerOpen()) {
                throw new Error('Service temporarily unavailable');
            }

            const validation = ListSessionsSchema.safeParse(req.query);
            if (!validation.success) {
                loggingService.warn('Session listing failed - invalid query parameters', {
                    requestId,
                    validationErrors: validation.error.errors
                });

                return res.status(400).json({
                    success: false,
                    error: 'Invalid query parameters',
                    details: validation.error.errors
                });
            }

            // Override userId with authenticated user's ID
            const authenticatedUserId = (req as any).user?.userId || (req as any).user?._id?.toString();
            
            const filters = {
                ...validation.data,
                userId: authenticatedUserId, // Force filter by authenticated user
                from: validation.data.from ? new Date(validation.data.from) : undefined,
                to: validation.data.to ? new Date(validation.data.to) : undefined
            };

            const result = await traceService.listSessions(filters);
            const duration = Date.now() - startTime;

            loggingService.info('Sessions listed successfully', {
                requestId,
                duration,
                totalSessions: result.total,
                sessionsCount: result.sessions?.length || 0
            });

            // Queue background business event logging
            TraceController.queueBackgroundOperation(async () => {
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
            });

            return res.json({
                success: true,
                data: result
            });
        } catch (error: any) {
            TraceController.recordDbFailure();
            const duration = Date.now() - startTime;
            
            if (error.message === 'Service temporarily unavailable') {
                loggingService.warn('Trace service unavailable', {
                    requestId,
                    duration
                });
                
                return res.status(503).json({
                    success: false,
                    error: 'Service temporarily unavailable',
                    message: 'Please try again later'
                });
            }
            
            loggingService.error('Session listing failed', {
                requestId,
                error: error.message || 'Unknown error',
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
                    error: data.error,
                    aiModel: data.aiModel,
                    tokens: data.tokens,
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
    async getSessionsSummary(req: any, res: Response): Promise<Response> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        
        // Always use authenticated user ID from JWT token, not query params
        const authenticatedUserId = (req.user as any)?.id;
        if (!authenticatedUserId) {
            return res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
        }

        try {
            loggingService.info('Sessions summary retrieval initiated', {
                requestId,
                userId: authenticatedUserId
            });
            
            // Check circuit breaker before proceeding
            if (TraceController.isDbCircuitBreakerOpen()) {
                throw new Error('Service temporarily unavailable');
            }

            // Use timeout handling for summary calculation
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Summary calculation timeout')), TraceController.SUMMARY_TIMEOUT);
            });

            const summaryPromise = traceService.getSessionsSummary(authenticatedUserId);
            const summary = await Promise.race([summaryPromise, timeoutPromise]);
            const duration = Date.now() - startTime;
            
            loggingService.info('Sessions summary retrieved successfully', {
                requestId,
                duration,
                totalSessions: summary.totalSessions
            });

            // Queue background business event logging
            TraceController.queueBackgroundOperation(async () => {
                loggingService.logBusiness({
                    event: 'sessions_summary_retrieved',
                    category: 'trace',
                    value: duration,
                    metadata: {
                        userId: authenticatedUserId,
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
            });
            
            return res.json({
                success: true,
                data: summary
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Sessions summary retrieval failed', {
                requestId,
                userId: authenticatedUserId,
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

    /**
     * Circuit breaker utilities for database operations
     */
    private static isDbCircuitBreakerOpen(): boolean {
        if (this.dbFailureCount >= this.MAX_DB_FAILURES) {
            const timeSinceLastFailure = Date.now() - this.lastDbFailureTime;
            if (timeSinceLastFailure < this.CIRCUIT_BREAKER_RESET_TIME) {
                return true;
            } else {
                // Reset circuit breaker
                this.dbFailureCount = 0;
                return false;
            }
        }
        return false;
    }

    private static recordDbFailure(): void {
        this.dbFailureCount++;
        this.lastDbFailureTime = Date.now();
    }

    /**
     * Background processing utilities
     */
    private static queueBackgroundOperation(operation: () => Promise<void>): void {
        this.backgroundQueue.push(operation);
    }

    private static startBackgroundProcessor(): void {
        this.backgroundProcessor = setInterval(async () => {
            if (this.backgroundQueue.length > 0) {
                const operation = this.backgroundQueue.shift();
                if (operation) {
                    try {
                        await operation();
                    } catch (error) {
                        loggingService.error('Background operation failed:', {
                            error: error instanceof Error ? error.message : String(error)
                        });
                    }
                }
            }
        }, 1000);
    }

    /**
     * Cleanup method for graceful shutdown
     */
    static cleanup(): void {
        if (this.backgroundProcessor) {
            clearInterval(this.backgroundProcessor);
            this.backgroundProcessor = undefined;
        }
        
        // Process remaining queue items
        while (this.backgroundQueue.length > 0) {
            const operation = this.backgroundQueue.shift();
            if (operation) {
                operation().catch(error => {
                    loggingService.error('Cleanup operation failed:', {
                        error: error instanceof Error ? error.message : String(error)
                    });
                });
            }
        }
    }
}

export const traceController = new TraceController();
