import mongoose from 'mongoose';
import { loggingService } from './logging.service';

// Schema for simulation tracking
const SimulationTrackingSchema = new mongoose.Schema({
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true,
        index: true 
    },
    sessionId: { 
        type: String, 
        required: true 
    },
    originalUsageId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Usage',
        required: false 
    },
    simulationType: {
        type: String,
        enum: ['real_time_analysis', 'prompt_optimization', 'context_trimming', 'model_comparison'],
        required: true
    },
    originalModel: { type: String, required: true },
    originalPrompt: { type: String, required: true },
    originalCost: { type: Number, required: true },
    originalTokens: { type: Number, required: true },
    
    // Simulation parameters
    parameters: {
        temperature: { type: Number },
        maxTokens: { type: Number },
        trimPercentage: { type: Number },
        alternativeModels: [String]
    },
    
    // Simulation results
    optimizationOptions: [{
        type: { type: String, required: true },
        description: { type: String, required: true },
        newModel: String,
        newCost: Number,
        savings: Number,
        savingsPercentage: Number,
        risk: { type: String, enum: ['low', 'medium', 'high'] },
        implementation: { type: String, enum: ['easy', 'moderate', 'complex'] },
        confidence: Number
    }],
    
    recommendations: [mongoose.Schema.Types.Mixed],
    potentialSavings: { type: Number, required: true },
    confidence: { type: Number, required: true },
    
    // User interaction tracking
    viewedAt: { type: Date, default: Date.now },
    timeSpentViewing: { type: Number }, // in seconds
    optionsViewed: [Number], // indices of options viewed
    appliedOptimizations: [{
        optionIndex: Number,
        appliedAt: Date,
        type: String,
        estimatedSavings: Number,
        actualSavings: Number, // filled in later if we can track actual results
        userFeedback: {
            satisfied: Boolean,
            comment: String,
            rating: { type: Number, min: 1, max: 5 }
        }
    }],
    
    // Metadata
    userAgent: String,
    ipAddress: String,
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, {
    timestamps: true,
    collection: 'simulation_tracking'
});

// Indexes for performance
SimulationTrackingSchema.index({ userId: 1, createdAt: -1 });
SimulationTrackingSchema.index({ sessionId: 1 });
SimulationTrackingSchema.index({ simulationType: 1, createdAt: -1 });
SimulationTrackingSchema.index({ 'appliedOptimizations.appliedAt': -1 });

const SimulationTracking = mongoose.model('SimulationTracking', SimulationTrackingSchema);

export interface SimulationTrackingData {
    userId: string;
    sessionId: string;
    originalUsageId?: string;
    simulationType: 'real_time_analysis' | 'prompt_optimization' | 'context_trimming' | 'model_comparison';
    originalModel: string;
    originalPrompt: string;
    originalCost: number;
    originalTokens: number;
    parameters?: {
        temperature?: number;
        maxTokens?: number;
        trimPercentage?: number;
        alternativeModels?: string[];
    };
    optimizationOptions: Array<{
        type: string;
        description: string;
        newModel?: string;
        newCost?: number;
        savings?: number;
        savingsPercentage?: number;
        risk?: 'low' | 'medium' | 'high';
        implementation?: 'easy' | 'moderate' | 'complex';
        confidence?: number;
    }>;
    recommendations: any[];
    potentialSavings: number;
    confidence: number;
    userAgent?: string;
    ipAddress?: string;
    projectId?: string;
}

export interface OptimizationApplication {
    optionIndex: number;
    type: string;
    estimatedSavings: number;
    userFeedback?: {
        satisfied: boolean;
        comment?: string;
        rating?: number;
    };
}

export interface SimulationStats {
    totalSimulations: number;
    totalOptimizationsApplied: number;
    acceptanceRate: number;
    averageSavings: number;
    totalPotentialSavings: number;
    totalActualSavings: number;
    topOptimizationTypes: Array<{
        type: string;
        count: number;
        averageSavings: number;
        acceptanceRate: number;
    }>;
    userEngagement: {
        averageTimeSpent: number;
        averageOptionsViewed: number;
        returnUsers: number;
    };
    weeklyTrends: Array<{
        week: string;
        simulations: number;
        applications: number;
        savings: number;
    }>;
}

export class SimulationTrackingService {
    // Background processing queue
    private static backgroundQueue: Array<() => Promise<void>> = [];
    private static backgroundProcessor?: NodeJS.Timeout;
    
    // Circuit breaker for database operations
    private static dbFailureCount: number = 0;
    private static readonly MAX_DB_FAILURES = 5;
    private static readonly CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minutes
    private static lastDbFailureTime: number = 0;
    
    // ObjectId conversion utilities
    private static objectIdCache = new Map<string, any>();
    private static readonly OBJECTID_CACHE_TTL = 300000; // 5 minutes
    
    /**
     * Initialize background processor
     */
    static {
        this.startBackgroundProcessor();
    }
    
    /**
     * Track a new simulation
     */
    static async trackSimulation(data: SimulationTrackingData): Promise<string> {
        try {
            const tracking = new SimulationTracking({
                userId: new mongoose.Types.ObjectId(data.userId),
                sessionId: data.sessionId,
                originalUsageId: data.originalUsageId ? new mongoose.Types.ObjectId(data.originalUsageId) : undefined,
                simulationType: data.simulationType,
                originalModel: data.originalModel,
                originalPrompt: data.originalPrompt,
                originalCost: data.originalCost,
                originalTokens: data.originalTokens,
                parameters: data.parameters,
                optimizationOptions: data.optimizationOptions,
                recommendations: data.recommendations,
                potentialSavings: data.potentialSavings,
                confidence: data.confidence,
                userAgent: data.userAgent,
                ipAddress: data.ipAddress,
                projectId: data.projectId ? new mongoose.Types.ObjectId(data.projectId) : undefined
            });

            const saved = await tracking.save();
            loggingService.info(`Simulation tracked: ${saved._id} for user ${data.userId}`);
            return saved._id.toString();
        } catch (error) {
            loggingService.error('Error tracking simulation:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Track optimization application
     */
    static async trackOptimizationApplication(
        trackingId: string, 
        application: OptimizationApplication
    ): Promise<void> {
        try {
            await SimulationTracking.findByIdAndUpdate(
                trackingId,
                {
                    $push: {
                        appliedOptimizations: {
                            ...application,
                            appliedAt: new Date()
                        }
                    },
                    $set: { updatedAt: new Date() }
                }
            );
            
            loggingService.info(`Optimization application tracked: ${trackingId}`);
        } catch (error) {
            loggingService.error('Error tracking optimization application:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Update viewing metrics
     */
    static async updateViewingMetrics(
        trackingId: string,
        timeSpent: number,
        optionsViewed: number[]
    ): Promise<void> {
        try {
            await SimulationTracking.findByIdAndUpdate(
                trackingId,
                {
                    $set: {
                        timeSpentViewing: timeSpent,
                        optionsViewed: optionsViewed,
                        updatedAt: new Date()
                    }
                }
            );
        } catch (error) {
            loggingService.error('Error updating viewing metrics:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get simulation statistics for a user or globally (optimized with unified aggregation)
     */
    static async getSimulationStats(
        userId?: string,
        timeRange?: { startDate: Date; endDate: Date }
    ): Promise<SimulationStats> {
        try {
            // Check circuit breaker
            if (this.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            const matchStage: any = {};
            
            if (userId) {
                matchStage.userId = this.getOptimizedObjectId(userId);
            }
            
            if (timeRange) {
                matchStage.createdAt = {
                    $gte: timeRange.startDate,
                    $lte: timeRange.endDate
                };
            }

            // Use unified aggregation pipeline with $facet for better performance
            const [results] = await SimulationTracking.aggregate([
                { $match: matchStage },
                {
                    $facet: {
                        // Basic statistics
                        basicStats: [
                            {
                                $group: {
                                    _id: null,
                                    totalSimulations: { $sum: 1 },
                                    totalOptimizationsApplied: {
                                        $sum: { $size: { $ifNull: ['$appliedOptimizations', []] } }
                                    },
                                    totalPotentialSavings: { $sum: '$potentialSavings' },
                                    averageConfidence: { $avg: '$confidence' },
                                    averageTimeSpent: { $avg: '$timeSpentViewing' },
                                    averageOptionsViewed: { $avg: { $size: { $ifNull: ['$optionsViewed', []] } } },
                                    uniqueUsers: { $addToSet: '$userId' }
                                }
                            }
                        ],
                        // Optimization type breakdown
                        optimizationTypes: [
                            { $unwind: '$optimizationOptions' },
                            {
                                $group: {
                                    _id: '$optimizationOptions.type',
                                    count: { $sum: 1 },
                                    averageSavings: { $avg: '$optimizationOptions.savings' },
                                    totalApplications: {
                                        $sum: {
                                            $size: {
                                                $filter: {
                                                    input: { $ifNull: ['$appliedOptimizations', []] },
                                                    cond: { $eq: ['$$this.type', '$optimizationOptions.type'] }
                                                }
                                            }
                                        }
                                    }
                                }
                            },
                            {
                                $project: {
                                    type: '$_id',
                                    count: 1,
                                    averageSavings: 1,
                                    acceptanceRate: {
                                        $cond: {
                                            if: { $gt: ['$count', 0] },
                                            then: { $divide: ['$totalApplications', '$count'] },
                                            else: 0
                                        }
                                    }
                                }
                            },
                            { $sort: { count: -1 } }
                        ],
                        // Weekly trends (optimized)
                        weeklyTrends: [
                            {
                                $group: {
                                    _id: {
                                        year: { $year: '$createdAt' },
                                        week: { $week: '$createdAt' }
                                    },
                                    simulations: { $sum: 1 },
                                    applications: {
                                        $sum: { $size: { $ifNull: ['$appliedOptimizations', []] } }
                                    },
                                    savings: { $sum: '$potentialSavings' }
                                }
                            },
                            {
                                $project: {
                                    week: { $concat: [{ $toString: '$_id.year' }, '-W', { $toString: '$_id.week' }] },
                                    simulations: 1,
                                    applications: 1,
                                    savings: 1
                                }
                            },
                            { $sort: { '_id.year': -1, '_id.week': -1 } },
                            { $limit: 12 }
                        ]
                    }
                }
            ]);

            const baseStats = results.basicStats[0] || {
                totalSimulations: 0,
                totalOptimizationsApplied: 0,
                totalPotentialSavings: 0,
                averageConfidence: 0,
                averageTimeSpent: 0,
                averageOptionsViewed: 0,
                uniqueUsers: []
            };

            // Calculate actual savings in parallel with other operations
            const actualSavingsPromise = this.calculateTotalActualSavings(userId, timeRange);

            // Reset failure count on success
            this.dbFailureCount = 0;

            return {
                totalSimulations: baseStats.totalSimulations,
                totalOptimizationsApplied: baseStats.totalOptimizationsApplied,
                acceptanceRate: baseStats.totalSimulations > 0 ? 
                    baseStats.totalOptimizationsApplied / baseStats.totalSimulations : 0,
                averageSavings: baseStats.totalPotentialSavings / (baseStats.totalSimulations || 1),
                totalPotentialSavings: baseStats.totalPotentialSavings,
                totalActualSavings: await actualSavingsPromise,
                topOptimizationTypes: results.optimizationTypes.map((type: any) => ({
                    type: type.type,
                    count: type.count,
                    averageSavings: type.averageSavings || 0,
                    acceptanceRate: type.acceptanceRate || 0
                })),
                userEngagement: {
                    averageTimeSpent: baseStats.averageTimeSpent || 0,
                    averageOptionsViewed: baseStats.averageOptionsViewed || 0,
                    returnUsers: baseStats.uniqueUsers ? baseStats.uniqueUsers.length : 0
                },
                weeklyTrends: results.weeklyTrends
            };
        } catch (error) {
            this.recordDbFailure();
            loggingService.error('Error getting simulation stats:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get top optimization wins for leaderboard
     */
    static async getTopOptimizationWins(
        timeRange?: { startDate: Date; endDate: Date },
        limit: number = 10
    ): Promise<Array<{
        userId: string;
        userName?: string;
        totalSavings: number;
        optimizationsApplied: number;
        averageSavings: number;
        topOptimizationType: string;
    }>> {
        try {
            const matchStage: any = {};
            
            if (timeRange) {
                matchStage.createdAt = {
                    $gte: timeRange.startDate,
                    $lte: timeRange.endDate
                };
            }

            const results = await SimulationTracking.aggregate([
                { $match: matchStage },
                { $unwind: { path: '$appliedOptimizations', preserveNullAndEmptyArrays: false } },
                {
                    $group: {
                        _id: '$userId',
                        totalSavings: { $sum: '$appliedOptimizations.estimatedSavings' },
                        optimizationsApplied: { $sum: 1 },
                        optimizationTypes: { $push: '$appliedOptimizations.type' }
                    }
                },
                {
                    $project: {
                        userId: { $toString: '$_id' },
                        totalSavings: 1,
                        optimizationsApplied: 1,
                        averageSavings: { $divide: ['$totalSavings', '$optimizationsApplied'] },
                        topOptimizationType: { $arrayElemAt: ['$optimizationTypes', 0] }
                    }
                },
                { $sort: { totalSavings: -1 } },
                { $limit: limit }
            ]);

            return results;
        } catch (error) {
            loggingService.error('Error getting top optimization wins:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get user's simulation history
     */
    static async getUserSimulationHistory(
        userId: string,
        limit: number = 20,
        offset: number = 0
    ): Promise<any[]> {
        try {
            const simulations = await SimulationTracking.find(
                { userId: new mongoose.Types.ObjectId(userId) }
            )
            .sort({ createdAt: -1 })
            .limit(limit)
            .skip(offset)
            .populate('originalUsageId', 'prompt model cost totalTokens')
            .populate('projectId', 'name')
            .lean();

            return simulations;
        } catch (error) {
            loggingService.error('Error getting user simulation history:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get applied optimizations for a user or project
     */
    static async getAppliedOptimizations(
        userId?: string,
        projectId?: string,
        timeRange?: { startDate: Date; endDate: Date }
    ): Promise<any[]> {
        try {
            const matchStage: any = {
                'appliedOptimizations.0': { $exists: true } // Has at least one applied optimization
            };

            if (userId) {
                matchStage.userId = new mongoose.Types.ObjectId(userId);
            }

            if (projectId) {
                matchStage.projectId = new mongoose.Types.ObjectId(projectId);
            }

            if (timeRange) {
                matchStage.createdAt = {
                    $gte: timeRange.startDate,
                    $lte: timeRange.endDate
                };
            }

            const results = await SimulationTracking.aggregate([
                { $match: matchStage },
                { $unwind: '$appliedOptimizations' },
                {
                    $lookup: {
                        from: 'usages',
                        localField: 'originalUsageId',
                        foreignField: '_id',
                        as: 'originalUsage'
                    }
                },
                {
                    $project: {
                        _id: 1,
                        userId: 1,
                        projectId: 1,
                        originalUsageId: 1,
                        originalUsage: { $arrayElemAt: ['$originalUsage', 0] },
                        optimization: '$appliedOptimizations',
                        appliedAt: '$appliedOptimizations.appliedAt',
                        createdAt: 1
                    }
                },
                { $sort: { appliedAt: -1 } }
            ]);

            return results;
        } catch (error) {
            loggingService.error('Error getting applied optimizations:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Calculate total actual savings from applied optimizations
     */
    static async calculateTotalActualSavings(
        userId?: string,
        timeRange?: { startDate: Date; endDate: Date }
    ): Promise<number> {
        try {
            const appliedOptimizations = await this.getAppliedOptimizations(userId, undefined, timeRange);
            let totalSavings = 0;

            for (const applied of appliedOptimizations) {
                const optimization = applied.optimization;
                const originalUsage = applied.originalUsage;

                if (!originalUsage || !optimization) continue;

                // Calculate actual savings based on optimization type
                switch (optimization.type) {
                    case 'model_switch':
                        totalSavings += await this.calculateModelSwitchActualSavings(
                            optimization,
                            originalUsage,
                            applied.appliedAt
                        );
                        break;
                    
                    case 'context_trim':
                        totalSavings += await this.calculateContextTrimActualSavings(
                            optimization,
                            originalUsage,
                            applied.appliedAt
                        );
                        break;
                    
                    case 'prompt_optimize':
                        totalSavings += await this.calculatePromptOptimizeActualSavings(
                            optimization,
                            originalUsage,
                            applied.appliedAt
                        );
                        break;
                    
                    default:
                        // For unknown types, use estimated savings
                        totalSavings += optimization.estimatedSavings || 0;
                }
            }

            return totalSavings;
        } catch (error) {
            loggingService.error('Error calculating total actual savings:', { error: error instanceof Error ? error.message : String(error) });
            return 0;
        }
    }

    /**
     * Calculate actual savings from model switch optimization (optimized)
     */
    static async calculateModelSwitchActualSavings(
        optimization: any,
        originalUsage: any,
        appliedAt: Date
    ): Promise<number> {
        try {
            const { newModel } = optimization;
            if (!newModel) return optimization.estimatedSavings || 0;

            // Check circuit breaker
            if (this.isDbCircuitBreakerOpen()) {
                return optimization.estimatedSavings || 0;
            }

            // Find usage with the new model after the optimization was applied
            const Usage = mongoose.model('Usage');
            
            // Use text search instead of regex for better performance
            const promptKeywords = originalUsage.prompt
                .substring(0, 100)
                .split(/\s+/)
                .filter((word: string) => word.length > 3)
                .slice(0, 5); // Take first 5 significant words

            const subsequentUsage = await Usage.find({
                userId: originalUsage.userId,
                model: newModel,
                createdAt: { $gte: appliedAt },
                // Use $text search if available, otherwise fall back to simple matching
                $or: promptKeywords.map((keyword: string) => ({
                    prompt: { $regex: keyword, $options: 'i' }
                }))
            }).limit(10).lean();

            if (subsequentUsage.length === 0) {
                return optimization.estimatedSavings || 0;
            }

            // Calculate average cost difference using vectorized operations
            const costs = subsequentUsage.map((usage: any) => usage.cost);
            const tokens = subsequentUsage.map((usage: any) => usage.totalTokens);
            
            const avgNewModelCost = costs.reduce((sum, cost) => sum + cost, 0) / costs.length;
            const originalCostPerToken = originalUsage.cost / originalUsage.totalTokens;
            const avgTokensInNewUsage = tokens.reduce((sum, token) => sum + token, 0) / tokens.length;
            const estimatedOriginalCost = originalCostPerToken * avgTokensInNewUsage;

            return Math.max(0, estimatedOriginalCost - avgNewModelCost);
        } catch (error) {
            this.recordDbFailure();
            loggingService.error('Error calculating model switch actual savings:', { error: error instanceof Error ? error.message : String(error) });
            return optimization.estimatedSavings || 0;
        }
    }

    /**
     * Calculate actual savings from context trim optimization
     */
    static async calculateContextTrimActualSavings(
        optimization: any,
        originalUsage: any,
        appliedAt: Date
    ): Promise<number> {
        try {
            const { trimPercentage } = optimization;
            if (!trimPercentage) return optimization.estimatedSavings || 0;

            // Find usage after the optimization was applied with similar patterns
            const Usage = mongoose.model('Usage');
            const subsequentUsage = await Usage.find({
                userId: originalUsage.userId,
                model: originalUsage.model,
                createdAt: { $gte: appliedAt },
                // Look for usage with reduced token count
                totalTokens: { $lt: originalUsage.totalTokens * 0.9 }
            }).limit(10).lean();

            if (subsequentUsage.length === 0) {
                return optimization.estimatedSavings || 0;
            }

            // Calculate actual token reduction and cost savings
            const avgNewTokens = subsequentUsage.reduce((sum, usage) => sum + usage.totalTokens, 0) / subsequentUsage.length;
            const avgNewCost = subsequentUsage.reduce((sum, usage) => sum + usage.cost, 0) / subsequentUsage.length;
            const costPerToken = originalUsage.cost / originalUsage.totalTokens;
            const estimatedCostWithoutTrim = avgNewTokens / (1 - trimPercentage / 100) * costPerToken;

            return Math.max(0, estimatedCostWithoutTrim - avgNewCost);
        } catch (error) {
            loggingService.error('Error calculating context trim actual savings:', { error: error instanceof Error ? error.message : String(error) });
            return optimization.estimatedSavings || 0;
        }
    }

    /**
     * Calculate actual savings from prompt optimization
     */
    static async calculatePromptOptimizeActualSavings(
        optimization: any,
        originalUsage: any,
        appliedAt: Date
    ): Promise<number> {
        try {
            // Find usage after the optimization was applied
            const Usage = mongoose.model('Usage');
            const subsequentUsage = await Usage.find({
                userId: originalUsage.userId,
                model: originalUsage.model,
                createdAt: { $gte: appliedAt },
                // Look for optimized prompts (different but related)
                totalTokens: { $lt: originalUsage.totalTokens * 1.1 } // Within 10% token range
            }).limit(10).lean();

            if (subsequentUsage.length === 0) {
                return optimization.estimatedSavings || 0;
            }

            // Calculate efficiency improvement
            const avgNewCost = subsequentUsage.reduce((sum, usage) => sum + usage.cost, 0) / subsequentUsage.length;
            const avgNewTokens = subsequentUsage.reduce((sum, usage) => sum + usage.totalTokens, 0) / subsequentUsage.length;
            
            // Normalize by token count to compare efficiency
            const originalCostPerToken = originalUsage.cost / originalUsage.totalTokens;
            const newCostPerToken = avgNewCost / avgNewTokens;
            const tokenSavings = Math.max(0, originalCostPerToken - newCostPerToken) * avgNewTokens;

            return tokenSavings;
        } catch (error) {
            loggingService.error('Error calculating prompt optimize actual savings:', { error: error instanceof Error ? error.message : String(error) });
            return optimization.estimatedSavings || 0;
        }
    }

    /**
     * Circuit breaker utilities for database operations
     */
    private static isDbCircuitBreakerOpen(): boolean {
        if (this.dbFailureCount >= this.MAX_DB_FAILURES) {
            const timeSinceLastFailure = Date.now() - this.lastDbFailureTime;
            if (timeSinceLastFailure < this.CIRCUIT_BREAKER_RESET_TIME) {
                return true;
            } else {
                // Reset circuit breaker
                this.dbFailureCount = 0;
                return false;
            }
        }
        return false;
    }

    private static recordDbFailure(): void {
        this.dbFailureCount++;
        this.lastDbFailureTime = Date.now();
    }

    private static startBackgroundProcessor(): void {
        this.backgroundProcessor = setInterval(async () => {
            if (this.backgroundQueue.length > 0) {
                const operation = this.backgroundQueue.shift();
                if (operation) {
                    try {
                        await operation();
                    } catch (error) {
                        loggingService.error('Background operation failed:', {
                            error: error instanceof Error ? error.message : String(error)
                        });
                    }
                }
            }
        }, 1000);
    }

    /**
     * ObjectId conversion utilities
     */
    private static getOptimizedObjectId(id: string): any {
        const cached = this.objectIdCache.get(id);
        if (cached && Date.now() - cached.timestamp < this.OBJECTID_CACHE_TTL) {
            return cached.objectId;
        }

        const objectId = new mongoose.Types.ObjectId(id);
        this.objectIdCache.set(id, {
            objectId,
            timestamp: Date.now()
        });

        return objectId;
    }

    /**
     * Cleanup method for graceful shutdown
     */
    static cleanup(): void {
        if (this.backgroundProcessor) {
            clearInterval(this.backgroundProcessor);
            this.backgroundProcessor = undefined;
        }
        
        // Process remaining queue items
        while (this.backgroundQueue.length > 0) {
            const operation = this.backgroundQueue.shift();
            if (operation) {
                operation().catch(error => {
                    loggingService.error('Cleanup operation failed:', {
                        error: error instanceof Error ? error.message : String(error)
                    });
                });
            }
        }
        
        // Clear caches
        this.objectIdCache.clear();
    }
}

export default SimulationTrackingService;