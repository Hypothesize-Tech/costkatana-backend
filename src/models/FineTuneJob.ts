import mongoose, { Document, Schema } from 'mongoose';

export interface IFineTuneJob extends Document {
    userId: mongoose.Types.ObjectId;
    name: string;
    description?: string;
    
    // Dataset and model info
    datasetId: mongoose.Types.ObjectId;
    datasetVersion: string;
    baseModel: string; // e.g., 'gpt-3.5-turbo', 'claude-3-haiku'
    provider: 'openai' | 'anthropic' | 'aws-bedrock' | 'azure' | 'cohere' | 'huggingface';
    
    // Job configuration
    hyperparameters: {
        learningRate?: number;
        batchSize?: number;
        epochs?: number;
        temperature?: number;
        maxTokens?: number;
        validationSplit?: number;
        earlyStoppingPatience?: number;
        customParameters?: Record<string, any>;
    };
    
    // Provider-specific configuration
    providerConfig: {
        // AWS Bedrock
        region?: string;
        roleArn?: string;
        s3BucketName?: string;
        modelName?: string;
        
        // OpenAI
        suffix?: string;
        
        // Common
        customizations?: Record<string, any>;
    };
    
    // Job status and tracking
    status: 'queued' | 'validating' | 'running' | 'succeeded' | 'failed' | 'cancelled';
    progress: {
        percentage: number; // 0-100
        currentEpoch?: number;
        totalEpochs?: number;
        currentStep?: number;
        totalSteps?: number;
        lastUpdated: Date;
    };
    
    // Provider job details
    providerJobId?: string; // External provider's job ID
    providerJobArn?: string; // For AWS
    
    // Metrics and results
    metrics: {
        trainingLoss?: number[];
        validationLoss?: number[];
        accuracy?: number[];
        perplexity?: number[];
        bleuScore?: number;
        rougeScore?: Record<string, number>;
        customMetrics?: Record<string, any>;
    };
    
    // Cost tracking
    cost: {
        estimated: number;
        actual?: number;
        currency: string;
        breakdown?: {
            trainingCost?: number;
            storageCost?: number;
            computeCost?: number;
            dataCost?: number;
        };
    };
    
    // Time tracking
    timing: {
        queuedAt: Date;
        startedAt?: Date;
        completedAt?: Date;
        estimatedDuration?: number; // in seconds
        actualDuration?: number; // in seconds
    };
    
    // Results
    results: {
        modelId?: string; // Fine-tuned model ID
        modelArn?: string; // AWS model ARN
        endpointUrl?: string; // Model endpoint
        downloadUrl?: string; // Model download URL
        evaluationResults?: {
            testLoss: number;
            testAccuracy: number;
            benchmarkScores?: Record<string, number>;
        };
    };
    
    // Error information
    error?: {
        code: string;
        message: string;
        details?: any;
        timestamp: Date;
    };
    
    // Evaluation integration
    evaluationIds: string[]; // Related evaluation job IDs
    
    // Lineage and relationships
    lineage: {
        parentJobId?: string; // If this is a retry/continuation
        childJobIds: string[]; // Derivative jobs
        experimentId?: string; // Related experiment
    };
    
    createdAt: Date;
    updatedAt: Date;
}

const fineTuneJobSchema = new Schema<IFineTuneJob>({
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
    
    // Dataset and model info
    datasetId: {
        type: Schema.Types.ObjectId,
        ref: 'TrainingDataset',
        required: true,
        index: true
    },
    datasetVersion: {
        type: String,
        required: true
    },
    baseModel: {
        type: String,
        required: true
    },
    provider: {
        type: String,
        enum: ['openai', 'anthropic', 'aws-bedrock', 'azure', 'cohere', 'huggingface'],
        required: true
    },
    
    // Job configuration
    hyperparameters: {
        learningRate: { type: Number, min: 0, max: 1 },
        batchSize: { type: Number, min: 1 },
        epochs: { type: Number, min: 1 },
        temperature: { type: Number, min: 0, max: 2 },
        maxTokens: { type: Number, min: 1 },
        validationSplit: { type: Number, min: 0, max: 0.5, default: 0.1 },
        earlyStoppingPatience: { type: Number, min: 1, default: 3 },
        customParameters: { type: Map, of: Schema.Types.Mixed, default: {} }
    },
    
    // Provider-specific configuration
    providerConfig: {
        region: String,
        roleArn: String,
        s3BucketName: String,
        modelName: String,
        suffix: String,
        customizations: { type: Map, of: Schema.Types.Mixed, default: {} }
    },
    
    // Job status and tracking
    status: {
        type: String,
        enum: ['queued', 'validating', 'running', 'succeeded', 'failed', 'cancelled'],
        default: 'queued',
        index: true
    },
    progress: {
        percentage: { type: Number, min: 0, max: 100, default: 0 },
        currentEpoch: Number,
        totalEpochs: Number,
        currentStep: Number,
        totalSteps: Number,
        lastUpdated: { type: Date, default: Date.now }
    },
    
    // Provider job details
    providerJobId: { type: String, index: true },
    providerJobArn: String,
    
    // Metrics and results
    metrics: {
        trainingLoss: [Number],
        validationLoss: [Number],
        accuracy: [Number],
        perplexity: [Number],
        bleuScore: Number,
        rougeScore: { type: Map, of: Number, default: {} },
        customMetrics: { type: Map, of: Schema.Types.Mixed, default: {} }
    },
    
    // Cost tracking
    cost: {
        estimated: { type: Number, required: true },
        actual: Number,
        currency: { type: String, default: 'USD' },
        breakdown: {
            trainingCost: Number,
            storageCost: Number,
            computeCost: Number,
            dataCost: Number
        }
    },
    
    // Time tracking
    timing: {
        queuedAt: { type: Date, default: Date.now },
        startedAt: Date,
        completedAt: Date,
        estimatedDuration: Number,
        actualDuration: Number
    },
    
    // Results
    results: {
        modelId: String,
        modelArn: String,
        endpointUrl: String,
        downloadUrl: String,
        evaluationResults: {
            testLoss: Number,
            testAccuracy: Number,
            benchmarkScores: { type: Map, of: Number, default: {} }
        }
    },
    
    // Error information
    error: {
        code: String,
        message: String,
        details: Schema.Types.Mixed,
        timestamp: Date
    },
    
    // Evaluation integration
    evaluationIds: [String],
    
    // Lineage and relationships
    lineage: {
        parentJobId: String,
        childJobIds: [String],
        experimentId: String
    }
}, {
    timestamps: true
});

// Indexes for efficient queries
fineTuneJobSchema.index({ userId: 1, status: 1 });
fineTuneJobSchema.index({ userId: 1, createdAt: -1 });
fineTuneJobSchema.index({ provider: 1, status: 1 });
fineTuneJobSchema.index({ datasetId: 1 });
fineTuneJobSchema.index({ providerJobId: 1 });
fineTuneJobSchema.index({ 'timing.queuedAt': 1 });

// Virtual for total duration
fineTuneJobSchema.virtual('totalDuration').get(function() {
    if (this.timing.completedAt && this.timing.startedAt) {
        return this.timing.completedAt.getTime() - this.timing.startedAt.getTime();
    }
    return null;
});

// Methods
fineTuneJobSchema.methods.updateProgress = function(progressData: Partial<IFineTuneJob['progress']>) {
    this.progress = { ...this.progress, ...progressData, lastUpdated: new Date() };
    return this.save();
};

fineTuneJobSchema.methods.setError = function(error: IFineTuneJob['error']) {
    this.status = 'failed';
    this.error = { ...error, timestamp: new Date() };
    if (!this.timing.completedAt) {
        this.timing.completedAt = new Date();
    }
    return this.save();
};

fineTuneJobSchema.methods.complete = function(results: Partial<IFineTuneJob['results']>) {
    this.status = 'succeeded';
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

export const FineTuneJob = mongoose.model<IFineTuneJob>('FineTuneJob', fineTuneJobSchema);