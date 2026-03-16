import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export interface IWorkflowStep {
  stepId: string;
  name: string;
  type: string;
  config: Record<string, any>;
  order: number;
}

export interface IWorkflowTrigger {
  type: 'manual' | 'scheduled' | 'webhook' | 'event';
  config: Record<string, any>;
}

export type GoogleWorkflowDocument = HydratedDocument<GoogleWorkflow>;

@Schema({ timestamps: true, collection: 'google_workflows' })
export class GoogleWorkflow {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'GoogleConnection',
    required: true,
  })
  googleConnectionId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop()
  description?: string;

  @Prop({
    type: { type: String, required: true },
    config: { type: mongoose.Schema.Types.Mixed, required: true },
  })
  trigger: IWorkflowTrigger;

  @Prop([
    {
      stepId: { type: String, required: true },
      name: { type: String, required: true },
      type: { type: String, required: true },
      config: { type: mongoose.Schema.Types.Mixed, required: true },
      order: { type: Number, required: true },
    },
  ])
  steps: IWorkflowStep[];

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop()
  lastExecution?: Date;

  @Prop({ type: Number, default: 0 })
  executionCount: number;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const GoogleWorkflowSchema =
  SchemaFactory.createForClass(GoogleWorkflow);

// Indexes
GoogleWorkflowSchema.index({ googleConnectionId: 1 });
GoogleWorkflowSchema.index({ isActive: 1 });
