import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ProviderKeyDocument = HydratedDocument<ProviderKey>;

@Schema({ timestamps: true })
export class ProviderKey {
  @Prop({ required: true, trim: true, maxlength: 100 })
  name: string;

  @Prop({
    required: true,
    enum: [
      'openai',
      'anthropic',
      'google',
      'cohere',
      'aws-bedrock',
      'deepseek',
      'groq',
    ],
  })
  provider:
    | 'openai'
    | 'anthropic'
    | 'google'
    | 'cohere'
    | 'aws-bedrock'
    | 'deepseek'
    | 'groq';

  @Prop({ required: true })
  encryptedKey: string;

  @Prop({ required: true })
  maskedKey: string;

  @Prop({ type: String, ref: 'User', required: true })
  userId: string;

  @Prop({ trim: true, maxlength: 500 })
  description?: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  lastUsed?: Date;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const ProviderKeySchema = SchemaFactory.createForClass(ProviderKey);

// Indexes
ProviderKeySchema.index({ userId: 1 });
ProviderKeySchema.index({ provider: 1 });
ProviderKeySchema.index({ userId: 1, isActive: 1 });
ProviderKeySchema.index({ userId: 1, provider: 1, name: 1 }, { unique: true });
