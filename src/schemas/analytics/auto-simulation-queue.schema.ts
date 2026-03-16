import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type AutoSimulationQueueDocument = HydratedDocument<AutoSimulationQueue>;

@Schema({ timestamps: true, collection: 'auto_simulation_queue' })
export class AutoSimulationQueue {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Usage',
    required: true,
  })
  usageId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: String,
    enum: [
      'pending',
      'processing',
      'completed',
      'failed',
      'approved',
      'rejected',
    ],
    default: 'pending',
  })
  status:
    | 'pending'
    | 'processing'
    | 'completed'
    | 'failed'
    | 'approved'
    | 'rejected';

  @Prop()
  simulationId?: string;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  optimizationOptions: any[];

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  recommendations: any[];

  @Prop()
  potentialSavings?: number;

  @Prop()
  confidence?: number;

  @Prop({ type: Boolean, default: false })
  autoApplied: boolean;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  appliedOptimizations: any[];

  @Prop()
  processedAt?: Date;

  @Prop()
  errorMessage?: string;

  @Prop({ type: Number, default: 0 })
  retryCount: number;

  @Prop({ type: Number, default: 3 })
  maxRetries: number;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const AutoSimulationQueueSchema =
  SchemaFactory.createForClass(AutoSimulationQueue);

// Indexes for performance
AutoSimulationQueueSchema.index({ userId: 1, status: 1 });
AutoSimulationQueueSchema.index({ status: 1, createdAt: 1 });
