/**
 * MongoDB MCP Server
 * Operations for MongoDB with security controls
 */

import { BaseIntegrationMCP } from './base-integration.mcp';
import { createToolSchema, createParameter, CommonParameters } from '../registry/tool-metadata';
import { loggingService } from '../../services/logging.service';
import mongoose, { Connection, ConnectOptions } from 'mongoose';
import {  Db, Collection, Document } from 'mongodb';

interface MongoConnectionResult {
  connection: Connection;
  databaseName: string;
}

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
   * Get MongoDB connection
   */
  private async getMongoConnection(connectionId: string): Promise<MongoConnectionResult> {
    const { MongoDBConnection } = await import('../../models/MongoDBConnection');
    const conn = await MongoDBConnection.findById(connectionId);
    
    if (!conn) {
      throw new Error('MongoDB connection not found');
    }

    if (!conn.database) {
      throw new Error('Database name is not configured for this connection');
    }

    // Check if already connected with this connection string
    // In production, you'd want connection pooling with proper connection management
    const connectionString = conn.connectionString;
    const databaseName = conn.database;
    const existingConnection = mongoose.connections.find(
      (c: Connection) => c.readyState === 1 && c.name === databaseName
    );

    if (existingConnection) {
      return {
        connection: existingConnection,
        databaseName,
      };
    }

    // Create new connection if none exists
    const connectOptions: ConnectOptions = {
      maxPoolSize: 10, // Maintain up to 10 socket connections
      serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
      bufferCommands: false, // Disable mongoose buffering
    };

    const newConnection = mongoose.createConnection(connectionString, connectOptions);

    return {
      connection: newConnection,
      databaseName,
    };
  }

  /**
   * Validate collection name for security
   */
  private validateCollectionName(collectionName: string): void {
    // Prevent access to system collections
    const blockedCollections = ['system.', 'admin.', 'local.', 'config.'];
    
    if (blockedCollections.some(blocked => collectionName.startsWith(blocked))) {
      throw new Error(`Access to collection '${collectionName}' is not allowed`);
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
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (dangerousOps.includes(key)) {
          loggingService.warn('Blocked dangerous MongoDB operator', { operator: key });
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
          createParameter('collection', 'string', 'Collection name', { required: true }),
          createParameter('query', 'object', 'Query filter', { required: false, default: {} }),
          createParameter('projection', 'object', 'Fields to return', { required: false }),
          CommonParameters.limit,
          createParameter('sort', 'object', 'Sort order', { required: false }),
        ],
        { requiredScopes: ['read'] }
      ),
      async (params: FindParams, context) => {
        this.validateCollectionName(params.collection);
        const sanitizedQuery = this.sanitizeQuery(params.query || {});

        const { connection } = await this.getMongoConnection(context.connectionId);
        
        if (!connection.db) {
          throw new Error('Database connection is not available');
        }
        
        const db: Db = connection.db;
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
      }
    );

    // Aggregate
    this.registerTool(
      createToolSchema(
        'mongodb_aggregate',
        'mongodb',
        'Run aggregation pipeline',
        'GET',
        [
          createParameter('collection', 'string', 'Collection name', { required: true }),
          createParameter('pipeline', 'array', 'Aggregation pipeline', { required: true }),
        ],
        { requiredScopes: ['read'] }
      ),
      async (params: AggregateParams, context) => {
        this.validateCollectionName(params.collection);
        const sanitizedPipeline = this.sanitizeQuery(params.pipeline);

        const { connection } = await this.getMongoConnection(context.connectionId);
        
        if (!connection.db) {
          throw new Error('Database connection is not available');
        }
        
        const db: Db = connection.db;
        const collection: Collection = db.collection(params.collection);

        const results = await collection.aggregate(sanitizedPipeline).toArray();

        return {
          results,
          count: results.length,
          collection: params.collection,
        };
      }
    );

    // Count documents
    this.registerTool(
      createToolSchema(
        'mongodb_count',
        'mongodb',
        'Count documents in a collection',
        'GET',
        [
          createParameter('collection', 'string', 'Collection name', { required: true }),
          createParameter('query', 'object', 'Query filter', { required: false, default: {} }),
        ],
        { requiredScopes: ['read'] }
      ),
      async (params: CountParams, context) => {
        this.validateCollectionName(params.collection);
        const sanitizedQuery = this.sanitizeQuery(params.query || {});

        const { connection } = await this.getMongoConnection(context.connectionId);
        
        if (!connection.db) {
          throw new Error('Database connection is not available');
        }
        
        const db: Db = connection.db;
        const collection: Collection = db.collection(params.collection);

        const count = await collection.countDocuments(sanitizedQuery);

        return {
          count,
          collection: params.collection,
        };
      }
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
          createParameter('collection', 'string', 'Collection name', { required: true }),
          createParameter('documents', 'array', 'Documents to insert', { required: true }),
        ],
        { requiredScopes: ['write'] }
      ),
      async (params: InsertParams, context) => {
        this.validateCollectionName(params.collection);

        if (!Array.isArray(params.documents) || params.documents.length === 0) {
          throw new Error('documents must be a non-empty array');
        }

        const { connection } = await this.getMongoConnection(context.connectionId);
        
        if (!connection.db) {
          throw new Error('Database connection is not available');
        }
        
        const db: Db = connection.db;
        const collection: Collection = db.collection(params.collection);

        const result = await collection.insertMany(params.documents);

        return {
          success: true,
          insertedCount: result.insertedCount,
          insertedIds: result.insertedIds,
          collection: params.collection,
        };
      }
    );

    // Update documents
    this.registerTool(
      createToolSchema(
        'mongodb_update',
        'mongodb',
        'Update documents in a collection',
        'PATCH',
        [
          createParameter('collection', 'string', 'Collection name', { required: true }),
          createParameter('query', 'object', 'Query filter', { required: true }),
          createParameter('update', 'object', 'Update operations', { required: true }),
          createParameter('multi', 'boolean', 'Update multiple documents', { default: false }),
        ],
        { requiredScopes: ['write'] }
      ),
      async (params: UpdateParams, context) => {
        this.validateCollectionName(params.collection);
        const sanitizedQuery = this.sanitizeQuery(params.query);
        const sanitizedUpdate = this.sanitizeQuery(params.update);

        const { connection } = await this.getMongoConnection(context.connectionId);
        
        if (!connection.db) {
          throw new Error('Database connection is not available');
        }
        
        const db: Db = connection.db;
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
      }
    );

    // Delete documents
    this.registerTool(
      createToolSchema(
        'mongodb_delete',
        'mongodb',
        'Delete documents from a collection',
        'DELETE',
        [
          createParameter('collection', 'string', 'Collection name', { required: true }),
          createParameter('query', 'object', 'Query filter', { required: true }),
          createParameter('multi', 'boolean', 'Delete multiple documents', { default: false }),
        ],
        {
          requiredScopes: ['delete'],
          dangerous: true,
        }
      ),
      async (params: DeleteParams, context) => {
        this.validateCollectionName(params.collection);
        const sanitizedQuery = this.sanitizeQuery(params.query);

        // Prevent deleting entire collection
        if (Object.keys(sanitizedQuery as Record<string, any>).length === 0) {
          throw new Error('Query cannot be empty for delete operations. Use a specific query filter.');
        }

        const { connection } = await this.getMongoConnection(context.connectionId);
        
        if (!connection.db) {
          throw new Error('Database connection is not available');
        }
        
        const db: Db = connection.db;
        const collection: Collection = db.collection(params.collection);

        const result = params.multi
          ? await collection.deleteMany(sanitizedQuery)
          : await collection.deleteOne(sanitizedQuery);

        return {
          success: true,
          deletedCount: result.deletedCount,
          collection: params.collection,
        };
      }
    );
  }
}

// Initialize and register MongoDB tools
export function initializeMongoDBMCP(): void {
  const mongodbMCP = new MongoDBMCP();
  mongodbMCP.registerTools();
}
