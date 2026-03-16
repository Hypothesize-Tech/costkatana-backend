/**
 * Feature Scoring Service for NestJS
 * Scores and ranks AI features based on usage patterns, user feedback, and performance metrics
 */

import { Injectable, Logger } from '@nestjs/common';

export interface FeatureScore {
  featureId: string;
  name: string;
  category:
    | 'code_generation'
    | 'code_analysis'
    | 'optimization'
    | 'testing'
    | 'documentation'
    | 'deployment';
  overallScore: number; // 0-100
  scores: {
    usage: number; // Based on adoption and frequency
    performance: number; // Based on success rates and latency
    userSatisfaction: number; // Based on acceptance rates and feedback
    reliability: number; // Based on error rates and uptime
    innovation: number; // Based on uniqueness and advanced capabilities
  };
  metrics: {
    totalUsage: number;
    successRate: number;
    averageLatency: number;
    userRating: number;
    errorRate: number;
  };
  trends: {
    scoreChange: number; // Change from last period
    usageGrowth: number;
    performanceTrend: 'improving' | 'stable' | 'declining';
  };
  recommendations: string[];
}

@Injectable()
export class FeatureScoringService {
  private readonly logger = new Logger(FeatureScoringService.name);

  // Feature data should be loaded from database or configuration
  // This service requires proper feature metrics collection infrastructure
  private features: Array<{
    id: string;
    name: string;
    category: FeatureScore['category'];
    metrics: FeatureScore['metrics'];
  }> = [];

  /**
   * Get scores for all features
   */
  async getAllFeatureScores(): Promise<FeatureScore[]> {
    return this.features.map((feature) => this.calculateFeatureScore(feature));
  }

  /**
   * Get score for a specific feature
   */
  async getFeatureScore(featureId: string): Promise<FeatureScore | null> {
    const feature = this.features.find((f) => f.id === featureId);
    if (!feature) return null;

    return this.calculateFeatureScore(feature);
  }

  /**
   * Get top performing features
   */
  async getTopFeatures(limit: number = 10): Promise<FeatureScore[]> {
    const scores = await this.getAllFeatureScores();
    return scores
      .sort((a, b) => b.overallScore - a.overallScore)
      .slice(0, limit);
  }

  /**
   * Get features by category
   */
  async getFeaturesByCategory(
    category: FeatureScore['category'],
  ): Promise<FeatureScore[]> {
    const categoryFeatures = this.features.filter(
      (f) => f.category === category,
    );
    return categoryFeatures.map((feature) =>
      this.calculateFeatureScore(feature),
    );
  }

  /**
   * Update feature metrics
   */
  async updateFeatureMetrics(
    featureId: string,
    metrics: Partial<FeatureScore['metrics']>,
  ): Promise<void> {
    const feature = this.features.find((f) => f.id === featureId);
    if (feature) {
      feature.metrics = { ...feature.metrics, ...metrics };
      this.logger.log('Feature metrics updated', { featureId, metrics });
    }
  }

  /**
   * Calculate comprehensive score for a feature
   */
  private calculateFeatureScore(feature: any): FeatureScore {
    const scores = {
      usage: this.calculateUsageScore(feature.metrics),
      performance: this.calculatePerformanceScore(feature.metrics),
      userSatisfaction: this.calculateUserSatisfactionScore(feature.metrics),
      reliability: this.calculateReliabilityScore(feature.metrics),
      innovation: this.calculateInnovationScore(feature),
    };

    const overallScore =
      scores.usage * 0.25 +
      scores.performance * 0.25 +
      scores.userSatisfaction * 0.25 +
      scores.reliability * 0.15 +
      scores.innovation * 0.1;

    const trends = this.calculateTrends(feature);

    return {
      featureId: feature.id,
      name: feature.name,
      category: feature.category,
      overallScore: Math.round(overallScore),
      scores,
      metrics: feature.metrics,
      trends,
      recommendations: this.generateRecommendations(scores, trends),
    };
  }

  /**
   * Calculate usage score (0-100)
   */
  private calculateUsageScore(metrics: FeatureScore['metrics']): number {
    // Normalize usage count to a score
    const usageScore = Math.min(metrics.totalUsage / 1000, 1) * 100;
    return Math.round(usageScore);
  }

  /**
   * Calculate performance score (0-100)
   */
  private calculatePerformanceScore(metrics: FeatureScore['metrics']): number {
    const latencyScore = Math.max(0, 100 - metrics.averageLatency / 50); // Penalize latency > 50ms
    const successScore = metrics.successRate * 100;
    return Math.round((latencyScore + successScore) / 2);
  }

  /**
   * Calculate user satisfaction score (0-100)
   */
  private calculateUserSatisfactionScore(
    metrics: FeatureScore['metrics'],
  ): number {
    return Math.round((metrics.userRating / 5) * 100);
  }

  /**
   * Calculate reliability score (0-100)
   */
  private calculateReliabilityScore(metrics: FeatureScore['metrics']): number {
    const errorScore = (1 - metrics.errorRate) * 100;
    return Math.round(errorScore);
  }

  /**
   * Calculate innovation score (0-100)
   */
  private calculateInnovationScore(feature: any): number {
    // This would be based on feature uniqueness, advanced capabilities, etc.
    const innovationScores: Record<string, number> = {
      code_completion: 70,
      code_review: 85,
      performance_optimization: 95,
    };
    return innovationScores[feature.id] || 50;
  }

  /**
   * Calculate trends from available metrics (no historical pipeline = stable defaults)
   */
  private calculateTrends(feature: any): FeatureScore['trends'] {
    return {
      scoreChange: 0,
      usageGrowth: 0,
      performanceTrend: 'stable',
    };
  }

  /**
   * Generate recommendations based on scores and trends
   */
  private generateRecommendations(
    scores: FeatureScore['scores'],
    trends: FeatureScore['trends'],
  ): string[] {
    const recommendations: string[] = [];

    if (scores.performance < 60) {
      recommendations.push(
        'Consider optimizing performance - high latency or low success rate',
      );
    }

    if (scores.userSatisfaction < 70) {
      recommendations.push(
        'User satisfaction is low - gather feedback and improve user experience',
      );
    }

    if (scores.reliability < 80) {
      recommendations.push(
        'Reliability issues detected - investigate and fix error rates',
      );
    }

    if (trends.usageGrowth < 0) {
      recommendations.push(
        'Usage is declining - consider marketing or feature improvements',
      );
    }

    if (trends.performanceTrend === 'declining') {
      recommendations.push('Performance is declining - monitor and optimize');
    }

    return recommendations;
  }

  /**
   * Get feature scoring statistics
   */
  getStatistics(): {
    totalFeatures: number;
    averageScore: number;
    topCategory: string;
    scoreDistribution: {
      excellent: number;
      good: number;
      average: number;
      poor: number;
    };
  } {
    const scores = this.features.map((f) => this.calculateFeatureScore(f));
    const totalFeatures = scores.length;
    const averageScore =
      totalFeatures > 0
        ? scores.reduce((sum, s) => sum + s.overallScore, 0) / totalFeatures
        : 0;

    const categories = scores.reduce(
      (acc, score) => {
        acc[score.category] = (acc[score.category] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const topCategory =
      Object.entries(categories).sort(([, a], [, b]) => b - a)[0]?.[0] ||
      'unknown';

    const distribution = {
      excellent: scores.filter((s) => s.overallScore >= 90).length,
      good: scores.filter((s) => s.overallScore >= 75 && s.overallScore < 90)
        .length,
      average: scores.filter((s) => s.overallScore >= 50 && s.overallScore < 75)
        .length,
      poor: scores.filter((s) => s.overallScore < 50).length,
    };

    return {
      totalFeatures,
      averageScore: Math.round(averageScore),
      topCategory,
      scoreDistribution: distribution,
    };
  }
}
