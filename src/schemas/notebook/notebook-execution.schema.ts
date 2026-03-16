import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

export interface IExecutionResult {
  cell_id: string;
  output: any;
  execution_time_ms: number;
  error?: string;
}

export type NotebookExecutionDocument = HydratedDocument<NotebookExecution>;

@Schema({ timestamps: true })
export class NotebookExecution {
  @Prop({ required: true })
  notebook_id: string;

  @Prop({ required: true, unique: true })
  execution_id: string;

  @Prop({
    type: String,
    enum: ['pending', 'running', 'completed', 'failed'],
    default: 'pending',
  })
  status: 'pending' | 'running' | 'completed' | 'failed';

  @Prop({ required: true })
  started_at: Date;

  @Prop()
  completed_at?: Date;

  @Prop({ default: 0 })
  execution_time_ms: number;

  @Prop()
  error?: string;

  @Prop([
    {
      cell_id: { type: String, required: true },
      output: mongoose.Schema.Types.Mixed,
      execution_time_ms: { type: Number, required: true },
      error: String,
    },
  ])
  results: IExecutionResult[];

  @Prop({ type: mongoose.Schema.Types.Mixed })
  metadata?: Record<string, any>;

  @Prop()
  userId?: string;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const NotebookExecutionSchema =
  SchemaFactory.createForClass(NotebookExecution);

// Compound indexes for efficient queries
NotebookExecutionSchema.index({ notebook_id: 1, status: 1, started_at: -1 });
NotebookExecutionSchema.index({ userId: 1, status: 1, started_at: -1 });
NotebookExecutionSchema.index({ status: 1, started_at: -1 });

// TTL index for cleanup (optional)
if (process.env.EXECUTION_TTL_DAYS) {
  const ttlDays = parseInt(process.env.EXECUTION_TTL_DAYS);
  NotebookExecutionSchema.index(
    { started_at: 1 },
    { expireAfterSeconds: ttlDays * 24 * 60 * 60 },
  );
}

// Virtual for id field to ensure frontend compatibility
NotebookExecutionSchema.virtual('id').get(function () {
  return this._id;
});

// Ensure virtual fields are serialized
NotebookExecutionSchema.set('toJSON', { virtuals: true });
NotebookExecutionSchema.set('toObject', { virtuals: true });
