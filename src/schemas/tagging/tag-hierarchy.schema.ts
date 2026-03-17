import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type TagHierarchyDocument = HydratedDocument<TagHierarchy>;

@Schema({ timestamps: true })
export class TagHierarchy {
  @Prop({ required: true })
  name: string;

  @Prop()
  parent?: string;

  @Prop({ type: [String], default: [] })
  children: string[];

  @Prop({ default: '#3B82F6' })
  color?: string;

  @Prop()
  description?: string;

  @Prop({ required: true, type: String, ref: 'User' })
  createdBy: string;

  @Prop({ default: true })
  isActive: boolean;
}

export const TagHierarchySchema = SchemaFactory.createForClass(TagHierarchy);
TagHierarchySchema.index({ createdBy: 1, isActive: 1 });
TagHierarchySchema.index({ parent: 1 });
