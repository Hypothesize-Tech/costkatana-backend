import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export interface GeminiCacheContent {
  role: 'user' | 'model';
  parts: Array<{
    text?: string;
    inlineData?: {
      mimeType: string;
      data: string;
    };
  }>;
}

export interface GeminiCachedContent {
  id: string;
  content: GeminiCacheContent[];
  model: string;
  displayName?: string;
  createdAt: Date;
  expiresAt: Date;
  usageCount: number;
  lastUsed?: Date;
  metadata?: Record<string, unknown>;
}

@Schema({ timestamps: true, collection: 'gemini_caches' })
export class GeminiCache {
  @Prop({ required: true, unique: true })
  id!: string;

  @Prop({ type: [Object], required: true })
  content!: GeminiCacheContent[];

  /** Model identifier; named modelName to avoid conflict with Mongoose Document.model() */
  @Prop({ required: true })
  modelName!: string;

  @Prop()
  displayName?: string;

  @Prop({ required: true })
  createdAt!: Date;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ default: 0 })
  usageCount!: number;

  @Prop()
  lastUsed?: Date;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;
}

export type GeminiCacheDocument = GeminiCache & Document;

export const GeminiCacheSchema = SchemaFactory.createForClass(GeminiCache);

// Add indexes for efficient querying
GeminiCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index
GeminiCacheSchema.index({ modelName: 1 });
GeminiCacheSchema.index({ usageCount: -1 });
GeminiCacheSchema.index({ lastUsed: -1 });
