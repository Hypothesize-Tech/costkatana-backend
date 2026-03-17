import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MongoClient, Db, type Document } from 'mongodb';
import {
  MongodbMcpConnection,
  MongodbMcpConnectionDocument,
} from '../../../schemas/integration/mongodb-mcp-connection.schema';
import { MongodbMcpConnectionHelperService } from './mongodb-mcp-connection-helper.service';
import { MongodbMcpPolicyService } from './mongodb-mcp-policy.service';
import { MongodbMcpCircuitBreakerService } from './mongodb-mcp-circuit-breaker.service';
export interface MCPToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

interface MCPToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOL_DEFINITIONS: MCPToolDef[] = [
  {
    name: 'find',
    description:
      'Execute a find query on a MongoDB collection. Returns up to 500 documents.',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: 'Collection name' },
        query: { type: 'object', description: 'MongoDB query filter' },
        limit: {
          type: 'number',
          description: 'Maximum documents to return (max 500)',
        },
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
  {
    name: 'listCollections',
    description: 'List all collections in the database.',
    inputSchema: { type: 'object', properties: {} },
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
    description:
      'Infer schema from sample documents (analyzes up to 100 documents).',
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
    description:
      'Suggest indexes for a collection based on existing indexes and optional sample queries.',
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
    description:
      'List recent slow operations from system.profile when profiler is enabled.',
    inputSchema: {
      type: 'object',
      properties: {
        collection: {
          type: 'string',
          description: 'Collection name (optional)',
        },
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
    inputSchema: { type: 'object', properties: {} },
  },
];

interface CachedExecutor {
  client: MongoClient;
  db: Db;
  connection: MongodbMcpConnectionDocument;
  lastUsed: number;
}

let mongodbMcpServiceInstance: MongodbMcpService | null = null;

export function getMongodbMcpService(): MongodbMcpService {
  if (!mongodbMcpServiceInstance) {
    throw new Error(
      'MongodbMcpService not initialized. Ensure MongodbMcpModule is imported.',
    );
  }
  return mongodbMcpServiceInstance;
}

@Injectable()
export class MongodbMcpService {
  private readonly logger = new Logger(MongodbMcpService.name);
  private readonly cache = new Map<string, CachedExecutor>();
  private readonly POOL_CLEANUP_MS = 5 * 60 * 1000;
  private readonly IDLE_TIMEOUT_MS = 10 * 60 * 1000;
  private cleanupInterval?: ReturnType<typeof setInterval>;

  constructor(
    @InjectModel(MongodbMcpConnection.name)
    private readonly connectionModel: Model<MongodbMcpConnectionDocument>,
    private readonly helper: MongodbMcpConnectionHelperService,
    private readonly policy: MongodbMcpPolicyService,
    private readonly circuitBreaker: MongodbMcpCircuitBreakerService,
  ) {
    mongodbMcpServiceInstance = this;
    this.startPoolCleanup();
  }

  getToolDefinitions(): MCPToolDef[] {
    return [...TOOL_DEFINITIONS];
  }

  async executeToolCall(
    userId: string,
    connectionId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    try {
      this.logger.debug('MongoDB MCP tool call started', {
        toolName,
        userId,
        connectionId,
      });

      const executor = await this.getOrCreateExecutor(userId, connectionId);

      if (this.helper.isCredentialExpired(executor.connection)) {
        throw new Error(
          'MongoDB credentials have expired. Please refresh your connection.',
        );
      }

      let result: MCPToolResult;
      switch (toolName) {
        case 'find':
          result = await this.handleFind(executor, args);
          break;
        case 'aggregate':
          result = await this.handleAggregate(executor, args);
          break;
        case 'count':
          result = await this.handleCount(executor, args);
          break;
        case 'distinct':
          result = await this.handleDistinct(executor, args);
          break;
        case 'listCollections':
          result = await this.handleListCollections(executor, args);
          break;
        case 'listIndexes':
          result = await this.handleListIndexes(executor, args);
          break;
        case 'collectionStats':
          result = await this.handleCollectionStats(executor, args);
          break;
        case 'analyzeSchema':
          result = await this.handleAnalyzeSchema(executor, args);
          break;
        case 'explainQuery':
          result = await this.handleExplainQuery(executor, args);
          break;
        case 'suggestIndexes':
          result = await this.handleSuggestIndexes(executor, args);
          break;
        case 'analyzeSlowQueries':
          result = await this.handleAnalyzeSlowQueries(executor, args);
          break;
        case 'estimateQueryCost':
          result = await this.handleEstimateQueryCost(executor, args);
          break;
        case 'validateQuery':
          result = await this.handleValidateQuery(executor, args);
          break;
        case 'sampleDocuments':
          result = await this.handleSampleDocuments(executor, args);
          break;
        case 'getDatabaseStats':
          result = await this.handleGetDatabaseStats(executor, args);
          break;
        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }

      executor.lastUsed = Date.now();
      await this.connectionModel.updateOne(
        { _id: new Types.ObjectId(connectionId) },
        { $set: { lastUsed: new Date() } },
      );

      this.logger.debug('MongoDB MCP tool call completed', {
        toolName,
        success: true,
      });
      return result;
    } catch (error) {
      this.logger.warn('MongoDB MCP tool call failed', {
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

  clearCacheForConnection(userId: string, connectionId: string): void {
    const key = `${userId}:${connectionId}`;
    const cached = this.cache.get(key);
    if (cached) {
      cached.client.close().catch((e) => this.logger.warn('Close error', e));
      this.cache.delete(key);
    }
  }

  async close(): Promise<void> {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    for (const [key, entry] of this.cache.entries()) {
      try {
        await entry.client.close();
      } catch (e) {
        this.logger.warn('Failed to close client', { key });
      }
    }
    this.cache.clear();
  }

  private async getOrCreateExecutor(
    userId: string,
    connectionId: string,
  ): Promise<CachedExecutor> {
    const key = `${userId}:${connectionId}`;
    let entry = this.cache.get(key);
    if (entry) {
      entry.lastUsed = Date.now();
      return entry;
    }

    const connDoc = await this.connectionModel
      .findOne({
        _id: new Types.ObjectId(connectionId),
        userId: new Types.ObjectId(userId),
        isActive: true,
      })
      .select('+connectionString')
      .exec();

    if (!connDoc) throw new Error('MongoDB connection not found or inactive');

    const connectionString = this.helper.getDecryptedConnectionString(connDoc);
    const client = new MongoClient(connectionString, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
      maxPoolSize: 5,
      minPoolSize: 1,
    });
    await client.connect();
    const db = connDoc.database ? client.db(connDoc.database) : client.db();

    entry = {
      client,
      db,
      connection: connDoc,
      lastUsed: Date.now(),
    };
    this.cache.set(key, entry);
    return entry;
  }

  private startPoolCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.cache.entries()) {
        if (now - entry.lastUsed > this.IDLE_TIMEOUT_MS) {
          entry.client.close().catch(() => {});
          this.cache.delete(key);
        }
      }
    }, this.POOL_CLEANUP_MS);
  }

  private async handleFind(
    executor: CachedExecutor,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const {
      collection,
      query = {},
      limit,
      sort,
      projection,
    } = args as {
      collection: string;
      query?: Record<string, unknown>;
      limit?: number;
      sort?: unknown;
      projection?: Record<string, unknown>;
    };
    const validation = await this.policy.validateFindQuery(
      executor.connection,
      collection,
      query,
      { limit, sort, projection },
    );
    if (!validation.allowed) {
      throw new Error(validation.reason ?? 'Query not allowed by policy');
    }
    const opts = validation.sanitizedQuery!.options ?? {};
    const coll = executor.db.collection(collection);
    const cursor = coll.find(
      validation.sanitizedQuery!.query as Record<string, unknown>,
      opts as {
        limit?: number;
        projection?: Record<string, unknown>;
        maxTimeMS?: number;
      },
    );
    const documents = await cursor.toArray();
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
            2,
          ),
        },
      ],
    };
  }

  private async handleAggregate(
    executor: CachedExecutor,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const { collection, pipeline } = args as {
      collection: string;
      pipeline: unknown[];
    };
    const validation = await this.policy.validateAggregationPipeline(
      executor.connection,
      collection,
      pipeline,
    );
    if (!validation.allowed) {
      throw new Error(validation.reason ?? 'Pipeline not allowed by policy');
    }
    const coll = executor.db.collection(collection);
    const results = await coll
      .aggregate((validation.sanitizedQuery!.pipeline ?? []) as Document[], {
        maxTimeMS: validation.sanitizedQuery!.options?.maxTimeMS,
      })
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
            2,
          ),
        },
      ],
    };
  }

  private async handleCount(
    executor: CachedExecutor,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const { collection, query = {} } = args as {
      collection: string;
      query?: Record<string, unknown>;
    };
    const validation = await this.policy.validateCountQuery(
      executor.connection,
      collection,
      query,
    );
    if (!validation.allowed) {
      throw new Error(validation.reason ?? 'Query not allowed by policy');
    }
    const coll = executor.db.collection(collection);
    const count = await coll.countDocuments(
      validation.sanitizedQuery!.query as Record<string, unknown>,
      validation.sanitizedQuery!.options as { maxTimeMS?: number },
    );
    return {
      content: [
        { type: 'text', text: JSON.stringify({ collection, count }, null, 2) },
      ],
    };
  }

  private async handleDistinct(
    executor: CachedExecutor,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const {
      collection,
      field,
      query = {},
    } = args as {
      collection: string;
      field: string;
      query?: Record<string, unknown>;
    };
    const validation = await this.policy.validateCountQuery(
      executor.connection,
      collection,
      query,
    );
    if (!validation.allowed) {
      throw new Error(validation.reason ?? 'Query not allowed by policy');
    }
    const coll = executor.db.collection(collection);
    const values = await coll.distinct(
      field,
      validation.sanitizedQuery!.query as Record<string, unknown>,
    );
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              collection,
              field,
              distinctValues: values.length,
              values: values.slice(0, 100),
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async handleListCollections(
    executor: CachedExecutor,
    _args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const collections = await executor.db.listCollections().toArray();
    const names = collections.map((c) => c.name);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              database: executor.db.databaseName,
              count: names.length,
              collections: names,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async handleListIndexes(
    executor: CachedExecutor,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const { collection } = args as { collection: string };
    const validation = await this.policy.validateCountQuery(
      executor.connection,
      collection,
      {},
    );
    if (!validation.allowed) {
      throw new Error(validation.reason ?? 'Collection access not allowed');
    }
    const coll = executor.db.collection(collection);
    const indexes = await coll.indexes();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { collection, count: indexes.length, indexes },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async handleCollectionStats(
    executor: CachedExecutor,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const { collection } = args as { collection: string };
    const validation = await this.policy.validateCountQuery(
      executor.connection,
      collection,
      {},
    );
    if (!validation.allowed) {
      throw new Error(validation.reason ?? 'Collection access not allowed');
    }
    const stats = await executor.db.command({ collStats: collection });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              collection,
              stats: {
                count: (stats as Record<string, unknown>).count,
                size: (stats as Record<string, unknown>).size,
                avgObjSize: (stats as Record<string, unknown>).avgObjSize,
                storageSize: (stats as Record<string, unknown>).storageSize,
                indexes: (stats as Record<string, unknown>).nindexes,
                totalIndexSize: (stats as Record<string, unknown>)
                  .totalIndexSize,
              },
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async handleAnalyzeSchema(
    executor: CachedExecutor,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const { collection, sampleSize = 100 } = args as {
      collection: string;
      sampleSize?: number;
    };
    const validation = await this.policy.validateFindQuery(
      executor.connection,
      collection,
      {},
      { limit: Math.min(sampleSize, 100) },
    );
    if (!validation.allowed) {
      throw new Error(validation.reason ?? 'Collection access not allowed');
    }
    const coll = executor.db.collection(collection);
    const opts = (validation.sanitizedQuery!.options ?? {}) as {
      limit?: number;
      projection?: Record<string, unknown>;
    };
    const samples = await coll.find({}, opts).toArray();
    const schema = this.inferSchema(samples);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { collection, sampleSize: samples.length, schema },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async handleExplainQuery(
    executor: CachedExecutor,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const {
      collection,
      query,
      verbosity = 'executionStats',
    } = args as {
      collection: string;
      query: Record<string, unknown>;
      verbosity?: string;
    };
    const validation = await this.policy.validateFindQuery(
      executor.connection,
      collection,
      query,
      {},
    );
    if (!validation.allowed) {
      throw new Error(validation.reason ?? 'Query not allowed by policy');
    }
    const coll = executor.db.collection(collection);
    const explanation = await coll
      .find(validation.sanitizedQuery!.query as Record<string, unknown>)
      .explain(
        verbosity as 'queryPlanner' | 'executionStats' | 'allPlansExecution',
      );
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
            2,
          ),
        },
      ],
    };
  }

  private async handleSuggestIndexes(
    executor: CachedExecutor,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const { collection, sampleQueries = [] } = args as {
      collection: string;
      sampleQueries?: Array<Record<string, unknown>>;
    };
    const validation = await this.policy.validateCountQuery(
      executor.connection,
      collection,
      {},
    );
    if (!validation.allowed) {
      throw new Error(validation.reason ?? 'Collection access not allowed');
    }
    const coll = executor.db.collection(collection);
    const indexes = await coll.indexes();
    const suggested: string[] = [];
    const hasIdIndex = indexes.some(
      (idx) => (idx as Record<string, unknown>).name === '_id_',
    );
    if (!hasIdIndex) {
      suggested.push('Ensure _id index exists (default in MongoDB).');
    }
    const indexKeys = new Set(
      indexes.flatMap((idx) =>
        Object.keys((idx as Record<string, unknown>).key ?? {}),
      ),
    );
    for (const q of sampleQueries) {
      const keys = Object.keys(q).filter((k) => !k.startsWith('$'));
      for (const k of keys) {
        if (!indexKeys.has(k)) {
          suggested.push(
            `Consider an index on field "${k}" for queries filtering by ${k}.`,
          );
        }
      }
    }
    if (suggested.length === 0) {
      suggested.push(
        'Existing indexes look sufficient for the provided sample queries.',
      );
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              collection,
              existingIndexes: indexes.length,
              suggestions: suggested,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async handleAnalyzeSlowQueries(
    executor: CachedExecutor,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const { minDurationMs = 100 } = args as { minDurationMs?: number };
    try {
      const profileColl = executor.db.collection('system.profile');
      const entries = await profileColl
        .find({ millis: { $gte: minDurationMs } })
        .sort({ ts: -1 })
        .limit(50)
        .toArray();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                note: 'Requires database profiler to be enabled (db.setProfilingLevel(1)).',
                count: entries.length,
                minDurationMs,
                slowOperations: entries,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (e) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              note: 'Slow query analysis requires the database profiler to be enabled. Run db.setProfilingLevel(1) on the target database. The system.profile collection may not exist or may be inaccessible.',
              error: e instanceof Error ? e.message : String(e),
            }),
          },
        ],
      };
    }
  }

  private async handleEstimateQueryCost(
    executor: CachedExecutor,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const { collection, query } = args as {
      collection: string;
      query: Record<string, unknown>;
    };
    const validation = await this.policy.validateFindQuery(
      executor.connection,
      collection,
      query,
      {},
    );
    if (!validation.allowed) {
      throw new Error(validation.reason ?? 'Query not allowed by policy');
    }
    const coll = executor.db.collection(collection);
    const explanation = (await coll
      .find(validation.sanitizedQuery!.query as Record<string, unknown>)
      .explain('executionStats')) as Record<string, unknown>;
    const execStats = explanation.executionStats as Record<string, unknown>;
    const planner = explanation.queryPlanner as Record<string, unknown>;
    const winningPlan = (planner?.winningPlan as Record<string, unknown>) ?? {};
    const inputStage = winningPlan.inputStage as
      | Record<string, unknown>
      | undefined;
    const cost = {
      documentsExamined: execStats.totalDocsExamined,
      documentsReturned: execStats.nReturned,
      executionTimeMs: execStats.executionTimeMillis,
      indexUsed: (inputStage?.indexName as string) ?? 'COLLECTION_SCAN',
      estimatedCost:
        (Number(execStats.totalDocsExamined) || 0) /
        (Number(execStats.nReturned) || 1),
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

  private async handleValidateQuery(
    executor: CachedExecutor,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const { collection, query } = args as {
      collection: string;
      query: Record<string, unknown>;
    };
    const validation = await this.policy.validateFindQuery(
      executor.connection,
      collection,
      query,
      {},
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
            2,
          ),
        },
      ],
    };
  }

  private async handleSampleDocuments(
    executor: CachedExecutor,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const { collection, size = 10 } = args as {
      collection: string;
      size?: number;
    };
    const validation = await this.policy.validateAggregationPipeline(
      executor.connection,
      collection,
      [{ $sample: { size: Math.min(size, 100) } }],
    );
    if (!validation.allowed) {
      throw new Error(validation.reason ?? 'Collection access not allowed');
    }
    const coll = executor.db.collection(collection);
    const samples = await coll
      .aggregate((validation.sanitizedQuery!.pipeline ?? []) as Document[])
      .toArray();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { collection, count: samples.length, samples },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async handleGetDatabaseStats(
    executor: CachedExecutor,
    _args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const stats = await executor.db.stats();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              database: executor.db.databaseName,
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
            2,
          ),
        },
      ],
    };
  }

  private inferSchema(
    documents: Record<string, unknown>[],
  ): Record<string, unknown> {
    if (documents.length === 0) return {};
    const schema: Record<string, { types: Set<string>; examples: unknown[] }> =
      {};
    const typeCount: Record<string, Record<string, number>> = {};

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
        typeCount[key][type] = (typeCount[key][type] ?? 0) + 1;
        if (schema[key].examples.length < 3) {
          schema[key].examples.push(value);
        }
      }
    }

    const result: Record<string, unknown> = {};
    for (const [key, info] of Object.entries(schema)) {
      result[key] = {
        types: Array.from(info.types),
        occurrences: Object.values(typeCount[key]).reduce((a, b) => a + b, 0),
        examples: info.examples,
      };
    }
    return result;
  }
}
