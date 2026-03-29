import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type ExperimentSessionDocument = HydratedDocument<ExperimentSession>;

@Schema({ timestamps: true })
export class ExperimentSession {
  @Prop({ required: true, unique: true })
  sessionId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({
    type: String,
    enum: ['active', 'completed', 'cancelled'],
    default: 'active',
  })
  status: 'active' | 'completed' | 'cancelled';

  @Prop({ required: true })
  experimentType: string;

  /** Real-time comparison job progress (SSE recovery) */
  @Prop({ type: Number, default: 0 })
  progress: number;

  @Prop({ type: String, default: '' })
  stage: string;

  @Prop({ type: String, default: '' })
  message: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  partialResults?: unknown;

  @Prop({ type: String })
  experimentId?: string;

  @Prop({ type: String })
  error?: string;

  @Prop({ type: Date })
  lastUpdatedAt?: Date;
}

export const ExperimentSessionSchema =
  SchemaFactory.createForClass(ExperimentSession);

ExperimentSessionSchema.index({ userId: 1, status: 1 });
ExperimentSessionSchema.index({ createdAt: 1 });
