import { Telemetry, ITelemetry } from '../models/Telemetry';
import { context, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { logger } from '../utils/logger';
import os from 'os';

export interface TelemetryQuery {
  tenant_id?: string;
  workspace_id?: string;
  user_id?: string;
  trace_id?: string;
  request_id?: string;
  service_name?: string;
  operation_name?: string;
  status?: 'success' | 'error' | 'unset';
  start_time?: Date;
  end_time?: Date;
  min_duration?: number;
  max_duration?: number;
  min_cost?: number;
  max_cost?: number;
  http_route?: string;
  http_method?: string;
  http_status_code?: number;
  gen_ai_model?: string;
  error_type?: string;
  limit?: number;
  page?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface PerformanceMetrics {
  timeframe: string;
  start_time: Date;
  end_time: Date;
  total_requests: number;
  total_errors: number;
  error_rate: number;
  avg_duration_ms: number;
  p50_duration_ms: number;
  p95_duration_ms: number;
  p99_duration_ms: number;
  total_cost_usd: number;
  avg_cost_usd: number;
  total_tokens: number;
  avg_tokens: number;
  requests_per_minute: number;
  top_operations: Array<{
    name: string;
    count: number;
    avg_duration_ms: number;
    error_rate: number;
  }>;
  top_errors: Array<{
    type: string;
    count: number;
    latest_occurrence: Date;
  }>;
  cost_by_model: Array<{
    model: string;
    total_cost: number;
    request_count: number;
  }>;
}

export class TelemetryService {
  /**
   * Store telemetry data from OpenTelemetry span
   */
  static async storeFromSpan(span: any): Promise<ITelemetry | null> {
    try {
      const spanContext = span.spanContext();
      if (!spanContext) return null;

      // Get baggage from context
      const baggageEntries = context.active().getValue(Symbol.for('opentelemetry.baggage'));
      const baggage: Record<string, string> = {};
      if (baggageEntries && typeof baggageEntries === 'object') {
        const entries = (baggageEntries as any).getAllEntries ? (baggageEntries as any).getAllEntries() : [];
        entries.forEach(([key, value]: [string, any]) => {
          baggage[key] = value?.value || value;
        });
      }

      // Get system metrics
      const cpuUsage = process.cpuUsage();
      const memUsage = process.memoryUsage();
      const loadAvg = os.loadavg();

      const telemetryData: Partial<ITelemetry> = {
        // Trace identifiers
        trace_id: spanContext.traceId,
        span_id: spanContext.spanId,
        parent_span_id: span.parentSpanId,
        
        // Context from baggage
        tenant_id: baggage.tenant_id || span.attributes.tenant_id || 'unknown',
        workspace_id: baggage.workspace_id || span.attributes.workspace_id || 'unknown',
        user_id: baggage.user_id || span.attributes.user_id || 'unknown',
        request_id: baggage.request_id || span.attributes.request_id || 'unknown',
        
        // Timing
        timestamp: new Date(),
        start_time: new Date(span.startTime[0] * 1000 + span.startTime[1] / 1000000),
        end_time: new Date(span.endTime[0] * 1000 + span.endTime[1] / 1000000),
        duration_ms: span.duration[0] * 1000 + span.duration[1] / 1000000,
        
        // Service info
        service_name: span.resource?.attributes?.['service.name'] || 'cost-katana-api',
        operation_name: span.name,
        span_kind: this.mapSpanKind(span.kind) as 'server' | 'client' | 'producer' | 'consumer' | 'internal',
        
        // Status
        status: this.mapSpanStatus(span.status?.code) as 'success' | 'error' | 'unset',
        status_message: span.status?.message,
        
        // HTTP attributes
        http_route: span.attributes['http.route'],
        http_method: span.attributes['http.method'],
        http_status_code: span.attributes['http.status_code'],
        http_url: span.attributes['http.url'],
        http_target: span.attributes['http.target'],
        http_host: span.attributes['http.host'],
        http_scheme: span.attributes['http.scheme'],
        http_user_agent: span.attributes['http.user_agent'],
        
        // Error details
        error_type: span.attributes['error.type'],
        error_message: span.attributes['error.message'],
        error_stack: span.attributes['error.stack'],
        
        // GenAI attributes
        gen_ai_system: span.attributes['gen_ai.system'],
        gen_ai_model: span.attributes['gen_ai.request.model'],
        gen_ai_operation: span.attributes['gen_ai.operation.name'],
        prompt_tokens: span.attributes['gen_ai.usage.prompt_tokens'],
        completion_tokens: span.attributes['gen_ai.usage.completion_tokens'],
        total_tokens: span.attributes['gen_ai.usage.total_tokens'],
        cost_usd: span.attributes['costkatana.cost.usd'],
        temperature: span.attributes['gen_ai.request.temperature'],
        max_tokens: span.attributes['gen_ai.request.max_tokens'],
        
        // Performance metrics
        database_latency_ms: span.attributes['db.latency_ms'],
        cache_latency_ms: span.attributes['cache.latency_ms'],
        external_api_latency_ms: span.attributes['http.latency_ms'],
        processing_latency_ms: span.attributes['processing.latency_ms'],
        queue_wait_ms: span.attributes['queue.wait_ms'],
        
        // Database operations
        db_system: span.attributes['db.system'],
        db_operation: span.attributes['db.operation'],
        db_name: span.attributes['db.name'],
        db_collection: span.attributes['db.mongodb.collection'],
        db_statement: span.attributes['db.statement'],
        
        // System metrics
        system_cpu_usage: (cpuUsage.user + cpuUsage.system) / 1000000, // Convert to seconds
        system_memory_usage: memUsage.heapUsed / (1024 * 1024), // Convert to MB
        system_memory_available: memUsage.heapTotal / (1024 * 1024), // Convert to MB
        system_load_average: loadAvg,
        
        // Network metrics
        net_peer_ip: span.attributes['net.peer.ip'],
        net_peer_port: span.attributes['net.peer.port'],
        net_host_ip: span.attributes['net.host.ip'],
        net_host_port: span.attributes['net.host.port'],
        
        // Resource attributes
        resource_attributes: {
          service_version: span.resource?.attributes?.['service.version'],
          deployment_environment: span.resource?.attributes?.['deployment.environment'],
          cloud_provider: span.resource?.attributes?.['cloud.provider'],
          cloud_region: span.resource?.attributes?.['cloud.region'],
          cloud_availability_zone: span.resource?.attributes?.['cloud.availability_zone'],
          host_name: span.resource?.attributes?.['host.name'],
          host_type: span.resource?.attributes?.['host.type'],
          container_id: span.resource?.attributes?.['container.id'],
          process_pid: process.pid
        },
        
        // Events
        events: span.events?.map((event: any) => ({
          name: event.name,
          timestamp: new Date(event.time[0] * 1000 + event.time[1] / 1000000),
          attributes: event.attributes
        })),
        
        // Links
        links: span.links?.map((link: any) => ({
          trace_id: link.context.traceId,
          span_id: link.context.spanId,
          attributes: link.attributes
        })),
        
        // Store remaining attributes
        attributes: this.filterCustomAttributes(span.attributes)
      };

      const telemetry = new Telemetry(telemetryData);
      await telemetry.save();
      
      return telemetry;
    } catch (error) {
      logger.error('Failed to store telemetry from span:', error);
      return null;
    }
  }

  /**
   * Store telemetry data directly
   */
  static async storeTelemetryData(data: Partial<ITelemetry>): Promise<ITelemetry> {
    try {
      const telemetry = new Telemetry(data);
      await telemetry.save();
      return telemetry;
    } catch (error) {
      logger.error('Failed to store telemetry data:', error);
      throw error;
    }
  }

  /**
   * Query telemetry data with filters
   */
  static async queryTelemetry(query: TelemetryQuery) {
    try {
      const filter: any = {};
      
      // Build filter
      if (query.tenant_id) filter.tenant_id = query.tenant_id;
      if (query.workspace_id) filter.workspace_id = query.workspace_id;
      if (query.user_id) filter.user_id = query.user_id;
      if (query.trace_id) filter.trace_id = query.trace_id;
      if (query.request_id) filter.request_id = query.request_id;
      if (query.service_name) filter.service_name = query.service_name;
      if (query.operation_name) filter.operation_name = new RegExp(query.operation_name, 'i');
      if (query.status) filter.status = query.status;
      if (query.http_route) filter.http_route = query.http_route;
      if (query.http_method) filter.http_method = query.http_method;
      if (query.http_status_code) filter.http_status_code = query.http_status_code;
      if (query.gen_ai_model) filter.gen_ai_model = query.gen_ai_model;
      if (query.error_type) filter.error_type = query.error_type;
      
      // Time range filter
      if (query.start_time || query.end_time) {
        filter.timestamp = {};
        if (query.start_time) filter.timestamp.$gte = query.start_time;
        if (query.end_time) filter.timestamp.$lte = query.end_time;
      }
      
      // Duration filter
      if (query.min_duration || query.max_duration) {
        filter.duration_ms = {};
        if (query.min_duration) filter.duration_ms.$gte = query.min_duration;
        if (query.max_duration) filter.duration_ms.$lte = query.max_duration;
      }
      
      // Cost filter
      if (query.min_cost || query.max_cost) {
        filter.cost_usd = {};
        if (query.min_cost) filter.cost_usd.$gte = query.min_cost;
        if (query.max_cost) filter.cost_usd.$lte = query.max_cost;
      }

      // Pagination
      const limit = query.limit || 100;
      const page = query.page || 1;
      const skip = (page - 1) * limit;
      
      // Sorting
      const sortField = query.sort_by || 'timestamp';
      const sortOrder = query.sort_order === 'asc' ? 1 : -1;
      const sort: any = {};
      sort[sortField] = sortOrder;

      // Execute query
      const [results, total] = await Promise.all([
        Telemetry.find(filter)
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean(),
        Telemetry.countDocuments(filter)
      ]);

      return {
        data: results,
        pagination: {
          total,
          page,
          limit,
          total_pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Failed to query telemetry:', error);
      throw error;
    }
  }

  /**
   * Get trace details (all spans in a trace)
   */
  static async getTraceDetails(traceId: string) {
    try {
      const spans = await Telemetry.find({ trace_id: traceId })
        .sort({ start_time: 1 })
        .lean();
      
      // Build trace tree
      const spanMap = new Map();
      const rootSpans: any[] = [];
      
      spans.forEach(span => {
        spanMap.set(span.span_id, { ...span, children: [] });
      });
      
      spans.forEach(span => {
        if (span.parent_span_id && spanMap.has(span.parent_span_id)) {
          spanMap.get(span.parent_span_id).children.push(spanMap.get(span.span_id));
        } else {
          rootSpans.push(spanMap.get(span.span_id));
        }
      });
      
      // Calculate trace summary
      const summary = {
        trace_id: traceId,
        total_spans: spans.length,
        total_duration_ms: rootSpans.reduce((max, span) => Math.max(max, span.duration_ms), 0),
        total_cost_usd: spans.reduce((sum, span) => sum + (span.cost_usd || 0), 0),
        total_tokens: spans.reduce((sum, span) => sum + (span.total_tokens || 0), 0),
        error_count: spans.filter(span => span.status === 'error').length,
        services: [...new Set(spans.map(span => span.service_name))],
        operations: [...new Set(spans.map(span => span.operation_name))]
      };
      
      return {
        summary,
        spans: rootSpans,
        flat_spans: spans
      };
    } catch (error) {
      logger.error('Failed to get trace details:', error);
      throw error;
    }
  }

  /**
   * Get performance metrics
   */
  static async getPerformanceMetrics({
    tenant_id,
    workspace_id,
    timeframe = '1h'
  }: {
    tenant_id?: string;
    workspace_id?: string;
    timeframe?: string;
  }): Promise<PerformanceMetrics> {
    try {
      const now = new Date();
      const start = new Date(now.getTime() - this.getTimeframeMs(timeframe));

      const matchStage: any = {
        timestamp: { $gte: start, $lte: now }
      };
      
      if (tenant_id) matchStage.tenant_id = tenant_id;
      if (workspace_id) matchStage.workspace_id = workspace_id;

      // Main aggregation pipeline
      const pipeline = [
        { $match: matchStage },
        {
          $facet: {
            // Basic metrics
            basic: [
              {
                $group: {
                  _id: null,
                  total_requests: { $sum: 1 },
                  total_errors: {
                    $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] }
                  },
                  avg_duration_ms: { $avg: '$duration_ms' },
                  total_cost_usd: { $sum: { $ifNull: ['$cost_usd', 0] } },
                  avg_cost_usd: { $avg: { $ifNull: ['$cost_usd', 0] } },
                  total_tokens: { $sum: { $ifNull: ['$total_tokens', 0] } },
                  avg_tokens: { $avg: { $ifNull: ['$total_tokens', 0] } }
                }
              }
            ],
            // Percentiles
            percentiles: [
              { $sort: { duration_ms: 1 } },
              {
                $group: {
                  _id: null,
                  durations: { $push: '$duration_ms' }
                }
              }
            ],
            // Top operations
            operations: [
              {
                $group: {
                  _id: '$operation_name',
                  count: { $sum: 1 },
                  avg_duration_ms: { $avg: '$duration_ms' },
                  error_count: {
                    $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] }
                  }
                }
              },
              { $sort: { count: -1 } },
              { $limit: 10 }
            ],
            // Top errors
            errors: [
              { $match: { status: 'error' } },
              {
                $group: {
                  _id: '$error_type',
                  count: { $sum: 1 },
                  latest_occurrence: { $max: '$timestamp' }
                }
              },
              { $sort: { count: -1 } },
              { $limit: 10 }
            ],
            // Cost by model
            models: [
              { $match: { gen_ai_model: { $exists: true } } },
              {
                $group: {
                  _id: '$gen_ai_model',
                  total_cost: { $sum: { $ifNull: ['$cost_usd', 0] } },
                  request_count: { $sum: 1 }
                }
              },
              { $sort: { total_cost: -1 } }
            ]
          }
        }
      ];

      const [result] = await Telemetry.aggregate(pipeline as any);
      
      // Calculate percentiles
      const durations = result.percentiles[0]?.durations || [];
      const p50 = this.calculatePercentile(durations, 50);
      const p95 = this.calculatePercentile(durations, 95);
      const p99 = this.calculatePercentile(durations, 99);
      
      // Calculate requests per minute
      const timeframeMinutes = this.getTimeframeMs(timeframe) / 60000;
      const rpm = result.basic[0]?.total_requests / timeframeMinutes || 0;
      
      // Format response
      const metrics: PerformanceMetrics = {
        timeframe,
        start_time: start,
        end_time: now,
        total_requests: result.basic[0]?.total_requests || 0,
        total_errors: result.basic[0]?.total_errors || 0,
        error_rate: result.basic[0]?.total_requests 
          ? (result.basic[0].total_errors / result.basic[0].total_requests) * 100 
          : 0,
        avg_duration_ms: result.basic[0]?.avg_duration_ms || 0,
        p50_duration_ms: p50,
        p95_duration_ms: p95,
        p99_duration_ms: p99,
        total_cost_usd: result.basic[0]?.total_cost_usd || 0,
        avg_cost_usd: result.basic[0]?.avg_cost_usd || 0,
        total_tokens: result.basic[0]?.total_tokens || 0,
        avg_tokens: result.basic[0]?.avg_tokens || 0,
        requests_per_minute: rpm,
        top_operations: result.operations.map((op: any) => ({
          name: op._id,
          count: op.count,
          avg_duration_ms: op.avg_duration_ms,
          error_rate: (op.error_count / op.count) * 100
        })),
        top_errors: result.errors.map((err: any) => ({
          type: err._id || 'Unknown',
          count: err.count,
          latest_occurrence: err.latest_occurrence
        })),
        cost_by_model: result.models.map((model: any) => ({
          model: model._id,
          total_cost: model.total_cost,
          request_count: model.request_count
        }))
      };
      
      return metrics;
    } catch (error) {
      logger.error('Failed to get performance metrics:', error);
      throw error;
    }
  }

  /**
   * Get service dependencies
   */
  static async getServiceDependencies(timeframe = '1h') {
    try {
      const now = new Date();
      const start = new Date(now.getTime() - this.getTimeframeMs(timeframe));

      const pipeline = [
        {
          $match: {
            timestamp: { $gte: start, $lte: now },
            parent_span_id: { $exists: true }
          }
        },
        {
          $lookup: {
            from: 'telemetries',
            localField: 'parent_span_id',
            foreignField: 'span_id',
            as: 'parent'
          }
        },
        {
          $unwind: '$parent'
        },
        {
          $group: {
            _id: {
              source: '$parent.service_name',
              target: '$service_name'
            },
            call_count: { $sum: 1 },
            avg_duration_ms: { $avg: '$duration_ms' },
            error_count: {
              $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] }
            }
          }
        },
        {
          $project: {
            _id: 0,
            source: '$_id.source',
            target: '$_id.target',
            call_count: 1,
            avg_duration_ms: 1,
            error_rate: {
              $multiply: [{ $divide: ['$error_count', '$call_count'] }, 100]
            }
          }
        }
      ];

      const dependencies = await Telemetry.aggregate(pipeline);
      
      // Get unique services
      const services = new Set<string>();
      dependencies.forEach(dep => {
        services.add(dep.source);
        services.add(dep.target);
      });
      
      return {
        services: Array.from(services),
        dependencies
      };
    } catch (error) {
      logger.error('Failed to get service dependencies:', error);
      throw error;
    }
  }

  /**
   * Helper methods
   */
  private static mapSpanKind(kind: SpanKind): string {
    switch (kind) {
      case SpanKind.SERVER: return 'server';
      case SpanKind.CLIENT: return 'client';
      case SpanKind.PRODUCER: return 'producer';
      case SpanKind.CONSUMER: return 'consumer';
      default: return 'internal';
    }
  }

  private static mapSpanStatus(code?: SpanStatusCode): string {
    switch (code) {
      case SpanStatusCode.OK: return 'success';
      case SpanStatusCode.ERROR: return 'error';
      default: return 'unset';
    }
  }

  private static filterCustomAttributes(attributes: any): Record<string, any> {
    const standardKeys = [
      'http.', 'net.', 'db.', 'rpc.', 'messaging.', 'faas.', 'cloud.', 
      'host.', 'service.', 'telemetry.', 'gen_ai.', 'costkatana.'
    ];
    
    const custom: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(attributes || {})) {
      if (!standardKeys.some(prefix => key.startsWith(prefix))) {
        custom[key] = value;
      }
    }
    
    return custom;
  }

  private static getTimeframeMs(timeframe: string): number {
    const hour = 3600000;
    switch (timeframe) {
      case '5m': return 5 * 60000;
      case '15m': return 15 * 60000;
      case '30m': return 30 * 60000;
      case '1h': return hour;
      case '3h': return 3 * hour;
      case '6h': return 6 * hour;
      case '12h': return 12 * hour;
      case '24h': return 24 * hour;
      case '7d': return 7 * 24 * hour;
      case '30d': return 30 * 24 * hour;
      default: return hour;
    }
  }

  private static calculatePercentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) return 0;
    
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, index)];
  }
}
