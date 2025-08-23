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
        
        // GenAI attributes (including enriched ones)
        gen_ai_system: span.attributes['gen_ai.system'],
        gen_ai_model: span.attributes['gen_ai.request.model'],
        gen_ai_operation: span.attributes['gen_ai.operation.name'],
        prompt_tokens: span.attributes['gen_ai.usage.prompt_tokens'],
        completion_tokens: span.attributes['gen_ai.usage.completion_tokens'],
        total_tokens: span.attributes['gen_ai.usage.total_tokens'],
        cost_usd: span.attributes['costkatana.cost.usd'] || span.attributes['costkatana.price_usd'],
        temperature: span.attributes['gen_ai.request.temperature'],
        max_tokens: span.attributes['gen_ai.request.max_tokens'],
        
        // Performance metrics (including enriched ones)
        database_latency_ms: span.attributes['db.latency_ms'],
        cache_latency_ms: span.attributes['cache.latency_ms'] || span.attributes['processing.latency_ms'],
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
        
        // Store remaining attributes (including enriched ones)
        attributes: {
          ...this.filterCustomAttributes(span.attributes),
          // Extract enriched attributes
          ...(span.attributes['costkatana.insights'] && {
            enriched_insights: span.attributes['costkatana.insights']
          }),
          ...(span.attributes['costkatana.routing_decision'] && {
            routing_decision: span.attributes['costkatana.routing_decision']
          }),
          ...(span.attributes['cache.hit'] !== undefined && {
            cache_hit: span.attributes['cache.hit']
          }),
          ...(span.attributes['request.priority'] && {
            request_priority: span.attributes['request.priority']
          }),
          ...(span.attributes['processing.type'] && {
            processing_type: span.attributes['processing.type']
          })
        }
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
      
      // Adjust limits based on timeframe to prevent memory issues
      const isLongTimeframe = timeframe === '30d' || timeframe === '90d';
      const maxRecords = isLongTimeframe ? 50000 : 100000; // Lower limit for longer timeframes
      
      // For very long timeframes, we'll rely on the limit instead of sampling
      // to ensure compatibility across all MongoDB versions

      // Main aggregation pipeline - optimized for memory efficiency
      const pipeline = [
        { $match: matchStage },
        // Add a limit stage to prevent memory issues with very large datasets
        { $limit: maxRecords }, // Dynamic limit based on timeframe
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
            // Percentiles - optimized for memory efficiency
            percentiles: [
              {
                $group: {
                  _id: null,
                  durations: { $push: '$duration_ms' }
                }
              }
            ],
            // Top operations - optimized for memory efficiency
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
            // Top errors - optimized for memory efficiency
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

      let result: any;
      try {
        logger.info(`Executing aggregation pipeline for timeframe: ${timeframe}, maxRecords: ${maxRecords}`);
        
        // Add timeout to MongoDB aggregation to prevent hanging
        const aggregationPromise = Telemetry.aggregate(pipeline as any);
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('MongoDB aggregation timeout after 20 seconds')), 20000);
        });
        
        const aggregationResult = await Promise.race([aggregationPromise, timeoutPromise]);
        result = (aggregationResult as any)[0] || {};
        logger.info(`Aggregation completed successfully with ${result.basic?.[0]?.total_requests || 0} records`);
      } catch (error: any) {
        // Handle memory limit errors gracefully
        if (error.message && error.message.includes('memory limit')) {
          logger.warn(`Memory limit exceeded for timeframe ${timeframe}, using fallback aggregation`);
                     // Fallback to simpler aggregation without percentiles
           const fallbackPipeline = [
             { $match: matchStage },
             { $limit: Math.floor(maxRecords * 0.1) }, // Much smaller limit based on timeframe
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
          ];
          
                     const [fallbackResult] = await Telemetry.aggregate(fallbackPipeline as any);
           logger.info(`Fallback aggregation completed with ${fallbackResult?.total_requests || 0} records`);
           result = {
             basic: [fallbackResult],
             percentiles: [{ durations: [] }],
             operations: [],
             errors: [],
             models: []
           };
        } else {
          throw error;
        }
      }
      
      // Calculate percentiles - sort in memory after grouping for memory efficiency
      const durations = result.percentiles?.[0]?.durations || [];
      // Only sort if we have a reasonable number of data points to avoid memory issues
      let sortedDurations = durations;
      if (durations.length > 0 && durations.length <= 10000) {
        sortedDurations = [...durations].sort((a, b) => a - b);
      } else if (durations.length > 10000) {
        // For very large datasets, use sampling for percentiles
        const sampleSize = Math.min(10000, Math.floor(durations.length * 0.1));
        const step = Math.floor(durations.length / sampleSize);
        const sampledDurations = [];
        for (let i = 0; i < durations.length; i += step) {
          sampledDurations.push(durations[i]);
        }
        sortedDurations = sampledDurations.sort((a, b) => a - b);
      }
      
      const p50 = this.calculatePercentile(sortedDurations, 50);
      const p95 = this.calculatePercentile(sortedDurations, 95);
      const p99 = this.calculatePercentile(sortedDurations, 99);
      
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

  /**
   * Get enrichment statistics
   */
  static async getEnrichmentStats(timeframe = '1h') {
    try {
      const now = new Date();
      const start = new Date(now.getTime() - this.getTimeframeMs(timeframe));

      const pipeline = [
        {
          $match: {
            timestamp: { $gte: start, $lte: now }
          }
        },
        {
          $facet: {
            // Enrichment coverage
            enrichment_stats: [
              {
                $group: {
                  _id: null,
                  total_spans: { $sum: 1 },
                  enriched_spans: {
                    $sum: {
                      $cond: [
                        { $ifNull: ['$attributes.enriched_insights', false] },
                        1,
                        0
                      ]
                    }
                  },
                  cache_hit_spans: {
                    $sum: {
                      $cond: [
                        { $eq: ['$attributes.cache_hit', true] },
                        1,
                        0
                      ]
                    }
                  },
                  routing_decisions: {
                    $sum: {
                      $cond: [
                        { $ifNull: ['$attributes.routing_decision', false] },
                        1,
                        0
                      ]
                    }
                  }
                }
              }
            ],
            // Processing types
            processing_types: [
              {
                $match: {
                  'attributes.processing_type': { $exists: true }
                }
              },
              {
                $group: {
                  _id: '$attributes.processing_type',
                  count: { $sum: 1 },
                  avg_duration: { $avg: '$duration_ms' },
                  avg_cost: { $avg: { $ifNull: ['$cost_usd', 0] } }
                }
              }
            ],
            // Request priorities
            priorities: [
              {
                $match: {
                  'attributes.request_priority': { $exists: true }
                }
              },
              {
                $group: {
                  _id: '$attributes.request_priority',
                  count: { $sum: 1 },
                  avg_duration: { $avg: '$duration_ms' }
                }
              }
            ]
          }
        }
      ];

      const [result] = await Telemetry.aggregate(pipeline as any);
      
      const stats = result.enrichment_stats[0] || {};
      const enrichmentRate = stats.total_spans > 0 
        ? (stats.enriched_spans / stats.total_spans) * 100 
        : 0;

      return {
        timeframe,
        total_spans: stats.total_spans || 0,
        enriched_spans: stats.enriched_spans || 0,
        enrichment_rate: enrichmentRate,
        cache_hit_spans: stats.cache_hit_spans || 0,
        routing_decisions: stats.routing_decisions || 0,
        processing_types: result.processing_types || [],
        request_priorities: result.priorities || []
      };
    } catch (error) {
      logger.error('Failed to get enrichment stats:', error);
      throw error;
    }
  }

  /**
   * Get spans with enrichment insights
   */
  static async getEnrichedSpans({
    tenant_id,
    workspace_id,
    timeframe = '1h',
    limit = 50
  }: {
    tenant_id?: string;
    workspace_id?: string;
    timeframe?: string;
    limit?: number;
  }) {
    try {
      const now = new Date();
      const start = new Date(now.getTime() - this.getTimeframeMs(timeframe));

      const matchStage: any = {
        timestamp: { $gte: start, $lte: now },
        'attributes.enriched_insights': { $exists: true }
      };
      
      if (tenant_id) matchStage.tenant_id = tenant_id;
      if (workspace_id) matchStage.workspace_id = workspace_id;

      const spans = await Telemetry.find(matchStage)
        .sort({ timestamp: -1 })
        .limit(limit)
        .select({
          trace_id: 1,
          span_id: 1,
          operation_name: 1,
          duration_ms: 1,
          cost_usd: 1,
          status: 1,
          timestamp: 1,
          'attributes.enriched_insights': 1,
          'attributes.routing_decision': 1,
          'attributes.cache_hit': 1,
          'attributes.processing_type': 1,
          'attributes.request_priority': 1
        })
        .lean();

      return spans.map(span => ({
        trace_id: span.trace_id,
        span_id: span.span_id,
        operation_name: span.operation_name,
        duration_ms: span.duration_ms,
        cost_usd: span.cost_usd,
        status: span.status,
        timestamp: span.timestamp,
        insights: span.attributes?.enriched_insights,
        routing_decision: span.attributes?.routing_decision,
        cache_hit: span.attributes?.cache_hit,
        processing_type: span.attributes?.processing_type,
        request_priority: span.attributes?.request_priority
      }));
    } catch (error) {
      logger.error('Failed to get enriched spans:', error);
      throw error;
    }
  }

  /**
   * Auto-vectorize new telemetry data
   */
  static async autoVectorizeSpan(spanData: any): Promise<void> {
    try {
      // Import here to avoid circular dependency
      const { embeddingsService } = await import('./embeddings.service');
      
      // Generate embedding and cost narrative
      const [embeddingResult, costNarrative] = await Promise.all([
        embeddingsService.generateTelemetryEmbedding(spanData),
        embeddingsService.generateCostNarrative(spanData)
      ]);

      // Update the span with vector data
      await Telemetry.updateOne(
        { trace_id: spanData.trace_id, span_id: spanData.span_id },
        {
          $set: {
            semantic_embedding: embeddingResult.embedding,
            semantic_content: embeddingResult.text,
            cost_narrative: costNarrative
          }
        }
      );

      logger.info(`Auto-vectorized span: ${spanData.span_id}`);
    } catch (error) {
      logger.warn(`Failed to auto-vectorize span ${spanData.span_id}:`, error);
      // Don't throw - vectorization failure shouldn't break telemetry storage
    }
  }

  /**
   * Start continuous background enrichment
   */
  static startBackgroundEnrichment(): void {
    // Run enrichment every 5 minutes
    setInterval(async () => {
      try {
        await TelemetryService.autoEnrichSpans();
        logger.info('Background span enrichment completed');
      } catch (error) {
        logger.error('Background span enrichment failed:', error);
      }
    }, 5 * 60 * 1000); // 5 minutes

    // Also run immediately
    setImmediate(async () => {
      try {
        await TelemetryService.autoEnrichSpans();
        logger.info('Initial background span enrichment completed');
      } catch (error) {
        logger.error('Initial background span enrichment failed:', error);
      }
    });
  }

  /**
   * Auto-enrich spans with AI insights and cost optimization
   */
  static async autoEnrichSpans(): Promise<void> {
    try {
      const now = new Date();
      const start = new Date(now.getTime() - 24 * 60 * 60 * 1000); // Last 24 hours

      // Find spans that haven't been enriched yet
      const unenrichedSpans = await Telemetry.find({
        timestamp: { $gte: start, $lte: now },
        'attributes.enriched_insights': { $exists: false },
        status: { $in: ['success', 'error'] }
      }).limit(50).lean(); // Reduced limit for better performance

      if (unenrichedSpans.length === 0) {
        return;
      }

      logger.info(`Enriching ${unenrichedSpans.length} spans with AI insights`);

      // Process spans in batches for better performance
      const batchSize = 10;
      for (let i = 0; i < unenrichedSpans.length; i += batchSize) {
        const batch = unenrichedSpans.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (span) => {
          try {
            const enrichment = await this.generateSpanEnrichment(span);
            
            if (enrichment) {
              await Telemetry.updateOne(
                { _id: span._id },
                { 
                  $set: { 
                    'attributes.enriched_insights': enrichment.insights,
                    'attributes.routing_decision': enrichment.routing_decision,
                    'attributes.processing_type': enrichment.processing_type,
                    'attributes.request_priority': enrichment.priority,
                    'attributes.cache_hit': enrichment.cache_hit
                  }
                }
              );
            }
          } catch (error) {
            logger.error(`Failed to enrich span ${span.span_id}:`, error);
          }
        }));

        // Small delay between batches to prevent overwhelming the database
        if (i + batchSize < unenrichedSpans.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    } catch (error) {
      logger.error('Failed to auto-enrich spans:', error);
    }
  }

  /**
   * Generate AI enrichment for a span
   */
  private static async generateSpanEnrichment(span: any): Promise<{
    insights: string;
    routing_decision: string;
    processing_type: string;
    priority: string;
    cache_hit: boolean;
  } | null> {
    try {
      // Analyze span characteristics
      const isHighCost = (span.cost_usd || 0) > 0.01;
      const isSlow = (span.duration_ms || 0) > 5000;
      const isError = span.status === 'error';
      const isGenAI = span.gen_ai_model || span.gen_ai_system;

      let insights = '';
      let routing_decision = 'standard';
      let processing_type = 'general';
      let priority = 'normal';
      let cache_hit = false;

      // Generate insights based on span characteristics
      if (isHighCost && isGenAI) {
        insights = `High-cost AI operation detected. Consider using a more cost-effective model or implementing caching for similar requests.`;
        routing_decision = 'cost_optimized';
        processing_type = 'ai_cost_optimization';
        priority = 'high';
      } else if (isSlow && isGenAI) {
        insights = `Slow AI response detected. Consider using a faster model or implementing request batching.`;
        routing_decision = 'performance_optimized';
        processing_type = 'ai_performance_optimization';
        priority = 'medium';
      } else if (isError && isGenAI) {
        insights = `AI operation failed. Check model availability and consider implementing retry logic with exponential backoff.`;
        routing_decision = 'error_handling';
        processing_type = 'ai_error_recovery';
        priority = 'high';
      } else if (isGenAI) {
        insights = `AI operation completed successfully. Consider implementing caching for repeated similar requests to reduce costs.`;
        routing_decision = 'cache_optimized';
        processing_type = 'ai_caching';
        priority = 'low';
        cache_hit = true;
      } else if (span.database_latency_ms > 1000) {
        insights = `Database operation is slow. Consider adding database indexes or implementing connection pooling.`;
        routing_decision = 'db_optimized';
        processing_type = 'database_optimization';
        priority = 'medium';
      } else if (span.http_status_code >= 400) {
        insights = `HTTP error detected. Check external service health and implement proper error handling.`;
        routing_decision = 'error_handling';
        processing_type = 'http_error_recovery';
        priority = 'high';
      } else {
        insights = `Operation completed successfully. No immediate optimization needed.`;
        routing_decision = 'standard';
        processing_type = 'general';
        priority = 'low';
      }

      return {
        insights,
        routing_decision,
        processing_type,
        priority,
        cache_hit
      };
    } catch (error) {
      logger.error('Failed to generate span enrichment:', error);
      return null;
    }
  }

  /**
   * Generate real-time AI recommendations based on current telemetry
   */
  static async generateAIRecommendations(timeframe = '1h'): Promise<Array<{
    trace_id: string;
    operation: string;
    insight: string;
    cost_impact: number;
    routing_decision: string;
    priority: 'high' | 'medium' | 'low';
    category: string;
  }>> {
    try {
      const now = new Date();
      const start = new Date(now.getTime() - this.getTimeframeMs(timeframe));

      // Get recent spans for analysis
      const recentSpans = await Telemetry.find({
        timestamp: { $gte: start, $lte: now },
        status: { $in: ['success', 'error'] }
      }).sort({ timestamp: -1 }).limit(100).lean();

      if (recentSpans.length === 0) {
        return [];
      }

      const recommendations: Array<{
        trace_id: string;
        operation: string;
        insight: string;
        cost_impact: number;
        routing_decision: string;
        priority: 'high' | 'medium' | 'low';
        category: string;
      }> = [];

      // Analyze cost patterns
      const highCostSpans = recentSpans.filter(span => (span.cost_usd || 0) > 0.01);
      if (highCostSpans.length > 0) {
        const totalCost = highCostSpans.reduce((sum, span) => sum + (span.cost_usd || 0), 0);
        const avgCost = totalCost / highCostSpans.length;
        
        recommendations.push({
          trace_id: highCostSpans[0].trace_id,
          operation: 'Cost Optimization',
          insight: `High-cost operations detected: ${highCostSpans.length} spans with average cost $${avgCost.toFixed(4)}. Consider implementing caching, using cost-effective models, or request batching.`,
          cost_impact: totalCost,
          routing_decision: 'cost_optimized',
          priority: 'high',
          category: 'cost_optimization'
        });
      }

      // Analyze performance patterns
      const slowSpans = recentSpans.filter(span => (span.duration_ms || 0) > 5000);
      if (slowSpans.length > 0) {
        const avgDuration = slowSpans.reduce((sum, span) => sum + (span.duration_ms || 0), 0) / slowSpans.length;
        
        recommendations.push({
          trace_id: slowSpans[0].trace_id,
          operation: 'Performance Optimization',
          insight: `Slow operations detected: ${slowSpans.length} spans with average duration ${(avgDuration / 1000).toFixed(2)}s. Consider optimizing database queries, implementing caching, or using faster models.`,
          cost_impact: 0,
          routing_decision: 'performance_optimized',
          priority: 'medium',
          category: 'performance_optimization'
        });
      }

      // Analyze error patterns
      const errorSpans = recentSpans.filter(span => span.status === 'error');
      if (errorSpans.length > 0) {
        const errorRate = (errorSpans.length / recentSpans.length) * 100;
        
        recommendations.push({
          trace_id: errorSpans[0].trace_id,
          operation: 'Error Resolution',
          insight: `Error rate is ${errorRate.toFixed(1)}%. Check service health, implement proper error handling, and consider adding retry logic for transient failures.`,
          cost_impact: 0,
          routing_decision: 'error_handling',
          priority: 'high',
          category: 'error_resolution'
        });
      }

      // Analyze AI model usage patterns
      const aiSpans = recentSpans.filter(span => span.gen_ai_model || span.gen_ai_system);
      if (aiSpans.length > 0) {
        const modelUsage = aiSpans.reduce((acc, span) => {
          const model = span.gen_ai_model || span.gen_ai_system || 'unknown';
          acc[model] = (acc[model] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        const topModel = Object.entries(modelUsage).sort(([,a], [,b]) => b - a)[0];
        
        recommendations.push({
          trace_id: aiSpans[0].trace_id,
          operation: 'AI Model Optimization',
          insight: `Most used AI model: ${topModel[0]} (${topModel[1]} requests). Consider implementing model selection logic based on request complexity and cost requirements.`,
          cost_impact: aiSpans.reduce((sum, span) => sum + (span.cost_usd || 0), 0),
          routing_decision: 'model_optimized',
          priority: 'medium',
          category: 'ai_optimization'
        });
      }

      // Analyze database performance
      const dbSpans = recentSpans.filter(span => span.database_latency_ms && span.database_latency_ms > 1000);
      if (dbSpans.length > 0) {
        const avgDbLatency = dbSpans.reduce((sum, span) => sum + (span.database_latency_ms || 0), 0) / dbSpans.length;
        
        recommendations.push({
          trace_id: dbSpans[0].trace_id,
          operation: 'Database Optimization',
          insight: `Slow database operations detected: ${dbSpans.length} spans with average latency ${(avgDbLatency / 1000).toFixed(2)}s. Consider adding indexes, optimizing queries, or implementing connection pooling.`,
          cost_impact: 0,
          routing_decision: 'db_optimized',
          priority: 'medium',
          category: 'database_optimization'
        });
      }

      return recommendations.slice(0, 5); // Return top 5 recommendations
    } catch (error) {
      logger.error('Failed to generate AI recommendations:', error);
      return [];
    }
  }
}
