import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export interface ICostAttribution {
  system_prompt_tokens?: number;
  system_prompt_cost?: number;
  tool_calls_count?: number;
  tool_calls_cost?: number;
  context_window_tokens?: number;
  context_window_cost?: number;
  retry_attempts?: number;
  retry_cost?: number;
  cache_miss_cost?: number;
  model_switching_cost?: number;
  network_latency_cost?: number;
  database_inefficiency_cost?: number;
  total_explained_cost?: number;
  unexplained_cost?: number;
  cost_anomaly_score?: number;
}

export interface IBaselineComparison {
  expected_cost?: number;
  deviation_percentage?: number;
  deviation_reason?: string;
}

export interface ICostDriver {
  driver_type:
    | 'system_prompt'
    | 'tool_calls'
    | 'context_window'
    | 'retries'
    | 'cache_miss'
    | 'model_switching'
    | 'network'
    | 'database';
  cost_impact: number;
  percentage_of_total: number;
  explanation: string;
  optimization_potential: number;
}

export interface IOptimizationRecommendation {
  type: 'immediate' | 'short_term' | 'long_term';
  description: string;
  potential_savings: number;
  implementation_effort: 'low' | 'medium' | 'high';
}

export interface ICostAnalysis {
  baseline_comparison?: IBaselineComparison;
  cost_drivers?: ICostDriver[];
  cost_story?: string;
  optimization_recommendations?: IOptimizationRecommendation[];
}

export interface IResourceAttributes {
  service_version?: string;
  deployment_environment?: string;
  cloud_provider?: string;
  cloud_region?: string;
  cloud_availability_zone?: string;
  host_name?: string;
  host_type?: string;
  container_id?: string;
  process_pid?: number;
}

export interface IEvent {
  name: string;
  timestamp: Date;
  attributes?: Record<string, any>;
}

export interface IDataTransferred {
  requestBytes: number;
  responseBytes: number;
  compressionRatio?: number;
}

export interface IConnectionDetails {
  protocol: string;
  cipher?: string;
  keepAlive: boolean;
  connectionReused: boolean;
}

export interface IPerformanceBreakdown {
  dnsLookupTime?: number;
  tcpConnectTime?: number;
  tlsHandshakeTime?: number;
  requestUploadTime?: number;
  responseDownloadTime?: number;
}

export interface INetworkingMetadata {
  clientEndpoint: string;
  serverEndpoint: string;
  dataTransferred: IDataTransferred;
  connectionDetails: IConnectionDetails;
  performanceBreakdown: IPerformanceBreakdown;
}

export interface ILink {
  trace_id: string;
  span_id: string;
  attributes?: Record<string, any>;
}

export type TelemetryDocument = HydratedDocument<Telemetry>;

@Schema({ timestamps: true })
export class Telemetry {
  // Trace identifiers
  @Prop({ required: true, index: true })
  trace_id: string;

  @Prop({ required: true, index: true })
  span_id: string;

  @Prop()
  parent_span_id?: string;

  // Context
  @Prop({ required: true, index: true })
  tenant_id: string;

  @Prop({ required: true, index: true })
  workspace_id: string;

  @Prop({ required: true, index: true })
  user_id: string;

  @Prop({ required: true, index: true })
  request_id: string;

  // Timing
  @Prop({ required: true })
  timestamp: Date;

  @Prop({ required: true })
  start_time: Date;

  @Prop({ required: true })
  end_time: Date;

  @Prop({ required: true, index: true })
  duration_ms: number;

  // Service info
  @Prop({ required: true, index: true })
  service_name: string;

  @Prop({ required: true, index: true })
  operation_name: string;

  @Prop({
    type: String,
    required: true,
    enum: ['server', 'client', 'producer', 'consumer', 'internal'],
  })
  span_kind: 'server' | 'client' | 'producer' | 'consumer' | 'internal';

  // Status
  @Prop({
    type: String,
    required: true,
    enum: ['success', 'error', 'unset'],
  })
  status: 'success' | 'error' | 'unset';

  @Prop()
  status_message?: string;

  // HTTP details
  @Prop({ index: true })
  http_route?: string;

  @Prop({ index: true })
  http_method?: string;

  @Prop({ index: true })
  http_status_code?: number;

  @Prop()
  http_url?: string;

  @Prop()
  http_target?: string;

  @Prop()
  http_host?: string;

  @Prop()
  http_scheme?: string;

  @Prop()
  http_user_agent?: string;

  // Error details
  @Prop({ index: true })
  error_type?: string;

  @Prop()
  error_message?: string;

  @Prop()
  error_stack?: string;

  // GenAI specific fields
  @Prop({ index: true })
  gen_ai_system?: string;

  @Prop({ index: true })
  gen_ai_model?: string;

  @Prop()
  gen_ai_operation?: string;

  @Prop()
  prompt_tokens?: number;

  @Prop()
  completion_tokens?: number;

  @Prop()
  total_tokens?: number;

  @Prop({ index: true })
  cost_usd?: number;

  @Prop()
  temperature?: number;

  @Prop()
  max_tokens?: number;

  // Performance breakdowns
  @Prop()
  database_latency_ms?: number;

  @Prop()
  cache_latency_ms?: number;

  @Prop()
  external_api_latency_ms?: number;

  @Prop()
  processing_latency_ms?: number;

  @Prop()
  queue_wait_ms?: number;

  // Database operations
  @Prop()
  db_system?: string;

  @Prop()
  db_operation?: string;

  @Prop()
  db_name?: string;

  @Prop()
  db_collection?: string;

  @Prop()
  db_statement?: string;

  // System metrics
  @Prop()
  system_cpu_usage?: number;

  @Prop()
  system_memory_usage?: number;

  @Prop()
  system_memory_available?: number;

  @Prop([Number])
  system_load_average?: number[];

  // Network metrics
  @Prop()
  net_peer_ip?: string;

  @Prop()
  net_peer_port?: number;

  @Prop()
  net_host_ip?: string;

  @Prop()
  net_host_port?: number;

  // Custom attributes
  @Prop({ type: Object })
  attributes?: Record<string, any>;

  // Vector embeddings for semantic search
  @Prop([Number])
  semantic_embedding?: number[];

  @Prop()
  semantic_content?: string;

  @Prop()
  cost_narrative?: string;

  // Cost Attribution Fields
  @Prop({
    type: {
      system_prompt_tokens: Number,
      system_prompt_cost: Number,
      tool_calls_count: Number,
      tool_calls_cost: Number,
      context_window_tokens: Number,
      context_window_cost: Number,
      retry_attempts: Number,
      retry_cost: Number,
      cache_miss_cost: Number,
      model_switching_cost: Number,
      network_latency_cost: Number,
      database_inefficiency_cost: Number,
      total_explained_cost: Number,
      unexplained_cost: Number,
      cost_anomaly_score: Number,
    },
    _id: false,
  })
  cost_attribution?: ICostAttribution;

  // Cost Analysis Metadata
  @Prop({
    type: {
      baseline_comparison: {
        expected_cost: Number,
        deviation_percentage: Number,
        deviation_reason: String,
      },
      cost_drivers: [
        {
          driver_type: {
            type: String,
            enum: [
              'system_prompt',
              'tool_calls',
              'context_window',
              'retries',
              'cache_miss',
              'model_switching',
              'network',
              'database',
            ],
          },
          cost_impact: Number,
          percentage_of_total: Number,
          explanation: String,
          optimization_potential: Number,
        },
      ],
      cost_story: String,
      optimization_recommendations: [
        {
          type: {
            type: String,
            enum: ['immediate', 'short_term', 'long_term'],
          },
          description: String,
          potential_savings: Number,
          implementation_effort: {
            type: String,
            enum: ['low', 'medium', 'high'],
          },
        },
      ],
    },
    _id: false,
  })
  cost_analysis?: ICostAnalysis;

  // Resource attributes
  @Prop({
    type: {
      service_version: String,
      deployment_environment: String,
      cloud_provider: String,
      cloud_region: String,
      cloud_availability_zone: String,
      host_name: String,
      host_type: String,
      container_id: String,
      process_pid: Number,
    },
    _id: false,
  })
  resource_attributes?: IResourceAttributes;

  // Events within the span
  @Prop({
    type: [
      {
        name: String,
        timestamp: Date,
        attributes: { type: Object },
      },
    ],
    _id: false,
  })
  events?: IEvent[];

  // Comprehensive networking metadata
  @Prop({
    type: {
      clientEndpoint: String,
      serverEndpoint: String,
      dataTransferred: {
        requestBytes: { type: Number, min: 0, default: 0 },
        responseBytes: { type: Number, min: 0, default: 0 },
        compressionRatio: Number,
      },
      connectionDetails: {
        protocol: String,
        cipher: String,
        keepAlive: Boolean,
        connectionReused: Boolean,
      },
      performanceBreakdown: {
        dnsLookupTime: Number,
        tcpConnectTime: Number,
        tlsHandshakeTime: Number,
        requestUploadTime: Number,
        responseDownloadTime: Number,
      },
    },
    _id: false,
  })
  networkingMetadata?: INetworkingMetadata;

  // Links to other spans
  @Prop({
    type: [
      {
        trace_id: String,
        span_id: String,
        attributes: { type: Object },
      },
    ],
    _id: false,
  })
  links?: ILink[];

  // Archival fields for cold storage
  @Prop({ type: Boolean, default: false, index: true })
  archived?: boolean;

  @Prop({ type: Date })
  archivedAt?: Date;

  @Prop({ type: String })
  archiveReason?: string;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const TelemetrySchema = SchemaFactory.createForClass(Telemetry);

// Compound indexes for common queries
TelemetrySchema.index({ timestamp: -1, tenant_id: 1 });
TelemetrySchema.index({ timestamp: -1, workspace_id: 1 });
TelemetrySchema.index({ timestamp: -1, status: 1 });
TelemetrySchema.index({ timestamp: -1, http_route: 1 });
TelemetrySchema.index({ gen_ai_model: 1, timestamp: -1 });
TelemetrySchema.index({ cost_usd: -1, timestamp: -1 });
TelemetrySchema.index({ duration_ms: -1, timestamp: -1 });
TelemetrySchema.index({ trace_id: 1, span_id: 1 });
TelemetrySchema.index({ parent_span_id: 1 });
TelemetrySchema.index({ error_type: 1, timestamp: -1 });

// TTL index to automatically delete old telemetry data
const ttlDays = parseInt(process.env.TELEMETRY_TTL_DAYS || '7');
TelemetrySchema.index(
  { timestamp: 1 },
  { expireAfterSeconds: ttlDays * 24 * 60 * 60 },
);
