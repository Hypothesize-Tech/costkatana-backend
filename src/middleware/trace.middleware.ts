import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { traceService } from '../services/trace.service';
import { logger } from '../utils/logger';

declare global {
    namespace Express {
        interface Request {
            traceContext?: {
                sessionId: string;
                traceId: string;
                parentId?: string;
            };
        }
    }
}

export const traceInterceptor = async (req: Request, res: Response, next: NextFunction) => {
    // Skip tracing for health checks and static assets
    if (req.path === '/' || req.path === '/health' || req.path.startsWith('/api/health')) {
        return next();
    }

    // Skip tracing for trace endpoints themselves to avoid recursion
    if (req.path.includes('/sessions') || req.path.includes('/traces')) {
        return next();
    }

    const sessionId = req.headers['x-session-id'] as string || 
                     req.headers['x-trace-session-id'] as string || 
                     uuidv4();
    const parentId = req.headers['x-parent-trace-id'] as string;

    try {
        // Start root span for this HTTP request
        const trace = await traceService.startSpan({
            sessionId,
            parentId,
            name: `${req.method} ${req.path}`,
            type: 'http',
            metadata: {
                method: req.method,
                path: req.path,
                query: req.query,
                headers: {
                    'user-agent': req.headers['user-agent'],
                    'content-type': req.headers['content-type']
                },
                ip: req.ip
            }
        });

        // Attach trace context to request
        req.traceContext = {
            sessionId,
            traceId: trace.traceId,
            parentId
        };

        // Store original res.json to intercept response
        const originalJson = res.json.bind(res);
        res.json = function(body: any) {
            // End the span when response is sent
            const endSpan = async () => {
                try {
                    await traceService.endSpan(trace.traceId, {
                        status: res.statusCode >= 400 ? 'error' : 'ok',
                        metadata: {
                            statusCode: res.statusCode,
                            responseSize: JSON.stringify(body).length
                        },
                        error: res.statusCode >= 400 ? {
                            message: body?.error || body?.message || `HTTP ${res.statusCode}`,
                        } : undefined
                    });
                } catch (error) {
                    logger.error('Error ending HTTP trace span:', error);
                }
            };

            // End span asynchronously without blocking response
            endSpan();
            
            return originalJson(body);
        };

        next();
    } catch (error) {
        logger.error('Error in trace interceptor:', error);
        // Continue without tracing if there's an error
        next();
    }
};
