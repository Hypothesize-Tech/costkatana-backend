import mongoose, { Schema, Document } from 'mongoose';

export interface ITemplateExecution extends Document {
    _id: mongoose.Types.ObjectId;
    templateId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    variables: Record<string, any>;
    
    // Execution details
    modelUsed: string;
    modelRecommended?: string;
    recommendationFollowed: boolean;
    
    // Response data
    aiResponse: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    
    // Cost tracking
    actualCost: number;
    baselineCost: number;
    savingsAmount: number;
    savingsPercentage: number;
    
    // Performance
    latencyMs: number;
    
    // Metadata
    executedAt: Date;
    usageRecordId?: mongoose.Types.ObjectId; // Link to Usage collection
}

const TemplateExecutionSchema = new Schema<ITemplateExecution>({
    templateId: {
        type: Schema.Types.ObjectId,
        ref: 'PromptTemplate',
        required: true,
        index: true
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    variables: {
        type: Schema.Types.Mixed,
        default: {}
    },
    
    // Execution details
    modelUsed: {
        type: String,
        required: true,
        index: true
    },
    modelRecommended: {
        type: String
    },
    recommendationFollowed: {
        type: Boolean,
        default: false
    },
    
    // Response data
    aiResponse: {
        type: String,
        required: true
    },
    promptTokens: {
        type: Number,
        required: true,
        default: 0
    },
    completionTokens: {
        type: Number,
        required: true,
        default: 0
    },
    totalTokens: {
        type: Number,
        required: true,
        default: 0
    },
    
    // Cost tracking
    actualCost: {
        type: Number,
        required: true,
        default: 0
    },
    baselineCost: {
        type: Number,
        required: true,
        default: 0
    },
    savingsAmount: {
        type: Number,
        required: true,
        default: 0
    },
    savingsPercentage: {
        type: Number,
        required: true,
        default: 0
    },
    
    // Performance
    latencyMs: {
        type: Number,
        required: true,
        default: 0
    },
    
    // Metadata
    executedAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    usageRecordId: {
        type: Schema.Types.ObjectId,
        ref: 'Usage'
    }
}, {
    timestamps: true,
    collection: 'template_executions'
});

// Indexes for efficient queries
TemplateExecutionSchema.index({ templateId: 1, executedAt: -1 });
TemplateExecutionSchema.index({ userId: 1, executedAt: -1 });
TemplateExecutionSchema.index({ modelUsed: 1 });

export const TemplateExecution = mongoose.model<ITemplateExecution>('TemplateExecution', TemplateExecutionSchema);

