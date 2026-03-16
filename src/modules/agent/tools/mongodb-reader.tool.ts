import { Injectable, Inject } from '@nestjs/common';
import { BaseAgentTool } from './base-agent.tool';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

interface MongoQuery {
  collection: string;
  operation: 'find' | 'aggregate' | 'count';
  query?: any;
  options?: any;
  pipeline?: any[];
  limit?: number;
}

/**
 * MongoDB Reader Tool Service
 * Provides READ-ONLY access to MongoDB collections for analytics and data retrieval
 * Ported from Express MongoDbReaderTool with NestJS patterns
 */
@Injectable()
export class MongoDbReaderToolService extends BaseAgentTool {
  private readonly allowedCollections = [
    'usages',
    'projects',
    'optimizations',
    'alerts',
    'users',
    'prompttemplates',
    'activities',
    'conversations',
    'chatmessages',
    'qualityscores',
    'tips',
    'guardrails',
    'intelligentmonitoring',
    'webhooks',
    'integrations',
    'costtracking',
    'modelpricing',
    'experiments',
    'feedback',
    'analytics',
    'notifications',
    'sessions',
    'tokens',
    'models',
    'providers',
    'settings',
    'logs',
    'metrics',
    'traces',
    'spans',
    'telemetry',
  ];

  private readonly allowedOperations = ['find', 'aggregate', 'count'];

  constructor(
    @InjectConnection()
    private readonly connection: Connection,
  ) {
    super(
      'mongodb_reader',
      `Query the MongoDB database for cost and usage information. This tool provides READ-ONLY access to:
- Usage data and patterns
- Cost analytics and trends
- Project information
- Optimization history
- Alert configurations

Input should be a JSON string with:
{
  "collection": "usages|projects|optimizations|alerts|users|prompttemplates",
  "operation": "find|aggregate|count",
  "query": {...}, // MongoDB query object
  "options": {...}, // Additional options like sort, limit
  "pipeline": [...], // For aggregation operations
  "limit": number // Max results (default: 100)
}

IMPORTANT: This tool is READ-ONLY and cannot modify data.`,
    );
  }

  /**
   * Public API for executing a read-only query. Use this from other services (e.g. analytics, optimization).
   */
  async runQuery(input: any): Promise<any> {
    return this.executeLogic(input);
  }

  protected async executeLogic(input: any): Promise<any> {
    try {
      if (!input || typeof input !== 'object') {
        return this.createErrorResponse(
          'mongodb_reader',
          'Invalid input format. Expected JSON object.',
        );
      }

      const queryData: MongoQuery = input;

      // Security validations
      if (!this.isValidQuery(queryData)) {
        return this.createErrorResponse(
          'mongodb_reader',
          'Invalid query: Check collection name, operation, and parameters.',
        );
      }

      const collection = this.connection.collection(queryData.collection);
      const limit = Math.min(queryData.limit || 100, 500); // Max 500 records

      let result: any;

      switch (queryData.operation) {
        case 'find':
          const findOptions = {
            ...queryData.options,
            limit,
          };
          result = await collection
            .find(queryData.query || {}, findOptions)
            .toArray();
          break;

        case 'aggregate':
          if (!queryData.pipeline || !Array.isArray(queryData.pipeline)) {
            return this.createErrorResponse(
              'mongodb_reader',
              'Pipeline is required for aggregate operations',
            );
          }
          // Add limit to pipeline if not present
          const pipeline = [...queryData.pipeline];
          if (!pipeline.some((stage) => stage.$limit)) {
            pipeline.push({ $limit: limit });
          }
          result = await collection.aggregate(pipeline).toArray();
          break;

        case 'count':
          result = await collection.countDocuments(queryData.query || {});
          break;

        default:
          return this.createErrorResponse(
            'mongodb_reader',
            `Unsupported operation: ${queryData.operation}`,
          );
      }

      return this.createSuccessResponse('mongodb_reader', {
        collection: queryData.collection,
        operation: queryData.operation,
        result,
        count: Array.isArray(result) ? result.length : result,
        limit: limit,
      });
    } catch (error: any) {
      this.logger.error('MongoDB reader operation failed', {
        error: error.message,
        input,
      });
      return this.createErrorResponse('mongodb_reader', error.message);
    }
  }

  private isValidQuery(query: MongoQuery): boolean {
    // Check collection is allowed
    if (!this.allowedCollections.includes(query.collection)) {
      this.logger.warn('Attempted access to unauthorized collection', {
        collection: query.collection,
        allowedCollections: this.allowedCollections,
      });
      return false;
    }

    // Check operation is allowed
    if (!this.allowedOperations.includes(query.operation)) {
      this.logger.warn('Attempted unauthorized operation', {
        operation: query.operation,
        allowedOperations: this.allowedOperations,
      });
      return false;
    }

    // Additional validation for aggregate operations
    if (
      query.operation === 'aggregate' &&
      (!query.pipeline || !Array.isArray(query.pipeline))
    ) {
      return false;
    }

    return true;
  }
}
