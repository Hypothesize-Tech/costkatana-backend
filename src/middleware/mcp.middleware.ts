import { Request, Response, NextFunction } from 'express';
import { loggingService } from '../services/logging.service';
import { cacheService } from '../services/cache.service';

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
export const validateMCPRequest = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const startTime = Date.now();
    
    loggingService.info('=== MCP REQUEST VALIDATION MIDDLEWARE STARTED ===', {
        component: 'MCPMiddleware',
        operation: 'validateMCPRequest',
        type: 'mcp_validation',
        path: req.path,
        method: req.method
    });

    loggingService.info('Step 1: Initializing MCP context', {
        component: 'MCPMiddleware',
        operation: 'validateMCPRequest',
        type: 'mcp_validation',
        step: 'init_context'
    });

    // Add MCP context
    req.mcpContext = {
        startTime
    };

    // Track MCP client connection if client ID is provided
    const clientId = req.headers['x-mcp-client-id'] as string || req.ip || 'unknown';
    try {
        const existingConnection = await cacheService.get(`mcp_connection:${clientId}`);
        if (!existingConnection) {
            await mcpConnectionMonitor.trackConnection(clientId);
            
            loggingService.info('New MCP client connection tracked during validation', {
                component: 'MCPMiddleware',
                operation: 'validateMCPRequest',
                type: 'mcp_validation',
                step: 'new_connection_tracked',
                clientId
            });
        } else {
            await mcpConnectionMonitor.updateActivity(clientId);
            
            loggingService.debug('MCP client activity updated during validation', {
                component: 'MCPMiddleware',
                operation: 'validateMCPRequest',
                type: 'mcp_validation',
                step: 'activity_updated',
                clientId
            });
        }
    } catch (error) {
        loggingService.debug('Failed to track MCP client connection during validation', {
            component: 'MCPMiddleware',
            operation: 'validateMCPRequest',
            type: 'mcp_validation',
            step: 'connection_tracking_failed',
            clientId,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }

    loggingService.info('MCP context initialized successfully', {
        component: 'MCPMiddleware',
        operation: 'validateMCPRequest',
        type: 'mcp_validation',
        step: 'context_initialized',
        startTime
    });

    loggingService.info('Step 2: Checking request frequency', {
        component: 'MCPMiddleware',
        operation: 'validateMCPRequest',
        type: 'mcp_validation',
        step: 'check_frequency'
    });

    // Fast path for high-frequency requests to minimize processing overhead
    if (req.method === 'POST' && ['tools/list', 'resources/list', 'prompts/list'].includes(req.body?.method)) {
        loggingService.info('High-frequency MCP request detected, skipping detailed logging', {
            component: 'MCPMiddleware',
            operation: 'validateMCPRequest',
            type: 'mcp_validation',
            step: 'high_frequency_skip',
            method: req.body?.method,
            path: req.path
        });
        // Skip expensive logging for high-frequency requests to improve performance
        next();
        return;
    }

    loggingService.info('Step 3: Logging incoming MCP request', {
        component: 'MCPMiddleware',
        operation: 'validateMCPRequest',
        type: 'mcp_validation',
        step: 'log_request'
    });

    // Log incoming MCP request (only for non-high-frequency requests)
    loggingService.info('MCP Request incoming', {
        component: 'MCPMiddleware',
        operation: 'validateMCPRequest',
        type: 'mcp_validation',
        step: 'request_logged',
        method: req.method,
        path: req.path,
        headers: req.headers,
        body: req.method === 'POST' ? req.body : undefined
    });

    loggingService.info('Step 4: Validating JSON-RPC structure', {
        component: 'MCPMiddleware',
        operation: 'validateMCPRequest',
        type: 'mcp_validation',
        step: 'validate_jsonrpc'
    });

    // Validate JSON-RPC structure for POST requests
    if (req.method === 'POST') {
        const { jsonrpc, method } = req.body;
        
        if (jsonrpc !== '2.0') {
            loggingService.warn('Invalid JSON-RPC version detected', {
                component: 'MCPMiddleware',
                operation: 'validateMCPRequest',
                type: 'mcp_validation',
                step: 'invalid_jsonrpc_version',
                receivedVersion: jsonrpc,
                expectedVersion: '2.0'
            });

            // Record error for this client
            const clientId = req.headers['x-mcp-client-id'] as string || req.ip || 'unknown';
            try {
                await mcpConnectionMonitor.recordError(clientId);
                
                loggingService.debug('MCP validation error recorded for client', {
                    component: 'MCPMiddleware',
                    operation: 'validateMCPRequest',
                    type: 'mcp_validation',
                    step: 'error_recorded',
                    clientId,
                    errorType: 'invalid_jsonrpc_version'
                });
            } catch (error) {
                loggingService.debug('Failed to record MCP validation error', {
                    component: 'MCPMiddleware',
                    operation: 'validateMCPRequest',
                    type: 'mcp_validation',
                    step: 'error_recording_failed',
                    clientId,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }

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
            loggingService.warn('Missing or invalid method in JSON-RPC request', {
                component: 'MCPMiddleware',
                operation: 'validateMCPRequest',
                type: 'mcp_validation',
                step: 'missing_method',
                receivedMethod: method,
                methodType: typeof method
            });

            // Record error for this client
            const clientId = req.headers['x-mcp-client-id'] as string || req.ip || 'unknown';
            try {
                await mcpConnectionMonitor.recordError(clientId);
                
                loggingService.debug('MCP validation error recorded for client', {
                    component: 'MCPMiddleware',
                    operation: 'validateMCPRequest',
                    type: 'mcp_validation',
                    step: 'error_recorded',
                    clientId,
                    errorType: 'missing_method'
                });
            } catch (error) {
                loggingService.debug('Failed to record MCP validation error', {
                    component: 'MCPMiddleware',
                    operation: 'validateMCPRequest',
                    type: 'mcp_validation',
                    step: 'error_recording_failed',
                    clientId,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }

            res.status(400).json({
                jsonrpc: '2.0',
                error: {
                    code: -32600,
                    message: 'Invalid Request - method is required'
                }
            });
            return;
        }

        loggingService.info('JSON-RPC validation successful', {
            component: 'MCPMiddleware',
            operation: 'validateMCPRequest',
            type: 'mcp_validation',
            step: 'jsonrpc_validated',
            method,
            jsonrpc
        });
    }

    loggingService.info('MCP request validation completed successfully', {
        component: 'MCPMiddleware',
        operation: 'validateMCPRequest',
        type: 'mcp_validation',
        step: 'validation_complete',
        totalTime: `${Date.now() - startTime}ms`
    });

    loggingService.info('=== MCP REQUEST VALIDATION MIDDLEWARE COMPLETED ===', {
        component: 'MCPMiddleware',
        operation: 'validateMCPRequest',
        type: 'mcp_validation',
        step: 'completed',
        totalTime: `${Date.now() - startTime}ms`
    });

    next();
};

// MCP response timing middleware - optimized for performance-critical endpoints
export const mcpResponseTimer = (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    
    loggingService.info('=== MCP RESPONSE TIMER MIDDLEWARE STARTED ===', {
        component: 'MCPMiddleware',
        operation: 'mcpResponseTimer',
        type: 'mcp_timing',
        path: req.path,
        method: req.method
    });

    loggingService.info('Step 1: Setting up response timing monitoring', {
        component: 'MCPMiddleware',
        operation: 'mcpResponseTimer',
        type: 'mcp_timing',
        step: 'setup_monitoring'
    });

    const originalSend = res.send;
    
    res.send = function(data: any) {
        if (req.mcpContext) {
            const duration = Date.now() - req.mcpContext.startTime;
            
            loggingService.info('Response timing calculated', {
                component: 'MCPMiddleware',
                operation: 'mcpResponseTimer',
                type: 'mcp_timing',
                step: 'timing_calculated',
                duration,
                isHighFrequency: ['tools/list', 'resources/list', 'prompts/list'].includes(req.body?.method)
            });
            
            // Only log timing for non-high-frequency requests or if duration is unusually high
            if (!['tools/list', 'resources/list', 'prompts/list'].includes(req.body?.method) || duration > 1000) {
                loggingService.info('MCP Response sent', {
                    component: 'MCPMiddleware',
                    operation: 'mcpResponseTimer',
                    type: 'mcp_timing',
                    step: 'response_logged',
                    method: req.method,
                    path: req.path,
                    rpcMethod: req.body?.method,
                    duration,
                    statusCode: res.statusCode,
                    isHighFrequency: false,
                    isSlowRequest: duration > 1000
                });
            } else {
                loggingService.debug('High-frequency MCP response (timing not logged)', {
                    component: 'MCPMiddleware',
                    operation: 'mcpResponseTimer',
                    type: 'mcp_timing',
                    step: 'high_frequency_response',
                    method: req.body?.method,
                    duration
                });
            }
        }
        return originalSend.call(this, data);
    };

    loggingService.info('Response timing monitoring setup completed', {
        component: 'MCPMiddleware',
        operation: 'mcpResponseTimer',
        type: 'mcp_timing',
        step: 'monitoring_setup',
        setupTime: `${Date.now() - startTime}ms`
    });

    loggingService.info('=== MCP RESPONSE TIMER MIDDLEWARE COMPLETED ===', {
        component: 'MCPMiddleware',
        operation: 'mcpResponseTimer',
        type: 'mcp_timing',
        step: 'completed',
        setupTime: `${Date.now() - startTime}ms`
    });
    
    next();
};

// MCP Connection Monitor with Redis primary and in-memory fallback
class MCPConnectionMonitor {
    async trackConnection(clientId: string): Promise<void> {
        const startTime = Date.now();
        
        loggingService.info('=== MCP CONNECTION TRACKING STARTED ===', {
            component: 'MCPConnectionMonitor',
            operation: 'trackConnection',
            type: 'mcp_connection_tracking',
            clientId
        });

        loggingService.info('Step 1: Tracking new MCP connection', {
            component: 'MCPConnectionMonitor',
            operation: 'trackConnection',
            type: 'mcp_connection_tracking',
            step: 'track_connection',
            clientId
        });

        const connectionData = {
            lastActivity: Date.now(),
            errorCount: 0,
            requestCount: 0
        };

        // Store in Redis primary with in-memory fallback
        try {
            await cacheService.set(`mcp_connection:${clientId}`, connectionData, 3600, {
                type: 'mcp_connection',
                clientId,
                operation: 'track'
            });
            
            loggingService.info('MCP connection data stored in cache successfully', {
                component: 'MCPConnectionMonitor',
                operation: 'trackConnection',
                type: 'mcp_connection_tracking',
                step: 'cache_store_success',
                clientId,
                lastActivity: new Date(connectionData.lastActivity).toISOString()
            });
        } catch (error) {
            loggingService.warn('Failed to store MCP connection in cache, using fallback', {
                component: 'MCPConnectionMonitor',
                operation: 'trackConnection',
                type: 'mcp_connection_tracking',
                step: 'cache_store_failed',
                clientId,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
        
        loggingService.info('MCP connection tracked successfully', {
            component: 'MCPConnectionMonitor',
            operation: 'trackConnection',
            type: 'mcp_connection_tracking',
            step: 'connection_tracked',
            clientId,
            totalTime: `${Date.now() - startTime}ms`
        });

        loggingService.info('=== MCP CONNECTION TRACKING COMPLETED ===', {
            component: 'MCPConnectionMonitor',
            operation: 'trackConnection',
            type: 'mcp_connection_tracking',
            step: 'completed',
            clientId,
            totalTime: `${Date.now() - startTime}ms`
        });
    }

    async updateActivity(clientId: string): Promise<void> {
        const startTime = Date.now();
        
        loggingService.debug('=== MCP ACTIVITY UPDATE STARTED ===', {
            component: 'MCPConnectionMonitor',
            operation: 'updateActivity',
            type: 'mcp_activity_update',
            clientId
        });

        const now = Date.now();
        const connectionData = {
            lastActivity: now,
            errorCount: 0,
            requestCount: 1
        };

        // Update in cache
        try {
            const existingData = await cacheService.get<{ errorCount: number; requestCount: number }>(`mcp_connection:${clientId}`);
            if (existingData) {
                connectionData.errorCount = existingData.errorCount;
                connectionData.requestCount = existingData.requestCount + 1;
            }
            
            await cacheService.set(`mcp_connection:${clientId}`, connectionData, 3600, {
                type: 'mcp_connection',
                clientId,
                operation: 'update_activity'
            });
            
            loggingService.debug('MCP activity updated in cache successfully', {
                component: 'MCPConnectionMonitor',
                operation: 'updateActivity',
                type: 'mcp_activity_update',
                step: 'cache_update_success',
                clientId,
                requestCount: connectionData.requestCount
            });
        } catch (error) {
            loggingService.debug('Failed to update MCP activity in cache', {
                component: 'MCPConnectionMonitor',
                operation: 'updateActivity',
                type: 'mcp_activity_update',
                step: 'cache_update_failed',
                clientId,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }

        loggingService.debug('MCP activity updated successfully', {
            component: 'MCPConnectionMonitor',
            operation: 'updateActivity',
            type: 'mcp_activity_update',
            step: 'activity_updated',
            clientId,
            totalTime: `${Date.now() - startTime}ms`
        });
    }

    async recordError(clientId: string): Promise<void> {
        const startTime = Date.now();
        
        loggingService.debug('=== MCP ERROR RECORDING STARTED ===', {
            component: 'MCPConnectionMonitor',
            operation: 'recordError',
            type: 'mcp_error_recording',
            clientId
        });

        // Update error count in cache
        try {
            const existingData = await cacheService.get<{ lastActivity: number; errorCount: number; requestCount: number }>(`mcp_connection:${clientId}`);
            if (existingData) {
                existingData.errorCount++;
                await cacheService.set(`mcp_connection:${clientId}`, existingData, 3600, {
                    type: 'mcp_connection',
                    clientId,
                    operation: 'record_error'
                });
                
                loggingService.debug('MCP error recorded in cache successfully', {
                    component: 'MCPConnectionMonitor',
                    operation: 'recordError',
                    type: 'mcp_error_recording',
                    step: 'cache_error_recorded',
                    clientId,
                    errorCount: existingData.errorCount
                });
            }
        } catch (error) {
            loggingService.debug('Failed to record MCP error in cache', {
                component: 'MCPConnectionMonitor',
                operation: 'recordError',
                type: 'mcp_error_recording',
                step: 'cache_error_failed',
                clientId,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }

        loggingService.debug('MCP error recorded successfully', {
            component: 'MCPConnectionMonitor',
            operation: 'recordError',
            type: 'mcp_error_recording',
            step: 'error_recorded',
            clientId,
            totalTime: `${Date.now() - startTime}ms`
        });
    }

    async removeConnection(clientId: string): Promise<void> {
        const startTime = Date.now();
        
        loggingService.info('=== MCP CONNECTION REMOVAL STARTED ===', {
            component: 'MCPConnectionMonitor',
            operation: 'removeConnection',
            type: 'mcp_connection_removal',
            clientId
        });

        // Remove from cache
        try {
            await cacheService.delete(`mcp_connection:${clientId}`);
            
            loggingService.info('MCP connection removed from cache successfully', {
                component: 'MCPConnectionMonitor',
                operation: 'removeConnection',
                type: 'mcp_connection_removal',
                step: 'cache_removal_success',
                clientId
            });
        } catch (error) {
            loggingService.warn('Failed to remove MCP connection from cache', {
                component: 'MCPConnectionMonitor',
                operation: 'removeConnection',
                type: 'mcp_connection_removal',
                step: 'cache_removal_failed',
                clientId,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
        
        loggingService.info('MCP connection removed successfully', {
            component: 'MCPConnectionMonitor',
            operation: 'removeConnection',
            type: 'mcp_connection_removal',
            step: 'connection_removed',
            clientId,
            totalTime: `${Date.now() - startTime}ms`
        });

        loggingService.info('=== MCP CONNECTION REMOVAL COMPLETED ===', {
            component: 'MCPConnectionMonitor',
            operation: 'removeConnection',
            type: 'mcp_connection_removal',
            step: 'completed',
            clientId,
            totalTime: `${Date.now() - startTime}ms`
        });
    }

    async getActiveConnections(): Promise<Map<string, { lastActivity: number; errorCount: number; requestCount: number }>> {
        const startTime = Date.now();
        
        loggingService.debug('=== MCP ACTIVE CONNECTIONS RETRIEVAL STARTED ===', {
            component: 'MCPConnectionMonitor',
            operation: 'getActiveConnections',
            type: 'mcp_connections_retrieval',
            step: 'started'
        });

        // Note: This is a simplified approach - in production you might want to use Redis SCAN
        // For now, we'll return an empty map since we're not maintaining a local connections list
        // In a real implementation, you'd want to scan Redis keys or maintain a separate index
        
        loggingService.debug('Active MCP connections retrieval completed (simplified implementation)', {
            component: 'MCPConnectionMonitor',
            operation: 'getActiveConnections',
            type: 'mcp_connections_retrieval',
            step: 'retrieval_completed',
            note: 'Simplified implementation - no local connections list maintained',
            totalTime: `${Date.now() - startTime}ms`
        });

        return new Map(); // Return empty map for now
    }
}

// Create singleton instance
const mcpConnectionMonitor = new MCPConnectionMonitor();

// Export the connection monitor for external use
export { mcpConnectionMonitor };

/**
 * Get MCP connection statistics
 */
export async function getMCPConnectionStats(): Promise<{
    activeConnections: number;
    totalConnections: number;
    errorRates: { [clientId: string]: number };
}> {
    try {
        const activeConnections = await mcpConnectionMonitor.getActiveConnections();
        
        // Get error rates from cache
        const errorRates: { [clientId: string]: number } = {};
        let totalConnections = 0;
        
        // This is a simplified implementation - in production you'd want to scan Redis keys
        // For now, we'll return basic stats
        for (const [clientId, connection] of activeConnections.entries()) {
            if (connection.errorCount > 0) {
                errorRates[clientId] = connection.errorCount / connection.requestCount;
            }
            totalConnections++;
        }
        
        return {
            activeConnections: activeConnections.size,
            totalConnections,
            errorRates
        };
    } catch (error) {
        loggingService.error('Failed to get MCP connection stats', {
            component: 'MCPMiddleware',
            operation: 'getMCPConnectionStats',
            type: 'mcp_stats',
            step: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        return {
            activeConnections: 0,
            totalConnections: 0,
            errorRates: {}
        };
    }
}

/**
 * Clean up expired MCP connections
 */
export async function cleanupMCPConnections(): Promise<number> {
    try {
        const activeConnections = await mcpConnectionMonitor.getActiveConnections();
        let cleanedCount = 0;
        const now = Date.now();
        
        for (const [clientId, connection] of activeConnections.entries()) {
            // Remove connections inactive for more than 1 hour
            if (now - connection.lastActivity > 3600000) {
                await mcpConnectionMonitor.removeConnection(clientId);
                cleanedCount++;
            }
        }
        
        loggingService.info('MCP connections cleanup completed', {
            component: 'MCPMiddleware',
            operation: 'cleanupMCPConnections',
            type: 'mcp_cleanup',
            step: 'completed',
            cleanedCount,
            remainingConnections: activeConnections.size - cleanedCount
        });
        
        return cleanedCount;
    } catch (error) {
        loggingService.error('Failed to cleanup MCP connections', {
            component: 'MCPMiddleware',
            operation: 'cleanupMCPConnections',
            type: 'mcp_cleanup',
            step: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        return 0;
    }
}

/**
 * MCP Rate Limiting with Redis primary and in-memory fallback
 */
export function mcpRateLimit(
    maxRequests: number = 100,
    windowMs: number = 60000
): (req: Request, res: Response, next: NextFunction) => void {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const startTime = Date.now();
        
        loggingService.info('=== MCP RATE LIMIT MIDDLEWARE STARTED ===', {
            component: 'MCPMiddleware',
            operation: 'mcpRateLimit',
            type: 'mcp_rate_limit',
            path: req.path,
            method: req.method,
            maxRequests,
            windowMs
        });

        loggingService.info('Step 1: Identifying MCP client for rate limiting', {
            component: 'MCPMiddleware',
            operation: 'mcpRateLimit',
            type: 'mcp_rate_limit',
            step: 'identify_client'
        });

        // Identify client (IP or custom header)
        const clientId = req.headers['x-mcp-client-id'] as string || req.ip || 'unknown';
        const now = Date.now();
        const cacheKey = `mcp_rate_limit:${clientId}`;

        loggingService.info('MCP client identified for rate limiting', {
            component: 'MCPMiddleware',
            operation: 'mcpRateLimit',
            type: 'mcp_rate_limit',
            step: 'client_identified',
            clientId,
            cacheKey,
            hasCustomHeader: !!req.headers['x-mcp-client-id'],
            hasIP: !!req.ip
        });

        loggingService.info('Step 2: Tracking MCP client connection and activity', {
            component: 'MCPMiddleware',
            operation: 'mcpRateLimit',
            type: 'mcp_rate_limit',
            step: 'track_connection'
        });

        // Track client connection and update activity
        try {
            // Check if this is a new connection
            const existingConnection = await cacheService.get(`mcp_connection:${clientId}`);
            if (!existingConnection) {
                await mcpConnectionMonitor.trackConnection(clientId);
                
                loggingService.info('New MCP client connection tracked', {
                    component: 'MCPMiddleware',
                    operation: 'mcpRateLimit',
                    type: 'mcp_rate_limit',
                    step: 'new_connection_tracked',
                    clientId
                });
            } else {
                await mcpConnectionMonitor.updateActivity(clientId);
                
                loggingService.debug('MCP client activity updated', {
                    component: 'MCPMiddleware',
                    operation: 'mcpRateLimit',
                    type: 'mcp_rate_limit',
                    step: 'activity_updated',
                    clientId
                });
            }
        } catch (error) {
            loggingService.warn('Failed to track MCP client connection/activity', {
                component: 'MCPMiddleware',
                operation: 'mcpRateLimit',
                type: 'mcp_rate_limit',
                step: 'connection_tracking_failed',
                clientId,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }

        loggingService.info('Step 3: Retrieving MCP rate limit record from cache', {
            component: 'MCPMiddleware',
            operation: 'mcpRateLimit',
            type: 'mcp_rate_limit',
            step: 'retrieve_record'
        });

        // Get rate limit record from Redis/in-memory cache
        let record: { count: number; resetTime: number } | null = null;
        try {
            const cachedRecord = await cacheService.get(cacheKey);
            if (cachedRecord) {
                record = cachedRecord as { count: number; resetTime: number };
                
                loggingService.info('MCP rate limit record retrieved from cache', {
                    component: 'MCPMiddleware',
                    operation: 'mcpRateLimit',
                    type: 'mcp_rate_limit',
                    step: 'record_retrieved',
                    clientId,
                    cacheKey,
                    currentCount: record.count,
                    resetTime: new Date(record.resetTime).toISOString(),
                    timeUntilReset: record.resetTime - now
                });
            }
        } catch (error) {
            loggingService.warn('Failed to retrieve MCP rate limit record from cache', {
                component: 'MCPMiddleware',
                operation: 'mcpRateLimit',
                type: 'mcp_rate_limit',
                step: 'cache_retrieve_failed',
                clientId,
                cacheKey,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }

        loggingService.info('Step 3: Processing MCP rate limit record', {
            component: 'MCPMiddleware',
            operation: 'mcpRateLimit',
            type: 'mcp_rate_limit',
            step: 'process_record'
        });

        // Check if record exists and is still valid
        if (!record || record.resetTime < now) {
            // Create new record
            record = {
                count: 1,
                resetTime: now + windowMs
            };
            
            loggingService.info('New MCP rate limit record created', {
                component: 'MCPMiddleware',
                operation: 'mcpRateLimit',
                type: 'mcp_rate_limit',
                step: 'record_created',
                clientId,
                cacheKey,
                resetTime: new Date(record.resetTime).toISOString(),
                windowMs
            });
        } else {
            // Increment existing record
            record.count++;
            
            loggingService.info('Existing MCP rate limit record incremented', {
                component: 'MCPMiddleware',
                operation: 'mcpRateLimit',
                type: 'mcp_rate_limit',
                step: 'record_incremented',
                clientId,
                cacheKey,
                newCount: record.count,
                maxRequests,
                remaining: maxRequests - record.count
            });
        }

        loggingService.info('Step 4: Checking MCP rate limit status', {
            component: 'MCPMiddleware',
            operation: 'mcpRateLimit',
            type: 'mcp_rate_limit',
            step: 'check_limit'
        });

        // Check if limit exceeded
        if (record.count > maxRequests) {
            const retryAfter = Math.ceil((record.resetTime - now) / 1000);
            
            loggingService.warn('MCP rate limit exceeded', {
                component: 'MCPMiddleware',
                operation: 'mcpRateLimit',
                type: 'mcp_rate_limit',
                step: 'limit_exceeded',
                clientId,
                cacheKey,
                count: record.count,
                maxRequests,
                retryAfter,
                resetTime: new Date(record.resetTime).toISOString()
            });

            // Record error for this client
            try {
                await mcpConnectionMonitor.recordError(clientId);
                
                loggingService.info('MCP rate limit error recorded for client', {
                    component: 'MCPMiddleware',
                    operation: 'mcpRateLimit',
                    type: 'mcp_rate_limit',
                    step: 'error_recorded',
                    clientId
                });
            } catch (error) {
                loggingService.debug('Failed to record MCP rate limit error', {
                    component: 'MCPMiddleware',
                    operation: 'mcpRateLimit',
                    type: 'mcp_rate_limit',
                    step: 'error_recording_failed',
                    clientId,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }

            loggingService.info('Step 4a: Sending MCP rate limit exceeded response', {
                component: 'MCPMiddleware',
                operation: 'mcpRateLimit',
                type: 'mcp_rate_limit',
                step: 'send_limit_response'
            });

            res.status(429).json({
                error: 'MCP rate limit exceeded',
                message: 'Too many MCP requests, please try again later.',
                retryAfter
            });

            loggingService.info('MCP rate limit exceeded response sent', {
                component: 'MCPMiddleware',
                operation: 'mcpRateLimit',
                type: 'mcp_rate_limit',
                step: 'response_sent',
                statusCode: 429,
                retryAfter,
                totalTime: `${Date.now() - startTime}ms`
            });

            loggingService.info('=== MCP RATE LIMIT MIDDLEWARE COMPLETED (LIMIT EXCEEDED) ===', {
                component: 'MCPMiddleware',
                operation: 'mcpRateLimit',
                type: 'mcp_rate_limit',
                step: 'completed_limit_exceeded',
                totalTime: `${Date.now() - startTime}ms`
            });

            return;
        }
        
        loggingService.info('Step 5: Storing updated MCP rate limit record in cache', {
            component: 'MCPMiddleware',
            operation: 'mcpRateLimit',
            type: 'mcp_rate_limit',
            step: 'store_record'
        });

        // Store updated record in cache
        try {
            const ttl = Math.ceil((record.resetTime - now) / 1000);
            await cacheService.set(cacheKey, record, ttl, {
                type: 'mcp_rate_limit',
                clientId,
                maxRequests,
                windowMs
            });
            
            loggingService.info('MCP rate limit record stored in cache successfully', {
                component: 'MCPMiddleware',
                operation: 'mcpRateLimit',
                type: 'mcp_rate_limit',
                step: 'record_stored',
                clientId,
                cacheKey,
                ttl,
                count: record.count,
                resetTime: new Date(record.resetTime).toISOString()
            });
        } catch (error) {
            loggingService.warn('Failed to store MCP rate limit record in cache', {
                component: 'MCPMiddleware',
                operation: 'mcpRateLimit',
                type: 'mcp_rate_limit',
                step: 'cache_store_failed',
                clientId,
                cacheKey,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }

        loggingService.info('MCP rate limit check completed successfully', {
            component: 'MCPMiddleware',
            operation: 'mcpRateLimit',
            type: 'mcp_rate_limit',
            step: 'check_complete',
            clientId,
            cacheKey,
            currentCount: record.count,
            maxRequests,
            remaining: maxRequests - record.count,
            totalTime: `${Date.now() - startTime}ms`
        });

        loggingService.info('=== MCP RATE LIMIT MIDDLEWARE COMPLETED ===', {
            component: 'MCPMiddleware',
            operation: 'mcpRateLimit',
            type: 'mcp_rate_limit',
            step: 'completed',
            clientId,
            totalTime: `${Date.now() - startTime}ms`
        });
        
        next();
    };
} 