import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    Tool as MCPTool,
} from '@modelcontextprotocol/sdk/types.js';
import { MongoClient, Db } from 'mongodb';
import { loggingService } from './logging.service';
import { MongoDBConnection, IMongoDBConnection } from '../models/MongoDBConnection';
import { MongoDBMCPPolicyService } from './mongodbMcpPolicy.service';
import { mcpToolSyncerService } from './mcpToolSyncer.service';

/**
 * MongoDB MCP Core Service
 * 
 * Transport-agnostic MCP server implementation for MongoDB operations.
 * Provides 15 read-only tools with comprehensive security and guardrails.
 */

export interface MongoDBMCPConfig {
    userId: string;
    connectionId: string;
    transport?: 'stdio' | 'http';
}

export interface MCPToolResult {
    content: Array<{
        type: string;
        text?: string;
    }>;
    isError?: boolean;
}

export class MongoDBMCPService {
    private server: Server;
    private config: MongoDBMCPConfig;
    private connection?: IMongoDBConnection;
    private mongoClient?: MongoClient;
    private db?: Db;
    private connectionPool: Map<string, { client: MongoClient; lastUsed: number }> = new Map();
    private readonly POOL_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
    private readonly CONNECTION_IDLE_TIMEOUT = 10 * 60 * 1000; // 10 minutes

    constructor(config: MongoDBMCPConfig) {
        this.config = config;
        this.server = new Server(
            {
                name: 'mongodb-costkatana',
                version: '1.0.0',
            },
            {
                capabilities: {
                    tools: {},
                },
            }
        );

        this.setupHandlers();
        this.startConnectionPoolCleanup();
        
        // Sync tools to file registry
        this.syncToolsToRegistry();
    }
    
    /**
     * Sync MongoDB MCP tools to file registry for dynamic discovery
     */
    private async syncToolsToRegistry(): Promise<void> {
        try {
            const tools = this.getToolDefinitions();
            await mcpToolSyncerService.syncMongoDBTools(tools);
            loggingService.info('MongoDB MCP tools synced to registry', {
                toolCount: tools.length
            });
        } catch (error) {
            loggingService.warn('Failed to sync MongoDB tools to registry', {
                error: error instanceof Error ? error.message : String(error)
            });
            // Don't throw - this is non-critical
        }
    }

    /**
     * Setup MCP protocol handlers
     */
    private setupHandlers(): void {
        // List available tools
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: this.getToolDefinitions(),
        }));

        // Handle tool calls
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const result = await this.handleToolCall(request.params.name, request.params.arguments || {});
            return result as any; // MCP SDK type compatibility
        });
    }

    /**
     * Get all tool definitions
     */
    private getToolDefinitions(): MCPTool[] {
        return [
            // Query Tools
            {
                name: 'find',
                description: 'Execute a find query on a MongoDB collection. Returns up to 500 documents.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        collection: { type: 'string', description: 'Collection name' },
                        query: { type: 'object', description: 'MongoDB query filter' },
                        limit: { type: 'number', description: 'Maximum documents to return (max 500)' },
                        sort: { type: 'object', description: 'Sort specification' },
                        projection: { type: 'object', description: 'Field projection' },
                    },
                    required: ['collection'],
                },
            },
            {
                name: 'aggregate',
                description: 'Execute an aggregation pipeline on a MongoDB collection.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        collection: { type: 'string', description: 'Collection name' },
                        pipeline: {
                            type: 'array',
                            description: 'Aggregation pipeline stages',
                            items: { type: 'object' },
                        },
                    },
                    required: ['collection', 'pipeline'],
                },
            },
            {
                name: 'count',
                description: 'Count documents matching a query.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        collection: { type: 'string', description: 'Collection name' },
                        query: { type: 'object', description: 'MongoDB query filter' },
                    },
                    required: ['collection'],
                },
            },
            {
                name: 'distinct',
                description: 'Get distinct values for a field.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        collection: { type: 'string', description: 'Collection name' },
                        field: { type: 'string', description: 'Field name' },
                        query: { type: 'object', description: 'Optional query filter' },
                    },
                    required: ['collection', 'field'],
                },
            },

            // Schema & Metadata Tools
            {
                name: 'listCollections',
                description: 'List all collections in the database.',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
            {
                name: 'listIndexes',
                description: 'List indexes for a collection.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        collection: { type: 'string', description: 'Collection name' },
                    },
                    required: ['collection'],
                },
            },
            {
                name: 'collectionStats',
                description: 'Get storage and index statistics for a collection.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        collection: { type: 'string', description: 'Collection name' },
                    },
                    required: ['collection'],
                },
            },
            {
                name: 'analyzeSchema',
                description: 'Infer schema from sample documents (analyzes up to 100 documents).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        collection: { type: 'string', description: 'Collection name' },
                        sampleSize: {
                            type: 'number',
                            description: 'Number of documents to sample (max 100)',
                        },
                    },
                    required: ['collection'],
                },
            },

            // Performance Tools
            {
                name: 'explainQuery',
                description: 'Get query execution plan and performance statistics.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        collection: { type: 'string', description: 'Collection name' },
                        query: { type: 'object', description: 'MongoDB query filter' },
                        verbosity: {
                            type: 'string',
                            enum: ['queryPlanner', 'executionStats', 'allPlansExecution'],
                            description: 'Explain verbosity level',
                        },
                    },
                    required: ['collection', 'query'],
                },
            },
            {
                name: 'suggestIndexes',
                description: 'AI-powered index recommendations for a collection based on query patterns.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        collection: { type: 'string', description: 'Collection name' },
                        sampleQueries: {
                            type: 'array',
                            description: 'Sample queries to analyze',
                            items: { type: 'object' },
                        },
                    },
                    required: ['collection'],
                },
            },
            {
                name: 'analyzeSlowQueries',
                description: 'Identify slow query patterns and optimization opportunities.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        collection: { type: 'string', description: 'Collection name (optional)' },
                        minDurationMs: {
                            type: 'number',
                            description: 'Minimum query duration to analyze (default: 100ms)',
                        },
                    },
                },
            },
            {
                name: 'estimateQueryCost',
                description: 'Estimate cost/performance impact of a query.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        collection: { type: 'string', description: 'Collection name' },
                        query: { type: 'object', description: 'MongoDB query filter' },
                    },
                    required: ['collection', 'query'],
                },
            },

            // Utility Tools
            {
                name: 'validateQuery',
                description: 'Validate a query without executing it (dry-run).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        collection: { type: 'string', description: 'Collection name' },
                        query: { type: 'object', description: 'MongoDB query filter' },
                    },
                    required: ['collection', 'query'],
                },
            },
            {
                name: 'sampleDocuments',
                description: 'Get representative sample documents from a collection.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        collection: { type: 'string', description: 'Collection name' },
                        size: { type: 'number', description: 'Sample size (max 100)' },
                    },
                    required: ['collection'],
                },
            },
            {
                name: 'getDatabaseStats',
                description: 'Get database-level statistics (size, collections, indexes).',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
        ];
    }

    /**
     * Handle tool call
     */
    private async handleToolCall(toolName: string, args: any): Promise<MCPToolResult> {
        try {
            loggingService.info('MongoDB MCP tool call started', {
                component: 'MongoDBMCPService',
                operation: 'handleToolCall',
                toolName,
                userId: this.config.userId,
                connectionId: this.config.connectionId,
            });

            // Ensure connection is initialized
            if (!this.connection) {
                await this.initializeConnection();
            }

            // Check credential expiry
            if (this.connection?.isCredentialExpired()) {
                throw new Error('MongoDB credentials have expired. Please refresh your connection.');
            }

            // Route to appropriate handler
            let result;
            switch (toolName) {
                case 'find':
                    result = await this.handleFind(args);
                    break;
                case 'aggregate':
                    result = await this.handleAggregate(args);
                    break;
                case 'count':
                    result = await this.handleCount(args);
                    break;
                case 'distinct':
                    result = await this.handleDistinct(args);
                    break;
                case 'listCollections':
                    result = await this.handleListCollections(args);
                    break;
                case 'listIndexes':
                    result = await this.handleListIndexes(args);
                    break;
                case 'collectionStats':
                    result = await this.handleCollectionStats(args);
                    break;
                case 'analyzeSchema':
                    result = await this.handleAnalyzeSchema(args);
                    break;
                case 'explainQuery':
                    result = await this.handleExplainQuery(args);
                    break;
                case 'suggestIndexes':
                    result = await this.handleSuggestIndexes(args);
                    break;
                case 'analyzeSlowQueries':
                    result = await this.handleAnalyzeSlowQueries(args);
                    break;
                case 'estimateQueryCost':
                    result = await this.handleEstimateQueryCost(args);
                    break;
                case 'validateQuery':
                    result = await this.handleValidateQuery(args);
                    break;
                case 'sampleDocuments':
                    result = await this.handleSampleDocuments(args);
                    break;
                case 'getDatabaseStats':
                    result = await this.handleGetDatabaseStats(args);
                    break;
                default:
                    throw new Error(`Unknown tool: ${toolName}`);
            }

            // Update last used timestamp
            if (this.connection) {
                this.connection.lastUsed = new Date();
                await this.connection.save();
            }

            loggingService.info('MongoDB MCP tool call completed', {
                component: 'MongoDBMCPService',
                operation: 'handleToolCall',
                toolName,
                success: true,
            });

            return result;
        } catch (error) {
            loggingService.error('MongoDB MCP tool call failed', {
                component: 'MongoDBMCPService',
                operation: 'handleToolCall',
                toolName,
                error: error instanceof Error ? error.message : String(error),
            });

            return {
                content: [
                    {
                        type: 'text',
                        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    }

    /**
     * Initialize MongoDB connection
     */
    private async initializeConnection(): Promise<void> {
        // Fetch connection from database
        this.connection = await MongoDBConnection.findOne({
            _id: this.config.connectionId,
            userId: this.config.userId,
            isActive: true,
        }).select('+connectionString');

        if (!this.connection) {
            throw new Error('MongoDB connection not found or inactive');
        }

        // Get or create MongoDB client
        const poolKey = `${this.config.userId}:${this.config.connectionId}`;
        const pooledConnection = this.connectionPool.get(poolKey);

        if (pooledConnection) {
            // Reuse existing connection
            this.mongoClient = pooledConnection.client;
            pooledConnection.lastUsed = Date.now();
            loggingService.info('Reusing pooled MongoDB connection', {
                component: 'MongoDBMCPService',
                operation: 'initializeConnection',
                poolKey,
            });
        } else {
            // Create new connection
            const connectionString = this.connection.getDecryptedConnectionString();
            this.mongoClient = new MongoClient(connectionString, {
                serverSelectionTimeoutMS: 5000,
                connectTimeoutMS: 10000,
                maxPoolSize: 5,
                minPoolSize: 1,
            });

            await this.mongoClient.connect();
            
            // Add to pool
            this.connectionPool.set(poolKey, {
                client: this.mongoClient,
                lastUsed: Date.now(),
            });

            loggingService.info('Created new MongoDB connection', {
                component: 'MongoDBMCPService',
                operation: 'initializeConnection',
                poolKey,
            });
        }

        // Get database
        if (this.connection.database) {
            this.db = this.mongoClient.db(this.connection.database);
        } else {
            // Use default database from connection string
            this.db = this.mongoClient.db();
        }
    }

    /**
     * Tool Handlers
     */
    private async handleFind(args: any): Promise<MCPToolResult> {
        if (!this.db || !this.connection) {
            throw new Error('Database connection not initialized');
        }

        const { collection, query = {}, limit, sort, projection } = args;

        // Validate with policy engine
        const validation = await MongoDBMCPPolicyService.validateFindQuery(
            this.connection,
            collection,
            query,
            { limit, sort, projection }
        );

        if (!validation.allowed) {
            throw new Error(validation.reason || 'Query not allowed by policy');
        }

        // Execute query
        const coll = this.db.collection(collection);
        const documents = await coll
            .find(validation.sanitizedQuery!.query, validation.sanitizedQuery!.options)
            .toArray();

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            collection,
                            count: documents.length,
                            documents,
                            metadata: validation.metadata,
                        },
                        null,
                        2
                    ),
                },
            ],
        };
    }

    private async handleAggregate(args: any): Promise<MCPToolResult> {
        if (!this.db || !this.connection) {
            throw new Error('Database connection not initialized');
        }

        const { collection, pipeline } = args;

        // Validate with policy engine
        const validation = await MongoDBMCPPolicyService.validateAggregationPipeline(
            this.connection,
            collection,
            pipeline
        );

        if (!validation.allowed) {
            throw new Error(validation.reason || 'Pipeline not allowed by policy');
        }

        // Execute aggregation
        const coll = this.db.collection(collection);
        const results = await coll
            .aggregate(validation.sanitizedQuery!.pipeline, validation.sanitizedQuery!.options)
            .toArray();

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            collection,
                            count: results.length,
                            results,
                            metadata: validation.metadata,
                        },
                        null,
                        2
                    ),
                },
            ],
        };
    }

    private async handleCount(args: any): Promise<MCPToolResult> {
        if (!this.db || !this.connection) {
            throw new Error('Database connection not initialized');
        }

        const { collection, query = {} } = args;

        // Validate with policy engine
        const validation = await MongoDBMCPPolicyService.validateCountQuery(
            this.connection,
            collection,
            query
        );

        if (!validation.allowed) {
            throw new Error(validation.reason || 'Query not allowed by policy');
        }

        // Execute count
        const coll = this.db.collection(collection);
        const count = await coll.countDocuments(
            validation.sanitizedQuery!.query,
            validation.sanitizedQuery!.options
        );

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({ collection, count }, null, 2),
                },
            ],
        };
    }

    private async handleDistinct(args: any): Promise<MCPToolResult> {
        if (!this.db || !this.connection) {
            throw new Error('Database connection not initialized');
        }

        const { collection, field, query = {} } = args;

        // Validate collection access
        const validation = await MongoDBMCPPolicyService.validateCountQuery(
            this.connection,
            collection,
            query
        );

        if (!validation.allowed) {
            throw new Error(validation.reason || 'Query not allowed by policy');
        }

        // Execute distinct
        const coll = this.db.collection(collection);
        const values = await coll.distinct(field, validation.sanitizedQuery!.query);

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            collection,
                            field,
                            distinctValues: values.length,
                            values: values.slice(0, 100), // Limit distinct values shown
                        },
                        null,
                        2
                    ),
                },
            ],
        };
    }

    private async handleListCollections(args: any): Promise<MCPToolResult> {
        if (!this.db) {
            throw new Error('Database connection not initialized');
        }

        const collections = await this.db.listCollections().toArray();
        const collectionNames = collections.map((c) => c.name);

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            database: this.db.databaseName,
                            count: collectionNames.length,
                            collections: collectionNames,
                        },
                        null,
                        2
                    ),
                },
            ],
        };
    }

    private async handleListIndexes(args: any): Promise<MCPToolResult> {
        if (!this.db || !this.connection) {
            throw new Error('Database connection not initialized');
        }

        const { collection } = args;

        // Validate collection access
        const validation = await MongoDBMCPPolicyService.validateCountQuery(
            this.connection,
            collection,
            {}
        );

        if (!validation.allowed) {
            throw new Error(validation.reason || 'Collection access not allowed');
        }

        const coll = this.db.collection(collection);
        const indexes = await coll.indexes();

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            collection,
                            count: indexes.length,
                            indexes,
                        },
                        null,
                        2
                    ),
                },
            ],
        };
    }

    private async handleCollectionStats(args: any): Promise<MCPToolResult> {
        if (!this.db || !this.connection) {
            throw new Error('Database connection not initialized');
        }

        const { collection } = args;

        // Validate collection access
        const validation = await MongoDBMCPPolicyService.validateCountQuery(
            this.connection,
            collection,
            {}
        );

        if (!validation.allowed) {
            throw new Error(validation.reason || 'Collection access not allowed');
        }

        const stats: any = await this.db.command({ collStats: collection });

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            collection,
                            stats: {
                                count: stats.count,
                                size: stats.size,
                                avgObjSize: stats.avgObjSize,
                                storageSize: stats.storageSize,
                                indexes: stats.nindexes,
                                totalIndexSize: stats.totalIndexSize,
                            },
                        },
                        null,
                        2
                    ),
                },
            ],
        };
    }

    private async handleAnalyzeSchema(args: any): Promise<MCPToolResult> {
        if (!this.db || !this.connection) {
            throw new Error('Database connection not initialized');
        }

        const { collection, sampleSize = 100 } = args;

        // Validate collection access
        const validation = await MongoDBMCPPolicyService.validateFindQuery(
            this.connection,
            collection,
            {},
            { limit: Math.min(sampleSize, 100) }
        );

        if (!validation.allowed) {
            throw new Error(validation.reason || 'Collection access not allowed');
        }

        const coll = this.db.collection(collection);
        const samples = await coll
            .find({}, validation.sanitizedQuery!.options)
            .toArray();

        // Infer schema
        const schema = this.inferSchema(samples);

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            collection,
                            sampleSize: samples.length,
                            schema,
                        },
                        null,
                        2
                    ),
                },
            ],
        };
    }

    private async handleExplainQuery(args: any): Promise<MCPToolResult> {
        if (!this.db || !this.connection) {
            throw new Error('Database connection not initialized');
        }

        const { collection, query, verbosity = 'executionStats' } = args;

        // Validate query
        const validation = await MongoDBMCPPolicyService.validateFindQuery(
            this.connection,
            collection,
            query,
            {}
        );

        if (!validation.allowed) {
            throw new Error(validation.reason || 'Query not allowed by policy');
        }

        const coll = this.db.collection(collection);
        const explanation = await coll
            .find(validation.sanitizedQuery!.query)
            .explain(verbosity);

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            collection,
                            query: validation.sanitizedQuery!.query,
                            explanation,
                        },
                        null,
                        2
                    ),
                },
            ],
        };
    }

    private async handleSuggestIndexes(args: any): Promise<MCPToolResult> {
        // This will be implemented in Phase 3 with AI integration
        return {
            content: [
                {
                    type: 'text',
                    text: 'Index suggestions require AI analysis. This feature will be available in the next update.',
                },
            ],
        };
    }

    private async handleAnalyzeSlowQueries(args: any): Promise<MCPToolResult> {
        // This requires system.profile collection access
        return {
            content: [
                {
                    type: 'text',
                    text: 'Slow query analysis requires database profiler access. This feature will be available in the next update.',
                },
            ],
        };
    }

    private async handleEstimateQueryCost(args: any): Promise<MCPToolResult> {
        if (!this.db || !this.connection) {
            throw new Error('Database connection not initialized');
        }

        const { collection, query } = args;

        // Get execution stats
        const validation = await MongoDBMCPPolicyService.validateFindQuery(
            this.connection,
            collection,
            query,
            {}
        );

        if (!validation.allowed) {
            throw new Error(validation.reason || 'Query not allowed by policy');
        }

        const coll = this.db.collection(collection);
        const explanation: any = await coll
            .find(validation.sanitizedQuery!.query)
            .explain('executionStats');

        // Extract cost metrics
        const executionStats = explanation.executionStats;
        const cost = {
            documentsExamined: executionStats.totalDocsExamined,
            documentsReturned: executionStats.nReturned,
            executionTimeMs: executionStats.executionTimeMillis,
            indexUsed: explanation.queryPlanner?.winningPlan?.inputStage?.indexName || 'COLLECTION_SCAN',
            estimatedCost: executionStats.totalDocsExamined / (executionStats.nReturned || 1),
        };

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({ collection, query, cost }, null, 2),
                },
            ],
        };
    }

    private async handleValidateQuery(args: any): Promise<MCPToolResult> {
        if (!this.connection) {
            throw new Error('Connection not initialized');
        }

        const { collection, query } = args;

        // Validate with policy engine (dry-run)
        const validation = await MongoDBMCPPolicyService.validateFindQuery(
            this.connection,
            collection,
            query,
            {}
        );

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            valid: validation.allowed,
                            reason: validation.reason,
                            sanitizedQuery: validation.sanitizedQuery,
                            metadata: validation.metadata,
                        },
                        null,
                        2
                    ),
                },
            ],
        };
    }

    private async handleSampleDocuments(args: any): Promise<MCPToolResult> {
        if (!this.db || !this.connection) {
            throw new Error('Database connection not initialized');
        }

        const { collection, size = 10 } = args;

        // Validate collection access
        const validation = await MongoDBMCPPolicyService.validateAggregationPipeline(
            this.connection,
            collection,
            [{ $sample: { size: Math.min(size, 100) } }]
        );

        if (!validation.allowed) {
            throw new Error(validation.reason || 'Collection access not allowed');
        }

        const coll = this.db.collection(collection);
        const samples = await coll
            .aggregate(validation.sanitizedQuery!.pipeline, validation.sanitizedQuery!.options)
            .toArray();

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            collection,
                            count: samples.length,
                            samples,
                        },
                        null,
                        2
                    ),
                },
            ],
        };
    }

    private async handleGetDatabaseStats(args: any): Promise<MCPToolResult> {
        if (!this.db) {
            throw new Error('Database connection not initialized');
        }

        const stats = await this.db.stats();

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            database: this.db.databaseName,
                            stats: {
                                collections: stats.collections,
                                views: stats.views,
                                dataSize: stats.dataSize,
                                storageSize: stats.storageSize,
                                indexes: stats.indexes,
                                indexSize: stats.indexSize,
                            },
                        },
                        null,
                        2
                    ),
                },
            ],
        };
    }

    /**
     * Helper: Infer schema from documents
     */
    private inferSchema(documents: any[]): any {
        if (documents.length === 0) {
            return {};
        }

        const schema: any = {};
        const typeCount: any = {};

        for (const doc of documents) {
            for (const [key, value] of Object.entries(doc)) {
                if (!schema[key]) {
                    schema[key] = { types: new Set(), examples: [] };
                    typeCount[key] = {};
                }

                const type = Array.isArray(value)
                    ? 'array'
                    : value === null
                    ? 'null'
                    : typeof value === 'object'
                    ? 'object'
                    : typeof value;

                schema[key].types.add(type);
                typeCount[key][type] = (typeCount[key][type] || 0) + 1;

                if (schema[key].examples.length < 3) {
                    schema[key].examples.push(value);
                }
            }
        }

        // Convert Sets to arrays and add statistics
        const result: any = {};
        for (const [key, info] of Object.entries(schema)) {
            result[key] = {
                    types: Array.from((info as any).types),
                    occurrences: Object.values(typeCount[key]).reduce((a: number, b: any) => a + (b as number), 0),
                    examples: (info as any).examples,
                };
        }

        return result;
    }

    /**
     * Start connection pool cleanup
     */
    private startConnectionPoolCleanup(): void {
        setInterval(() => {
            const now = Date.now();
            for (const [key, connection] of this.connectionPool.entries()) {
                if (now - connection.lastUsed > this.CONNECTION_IDLE_TIMEOUT) {
                    connection.client.close().catch((error) => {
                        loggingService.warn('Failed to close idle MongoDB connection', {
                            component: 'MongoDBMCPService',
                            operation: 'startConnectionPoolCleanup',
                            error: error instanceof Error ? error.message : String(error),
                        });
                    });
                    this.connectionPool.delete(key);
                    loggingService.info('Closed idle MongoDB connection', {
                        component: 'MongoDBMCPService',
                        operation: 'startConnectionPoolCleanup',
                        poolKey: key,
                    });
                }
            }
        }, this.POOL_CLEANUP_INTERVAL);
    }

    /**
     * Run server (stdio transport)
     */
    async runStdio(): Promise<void> {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        loggingService.info('MongoDB MCP server started (stdio transport)', {
            component: 'MongoDBMCPService',
            operation: 'runStdio',
            userId: this.config.userId,
        });
    }

    /**
     * Close all connections
     */
    async close(): Promise<void> {
        for (const [key, connection] of this.connectionPool.entries()) {
            try {
                await connection.client.close();
                loggingService.info('Closed MongoDB connection', {
                    component: 'MongoDBMCPService',
                    operation: 'close',
                    poolKey: key,
                });
            } catch (error) {
                loggingService.error('Failed to close MongoDB connection', {
                    component: 'MongoDBMCPService',
                    operation: 'close',
                    poolKey: key,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        this.connectionPool.clear();
    }
}
