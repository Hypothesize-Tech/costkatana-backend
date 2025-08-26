import mongoose, { Document, Schema } from 'mongoose';

export interface INotebook extends Document {
  id: string;
  title: string;
  description: string;
  cells: Array<{
    id: string;
    type: 'markdown' | 'query' | 'visualization' | 'insight';
    content: string;
    output?: any;
    metadata?: Record<string, any>;
  }>;
  created_at: Date;
  updated_at: Date;
  tags: string[];
  template_type?: 'cost_spike' | 'model_performance' | 'usage_patterns' | 'custom';
  userId?: string;
  status: 'active' | 'archived' | 'deleted';
}

const NotebookCellSchema = new Schema({
  id: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['markdown', 'query', 'visualization', 'insight'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  output: Schema.Types.Mixed,
  metadata: Schema.Types.Mixed
});

const NotebookSchema = new Schema<INotebook>({
  title: {
    type: String,
    required: true, },
  description: {
    type: String,
    required: true
  },
  cells: [NotebookCellSchema],
  tags: [{
    type: String, }],
  template_type: {
    type: String,
    enum: ['cost_spike', 'model_performance', 'usage_patterns', 'custom'], },
  userId: {
    type: String, },
  status: {
    type: String,
    enum: ['active', 'archived', 'deleted'],
    default: 'active', }
}, {
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

// Compound indexes for efficient queries
NotebookSchema.index({ userId: 1, status: 1, created_at: -1 });
NotebookSchema.index({ template_type: 1, status: 1 });




// Virtual for id field to ensure frontend compatibility
NotebookSchema.virtual('id').get(function() {
  return this._id;
});

// Ensure virtual fields are serialized
NotebookSchema.set('toJSON', { virtuals: true });
NotebookSchema.set('toObject', { virtuals: true });

export const Notebook = mongoose.model<INotebook>('Notebook', NotebookSchema);
