import { loggingService } from '../services/logging.service';
import { ChatBedrockConverse } from "@langchain/aws";
import { HumanMessage } from "@langchain/core/messages";
import { UserMemory, ConversationMemory } from '../models/Memory';
import { Message } from '../models/Message';
import { vectorMemoryService } from '../services/vectorMemory.service';
import { redisService } from './redis.service';

export interface UserBehaviorPattern {
    userId: string;
    patterns: {
        preferredTopics: string[];
        queryComplexity: 'simple' | 'moderate' | 'complex';
        responsePreference: 'concise' | 'detailed' | 'comprehensive';
        technicalLevel: 'beginner' | 'intermediate' | 'expert';
        costSensitivity: 'low' | 'medium' | 'high';
        peakUsageHours: number[];
        commonQuestionTypes: string[];
    };
    confidence: number;
    lastAnalyzed: Date;
    sampleSize: number;
}

export interface PredictiveInsight {
    type: 'cost_optimization' | 'usage_pattern' | 'behavior_prediction' | 'recommendation';
    insight: string;
    confidence: number;
    actionable: boolean;
    estimatedImpact: 'low' | 'medium' | 'high';
    category: string;
    metadata: any;
}

export interface CrossDomainConnection {
    sourceType: 'memory' | 'conversation' | 'message';
    targetType: 'memory' | 'conversation' | 'message';
    connectionType: 'causal' | 'temporal' | 'semantic' | 'behavioral';
    strength: number;
    description: string;
    examples: string[];
}

/**
 * Cross-Modal Intelligence Engine
 * Generates insights by connecting patterns across UserMemory, ConversationMemory, and Messages
 * Runs in background to provide contextual intelligence for enhanced user experiences
 */
export class CrossModalIntelligenceService {
    private static instance: CrossModalIntelligenceService;
    private intelligenceAgent: ChatBedrockConverse;
    private readonly ANALYSIS_CACHE_TTL = 6 * 60 * 60; // 6 hours
    private readonly MIN_SAMPLE_SIZE = 5; // Minimum data points for reliable analysis

    private constructor() {
        this.intelligenceAgent = new ChatBedrockConverse({
            model: "amazon.nova-pro-v1:0",
            region: process.env.AWS_REGION ?? 'us-east-1',
            temperature: 0.2, // Low temperature for consistent analysis
            maxTokens: 3000,
        });
    }

    static getInstance(): CrossModalIntelligenceService {
        if (!CrossModalIntelligenceService.instance) {
            CrossModalIntelligenceService.instance = new CrossModalIntelligenceService();
        }
        return CrossModalIntelligenceService.instance;
    }

    /**
     * Analyze user behavior patterns across all data types
     */
    async analyzeUserBehaviorPatterns(userId: string, forceRefresh: boolean = false): Promise<UserBehaviorPattern> {
        try {
            const cacheKey = `behavior_pattern:${userId}`;
            
            // Check cache first unless force refresh
            if (!forceRefresh) {
                const cached = await redisService.get(cacheKey);
                if (cached) {
                    return typeof cached === 'string' ? JSON.parse(cached) : cached;
                }
            }

            loggingService.info('🧠 Analyzing user behavior patterns', { userId });

            // Gather data from all sources
            const [memories, conversations, messages] = await Promise.all([
                UserMemory.find({ userId, isActive: true }).limit(50).lean(),
                ConversationMemory.find({ userId, isArchived: false }).sort({ createdAt: -1 }).limit(30).lean(),
                Message.find({ isVectorized: true }).sort({ createdAt: -1 }).limit(20).lean()
            ]);

            const totalSamples = memories.length + conversations.length + messages.length;
            
            if (totalSamples < this.MIN_SAMPLE_SIZE) {
                // Return default pattern for new users
                const defaultPattern = this.createDefaultBehaviorPattern(userId);
                await redisService.set(cacheKey, defaultPattern, this.ANALYSIS_CACHE_TTL);
                return defaultPattern;
            }

            // Analyze patterns using AI
            const behaviorAnalysis = await this.generateBehaviorAnalysis(memories, conversations, messages);
            
            const behaviorPattern: UserBehaviorPattern = {
                userId,
                patterns: behaviorAnalysis.patterns,
                confidence: Math.min(0.95, totalSamples / 50), // Higher confidence with more samples
                lastAnalyzed: new Date(),
                sampleSize: totalSamples
            };

            // Cache the analysis
            await redisService.set(cacheKey, behaviorPattern, this.ANALYSIS_CACHE_TTL);

            loggingService.info('✅ Behavior pattern analysis completed', {
                userId,
                confidence: behaviorPattern.confidence,
                sampleSize: totalSamples
            });

            return behaviorPattern;
        } catch (error) {
            loggingService.error('❌ Behavior pattern analysis failed:', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            
            return this.createDefaultBehaviorPattern(userId);
        }
    }

    /**
     * Generate predictive insights based on cross-modal patterns
     */
    async generatePredictiveInsights(userId: string, currentContext?: string): Promise<PredictiveInsight[]> {
        try {
            loggingService.info('🔮 Generating predictive insights', { userId });

            // Get behavior patterns
            const behaviorPattern = await this.analyzeUserBehaviorPatterns(userId);
            
            // Get recent cross-modal search results if context provided
            let contextualData: any = {};
            if (currentContext) {
                contextualData = await vectorMemoryService.crossModelSearch(currentContext, userId, {
                    includeConversations: true,
                    includeMemories: true,
                    includeMessages: true,
                    limit: 5
                });
            }

            // Generate insights using AI
            const insights = await this.generateAIPredictiveInsights(behaviorPattern, contextualData, currentContext);

            loggingService.info('✅ Predictive insights generated', {
                userId,
                insightCount: insights.length,
                categories: insights.map(i => i.category)
            });

            return insights;
        } catch (error) {
            loggingService.error('❌ Predictive insights generation failed:', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            return [];
        }
    }

    /**
     * Discover connections between different data types
     */
    async discoverCrossDomainConnections(userId: string): Promise<CrossDomainConnection[]> {
        try {
            loggingService.info('🔗 Discovering cross-domain connections', { userId });

            // Get sample data from each domain
            const [memories, conversations, messages] = await Promise.all([
                UserMemory.find({ 
                    userId, 
                    isActive: true,
                    semanticEmbedding: { $exists: true }
                }).limit(10).lean(),
                ConversationMemory.find({ 
                    userId, 
                    isArchived: false,
                    queryEmbedding: { $exists: true }
                }).limit(10).lean(),
                Message.find({ 
                    isVectorized: true,
                    semanticEmbedding: { $exists: true }
                }).limit(5).lean()
            ]);

            const connections: CrossDomainConnection[] = [];

            // Analyze semantic connections using vector similarity
            connections.push(...await this.findSemanticConnections(memories, conversations, messages));
            
            // Analyze temporal patterns
            connections.push(...await this.findTemporalConnections(memories, conversations, messages));
            
            // Analyze behavioral connections using AI
            connections.push(...await this.findBehavioralConnections(memories, conversations, messages));

            loggingService.info('✅ Cross-domain connections discovered', {
                userId,
                connectionCount: connections.length,
                types: connections.map(c => c.connectionType)
            });

            return connections;
        } catch (error) {
            loggingService.error('❌ Cross-domain connection discovery failed:', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            return [];
        }
    }

    /**
     * Update user context models continuously
     */
    async updateUserContextModel(userId: string, newInteraction: {
        type: 'memory' | 'conversation' | 'message';
        content: string;
        metadata?: any;
    }): Promise<void> {
        try {
            loggingService.info('🔄 Updating user context model', { userId, type: newInteraction.type });

            // Get current behavior pattern
            const currentPattern = await this.analyzeUserBehaviorPatterns(userId);
            
            // Analyze the impact of new interaction
            const impactAnalysis = await this.analyzeInteractionImpact(newInteraction, currentPattern);
            
            // Update context model incrementally
            if (impactAnalysis.significantChange) {
                // Force refresh of behavior pattern
                await this.analyzeUserBehaviorPatterns(userId, true);
                
                // Generate new insights based on updated pattern
                await this.generatePredictiveInsights(userId);
                
                loggingService.info('📊 Context model updated with significant changes', {
                    userId,
                    impactScore: impactAnalysis.impactScore
                });
            } else {
                loggingService.info('📊 Context model updated incrementally', {
                    userId,
                    impactScore: impactAnalysis.impactScore
                });
            }
        } catch (error) {
            loggingService.error('❌ Context model update failed:', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
        }
    }

    /**
     * Provide enhanced context for existing memory enhancement functions
     */
    async getEnhancedMemoryContext(userId: string, query: string): Promise<{
        behaviorPattern: UserBehaviorPattern;
        predictiveInsights: PredictiveInsight[];
        crossDomainConnections: CrossDomainConnection[];
        contextualRecommendations: string[];
    }> {
        try {
            loggingService.info('🎯 Getting enhanced memory context', { userId });

            // Run all analyses in parallel
            const [behaviorPattern, predictiveInsights, crossDomainConnections] = await Promise.all([
                this.analyzeUserBehaviorPatterns(userId),
                this.generatePredictiveInsights(userId, query),
                this.discoverCrossDomainConnections(userId)
            ]);

            // Generate contextual recommendations
            const contextualRecommendations = await this.generateContextualRecommendations(
                behaviorPattern,
                predictiveInsights,
                crossDomainConnections,
                query
            );

            return {
                behaviorPattern,
                predictiveInsights,
                crossDomainConnections,
                contextualRecommendations
            };
        } catch (error) {
            loggingService.error('❌ Enhanced memory context retrieval failed:', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            
            // Return minimal context on error
            return {
                behaviorPattern: this.createDefaultBehaviorPattern(userId),
                predictiveInsights: [],
                crossDomainConnections: [],
                contextualRecommendations: []
            };
        }
    }

    // ============================================================================
    // PRIVATE ANALYSIS METHODS
    // ============================================================================

    /**
     * Generate behavior analysis using AI
     */
    private async generateBehaviorAnalysis(
        memories: any[],
        conversations: any[],
        messages: any[]
    ): Promise<{ patterns: UserBehaviorPattern['patterns'] }> {
        try {
            const analysisPrompt = `Analyze user behavior patterns from this data:

MEMORIES (${memories.length} items):
${memories.map((m, i) => `${i+1}. [${m.memoryType}]: ${m.content.substring(0, 100)}`).join('\n')}

CONVERSATIONS (${conversations.length} items):
${conversations.map((c, i) => `${i+1}. Q: "${c.query.substring(0, 80)}" A: "${c.response.substring(0, 80)}"`).join('\n')}

MESSAGES (${messages.length} items):
${messages.map((msg, i) => `${i+1}. [${msg.role}]: ${msg.contentPreview?.substring(0, 80) || 'No preview'}`).join('\n')}

Analyze patterns and respond with JSON:
{
  "patterns": {
    "preferredTopics": ["topic1", "topic2"],
    "queryComplexity": "simple|moderate|complex",
    "responsePreference": "concise|detailed|comprehensive", 
    "technicalLevel": "beginner|intermediate|expert",
    "costSensitivity": "low|medium|high",
    "peakUsageHours": [hour1, hour2],
    "commonQuestionTypes": ["type1", "type2"]
  }
}

Focus on AI cost optimization, technical preferences, and usage patterns.`;

            const response = await this.intelligenceAgent.invoke([new HumanMessage(analysisPrompt)]);
            const analysis = this.parseAIResponse(response.content.toString());
            
            return analysis;
        } catch (error) {
            loggingService.error('Failed to generate behavior analysis:', {
                error: error instanceof Error ? error.message : String(error)
            });
            
            return {
                patterns: {
                    preferredTopics: ['cost optimization', 'ai models'],
                    queryComplexity: 'moderate',
                    responsePreference: 'detailed',
                    technicalLevel: 'intermediate',
                    costSensitivity: 'medium',
                    peakUsageHours: [9, 14, 16],
                    commonQuestionTypes: ['how-to', 'optimization']
                }
            };
        }
    }

    /**
     * Generate AI-powered predictive insights
     */
    private async generateAIPredictiveInsights(
        behaviorPattern: UserBehaviorPattern,
        contextualData: any,
        currentContext?: string
    ): Promise<PredictiveInsight[]> {
        try {
            const insightsPrompt = `Based on user behavior patterns and context, generate predictive insights:

USER BEHAVIOR PATTERN:
- Preferred Topics: ${behaviorPattern.patterns.preferredTopics.join(', ')}
- Technical Level: ${behaviorPattern.patterns.technicalLevel}
- Cost Sensitivity: ${behaviorPattern.patterns.costSensitivity}
- Response Preference: ${behaviorPattern.patterns.responsePreference}
- Common Question Types: ${behaviorPattern.patterns.commonQuestionTypes.join(', ')}

${currentContext ? `CURRENT CONTEXT: ${currentContext}` : ''}

${contextualData.totalResults ? `
CONTEXTUAL DATA:
- Memories: ${contextualData.memories?.length || 0} relevant items
- Conversations: ${contextualData.conversations?.length || 0} similar discussions
- Messages: ${contextualData.messages?.length || 0} related messages
` : ''}

Generate 3-5 predictive insights as JSON array:
[{
  "type": "cost_optimization|usage_pattern|behavior_prediction|recommendation",
  "insight": "Specific insight text",
  "confidence": 0.0-1.0,
  "actionable": true/false,
  "estimatedImpact": "low|medium|high",
  "category": "category_name",
  "metadata": {}
}]

Focus on actionable cost optimization and usage improvement insights.`;

            const response = await this.intelligenceAgent.invoke([new HumanMessage(insightsPrompt)]);
            const insights = this.parseAIResponse(response.content.toString());
            
            return Array.isArray(insights) ? insights : [];
        } catch (error) {
            loggingService.error('Failed to generate AI predictive insights:', {
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }

    /**
     * Find semantic connections using vector similarity
     */
    private async findSemanticConnections(
        memories: any[],
        conversations: any[],
        _messages: any[]
    ): Promise<CrossDomainConnection[]> {
        const connections: CrossDomainConnection[] = [];
        
        try {
            // Compare memories with conversations (semantic similarity)
            for (const memory of memories.slice(0, 5)) {
                if (!memory.semanticEmbedding) continue;
                
                for (const conv of conversations.slice(0, 5)) {
                    if (!conv.queryEmbedding) continue;
                    
                    const similarity = this.calculateCosineSimilarity(
                        memory.semanticEmbedding,
                        conv.queryEmbedding
                    );
                    
                    if (similarity > 0.8) {
                        connections.push({
                            sourceType: 'memory',
                            targetType: 'conversation',
                            connectionType: 'semantic',
                            strength: similarity,
                            description: `Memory about "${memory.content.substring(0, 50)}" relates to conversation "${conv.query.substring(0, 50)}"`,
                            examples: [memory.content.substring(0, 100), conv.query.substring(0, 100)]
                        });
                    }
                }
            }
            
            return connections;
        } catch (error) {
            loggingService.error('Failed to find semantic connections:', {
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }

    /**
     * Find temporal connections between data points
     */
    private async findTemporalConnections(
        memories: any[],
        conversations: any[],
        messages: any[]
    ): Promise<CrossDomainConnection[]> {
        const connections: CrossDomainConnection[] = [];
        
        try {
            // Find temporal patterns (e.g., conversations followed by memory updates)
            const sortedData = [
                ...memories.map(m => ({ ...m, type: 'memory' })),
                ...conversations.map(c => ({ ...c, type: 'conversation' })),
                ...messages.map(msg => ({ ...msg, type: 'message' }))
            ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

            for (let i = 0; i < sortedData.length - 1; i++) {
                const current = sortedData[i];
                const next = sortedData[i + 1];
                
                const timeDiff = new Date(next.createdAt).getTime() - new Date(current.createdAt).getTime();
                const hoursDiff = timeDiff / (1000 * 60 * 60);
                
                // Look for patterns within 24 hours
                if (hoursDiff <= 24 && current.type !== next.type) {
                    connections.push({
                        sourceType: current.type as any,
                        targetType: next.type as any,
                        connectionType: 'temporal',
                        strength: Math.max(0.1, 1 - (hoursDiff / 24)), // Stronger connection for closer time
                        description: `${current.type} at ${new Date(current.createdAt).toLocaleString()} followed by ${next.type}`,
                        examples: [
                            current.content || current.query || current.contentPreview || 'No content',
                            next.content || next.query || next.contentPreview || 'No content'
                        ]
                    });
                }
            }
            
            return connections;
        } catch (error) {
            loggingService.error('Failed to find temporal connections:', {
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }

    /**
     * Find behavioral connections using AI analysis
     */
    private async findBehavioralConnections(
        memories: any[],
        conversations: any[],
        messages: any[]
    ): Promise<CrossDomainConnection[]> {
        try {
            const behaviorPrompt = `Analyze behavioral connections between these data points:

MEMORIES: ${memories.map(m => m.content.substring(0, 80)).join(' | ')}
CONVERSATIONS: ${conversations.map(c => c.query.substring(0, 80)).join(' | ')}
MESSAGES: ${messages.map(msg => msg.contentPreview?.substring(0, 80) || 'No preview').join(' | ')}

Find behavioral patterns and causal relationships. Return JSON array:
[{
  "sourceType": "memory|conversation|message",
  "targetType": "memory|conversation|message", 
  "connectionType": "causal|behavioral",
  "strength": 0.0-1.0,
  "description": "Connection description",
  "examples": ["example1", "example2"]
}]`;

            const response = await this.intelligenceAgent.invoke([new HumanMessage(behaviorPrompt)]);
            const connections = this.parseAIResponse(response.content.toString());
            
            return Array.isArray(connections) ? connections : [];
        } catch (error) {
            loggingService.error('Failed to find behavioral connections:', {
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }

    /**
     * Analyze interaction impact on user context
     */
    private analyzeInteractionImpact(
        interaction: { type: string; content: string; metadata?: any },
        currentPattern: UserBehaviorPattern
    ): { significantChange: boolean; impactScore: number } {
        try {
            // Simple heuristic-based impact analysis
            let impactScore = 0.1; // Base impact
            
            // Check if interaction introduces new topics
            const currentTopics = currentPattern.patterns.preferredTopics.join(' ').toLowerCase();
            if (!currentTopics.includes(interaction.content.toLowerCase().substring(0, 50))) {
                impactScore += 0.3; // New topic
            }
            
            // Check interaction frequency (higher frequency = higher impact)
            if (currentPattern.sampleSize < 10) {
                impactScore += 0.4; // New user, higher impact
            }
            
            const significantChange = impactScore > 0.5;
            
            return { significantChange, impactScore };
        } catch (error) {
            loggingService.error('Failed to analyze interaction impact:', {
                error: error instanceof Error ? error.message : String(error)
            });
            return { significantChange: false, impactScore: 0.1 };
        }
    }

    /**
     * Generate contextual recommendations
     */
    private async generateContextualRecommendations(
        behaviorPattern: UserBehaviorPattern,
        insights: PredictiveInsight[],
        connections: CrossDomainConnection[],
        query: string
    ): Promise<string[]> {
        try {
            const recPrompt = `Generate contextual recommendations based on:

BEHAVIOR PATTERN:
- Technical Level: ${behaviorPattern.patterns.technicalLevel}
- Cost Sensitivity: ${behaviorPattern.patterns.costSensitivity}
- Preferred Topics: ${behaviorPattern.patterns.preferredTopics.join(', ')}

CURRENT QUERY: ${query}

INSIGHTS: ${insights.map(i => i.insight).join(' | ')}

CONNECTION PATTERNS: ${connections.length} cross-domain connections found

Generate 3-5 specific, actionable recommendations as JSON array of strings:
["recommendation1", "recommendation2", "recommendation3"]

Focus on cost optimization and technical improvements relevant to the user's level and interests.`;

            const response = await this.intelligenceAgent.invoke([new HumanMessage(recPrompt)]);
            const recommendations = this.parseAIResponse(response.content.toString());
            
            return Array.isArray(recommendations) ? recommendations : [
                "Consider optimizing your Claude model usage based on query complexity",
                "Review your peak usage patterns for potential cost savings",
                "Explore batch processing for similar queries to reduce costs"
            ];
        } catch (error) {
            loggingService.error('Failed to generate contextual recommendations:', {
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }

    // ============================================================================
    // UTILITY METHODS
    // ============================================================================

    /**
     * Create default behavior pattern for new users
     */
    private createDefaultBehaviorPattern(userId: string): UserBehaviorPattern {
        return {
            userId,
            patterns: {
                preferredTopics: ['cost optimization', 'ai models', 'general'],
                queryComplexity: 'moderate',
                responsePreference: 'detailed',
                technicalLevel: 'intermediate',
                costSensitivity: 'medium',
                peakUsageHours: [9, 14, 16], // Typical business hours
                commonQuestionTypes: ['how-to', 'optimization', 'troubleshooting']
            },
            confidence: 0.3, // Low confidence for default
            lastAnalyzed: new Date(),
            sampleSize: 0
        };
    }

    /**
     * Parse AI response safely
     */
    private parseAIResponse(content: string): any {
        try {
            const jsonMatch = content.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            throw new Error('No JSON found in response');
        } catch (error) {
            loggingService.error('Failed to parse AI response:', {
                error: error instanceof Error ? error.message : String(error),
                content: content.substring(0, 200)
            });
            return null;
        }
    }

    /**
     * Calculate cosine similarity between vectors
     */
    private calculateCosineSimilarity(vectorA: number[], vectorB: number[]): number {
        try {
            if (vectorA.length !== vectorB.length) return 0;
            
            let dotProduct = 0;
            let normA = 0;
            let normB = 0;
            
            for (let i = 0; i < vectorA.length; i++) {
                dotProduct += vectorA[i] * vectorB[i];
                normA += vectorA[i] * vectorA[i];
                normB += vectorB[i] * vectorB[i];
            }
            
            const denominator = Math.sqrt(normA) * Math.sqrt(normB);
            return denominator === 0 ? 0 : dotProduct / denominator;
        } catch (error) {
            return 0;
        }
    }
}

// Export singleton instance
export const crossModalIntelligenceService = CrossModalIntelligenceService.getInstance();