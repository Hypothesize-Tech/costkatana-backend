import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * User data consent for GDPR and data protection compliance.
 * Records explicit user consent for specific processing purposes.
 */
export type UserDataConsentDocument = HydratedDocument<UserDataConsent>;

@Schema({ timestamps: true, collection: 'user_data_consents' })
export class UserDataConsent {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({
    required: true,
    index: true,
    enum: ['ai_processing', 'analytics', 'marketing', 'data_export'],
  })
  purpose: 'ai_processing' | 'analytics' | 'marketing' | 'data_export';

  @Prop({ required: true, default: true })
  consented: boolean;

  @Prop({ default: Date.now })
  consentedAt?: Date;

  @Prop()
  withdrawnAt?: Date;

  @Prop()
  version?: string;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;
}

export const UserDataConsentSchema =
  SchemaFactory.createForClass(UserDataConsent);

UserDataConsentSchema.index({ userId: 1, purpose: 1 }, { unique: true });
UserDataConsentSchema.index({ consented: 1, purpose: 1 });
