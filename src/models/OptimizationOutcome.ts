import mongoose, { Schema, Document } from 'mongoose';

// ============================================================================
// OPTIMIZATION OUTCOME MODEL
// ============================================================================

export interface IOptimizationOutcome extends Document {
    optimizationId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    timestamp: Date;
    optimizationType: string;
    context: {
        originalModel: string;
        suggestedModel: string;
        promptComplexity: number;
        userTier: string;
        taskType?: string;
        promptLength?: number;
        estimatedCost?: number;
    };
    outcome: {
        applied: boolean;
        userApproved: boolean;
        costSaved: number;
        qualityScore?: number; // 0-1 scale
        userRating?: number; // 1-5 scale
        errorOccurred?: boolean;
        executionTime?: number;
    };
    learningSignals?: {
        acceptanceRate?: number;
        successRate?: number;
        averageSavings?: number;
        confidenceScore?: number;
    };
}

const OptimizationOutcomeSchema = new Schema<IOptimizationOutcome>({
    optimizationId: { 
        type: Schema.Types.ObjectId, 
        required: true,
        index: true 
    },
    userId: { 
        type: Schema.Types.ObjectId, 
        ref: 'User', 
        required: true,
        index: true 
    },
    timestamp: { 
        type: Date, 
        required: true, 
        default: Date.now,
        index: true 
    },
    optimizationType: { 
        type: String, 
        required: true,
        index: true 
    },
    context: {
        originalModel: { type: String, required: true },
        suggestedModel: { type: String, required: true },
        promptComplexity: { type: Number, required: true },
        userTier: { type: String, required: true },
        taskType: { type: String },
        promptLength: { type: Number },
        estimatedCost: { type: Number }
    },
    outcome: {
        applied: { type: Boolean, required: true, default: false },
        userApproved: { type: Boolean, required: true, default: false },
        costSaved: { type: Number, required: true, default: 0 },
        qualityScore: { type: Number, min: 0, max: 1 },
        userRating: { type: Number, min: 1, max: 5 },
        errorOccurred: { type: Boolean, default: false },
        executionTime: { type: Number }
    },
    learningSignals: {
        acceptanceRate: { type: Number, min: 0, max: 1 },
        successRate: { type: Number, min: 0, max: 1 },
        averageSavings: { type: Number },
        confidenceScore: { type: Number, min: 0, max: 1 }
    }
}, {
    timestamps: true,
    collection: 'optimization_outcomes'
});

// Compound indexes for learning queries
OptimizationOutcomeSchema.index({ userId: 1, optimizationType: 1, timestamp: -1 });
OptimizationOutcomeSchema.index({ 'context.originalModel': 1, 'context.suggestedModel': 1 });
OptimizationOutcomeSchema.index({ 'outcome.applied': 1, 'outcome.userApproved': 1 });
OptimizationOutcomeSchema.index({ optimizationType: 1, 'outcome.applied': 1, timestamp: -1 });

export const OptimizationOutcome = mongoose.model<IOptimizationOutcome>('OptimizationOutcome', OptimizationOutcomeSchema);

