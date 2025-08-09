import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

// Extend Request interface to include MCP-specific properties
declare global {
    namespace Express {
        interface Request {
            mcpContext?: {
                startTime: number;
                protocol?: string;
                clientInfo?: any;
            };
        }
    }
}

// MCP request validation middleware
export const validateMCPRequest = (req: Request, res: Response, next: NextFunction): void => {
    // Add MCP context
    req.mcpContext = {
        startTime: Date.now()
    };

    // Fast path for high-frequency requests to minimize processing overhead
    if (req.method === 'POST' && ['tools/list', 'resources/list', 'prompts/list'].includes(req.body?.method)) {
        // Skip expensive logging for high-frequency requests to improve performance
        next();
        return;
    }

    // Log incoming MCP request (only for non-high-frequency requests)
    logger.info('MCP Request incoming', {
        method: req.method,
        path: req.path,
        headers: req.headers,
        body: req.method === 'POST' ? req.body : undefined
    });

    // Validate JSON-RPC structure for POST requests
    if (req.method === 'POST') {
        const { jsonrpc, method } = req.body;
        
        if (jsonrpc !== '2.0') {
            res.status(400).json({
                jsonrpc: '2.0',
                error: {
                    code: -32600,
                    message: 'Invalid Request - JSON-RPC version must be 2.0'
                }
            });
            return;
        }

        if (!method || typeof method !== 'string') {
            res.status(400).json({
                jsonrpc: '2.0',
                error: {
                    code: -32600,
                    message: 'Invalid Request - method is required'
                }
            });
            return;
        }
    }

    next();
};

// MCP response timing middleware - optimized for performance-critical endpoints
export const mcpResponseTimer = (req: Request, res: Response, next: NextFunction) => {
    const originalSend = res.send;
    
    res.send = function(data: any) {
        if (req.mcpContext) {
            const duration = Date.now() - req.mcpContext.startTime;
            
            // Only log timing for non-high-frequency requests or if duration is unusually high
            if (!['tools/list', 'resources/list', 'prompts/list'].includes(req.body?.method) || duration > 1000) {
                logger.info('MCP Response sent', {
                    method: req.method,
                    path: req.path,
                    rpcMethod: req.body?.method,
                    duration,
                    statusCode: res.statusCode
                });
            }
        }
        return originalSend.call(this, data);
    };
    
    next();
};

// Connection health monitoring
export class MCPConnectionMonitor {
    private static connections = new Map<string, {
        established: Date;
        lastActivity: Date;
        errors: number;
    }>();

    static trackConnection(connectionId: string) {
        this.connections.set(connectionId, {
            established: new Date(),
            lastActivity: new Date(),
            errors: 0
        });
    }

    static updateActivity(connectionId: string) {
        const conn = this.connections.get(connectionId);
        if (conn) {
            conn.lastActivity = new Date();
        }
    }

    static recordError(connectionId: string) {
        const conn = this.connections.get(connectionId);
        if (conn) {
            conn.errors++;
            if (conn.errors > 5) {
                logger.warn('MCP Connection has high error rate', {
                    connectionId,
                    errors: conn.errors
                });
            }
        }
    }

    static removeConnection(connectionId: string) {
        const conn = this.connections.get(connectionId);
        if (conn) {
            const duration = Date.now() - conn.established.getTime();
            logger.info('MCP Connection closed', {
                connectionId,
                duration,
                errors: conn.errors
            });
            this.connections.delete(connectionId);
        }
    }

    static getActiveConnections() {
        return Array.from(this.connections.entries()).map(([id, info]) => ({
            id,
            ...info,
            active: Date.now() - info.lastActivity.getTime() < 60000 // Active if activity within last minute
        }));
    }
}

// Rate limiting for MCP endpoints
export const mcpRateLimit = (maxRequests: number = 100, windowMs: number = 60000) => {
    const requests = new Map<string, number[]>();

    return (req: Request, res: Response, next: NextFunction): void => {
        const clientId = req.ip || 'unknown';
        const now = Date.now();
        const clientRequests = requests.get(clientId) || [];
        
        // Remove old requests outside the window
        const validRequests = clientRequests.filter(time => now - time < windowMs);
        
        if (validRequests.length >= maxRequests) {
            logger.warn('MCP Rate limit exceeded', { clientId, requests: validRequests.length });
            res.status(429).json({
                jsonrpc: '2.0',
                error: {
                    code: -32000,
                    message: 'Rate limit exceeded'
                }
            });
            return;
        }
        
        validRequests.push(now);
        requests.set(clientId, validRequests);
        
        next();
    };
}; 