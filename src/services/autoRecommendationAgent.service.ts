import mongoose from 'mongoose';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { retryBedrockOperation } from '../utils/bedrockRetry';
import { SimulationTrackingService } from './simulationTracking.service';
import { Usage } from '../models/Usage';
import { loggingService } from './logging.service';
// import { User } from '../models/User';
// import { Project } from '../models/Project';

const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });

// Schema for user behavior patterns
const UserBehaviorPatternSchema = new mongoose.Schema({
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true,
        unique: true 
    },
    
    // Usage patterns
    usagePatterns: {
        preferredModels: [{ model: String, frequency: Number, avgCost: Number }],
        commonPromptTypes: [{ type: String, frequency: Number, avgTokens: Number }],
        costSensitivity: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
        qualityTolerance: { type: String, enum: ['low', 'medium', 'high'], default: 'high' },
        peakUsageHours: [Number], // Hours of day (0-23)
        avgRequestsPerDay: Number,
        avgCostPerDay: Number
    },
    
    // Optimization behavior
    optimizationBehavior: {
        acceptanceRate: Number, // Percentage of recommendations accepted
        preferredOptimizationTypes: [{ type: String, acceptanceRate: Number }],
        riskTolerance: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
        avgTimeToDecision: Number, // Seconds to make optimization decisions
        frequentlyRejectedOptimizations: [String]
    },
    
    // Learning data
    learningData: {
        totalInteractions: Number,
        successfulRecommendations: Number,
        lastUpdated: { type: Date, default: Date.now },
        confidence: { type: Number, min: 0, max: 1, default: 0.5 }
    },
    
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, {
    timestamps: true,
    collection: 'user_behavior_patterns'
});

const UserBehaviorPattern = mongoose.model('UserBehaviorPattern', UserBehaviorPatternSchema);

// Schema for AI-generated recommendations
const AIRecommendationSchema = new mongoose.Schema({
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    
    // Recommendation details
    type: {
        type: String,
        enum: ['model_switch', 'prompt_optimization', 'usage_pattern', 'cost_alert', 'efficiency_tip'],
        required: true
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'urgent'],
        default: 'medium'
    },
    
    title: { type: String, required: true },
    description: { type: String, required: true },
    reasoning: String, // AI's reasoning for the recommendation
    
    // Actionable data
    actionable: {
        currentModel: String,
        suggestedModel: String,
        currentPrompt: String,
        suggestedPrompt: String,
        estimatedSavings: Number,
        confidenceScore: Number,
        implementationComplexity: { type: String, enum: ['easy', 'moderate', 'complex'], default: 'moderate' }
    },
    
    // Context
    context: {
        triggeredBy: String, // What triggered this recommendation
        relevantUsageIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Usage' }],
        projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
        basedOnPattern: String
    },
    
    // User interaction
    userInteraction: {
        status: { 
            type: String, 
            enum: ['pending', 'viewed', 'accepted', 'rejected', 'dismissed'], 
            default: 'pending' 
        },
        viewedAt: Date,
        respondedAt: Date,
        feedback: String,
        rating: { type: Number, min: 1, max: 5 }
    },
    
    // Effectiveness tracking
    effectiveness: {
        actualSavings: Number,
        userSatisfaction: Number,
        implementationSuccess: Boolean,
        followUpNeeded: Boolean
    },
    
    expiresAt: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }, // 7 days
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, {
    timestamps: true,
    collection: 'ai_recommendations'
});

AIRecommendationSchema.index({ userId: 1, status: 1 });
AIRecommendationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const AIRecommendation = mongoose.model('AIRecommendation', AIRecommendationSchema);

export interface UserBehaviorPattern {
    userId: string;
    usagePatterns: {
        preferredModels: Array<{ model: string; frequency: number; avgCost: number }>;
        commonPromptTypes: Array<{ type: string; frequency: number; avgTokens: number }>;
        costSensitivity: 'low' | 'medium' | 'high';
        qualityTolerance: 'low' | 'medium' | 'high';
        peakUsageHours: number[];
        avgRequestsPerDay: number;
        avgCostPerDay: number;
    };
    optimizationBehavior: {
        acceptanceRate: number;
        preferredOptimizationTypes: Array<{ type: string; acceptanceRate: number }>;
        riskTolerance: 'low' | 'medium' | 'high';
        avgTimeToDecision: number;
        frequentlyRejectedOptimizations: string[];
    };
    learningData: {
        totalInteractions: number;
        successfulRecommendations: number;
        confidence: number;
    };
}

export interface AIRecommendationData {
    type: 'model_switch' | 'prompt_optimization' | 'usage_pattern' | 'cost_alert' | 'efficiency_tip';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    title: string;
    description: string;
    reasoning: string;
    actionable: {
        currentModel?: string;
        suggestedModel?: string;
        currentPrompt?: string;
        suggestedPrompt?: string;
        estimatedSavings?: number;
        confidenceScore: number;
        implementationComplexity: 'easy' | 'moderate' | 'complex';
    };
    context: {
        triggeredBy: string;
        relevantUsageIds?: string[];
        projectId?: string;
        basedOnPattern: string;
    };
}

export class AutoRecommendationAgentService {
    
    /**
     * Analyze user behavior and update patterns
     */
    static async analyzeUserBehavior(userId: string): Promise<UserBehaviorPattern> {
        try {
            // Get user's recent usage data (last 30 days)
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const recentUsage = await Usage.find({
                userId: new mongoose.Types.ObjectId(userId),
                createdAt: { $gte: thirtyDaysAgo }
            }).lean();

            // Get simulation tracking data
            const simulationStats = await SimulationTrackingService.getSimulationStats(userId);

            // Analyze usage patterns
            const usagePatterns = this.analyzeUsagePatterns(recentUsage);
            
            // Analyze optimization behavior
            const optimizationBehavior = this.analyzeOptimizationBehavior(simulationStats);

            // Calculate learning metrics
            const learningData = {
                totalInteractions: simulationStats.totalSimulations,
                successfulRecommendations: simulationStats.totalOptimizationsApplied,
                confidence: simulationStats.totalSimulations > 0 ? 
                    simulationStats.totalOptimizationsApplied / simulationStats.totalSimulations : 0.5
            };

            const behaviorPattern: UserBehaviorPattern = {
                userId,
                usagePatterns,
                optimizationBehavior,
                learningData
            };

            // Save to database
            await UserBehaviorPattern.findOneAndUpdate(
                { userId: new mongoose.Types.ObjectId(userId) },
                {
                    ...behaviorPattern,
                    userId: new mongoose.Types.ObjectId(userId),
                    updatedAt: new Date()
                },
                { upsert: true, new: true }
            );

            return behaviorPattern;
        } catch (error) {
            loggingService.error('Error analyzing user behavior:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Generate AI-powered recommendations for user
     */
    static async generateRecommendations(userId: string): Promise<AIRecommendationData[]> {
        try {
            // Get user behavior pattern
            const behaviorPattern = await this.analyzeUserBehavior(userId);
            
            // Get recent usage for context
            const recentUsage = await Usage.find({
                userId: new mongoose.Types.ObjectId(userId),
                createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Last 7 days
            }).limit(20).lean();

            if (recentUsage.length === 0) {
                return [];
            }

            // Prepare context for AI
            const context = {
                userBehavior: behaviorPattern,
                recentUsage: recentUsage.map(u => ({
                    model: u.model,
                    cost: u.cost,
                    tokens: u.totalTokens,
                    prompt: u.prompt.substring(0, 200), // Truncate for privacy
                    timestamp: u.createdAt
                })),
                currentDate: new Date().toISOString()
            };

            // Generate recommendations using AI
            const recommendations = await this.callAIForRecommendations(context);

            // Save recommendations to database
            for (const rec of recommendations) {
                await this.saveRecommendation(userId, rec);
            }

            return recommendations;
        } catch (error) {
            loggingService.error('Error generating recommendations:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get user's active recommendations
     */
    static async getUserRecommendations(
        userId: string,
        status?: string,
        limit: number = 10
    ): Promise<any[]> {
        try {
            const query: any = { 
                userId: new mongoose.Types.ObjectId(userId),
                expiresAt: { $gt: new Date() }
            };
            
            if (status) {
                query['userInteraction.status'] = status;
            }

            const recommendations = await AIRecommendation.find(query)
                .sort({ priority: -1, createdAt: -1 })
                .limit(limit)
                .populate('context.relevantUsageIds', 'prompt model cost')
                .populate('context.projectId', 'name')
                .lean();

            return recommendations;
        } catch (error) {
            loggingService.error('Error getting user recommendations:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Update recommendation status
     */
    static async updateRecommendationStatus(
        recommendationId: string,
        status: 'viewed' | 'accepted' | 'rejected' | 'dismissed',
        feedback?: string,
        rating?: number
    ): Promise<void> {
        try {
            const updateData: any = {
                'userInteraction.status': status,
                'userInteraction.respondedAt': new Date(),
                updatedAt: new Date()
            };

            if (status === 'viewed' && !await AIRecommendation.findOne({ 
                _id: recommendationId, 
                'userInteraction.viewedAt': { $exists: true } 
            })) {
                updateData['userInteraction.viewedAt'] = new Date();
            }

            if (feedback) {
                updateData['userInteraction.feedback'] = feedback;
            }

            if (rating) {
                updateData['userInteraction.rating'] = rating;
            }

            await AIRecommendation.findByIdAndUpdate(recommendationId, updateData);

            // Update user behavior pattern based on interaction
            await this.updateBehaviorFromInteraction(recommendationId, status);

            loggingService.info(`Updated recommendation ${recommendationId} status to ${status}`);
        } catch (error) {
            loggingService.error('Error updating recommendation status:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Analyze usage patterns from recent usage
     */
    private static analyzeUsagePatterns(usage: any[]): UserBehaviorPattern['usagePatterns'] {
        if (usage.length === 0) {
            return {
                preferredModels: [],
                commonPromptTypes: [],
                costSensitivity: 'medium',
                qualityTolerance: 'high',
                peakUsageHours: [],
                avgRequestsPerDay: 0,
                avgCostPerDay: 0
            };
        }

        // Analyze preferred models
        const modelStats = new Map<string, { count: number; totalCost: number }>();
        usage.forEach(u => {
            const existing = modelStats.get(u.model) || { count: 0, totalCost: 0 };
            modelStats.set(u.model, {
                count: existing.count + 1,
                totalCost: existing.totalCost + u.cost
            });
        });

        const preferredModels = Array.from(modelStats.entries())
            .map(([model, stats]) => ({
                model,
                frequency: stats.count / usage.length,
                avgCost: stats.totalCost / stats.count
            }))
            .sort((a, b) => b.frequency - a.frequency);

        // Analyze peak usage hours
        const hourStats = new Array(24).fill(0);
        usage.forEach(u => {
            const hour = new Date(u.createdAt).getHours();
            hourStats[hour]++;
        });

        const peakUsageHours = hourStats
            .map((count, hour) => ({ hour, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5)
            .map(h => h.hour);

        // Calculate averages
        const totalCost = usage.reduce((sum, u) => sum + u.cost, 0);
        const daysSpan = Math.max(1, (Date.now() - new Date(usage[usage.length - 1].createdAt).getTime()) / (24 * 60 * 60 * 1000));
        
        // Determine cost sensitivity based on model choices
        const avgCostPerRequest = totalCost / usage.length;
        let costSensitivity: 'low' | 'medium' | 'high' = 'medium';
        if (avgCostPerRequest > 0.05) costSensitivity = 'low';
        else if (avgCostPerRequest < 0.01) costSensitivity = 'high';

        return {
            preferredModels,
            commonPromptTypes: this.classifyPromptTypes(usage),
            costSensitivity,
            qualityTolerance: 'high', // Default assumption
            peakUsageHours,
            avgRequestsPerDay: usage.length / daysSpan,
            avgCostPerDay: totalCost / daysSpan
        };
    }

    /**
     * Classify prompt types based on usage patterns
     */
    private static classifyPromptTypes(usage: any[]): Array<{ type: string; frequency: number; avgTokens: number }> {
        const promptTypes = new Map<string, { count: number; totalTokens: number }>();

        for (const u of usage) {
            const prompt = u.prompt.toLowerCase();
            let type = 'general';

            // Classification rules based on prompt content
            if (prompt.includes('summarize') || prompt.includes('summary')) {
                type = 'summarization';
            } else if (prompt.includes('translate') || prompt.includes('translation')) {
                type = 'translation';
            } else if (prompt.includes('analyze') || prompt.includes('analysis')) {
                type = 'analysis';
            } else if (prompt.includes('write') || prompt.includes('create') || prompt.includes('generate')) {
                type = 'generation';
            } else if (prompt.includes('explain') || prompt.includes('what is') || prompt.includes('how does')) {
                type = 'explanation';
            } else if (prompt.includes('code') || prompt.includes('function') || prompt.includes('programming')) {
                type = 'coding';
            } else if (prompt.includes('classify') || prompt.includes('categorize')) {
                type = 'classification';
            } else if (prompt.includes('extract') || prompt.includes('find')) {
                type = 'extraction';
            } else if (prompt.includes('compare') || prompt.includes('difference')) {
                type = 'comparison';
            } else if (prompt.includes('rewrite') || prompt.includes('improve') || prompt.includes('edit')) {
                type = 'editing';
            }

            const existing = promptTypes.get(type) || { count: 0, totalTokens: 0 };
            promptTypes.set(type, {
                count: existing.count + 1,
                totalTokens: existing.totalTokens + u.totalTokens
            });
        }

        return Array.from(promptTypes.entries())
            .map(([type, stats]) => ({
                type,
                frequency: stats.count / usage.length,
                avgTokens: stats.totalTokens / stats.count
            }))
            .sort((a, b) => b.frequency - a.frequency);
    }

    /**
     * Analyze optimization behavior from simulation stats
     */
    private static analyzeOptimizationBehavior(stats: any): UserBehaviorPattern['optimizationBehavior'] {
        return {
            acceptanceRate: stats.acceptanceRate || 0,
            preferredOptimizationTypes: stats.topOptimizationTypes || [],
            riskTolerance: this.inferRiskTolerance(stats),
            avgTimeToDecision: stats.userEngagement?.averageTimeSpent || 0,
            frequentlyRejectedOptimizations: this.trackRejectionPatterns(stats)
        };
    }

    /**
     * Infer user's risk tolerance from their optimization choices
     */
    private static inferRiskTolerance(stats: any): 'low' | 'medium' | 'high' {
        const acceptanceRate = stats.acceptanceRate || 0;
        const topTypes = stats.topOptimizationTypes || [];

        // High acceptance rate suggests higher risk tolerance
        if (acceptanceRate > 0.7) {
            return 'high';
        } else if (acceptanceRate < 0.3) {
            return 'low';
        }

        // Check if user prefers safer optimizations
        const safeOptimizations = topTypes.filter((type: any) => 
            type.type === 'model_switch' || type.type === 'context_trim'
        ).length;

        const riskyOptimizations = topTypes.filter((type: any) => 
            type.type === 'prompt_optimize' || type.type === 'batch_processing'
        ).length;

        if (safeOptimizations > riskyOptimizations) {
            return 'low';
        } else if (riskyOptimizations > safeOptimizations) {
            return 'high';
        }

        return 'medium';
    }

    /**
     * Track frequently rejected optimization patterns
     */
    private static trackRejectionPatterns(stats: any): string[] {
        const rejectedPatterns: string[] = [];
        const topTypes = stats.topOptimizationTypes || [];

        // Find optimization types with low acceptance rates
        for (const type of topTypes) {
            if (type.acceptanceRate < 0.2) {
                rejectedPatterns.push(type.type);
            }
        }

        return rejectedPatterns;
    }

    /**
     * Call AI model to generate recommendations
     */
    private static async callAIForRecommendations(context: any): Promise<AIRecommendationData[]> {
        try {
            const prompt = `You are an AI cost optimization expert. Analyze the user's behavior and usage patterns to generate personalized recommendations for reducing AI costs while maintaining quality.

User Context:
${JSON.stringify(context, null, 2)}

Generate 3-5 specific, actionable recommendations. For each recommendation, provide:
1. Type (model_switch, prompt_optimization, usage_pattern, cost_alert, or efficiency_tip)
2. Priority (low, medium, high, urgent)
3. Title (concise, engaging)
4. Description (detailed explanation)
5. Reasoning (why this recommendation makes sense for this user)
6. Actionable details (current vs suggested, estimated savings, confidence score 0-1, complexity)
7. Context (what triggered this, relevant usage patterns)

Focus on:
- User's actual usage patterns and preferences
- Cost optimization opportunities that match their risk tolerance
- Practical recommendations they're likely to accept
- Specific model switches or prompt improvements
- Usage pattern optimizations

Return valid JSON array of recommendations.`;

            const command = new InvokeModelCommand({
                modelId: 'anthropic.claude-3-5-haiku-20241022-v1:0',
                contentType: 'application/json',
                accept: 'application/json',
                body: JSON.stringify({
                    anthropic_version: 'bedrock-2023-05-31',
                    max_tokens: 2000,
                    temperature: 0.3,
                    messages: [
                        {
                            role: 'user',
                            content: prompt
                        }
                    ]
                })
            });

            const response = await retryBedrockOperation(
                () => bedrockClient.send(command),
                {
                    maxRetries: 3,
                    baseDelay: 1000,
                    maxDelay: 15000,
                    backoffMultiplier: 2,
                    jitterFactor: 0.25
                },
                {
                    modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
                    operation: 'generateRecommendations'
                }
            );
            const responseBody = JSON.parse(new TextDecoder().decode(response.body));
            
            let recommendationsText = responseBody.content[0].text;
            
            // Extract JSON from the response
            const jsonMatch = recommendationsText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                recommendationsText = jsonMatch[0];
            }

            const recommendations = JSON.parse(recommendationsText);
            
            // Validate and format recommendations
            return recommendations.map((rec: any) => ({
                type: rec.type || 'efficiency_tip',
                priority: rec.priority || 'medium',
                title: rec.title || 'Optimization Opportunity',
                description: rec.description || 'Consider optimizing your usage',
                reasoning: rec.reasoning || 'Based on your usage patterns',
                actionable: {
                    currentModel: rec.actionable?.currentModel,
                    suggestedModel: rec.actionable?.suggestedModel,
                    currentPrompt: rec.actionable?.currentPrompt,
                    suggestedPrompt: rec.actionable?.suggestedPrompt,
                    estimatedSavings: rec.actionable?.estimatedSavings || 0,
                    confidenceScore: rec.actionable?.confidenceScore || 0.7,
                    implementationComplexity: rec.actionable?.implementationComplexity || 'moderate'
                },
                context: {
                    triggeredBy: rec.context?.triggeredBy || 'usage_analysis',
                    basedOnPattern: rec.context?.basedOnPattern || 'general_usage'
                }
            }));
        } catch (error) {
            loggingService.error('Error calling AI for recommendations:', { error: error instanceof Error ? error.message : String(error) });
            
            // Return fallback recommendations
            return [
                {
                    type: 'efficiency_tip',
                    priority: 'medium',
                    title: 'Consider Using More Cost-Effective Models',
                    description: 'Based on your usage patterns, you might benefit from trying more cost-effective models for certain tasks.',
                    reasoning: 'Fallback recommendation due to AI service unavailable',
                    actionable: {
                        confidenceScore: 0.5,
                        implementationComplexity: 'moderate'
                    },
                    context: {
                        triggeredBy: 'fallback',
                        basedOnPattern: 'general'
                    }
                }
            ];
        }
    }

    /**
     * Save recommendation to database
     */
    private static async saveRecommendation(userId: string, rec: AIRecommendationData): Promise<void> {
        try {
            const recommendation = new AIRecommendation({
                userId: new mongoose.Types.ObjectId(userId),
                type: rec.type,
                priority: rec.priority,
                title: rec.title,
                description: rec.description,
                reasoning: rec.reasoning,
                actionable: rec.actionable,
                context: {
                    ...rec.context,
                    projectId: rec.context.projectId ? new mongoose.Types.ObjectId(rec.context.projectId) : undefined,
                    relevantUsageIds: rec.context.relevantUsageIds?.map(id => new mongoose.Types.ObjectId(id))
                }
            });

            await recommendation.save();
        } catch (error) {
            loggingService.error('Error saving recommendation:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Update behavior pattern based on user interaction
     */
    private static async updateBehaviorFromInteraction(
        recommendationId: string,
        status: string
    ): Promise<void> {
        try {
            const recommendation = await AIRecommendation.findById(recommendationId);
            if (!recommendation) return;

            const userId = recommendation.userId;
            const pattern = await UserBehaviorPattern.findOne({ userId });
            if (!pattern) return;

            // Update acceptance rate and learning data
            const isAccepted = status === 'accepted';
            const totalInteractions = (pattern.learningData?.totalInteractions || 0) + 1;
            const successfulRecommendations = (pattern.learningData?.successfulRecommendations || 0) + (isAccepted ? 1 : 0);

            await UserBehaviorPattern.findOneAndUpdate(
                { userId },
                {
                    'learningData.totalInteractions': totalInteractions,
                    'learningData.successfulRecommendations': successfulRecommendations,
                    'learningData.confidence': successfulRecommendations / totalInteractions,
                    'learningData.lastUpdated': new Date(),
                    updatedAt: new Date()
                }
            );
        } catch (error) {
            loggingService.error('Error updating behavior from interaction:', { error: error instanceof Error ? error.message : String(error) });
        }
    }
}

export default AutoRecommendationAgentService;