import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  HttpStatus,
  HttpException,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import {
  PerformanceCostAnalysisService,
  CostPerformanceCorrelation,
  OptimizationOpportunity,
} from '@/modules/predictive-intelligence/services/performance-cost-analysis.service';
import { AnalyzeCostPerformanceBodyDto } from './dto/analyze.dto';
import { CompareServicesBodyDto } from './dto/compare.dto';
import { PerformanceTrendsQueryDto } from './dto/trends-query.dto';
import { DetailedMetricsQueryDto } from './dto/detailed-metrics-query.dto';
import { EfficiencyScoreQueryDto } from './dto/efficiency-score-query.dto';
import { OptimizationOpportunitiesBodyDto } from './dto/optimization-opportunities.dto';
import { HeatmapQueryDto } from './dto/heatmap-query.dto';
import {
  TradeoffAnalysisBodyDto,
  PriorityWeightsDto,
} from './dto/tradeoff-analysis.dto';

const ANALYZE_TIMEOUT_MS = 15000;
const COMPARE_TIMEOUT_MS = 15000;
const TRENDS_TIMEOUT_MS = 20000;

@Controller('api/performance-cost')
@UseGuards(JwtAuthGuard)
export class PerformanceCostAnalysisController {
  private readonly logger = new Logger(PerformanceCostAnalysisController.name);

  constructor(
    private readonly performanceCostService: PerformanceCostAnalysisService,
  ) {}

  @Post('analyze')
  async analyzeCostPerformanceCorrelation(
    @CurrentUser('id') userId: string,
    @Body() body: AnalyzeCostPerformanceBodyDto,
  ) {
    const options = {
      startDate: body.startDate ? new Date(body.startDate) : undefined,
      endDate: body.endDate ? new Date(body.endDate) : undefined,
      services: body.services,
      models: body.models,
      tags: body.tags,
    };
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Request timeout')),
        ANALYZE_TIMEOUT_MS,
      ),
    );
    try {
      const correlations = await Promise.race([
        this.performanceCostService.analyzeCostPerformanceCorrelation(
          userId,
          options,
        ),
        timeout,
      ]);
      const len = correlations.length;
      const summary = {
        totalServices: len,
        averageEfficiencyScore:
          len > 0
            ? correlations.reduce(
                (s, c) => s + c.efficiency.costEfficiencyScore,
                0,
              ) / len
            : 0,
        bestPerforming:
          len > 0
            ? correlations.reduce((a, b) =>
                a.efficiency.costEfficiencyScore >
                b.efficiency.costEfficiencyScore
                  ? a
                  : b,
              )
            : null,
        worstPerforming:
          len > 0
            ? correlations.reduce((a, b) =>
                a.efficiency.costEfficiencyScore <
                b.efficiency.costEfficiencyScore
                  ? a
                  : b,
              )
            : null,
        averageCostPerRequest:
          len > 0
            ? correlations.reduce((s, c) => s + c.costPerRequest, 0) / len
            : 0,
        averageLatency:
          len > 0
            ? correlations.reduce((s, c) => s + c.performance.latency, 0) / len
            : 0,
        averageQualityScore:
          len > 0
            ? correlations.reduce((s, c) => s + c.performance.qualityScore, 0) /
              len
            : 0,
      };
      return {
        success: true,
        data: { correlations, summary },
        metadata: {
          analysisType: 'cost_performance_correlation',
          generatedAt: new Date().toISOString(),
        },
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'Request timeout') {
        throw new HttpException(
          'Request timeout - analysis took too long. Please try again with a smaller date range.',
          HttpStatus.REQUEST_TIMEOUT,
        );
      }
      if (
        err instanceof Error &&
        err.message?.includes('Database circuit breaker')
      ) {
        throw new HttpException(
          'Service temporarily unavailable. Please try again later.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      this.logger.error('analyzeCostPerformanceCorrelation failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new HttpException(
        'Cost-performance correlation analysis failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('compare')
  async compareServices(
    @CurrentUser('id') userId: string,
    @Body() body: CompareServicesBodyDto,
  ) {
    const options = {
      startDate: body.startDate ? new Date(body.startDate) : undefined,
      endDate: body.endDate ? new Date(body.endDate) : undefined,
      useCase: body.useCase,
      tags: body.tags,
    };
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Request timeout')),
        COMPARE_TIMEOUT_MS,
      ),
    );
    try {
      const comparison = await Promise.race([
        this.performanceCostService.compareServices(userId, options),
        timeout,
      ]);
      return {
        success: true,
        data: comparison,
        metadata: {
          analysisType: 'service_comparison',
          totalServices: comparison.services.length,
          bestValue: comparison.bestValue,
          totalRecommendations: comparison.recommendations.length,
          generatedAt: new Date().toISOString(),
        },
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'Request timeout') {
        throw new HttpException(
          'Request timeout - comparison took too long.',
          HttpStatus.REQUEST_TIMEOUT,
        );
      }
      this.logger.error('compareServices failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new HttpException(
        'Service comparison failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('trends')
  async getPerformanceTrends(
    @CurrentUser('id') userId: string,
    @Query() query: PerformanceTrendsQueryDto,
  ) {
    const options = {
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      service: query.service,
      model: query.model,
      granularity: query.granularity ?? 'day',
    };
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout')), TRENDS_TIMEOUT_MS),
    );
    try {
      const trends = await Promise.race([
        this.performanceCostService.getPerformanceTrends(userId, options),
        timeout,
      ]);
      const trendSummary = {
        totalPeriods: trends.length,
        improvingPeriods: trends.filter((t) => t.trend === 'improving').length,
        degradingPeriods: trends.filter((t) => t.trend === 'degrading').length,
        stablePeriods: trends.filter((t) => t.trend === 'stable').length,
        totalAlerts: trends.reduce((s, t) => s + t.alerts.length, 0),
        highSeverityAlerts: trends.reduce(
          (s, t) => s + t.alerts.filter((a) => a.severity === 'high').length,
          0,
        ),
        averageCost:
          trends.length > 0
            ? trends.reduce((s, t) => s + t.metrics.cost, 0) / trends.length
            : 0,
        averageLatency:
          trends.length > 0
            ? trends.reduce((s, t) => s + t.metrics.latency, 0) / trends.length
            : 0,
        averageQualityScore:
          trends.length > 0
            ? trends.reduce((s, t) => s + t.metrics.qualityScore, 0) /
              trends.length
            : 0,
      };
      return {
        success: true,
        data: { trends, summary: trendSummary },
        metadata: {
          analysisType: 'performance_trends',
          granularity: options.granularity,
          generatedAt: new Date().toISOString(),
        },
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'Request timeout') {
        throw new HttpException(
          'Request timeout - trends analysis took too long.',
          HttpStatus.REQUEST_TIMEOUT,
        );
      }
      this.logger.error('getPerformanceTrends failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new HttpException(
        'Performance trends retrieval failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('detailed-metrics')
  async getDetailedMetrics(
    @CurrentUser('id') userId: string,
    @Query() query: DetailedMetricsQueryDto,
  ) {
    if (!query.service || !query.model) {
      throw new HttpException(
        'Service and model parameters are required',
        HttpStatus.BAD_REQUEST,
      );
    }
    const options = {
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      tags: query.tags ? query.tags.split(',').map((s) => s.trim()) : undefined,
    };
    const metrics = await this.performanceCostService.getDetailedMetrics(
      userId,
      query.service,
      query.model,
      options,
    );
    return {
      success: true,
      data: metrics,
      metadata: {
        service: query.service,
        model: query.model,
        analysisType: 'detailed_metrics',
        generatedAt: new Date().toISOString(),
      },
    };
  }

  @Get('efficiency-score')
  async getEfficiencyScore(
    @CurrentUser('id') userId: string,
    @Query() query: EfficiencyScoreQueryDto,
  ) {
    const options = {
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      services: query.service ? [query.service] : undefined,
      models: query.model ? [query.model] : undefined,
    };
    const correlations =
      await this.performanceCostService.analyzeCostPerformanceCorrelation(
        userId,
        options,
      );
    if (correlations.length === 0) {
      throw new HttpException(
        'No data found for the specified criteria',
        HttpStatus.NOT_FOUND,
      );
    }
    const target = correlations[0];
    const allCorrelations =
      await this.performanceCostService.analyzeCostPerformanceCorrelation(
        userId,
        { startDate: options.startDate, endDate: options.endDate },
      );
    const efficiencyScores = allCorrelations
      .map((c) => c.efficiency.costEfficiencyScore)
      .sort((a, b) => b - a);
    const percentileRank =
      (efficiencyScores.indexOf(target.efficiency.costEfficiencyScore) /
        efficiencyScores.length) *
      100;
    const efficiencyAnalysis = {
      service: target.service,
      model: target.model,
      efficiencyScore: target.efficiency.costEfficiencyScore,
      percentileRank: Math.round(percentileRank),
      performanceRating: target.efficiency.performanceRating,
      recommendation: target.efficiency.recommendation,
      optimizationPotential: target.efficiency.optimizationPotential,
      benchmarks: {
        industry: {
          averageEfficiency:
            efficiencyScores.reduce((s, x) => s + x, 0) /
            efficiencyScores.length,
          topPercentileThreshold:
            efficiencyScores[Math.floor(efficiencyScores.length * 0.1)],
          bottomPercentileThreshold:
            efficiencyScores[Math.floor(efficiencyScores.length * 0.9)],
        },
        yourAccount: {
          bestService: allCorrelations.reduce((a, b) =>
            b.efficiency.costEfficiencyScore > a.efficiency.costEfficiencyScore
              ? b
              : a,
          ),
          worstService: allCorrelations.reduce((a, b) =>
            b.efficiency.costEfficiencyScore < a.efficiency.costEfficiencyScore
              ? b
              : a,
          ),
        },
      },
      improvementActions: [
        ...(target.performance.latency > 5000
          ? [
              {
                action: 'Optimize request latency',
                impact: 'High',
                effort: 'Medium',
                expectedImprovement: '15-25%',
              },
            ]
          : []),
        ...(target.performance.errorRate > 5
          ? [
              {
                action: 'Improve error handling',
                impact: 'Medium',
                effort: 'Low',
                expectedImprovement: '10-20%',
              },
            ]
          : []),
        ...(target.efficiency.costEfficiencyScore < 0.6
          ? [
              {
                action: 'Consider alternative service/model',
                impact: 'High',
                effort: 'High',
                expectedImprovement: '20-40%',
              },
            ]
          : []),
      ],
    };
    return {
      success: true,
      data: efficiencyAnalysis,
      metadata: {
        analysisType: 'efficiency_score',
        generatedAt: new Date().toISOString(),
      },
    };
  }

  @Post('optimization-opportunities')
  async identifyOptimizationOpportunities(
    @CurrentUser('id') userId: string,
    @Body() body: OptimizationOpportunitiesBodyDto,
  ) {
    const options = {
      startDate: body.startDate ? new Date(body.startDate) : undefined,
      endDate: body.endDate ? new Date(body.endDate) : undefined,
      minSavings: body.minSavings ?? 50,
      tags: body.tags,
    };
    const opportunities =
      await this.performanceCostService.identifyOptimizationOpportunities(
        userId,
        options,
      );
    const summary = {
      totalOpportunities: opportunities.length,
      totalPotentialSavings: opportunities.reduce((s, o) => s + o.savings, 0),
      averageSavingsPerOpportunity:
        opportunities.length > 0
          ? opportunities.reduce((s, o) => s + o.savings, 0) /
            opportunities.length
          : 0,
      highPriorityOpportunities: opportunities.filter((o) => o.priority > 0.8)
        .length,
      lowRiskOpportunities: opportunities.filter(
        (o) => o.riskAssessment.level === 'low',
      ).length,
      quickWins: opportunities.filter(
        (o) => o.implementationComplexity === 'low' && o.savings > 100,
      ).length,
      opportunityTypes: [...new Set(opportunities.map((o) => o.type))],
      averageImplementationComplexity:
        this.calculateAverageComplexity(opportunities),
    };
    return {
      success: true,
      data: { opportunities, summary },
      metadata: {
        analysisType: 'optimization_opportunities',
        minSavingsThreshold: options.minSavings,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  @Get('heatmap')
  async getPerformanceHeatmap(
    @CurrentUser('id') userId: string,
    @Query() query: HeatmapQueryDto,
  ) {
    const options = {
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      granularity: query.granularity ?? 'day',
    };
    const trends = await this.performanceCostService.getPerformanceTrends(
      userId,
      options,
    );
    const metric = query.metric ?? 'cost';
    const heatmapData = trends.map((t) => ({
      period: t.period,
      cost: t.metrics.cost,
      latency: t.metrics.latency,
      qualityScore: t.metrics.qualityScore,
      errorRate: t.metrics.errorRate,
      volume: t.metrics.volume,
      efficiency: this.calculateEfficiency(t.metrics),
      alerts: t.alerts.length,
      trend: t.trend,
    }));
    const metricValues = heatmapData.map((d) => {
      const v = (d as Record<string, unknown>)[metric];
      return typeof v === 'number' ? v : 0;
    });
    const sorted = [...metricValues].sort((a, b) => a - b);
    const intensityRanges = {
      min: metricValues.length > 0 ? Math.min(...metricValues) : 0,
      max: metricValues.length > 0 ? Math.max(...metricValues) : 0,
      median: sorted[Math.floor(sorted.length / 2)] ?? 0,
      q1: sorted[Math.floor(sorted.length * 0.25)] ?? 0,
      q3: sorted[Math.floor(sorted.length * 0.75)] ?? 0,
    };
    return {
      success: true,
      data: {
        heatmapData,
        intensityRanges,
        metadata: {
          metric,
          granularity: options.granularity,
          totalPeriods: heatmapData.length,
          dateRange: {
            start: trends[0]?.period,
            end: trends[trends.length - 1]?.period,
          },
        },
      },
      metadata: {
        analysisType: 'performance_heatmap',
        generatedAt: new Date().toISOString(),
      },
    };
  }

  @Post('tradeoff-analysis')
  async getTradeoffAnalysis(
    @CurrentUser('id') userId: string,
    @Body() body: TradeoffAnalysisBodyDto,
  ) {
    const priorityWeights: Required<PriorityWeightsDto> = {
      cost: body.priorityWeights?.cost ?? 0.4,
      latency: body.priorityWeights?.latency ?? 0.3,
      quality: body.priorityWeights?.quality ?? 0.3,
    };
    const options = {
      startDate: body.startDate ? new Date(body.startDate) : undefined,
      endDate: body.endDate ? new Date(body.endDate) : undefined,
      services: body.services,
      models: body.models,
    };
    const correlations =
      await this.performanceCostService.analyzeCostPerformanceCorrelation(
        userId,
        options,
      );
    const maxCost = Math.max(
      ...correlations.map((c) => c.costPerRequest),
      0.01,
    );
    const maxLatency = Math.max(
      ...correlations.map((c) => c.performance.latency),
      1,
    );
    const tradeoffAnalysis = correlations
      .map((c) => {
        const normalizedCost = 1 - c.costPerRequest / maxCost;
        const normalizedLatency = 1 - c.performance.latency / maxLatency;
        const normalizedQuality = c.performance.qualityScore;
        const weightedScore =
          normalizedCost * priorityWeights.cost +
          normalizedLatency * priorityWeights.latency +
          normalizedQuality * priorityWeights.quality;
        return {
          service: c.service,
          model: c.model,
          weightedScore,
          normalizedMetrics: {
            cost: normalizedCost,
            latency: normalizedLatency,
            quality: normalizedQuality,
          },
          rawMetrics: {
            cost: c.costPerRequest,
            latency: c.performance.latency,
            quality: c.performance.qualityScore,
          },
          tradeoffs: c.tradeoffs,
          recommendation: this.generateTradeoffRecommendation(weightedScore, c),
        };
      })
      .sort((a, b) => b.weightedScore - a.weightedScore);
    const summary = {
      totalOptions: tradeoffAnalysis.length,
      topTier: tradeoffAnalysis.filter((t) => t.weightedScore > 0.8).length,
      averageScore:
        tradeoffAnalysis.length > 0
          ? tradeoffAnalysis.reduce((s, t) => s + t.weightedScore, 0) /
            tradeoffAnalysis.length
          : 0,
    };
    return {
      success: true,
      data: {
        tradeoffAnalysis,
        priorityWeights,
        bestOption: tradeoffAnalysis[0] ?? null,
        summary,
      },
      metadata: {
        analysisType: 'tradeoff_analysis',
        generatedAt: new Date().toISOString(),
      },
    };
  }

  private calculateAverageComplexity(
    opportunities: OptimizationOpportunity[],
  ): number {
    if (opportunities.length === 0) return 0;
    const map: Record<string, number> = { low: 1, medium: 2, high: 3 };
    const total = opportunities.reduce(
      (s, o) => s + (map[o.implementationComplexity] ?? 2),
      0,
    );
    return total / opportunities.length;
  }

  private calculateEfficiency(metrics: {
    cost: number;
    latency: number;
    qualityScore: number;
  }): number {
    const costScore = Math.max(0, 1 - metrics.cost / 100);
    const latencyScore = Math.max(0, 1 - metrics.latency / 10000);
    return (costScore + latencyScore + metrics.qualityScore) / 3;
  }

  private generateTradeoffRecommendation(
    score: number,
    correlation: CostPerformanceCorrelation,
  ): string {
    if (score > 0.8) {
      return 'Excellent balance of cost, performance, and quality. Recommended for production use.';
    }
    if (score > 0.6) {
      return 'Good option with acceptable trade-offs. Consider for most use cases.';
    }
    if (correlation.performance.latency > 5000) {
      return 'High latency may impact user experience. Consider if speed is critical.';
    }
    if (correlation.costPerRequest > 0.05) {
      return 'Higher cost option. Evaluate if the performance benefits justify the expense.';
    }
    return 'Consider optimization or alternative options for better cost-performance balance.';
  }
}
