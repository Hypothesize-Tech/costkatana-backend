/**
 * Integration MCP Mapper Service (NestJS)
 * Maps integration intents to MongoDB MCP queries
 * Ported from Express IntegrationMcpMapperService
 *
 * NOTE: This service is kept for potential future use with internal costkatana metadata only.
 * SECURITY: Integration data (Linear projects, JIRA issues, etc.) MUST come from their APIs, not MongoDB.
 */

import { Injectable, Logger } from '@nestjs/common';
import { MongoDbReaderToolService } from '../../agent/tools/mongodb-reader.tool';

/**
 * Maps integration intents to MongoDB MCP queries
 * NOTE: This service is kept for potential future use with internal costkatana metadata only.
 * SECURITY: Integration data should always be fetched via APIs.
 */
@Injectable()
export class IntegrationMcpMapperService {
  private readonly logger = new Logger(IntegrationMcpMapperService.name);

  constructor(private readonly mongoDbReaderTool: MongoDbReaderToolService) {}

  /**
   * Execute MCP query using MongoDB reader tool
   * NOTE: This is kept for potential future use with internal costkatana metadata only.
   * Integration data should always be fetched via APIs.
   */
  async executeMcpQuery(query: {
    collection: string;
    operation: 'find' | 'aggregate' | 'count';
    query?: any;
    pipeline?: any[];
    limit?: number;
  }): Promise<any> {
    try {
      // Convert query to JSON string for tool
      const queryJson = JSON.stringify(query);

      this.logger.log('Executing MCP query', {
        component: 'IntegrationMcpMapper',
        operation: 'executeMcpQuery',
        collection: query.collection,
        operationType: query.operation,
      });

      const result = await this.mongoDbReaderTool._call(queryJson);

      // Parse result
      try {
        return JSON.parse(result);
      } catch {
        // If not JSON, return as string
        return { data: result, raw: true };
      }
    } catch (error: any) {
      this.logger.error('MCP query execution failed', {
        component: 'IntegrationMcpMapper',
        operation: 'executeMcpQuery',
        error: error.message,
      });
      throw error;
    }
  }
}
