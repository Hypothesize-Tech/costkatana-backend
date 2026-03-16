import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UsageDocument = HydratedDocument<Usage>;

@Schema({ timestamps: true })
export class Usage {
  @Prop({ required: true, type: String, ref: 'User' })
  userId: string;

  @Prop({ type: String, ref: 'Subscription' })
  subscriptionId?: string;

  @Prop({
    required: true,
    enum: ['openai', 'anthropic', 'google', 'cohere', 'huggingface', 'other'],
  })
  provider: string;

  @Prop({ required: true })
  model: string;

  @Prop()
  prompt?: string;

  @Prop()
  completion?: string;

  @Prop({ required: true, min: 0 })
  promptTokens: number;

  @Prop({ required: true, min: 0 })
  completionTokens: number;

  @Prop({ min: 0 })
  totalTokens?: number;

  @Prop({ required: true, min: 0 })
  cost: number;

  @Prop({ min: 0 })
  estimatedCost?: number;

  @Prop({ min: 0 })
  responseTime?: number;

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop()
  workflowId?: string;

  @Prop()
  workflowName?: string;

  @Prop()
  workflowStep?: string;

  @Prop({ min: 0 })
  workflowSequence?: number;

  @Prop({ type: String, enum: ['zapier', 'make', 'n8n'] })
  automationPlatform?: 'zapier' | 'make' | 'n8n';

  @Prop()
  automationConnectionId?: string;

  @Prop({ type: String, ref: 'Project' })
  projectId?: string;

  @Prop()
  recordedAt: Date;

  @Prop({
    type: {
      templateId: { type: String, ref: 'PromptTemplate' },
      templateName: String,
      templateCategory: {
        type: String,
        enum: [
          'general',
          'coding',
          'writing',
          'analysis',
          'creative',
          'business',
          'custom',
          'visual-compliance',
        ],
      },
      variablesResolved: [
        {
          variableName: String,
          value: String,
          confidence: Number,
          source: {
            type: String,
            enum: ['user_provided', 'context_inferred', 'default', 'missing'],
          },
          reasoning: String,
        },
      ],
      context: {
        type: String,
        enum: [
          'chat',
          'optimization',
          'visual-compliance',
          'agent_trace',
          'api',
        ],
      },
      templateVersion: Number,
    },
  })
  templateUsage?: {
    templateId: string;
    templateName: string;
    templateCategory:
      | 'general'
      | 'coding'
      | 'writing'
      | 'analysis'
      | 'creative'
      | 'business'
      | 'custom'
      | 'visual-compliance';
    variablesResolved: Array<{
      variableName: string;
      value: string;
      confidence: number;
      source: 'user_provided' | 'context_inferred' | 'default' | 'missing';
      reasoning?: string;
    }>;
    context:
      | 'chat'
      | 'optimization'
      | 'visual-compliance'
      | 'agent_trace'
      | 'api';
    templateVersion?: number;
  };

  @Prop({ default: Date.now })
  createdAt: Date;
}

export const UsageSchema = SchemaFactory.createForClass(Usage);

// Indexes
UsageSchema.index({ userId: 1, recordedAt: -1 });
UsageSchema.index({ subscriptionId: 1 });
UsageSchema.index({ provider: 1, model: 1 });
UsageSchema.index({ projectId: 1 });
UsageSchema.index({ recordedAt: -1 });
UsageSchema.index({ userId: 1, tags: 1, createdAt: -1 });
UsageSchema.index({ workflowId: 1 });
UsageSchema.index({ 'templateUsage.templateId': 1, createdAt: -1 });
UsageSchema.index({ 'templateUsage.context': 1, createdAt: -1 });
UsageSchema.index({ userId: 1, 'templateUsage.templateId': 1, createdAt: -1 });
