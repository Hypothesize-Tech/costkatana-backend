import { RequestFeedback, IRequestFeedback } from '../models/RequestFeedback';
import { Usage } from '../models/Usage';
import { loggingService } from './logging.service';

export interface FeedbackData {
    rating: boolean; // true = positive, false = negative
    comment?: string;
    implicitSignals?: {
        copied?: boolean;
        conversationContinued?: boolean;
        immediateRephrase?: boolean;
        sessionDuration?: number;
        codeAccepted?: boolean;
    };
    userAgent?: string;
    ipAddress?: string;
}

export interface FeedbackAnalytics {
    totalRequests: number;
    ratedRequests: number;
    positiveRatings: number;
    negativeRatings: number;
    totalCost: number;
    positiveCost: number;
    negativeCost: number;
    averageRating: number;
    costPerPositiveRating: number;
    costPerNegativeRating: number;
    ratingsByProvider: Record<string, { positive: number; negative: number; cost: number }>;
    ratingsByModel: Record<string, { positive: number; negative: number; cost: number }>;
    ratingsByFeature: Record<string, { positive: number; negative: number; cost: number }>;
    implicitSignalsAnalysis: {
        copyRate: number;
        continuationRate: number;
        rephraseRate: number;
        codeAcceptanceRate: number;
        averageSessionDuration: number;
    };
    costSavedFromBlocked?: number; // Future: cost saved from blocking low-rated patterns
}

export class RequestFeedbackService {
    // Background processing queue
    private static backgroundQueue: Array<() => Promise<void>> = [];
    private static backgroundProcessor?: NodeJS.Timeout;
    
    // Circuit breaker for database operations
    private static dbFailureCount: number = 0;
    private static readonly MAX_DB_FAILURES = 5;
    private static readonly CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minutes
    private static lastDbFailureTime: number = 0;
    
    /**
     * Initialize background processor
     */
    static {
        this.startBackgroundProcessor();
    }

    /**
     * Submit feedback for a specific request
     */
    static async submitFeedback(
        requestId: string,
        userId: string,
        feedbackData: FeedbackData
    ): Promise<void> {
        try {
            // Check if feedback already exists for this request
            const existingFeedback = await RequestFeedback.findOne({ requestId });
            if (existingFeedback) {
                throw new Error('Feedback already exists for this request');
            }

            // Get request details from Usage collection for analytics
            const usageRecord = await Usage.findOne({ 
                'metadata.requestId': requestId 
            }).sort({ createdAt: -1 });

            const feedbackRecord = new RequestFeedback({
                requestId,
                userId,
                rating: feedbackData.rating,
                comment: feedbackData.comment,
                
                // Copy request details from usage record if available
                modelName: usageRecord?.model,
                provider: usageRecord?.service,
                cost: usageRecord?.cost,
                tokens: usageRecord?.totalTokens,
                
                // Implicit signals
                implicitSignals: feedbackData.implicitSignals,
                
                // Metadata
                userAgent: feedbackData.userAgent,
                ipAddress: feedbackData.ipAddress,
                feature: usageRecord?.metadata?.feature
            });

            await feedbackRecord.save();

            loggingService.info('Feedback submitted successfully', { value:  { 
                requestId,
                userId,
                rating: feedbackData.rating,
                cost: usageRecord?.cost
             } });

        } catch (error) {
            loggingService.error('Error submitting feedback:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get feedback analytics for a user (optimized with aggregation pipeline)
     */
    static async getFeedbackAnalytics(userId: string): Promise<FeedbackAnalytics> {
        try {
            // Check circuit breaker
            if (this.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            // Use MongoDB aggregation pipeline for efficient analytics calculation
            const analyticsResults = await RequestFeedback.aggregate([
                { $match: { userId } },
                {
                    $facet: {
                        // Basic statistics
                        basicStats: [
                            {
                                $group: {
                                    _id: null,
                                    totalRequests: { $sum: 1 },
                                    positiveRatings: { $sum: { $cond: ['$rating', 1, 0] } },
                                    negativeRatings: { $sum: { $cond: ['$rating', 0, 1] } },
                                    totalCost: { $sum: { $ifNull: ['$cost', 0] } },
                                    positiveCost: { $sum: { $cond: ['$rating', { $ifNull: ['$cost', 0] }, 0] } },
                                    negativeCost: { $sum: { $cond: ['$rating', 0, { $ifNull: ['$cost', 0] }] } }
                                }
                            }
                        ],
                        // Ratings by provider
                        byProvider: [
                            {
                                $group: {
                                    _id: { $ifNull: ['$provider', 'unknown'] },
                                    positive: { $sum: { $cond: ['$rating', 1, 0] } },
                                    negative: { $sum: { $cond: ['$rating', 0, 1] } },
                                    cost: { $sum: { $ifNull: ['$cost', 0] } }
                                }
                            }
                        ],
                        // Ratings by model
                        byModel: [
                            {
                                $group: {
                                    _id: { $ifNull: ['$modelName', 'unknown'] },
                                    positive: { $sum: { $cond: ['$rating', 1, 0] } },
                                    negative: { $sum: { $cond: ['$rating', 0, 1] } },
                                    cost: { $sum: { $ifNull: ['$cost', 0] } }
                                }
                            }
                        ],
                        // Ratings by feature
                        byFeature: [
                            {
                                $group: {
                                    _id: { $ifNull: ['$feature', 'unknown'] },
                                    positive: { $sum: { $cond: ['$rating', 1, 0] } },
                                    negative: { $sum: { $cond: ['$rating', 0, 1] } },
                                    cost: { $sum: { $ifNull: ['$cost', 0] } }
                                }
                            }
                        ],
                        // Implicit signals analysis
                        implicitSignals: [
                            { $match: { implicitSignals: { $exists: true, $ne: null } } },
                            {
                                $group: {
                                    _id: null,
                                    totalWithSignals: { $sum: 1 },
                                    copiedCount: { $sum: { $cond: ['$implicitSignals.copied', 1, 0] } },
                                    continuedCount: { $sum: { $cond: ['$implicitSignals.conversationContinued', 1, 0] } },
                                    rephrasedCount: { $sum: { $cond: ['$implicitSignals.immediateRephrase', 1, 0] } },
                                    codeAcceptedCount: { $sum: { $cond: ['$implicitSignals.codeAccepted', 1, 0] } },
                                    totalSessionDuration: { $sum: { $ifNull: ['$implicitSignals.sessionDuration', 0] } }
                                }
                            }
                        ]
                    }
                }
            ]);

            const result = analyticsResults[0];
            
            if (!result || !result.basicStats || result.basicStats.length === 0) {
                return this.getEmptyAnalytics();
            }

            const basicStats = result.basicStats[0];
            const implicitStats = result.implicitSignals[0] || { totalWithSignals: 0, copiedCount: 0, continuedCount: 0, rephrasedCount: 0, codeAcceptedCount: 0, totalSessionDuration: 0 };

            // Transform aggregation results to expected format
            const ratingsByProvider: Record<string, { positive: number; negative: number; cost: number }> = {};
            result.byProvider.forEach((item: any) => {
                ratingsByProvider[item._id] = {
                    positive: item.positive,
                    negative: item.negative,
                    cost: item.cost
                };
            });

            const ratingsByModel: Record<string, { positive: number; negative: number; cost: number }> = {};
            result.byModel.forEach((item: any) => {
                ratingsByModel[item._id] = {
                    positive: item.positive,
                    negative: item.negative,
                    cost: item.cost
                };
            });

            const ratingsByFeature: Record<string, { positive: number; negative: number; cost: number }> = {};
            result.byFeature.forEach((item: any) => {
                ratingsByFeature[item._id] = {
                    positive: item.positive,
                    negative: item.negative,
                    cost: item.cost
                };
            });

            const implicitSignalsAnalysis = {
                copyRate: implicitStats.totalWithSignals > 0 ? implicitStats.copiedCount / implicitStats.totalWithSignals : 0,
                continuationRate: implicitStats.totalWithSignals > 0 ? implicitStats.continuedCount / implicitStats.totalWithSignals : 0,
                rephraseRate: implicitStats.totalWithSignals > 0 ? implicitStats.rephrasedCount / implicitStats.totalWithSignals : 0,
                codeAcceptanceRate: implicitStats.totalWithSignals > 0 ? implicitStats.codeAcceptedCount / implicitStats.totalWithSignals : 0,
                averageSessionDuration: implicitStats.totalWithSignals > 0 ? implicitStats.totalSessionDuration / implicitStats.totalWithSignals : 0
            };

            // Reset failure count on success
            this.dbFailureCount = 0;

            return {
                totalRequests: basicStats.totalRequests,
                ratedRequests: basicStats.totalRequests,
                positiveRatings: basicStats.positiveRatings,
                negativeRatings: basicStats.negativeRatings,
                totalCost: basicStats.totalCost,
                positiveCost: basicStats.positiveCost,
                negativeCost: basicStats.negativeCost,
                averageRating: basicStats.totalRequests > 0 ? basicStats.positiveRatings / basicStats.totalRequests : 0,
                costPerPositiveRating: basicStats.positiveRatings > 0 ? basicStats.positiveCost / basicStats.positiveRatings : 0,
                costPerNegativeRating: basicStats.negativeRatings > 0 ? basicStats.negativeCost / basicStats.negativeRatings : 0,
                ratingsByProvider,
                ratingsByModel,
                ratingsByFeature,
                implicitSignalsAnalysis
            };

        } catch (error) {
            this.recordDbFailure();
            loggingService.error('Error getting feedback analytics:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get global feedback analytics (admin only) - optimized with aggregation pipeline
     */
    static async getGlobalFeedbackAnalytics(): Promise<FeedbackAnalytics> {
        try {
            // Check circuit breaker
            if (this.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            // Use the same optimized aggregation pipeline but without userId filter
            const analyticsResults = await RequestFeedback.aggregate([
                {
                    $facet: {
                        // Basic statistics
                        basicStats: [
                            {
                                $group: {
                                    _id: null,
                                    totalRequests: { $sum: 1 },
                                    positiveRatings: { $sum: { $cond: ['$rating', 1, 0] } },
                                    negativeRatings: { $sum: { $cond: ['$rating', 0, 1] } },
                                    totalCost: { $sum: { $ifNull: ['$cost', 0] } },
                                    positiveCost: { $sum: { $cond: ['$rating', { $ifNull: ['$cost', 0] }, 0] } },
                                    negativeCost: { $sum: { $cond: ['$rating', 0, { $ifNull: ['$cost', 0] }] } }
                                }
                            }
                        ],
                        // Ratings by provider
                        byProvider: [
                            {
                                $group: {
                                    _id: { $ifNull: ['$provider', 'unknown'] },
                                    positive: { $sum: { $cond: ['$rating', 1, 0] } },
                                    negative: { $sum: { $cond: ['$rating', 0, 1] } },
                                    cost: { $sum: { $ifNull: ['$cost', 0] } }
                                }
                            }
                        ],
                        // Ratings by model
                        byModel: [
                            {
                                $group: {
                                    _id: { $ifNull: ['$modelName', 'unknown'] },
                                    positive: { $sum: { $cond: ['$rating', 1, 0] } },
                                    negative: { $sum: { $cond: ['$rating', 0, 1] } },
                                    cost: { $sum: { $ifNull: ['$cost', 0] } }
                                }
                            }
                        ],
                        // Ratings by feature
                        byFeature: [
                            {
                                $group: {
                                    _id: { $ifNull: ['$feature', 'unknown'] },
                                    positive: { $sum: { $cond: ['$rating', 1, 0] } },
                                    negative: { $sum: { $cond: ['$rating', 0, 1] } },
                                    cost: { $sum: { $ifNull: ['$cost', 0] } }
                                }
                            }
                        ],
                        // Implicit signals analysis
                        implicitSignals: [
                            { $match: { implicitSignals: { $exists: true, $ne: null } } },
                            {
                                $group: {
                                    _id: null,
                                    totalWithSignals: { $sum: 1 },
                                    copiedCount: { $sum: { $cond: ['$implicitSignals.copied', 1, 0] } },
                                    continuedCount: { $sum: { $cond: ['$implicitSignals.conversationContinued', 1, 0] } },
                                    rephrasedCount: { $sum: { $cond: ['$implicitSignals.immediateRephrase', 1, 0] } },
                                    codeAcceptedCount: { $sum: { $cond: ['$implicitSignals.codeAccepted', 1, 0] } },
                                    totalSessionDuration: { $sum: { $ifNull: ['$implicitSignals.sessionDuration', 0] } }
                                }
                            }
                        ]
                    }
                }
            ]);

            const result = analyticsResults[0];
            
            if (!result || !result.basicStats || result.basicStats.length === 0) {
                return this.getEmptyAnalytics();
            }

            const basicStats = result.basicStats[0];
            const implicitStats = result.implicitSignals[0] || { totalWithSignals: 0, copiedCount: 0, continuedCount: 0, rephrasedCount: 0, codeAcceptedCount: 0, totalSessionDuration: 0 };

            // Transform aggregation results to expected format (same as user analytics)
            const ratingsByProvider: Record<string, { positive: number; negative: number; cost: number }> = {};
            result.byProvider.forEach((item: any) => {
                ratingsByProvider[item._id] = {
                    positive: item.positive,
                    negative: item.negative,
                    cost: item.cost
                };
            });

            const ratingsByModel: Record<string, { positive: number; negative: number; cost: number }> = {};
            result.byModel.forEach((item: any) => {
                ratingsByModel[item._id] = {
                    positive: item.positive,
                    negative: item.negative,
                    cost: item.cost
                };
            });

            const ratingsByFeature: Record<string, { positive: number; negative: number; cost: number }> = {};
            result.byFeature.forEach((item: any) => {
                ratingsByFeature[item._id] = {
                    positive: item.positive,
                    negative: item.negative,
                    cost: item.cost
                };
            });

            const implicitSignalsAnalysis = {
                copyRate: implicitStats.totalWithSignals > 0 ? implicitStats.copiedCount / implicitStats.totalWithSignals : 0,
                continuationRate: implicitStats.totalWithSignals > 0 ? implicitStats.continuedCount / implicitStats.totalWithSignals : 0,
                rephraseRate: implicitStats.totalWithSignals > 0 ? implicitStats.rephrasedCount / implicitStats.totalWithSignals : 0,
                codeAcceptanceRate: implicitStats.totalWithSignals > 0 ? implicitStats.codeAcceptedCount / implicitStats.totalWithSignals : 0,
                averageSessionDuration: implicitStats.totalWithSignals > 0 ? implicitStats.totalSessionDuration / implicitStats.totalWithSignals : 0
            };

            // Reset failure count on success
            this.dbFailureCount = 0;

            return {
                totalRequests: basicStats.totalRequests,
                ratedRequests: basicStats.totalRequests,
                positiveRatings: basicStats.positiveRatings,
                negativeRatings: basicStats.negativeRatings,
                totalCost: basicStats.totalCost,
                positiveCost: basicStats.positiveCost,
                negativeCost: basicStats.negativeCost,
                averageRating: basicStats.totalRequests > 0 ? basicStats.positiveRatings / basicStats.totalRequests : 0,
                costPerPositiveRating: basicStats.positiveRatings > 0 ? basicStats.positiveCost / basicStats.positiveRatings : 0,
                costPerNegativeRating: basicStats.negativeRatings > 0 ? basicStats.negativeCost / basicStats.negativeRatings : 0,
                ratingsByProvider,
                ratingsByModel,
                ratingsByFeature,
                implicitSignalsAnalysis
            };

        } catch (error) {
            this.recordDbFailure();
            loggingService.error('Error getting global feedback analytics:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get feedback for a specific request
     */
    static async getFeedbackByRequestId(requestId: string): Promise<IRequestFeedback | null> {
        try {
            return await RequestFeedback.findOne({ requestId });
        } catch (error) {
            loggingService.error('Error getting feedback by request ID:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Update implicit signals for a request
     */
    static async updateImplicitSignals(
        requestId: string,
        signals: {
            copied?: boolean;
            conversationContinued?: boolean;
            immediateRephrase?: boolean;
            sessionDuration?: number;
            codeAccepted?: boolean;
        }
    ): Promise<void> {
        try {
            await RequestFeedback.findOneAndUpdate(
                { requestId },
                { 
                    $set: { 
                        'implicitSignals.copied': signals.copied,
                        'implicitSignals.conversationContinued': signals.conversationContinued,
                        'implicitSignals.immediateRephrase': signals.immediateRephrase,
                        'implicitSignals.sessionDuration': signals.sessionDuration,
                        'implicitSignals.codeAccepted': signals.codeAccepted
                    }
                },
                { upsert: false }
            );

            loggingService.info('Implicit signals updated', { value:  {  requestId, signals  } });
        } catch (error) {
            loggingService.error('Error updating implicit signals:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get empty analytics structure
     */
    private static getEmptyAnalytics(): FeedbackAnalytics {
        return {
            totalRequests: 0,
            ratedRequests: 0,
            positiveRatings: 0,
            negativeRatings: 0,
            totalCost: 0,
            positiveCost: 0,
            negativeCost: 0,
            averageRating: 0,
            costPerPositiveRating: 0,
            costPerNegativeRating: 0,
            ratingsByProvider: {},
            ratingsByModel: {},
            ratingsByFeature: {},
            implicitSignalsAnalysis: {
                copyRate: 0,
                continuationRate: 0,
                rephraseRate: 0,
                codeAcceptanceRate: 0,
                averageSessionDuration: 0
            }
        };
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
    }
}