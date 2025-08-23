import mongoose, { Document, Schema } from 'mongoose';

export interface INotebookExecution extends Document {
  notebook_id: string;
  execution_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  started_at: Date;
  completed_at?: Date;
  execution_time_ms: number;
  error?: string;
  results: Array<{
    cell_id: string;
    output: any;
    execution_time_ms: number;
    error?: string;
  }>;
  metadata?: Record<string, any>;
  userId?: string;
}

const ExecutionResultSchema = new Schema({
  cell_id: {
    type: String,
    required: true
  },
  output: Schema.Types.Mixed,
  execution_time_ms: {
    type: Number,
    required: true
  },
  error: String
});

const NotebookExecutionSchema = new Schema<INotebookExecution>({
  notebook_id: {
    type: String,
    required: true,
    index: true
  },
  execution_id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'running', 'completed', 'failed'],
    default: 'pending',
    index: true
  },
  started_at: {
    type: Date,
    required: true,
    index: true
  },
  completed_at: Date,
  execution_time_ms: {
    type: Number,
    default: 0
  },
  error: String,
  results: [ExecutionResultSchema],
  metadata: Schema.Types.Mixed,
  userId: {
    type: String,
    index: true
  }
}, {
  timestamps: true
});

// Compound indexes for efficient queries
NotebookExecutionSchema.index({ notebook_id: 1, status: 1, started_at: -1 });
NotebookExecutionSchema.index({ userId: 1, status: 1, started_at: -1 });
NotebookExecutionSchema.index({ status: 1, started_at: -1 });

// TTL index for cleanup (optional)
if (process.env.EXECUTION_TTL_DAYS) {
  const ttlDays = parseInt(process.env.EXECUTION_TTL_DAYS);
  NotebookExecutionSchema.index({ started_at: 1 }, { expireAfterSeconds: ttlDays * 24 * 60 * 60 });
}

// Virtual for id field to ensure frontend compatibility
NotebookExecutionSchema.virtual('id').get(function() {
  return this._id;
});

// Ensure virtual fields are serialized
NotebookExecutionSchema.set('toJSON', { virtuals: true });
NotebookExecutionSchema.set('toObject', { virtuals: true });

export const NotebookExecution = mongoose.model<INotebookExecution>('NotebookExecution', NotebookExecutionSchema);
