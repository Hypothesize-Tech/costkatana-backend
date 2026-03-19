import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type SimulationAccuracyDocument = HydratedDocument<SimulationAccuracy>;

@Schema({ timestamps: true, collection: 'simulation_accuracy' })
export class SimulationAccuracy {
  @Prop({ required: true })
  simulationId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  userId?: Types.ObjectId;

  @Prop()
  workspaceId?: string;

  @Prop({ required: true })
  estimatedCost: number;

  @Prop({ required: true })
  actualCost: number;

  @Prop({ required: true })
  variance: number;

  @Prop({ required: true })
  variancePercentage: number;

  @Prop({ default: Date.now })
  timestamp: Date;

  @Prop({ default: Date.now })
  createdAt: Date;
}

export const SimulationAccuracySchema =
  SchemaFactory.createForClass(SimulationAccuracy);

SimulationAccuracySchema.index({ simulationId: 1 });
SimulationAccuracySchema.index({ userId: 1, timestamp: -1 });
SimulationAccuracySchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 },
); // TTL 30 days