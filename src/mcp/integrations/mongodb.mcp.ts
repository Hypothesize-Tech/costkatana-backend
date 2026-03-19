/**
 * MongoDB MCP Server
 * Operations for MongoDB with security controls
 * Uses connection pooling to reuse Mongoose connections per connectionId
 */

import { BaseIntegrationMCP } from './base-integration.mcp';
import {
  createToolSchema,
  createParameter,
  CommonParameters,
} from '../registry/tool-metadata';
import { loggingService } from '../../common/services/logging.service';
import mongoose, { Connection, ConnectOptions } from 'mongoose';
import { Db, Collection, Document } from 'mongodb';

interface MongoConnectionResult {
  connection: Connection;
  databaseName: string;
}

/** Cached connection entry with TTL for pool eviction */
interface PoolEntry {
  connection: Connection;
  databaseName: string;
  lastUsed: number;
}

const CONNECTION_POOL_MAX_AGE_MS = 30 * 60 * 1000; // 30 min idle before eligible for eviction
const CONNECTION_POOL_MAX_SIZE = 50;

const connectionPool = new Map<string, PoolEntry>();

interface FindParams {
  collection: string;
  query?: Record<string, any>;
  projection?: Record<string, any>;
  limit?: number;
  sort?: Record<string, any>;
}

interface AggregateParams {
  collection: string;
  pipeline: any[];
}

interface CountParams {
  collection: string;
  query?: Record<string, any>;
}

interface InsertParams {
  collection: string;
  documents: Document[];
}

interface UpdateParams {
  collection: string;
  query: Record<string, any>;
  update: Record<string, any>;
  multi?: boolean;
}

interface DeleteParams {
  collection: string;
  query: Record<string, any>;
  multi?: boolean;
}

export class MongoDBMCP extends BaseIntegrationMCP {
  constructor() {
    super('mongodb', '1.0.0');
  }

  /**
   * Evict stale or excess entries from the connection pool
   */
  private evictStaleConnections(): void {
    const now = Date.now();
    const keysToRemove: string[] = [];
    const entriesByAge: [string, number][] = [];

    for (const [key, entry] of connectionPool) {
      if (now - entry.lastUsed > CONNECTION_POOL_MAX_AGE_MS) {
        keysToRemove.push(key);
      } else {
        entriesByAge.push([key, entry.lastUsed]);
      }
    }

    // If still over limit after removing stale, evict oldest
    entriesByAge.sort((a, b) => a[1] - b[1]);
    let remaining = connectionPool.size - keysToRemove.length;
    for (const [key] of entriesByAge) {
      if (remaining <= CONNECTION_POOL_MAX_SIZE) break;
      keysToRemove.push(key);
      remaining--;
    }

    for (const key of keysToRemove) {
      const entry = connectionPool.get(key);
      if (entry?.connection.readyState === 1) {
        entry.connection.close().catch(() => {});
      }
      connectionPool.delete(key);
    }
  }

  /**
   * Get MongoDB connection with pooling.
   * Reuses connections per connectionId to avoid creating a new connection per operation.
   */
  private async getMongoConnection(
    connectionId: string,
  ): Promise<MongoConnectionResult> {
    const poolKey = String(connectionId);

    // Return cached connection if healthy
    const cached = connectionPool.get(poolKey);
    if (cached && cached.connection.readyState === 1) {
      cached.lastUsed = Date.now();
      return {
        connection: cached.connection,
        databaseName: cached.databaseName,
      };
    }

    if (cached) {
      connectionPool.delete(poolKey);
      cached.connection.close().catch(() => {});
    }

    const { MongoDBConnection } =
      await import('../../schemas/integration/mongodb-connection.schema');
    const { EncryptionService } = await import('../../utils/encryption');

    const conn = await MongoDBConnection.findById(connectionId).select(
      '+encryptedConnectionString',
    );

    if (!conn) {
      throw new Error('MongoDB connection not found');
    }

    const connectionString = conn.encryptedConnectionString
      ? EncryptionService.decryptFromCombinedFormat(
          conn.encryptedConnectionString,
        )
      : (conn as any).connectionString;

    const databaseName =
      (conn as any).database ?? conn.databaseAccess?.[0]?.name;

    if (!databaseName) {
      throw new Error('Database name is not configured for this connection');
    }

    const connectOptions: ConnectOptions = {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      bufferCommands: false,
    };

    const newConnection = mongoose.createConnection(
      connectionString,
      connectOptions,
    );

    this.evictStaleConnections();
    connectionPool.set(poolKey, {
      connection: newConnection,
      databaseName,
      lastUsed: Date.now(),
    });

    return { connection: newConnection, databaseName };
  }

  /**
   * Validate collection name for security
   */
  private validateCollectionName(collectionName: string): void {
    // Prevent access to system collections
    const blockedCollections = ['system.', 'admin.', 'local.', 'config.'];

    if (
      blockedCollections.some((blocked) => collectionName.startsWith(blocked))
    ) {
      throw new Error(
        `Access to collection '${collectionName}' is not allowed`,
      );
    }

    // Basic validation
    if (!/^[a-zA-Z0-9_.-]+$/.test(collectionName)) {
      throw new Error('Invalid collection name');
    }
  }

  /**
   * Sanitize query for security
   */
  private sanitizeQuery(query: any): any {
    // Remove dangerous operators
    const dangerousOps = ['$where', '$function', '$accumulator', '$expr'];

    const sanitize = (obj: any): any => {
      if (typeof obj !== 'object' || obj === null) {
        return obj;
      }

      if (Array.isArray(obj)) {
        return obj.map(sanitize);
      }

      const sanitized: Record<string, any> = {};
      for (const [key, value] of Object.entries(
        obj as Record<string, unknown>,
      )) {
        if (dangerousOps.includes(key)) {
          loggingService.warn('Blocked dangerous MongoDB operator', {
            operator: key,
          });
          continue;
        }
        sanitized[key] = sanitize(value);
      }
      return sanitized;
    };

    return sanitize(query);
  }

  registerTools(): void {
    // ===== READ OPERATIONS =====

    // Find documents
    this.registerTool(
      createToolSchema(
        'mongodb_find',
        'mongodb',
        'Find documents in a collection',
        'GET',
        [
          createParameter('collection', 'string', 'Collection name', {
            required: true,
          }),
          createParameter('query', 'object', 'Query filter', {
            required: false,
            default: {},
          }),
          createParameter('projection', 'object', 'Fields to return', {
            required: false,
          }),
          CommonParameters.limit,
          createParameter('sort', 'object', 'Sort order', { required: false }),
        ],
        { requiredScopes: ['read'] },
      ),
      async (params: FindParams, context) => {
        this.validateCollectionName(params.collection);
        const sanitizedQuery = this.sanitizeQuery(params.query || {});

        const { connection } = await this.getMongoConnection(
          context.connectionId,
        );

        if (!connection.db) {
          throw new Error('Database connection is not available');
        }

        const db = connection.db as unknown as Db;
        const collection: Collection = db.collection(params.collection);

        let cursor = collection.find(sanitizedQuery);

        if (params.projection) {
          cursor = cursor.project(params.projection);
        }

        if (params.sort) {
          cursor = cursor.sort(params.sort);
        }

        cursor = cursor.limit(params.limit || 20);

        const documents = await cursor.toArray();

        return {
          documents,
          count: documents.length,
          collection: params.collection,
        };
      },
    );

    // Aggregate
    this.registerTool(
      createToolSchema(
        'mongodb_aggregate',
        'mongodb',
        'Run aggregation pipeline',
        'GET',
        [
          createParameter('collection', 'string', 'Collection name', {
            required: true,
          }),
          createParameter('pipeline', 'array', 'Aggregation pipeline', {
            required: true,
          }),
        ],
        { requiredScopes: ['read'] },
      ),
      async (params: AggregateParams, context) => {
        this.validateCollectionName(params.collection);
        const sanitizedPipeline = this.sanitizeQuery(params.pipeline);

        const { connection } = await this.getMongoConnection(
          context.connectionId,
        );

        if (!connection.db) {
          throw new Error('Database connection is not available');
        }

        const db = connection.db as unknown as Db;
        const collection: Collection = db.collection(params.collection);

        const results = await collection.aggregate(sanitizedPipeline).toArray();

        return {
          results,
          count: results.length,
          collection: params.collection,
        };
      },
    );

    // Count documents
    this.registerTool(
      createToolSchema(
        'mongodb_count',
        'mongodb',
        'Count documents in a collection',
        'GET',
        [
          createParameter('collection', 'string', 'Collection name', {
            required: true,
          }),
          createParameter('query', 'object', 'Query filter', {
            required: false,
            default: {},
          }),
        ],
        { requiredScopes: ['read'] },
      ),
      async (params: CountParams, context) => {
        this.validateCollectionName(params.collection);
        const sanitizedQuery = this.sanitizeQuery(params.query || {});

        const { connection } = await this.getMongoConnection(
          context.connectionId,
        );

        if (!connection.db) {
          throw new Error('Database connection is not available');
        }

        const db = connection.db as unknown as Db;
        const collection: Collection = db.collection(params.collection);

        const count = await collection.countDocuments(sanitizedQuery);

        return {
          count,
          collection: params.collection,
        };
      },
    );

    // ===== WRITE OPERATIONS =====

    // Insert documents
    this.registerTool(
      createToolSchema(
        'mongodb_insert',
        'mongodb',
        'Insert documents into a collection',
        'POST',
        [
          createParameter('collection', 'string', 'Collection name', {
            required: true,
          }),
          createParameter('documents', 'array', 'Documents to insert', {
            required: true,
          }),
        ],
        { requiredScopes: ['write'] },
      ),
      async (params: InsertParams, context) => {
        this.validateCollectionName(params.collection);

        if (!Array.isArray(params.documents) || params.documents.length === 0) {
          throw new Error('documents must be a non-empty array');
        }

        const { connection } = await this.getMongoConnection(
          context.connectionId,
        );

        if (!connection.db) {
          throw new Error('Database connection is not available');
        }

        const db = connection.db as unknown as Db;
        const collection: Collection = db.collection(params.collection);

        const result = await collection.insertMany(params.documents);

        return {
          success: true,
          insertedCount: result.insertedCount,
          insertedIds: result.insertedIds,
          collection: params.collection,
        };
      },
    );

    // Update documents
    this.registerTool(
      createToolSchema(
        'mongodb_update',
        'mongodb',
        'Update documents in a collection',
        'PATCH',
        [
          createParameter('collection', 'string', 'Collection name', {
            required: true,
          }),
          createParameter('query', 'object', 'Query filter', {
            required: true,
          }),
          createParameter('update', 'object', 'Update operations', {
            required: true,
          }),
          createParameter('multi', 'boolean', 'Update multiple documents', {
            default: false,
          }),
        ],
        { requiredScopes: ['write'] },
      ),
      async (params: UpdateParams, context) => {
        this.validateCollectionName(params.collection);
        const sanitizedQuery = this.sanitizeQuery(params.query);
        const sanitizedUpdate = this.sanitizeQuery(params.update);

        const { connection } = await this.getMongoConnection(
          context.connectionId,
        );

        if (!connection.db) {
          throw new Error('Database connection is not available');
        }

        const db = connection.db as unknown as Db;
        const collection: Collection = db.collection(params.collection);

        const result = params.multi
          ? await collection.updateMany(sanitizedQuery, sanitizedUpdate)
          : await collection.updateOne(sanitizedQuery, sanitizedUpdate);

        return {
          success: true,
          matchedCount: result.matchedCount,
          modifiedCount: result.modifiedCount,
          collection: params.collection,
        };
      },
    );

    // Delete documents
    this.registerTool(
      createToolSchema(
        'mongodb_delete',
        'mongodb',
        'Delete documents from a collection',
        'DELETE',
        [
          createParameter('collection', 'string', 'Collection name', {
            required: true,
          }),
          createParameter('query', 'object', 'Query filter', {
            required: true,
          }),
          createParameter('multi', 'boolean', 'Delete multiple documents', {
            default: false,
          }),
        ],
        {
          requiredScopes: ['delete'],
          dangerous: true,
        },
      ),
      async (params: DeleteParams, context) => {
        this.validateCollectionName(params.collection);
        const sanitizedQuery = this.sanitizeQuery(params.query);

        // Prevent deleting entire collection
        if (Object.keys(sanitizedQuery as Record<string, any>).length === 0) {
          throw new Error(
            'Query cannot be empty for delete operations. Use a specific query filter.',
          );
        }

        const { connection } = await this.getMongoConnection(
          context.connectionId,
        );

        if (!connection.db) {
          throw new Error('Database connection is not available');
        }

        const db = connection.db as unknown as Db;
        const collection: Collection = db.collection(params.collection);

        const result = params.multi
          ? await collection.deleteMany(sanitizedQuery)
          : await collection.deleteOne(sanitizedQuery);

        return {
          success: true,
          deletedCount: result.deletedCount,
          collection: params.collection,
        };
      },
    );
  }
}

// Initialize and register MongoDB tools
export function initializeMongoDBMCP(): void {
  const mongodbMCP = new MongoDBMCP();
  mongodbMCP.registerTools();
}
