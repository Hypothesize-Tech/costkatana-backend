import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

export interface IFieldDefinition {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
  validation?: Record<string, any>;
}

export interface IDatasetSchema {
  fields: IFieldDefinition[];
  primaryKey?: string;
  indexes?: string[];
  validationRules?: Record<string, any>;
}

export type DatasetItemSchemaDocument = HydratedDocument<DatasetItemSchema>;

@Schema({ timestamps: true })
export class DatasetItemSchema {
  @Prop({ required: true })
  datasetId: string;

  @Prop({ required: true })
  name: string;

  @Prop()
  description?: string;

  @Prop({
    type: {
      fields: [
        {
          name: { type: String, required: true },
          type: { type: String, required: true },
          required: Boolean,
          description: String,
          validation: mongoose.Schema.Types.Mixed,
        },
      ],
      primaryKey: String,
      indexes: [String],
      validationRules: mongoose.Schema.Types.Mixed,
    },
  })
  schema: IDatasetSchema;

  @Prop({ default: 'active' })
  status: string;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const DatasetItemSchemaSchema =
  SchemaFactory.createForClass(DatasetItemSchema);

// Indexes
DatasetItemSchemaSchema.index({ datasetId: 1, name: 1 }, { unique: true });
