import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ContinuityCheckpointDocument =
  HydratedDocument<ContinuityCheckpoint>;

@Schema({ timestamps: true, collection: 'continuity_checkpoints' })
export class ContinuityCheckpoint {
  @Prop({ required: true })
  id: string;

  @Prop({ required: true })
  executionId: string;

  @Prop({ required: true })
  phase: 'initializing' | 'processing' | 'completed' | 'error' | 'cancelled';

  @Prop({ required: true })
  timestamp: Date;

  @Prop()
  canResume: boolean;

  @Prop()
  tokensProcessed: number;

  @Prop()
  stepCount: number;

  @Prop()
  memoryUsage: number;

  @Prop({ type: Object })
  executionState: any;

  @Prop({ type: Object })
  metadata: any;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;

  // TTL index for automatic cleanup (7 days)
  @Prop({
    type: Date,
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  })
  expiresAt: Date;
}

export const ContinuityCheckpointSchema =
  SchemaFactory.createForClass(ContinuityCheckpoint);

// Indexes for efficient querying
ContinuityCheckpointSchema.index({ executionId: 1, timestamp: -1 });
ContinuityCheckpointSchema.index({ phase: 1 });
ContinuityCheckpointSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index
