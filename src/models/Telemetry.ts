import mongoose, { Schema, Document } from 'mongoose';

export interface ITelemetry extends Document {
  // Trace identifiers
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  
  // Context
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  request_id: string;
  
  // Timing
  timestamp: Date;
  start_time: Date;
  end_time: Date;
  duration_ms: number;
  
  // Service info
  service_name: string;
  operation_name: string;
  span_kind: 'server' | 'client' | 'producer' | 'consumer' | 'internal';
  
  // Status
  status: 'success' | 'error' | 'unset';
  status_message?: string;
  
  // HTTP details
  http_route?: string;
  http_method?: string;
  http_status_code?: number;
  http_url?: string;
  http_target?: string;
  http_host?: string;
  http_scheme?: string;
  http_user_agent?: string;
  
  // Error details
  error_type?: string;
  error_message?: string;
  error_stack?: string;
  
  // GenAI specific fields
  gen_ai_system?: string;
  gen_ai_model?: string;
  gen_ai_operation?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost_usd?: number;
  temperature?: number;
  max_tokens?: number;
  
  // Performance breakdowns
  database_latency_ms?: number;
  cache_latency_ms?: number;
  external_api_latency_ms?: number;
  processing_latency_ms?: number;
  queue_wait_ms?: number;
  
  // Database operations
  db_system?: string;
  db_operation?: string;
  db_name?: string;
  db_collection?: string;
  db_statement?: string;
  
  // System metrics at time of request
  system_cpu_usage?: number;
  system_memory_usage?: number;
  system_memory_available?: number;
  system_load_average?: number[];
  
  // Network metrics
  net_peer_ip?: string;
  net_peer_port?: number;
  net_host_ip?: string;
  net_host_port?: number;
  
  // Custom attributes
  attributes?: Record<string, any>;
  
  // Resource attributes
  resource_attributes?: {
    service_version?: string;
    deployment_environment?: string;
    cloud_provider?: string;
    cloud_region?: string;
    cloud_availability_zone?: string;
    host_name?: string;
    host_type?: string;
    container_id?: string;
    process_pid?: number;
  };
  
  // Events within the span
  events?: Array<{
    name: string;
    timestamp: Date;
    attributes?: Record<string, any>;
  }>;
  
  // Links to other spans
  links?: Array<{
    trace_id: string;
    span_id: string;
    attributes?: Record<string, any>;
  }>;
}

const TelemetrySchema = new Schema<ITelemetry>({
  // Trace identifiers
  trace_id: { type: String, required: true, index: true },
  span_id: { type: String, required: true, index: true },
  parent_span_id: { type: String, index: true },
  
  // Context
  tenant_id: { type: String, required: true, index: true },
  workspace_id: { type: String, required: true, index: true },
  user_id: { type: String, required: true, index: true },
  request_id: { type: String, required: true, index: true },
  
  // Timing
  timestamp: { type: Date, required: true, index: true },
  start_time: { type: Date, required: true },
  end_time: { type: Date, required: true },
  duration_ms: { type: Number, required: true, index: true },
  
  // Service info
  service_name: { type: String, required: true, index: true },
  operation_name: { type: String, required: true, index: true },
  span_kind: { 
    type: String, 
    required: true,
    enum: ['server', 'client', 'producer', 'consumer', 'internal']
  },
  
  // Status
  status: { 
    type: String, 
    required: true, 
    enum: ['success', 'error', 'unset'],
    index: true 
  },
  status_message: String,
  
  // HTTP details
  http_route: { type: String, index: true },
  http_method: { type: String, index: true },
  http_status_code: { type: Number, index: true },
  http_url: String,
  http_target: String,
  http_host: String,
  http_scheme: String,
  http_user_agent: String,
  
  // Error details
  error_type: { type: String, index: true },
  error_message: String,
  error_stack: String,
  
  // GenAI specific fields
  gen_ai_system: { type: String, index: true },
  gen_ai_model: { type: String, index: true },
  gen_ai_operation: String,
  prompt_tokens: Number,
  completion_tokens: Number,
  total_tokens: Number,
  cost_usd: { type: Number, index: true },
  temperature: Number,
  max_tokens: Number,
  
  // Performance breakdowns
  database_latency_ms: Number,
  cache_latency_ms: Number,
  external_api_latency_ms: Number,
  processing_latency_ms: Number,
  queue_wait_ms: Number,
  
  // Database operations
  db_system: String,
  db_operation: String,
  db_name: String,
  db_collection: String,
  db_statement: String,
  
  // System metrics
  system_cpu_usage: Number,
  system_memory_usage: Number,
  system_memory_available: Number,
  system_load_average: [Number],
  
  // Network metrics
  net_peer_ip: String,
  net_peer_port: Number,
  net_host_ip: String,
  net_host_port: Number,
  
  // Custom attributes
  attributes: { type: Schema.Types.Mixed },
  
  // Resource attributes
  resource_attributes: {
    service_version: String,
    deployment_environment: String,
    cloud_provider: String,
    cloud_region: String,
    cloud_availability_zone: String,
    host_name: String,
    host_type: String,
    container_id: String,
    process_pid: Number
  },
  
  // Events
  events: [{
    name: String,
    timestamp: Date,
    attributes: Schema.Types.Mixed
  }],
  
  // Links
  links: [{
    trace_id: String,
    span_id: String,
    attributes: Schema.Types.Mixed
  }]
}, {
  timestamps: true
});

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

// TTL index to automatically delete old telemetry data after 30 days
TelemetrySchema.index({ timestamp: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const Telemetry = mongoose.model<ITelemetry>('Telemetry', TelemetrySchema);
