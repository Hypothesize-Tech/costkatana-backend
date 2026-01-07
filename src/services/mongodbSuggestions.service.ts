import { MongoDBChatContext, MongoDBSuggestion } from './mongodbChatAgent.service';
import { MongoDBConnection } from '../models/MongoDBConnection';
import { loggingService } from './logging.service';
import { ChatBedrockConverse } from '@langchain/aws';

/**
 * MongoDB Suggestions Service
 * 
 * Generates intelligent command suggestions for MongoDB operations
 */

export class MongoDBSuggestionsService {
    private static model: ChatBedrockConverse;

    /**
     * Initialize AI model for suggestion generation
     */
    private static getModel(): ChatBedrockConverse {
        if (!this.model) {
            this.model = new ChatBedrockConverse({
                model: 'amazon.nova-micro-v1:0',
                region: process.env.AWS_BEDROCK_REGION ?? 'us-east-1',
                maxTokens: 1024,
                temperature: 0.7,
            });
        }
        return this.model;
    }

    /**
     * Get static template suggestions (always available)
     */
    static getStaticSuggestions(): MongoDBSuggestion[] {
        return [
            {
                category: 'exploration',
                label: 'Show All Collections',
                command: '@mongodb list all collections',
                description: 'View all collections in your database',
                icon: '📋',
            },
            {
                category: 'exploration',
                label: 'Database Statistics',
                command: '@mongodb show database stats',
                description: 'Get database size, collection count, and storage info',
                icon: '📊',
            },
            {
                category: 'analysis',
                label: 'Help',
                command: '@mongodb help',
                description: 'See all available MongoDB commands',
                icon: '❓',
            },
        ];
    }

    /**
     * Get collection-aware suggestions after listing collections
     */
    static getCollectionAwareSuggestions(collections: string[]): MongoDBSuggestion[] {
        const suggestions: MongoDBSuggestion[] = [];

        // Add suggestions for first few collections
        const topCollections = collections.slice(0, 3);

        for (const collection of topCollections) {
            suggestions.push(
                {
                    category: 'exploration',
                    label: `Sample ${collection}`,
                    command: `@mongodb show 10 samples from ${collection}`,
                    description: `View sample documents from ${collection}`,
                    icon: '📄',
                    requiresCollection: true,
                },
                {
                    category: 'analysis',
                    label: `Analyze ${collection} Schema`,
                    command: `@mongodb analyze schema of ${collection}`,
                    description: `Understand the structure of ${collection}`,
                    icon: '🔍',
                    requiresCollection: true,
                },
                {
                    category: 'analysis',
                    label: `Count ${collection}`,
                    command: `@mongodb count documents in ${collection}`,
                    description: `Get total document count for ${collection}`,
                    icon: '🔢',
                    requiresCollection: true,
                }
            );
        }

        return suggestions;
    }

    /**
     * Get contextual suggestions based on recent activity
     */
    static getContextualSuggestions(context: MongoDBChatContext): MongoDBSuggestion[] {
        const suggestions: MongoDBSuggestion[] = [];

        // If there's an active collection, suggest operations on it
        if (context.activeCollection) {
            suggestions.push(
                {
                    category: 'exploration',
                    label: 'Sample Documents',
                    command: `@mongodb show 10 samples from ${context.activeCollection}`,
                    description: `Preview data from ${context.activeCollection}`,
                    icon: '📄',
                    requiresCollection: true,
                },
                {
                    category: 'analysis',
                    label: 'Count Documents',
                    command: `@mongodb count documents in ${context.activeCollection}`,
                    description: `Get total count for ${context.activeCollection}`,
                    icon: '🔢',
                    requiresCollection: true,
                },
                {
                    category: 'analysis',
                    label: 'Analyze Schema',
                    command: `@mongodb analyze schema of ${context.activeCollection}`,
                    description: `View field types and structure for ${context.activeCollection}`,
                    icon: '🔍',
                    requiresCollection: true,
                },
                {
                    category: 'optimization',
                    label: 'Show Indexes',
                    command: `@mongodb list indexes for ${context.activeCollection}`,
                    description: `View indexes on ${context.activeCollection}`,
                    icon: '🎯',
                    requiresCollection: true,
                },
                {
                    category: 'optimization',
                    label: 'Collection Stats',
                    command: `@mongodb show stats for ${context.activeCollection}`,
                    description: `Get detailed statistics for ${context.activeCollection}`,
                    icon: '📊',
                    requiresCollection: true,
                }
            );
        }

        // If there are recent queries, suggest related operations
        if (context.recentQueries && context.recentQueries.length > 0) {
            const lastQuery = context.recentQueries[context.recentQueries.length - 1];
            if (lastQuery.collection) {
                suggestions.push({
                    category: 'optimization',
                    label: `Explain Last Query`,
                    command: `@mongodb explain query on ${lastQuery.collection}`,
                    description: 'Analyze query performance',
                    icon: '⚡',
                    requiresCollection: true,
                });
            }
        }

        return suggestions;
    }

    /**
     * Generate AI-powered suggestions based on results and context
     */
    static async getAIPoweredSuggestions(
        results: any,
        context: MongoDBChatContext,
        lastCommand: string
    ): Promise<MongoDBSuggestion[]> {
        try {
            const model = this.getModel();

            const prompt = `You are a MongoDB assistant. Based on the user's last query and results, suggest 3-5 logical next steps.

Last command: "${lastCommand}"

Context:
${context.activeDatabase ? `- Database: ${context.activeDatabase}` : ''}
${context.activeCollection ? `- Collection: ${context.activeCollection}` : ''}
${context.recentQueries?.length ? `- Recent queries: ${context.recentQueries.length}` : ''}

Results summary:
${JSON.stringify(results, null, 2).substring(0, 500)}

Suggest 3-5 natural next steps the user might want to take. Each suggestion should be:
- Practical and actionable
- Related to the current context
- A MongoDB operation command

Respond with ONLY a JSON array in this format:
[
  {
    "category": "exploration|analysis|optimization|schema",
    "label": "Short label",
    "command": "@mongodb <natural language command>",
    "description": "What this does",
    "icon": "emoji"
  }
]`;

            const response = await model.invoke([{ role: 'user', content: prompt }]);
            const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

            // Extract JSON array from response
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const suggestions = JSON.parse(jsonMatch[0]);
                if (Array.isArray(suggestions)) {
                    return suggestions.slice(0, 5); // Limit to 5 suggestions
                }
            }

            // Fallback to contextual suggestions
            return this.getContextualSuggestions(context);
        } catch (error) {
            loggingService.warn('AI suggestion generation failed, using fallback', {
                component: 'MongoDBSuggestionsService',
                operation: 'getAIPoweredSuggestions',
                error: error instanceof Error ? error.message : String(error),
            });

            // Fallback to contextual suggestions
            return this.getContextualSuggestions(context);
        }
    }

    /**
     * Get all suggestions for current state
     */
    static async getAllSuggestions(
        context?: MongoDBChatContext,
        lastResults?: any,
        lastCommand?: string
    ): Promise<MongoDBSuggestion[]> {
        const suggestions: MongoDBSuggestion[] = [];

        // Always include static suggestions
        suggestions.push(...this.getStaticSuggestions());

        // Add contextual suggestions if context is available
        if (context) {
            suggestions.push(...this.getContextualSuggestions(context));
        }

        // Add AI-powered suggestions if results are available
        if (lastResults && lastCommand && context) {
            try {
                const aiSuggestions = await this.getAIPoweredSuggestions(lastResults, context, lastCommand);
                suggestions.push(...aiSuggestions);
            } catch (error) {
                // AI suggestions are optional, continue without them
                loggingService.debug('Skipping AI suggestions', {
                    component: 'MongoDBSuggestionsService',
                    operation: 'getAllSuggestions',
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        // Deduplicate by command
        const uniqueSuggestions = Array.from(
            new Map(suggestions.map(s => [s.command, s])).values()
        );

        return uniqueSuggestions.slice(0, 10); // Return top 10 suggestions
    }

    /**
     * Filter suggestions based on user permissions and available collections
     */
    static async filterSuggestionsByPermissions(
        suggestions: MongoDBSuggestion[],
        userId: string,
        connectionId: string
    ): Promise<MongoDBSuggestion[]> {
        try {
            // Get user's MongoDB connection to check allowed collections
            const connection = await MongoDBConnection.findOne({
                _id: connectionId,
                userId,
                isActive: true,
            });

            if (!connection) {
                return suggestions.filter(s => !s.requiresCollection);
            }

            const allowedCollections = connection.metadata?.allowedCollections || [];

            // If no specific collections are allowed, return all suggestions
            if (allowedCollections.length === 0) {
                return suggestions;
            }

            // Filter suggestions to only include allowed collections
            return suggestions.filter(suggestion => {
                if (!suggestion.requiresCollection) {
                    return true; // Always include suggestions that don't require a specific collection
                }

                // Check if the suggestion's collection is in the allowed list
                const collectionMatch = suggestion.command.match(/(?:from|in|for|of)\s+([a-zA-Z0-9_]+)/);
                if (collectionMatch) {
                    const collection = collectionMatch[1];
                    return allowedCollections.includes(collection);
                }

                return true; // Include if we can't determine the collection
            });
        } catch (error) {
            loggingService.warn('Error filtering suggestions by permissions', {
                component: 'MongoDBSuggestionsService',
                operation: 'filterSuggestionsByPermissions',
                error: error instanceof Error ? error.message : String(error),
            });

            return suggestions; // Return all suggestions on error
        }
    }

    /**
     * Rank suggestions by relevance
     */
    static rankSuggestionsByRelevance(
        suggestions: MongoDBSuggestion[],
        context?: MongoDBChatContext
    ): MongoDBSuggestion[] {
        // Scoring logic
        return suggestions.sort((a, b) => {
            let scoreA = 0;
            let scoreB = 0;

            // Prioritize suggestions related to active collection
            if (context?.activeCollection) {
                if (a.command.includes(context.activeCollection)) scoreA += 10;
                if (b.command.includes(context.activeCollection)) scoreB += 10;
            }

            // Prioritize exploration early, optimization later
            const recentQueriesCount = context?.recentQueries?.length || 0;
            if (recentQueriesCount === 0) {
                if (a.category === 'exploration') scoreA += 5;
                if (b.category === 'exploration') scoreB += 5;
            } else {
                if (a.category === 'optimization') scoreA += 5;
                if (b.category === 'optimization') scoreB += 5;
            }

            return scoreB - scoreA;
        });
    }
}
