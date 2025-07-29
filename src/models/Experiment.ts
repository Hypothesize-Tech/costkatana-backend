import mongoose, { Document, Schema } from 'mongoose';

export interface IExperiment extends Document {
    userId: mongoose.Types.ObjectId;
    name: string;
    type: 'model_comparison' | 'what_if' | 'fine_tuning';
    status: 'running' | 'completed' | 'failed';
    startTime: Date;
    endTime?: Date;
    results: any;
    metadata: {
        duration: number;
        iterations: number;
        confidence: number;
    };
    request: {
        prompt?: string;
        models?: Array<{
            provider: string;
            model: string;
            temperature?: number;
            maxTokens?: number;
        }>;
        evaluationCriteria?: string[];
        iterations?: number;
        comparisonMode?: 'quality' | 'cost' | 'speed' | 'comprehensive';
        executeOnBedrock?: boolean;
    };
    createdAt: Date;
    updatedAt: Date;
}

const ExperimentSchema = new Schema<IExperiment>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    type: {
        type: String,
        enum: ['model_comparison', 'what_if', 'fine_tuning'],
        required: true
    },
    status: {
        type: String,
        enum: ['running', 'completed', 'failed'],
        required: true,
        default: 'running'
    },
    startTime: {
        type: Date,
        required: true,
        default: Date.now
    },
    endTime: {
        type: Date
    },
    results: {
        type: Schema.Types.Mixed,
        default: {}
    },
    metadata: {
        duration: {
            type: Number,
            default: 0
        },
        iterations: {
            type: Number,
            default: 1
        },
        confidence: {
            type: Number,
            default: 0.5
        }
    },
    request: {
        prompt: String,
        models: [{
            provider: String,
            model: String,
            temperature: Number,
            maxTokens: Number
        }],
        evaluationCriteria: [String],
        iterations: Number,
        comparisonMode: {
            type: String,
            enum: ['quality', 'cost', 'speed', 'comprehensive']
        },
        executeOnBedrock: Boolean
    }
}, {
    timestamps: true
});

// Indexes for efficient querying
ExperimentSchema.index({ userId: 1, createdAt: -1 });
ExperimentSchema.index({ userId: 1, type: 1 });
ExperimentSchema.index({ userId: 1, status: 1 });

export const Experiment = mongoose.model<IExperiment>('Experiment', ExperimentSchema); 