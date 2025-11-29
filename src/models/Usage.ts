import mongoose, { Schema } from 'mongoose';

export interface IUsage {
    _id?: any;
    userId: mongoose.Types.ObjectId;
    projectId?: mongoose.Types.ObjectId;
    service: 'openai' | 'aws-bedrock' | 'google-ai' | 'anthropic' | 'huggingface' | 'cohere' | 'dashboard-analytics' | string;
    model: string;
    prompt: string;
    completion?: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number;
    responseTime: number;
    metadata: {
        requestId?: string;
        endpoint?: string;
        temperature?: number;
        maxTokens?: number;
        topP?: number;
        frequencyPenalty?: number;
        presencePenalty?: number;
        promptTemplateId?: mongoose.Types.ObjectId;
        [key: string]: any;
    };
    tags: string[];
    costAllocation?: {
        department?: string;
        team?: string;
        purpose?: string;
        client?: string;
        [key: string]: any;
    };
    optimizationApplied: boolean;
    optimizationId?: mongoose.Types.ObjectId;
    errorOccurred: boolean;
    errorMessage?: string;
    // Enhanced error tracking
    httpStatusCode?: number;
    errorType?: 'client_error' | 'server_error' | 'network_error' | 'auth_error' | 'rate_limit' | 'timeout' | 'validation_error' | 'integration_error';
    errorDetails?: {
        code?: string;
        type?: string;
        statusText?: string;
        requestId?: string;
        timestamp?: Date;
        endpoint?: string;
        method?: string;
        userAgent?: string;
        clientVersion?: string;
        [key: string]: any;
    };
    isClientError?: boolean; // Quick flag for 4xx errors
    isServerError?: boolean; // Quick flag for 5xx errors
    ipAddress?: string;
    userAgent?: string;
    workflowId?: string;
    workflowName?: string;
    workflowStep?: string;
    workflowSequence?: number;
    // Automation platform tracking
    automationPlatform?: 'zapier' | 'make' | 'n8n';
    automationConnectionId?: string;
    // Template usage tracking
    templateUsage?: {
        templateId: mongoose.Types.ObjectId;
        templateName: string;
        templateCategory: string;
        variablesResolved: Array<{
            variableName: string;
            value: string; // truncated if sensitive
            confidence: number;
            source: 'user_provided' | 'context_inferred' | 'default' | 'missing';
            reasoning?: string;
        }>;
        context: 'chat' | 'optimization' | 'visual-compliance' | 'workflow' | 'api';
        templateVersion?: number;
    };
    createdAt: Date;
    updatedAt: Date;
    // Email fields for user and customer identification
    userEmail?: string;
    customerEmail?: string;
}

const usageSchema = new Schema<IUsage>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    projectId: {
        type: Schema.Types.ObjectId,
        ref: 'Project'
    },
    service: {
        type: String,
        enum: ['openai', 'aws-bedrock', 'google-ai', 'anthropic', 'huggingface', 'cohere', 'dashboard-analytics'],
        required: true
    },
    model: {
        type: String,
        required: true
    },
    prompt: {
        type: String,
        default: ''
    },
    completion: String,
    promptTokens: {
        type: Number,
        required: true,
        min: 0,
    },
    completionTokens: {
        type: Number,
        required: true,
        min: 0,
    },
    totalTokens: {
        type: Number,
        required: true,
        min: 0,
    },
    cost: {
        type: Number,
        required: true,
        min: 0,
        default: 0
    },
    responseTime: {
        type: Number,
        required: true,
        min: 0,
        default: 0
    },
    metadata: {
        type: Schema.Types.Mixed,
        default: {},
    },
    tags: [{
        type: String,
        trim: true,
    }],
    costAllocation: {
        type: Schema.Types.Mixed,
        default: {}
    },
    optimizationApplied: {
        type: Boolean,
        default: false,
    },
    optimizationId: {
        type: Schema.Types.ObjectId,
        ref: 'Optimization',
    },
    errorOccurred: {
        type: Boolean,
        default: false,
    },
    errorMessage: String,
    // Enhanced error tracking schema
    httpStatusCode: {
        type: Number,
        min: 100,
        max: 599
    },
    errorType: {
        type: String,
        enum: ['client_error', 'server_error', 'network_error', 'auth_error', 'rate_limit', 'timeout', 'validation_error', 'integration_error']
    },
    errorDetails: {
        type: Schema.Types.Mixed,
        default: {}
    },
    isClientError: {
        type: Boolean,
        default: false
    },
    isServerError: {
        type: Boolean,
        default: false
    },
    // Email fields for user and customer identification
    userEmail: {
        type: String,
        trim: true,
        lowercase: true,
        sparse: true
    },
    customerEmail: {
        type: String,
        trim: true,
        lowercase: true,
        sparse: true
    },
    ipAddress: String,
    userAgent: String,
    // Workflow tracking fields
    workflowId: {
        type: String
    },
    workflowName: {
        type: String
    },
    workflowStep: {
        type: String
    },
    workflowSequence: {
        type: Number,
        min: 0
    },
    // Automation platform tracking schema
    automationPlatform: {
        type: String,
        enum: ['zapier', 'make', 'n8n']
    },
    automationConnectionId: {
        type: String,
        ref: 'AutomationConnection'
    },
    // Template usage tracking schema
    templateUsage: {
        templateId: {
            type: Schema.Types.ObjectId,
            ref: 'PromptTemplate'
        },
        templateName: String,
        templateCategory: {
            type: String,
            enum: ['general', 'coding', 'writing', 'analysis', 'creative', 'business', 'custom', 'visual-compliance']
        },
        variablesResolved: [{
            variableName: String,
            value: String,
            confidence: Number,
            source: {
                type: String,
                enum: ['user_provided', 'context_inferred', 'default', 'missing']
            },
            reasoning: String
        }],
        context: {
            type: String,
            enum: ['chat', 'optimization', 'visual-compliance', 'workflow', 'api']
        },
        templateVersion: Number
    }
}, {
    timestamps: true,
});

// 1. Primary user queries (most common)
usageSchema.index({ userId: 1, createdAt: -1 });

// 2. Time-based queries
usageSchema.index({ createdAt: -1 });

// 3. Service filtering
usageSchema.index({ service: 1, createdAt: -1 });

// 4. Cost analysis
usageSchema.index({ cost: -1 });

// 5. Error tracking (only if actually used)
usageSchema.index({ errorOccurred: 1, createdAt: -1 });

// 6. Text search for prompts (if needed)
usageSchema.index({ prompt: 'text', completion: 'text' });

// 7. Template usage tracking
usageSchema.index({ 'templateUsage.templateId': 1, createdAt: -1 });
usageSchema.index({ 'templateUsage.context': 1, createdAt: -1 });
usageSchema.index({ userId: 1, 'templateUsage.templateId': 1, createdAt: -1 });

// 8. Automation platform tracking
usageSchema.index({ automationPlatform: 1, createdAt: -1 });
usageSchema.index({ automationConnectionId: 1, createdAt: -1 });
usageSchema.index({ userId: 1, automationPlatform: 1, createdAt: -1 });
usageSchema.index({ workflowId: 1, automationPlatform: 1, createdAt: -1 });

// Virtual for cost per token
usageSchema.virtual('costPerToken').get(function () {
    return this.totalTokens > 0 ? this.cost / this.totalTokens : 0;
});

// Static method to get usage summary for a user
usageSchema.statics.getUserSummary = async function (userId: string, startDate?: Date, endDate?: Date) {
    const match: any = { userId: new mongoose.Types.ObjectId(userId) };

    if (startDate || endDate) {
        match.createdAt = {};
        if (startDate) match.createdAt.$gte = startDate;
        if (endDate) match.createdAt.$lte = endDate;
    }

    return this.aggregate([
        { $match: match },
        {
            $group: {
                _id: null,
                totalCost: { $sum: '$cost' },
                totalTokens: { $sum: '$totalTokens' },
                totalCalls: { $sum: 1 },
                avgCost: { $avg: '$cost' },
                avgTokens: { $avg: '$totalTokens' },
                avgResponseTime: { $avg: '$responseTime' },
            }
        }
    ]);
};

export const Usage = mongoose.model<IUsage>('Usage', usageSchema);