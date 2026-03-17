import { Injectable } from '@nestjs/common';
import { BedrockService } from '../../bedrock/bedrock.service';
import { LoggerService } from '../../../common/logger/logger.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MongoDBConnectionDocument } from '../../../schemas/integration/mongodb-connection.schema';
import { McpIntegrationHandlerService } from './mcp-integration-handler.service';
import { IntegrationFormatterService } from './integration-formatter.service';
import {
  IntegrationChatService,
  IntegrationCommand,
  ParsedMention,
} from './integration-chat.service';

export interface MongoDBChatContext {
  conversationId?: string;
  connectionId?: string;
  userId: string;
  activeDatabase?: string;
  activeCollection?: string;
  /** List of collection names (e.g. from list collections) for suggestion context */
  collections?: string[];
  recentQueries?: Array<{
    query: any;
    collection: string;
    timestamp: Date;
  }>;
}

export interface MongoDBCommand {
  action:
    | 'find'
    | 'aggregate'
    | 'count'
    | 'distinct'
    | 'listCollections'
    | 'listIndexes'
    | 'collectionStats'
    | 'analyzeSchema'
    | 'explainQuery'
    | 'suggestIndexes'
    | 'estimateQueryCost'
    | 'validateQuery'
    | 'sampleDocuments'
    | 'getDatabaseStats'
    | 'connect'
    | 'help';
  parameters?: Record<string, any>;
  collection?: string;
}

export interface MongoDBChatResponse {
  message: string;
  data?: any;
  suggestions?: MongoDBSuggestion[];
  requiresAction?: boolean;
  action?: MongoDBCommand;
  resultType?: 'documents' | 'schema' | 'stats' | 'explain' | 'json';
  formattedResult?: {
    type:
      | 'table'
      | 'json'
      | 'schema'
      | 'stats'
      | 'chart'
      | 'error'
      | 'empty'
      | 'text'
      | 'explain';
    data: any;
  };
  mongodbSelectedViewType?:
    | 'table'
    | 'json'
    | 'schema'
    | 'stats'
    | 'chart'
    | 'text'
    | 'error'
    | 'empty'
    | 'explain';
  mongodbResultData?: any;
}

export interface MongoDBSuggestion {
  category:
    | 'exploration'
    | 'analysis'
    | 'optimization'
    | 'schema'
    | 'personalization'
    | 'connection';
  label: string;
  command: string;
  description: string;
  icon?: string;
  requiresCollection?: boolean;
}

let mongoDBChatAgentServiceInstance: MongoDBChatAgentService | null = null;

export function getMongoDBChatAgentService(): MongoDBChatAgentService {
  if (!mongoDBChatAgentServiceInstance) {
    throw new Error(
      'MongoDBChatAgentService not initialized. Ensure ChatModule is imported.',
    );
  }
  return mongoDBChatAgentServiceInstance;
}

@Injectable()
export class MongoDBChatAgentService {
  constructor(
    private readonly bedrockService: BedrockService,
    private readonly logger: LoggerService,
    @InjectModel('MongoDBConnection')
    private readonly mongodbConnectionModel: Model<MongoDBConnectionDocument>,
    private readonly mcpIntegrationHandler: McpIntegrationHandlerService,
    private readonly integrationChatService: IntegrationChatService,
    private readonly integrationFormatter: IntegrationFormatterService,
  ) {
    mongoDBChatAgentServiceInstance = this;
  }

  /**
   * Process user message and execute MongoDB operations
   */
  async processMessage(
    userId: string,
    connectionId: string,
    message: string,
    context?: MongoDBChatContext,
  ): Promise<MongoDBChatResponse> {
    try {
      this.logger.log('Processing MongoDB chat message', {
        userId,
        connectionId,
        messageLength: message.length,
        hasContext: !!context,
      });

      // Check if connection exists and is active
      const connection = await this.mongodbConnectionModel.findOne({
        _id: connectionId,
        userId,
        isActive: true,
      });

      if (!connection) {
        return {
          message:
            "I couldn't find that MongoDB connection. Please connect your MongoDB database first.",
          suggestions: [
            {
              category: 'exploration',
              label: 'Connect MongoDB',
              command: '@mongodb connect',
              description: 'Set up MongoDB connection',
              icon: '🔌',
            },
          ],
        };
      }

      // Parse intent from message
      const command = await this.parseNaturalLanguageQuery(message, context);

      if (!command) {
        return {
          message:
            "I'm not sure what you'd like to do with your MongoDB database. Try commands like:\n- Show collections\n- Find documents in [collection]\n- Analyze schema\n- Get database stats",
          suggestions: await this.generateSuggestions(
            userId,
            connectionId,
            context,
          ),
        };
      }

      // Execute the command via MCP integration
      const formattedResult = await this.executeMCPCommand(
        userId,
        connectionId,
        command,
      );

      return {
        message: this.generateResponseMessage(command, formattedResult),
        data: formattedResult.data,
        suggestions: await this.generateContextualSuggestions(
          command,
          formattedResult.data,
          context,
        ),
        resultType: this.detectResultType(formattedResult.data),
        formattedResult: formattedResult,
        mongodbSelectedViewType: this.getViewType(command.action),
        mongodbResultData: formattedResult.data,
      };
    } catch (error) {
      this.logger.error('MongoDB chat agent error', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        connectionId,
      });

      return {
        message: `Error: ${error instanceof Error ? error.message : 'An error occurred'}`,
        suggestions: await this.generateSuggestions(
          userId,
          connectionId,
          context,
        ),
      };
    }
  }

  /**
   * Parse natural language query into MongoDB command
   */
  private async parseNaturalLanguageQuery(
    message: string,
    context?: MongoDBChatContext,
  ): Promise<MongoDBCommand | null> {
    const lowerMessage = message.toLowerCase();

    // Connection intent
    if (
      lowerMessage.includes('connect mongo') ||
      lowerMessage.includes('link mongo') ||
      lowerMessage.includes('setup mongo')
    ) {
      return { action: 'connect' };
    }

    // Help intent
    if (
      lowerMessage.includes('help') ||
      lowerMessage.includes('what can you do')
    ) {
      return { action: 'help' };
    }

    // List collections intent
    if (
      (lowerMessage.includes('list') || lowerMessage.includes('show')) &&
      lowerMessage.includes('collection')
    ) {
      return { action: 'listCollections' };
    }

    // Database stats intent
    if (
      (lowerMessage.includes('database') || lowerMessage.includes('db')) &&
      (lowerMessage.includes('stat') ||
        lowerMessage.includes('info') ||
        lowerMessage.includes('summary'))
    ) {
      return { action: 'getDatabaseStats' };
    }

    // For complex queries, use AI to parse
    try {
      const aiParsedCommand = await this.parseWithAI(message, context);
      if (aiParsedCommand) {
        return aiParsedCommand;
      }
    } catch (error) {
      this.logger.warn('AI parsing failed, using fallback', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Fallback pattern matching
    return this.parseWithPatterns(message, context);
  }

  /**
   * Parse query using AI (Bedrock)
   */
  private async parseWithAI(
    message: string,
    context?: MongoDBChatContext,
  ): Promise<MongoDBCommand | null> {
    const prompt = `You are a MongoDB query assistant. Parse the user's natural language query into a structured MongoDB command.

Context:
${context?.activeDatabase ? `- Current database: ${context.activeDatabase}` : ''}
${context?.activeCollection ? `- Current collection: ${context.activeCollection}` : ''}
${context?.recentQueries?.length ? `- Recent queries: ${JSON.stringify(context.recentQueries.slice(-3))}` : ''}

User query: "${message}"

Available actions: find, aggregate, count, distinct, listCollections, listIndexes, collectionStats, analyzeSchema, explainQuery, estimateQueryCost, validateQuery, sampleDocuments, getDatabaseStats

Respond with ONLY a JSON object in this format:
{
  "action": "find|aggregate|count|...",
  "collection": "collection_name (if applicable)",
  "parameters": {
    "query": {...},
    "limit": number,
    "sort": {...},
    etc.
  }
}

If the query is unclear, respond with: {"action": null}`;

    const response = await BedrockService.invokeModelDirectly(
      'anthropic.claude-sonnet-4-5-20250929-v1:0', // Use active model instead of nova-lite
      {
        prompt,
        max_tokens: 1000,
        temperature: 0.1,
      },
    );

    const content = (response as any)?.response || '';

    try {
      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.action && parsed.action !== null) {
          return parsed as MongoDBCommand;
        }
      }
    } catch (error) {
      this.logger.warn('Failed to parse AI response', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return null;
  }

  /**
   * Parse query using pattern matching (fallback)
   */
  private parseWithPatterns(
    message: string,
    context?: MongoDBChatContext,
  ): MongoDBCommand | null {
    const lowerMessage = message.toLowerCase();

    // Find queries
    if (
      lowerMessage.includes('find') ||
      lowerMessage.includes('search') ||
      lowerMessage.includes('get')
    ) {
      return {
        action: 'find',
        collection: context?.activeCollection,
        parameters: { limit: 10 },
      };
    }

    // Count queries
    if (lowerMessage.includes('count') || lowerMessage.includes('how many')) {
      return {
        action: 'count',
        collection: context?.activeCollection,
      };
    }

    // Schema analysis
    if (lowerMessage.includes('schema') || lowerMessage.includes('structure')) {
      return {
        action: 'analyzeSchema',
        collection: context?.activeCollection,
      };
    }

    // Stats queries
    if (lowerMessage.includes('stats') || lowerMessage.includes('statistics')) {
      return {
        action: 'collectionStats',
        collection: context?.activeCollection,
      };
    }

    return null;
  }

  /**
   * Execute MongoDB command via MCP integration
   */
  private async executeMCPCommand(
    userId: string,
    connectionId: string,
    command: MongoDBCommand,
  ): Promise<any> {
    this.logger.log('Executing MongoDB command via MCP', {
      userId,
      connectionId,
      action: command.action,
      collection: command.collection,
      hasParameters: !!command.parameters,
    });

    try {
      // Create MCP-compatible command structure
      const mcpCommand: IntegrationCommand = {
        mention: {
          integration: 'mongodb',
          entity: this.mapActionToEntity(command.action),
          subEntity: command.collection,
          originalMention: `@mongodb ${command.action}`,
        } as ParsedMention,
        type: this.mapActionToType(command.action),
        entity: command.collection || 'documents',
        params: {
          ...command.parameters,
          action: command.action,
          collection: command.collection,
        },
      };

      // Execute via MCP integration handler
      const result =
        await this.mcpIntegrationHandler.handleIntegrationOperation({
          userId,
          command: mcpCommand,
          context: {
            connectionId,
            mongodbContext: {
              connectionId,
              activeDatabase: 'default', // Would be retrieved from connection
              activeCollection: command.collection,
            },
          },
        });

      if (!result.success) {
        throw new Error(
          result.result.message || 'MCP command execution failed',
        );
      }

      // Format the MCP result using IntegrationFormatterService
      return await this.integrationFormatter.formatMongoDBResult({
        metadata: {
          operation: `mongodb_${command.action}`,
          collection: command.collection,
          connectionId,
        },
        data: result.result,
      });
    } catch (error) {
      this.logger.error('MCP command execution failed', {
        error: error instanceof Error ? error.message : String(error),
        action: command.action,
        collection: command.collection,
      });

      // Re-throw the error since MCP execution failed
      throw error;
    }
  }

  /**
   * Map MongoDB action to MCP entity type
   */
  private mapActionToEntity(action: string): string {
    switch (action) {
      case 'listCollections':
        return 'collections';
      case 'find':
      case 'count':
      case 'distinct':
        return 'documents';
      case 'analyzeSchema':
        return 'schema';
      case 'collectionStats':
        return 'stats';
      case 'getDatabaseStats':
        return 'database';
      default:
        return 'query';
    }
  }

  /**
   * Map MongoDB action to MCP command type
   */
  private mapActionToType(action: string): 'list' | 'get' | 'query' {
    switch (action) {
      case 'listCollections':
        return 'list';
      case 'find':
      case 'count':
      case 'distinct':
      case 'analyzeSchema':
      case 'collectionStats':
      case 'getDatabaseStats':
        return 'get';
      default:
        return 'query';
    }
  }

  /**
   * Parse MCP result into expected format
   */
  private parseMCPResult(result: any, action: string): any {
    // Parse the MCP result into the expected MongoDB response format
    if (!result.data && !result.message) {
      return { message: 'Command executed successfully' };
    }

    // Try to parse structured data from the result
    let data = result.data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        // Keep as string if not valid JSON
      }
    }

    // Transform based on action type
    switch (action) {
      case 'listCollections':
        return {
          collections: data?.collections || [],
          count: data?.count || data?.collections?.length || 0,
        };

      case 'find':
        return {
          documents: data?.documents || data || [],
          count: data?.count || data?.documents?.length || 0,
          totalCount: data?.totalCount,
        };

      case 'count':
        return {
          count: data?.count || data || 0,
        };

      case 'getDatabaseStats':
        return {
          db: data?.db || data?.database || 'unknown',
          collections: data?.collections || 0,
          indexes: data?.indexes || 0,
          dataSize: data?.dataSize || 0,
          storageSize: data?.storageSize || 0,
        };

      default:
        return data || { message: result.message || 'Command executed' };
    }
  }

  /**
   * Generate response message
   */
  private generateResponseMessage(
    command: MongoDBCommand,
    result: any,
  ): string {
    switch (command.action) {
      case 'listCollections':
        return `Found ${result.count || 0} collections in the database.`;

      case 'find':
        return `Found ${result.count || 0} documents${result.totalCount ? ` (showing ${result.count} of ${result.totalCount})` : ''}.`;

      case 'count':
        return `The collection contains ${result.count || 0} documents.`;

      case 'getDatabaseStats':
        return `Database "${result.db}" has ${result.collections || 0} collections and ${result.indexes || 0} indexes.`;

      default:
        return `Executed ${command.action} command successfully.`;
    }
  }

  /**
   * Detect result type for proper display
   */
  private detectResultType(
    result: any,
  ): 'documents' | 'schema' | 'stats' | 'explain' | 'json' {
    if (result.documents || result.collection) {
      return 'documents';
    }
    if (result.schema || result.fields) {
      return 'schema';
    }
    if (result.count !== undefined || result.stats || result.metrics) {
      return 'stats';
    }
    if (result.explain) {
      return 'explain';
    }
    return 'json';
  }

  /**
   * Get appropriate view type for the action
   */
  private getViewType(action: string): 'table' | 'json' | 'schema' {
    switch (action) {
      case 'find':
      case 'listCollections':
        return 'table';
      case 'analyzeSchema':
        return 'schema';
      default:
        return 'json';
    }
  }

  /**
   * Generate contextual suggestions based on command and result
   */
  private async generateContextualSuggestions(
    command: MongoDBCommand,
    result: any,
    context?: MongoDBChatContext,
  ): Promise<MongoDBSuggestion[]> {
    const suggestions: MongoDBSuggestion[] = [];

    // Helper: Find neighboring collections for navigation suggestions
    function getOtherCollections(
      currentCollection: string | undefined,
      contextCollections: string[] | undefined,
    ) {
      if (!contextCollections || !currentCollection) return [];
      return contextCollections
        .filter((col) => col !== currentCollection)
        .slice(0, 2);
    }

    switch (command.action) {
      case 'listCollections': {
        // Prefer context.collections, fall back to result.collections
        const collections =
          (context?.collections?.length
            ? context.collections
            : result.collections) || [];

        if (collections.length > 0) {
          suggestions.push({
            category: 'exploration',
            label: `Explore "${collections[0]}"`,
            command: `@mongodb find documents in ${collections[0]}`,
            description: `Look at documents in ${collections[0]}`,
            icon: '🔍',
            requiresCollection: true,
          });

          // Suggest switching/exploring another collection in context if available
          if (collections.length > 1) {
            suggestions.push({
              category: 'exploration',
              label: `Explore "${collections[1]}"`,
              command: `@mongodb find documents in ${collections[1]}`,
              description: `Look at documents in ${collections[1]}`,
              icon: '🔍',
              requiresCollection: true,
            });
          }
        }
        break;
      }

      case 'find': {
        // If context contains recognized fields, suggest filtering or sorting
        if (command.collection) {
          suggestions.push({
            category: 'analysis',
            label: 'Analyze Schema',
            command: `@mongodb analyze schema of ${command.collection}`,
            description: 'Understand the data structure',
            icon: '📊',
          });
          suggestions.push({
            category: 'analysis',
            label: 'Get Statistics',
            command: `@mongodb get stats for ${command.collection}`,
            description: 'View collection statistics',
            icon: '📈',
          });

          // Suggest exploring another collection (if present in context)
          if (context?.collections?.length && context.collections.length > 1) {
            const altCollections = getOtherCollections(
              command.collection,
              context.collections,
            );
            altCollections.forEach((col) => {
              suggestions.push({
                category: 'exploration',
                label: `Explore "${col}"`,
                command: `@mongodb find documents in ${col}`,
                description: `Look at documents in ${col}`,
                icon: '🔍',
                requiresCollection: true,
              });
            });
          }
        }
        break;
      }

      case 'getDatabaseStats':
        suggestions.push({
          category: 'exploration',
          label: 'List Collections',
          command: '@mongodb list collections',
          description: 'See all collections in the database',
          icon: '📋',
        });

        // Suggest inspecting a collection if one is set in context
        if (context?.collections?.length) {
          suggestions.push({
            category: 'exploration',
            label: `Explore "${context.collections[0]}"`,
            command: `@mongodb find documents in ${context.collections[0]}`,
            description: `Look at documents in ${context.collections[0]}`,
            icon: '🔍',
            requiresCollection: true,
          });
        }
        break;
    }

    return suggestions;
  }

  /**
   * Generate general suggestions using all provided parameters
   */
  public generateSuggestions(
    userId: string,
    connectionId: string,
    context?: MongoDBChatContext,
  ): MongoDBSuggestion[] {
    const suggestions: MongoDBSuggestion[] = [];

    // Personalized greeting or tip based on user (example usage of userId)
    if (userId) {
      suggestions.push({
        category: 'personalization',
        label: `Hi User ${userId}, see your collections`,
        command: '@mongodb list collections',
        description: 'View all collections tailored for you',
        icon: '👤',
      });
    } else {
      suggestions.push({
        category: 'exploration',
        label: 'List Collections',
        command: '@mongodb list collections',
        description: 'See all collections in your database',
        icon: '📋',
      });
    }

    // Suggestion based on connectionId (could provide connection-specific context)
    if (connectionId) {
      suggestions.push({
        category: 'connection',
        label: `Connection ${connectionId} Stats`,
        command: '@mongodb get database stats',
        description: `Database stats for connection ${connectionId}`,
        icon: '📊',
      });
    } else {
      suggestions.push({
        category: 'exploration',
        label: 'Database Stats',
        command: '@mongodb get database stats',
        description: 'Get overview of your database',
        icon: '📊',
      });
    }

    // Use context if available to provide collection-specific suggestions
    if (context?.collections?.length) {
      suggestions.push({
        category: 'exploration',
        label: `Explore "${context.collections[0]}"`,
        command: `@mongodb find documents in ${context.collections[0]}`,
        description: `Look at documents in ${context.collections[0]}`,
        icon: '🔍',
        requiresCollection: true,
      });

      // Optionally suggest schema analysis on specific collection
      suggestions.push({
        category: 'analysis',
        label: `Analyze Schema for "${context.collections[0]}"`,
        command: `@mongodb analyze schema ${context.collections[0]}`,
        description: `Understand the schema of ${context.collections[0]}`,
        icon: '🧬',
      });

      // Suggest exploring additional collections if more exist
      if (context.collections.length > 1) {
        for (let i = 1; i < context.collections.length; i++) {
          suggestions.push({
            category: 'exploration',
            label: `Explore "${context.collections[i]}"`,
            command: `@mongodb find documents in ${context.collections[i]}`,
            description: `Look at documents in ${context.collections[i]}`,
            icon: '🔎',
            requiresCollection: true,
          });
        }
      }
    } else {
      // Fallback generic schema analysis
      suggestions.push({
        category: 'analysis',
        label: 'Analyze Schema',
        command: '@mongodb analyze schema',
        description: 'Understand your data structure',
        icon: '🔍',
      });
    }

    return suggestions;
  }
}
