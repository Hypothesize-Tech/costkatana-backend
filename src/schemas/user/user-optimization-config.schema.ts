import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserOptimizationConfigDocument = UserOptimizationConfig & Document;

@Schema({ timestamps: true, collection: 'user_optimization_configs' })
export class UserOptimizationConfig {
  @Prop({ required: true, index: true, unique: true })
  userId: string;

  // General optimization settings
  @Prop({ default: true })
  autoOptimize: boolean;

  @Prop({
    enum: ['conservative', 'balanced', 'aggressive'],
    default: 'balanced',
  })
  optimizationLevel: 'conservative' | 'balanced' | 'aggressive';

  // Model selection preferences
  @Prop({
    type: [String],
    enum: [
      'openai',
      'anthropic',
      'google',
      'aws',
      'cohere',
      'mistral',
      'meta',
      'grok',
    ],
  })
  preferredProviders: string[];

  @Prop({ default: 0.1, min: 0 })
  maxCostPerRequest: number;

  @Prop({ default: false })
  prioritizeLatency: boolean;

  @Prop({ default: true })
  prioritizeAccuracy: boolean;

  // Prompt optimization
  @Prop({ default: true })
  enablePromptOptimization: boolean;

  @Prop({
    enum: ['basic', 'advanced', 'expert'],
    default: 'advanced',
  })
  promptOptimizationLevel: 'basic' | 'advanced' | 'expert';

  @Prop({ default: true })
  preserveOriginalIntent: boolean;

  // Caching preferences
  @Prop({ default: true })
  enableSemanticCaching: boolean;

  @Prop({ default: 24, min: 1, max: 168 }) // 1 week
  cacheTTLHours: number;

  @Prop({ default: 0.85, min: 0, max: 1 })
  cacheSimilarityThreshold: number;

  // Cost optimization
  @Prop({ default: true })
  enableCostOptimization: boolean;

  @Prop({ default: 30, min: 0, max: 100 })
  targetCostReduction: number;

  @Prop({ default: false })
  maxModelDowngrade: boolean;

  // Custom rules
  @Prop({
    type: [
      {
        ruleName: { type: String, required: true },
        condition: { type: String, required: true },
        action: { type: String, required: true },
        enabled: { type: Boolean, default: true },
      },
    ],
  })
  customRules: {
    ruleName: string;
    condition: string;
    action: string;
    enabled: boolean;
  }[];

  // Notification preferences
  @Prop({ default: true })
  notifyOnOptimization: boolean;

  @Prop({ default: true })
  notifyOnSavings: boolean;

  @Prop({ default: true })
  monthlyReport: boolean;

  // Status
  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  lastOptimizedAt?: Date;
}

export const UserOptimizationConfigSchema = SchemaFactory.createForClass(
  UserOptimizationConfig,
);

UserOptimizationConfigSchema.index({ userId: 1 });
UserOptimizationConfigSchema.index({ isActive: 1 });
UserOptimizationConfigSchema.index({ preferredProviders: 1 });
