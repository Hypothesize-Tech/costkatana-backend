import { RequestFeedback, IRequestFeedback } from '../models/RequestFeedback';
import { Usage } from '../models/Usage';
import { logger } from '../utils/logger';

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

            logger.info('Feedback submitted successfully', {
                requestId,
                userId,
                rating: feedbackData.rating,
                cost: usageRecord?.cost
            });

        } catch (error) {
            logger.error('Error submitting feedback:', error);
            throw error;
        }
    }

    /**
     * Get feedback analytics for a user
     */
    static async getFeedbackAnalytics(userId: string): Promise<FeedbackAnalytics> {
        try {
            // Get all feedback records for the user
            const feedbackRecords = await RequestFeedback.find({ userId });
            
            if (feedbackRecords.length === 0) {
                return RequestFeedbackService.getEmptyAnalytics();
            }

            const totalRequests = feedbackRecords.length;
            const positiveRatings = feedbackRecords.filter(f => f.rating === true).length;
            const negativeRatings = feedbackRecords.filter(f => f.rating === false).length;
            
            const totalCost = feedbackRecords.reduce((sum, f) => sum + (f.cost || 0), 0);
            const positiveCost = feedbackRecords
                .filter(f => f.rating === true)
                .reduce((sum, f) => sum + (f.cost || 0), 0);
            const negativeCost = feedbackRecords
                .filter(f => f.rating === false)
                .reduce((sum, f) => sum + (f.cost || 0), 0);

            // Calculate ratings by provider
            const ratingsByProvider: Record<string, { positive: number; negative: number; cost: number }> = {};
            feedbackRecords.forEach(record => {
                const provider = record.provider || 'unknown';
                if (!ratingsByProvider[provider]) {
                    ratingsByProvider[provider] = { positive: 0, negative: 0, cost: 0 };
                }
                
                if (record.rating) {
                    ratingsByProvider[provider].positive++;
                } else {
                    ratingsByProvider[provider].negative++;
                }
                ratingsByProvider[provider].cost += record.cost || 0;
            });

            // Calculate ratings by model
            const ratingsByModel: Record<string, { positive: number; negative: number; cost: number }> = {};
            feedbackRecords.forEach(record => {
                const model = record.modelName || 'unknown';
                if (!ratingsByModel[model]) {
                    ratingsByModel[model] = { positive: 0, negative: 0, cost: 0 };
                }
                
                if (record.rating) {
                    ratingsByModel[model].positive++;
                } else {
                    ratingsByModel[model].negative++;
                }
                ratingsByModel[model].cost += record.cost || 0;
            });

            // Calculate ratings by feature
            const ratingsByFeature: Record<string, { positive: number; negative: number; cost: number }> = {};
            feedbackRecords.forEach(record => {
                const feature = record.feature || 'unknown';
                if (!ratingsByFeature[feature]) {
                    ratingsByFeature[feature] = { positive: 0, negative: 0, cost: 0 };
                }
                
                if (record.rating) {
                    ratingsByFeature[feature].positive++;
                } else {
                    ratingsByFeature[feature].negative++;
                }
                ratingsByFeature[feature].cost += record.cost || 0;
            });

            // Calculate implicit signals analysis
            const recordsWithSignals = feedbackRecords.filter(r => r.implicitSignals);
            const implicitSignalsAnalysis = {
                copyRate: recordsWithSignals.length > 0 ? 
                    recordsWithSignals.filter(r => r.implicitSignals?.copied).length / recordsWithSignals.length : 0,
                continuationRate: recordsWithSignals.length > 0 ? 
                    recordsWithSignals.filter(r => r.implicitSignals?.conversationContinued).length / recordsWithSignals.length : 0,
                rephraseRate: recordsWithSignals.length > 0 ? 
                    recordsWithSignals.filter(r => r.implicitSignals?.immediateRephrase).length / recordsWithSignals.length : 0,
                codeAcceptanceRate: recordsWithSignals.length > 0 ? 
                    recordsWithSignals.filter(r => r.implicitSignals?.codeAccepted).length / recordsWithSignals.length : 0,
                averageSessionDuration: recordsWithSignals.length > 0 ? 
                    recordsWithSignals.reduce((sum, r) => sum + (r.implicitSignals?.sessionDuration || 0), 0) / recordsWithSignals.length : 0
            };

            return {
                totalRequests,
                ratedRequests: totalRequests,
                positiveRatings,
                negativeRatings,
                totalCost,
                positiveCost,
                negativeCost,
                averageRating: positiveRatings / totalRequests,
                costPerPositiveRating: positiveRatings > 0 ? positiveCost / positiveRatings : 0,
                costPerNegativeRating: negativeRatings > 0 ? negativeCost / negativeRatings : 0,
                ratingsByProvider,
                ratingsByModel,
                ratingsByFeature,
                implicitSignalsAnalysis
            };

        } catch (error) {
            logger.error('Error getting feedback analytics:', error);
            throw error;
        }
    }

    /**
     * Get global feedback analytics (admin only)
     */
    static async getGlobalFeedbackAnalytics(): Promise<FeedbackAnalytics> {
        try {
            const feedbackRecords = await RequestFeedback.find({});
            
            if (feedbackRecords.length === 0) {
                return RequestFeedbackService.getEmptyAnalytics();
            }

            // Similar calculation as getFeedbackAnalytics but for all users
            const totalRequests = feedbackRecords.length;
            const positiveRatings = feedbackRecords.filter(f => f.rating === true).length;
            const negativeRatings = feedbackRecords.filter(f => f.rating === false).length;
            
            const totalCost = feedbackRecords.reduce((sum, f) => sum + (f.cost || 0), 0);
            const positiveCost = feedbackRecords
                .filter(f => f.rating === true)
                .reduce((sum, f) => sum + (f.cost || 0), 0);
            const negativeCost = feedbackRecords
                .filter(f => f.rating === false)
                .reduce((sum, f) => sum + (f.cost || 0), 0);

            // Calculate other metrics (same logic as above)
            const ratingsByProvider: Record<string, { positive: number; negative: number; cost: number }> = {};
            const ratingsByModel: Record<string, { positive: number; negative: number; cost: number }> = {};
            const ratingsByFeature: Record<string, { positive: number; negative: number; cost: number }> = {};

            feedbackRecords.forEach(record => {
                // Provider stats
                const provider = record.provider || 'unknown';
                if (!ratingsByProvider[provider]) {
                    ratingsByProvider[provider] = { positive: 0, negative: 0, cost: 0 };
                }
                if (record.rating) ratingsByProvider[provider].positive++;
                else ratingsByProvider[provider].negative++;
                ratingsByProvider[provider].cost += record.cost || 0;

                // Model stats
                const model = record.modelName || 'unknown';
                if (!ratingsByModel[model]) {
                    ratingsByModel[model] = { positive: 0, negative: 0, cost: 0 };
                }
                if (record.rating) ratingsByModel[model].positive++;
                else ratingsByModel[model].negative++;
                ratingsByModel[model].cost += record.cost || 0;

                // Feature stats
                const feature = record.feature || 'unknown';
                if (!ratingsByFeature[feature]) {
                    ratingsByFeature[feature] = { positive: 0, negative: 0, cost: 0 };
                }
                if (record.rating) ratingsByFeature[feature].positive++;
                else ratingsByFeature[feature].negative++;
                ratingsByFeature[feature].cost += record.cost || 0;
            });

            const recordsWithSignals = feedbackRecords.filter(r => r.implicitSignals);
            const implicitSignalsAnalysis = {
                copyRate: recordsWithSignals.length > 0 ? 
                    recordsWithSignals.filter(r => r.implicitSignals?.copied).length / recordsWithSignals.length : 0,
                continuationRate: recordsWithSignals.length > 0 ? 
                    recordsWithSignals.filter(r => r.implicitSignals?.conversationContinued).length / recordsWithSignals.length : 0,
                rephraseRate: recordsWithSignals.length > 0 ? 
                    recordsWithSignals.filter(r => r.implicitSignals?.immediateRephrase).length / recordsWithSignals.length : 0,
                codeAcceptanceRate: recordsWithSignals.length > 0 ? 
                    recordsWithSignals.filter(r => r.implicitSignals?.codeAccepted).length / recordsWithSignals.length : 0,
                averageSessionDuration: recordsWithSignals.length > 0 ? 
                    recordsWithSignals.reduce((sum, r) => sum + (r.implicitSignals?.sessionDuration || 0), 0) / recordsWithSignals.length : 0
            };

            return {
                totalRequests,
                ratedRequests: totalRequests,
                positiveRatings,
                negativeRatings,
                totalCost,
                positiveCost,
                negativeCost,
                averageRating: positiveRatings / totalRequests,
                costPerPositiveRating: positiveRatings > 0 ? positiveCost / positiveRatings : 0,
                costPerNegativeRating: negativeRatings > 0 ? negativeCost / negativeRatings : 0,
                ratingsByProvider,
                ratingsByModel,
                ratingsByFeature,
                implicitSignalsAnalysis
            };

        } catch (error) {
            logger.error('Error getting global feedback analytics:', error);
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
            logger.error('Error getting feedback by request ID:', error);
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

            logger.info('Implicit signals updated', { requestId, signals });
        } catch (error) {
            logger.error('Error updating implicit signals:', error);
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
}