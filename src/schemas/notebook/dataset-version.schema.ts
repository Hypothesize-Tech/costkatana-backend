import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import mongoose from 'mongoose';

export interface IDatasetMetadata {
  description?: string;
  tags?: string[];
  schema?: any;
  statistics?: Record<string, any>;
}

export type DatasetVersionDocument = HydratedDocument<DatasetVersion>;

@Schema({ timestamps: true })
export class DatasetVersion {
  @Prop({ required: true })
  datasetId: string;

  @Prop({ required: true })
  version: string;

  @Prop()
  name?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  createdBy?: MongooseSchema.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  metadata?: IDatasetMetadata;

  @Prop({ default: 'active' })
  status: string;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const DatasetVersionSchema =
  SchemaFactory.createForClass(DatasetVersion);

// Indexes
DatasetVersionSchema.index({ datasetId: 1, version: -1 });
DatasetVersionSchema.index({ createdBy: 1, createdAt: -1 });
