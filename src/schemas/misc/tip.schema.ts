import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export interface ITipTrigger {
  condition:
    | 'high_tokens'
    | 'no_optimization'
    | 'expensive_model'
    | 'repeated_prompts'
    | 'long_context'
    | 'custom';
  threshold?: number;
  customRule?: string;
}

export interface ITipAction {
  type?:
    | 'enable_feature'
    | 'optimize_prompt'
    | 'change_model'
    | 'view_guide'
    | 'run_wizard';
  feature?: string;
  targetModel?: string;
  guideUrl?: string;
}

export interface IPotentialSavings {
  percentage?: number;
  amount?: number;
  description: string;
}

export type TipDocument = HydratedDocument<Tip>;

@Schema({ timestamps: true })
export class Tip {
  @Prop({ required: true, unique: true })
  tipId: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  message: string;

  @Prop({
    type: String,
    enum: [
      'optimization',
      'feature',
      'cost_saving',
      'quality',
      'best_practice',
    ],
    required: true,
  })
  type:
    | 'optimization'
    | 'feature'
    | 'cost_saving'
    | 'quality'
    | 'best_practice';

  @Prop({
    type: {
      condition: {
        type: String,
        enum: [
          'high_tokens',
          'no_optimization',
          'expensive_model',
          'repeated_prompts',
          'long_context',
          'custom',
        ],
        required: true,
      },
      threshold: Number,
      customRule: String,
    },
  })
  trigger: ITipTrigger;

  @Prop({
    type: {
      type: String,
      enum: [
        'enable_feature',
        'optimize_prompt',
        'change_model',
        'view_guide',
        'run_wizard',
      ],
    },
    feature: String,
    targetModel: String,
    guideUrl: String,
  })
  action?: ITipAction;

  @Prop({
    type: {
      percentage: Number,
      amount: Number,
      description: { type: String, required: true },
    },
  })
  potentialSavings?: IPotentialSavings;

  @Prop({
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium',
  })
  priority: 'low' | 'medium' | 'high';

  @Prop({
    type: String,
    enum: ['all', 'free', 'pro', 'enterprise'],
    default: 'all',
  })
  targetAudience: 'all' | 'free' | 'pro' | 'enterprise';

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: 0 })
  displayCount: number;

  @Prop({ default: 0 })
  clickCount: number;

  @Prop({ default: 0 })
  dismissCount: number;

  @Prop({ default: 0 })
  successCount: number;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const TipSchema = SchemaFactory.createForClass(Tip);

// Indexes for efficient querying
TipSchema.index({ 'trigger.condition': 1, isActive: 1 });
TipSchema.index({ type: 1, priority: -1 });
