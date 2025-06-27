import mongoose, { Schema } from 'mongoose';

export interface IUsage {
    _id?: any;
    userId: mongoose.Types.ObjectId;
    service: 'openai' | 'aws-bedrock' | 'google-ai' | 'anthropic' | 'huggingface' | 'cohere' | 'dashboard-analytics';
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
        [key: string]: any;
    };
    tags: string[];
    optimizationApplied: boolean;
    optimizationId?: mongoose.Types.ObjectId;
    errorOccurred: boolean;
    errorMessage?: string;
    ipAddress?: string;
    userAgent?: string;
    createdAt: Date;
    updatedAt: Date;
}

const usageSchema = new Schema<IUsage>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
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
}, {
    timestamps: true,
});

// Compound indexes for efficient querying
usageSchema.index({ userId: 1, createdAt: -1 });
usageSchema.index({ userId: 1, service: 1 });
usageSchema.index({ userId: 1, model: 1 });
usageSchema.index({ cost: -1 });
usageSchema.index({ totalTokens: -1 });
usageSchema.index({ tags: 1 });
usageSchema.index({ createdAt: -1 });

// Text index for prompt searching
usageSchema.index({ prompt: 'text' });

// Virtual for cost per token
usageSchema.virtual('costPerToken').get(function () {
    return this.totalTokens > 0 ? this.cost / this.totalTokens : 0;
});

export const Usage = mongoose.model<IUsage>('Usage', usageSchema);