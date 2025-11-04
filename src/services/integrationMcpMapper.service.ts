import { loggingService } from './logging.service';
import { MongoDbReaderTool } from '../tools/mongoDbReader.tool';

/**
 * Maps integration intents to MongoDB MCP queries
 * NOTE: This service is kept for potential future use with internal costkatana metadata only.
 * SECURITY: Integration data (Linear projects, JIRA issues, etc.) MUST come from their APIs, not MongoDB.
 */
export class IntegrationMcpMapperService {
  /**
   * Execute MCP query using MongoDB reader tool
   * NOTE: This is kept for potential future use with internal costkatana metadata only.
   * Integration data should always be fetched via APIs.
   */
  static async executeMcpQuery(
    query: {
      collection: string;
      operation: 'find' | 'aggregate' | 'count';
      query?: any;
      pipeline?: any[];
      limit?: number;
    }
  ): Promise<any> {
    try {
      const tool = new MongoDbReaderTool();
      
      // Convert query to JSON string for tool
      const queryJson = JSON.stringify(query);
      
      loggingService.info('Executing MCP query', {
        component: 'IntegrationMcpMapper',
        operation: 'executeMcpQuery',
        collection: query.collection,
        operationType: query.operation
      });

      const result = await tool._call(queryJson);
      
      // Parse result
      try {
        return JSON.parse(result);
      } catch {
        // If not JSON, return as string
        return { data: result, raw: true };
      }
    } catch (error: any) {
      loggingService.error('MCP query execution failed', {
        component: 'IntegrationMcpMapper',
        operation: 'executeMcpQuery',
        error: error.message
      });
      throw error;
    }
  }
}

