import mongoose, { Schema, Document } from 'mongoose';

export interface IAutomationConnection extends Document {
    userId: mongoose.Types.ObjectId;
    platform: 'zapier' | 'make' | 'n8n';
    name: string;
    description?: string;
    webhookUrl: string; // Generated unique webhook URL
    apiKey?: string; // Optional API key for authentication
    status: 'active' | 'inactive' | 'error';
    
    // Connection metadata
    metadata?: {
        workflowCount?: number;
        lastWorkflowName?: string;
        workflowQuota?: {
            current: number;
            limit: number;
            percentage: number;
            plan: string;
        };
        // Integration metadata for workflow analysis
        workflowMetadata?: {
            stepCount?: number;
            aiStepCount?: number;
            nonAIStepCount?: number;
            stepTypes?: Array<'ai' | 'action' | 'filter' | 'formatter' | 'webhook' | 'other'>;
            triggerType?: 'scheduled' | 'webhook' | 'polling' | 'manual';
            hasLoops?: boolean;
            hasConcurrentBranches?: boolean;
            complexityScore?: number; // 0-100
        };
        [key: string]: any;
    };
    
    // Statistics
    stats: {
        totalRequests: number;
        totalCost: number;
        totalTokens: number;
        lastActivityAt?: Date;
        lastRequestAt?: Date;
        averageCostPerRequest: number;
        averageTokensPerRequest: number;
    };
    
    // Health tracking
    lastHealthCheck?: Date;
    healthCheckStatus?: 'healthy' | 'degraded' | 'unhealthy';
    errorMessage?: string;
    
    createdAt: Date;
    updatedAt: Date;
}

const automationConnectionSchema = new Schema<IAutomationConnection>({
    _id: {
        type: String,
        required: true
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    platform: {
        type: String,
        enum: ['zapier', 'make', 'n8n'],
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
    webhookUrl: {
        type: String,
        required: true,
        unique: true
    },
    apiKey: {
        type: String,
        trim: true
    },
    status: {
        type: String,
        enum: ['active', 'inactive', 'error'],
        default: 'active'
    },
    metadata: {
        type: Schema.Types.Mixed,
        default: {}
    },
    stats: {
        totalRequests: {
            type: Number,
            default: 0
        },
        totalCost: {
            type: Number,
            default: 0
        },
        totalTokens: {
            type: Number,
            default: 0
        },
        lastActivityAt: Date,
        lastRequestAt: Date,
        averageCostPerRequest: {
            type: Number,
            default: 0
        },
        averageTokensPerRequest: {
            type: Number,
            default: 0
        }
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

// Indexes
automationConnectionSchema.index({ userId: 1, platform: 1 });
automationConnectionSchema.index({ userId: 1, status: 1 });
automationConnectionSchema.index({ 'stats.lastActivityAt': -1 });

// Method to update statistics
automationConnectionSchema.methods.updateStats = function(cost: number, tokens: number) {
    this.stats.totalRequests += 1;
    this.stats.totalCost += cost;
    this.stats.totalTokens += tokens;
    this.stats.lastActivityAt = new Date();
    this.stats.lastRequestAt = new Date();
    this.stats.averageCostPerRequest = this.stats.totalCost / this.stats.totalRequests;
    this.stats.averageTokensPerRequest = this.stats.totalTokens / this.stats.totalRequests;
    return this.save();
};

export const AutomationConnection = mongoose.model<IAutomationConnection>('AutomationConnection', automationConnectionSchema);

