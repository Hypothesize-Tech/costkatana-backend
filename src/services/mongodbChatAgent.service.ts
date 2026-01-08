import { MongoDBMCPService, MCPToolResult } from './mongodbMcp.service';
import { MongoDBConnection } from '../models/MongoDBConnection';
import { loggingService } from './logging.service';
import { ChatBedrockConverse } from '@langchain/aws';
import { contextFileManager } from './contextFileManager.service';
import { FileReference } from '../types/contextFile.types';
import crypto from 'crypto';

/**
 * MongoDB Chat Agent Service
 * 
 * Specialized agent for natural language MongoDB interactions
 * Integrates with MongoDB MCP server for secure database access
 */

export interface MongoDBChatContext {
    conversationId?: string;
    connectionId?: string;
    userId: string;
    activeDatabase?: string;
    activeCollection?: string;
    recentQueries?: Array<{
        query: any;
        collection: string;
        timestamp: Date;
    }>;
}

export interface MongoDBCommand {
    action: 'find' | 'aggregate' | 'count' | 'distinct' | 'listCollections' | 
            'listIndexes' | 'collectionStats' | 'analyzeSchema' | 'explainQuery' |
            'suggestIndexes' | 'estimateQueryCost' | 'validateQuery' | 
            'sampleDocuments' | 'getDatabaseStats' | 'connect' | 'help';
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
        type: 'table' | 'json' | 'schema' | 'stats' | 'chart' | 'error' | 'empty' | 'text' | 'explain';
        data: any;
    };
}

export interface MongoDBSuggestion {
    category: 'exploration' | 'analysis' | 'optimization' | 'schema';
    label: string;
    command: string;
    description: string;
    icon?: string;
    requiresCollection?: boolean;
}

export class MongoDBChatAgentService {
    private static model: ChatBedrockConverse;

    /**
     * Initialize the AI model for query parsing
     */
    private static getModel(): ChatBedrockConverse {
        if (!this.model) {
            this.model = new ChatBedrockConverse({
                model: 'amazon.nova-micro-v1:0',
                region: process.env.AWS_BEDROCK_REGION ?? 'us-east-1',
                maxTokens: 2048,
                temperature: 0.3, // Lower temperature for more precise query generation
            });
        }
        return this.model;
    }

    /**
     * Process user message and execute MongoDB operations
     */
    static async processMessage(
        userId: string,
        connectionId: string,
        message: string,
        context?: MongoDBChatContext
    ): Promise<MongoDBChatResponse> {
        try {
            loggingService.info('Processing MongoDB chat message', {
                component: 'MongoDBChatAgentService',
                operation: 'processMessage',
                userId,
                connectionId,
                messageLength: message.length,
            });

            // Check if connection exists
            const connection = await MongoDBConnection.findOne({
                _id: connectionId,
                userId,
                isActive: true,
            });

            if (!connection) {
                return {
                    message: "I couldn't find that MongoDB connection. Please connect your MongoDB database first.",
                    suggestions: [{
                        category: 'exploration',
                        label: 'Connect MongoDB',
                        command: '@mongodb connect',
                        description: 'Set up MongoDB connection',
                        icon: '🔌',
                    }],
                };
            }

            // Parse intent from message
            const command = await this.parseNaturalLanguageQuery(message, context);

            if (!command) {
                return {
                    message: "I'm not sure what you'd like to do with your MongoDB database. Try commands like:\n- Show collections\n- Find documents in [collection]\n- Analyze schema\n- Get database stats",
                    suggestions: await this.generateSuggestions(userId, connectionId, context),
                };
            }

            // Execute the command
            const result = await this.executeMCPTool(userId, connectionId, command);

            // Format results for chat
            const formattedResult = await this.formatResults(result, command.action);

            // Check if response should be written to file
            let fileReference: FileReference | undefined;
            if (contextFileManager.isEnabled() && contextFileManager.shouldWriteToFile(result)) {
                try {
                    const requestId = crypto.randomBytes(16).toString('hex');
                    fileReference = await contextFileManager.writeResponse(result, {
                        userId,
                        requestId,
                        toolName: `mongodb_${command.action}`
                    });
                    
                    loggingService.info('Large MongoDB response written to file', {
                        userId,
                        action: command.action,
                        filePath: fileReference.path,
                        size: fileReference.size
                    });
                } catch (fileError) {
                    loggingService.warn('Failed to write response to file, returning inline', {
                        error: fileError instanceof Error ? fileError.message : String(fileError)
                    });
                }
            }

            // Generate follow-up suggestions
            const suggestions = await this.generateContextualSuggestions(command, result, context);

            return {
                message: fileReference 
                    ? `${this.generateResponseMessage(command, result)}\n\n📁 Large result stored in file for better performance. ${fileReference.summary}\n${fileReference.instructions}`
                    : this.generateResponseMessage(command, result),
                data: fileReference ? { fileReference } : result,
                suggestions,
                resultType: this.detectResultType(result),
                formattedResult: fileReference ? { fileReference } : formattedResult,
                fileReference,
            };
        } catch (error) {
            loggingService.error('MongoDB chat agent error', {
                component: 'MongoDBChatAgentService',
                operation: 'processMessage',
                error: error instanceof Error ? error.message : String(error),
            });

            return {
                message: `Error: ${error instanceof Error ? error.message : 'An error occurred'}`,
                suggestions: await this.generateSuggestions(userId, connectionId, context),
            };
        }
    }

    /**
     * Parse natural language query into MongoDB command
     */
    static async parseNaturalLanguageQuery(
        message: string,
        context?: MongoDBChatContext
    ): Promise<MongoDBCommand | null> {
        const lowerMessage = message.toLowerCase();

        // Connection intent
        if (lowerMessage.includes('connect mongo') || 
            lowerMessage.includes('link mongo') ||
            lowerMessage.includes('setup mongo')) {
            return { action: 'connect' };
        }

        // Help intent
        if (lowerMessage.includes('help') || lowerMessage.includes('what can you do')) {
            return { action: 'help' };
        }

        // List collections intent
        if ((lowerMessage.includes('list') || lowerMessage.includes('show')) && 
            lowerMessage.includes('collection')) {
            return { action: 'listCollections' };
        }

        // Database stats intent
        if ((lowerMessage.includes('database') || lowerMessage.includes('db')) && 
            (lowerMessage.includes('stat') || lowerMessage.includes('info') || lowerMessage.includes('summary'))) {
            return { action: 'getDatabaseStats' };
        }

        // For complex queries, use AI to parse
        try {
            const aiParsedCommand = await this.parseWithAI(message, context);
            if (aiParsedCommand) {
                return aiParsedCommand;
            }
        } catch (error) {
            loggingService.warn('AI parsing failed, using fallback', {
                component: 'MongoDBChatAgentService',
                operation: 'parseNaturalLanguageQuery',
                error: error instanceof Error ? error.message : String(error),
            });
        }

        // Fallback pattern matching
        return this.parseWithPatterns(message, context);
    }

    /**
     * Parse query using AI (Bedrock)
     */
    private static async parseWithAI(
        message: string,
        context?: MongoDBChatContext
    ): Promise<MongoDBCommand | null> {
        const model = this.getModel();

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

        const response = await model.invoke([{ role: 'user', content: prompt }]);
        const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

        try {
            // Extract JSON from response
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed.action) {
                    return parsed as MongoDBCommand;
                }
            }
        } catch (error) {
            loggingService.warn('Failed to parse AI response', {
                component: 'MongoDBChatAgentService',
                operation: 'parseWithAI',
                error: error instanceof Error ? error.message : String(error),
            });
        }

        return null;
    }

    /**
     * Parse query using pattern matching (fallback)
     */
    private static parseWithPatterns(
        message: string,
        context?: MongoDBChatContext
    ): MongoDBCommand | null {
        const lowerMessage = message.toLowerCase();

        // Find documents
        const findMatch = message.match(/find|show|get|list|select/i);
        const collectionMatch = message.match(/in\s+([a-zA-Z0-9_]+)|from\s+([a-zA-Z0-9_]+)|([a-zA-Z0-9_]+)\s+collection/i);
        
        if (findMatch) {
            const collection = collectionMatch?.[1] || collectionMatch?.[2] || collectionMatch?.[3] || context?.activeCollection;
            if (collection) {
                const limitMatch = message.match(/limit\s+(\d+)/i);
                return {
                    action: 'find',
                    collection,
                    parameters: {
                        query: {},
                        limit: limitMatch ? parseInt(limitMatch[1]) : 10,
                    },
                };
            }
        }

        // Count documents
        if (lowerMessage.includes('count') || lowerMessage.includes('how many')) {
            const collection = collectionMatch?.[1] || collectionMatch?.[2] || collectionMatch?.[3] || context?.activeCollection;
            if (collection) {
                return {
                    action: 'count',
                    collection,
                    parameters: { query: {} },
                };
            }
        }

        // Analyze schema
        if (lowerMessage.includes('schema') || lowerMessage.includes('structure')) {
            const collection = collectionMatch?.[1] || collectionMatch?.[2] || collectionMatch?.[3] || context?.activeCollection;
            if (collection) {
                return {
                    action: 'analyzeSchema',
                    collection,
                    parameters: { sampleSize: 100 },
                };
            }
        }

        // List indexes
        if (lowerMessage.includes('index') || lowerMessage.includes('indices')) {
            const collection = collectionMatch?.[1] || collectionMatch?.[2] || collectionMatch?.[3] || context?.activeCollection;
            if (collection) {
                return {
                    action: 'listIndexes',
                    collection,
                };
            }
        }

        // Collection stats
        if (lowerMessage.includes('stats') || lowerMessage.includes('statistics')) {
            const collection = collectionMatch?.[1] || collectionMatch?.[2] || collectionMatch?.[3] || context?.activeCollection;
            if (collection) {
                return {
                    action: 'collectionStats',
                    collection,
                };
            }
        }

        // Sample documents
        if (lowerMessage.includes('sample') || lowerMessage.includes('example')) {
            const collection = collectionMatch?.[1] || collectionMatch?.[2] || collectionMatch?.[3] || context?.activeCollection;
            if (collection) {
                const sizeMatch = message.match(/(\d+)\s+(?:sample|example)/i);
                return {
                    action: 'sampleDocuments',
                    collection,
                    parameters: { size: sizeMatch ? parseInt(sizeMatch[1]) : 10 },
                };
            }
        }

        return null;
    }

    /**
     * Execute MCP tool
     */
    private static async executeMCPTool(
        userId: string,
        connectionId: string,
        command: MongoDBCommand
    ): Promise<MCPToolResult> {
        const mcpService = new MongoDBMCPService({
            userId,
            connectionId,
            transport: 'http',
        });

        // Build tool arguments
        const toolArgs: any = {
            ...(command.collection ? { collection: command.collection } : {}),
            ...command.parameters,
        };

        // Call the appropriate tool
        const result = await (mcpService as any).handleToolCall(command.action, toolArgs);

        return result;
    }

    /**
     * Format results for chat display
     */
    private static async formatResults(
        result: MCPToolResult,
        action: string
    ): Promise<{ type: 'table' | 'json' | 'schema' | 'stats' | 'chart' | 'error' | 'empty' | 'text' | 'explain'; data: any }> {
        if (result.isError) {
            return { type: 'error', data: result.content[0]?.text };
        }

        const content = result.content[0]?.text;
        if (!content) {
            return { type: 'empty', data: null };
        }

        try {
            const parsed = JSON.parse(content);

            // Determine format based on action and data
            if (action === 'find' || action === 'sampleDocuments') {
                return { type: 'table', data: parsed };
            } else if (action === 'aggregate') {
                // For aggregation, return as table if results exist, otherwise json
                if (parsed.results && Array.isArray(parsed.results)) {
                    return { type: 'table', data: parsed.results };
                }
                return { type: 'json', data: parsed };
            } else if (action === 'analyzeSchema') {
                return { type: 'schema', data: parsed };
            } else if (action === 'collectionStats' || action === 'getDatabaseStats') {
                return { type: 'stats', data: parsed };
            } else if (action === 'explainQuery') {
                return { type: 'explain', data: parsed };
            } else {
                return { type: 'json', data: parsed };
            }
        } catch (error) {
            return { type: 'text', data: content };
        }
    }

    /**
     * Generate response message
     */
    private static generateResponseMessage(command: MongoDBCommand, result: MCPToolResult): string {
        if (result.isError) {
            return `Error executing ${command.action}: ${result.content[0]?.text}`;
        }

        const content = result.content[0]?.text;
        if (!content) {
            return 'No results found.';
        }

        try {
            const parsed = JSON.parse(content);

            switch (command.action) {
                case 'listCollections':
                    return `Found ${parsed.count} collections in your database.`;
                case 'find':
                    return `Found ${parsed.count} documents${command.collection ? ` in ${command.collection}` : ''}.`;
                case 'count':
                    return `Count: ${parsed.count} documents${command.collection ? ` in ${command.collection}` : ''}.`;
                case 'aggregate':
                    // For aggregation, include the results
                    const resultCount = parsed.results?.length || parsed.count || 0;
                    const resultSummary = resultCount > 0 
                        ? `\n\n**Results (${resultCount} documents):**\n\`\`\`json\n${JSON.stringify(parsed.results || parsed.data || [], null, 2)}\n\`\`\``
                        : '\n\nNo results returned from aggregation pipeline.';
                    return `Aggregation pipeline executed successfully on ${command.collection}.${resultSummary}`;
                case 'analyzeSchema':
                    return `Schema analysis complete for ${command.collection}. Found ${Object.keys(parsed.schema || {}).length} fields.`;
                case 'collectionStats':
                    return `Collection stats for ${command.collection}: ${parsed.stats?.count || 0} documents.`;
                case 'getDatabaseStats':
                    return `Database stats: ${parsed.stats?.collections || 0} collections, ${parsed.stats?.dataSize ? Math.round(parsed.stats.dataSize / 1024 / 1024) : 0}MB data.`;
                default:
                    return 'Query executed successfully.';
            }
        } catch (error) {
            return 'Query executed successfully.';
        }
    }

    /**
     * Detect result type
     */
    private static detectResultType(result: MCPToolResult): 'documents' | 'schema' | 'stats' | 'explain' | 'json' {
        const content = result.content[0]?.text;
        if (!content) return 'json';

        try {
            const parsed = JSON.parse(content);
            if (parsed.documents || parsed.results) return 'documents';
            if (parsed.schema) return 'schema';
            if (parsed.stats) return 'stats';
            if (parsed.explanation || parsed.queryPlanner) return 'explain';
        } catch (error) {
            // Ignore
        }

        return 'json';
    }

    /**
     * Generate initial suggestions
     */
    static async generateSuggestions(
        userId: string,
        connectionId: string,
        context?: MongoDBChatContext
    ): Promise<MongoDBSuggestion[]> {
        const suggestions: MongoDBSuggestion[] = [
            {
                category: 'exploration',
                label: 'Show Collections',
                command: `@mongodb list all collections for user ${userId} on connection ${connectionId}`,
                description: `See all collections in the database for user ${userId} on this connection`,
                icon: '📋',
            },
            {
                category: 'exploration',
                label: 'Database Stats',
                command: `@mongodb show database stats for user ${userId} on connection ${connectionId}`,
                description: `Get database size and info for user ${userId} on this connection`,
                icon: '📊',
            },
        ];

        // If we have an active collection, add collection-specific suggestions
        if (context?.activeCollection) {
            suggestions.push(
                {
                    category: 'analysis',
                    label: `Analyze ${context.activeCollection} Schema`,
                    command: `@mongodb analyze schema of ${context.activeCollection} for user ${userId} on connection ${connectionId}`,
                    description: `Understand data structure of ${context.activeCollection} for user ${userId} on this connection`,
                    icon: '🔍',
                    requiresCollection: true,
                },
                {
                    category: 'exploration',
                    label: `Sample ${context.activeCollection} Documents`,
                    command: `@mongodb show 10 samples from ${context.activeCollection} for user ${userId} on connection ${connectionId}`,
                    description: `Preview sample data from ${context.activeCollection} for user ${userId} on this connection`,
                    icon: '📄',
                    requiresCollection: true,
                }
            );
        }

        return suggestions;
    }

    /**
     * Generate contextual suggestions based on previous command
     */
    private static async generateContextualSuggestions(
        command: MongoDBCommand,
        result: MCPToolResult,
        context?: MongoDBChatContext
    ): Promise<MongoDBSuggestion[]> {
        const suggestions: MongoDBSuggestion[] = [];

        switch (command.action) {
            case 'listCollections':
                // After listing collections, suggest analyzing specific ones
                try {
                    const parsed = JSON.parse(result.content[0]?.text || '{}');
                    const collections = parsed.collections || [];
                    if (collections.length > 0) {
                        suggestions.push(
                            {
                                category: 'analysis',
                                label: `Analyze ${collections[0]} Schema`,
                                command: `@mongodb analyze schema of ${collections[0]}`,
                                description: 'Understand data structure',
                                icon: '🔍',
                            },
                            {
                                category: 'exploration',
                                label: `Sample ${collections[0]} Data`,
                                command: `@mongodb show 10 samples from ${collections[0]}`,
                                description: 'Preview data',
                                icon: '📄',
                            }
                        );
                    }
                } catch (error) {
                    // Ignore
                }
                break;

            case 'find':
            case 'sampleDocuments':
                if (command.collection) {
                    suggestions.push(
                        {
                            category: 'analysis',
                            label: 'Count Total',
                            command: `@mongodb count documents in ${command.collection}`,
                            description: 'Get total document count',
                            icon: '🔢',
                        },
                        {
                            category: 'analysis',
                            label: 'Collection Stats',
                            command: `@mongodb show stats for ${command.collection}`,
                            description: 'Get collection metrics',
                            icon: '📊',
                        },
                        {
                            category: 'schema',
                            label: 'Analyze Schema',
                            command: `@mongodb analyze schema of ${command.collection}`,
                            description: 'View data structure',
                            icon: '🔍',
                        }
                    );
                }
                break;

            case 'analyzeSchema':
                if (command.collection) {
                    suggestions.push(
                        {
                            category: 'optimization',
                            label: 'Show Indexes',
                            command: `@mongodb list indexes for ${command.collection}`,
                            description: 'View existing indexes',
                            icon: '🎯',
                        },
                        {
                            category: 'exploration',
                            label: 'Sample Data',
                            command: `@mongodb show 10 samples from ${command.collection}`,
                            description: 'View example documents',
                            icon: '📄',
                        }
                    );
                }
                break;

            case 'collectionStats':
                if (command.collection) {
                    suggestions.push(
                        {
                            category: 'optimization',
                            label: 'Suggest Indexes',
                            command: `@mongodb suggest indexes for ${command.collection}`,
                            description: 'Get optimization tips',
                            icon: '💡',
                        },
                        {
                            category: 'analysis',
                            label: 'Sample Documents',
                            command: `@mongodb show 10 samples from ${command.collection}`,
                            description: 'Preview data',
                            icon: '📄',
                        }
                    );
                }
                break;

            default:
                // Return generic suggestions
                return this.generateSuggestions(context?.userId || '', context?.connectionId || '', context);
        }

        return suggestions;
    }

    /**
     * Parse MongoDB mention from message
     */
    static parseMongoDBMention(message: string): { hasMention: boolean; cleanMessage: string } {
        const mentionPattern = /@mongodb\s*/i;
        const hasMention = mentionPattern.test(message);
        const cleanMessage = message.replace(mentionPattern, '').trim();

        return { hasMention, cleanMessage };
    }
}
