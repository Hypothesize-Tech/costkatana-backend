import mongoose, { Document, Schema } from 'mongoose';

export interface IWhatIfScenario extends Document {
    userId: mongoose.Types.ObjectId;
    name: string;
    description: string;
    changes: Array<{
        type: 'model_switch' | 'volume_change' | 'feature_addition' | 'optimization_applied';
        currentValue: any;
        proposedValue: any;
        affectedMetrics: string[];
        description: string;
    }>;
    timeframe: 'daily' | 'weekly' | 'monthly' | 'yearly';
    baselineData: {
        cost: number;
        volume: number;
        performance: number;
    };
    analysis?: {
        projectedImpact: {
            costChange: number;
            costChangePercentage: number;
            performanceChange: number;
            performanceChangePercentage: number;
            riskLevel: 'low' | 'medium' | 'high';
            confidence: number;
        };
        breakdown: {
            currentCosts: Record<string, number>;
            projectedCosts: Record<string, number>;
            savingsOpportunities: Array<{
                category: string;
                savings: number;
                effort: 'low' | 'medium' | 'high';
            }>;
        };
        recommendations: string[];
        warnings: string[];
        aiInsights?: string[];
    };
    status: 'created' | 'analyzed' | 'applied';
    isUserCreated: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const WhatIfScenarioSchema = new Schema<IWhatIfScenario>({
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
        unique: true // Ensure unique names per user
    },
    description: {
        type: String,
        required: true,
        trim: true
    },
    changes: [{
        type: {
            type: String,
            enum: ['model_switch', 'volume_change', 'feature_addition', 'optimization_applied'],
            required: true
        },
        currentValue: Schema.Types.Mixed,
        proposedValue: Schema.Types.Mixed,
        affectedMetrics: [String],
        description: String
    }],
    timeframe: {
        type: String,
        enum: ['daily', 'weekly', 'monthly', 'yearly'],
        required: true
    },
    baselineData: {
        cost: {
            type: Number,
            required: true
        },
        volume: {
            type: Number,
            required: true
        },
        performance: {
            type: Number,
            required: true
        }
    },
    analysis: {
        projectedImpact: {
            costChange: Number,
            costChangePercentage: Number,
            performanceChange: Number,
            performanceChangePercentage: Number,
            riskLevel: {
                type: String,
                enum: ['low', 'medium', 'high']
            },
            confidence: Number
        },
        breakdown: {
            currentCosts: Schema.Types.Mixed,
            projectedCosts: Schema.Types.Mixed,
            savingsOpportunities: [{
                category: String,
                savings: Number,
                effort: {
                    type: String,
                    enum: ['low', 'medium', 'high']
                }
            }]
        },
        recommendations: [String],
        warnings: [String],
        aiInsights: [String]
    },
    status: {
        type: String,
        enum: ['created', 'analyzed', 'applied'],
        default: 'created'
    },
    isUserCreated: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Compound index to ensure unique names per user
WhatIfScenarioSchema.index({ userId: 1, name: 1 }, { unique: true });

// Indexes for efficient querying
WhatIfScenarioSchema.index({ userId: 1, createdAt: -1 });
WhatIfScenarioSchema.index({ userId: 1, status: 1 });
WhatIfScenarioSchema.index({ userId: 1, isUserCreated: 1 });

export const WhatIfScenario = mongoose.model<IWhatIfScenario>('WhatIfScenario', WhatIfScenarioSchema); 