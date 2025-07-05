import mongoose, { Schema } from 'mongoose';

export interface IQualityScore {
    _id?: any;
    userId: any;
    usageId?: any; // Reference to the usage record
    optimizationId?: any; // Reference to the optimization record
    originalScore?: number; // Quality score before optimization (1-100)
    optimizedScore: number; // Quality score after optimization (1-100)
    scoringMethod: 'ai_model' | 'user_feedback' | 'automated' | 'hybrid';
    scoringModel?: string; // Which model was used for scoring
    scoringCriteria?: {
        accuracy?: number;
        relevance?: number;
        completeness?: number;
        coherence?: number;
        factuality?: number;
    };
    costSavings: {
        amount: number;
        percentage: number;
    };
    optimizationType: string[]; // e.g., ['context_trimming', 'model_switching']
    userFeedback?: {
        rating?: 1 | 2 | 3 | 4 | 5;
        isAcceptable: boolean;
        comment?: string;
        timestamp: Date;
    };
    metadata?: {
        promptLength?: number;
        responseLength?: number;
        processingTime?: number;
        optimizationDetails?: any;
    };
    createdAt: Date;
    updatedAt: Date;
}

const QualityScoreSchema = new Schema<IQualityScore>({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    usageId: { type: Schema.Types.ObjectId, ref: 'Usage' },
    optimizationId: { type: Schema.Types.ObjectId, ref: 'Optimization' },
    originalScore: { type: Number, min: 1, max: 100 },
    optimizedScore: { type: Number, required: true, min: 1, max: 100 },
    scoringMethod: {
        type: String,
        enum: ['ai_model', 'user_feedback', 'automated', 'hybrid'],
        required: true
    },
    scoringModel: String,
    scoringCriteria: {
        accuracy: { type: Number, min: 0, max: 100 },
        relevance: { type: Number, min: 0, max: 100 },
        completeness: { type: Number, min: 0, max: 100 },
        coherence: { type: Number, min: 0, max: 100 },
        factuality: { type: Number, min: 0, max: 100 }
    },
    costSavings: {
        amount: { type: Number, required: true },
        percentage: { type: Number, required: true }
    },
    optimizationType: [{ type: String, required: true }],
    userFeedback: {
        rating: { type: Number, min: 1, max: 5 },
        isAcceptable: Boolean,
        comment: String,
        timestamp: Date
    },
    metadata: {
        promptLength: Number,
        responseLength: Number,
        processingTime: Number,
        optimizationDetails: Schema.Types.Mixed
    }
}, {
    timestamps: true
});

// Indexes for efficient querying
QualityScoreSchema.index({ userId: 1, createdAt: -1 });
QualityScoreSchema.index({ optimizedScore: 1, costSavings: -1 });
QualityScoreSchema.index({ optimizationType: 1 });

// Virtual for quality delta
QualityScoreSchema.virtual('qualityDelta').get(function () {
    if (this.originalScore) {
        return this.optimizedScore - this.originalScore;
    }
    return null;
});

// Virtual for quality retention percentage
QualityScoreSchema.virtual('qualityRetention').get(function () {
    if (this.originalScore) {
        return (this.optimizedScore / this.originalScore) * 100;
    }
    return 100;
});

export const QualityScore = mongoose.model<IQualityScore>('QualityScore', QualityScoreSchema); 