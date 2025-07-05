import mongoose, { Schema } from 'mongoose';

export interface ITip {
    _id?: any;
    tipId: string; // Unique identifier for the tip
    title: string;
    message: string;
    type: 'optimization' | 'feature' | 'cost_saving' | 'quality' | 'best_practice';
    trigger: {
        condition: 'high_tokens' | 'no_optimization' | 'expensive_model' | 'repeated_prompts' | 'long_context' | 'custom';
        threshold?: number;
        customRule?: string; // For complex conditions
    };
    action?: {
        type: 'enable_feature' | 'optimize_prompt' | 'change_model' | 'view_guide' | 'run_wizard';
        feature?: string;
        targetModel?: string;
        guideUrl?: string;
    };
    potentialSavings?: {
        percentage?: number;
        amount?: number;
        description: string;
    };
    priority: 'low' | 'medium' | 'high';
    targetAudience?: 'all' | 'free' | 'pro' | 'enterprise';
    isActive: boolean;
    displayCount: number;
    clickCount: number;
    dismissCount: number;
    successCount: number; // When user applies the suggestion
    createdAt: Date;
    updatedAt: Date;
}

const TipSchema = new Schema<ITip>({
    tipId: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: {
        type: String,
        enum: ['optimization', 'feature', 'cost_saving', 'quality', 'best_practice'],
        required: true
    },
    trigger: {
        condition: {
            type: String,
            enum: ['high_tokens', 'no_optimization', 'expensive_model', 'repeated_prompts', 'long_context', 'custom'],
            required: true
        },
        threshold: Number,
        customRule: String
    },
    action: {
        type: {
            type: String,
            enum: ['enable_feature', 'optimize_prompt', 'change_model', 'view_guide', 'run_wizard']
        },
        feature: String,
        targetModel: String,
        guideUrl: String
    },
    potentialSavings: {
        percentage: Number,
        amount: Number,
        description: { type: String, required: true }
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'medium'
    },
    targetAudience: {
        type: String,
        enum: ['all', 'free', 'pro', 'enterprise'],
        default: 'all'
    },
    isActive: { type: Boolean, default: true },
    displayCount: { type: Number, default: 0 },
    clickCount: { type: Number, default: 0 },
    dismissCount: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 }
}, {
    timestamps: true
});

// Indexes for efficient querying
TipSchema.index({ tipId: 1 });
TipSchema.index({ 'trigger.condition': 1, isActive: 1 });
TipSchema.index({ type: 1, priority: -1 });

export const Tip = mongoose.model<ITip>('Tip', TipSchema); 