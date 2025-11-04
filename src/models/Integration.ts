import mongoose, { Document, Schema } from 'mongoose';
import { encryptData, decryptData } from '../utils/encryption';

export type IntegrationType = 
    | 'slack_webhook' 
    | 'slack_oauth' 
    | 'discord_webhook' 
    | 'discord_oauth' 
    | 'linear_oauth'
    | 'jira_oauth'
    | 'custom_webhook';

export type IntegrationStatus = 'active' | 'inactive' | 'error' | 'pending';

export type AlertType = 
    | 'cost_threshold' 
    | 'usage_spike' 
    | 'optimization_available' 
    | 'weekly_summary' 
    | 'monthly_summary' 
    | 'error_rate' 
    | 'cost' 
    | 'optimization' 
    | 'anomaly' 
    | 'system';

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface AlertRoutingRule {
    enabled: boolean;
    severities: AlertSeverity[];
    template?: string;
    customMessage?: string;
}

export interface IntegrationCredentials {
    webhookUrl?: string;
    accessToken?: string;
    refreshToken?: string;
    botToken?: string;
    channelId?: string;
    channelName?: string;
    guildId?: string;
    guildName?: string;
    teamId?: string;
    teamName?: string;
    projectId?: string;
    issueId?: string;
    scope?: string;
    siteUrl?: string;
    cloudId?: string; 
    projectKey?: string;
    issueTypeId?: string;
    priorityId?: string;
    labels?: string[];
    components?: Array<{ id: string; name?: string }>;
    issueKey?: string;
}

export interface DeliveryConfig {
    retryEnabled: boolean;
    maxRetries: number;
    timeout: number;
    batchDelay?: number;
}

export interface IntegrationStats {
    totalDeliveries: number;
    successfulDeliveries: number;
    failedDeliveries: number;
    lastDeliveryAt?: Date;
    lastSuccessAt?: Date;
    lastFailureAt?: Date;
    averageResponseTime: number;
}

export interface IIntegration extends Document {
    userId: mongoose.Types.ObjectId;
    type: IntegrationType;
    name: string;
    description?: string;
    status: IntegrationStatus;
    
    // Encrypted credentials
    encryptedCredentials: string;
    
    // Alert routing configuration
    alertRouting: Map<AlertType, AlertRoutingRule>;
    
    // Delivery settings
    deliveryConfig: DeliveryConfig;
    
    // Statistics
    stats: IntegrationStats;
    
    // Metadata
    metadata?: Record<string, any>;
    lastHealthCheck?: Date;
    healthCheckStatus?: 'healthy' | 'degraded' | 'unhealthy';
    errorMessage?: string;
    
    createdAt: Date;
    updatedAt: Date;
    
    // Virtual methods
    getCredentials(): IntegrationCredentials;
    setCredentials(credentials: IntegrationCredentials): void;
}

const integrationSchema = new Schema<IIntegration>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    type: {
        type: String,
        enum: ['slack_webhook', 'slack_oauth', 'discord_webhook', 'discord_oauth', 'linear_oauth', 'jira_oauth', 'custom_webhook'],
        required: true
    },
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    description: {
        type: String,
        trim: true,
        maxlength: 500
    },
    status: {
        type: String,
        enum: ['active', 'inactive', 'error', 'pending'],
        default: 'active'
    },
    encryptedCredentials: {
        type: String,
        required: true
    },
    alertRouting: {
        type: Map,
        of: {
            enabled: {
                type: Boolean,
                default: true
            },
            severities: [{
                type: String,
                enum: ['low', 'medium', 'high', 'critical']
            }],
            template: String,
            customMessage: String
        },
        default: new Map()
    },
    deliveryConfig: {
        retryEnabled: {
            type: Boolean,
            default: true
        },
        maxRetries: {
            type: Number,
            default: 3,
            min: 0,
            max: 10
        },
        timeout: {
            type: Number,
            default: 30000,
            min: 1000,
            max: 120000
        },
        batchDelay: {
            type: Number,
            min: 0,
            max: 60000
        }
    },
    stats: {
        totalDeliveries: {
            type: Number,
            default: 0
        },
        successfulDeliveries: {
            type: Number,
            default: 0
        },
        failedDeliveries: {
            type: Number,
            default: 0
        },
        lastDeliveryAt: Date,
        lastSuccessAt: Date,
        lastFailureAt: Date,
        averageResponseTime: {
            type: Number,
            default: 0
        }
    },
    metadata: {
        type: Schema.Types.Mixed,
        default: {}
    },
    lastHealthCheck: Date,
    healthCheckStatus: {
        type: String,
        enum: ['healthy', 'degraded', 'unhealthy']
    },
    errorMessage: String
}, {
    timestamps: true
});

// Indexes for efficient queries
integrationSchema.index({ userId: 1, status: 1 });
integrationSchema.index({ userId: 1, type: 1 });
integrationSchema.index({ 'stats.lastDeliveryAt': -1 });

// Virtual methods for credential encryption/decryption
integrationSchema.methods.getCredentials = function(): IntegrationCredentials {
    try {
        const decrypted = decryptData(this.encryptedCredentials);
        return JSON.parse(decrypted);
    } catch (error) {
        throw new Error('Failed to decrypt integration credentials');
    }
};

integrationSchema.methods.setCredentials = function(credentials: IntegrationCredentials): void {
    const jsonString = JSON.stringify(credentials);
    this.encryptedCredentials = encryptData(jsonString);
};

export const Integration = mongoose.model<IIntegration>('Integration', integrationSchema);

