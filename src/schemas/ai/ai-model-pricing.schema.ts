import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AIModelPricingDocument = HydratedDocument<AIModelPricing>;

@Schema({ timestamps: true })
export class AIModelPricing {
  // Model identification
  @Prop({ required: true, unique: true, index: true })
  modelId: string;

  @Prop({ required: true })
  modelName: string;

  @Prop({
    type: String,
    required: true,
    enum: [
      'openai',
      'anthropic',
      'google-ai',
      'aws-bedrock',
      'cohere',
      'mistral',
      'xai',
    ],
    index: true,
  })
  provider:
    | 'openai'
    | 'anthropic'
    | 'google-ai'
    | 'aws-bedrock'
    | 'cohere'
    | 'mistral'
    | 'xai'
    | string;

  // Pricing (in dollars per million tokens)
  @Prop({ required: true, min: 0 })
  inputPricePerMToken: number;

  @Prop({ required: true, min: 0 })
  outputPricePerMToken: number;

  @Prop({ min: 0 })
  cachedInputPricePerMToken?: number;

  // Model specs
  @Prop({ required: true, min: 0 })
  contextWindow: number;

  @Prop({ type: [String], default: [] })
  capabilities: string[];

  @Prop({
    type: String,
    required: true,
    enum: ['text', 'multimodal', 'embedding', 'code'],
  })
  category: 'text' | 'multimodal' | 'embedding' | 'code';

  @Prop({ type: Boolean, default: false, index: true })
  isLatest: boolean;

  @Prop({ type: Boolean, default: true, index: true })
  isActive: boolean;

  // Discovery metadata
  @Prop({
    type: String,
    required: true,
    enum: ['google_search', 'manual', 'fallback_scraping'],
    index: true,
  })
  discoverySource: 'google_search' | 'manual' | 'fallback_scraping';

  @Prop({ required: true, default: Date.now })
  discoveryDate: Date;

  @Prop({ required: true, default: Date.now })
  lastValidated: Date;

  @Prop({ required: true, default: Date.now, index: true })
  lastUpdated: Date;

  // Search metadata
  @Prop()
  searchQuery?: string;

  @Prop()
  googleSearchSnippet?: string;

  @Prop()
  llmExtractionPrompt?: string;

  // Deprecation
  @Prop({ type: Boolean, default: false })
  isDeprecated: boolean;

  @Prop()
  deprecationDate?: Date;

  @Prop()
  replacementModelId?: string;

  // Validation
  @Prop({
    type: String,
    required: true,
    enum: ['verified', 'pending', 'failed'],
    default: 'pending',
  })
  validationStatus: 'verified' | 'pending' | 'failed';

  @Prop([String])
  validationErrors?: string[];

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const AIModelPricingSchema =
  SchemaFactory.createForClass(AIModelPricing);

// Compound indexes for common queries
AIModelPricingSchema.index({ provider: 1, isActive: 1, isLatest: -1 });
AIModelPricingSchema.index({
  provider: 1,
  validationStatus: 1,
  lastUpdated: -1,
});
AIModelPricingSchema.index({ discoverySource: 1, discoveryDate: -1 });
AIModelPricingSchema.index({ isActive: 1, isDeprecated: 1 });

// Static methods
AIModelPricingSchema.statics.findActiveByProvider = function (
  provider: string,
) {
  return this.find({
    provider,
    isActive: true,
    isDeprecated: false,
    validationStatus: 'verified',
  }).sort({ isLatest: -1, lastUpdated: -1 });
};

AIModelPricingSchema.statics.findLatestModels = function () {
  return this.find({
    isLatest: true,
    isActive: true,
    isDeprecated: false,
    validationStatus: 'verified',
  }).sort({ provider: 1, modelName: 1 });
};
