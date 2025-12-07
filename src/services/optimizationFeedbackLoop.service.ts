import mongoose from 'mongoose';
import { loggingService } from './logging.service';
import { OptimizationOutcome } from '../models/OptimizationOutcome';
import { ModelPerformanceHistory } from '../models/ModelPerformanceHistory';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface OptimizationContext {
    promptComplexity: number; // 0-1 scale
    userTier: 'free' | 'pro' | 'enterprise';
    costBudget: 'low' | 'medium' | 'high';
    taskType: string;
    promptLength?: number;
}

export interface OptimizationRecommendation {
    model: string;
    provider: string;
    confidenceScore: number; // 0-1
    expectedCostSavings: number;
    expectedQualityScore: number; // 0-1
    reasoning: string;
}

export interface BanditArm {
    model: string;
    provider: string;
    pulls: number; // Times selected
    successes: number; // Times it worked well
    totalReward: number; // Cumulative reward
    alpha: number; // Beta distribution param (successes + 1)
    beta: number; // Beta distribution param (failures + 1)
}

export interface LearningSignals {
    userAcceptance: boolean;
    costSaved: number;
    qualityMaintained: boolean;
    userRating?: number;
    errorOccurred: boolean;
}

// ============================================================================
// OPTIMIZATION FEEDBACK LOOP SERVICE
// ============================================================================

export class OptimizationFeedbackLoopService {
    private static instance: OptimizationFeedbackLoopService;
    
    // Thompson Sampling: Multi-armed bandit state
    private banditArms: Map<string, BanditArm> = new Map();
    
    // Retraining tracking
    private lastRetraining?: Date;
    
    // Learning configuration
    private config = {
        explorationRate: 0.1, // 10% exploration vs exploitation
        minimumPulls: 10, // Minimum samples before trusting model
        rewardWeights: {
            costSavings: 0.4,
            quality: 0.3,
            userApproval: 0.3
        },
        retrainingInterval: 3600000, // 1 hour
        confidenceThreshold: 0.8
    };

    private constructor() {
        loggingService.info('🧠 Optimization Feedback Loop initialized', {
            component: 'OptimizationFeedbackLoop'
        });
        
        // Load existing bandit state from database
        this.loadBanditState();
        
        // Schedule periodic retraining
        setInterval(() => {
            this.trainReinforcementModel();
        }, this.config.retrainingInterval);
    }

    public static getInstance(): OptimizationFeedbackLoopService {
        if (!OptimizationFeedbackLoopService.instance) {
            OptimizationFeedbackLoopService.instance = new OptimizationFeedbackLoopService();
        }
        return OptimizationFeedbackLoopService.instance;
    }

    /**
     * Record the outcome of an optimization
     */
    public async recordOptimizationOutcome(
        optimizationId: string,
        userId: string,
        context: OptimizationContext,
        originalModel: string,
        suggestedModel: string,
        signals: LearningSignals
    ): Promise<void> {
        try {
            // Calculate reward
            const reward = this.calculateReward(signals);

            // Update bandit arm
            const armKey = `${suggestedModel}:${context.userTier}:${context.taskType}`;
            await this.updateBanditArm(armKey, reward > 0.5);

            // Store outcome in database
            await OptimizationOutcome.create({
                optimizationId: new mongoose.Types.ObjectId(optimizationId),
                userId: new mongoose.Types.ObjectId(userId),
                timestamp: new Date(),
                optimizationType: 'model_suggestion',
                context: {
                    originalModel,
                    suggestedModel,
                    promptComplexity: context.promptComplexity,
                    userTier: context.userTier,
                    taskType: context.taskType,
                    promptLength: context.promptLength
                },
                outcome: {
                    applied: signals.userAcceptance,
                    userApproved: signals.userAcceptance,
                    costSaved: signals.costSaved,
                    qualityScore: signals.qualityMaintained ? 0.8 : 0.3,
                    userRating: signals.userRating,
                    errorOccurred: signals.errorOccurred
                },
                learningSignals: {
                    acceptanceRate: signals.userAcceptance ? 1 : 0,
                    successRate: signals.errorOccurred ? 0 : 1,
                    averageSavings: signals.costSaved,
                    confidenceScore: reward
                }
            });

            loggingService.info('📊 Optimization outcome recorded', {
                component: 'OptimizationFeedbackLoop',
                optimizationId,
                suggestedModel,
                reward: reward.toFixed(3),
                accepted: signals.userAcceptance
            });

        } catch (error) {
            loggingService.error('Failed to record optimization outcome', {
                component: 'OptimizationFeedbackLoop',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Learn from user action (approval/rejection)
     */
    public async learnFromUserAction(
        userId: string,
        action: 'approve' | 'reject',
        context: OptimizationContext,
        suggestedModel: string
    ): Promise<void> {
        try {
            const signals: LearningSignals = {
                userAcceptance: action === 'approve',
                costSaved: action === 'approve' ? 0.5 : 0, // Estimate
                qualityMaintained: action === 'approve',
                errorOccurred: false
            };

            await this.recordOptimizationOutcome(
                new mongoose.Types.ObjectId().toString(),
                userId,
                context,
                'unknown', // Original model unknown in this flow
                suggestedModel,
                signals
            );

            loggingService.info('👤 User action learned', {
                component: 'OptimizationFeedbackLoop',
                userId,
                action,
                model: suggestedModel
            });

        } catch (error) {
            loggingService.error('Failed to learn from user action', {
                component: 'OptimizationFeedbackLoop',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Update model performance metrics
     */
    public async updateModelPerformance(
        model: string,
        provider: string,
        metrics: {
            success: boolean;
            cost: number;
            latency: number;
            qualityScore?: number;
        }
    ): Promise<void> {
        try {
            // Find or create performance history entry
            let history = await ModelPerformanceHistory.findOne({ model, provider });

            if (!history) {
                history = new ModelPerformanceHistory({
                    model,
                    provider,
                    timestamp: new Date(),
                    metrics: {
                        totalRequests: 0,
                        successfulRequests: 0,
                        failedRequests: 0,
                        averageCost: 0,
                        averageLatency: 0
                    },
                    contextMetrics: {
                        byUserTier: new Map(),
                        byTaskType: new Map(),
                        byPromptComplexity: {
                            low: { requests: 0, successRate: 0 },
                            medium: { requests: 0, successRate: 0 },
                            high: { requests: 0, successRate: 0 }
                        }
                    },
                    performanceScore: 50,
                    recommendationConfidence: 0.5
                });
            }

            // Update metrics (exponential moving average)
            const alpha = 0.1; // Weight for new data
            history.metrics.totalRequests++;
            
            if (metrics.success) {
                history.metrics.successfulRequests++;
            } else {
                history.metrics.failedRequests++;
            }

            history.metrics.averageCost = 
                alpha * metrics.cost + (1 - alpha) * history.metrics.averageCost;
            
            history.metrics.averageLatency = 
                alpha * metrics.latency + (1 - alpha) * history.metrics.averageLatency;

            if (metrics.qualityScore !== undefined) {
                history.metrics.averageQualityScore = 
                    alpha * metrics.qualityScore + (1 - alpha) * (history.metrics.averageQualityScore || 0.5);
            }

            // Calculate performance score (0-100)
            const successRate = history.metrics.successfulRequests / history.metrics.totalRequests;
            const costScore = Math.max(0, 100 - history.metrics.averageCost * 1000); // Lower is better
            const latencyScore = Math.max(0, 100 - history.metrics.averageLatency / 100); // Lower is better
            const qualityScore = (history.metrics.averageQualityScore || 0.5) * 100;

            history.performanceScore = 
                successRate * 40 + // 40% weight on success rate
                (costScore / 100) * 30 + // 30% weight on cost
                (latencyScore / 100) * 15 + // 15% weight on latency
                (qualityScore / 100) * 15; // 15% weight on quality

            // Update confidence based on sample size
            history.recommendationConfidence = Math.min(1, history.metrics.totalRequests / 100);

            await history.save();

            loggingService.debug('Model performance updated', {
                component: 'OptimizationFeedbackLoop',
                model,
                performanceScore: history.performanceScore.toFixed(1),
                confidence: history.recommendationConfidence.toFixed(2)
            });

        } catch (error) {
            loggingService.error('Failed to update model performance', {
                component: 'OptimizationFeedbackLoop',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Get optimization recommendation using Thompson Sampling
     */
    public async getOptimizationRecommendation(
        context: OptimizationContext
    ): Promise<OptimizationRecommendation | null> {
        try {
            // Build candidate models based on context
            const candidates = await this.getCandidateModels(context);
            
            if (candidates.length === 0) {
                return null;
            }

            // Thompson Sampling: sample from each arm's beta distribution
            const samples = candidates.map(model => {
                const armKey = `${model}:${context.userTier}:${context.taskType}`;
                const arm = this.banditArms.get(armKey) || this.createBanditArm(model, 'unknown');
                
                // Sample from Beta(alpha, beta)
                const sample = this.sampleBeta(arm.alpha, arm.beta);
                
                return { model, sample, arm };
            });

            // Sort by sample value (exploration + exploitation)
            samples.sort((a, b) => b.sample - a.sample);

            // Exploration vs exploitation
            const shouldExplore = Math.random() < this.config.explorationRate;
            
            const selectedIndex = shouldExplore 
                ? Math.floor(Math.random() * Math.min(3, samples.length)) // Explore top 3
                : 0; // Exploit best

            const selected = samples[selectedIndex];

            // Get historical performance
            const history = await ModelPerformanceHistory.findOne({ 
                model: selected.model 
            });

            // Calculate expected metrics
            const expectedCostSavings = history 
                ? Math.max(0, 0.01 - history.metrics.averageCost)
                : 0.005; // Default estimate

            const expectedQualityScore = history?.metrics.averageQualityScore || 0.7;

            // Confidence is based on number of pulls and success rate
            const confidence = selected.arm.pulls >= this.config.minimumPulls
                ? Math.min(1, selected.arm.successes / selected.arm.pulls)
                : 0.5;

            return {
                model: selected.model,
                provider: this.getProviderFromModel(selected.model),
                confidenceScore: confidence,
                expectedCostSavings,
                expectedQualityScore,
                reasoning: this.generateReasoning(selected.model, context, confidence)
            };

        } catch (error) {
            loggingService.error('Failed to get optimization recommendation', {
                component: 'OptimizationFeedbackLoop',
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }

    /**
     * Calculate confidence score for an optimization
     */
    public async calculateConfidenceScore(
        model: string,
        context: OptimizationContext
    ): Promise<number> {
        try {
            const armKey = `${model}:${context.userTier}:${context.taskType}`;
            const arm = this.banditArms.get(armKey);

            if (!arm || arm.pulls < this.config.minimumPulls) {
                return 0.5; // Low confidence without data
            }

            // Confidence based on success rate and sample size
            const successRate = arm.successes / arm.pulls;
            const sampleConfidence = Math.min(1, arm.pulls / 100);

            return successRate * 0.7 + sampleConfidence * 0.3;

        } catch (error) {
            return 0.5;
        }
    }

    /**
     * Periodic reinforcement learning model retraining
     */
    public async trainReinforcementModel(): Promise<void> {
        try {
            loggingService.info('🔄 Retraining reinforcement learning model', {
                component: 'OptimizationFeedbackLoop'
            });

            // Get recent outcomes (last 7 days)
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const outcomes = await OptimizationOutcome.find({
                timestamp: { $gte: sevenDaysAgo }
            }).lean();

            // Rebuild bandit arms from outcomes
            this.banditArms.clear();

            for (const outcome of outcomes) {
                const armKey = `${outcome.context.suggestedModel}:${outcome.context.userTier}:${outcome.context.taskType}`;
                const success = outcome.outcome.applied && !outcome.outcome.errorOccurred;
                
                await this.updateBanditArm(armKey, success);
            }

            // Update model performance histories
            const uniqueModels = [...new Set(outcomes.map(o => o.context.suggestedModel))];
            
            for (const model of uniqueModels) {
                const modelOutcomes = outcomes.filter(o => o.context.suggestedModel === model);
                const avgCost = modelOutcomes.reduce((sum, o) => sum + o.outcome.costSaved, 0) / modelOutcomes.length;
                const successRate = modelOutcomes.filter(o => !o.outcome.errorOccurred).length / modelOutcomes.length;
                
                await this.updateModelPerformance(model, this.getProviderFromModel(model), {
                    success: successRate > 0.7,
                    cost: avgCost,
                    latency: 1000, // Default
                    qualityScore: successRate
                });
            }

            this.lastRetraining = new Date();

            loggingService.info('✅ Reinforcement learning model retrained', {
                component: 'OptimizationFeedbackLoop',
                outcomeCount: outcomes.length,
                armCount: this.banditArms.size,
                modelCount: uniqueModels.length
            });

        } catch (error) {
            loggingService.error('Failed to retrain model', {
                component: 'OptimizationFeedbackLoop',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    // =========================================================================
    // PRIVATE HELPER METHODS
    // =========================================================================

    /**
     * Calculate reward from learning signals
     */
    private calculateReward(signals: LearningSignals): number {
        const { costSavings, quality, userApproval } = this.config.rewardWeights;
        
        const costReward = Math.min(1, signals.costSaved / 1); // Normalize to $1
        const qualityReward = signals.qualityMaintained ? 1 : 0;
        const approvalReward = signals.userAcceptance ? 1 : 0;
        const errorPenalty = signals.errorOccurred ? -0.5 : 0;

        const reward = 
            costReward * costSavings +
            qualityReward * quality +
            approvalReward * userApproval +
            errorPenalty;

        return Math.max(0, Math.min(1, reward)); // Clamp to [0, 1]
    }

    /**
     * Update bandit arm with new observation
     */
    private async updateBanditArm(armKey: string, success: boolean): Promise<void> {
        let arm = this.banditArms.get(armKey);
        
        if (!arm) {
            const [model] = armKey.split(':');
            arm = this.createBanditArm(model, 'unknown');
        }

        arm.pulls++;
        if (success) {
            arm.successes++;
            arm.totalReward += 1;
            arm.alpha++;
        } else {
            arm.beta++;
        }

        this.banditArms.set(armKey, arm);
    }

    /**
     * Create new bandit arm
     */
    private createBanditArm(model: string, provider: string): BanditArm {
        return {
            model,
            provider,
            pulls: 0,
            successes: 0,
            totalReward: 0,
            alpha: 1, // Prior: uniform distribution
            beta: 1
        };
    }

    /**
     * Sample from Beta distribution (simplified)
     */
    private sampleBeta(alpha: number, beta: number): number {
        // Proper Beta distribution sampling using Cheng's algorithm
        // Reference: R.C.H. Cheng (1978) "Generating beta variates with nonintegral shape parameters"
        
        if (alpha <= 0 || beta <= 0) {
            throw new Error('Alpha and beta must be positive');
        }

        // Special case: if both parameters are 1, return uniform random
        if (alpha === 1 && beta === 1) {
            return Math.random();
        }

        // Use Johnk's algorithm for small parameters
        if (alpha < 1 && beta < 1) {
            while (true) {
                const u = Math.random();
                const v = Math.random();
                const x = Math.pow(u, 1 / alpha);
                const y = Math.pow(v, 1 / beta);
                const sum = x + y;
                
                if (sum <= 1) {
                    return x / sum;
                }
            }
        }

        // Use Cheng's BB algorithm for larger parameters
        const alphaMin = Math.min(alpha, beta);
        const alphaMax = Math.max(alpha, beta);
        const alphaPlusB = alpha + beta;
        
        let gamma: number;
        
        if (alphaMin > 1) {
            // BB algorithm
            const A = alphaMin - 1;
            const B = alphaMax - 1;
            const C = (A + B) / Math.sqrt(A * B);
            
            while (true) {
                const u1 = Math.random();
                const u2 = Math.random();
                const v = C * Math.log(u1 / (1 - u1));
                const w = alphaMin * Math.exp(v);
                
                const logAcceptRatio = 
                    A * Math.log(w / A) + 
                    B * Math.log((alphaMax - 1 + A - w) / B) - 
                    v;
                
                if (logAcceptRatio >= Math.log(u1 * u1 * u2)) {
                    gamma = w / (alphaMax - 1 + A);
                    break;
                }
            }
        } else {
            // BC algorithm (when one parameter is small)
            const A = alphaMax;
            const B = Math.max(alphaMin, 1e-8);
            const C = B + A - B;
            
            while (true) {
                const u1 = Math.random();
                const u2 = Math.random();
                const y = u1 * u2;
                const z = u1 * y;
                
                if (C * u2 - 1 - z >= 0 || C * Math.log(u2) - Math.log(z) >= 0) {
                    gamma = Math.pow(u1, 1 / B);
                    break;
                }
            }
        }
        
        // Return X ~ Beta(alpha, beta)
        return alpha === alphaMin ? gamma : 1 - gamma;
    }

    /**
     * Get candidate models based on context
     */
    private async getCandidateModels(context: OptimizationContext): Promise<string[]> {
        // Simplified: return predefined model list based on complexity
        if (context.promptComplexity > 0.7) {
            return ['gpt-4', 'claude-3-opus', 'gemini-pro'];
        } else if (context.promptComplexity > 0.4) {
            return ['gpt-3.5-turbo', 'claude-3-sonnet', 'gemini-flash'];
        } else {
            return ['gpt-3.5-turbo', 'claude-3-haiku', 'gemini-flash'];
        }
    }

    /**
     * Get provider from model name
     */
    private getProviderFromModel(model: string): string {
        if (model.startsWith('gpt-')) return 'openai';
        if (model.startsWith('claude-')) return 'anthropic';
        if (model.startsWith('gemini-')) return 'google';
        return 'unknown';
    }

    /**
     * Generate reasoning for recommendation
     */
    private generateReasoning(
        model: string,
        context: OptimizationContext,
        confidence: number
    ): string {
        const reasons = [];
        
        reasons.push(`Model: ${model}`);
        
        if (confidence > this.config.confidenceThreshold) {
            reasons.push(`High confidence (${(confidence * 100).toFixed(0)}%) based on historical performance`);
        }
        
        if (context.costBudget === 'low') {
            reasons.push('Optimized for cost efficiency');
        }
        
        if (context.promptComplexity > 0.7) {
            reasons.push('Selected for high complexity tasks');
        }

        return reasons.join('. ') || `Recommended ${model} based on learning`;
    }

    /**
     * Load bandit state from database
     */
    private async loadBanditState(): Promise<void> {
        try {
            const histories = await ModelPerformanceHistory.find({}).lean();
            
            histories.forEach(history => {
                const arm: BanditArm = {
                    model: history.modelName,
                    provider: history.provider,
                    pulls: history.metrics.totalRequests,
                    successes: history.metrics.successfulRequests,
                    totalReward: history.metrics.successfulRequests,
                    alpha: history.metrics.successfulRequests + 1,
                    beta: history.metrics.failedRequests + 1
                };
                
                // Store with default context keys
                const defaultKey = `${history.modelName}:pro:general`;
                this.banditArms.set(defaultKey, arm);
            });

            loggingService.info('Bandit state loaded', {
                component: 'OptimizationFeedbackLoop',
                armCount: this.banditArms.size
            });

        } catch (error) {
            loggingService.error('Failed to load bandit state', {
                component: 'OptimizationFeedbackLoop',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
}

// Export singleton instance
export const optimizationFeedbackLoop = OptimizationFeedbackLoopService.getInstance();

