import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type VectorizationJobDocument = HydratedDocument<VectorizationJob>;

@Schema({ timestamps: true })
export class VectorizationJob {
  @Prop({ required: true, unique: true })
  jobId: string;

  @Prop({
    required: true,
    enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
    default: 'pending',
  })
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

  @Prop({ required: true, min: 0, max: 100, default: 0 })
  progress: number;

  @Prop({ required: true, min: 0, default: 0 })
  totalItems: number;

  @Prop({ required: true, min: 0, default: 0 })
  processedItems: number;

  @Prop({ type: Date, default: Date.now })
  startTime: Date;

  @Prop({ type: Date })
  endTime?: Date;

  @Prop()
  error?: string;

  @Prop({ type: Object, required: true })
  config: {
    samplingRate: number;
    vectorizationMethod: string;
    targetDimensions: number;
    contentTypes?: string[];
    dateRange?: {
      start: Date;
      end: Date;
    };
    userFilter?: string[];
    batchSize?: number;
  };

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
  })
  initiatedBy?: MongooseSchema.Types.ObjectId;

  @Prop({ type: Object })
  results?: {
    successfulItems: number;
    failedItems: number;
    totalVectors: number;
    averageProcessingTime: number;
    vectorizationStats: Record<string, any>;
  };

  @Prop({ type: Date })
  lastProgressUpdate?: Date;

  @Prop({ default: 0 })
  retryCount: number;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const VectorizationJobSchema =
  SchemaFactory.createForClass(VectorizationJob);

// Indexes for efficient queries
VectorizationJobSchema.index({ status: 1, createdAt: -1 });
VectorizationJobSchema.index({ initiatedBy: 1, createdAt: -1 });
VectorizationJobSchema.index({ jobId: 1 }, { unique: true });
VectorizationJobSchema.index({ status: 1, updatedAt: -1 });

// TTL index to automatically clean up old completed jobs after 30 days
VectorizationJobSchema.index(
  { createdAt: 1 },
  {
    expireAfterSeconds: 30 * 24 * 60 * 60,
    partialFilterExpression: {
      status: { $in: ['completed', 'failed', 'cancelled'] },
    },
  },
);

// Pre-save middleware to update progress timestamp
VectorizationJobSchema.pre('save', function (next) {
  if (this.isModified('progress') || this.isModified('status')) {
    this.lastProgressUpdate = new Date();
  }
  next();
});
