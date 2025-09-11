import mongoose, { Schema } from 'mongoose';

export interface IOptimization {
    _id?: any;
    userId: mongoose.Types.ObjectId;
    userQuery: string; // Changed from originalPrompt
    generatedAnswer: string; // Changed from optimizedPrompt
    optimizationTechniques: string[];
    originalTokens: number;
    optimizedTokens: number;
    tokensSaved: number;
    originalCost: number;
    optimizedCost: number;
    costSaved: number;
    improvementPercentage: number;
    service: string;
    model: string;
    category: 'prompt_reduction' | 'context_optimization' | 'response_formatting' | 'batch_processing' | 'model_selection';
    suggestions: Array<{
        type: string;
        description: string;
        impact: 'low' | 'medium' | 'high';
        implemented: boolean;
    }>;
    metadata: {
        analysisTime?: number;
        confidence?: number;
        alternatives?: Array<{
            prompt: string;
            tokens: number;
            cost: number;
        }>;
        [key: string]: any;
    };
    cortexImpactMetrics?: {
        tokenReduction: {
            withoutCortex: number;
            withCortex: number;
            absoluteSavings: number;
            percentageSavings: number;
        };
        qualityMetrics: {
            clarityScore: number;
            completenessScore: number;
            relevanceScore: number;
            ambiguityReduction: number;
            redundancyRemoval: number;
        };
        performanceMetrics: {
            processingTime: number;
            responseLatency: number;
            compressionRatio: number;
        };
        costImpact: {
            estimatedCostWithoutCortex: number;
            actualCostWithCortex: number;
            costSavings: number;
            savingsPercentage: number;
        };
        justification: {
            optimizationTechniques: string[];
            keyImprovements: string[];
            confidenceScore: number;
        };
    };
    feedback?: {
        helpful: boolean;
        rating?: number;
        comment?: string;
        submittedAt?: Date;
    };
    tags: string[];
    createdAt: Date;
    updatedAt: Date;
}

const optimizationSchema = new Schema<IOptimization>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    userQuery: {
        type: String,
        required: true
    },
    generatedAnswer: {
        type: String,
        required: true
    },
    optimizationTechniques: [{
        type: String,
    }],
    originalTokens: {
        type: Number,
        required: true,
        min: 0,
    },
    optimizedTokens: {
        type: Number,
        required: true,
        min: 0,
    },
    tokensSaved: {
        type: Number,
        required: true,
        min: 0,
    },
    originalCost: {
        type: Number,
        required: true,
        min: 0,
    },
    optimizedCost: {
        type: Number,
        required: true,
        min: 0,
    },
    costSaved: {
        type: Number,
        required: true,
        min: 0,
    },
    improvementPercentage: {
        type: Number,
        required: true,
        min: 0,
        max: 100,
    },
    service: {
        type: String,
        required: true,
    },
    model: {
        type: String,
        required: true,
    },
    category: {
        type: String,
        enum: ['prompt_reduction', 'context_optimization', 'response_formatting', 'batch_processing', 'model_selection'],
        required: true
    },
    suggestions: [{
        type: {
            type: String,
            required: true,
        },
        description: {
            type: String,
            required: true,
        },
        impact: {
            type: String,
            enum: ['low', 'medium', 'high'],
            required: true,
        },
        implemented: {
            type: Boolean,
            default: false,
        },
    }],
    metadata: {
        type: Schema.Types.Mixed,
        default: {},
    },
    cortexImpactMetrics: {
        type: {
            tokenReduction: {
                withoutCortex: Number,
                withCortex: Number,
                absoluteSavings: Number,
                percentageSavings: Number
            },
            qualityMetrics: {
                clarityScore: Number,
                completenessScore: Number,
                relevanceScore: Number,
                ambiguityReduction: Number,
                redundancyRemoval: Number
            },
            performanceMetrics: {
                processingTime: Number,
                responseLatency: Number,
                compressionRatio: Number
            },
            costImpact: {
                estimatedCostWithoutCortex: Number,
                actualCostWithCortex: Number,
                costSavings: Number,
                savingsPercentage: Number
            },
            justification: {
                optimizationTechniques: [String],
                keyImprovements: [String],
                confidenceScore: Number
            }
        },
        required: false
    },
    feedback: {
        helpful: Boolean,
        rating: {
            type: Number,
            min: 1,
            max: 5,
        },
        comment: String,
        submittedAt: Date,
    },
    tags: [{
        type: String,
        trim: true,
    }],
}, {
    timestamps: true,
});

// Indexes
optimizationSchema.index({ userId: 1, createdAt: -1 });
optimizationSchema.index({ userId: 1, applied: 1 });
optimizationSchema.index({ costSaved: -1 });
optimizationSchema.index({ improvementPercentage: -1 });
optimizationSchema.index({ category: 1 });
optimizationSchema.index({ createdAt: -1 });

// Text index for searching prompts
optimizationSchema.index({ originalPrompt: 'text', optimizedPrompt: 'text' });

export const Optimization = mongoose.model<IOptimization>('Optimization', optimizationSchema);