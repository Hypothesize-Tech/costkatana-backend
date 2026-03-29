import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DeadLetterJobDocument = HydratedDocument<DeadLetterJob>;

@Schema({ timestamps: true })
export class DeadLetterJob {
  @Prop({ required: true })
  originalQueue: string;

  @Prop({ required: true })
  originalJobId: string;

  @Prop({ type: Object, required: true })
  jobData: Record<string, any>;

  @Prop({ required: true })
  failedReason: string;

  @Prop({ required: true, default: 0 })
  attemptsMade: number;

  @Prop({ required: true, default: 3 })
  maxAttempts: number;

  @Prop({ required: true, default: Date.now })
  failedAt: Date;

  @Prop({ required: true, default: 0 })
  retryCount: number;

  @Prop({ type: Date })
  lastRetryAt?: Date;

  @Prop({ type: Date })
  archivedAt?: Date;

  @Prop({ type: Date })
  resolvedAt?: Date;

  @Prop({
    required: true,
    enum: ['pending', 'retrying', 'archived', 'resolved', 'escalated'],
    default: 'pending',
  })
  status: 'pending' | 'retrying' | 'archived' | 'resolved' | 'escalated';

  @Prop({
    required: true,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium',
  })
  priority: 'low' | 'medium' | 'high' | 'critical';

  @Prop({ type: [String] })
  tags?: string[];

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const DeadLetterJobSchema = SchemaFactory.createForClass(DeadLetterJob);

// Indexes for performance
DeadLetterJobSchema.index({ status: 1, priority: 1 });
DeadLetterJobSchema.index({ originalQueue: 1, status: 1 });
DeadLetterJobSchema.index({ failedAt: -1 });
DeadLetterJobSchema.index({ priority: 1, status: 1 });
DeadLetterJobSchema.index({ tags: 1 });
