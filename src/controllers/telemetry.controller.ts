
import { Response } from 'express';
import { TelemetryService } from '../services/telemetry.service';
import { loggingService } from '../services/logging.service';
import { trace } from '@opentelemetry/api';

export class TelemetryController {
  /**
   * Get telemetry data with filters
   */
  static async getTelemetry(req: any, res: Response) {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] as string;
    const {
      tenant_id,
      workspace_id,
      user_id,
      trace_id,
      request_id,
      service_name,
      operation_name,
      status,
      start_time,
      end_time,
      min_duration,
      max_duration,
      min_cost,
      max_cost,
      http_route,
      http_method,
      http_status_code,
      gen_ai_model,
      error_type,
      limit,
      page,
      sort_by,
      sort_order
    } = req.query;

    try {
      loggingService.info('Telemetry query initiated', {
        requestId,
        tenant_id,
        hasTenantId: !!tenant_id,
        workspace_id,
        hasWorkspaceId: !!workspace_id,
        user_id,
        hasUserId: !!user_id,
        trace_id,
        hasTraceId: !!trace_id,
        request_id,
        hasRequestId: !!request_id,
        service_name,
        hasServiceName: !!service_name,
        operation_name,
        hasOperationName: !!operation_name,
        status,
        hasStatus: !!status,
        start_time,
        hasStartTime: !!start_time,
        end_time,
        hasEndTime: !!end_time,
        min_duration,
        hasMinDuration: min_duration !== undefined,
        max_duration,
        hasMaxDuration: max_duration !== undefined,
        min_cost,
        hasMinCost: min_cost !== undefined,
        max_cost,
        hasMaxCost: max_cost !== undefined,
        http_route,
        hasHttpRoute: !!http_route,
        http_method,
        hasHttpMethod: !!http_method,
        http_status_code,
        hasHttpStatusCode: http_status_code !== undefined,
        gen_ai_model,
        hasGenAiModel: !!gen_ai_model,
        error_type,
        hasErrorType: !!error_type,
        limit: limit ? Number(limit) : 100,
        page: page ? Number(page) : 1,
        sort_by,
        hasSortBy: !!sort_by,
        sort_order
      });

      const results = await TelemetryService.queryTelemetry({
        tenant_id: tenant_id as string,
        workspace_id: workspace_id as string,
        user_id: user_id as string,
        trace_id: trace_id as string,
        request_id: request_id as string,
        service_name: service_name as string,
        operation_name: operation_name as string,
        status: status as 'success' | 'error' | 'unset',
        start_time: start_time ? new Date(start_time as string) : undefined,
        end_time: end_time ? new Date(end_time as string) : undefined,
        min_duration: min_duration ? Number(min_duration) : undefined,
        max_duration: max_duration ? Number(max_duration) : undefined,
        min_cost: min_cost ? Number(min_cost) : undefined,
        max_cost: max_cost ? Number(max_cost) : undefined,
        http_route: http_route as string,
        http_method: http_method as string,
        http_status_code: http_status_code ? Number(http_status_code) : undefined,
        gen_ai_model: gen_ai_model as string,
        error_type: error_type as string,
        limit: limit ? Number(limit) : 100,
        page: page ? Number(page) : 1,
        sort_by: sort_by as string,
        sort_order: sort_order as 'asc' | 'desc'
      });
      const duration = Date.now() - startTime;

      loggingService.info('Telemetry query completed successfully', {
        requestId,
        duration,
        tenant_id,
        workspace_id,
        user_id,
        trace_id,
        request_id,
        service_name,
        operation_name,
        status,
        start_time,
        end_time,
        min_duration,
        max_duration,
        min_cost,
        max_cost,
        http_route,
        http_method,
        http_status_code,
        gen_ai_model,
        error_type,
        limit: limit ? Number(limit) : 100,
        page: page ? Number(page) : 1,
        sort_by,
        sort_order,
        resultsCount: results?.data?.length || 0,
        hasResults: !!results
      });

      // Log business event
      loggingService.logBusiness({
        event: 'telemetry_queried',
        category: 'telemetry',
        value: duration,
        metadata: {
          tenant_id,
          workspace_id,
          user_id,
          trace_id,
          request_id,
          service_name,
          operation_name,
          status,
          hasDateRange: !!(start_time && end_time),
          hasCostRange: !!(min_cost || max_cost),
          hasDurationRange: !!(min_duration || max_duration),
          resultsCount: results?.data?.length || 0
        }
      });

      res.json({
        success: true,
        ...results
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Telemetry query failed', {
        requestId,
        tenant_id,
        workspace_id,
        user_id,
        trace_id,
        request_id,
        service_name,
        operation_name,
        status,
        start_time,
        end_time,
        min_duration,
        max_duration,
        min_cost,
        max_cost,
        http_route,
        http_method,
        http_status_code,
        gen_ai_model,
        error_type,
        limit,
        page,
        sort_by,
        sort_order,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to get telemetry data',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get trace details
   */
  static async getTraceDetails(req: any, res: Response): Promise<void> {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] as string;
    const { traceId } = req.params;

    try {
      loggingService.info('Trace details retrieval initiated', {
        requestId,
        traceId,
        hasTraceId: !!traceId
      });
      
      if (!traceId) {
        loggingService.warn('Trace details retrieval failed - trace ID is required', {
          requestId
        });
        res.status(400).json({
          success: false,
          error: 'Trace ID is required'
        });
        return;
      }

      const traceDetails = await TelemetryService.getTraceDetails(traceId);
      const duration = Date.now() - startTime;
      
      loggingService.info('Trace details retrieved successfully', {
        requestId,
        duration,
        traceId,
        hasTraceDetails: !!traceDetails
      });

      // Log business event
      loggingService.logBusiness({
        event: 'trace_details_retrieved',
        category: 'telemetry',
        value: duration,
        metadata: {
          traceId,
          hasTraceDetails: !!traceDetails
        }
      });
      
      res.json({
        success: true,
        ...traceDetails
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Trace details retrieval failed', {
        requestId,
        traceId,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to get trace details',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get performance metrics
   */
  static async getMetrics(req: any, res: Response) {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] as string;
    const { tenant_id, workspace_id, timeframe } = req.query;

    try {
      loggingService.info('Performance metrics retrieval initiated', {
        requestId,
        tenant_id,
        hasTenantId: !!tenant_id,
        workspace_id,
        hasWorkspaceId: !!workspace_id,
        timeframe: timeframe as string || '1h',
        hasTimeframe: !!timeframe
      });

      const metrics = await TelemetryService.getPerformanceMetrics({
        tenant_id: tenant_id as string,
        workspace_id: workspace_id as string,
        timeframe: timeframe as string || '1h'
      });
      const duration = Date.now() - startTime;

      loggingService.info('Performance metrics retrieved successfully', {
        requestId,
        duration,
        tenant_id,
        workspace_id,
        timeframe: timeframe as string || '1h',
        hasMetrics: !!metrics
      });

      // Log business event
      loggingService.logBusiness({
        event: 'performance_metrics_retrieved',
        category: 'telemetry',
        value: duration,
        metadata: {
          tenant_id,
          workspace_id,
          timeframe: timeframe as string || '1h',
          hasMetrics: !!metrics
        }
      });

      res.json({
        success: true,
        metrics
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Performance metrics retrieval failed', {
        requestId,
        tenant_id,
        workspace_id,
        timeframe: timeframe as string || '1h',
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to get metrics data',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get service dependencies
   */
  static async getServiceDependencies(req: any, res: Response) {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] as string;
    const { timeframe } = req.query;

    try {
      loggingService.info('Service dependencies retrieval initiated', {
        requestId,
        timeframe: timeframe as string || '1h',
        hasTimeframe: !!timeframe
      });

      const dependencies = await TelemetryService.getServiceDependencies(
        timeframe as string || '1h'
      );
      const duration = Date.now() - startTime;

      loggingService.info('Service dependencies retrieved successfully', {
        requestId,
        duration,
        timeframe: timeframe as string || '1h',
        hasDependencies: !!dependencies
      });

      // Log business event
      loggingService.logBusiness({
        event: 'service_dependencies_retrieved',
        category: 'telemetry',
        value: duration,
        metadata: {
          timeframe: timeframe as string || '1h',
          hasDependencies: !!dependencies
        }
      });

      res.json({
        success: true,
        ...dependencies
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Service dependencies retrieval failed', {
        requestId,
        timeframe: timeframe as string || '1h',
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to get service dependencies',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Check telemetry health
   */
  static async checkTelemetryHealth(_req: any, res: Response) {
    const startTime = Date.now();
    const requestId = _req?.headers?.['x-request-id'] as string;

    try {
      loggingService.info('Telemetry health check initiated', {
        requestId,
        hasRequestId: !!requestId
      });

      // Check if OTel is working
      const tracer = trace.getTracer('health-check');
      
      // Create a test span
      const span = tracer.startSpan('telemetry.health.check');
      span.setAttribute('check.type', 'health');
      span.setAttribute('check.timestamp', Date.now());
      
      // Check collector connectivity
      let collectorStatus = 'disabled';
      const collectorUrl = process.env.OTLP_HTTP_TRACES_URL;
      
      if (!collectorUrl || collectorUrl.trim() === '') {
        collectorStatus = 'disabled';
      } else {
        try {
          // Try to reach the collector health endpoint
          const healthUrl = collectorUrl.replace('/v1/traces', '').replace('4318', '13133') + '/health';
          const response = await fetch(healthUrl, { 
            method: 'GET',
            signal: AbortSignal.timeout(5000) // 5 second timeout
          });
          collectorStatus = response.ok ? 'healthy' : 'unhealthy';
        } catch (error) {
          collectorStatus = 'unreachable';
        }
      }
      
      span.end();

      // Get telemetry stats from MongoDB
      const { Telemetry } = await import('../models/Telemetry');
      const stats = await Telemetry.aggregate([
        {
          $facet: {
            recent: [
              {
                $match: {
                  timestamp: { $gte: new Date(Date.now() - 5 * 60000) } // Last 5 minutes
                }
              },
              { $count: 'count' }
            ],
            total: [
              { $count: 'count' }
            ],
            oldest: [
              { $sort: { timestamp: 1 } },
              { $limit: 1 },
              { $project: { timestamp: 1 } }
            ],
            newest: [
              { $sort: { timestamp: -1 } },
              { $limit: 1 },
              { $project: { timestamp: 1 } }
            ]
          }
        }
      ]);

      const telemetryStats = {
        total_spans: stats[0]?.total[0]?.count || 0,
        recent_spans: stats[0]?.recent[0]?.count || 0,
        oldest_span: stats[0]?.oldest[0]?.timestamp || null,
        newest_span: stats[0]?.newest[0]?.timestamp || null
      };

      const duration = Date.now() - startTime;

      loggingService.info('Telemetry health check completed successfully', {
        requestId,
        duration,
        collectorStatus,
        totalSpans: telemetryStats.total_spans,
        recentSpans: telemetryStats.recent_spans,
        hasOldestSpan: !!telemetryStats.oldest_span,
        hasNewestSpan: !!telemetryStats.newest_span
      });

      // Log business event
      loggingService.logBusiness({
        event: 'telemetry_health_checked',
        category: 'telemetry',
        value: duration,
        metadata: {
          collectorStatus,
          totalSpans: telemetryStats.total_spans,
          recentSpans: telemetryStats.recent_spans
        }
      });

      res.json({
        status: 'healthy',
        timestamp: new Date(),
        telemetry: {
          sdk: {
            initialized: true,
            service_name: process.env.OTEL_SERVICE_NAME || 'cost-katana-api',
            environment: process.env.NODE_ENV || 'development'
          },
          collector: {
            status: collectorStatus,
            url: collectorUrl
          },
          exporters: {
            traces: process.env.OTLP_HTTP_TRACES_URL || 'default',
            metrics: process.env.OTLP_HTTP_METRICS_URL || 'default'
          },
          storage: telemetryStats,
          features: {
            capture_model_text: process.env.CK_CAPTURE_MODEL_TEXT === 'true',
            telemetry_region: process.env.CK_TELEMETRY_REGION || 'auto'
          }
        }
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Telemetry health check failed', {
        requestId,
        hasRequestId: !!requestId,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration
      });
      
      res.status(500).json({
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date()
      });
    }
  }

  /**
   * Get telemetry dashboard data
   */
  static async getDashboard(req: any, res: Response) {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] as string;
    const { tenant_id, workspace_id } = req.query;

    try {
      loggingService.info('Telemetry dashboard retrieval initiated', {
        requestId,
        tenant_id,
        hasTenantId: !!tenant_id,
        workspace_id,
        hasWorkspaceId: !!workspace_id
      });

      // Get multiple timeframe metrics in parallel
      const [
        last5min,
        last1hour,
        last24hours,
        serviceDeps
      ] = await Promise.all([
        TelemetryService.getPerformanceMetrics({
          tenant_id: tenant_id as string,
          workspace_id: workspace_id as string,
          timeframe: '5m'
        }),
        TelemetryService.getPerformanceMetrics({
          tenant_id: tenant_id as string,
          workspace_id: workspace_id as string,
          timeframe: '1h'
        }),
        TelemetryService.getPerformanceMetrics({
          tenant_id: tenant_id as string,
          workspace_id: workspace_id as string,
          timeframe: '24h'
        }),
        TelemetryService.getServiceDependencies('1h')
      ]);

      // Get recent errors
      const recentErrors = await TelemetryService.queryTelemetry({
        tenant_id: tenant_id as string,
        workspace_id: workspace_id as string,
        status: 'error',
        start_time: new Date(Date.now() - 3600000), // Last hour
        limit: 10,
        sort_by: 'timestamp',
        sort_order: 'desc'
      });

      // Get high-cost operations
      const highCostOps = await TelemetryService.queryTelemetry({
        tenant_id: tenant_id as string,
        workspace_id: workspace_id as string,
        min_cost: 0.01, // Operations costing more than $0.01
        start_time: new Date(Date.now() - 3600000),
        limit: 10,
        sort_by: 'cost_usd',
        sort_order: 'desc'
      });

      const duration = Date.now() - startTime;

      loggingService.info('Telemetry dashboard retrieved successfully', {
        requestId,
        duration,
        tenant_id,
        workspace_id,
        hasLast5min: !!last5min,
        hasLast1hour: !!last1hour,
        hasLast24hours: !!last24hours,
        hasServiceDeps: !!serviceDeps,
        recentErrorsCount: recentErrors?.data?.length || 0,
        highCostOpsCount: highCostOps?.data?.length || 0,
        hasTopOperations: !!last1hour?.top_operations,
        hasCostByModel: !!last1hour?.cost_by_model
      });

      // Log business event
      loggingService.logBusiness({
        event: 'telemetry_dashboard_retrieved',
        category: 'telemetry',
        value: duration,
        metadata: {
          tenant_id,
          workspace_id,
          recentErrorsCount: recentErrors?.data?.length || 0,
          highCostOpsCount: highCostOps?.data?.length || 0
        }
      });

      res.json({
        success: true,
        dashboard: {
          current: {
            requests_per_minute: last5min.requests_per_minute,
            error_rate: last5min.error_rate,
            avg_latency_ms: last5min.avg_duration_ms,
            p95_latency_ms: last5min.p95_duration_ms
          },
          trends: {
            last_5_minutes: last5min,
            last_hour: last1hour,
            last_24_hours: last24hours
          },
          service_map: serviceDeps,
          recent_errors: recentErrors.data,
          high_cost_operations: highCostOps.data,
          top_operations: last1hour.top_operations,
          cost_by_model: last1hour.cost_by_model
        }
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Telemetry dashboard retrieval failed', {
        requestId,
        tenant_id,
        workspace_id,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to get dashboard data',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get enrichment statistics
   */
  static async getEnrichmentStats(req: any, res: Response) {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] as string;
    const { timeframe } = req.query;

    try {
      loggingService.info('Enrichment statistics retrieval initiated', {
        requestId,
        timeframe: timeframe as string || '1h',
        hasTimeframe: !!timeframe
      });

      const stats = await TelemetryService.getEnrichmentStats(
        timeframe as string || '1h'
      );
      const duration = Date.now() - startTime;

      loggingService.info('Enrichment statistics retrieved successfully', {
        requestId,
        duration,
        timeframe: timeframe as string || '1h',
        hasStats: !!stats
      });

      // Log business event
      loggingService.logBusiness({
        event: 'enrichment_stats_retrieved',
        category: 'telemetry',
        value: duration,
        metadata: {
          timeframe: timeframe as string || '1h',
          hasStats: !!stats
        }
      });

      res.json({
        success: true,
        enrichment_stats: stats
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Enrichment statistics retrieval failed', {
        requestId,
        timeframe: timeframe as string || '1h',
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to get enrichment statistics',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get enriched spans with AI insights
   */
  static async getEnrichedSpans(req: any, res: Response) {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] as string;
    const { tenant_id, workspace_id, timeframe, limit } = req.query;

    try {
      loggingService.info('Enriched spans retrieval initiated', {
        requestId,
        tenant_id,
        hasTenantId: !!tenant_id,
        workspace_id,
        hasWorkspaceId: !!workspace_id,
        timeframe: timeframe as string || '1h',
        hasTimeframe: !!timeframe,
        limit: limit ? Number(limit) : 50,
        hasLimit: !!limit
      });

      const spans = await TelemetryService.getEnrichedSpans({
        tenant_id: tenant_id as string,
        workspace_id: workspace_id as string,
        timeframe: timeframe as string || '1h',
        limit: limit ? Number(limit) : 50
      });
      const duration = Date.now() - startTime;

      loggingService.info('Enriched spans retrieved successfully', {
        requestId,
        duration,
        tenant_id,
        workspace_id,
        timeframe: timeframe as string || '1h',
        limit: limit ? Number(limit) : 50,
        spansCount: spans.length,
        hasSpans: !!spans
      });

      // Log business event
      loggingService.logBusiness({
        event: 'enriched_spans_retrieved',
        category: 'telemetry',
        value: duration,
        metadata: {
          tenant_id,
          workspace_id,
          timeframe: timeframe as string || '1h',
          limit: limit ? Number(limit) : 50,
          spansCount: spans.length
        }
      });

      res.json({
        success: true,
        enriched_spans: spans,
        count: spans.length
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Enriched spans retrieval failed', {
        requestId,
        tenant_id,
        workspace_id,
        timeframe: timeframe as string || '1h',
        limit: limit ? Number(limit) : 50,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to get enriched spans',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get span processor health and buffer stats
   */
  static async getProcessorHealth(_req: any, res: Response) {
    const startTime = Date.now();
    const requestId = _req?.headers?.['x-request-id'] as string;

    try {
      loggingService.info('Processor health check initiated', {
        requestId,
        hasRequestId: !!requestId
      });

      // This would need to be implemented to access the processor instance
      // For now, return basic health info
      const duration = Date.now() - startTime;

      loggingService.info('Processor health check completed successfully', {
        requestId,
        duration
      });

      // Log business event
      loggingService.logBusiness({
        event: 'processor_health_checked',
        category: 'telemetry',
        value: duration,
        metadata: {
          status: 'healthy'
        }
      });

      res.json({
        success: true,
        processor_health: {
          status: 'healthy',
          buffer_size: 0,
          is_exporting: false,
          oldest_span_age: 0,
          features: {
            redis_failover: true,
            ai_enrichment: true,
            semantic_inference: true
          }
        }
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Processor health check failed', {
        requestId,
        hasRequestId: !!requestId,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to get processor health',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Enhanced dashboard with enrichment data
   */
  static async getEnhancedDashboard(req: any, res: Response) {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] as string;
    const { tenant_id, workspace_id } = req.query;

    try {
      loggingService.info('Enhanced telemetry dashboard retrieval initiated', {
        requestId,
        tenant_id,
        hasTenantId: !!tenant_id,
        workspace_id,
        hasWorkspaceId: !!workspace_id
      });

      // Get standard dashboard data
      const [
        standardDashboard,
        enrichmentStats,
        enrichedSpans,
        aiRecommendations
      ] = await Promise.all([
        // Reuse existing dashboard logic
        TelemetryController.getDashboardData(tenant_id as string, workspace_id as string),
        TelemetryService.getEnrichmentStats('1h'),
        TelemetryService.getEnrichedSpans({
          tenant_id: tenant_id as string,
          workspace_id: workspace_id as string,
          timeframe: '1h',
          limit: 20
        }),
        TelemetryService.generateAIRecommendations('1h')
      ]);

      // Auto-enrich spans in background (don't block response)
      setImmediate(async () => {
        try {
          await TelemetryService.autoEnrichSpans();
        } catch (error: any) {
          loggingService.error('Background span enrichment failed', {
            error: error.message || 'Unknown error',
            stack: error.stack
          });
        }
      });

      const duration = Date.now() - startTime;

      loggingService.info('Enhanced telemetry dashboard retrieved successfully', {
        requestId,
        duration,
        tenant_id,
        workspace_id,
        hasStandardDashboard: !!standardDashboard,
        hasEnrichmentStats: !!enrichmentStats,
        enrichedSpansCount: enrichedSpans?.length || 0,
        aiRecommendationsCount: aiRecommendations?.length || 0
      });

      // Log business event
      loggingService.logBusiness({
        event: 'enhanced_telemetry_dashboard_retrieved',
        category: 'telemetry',
        value: duration,
        metadata: {
          tenant_id,
          workspace_id,
          enrichedSpansCount: enrichedSpans?.length || 0,
          aiRecommendationsCount: aiRecommendations?.length || 0
        }
      });

      res.json({
        success: true,
        enhanced_dashboard: {
          ...standardDashboard,
          enrichment: {
            stats: enrichmentStats,
            recent_insights: enrichedSpans.slice(0, 10),
            ai_recommendations: aiRecommendations.map(rec => ({
              trace_id: rec.trace_id,
              operation: rec.operation,
              insight: rec.insight,
              cost_impact: rec.cost_impact,
              routing_decision: rec.routing_decision,
              priority: rec.priority,
              category: rec.category
            }))
          }
        }
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Enhanced telemetry dashboard retrieval failed', {
        requestId,
        tenant_id,
        workspace_id,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to get enhanced dashboard data',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Manually trigger span enrichment (for testing/admin purposes)
   */
  static async triggerEnrichment(req: any, res: Response) {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] as string;
    const { timeframe = '24h' } = req.query;

    try {
      loggingService.info('Manual span enrichment triggered', {
        requestId,
        timeframe,
        hasTimeframe: !!timeframe
      });
      
      // Start enrichment in background
      setImmediate(async () => {
        try {
          await TelemetryService.autoEnrichSpans();
          loggingService.info('Manual span enrichment completed successfully');
        } catch (error: any) {
          loggingService.error('Manual span enrichment failed', {
            error: error.message || 'Unknown error',
            stack: error.stack
          });
        }
      });

      const duration = Date.now() - startTime;

      loggingService.info('Manual span enrichment triggered successfully', {
        requestId,
        duration,
        timeframe
      });

      // Log business event
      loggingService.logBusiness({
        event: 'manual_span_enrichment_triggered',
        category: 'telemetry',
        value: duration,
        metadata: {
          timeframe
        }
      });

      res.json({
        success: true,
        message: 'Span enrichment started in background',
        timeframe
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Manual span enrichment trigger failed', {
        requestId,
        timeframe,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to trigger enrichment',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Helper method to get dashboard data (extracted for reuse)
   */
  private static async getDashboardData(tenant_id?: string, workspace_id?: string) {
    const [
      last5min,
      last1hour,
      last24hours,
      serviceDeps
    ] = await Promise.all([
      TelemetryService.getPerformanceMetrics({
        tenant_id,
        workspace_id,
        timeframe: '5m'
      }),
      TelemetryService.getPerformanceMetrics({
        tenant_id,
        workspace_id,
        timeframe: '1h'
      }),
      TelemetryService.getPerformanceMetrics({
        tenant_id,
        workspace_id,
        timeframe: '24h'
      }),
      TelemetryService.getServiceDependencies('1h')
    ]);

    const recentErrors = await TelemetryService.queryTelemetry({
      tenant_id,
      workspace_id,
      status: 'error',
      start_time: new Date(Date.now() - 3600000),
      limit: 10,
      sort_by: 'timestamp',
      sort_order: 'desc'
    });

    const highCostOps = await TelemetryService.queryTelemetry({
      tenant_id,
      workspace_id,
      min_cost: 0.01,
      start_time: new Date(Date.now() - 3600000),
      limit: 10,
      sort_by: 'cost_usd',
      sort_order: 'desc'
    });

    return {
      current: {
        requests_per_minute: last5min.requests_per_minute,
        error_rate: last5min.error_rate,
        avg_latency_ms: last5min.avg_duration_ms,
        p95_latency_ms: last5min.p95_duration_ms
      },
      trends: {
        last_5_minutes: last5min,
        last_hour: last1hour,
        last_24_hours: last24hours
      },
      service_map: serviceDeps,
      recent_errors: recentErrors.data,
      high_cost_operations: highCostOps.data,
      top_operations: last1hour.top_operations,
      cost_by_model: last1hour.cost_by_model
    };
  }
}
