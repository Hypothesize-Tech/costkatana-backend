import { loggingService } from './logging.service';
import { ChatBedrockConverse } from "@langchain/aws";
import { HumanMessage } from "@langchain/core/messages";
import { UserMemory, ConversationMemory, UserPreference } from '../models/Memory';
import { Message } from '../models/Message';
import { VectorMemoryService } from './vectorMemory.service';
import { UserPreferenceService } from './userPreference.service';
import { cacheService } from './cache.service';
import { LRUCache } from 'lru-cache';
import mongoose from 'mongoose';

export interface MemoryContext {
    userId: string;
    conversationId: string;
    query: string;
    response?: string;
    metadata?: any;
}

export interface ConversationContext {
    conversationId: string;
    currentSubject?: string;
    currentIntent?: string;
    lastReferencedEntities: string[];
    lastToolUsed?: string;
    lastDomain?: string;
    languageFramework?: string;
    subjectConfidence: number;
    timestamp: Date;
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
    
    // LRU caches for performance with proper size limits
    private userSessionCache: LRUCache<string, any>;
    private conversationCache: LRUCache<string, { data: SimilarConversation[]; timestamp: number }>;
    private securityPatternCache: LRUCache<string, number>;
    
    // Cache expiry (5 minutes for sessions, 1 hour for conversations)
    private readonly SESSION_CACHE_TTL = 5 * 60 * 1000;
    private readonly CONVERSATION_CACHE_TTL = 60 * 60 * 1000;
    private readonly SECURITY_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
    
    // Context management with LRU cache
    private static contextCache: LRUCache<string, ConversationContext>;
    private static readonly CTX_REDIS_TTL = parseInt(process.env.CTX_REDIS_TTL || '600');

    constructor() {
        this.memoryAgent = new ChatBedrockConverse({
            model: "amazon.nova-pro-v1:0",
            region: process.env.AWS_REGION || 'us-east-1',
            temperature: 0.1,
            maxTokens: 1000,
        });
        
        this.vectorMemoryService = new VectorMemoryService();
        this.userPreferenceService = new UserPreferenceService();
        
        // Initialize LRU caches with proper size limits and TTL
        this.userSessionCache = new LRUCache({
            max: 1000, // Maximum 1000 user sessions
            ttl: this.SESSION_CACHE_TTL,
            updateAgeOnGet: true,
            allowStale: false
        });

        this.conversationCache = new LRUCache({
            max: 500, // Maximum 500 conversations
            ttl: this.CONVERSATION_CACHE_TTL,
            updateAgeOnGet: true,
            allowStale: false
        });

        this.securityPatternCache = new LRUCache({
            max: 10000, // Security patterns can be numerous
            ttl: this.SECURITY_CACHE_TTL,
            updateAgeOnGet: true,
            allowStale: false
        });

        // Initialize static context cache if not already done
        if (!MemoryService.contextCache) {
            MemoryService.contextCache = new LRUCache({
                max: 1000, // Maximum 1000 conversation contexts
                ttl: MemoryService.CTX_REDIS_TTL * 1000, // Convert seconds to milliseconds
                updateAgeOnGet: true,
                allowStale: false
            });
        }
    }

    // Context Management Methods
    static async getConversationContext(conversationId: string): Promise<ConversationContext | null> {
        // Try in-memory cache first
        const cachedContext = this.contextCache.get(conversationId);
        if (cachedContext) {
            return cachedContext;
        }

        // Try cache service fallback
        try {
            const cacheKey = `context:${conversationId}`;
            const contextData = await cacheService.get(cacheKey);
            if (contextData) {
                const context = contextData as ConversationContext;
                // Restore to in-memory cache for faster access
                this.contextCache.set(conversationId, context);
                return context;
            }
        } catch (error) {
            loggingService.warn('Cache service fallback failed, using in-memory cache only', {
                error: error instanceof Error ? error.message : String(error)
            });
        }

        return null;
    }

    static async setConversationContext(context: ConversationContext): Promise<void> {
        // Store in memory cache
        this.contextCache.set(context.conversationId, context);
        
        // Store in cache service with TTL
        try {
            const cacheKey = `context:${context.conversationId}`;
            await cacheService.set(cacheKey, context, this.CTX_REDIS_TTL);
        } catch (error) {
            loggingService.warn('Failed to store context in cache service, using in-memory cache only', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
        
        loggingService.info('💾 Conversation context stored', {
            conversationId: context.conversationId,
            subject: context.currentSubject,
            domain: context.lastDomain,
            confidence: context.subjectConfidence
        });
    }

    static async clearConversationContext(conversationId: string): Promise<void> {
        this.contextCache.delete(conversationId);
        
        // Clear from cache service as well
        try {
            const cacheKey = `context:${conversationId}`;
            await cacheService.delete(cacheKey);
        } catch (error) {
            loggingService.warn('Failed to clear context from cache service', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
        
        loggingService.info('🗑️ Conversation context cleared', {
            conversationId
        });
    }

    /**
     * Store conversation memory with vector embedding
     */
    async storeConversationMemory(context: MemoryContext): Promise<void> {
        try {
            // Validate that we have a valid response before storing
            if (!context.response || context.response.trim().length === 0) {
                loggingService.warn('🧠 Skipping conversation memory storage - empty response', {
                    userId: context.userId,
                    conversationId: context.conversationId,
                    responseLength: context.response?.length || 0
                });
                return;
            }

            // Check for ambiguous subject context
            const conversationContext = await MemoryService.getConversationContext(context.conversationId);
            if (conversationContext && conversationContext.subjectConfidence < 0.6) {
                loggingService.warn('🧠 Skipping conversation memory storage - ambiguous subject', {
                    userId: context.userId,
                    conversationId: context.conversationId,
                    subjectConfidence: conversationContext.subjectConfidence,
                    currentSubject: conversationContext.currentSubject
                });
                return;
            }

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
     * Get user memory insights with parallel execution
     */
    async getUserMemoryInsights(userId: string): Promise<MemoryInsight[]> {
        try {
            loggingService.info(`🧠 Getting memory insights for user: ${userId}`);
            
            // Execute all data fetching operations in parallel
            const [preferences, recentConversations, securityInsight] = await Promise.all([
                this.userPreferenceService.getUserPreferences(userId),
                ConversationMemory.find({ userId: new mongoose.Types.ObjectId(userId) })
                    .sort({ createdAt: -1 })
                    .limit(10)
                    .lean(), // Use lean for better performance
                this.checkSecurityPatterns(userId)
            ]);

            const insights: MemoryInsight[] = [];
            
            // Process preferences insight
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
            
            // Process conversation patterns insight
            if (recentConversations.length > 0) {
                // Run pattern analysis in background for non-blocking response
                this.analyzeConversationPatternsAsync(userId, recentConversations)
                    .then(patterns => {
                        // Store patterns for future use
                        this.storePatternInsight(userId, patterns);
                    })
                    .catch(error => {
                        loggingService.error('Background pattern analysis failed:', { error: error.message });
                    });

                // Return immediate pattern insight based on conversation count and recency
                const patternContent = this.generateQuickPatternInsight(recentConversations);
                insights.push({
                    type: 'pattern',
                    content: patternContent,
                    confidence: 0.7,
                    timestamp: new Date(),
                    source: 'conversation_analysis'
                });
            }
            
            // Add security insight if found
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
            const recentConversations = await ConversationMemory.find({ userId: new mongoose.Types.ObjectId(userId) })
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
     * Get user session data from cache
     */
    getUserSession(userId: string): any {
        return this.userSessionCache.get(userId) || null;
    }

    /**
     * Clear all memory for a user (GDPR compliance)
     */
    async clearUserMemory(userId: string): Promise<void> {
        try {
            loggingService.info(`🗑️ Clearing all memory for user: ${userId}`);
            
            // Clear from database
            await Promise.all([
                ConversationMemory.deleteMany({ userId: new mongoose.Types.ObjectId(userId) }),
                UserMemory.deleteMany({ userId: new mongoose.Types.ObjectId(userId) }),
                UserPreference.deleteOne({ userId: new mongoose.Types.ObjectId(userId) })
            ]);
            
            // Clear from vector storage
            await this.vectorMemoryService.clearUserVectors(userId);
            
            // Clear from caches
            this.userSessionCache.delete(userId);
            for (const key of Array.from(this.conversationCache.keys())) {
                if (key.startsWith(userId + ':')) {
                    this.conversationCache.delete(key);
                }
            }
            for (const key of Array.from(this.securityPatternCache.keys())) {
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
            // Clean the content - trim whitespace
            const cleanContent = content.trim();
            
            // First try to parse as-is
            return JSON.parse(cleanContent);
        } catch {
            // If that fails, try to extract JSON from markdown code blocks
            const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
            if (jsonMatch) {
                try {
                    return JSON.parse(jsonMatch[1]);
                } catch {
                    // Continue to next method
                }
            }
            
            // Try to find and extract just the JSON object (handles trailing text after JSON)
            const objectMatch = content.match(/(\{[\s\S]*?\})(?:\s*[^{}\[\]]*)?$/);
            if (objectMatch) {
                try {
                    return JSON.parse(objectMatch[1]);
                } catch {
                    // Continue to next method
                }
            }
            
            // Try to find the first complete JSON object using bracket matching
            const jsonStart = content.indexOf('{');
            if (jsonStart !== -1) {
                let braceCount = 0;
                let jsonEnd = -1;
                for (let i = jsonStart; i < content.length; i++) {
                    if (content[i] === '{') braceCount++;
                    if (content[i] === '}') braceCount--;
                    if (braceCount === 0) {
                        jsonEnd = i + 1;
                        break;
                    }
                }
                if (jsonEnd !== -1) {
                    try {
                        return JSON.parse(content.substring(jsonStart, jsonEnd));
                    } catch {
                        // Continue to fallback
                    }
                }
            }
            
            // Return default safe response if all parsing fails
            loggingService.warn('Failed to parse AI response, returning safe default', {
                contentPreview: content.substring(0, 200)
            });
            return {
                suspicious: false,
                confidence: 0,
                pattern: 'Unable to analyze',
                risk_level: 'low'
            };
        }
    }

    // ============================================================================
    // OPTIMIZATION UTILITY METHODS
    // ============================================================================

    /**
     * Generate quick pattern insight without AI analysis
     */
    private generateQuickPatternInsight(conversations: any[]): string {
        const totalConversations = conversations.length;
        const recentDays = Math.ceil((Date.now() - new Date(conversations[conversations.length - 1].createdAt).getTime()) / (1000 * 60 * 60 * 24));
        
        // Analyze query lengths and types
        const avgQueryLength = conversations.reduce((sum, conv) => sum + conv.query.length, 0) / totalConversations;
        const hasLongQueries = avgQueryLength > 100;
        const hasShortQueries = avgQueryLength < 50;
        
        // Quick topic detection
        const queries = conversations.map(conv => conv.query.toLowerCase());
        const commonWords = this.extractCommonWords(queries);
        
        let insight = `User has ${totalConversations} conversations over ${recentDays} days. `;
        
        if (hasLongQueries) {
            insight += "Tends to ask detailed, complex questions. ";
        } else if (hasShortQueries) {
            insight += "Prefers concise, direct questions. ";
        }
        
        if (commonWords.length > 0) {
            insight += `Common topics include: ${commonWords.slice(0, 3).join(', ')}.`;
        }
        
        return insight;
    }

    /**
     * Extract common words from queries for quick analysis
     */
    private extractCommonWords(queries: string[]): string[] {
        const wordCount = new Map<string, number>();
        const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'what', 'how', 'when', 'where', 'why', 'who']);
        
        queries.forEach(query => {
            const words = query.split(/\s+/).filter(word => 
                word.length > 3 && !stopWords.has(word.toLowerCase())
            );
            
            words.forEach(word => {
                const cleanWord = word.toLowerCase().replace(/[^\w]/g, '');
                if (cleanWord.length > 3) {
                    wordCount.set(cleanWord, (wordCount.get(cleanWord) || 0) + 1);
                }
            });
        });
        
        return Array.from(wordCount.entries())
            .filter(([, count]) => count > 1)
            .sort((a, b) => b[1] - a[1])
            .map(([word]) => word);
    }

    /**
     * Async conversation pattern analysis for background processing
     */
    private async analyzeConversationPatternsAsync(userId: string, conversations: any[]): Promise<string> {
        try {
            // Use streaming approach for large conversation sets
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
            loggingService.error('❌ Failed to analyze conversation patterns async:', { error: error instanceof Error ? error.message : String(error) });
            return 'Unable to analyze conversation patterns';
        }
    }

    /**
     * Store pattern insight for future use
     */
    private async storePatternInsight(userId: string, patterns: string): Promise<void> {
        try {
            // Store in UserMemory for future reference
            const patternMemory = new UserMemory({
                userId,
                memoryType: 'pattern',
                content: patterns,
                confidence: 0.8,
                source: 'ai_analysis',
                tags: ['conversation_patterns', 'ai_generated'],
                metadata: {
                    generatedAt: new Date(),
                    analysisType: 'conversation_patterns'
                }
            });
            
            await patternMemory.save();
        } catch (error) {
            loggingService.error('❌ Failed to store pattern insight:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    // ============ CONSOLIDATED MEMORY AGENT CAPABILITIES ============
    // The following methods consolidate MemoryWriterAgent and MemoryReaderAgent functionality

    /**
     * Process memory write operations (consolidated from MemoryWriterAgent)
     */
    async processMemoryWrite(state: {
        userId: string;
        conversationId: string;
        query: string;
        response?: string;
        securityFlags?: string[];
        metadata?: any;
    }): Promise<{ memoryOperations: string[]; metadata: any }> {
        try {
            loggingService.info(`📝 Processing memory write for user: ${state.userId}`);

            const operations: string[] = [];

            // Store conversation memory
            if (state.query && state.response && state.response.trim().length > 0) {
                await this.storeConversationMemory({
                    userId: state.userId,
                    conversationId: state.conversationId,
                    query: state.query,
                    response: state.response,
                    metadata: state.metadata
                });
                operations.push('conversation_stored');
            }

            // Analyze and store user preferences
            if (state.query && state.response && state.response.trim().length > 0) {
                await this.analyzeAndStorePreferencesConsolidated(state);
                operations.push('preferences_analyzed');
            }

            // Store security insights if any flags were raised
            if (state.securityFlags && state.securityFlags.length > 0) {
                await this.storeSecurityInsightsConsolidated(state);
                operations.push('security_insights_stored');
            }

            // Generate learning insights
            await this.generateLearningInsightsConsolidated(state);
            operations.push('learning_insights_generated');

            loggingService.info(`✅ Memory write completed: ${operations.length} operations`);

            return {
                memoryOperations: operations,
                metadata: {
                    ...state.metadata,
                    memoryWriteTimestamp: new Date(),
                    operationsCompleted: operations
                }
            };
        } catch (error) {
            loggingService.error('❌ Memory write failed:', { error: error instanceof Error ? error.message : String(error) });
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
     * Process memory read operations (consolidated from MemoryReaderAgent)
     */
    async processMemoryRead(state: {
        userId: string;
        query: string;
        conversationId: string;
        metadata?: any;
    }): Promise<{
        memoryInsights: MemoryInsight[];
        similarConversations: SimilarConversation[];
        userPreferences: any;
        personalizedRecommendations: string[];
        securityFlags: string[];
        metadata: any;
    }> {
        try {
            loggingService.info(`🔍 Processing memory read for user: ${state.userId}`);

            const [
                memoryInsights,
                similarConversations,
                userPreferences,
                personalizedRecommendations,
                securityCheck
            ] = await Promise.all([
                this.getUserMemoryInsights(state.userId),
                this.getSimilarConversations(state.userId, state.query, 3),
                this.userPreferenceService.getUserPreferences(state.userId),
                this.getPersonalizedRecommendations(state.userId, state.query),
                this.checkSecurityPatterns(state.userId, state.query)
            ]);

            // Check for security concerns
            const securityFlags: string[] = [];
            if (securityCheck) {
                securityFlags.push(securityCheck.content);
            }

            loggingService.info(`✅ Memory read completed for user: ${state.userId}`);

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
            loggingService.error('❌ Memory read failed:', { error: error instanceof Error ? error.message : String(error) });
            return {
                memoryInsights: [],
                similarConversations: [],
                userPreferences: null,
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
     * Enhance prompt with memory context (consolidated from MemoryReaderAgent)
     */
    async enhancePromptWithMemory(state: {
        query: string;
        memoryInsights?: MemoryInsight[];
        userPreferences?: any;
        similarConversations?: SimilarConversation[];
        personalizedRecommendations?: string[];
    }): Promise<string> {
        try {
            if (!state.memoryInsights || state.memoryInsights.length === 0) {
                return state.query;
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
            Return only the enhanced query, no other text.`;

            const response = await this.memoryAgent.invoke([new HumanMessage(enhancementPrompt)]);
            const enhancedQuery = response.content.toString().trim();

            loggingService.info(`🎯 Enhanced query with memory context`);
            return enhancedQuery;
        } catch (error) {
            loggingService.error('❌ Failed to enhance prompt with memory:', { error: error instanceof Error ? error.message : String(error) });
            return state.query;
        }
    }

    /**
     * Analyze and store user preferences (consolidated from MemoryWriterAgent)
     */
    private async analyzeAndStorePreferencesConsolidated(state: any): Promise<void> {
        const analysisPrompt = `Analyze this conversation for user preferences:

        User Query: "${state.query}"
        Assistant Response: "${state.response?.substring(0, 1000) || ''}"

        Extract insights about communication style, topics, complexity level, tool preferences, cost sensitivity.

        Respond with JSON only:
        {
            "communication_style": "style or null",
            "topics_of_interest": [],
            "complexity_level": "beginner|intermediate|expert or null",
            "tool_preferences": [],
            "cost_sensitivity": "low|medium|high or null",
            "response_format": "preference or null"
        }`;

        try {
            const response = await this.memoryAgent.invoke([new HumanMessage(analysisPrompt)]);
            const analysis = this.parseAIResponseHelper(response.content.toString());

            const preferenceUpdates: any = {};

            if (analysis.communication_style) preferenceUpdates.preferredStyle = analysis.communication_style;
            if (analysis.complexity_level) preferenceUpdates.technicalLevel = analysis.complexity_level;
            if (analysis.topics_of_interest?.length) preferenceUpdates.commonTopics = analysis.topics_of_interest;

            if (Object.keys(preferenceUpdates).length > 0) {
                await this.userPreferenceService.updatePreferences(state.userId, preferenceUpdates);
            }
        } catch (error) {
            loggingService.error('❌ Failed to analyze preferences:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Store security insights (consolidated from MemoryWriterAgent)
     */
    private async storeSecurityInsightsConsolidated(state: any): Promise<void> {
        if (!state.securityFlags || state.securityFlags.length === 0) return;
        loggingService.warn(`🚨 Security flags for user ${state.userId}: ${state.securityFlags.join(', ')}`);
    }

    /**
     * Generate learning insights (consolidated from MemoryWriterAgent)
     */
    private async generateLearningInsightsConsolidated(state: any): Promise<string[]> {
        try {
            const insightPrompt = `Based on this conversation, generate 2-3 learning insights:

            User Query: "${state.query}"
            Assistant Response: "${state.response?.substring(0, 500) || ''}"

            Respond with a JSON array of insight strings: ["insight1", "insight2"]`;

            const response = await this.memoryAgent.invoke([new HumanMessage(insightPrompt)]);
            const insights = this.parseAIResponseHelper(response.content.toString());

            return Array.isArray(insights) ? insights : [];
        } catch (error) {
            loggingService.error('❌ Failed to generate learning insights:', { error: error instanceof Error ? error.message : String(error) });
            return [];
        }
    }

    /**
     * Parse AI response helper (consolidated from MemoryWriterAgent)
     */
    private parseAIResponseHelper(content: string): any {
        try {
            // Clean the content - trim whitespace
            const cleanContent = content.trim();
            return JSON.parse(cleanContent);
        } catch {
            // Try markdown code blocks
            const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*```/);
            if (jsonMatch) {
                try {
                    return JSON.parse(jsonMatch[1]);
                } catch {
                    // Continue to next method
                }
            }
            
            // Try to find and extract just the JSON object/array using bracket matching
            const objectStart = content.indexOf('{');
            const arrayStart = content.indexOf('[');
            const jsonStart = objectStart === -1 ? arrayStart : (arrayStart === -1 ? objectStart : Math.min(objectStart, arrayStart));
            
            if (jsonStart !== -1) {
                const isArray = content[jsonStart] === '[';
                const openBracket = isArray ? '[' : '{';
                const closeBracket = isArray ? ']' : '}';
                let bracketCount = 0;
                let jsonEnd = -1;
                
                for (let i = jsonStart; i < content.length; i++) {
                    if (content[i] === openBracket) bracketCount++;
                    if (content[i] === closeBracket) bracketCount--;
                    if (bracketCount === 0) {
                        jsonEnd = i + 1;
                        break;
                    }
                }
                
                if (jsonEnd !== -1) {
                    try {
                        return JSON.parse(content.substring(jsonStart, jsonEnd));
                    } catch {
                        // Continue to fallback
                    }
                }
            }
            
            // Return default safe response if all parsing fails
            loggingService.warn('Failed to parse AI response helper, returning empty object', {
                contentPreview: content.substring(0, 200)
            });
            return {};
        }
    }

    /**
     * Get vectorized memories with enhanced semantic search
     * Internal method that leverages vector embeddings when available
     */
    async getVectorizedMemories(userId: string, query?: string, limit: number = 5): Promise<MemoryInsight[]> {
        try {
            // Try vector search first if query is provided
            if (query) {
                const vectorResults = await this.performVectorMemorySearch(userId, query, limit);
                if (vectorResults.length > 0) {
                    return vectorResults;
                }
            }

            // Fallback to traditional memory retrieval
            const memories = await UserMemory.find({
                userId,
                isActive: true
            }).sort({ createdAt: -1 }).limit(limit).lean();

            return memories.map(memory => ({
                type: memory.memoryType as 'preference' | 'pattern' | 'security' | 'context',
                content: memory.content,
                confidence: memory.confidence,
                timestamp: memory.createdAt,
                source: memory.source
            }));
        } catch (error) {
            loggingService.error('Failed to get vectorized memories:', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            return [];
        }
    }

    /**
     * Cross-modal search across memory types simultaneously
     * Searches UserMemory, ConversationMemory, and high-value Messages
     */
    async crossModalSearch(userId: string, query: string, options?: {
        includeMemories?: boolean;
        includeConversations?: boolean; 
        includeMessages?: boolean;
        limit?: number;
    }): Promise<{
        memories: MemoryInsight[];
        conversations: SimilarConversation[];
        messages: any[];
        totalResults: number;
    }> {
        const opts = {
            includeMemories: true,
            includeConversations: true,
            includeMessages: true,
            limit: 10,
            ...options
        };

        try {
            loggingService.info('🔍 Starting cross-modal memory search', {
                userId,
                query: query.substring(0, 100),
                options: opts
            });

            const searches: Promise<any>[] = [];
            
            // Search vectorized memories
            if (opts.includeMemories) {
                searches.push(this.performVectorMemorySearch(userId, query, opts.limit));
            }

            // Search conversation memories with vectors
            if (opts.includeConversations) {
                searches.push(this.performVectorConversationSearch(userId, query, opts.limit));
            }

            // Search high-value vectorized messages
            if (opts.includeMessages) {
                searches.push(this.performVectorMessageSearch(userId, query, opts.limit));
            }

            const results = await Promise.all(searches);
            
            const response = {
                memories: opts.includeMemories ? (results[0] || []) : [],
                conversations: opts.includeConversations ? (results[opts.includeMemories ? 1 : 0] || []) : [],
                messages: opts.includeMessages ? (results[searches.length - 1] || []) : [],
                totalResults: 0
            };

            response.totalResults = response.memories.length + response.conversations.length + response.messages.length;

            loggingService.info('✅ Cross-modal search completed', {
                userId,
                totalResults: response.totalResults,
                breakdown: {
                    memories: response.memories.length,
                    conversations: response.conversations.length,
                    messages: response.messages.length
                }
            });

            return response;
        } catch (error) {
            loggingService.error('❌ Cross-modal search failed:', {
                error: error instanceof Error ? error.message : String(error),
                userId,
                query: query.substring(0, 100)
            });

            return {
                memories: [],
                conversations: [],
                messages: [],
                totalResults: 0
            };
        }
    }

    /**
     * Generate contextual insights using vectorized data
     * Creates personalized recommendations based on cross-modal patterns
     */
    async generateContextualInsights(userId: string, currentQuery?: string): Promise<{
        personalizedRecommendations: string[];
        behaviorPatterns: string[];
        contextualTips: string[];
    }> {
        try {
            // Get cross-modal context
            const context = currentQuery 
                ? await this.crossModalSearch(userId, currentQuery, { limit: 5 })
                : await this.getUserMemoryContext(userId);

            // Generate insights using AI
            const insightsPrompt = `Based on this user's memory and conversation patterns, generate personalized insights:

USER CONTEXT:
Memories: ${context.memories.map(m => `${m.type}: ${m.content.substring(0, 100)}`).join('\n')}
Recent Conversations: ${context.conversations.map(c => `Q: ${c.query.substring(0, 80)}`).join('\n')}
${currentQuery ? `Current Query: ${currentQuery}` : ''}

Generate insights as JSON:
{
  "personalizedRecommendations": ["rec1", "rec2", "rec3"],
  "behaviorPatterns": ["pattern1", "pattern2"],
  "contextualTips": ["tip1", "tip2"]
}

Focus on cost optimization, AI model usage, and technical preferences.`;

            const response = await this.memoryAgent.invoke([new HumanMessage(insightsPrompt)]);
            const insights = this.parseAIResponseHelper(response.content.toString());

            return {
                personalizedRecommendations: insights.personalizedRecommendations || [],
                behaviorPatterns: insights.behaviorPatterns || [],
                contextualTips: insights.contextualTips || []
            };
        } catch (error) {
            loggingService.error('Failed to generate contextual insights:', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });

            return {
                personalizedRecommendations: [],
                behaviorPatterns: [],
                contextualTips: []
            };
        }
    }

    /**
     * Enhanced prompt enhancement using full vector context
     * Improves the existing enhancePromptWithMemory with cross-modal intelligence
     */
    async enhanceWithVectorContext(state: {
        query: string;
        userId: string;
        memoryInsights?: MemoryInsight[];
        userPreferences?: any;
        similarConversations?: SimilarConversation[];
        personalizedRecommendations?: string[];
    }): Promise<string> {
        try {
            // Get enhanced context using cross-modal search
            const vectorContext = await this.crossModalSearch(state.userId, state.query, { limit: 3 });
            
            // Combine existing context with vector context
            const enhancedMemoryInsights = [
                ...(state.memoryInsights || []),
                ...vectorContext.memories
            ];

            const enhancedConversations = [
                ...(state.similarConversations || []),
                ...vectorContext.conversations
            ];

            // Generate contextual insights if not provided
            const insights = await this.generateContextualInsights(state.userId, state.query);

            const enhancementPrompt = `Enhance this user query with comprehensive memory context:

Original Query: "${state.query}"

ENHANCED MEMORY CONTEXT:
${enhancedMemoryInsights.map(insight => `- ${insight.type}: ${insight.content.substring(0, 150)}`).join('\n')}

USER PREFERENCES:
${state.userPreferences ? `
- Preferred Model: ${state.userPreferences.preferredModel || 'Not set'}
- Technical Level: ${state.userPreferences.technicalLevel || 'Not set'}
- Response Length: ${state.userPreferences.responseLength || 'Not set'}
- Common Topics: ${state.userPreferences.commonTopics?.join(', ') || 'None'}
` : 'No preferences set'}

SIMILAR PAST CONVERSATIONS:
${enhancedConversations.map(conv => `- "${conv.query.substring(0, 100)}" (similarity: ${conv.similarity?.toFixed(2) || 'N/A'})`).join('\n')}

HIGH-VALUE MESSAGES CONTEXT:
${vectorContext.messages.map(msg => `- [${msg.role}]: ${msg.contentPreview?.substring(0, 100) || 'No preview'}`).join('\n')}

PERSONALIZED INSIGHTS:
${insights.personalizedRecommendations.map(rec => `- ${rec}`).join('\n')}

BEHAVIORAL PATTERNS:
${insights.behaviorPatterns.map(pattern => `- ${pattern}`).join('\n')}

Create an enhanced version of the query that incorporates relevant context.
The enhanced query should:
1. Reference relevant past conversations and solutions
2. Adjust complexity based on user's technical level and patterns
3. Include user preferences and behavioral insights where relevant
4. Maintain the original intent while adding helpful context
5. Leverage cross-modal intelligence from memories, conversations, and messages

Return only the enhanced query, no other text.`;

            const response = await this.memoryAgent.invoke([new HumanMessage(enhancementPrompt)]);
            const enhancedQuery = response.content.toString().trim();

            loggingService.info('🎯 Enhanced query with vector context', {
                originalLength: state.query.length,
                enhancedLength: enhancedQuery.length,
                contextSources: {
                    memories: enhancedMemoryInsights.length,
                    conversations: enhancedConversations.length,
                    messages: vectorContext.messages.length
                }
            });

            return enhancedQuery;
        } catch (error) {
            loggingService.error('❌ Failed to enhance with vector context:', {
                error: error instanceof Error ? error.message : String(error)
            });
            return state.query;
        }
    }

    // ============================================================================
    // PRIVATE VECTOR SEARCH METHODS
    // ============================================================================

    /**
     * Perform vector search on user memories
     */
    private async performVectorMemorySearch(userId: string, query: string, limit: number): Promise<MemoryInsight[]> {
        try {
            // Use MongoDB vector search if embeddings are available
            const pipeline = [
                {
                    $vectorSearch: {
                        index: "usermemory_semantic_index",
                        path: "semanticEmbedding",
                        queryVector: await this.generateQueryEmbedding(query),
                        numCandidates: limit * 10,
                        limit: limit,
                        filter: { userId, isActive: true }
                    }
                },
                {
                    $addFields: {
                        score: { $meta: "vectorSearchScore" }
                    }
                },
                {
                    $match: {
                        score: { $gte: 0.7 } // Similarity threshold
                    }
                }
            ];

            const results = await UserMemory.aggregate(pipeline);
            
            return results.map(memory => ({
                type: memory.memoryType as 'preference' | 'pattern' | 'security' | 'context',
                content: memory.content,
                confidence: memory.confidence * (memory.score || 1), // Boost confidence with similarity
                timestamp: memory.createdAt,
                source: `${memory.source} (vector search)`
            }));
        } catch (error) {
            // Fallback to traditional search
            loggingService.warn('Vector search failed, using fallback:', {
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }

    /**
     * Perform vector search on conversation memories
     */
    private async performVectorConversationSearch(userId: string, query: string, limit: number): Promise<SimilarConversation[]> {
        try {
            const pipeline = [
                {
                    $vectorSearch: {
                        index: "conversation_semantic_index",
                        path: "queryEmbedding",
                        queryVector: await this.generateQueryEmbedding(query),
                        numCandidates: limit * 10,
                        limit: limit,
                        filter: { userId, isArchived: false }
                    }
                },
                {
                    $addFields: {
                        score: { $meta: "vectorSearchScore" }
                    }
                },
                {
                    $match: {
                        score: { $gte: 0.6 }
                    }
                }
            ];

            const results = await ConversationMemory.aggregate(pipeline);
            
            return results.map(conv => ({
                conversationId: conv.conversationId,
                query: conv.query,
                response: conv.response,
                similarity: conv.score || 0,
                timestamp: conv.createdAt,
                metadata: { ...conv.metadata, vectorSearch: true }
            }));
        } catch (error) {
            loggingService.warn('Conversation vector search failed:', {
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }

    /**
     * Perform vector search on high-value messages
     */
    private async performVectorMessageSearch(userId: string, query: string, limit: number): Promise<any[]> {
        try {
            const pipeline = [
                {
                    $vectorSearch: {
                        index: "message_semantic_index",
                        path: "semanticEmbedding",
                        queryVector: await this.generateQueryEmbedding(query),
                        numCandidates: limit * 10,
                        limit: limit,
                        filter: { isVectorized: true }
                    }
                },
                {
                    $addFields: {
                        score: { $meta: "vectorSearchScore" }
                    }
                },
                {
                    $match: {
                        score: { $gte: 0.65 }
                    }
                }
            ];

            const results = await Message.aggregate(pipeline);
            return results;
        } catch (error) {
            loggingService.warn('Message vector search failed:', {
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }

    /**
     * Generate query embedding for vector search
     */
    private async generateQueryEmbedding(query: string): Promise<number[]> {
        try {
            // Validate input - AWS Bedrock requires minLength: 1
            if (!query || query.trim().length === 0) {
                loggingService.warn('Empty query provided to generateQueryEmbedding, returning zero vector');
                return new Array(1024).fill(0);
            }

            // Use SafeBedrockEmbeddings for automatic validation
            const { createSafeBedrockEmbeddings } = await import("./safeBedrockEmbeddings");
            const embeddings = createSafeBedrockEmbeddings({
                model: 'amazon.titan-embed-text-v2:0'
            });
            
            return await embeddings.embedQuery(query.trim());
        } catch (error) {
            loggingService.error('Failed to generate query embedding:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get user memory context for insights generation
     */
    private async getUserMemoryContext(userId: string): Promise<{
        memories: MemoryInsight[];
        conversations: SimilarConversation[];
        messages: any[];
        totalResults: number;
    }> {
        try {
            const [memories, conversations, messages] = await Promise.all([
                UserMemory.find({ userId, isActive: true }).limit(5).lean(),
                ConversationMemory.find({ userId, isArchived: false }).sort({ createdAt: -1 }).limit(3).lean(),
                Message.find({ isVectorized: true }).sort({ createdAt: -1 }).limit(2).lean()
            ]);

            return {
                memories: memories.map(m => ({
                    type: m.memoryType as 'preference' | 'pattern' | 'security' | 'context',
                    content: m.content,
                    confidence: m.confidence,
                    timestamp: m.createdAt,
                    source: m.source
                })),
                conversations: conversations.map(c => ({
                    conversationId: c.conversationId,
                    query: c.query,
                    response: c.response,
                    similarity: 0.8, // Default high similarity for recent conversations
                    timestamp: c.createdAt,
                    metadata: c.metadata
                })),
                messages,
                totalResults: memories.length + conversations.length + messages.length
            };
        } catch (error) {
            loggingService.error('Failed to get user memory context:', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            return { memories: [], conversations: [], messages: [], totalResults: 0 };
        }
    }

}

export const memoryService = new MemoryService();