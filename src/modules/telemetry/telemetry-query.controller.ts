import {
  Controller,
  Get,
  Query,
  Param,
  UseGuards,
  HttpException,
  HttpStatus,
  Logger,
  Res,
  Req,
  ValidationPipe,
  UsePipes,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { Public } from '@/common/decorators/public.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { TelemetryQueryService } from './services/telemetry-query.service';
import { CostStreamingService } from './services/cost-streaming.service';
import { TelemetryQueryDto } from './dto/telemetry-query.dto';
import { MetricsQueryDto } from './dto/metrics-query.dto';
import { EnrichedSpansQueryDto } from './dto/enriched-spans-query.dto';
import { generateSecureId } from '../../common/utils/secure-id.util';

@Controller('api/telemetry')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class TelemetryQueryController {
  private readonly logger = new Logger(TelemetryQueryController.name);

  constructor(
    private readonly telemetryQueryService: TelemetryQueryService,
    private readonly costStreamingService: CostStreamingService,
  ) {}

  /**
   * GET /telemetry/health - Public health check endpoint
   * Express-compatible: returns { status, timestamp, telemetry } at top level
   */
  @Get('health')
  @Public()
  async checkTelemetryHealth() {
    const startTime = Date.now();
    try {
      const health = await this.telemetryQueryService.checkTelemetryHealth();
      this.logger.log(`Health check completed in ${Date.now() - startTime}ms`);
      return health;
    } catch (error) {
      this.logger.error('Health check failed', {
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });
      throw new HttpException(
        'Health check failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * GET /telemetry/dashboard - Unified dashboard data
   * Express-compatible: returns { success, dashboard } with Express shape
   */
  @Get('dashboard')
  async getDashboard(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: { tenant_id?: string; workspace_id?: string },
  ) {
    const startTime = Date.now();
    try {
      const nestDashboard =
        await this.telemetryQueryService.getUnifiedDashboardData(query);

      this.logger.log(
        `Dashboard data retrieved in ${Date.now() - startTime}ms`,
        {
          userId: user.id,
          spans: nestDashboard.totalSpans,
        },
      );

      const dashboard = this.mapDashboardToExpressFormat(nestDashboard);
      return { success: true, dashboard };
    } catch (error) {
      this.logger.error('Dashboard retrieval failed', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
        duration: Date.now() - startTime,
      });
      throw new HttpException(
        'Failed to retrieve dashboard data',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * GET /telemetry - Query telemetry spans
   * Express-compatible: returns { success, data, pagination }
   */
  @Get()
  async getTelemetry(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: TelemetryQueryDto,
  ) {
    const startTime = Date.now();
    try {
      const result = await this.telemetryQueryService.queryTelemetry(query);

      this.logger.log(
        `Telemetry query executed in ${Date.now() - startTime}ms`,
        {
          userId: user.id,
          returned: result.spans.length,
          total: result.total,
        },
      );

      return {
        success: true,
        data: result.spans,
        pagination: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          total_pages: Math.ceil(result.total / (result.limit || 1)) || 1,
        },
      };
    } catch (error) {
      this.logger.error('Telemetry query failed', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
        duration: Date.now() - startTime,
      });
      throw new HttpException(
        'Failed to query telemetry',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * GET /telemetry/query - Alternative query endpoint (same as /telemetry)
   */
  @Get('query')
  async getTelemetryQuery(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: TelemetryQueryDto,
  ) {
    return this.getTelemetry(user, query);
  }

  /**
   * GET /telemetry/traces/:traceId - Get trace details
   * Express-compatible: returns { success, summary, spans } at top level
   */
  @Get('traces/:traceId')
  async getTraceDetails(
    @CurrentUser() user: AuthenticatedUser,
    @Param('traceId') traceId: string,
  ) {
    const startTime = Date.now();
    try {
      const trace = await this.telemetryQueryService.getTraceDetails(traceId);

      this.logger.log(
        `Trace details retrieved in ${Date.now() - startTime}ms`,
        {
          userId: user.id,
          traceId,
          spanCount: trace.trace.spans.length,
        },
      );

      const s = trace.trace.summary as Record<string, unknown>;
      return {
        success: true,
        summary: {
          trace_id: traceId,
          total_spans: s.totalSpans ?? trace.trace.spans.length,
          total_duration_ms: s.totalDuration ?? 0,
          total_cost_usd: s.totalCost ?? 0,
          error_count: s.errorCount ?? 0,
        },
        spans: trace.trace.spans,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;

      this.logger.error('Trace details retrieval failed', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
        traceId,
        duration: Date.now() - startTime,
      });
      throw new HttpException(
        'Failed to retrieve trace details',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * GET /telemetry/metrics - Performance metrics
   * Express-compatible: returns { success, metrics } with flat structure
   */
  @Get('metrics')
  async getMetrics(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MetricsQueryDto,
  ) {
    const startTime = Date.now();
    try {
      const nestMetrics =
        await this.telemetryQueryService.getPerformanceMetrics(query);

      this.logger.log(
        `Performance metrics calculated in ${Date.now() - startTime}ms`,
        {
          userId: user.id,
          totalSpans: nestMetrics.basic.totalSpans,
        },
      );

      const metrics = this.mapMetricsToExpressFormat(
        nestMetrics,
        query.timeframe || '1h',
      );
      return { success: true, metrics };
    } catch (error) {
      this.logger.error('Metrics retrieval failed', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
        duration: Date.now() - startTime,
      });
      throw new HttpException(
        'Failed to retrieve metrics',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * GET /telemetry/dependencies - Service dependency graph
   * Express-compatible: returns { success, services, dependencies } at top level
   */
  @Get('dependencies')
  async getServiceDependencies(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MetricsQueryDto,
  ) {
    const startTime = Date.now();
    try {
      const deps =
        await this.telemetryQueryService.getServiceDependencies(query);

      this.logger.log(
        `Service dependencies calculated in ${Date.now() - startTime}ms`,
        {
          userId: user.id,
          services: deps.length,
        },
      );

      const services = [
        ...new Set(
          deps.flatMap((d) => [d.service, ...d.calledBy.map((c) => c.service)]),
        ),
      ].map((id) => ({ id, name: id }));
      const dependencies = deps.flatMap((d) =>
        d.calledBy.map((c) => ({
          source: c.service,
          target: d.service,
          call_count: c.count,
          error_rate: 0,
        })),
      );

      return { success: true, services, dependencies };
    } catch (error) {
      this.logger.error('Service dependencies retrieval failed', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
        duration: Date.now() - startTime,
      });
      throw new HttpException(
        'Failed to retrieve service dependencies',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * GET /telemetry/enrichment/stats - Enrichment statistics
   * Express-compatible: returns { success, enrichment_stats }
   */
  @Get('enrichment/stats')
  async getEnrichmentStats(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MetricsQueryDto,
  ) {
    const startTime = Date.now();
    try {
      const stats = await this.telemetryQueryService.getEnrichmentStats(query);

      this.logger.log(
        `Enrichment stats retrieved in ${Date.now() - startTime}ms`,
        {
          userId: user.id,
          coverage: Math.round(stats.coverage * 100) + '%',
        },
      );

      return { success: true, enrichment_stats: stats };
    } catch (error) {
      this.logger.error('Enrichment stats retrieval failed', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
        duration: Date.now() - startTime,
      });
      throw new HttpException(
        'Failed to retrieve enrichment stats',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * GET /telemetry/enrichment/spans - Enriched spans
   * Express-compatible: returns { success, enriched_spans, count }
   */
  @Get('enrichment/spans')
  async getEnrichedSpans(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: EnrichedSpansQueryDto,
  ) {
    const startTime = Date.now();
    try {
      const spans = await this.telemetryQueryService.getEnrichedSpans(query);

      this.logger.log(
        `Enriched spans retrieved in ${Date.now() - startTime}ms`,
        {
          userId: user.id,
          count: spans.length,
        },
      );

      return { success: true, enriched_spans: spans, count: spans.length };
    } catch (error) {
      this.logger.error('Enriched spans retrieval failed', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
        duration: Date.now() - startTime,
      });
      throw new HttpException(
        'Failed to retrieve enriched spans',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * GET /telemetry/enrichment/health - Processor health
   */
  @Get('enrichment/health')
  @Public()
  getProcessorHealth() {
    try {
      const health = this.telemetryQueryService.getProcessorHealth();
      this.logger.log('Processor health check completed');
      return { success: true, data: health };
    } catch (error) {
      this.logger.error('Processor health check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        'Processor health check failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * GET /telemetry/enrichment/trigger - Trigger enrichment
   */
  @Get('enrichment/trigger')
  async triggerEnrichment(@CurrentUser() user: AuthenticatedUser) {
    const startTime = Date.now();
    try {
      const result = await this.telemetryQueryService.triggerEnrichment();

      this.logger.log(`Enrichment triggered in ${Date.now() - startTime}ms`, {
        userId: user.id,
        processed: result.processed,
        enriched: result.enriched,
      });

      return { success: true, data: result };
    } catch (error) {
      this.logger.error('Enrichment trigger failed', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
        duration: Date.now() - startTime,
      });
      throw new HttpException(
        'Failed to trigger enrichment',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * GET /telemetry/dashboard/enhanced - Enhanced dashboard with AI recommendations
   * Express-compatible: returns { success, enhanced_dashboard }
   */
  @Get('dashboard/enhanced')
  async getEnhancedDashboard(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: { tenant_id?: string; workspace_id?: string },
  ) {
    const startTime = Date.now();
    try {
      const result = await this.telemetryQueryService.getEnhancedDashboard({
        tenant_id: query.tenant_id,
        workspace_id: query.workspace_id || user.workspaceId,
      });

      this.logger.log(
        `Enhanced dashboard retrieved in ${Date.now() - startTime}ms`,
        {
          userId: user.id,
          recommendations: result.recommendations.length,
        },
      );

      return { success: true, enhanced_dashboard: result };
    } catch (error) {
      this.logger.error('Enhanced dashboard retrieval failed', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
        duration: Date.now() - startTime,
      });
      throw new HttpException(
        'Failed to retrieve enhanced dashboard',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * GET /telemetry/stream - SSE streaming endpoint for real-time cost telemetry
   */
  @Get('stream')
  streamTelemetry(
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: AuthenticatedUser,
    @Query()
    query: {
      eventTypes?: string;
      minCost?: string;
      operations?: string;
    },
  ) {
    try {
      // Parse query parameters
      const filters = {
        eventTypes: query.eventTypes?.split(','),
        minCost: query.minCost ? parseFloat(query.minCost) : undefined,
        operations: query.operations?.split(','),
      };

      // Register client for streaming
      this.costStreamingService.registerClient(
        generateSecureId('client'),
        res,
        user.id,
        user.workspaceId,
        filters,
      );

      // Log streaming connection
      this.logger.log('Client connected to telemetry stream', {
        userId: user.id,
        filters,
      });

      // Note: Don't return anything - the response is handled by SSE
    } catch (error) {
      this.logger.error('Failed to establish telemetry stream', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
      });
      throw new HttpException(
        'Failed to establish stream',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Map Nest PerformanceMetrics to Express flat format
   */
  private mapMetricsToExpressFormat(
    m: {
      basic: {
        totalSpans: number;
        totalCost: number;
        averageLatency: number;
        errorRate: number;
        p95Latency: number;
        p99Latency: number;
      };
      percentiles?: { p50: number; p95: number; p99: number };
      operations: Array<{
        operation: string;
        count: number;
        avgDuration: number;
        avgCost: number;
        errorRate?: number;
      }>;
      errors: Array<{
        operation: string;
        error_type: string;
        count: number;
        avgDuration?: number;
      }>;
      models: Array<{
        model: string;
        count: number;
        avgCost: number;
        avgDuration?: number;
      }>;
    },
    timeframe: string,
  ): Record<string, unknown> {
    const b = m.basic;
    const total = b.totalSpans || 0;
    const totalErrors = Math.round((b.errorRate || 0) * total);
    const p: { p50?: number; p95?: number; p99?: number } = m.percentiles ?? {};
    const timeframeMs =
      timeframe === '1h' ? 3600000 : timeframe === '24h' ? 86400000 : 3600000;
    const rpm = total > 0 ? total / (timeframeMs / 60000) : 0;

    return {
      timeframe,
      start_time: new Date(Date.now() - timeframeMs),
      end_time: new Date(),
      total_requests: total,
      total_errors: totalErrors,
      error_rate: total > 0 ? (totalErrors / total) * 100 : 0,
      avg_duration_ms: b.averageLatency || 0,
      p50_duration_ms: p.p50 || b.averageLatency || 0,
      p95_duration_ms: b.p95Latency || p.p95 || 0,
      p99_duration_ms: b.p99Latency || p.p99 || 0,
      total_cost_usd: b.totalCost || 0,
      avg_cost_usd: total > 0 ? (b.totalCost || 0) / total : 0,
      total_tokens: 0,
      avg_tokens: 0,
      requests_per_minute: rpm,
      top_operations: (m.operations || []).map((o) => ({
        name: o.operation,
        count: o.count,
        avg_duration_ms: o.avgDuration || 0,
        error_rate: (o.errorRate || 0) * 100,
      })),
      top_errors: (m.errors || []).map((e) => ({
        type: e.error_type || 'Unknown',
        count: e.count,
        latest_occurrence: new Date(),
      })),
      cost_by_model: (m.models || []).map((mod) => ({
        model: mod.model,
        total_cost: (mod.avgCost || 0) * (mod.count || 0),
        request_count: mod.count || 0,
      })),
    };
  }

  /**
   * Map Nest TelemetryDashboardData to Express dashboard shape
   */
  private mapDashboardToExpressFormat(d: {
    totalSpans: number;
    totalCost: number;
    averageLatency: number;
    errorRate: number;
    topOperations: Array<{
      operation?: string;
      count?: number;
      avgDuration?: number;
      avgCost?: number;
    }>;
    recentErrors: unknown[];
    costTrends?: unknown[];
    performanceTrends?: unknown[];
  }): Record<string, unknown> {
    const rpm = d.totalSpans > 0 ? d.totalSpans / 60 : 0;
    const topOps = (d.topOperations || []).map((o) => ({
      name: o.operation ?? 'unknown',
      count: o.count ?? 0,
      avg_duration_ms: o.avgDuration ?? 0,
      avg_cost: o.avgCost ?? 0,
    }));
    return {
      current: {
        requests_per_minute: rpm,
        error_rate: (d.errorRate || 0) * 100,
        avg_latency_ms: d.averageLatency || 0,
        p95_latency_ms: d.averageLatency || 0,
      },
      trends: {
        last_5_minutes: {
          requests_per_minute: rpm,
          error_rate: d.errorRate,
          avg_duration_ms: d.averageLatency,
          p95_duration_ms: d.averageLatency,
        },
        last_hour: {
          requests_per_minute: rpm,
          error_rate: d.errorRate,
          avg_duration_ms: d.averageLatency,
          p95_duration_ms: d.averageLatency,
          top_operations: topOps,
          cost_by_model: [],
        },
        last_24_hours: {
          requests_per_minute: rpm,
          error_rate: d.errorRate,
          avg_duration_ms: d.averageLatency,
          p95_duration_ms: d.averageLatency,
        },
      },
      service_map: [],
      recent_errors: d.recentErrors || [],
      high_cost_operations: topOps.slice(0, 5),
      top_operations: topOps,
      cost_by_model: [],
    };
  }
}
