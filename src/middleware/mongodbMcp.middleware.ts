import { Request, Response, NextFunction } from 'express';
import { loggingService } from '../services/logging.service';
import { MongoDBConnection } from '../models/MongoDBConnection';
import { MongoDBMCPPolicyService } from '../services/mongodbMcpPolicy.service';

/**
 * MongoDB MCP Middleware
 * 
 * Handles authentication, authorization, and audit logging
 * for MongoDB MCP operations
 */

declare global {
    namespace Express {
        interface Request {
            mongodbMcpContext?: {
                connectionId: string;
                userId: string;
                startTime: number;
            };
        }
    }
}

/**
 * MongoDB MCP request middleware
 * Validates connection access and sets context
 */
export const mongodbMcpMiddleware = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    const startTime = Date.now();

    try {
        loggingService.info('MongoDB MCP middleware started', {
            component: 'mongodbMcpMiddleware',
            operation: 'mongodbMcpMiddleware',
            path: req.path,
            method: req.method,
        });

        // Extract user ID from authenticated request
        const userId = (req as any).user?.userId || (req as any).user?._id;
        if (!userId) {
            res.status(401).json({
                jsonrpc: '2.0',
                error: {
                    code: -32001,
                    message: 'Authentication required',
                },
            });
            return;
        }

        // Extract connection ID from request body (JSON-RPC params)
        const connectionId = req.body?.params?.connectionId || req.query.connectionId;
        if (!connectionId) {
            res.status(400).json({
                jsonrpc: '2.0',
                error: {
                    code: -32602,
                    message: 'Invalid params: connectionId is required',
                },
            });
            return;
        }

        // Verify connection exists and user has access
        const connection = await MongoDBConnection.findOne({
            _id: connectionId,
            userId,
            isActive: true,
        });

        if (!connection) {
            loggingService.warn('MongoDB connection not found or unauthorized', {
                component: 'mongodbMcpMiddleware',
                operation: 'mongodbMcpMiddleware',
                userId,
                connectionId,
            });

            res.status(404).json({
                jsonrpc: '2.0',
                error: {
                    code: -32001,
                    message: 'MongoDB connection not found or unauthorized',
                },
            });
            return;
        }

        // Check credential expiry
        if (connection.isCredentialExpired()) {
            loggingService.warn('MongoDB credentials expired', {
                component: 'mongodbMcpMiddleware',
                operation: 'mongodbMcpMiddleware',
                userId,
                connectionId,
            });

            res.status(401).json({
                jsonrpc: '2.0',
                error: {
                    code: -32001,
                    message: 'MongoDB credentials have expired. Please refresh your connection.',
                },
            });
            return;
        }

        // Set context for controller
        req.mongodbMcpContext = {
            connectionId,
            userId,
            startTime,
        };

        loggingService.info('MongoDB MCP middleware completed', {
            component: 'mongodbMcpMiddleware',
            operation: 'mongodbMcpMiddleware',
            userId,
            connectionId,
            duration: Date.now() - startTime,
        });

        next();
    } catch (error) {
        loggingService.error('MongoDB MCP middleware error', {
            component: 'mongodbMcpMiddleware',
            operation: 'mongodbMcpMiddleware',
            error: error instanceof Error ? error.message : String(error),
            duration: Date.now() - startTime,
        });

        res.status(500).json({
            jsonrpc: '2.0',
            error: {
                code: -32603,
                message: 'Internal server error',
            },
        });
    }
};

/**
 * Validate MongoDB connection access middleware
 * Used for connection management endpoints
 */
export const validateMongoDBConnectionAccess = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const userId = (req as any).user?.userId || (req as any).user?._id;
        const connectionId = req.params.connectionId;

        if (!userId) {
            res.status(401).json({
                success: false,
                message: 'Authentication required',
            });
            return;
        }

        if (!connectionId) {
            res.status(400).json({
                success: false,
                message: 'Connection ID is required',
            });
            return;
        }

        // Verify ownership
        const connection = await MongoDBConnection.findOne({
            _id: connectionId,
            userId,
        });

        if (!connection) {
            loggingService.warn('MongoDB connection access denied', {
                component: 'mongodbMcpMiddleware',
                operation: 'validateMongoDBConnectionAccess',
                userId,
                connectionId,
            });

            res.status(404).json({
                success: false,
                message: 'MongoDB connection not found or unauthorized',
            });
            return;
        }

        // Attach connection to request for controller
        (req as any).mongodbConnection = connection;

        next();
    } catch (error) {
        loggingService.error('MongoDB connection access validation error', {
            component: 'mongodbMcpMiddleware',
            operation: 'validateMongoDBConnectionAccess',
            error: error instanceof Error ? error.message : String(error),
        });

        res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
};

/**
 * Audit logging middleware
 * Logs all MongoDB MCP operations
 */
export const auditMongoDBMCPOperation = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    const startTime = Date.now();

    // Store original send
    const originalSend = res.send;

    // Override send to capture response
    res.send = function (data: any): Response {
        const duration = Date.now() - startTime;
        const context = req.mongodbMcpContext;

        if (context) {
            // Extract tool name and arguments from request
            const toolName = req.body?.method || req.body?.params?.name;
            const toolArgs = req.body?.params?.arguments;

            // Log audit trail
            loggingService.info('MongoDB MCP operation audit', {
                component: 'mongodbMcpMiddleware',
                operation: 'auditMongoDBMCPOperation',
                type: 'audit',
                userId: context.userId,
                connectionId: context.connectionId,
                toolName,
                toolArgsHash: toolArgs ? JSON.stringify(toolArgs).substring(0, 100) : undefined,
                duration,
                statusCode: res.statusCode,
                success: res.statusCode < 400,
            });

            // TODO: Store audit log in database for compliance
            // await AuditLog.create({ ... });
        }

        return originalSend.call(this, data);
    };

    next();
};

/**
 * Circuit breaker for customer MongoDB failures
 * Prevents cascading failures when customer DBs are unavailable
 */
class CircuitBreaker {
    private failures: Map<string, { count: number; lastFailure: number }> = new Map();
    private readonly THRESHOLD = 5; // Failures before opening circuit
    private readonly TIMEOUT = 60000; // 1 minute timeout
    private readonly RESET_TIME = 300000; // 5 minutes to reset

    isOpen(connectionId: string): boolean {
        const record = this.failures.get(connectionId);
        if (!record) return false;

        const now = Date.now();
        
        // Reset if enough time has passed
        if (now - record.lastFailure > this.RESET_TIME) {
            this.failures.delete(connectionId);
            return false;
        }

        // Check if threshold exceeded and timeout active
        if (record.count >= this.THRESHOLD && now - record.lastFailure < this.TIMEOUT) {
            return true;
        }

        return false;
    }

    recordFailure(connectionId: string): void {
        const record = this.failures.get(connectionId) || { count: 0, lastFailure: 0 };
        record.count++;
        record.lastFailure = Date.now();
        this.failures.set(connectionId, record);

        loggingService.warn('MongoDB circuit breaker recorded failure', {
            component: 'CircuitBreaker',
            operation: 'recordFailure',
            connectionId,
            failureCount: record.count,
            threshold: this.THRESHOLD,
        });
    }

    recordSuccess(connectionId: string): void {
        this.failures.delete(connectionId);
    }
}

export const circuitBreaker = new CircuitBreaker();

/**
 * Circuit breaker middleware
 */
export const mongodbCircuitBreakerMiddleware = (
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    const connectionId = req.body?.params?.connectionId || req.query.connectionId;

    if (connectionId && circuitBreaker.isOpen(connectionId)) {
        loggingService.warn('MongoDB circuit breaker open', {
            component: 'mongodbMcpMiddleware',
            operation: 'mongodbCircuitBreakerMiddleware',
            connectionId,
        });

        res.status(503).json({
            jsonrpc: '2.0',
            error: {
                code: -32001,
                message:
                    'MongoDB connection temporarily unavailable due to repeated failures. Please try again in a few minutes.',
            },
        });
        return;
    }

    next();
};
