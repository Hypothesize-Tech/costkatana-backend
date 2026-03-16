import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RepositoryUserMappingDocument =
  HydratedDocument<RepositoryUserMapping>;

@Schema({ timestamps: true, collection: 'repository_user_mappings' })
export class RepositoryUserMapping {
  @Prop({ required: true, index: true, unique: true })
  repositoryFullName: string;

  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  connectionId: string;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const RepositoryUserMappingSchema = SchemaFactory.createForClass(
  RepositoryUserMapping,
);

// Compound index for efficient lookups
RepositoryUserMappingSchema.index({ repositoryFullName: 1, userId: 1 });
