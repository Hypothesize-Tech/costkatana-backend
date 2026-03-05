/**
 * User Optimization Configuration Model
 *
 * Stores user's optimization preferences and settings for AI model optimization.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IUserOptimizationConfig extends Document {
    userId: string;

    // General optimization settings
    autoOptimize: boolean;
    optimizationLevel: 'conservative' | 'balanced' | 'aggressive';

    // Model selection preferences
    preferredProviders: string[]; // e.g., ['openai', 'anthropic', 'google']
    maxCostPerRequest: number; // Maximum cost per request in USD
    prioritizeLatency: boolean;
    prioritizeAccuracy: boolean;

    // Prompt optimization
    enablePromptOptimization: boolean;
    promptOptimizationLevel: 'basic' | 'advanced' | 'expert';
    preserveOriginalIntent: boolean;

    // Caching preferences
    enableSemanticCaching: boolean;
    cacheTTLHours: number;
    cacheSimilarityThreshold: number;

    // Cost optimization
    enableCostOptimization: boolean;
    targetCostReduction: number; // Percentage (0-100)
    maxModelDowngrade: boolean; // Allow downgrading to cheaper models

    // Custom rules
    customRules: {
        ruleName: string;
        condition: string;
        action: string;
        enabled: boolean;
    }[];

    // Notification preferences
    notifyOnOptimization: boolean;
    notifyOnSavings: boolean;
    monthlyReport: boolean;

    // Status
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    lastOptimizedAt?: Date;
}

const UserOptimizationConfigSchema = new Schema<IUserOptimizationConfig>({
    userId: {
        type: String,
        required: true,
        index: true,
        unique: true
    },

    // General optimization settings
    autoOptimize: {
        type: Boolean,
        default: true
    },

    optimizationLevel: {
        type: String,
        enum: ['conservative', 'balanced', 'aggressive'],
        default: 'balanced'
    },

    // Model selection preferences
    preferredProviders: [{
        type: String,
        enum: ['openai', 'anthropic', 'google', 'aws', 'cohere', 'mistral', 'meta', 'grok']
    }],

    maxCostPerRequest: {
        type: Number,
        default: 0.10,
        min: 0
    },

    prioritizeLatency: {
        type: Boolean,
        default: false
    },

    prioritizeAccuracy: {
        type: Boolean,
        default: true
    },

    // Prompt optimization
    enablePromptOptimization: {
        type: Boolean,
        default: true
    },

    promptOptimizationLevel: {
        type: String,
        enum: ['basic', 'advanced', 'expert'],
        default: 'advanced'
    },

    preserveOriginalIntent: {
        type: Boolean,
        default: true
    },

    // Caching preferences
    enableSemanticCaching: {
        type: Boolean,
        default: true
    },

    cacheTTLHours: {
        type: Number,
        default: 24,
        min: 1,
        max: 168 // 1 week
    },

    cacheSimilarityThreshold: {
        type: Number,
        default: 0.85,
        min: 0,
        max: 1
    },

    // Cost optimization
    enableCostOptimization: {
        type: Boolean,
        default: true
    },

    targetCostReduction: {
        type: Number,
        default: 30,
        min: 0,
        max: 100
    },

    maxModelDowngrade: {
        type: Boolean,
        default: false
    },

    // Custom rules
    customRules: [{
        ruleName: { type: String, required: true },
        condition: { type: String, required: true },
        action: { type: String, required: true },
        enabled: { type: Boolean, default: true }
    }],

    // Notification preferences
    notifyOnOptimization: {
        type: Boolean,
        default: true
    },

    notifyOnSavings: {
        type: Boolean,
        default: true
    },

    monthlyReport: {
        type: Boolean,
        default: true
    },

    // Status
    isActive: {
        type: Boolean,
        default: true
    },

    lastOptimizedAt: Date
}, {
    timestamps: true,
    collection: 'user_optimization_configs'
});

// Indexes
UserOptimizationConfigSchema.index({ userId: 1 });
UserOptimizationConfigSchema.index({ isActive: 1 });
UserOptimizationConfigSchema.index({ 'preferredProviders': 1 });

export const UserOptimizationConfig = mongoose.model<IUserOptimizationConfig>('UserOptimizationConfig', UserOptimizationConfigSchema);