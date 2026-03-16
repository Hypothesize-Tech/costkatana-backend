import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type VectorizationDocumentDocument =
  HydratedDocument<VectorizationDocument>;

@Schema({ timestamps: true })
export class VectorizationDocument {
  @Prop({ required: true })
  content: string;

  @Prop({
    required: true,
    enum: ['user_memory', 'conversation', 'message', 'document', 'telemetry'],
  })
  contentType:
    | 'user_memory'
    | 'conversation'
    | 'message'
    | 'document'
    | 'telemetry';

  @Prop()
  userId?: string;

  @Prop()
  tenantId?: string;

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  @Prop({ type: Date })
  vectorizedAt?: Date;

  @Prop({ type: [Number] })
  vector?: number[];

  @Prop({
    required: true,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
  })
  vectorizationStatus: 'pending' | 'processing' | 'completed' | 'failed';

  @Prop({ required: true, default: 0 })
  vectorizationAttempts: number;

  @Prop()
  lastError?: string;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const VectorizationDocumentSchema = SchemaFactory.createForClass(
  VectorizationDocument,
);

// Indexes for performance
VectorizationDocumentSchema.index({ contentType: 1, vectorizationStatus: 1 });
VectorizationDocumentSchema.index({ userId: 1, contentType: 1 });
VectorizationDocumentSchema.index({ createdAt: -1 });
VectorizationDocumentSchema.index({
  vectorizationStatus: 1,
  vectorizationAttempts: 1,
});
VectorizationDocumentSchema.index({ vectorizedAt: -1 });
