/**
 * MongoDB MCP Service
 * Database operations for MongoDB integration
 */

import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BaseIntegrationService } from './base-integration.service';
import { ToolRegistryService } from '../tool-registry.service';
import { TokenManagerService } from '../token-manager.service';
import { LoggerService } from '../../../../common/logger/logger.service';
import { createToolSchema, createParameter } from '../../utils/tool-validation';
import { VercelConnection } from '@/schemas/integration/vercel-connection.schema';
import { GitHubConnection } from '@/schemas/integration/github-connection.schema';
import { GoogleConnection } from '@/schemas/integration/google-connection.schema';
import { MongoDBConnection } from '@/schemas/integration/mongodb-connection.schema';
import { AWSConnection } from '@/schemas/integration/aws-connection.schema';
import { Integration } from '@/schemas/integration/integration.schema';

@Injectable()
export class MongoDbMcpService
  extends BaseIntegrationService
  implements OnModuleInit
{
  protected integration: 'mongodb' = 'mongodb';
  protected version = '1.0.0';

  constructor(
    logger: LoggerService,
    toolRegistry: ToolRegistryService,
    tokenManager: TokenManagerService,
    @InjectModel(VercelConnection.name)
    vercelConnectionModel: Model<VercelConnection>,
    @InjectModel(GitHubConnection.name)
    githubConnectionModel: Model<GitHubConnection>,
    @InjectModel(GoogleConnection.name)
    googleConnectionModel: Model<GoogleConnection>,
    @InjectModel(MongoDBConnection.name)
    mongodbConnectionModel: Model<MongoDBConnection>,
    @InjectModel(AWSConnection.name)
    awsConnectionModel: Model<AWSConnection>,
    @InjectModel(Integration.name) integrationModel: Model<Integration>,
  ) {
    super(
      logger,
      toolRegistry,
      tokenManager,
      vercelConnectionModel,
      githubConnectionModel,
      googleConnectionModel,
      mongodbConnectionModel,
      awsConnectionModel,
      integrationModel,
    );
  }

  onModuleInit() {
    this.registerTools();
  }

  /**
   * Execute a MongoDB action by name (used by integration orchestrator).
   * Delegates to natural language command stub; override to map actions to tools.
   */
  async executeAction(
    userId: string,
    action: string,
    params: Record<string, any>,
  ): Promise<any> {
    return this.executeNaturalLanguageCommand(
      userId,
      `MongoDB ${action}: ${JSON.stringify(params)}`,
    );
  }

  registerTools(): void {
    // Find documents
    this.registerTool(
      createToolSchema(
        'mongodb_find',
        'mongodb',
        'Find documents in a MongoDB collection',
        'GET',
        [
          createParameter('database', 'string', 'Database name', {
            required: true,
          }),
          createParameter('collection', 'string', 'Collection name', {
            required: true,
          }),
          createParameter('filter', 'object', 'Query filter', {
            required: false,
          }),
          createParameter('projection', 'object', 'Field projection', {
            required: false,
          }),
          createParameter('sort', 'object', 'Sort specification', {
            required: false,
          }),
          createParameter('limit', 'number', 'Maximum number of documents', {
            required: false,
            default: 100,
          }),
          createParameter('skip', 'number', 'Number of documents to skip', {
            required: false,
            default: 0,
          }),
        ],
        { requiredScopes: ['read'] },
      ),
      async (params, context) => {
        const { MongoClient } = await import('mongodb');
        const connectionString = await this.getAccessToken(
          context.connectionId,
        );

        const client = new MongoClient(connectionString);
        await client.connect();

        try {
          const db = client.db(params.database);
          const collection = db.collection(params.collection);

          const cursor = collection
            .find(params.filter || {})
            .project(params.projection || {})
            .sort(params.sort || {})
            .limit(Math.min(params.limit || 100, 1000)) // Max 1000 documents
            .skip(params.skip || 0);

          const documents = await cursor.toArray();

          return {
            documents,
            count: documents.length,
            database: params.database,
            collection: params.collection,
          };
        } finally {
          await client.close();
        }
      },
    );

    // Aggregate documents
    this.registerTool(
      createToolSchema(
        'mongodb_aggregate',
        'mongodb',
        'Perform aggregation pipeline on MongoDB collection',
        'GET',
        [
          createParameter('database', 'string', 'Database name', {
            required: true,
          }),
          createParameter('collection', 'string', 'Collection name', {
            required: true,
          }),
          createParameter('pipeline', 'array', 'Aggregation pipeline stages', {
            required: true,
          }),
          createParameter('options', 'object', 'Aggregation options', {
            required: false,
          }),
        ],
        { requiredScopes: ['read'] },
      ),
      async (params, context) => {
        const { MongoClient } = await import('mongodb');
        const connectionString = await this.getAccessToken(
          context.connectionId,
        );

        const client = new MongoClient(connectionString);
        await client.connect();

        try {
          const db = client.db(params.database);
          const collection = db.collection(params.collection);

          const cursor = collection.aggregate(
            params.pipeline,
            params.options || {},
          );
          const results = await cursor.toArray();

          return {
            results,
            count: results.length,
            database: params.database,
            collection: params.collection,
            pipeline: params.pipeline,
          };
        } finally {
          await client.close();
        }
      },
    );

    // Insert documents
    this.registerTool(
      createToolSchema(
        'mongodb_insert',
        'mongodb',
        'Insert documents into MongoDB collection',
        'POST',
        [
          createParameter('database', 'string', 'Database name', {
            required: true,
          }),
          createParameter('collection', 'string', 'Collection name', {
            required: true,
          }),
          createParameter('documents', 'array', 'Documents to insert', {
            required: true,
          }),
          createParameter('options', 'object', 'Insert options', {
            required: false,
          }),
        ],
        { requiredScopes: ['write'] },
      ),
      async (params, context) => {
        const { MongoClient } = await import('mongodb');
        const connectionString = await this.getAccessToken(
          context.connectionId,
        );

        const client = new MongoClient(connectionString);
        await client.connect();

        try {
          const db = client.db(params.database);
          const collection = db.collection(params.collection);

          const result = await collection.insertMany(
            params.documents,
            params.options || {},
          );

          return {
            insertedIds: Object.values(result.insertedIds),
            insertedCount: result.insertedCount,
            database: params.database,
            collection: params.collection,
          };
        } finally {
          await client.close();
        }
      },
    );

    // Update documents
    this.registerTool(
      createToolSchema(
        'mongodb_update',
        'mongodb',
        'Update documents in MongoDB collection',
        'PATCH',
        [
          createParameter('database', 'string', 'Database name', {
            required: true,
          }),
          createParameter('collection', 'string', 'Collection name', {
            required: true,
          }),
          createParameter('filter', 'object', 'Update filter', {
            required: true,
          }),
          createParameter('update', 'object', 'Update operations', {
            required: true,
          }),
          createParameter('options', 'object', 'Update options', {
            required: false,
          }),
        ],
        { requiredScopes: ['write'] },
      ),
      async (params, context) => {
        const { MongoClient } = await import('mongodb');
        const connectionString = await this.getAccessToken(
          context.connectionId,
        );

        const client = new MongoClient(connectionString);
        await client.connect();

        try {
          const db = client.db(params.database);
          const collection = db.collection(params.collection);

          const result = await collection.updateMany(
            params.filter,
            params.update,
            params.options || {},
          );

          return {
            matchedCount: result.matchedCount,
            modifiedCount: result.modifiedCount,
            upsertedCount: result.upsertedCount,
            upsertedId: result.upsertedId,
            database: params.database,
            collection: params.collection,
          };
        } finally {
          await client.close();
        }
      },
    );

    // Delete documents
    this.registerTool(
      createToolSchema(
        'mongodb_delete',
        'mongodb',
        'Delete documents from MongoDB collection',
        'DELETE',
        [
          createParameter('database', 'string', 'Database name', {
            required: true,
          }),
          createParameter('collection', 'string', 'Collection name', {
            required: true,
          }),
          createParameter('filter', 'object', 'Delete filter', {
            required: true,
          }),
          createParameter('options', 'object', 'Delete options', {
            required: false,
          }),
        ],
        {
          requiredScopes: ['delete'],
          dangerous: true,
        },
      ),
      async (params, context) => {
        const { MongoClient } = await import('mongodb');
        const connectionString = await this.getAccessToken(
          context.connectionId,
        );

        const client = new MongoClient(connectionString);
        await client.connect();

        try {
          const db = client.db(params.database);
          const collection = db.collection(params.collection);

          const result = await collection.deleteMany(
            params.filter,
            params.options || {},
          );

          return {
            deletedCount: result.deletedCount,
            database: params.database,
            collection: params.collection,
          };
        } finally {
          await client.close();
        }
      },
    );

    // Count documents
    this.registerTool(
      createToolSchema(
        'mongodb_count',
        'mongodb',
        'Count documents in MongoDB collection',
        'GET',
        [
          createParameter('database', 'string', 'Database name', {
            required: true,
          }),
          createParameter('collection', 'string', 'Collection name', {
            required: true,
          }),
          createParameter('filter', 'object', 'Count filter', {
            required: false,
          }),
          createParameter('options', 'object', 'Count options', {
            required: false,
          }),
        ],
        { requiredScopes: ['read'] },
      ),
      async (params, context) => {
        const { MongoClient } = await import('mongodb');
        const connectionString = await this.getAccessToken(
          context.connectionId,
        );

        const client = new MongoClient(connectionString);
        await client.connect();

        try {
          const db = client.db(params.database);
          const collection = db.collection(params.collection);

          const count = await collection.countDocuments(
            params.filter || {},
            params.options || {},
          );

          return {
            count,
            database: params.database,
            collection: params.collection,
          };
        } finally {
          await client.close();
        }
      },
    );

    // Distinct values
    this.registerTool(
      createToolSchema(
        'mongodb_distinct',
        'mongodb',
        'Get distinct values for a field in MongoDB collection',
        'GET',
        [
          createParameter('database', 'string', 'Database name', {
            required: true,
          }),
          createParameter('collection', 'string', 'Collection name', {
            required: true,
          }),
          createParameter('field', 'string', 'Field name', { required: true }),
          createParameter('filter', 'object', 'Query filter', {
            required: false,
          }),
          createParameter('options', 'object', 'Distinct options', {
            required: false,
          }),
        ],
        { requiredScopes: ['read'] },
      ),
      async (params, context) => {
        const { MongoClient } = await import('mongodb');
        const connectionString = await this.getAccessToken(
          context.connectionId,
        );

        const client = new MongoClient(connectionString);
        await client.connect();

        try {
          const db = client.db(params.database);
          const collection = db.collection(params.collection);

          const values = await collection.distinct(
            params.field,
            params.filter || {},
            params.options || {},
          );

          return {
            field: params.field,
            values,
            count: values.length,
            database: params.database,
            collection: params.collection,
          };
        } finally {
          await client.close();
        }
      },
    );

    // List collections
    this.registerTool(
      createToolSchema(
        'mongodb_list_collections',
        'mongodb',
        'List collections in MongoDB database',
        'GET',
        [
          createParameter('database', 'string', 'Database name', {
            required: true,
          }),
          createParameter('filter', 'object', 'Collection filter', {
            required: false,
          }),
        ],
        { requiredScopes: ['read'] },
      ),
      async (params, context) => {
        const { MongoClient } = await import('mongodb');
        const connectionString = await this.getAccessToken(
          context.connectionId,
        );

        const client = new MongoClient(connectionString);
        await client.connect();

        try {
          const db = client.db(params.database);
          const collections = await db
            .listCollections(params.filter || {})
            .toArray();

          return {
            collections: collections.map((col) => ({
              name: col.name,
              type: col.type,
              // Note: options may not be available in all MongoDB versions
              options: (col as any).options || {},
            })),
            count: collections.length,
            database: params.database,
          };
        } finally {
          await client.close();
        }
      },
    );

    // Collection stats
    this.registerTool(
      createToolSchema(
        'mongodb_collection_stats',
        'mongodb',
        'Get statistics for MongoDB collection',
        'GET',
        [
          createParameter('database', 'string', 'Database name', {
            required: true,
          }),
          createParameter('collection', 'string', 'Collection name', {
            required: true,
          }),
        ],
        { requiredScopes: ['read'] },
      ),
      async (params, context) => {
        const { MongoClient } = await import('mongodb');
        const connectionString = await this.getAccessToken(
          context.connectionId,
        );

        const client = new MongoClient(connectionString);
        await client.connect();

        try {
          const db = client.db(params.database);
          const collection = db.collection(params.collection);

          const stats = await db.command({
            collStats: params.collection,
            scale: 1024 * 1024, // Scale to MB
          });

          return {
            stats,
            database: params.database,
            collection: params.collection,
          };
        } finally {
          await client.close();
        }
      },
    );

    // Analyze query
    this.registerTool(
      createToolSchema(
        'mongodb_explain_query',
        'mongodb',
        'Explain query execution plan',
        'GET',
        [
          createParameter('database', 'string', 'Database name', {
            required: true,
          }),
          createParameter('collection', 'string', 'Collection name', {
            required: true,
          }),
          createParameter('filter', 'object', 'Query filter', {
            required: true,
          }),
          createParameter('options', 'object', 'Explain options', {
            required: false,
          }),
        ],
        { requiredScopes: ['read'] },
      ),
      async (params, context) => {
        const { MongoClient } = await import('mongodb');
        const connectionString = await this.getAccessToken(
          context.connectionId,
        );

        const client = new MongoClient(connectionString);
        await client.connect();

        try {
          const db = client.db(params.database);
          const collection = db.collection(params.collection);

          const explanation = await collection
            .find(params.filter)
            .explain(params.options || {});

          return {
            explanation,
            database: params.database,
            collection: params.collection,
            filter: params.filter,
          };
        } finally {
          await client.close();
        }
      },
    );

    // Suggest indexes
    this.registerTool(
      createToolSchema(
        'mongodb_suggest_indexes',
        'mongodb',
        'Analyze query patterns and suggest indexes',
        'GET',
        [
          createParameter('database', 'string', 'Database name', {
            required: true,
          }),
          createParameter('collection', 'string', 'Collection name', {
            required: true,
          }),
          createParameter('queries', 'array', 'Sample queries to analyze', {
            required: true,
          }),
        ],
        { requiredScopes: ['read'] },
      ),
      async (params, context) => {
        const { MongoClient } = await import('mongodb');
        const connectionString = await this.getAccessToken(
          context.connectionId,
        );

        const client = new MongoClient(connectionString);
        await client.connect();

        try {
          const db = client.db(params.database);
          const collection = db.collection(params.collection);

          const suggestions = [];

          for (const query of params.queries) {
            try {
              const explanation = await collection.find(query).explain();
              const winningPlan = explanation.executionStats?.winningPlan;

              if (winningPlan?.stage === 'COLLSCAN') {
                // Full collection scan - suggest index
                const suggestedIndex = Object.keys(query).reduce((acc, key) => {
                  if (key !== '_id') acc[key] = 1;
                  return acc;
                }, {} as any);

                suggestions.push({
                  query,
                  suggestion: 'Consider creating index',
                  index: suggestedIndex,
                  reason: 'Query is performing full collection scan',
                });
              }
            } catch (error) {
              // Skip invalid queries
              continue;
            }
          }

          return {
            suggestions,
            database: params.database,
            collection: params.collection,
            analyzedQueries: params.queries.length,
          };
        } finally {
          await client.close();
        }
      },
    );
  }
}
