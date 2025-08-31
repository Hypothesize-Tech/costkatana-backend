import { loggingService } from './logging.service';
import { ChatBedrockConverse } from "@langchain/aws";
import { HumanMessage } from "@langchain/core/messages";
import { memoryService, MemoryContext, MemoryInsight } from './memory.service';
import { userPreferenceService } from './userPreference.service';

export interface MemoryAgentState {
    userId: string;
    conversationId: string;
    query: string;
    response?: string;
    memoryInsights?: MemoryInsight[];
    personalizedRecommendations?: string[];
    securityFlags?: string[];
    similarConversations?: any[];
    userPreferences?: any;
    shouldStoreMemory?: boolean;
    memoryOperations?: string[];
    metadata?: any;
}

/**
 * Memory Writer Agent - Responsible for storing and updating memory
 */
export class MemoryWriterAgent {
    private writerAgent: ChatBedrockConverse;

    constructor() {
        this.writerAgent = new ChatBedrockConverse({
            model: "amazon.nova-pro-v1:0",
            region: process.env.AWS_REGION || 'us-east-1',
            temperature: 0.1,
            maxTokens: 1000,
        });
    }

    /**
     * Process memory writing operations
     */
    async processMemoryWrite(state: MemoryAgentState): Promise<Partial<MemoryAgentState>> {
        try {
            loggingService.info(`📝 MemoryWriterAgent processing for user: ${state.userId}`);

            const operations: string[] = [];

            // Store conversation memory
            if (state.query && state.response) {
                await this.storeConversationMemory(state);
                operations.push('conversation_stored');
            }

            // Analyze and store user preferences
            if (state.query && state.response) {
                await this.analyzeAndStorePreferences(state);
                operations.push('preferences_analyzed');
            }

            // Store security insights if any flags were raised
            if (state.securityFlags && state.securityFlags.length > 0) {
                await this.storeSecurityInsights(state);
                operations.push('security_insights_stored');
            }

            // Generate learning insights
            await this.generateLearningInsights(state);
            operations.push('learning_insights_generated');

            loggingService.info(`✅ MemoryWriterAgent completed ${operations.length} operations`);

            return {
                memoryOperations: operations,
                metadata: {
                    ...state.metadata,
                    memoryWriteTimestamp: new Date(),
                    operationsCompleted: operations
                }
            };
        } catch (error) {
            loggingService.error('❌ MemoryWriterAgent failed:', { error: error instanceof Error ? error.message : String(error) });
            return {
                memoryOperations: ['error'],
                metadata: {
                    ...state.metadata,
                    memoryWriteError: error instanceof Error ? error.message : 'Unknown error'
                }
            };
        }
    }

    /**
     * Store conversation memory
     */
    private async storeConversationMemory(state: MemoryAgentState): Promise<void> {
        const memoryContext: MemoryContext = {
            userId: state.userId,
            conversationId: state.conversationId,
            query: state.query,
            response: state.response,
            metadata: {
                timestamp: new Date(),
                queryLength: state.query.length,
                responseLength: state.response?.length || 0,
                ...state.metadata
            }
        };

        await memoryService.storeConversationMemory(memoryContext);
    }

    /**
     * Analyze and store user preferences
     */
    private async analyzeAndStorePreferences(state: MemoryAgentState): Promise<void> {
        const analysisPrompt = `Analyze this conversation for user preferences and learning opportunities:

        User Query: "${state.query}"
        Assistant Response: "${state.response?.substring(0, 1000) || 'No response'}"

        Extract insights about:
        1. Preferred communication style (technical, simple, detailed, concise)
        2. Topics of interest
        3. Complexity level preference
        4. Any specific tool or model preferences mentioned
        5. Cost sensitivity indicators
        6. Response format preferences

        Respond with JSON only:
        {
            "communication_style": "style preference or null",
            "topics_of_interest": ["topic1", "topic2"],
            "complexity_level": "beginner|intermediate|expert or null",
            "tool_preferences": ["tool1", "tool2"],
            "cost_sensitivity": "low|medium|high or null",
            "response_format": "preference or null",
            "learning_indicators": ["indicator1", "indicator2"]
        }`;

        try {
            const response = await this.writerAgent.invoke([new HumanMessage(analysisPrompt)]);
            const analysis = this.parseAIResponse(response.content.toString());

            // Update user preferences based on analysis
            const preferenceUpdates: any = {};

            if (analysis.communication_style) {
                preferenceUpdates.preferredStyle = analysis.communication_style;
            }

            if (analysis.complexity_level) {
                preferenceUpdates.technicalLevel = analysis.complexity_level;
            }

            if (analysis.topics_of_interest && analysis.topics_of_interest.length > 0) {
                preferenceUpdates.commonTopics = analysis.topics_of_interest;
            }

            if (analysis.cost_sensitivity) {
                const costMapping = {
                    'low': 'premium',
                    'medium': 'balanced',
                    'high': 'cheap'
                };
                preferenceUpdates.costPreference = costMapping[analysis.cost_sensitivity as keyof typeof costMapping];
            }

            if (analysis.response_format) {
                if (analysis.response_format.includes('concise') || analysis.response_format.includes('brief')) {
                    preferenceUpdates.responseLength = 'concise';
                } else if (analysis.response_format.includes('detailed') || analysis.response_format.includes('comprehensive')) {
                    preferenceUpdates.responseLength = 'comprehensive';
                }
            }

            // Update preferences if any were found
            if (Object.keys(preferenceUpdates).length > 0) {
                await userPreferenceService.updatePreferences(state.userId, preferenceUpdates);
            }
        } catch (error) {
            loggingService.error('❌ Failed to analyze preferences:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Store security insights
     */
    private async storeSecurityInsights(state: MemoryAgentState): Promise<void> {
        if (!state.securityFlags || state.securityFlags.length === 0) return;

        // Store security-related memory entries
        // This would integrate with your existing security logging system
        loggingService.warn(`🚨 Security flags for user ${state.userId}: ${state.securityFlags.join(', ')}`);
    }

    /**
     * Generate learning insights from the conversation
     */
    private async generateLearningInsights(state: MemoryAgentState): Promise<string[]> {
        try {
            const insightPrompt = `Based on this conversation, generate learning insights for future interactions:

            User Query: "${state.query}"
            Assistant Response: "${state.response?.substring(0, 500) || 'No response'}"

            Generate 2-3 insights that could improve future interactions with this user.
            Focus on:
            1. What worked well in this interaction
            2. What could be improved
            3. User behavior patterns to remember

            Respond with a JSON array of insight strings:
            ["insight1", "insight2", "insight3"]`;

            const response = await this.writerAgent.invoke([new HumanMessage(insightPrompt)]);
            const insights = this.parseAIResponse(response.content.toString());

            return Array.isArray(insights) ? insights : [];
        } catch (error) {
            loggingService.error('❌ Failed to generate learning insights:', { error: error instanceof Error ? error.message : String(error) });
            return [];
        }
    }

    /**
     * Parse AI response that might be wrapped in markdown code blocks
     */
    private parseAIResponse(content: string): any {
        try {
            // First try to parse as-is
            return JSON.parse(content);
        } catch (error) {
            // If that fails, try to extract JSON from markdown code blocks
            const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*```/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[1]);
            }
            
            // Try to find JSON object or array without code blocks
            const objectMatch = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
            if (objectMatch) {
                return JSON.parse(objectMatch[0]);
            }
            
            // If all else fails, throw the original error
            throw error;
        }
    }
}

/**
 * Memory Reader Agent - Responsible for retrieving and applying memory
 */
export class MemoryReaderAgent {
    private readerAgent: ChatBedrockConverse;

    constructor() {
        this.readerAgent = new ChatBedrockConverse({
            model: "amazon.nova-pro-v1:0",
            region: process.env.AWS_REGION || 'us-east-1',
            temperature: 0.2,
            maxTokens: 1500,
        });
    }

    /**
     * Process memory reading operations
     */
    async processMemoryRead(state: MemoryAgentState): Promise<Partial<MemoryAgentState>> {
        try {
            loggingService.info(`🔍 MemoryReaderAgent processing for user: ${state.userId}`);

            const [
                memoryInsights,
                similarConversations,
                userPreferences,
                personalizedRecommendations,
                securityCheck
            ] = await Promise.all([
                memoryService.getUserMemoryInsights(state.userId),
                memoryService.getSimilarConversations(state.userId, state.query, 3),
                userPreferenceService.getUserPreferences(state.userId),
                memoryService.getPersonalizedRecommendations(state.userId, state.query),
                memoryService.checkSecurityPatterns(state.userId, state.query)
            ]);

            // Check for security concerns
            const securityFlags: string[] = [];
            if (securityCheck) {
                securityFlags.push(securityCheck.content);
            }

            loggingService.info(`✅ MemoryReaderAgent retrieved insights for user: ${state.userId}`);

            return {
                memoryInsights,
                similarConversations,
                userPreferences,
                personalizedRecommendations,
                securityFlags,
                metadata: {
                    ...state.metadata,
                    memoryReadTimestamp: new Date(),
                    hasMemoryContext: memoryInsights.length > 0,
                    hasSimilarConversations: similarConversations.length > 0,
                    hasSecurityConcerns: securityFlags.length > 0
                }
            };
        } catch (error) {
            loggingService.error('❌ MemoryReaderAgent failed:', { error: error instanceof Error ? error.message : String(error) });
            return {
                memoryInsights: [],
                similarConversations: [],
                personalizedRecommendations: [],
                securityFlags: [],
                metadata: {
                    ...state.metadata,
                    memoryReadError: error instanceof Error ? error.message : 'Unknown error'
                }
            };
        }
    }

    /**
     * Generate context-aware prompt enhancement
     */
    async enhancePromptWithMemory(state: MemoryAgentState): Promise<string> {
        try {
            if (!state.memoryInsights || state.memoryInsights.length === 0) {
                return state.query; // No memory context available
            }

            const enhancementPrompt = `Enhance this user query with relevant memory context:

            Original Query: "${state.query}"

            Memory Context:
            ${state.memoryInsights.map(insight => `- ${insight.type}: ${insight.content}`).join('\n')}

            User Preferences:
            ${state.userPreferences ? `
            - Preferred Model: ${state.userPreferences.preferredModel || 'Not set'}
            - Technical Level: ${state.userPreferences.technicalLevel || 'Not set'}
            - Response Length: ${state.userPreferences.responseLength || 'Not set'}
            - Common Topics: ${state.userPreferences.commonTopics?.join(', ') || 'None'}
            ` : 'No preferences set'}

            Similar Past Conversations:
            ${state.similarConversations?.map(conv => `- "${conv.query}" (similarity: ${conv.similarity.toFixed(2)})`).join('\n') || 'None'}

            Personalized Recommendations:
            ${state.personalizedRecommendations?.join('\n- ') || 'None'}

            Create an enhanced version of the query that incorporates relevant memory context.
            The enhanced query should:
            1. Reference relevant past conversations if applicable
            2. Adjust complexity based on user's technical level
            3. Include user preferences where relevant
            4. Maintain the original intent while adding helpful context

            Return only the enhanced query, no other text.`;

            const response = await this.readerAgent.invoke([new HumanMessage(enhancementPrompt)]);
            const enhancedQuery = response.content.toString().trim();

            loggingService.info(`🎯 Enhanced query with memory context`);
            return enhancedQuery;
        } catch (error) {
            loggingService.error('❌ Failed to enhance prompt with memory:', { error: error instanceof Error ? error.message : String(error) });
            return state.query; // Fallback to original query
        }
    }

    /**
     * Generate memory-aware response suggestions
     */
    async generateResponseGuidance(state: MemoryAgentState): Promise<string> {
        try {
            const guidancePrompt = `Based on the user's memory profile, provide guidance for generating the best response:

            User Query: "${state.query}"
            
            User Profile:
            - Technical Level: ${state.userPreferences?.technicalLevel || 'unknown'}
            - Preferred Response Length: ${state.userPreferences?.responseLength || 'unknown'}
            - Common Topics: ${state.userPreferences?.commonTopics?.join(', ') || 'none'}
            - Cost Preference: ${state.userPreferences?.costPreference || 'unknown'}

            Memory Insights:
            ${state.memoryInsights?.map(insight => `- ${insight.content}`).join('\n') || 'No specific insights'}

            Similar Past Conversations:
            ${state.similarConversations?.slice(0, 2).map(conv => 
                `- Query: "${conv.query}"\n  Response Preview: "${conv.response.substring(0, 200)}..."`
            ).join('\n\n') || 'No similar conversations'}

            Provide specific guidance for the response including:
            1. Recommended tone and complexity level
            2. Suggested response structure
            3. Key points to emphasize based on user interests
            4. Any warnings or considerations
            5. How to reference past conversations if relevant

            Keep the guidance concise and actionable.`;

            const response = await this.readerAgent.invoke([new HumanMessage(guidancePrompt)]);
            return response.content.toString();
        } catch (error) {
            loggingService.error('❌ Failed to generate response guidance:', { error: error instanceof Error ? error.message : String(error) });
            return 'No specific guidance available';
        }
    }
}

// Export singleton instances
export const memoryWriterAgent = new MemoryWriterAgent();
export const memoryReaderAgent = new MemoryReaderAgent();