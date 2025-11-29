import { loggingService } from './logging.service';

export interface FeatureScore {
    featureId: string;
    featureName: string;
    score: number;
    factors: {
        frequency: number;
        impact: number;
        risk: number; // Inverted in final score
        complexity: number; // Inverted in final score
        testability: number;
        reusability: number;
    };
}

export interface ScoringWeights {
    frequency: number;
    impact: number;
    risk: number;
    complexity: number;
    testability: number;
    reusability: number;
}

/**
 * Feature scoring service for prioritization
 * Implements weighted scoring rubric for feature prioritization
 */
export class FeatureScoringService {
    private static readonly DEFAULT_WEIGHTS: ScoringWeights = {
        frequency: 0.25,
        impact: 0.25,
        risk: 0.20,
        complexity: 0.10,
        testability: 0.10,
        reusability: 0.10
    };

    /**
     * Score a feature using weighted rubric
     */
    static scoreFeature(
        featureId: string,
        featureName: string,
        factors: {
            frequency: number; // 0-10, how often task occurs
            impact: number; // 0-10, time saved per occurrence
            risk: number; // 0-10, higher = more risky (will be inverted)
            complexity: number; // 0-10, higher = more complex (will be inverted)
            testability: number; // 0-10, ease of auto-verification
            reusability: number; // 0-10, how many repos benefit
        },
        weights: ScoringWeights = this.DEFAULT_WEIGHTS
    ): FeatureScore {
        // Invert risk and complexity (lower is better, so invert for scoring)
        const invertedRisk = 10 - factors.risk;
        const invertedComplexity = 10 - factors.complexity;

        // Calculate weighted score
        const score =
            (factors.frequency * weights.frequency) +
            (factors.impact * weights.impact) +
            (invertedRisk * weights.risk) +
            (invertedComplexity * weights.complexity) +
            (factors.testability * weights.testability) +
            (factors.reusability * weights.reusability);

        return {
            featureId,
            featureName,
            score,
            factors: {
                ...factors,
                risk: invertedRisk, // Store inverted for display
                complexity: invertedComplexity
            }
        };
    }

    /**
     * Score multiple features and sort by priority
     */
    static scoreAndSortFeatures(
        features: Array<{
            id: string;
            name: string;
            factors: FeatureScore['factors'];
        }>,
        weights: ScoringWeights = this.DEFAULT_WEIGHTS
    ): FeatureScore[] {
        const scored = features.map(feature =>
            this.scoreFeature(feature.id, feature.name, feature.factors, weights)
        );

        // Sort by score (descending)
        scored.sort((a, b) => b.score - a.score);

        loggingService.info('Features scored and sorted', {
            component: 'FeatureScoringService',
            featuresCount: scored.length,
            topScore: scored[0]?.score,
            topFeature: scored[0]?.featureName
        });

        return scored;
    }

    /**
     * Get recommended features (top N by score)
     */
    static getRecommendedFeatures(
        features: FeatureScore[],
        limit: number = 5
    ): FeatureScore[] {
        return features.slice(0, limit);
    }
}

