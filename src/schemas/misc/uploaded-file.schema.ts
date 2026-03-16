import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type UploadedFileDocument = HydratedDocument<UploadedFile>;

@Schema({ timestamps: true })
export class UploadedFile {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ChatMessage' })
  messageId?: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Conversation' })
  conversationId?: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  fileName: string;

  @Prop({ required: true })
  originalName: string;

  @Prop({ required: true })
  fileSize: number;

  @Prop({ required: true })
  mimeType: string;

  @Prop({ required: true, unique: true })
  s3Key: string;

  @Prop({ required: true })
  fileType: string;

  @Prop()
  extractedText?: string;

  @Prop({ default: Date.now })
  uploadedAt: Date;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const UploadedFileSchema = SchemaFactory.createForClass(UploadedFile);

// Indexes for efficient queries
UploadedFileSchema.index({ userId: 1, uploadedAt: -1 });
UploadedFileSchema.index({ conversationId: 1 });
UploadedFileSchema.index({ messageId: 1 });
