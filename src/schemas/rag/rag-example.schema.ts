import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export interface IRAGExampleMetadata {
  type: string;
  tags: string[];
  category?: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  domain?: string;
}

export type RAGExampleDocument = RAGExample & Document;

@Schema({
  timestamps: true,
  collection: 'rag_examples',
})
export class RAGExample {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true, maxlength: 10000 })
  content: string;

  @Prop({ type: Object, required: true })
  metadata: IRAGExampleMetadata;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: Number, default: 0 })
  usageCount: number;

  @Prop({ type: Date })
  lastUsed?: Date;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const RAGExampleSchema = SchemaFactory.createForClass(RAGExample);

// Indexes for performance
RAGExampleSchema.index({ 'metadata.type': 1 });
RAGExampleSchema.index({ 'metadata.tags': 1 });
RAGExampleSchema.index({ 'metadata.category': 1 });
RAGExampleSchema.index({ isActive: 1, usageCount: -1 });
RAGExampleSchema.index({ createdAt: -1 });
