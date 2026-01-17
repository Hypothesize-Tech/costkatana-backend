import mongoose, { Schema, Document } from 'mongoose';

/**
 * AI Model Pricing Document Interface
 * Stores discovered AI model pricing information with metadata
 */
export interface IAIModelPricing extends Document {
    // Model identification
    modelId: string;
    modelName: string;
    provider: 'openai' | 'anthropic' | 'google-ai' | 'aws-bedrock' | 'cohere' | 'mistral' | 'xai' | string;
    
    // Pricing (in dollars per million tokens)
    inputPricePerMToken: number;
    outputPricePerMToken: number;
    cachedInputPricePerMToken?: number;
    
    // Model specs
    contextWindow: number;
    capabilities: string[];
    category: 'text' | 'multimodal' | 'embedding' | 'code';
    isLatest: boolean;
    isActive: boolean;
    
    // Discovery metadata
    discoverySource: 'google_search' | 'manual' | 'fallback_scraping';
    discoveryDate: Date;
    lastValidated: Date;
    lastUpdated: Date;
    
    // Search metadata
    searchQuery?: string;
    googleSearchSnippet?: string;
    llmExtractionPrompt?: string;
    
    // Deprecation
    isDeprecated: boolean;
    deprecationDate?: Date;
    replacementModelId?: string;
    
    // Validation
    validationStatus: 'verified' | 'pending' | 'failed';
    validationErrors?: string[];
    
    createdAt: Date;
    updatedAt: Date;
}

const aiModelPricingSchema = new Schema<IAIModelPricing>({
    // Model identification
    modelId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    modelName: {
        type: String,
        required: true
    },
    provider: {
        type: String,
        required: true,
        enum: ['openai', 'anthropic', 'google-ai', 'aws-bedrock', 'cohere', 'mistral', 'xai'],
        index: true
    },
    
    // Pricing
    inputPricePerMToken: {
        type: Number,
        required: true,
        min: 0
    },
    outputPricePerMToken: {
        type: Number,
        required: true,
        min: 0
    },
    cachedInputPricePerMToken: {
        type: Number,
        min: 0
    },
    
    // Model specs
    contextWindow: {
        type: Number,
        required: true,
        min: 0
    },
    capabilities: {
        type: [String],
        default: []
    },
    category: {
        type: String,
        required: true,
        enum: ['text', 'multimodal', 'embedding', 'code']
    },
    isLatest: {
        type: Boolean,
        default: false,
        index: true
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    
    // Discovery metadata
    discoverySource: {
        type: String,
        required: true,
        enum: ['google_search', 'manual', 'fallback_scraping'],
        index: true
    },
    discoveryDate: {
        type: Date,
        required: true,
        default: Date.now
    },
    lastValidated: {
        type: Date,
        required: true,
        default: Date.now
    },
    lastUpdated: {
        type: Date,
        required: true,
        default: Date.now,
        index: true
    },
    
    // Search metadata
    searchQuery: String,
    googleSearchSnippet: String,
    llmExtractionPrompt: String,
    
    // Deprecation
    isDeprecated: {
        type: Boolean,
        default: false
    },
    deprecationDate: Date,
    replacementModelId: String,
    
    // Validation
    validationStatus: {
        type: String,
        required: true,
        enum: ['verified', 'pending', 'failed'],
        default: 'pending'
    },
    validationErrors: [String]
}, {
    timestamps: true
});

// Compound indexes for common queries
aiModelPricingSchema.index({ provider: 1, isActive: 1, isLatest: -1 });
aiModelPricingSchema.index({ provider: 1, validationStatus: 1, lastUpdated: -1 });
aiModelPricingSchema.index({ discoverySource: 1, discoveryDate: -1 });
aiModelPricingSchema.index({ isActive: 1, isDeprecated: 1 });

// Static methods
aiModelPricingSchema.statics.findActiveByProvider = function(provider: string) {
    return this.find({
        provider,
        isActive: true,
        isDeprecated: false,
        validationStatus: 'verified'
    }).sort({ isLatest: -1, lastUpdated: -1 });
};

aiModelPricingSchema.statics.findLatestModels = function() {
    return this.find({
        isLatest: true,
        isActive: true,
        isDeprecated: false,
        validationStatus: 'verified'
    }).sort({ provider: 1, modelName: 1 });
};

export const AIModelPricing = mongoose.model<IAIModelPricing>('AIModelPricing', aiModelPricingSchema);
