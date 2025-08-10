import { Request, Response } from 'express';
import { TelemetryService } from '../services/telemetry.service';
import { logger } from '../utils/logger';
import { trace } from '@opentelemetry/api';

export class TelemetryController {
  /**
   * Get telemetry data with filters
   */
  static async getTelemetry(req: Request, res: Response) {
    try {
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

      res.json({
        success: true,
        ...results
      });
    } catch (error) {
      logger.error('Failed to get telemetry:', error);
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
  static async getTraceDetails(req: Request, res: Response): Promise<void> {
    try {
      const { traceId } = req.params;
      
      if (!traceId) {
        res.status(400).json({
          success: false,
          error: 'Trace ID is required'
        });
        return;
      }

      const traceDetails = await TelemetryService.getTraceDetails(traceId);
      
      res.json({
        success: true,
        ...traceDetails
      });
    } catch (error) {
      logger.error('Failed to get trace details:', error);
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
  static async getMetrics(req: Request, res: Response) {
    try {
      const { tenant_id, workspace_id, timeframe } = req.query;

      const metrics = await TelemetryService.getPerformanceMetrics({
        tenant_id: tenant_id as string,
        workspace_id: workspace_id as string,
        timeframe: timeframe as string || '1h'
      });

      res.json({
        success: true,
        metrics
      });
    } catch (error) {
      logger.error('Failed to get metrics:', error);
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
  static async getServiceDependencies(req: Request, res: Response) {
    try {
      const { timeframe } = req.query;

      const dependencies = await TelemetryService.getServiceDependencies(
        timeframe as string || '1h'
      );

      res.json({
        success: true,
        ...dependencies
      });
    } catch (error) {
      logger.error('Failed to get service dependencies:', error);
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
  static async checkTelemetryHealth(_req: Request, res: Response) {
    try {
      // Check if OTel is working
      const tracer = trace.getTracer('health-check');
      
      // Create a test span
      const span = tracer.startSpan('telemetry.health.check');
      span.setAttribute('check.type', 'health');
      span.setAttribute('check.timestamp', Date.now());
      
      // Check collector connectivity
      let collectorStatus = 'unknown';
      const collectorUrl = process.env.OTLP_HTTP_TRACES_URL || 'http://localhost:4318/v1/traces';
      
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
    } catch (error) {
      logger.error('Telemetry health check failed:', error);
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
  static async getDashboard(req: Request, res: Response) {
    try {
      const { tenant_id, workspace_id } = req.query;

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
    } catch (error) {
      logger.error('Failed to get dashboard data:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get dashboard data',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}
