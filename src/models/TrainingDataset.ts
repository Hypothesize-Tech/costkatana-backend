import mongoose, { Document, Schema } from 'mongoose';

export interface ITrainingDataset extends Document {
    name: string;
    description?: string;
    userId: mongoose.Types.ObjectId;
    
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
    };
    
    // Export information
    lastExportedAt?: Date;
    exportFormat: 'openai-jsonl' | 'anthropic-jsonl' | 'huggingface-jsonl' | 'custom';
    exportCount: number;
    
    // Status
    status: 'draft' | 'ready' | 'exported' | 'training' | 'completed';
    
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
    
    // Statistics
    stats: {
        totalRequests: { type: Number, default: 0 },
        averageScore: { type: Number, default: 0 },
        totalTokens: { type: Number, default: 0 },
        totalCost: { type: Number, default: 0 },
        averageTokensPerRequest: { type: Number, default: 0 },
        averageCostPerRequest: { type: Number, default: 0 },
        providerBreakdown: { type: Map, of: Number, default: {} },
        modelBreakdown: { type: Map, of: Number, default: {} }
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
    }
}, { 
    timestamps: true 
});

// 1. Primary user queries
trainingDatasetSchema.index({ userId: 1, createdAt: -1 });

// 2. Status queries
trainingDatasetSchema.index({ userId: 1, status: 1 });

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