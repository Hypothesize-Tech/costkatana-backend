import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type PromptVersionDocument = HydratedDocument<PromptVersion>;

@Schema({ timestamps: true })
export class PromptVersion {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'PromptTemplate',
    required: true,
  })
  templateId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  version: number;

  @Prop({ required: true })
  content: string;

  @Prop({ trim: true, maxlength: 1000 })
  changeNote?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  createdBy: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'PromptVersion' })
  parentVersionId?: MongooseSchema.Types.ObjectId;

  @Prop()
  agentId?: string;

  @Prop()
  nodeId?: string;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const PromptVersionSchema = SchemaFactory.createForClass(PromptVersion);

PromptVersionSchema.index({ templateId: 1, version: -1 }, { unique: true });
PromptVersionSchema.index({ templateId: 1, createdAt: -1 });
PromptVersionSchema.index({ createdBy: 1 });
