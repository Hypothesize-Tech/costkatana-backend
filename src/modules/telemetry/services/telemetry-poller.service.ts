import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import axios, { AxiosRequestConfig } from 'axios';
import * as crypto from 'crypto';
import * as https from 'https';
import { LoggerService } from '../../../common/logger/logger.service';
import {
  UserTelemetryConfig,
  UserTelemetryConfigDocument,
} from '../../../schemas/integration/user-telemetry-config.schema';
import {
  Telemetry,
  TelemetryDocument,
} from '../../../schemas/core/telemetry.schema';

interface OTLPSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Array<{ key: string; value: any }>;
  status?: { code: number; message?: string };
}

@Injectable()
export class TelemetryPollerService {
  private isRunning = false;

  constructor(
    @InjectModel(UserTelemetryConfig.name)
    private userTelemetryConfigModel: Model<UserTelemetryConfigDocument>,
    @InjectModel(Telemetry.name)
    private telemetryModel: Model<TelemetryDocument>,
    private logger: LoggerService,
  ) {}

  /**
   * Start the telemetry poller (called by cron job)
   */
  async pollAllEndpoints(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        'Telemetry poller already running, skipping this cycle',
        {
          component: 'TelemetryPollerService',
        },
      );
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      this.logger.info('Starting telemetry poll cycle', {
        component: 'TelemetryPollerService',
      });

      // Get all active configurations that need syncing
      const configs = await this.userTelemetryConfigModel.find({
        isActive: true,
        syncEnabled: true,
        $or: [
          { lastSyncAt: { $exists: false } }, // Never synced
          {
            lastSyncAt: {
              $lt: new Date(Date.now() - this.getSyncInterval() * 60 * 1000),
            },
          },
        ],
      });

      this.logger.info(`Found ${configs.length} endpoints to sync`, {
        component: 'TelemetryPollerService',
      });

      // Poll each endpoint in parallel (with concurrency limit)
      const results = await Promise.allSettled(
        configs.map((config) => this.pollEndpoint(config)),
      );

      // Log results
      const successful = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;

      this.logger.info('Telemetry poll cycle completed', {
        component: 'TelemetryPollerService',
        duration: Date.now() - startTime,
        total: configs.length,
        successful,
        failed,
      });
    } catch (error: any) {
      this.logger.error('Telemetry poll cycle failed', {
        component: 'TelemetryPollerService',
        error: error.message || String(error),
      });
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Poll a single endpoint (public method for manual sync)
   */
  async pollSingleEndpoint(
    config: UserTelemetryConfigDocument,
  ): Promise<{ success: boolean; recordsImported?: number; error?: string }> {
    try {
      await this.pollEndpoint(config);
      return { success: true, recordsImported: 0 }; // Updated by pollEndpoint
    } catch (error: any) {
      return {
        success: false,
        recordsImported: 0,
        error: error.message || String(error),
      };
    }
  }

  /**
   * Poll a single telemetry endpoint (private implementation)
   */
  private async pollEndpoint(
    config: UserTelemetryConfigDocument,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.info('Polling telemetry endpoint', {
        component: 'TelemetryPollerService',
        userId: config.userId,
        endpoint: config.endpoint,
        type: config.endpointType,
      });

      // Fetch data based on endpoint type
      let spans: OTLPSpan[] = [];

      switch (config.endpointType) {
        case 'otlp-http':
          spans = await this.fetchOTLPHTTP(config);
          break;
        case 'tempo':
          spans = await this.fetchTempo(config);
          break;
        case 'jaeger':
          spans = await this.fetchJaeger(config);
          break;
        default:
          this.logger.warn('Unsupported endpoint type', {
            component: 'TelemetryPollerService',
            type: config.endpointType,
          });
          return;
      }

      if (spans.length === 0) {
        this.logger.info('No new telemetry data found', {
          component: 'TelemetryPollerService',
          userId: config.userId,
        });

        await this.userTelemetryConfigModel.findByIdAndUpdate(config._id, {
          lastSyncAt: new Date(),
          lastSyncStatus: 'success',
        });
        return;
      }

      // Transform and store spans
      const telemetryRecords = spans
        .map((span) => this.transformSpanToTelemetry(span, config))
        .filter(Boolean); // Remove nulls

      if (telemetryRecords.length > 0) {
        await this.telemetryModel.insertMany(telemetryRecords, {
          ordered: false,
        });
      }

      // Update config
      await this.userTelemetryConfigModel.findByIdAndUpdate(config._id, {
        lastSyncAt: new Date(),
        lastSyncStatus: 'success',
        lastSyncError: null,
        totalRecordsSynced: config.totalRecordsSynced + telemetryRecords.length,
      });

      this.logger.info('Successfully polled telemetry endpoint', {
        component: 'TelemetryPollerService',
        userId: config.userId,
        recordsImported: telemetryRecords.length,
        duration: Date.now() - startTime,
      });
    } catch (error: any) {
      const errorMessage = error.message || String(error);

      this.logger.error('Failed to poll telemetry endpoint', {
        component: 'TelemetryPollerService',
        userId: config.userId,
        endpoint: config.endpoint,
        error: errorMessage,
      });

      // Update config with error
      await this.userTelemetryConfigModel.findByIdAndUpdate(config._id, {
        lastSyncAt: new Date(),
        lastSyncStatus: 'error',
        lastSyncError: errorMessage,
        totalSyncErrors: config.totalSyncErrors + 1,
      });
    }
  }

  /**
   * Fetch data from OTLP HTTP endpoint
   */
  private async fetchOTLPHTTP(
    config: UserTelemetryConfigDocument,
  ): Promise<OTLPSpan[]> {
    const spans: OTLPSpan[] = [];

    try {
      // OTLP HTTP endpoints typically expose query APIs
      // We'll query for recent traces using the Tempo-like API
      const now = Date.now();
      const start = now - config.queryTimeRangeMinutes * 60 * 1000;

      const axiosConfig = this.buildAxiosConfig(config);

      // Try to fetch traces using various common OTLP backend APIs
      const queryUrl = config.tracesEndpoint || `${config.endpoint}/api/traces`;
      const params: any = {
        start: Math.floor(start / 1000),
        end: Math.floor(now / 1000),
        limit: 1000,
      };

      // Add service filter if configured
      if (config.queryFilters?.serviceName) {
        params['service.name'] = config.queryFilters.serviceName;
      }

      this.logger.info('Fetching from OTLP HTTP endpoint', {
        component: 'TelemetryPollerService',
        url: queryUrl,
        params,
      });

      const response = await axios.get(queryUrl, {
        ...axiosConfig,
        params,
        headers: {
          ...axiosConfig.headers,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });

      // Parse response - handle both Tempo and standard OTLP formats
      if (response.data.traces) {
        // Tempo format
        for (const trace of response.data.traces) {
          if (trace.traceID) {
            // Fetch full trace
            try {
              const traceUrl = `${config.endpoint}/api/traces/${trace.traceID}`;
              const traceResponse = await axios.get(traceUrl, axiosConfig);
              const traceSpans = this.extractSpansFromTrace(traceResponse.data);
              spans.push(...traceSpans);
            } catch (traceError: any) {
              this.logger.warn('Failed to fetch trace from OTLP endpoint', {
                component: 'TelemetryPollerService',
                traceId: trace.traceID,
                error: traceError.message || String(traceError),
              });
            }
          }
        }
      } else if (response.data.resourceSpans) {
        // Direct OTLP format
        spans.push(...this.extractSpansFromTrace(response.data));
      } else if (response.data.batches) {
        // Batch format
        spans.push(...this.extractSpansFromTrace(response.data));
      } else if (Array.isArray(response.data)) {
        // Array of traces
        for (const traceData of response.data) {
          spans.push(...this.extractSpansFromTrace(traceData));
        }
      }

      this.logger.info('Fetched spans from OTLP HTTP endpoint', {
        component: 'TelemetryPollerService',
        spanCount: spans.length,
      });
    } catch (error: any) {
      this.logger.error('Failed to fetch from OTLP HTTP endpoint', {
        component: 'TelemetryPollerService',
        error: error.message || String(error),
        endpoint: config.endpoint,
      });
    }

    return spans;
  }

  /**
   * Fetch data from Grafana Tempo
   */
  private async fetchTempo(
    config: UserTelemetryConfigDocument,
  ): Promise<OTLPSpan[]> {
    const spans: OTLPSpan[] = [];

    try {
      // Calculate time range
      const now = Date.now();
      const start = now - config.queryTimeRangeMinutes * 60 * 1000;

      // Tempo search API
      const searchUrl = `${config.endpoint}/api/search`;
      const query: any = {
        start: Math.floor(start / 1000),
        end: Math.floor(now / 1000),
        limit: 1000,
      };

      // Add filters if configured
      if (config.queryFilters?.serviceName) {
        query.tags = `service.name=${config.queryFilters.serviceName}`;
      }

      const axiosConfig = this.buildAxiosConfig(config);
      const response = await axios.get(searchUrl, {
        ...axiosConfig,
        params: query,
      });

      // Fetch full trace data for each trace ID
      const traceIds = response.data.traces?.map((t: any) => t.traceID) || [];

      for (const traceId of traceIds.slice(0, 100)) {
        // Limit to 100 traces per poll
        try {
          const traceUrl = `${config.endpoint}/api/traces/${traceId}`;
          const traceResponse = await axios.get(traceUrl, axiosConfig);

          // Extract spans from trace
          const traceSpans = this.extractSpansFromTrace(traceResponse.data);
          spans.push(...traceSpans);
        } catch (traceError: any) {
          this.logger.warn('Failed to fetch trace', {
            component: 'TelemetryPollerService',
            traceId,
            error: traceError.message || String(traceError),
          });
        }
      }
    } catch (error: any) {
      this.logger.error('Failed to fetch from Tempo', {
        component: 'TelemetryPollerService',
        error: error.message || String(error),
      });
    }

    return spans;
  }

  /**
   * Fetch data from Jaeger
   */
  private async fetchJaeger(
    config: UserTelemetryConfigDocument,
  ): Promise<OTLPSpan[]> {
    const spans: OTLPSpan[] = [];

    try {
      // Jaeger Query API
      const searchUrl = `${config.endpoint}/api/traces`;

      const now = Date.now();
      const start = now - config.queryTimeRangeMinutes * 60 * 1000;

      const params: any = {
        start: start * 1000, // Jaeger uses microseconds
        end: now * 1000,
        limit: 1000,
      };

      if (config.queryFilters?.serviceName) {
        params.service = config.queryFilters.serviceName;
      }

      const axiosConfig = this.buildAxiosConfig(config);
      const response = await axios.get(searchUrl, {
        ...axiosConfig,
        params,
      });

      // Extract spans from Jaeger traces
      const traces = response.data.data || [];
      for (const trace of traces) {
        const traceSpans = this.extractSpansFromJaegerTrace(trace);
        spans.push(...traceSpans);
      }
    } catch (error: any) {
      this.logger.error('Failed to fetch from Jaeger', {
        component: 'TelemetryPollerService',
        error: error.message || String(error),
      });
    }

    return spans;
  }

  /**
   * Build axios config with auth and TLS settings
   */
  private buildAxiosConfig(
    config: UserTelemetryConfigDocument,
  ): AxiosRequestConfig {
    const axiosConfig: AxiosRequestConfig = {
      headers: {},
      timeout: 30000,
    };

    // Add authentication
    if (config.authType === 'bearer' && config.authToken) {
      axiosConfig.headers!['Authorization'] = `Bearer ${config.authToken}`;
    } else if (
      config.authType === 'basic' &&
      config.username &&
      config.password
    ) {
      axiosConfig.auth = {
        username: config.username,
        password: config.password,
      };
    } else if (
      config.authType === 'api-key' &&
      config.authToken &&
      config.authHeader
    ) {
      axiosConfig.headers![config.authHeader] = config.authToken;
    }

    // TLS configuration
    if (config.useTLS) {
      axiosConfig.httpsAgent = new https.Agent({
        rejectUnauthorized: !config.skipTLSVerify,
        ca: config.tlsCertificate
          ? Buffer.from(config.tlsCertificate, 'base64')
          : undefined,
      });
    }

    return axiosConfig;
  }

  /**
   * Extract spans from OTLP trace format
   */
  private extractSpansFromTrace(traceData: any): OTLPSpan[] {
    const spans: OTLPSpan[] = [];

    try {
      if (traceData.batches) {
        for (const batch of traceData.batches) {
          for (const scopeSpan of batch.scopeSpans ||
            batch.instrumentationLibrarySpans ||
            []) {
            for (const span of scopeSpan.spans || []) {
              spans.push(span);
            }
          }
        }
      } else if (traceData.resourceSpans) {
        for (const resourceSpan of traceData.resourceSpans) {
          for (const scopeSpan of resourceSpan.scopeSpans || []) {
            for (const span of scopeSpan.spans || []) {
              spans.push(span);
            }
          }
        }
      }
    } catch (error: any) {
      this.logger.warn('Failed to extract spans from trace', {
        component: 'TelemetryPollerService',
        error: error.message || String(error),
      });
    }

    return spans;
  }

  /**
   * Extract spans from Jaeger trace format
   */
  private extractSpansFromJaegerTrace(trace: any): OTLPSpan[] {
    const spans: OTLPSpan[] = [];

    try {
      for (const span of trace.spans || []) {
        spans.push({
          traceId: trace.traceID,
          spanId: span.spanID,
          parentSpanId: span.references?.find(
            (r: any) => r.refType === 'CHILD_OF',
          )?.spanID,
          name: span.operationName,
          kind: 0, // Will be determined from tags
          startTimeUnixNano: (span.startTime * 1000).toString(),
          endTimeUnixNano: ((span.startTime + span.duration) * 1000).toString(),
          attributes:
            span.tags?.map((tag: any) => ({
              key: tag.key,
              value: { stringValue: tag.value },
            })) || [],
          status: span.warnings ? { code: 2 } : { code: 1 },
        });
      }
    } catch (error: any) {
      this.logger.warn('Failed to extract spans from Jaeger trace', {
        component: 'TelemetryPollerService',
        error: error.message || String(error),
      });
    }

    return spans;
  }

  /**
   * Transform OTLP span to Cost Katana telemetry format
   */
  private transformSpanToTelemetry(
    span: OTLPSpan,
    config: UserTelemetryConfigDocument,
  ): any | null {
    try {
      // Extract attributes
      const attrs = this.extractAttributes(span.attributes);

      // Only process if it's a GenAI span or has relevant data
      const isGenAI = attrs['gen_ai.system'] || attrs['gen_ai.request.model'];

      if (!isGenAI) {
        return null; // Skip non-AI spans
      }

      const startTime = new Date(parseInt(span.startTimeUnixNano) / 1000000);
      const endTime = new Date(parseInt(span.endTimeUnixNano) / 1000000);
      const durationMs =
        (parseInt(span.endTimeUnixNano) - parseInt(span.startTimeUnixNano)) /
        1000000;

      return {
        trace_id: span.traceId || crypto.randomUUID(),
        span_id: span.spanId || crypto.randomUUID(),
        parent_span_id: span.parentSpanId,
        request_id: span.spanId,

        tenant_id: config.userId,
        workspace_id: config.projectId || 'default',
        user_id: config.userId,

        timestamp: startTime,
        start_time: startTime,
        end_time: endTime,
        duration_ms: durationMs,

        service_name: attrs['service.name'] || 'external',
        operation_name: span.name || 'unknown',
        span_kind: this.mapSpanKind(span.kind),

        status:
          span.status?.code === 1
            ? 'success'
            : span.status?.code === 2
              ? 'error'
              : 'unset',
        status_message: span.status?.message,

        gen_ai_system: attrs['gen_ai.system'],
        gen_ai_model: attrs['gen_ai.request.model'],
        gen_ai_operation: attrs['gen_ai.operation.name'],
        prompt_tokens: attrs['gen_ai.usage.prompt_tokens'] || 0,
        completion_tokens: attrs['gen_ai.usage.completion_tokens'] || 0,
        total_tokens: attrs['gen_ai.usage.total_tokens'] || 0,
        cost_usd:
          attrs['costkatana.cost.usd'] || attrs['gen_ai.usage.cost'] || 0,
        temperature: attrs['gen_ai.request.temperature'],
        max_tokens: attrs['gen_ai.request.max_tokens'],

        http_route: attrs['http.route'],
        http_method: attrs['http.method'],
        http_status_code: attrs['http.status_code'],

        error_type: attrs['error.type'],
        error_message: attrs['error.message'],

        attributes: {
          ...attrs,
          source: 'external_poll',
          polledFrom: config.endpoint,
          endpointType: config.endpointType,
        },
      };
    } catch (error: any) {
      this.logger.warn('Failed to transform span', {
        component: 'TelemetryPollerService',
        error: error.message || String(error),
      });
      return null;
    }
  }

  /**
   * Extract attributes from OTLP format
   */
  private extractAttributes(attributes: any[]): Record<string, any> {
    const result: Record<string, any> = {};

    if (!attributes) return result;

    for (const attr of attributes) {
      if (attr.key && attr.value) {
        const value =
          attr.value.stringValue ||
          attr.value.intValue ||
          attr.value.doubleValue ||
          attr.value.boolValue ||
          attr.value.arrayValue ||
          attr.value.kvlistValue;
        result[attr.key] = value;
      }
    }

    return result;
  }

  /**
   * Map OTLP span kind to string
   */
  private mapSpanKind(
    kind: number,
  ): 'server' | 'client' | 'producer' | 'consumer' | 'internal' {
    const kindMap: Record<number, any> = {
      0: 'internal',
      1: 'server',
      2: 'client',
      3: 'producer',
      4: 'consumer',
    };
    return kindMap[kind] || 'internal';
  }

  /**
   * Get sync interval from environment (default 5 minutes)
   */
  private getSyncInterval(): number {
    return parseInt(process.env.TELEMETRY_SYNC_INTERVAL_MINUTES || '5');
  }

  /**
   * Health check for a specific endpoint
   */
  async healthCheck(configId: string): Promise<{
    healthy: boolean;
    message: string;
    latency?: number;
  }> {
    try {
      const config = await this.userTelemetryConfigModel.findById(configId);

      if (!config) {
        return { healthy: false, message: 'Configuration not found' };
      }

      const startTime = Date.now();
      const axiosConfig = this.buildAxiosConfig(config);

      // Simple health check - just try to connect
      await axios.get(`${config.endpoint}/health`, {
        ...axiosConfig,
        timeout: 5000,
        validateStatus: () => true,
      });

      const latency = Date.now() - startTime;

      await this.userTelemetryConfigModel.findByIdAndUpdate(configId, {
        lastHealthCheckAt: new Date(),
        lastHealthCheckStatus: 'healthy',
      });

      return {
        healthy: true,
        message: 'Endpoint is reachable',
        latency,
      };
    } catch (error: any) {
      await this.userTelemetryConfigModel.findByIdAndUpdate(configId, {
        lastHealthCheckAt: new Date(),
        lastHealthCheckStatus: 'unhealthy',
      });

      return {
        healthy: false,
        message: error.message || 'Unknown error',
      };
    }
  }
}
