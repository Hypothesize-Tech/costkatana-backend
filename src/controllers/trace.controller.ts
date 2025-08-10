import { Request, Response } from 'express';
import { traceService } from '../services/trace.service';
import { z } from 'zod';
import { logger } from '../utils/logger';

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
        try {
            const validation = ListSessionsSchema.safeParse(req.query);
            if (!validation.success) {
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

            return res.json({
                success: true,
                data: result
            });
        } catch (error) {
            logger.error('Error listing sessions:', error);
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
        try {
            const { id } = req.params;
            
            const graph = await traceService.getSessionGraph(id);
            
            return res.json({
                success: true,
                data: graph
            });
        } catch (error) {
            logger.error('Error getting session graph:', error);
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
        try {
            const { id } = req.params;
            
            const details = await traceService.getSessionDetails(id);
            
            if (!details.session) {
                return res.status(404).json({
                    success: false,
                    error: 'Session not found'
                });
            }
            
            return res.json({
                success: true,
                data: details
            });
        } catch (error) {
            logger.error('Error getting session details:', error);
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
        try {
            const validation = IngestTraceSchema.safeParse(req.body);
            if (!validation.success) {
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

            return res.json({
                success: true,
                data: {
                    traceId: trace.traceId,
                    sessionId: trace.sessionId
                }
            });
        } catch (error) {
            logger.error('Error ingesting trace:', error);
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
        try {
            const { id } = req.params;
            
            const session = await traceService.endSession(id);
            
            if (!session) {
                return res.status(404).json({
                    success: false,
                    error: 'Session not found'
                });
            }
            
            return res.json({
                success: true,
                data: session
            });
        } catch (error) {
            logger.error('Error ending session:', error);
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
        try {
            const { userId } = req.query;
            
            const sessions = await traceService.listSessions({
                userId: userId as string,
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
            
            return res.json({
                success: true,
                data: summary
            });
        } catch (error) {
            logger.error('Error getting sessions summary:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to get sessions summary'
            });
        }
    }
}

export const traceController = new TraceController();
