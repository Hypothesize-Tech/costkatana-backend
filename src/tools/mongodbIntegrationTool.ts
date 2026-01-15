/**
 * MongoDB Integration Tool for Agent System
 * 
 * This tool allows the AI agent to execute MongoDB operations using the existing
 * MCP infrastructure and MongoDBChatAgentService.
 */

import { Tool } from '@langchain/core/tools';
import { loggingService } from '../services/logging.service';
import { MongoDBConnection } from '../models/MongoDBConnection';
import { MongoDBChatAgentService } from '../services/mongodbChatAgent.service';

export interface MongoDBIntegrationInput {
  action: string;
  connectionId?: string;
  collectionName?: string;
  query?: string;
  documents?: string;
  update?: string;
  indexName?: string;
  fields?: string;
  pipeline?: string;
  limit?: number;
  skip?: number;
  [key: string]: any;
}

export class MongoDBIntegrationTool extends Tool {
  name = 'mongodb_integration';
  description = `Execute MongoDB READ-ONLY operations using the MCP service. Use this tool when the user wants to:
  - List collections (action: "list_collections") - Shows all collections in the database
  - Get database stats (action: "database_stats") - Database size and information
  - Get collection stats (action: "collection_stats", collectionName: string) - Collection statistics
  - Find documents (action: "find", collectionName: string, query?: string, limit?: number) - Query documents
  - Run aggregation (action: "aggregate", collectionName: string, pipeline: string) - Aggregation pipeline
  - Get help (action: "help") - Available MongoDB commands

This tool uses the existing MongoDB MCP service and chat agent for all operations.
Input should be a JSON string with action and required parameters.
Example: {"action": "list_collections"}`;

  private userId: string = 'unknown';

  constructor(userId?: string) {
    super();
    if (userId) {
      this.userId = userId;
    }
  }

  /**
   * Set userId - called before invocation
   */
  public setUserId(userId: string): void {
    this.userId = userId;
  }

  async _call(input: string, runManager?: any): Promise<string> {
    try {
      // Try to extract userId from run manager or context
      const contextUserId = runManager?.metadata?.userId || runManager?.tags?.includes('user:') 
        ? runManager.tags.find((t: string) => t.startsWith('user:'))?.split(':')[1]
        : this.userId;

      loggingService.info('🔧 MongoDB Integration Tool called', {
        component: 'MongoDBIntegrationTool',
        userId: contextUserId,
        input: input.substring(0, 200),
      });

      // Parse input
      let params: MongoDBIntegrationInput;
      try {
        params = JSON.parse(input);
      } catch (error) {
        // If input is not JSON, try to extract action and parameters from natural language
        params = this.parseNaturalLanguage(input);
      }

      if (!params.action) {
        return JSON.stringify({
          success: false,
          error: 'Missing required parameter: action',
          hint: 'Please specify an action like list_collections, find, aggregate, etc.',
        });
      }

      // Validate action
      const validActions = [
        'list_collections', 'list_databases', 'database_stats', 'collection_stats',
        'find', 'count', 'distinct', 'aggregate', 'help'
      ];

      if (!validActions.includes(params.action)) {
        return JSON.stringify({
          success: false,
          error: `Invalid action: ${params.action}`,
          validActions,
          message: `Invalid MongoDB action "${params.action}". Valid actions are: ${validActions.join(', ')}`,
        });
      }

      // Check for required parameters and trigger IntegrationSelector if missing
      const paramCheckResult = await this.checkRequiredParameters(params, contextUserId);
      if (!paramCheckResult.valid) {
        loggingService.info('🔧 Missing required parameters, triggering IntegrationSelector', {
          component: 'MongoDBIntegrationTool',
          action: params.action,
          missingParam: paramCheckResult.missingParam,
          selectorDataPreview: {
            parameterName: paramCheckResult.selectorData?.parameterName,
            question: paramCheckResult.selectorData?.question,
            optionsCount: paramCheckResult.selectorData?.options?.length || 0,
            allowCustom: paramCheckResult.selectorData?.allowCustom,
            integration: paramCheckResult.selectorData?.integration
          }
        });
        
        return JSON.stringify({
          success: false,
          error: paramCheckResult.error,
          requiresIntegrationSelector: true,
          integrationSelectorData: paramCheckResult.selectorData,
        });
      }

      // Execute MongoDB command
      const result = await this.executeMongoDBCommand(params, contextUserId);

      loggingService.info('✅ MongoDB Integration Tool completed', {
        component: 'MongoDBIntegrationTool',
        action: params.action,
        success: result.success,
      });

      return JSON.stringify(result);
    } catch (error) {
      loggingService.error('❌ MongoDB Integration Tool error', {
        component: 'MongoDBIntegrationTool',
        error: error instanceof Error ? error.message : String(error),
      });

      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Execute MongoDB command using existing MCP infrastructure
   */
  private async executeMongoDBCommand(params: MongoDBIntegrationInput, userId: string): Promise<any> {
    try {
      // Get active MongoDB connection for the user (with connectionString for debugging)
      const connection = await MongoDBConnection.findOne({
        userId,
        isActive: true
      }).select('+connectionString');

      if (!connection) {
        return {
          success: false,
          error: 'No active MongoDB connection found',
          hint: 'Please connect to MongoDB first using the Integrations page',
          requiresSetup: true
        };
      }

      const connectionId = connection._id?.toString();
      if (!connectionId) {
        return {
          success: false,
          error: 'Invalid connection ID'
        };
      }

      // Log connection details for debugging
      loggingService.info('MongoDB connection details', {
        component: 'MongoDBIntegrationTool',
        connectionId,
        database: connection.database,
        alias: connection.alias,
        action: params.action
      });

      // Map the action to a natural language message that MongoDBChatAgentService can understand
      let message = '';
      
      switch (params.action) {
        case 'list_collections':
          message = 'show all collections';
          break;
        
        case 'list_databases':
          message = 'show database info';
          break;
        
        case 'database_stats':
          message = 'show database statistics';
          break;
        
        case 'collection_stats':
          message = `show statistics for ${params.collectionName} collection`;
          break;
        
        case 'find':
          const limit = params.limit || 10;
          message = `find ${limit} documents from ${params.collectionName}`;
          if (params.query) {
            message += ` where ${JSON.stringify(params.query)}`;
          }
          break;
        
        case 'count':
          message = `count how many documents in ${params.collectionName}`;
          if (params.query) {
            message += ` matching ${JSON.stringify(params.query)}`;
          }
          break;
        
        case 'aggregate':
          message = `aggregate ${params.collectionName} with pipeline ${JSON.stringify(params.pipeline)}`;
          break;
        
        case 'distinct':
          message = `get distinct values from ${params.collectionName}`;
          if (params.fields) {
            message += ` for field ${params.fields}`;
          }
          break;
        
        case 'help':
          return {
            success: true,
            message: `Available MongoDB commands:
• @mongodb:list - List all collections
• @mongodb:database_stats - Get database statistics  
• @mongodb:count collection_name - Count documents in a collection
• @mongodb:find collection_name - Find documents in a collection
• @mongodb:aggregate collection_name - Run aggregation pipeline
• @mongodb:distinct collection_name - Get distinct values from a field

Connected to database: ${connection.database || 'default'}
Connection: ${connection.alias}`,
            action: 'help'
          };
        
        default:
          return {
            success: false,
            error: `Unknown action: ${params.action}`,
            availableActions: ['list_collections', 'database_stats', 'collection_stats', 'find', 'count', 'aggregate', 'help']
          };
      }

      // Call the existing MongoDB chat agent service
      const result = await MongoDBChatAgentService.processMessage(
        userId,
        connectionId,
        message
      );

      // Transform the result to match our expected format
      // Add database info to the message for transparency
      const enhancedMessage = `${result.message}\n\n📁 Connected to database: "${connection.database || 'default'}"`;
      
      return {
        success: true,
        message: enhancedMessage,
        data: result.data,
        formattedResult: result.formattedResult,
        suggestions: result.suggestions,
        resultType: result.resultType,
        action: params.action,
        connectionId,
        database: connection.database,
        connectionAlias: connection.alias,
        // MongoDB integration data for frontend
        mongodbIntegrationData: {
          action: params.action,
          connectionId,
          database: connection.database,
          connectionAlias: connection.alias
        }
      };

    } catch (error) {
      loggingService.error('Error executing MongoDB command', {
        component: 'MongoDBIntegrationTool',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Fetch collection options for IntegrationSelector
   * Returns a formatted array of collections with metadata
   */
  private async fetchCollectionOptions(userId: string): Promise<Array<{
    id: string;
    label: string;
    value: string;
    description?: string;
  }>> {
    try {
      // Get active MongoDB connection
      const connection = await MongoDBConnection.findOne({
        userId,
        isActive: true
      });

      if (!connection) {
        return [{
          id: 'no_connection',
          label: 'No MongoDB connection found',
          value: '',
          description: 'Please connect your MongoDB database first'
        }];
      }

      const connectionId = connection._id?.toString();
      if (!connectionId) {
        return [];
      }

      // Call MongoDBChatAgentService to list collections
      const { MongoDBChatAgentService } = await import('../services/mongodbChatAgent.service');
      const result = await MongoDBChatAgentService.processMessage(
        userId,
        connectionId,
        'show all collections'
      );

      // Extract collections array from result
      // result.data is MCPToolResult: { content: [{ type: 'text', text: JSON.stringify({database, count, collections}) }] }
      let collectionsArray: string[] = [];
      
      try {
        if (result.data?.content && Array.isArray(result.data.content) && result.data.content.length > 0) {
          const textContent = result.data.content[0]?.text;
          if (textContent) {
            const parsed = JSON.parse(textContent);
            collectionsArray = parsed.collections || [];
            
            loggingService.info('Parsed collections from MCP result', {
              component: 'MongoDBIntegrationTool',
              collectionsCount: collectionsArray.length,
              sampleCollections: collectionsArray.slice(0, 3),
              database: parsed.database
            });
          }
        }
      } catch (parseError) {
        loggingService.error('Error parsing collections from MCP result', {
          component: 'MongoDBIntegrationTool',
          error: parseError instanceof Error ? parseError.message : String(parseError),
          dataStructure: result.data ? Object.keys(result.data) : 'no data'
        });
      }
      
      loggingService.info('Fetched collections for IntegrationSelector', {
        component: 'MongoDBIntegrationTool',
        userId,
        connectionId,
        resultType: result.resultType,
        hasData: !!result.data,
        collectionsCount: collectionsArray.length,
        sampleCollections: collectionsArray.slice(0, 3)
      });

      // Parse collections from result
      if (collectionsArray && Array.isArray(collectionsArray) && collectionsArray.length > 0) {
        const collectionsOptions = collectionsArray.map((collection: string) => ({
          id: collection,
          label: collection,
          value: collection,
          description: `Collection in database`
        }));
        
        loggingService.info('Formatted collections options for IntegrationSelector', {
          component: 'MongoDBIntegrationTool',
          optionsCount: collectionsOptions.length,
          sampleOptions: collectionsOptions.slice(0, 3)
        });
        
        return collectionsOptions;
      }

      // Fallback: return empty array with a helpful message
      return [{
        id: 'custom',
        label: 'Type collection name manually',
        value: '',
        description: 'Could not fetch collections. Please enter manually.'
      }];

    } catch (error) {
      loggingService.error('Error fetching collection options', {
        component: 'MongoDBIntegrationTool',
        error: error instanceof Error ? error.message : String(error)
      });
      
      // Return a fallback option
      return [{
        id: 'custom',
        label: 'Type collection name manually',
        value: '',
        description: 'Error fetching collections. Please enter manually.'
      }];
    }
  }

  /**
   * Fetch common aggregation pipeline stage suggestions
   */
  private getAggregationPipelineSuggestions(): Array<{
    id: string;
    label: string;
    value: string;
    description?: string;
  }> {
    return [
      {
        id: 'match',
        label: '$match - Filter documents',
        value: '[{"$match": {"status": "active"}}]',
        description: 'Filter documents by criteria'
      },
      {
        id: 'group',
        label: '$group - Group by field',
        value: '[{"$group": {"_id": "$category", "count": {"$sum": 1}}}]',
        description: 'Group documents and aggregate'
      },
      {
        id: 'sort',
        label: '$sort - Sort documents',
        value: '[{"$sort": {"createdAt": -1}}]',
        description: 'Sort by field ascending (1) or descending (-1)'
      },
      {
        id: 'limit',
        label: '$limit - Limit results',
        value: '[{"$limit": 10}]',
        description: 'Limit number of results'
      },
      {
        id: 'project',
        label: '$project - Select fields',
        value: '[{"$project": {"name": 1, "email": 1, "_id": 0}}]',
        description: 'Include/exclude specific fields'
      },
      {
        id: 'lookup',
        label: '$lookup - Join collections',
        value: '[{"$lookup": {"from": "orders", "localField": "_id", "foreignField": "userId", "as": "userOrders"}}]',
        description: 'Perform left outer join'
      },
      {
        id: 'custom',
        label: 'Custom pipeline',
        value: '',
        description: 'Type your own aggregation pipeline'
      }
    ];
  }

  /**
   * Check if all required parameters are present for the given action
   * If not, return IntegrationSelector data to ask the user
   */
  private async checkRequiredParameters(params: MongoDBIntegrationInput, userId: string): Promise<{
    valid: boolean;
    error?: string;
    missingParam?: string;
    selectorData?: any;
  }> {
    switch (params.action) {
      case 'count':
        if (!params.collectionName) {
          // Fetch collections to provide as options
          const collections = await this.fetchCollectionOptions(userId);
          
          return {
            valid: false,
            error: 'Collection name is required to count documents',
            missingParam: 'collectionName',
            selectorData: {
              parameterName: 'collectionName',
              question: 'Which collection would you like to count documents in?',
              options: collections,
              placeholder: 'Enter collection name (e.g., users, products, orders)',
              allowCustom: true,
              integration: 'mongodb',
              pendingAction: 'count',
              collectedParams: { action: 'count' },
            },
          };
        }
        break;

      case 'find':
        if (!params.collectionName) {
          // Fetch collections to provide as options
          const collections = await this.fetchCollectionOptions(userId);
          
          return {
            valid: false,
            error: 'Collection name is required to find documents',
            missingParam: 'collectionName',
            selectorData: {
              parameterName: 'collectionName',
              question: 'Which collection would you like to search in?',
              options: collections,
              placeholder: 'Enter collection name (e.g., users, products, orders)',
              allowCustom: true,
              integration: 'mongodb',
              pendingAction: 'find',
              collectedParams: { action: 'find' },
            },
          };
        }
        // Query and limit are optional - use defaults if not provided
        // Default: find all documents with limit of 10
        break;

      case 'collection_stats':
        if (!params.collectionName) {
          // Fetch collections to provide as options
          const collections = await this.fetchCollectionOptions(userId);
          
          return {
            valid: false,
            error: 'Collection name is required for collection statistics',
            missingParam: 'collectionName',
            selectorData: {
              parameterName: 'collectionName',
              question: 'Which collection would you like to get statistics for?',
              options: collections,
              placeholder: 'Enter collection name',
              allowCustom: true,
              integration: 'mongodb',
              pendingAction: 'collection_stats',
              collectedParams: { action: 'collection_stats' },
            },
          };
        }
        break;

      case 'aggregate':
        if (!params.collectionName) {
          // Fetch collections to provide as options
          const collections = await this.fetchCollectionOptions(userId);
          
          return {
            valid: false,
            error: 'Collection name is required for aggregation',
            missingParam: 'collectionName',
            selectorData: {
              parameterName: 'collectionName',
              question: 'Which collection would you like to run aggregation on?',
              options: collections,
              placeholder: 'Enter collection name',
              allowCustom: true,
              integration: 'mongodb',
              pendingAction: 'aggregate',
              collectedParams: { action: 'aggregate' },
            },
          };
        }
        if (!params.pipeline) {
          // Provide aggregation pipeline suggestions
          const pipelineSuggestions = this.getAggregationPipelineSuggestions();
          
          return {
            valid: false,
            error: 'Aggregation pipeline is required',
            missingParam: 'pipeline',
            selectorData: {
              parameterName: 'pipeline',
              question: 'What aggregation pipeline would you like to run?',
              options: pipelineSuggestions,
              placeholder: 'Enter JSON array (e.g., [{"$match": {"status": "active"}}])',
              allowCustom: true,
              integration: 'mongodb',
              pendingAction: 'aggregate',
              collectedParams: { action: 'aggregate', collectionName: params.collectionName },
            },
          };
        }
        break;

      case 'distinct':
        if (!params.collectionName) {
          // Fetch collections to provide as options
          const collections = await this.fetchCollectionOptions(userId);
          
          return {
            valid: false,
            error: 'Collection name is required for distinct operation',
            missingParam: 'collectionName',
            selectorData: {
              parameterName: 'collectionName',
              question: 'Which collection would you like to get distinct values from?',
              options: collections,
              placeholder: 'Enter collection name',
              allowCustom: true,
              integration: 'mongodb',
              pendingAction: 'distinct',
              collectedParams: { action: 'distinct' },
            },
          };
        }
        break;

      case 'list_collections':
      case 'list_databases':
      case 'database_stats':
      case 'help':
        // These actions don't require additional parameters
        break;

      default:
        return {
          valid: false,
          error: `Unknown action: ${params.action}`,
        };
    }

    return { valid: true };
  }

  /**
   * Parse natural language input to extract action and parameters
   */
  private parseNaturalLanguage(input: string): MongoDBIntegrationInput {
    const lowerInput = input.toLowerCase();
    
    // Extract action - check for @mongodb:action format first
    let action = 'help';
    let collectionName: string | undefined;
    
    // Handle @mongodb:action format
    const mentionMatch = /@mongodb:(\w+)(?:\s+(.+))?/i.exec(input);
    if (mentionMatch) {
      const mentionedAction = mentionMatch[1].toLowerCase();
      const restOfMessage = mentionMatch[2]?.trim();
      
      // Map mentioned actions
      if (mentionedAction === 'list') {
        action = 'list_collections';
      } else if (mentionedAction === 'count') {
        action = 'count';
        // Extract collection name from the rest of the message
        if (restOfMessage) {
          collectionName = restOfMessage.split(/\s+/)[0]; // Get first word as collection name
        }
      } else if (mentionedAction === 'find') {
        action = 'find';
        if (restOfMessage) {
          collectionName = restOfMessage.split(/\s+/)[0];
        }
      } else if (mentionedAction === 'stats' || mentionedAction === 'database_stats') {
        action = 'database_stats';
      } else if (mentionedAction === 'help') {
        action = 'help';
      } else if (mentionedAction === 'aggregate') {
        action = 'aggregate';
        if (restOfMessage) {
          collectionName = restOfMessage.split(/\s+/)[0];
        }
      } else if (mentionedAction === 'distinct') {
        action = 'distinct';
        if (restOfMessage) {
          collectionName = restOfMessage.split(/\s+/)[0];
        }
      }
    }
    // Handle plain language without @mongodb: prefix
    else if (lowerInput === 'list' || lowerInput.includes('show collections') || lowerInput.includes('list collections')) {
      action = 'list_collections';
    }
    else if (lowerInput.includes('count')) {
      action = 'count';
      // Try to extract collection name
      const countMatch = /count\s+(?:documents\s+in\s+)?(?:collection\s+)?([a-zA-Z0-9_.-]+)/i.exec(input);
      if (countMatch && countMatch[1]) {
        collectionName = countMatch[1];
      }
    }
    else if (lowerInput.includes('database') && lowerInput.includes('stat')) {
      action = 'database_stats';
    }
    else if (lowerInput.includes('find') || lowerInput.includes('query')) {
      action = 'find';
      const findMatch = /find\s+(?:documents\s+in\s+)?(?:collection\s+)?([a-zA-Z0-9_.-]+)/i.exec(input);
      if (findMatch && findMatch[1]) {
        collectionName = findMatch[1];
      }
    }
    else if (lowerInput.includes('aggregate')) {
      action = 'aggregate';
      const aggMatch = /aggregate\s+(?:on\s+)?(?:collection\s+)?([a-zA-Z0-9_.-]+)/i.exec(input);
      if (aggMatch && aggMatch[1]) {
        collectionName = aggMatch[1];
      }
    }
    else if (lowerInput.includes('distinct')) {
      action = 'distinct';
      const distinctMatch = /distinct\s+(?:values?\s+)?(?:from\s+)?(?:collection\s+)?([a-zA-Z0-9_.-]+)/i.exec(input);
      if (distinctMatch && distinctMatch[1]) {
        collectionName = distinctMatch[1];
      }
    }

    const result: MongoDBIntegrationInput = { action };
    if (collectionName) {
      result.collectionName = collectionName;
    }
    
    return result;
  }
}
