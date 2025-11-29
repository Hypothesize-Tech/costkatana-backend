import { loggingService } from './logging.service';

export interface AcceptanceMetrics {
    applyRate: number; // % of generated code that was applied
    ciPassRate: number; // % that passed CI
    rollbackRate: number; // % that was rolled back
    timeSaved: number; // Estimated developer-hours saved
    hallucinationRate: number; // % flagged for incorrect assumptions
    averageLatency: number; // ms from request to patch
    userAcceptance: number; // % with positive feedback
}

export interface FeedbackRecord {
    generationId: string;
    userId: string;
    applied: boolean;
    ciPassed: boolean;
    rolledBack: boolean;
    feedback: 'positive' | 'negative' | 'neutral';
    reason?: string;
    latency: number;
}

/**
 * Acceptance metrics service
 * Tracks and analyzes code generation acceptance rates
 */
export class AcceptanceMetricsService {
    private static feedbackRecords: FeedbackRecord[] = [];
    private static readonly MAX_RECORDS = 10000;

    /**
     * Record feedback for a generation
     */
    static recordFeedback(feedback: FeedbackRecord): void {
        this.feedbackRecords.push(feedback);

        // Limit records in memory (in production, would store in database)
        if (this.feedbackRecords.length > this.MAX_RECORDS) {
            this.feedbackRecords = this.feedbackRecords.slice(-this.MAX_RECORDS);
        }

        loggingService.info('Feedback recorded', {
            component: 'AcceptanceMetricsService',
            generationId: feedback.generationId,
            applied: feedback.applied,
            ciPassed: feedback.ciPassed
        });
    }

    /**
     * Calculate acceptance metrics
     */
    static calculateMetrics(
        userId?: string,
        repoFullName?: string,
        timeRange?: { from: Date; to: Date }
    ): AcceptanceMetrics {
        let records = this.feedbackRecords;

        // Filter by user if specified
        if (userId) {
            records = records.filter(r => r.userId === userId);
        }

        // Filter by time range if specified
        if (timeRange) {
            records = records.filter(r => {
                const recordTime = new Date(r.generationId.split('_')[1] || '0');
                return recordTime >= timeRange.from && recordTime <= timeRange.to;
            });
        }

        if (records.length === 0) {
            return {
                applyRate: 0,
                ciPassRate: 0,
                rollbackRate: 0,
                timeSaved: 0,
                hallucinationRate: 0,
                averageLatency: 0,
                userAcceptance: 0
            };
        }

        const applied = records.filter(r => r.applied).length;
        const ciPassed = records.filter(r => r.ciPassed).length;
        const rolledBack = records.filter(r => r.rolledBack).length;
        const positiveFeedback = records.filter(r => r.feedback === 'positive').length;
        const negativeFeedback = records.filter(r => r.feedback === 'negative').length;

        const totalLatency = records.reduce((sum, r) => sum + r.latency, 0);

        return {
            applyRate: applied / records.length,
            ciPassRate: ciPassed / Math.max(applied, 1),
            rollbackRate: rolledBack / Math.max(applied, 1),
            timeSaved: this.estimateTimeSaved(records),
            hallucinationRate: negativeFeedback / records.length,
            averageLatency: totalLatency / records.length,
            userAcceptance: positiveFeedback / records.length
        };
    }

    /**
     * Estimate time saved (developer-hours)
     */
    private static estimateTimeSaved(records: FeedbackRecord[]): number {
        // Rough estimate: 2 hours saved per applied generation
        const appliedCount = records.filter(r => r.applied).length;
        return appliedCount * 2;
    }

    /**
     * Get metrics for a specific repository
     */
    static getRepositoryMetrics(repoFullName: string): AcceptanceMetrics {
        // In production, would filter by repoFullName from stored records
        return this.calculateMetrics();
    }
}

