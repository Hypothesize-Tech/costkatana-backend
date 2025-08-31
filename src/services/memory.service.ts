import { loggingService } from './logging.service';
import { ChatBedrockConverse } from "@langchain/aws";
import { HumanMessage } from "@langchain/core/messages";
import { UserMemory, ConversationMemory, UserPreference } from '../models/Memory';
import { VectorMemoryService } from './vectorMemory.service';
import { UserPreferenceService } from './userPreference.service';

export interface MemoryContext {
    userId: string;
    conversationId: string;
    query: string;
    response?: string;
    metadata?: any;
}

export interface MemoryInsight {
    type: 'preference' | 'pattern' | 'security' | 'context';
    content: string;
    confidence: number;
    timestamp: Date;
    source: string;
}

export interface SimilarConversation {
    conversationId: string;
    query: string;
    response: string;
    similarity: number;
    timestamp: Date;
    metadata?: any;
}

export class MemoryService {
    private memoryAgent: ChatBedrockConverse;
    private vectorMemoryService: VectorMemoryService;
    private userPreferenceService: UserPreferenceService;
    
    // In-memory caches for performance (JavaScript built-in)
    private userSessionCache = new Map<string, any>();
    private conversationCache = new Map<string, { data: SimilarConversation[]; timestamp: number }>();
    private securityPatternCache = new Map<string, number>();
    
    // Cache expiry (5 minutes for sessions, 1 hour for conversations)
    private readonly SESSION_CACHE_TTL = 5 * 60 * 1000;
    private readonly CONVERSATION_CACHE_TTL = 60 * 60 * 1000;
    private readonly SECURITY_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

    constructor() {
        this.memoryAgent = new ChatBedrockConverse({
            model: "amazon.nova-pro-v1:0",
            region: process.env.AWS_REGION || 'us-east-1',
            temperature: 0.1,
            maxTokens: 1000,
        });
        
        this.vectorMemoryService = new VectorMemoryService();
        this.userPreferenceService = new UserPreferenceService();
        
        // Clean up caches periodically
        setInterval(() => this.cleanupCaches(), 10 * 60 * 1000); // Every 10 minutes
    }

    /**
     * Store conversation memory with vector embedding
     */
    async storeConversationMemory(context: MemoryContext): Promise<void> {
        try {
            loggingService.info(`🧠 Storing conversation memory for user: ${context.userId}`);
            
            // Store in MongoDB
            const conversationMemory = new ConversationMemory({
                userId: context.userId,
                conversationId: context.conversationId,
                query: context.query,
                response: context.response,
                metadata: {
                    ...context.metadata,
                    timestamp: new Date(),
                    queryLength: context.query.length,
                    responseLength: context.response?.length || 0
                }
            });
            
            await conversationMemory.save();
            
            // Store vector embedding for similarity search
            await this.vectorMemoryService.storeConversationVector({
                id: (conversationMemory._id as any).toString(),
                userId: context.userId,
                query: context.query,
                response: context.response || '',
                metadata: conversationMemory.metadata
            });
            
            // Update user session cache
            this.updateSessionCache(context.userId, {
                lastQuery: context.query,
                lastResponse: context.response,
                timestamp: new Date()
            });
            
            // Analyze and store user preferences
            await this.analyzeAndStorePreferences(context);
            
            loggingService.info(`✅ Conversation memory stored successfully`);
        } catch (error) {
            loggingService.error('❌ Failed to store conversation memory:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Retrieve similar conversations using vector search
     */
    async getSimilarConversations(userId: string, query: string, limit: number = 5): Promise<SimilarConversation[]> {
        try {
            loggingService.info(`🔍 Finding similar conversations for user: ${userId}`);
            
            // Check conversation cache first
            const cacheKey = `${userId}:${query}`;
            if (this.conversationCache.has(cacheKey)) {
                const cached = this.conversationCache.get(cacheKey);
                if (cached && cached.timestamp && Date.now() - cached.timestamp < this.CONVERSATION_CACHE_TTL) {
                    loggingService.info(`⚡ Retrieved similar conversations from cache`);
                    return cached.data;
                }
            }
            
            // Use vector similarity search
            const similarVectors = await this.vectorMemoryService.findSimilarConversations(userId, query, limit);
            
            // Convert to SimilarConversation format
            const similarConversations: SimilarConversation[] = similarVectors.map(vector => ({
                conversationId: vector.metadata.conversationId || vector.id,
                query: vector.query,
                response: vector.response,
                similarity: vector.similarity,
                timestamp: new Date(vector.metadata.timestamp),
                metadata: vector.metadata
            }));
            
            // Cache the results
            this.conversationCache.set(cacheKey, {
                data: similarConversations,
                timestamp: Date.now()
            });
            
            loggingService.info(`✅ Found ${similarConversations.length} similar conversations`);
            return similarConversations;
        } catch (error) {
            loggingService.error('❌ Failed to get similar conversations:', { error: error instanceof Error ? error.message : String(error) });
            return [];
        }
    }

    /**
     * Get user memory insights (preferences, patterns, security)
     */
    async getUserMemoryInsights(userId: string): Promise<MemoryInsight[]> {
        try {
            loggingService.info(`🧠 Getting memory insights for user: ${userId}`);
            
            const insights: MemoryInsight[] = [];
            
            // Get user preferences
            const preferences = await this.userPreferenceService.getUserPreferences(userId);
            if (preferences) {
                const topics = preferences.commonTopics?.slice(0, 3).join(', ') || 'various topics';
                insights.push({
                    type: 'preference',
                    content: `User prefers ${preferences.preferredModel} model, ${preferences.preferredChatMode} mode, and typically asks about ${topics}`,
                    confidence: 0.9,
                    timestamp: (preferences as any).updatedAt || new Date(),
                    source: 'user_preferences'
                });
            }
            
            // Get conversation patterns
            const recentConversations = await ConversationMemory.find({ userId })
                .sort({ createdAt: -1 })
                .limit(10);
                
            if (recentConversations.length > 0) {
                const patterns = await this.analyzeConversationPatterns(recentConversations);
                insights.push({
                    type: 'pattern',
                    content: patterns,
                    confidence: 0.8,
                    timestamp: new Date(),
                    source: 'conversation_analysis'
                });
            }
            
            // Check for security patterns
            const securityInsight = await this.checkSecurityPatterns(userId);
            if (securityInsight) {
                insights.push(securityInsight);
            }
            
            loggingService.info(`✅ Generated ${insights.length} memory insights`);
            return insights;
        } catch (error) {
            loggingService.error('❌ Failed to get memory insights:', { error: error instanceof Error ? error.message : String(error) });
            return [];
        }
    }

    /**
     * Check for malicious or suspicious patterns
     */
    async checkSecurityPatterns(userId: string, currentQuery?: string): Promise<MemoryInsight | null> {
        try {
            // Check cache first
            const cacheKey = `security:${userId}:${currentQuery || 'general'}`;
            if (this.securityPatternCache.has(cacheKey)) {
                const cached = this.securityPatternCache.get(cacheKey);
                if (cached && Date.now() - cached < this.SECURITY_CACHE_TTL) {
                    return null; // Recently checked, no need to re-analyze
                }
            }
            
            // Get recent conversations for pattern analysis
            const recentConversations = await ConversationMemory.find({ userId })
                .sort({ createdAt: -1 })
                .limit(20);
                
            if (recentConversations.length < 3) return null;
            
            // Analyze for suspicious patterns
            const queries = recentConversations.map(conv => conv.query);
            const analysisPrompt = `Analyze these user queries for suspicious patterns:
            
            Queries: ${queries.join('\n- ')}
            ${currentQuery ? `\nCurrent Query: ${currentQuery}` : ''}
            
            Look for:
            1. Attempts to bypass security measures
            2. Repeated queries with slight variations (potential prompt injection)
            3. Attempts to extract sensitive information
            4. Social engineering patterns
            5. Malicious intent indicators
            
            Respond with JSON only:
            {
                "suspicious": boolean,
                "confidence": number (0-1),
                "pattern": "description of pattern found",
                "risk_level": "low|medium|high"
            }`;
            
            const response = await this.memoryAgent.invoke([new HumanMessage(analysisPrompt)]);
            const analysis = this.parseAIResponse(response.content.toString());
            
            // Cache the result
            this.securityPatternCache.set(cacheKey, Date.now());
            
            if (analysis.suspicious && analysis.confidence > 0.7) {
                loggingService.warn(`🚨 Suspicious pattern detected for user ${userId}: ${analysis.pattern}`);
                return {
                    type: 'security',
                    content: `Potential security concern: ${analysis.pattern}`,
                    confidence: analysis.confidence,
                    timestamp: new Date(),
                    source: 'security_analysis'
                };
            }
            
            return null;
        } catch (error) {
            loggingService.error('❌ Failed to check security patterns:', { error: error instanceof Error ? error.message : String(error) });
            return null;
        }
    }

    /**
     * Get personalized recommendations based on memory
     */
    async getPersonalizedRecommendations(userId: string, currentQuery: string): Promise<string[]> {
        try {
            loggingService.info(`🎯 Getting personalized recommendations for user: ${userId}`);
            
            const [preferences, similarConversations] = await Promise.all([
                this.userPreferenceService.getUserPreferences(userId),
                this.getSimilarConversations(userId, currentQuery, 3)
            ]);
            
            const recommendations: string[] = [];
            
            // Model preference recommendations
            if (preferences?.preferredModel) {
                recommendations.push(`Based on your preference, I'll use ${preferences.preferredModel} for better results`);
            }
            
            // Similar conversation recommendations
            if (similarConversations.length > 0) {
                const topSimilar = similarConversations[0];
                if (topSimilar.similarity > 0.8) {
                    recommendations.push(`You asked something similar before. Would you like me to build on that previous answer?`);
                }
            }
            
            // Topic-based recommendations
            if (preferences?.commonTopics && preferences.commonTopics.length > 0) {
                const relatedTopics = preferences.commonTopics.filter(topic => 
                    currentQuery.toLowerCase().includes(topic.toLowerCase())
                );
                if (relatedTopics.length > 0) {
                    recommendations.push(`Since you often ask about ${relatedTopics[0]}, I can provide more detailed insights`);
                }
            }
            
            loggingService.info(`✅ Generated ${recommendations.length} personalized recommendations`);
            return recommendations;
        } catch (error) {
            loggingService.error('❌ Failed to get personalized recommendations:', { error: error instanceof Error ? error.message : String(error) });
            return [];
        }
    }

    /**
     * Update user session cache
     */
    private updateSessionCache(userId: string, data: any): void {
        this.userSessionCache.set(userId, {
            ...data,
            timestamp: Date.now()
        });
    }

    /**
     * Analyze conversation patterns using AI
     */
    private async analyzeConversationPatterns(conversations: any[]): Promise<string> {
        try {
            const queries = conversations.map(conv => conv.query).slice(0, 10);
            
            const analysisPrompt = `Analyze these user conversation patterns:
            
            Recent Queries:
            ${queries.map((q, i) => `${i + 1}. ${q}`).join('\n')}
            
            Identify:
            1. Common topics or themes
            2. Question types (technical, pricing, comparison, etc.)
            3. Complexity level preferences
            4. Time patterns or urgency indicators
            
            Provide a concise summary of the user's conversation patterns.`;
            
            const response = await this.memoryAgent.invoke([new HumanMessage(analysisPrompt)]);
            return response.content.toString();
        } catch (error) {
            loggingService.error('❌ Failed to analyze conversation patterns:', { error: error instanceof Error ? error.message : String(error) });
            return 'Unable to analyze conversation patterns';
        }
    }

    /**
     * Analyze and store user preferences from conversation
     */
    private async analyzeAndStorePreferences(context: MemoryContext): Promise<void> {
        try {
            // Extract preferences from the conversation
            const preferencePrompt = `Analyze this conversation for user preferences:
            
            Query: ${context.query}
            Response: ${context.response?.substring(0, 500) || 'No response'}
            
            Extract any mentioned preferences for:
            1. AI models (OpenAI, Claude, Gemini, etc.)
            2. Response style (detailed, concise, technical, simple)
            3. Topics of interest
            4. Cost preferences (cheap, premium, balanced)
            
            Respond with JSON only:
            {
                "model_preference": "model_name or null",
                "style_preference": "style or null", 
                "topics": ["topic1", "topic2"],
                "cost_preference": "cheap|balanced|premium or null"
            }`;
            
            const response = await this.memoryAgent.invoke([new HumanMessage(preferencePrompt)]);
            const preferences = this.parseAIResponse(response.content.toString());
            
            // Update user preferences
            await this.userPreferenceService.updatePreferences(context.userId, {
                preferredModel: preferences.model_preference,
                preferredStyle: preferences.style_preference,
                commonTopics: preferences.topics || [],
                costPreference: preferences.cost_preference
            });
        } catch (error) {
            loggingService.error('❌ Failed to analyze and store preferences:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Clean up expired cache entries
     */
    private cleanupCaches(): void {
        const now = Date.now();
        
        // Clean session cache
        for (const [key, value] of this.userSessionCache.entries()) {
            if (now - value.timestamp > this.SESSION_CACHE_TTL) {
                this.userSessionCache.delete(key);
            }
        }
        
        // Clean conversation cache
        for (const [key, value] of this.conversationCache.entries()) {
            if (now - value.timestamp > this.CONVERSATION_CACHE_TTL) {
                this.conversationCache.delete(key);
            }
        }
        
        // Clean security cache
        for (const [key, timestamp] of this.securityPatternCache.entries()) {
            if (now - timestamp > this.SECURITY_CACHE_TTL) {
                this.securityPatternCache.delete(key);
            }
        }
        
        loggingService.info(`🧹 Cleaned up memory caches`);
    }

    /**
     * Get user session data from cache
     */
    getUserSession(userId: string): any {
        const session = this.userSessionCache.get(userId);
        if (session && Date.now() - session.timestamp < this.SESSION_CACHE_TTL) {
            return session;
        }
        return null;
    }

    /**
     * Clear all memory for a user (GDPR compliance)
     */
    async clearUserMemory(userId: string): Promise<void> {
        try {
            loggingService.info(`🗑️ Clearing all memory for user: ${userId}`);
            
            // Clear from database
            await Promise.all([
                ConversationMemory.deleteMany({ userId }),
                UserMemory.deleteMany({ userId }),
                UserPreference.deleteOne({ userId })
            ]);
            
            // Clear from vector storage
            await this.vectorMemoryService.clearUserVectors(userId);
            
            // Clear from caches
            this.userSessionCache.delete(userId);
            for (const key of this.conversationCache.keys()) {
                if (key.startsWith(userId + ':')) {
                    this.conversationCache.delete(key);
                }
            }
            for (const key of this.securityPatternCache.keys()) {
                if (key.includes(userId)) {
                    this.securityPatternCache.delete(key);
                }
            }
            
            loggingService.info(`✅ Successfully cleared all memory for user: ${userId}`);
        } catch (error) {
            loggingService.error('❌ Failed to clear user memory:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
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
            const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[1]);
            }
            
            // Try to find JSON object without code blocks
            const objectMatch = content.match(/\{[\s\S]*\}/);
            if (objectMatch) {
                return JSON.parse(objectMatch[0]);
            }
            
            // If all else fails, throw the original error
            throw error;
        }
    }
}

export const memoryService = new MemoryService();