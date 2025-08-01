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
    ipAddress?: string;
    userAgent?: string;
    workflowId?: string;
    workflowName?: string;
    workflowStep?: string;
    workflowSequence?: number;
    createdAt: Date;
    updatedAt: Date;
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
    ipAddress: String,
    userAgent: String,
    // Workflow tracking fields
    workflowId: {
        type: String,
        index: true  // Index for efficient workflow grouping
    },
    workflowName: {
        type: String,
        index: true  // Index for workflow type filtering
    },
    workflowStep: {
        type: String
    },
    workflowSequence: {
        type: Number,
        min: 0
    },
}, {
    timestamps: true,
});

// Compound indexes for efficient querying
usageSchema.index({ projectId: 1, createdAt: -1 });
usageSchema.index({ service: 1, createdAt: -1 });
usageSchema.index({ model: 1, createdAt: -1 });
usageSchema.index({ cost: -1 });
usageSchema.index({ 'costAllocation.department': 1 });
usageSchema.index({ 'costAllocation.team': 1 });
usageSchema.index({ 'costAllocation.client': 1 });

// Workflow indexes for efficient workflow queries
usageSchema.index({ workflowId: 1, workflowSequence: 1 }); // For workflow step ordering
usageSchema.index({ userId: 1, workflowId: 1, createdAt: -1 }); // For user workflow queries
usageSchema.index({ workflowName: 1, createdAt: -1 }); // For workflow type analytics

// Text index for prompt searching
usageSchema.index({ prompt: 'text', completion: 'text' });

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

// Create indexes for better query performance
usageSchema.index({ userId: 1, createdAt: -1 }); // For user-based time range queries
usageSchema.index({ userId: 1, tags: 1, createdAt: -1 }); // For tag-based analytics
usageSchema.index({ userId: 1, service: 1, model: 1, createdAt: -1 }); // For service/model analysis
usageSchema.index({ createdAt: -1 }); // For time-based operations
usageSchema.index({ tags: 1 }); // For tag operations
usageSchema.index({ userId: 1, cost: -1 }); // For cost-based sorting

export const Usage = mongoose.model<IUsage>('Usage', usageSchema);