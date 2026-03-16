import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

export interface INotebookCell {
  id: string;
  type: 'markdown' | 'query' | 'visualization' | 'insight';
  content: string;
  output?: any;
  metadata?: Record<string, any>;
}

export type NotebookDocument = HydratedDocument<Notebook>;

@Schema({
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
})
export class Notebook {
  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  description: string;

  @Prop([
    {
      id: { type: String, required: true },
      type: {
        type: String,
        enum: ['markdown', 'query', 'visualization', 'insight'],
        required: true,
      },
      content: { type: String, required: true },
      output: mongoose.Schema.Types.Mixed,
      metadata: mongoose.Schema.Types.Mixed,
    },
  ])
  cells: INotebookCell[];

  @Prop([{ type: String }])
  tags: string[];

  @Prop({
    type: String,
    enum: ['cost_spike', 'model_performance', 'usage_patterns', 'custom'],
  })
  template_type?:
    | 'cost_spike'
    | 'model_performance'
    | 'usage_patterns'
    | 'custom';

  @Prop()
  userId?: string;

  @Prop({
    type: String,
    enum: ['active', 'archived', 'deleted'],
    default: 'active',
  })
  status: 'active' | 'archived' | 'deleted';

  @Prop({ type: Date, default: Date.now })
  created_at: Date;

  @Prop({ type: Date, default: Date.now })
  updated_at: Date;
}

export const NotebookSchema = SchemaFactory.createForClass(Notebook);

// Compound indexes for efficient queries
NotebookSchema.index({ userId: 1, status: 1, created_at: -1 });
NotebookSchema.index({ template_type: 1, status: 1 });

// Virtual for id field to ensure frontend compatibility
NotebookSchema.virtual('id').get(function () {
  return this._id;
});

// Ensure virtual fields are serialized
NotebookSchema.set('toJSON', { virtuals: true });
NotebookSchema.set('toObject', { virtuals: true });
