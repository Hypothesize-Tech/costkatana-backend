import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';
import { Telemetry } from '@/schemas/core/telemetry.schema';
import { TelemetryQueryDto } from '../dto/telemetry-query.dto';
import { MetricsQueryDto } from '../dto/metrics-query.dto';
import { EnrichedSpansQueryDto } from '../dto/enriched-spans-query.dto';
import { CostStreamingService } from './cost-streaming.service';

// Export interfaces for controller usage
export interface TelemetrySpan {
  _id?: any;
  trace_id: string;
  request_id?: string;
  tenant_id?: string;
  workspace_id?: string;
  user_id?: string;
  service_name: string;
  operation_name: string;
  start_time: Date;
  end_time: Date;
  duration: number;
  status: 'success' | 'error' | 'unset';
  cost?: number;
  http_route?: string;
  http_method?: string;
  http_status_code?: number;
  gen_ai_model?: string;
  error_type?: string;
  enrichment?: {
    insights: string[];
    recommendations: string[];
    patterns: string[];
    cost_optimization_opportunities: string[];
    performance_insights: string[];
    error_analysis: string[];
  };
  created_at: Date;
}

export interface TelemetryDashboardData {
  totalSpans: number;
  totalCost: number;
  averageLatency: number;
  errorRate: number;
  topOperations: Array<{
    operation: string;
    count: number;
    avgDuration: number;
    avgCost: number;
  }>;
  recentErrors: TelemetrySpan[];
  costTrends: Array<{ timestamp: Date; cost: number; count: number }>;
  performanceTrends: Array<{
    timestamp: Date;
    avgDuration: number;
    count: number;
  }>;
}

export interface PerformanceMetrics {
  basic: {
    totalSpans: number;
    totalCost: number;
    averageLatency: number;
    errorRate: number;
    p95Latency: number;
    p99Latency: number;
  };
  percentiles: {
    p50: number;
    p95: number;
    p99: number;
    p999: number;
  };
  operations: Array<{
    operation: string;
    count: number;
    avgDuration: number;
    avgCost: number;
    errorRate: number;
  }>;
  errors: Array<{
    operation: string;
    error_type: string;
    count: number;
    avgDuration: number;
  }>;
  models: Array<{
    model: string;
    count: number;
    avgCost: number;
    avgDuration: number;
  }>;
}

export interface ServiceDependency {
  service: string;
  operation: string;
  calledBy: Array<{
    service: string;
    operation: string;
    count: number;
  }>;
}

export interface EnrichmentStats {
  totalSpans: number;
  enrichedSpans: number;
  coverage: number;
  recentEnrichments: number;
  enrichmentTypes: {
    insights: number;
    recommendations: number;
    patterns: number;
    costOptimizations: number;
    performanceInsights: number;
    errorAnalysis: number;
  };
}

export interface AIRecommendation {
  type:
    | 'cost_optimization'
    | 'performance_improvement'
    | 'error_reduction'
    | 'reliability_enhancement';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  impact: {
    costSavings?: number;
    latencyReduction?: number;
    errorReduction?: number;
  };
  actionItems: string[];
  confidence: number;
  basedOn: {
    spanCount: number;
    timeRange: string;
  };
}

/**
 * Telemetry Query Service with advanced analytics and circuit breaker
 */
@Injectable()
export class TelemetryQueryService implements OnModuleInit {
  private readonly logger = new Logger(TelemetryQueryService.name);

  // Circuit breaker state
  private dbFailureCount = 0;
  private lastDbFailureTime = 0;
  private readonly CIRCUIT_BREAKER_TIMEOUT = 30000; // 30 seconds

  // Telemetry processing counter
  private processedToday = 0;
  private lastResetDate = new Date().toDateString();
  private readonly MAX_DB_FAILURES = 5;

  // Background enrichment
  private enrichmentInterval?: NodeJS.Timeout;

  // Filter builders cache
  private filterBuilders: Map<string, any>;

  constructor(
    @InjectModel(Telemetry.name) private telemetryModel: Model<Telemetry>,
    private costStreamingService: CostStreamingService,
  ) {
    this.filterBuilders = new Map();
    this.initializeFilterBuilders();
  }

  /**
   * Initialize service with background enrichment
   */
  onModuleInit() {
    // Start background enrichment every 5 minutes
    this.enrichmentInterval = setInterval(
      () => {
        this.autoEnrichSpans().catch((error) => {
          this.logger.error('Background enrichment failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      },
      5 * 60 * 1000,
    ); // 5 minutes

    this.logger.log(
      'Telemetry Query Service initialized with background enrichment',
    );
  }

  /**
   * Query telemetry spans with circuit breaker protection
   */
  async queryTelemetry(query: TelemetryQueryDto): Promise<{
    spans: TelemetrySpan[];
    total: number;
    page: number;
    limit: number;
  }> {
    const startTime = Date.now();

    try {
      // Circuit breaker check
      if (this.isDbCircuitBreakerOpen()) {
        throw new ServiceUnavailableException(
          'Database circuit breaker is open',
        );
      }

      const filter = this.buildOptimizedFilter(query);
      const limit = Math.min(query.limit || 100, 1000); // Cap at 1000
      const page = query.page || 1;
      const skip = (page - 1) * limit;

      // Build sort
      const sort: any = {};
      if (query.sort_by) {
        sort[query.sort_by] = query.sort_order === 'desc' ? -1 : 1;
      } else {
        sort.start_time = -1; // Default: newest first
      }

      // Execute query with timeout protection
      const queryPromise = Promise.all([
        this.telemetryModel
          .find(filter)
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .exec(),
        this.telemetryModel.countDocuments(filter).exec(),
      ]);

      const [spans, total] = await Promise.race([
        queryPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Query timeout')), 15000),
        ),
      ]);

      // Reset circuit breaker on success
      this.dbFailureCount = 0;

      this.logger.log(`Query executed in ${Date.now() - startTime}ms`, {
        total,
        returned: spans.length,
        page,
        limit,
      });

      return {
        spans: spans.map((span) =>
          span.toObject ? span.toObject() : span,
        ) as unknown as TelemetrySpan[],
        total,
        page,
        limit,
      };
    } catch (error) {
      this.recordDbFailure();
      this.logger.error('Query telemetry failed', {
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Get trace details with span tree
   */
  async getTraceDetails(traceId: string): Promise<{
    trace: {
      id: string;
      spans: TelemetrySpan[];
      summary: {
        totalSpans: number;
        totalDuration: number;
        totalCost: number;
        errorCount: number;
        startTime: Date;
        endTime: Date;
      };
    };
  }> {
    const startTime = Date.now();

    try {
      if (this.isDbCircuitBreakerOpen()) {
        throw new ServiceUnavailableException(
          'Database circuit breaker is open',
        );
      }

      const spans = await this.telemetryModel
        .find({ trace_id: traceId })
        .sort({ start_time: 1 })
        .exec();

      if (spans.length === 0) {
        throw new NotFoundException(`Trace ${traceId} not found`);
      }

      // Convert to plain objects for easier manipulation
      const spanObjects = spans.map((span) =>
        span.toObject ? span.toObject() : span,
      ) as unknown as TelemetrySpan[];

      // Build span tree and calculate summary
      const summary = {
        totalSpans: spanObjects.length,
        totalDuration: spanObjects.reduce(
          (sum, span) => sum + (span.duration || 0),
          0,
        ),
        totalCost: spanObjects.reduce((sum, span) => sum + (span.cost || 0), 0),
        errorCount: spanObjects.filter((span) => span.status === 'error')
          .length,
        startTime: spanObjects[0].start_time,
        endTime: spanObjects[spanObjects.length - 1].end_time,
      };

      this.logger.log(
        `Trace details retrieved in ${Date.now() - startTime}ms`,
        {
          traceId,
          spanCount: spans.length,
        },
      );

      return {
        trace: {
          id: traceId,
          spans: spans.map((span) =>
            span.toObject ? span.toObject() : span,
          ) as unknown as TelemetrySpan[],
          summary,
        },
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.recordDbFailure();
      this.logger.error('Get trace details failed', {
        error: error instanceof Error ? error.message : String(error),
        traceId,
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Get comprehensive performance metrics
   */
  async getPerformanceMetrics(
    query: MetricsQueryDto,
  ): Promise<PerformanceMetrics> {
    const startTime = Date.now();

    try {
      if (this.isDbCircuitBreakerOpen()) {
        throw new ServiceUnavailableException(
          'Database circuit breaker is open',
        );
      }

      const timeframe = this.getTimeframeMs(query.timeframe || '24h');
      const startDate = new Date(Date.now() - timeframe);

      const pipeline: PipelineStage[] = [
        {
          $match: {
            start_time: { $gte: startDate },
            ...(query.tenant_id && { tenant_id: query.tenant_id }),
            ...(query.workspace_id && { workspace_id: query.workspace_id }),
          },
        },
        {
          $facet: {
            basic: [
              {
                $group: {
                  _id: null,
                  totalSpans: { $sum: 1 },
                  totalCost: { $sum: { $ifNull: ['$cost', 0] } },
                  avgLatency: { $avg: '$duration' },
                  errorCount: {
                    $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] },
                  },
                },
              },
            ],
            percentiles: [
              {
                $sort: { duration: 1 },
              },
              {
                $group: {
                  _id: null,
                  durations: { $push: '$duration' },
                  count: { $sum: 1 },
                },
              },
            ],
            operations: [
              {
                $group: {
                  _id: { operation: '$operation_name', status: '$status' },
                  count: { $sum: 1 },
                  avgDuration: { $avg: '$duration' },
                  avgCost: { $avg: { $ifNull: ['$cost', 0] } },
                },
              },
              {
                $group: {
                  _id: '$_id.operation',
                  totalCount: { $sum: '$count' },
                  avgDuration: { $avg: '$avgDuration' },
                  avgCost: { $avg: '$avgCost' },
                  errorCount: {
                    $sum: {
                      $cond: [{ $eq: ['$_id.status', 'error'] }, '$count', 0],
                    },
                  },
                },
              },
              {
                $project: {
                  operation: '$_id',
                  count: '$totalCount',
                  avgDuration: 1,
                  avgCost: 1,
                  errorRate: { $divide: ['$errorCount', '$totalCount'] },
                },
              },
              { $sort: { count: -1 } },
              { $limit: 20 },
            ],
            errors: [
              {
                $match: { status: 'error' },
              },
              {
                $group: {
                  _id: {
                    operation: '$operation_name',
                    error_type: '$error_type',
                  },
                  count: { $sum: 1 },
                  avgDuration: { $avg: '$duration' },
                },
              },
              {
                $project: {
                  operation: '$_id.operation',
                  error_type: '$_id.error_type',
                  count: 1,
                  avgDuration: 1,
                },
              },
              { $sort: { count: -1 } },
              { $limit: 10 },
            ],
            models: [
              {
                $match: { gen_ai_model: { $exists: true, $ne: null } },
              },
              {
                $group: {
                  _id: '$gen_ai_model',
                  count: { $sum: 1 },
                  avgCost: { $avg: { $ifNull: ['$cost', 0] } },
                  avgDuration: { $avg: '$duration' },
                },
              },
              {
                $project: {
                  model: '$_id',
                  count: 1,
                  avgCost: 1,
                  avgDuration: 1,
                },
              },
              { $sort: { count: -1 } },
              { $limit: 10 },
            ],
          },
        },
      ];

      const result = await this.telemetryModel.aggregate(pipeline).exec();

      if (!result || result.length === 0) {
        throw new NotFoundException(
          'No telemetry data found for the specified timeframe',
        );
      }

      const data = result[0];

      // Handle empty results gracefully
      const basic = data.basic?.[0] || {
        totalSpans: 0,
        totalCost: 0,
        avgLatency: 0,
        errorCount: 0,
      };

      // Calculate percentiles from the durations array in the aggregation result
      const percentiles = {
        p50: 0,
        p95: 0,
        p99: 0,
        p999: 0,
      };

      if (
        data.percentiles?.[0]?.durations &&
        Array.isArray(data.percentiles[0].durations)
      ) {
        const durations = data.percentiles[0].durations.sort(
          (a: number, b: number) => a - b,
        );
        percentiles.p50 = this.calculatePercentile(durations, 50);
        percentiles.p95 = this.calculatePercentile(durations, 95);
        percentiles.p99 = this.calculatePercentile(durations, 99);
        percentiles.p999 = this.calculatePercentile(durations, 99.9);
      } else if (basic.totalSpans > 0) {
        // Fallback: calculate percentiles from a separate query
        const durations = await this.telemetryModel
          .find({
            start_time: { $gte: startDate },
            ...(query.tenant_id && { tenant_id: query.tenant_id }),
            ...(query.workspace_id && { workspace_id: query.workspace_id }),
          })
          .select('duration')
          .sort({ duration: 1 })
          .exec();

        const durationValues = durations
          .map((d) => (d.toObject ? d.toObject() : d) as any)
          .map((d) => d.duration)
          .sort((a, b) => a - b);
        percentiles.p50 = this.calculatePercentile(durationValues, 50);
        percentiles.p95 = this.calculatePercentile(durationValues, 95);
        percentiles.p99 = this.calculatePercentile(durationValues, 99);
        percentiles.p999 = this.calculatePercentile(durationValues, 99.9);
      }

      const metrics: PerformanceMetrics = {
        basic: {
          totalSpans: basic.totalSpans,
          totalCost: basic.totalCost,
          averageLatency: basic.avgLatency || 0,
          errorRate:
            basic.totalSpans > 0 ? basic.errorCount / basic.totalSpans : 0,
          p95Latency: percentiles.p95 || 0,
          p99Latency: percentiles.p99 || 0,
        },
        percentiles,
        operations: data.operations || [],
        errors: data.errors || [],
        models: data.models || [],
      };

      this.logger.log(
        `Performance metrics calculated in ${Date.now() - startTime}ms`,
        {
          spans: basic.totalSpans,
          timeframe: query.timeframe,
        },
      );

      return metrics;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.recordDbFailure();
      this.logger.error('Get performance metrics failed', {
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Get service dependency graph
   */
  async getServiceDependencies(
    query: MetricsQueryDto,
  ): Promise<ServiceDependency[]> {
    const startTime = Date.now();

    try {
      if (this.isDbCircuitBreakerOpen()) {
        throw new ServiceUnavailableException(
          'Database circuit breaker is open',
        );
      }

      const timeframe = this.getTimeframeMs(query.timeframe || '24h');
      const startDate = new Date(Date.now() - timeframe);

      const pipeline: PipelineStage[] = [
        {
          $match: {
            start_time: { $gte: startDate },
            ...(query.tenant_id && { tenant_id: query.tenant_id }),
            ...(query.workspace_id && { workspace_id: query.workspace_id }),
          },
        },
        {
          $lookup: {
            from: 'telemetries', // Self-lookup for parent spans
            localField: 'trace_id',
            foreignField: 'trace_id',
            as: 'parentSpans',
            pipeline: [
              {
                $match: {
                  start_time: { $gte: startDate },
                  end_time: { $lt: '$$ROOT.start_time' },
                },
              },
              {
                $sort: { end_time: -1 },
              },
              {
                $limit: 1,
              },
            ],
          },
        },
        {
          $unwind: {
            path: '$parentSpans',
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $group: {
            _id: {
              service: '$service_name',
              operation: '$operation_name',
              parentService: { $ifNull: ['$parentSpans.service_name', null] },
              parentOperation: {
                $ifNull: ['$parentSpans.operation_name', null],
              },
            },
            count: { $sum: 1 },
          },
        },
        {
          $match: {
            '_id.parentService': { $ne: null },
            '_id.parentOperation': { $ne: null },
          },
        },
        {
          $group: {
            _id: {
              service: '$_id.service',
              operation: '$_id.operation',
            },
            calledBy: {
              $push: {
                service: '$_id.parentService',
                operation: '$_id.parentOperation',
                count: '$count',
              },
            },
          },
        },
        {
          $project: {
            service: '$_id.service',
            operation: '$_id.operation',
            calledBy: 1,
            _id: 0,
          },
        },
        { $sort: { 'calledBy.0.count': -1 } },
      ];

      const dependencies = await this.telemetryModel.aggregate(pipeline).exec();

      this.logger.log(
        `Service dependencies calculated in ${Date.now() - startTime}ms`,
        {
          services: dependencies.length,
        },
      );

      return dependencies as ServiceDependency[];
    } catch (error) {
      this.recordDbFailure();
      this.logger.error('Get service dependencies failed', {
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Get enrichment statistics
   */
  async getEnrichmentStats(query: MetricsQueryDto): Promise<EnrichmentStats> {
    const startTime = Date.now();

    try {
      if (this.isDbCircuitBreakerOpen()) {
        throw new ServiceUnavailableException(
          'Database circuit breaker is open',
        );
      }

      const timeframe = this.getTimeframeMs(query.timeframe || '24h');
      const startDate = new Date(Date.now() - timeframe);

      const pipeline: PipelineStage[] = [
        {
          $match: {
            start_time: { $gte: startDate },
            ...(query.tenant_id && { tenant_id: query.tenant_id }),
            ...(query.workspace_id && { workspace_id: query.workspace_id }),
          },
        },
        {
          $facet: {
            coverage: [
              {
                $group: {
                  _id: null,
                  totalSpans: { $sum: 1 },
                  enrichedSpans: {
                    $sum: { $cond: [{ $ne: ['$enrichment', null] }, 1, 0] },
                  },
                },
              },
              {
                $project: {
                  totalSpans: 1,
                  enrichedSpans: 1,
                  coverage: { $divide: ['$enrichedSpans', '$totalSpans'] },
                },
              },
            ],
            recent: [
              {
                $match: {
                  enrichment: { $exists: true },
                  start_time: { $gte: new Date(Date.now() - 3600000) }, // Last hour
                },
              },
              { $count: 'recentEnrichments' },
            ],
            types: [
              {
                $match: { enrichment: { $exists: true } },
              },
              {
                $project: {
                  insights: {
                    $size: { $ifNull: ['$enrichment.insights', []] },
                  },
                  recommendations: {
                    $size: { $ifNull: ['$enrichment.recommendations', []] },
                  },
                  patterns: {
                    $size: { $ifNull: ['$enrichment.patterns', []] },
                  },
                  costOptimizations: {
                    $size: {
                      $ifNull: [
                        '$enrichment.cost_optimization_opportunities',
                        [],
                      ],
                    },
                  },
                  performanceInsights: {
                    $size: {
                      $ifNull: ['$enrichment.performance_insights', []],
                    },
                  },
                  errorAnalysis: {
                    $size: { $ifNull: ['$enrichment.error_analysis', []] },
                  },
                },
              },
              {
                $group: {
                  _id: null,
                  insights: { $sum: '$insights' },
                  recommendations: { $sum: '$recommendations' },
                  patterns: { $sum: '$patterns' },
                  costOptimizations: { $sum: '$costOptimizations' },
                  performanceInsights: { $sum: '$performanceInsights' },
                  errorAnalysis: { $sum: '$errorAnalysis' },
                },
              },
            ],
          },
        },
      ];

      const result = await this.telemetryModel.aggregate(pipeline).exec();

      const data = result[0] || {};
      const coverage = data.coverage?.[0] || {
        totalSpans: 0,
        enrichedSpans: 0,
        coverage: 0,
      };
      const recent = data.recent?.[0]?.recentEnrichments || 0;
      const types = data.types?.[0] || {
        insights: 0,
        recommendations: 0,
        patterns: 0,
        costOptimizations: 0,
        performanceInsights: 0,
        errorAnalysis: 0,
      };

      const stats: EnrichmentStats = {
        totalSpans: coverage.totalSpans,
        enrichedSpans: coverage.enrichedSpans,
        coverage: coverage.coverage,
        recentEnrichments: recent,
        enrichmentTypes: {
          insights: types.insights,
          recommendations: types.recommendations,
          patterns: types.patterns,
          costOptimizations: types.costOptimizations,
          performanceInsights: types.performanceInsights,
          errorAnalysis: types.errorAnalysis,
        },
      };

      this.logger.log(
        `Enrichment stats calculated in ${Date.now() - startTime}ms`,
        stats,
      );

      return stats;
    } catch (error) {
      this.recordDbFailure();
      this.logger.error('Get enrichment stats failed', {
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Get enriched spans with insights
   */
  async getEnrichedSpans(
    query: EnrichedSpansQueryDto,
  ): Promise<TelemetrySpan[]> {
    const startTime = Date.now();

    try {
      if (this.isDbCircuitBreakerOpen()) {
        throw new ServiceUnavailableException(
          'Database circuit breaker is open',
        );
      }

      const timeframe = this.getTimeframeMs(query.timeframe || '24h');
      const startDate = new Date(Date.now() - timeframe);

      const filter: any = {
        start_time: { $gte: startDate },
        enrichment: { $exists: true, $ne: null },
        ...(query.tenant_id && { tenant_id: query.tenant_id }),
        ...(query.workspace_id && { workspace_id: query.workspace_id }),
      };

      const spans = await this.telemetryModel
        .find(filter)
        .select({
          _id: 1,
          trace_id: 1,
          request_id: 1,
          tenant_id: 1,
          workspace_id: 1,
          user_id: 1,
          service_name: 1,
          operation_name: 1,
          start_time: 1,
          end_time: 1,
          duration: 1,
          status: 1,
          cost: 1,
          http_route: 1,
          http_method: 1,
          http_status_code: 1,
          gen_ai_model: 1,
          error_type: 1,
          'enrichment.insights': 1,
          'enrichment.recommendations': 1,
          'enrichment.patterns': 1,
          'enrichment.cost_optimization_opportunities': 1,
          'enrichment.performance_insights': 1,
          'enrichment.error_analysis': 1,
          created_at: 1,
        })
        .sort({ start_time: -1 })
        .limit(query.limit || 50)
        .exec();

      this.logger.log(
        `Enriched spans retrieved in ${Date.now() - startTime}ms`,
        {
          count: spans.length,
        },
      );

      return spans as unknown as TelemetrySpan[];
    } catch (error) {
      this.recordDbFailure();
      this.logger.error('Get enriched spans failed', {
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Get unified dashboard data
   */
  async getUnifiedDashboardData(query: {
    tenant_id?: string;
    workspace_id?: string;
  }): Promise<TelemetryDashboardData> {
    const startTime = Date.now();

    try {
      if (this.isDbCircuitBreakerOpen()) {
        throw new ServiceUnavailableException(
          'Database circuit breaker is open',
        );
      }

      // Parallel queries for dashboard data
      const queries = [
        // Basic stats
        this.telemetryModel
          .aggregate([
            {
              $match: {
                ...(query.tenant_id && { tenant_id: query.tenant_id }),
                ...(query.workspace_id && { workspace_id: query.workspace_id }),
                start_time: {
                  $gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
                }, // Last 24h
              },
            },
            {
              $group: {
                _id: null,
                totalSpans: { $sum: 1 },
                totalCost: { $sum: { $ifNull: ['$cost', 0] } },
                avgLatency: { $avg: '$duration' },
                errorCount: {
                  $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] },
                },
              },
            },
          ])
          .exec(),

        // Top operations
        this.telemetryModel
          .aggregate([
            {
              $match: {
                ...(query.tenant_id && { tenant_id: query.tenant_id }),
                ...(query.workspace_id && { workspace_id: query.workspace_id }),
                start_time: {
                  $gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
                },
              },
            },
            {
              $group: {
                _id: '$operation_name',
                count: { $sum: 1 },
                avgDuration: { $avg: '$duration' },
                avgCost: { $avg: { $ifNull: ['$cost', 0] } },
              },
            },
            {
              $project: {
                operation: '$_id',
                count: 1,
                avgDuration: 1,
                avgCost: 1,
              },
            },
            { $sort: { count: -1 } },
            { $limit: 10 },
          ])
          .exec(),

        // Recent errors
        this.telemetryModel
          .find({
            status: 'error',
            ...(query.tenant_id && { tenant_id: query.tenant_id }),
            ...(query.workspace_id && { workspace_id: query.workspace_id }),
          })
          .sort({ start_time: -1 })
          .limit(5)
          .exec(),

        // Cost trends (last 7 days, hourly)
        this.telemetryModel
          .aggregate([
            {
              $match: {
                ...(query.tenant_id && { tenant_id: query.tenant_id }),
                ...(query.workspace_id && { workspace_id: query.workspace_id }),
                start_time: {
                  $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                },
              },
            },
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: '%Y-%m-%d-%H',
                    date: '$start_time',
                  },
                },
                cost: { $sum: { $ifNull: ['$cost', 0] } },
                count: { $sum: 1 },
              },
            },
            {
              $project: {
                timestamp: {
                  $dateFromString: {
                    dateString: {
                      $concat: [
                        { $substr: ['$_id', 0, 10] },
                        'T',
                        { $substr: ['$_id', 11, 2] },
                        ':00:00Z',
                      ],
                    },
                  },
                },
                cost: 1,
                count: 1,
              },
            },
            { $sort: { timestamp: 1 } },
          ])
          .exec(),

        // Performance trends
        this.telemetryModel
          .aggregate([
            {
              $match: {
                ...(query.tenant_id && { tenant_id: query.tenant_id }),
                ...(query.workspace_id && { workspace_id: query.workspace_id }),
                start_time: {
                  $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                },
              },
            },
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: '%Y-%m-%d-%H',
                    date: '$start_time',
                  },
                },
                avgDuration: { $avg: '$duration' },
                count: { $sum: 1 },
              },
            },
            {
              $project: {
                timestamp: {
                  $dateFromString: {
                    dateString: {
                      $concat: [
                        { $substr: ['$_id', 0, 10] },
                        'T',
                        { $substr: ['$_id', 11, 2] },
                        ':00:00Z',
                      ],
                    },
                  },
                },
                avgDuration: 1,
                count: 1,
              },
            },
            { $sort: { timestamp: 1 } },
          ])
          .exec(),
      ];

      const results = await Promise.allSettled(queries);

      // Extract results with fallbacks
      const [
        basicResult,
        operationsResult,
        errorsResult,
        costTrendsResult,
        perfTrendsResult,
      ] = results;

      const basic =
        basicResult.status === 'fulfilled' && basicResult.value.length > 0
          ? basicResult.value[0]
          : { totalSpans: 0, totalCost: 0, avgLatency: 0, errorCount: 0 };

      const dashboard: TelemetryDashboardData = {
        totalSpans: basic.totalSpans || 0,
        totalCost: basic.totalCost || 0,
        averageLatency: basic.avgLatency || 0,
        errorRate:
          basic.totalSpans > 0 ? (basic.errorCount || 0) / basic.totalSpans : 0,
        topOperations:
          operationsResult.status === 'fulfilled' ? operationsResult.value : [],
        recentErrors:
          errorsResult.status === 'fulfilled' ? errorsResult.value : [],
        costTrends:
          costTrendsResult.status === 'fulfilled' ? costTrendsResult.value : [],
        performanceTrends:
          perfTrendsResult.status === 'fulfilled' ? perfTrendsResult.value : [],
      };

      this.logger.log(
        `Dashboard data retrieved in ${Date.now() - startTime}ms`,
        {
          spans: dashboard.totalSpans,
        },
      );

      return dashboard;
    } catch (error) {
      this.recordDbFailure();
      this.logger.error('Get unified dashboard data failed', {
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Generate AI recommendations based on telemetry patterns
   */
  async generateAIRecommendations(
    timeframe: string = '7d',
  ): Promise<AIRecommendation[]> {
    const startTime = Date.now();

    try {
      const ms = this.getTimeframeMs(timeframe);
      const startDate = new Date(Date.now() - ms);

      // Analyze patterns for recommendations
      const patterns = await this.telemetryModel
        .aggregate([
          {
            $match: { start_time: { $gte: startDate } },
          },
          {
            $facet: {
              costAnalysis: [
                {
                  $match: { cost: { $exists: true, $gt: 0 } },
                },
                {
                  $group: {
                    _id: '$gen_ai_model',
                    avgCost: { $avg: '$cost' },
                    totalCost: { $sum: '$cost' },
                    count: { $sum: 1 },
                  },
                },
                { $sort: { totalCost: -1 } },
              ],
              performanceAnalysis: [
                {
                  $group: {
                    _id: '$operation_name',
                    avgDuration: { $avg: '$duration' },
                    count: { $sum: 1 },
                  },
                },
                { $sort: { avgDuration: -1 } },
              ],
              errorAnalysis: [
                {
                  $match: { status: 'error' },
                },
                {
                  $group: {
                    _id: '$operation_name',
                    errorCount: { $sum: 1 },
                    totalCount: { $sum: 1 },
                  },
                },
                {
                  $lookup: {
                    from: 'telemetries',
                    localField: '_id',
                    foreignField: 'operation_name',
                    as: 'totalSpans',
                  },
                },
                {
                  $project: {
                    operation: '$_id',
                    errorRate: {
                      $divide: ['$errorCount', { $size: '$totalSpans' }],
                    },
                  },
                },
                { $sort: { errorRate: -1 } },
              ],
            },
          },
        ])
        .exec();

      const data = patterns[0] || {};
      const recommendations: AIRecommendation[] = [];

      // Cost optimization recommendations
      if (data.costAnalysis?.length > 1) {
        const models = data.costAnalysis;
        const cheapest = models[models.length - 1];
        const expensive = models[0];

        if (expensive.avgCost > cheapest.avgCost * 1.5) {
          recommendations.push({
            type: 'cost_optimization',
            priority: 'high',
            title: 'Model Cost Optimization',
            description: `Consider switching from ${expensive._id} to ${cheapest._id} for cost savings`,
            impact: {
              costSavings:
                (expensive.avgCost - cheapest.avgCost) * expensive.count,
            },
            actionItems: [
              `Evaluate ${cheapest._id} for ${expensive._id} use cases`,
              'Update model routing logic',
              'A/B test performance impact',
            ],
            confidence: 0.85,
            basedOn: {
              spanCount: expensive.count,
              timeRange: timeframe,
            },
          });
        }
      }

      // Performance recommendations
      if (data.performanceAnalysis?.length > 0) {
        const slowOps = data.performanceAnalysis.filter(
          (op: any) => op.avgDuration > 5000,
        ); // > 5s
        if (slowOps.length > 0) {
          recommendations.push({
            type: 'performance_improvement',
            priority: 'medium',
            title: 'Slow Operation Optimization',
            description: `${slowOps.length} operations are running slower than expected`,
            impact: {
              latencyReduction:
                slowOps.reduce(
                  (sum: number, op: any) => sum + (op.avgDuration - 2000),
                  0,
                ) / slowOps.length,
            },
            actionItems: [
              'Implement caching for slow operations',
              'Optimize database queries',
              'Consider async processing',
            ],
            confidence: 0.75,
            basedOn: {
              spanCount: slowOps.reduce(
                (sum: number, op: any) => sum + op.count,
                0,
              ),
              timeRange: timeframe,
            },
          });
        }
      }

      // Error reduction recommendations
      if (data.errorAnalysis?.length > 0) {
        const highErrorOps = data.errorAnalysis.filter(
          (op: any) => op.errorRate > 0.1,
        ); // > 10% error rate
        if (highErrorOps.length > 0) {
          recommendations.push({
            type: 'error_reduction',
            priority: 'high',
            title: 'Error Rate Reduction',
            description: `${highErrorOps.length} operations have high error rates`,
            impact: {
              errorReduction:
                highErrorOps.reduce(
                  (sum: number, op: any) => sum + op.errorRate,
                  0,
                ) / highErrorOps.length,
            },
            actionItems: [
              'Add retry logic for failed operations',
              'Implement circuit breakers',
              'Add better error handling',
            ],
            confidence: 0.9,
            basedOn: {
              spanCount: highErrorOps.reduce(
                (sum: number, op: any) => sum + op.errorCount,
                0,
              ),
              timeRange: timeframe,
            },
          });
        }
      }

      this.logger.log(
        `AI recommendations generated in ${Date.now() - startTime}ms`,
        {
          count: recommendations.length,
        },
      );

      return recommendations;
    } catch (error) {
      this.logger.error('Generate AI recommendations failed', {
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });
      return [];
    }
  }

  /**
   * Get processed today count (resets daily)
   */
  private getProcessedToday(): number {
    this.checkAndResetDailyCounter();
    return this.processedToday;
  }

  /**
   * Check if we need to reset the daily counter
   */
  private checkAndResetDailyCounter(): void {
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      this.processedToday = 0;
      this.lastResetDate = today;
    }
  }

  /**
   * Increment processed counter
   */
  private incrementProcessedCount(count: number): void {
    this.checkAndResetDailyCounter();
    this.processedToday += count;
  }

  /**
   * Trigger enrichment for spans that need it
   */
  async triggerEnrichment(): Promise<{ processed: number; enriched: number }> {
    const startTime = Date.now();

    try {
      const result = await this.autoEnrichSpans();

      // Track processed count for health monitoring
      this.incrementProcessedCount(result.processed);

      this.logger.log(
        `Manual enrichment triggered in ${Date.now() - startTime}ms`,
        {
          ...result,
          processedToday: this.getProcessedToday(),
        },
      );
      return result;
    } catch (error) {
      this.logger.error('Manual enrichment trigger failed', {
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Get enhanced dashboard with AI recommendations
   */
  async getEnhancedDashboard(query: {
    tenant_id?: string;
    workspace_id?: string;
  }): Promise<{
    dashboard: TelemetryDashboardData;
    recommendations: AIRecommendation[];
    enrichmentStats: EnrichmentStats;
  }> {
    const startTime = Date.now();

    try {
      const [dashboard, recommendations, enrichmentStats] =
        await Promise.allSettled([
          this.getUnifiedDashboardData(query),
          this.generateAIRecommendations(),
          this.getEnrichmentStats({ timeframe: '7d', ...query }),
        ]);

      const result = {
        dashboard:
          dashboard.status === 'fulfilled'
            ? dashboard.value
            : ({} as TelemetryDashboardData),
        recommendations:
          recommendations.status === 'fulfilled' ? recommendations.value : [],
        enrichmentStats:
          enrichmentStats.status === 'fulfilled'
            ? enrichmentStats.value
            : ({} as EnrichmentStats),
      };

      this.logger.log(
        `Enhanced dashboard retrieved in ${Date.now() - startTime}ms`,
        {
          recommendations: result.recommendations.length,
        },
      );

      return result;
    } catch (error) {
      this.logger.error('Get enhanced dashboard failed', {
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Background enrichment process
   */
  private async autoEnrichSpans(): Promise<{
    processed: number;
    enriched: number;
  }> {
    try {
      // Find unenriched spans from the last 24 hours
      const unenrichedSpans = await this.telemetryModel
        .find({
          enrichment: { $exists: false },
          start_time: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        })
        .limit(100) // Process in batches
        .exec();

      if (unenrichedSpans.length === 0) {
        return { processed: 0, enriched: 0 };
      }

      const enrichmentOperations = unenrichedSpans.map((span) => ({
        updateOne: {
          filter: { _id: span._id },
          update: {
            $set: {
              enrichment: this.generateSpanEnrichment(
                (span.toObject
                  ? span.toObject()
                  : span) as unknown as TelemetrySpan,
              ),
            },
          },
        },
      }));

      const result = await this.telemetryModel.bulkWrite(enrichmentOperations, {
        ordered: false, // Allow parallel processing
      });

      // Emit enrichment events for real-time updates
      unenrichedSpans.forEach((span) => {
        this.costStreamingService.emitCostEvent({
          eventType: 'cost_tracked',
          timestamp: new Date(),
          userId: span.user_id,
          workspaceId: span.workspace_id,
          data: {
            operation: 'enrichment_processed',
            metadata: {
              spanId: span._id,
              enriched: true,
            },
          },
        });
      });

      return {
        processed: unenrichedSpans.length,
        enriched: result.modifiedCount,
      };
    } catch (error) {
      this.logger.error('Auto enrichment failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { processed: 0, enriched: 0 };
    }
  }

  /**
   * Generate AI-powered enrichment for a span
   */
  private generateSpanEnrichment(
    span: TelemetrySpan,
  ): TelemetrySpan['enrichment'] {
    const enrichment: TelemetrySpan['enrichment'] = {
      insights: [],
      recommendations: [],
      patterns: [],
      cost_optimization_opportunities: [],
      performance_insights: [],
      error_analysis: [],
    };

    // Cost analysis
    if (span.cost && span.cost > 0.01) {
      enrichment.cost_optimization_opportunities.push(
        'High cost operation detected',
      );

      if (span.duration > 10000) {
        // > 10s
        enrichment.cost_optimization_opportunities.push(
          'Consider caching results for expensive operations',
        );
      }

      if (span.gen_ai_model) {
        enrichment.cost_optimization_opportunities.push(
          `Review ${span.gen_ai_model} usage patterns for optimization`,
        );
      }
    }

    // Performance analysis
    if (span.duration > 5000) {
      enrichment.performance_insights.push('Slow operation detected');

      if (
        span.operation_name?.includes('query') ||
        span.operation_name?.includes('search')
      ) {
        enrichment.performance_insights.push(
          'Consider database query optimization',
        );
      }
    }

    // Error analysis
    if (span.status === 'error') {
      enrichment.error_analysis.push('Operation failed');

      if (span.error_type) {
        enrichment.error_analysis.push(`Error type: ${span.error_type}`);
      }

      if (span.http_status_code && span.http_status_code >= 500) {
        enrichment.error_analysis.push('Server error - check service health');
      }
    }

    // Pattern recognition
    if (span.operation_name) {
      if (span.operation_name.includes('cache')) {
        enrichment.patterns.push('Caching operation detected');
      }

      if (span.operation_name.includes('retry')) {
        enrichment.patterns.push('Retry logic detected');
      }
    }

    // Recommendations based on analysis
    if (enrichment.cost_optimization_opportunities.length > 0) {
      enrichment.recommendations.push('Implement cost monitoring alerts');
    }

    if (enrichment.performance_insights.length > 0) {
      enrichment.recommendations.push('Add performance monitoring');
    }

    if (enrichment.error_analysis.length > 0) {
      enrichment.recommendations.push('Implement error tracking and alerting');
    }

    return enrichment;
  }

  /**
   * Build optimized MongoDB filter using filter builders
   */
  private buildOptimizedFilter(query: TelemetryQueryDto): any {
    const filter: any = {};
    const filterConditions: any[] = [];

    // Apply filter builders for each query parameter
    Object.entries(query).forEach(([key, value]) => {
      if (
        value !== undefined &&
        value !== null &&
        this.filterBuilders.has(key)
      ) {
        const builder = this.filterBuilders.get(key);
        if (builder && typeof builder === 'function') {
          try {
            const condition = builder(value);
            if (condition && Object.keys(condition).length > 0) {
              filterConditions.push(condition);
            }
          } catch (error) {
            this.logger.warn(`Failed to build filter for ${key}`, {
              error: error instanceof Error ? error.message : String(error),
              value,
            });
          }
        }
      }
    });

    // Special handling for HTTP status code (not handled by builder)
    if (query.http_status_code !== undefined) {
      filterConditions.push({ http_status_code: query.http_status_code });
    }

    // Combine all conditions
    if (filterConditions.length === 1) {
      Object.assign(filter, filterConditions[0]);
    } else if (filterConditions.length > 1) {
      // Use $and to combine multiple conditions
      filter.$and = filterConditions;
    }

    // Optimize filter for better query performance
    this.optimizeFilter(filter);

    return filter;
  }

  /**
   * Optimize filter for better MongoDB query performance
   */
  private optimizeFilter(filter: any): void {
    // Remove empty objects
    Object.keys(filter).forEach((key) => {
      if (
        filter[key] &&
        typeof filter[key] === 'object' &&
        Object.keys(filter[key]).length === 0
      ) {
        delete filter[key];
      }
    });

    // Flatten single-element $and arrays
    if (filter.$and && Array.isArray(filter.$and) && filter.$and.length === 1) {
      const singleCondition = filter.$and[0];
      delete filter.$and;
      Object.assign(filter, singleCondition);
    }

    // Optimize $or conditions with single elements
    if (filter.$or && Array.isArray(filter.$or) && filter.$or.length === 1) {
      const singleOrCondition = filter.$or[0];
      delete filter.$or;
      Object.assign(filter, singleOrCondition);
    }

    // Log complex filters for monitoring
    if (this.hasComplexFilter(filter)) {
      this.logger.debug('Complex filter detected', {
        filterKeys: Object.keys(filter),
        hasAnd: !!filter.$and,
        hasOr: !!filter.$or,
        hasNor: !!filter.$nor,
      });
    }
  }

  /**
   * Check if filter contains complex conditions
   */
  private hasComplexFilter(filter: any): boolean {
    return !!(filter.$and || filter.$or || filter.$nor || filter.$not);
  }

  /**
   * Initialize filter builders for complex queries
   */
  private initializeFilterBuilders(): void {
    // Basic field filters
    this.filterBuilders.set('tenant_id', (value: string) => ({
      tenant_id: value,
    }));
    this.filterBuilders.set('workspace_id', (value: string) => ({
      workspace_id: value,
    }));
    this.filterBuilders.set('user_id', (value: string) => ({ user_id: value }));
    this.filterBuilders.set('trace_id', (value: string) => ({
      trace_id: value,
    }));
    this.filterBuilders.set('request_id', (value: string) => ({
      request_id: value,
    }));
    this.filterBuilders.set('service_name', (value: string) => ({
      service_name: value,
    }));
    this.filterBuilders.set('operation_name', (value: string) => ({
      operation_name: new RegExp(value, 'i'),
    }));
    this.filterBuilders.set('status', (value: string) => ({ status: value }));
    this.filterBuilders.set('http_route', (value: string) => ({
      http_route: value,
    }));
    this.filterBuilders.set('http_method', (value: string) => ({
      http_method: value,
    }));
    this.filterBuilders.set('http_status_code', (value: number) => ({
      http_status_code: value,
    }));
    this.filterBuilders.set('gen_ai_model', (value: string) => ({
      gen_ai_model: value,
    }));
    this.filterBuilders.set('error_type', (value: string) => ({
      error_type: value,
    }));

    // Range filters
    this.filterBuilders.set('start_time', (value: string) => ({
      start_time: { $gte: new Date(value) },
    }));
    this.filterBuilders.set('end_time', (value: string) => ({
      start_time: { $lte: new Date(value) },
    }));
    this.filterBuilders.set('min_duration', (value: number) => ({
      duration_ms: { $gte: value },
    }));
    this.filterBuilders.set('max_duration', (value: number) => ({
      duration_ms: { $lte: value },
    }));
    this.filterBuilders.set('min_cost', (value: number) => ({
      cost_usd: { $gte: value },
    }));
    this.filterBuilders.set('max_cost', (value: number) => ({
      cost_usd: { $lte: value },
    }));

    // Complex array filters
    this.filterBuilders.set('status_array', (values: string[]) => ({
      status: { $in: values },
    }));
    this.filterBuilders.set('service_array', (values: string[]) => ({
      service_name: { $in: values },
    }));
    this.filterBuilders.set('operation_array', (values: string[]) => ({
      operation_name: { $in: values.map((v) => new RegExp(v, 'i')) },
    }));

    // HTTP status code ranges
    this.filterBuilders.set(
      'http_status_range',
      (range: { min?: number; max?: number }) => {
        const filter: any = {};
        if (range.min !== undefined || range.max !== undefined) {
          filter.http_status_code = {};
          if (range.min !== undefined) filter.http_status_code.$gte = range.min;
          if (range.max !== undefined) filter.http_status_code.$lte = range.max;
        }
        return filter;
      },
    );

    // Error type patterns (supports regex)
    this.filterBuilders.set('error_type_pattern', (pattern: string) => ({
      error_type: new RegExp(pattern, 'i'),
    }));

    // Complex time range with timezone support
    this.filterBuilders.set(
      'time_range',
      (range: { start: string; end: string; timezone?: string }) => {
        let startDate: Date;
        let endDate: Date;

        if (range.timezone) {
          const { startUTC, endUTC } = this.applyTimezoneToDateRange(
            range.start,
            range.end,
            range.timezone,
          );
          startDate = startUTC;
          endDate = endUTC;
        } else {
          startDate = new Date(range.start);
          endDate = new Date(range.end);
        }

        const filter: any = {
          start_time: {
            $gte: startDate,
            $lte: endDate,
          },
        };

        return filter;
      },
    );

    // Cost efficiency filters (combines multiple cost-related conditions)
    this.filterBuilders.set(
      'cost_efficiency',
      (params: { threshold?: number; excludeFree?: boolean }) => {
        const conditions: any[] = [];

        if (params.threshold !== undefined) {
          conditions.push({ cost_usd: { $gte: params.threshold } });
        }

        if (params.excludeFree !== false) {
          // Default to true
          conditions.push({ cost_usd: { $gt: 0 } });
        }

        return conditions.length > 1
          ? { $and: conditions }
          : conditions[0] || {};
      },
    );

    // Performance anomaly filters
    this.filterBuilders.set(
      'performance_anomaly',
      (params: { durationThreshold?: number; errorCorrelation?: boolean }) => {
        const conditions: any[] = [];

        if (params.durationThreshold) {
          conditions.push({ duration_ms: { $gte: params.durationThreshold } });
        }

        if (params.errorCorrelation) {
          conditions.push({ status: 'error' });
        }

        return conditions.length > 1
          ? { $and: conditions }
          : conditions[0] || {};
      },
    );

    // Service dependency filters
    this.filterBuilders.set(
      'service_dependency',
      (params: {
        sourceService?: string;
        targetService?: string;
        excludeSelf?: boolean;
      }) => {
        const conditions: any[] = [];

        if (params.sourceService) {
          conditions.push({ service_name: params.sourceService });
        }

        if (params.targetService) {
          // Future enhancement: Use aggregation pipeline to trace cross-service calls
          // For now, filter by service name for basic telemetry queries
          conditions.push({ service_name: params.targetService });
        }

        if (
          params.excludeSelf &&
          params.sourceService &&
          params.targetService
        ) {
          conditions.push({ service_name: { $ne: params.sourceService } });
        }

        return conditions.length > 1
          ? { $and: conditions }
          : conditions[0] || {};
      },
    );

    // Multi-field search filter
    this.filterBuilders.set('multi_field_search', (query: string) => ({
      $or: [
        { operation_name: new RegExp(query, 'i') },
        { service_name: new RegExp(query, 'i') },
        { http_route: new RegExp(query, 'i') },
        { error_type: new RegExp(query, 'i') },
        { gen_ai_model: new RegExp(query, 'i') },
      ],
    }));

    // Advanced filtering with logical operators
    this.filterBuilders.set(
      'advanced_filter',
      (params: {
        must?: any[];
        should?: any[];
        must_not?: any[];
        minimum_should_match?: number;
      }) => {
        const filter: any = {};

        if (params.must && params.must.length > 0) {
          filter.$and = params.must;
        }

        if (params.should && params.should.length > 0) {
          const minMatch = params.minimum_should_match;
          if (
            minMatch !== undefined &&
            minMatch > 0 &&
            minMatch <= params.should.length
          ) {
            const matchExprs = params.should
              .map((clause) => this.clauseToMatchExpr(clause))
              .filter((e): e is object => e !== null);
            if (matchExprs.length === params.should.length) {
              filter.$expr = {
                $gte: [
                  {
                    $add: matchExprs.map((expr) => ({
                      $cond: [expr, 1, 0],
                    })),
                  },
                  minMatch,
                ],
              };
            } else {
              filter.$or = params.should;
              this.logger.debug(
                'minimum_should_match: some clauses could not be converted to $expr, using plain $or',
              );
            }
          } else {
            filter.$or = params.should;
          }
        }

        if (params.must_not && params.must_not.length > 0) {
          filter.$nor = params.must_not;
        }

        return filter;
      },
    );
  }

  /**
   * Convert a simple MongoDB query clause to a $expr-compatible match expression.
   * Supports: { field: value }, { field: { $eq, $ne, $in, $nin, $gt, $gte, $lt, $lte } }
   * Returns null if the clause cannot be converted.
   */
  private clauseToMatchExpr(clause: any): object | null {
    if (clause == null || typeof clause !== 'object') return null;
    const keys = Object.keys(clause);
    if (keys.length === 0) return null;
    if (keys.length === 1) {
      const field = keys[0];
      const val = clause[field];
      if (field.startsWith('$')) return null;
      const path = `$${field}`;
      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        const op = Object.keys(val)[0];
        const opVal = val[op];
        if (op === '$eq') return { $eq: [path, opVal] } as any;
        if (op === '$ne') return { $ne: [path, opVal] } as any;
        if (op === '$in') return { $in: [path, opVal] } as any;
        if (op === '$nin') return { $nin: [path, opVal] } as any;
        if (op === '$gt') return { $gt: [path, opVal] } as any;
        if (op === '$gte') return { $gte: [path, opVal] } as any;
        if (op === '$lt') return { $lt: [path, opVal] } as any;
        if (op === '$lte') return { $lte: [path, opVal] } as any;
        if (op === '$exists')
          return opVal ? { $ne: [path, null] } : ({ $eq: [path, null] } as any);
        return null;
      }
      return { $eq: [path, val] } as any;
    }
    const andParts = keys.map((k) =>
      this.clauseToMatchExpr({ [k]: clause[k] }),
    );
    if (andParts.some((p) => p === null)) return null;
    return { $and: andParts } as any;
  }

  /**
   * Convert date range from IANA timezone-local times to UTC for MongoDB queries.
   * Interprets range.start and range.end as local times in the specified timezone.
   */
  private applyTimezoneToDateRange(
    startStr: string,
    endStr: string,
    ianaTimezone: string,
  ): { startUTC: Date; endUTC: Date } {
    const startDate = new Date(startStr);
    const endDate = new Date(endStr);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return { startUTC: startDate, endUTC: endDate };
    }

    const getOffsetMinutes = (utcDate: Date, tz: string): number => {
      try {
        const formatted = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz,
          timeZoneName: 'shortOffset',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }).format(utcDate);
        const match = formatted.match(/GMT([+-])(\d{1,2})(?::(\d{2})?)?/);
        if (match) {
          const sign = match[1] === '+' ? 1 : -1;
          const h = parseInt(match[2], 10);
          const m = parseInt(match[3] ?? '0', 10);
          return sign * (h * 60 + m);
        }
      } catch {
        // Invalid timezone
      }
      return 0;
    };

    const toUTC = (date: Date, tz: string): Date => {
      const y = date.getUTCFullYear();
      const mo = date.getUTCMonth();
      const d = date.getUTCDate();
      const h = date.getUTCHours();
      const mi = date.getUTCMinutes();
      const s = date.getUTCSeconds();
      const utcGuess = Date.UTC(y, mo, d, h, mi, s);
      const offsetMin = getOffsetMinutes(new Date(utcGuess), tz);
      return new Date(utcGuess - offsetMin * 60 * 1000);
    };

    const startUTC = toUTC(startDate, ianaTimezone);
    let endUTC = toUTC(endDate, ianaTimezone);
    if (endUTC.getTime() <= startUTC.getTime()) {
      endUTC = new Date(startUTC.getTime() + 24 * 60 * 60 * 1000);
    }
    return { startUTC, endUTC };
  }

  /**
   * Circuit breaker check
   */
  private isDbCircuitBreakerOpen(): boolean {
    const now = Date.now();
    const timeSinceLastFailure = now - this.lastDbFailureTime;

    if (
      this.dbFailureCount >= this.MAX_DB_FAILURES &&
      timeSinceLastFailure < this.CIRCUIT_BREAKER_TIMEOUT
    ) {
      return true;
    }

    return false;
  }

  /**
   * Record database failure for circuit breaker
   */
  private recordDbFailure(): void {
    this.dbFailureCount++;
    this.lastDbFailureTime = Date.now();

    this.logger.error('Database operation failed', {
      failureCount: this.dbFailureCount,
      lastFailure: new Date(this.lastDbFailureTime).toISOString(),
    });
  }

  /**
   * Convert timeframe string to milliseconds
   */
  private getTimeframeMs(timeframe: string): number {
    const units: Record<string, number> = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '12h': 12 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '90d': 90 * 24 * 60 * 60 * 1000,
    };

    return units[timeframe] || 24 * 60 * 60 * 1000; // Default 24h
  }

  /**
   * Calculate percentile from sorted array
   */
  private calculatePercentile(
    sortedArray: number[],
    percentile: number,
  ): number {
    if (sortedArray.length === 0) return 0;

    const index = (percentile / 100) * (sortedArray.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    if (lower === upper) {
      return sortedArray[lower];
    }

    const weight = index - lower;
    return sortedArray[lower] * (1 - weight) + sortedArray[upper] * weight;
  }

  /**
   * Check telemetry health
   */
  async checkTelemetryHealth(): Promise<{
    status: string;
    message: string;
    metrics: any;
  }> {
    try {
      // Quick health check
      const count = await this.telemetryModel.estimatedDocumentCount().exec();

      const recentCount = await this.telemetryModel
        .countDocuments({
          start_time: { $gte: new Date(Date.now() - 60 * 1000) }, // Last minute
        })
        .exec();

      return {
        status: 'healthy',
        message: 'Telemetry service is operational',
        metrics: {
          totalSpans: count,
          recentSpansPerMinute: recentCount,
          circuitBreakerOpen: this.isDbCircuitBreakerOpen(),
          streamingClients: this.costStreamingService.getStats().activeClients,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Telemetry service error: ${error instanceof Error ? error.message : String(error)}`,
        metrics: {
          circuitBreakerOpen: this.isDbCircuitBreakerOpen(),
        },
      };
    }
  }

  /**
   * Get processor health (enrichment background process)
   */
  getProcessorHealth(): {
    status: string;
    enrichment: { enabled: boolean; lastRun?: Date; processedToday?: number };
    streaming: { activeClients: number; bufferedEvents: number };
  } {
    return {
      status: 'healthy',
      enrichment: {
        enabled: !!this.enrichmentInterval,
        lastRun: new Date(Date.now() - 5 * 60 * 1000), // Assume last run 5min ago
        processedToday: this.getProcessedToday(),
      },
      streaming: this.costStreamingService.getStats(),
    };
  }
}
