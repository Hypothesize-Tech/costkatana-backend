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
  
  // Vector embeddings for semantic search
  semantic_embedding?: number[];
  semantic_content?: string; // The text that was embedded
  cost_narrative?: string; // AI-generated cost story
  
  // Cost Attribution Fields
  cost_attribution?: {
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
  };
  
  // Cost Analysis Metadata
  cost_analysis?: {
    baseline_comparison?: {
      expected_cost?: number;
      deviation_percentage?: number;
      deviation_reason?: string;
    };
    cost_drivers?: Array<{
      driver_type: 'system_prompt' | 'tool_calls' | 'context_window' | 'retries' | 'cache_miss' | 'model_switching' | 'network' | 'database';
      cost_impact: number;
      percentage_of_total: number;
      explanation: string;
      optimization_potential: number;
    }>;
    cost_story?: string; // AI-generated explanation of why this cost occurred
    optimization_recommendations?: Array<{
      type: 'immediate' | 'short_term' | 'long_term';
      description: string;
      potential_savings: number;
      implementation_effort: 'low' | 'medium' | 'high';
    }>;
  };
  
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
  
  // NEW: Comprehensive networking metadata
  networkingMetadata?: {
    clientEndpoint: string;
    serverEndpoint: string;
    dataTransferred: {
      requestBytes: number;
      responseBytes: number;
      compressionRatio?: number;
    };
    connectionDetails: {
      protocol: string;
      cipher?: string;
      keepAlive: boolean;
      connectionReused: boolean;
    };
    performanceBreakdown: {
      dnsLookupTime?: number;
      tcpConnectTime?: number;
      tlsHandshakeTime?: number;
      requestUploadTime?: number;
      responseDownloadTime?: number;
    };
  };
  
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
  parent_span_id: { type: String },
  
  // Context
  tenant_id: { type: String, required: true, index: true },
  workspace_id: { type: String, required: true, index: true },
  user_id: { type: String, required: true, index: true },
  request_id: { type: String, required: true, index: true },
  
  // Timing
  timestamp: { type: Date, required: true },
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
    enum: ['success', 'error', 'unset']
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
  
  // Vector embeddings for semantic search
  semantic_embedding: [Number], // Array of numbers for vector embedding
  semantic_content: String, // The text that was embedded
  cost_narrative: String, // AI-generated cost story
  
  // Cost Attribution Fields
  cost_attribution: {
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
    cost_anomaly_score: Number
  },
  
  // Cost Analysis Metadata
  cost_analysis: {
    baseline_comparison: {
      expected_cost: Number,
      deviation_percentage: Number,
      deviation_reason: String
    },
    cost_drivers: [{
      driver_type: {
        type: String,
        enum: ['system_prompt', 'tool_calls', 'context_window', 'retries', 'cache_miss', 'model_switching', 'network', 'database']
      },
      cost_impact: Number,
      percentage_of_total: Number,
      explanation: String,
      optimization_potential: Number
    }],
    cost_story: String, // AI-generated explanation of why this cost occurred
    optimization_recommendations: [{
      type: {
        type: String,
        enum: ['immediate', 'short_term', 'long_term']
      },
      description: String,
      potential_savings: Number,
      implementation_effort: {
        type: String,
        enum: ['low', 'medium', 'high']
      }
    }]
  },
  
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
  
  // NEW: Comprehensive networking metadata schema
  networkingMetadata: {
    clientEndpoint: String,
    serverEndpoint: String,
    dataTransferred: {
      requestBytes: {
        type: Number,
        min: 0,
        default: 0
      },
      responseBytes: {
        type: Number,
        min: 0,
        default: 0
      },
      compressionRatio: Number
    },
    connectionDetails: {
      protocol: String,
      cipher: String,
      keepAlive: Boolean,
      connectionReused: Boolean
    },
    performanceBreakdown: {
      dnsLookupTime: Number,
      tcpConnectTime: Number,
      tlsHandshakeTime: Number,
      requestUploadTime: Number,
      responseDownloadTime: Number
    }
  },
  
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

// TTL index to automatically delete old telemetry data
// Configurable via TELEMETRY_TTL_DAYS environment variable (default: 7 days)
const ttlDays = parseInt(process.env.TELEMETRY_TTL_DAYS || '7');
TelemetrySchema.index({ timestamp: 1 }, { expireAfterSeconds: ttlDays * 24 * 60 * 60 });

// Vector search index for semantic queries (MongoDB Atlas Vector Search)
// Note: This needs to be created manually in MongoDB Atlas or via MongoDB CLI
// For Atlas Vector Search, create index via Atlas UI or mongosh:
/*
db.telemetries.createSearchIndex({
  "name": "semantic_search_index",
  "definition": {
    "fields": [
      {
        "type": "vector",
        "path": "semantic_embedding",
        "numDimensions": 1536,
        "similarity": "cosine"
      },
      {
        "type": "filter",
        "path": "tenant_id"
      },
      {
        "type": "filter", 
        "path": "workspace_id"
      },
      {
        "type": "filter",
        "path": "timestamp"
      }
    ]
  }
});
*/

export const Telemetry = mongoose.model<ITelemetry>('Telemetry', TelemetrySchema);
