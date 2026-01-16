import { loggingService } from './logging.service';
import { ChatBedrockConverse } from "@langchain/aws";
import { HumanMessage } from "@langchain/core/messages";
import { Message } from '../models/Message';
import { ConversationMemory } from '../models/Memory';

export interface SamplingCriteria {
    engagementScore: number;     // Based on follow-ups, stars, references (0-1)
    topicRelevance: number;      // Cost optimization, technical solutions (0-1)
    conversationDepth: number;   // Multi-turn conversations with solutions (0-1)
    userBehaviorMatch: number;   // Matches user's typical query patterns (0-1)
    temporalRelevance: number;   // Recent + historically referenced (0-1)
}

export interface MessageAnalysis {
    messageId: string;
    learningValue: number;       // Combined score (0-1)
    criteria: SamplingCriteria;
    selectionReason: string;
    shouldVectorize: boolean;
}

export interface SamplingStats {
    totalAnalyzed: number;
    selectedForVectorization: number;
    selectionRate: number;
    averageLearningValue: number;
    topReasons: Array<{ reason: string; count: number }>;
}

/**
 * Smart Sampling Service
 * Uses AI to identify high-value messages worth vectorizing
 * Implements intelligent selection to target ~10% of messages while capturing 95% of value
 */
export class SmartSamplingService {
    private static instance: SmartSamplingService;
    private analysisAgent: ChatBedrockConverse;
    private readonly MIN_LEARNING_VALUE = 0.5; // Minimum score to consider for vectorization
    private readonly BATCH_SIZE = 50; // Analyze in batches for efficiency

    private constructor() {
        this.analysisAgent = new ChatBedrockConverse({
            model: "amazon.nova-pro-v1:0",
            region: process.env.AWS_REGION ?? 'us-east-1',
            temperature: 0.1, // Low temperature for consistent analysis
            maxTokens: 2000,
        });
    }

    static getInstance(): SmartSamplingService {
        if (!SmartSamplingService.instance) {
            SmartSamplingService.instance = new SmartSamplingService();
        }
        return SmartSamplingService.instance;
    }

    /**
     * Analyze and score messages for vectorization potential
     */
    async analyzeMessages(messageIds?: string[]): Promise<MessageAnalysis[]> {
        try {
            loggingService.info('🎯 Starting smart message analysis');
            
            let query: any = {};
            if (messageIds && messageIds.length > 0) {
                query._id = { $in: messageIds };
            } else {
                // Analyze recent messages that haven't been scored yet
                query = {
                    createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // Last 7 days
                    $or: [
                        { learningValue: { $exists: false } },
                        { learningValue: 0 }
                    ],
                    fullContentStored: true
                };
            }

            const messages = await Message.find(query).limit(1000).lean(); // Limit for performance
            
            if (messages.length === 0) {
                loggingService.info('No messages found for analysis');
                return [];
            }

            loggingService.info(`📊 Analyzing ${messages.length} messages for learning value`);

            const analyses: MessageAnalysis[] = [];
            
            // Process in batches to avoid overwhelming the AI service
            for (let i = 0; i < messages.length; i += this.BATCH_SIZE) {
                const batch = messages.slice(i, i + this.BATCH_SIZE);
                const batchAnalyses = await this.analyzeBatch(batch);
                analyses.push(...batchAnalyses);
                
                // Brief pause between batches
                await new Promise(resolve => setTimeout(resolve, 200));
            }

            // Update messages with learning values
            await this.updateMessageLearningValues(analyses);

            loggingService.info('✅ Message analysis completed', {
                analyzed: analyses.length,
                selectedForVectorization: analyses.filter(a => a.shouldVectorize).length,
                averageLearningValue: analyses.reduce((sum, a) => sum + a.learningValue, 0) / analyses.length
            });

            return analyses;
        } catch (error) {
            loggingService.error('❌ Message analysis failed:', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get comprehensive sampling statistics
     */
    async getSamplingStats(): Promise<SamplingStats> {
        try {
            const [totalMessages, , messageLearningValues] = await Promise.all([
                Message.countDocuments({}),
                Message.countDocuments({ isVectorized: true }),
                Message.find({
                    learningValue: { $exists: true, $gt: 0 }
                }).select('learningValue vectorSelectionReason').lean()
            ]);

            const selectedCount = messageLearningValues.filter(m => (m.learningValue ?? 0) >= this.MIN_LEARNING_VALUE).length;
            const selectionRate = totalMessages > 0 ? selectedCount / totalMessages : 0;
            const averageLearningValue = messageLearningValues.length > 0 
                ? messageLearningValues.reduce((sum, m) => sum + (m.learningValue ?? 0), 0) / messageLearningValues.length
                : 0;

            // Count top selection reasons
            const reasonCounts = new Map<string, number>();
            messageLearningValues.forEach(m => {
                if (m.vectorSelectionReason) {
                    const key = m.vectorSelectionReason.split('.')[0]; // First sentence
                    reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
                }
            });

            const topReasons = Array.from(reasonCounts.entries())
                .map(([reason, count]) => ({ reason, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 5);

            return {
                totalAnalyzed: messageLearningValues.length,
                selectedForVectorization: selectedCount,
                selectionRate,
                averageLearningValue,
                topReasons
            };
        } catch (error) {
            loggingService.error('Failed to get sampling stats:', {
                error: error instanceof Error ? error.message : String(error)
            });
            
            return {
                totalAnalyzed: 0,
                selectedForVectorization: 0,
                selectionRate: 0,
                averageLearningValue: 0,
                topReasons: []
            };
        }
    }

    /**
     * Update selection criteria based on effectiveness
     */
    async updateSelectionCriteria(): Promise<void> {
        try {
            loggingService.info('🔄 Updating smart sampling criteria based on effectiveness');
            
            // Analyze the effectiveness of previously selected messages
            const vectorizedMessages = await Message.find({
                isVectorized: true,
                learningValue: { $exists: true }
            }).select('learningValue vectorSelectionReason createdAt').lean();

            if (vectorizedMessages.length < 10) {
                loggingService.info('Not enough vectorized messages for criteria updates');
                return;
            }

            // Statistical analysis to optimize selection criteria
            const learningValues = vectorizedMessages.map(m => m.learningValue ?? 0);
            const avgLearningValue = learningValues.reduce((sum, val) => sum + val, 0) / learningValues.length;
            const medianLearningValue = learningValues.sort((a, b) => a - b)[Math.floor(learningValues.length / 2)];
            const stdDev = Math.sqrt(
                learningValues.reduce((sum, val) => sum + Math.pow(val - avgLearningValue, 2), 0) / learningValues.length
            );

            // Analyze effectiveness by checking if selected messages are actually being used
            // (This would require tracking message usage, for now we use learning value distribution)
            const highValueMessages = learningValues.filter(v => v >= 0.7).length;
            const mediumValueMessages = learningValues.filter(v => v >= 0.5 && v < 0.7).length;
            const lowValueMessages = learningValues.filter(v => v < 0.5).length;

            // Calculate optimal threshold using statistical methods
            // If we have many high-value messages, we can be more selective
            // If we have many low-value messages, we should raise the threshold
            const highValueRatio = highValueMessages / vectorizedMessages.length;
            const lowValueRatio = lowValueMessages / vectorizedMessages.length;

            // Adaptive threshold adjustment
            let suggestedThreshold = this.MIN_LEARNING_VALUE;
            if (highValueRatio > 0.3 && avgLearningValue > 0.65) {
                // Many high-value messages - can be more selective
                suggestedThreshold = Math.min(0.6, this.MIN_LEARNING_VALUE + 0.1);
                loggingService.info('📈 High-quality messages detected - suggesting higher threshold', {
                    suggestedThreshold,
                    highValueRatio
                });
            } else if (lowValueRatio > 0.4 && avgLearningValue < 0.55) {
                // Many low-value messages - should raise threshold
                suggestedThreshold = Math.min(0.6, this.MIN_LEARNING_VALUE + 0.05);
                loggingService.info('📉 Low-quality messages detected - suggesting higher threshold', {
                    suggestedThreshold,
                    lowValueRatio
                });
            }

            // Analyze criteria weights effectiveness
            // Check which criteria correlate with high learning values
            const criteriaAnalysis = {
                avgLearningValue,
                medianLearningValue,
                stdDev,
                highValueRatio,
                mediumValueRatio: mediumValueMessages / vectorizedMessages.length,
                lowValueRatio,
                suggestedThreshold,
                totalAnalyzed: vectorizedMessages.length,
                distribution: {
                    high: highValueMessages,
                    medium: mediumValueMessages,
                    low: lowValueMessages
                }
            };

            // Store analysis for future ML model training
            // In production, this could feed into a reinforcement learning model
            loggingService.info('📊 Selection criteria analysis complete', criteriaAnalysis);

            // Optional: Store suggested threshold in Redis for dynamic adjustment
            // For now, we log it for manual review
            if (suggestedThreshold !== this.MIN_LEARNING_VALUE) {
                loggingService.info('💡 Suggested threshold adjustment', {
                    current: this.MIN_LEARNING_VALUE,
                    suggested: suggestedThreshold,
                    reason: highValueRatio > 0.3 ? 'high_quality_detected' : 'low_quality_detected'
                });
            }

        } catch (error) {
            loggingService.error('Failed to update selection criteria:', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Analyze a batch of messages using AI
     */
    private async analyzeBatch(messages: any[]): Promise<MessageAnalysis[]> {
        try {
            const analyses: MessageAnalysis[] = [];
            
            for (const message of messages) {
                const analysis = await this.analyzeMessage(message);
                analyses.push(analysis);
            }
            
            return analyses;
        } catch (error) {
            loggingService.error('Batch analysis failed:', {
                error: error instanceof Error ? error.message : String(error),
                batchSize: messages.length
            });
            
            // Return default low scores for the batch
            return messages.map(msg => ({
                messageId: msg._id.toString(),
                learningValue: 0.1,
                criteria: {
                    engagementScore: 0.1,
                    topicRelevance: 0.1,
                    conversationDepth: 0.1,
                    userBehaviorMatch: 0.1,
                    temporalRelevance: 0.1
                },
                selectionReason: 'Analysis failed, assigned low score',
                shouldVectorize: false
            }));
        }
    }

    /**
     * Analyze a single message for learning value
     */
    private async analyzeMessage(message: any): Promise<MessageAnalysis> {
        try {
            // Get conversation context
            const conversationMessages = await Message.find({
                sessionId: message.sessionId,
                timestamp: { $lte: message.timestamp }
            }).sort({ timestamp: 1 }).limit(10).lean();

            // Get user's conversation patterns for this user (if available)
            const userConversations = await ConversationMemory.find({
                userId: message.userId || 'unknown'
            }).limit(5).lean();

            const analysisPrompt = this.buildAnalysisPrompt(message, conversationMessages, userConversations);
            
            const response = await this.analysisAgent.invoke([new HumanMessage(analysisPrompt)]);
            const analysis = this.parseAnalysisResponse(response.content.toString(), message._id.toString());
            
            return analysis;
        } catch (error) {
            loggingService.error('Individual message analysis failed:', {
                error: error instanceof Error ? error.message : String(error),
                messageId: message._id
            });
            
            // Return conservative low score
            return {
                messageId: message._id.toString(),
                learningValue: 0.2,
                criteria: {
                    engagementScore: 0.2,
                    topicRelevance: 0.2,
                    conversationDepth: 0.2,
                    userBehaviorMatch: 0.2,
                    temporalRelevance: 0.2
                },
                selectionReason: 'Analysis error, conservative scoring',
                shouldVectorize: false
            };
        }
    }

    /**
     * Build AI analysis prompt
     */
    private buildAnalysisPrompt(message: any, conversationHistory: any[], userPatterns: any[]): string {
        return `Analyze this message for vectorization learning value. Score each criterion 0-1:

MESSAGE TO ANALYZE:
Role: ${message.role}
Content: "${message.contentPreview}"
Timestamp: ${message.timestamp}
Has Attachments: ${message.attachments && message.attachments.length > 0}

CONVERSATION CONTEXT:
${conversationHistory.map((msg, i) => `${i+1}. [${msg.role}]: ${msg.contentPreview.substring(0, 100)}`).join('\n')}

USER PATTERN CONTEXT:
${userPatterns.map((conv, i) => `Pattern ${i+1}: "${conv.query.substring(0, 80)}"`).join('\n')}

SCORING CRITERIA (0.0 to 1.0):
1. ENGAGEMENT SCORE: Does this message lead to follow-ups, solutions, or ongoing discussion?
2. TOPIC RELEVANCE: Is this about cost optimization, AI models, technical solutions, or business decisions?
3. CONVERSATION DEPTH: Is this part of a multi-turn conversation that reaches meaningful conclusions?
4. USER BEHAVIOR MATCH: Does this fit patterns of queries this user typically finds valuable?
5. TEMPORAL RELEVANCE: Is this recent or does it contain timeless valuable information?

OUTPUT FORMAT (JSON):
{
  "engagementScore": 0.0,
  "topicRelevance": 0.0,
  "conversationDepth": 0.0,
  "userBehaviorMatch": 0.0,
  "temporalRelevance": 0.0,
  "overallValue": 0.0,
  "reasoning": "Brief explanation why this message has learning value",
  "shouldVectorize": true/false
}

Focus on messages that contain solutions, technical insights, cost optimizations, or represent valuable user learning patterns.`;
    }

    /**
     * Parse AI analysis response
     */
    private parseAnalysisResponse(response: string, messageId: string): MessageAnalysis {
        try {
            // Extract JSON from response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No JSON found in response');
            }

            const parsed = JSON.parse(jsonMatch[0]);
            
            const criteria: SamplingCriteria = {
                engagementScore: Math.max(0, Math.min(1, parsed.engagementScore || 0)),
                topicRelevance: Math.max(0, Math.min(1, parsed.topicRelevance || 0)),
                conversationDepth: Math.max(0, Math.min(1, parsed.conversationDepth || 0)),
                userBehaviorMatch: Math.max(0, Math.min(1, parsed.userBehaviorMatch || 0)),
                temporalRelevance: Math.max(0, Math.min(1, parsed.temporalRelevance || 0))
            };

            // Calculate learning value as weighted average
            const learningValue = (
                criteria.engagementScore * 0.25 +
                criteria.topicRelevance * 0.30 +
                criteria.conversationDepth * 0.20 +
                criteria.userBehaviorMatch * 0.15 +
                criteria.temporalRelevance * 0.10
            );

            const shouldVectorize = learningValue >= this.MIN_LEARNING_VALUE && (parsed.shouldVectorize === true);

            return {
                messageId,
                learningValue,
                criteria,
                selectionReason: parsed.reasoning || 'AI analysis completed',
                shouldVectorize
            };
        } catch (error) {
            loggingService.error('Failed to parse analysis response:', {
                error: error instanceof Error ? error.message : String(error),
                response: response.substring(0, 200)
            });
            
            // Return conservative fallback
            return {
                messageId,
                learningValue: 0.3,
                criteria: {
                    engagementScore: 0.3,
                    topicRelevance: 0.3,
                    conversationDepth: 0.3,
                    userBehaviorMatch: 0.3,
                    temporalRelevance: 0.3
                },
                selectionReason: 'Parse error, conservative scoring',
                shouldVectorize: false
            };
        }
    }

    /**
     * Update messages with calculated learning values
     */
    private async updateMessageLearningValues(analyses: MessageAnalysis[]): Promise<void> {
        try {
            const bulkOps = analyses.map(analysis => ({
                updateOne: {
                    filter: { _id: analysis.messageId },
                    update: {
                        $set: {
                            learningValue: analysis.learningValue,
                            vectorSelectionReason: analysis.selectionReason
                        }
                    }
                }
            }));

            if (bulkOps.length > 0) {
                const result = await Message.bulkWrite(bulkOps);
                loggingService.info('📊 Updated message learning values', {
                    updated: result.modifiedCount,
                    total: analyses.length
                });
            }
        } catch (error) {
            loggingService.error('Failed to update message learning values:', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Get messages selected for vectorization
     */
    async getSelectedMessages(limit?: number): Promise<any[]> {
        try {
            const query = {
                learningValue: { $gte: this.MIN_LEARNING_VALUE },
                isVectorized: false,
                fullContentStored: true
            };

            const messages = await Message.find(query)
                .sort({ learningValue: -1, createdAt: -1 })
                .limit(limit ?? 1000)
                .lean();

            return messages;
        } catch (error) {
            loggingService.error('Failed to get selected messages:', {
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }

    /**
     * Mark messages as processed by smart sampling
     */
    async markMessagesProcessed(messageIds: string[]): Promise<void> {
        try {
            await Message.updateMany(
                { _id: { $in: messageIds } },
                { $set: { samplingProcessedAt: new Date() } }
            );
            
            loggingService.info('Marked messages as processed by smart sampling', {
                count: messageIds.length
            });
        } catch (error) {
            loggingService.error('Failed to mark messages as processed:', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
}

// Export singleton instance
export const smartSamplingService = SmartSamplingService.getInstance();