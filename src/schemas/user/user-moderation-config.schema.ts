import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserModerationConfigDocument = UserModerationConfig & Document;

@Schema({ timestamps: true, collection: 'user_moderation_configs' })
export class UserModerationConfig {
  @Prop({ required: true, index: true, unique: true })
  userId: string;

  // Content filtering
  @Prop({ default: true })
  enableContentFiltering: boolean;

  @Prop({
    enum: ['permissive', 'moderate', 'strict'],
    default: 'moderate',
  })
  contentFilterLevel: 'permissive' | 'moderate' | 'strict';

  // Safety settings
  @Prop({ default: true })
  blockUnsafeContent: boolean;

  @Prop({ default: false })
  allowAdultContent: boolean;

  @Prop({ default: true })
  blockHateSpeech: boolean;

  @Prop({ default: true })
  blockViolence: boolean;

  @Prop({ default: true })
  blockHarassment: boolean;

  // Custom filters
  @Prop({
    type: [String],
    set: (v: string[]) => v?.map((word) => word.trim().toLowerCase()),
  })
  customBlockedWords: string[];

  @Prop({ type: [String] })
  customBlockedPatterns: string[];

  @Prop({
    type: [String],
    set: (v: string[]) => v?.map((domain) => domain.trim().toLowerCase()),
  })
  allowedDomains: string[];

  @Prop({
    type: [String],
    set: (v: string[]) => v?.map((domain) => domain.trim().toLowerCase()),
  })
  blockedDomains: string[];

  // PII detection
  @Prop({ default: true })
  enablePIIDetection: boolean;

  @Prop({
    enum: ['basic', 'comprehensive'],
    default: 'comprehensive',
  })
  piiDetectionLevel: 'basic' | 'comprehensive';

  @Prop({ default: true })
  maskSensitiveData: boolean;

  // Response filtering
  @Prop({ default: true })
  filterModelResponses: boolean;

  @Prop({
    enum: ['low', 'medium', 'high'],
    default: 'medium',
  })
  responseSafetyLevel: 'low' | 'medium' | 'high';

  // Notification settings
  @Prop({ default: true })
  notifyOnBlockedContent: boolean;

  @Prop({ default: true })
  notifyOnSafetyViolations: boolean;

  // Compliance
  @Prop({
    type: [String],
    enum: ['gdpr', 'ccpa', 'hipaa', 'coppa'],
  })
  complianceFrameworks: ('gdpr' | 'ccpa' | 'hipaa' | 'coppa')[];

  @Prop({ default: 2555, min: 30, max: 2555 }) // 7 years for GDPR compliance
  dataRetentionDays: number;

  // Custom rules
  @Prop({
    type: [
      {
        ruleName: { type: String, required: true },
        condition: { type: String, required: true },
        action: {
          type: String,
          enum: ['block', 'warn', 'log', 'allow'],
          default: 'block',
        },
        severity: {
          type: String,
          enum: ['low', 'medium', 'high', 'critical'],
          default: 'medium',
        },
        enabled: { type: Boolean, default: true },
      },
    ],
  })
  customModerationRules: {
    ruleName: string;
    condition: string;
    action: 'block' | 'warn' | 'log' | 'allow';
    severity: 'low' | 'medium' | 'high' | 'critical';
    enabled: boolean;
  }[];

  // Status
  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  lastModerationEventAt?: Date;
}

export const UserModerationConfigSchema =
  SchemaFactory.createForClass(UserModerationConfig);

UserModerationConfigSchema.index({ userId: 1 });
UserModerationConfigSchema.index({ isActive: 1 });
UserModerationConfigSchema.index({ complianceFrameworks: 1 });
