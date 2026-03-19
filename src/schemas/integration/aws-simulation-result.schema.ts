import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type AwsSimulationResultDocument = HydratedDocument<AwsSimulationResult>;

@Schema({ timestamps: true, collection: 'aws_simulation_results' })
export class AwsSimulationResult {
  @Prop({ required: true, unique: true })
  planId: string;

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, ref: 'User' })
  userId: Types.ObjectId;

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, ref: 'AWSConnection' })
  connectionId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  result: Record<string, unknown>;

  @Prop({ required: true, default: Date.now })
  simulatedAt: Date;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const AwsSimulationResultSchema =
  SchemaFactory.createForClass(AwsSimulationResult);

AwsSimulationResultSchema.index({ planId: 1 }, { unique: true });
AwsSimulationResultSchema.index({ userId: 1, simulatedAt: -1 });
AwsSimulationResultSchema.index(
  { simulatedAt: 1 },
  { expireAfterSeconds: 24 * 60 * 60 },
); // TTL 24 hours