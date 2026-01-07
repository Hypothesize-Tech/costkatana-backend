import { Request, Response } from 'express';
import { loggingService } from '../services/logging.service';
import { MongoDBConnection, IMongoDBConnection } from '../models/MongoDBConnection';
import { MongoDBMCPService } from '../services/mongodbMcp.service';
import { MongoDBMCPPolicyService } from '../services/mongodbMcpPolicy.service';
import { circuitBreaker } from '../middleware/mongodbMcp.middleware';

/**
 * MongoDB MCP Controller
 * 
 * Handles HTTP requests for MongoDB MCP operations
 */

// Store MCP service instances per user+connection
const mcpServiceCache = new Map<string, MongoDBMCPService>();

/**
 * Get or create MCP service for user+connection
 */
async function getMCPService(userId: string, connectionId: string): Promise<MongoDBMCPService> {
    const cacheKey = `${userId}:${connectionId}`;
    
    let service = mcpServiceCache.get(cacheKey);
    if (!service) {
        service = new MongoDBMCPService({
            userId,
            connectionId,
            transport: 'http',
        });
        mcpServiceCache.set(cacheKey, service);
        
        loggingService.info('Created new MCP service instance', {
            component: 'mongodbMcpController',
            operation: 'getMCPService',
            cacheKey,
        });
    }
    
    return service;
}

/**
 * Handle MongoDB MCP tool call
 * POST /api/mcp/mongodb
 */
export const handleMongoDBMCPToolCall = async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    
    try {
        const context = req.mongodbMcpContext;
        if (!context) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: {
                    code: -32603,
                    message: 'Internal error: context not found',
                },
            });
            return;
        }

        // Extract JSON-RPC request
        const { method, params, id } = req.body;

        if (method !== 'tools/call') {
            res.status(400).json({
                jsonrpc: '2.0',
                id,
                error: {
                    code: -32601,
                    message: `Method not found: ${method}`,
                },
            });
            return;
        }

        const toolName = params?.name;
        const toolArguments = params?.arguments || {};

        if (!toolName) {
            res.status(400).json({
                jsonrpc: '2.0',
                id,
                error: {
                    code: -32602,
                    message: 'Invalid params: tool name is required',
                },
            });
            return;
        }

        loggingService.info('Handling MongoDB MCP tool call', {
            component: 'mongodbMcpController',
            operation: 'handleMongoDBMCPToolCall',
            toolName,
            userId: context.userId,
            connectionId: context.connectionId,
        });

        // Get MCP service
        const mcpService = await getMCPService(context.userId, context.connectionId);

        // Execute tool via MCP service (using internal method)
        const result = await (mcpService as any).handleToolCall(toolName, toolArguments);

        // Record success in circuit breaker
        circuitBreaker.recordSuccess(context.connectionId);

        const duration = Date.now() - startTime;

        loggingService.info('MongoDB MCP tool call completed', {
            component: 'mongodbMcpController',
            operation: 'handleMongoDBMCPToolCall',
            toolName,
            userId: context.userId,
            connectionId: context.connectionId,
            duration,
            success: !result.isError,
        });

        // Return JSON-RPC response
        res.json({
            jsonrpc: '2.0',
            id,
            result,
        });
    } catch (error) {
        const context = req.mongodbMcpContext;
        const duration = Date.now() - startTime;

        // Record failure in circuit breaker
        if (context?.connectionId) {
            circuitBreaker.recordFailure(context.connectionId);
        }

        loggingService.error('MongoDB MCP tool call failed', {
            component: 'mongodbMcpController',
            operation: 'handleMongoDBMCPToolCall',
            error: error instanceof Error ? error.message : String(error),
            duration,
        });

        res.status(500).json({
            jsonrpc: '2.0',
            id: req.body?.id,
            error: {
                code: -32603,
                message: error instanceof Error ? error.message : 'Internal server error',
            },
        });
    }
};

/**
 * List available MongoDB MCP tools
 * GET /api/mcp/mongodb/tools
 */
export const listMongoDBMCPTools = async (req: Request, res: Response): Promise<void> => {
    try {
        // Create temporary service to get tool definitions
        const service = new MongoDBMCPService({
            userId: 'temp',
            connectionId: 'temp',
            transport: 'http',
        });

        const tools = (service as any).getToolDefinitions();

        res.json({
            success: true,
            count: tools.length,
            tools,
        });
    } catch (error) {
        loggingService.error('Failed to list MongoDB MCP tools', {
            component: 'mongodbMcpController',
            operation: 'listMongoDBMCPTools',
            error: error instanceof Error ? error.message : String(error),
        });

        res.status(500).json({
            success: false,
            message: 'Failed to list tools',
        });
    }
};

/**
 * Get user's MongoDB connections
 * GET /api/mcp/mongodb/connections
 */
export const getUserMongoDBConnections = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = (req as any).userId || (req as any).user?.id;

        const connections = await MongoDBConnection.find({
            userId,
        }).select('-connectionString').sort({ lastUsed: -1, createdAt: -1 });

        res.json({
            success: true,
            count: connections.length,
            data: connections,
        });
    } catch (error) {
        loggingService.error('Failed to get MongoDB connections', {
            component: 'mongodbMcpController',
            operation: 'getUserMongoDBConnections',
            error: error instanceof Error ? error.message : String(error),
        });

        res.status(500).json({
            success: false,
            message: 'Failed to retrieve connections',
        });
    }
};

/**
 * Get a single MongoDB connection
 * GET /api/mcp/mongodb/connections/:connectionId
 */
export const getMongoDBConnection = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = (req as any).userId || (req as any).user?.id;
        const connectionId = req.params.connectionId;

        const connection = await MongoDBConnection.findOne({
            _id: connectionId,
            userId,
        }).select('-connectionString');

        if (!connection) {
            res.status(404).json({
                success: false,
                message: 'Connection not found',
            });
            return;
        }

        res.json({
            success: true,
            data: connection,
        });
    } catch (error) {
        loggingService.error('Failed to get MongoDB connection', {
            component: 'mongodbMcpController',
            operation: 'getMongoDBConnection',
            error: error instanceof Error ? error.message : String(error),
        });

        res.status(500).json({
            success: false,
            message: 'Failed to retrieve connection',
        });
    }
};

/**
 * Create new MongoDB connection
 * POST /api/mcp/mongodb/connections
 */
/**
 * Parse MongoDB connection string to extract metadata
 */
function parseMongoDBConnectionString(connectionString: string): {
    host?: string;
    port?: number;
    database?: string;
    username?: string;
    provider?: 'atlas' | 'self-hosted' | 'aws-documentdb' | 'azure-cosmos';
    region?: string;
} {
    const metadata: {
        host?: string;
        port?: number;
        database?: string;
        username?: string;
        provider?: 'atlas' | 'self-hosted' | 'aws-documentdb' | 'azure-cosmos';
        region?: string;
    } = {};

    try {
        // Parse MongoDB connection string
        // Format: mongodb://[username:password@]host[:port][/database][?options]
        // Format: mongodb+srv://[username:password@]host[/database][?options]
        
        const url = new URL(connectionString);
        
        // Extract username
        if (url.username) {
            metadata.username = decodeURIComponent(url.username);
        }
        
        // Extract host
        if (url.hostname) {
            metadata.host = url.hostname;
        }
        
        // Extract port (only for non-SRV connections)
        if (url.port && !connectionString.includes('mongodb+srv://')) {
            metadata.port = parseInt(url.port, 10);
        }
        
        // Extract database from path
        if (url.pathname && url.pathname.length > 1) {
            // Remove leading slash
            const dbName = url.pathname.substring(1);
            if (dbName) {
                metadata.database = dbName;
            }
        }
        
        // Determine provider
        if (connectionString.includes('mongodb+srv://')) {
            metadata.provider = 'atlas';
            // Try to extract region from hostname (Atlas format: cluster0.xxxxx.mongodb.net)
            const hostParts = url.hostname.split('.');
            if (hostParts.length >= 3) {
                // Atlas clusters often have region info in subdomain or we can infer from hostname
                // For now, we'll just mark it as Atlas
            }
        } else if (connectionString.includes('docdb.amazonaws.com') || connectionString.includes('documentdb')) {
            metadata.provider = 'aws-documentdb';
        } else if (connectionString.includes('cosmos.azure.com') || connectionString.includes('cosmosdb')) {
            metadata.provider = 'azure-cosmos';
        } else {
            metadata.provider = 'self-hosted';
        }
        
        // Extract region from query params if available (some providers include this)
        if (url.searchParams.has('region')) {
            metadata.region = url.searchParams.get('region') || undefined;
        }
        
    } catch (error) {
        // If parsing fails, we'll just skip metadata extraction
        // The connection string will still be stored and can be validated
        loggingService.warn('Failed to parse MongoDB connection string for metadata', {
            component: 'mongodbMcpController',
            operation: 'parseMongoDBConnectionString',
            error: error instanceof Error ? error.message : String(error),
        });
    }
    
    return metadata;
}

/**
 * Sanitize MongoDB database name
 * MongoDB database names must be alphanumeric and can contain underscores or hyphens
 * Cannot contain spaces or special characters
 */
function sanitizeDatabaseName(name: string): string {
    if (!name) return name;
    // Replace spaces and invalid characters with underscores
    // Keep only alphanumeric, underscores, and hyphens
    return name
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_{2,}/g, '_') // Replace multiple underscores with single
        .replace(/^_+|_+$/g, ''); // Remove leading/trailing underscores
}


export const createMongoDBConnection = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = (req as any).userId || (req as any).user?.id;
        
        if (!userId) {
            res.status(401).json({
                success: false,
                message: 'User ID not found. Authentication required.',
            });
            return;
        }
        const { alias, connectionString, database, metadata } = req.body;

        if (!alias || !connectionString) {
            res.status(400).json({
                success: false,
                message: 'Alias and connection string are required',
            });
            return;
        }

        // Database is now required
        if (!database || typeof database !== 'string' || database.trim().length === 0) {
            res.status(400).json({
                success: false,
                message: 'Database name is required. Please specify the database name from your connection string (e.g., if your URL ends with /test, enter "test")',
            });
            return;
        }

        // Sanitize database name
        const trimmed = database.trim();
        const sanitizedDatabase = sanitizeDatabaseName(trimmed);
        
        // If sanitization resulted in empty string, reject it
        if (!sanitizedDatabase || sanitizedDatabase.length === 0) {
            res.status(400).json({
                success: false,
                message: 'Database name cannot be empty after sanitization. Please provide a valid database name with alphanumeric characters, underscores, or hyphens.',
            });
            return;
        }
        
        // Additional validation for length and format
        if (sanitizedDatabase.length > 64) {
            res.status(400).json({
                success: false,
                message: 'Database name cannot exceed 64 characters after sanitization.',
            });
            return;
        }
        
        // Check if it starts or ends with hyphen (invalid)
        if (sanitizedDatabase.startsWith('-') || sanitizedDatabase.endsWith('-')) {
            res.status(400).json({
                success: false,
                message: 'Database name cannot start or end with a hyphen.',
            });
            return;
        }

        // Check for duplicate alias
        const existing = await MongoDBConnection.findOne({ userId, alias });
        if (existing) {
            res.status(400).json({
                success: false,
                message: 'Connection with this alias already exists',
            });
            return;
        }

        // Parse connection string to extract metadata
        const parsedMetadata = parseMongoDBConnectionString(connectionString);
        
        // Merge parsed metadata with provided metadata (provided metadata takes precedence)
        // Remove database from parsedMetadata as it's stored at root level, not in metadata
        const { database: _parsedDb, ...parsedMetadataWithoutDb } = parsedMetadata;
        const finalMetadata = {
            ...parsedMetadataWithoutDb,
            ...metadata,
        };

        // Create connection with the required sanitized database name
        const connection = new MongoDBConnection({
            userId,
            alias,
            database: sanitizedDatabase,
            metadata: finalMetadata,
            isActive: true,
        });

        // Set encrypted connection string
        connection.setConnectionString(connectionString);

        // Validate connection before saving
        const validation = await connection.validateConnection();
        if (!validation.valid) {
            res.status(400).json({
                success: false,
                message: `Connection validation failed: ${validation.error}`,
            });
            return;
        }

        await connection.save();

        loggingService.info('MongoDB connection created', {
            component: 'mongodbMcpController',
            operation: 'createMongoDBConnection',
            userId,
            connectionId: connection._id,
            alias,
        });

        res.status(201).json({
            success: true,
            message: 'MongoDB connection created successfully',
            data: {
                _id: connection._id,
                alias: connection.alias,
                database: connection.database,
                metadata: connection.metadata,
                isActive: connection.isActive,
                lastValidated: connection.lastValidated,
                createdAt: connection.createdAt,
                updatedAt: connection.updatedAt,
            },
        });
    } catch (error) {
        loggingService.error('Failed to create MongoDB connection', {
            component: 'mongodbMcpController',
            operation: 'createMongoDBConnection',
            error: error instanceof Error ? error.message : String(error),
        });

        res.status(500).json({
            success: false,
            message: 'Failed to create connection',
        });
    }
};

/**
 * Update MongoDB connection
 * PUT /api/mcp/mongodb/connections/:connectionId
 */
export const updateMongoDBConnection = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = (req as any).userId || (req as any).user?.id;
        const connectionId = req.params.connectionId;
        const { alias, connectionString, database, metadata, isActive } = req.body;

        const connection = await MongoDBConnection.findOne({
            _id: connectionId,
            userId,
        }).select('+connectionString');

        if (!connection) {
            res.status(404).json({
                success: false,
                message: 'Connection not found',
            });
            return;
        }

        // Update fields
        if (alias) connection.alias = alias;
        if (database !== undefined) {
            // Sanitize database name if provided (automatically fix invalid characters)
            if (database && typeof database === 'string') {
                const trimmed = database.trim();
                if (trimmed.length > 0) {
                    // Automatically sanitize the database name
                    const sanitized = sanitizeDatabaseName(trimmed);
                    
                    // If sanitization resulted in empty string, reject it
                    if (!sanitized || sanitized.length === 0) {
                        res.status(400).json({
                            success: false,
                            message: 'Database name cannot be empty after sanitization. Please provide a valid database name with alphanumeric characters, underscores, or hyphens.',
                        });
                        return;
                    }
                    
                    // Additional validation for length and format
                    if (sanitized.length > 64) {
                        res.status(400).json({
                            success: false,
                            message: 'Database name cannot exceed 64 characters after sanitization.',
                        });
                        return;
                    }
                    
                    // Check if it starts or ends with hyphen (invalid)
                    if (sanitized.startsWith('-') || sanitized.endsWith('-')) {
                        res.status(400).json({
                            success: false,
                            message: 'Database name cannot start or end with a hyphen.',
                        });
                        return;
                    }
                    
                    connection.database = sanitized;
                } else {
                    connection.database = undefined;
                }
            } else {
                connection.database = undefined;
            }
        }
        if (metadata) connection.metadata = { ...connection.metadata, ...metadata };
        if (isActive !== undefined) connection.isActive = isActive;

        // Update connection string if provided
        if (connectionString) {
            connection.setConnectionString(connectionString);
            
            // Revalidate if connection string changed
            const validation = await connection.validateConnection();
            if (!validation.valid) {
                res.status(400).json({
                    success: false,
                    message: `Connection validation failed: ${validation.error}`,
                });
                return;
            }
        }

        await connection.save();

        loggingService.info('MongoDB connection updated', {
            component: 'mongodbMcpController',
            operation: 'updateMongoDBConnection',
            userId,
            connectionId,
        });

        // Clear MCP service cache for this connection
        const cacheKey = `${userId}:${connectionId}`;
        const cachedService = mcpServiceCache.get(cacheKey);
        if (cachedService) {
            await cachedService.close();
            mcpServiceCache.delete(cacheKey);
        }

        res.json({
            success: true,
            message: 'MongoDB connection updated successfully',
            data: {
                _id: connection._id,
                alias: connection.alias,
                database: connection.database,
                metadata: connection.metadata,
                isActive: connection.isActive,
                lastValidated: connection.lastValidated,
                updatedAt: connection.updatedAt,
                createdAt: connection.createdAt,
            },
        });
    } catch (error) {
        loggingService.error('Failed to update MongoDB connection', {
            component: 'mongodbMcpController',
            operation: 'updateMongoDBConnection',
            error: error instanceof Error ? error.message : String(error),
        });

        res.status(500).json({
            success: false,
            message: 'Failed to update connection',
        });
    }
};

/**
 * Delete MongoDB connection
 * DELETE /api/mcp/mongodb/connections/:connectionId
 */
export const deleteMongoDBConnection = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = (req as any).userId || (req as any).user?.id;
        const connectionId = req.params.connectionId;

        const connection = await MongoDBConnection.findOneAndDelete({
            _id: connectionId,
            userId,
        });

        if (!connection) {
            res.status(404).json({
                success: false,
                message: 'Connection not found',
            });
            return;
        }

        loggingService.info('MongoDB connection deleted', {
            component: 'mongodbMcpController',
            operation: 'deleteMongoDBConnection',
            userId,
            connectionId,
        });

        // Clear MCP service cache
        const cacheKey = `${userId}:${connectionId}`;
        const cachedService = mcpServiceCache.get(cacheKey);
        if (cachedService) {
            await cachedService.close();
            mcpServiceCache.delete(cacheKey);
        }

        res.json({
            success: true,
            message: 'MongoDB connection deleted successfully',
        });
    } catch (error) {
        loggingService.error('Failed to delete MongoDB connection', {
            component: 'mongodbMcpController',
            operation: 'deleteMongoDBConnection',
            error: error instanceof Error ? error.message : String(error),
        });

        res.status(500).json({
            success: false,
            message: 'Failed to delete connection',
        });
    }
};

/**
 * Validate MongoDB connection
 * POST /api/mcp/mongodb/connections/:connectionId/validate
 */
export const validateMongoDBConnectionEndpoint = async (req: Request, res: Response): Promise<void> => {
    try {
        const connection = (req as any).mongodbConnection as IMongoDBConnection;

        // Need to re-fetch with connection string
        const connWithString = await MongoDBConnection.findById(connection._id).select(
            '+connectionString'
        );

        if (!connWithString) {
            res.status(404).json({
                success: false,
                message: 'Connection not found',
            });
            return;
        }

        const validation = await connWithString.validateConnection();

        res.json({
            success: validation.valid,
            message: validation.valid
                ? 'Connection validated successfully'
                : `Validation failed: ${validation.error}`,
            validation,
        });
    } catch (error) {
        loggingService.error('Failed to validate MongoDB connection', {
            component: 'mongodbMcpController',
            operation: 'validateMongoDBConnectionEndpoint',
            error: error instanceof Error ? error.message : String(error),
        });

        res.status(500).json({
            success: false,
            message: 'Failed to validate connection',
        });
    }
};
