import mongoose, { Document, Schema } from 'mongoose';

export interface ITrainingDataset extends Document {
    name: string;
    description?: string;
    userId: mongoose.Types.ObjectId;
    
    // Versioning
    version: string; // e.g., "1.0.0", "1.2.3"
    parentDatasetId?: mongoose.Types.ObjectId; // For dataset lineage
    versionNotes?: string; // Description of changes in this version
    
    // Dataset configuration
    targetUseCase: string; // e.g., 'support-ticket-classifier', 'content-generator'
    targetModel: string; // e.g., 'gpt-3.5-turbo', 'claude-haiku'
    
    // Request selection criteria
    requestIds: string[]; // Array of selected request IDs
    minScore: number; // Minimum score for inclusion (default 4)
    maxTokens?: number; // Maximum tokens per request
    maxCost?: number; // Maximum cost per request
    
    // Filters applied
    filters: {
        dateRange?: {
            start: Date;
            end: Date;
        };
        providers?: string[]; // OpenAI, Anthropic, etc.
        models?: string[]; // Specific models
        features?: string[]; // Custom properties/features
        costRange?: {
            min: number;
            max: number;
        };
        tokenRange?: {
            min: number;
            max: number;
        };
    };
    
    // Dataset items with ground-truth labels
    items: Array<{
        requestId: string;
        input: string;
        expectedOutput?: string; // Ground-truth label/expected completion
        criteria?: string[]; // Evaluation criteria
        tags?: string[]; // Custom tags
        piiFlags?: {
            hasPII: boolean;
            piiTypes: string[]; // email, phone, ssn, etc.
            confidence: number; // 0-1 confidence score
        };
        metadata?: Record<string, any>;
        split?: 'train' | 'dev' | 'test'; // Dataset split
    }>;
    
    // Dataset splits
    splits: {
        train: {
            percentage: number;
            count: number;
            itemIds: string[];
        };
        dev: {
            percentage: number;
            count: number;
            itemIds: string[];
        };
        test: {
            percentage: number;
            count: number;
            itemIds: string[];
        };
    };
    
    // Dataset statistics
    stats: {
        totalRequests: number;
        averageScore: number;
        totalTokens: number;
        totalCost: number;
        averageTokensPerRequest: number;
        averageCostPerRequest: number;
        providerBreakdown: Record<string, number>;
        modelBreakdown: Record<string, number>;
        piiStats: {
            totalWithPII: number;
            piiTypeBreakdown: Record<string, number>;
        };
    };
    
    // Export information
    lastExportedAt?: Date;
    exportFormat: 'openai-jsonl' | 'anthropic-jsonl' | 'huggingface-jsonl' | 'custom';
    exportCount: number;
    
    // Status
    status: 'draft' | 'ready' | 'exported' | 'training' | 'completed';
    
    // Lineage tracking
    lineage: {
        createdFrom?: {
            type: 'dataset' | 'experiment' | 'evaluation';
            id: string;
            version?: string;
        };
        derivedDatasets: string[]; // Dataset IDs that were created from this one
        relatedFineTuneJobs: string[]; // Fine-tune job IDs using this dataset
    };
    
    createdAt: Date;
    updatedAt: Date;
}

const trainingDatasetSchema = new Schema<ITrainingDataset>({
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
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    
    // Versioning
    version: {
        type: String,
        required: true,
        default: '1.0.0'
    },
    parentDatasetId: {
        type: Schema.Types.ObjectId,
        ref: 'TrainingDataset',
        required: false
    },
    versionNotes: {
        type: String,
        maxlength: 1000
    },
    
    // Dataset configuration
    targetUseCase: { 
        type: String, 
        required: true
    },
    targetModel: { 
        type: String, 
        required: true 
    },
    
    // Request selection
    requestIds: [{ 
        type: String
    }],
    minScore: { 
        type: Number, 
        default: 4, 
        min: 1, 
        max: 5 
    },
    maxTokens: Number,
    maxCost: Number,
    
    // Filters
    filters: {
        dateRange: {
            start: Date,
            end: Date
        },
        providers: [String],
        models: [String],
        features: [String],
        costRange: {
            min: Number,
            max: Number
        },
        tokenRange: {
            min: Number,
            max: Number
        }
    },
    
    // Dataset items with ground-truth labels
    items: [{
        requestId: { type: String, required: true },
        input: { type: String, required: true },
        expectedOutput: { type: String },
        criteria: [String],
        tags: [String],
        piiFlags: {
            hasPII: { type: Boolean, default: false },
            piiTypes: [String],
            confidence: { type: Number, min: 0, max: 1, default: 0 }
        },
        metadata: { type: Map, of: Schema.Types.Mixed, default: {} },
        split: { 
            type: String, 
            enum: ['train', 'dev', 'test'], 
            required: false 
        }
    }],
    
    // Dataset splits
    splits: {
        train: {
            percentage: { type: Number, default: 80 },
            count: { type: Number, default: 0 },
            itemIds: [String]
        },
        dev: {
            percentage: { type: Number, default: 10 },
            count: { type: Number, default: 0 },
            itemIds: [String]
        },
        test: {
            percentage: { type: Number, default: 10 },
            count: { type: Number, default: 0 },
            itemIds: [String]
        }
    },
    
    // Statistics
    stats: {
        totalRequests: { type: Number, default: 0 },
        averageScore: { type: Number, default: 0 },
        totalTokens: { type: Number, default: 0 },
        totalCost: { type: Number, default: 0 },
        averageTokensPerRequest: { type: Number, default: 0 },
        averageCostPerRequest: { type: Number, default: 0 },
        providerBreakdown: { type: Map, of: Number, default: {} },
        modelBreakdown: { type: Map, of: Number, default: {} },
        piiStats: {
            totalWithPII: { type: Number, default: 0 },
            piiTypeBreakdown: { type: Map, of: Number, default: {} }
        }
    },
    
    // Export info
    lastExportedAt: Date,
    exportFormat: { 
        type: String, 
        enum: ['openai-jsonl', 'anthropic-jsonl', 'huggingface-jsonl', 'custom'],
        default: 'openai-jsonl'
    },
    exportCount: { 
        type: Number, 
        default: 0 
    },
    
        // Status
    status: { 
        type: String,
        enum: ['draft', 'ready', 'exported', 'training', 'completed'],
        default: 'draft'
    },
    
    // Lineage tracking
    lineage: {
        createdFrom: {
            type: {
                type: String,
                enum: ['dataset', 'experiment', 'evaluation']
            },
            id: String,
            version: String
        },
        derivedDatasets: [String],
        relatedFineTuneJobs: [String]
    }
}, { 
    timestamps: true 
});

// 1. Primary user queries
trainingDatasetSchema.index({ userId: 1, createdAt: -1 });

// 2. Status queries
trainingDatasetSchema.index({ userId: 1, status: 1 });

// 3. Version queries
trainingDatasetSchema.index({ name: 1, version: 1, userId: 1 });

// 4. Lineage queries
trainingDatasetSchema.index({ 'lineage.createdFrom.id': 1 });

// Methods
trainingDatasetSchema.methods.calculateStats = async function() {
    // This will be implemented in the service layer
    return this.stats;
};

trainingDatasetSchema.methods.addRequest = function(requestId: string) {
    if (!this.requestIds.includes(requestId)) {
        this.requestIds.push(requestId);
    }
};

trainingDatasetSchema.methods.removeRequest = function(requestId: string) {
    this.requestIds = this.requestIds.filter((id: string) => id !== requestId);
};

export const TrainingDataset = mongoose.model<ITrainingDataset>('TrainingDataset', trainingDatasetSchema);