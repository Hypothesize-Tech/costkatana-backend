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

export interface IWorkflowStructure {
  stepCount: number;
  aiStepCount: number;
  stepTypes: string[];
  complexityScore: number;
}

export interface IModelChange {
  from: string;
  to: string;
}

export interface IVersionChanges {
  stepsAdded?: number;
  stepsRemoved?: number;
  stepsModified?: number;
  modelsChanged?: IModelChange[];
  costImpact?: number;
}

export type WorkflowVersionDocument = HydratedDocument<WorkflowVersion>;

@Schema({ timestamps: true })
export class WorkflowVersion {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, index: true })
  workflowId: string;

  @Prop({ required: true })
  workflowName: string;

  @Prop({
    type: String,
    enum: ['zapier', 'make', 'n8n'],
    required: true,
  })
  platform: 'zapier' | 'make' | 'n8n';

  @Prop({ required: true, default: 1 })
  version: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'WorkflowVersion' })
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
  })
  costMetrics: ICostMetrics;

  @Prop({
    type: {
      stepCount: { type: Number, default: 0 },
      aiStepCount: { type: Number, default: 0 },
      stepTypes: [String],
      complexityScore: { type: Number, default: 0 },
    },
  })
  structure: IWorkflowStructure;

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
  })
  changes?: IVersionChanges;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;
}

export const WorkflowVersionSchema =
  SchemaFactory.createForClass(WorkflowVersion);

// Indexes
WorkflowVersionSchema.index({ userId: 1, workflowId: 1, version: -1 });
WorkflowVersionSchema.index({ workflowId: 1, version: -1 });
