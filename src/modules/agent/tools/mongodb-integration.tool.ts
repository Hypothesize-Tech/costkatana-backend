import { Injectable, Inject } from '@nestjs/common';
import { BaseAgentTool } from './base-agent.tool';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

/**
 * MongoDB Integration Tool Service
 * Advanced MongoDB operations via MCP (Model Context Protocol)
 * Ported from Express MongoDBIntegrationTool with NestJS patterns
 */
@Injectable()
export class MongoDBIntegrationToolService extends BaseAgentTool {
  constructor(
    @InjectConnection()
    private readonly connection: Connection,
  ) {
    super(
      'mongodb_integration',
      `Advanced MongoDB operations via MCP:
- list_collections: List all available collections
- find: Query documents with advanced filters
- aggregate: Perform aggregation pipelines
- count: Count documents matching criteria

Input should be a JSON string with:
{
  "operation": "list_collections|find|aggregate|count",
  "collection": "collection_name",
  "query": {...}, // For find/count operations
  "pipeline": [...], // For aggregate operations
  "options": {...} // Additional options
}`,
    );
  }

  protected async executeLogic(input: any): Promise<any> {
    try {
      const { operation, collection, query, pipeline, options = {} } = input;

      switch (operation) {
        case 'list_collections':
          return await this.listCollections();

        case 'find':
          return await this.findDocuments(collection, query, options);

        case 'aggregate':
          return await this.aggregateDocuments(collection, pipeline, options);

        case 'count':
          return await this.countDocuments(collection, query);

        default:
          return this.createErrorResponse(
            'mongodb_integration',
            `Unsupported operation: ${operation}`,
          );
      }
    } catch (error: any) {
      this.logger.error('MongoDB integration operation failed', {
        error: error.message,
        input,
      });
      return this.createErrorResponse('mongodb_integration', error.message);
    }
  }

  private async listCollections(): Promise<any> {
    try {
      const db = this.connection.db;
      if (!db) {
        return this.createErrorResponse(
          'mongodb_integration',
          'Database not connected',
        );
      }
      const collections = await db.listCollections().toArray();
      const collectionNames = collections.map((col) => col.name);

      return this.createSuccessResponse('mongodb_integration', {
        operation: 'list_collections',
        collections: collectionNames,
        count: collectionNames.length,
        message: `Found ${collectionNames.length} collections`,
      });
    } catch (error: any) {
      return this.createErrorResponse(
        'mongodb_integration',
        `Failed to list collections: ${error.message}`,
      );
    }
  }

  private async findDocuments(
    collection: string,
    query: any,
    options: any,
  ): Promise<any> {
    try {
      const coll = this.connection.collection(collection);
      const limit = Math.min(options.limit || 100, 1000);
      const skip = options.skip || 0;

      const documents = await coll
        .find(query || {})
        .limit(limit)
        .skip(skip)
        .toArray();

      return this.createSuccessResponse('mongodb_integration', {
        operation: 'find',
        collection,
        query,
        documents,
        count: documents.length,
        message: `Found ${documents.length} documents in ${collection}`,
      });
    } catch (error: any) {
      return this.createErrorResponse(
        'mongodb_integration',
        `Failed to find documents: ${error.message}`,
      );
    }
  }

  private async aggregateDocuments(
    collection: string,
    pipeline: any[],
    options: any,
  ): Promise<any> {
    try {
      const coll = this.connection.collection(collection);
      const results = await coll.aggregate(pipeline).toArray();

      return this.createSuccessResponse('mongodb_integration', {
        operation: 'aggregate',
        collection,
        pipeline,
        results,
        count: results.length,
        message: `Aggregation completed with ${results.length} results`,
      });
    } catch (error: any) {
      return this.createErrorResponse(
        'mongodb_integration',
        `Failed to aggregate: ${error.message}`,
      );
    }
  }

  private async countDocuments(collection: string, query: any): Promise<any> {
    try {
      const coll = this.connection.collection(collection);
      const count = await coll.countDocuments(query || {});

      return this.createSuccessResponse('mongodb_integration', {
        operation: 'count',
        collection,
        query,
        count,
        message: `Found ${count} documents matching the query`,
      });
    } catch (error: any) {
      return this.createErrorResponse(
        'mongodb_integration',
        `Failed to count documents: ${error.message}`,
      );
    }
  }
}
