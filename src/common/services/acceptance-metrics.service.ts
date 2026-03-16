/**
 * Acceptance Metrics Service for NestJS
 * Tracks and calculates acceptance rates for AI-generated code and suggestions
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AcceptanceEvent as SchemaAcceptanceEvent,
  AcceptanceEventDocument,
} from '../../schemas/common/acceptance-metrics.schema';

/** In-memory shape with timestamp for trend calculation (schema uses createdAt) */
export interface AcceptanceEventWithDate {
  suggestionId: string;
  userId: string;
  type:
    | 'code_completion'
    | 'refactor'
    | 'optimization'
    | 'documentation'
    | 'test_generation';
  language: string;
  accepted: boolean;
  timestamp: Date;
  acceptanceTime?: number;
  context?: { filePath?: string; lineNumber?: number; sessionId?: string };
}

export interface AcceptanceMetrics {
  totalSuggestions: number;
  acceptedSuggestions: number;
  acceptanceRate: number;
  averageAcceptanceTime: number; // minutes
  acceptanceByType: Record<
    string,
    { total: number; accepted: number; rate: number }
  >;
  acceptanceByLanguage: Record<
    string,
    { total: number; accepted: number; rate: number }
  >;
  acceptanceTrends: Array<{ date: string; rate: number; count: number }>;
  userEngagementScore: number; // 0-100
}

@Injectable()
export class AcceptanceMetricsService {
  private readonly logger = new Logger(AcceptanceMetricsService.name);
  private readonly MAX_EVENTS = 50000;

  constructor(
    @InjectModel(SchemaAcceptanceEvent.name)
    private acceptanceEventModel: Model<AcceptanceEventDocument>,
  ) {}

  /**
   * Record an acceptance event
   */
  async recordAcceptance(
    suggestionId: string,
    userId: string,
    type: AcceptanceEventWithDate['type'],
    accepted: boolean,
    context?: AcceptanceEventWithDate['context'],
    acceptanceTime?: number,
  ): Promise<void> {
    try {
      await this.acceptanceEventModel.create({
        suggestionId,
        userId,
        type,
        language: this.detectLanguage(context?.filePath || ''),
        accepted,
        acceptanceTime,
        context,
      });

      // Clean up old events to maintain limit
      await this.cleanupOldEvents();

      this.logger.debug('Acceptance event recorded', {
        suggestionId,
        userId,
        type,
        accepted,
        acceptanceTime,
      });
    } catch (error) {
      this.logger.error('Failed to record acceptance event', {
        suggestionId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get acceptance metrics
   */
  async getMetrics(
    userId?: string,
    timeRange?: { start: Date; end: Date },
  ): Promise<AcceptanceMetrics> {
    try {
      // Build query
      const query: any = {};
      if (userId) query.userId = userId;
      if (timeRange) {
        query.createdAt = {
          $gte: timeRange.start,
          $lte: timeRange.end,
        };
      }

      // Get events from database
      const events = await this.acceptanceEventModel
        .find(query)
        .sort({ createdAt: -1 })
        .limit(10000) // Limit for performance
        .exec();

      if (events.length === 0) {
        return this.getEmptyMetrics();
      }

      // Convert documents to interface format
      const acceptanceEvents = events.map(this.convertDocumentToInterface);

      // Calculate metrics
      const totalSuggestions = acceptanceEvents.length;
      const acceptedSuggestions = acceptanceEvents.filter(
        (e) => e.accepted,
      ).length;
      const acceptanceRate =
        totalSuggestions > 0
          ? (acceptedSuggestions / totalSuggestions) * 100
          : 0;

      const acceptedEvents = acceptanceEvents.filter(
        (e) => e.accepted && e.acceptanceTime,
      );
      const averageAcceptanceTime =
        acceptedEvents.length > 0
          ? acceptedEvents.reduce(
              (sum, e) => sum + (e.acceptanceTime || 0),
              0,
            ) /
            acceptedEvents.length /
            60 // Convert to minutes
          : 0;

      const acceptanceByType = this.calculateAcceptanceByType(acceptanceEvents);
      const acceptanceByLanguage =
        this.calculateAcceptanceByLanguage(acceptanceEvents);
      const acceptanceTrends = this.calculateAcceptanceTrends(acceptanceEvents);
      const userEngagementScore =
        this.calculateUserEngagementScore(acceptanceEvents);

      return {
        totalSuggestions,
        acceptedSuggestions,
        acceptanceRate,
        averageAcceptanceTime,
        acceptanceByType,
        acceptanceByLanguage,
        acceptanceTrends,
        userEngagementScore,
      };
    } catch (error) {
      this.logger.error('Failed to get acceptance metrics', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      return this.getEmptyMetrics();
    }
  }

  /**
   * Get real-time acceptance rate
   */
  async getRealTimeAcceptanceRate(
    userId?: string,
    windowMinutes: number = 60,
  ): Promise<number> {
    try {
      const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000);

      const query: any = { createdAt: { $gte: cutoff } };
      if (userId) query.userId = userId;

      const [stats] = await this.acceptanceEventModel.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            accepted: { $sum: { $cond: ['$accepted', 1, 0] } },
          },
        },
      ]);

      if (!stats || stats.total === 0) return 0;
      return (stats.accepted / stats.total) * 100;
    } catch (error) {
      this.logger.error('Failed to get real-time acceptance rate', {
        userId,
        windowMinutes,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Get acceptance insights
   */
  async getInsights(userId?: string): Promise<{
    topPerformingTypes: Array<{ type: string; rate: number; count: number }>;
    improvementAreas: Array<{ type: string; rate: number; suggestion: string }>;
    trends: 'improving' | 'stable' | 'declining';
    recommendations: string[];
  }> {
    const metrics = await this.getMetrics(userId);

    const topPerformingTypes = Object.entries(metrics.acceptanceByType)
      .sort(([, a], [, b]) => b.rate - a.rate)
      .slice(0, 3)
      .map(([type, data]) => ({
        type,
        rate: data.rate,
        count: data.total,
      }));

    const improvementAreas = Object.entries(metrics.acceptanceByType)
      .filter(([, data]) => data.rate < 50)
      .map(([type, data]) => ({
        type,
        rate: data.rate,
        suggestion: `Consider improving ${type} suggestions quality`,
      }));

    const trends = this.analyzeTrends(metrics.acceptanceTrends);

    const recommendations = this.generateRecommendations(metrics, trends);

    return {
      topPerformingTypes,
      improvementAreas,
      trends,
      recommendations,
    };
  }

  /**
   * Detect language from file path
   */
  private detectLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      cs: 'csharp',
      php: 'php',
      rb: 'ruby',
      go: 'go',
      rs: 'rust',
      swift: 'swift',
      kt: 'kotlin',
      scala: 'scala',
    };

    return languageMap[ext || ''] || 'unknown';
  }

  /**
   * Get empty metrics structure
   */
  private getEmptyMetrics(): AcceptanceMetrics {
    return {
      totalSuggestions: 0,
      acceptedSuggestions: 0,
      acceptanceRate: 0,
      averageAcceptanceTime: 0,
      acceptanceByType: {},
      acceptanceByLanguage: {},
      acceptanceTrends: [],
      userEngagementScore: 0,
    };
  }

  /**
   * Calculate acceptance by type
   */
  private calculateAcceptanceByType(
    events: AcceptanceEventWithDate[],
  ): Record<string, { total: number; accepted: number; rate: number }> {
    const byType: Record<string, { total: number; accepted: number }> = {};

    for (const event of events) {
      if (!byType[event.type]) {
        byType[event.type] = { total: 0, accepted: 0 };
      }
      byType[event.type].total++;
      if (event.accepted) {
        byType[event.type].accepted++;
      }
    }

    const result: Record<
      string,
      { total: number; accepted: number; rate: number }
    > = {};
    for (const [type, data] of Object.entries(byType)) {
      result[type] = {
        total: data.total,
        accepted: data.accepted,
        rate: data.total > 0 ? (data.accepted / data.total) * 100 : 0,
      };
    }

    return result;
  }

  /**
   * Calculate acceptance by language
   */
  private calculateAcceptanceByLanguage(
    events: AcceptanceEventWithDate[],
  ): Record<string, { total: number; accepted: number; rate: number }> {
    const byLanguage: Record<string, { total: number; accepted: number }> = {};

    for (const event of events) {
      if (!byLanguage[event.language]) {
        byLanguage[event.language] = { total: 0, accepted: 0 };
      }
      byLanguage[event.language].total++;
      if (event.accepted) {
        byLanguage[event.language].accepted++;
      }
    }

    const result: Record<
      string,
      { total: number; accepted: number; rate: number }
    > = {};
    for (const [language, data] of Object.entries(byLanguage)) {
      result[language] = {
        total: data.total,
        accepted: data.accepted,
        rate: data.total > 0 ? (data.accepted / data.total) * 100 : 0,
      };
    }

    return result;
  }

  /**
   * Calculate acceptance trends over time
   */
  private calculateAcceptanceTrends(
    events: AcceptanceEventWithDate[],
  ): Array<{ date: string; rate: number; count: number }> {
    const dailyStats = new Map<string, { total: number; accepted: number }>();

    for (const event of events) {
      const date = event.timestamp.toISOString().split('T')[0];
      const existing = dailyStats.get(date) || { total: 0, accepted: 0 };

      existing.total++;
      if (event.accepted) {
        existing.accepted++;
      }

      dailyStats.set(date, existing);
    }

    return Array.from(dailyStats.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, stats]) => ({
        date,
        rate: stats.total > 0 ? (stats.accepted / stats.total) * 100 : 0,
        count: stats.total,
      }));
  }

  /**
   * Calculate user engagement score
   */
  private calculateUserEngagementScore(
    events: AcceptanceEventWithDate[],
  ): number {
    if (events.length === 0) return 0;

    const acceptanceRate =
      events.filter((e) => e.accepted).length / events.length;
    const activityScore = Math.min(events.length / 100, 1); // Normalize activity
    const consistencyScore = this.calculateConsistencyScore(events);

    return Math.round(
      (acceptanceRate * 0.5 + activityScore * 0.3 + consistencyScore * 0.2) *
        100,
    );
  }

  /**
   * Calculate consistency score based on acceptance rate stability
   */
  private calculateConsistencyScore(events: AcceptanceEventWithDate[]): number {
    if (events.length < 10) return 0.5; // Neutral score for small datasets

    const recentEvents = events.slice(-50); // Last 50 events
    const rates: number[] = [];

    // Calculate rates in sliding windows
    for (let i = 0; i < recentEvents.length - 9; i++) {
      const window = recentEvents.slice(i, i + 10);
      const rate = window.filter((e) => e.accepted).length / window.length;
      rates.push(rate);
    }

    if (rates.length < 2) return 0.5;

    // Calculate variance (lower variance = higher consistency)
    const mean = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
    const variance =
      rates.reduce((sum, rate) => sum + Math.pow(rate - mean, 2), 0) /
      rates.length;
    const stdDev = Math.sqrt(variance);

    // Convert to consistency score (lower std dev = higher consistency)
    return Math.max(0, 1 - stdDev);
  }

  /**
   * Analyze trends in acceptance rates
   */
  private analyzeTrends(
    trends: Array<{ date: string; rate: number; count: number }>,
  ): 'improving' | 'stable' | 'declining' {
    if (trends.length < 7) return 'stable';

    const recent = trends.slice(-7);
    const earlier = trends.slice(-14, -7);

    if (earlier.length === 0) return 'stable';

    const recentAvg =
      recent.reduce((sum, t) => sum + t.rate, 0) / recent.length;
    const earlierAvg =
      earlier.reduce((sum, t) => sum + t.rate, 0) / earlier.length;

    const change = recentAvg - earlierAvg;

    if (change > 5) return 'improving';
    if (change < -5) return 'declining';
    return 'stable';
  }

  /**
   * Generate recommendations based on metrics and trends
   */
  private generateRecommendations(
    metrics: AcceptanceMetrics,
    trends: string,
  ): string[] {
    const recommendations: string[] = [];

    if (metrics.acceptanceRate < 50) {
      recommendations.push(
        'Consider improving suggestion quality to increase acceptance rates',
      );
    }

    if (trends === 'declining') {
      recommendations.push(
        'Acceptance rates are declining - review recent changes to suggestions',
      );
    }

    if (metrics.averageAcceptanceTime > 10) {
      recommendations.push(
        'Users are taking longer to accept suggestions - consider making suggestions more obvious',
      );
    }

    const lowPerformingTypes = Object.entries(metrics.acceptanceByType)
      .filter(([, data]) => data.rate < 40)
      .map(([type]) => type);

    if (lowPerformingTypes.length > 0) {
      recommendations.push(
        `Focus on improving ${lowPerformingTypes.join(', ')} suggestions`,
      );
    }

    return recommendations;
  }

  /**
   * Get service statistics
   */
  async getStatistics(): Promise<{
    totalEvents: number;
    averageAcceptanceRate: number;
    mostActiveUsers: Array<{ userId: string; eventCount: number }>;
    mostAcceptedTypes: Array<{ type: string; count: number }>;
  }> {
    try {
      // Get overall stats
      const [stats] = await this.acceptanceEventModel.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            accepted: { $sum: { $cond: ['$accepted', 1, 0] } },
          },
        },
      ]);

      const totalEvents = stats?.total || 0;
      const acceptedEvents = stats?.accepted || 0;
      const averageAcceptanceRate =
        totalEvents > 0 ? (acceptedEvents / totalEvents) * 100 : 0;

      // Most active users
      const userStats = await this.acceptanceEventModel.aggregate([
        {
          $group: {
            _id: '$userId',
            eventCount: { $sum: 1 },
          },
        },
        { $sort: { eventCount: -1 } },
        { $limit: 5 },
      ]);

      const mostActiveUsers = userStats.map((stat) => ({
        userId: stat._id,
        eventCount: stat.eventCount,
      }));

      // Most accepted types
      const typeStats = await this.acceptanceEventModel.aggregate([
        { $match: { accepted: true } },
        {
          $group: {
            _id: '$type',
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]);

      const mostAcceptedTypes = typeStats.map((stat) => ({
        type: stat._id,
        count: stat.count,
      }));

      return {
        totalEvents,
        averageAcceptanceRate,
        mostActiveUsers,
        mostAcceptedTypes,
      };
    } catch (error) {
      this.logger.error('Failed to get service statistics', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        totalEvents: 0,
        averageAcceptanceRate: 0,
        mostActiveUsers: [],
        mostAcceptedTypes: [],
      };
    }
  }

  private async cleanupOldEvents(): Promise<void> {
    try {
      const count = await this.acceptanceEventModel.countDocuments();
      if (count > this.MAX_EVENTS) {
        const toDelete = count - this.MAX_EVENTS;
        await this.acceptanceEventModel
          .find()
          .sort({ createdAt: 1 })
          .limit(toDelete)
          .deleteMany();
      }
    } catch (error) {
      this.logger.warn('Failed to cleanup old acceptance events', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private convertDocumentToInterface(
    doc: AcceptanceEventDocument,
  ): AcceptanceEventWithDate {
    const docWithTimestamps = doc as AcceptanceEventDocument & {
      createdAt?: Date;
    };
    return {
      suggestionId: doc.suggestionId,
      userId: doc.userId,
      type: doc.type,
      language: doc.language,
      accepted: doc.accepted,
      timestamp: docWithTimestamps.createdAt ?? new Date(),
      acceptanceTime: doc.acceptanceTime,
      context: doc.context,
    };
  }
}
