import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type ModerationConfigDocument = HydratedDocument<ModerationConfig>;

export interface ModerationConfigInput {
  enableBasicFirewall?: boolean;
  enableAdvancedFirewall?: boolean;
  promptGuardThreshold?: number;
  openaiSafeguardThreshold?: number;
}

export interface ModerationConfigOutput {
  enableOutputModeration?: boolean;
  toxicityThreshold?: number;
  enablePIIDetection?: boolean;
  enableToxicityCheck?: boolean;
  enableHateSpeechCheck?: boolean;
  enableSexualContentCheck?: boolean;
  enableViolenceCheck?: boolean;
  enableSelfHarmCheck?: boolean;
  action?: 'block' | 'redact' | 'annotate';
}

export interface ModerationConfigPii {
  enablePIIDetection?: boolean;
  useAI?: boolean;
  sanitizationEnabled?: boolean;
}

@Schema({ timestamps: true, collection: 'moderationconfigs' })
export class ModerationConfig {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.Mixed, default: () => ({}) })
  inputModeration: ModerationConfigInput;

  @Prop({ type: MongooseSchema.Types.Mixed, default: () => ({}) })
  outputModeration: ModerationConfigOutput;

  @Prop({ type: MongooseSchema.Types.Mixed, default: () => ({}) })
  piiDetection: ModerationConfigPii;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const ModerationConfigSchema =
  SchemaFactory.createForClass(ModerationConfig);
ModerationConfigSchema.index({ userId: 1 }, { unique: true });
