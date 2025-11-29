import { loggingService } from './logging.service';
import { AcceptanceMetricsService } from './acceptanceMetrics.service';

export interface Feedback {
    generationId: string;
    userId: string;
    rating: 'positive' | 'negative' | 'neutral';
    reason?: string;
    applied: boolean;
    ciPassed?: boolean;
    suggestions?: string[];
}

/**
 * Feedback collection service
 * Captures user feedback to improve generation quality
 */
export class FeedbackService {
    /**
     * Record user feedback
     */
    static async recordFeedback(feedback: Feedback): Promise<void> {
        try {
            // Record in acceptance metrics
            AcceptanceMetricsService.recordFeedback({
                generationId: feedback.generationId,
                userId: feedback.userId,
                applied: feedback.applied,
                ciPassed: feedback.ciPassed ?? false,
                rolledBack: false, // Would be tracked separately
                feedback: feedback.rating,
                reason: feedback.reason,
                latency: 0 // Would be tracked from generation start
            });

            loggingService.info('User feedback recorded', {
                component: 'FeedbackService',
                generationId: feedback.generationId,
                rating: feedback.rating,
                applied: feedback.applied
            });

            // In production, would also:
            // - Store feedback in database
            // - Update reranker weights based on feedback
            // - Tune templates based on acceptance patterns
            // - A/B test prompt variations
        } catch (error) {
            loggingService.error('Failed to record feedback', {
                component: 'FeedbackService',
                error: error instanceof Error ? error.message : 'Unknown'
            });
        }
    }

    /**
     * Get feedback summary
     */
    static async getFeedbackSummary(
        userId?: string,
        timeRange?: { from: Date; to: Date }
    ): Promise<{
        total: number;
        positive: number;
        negative: number;
        neutral: number;
        applyRate: number;
    }> {
        const metrics = AcceptanceMetricsService.calculateMetrics(userId, undefined, timeRange);

        return {
            total: 0, // Would be calculated from stored records
            positive: Math.round(metrics.userAcceptance * 100),
            negative: Math.round(metrics.hallucinationRate * 100),
            neutral: 0,
            applyRate: Math.round(metrics.applyRate * 100)
        };
    }
}

