/**
 * User Telemetry Configuration Model
 * 
 * Stores user's telemetry endpoint configurations so Cost Katana can
 * pull their telemetry data periodically.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IUserTelemetryConfig extends Document {
    userId: string;
    projectId?: string;
    
    // Telemetry endpoint type
    endpointType: 'otlp-http' | 'otlp-grpc' | 'tempo' | 'jaeger' | 'prometheus' | 'custom';
    
    // Endpoint details
    endpoint: string; // e.g., http://user-otel-collector:4318
    tracesEndpoint?: string; // Specific traces endpoint
    metricsEndpoint?: string; // Specific metrics endpoint
    
    // Authentication (if required)
    authType?: 'none' | 'bearer' | 'basic' | 'api-key' | 'custom-header';
    authToken?: string; // Encrypted
    authHeader?: string; // e.g., "Authorization", "X-API-Key"
    username?: string;
    password?: string; // Encrypted
    
    // TLS/SSL
    useTLS: boolean;
    tlsCertificate?: string; // Base64 encoded certificate
    skipTLSVerify?: boolean;
    
    // Sync configuration
    syncEnabled: boolean;
    syncIntervalMinutes: number; // How often to pull data
    lastSyncAt?: Date;
    lastSyncStatus?: 'success' | 'error' | 'partial';
    lastSyncError?: string;
    
    // Query configuration
    queryTimeRangeMinutes: number; // How far back to query each time
    queryFilters?: {
        serviceName?: string;
        environment?: string;
        tags?: Record<string, string>;
    };
    
    // Status
    isActive: boolean;
    healthCheckEnabled: boolean;
    lastHealthCheckAt?: Date;
    lastHealthCheckStatus?: 'healthy' | 'unhealthy' | 'unknown';
    
    // Stats
    totalRecordsSynced: number;
    totalSyncErrors: number;
    
    // Metadata
    createdAt: Date;
    updatedAt: Date;
}

const UserTelemetryConfigSchema = new Schema<IUserTelemetryConfig>({
    userId: {
        type: String,
        required: true,
        index: true
    },
    projectId: {
        type: String,
        index: true
    },
    endpointType: {
        type: String,
        enum: ['otlp-http', 'otlp-grpc', 'tempo', 'jaeger', 'prometheus', 'custom'],
        required: true
    },
    endpoint: {
        type: String,
        required: true
    },
    tracesEndpoint: String,
    metricsEndpoint: String,
    
    authType: {
        type: String,
        enum: ['none', 'bearer', 'basic', 'api-key', 'custom-header'],
        default: 'none'
    },
    authToken: String, // Encrypted
    authHeader: String,
    username: String,
    password: String, // Encrypted
    
    useTLS: {
        type: Boolean,
        default: false
    },
    tlsCertificate: String,
    skipTLSVerify: {
        type: Boolean,
        default: false
    },
    
    syncEnabled: {
        type: Boolean,
        default: true
    },
    syncIntervalMinutes: {
        type: Number,
        default: 5, // Default: sync every 5 minutes
        min: 1,
        max: 1440 // Max: once per day
    },
    lastSyncAt: Date,
    lastSyncStatus: {
        type: String,
        enum: ['success', 'error', 'partial']
    },
    lastSyncError: String,
    
    queryTimeRangeMinutes: {
        type: Number,
        default: 10, // Default: query last 10 minutes
        min: 1,
        max: 1440
    },
    queryFilters: {
        serviceName: String,
        environment: String,
        tags: Schema.Types.Mixed
    },
    
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    healthCheckEnabled: {
        type: Boolean,
        default: true
    },
    lastHealthCheckAt: Date,
    lastHealthCheckStatus: {
        type: String,
        enum: ['healthy', 'unhealthy', 'unknown']
    },
    
    totalRecordsSynced: {
        type: Number,
        default: 0
    },
    totalSyncErrors: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

// Indexes
UserTelemetryConfigSchema.index({ userId: 1, projectId: 1 });
UserTelemetryConfigSchema.index({ isActive: 1, syncEnabled: 1 });
UserTelemetryConfigSchema.index({ lastSyncAt: 1 });

export const UserTelemetryConfig = mongoose.model<IUserTelemetryConfig>(
    'UserTelemetryConfig',
    UserTelemetryConfigSchema
);

