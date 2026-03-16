import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import type { WorkflowTemplate } from '../../modules/workflow/workflow.interfaces';

export type WorkflowTemplateVersionDocument =
  HydratedDocument<WorkflowTemplateVersion>;

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class WorkflowTemplateVersion {
  @Prop({ required: true, index: true })
  templateId: string;

  @Prop({ required: true })
  version: number;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  snapshot: WorkflowTemplate;

  @Prop()
  label?: string;

  @Prop({ required: true })
  createdAt: Date;
}

export const WorkflowTemplateVersionSchema = SchemaFactory.createForClass(
  WorkflowTemplateVersion,
);

// Indexes
WorkflowTemplateVersionSchema.index({ templateId: 1, version: -1 });
WorkflowTemplateVersionSchema.index({ templateId: 1, createdAt: -1 });
