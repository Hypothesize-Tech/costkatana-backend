import mongoose, { Document, Schema } from 'mongoose';

export interface IEvaluationJob extends Document {
    userId: mongoose.Types.ObjectId;
    name: string;
    description?: string;
    
    // What's being evaluated
    fineTuneJobId?: mongoose.Types.ObjectId; // Associated fine-tune job
    modelId: string; // Model being evaluated
    datasetId: mongoose.Types.ObjectId; // Test dataset
    datasetVersion: string;
    
    // Evaluation configuration
    evaluationType: 'accuracy' | 'quality' | 'cost-effectiveness' | 'comprehensive';
    metrics: string[]; // ['accuracy', 'bleu', 'rouge', 'perplexity', 'cost-per-token']
    benchmarks?: string[]; // External benchmarks to compare against
    
    // Status and progress
    status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
    progress: {
        percentage: number;
        currentStep: string;
        totalSteps: number;
        completedSteps: number;
        lastUpdated: Date;
    };
    
    // Results
    results: {
        overallScore: number; // 0-100 overall performance score
        metrics: Record<string, number>; // Individual metric scores
        benchmarkComparison?: {
            baseline: Record<string, number>;
            improvement: Record<string, number>;
            percentageChange: Record<string, number>;
        };
        costAnalysis: {
            averageCostPerRequest: number;
            totalEvaluationCost: number;
            costEfficiencyScore: number; // Cost vs quality ratio
        };
        qualityAnalysis: {
            humanLikenessScore: number; // 0-100
            coherenceScore: number;
            relevanceScore: number;
            safetyScore: number;
        };
        recommendations: string[];
    };
    
    // Timing and cost
    timing: {
        queuedAt: Date;
        startedAt?: Date;
        completedAt?: Date;
        estimatedDuration?: number;
        actualDuration?: number;
    };
    
    cost: {
        estimated: number;
        actual?: number;
        currency: string;
    };
    
    // Error handling
    error?: {
        code: string;
        message: string;
        details?: any;
        timestamp: Date;
    };
    
    // Integration tracking
    integration: {
        triggeredBy?: 'manual' | 'fine-tune-completion' | 'scheduled';
        parentJobId?: string; // If triggered by fine-tune job
        childEvaluations: string[]; // Sub-evaluations spawned from this one
    };
    
    createdAt: Date;
    updatedAt: Date;
}

const evaluationJobSchema = new Schema<IEvaluationJob>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    description: {
        type: String,
        maxlength: 500
    },
    
    // What's being evaluated
    fineTuneJobId: {
        type: Schema.Types.ObjectId,
        ref: 'FineTuneJob',
        required: false
    },
    modelId: {
        type: String,
        required: true
    },
    datasetId: {
        type: Schema.Types.ObjectId,
        ref: 'TrainingDataset',
        required: true
    },
    datasetVersion: {
        type: String,
        required: true
    },
    
    // Evaluation configuration
    evaluationType: {
        type: String,
        enum: ['accuracy', 'quality', 'cost-effectiveness', 'comprehensive'],
        default: 'comprehensive'
    },
    metrics: [{
        type: String,
        enum: ['accuracy', 'bleu', 'rouge', 'perplexity', 'cost-per-token', 'latency', 'safety']
    }],
    benchmarks: [String],
    
    // Status and progress
    status: {
        type: String,
        enum: ['queued', 'running', 'completed', 'failed', 'cancelled'],
        default: 'queued',
        index: true
    },
    progress: {
        percentage: { type: Number, min: 0, max: 100, default: 0 },
        currentStep: { type: String, default: 'Initializing' },
        totalSteps: { type: Number, default: 5 },
        completedSteps: { type: Number, default: 0 },
        lastUpdated: { type: Date, default: Date.now }
    },
    
    // Results
    results: {
        overallScore: { type: Number, min: 0, max: 100, default: 0 },
        metrics: { type: Map, of: Number, default: {} },
        benchmarkComparison: {
            baseline: { type: Map, of: Number, default: {} },
            improvement: { type: Map, of: Number, default: {} },
            percentageChange: { type: Map, of: Number, default: {} }
        },
        costAnalysis: {
            averageCostPerRequest: { type: Number, default: 0 },
            totalEvaluationCost: { type: Number, default: 0 },
            costEfficiencyScore: { type: Number, min: 0, max: 100, default: 0 }
        },
        qualityAnalysis: {
            humanLikenessScore: { type: Number, min: 0, max: 100, default: 0 },
            coherenceScore: { type: Number, min: 0, max: 100, default: 0 },
            relevanceScore: { type: Number, min: 0, max: 100, default: 0 },
            safetyScore: { type: Number, min: 0, max: 100, default: 0 }
        },
        recommendations: [String]
    },
    
    // Timing and cost
    timing: {
        queuedAt: { type: Date, default: Date.now },
        startedAt: Date,
        completedAt: Date,
        estimatedDuration: Number,
        actualDuration: Number
    },
    
    cost: {
        estimated: { type: Number, required: true },
        actual: Number,
        currency: { type: String, default: 'USD' }
    },
    
    // Error handling
    error: {
        code: String,
        message: String,
        details: Schema.Types.Mixed,
        timestamp: Date
    },
    
    // Integration tracking
    integration: {
        triggeredBy: {
            type: String,
            enum: ['manual', 'fine-tune-completion', 'scheduled'],
            default: 'manual'
        },
        parentJobId: String,
        childEvaluations: [String]
    }
}, {
    timestamps: true
});

// Indexes for efficient queries
evaluationJobSchema.index({ userId: 1, status: 1 });
evaluationJobSchema.index({ userId: 1, createdAt: -1 });
evaluationJobSchema.index({ fineTuneJobId: 1 });
evaluationJobSchema.index({ modelId: 1 });
evaluationJobSchema.index({ 'timing.queuedAt': 1 });

// Methods
evaluationJobSchema.methods.updateProgress = function(progressData: Partial<IEvaluationJob['progress']>) {
    this.progress = { ...this.progress, ...progressData, lastUpdated: new Date() };
    return this.save();
};

evaluationJobSchema.methods.setError = function(error: IEvaluationJob['error']) {
    this.status = 'failed';
    this.error = { ...error, timestamp: new Date() };
    if (!this.timing.completedAt) {
        this.timing.completedAt = new Date();
    }
    return this.save();
};

evaluationJobSchema.methods.complete = function(results: Partial<IEvaluationJob['results']>) {
    this.status = 'completed';
    this.results = { ...this.results, ...results };
    this.progress.percentage = 100;
    this.timing.completedAt = new Date();
    
    // Calculate actual duration
    if (this.timing.startedAt) {
        this.timing.actualDuration = Math.floor(
            (this.timing.completedAt.getTime() - this.timing.startedAt.getTime()) / 1000
        );
    }
    
    return this.save();
};

export const EvaluationJob = mongoose.model<IEvaluationJob>('EvaluationJob', evaluationJobSchema);
