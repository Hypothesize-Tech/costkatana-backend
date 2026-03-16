import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export interface IModelBreakdown {
  model: string;
  cost: number;
  percentage: number;
}

export interface ICostMetrics {
  averageCostPerExecution: number;
  totalExecutions: number;
  totalCost: number;
  modelBreakdown: IModelBreakdown[];
}

export interface IStructure {
  stepCount: number;
  aiStepCount: number;
  stepTypes: string[];
  complexityScore: number;
}

export interface IModelsChanged {
  from: string;
  to: string;
}

export interface IChanges {
  stepsAdded?: number;
  stepsRemoved?: number;
  stepsModified?: number;
  modelsChanged?: IModelsChanged[];
  costImpact?: number;
}

export type AgentTraceVersionDocument = HydratedDocument<AgentTraceVersion>;

@Schema({ timestamps: true, collection: 'agenttraceversions' })
export class AgentTraceVersion {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, index: true })
  traceId: string;

  @Prop({ required: true })
  traceName: string;

  @Prop({
    type: String,
    enum: ['zapier', 'make', 'n8n'],
    required: true,
  })
  platform: 'zapier' | 'make' | 'n8n';

  @Prop({ required: true, default: 1 })
  version: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'AgentTraceVersion' })
  previousVersionId?: MongooseSchema.Types.ObjectId;

  @Prop({
    type: {
      averageCostPerExecution: { type: Number, default: 0 },
      totalExecutions: { type: Number, default: 0 },
      totalCost: { type: Number, default: 0 },
      modelBreakdown: [
        {
          model: String,
          cost: Number,
          percentage: Number,
        },
      ],
    },
    required: true,
  })
  costMetrics: ICostMetrics;

  @Prop({
    type: {
      stepCount: { type: Number, default: 0 },
      aiStepCount: { type: Number, default: 0 },
      stepTypes: [String],
      complexityScore: { type: Number, default: 0 },
    },
    required: true,
  })
  structure: IStructure;

  @Prop({
    type: {
      stepsAdded: Number,
      stepsRemoved: Number,
      stepsModified: Number,
      modelsChanged: [
        {
          from: String,
          to: String,
        },
      ],
      costImpact: Number,
    },
    required: false,
  })
  changes?: IChanges;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;
}

export const AgentTraceVersionSchema =
  SchemaFactory.createForClass(AgentTraceVersion);

// Indexes
AgentTraceVersionSchema.index({ userId: 1, traceId: 1, version: -1 });
AgentTraceVersionSchema.index({ traceId: 1, version: -1 });
