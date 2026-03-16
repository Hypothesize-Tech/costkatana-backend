import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MagicLinkTokenDocument = MagicLinkToken & Document;

@Schema({
  timestamps: true,
  collection: 'magic_link_tokens',
  expires: '24h', // TTL index - tokens expire after 24 hours
})
export class MagicLinkToken {
  @Prop({ required: true, index: true })
  email: string;

  @Prop({ required: true, unique: true })
  token: string;

  @Prop({ default: false })
  used: boolean;

  @Prop({ type: Date })
  usedAt?: Date;

  @Prop({ type: Object })
  metadata?: {
    redirectUrl?: string;
    userAgent?: string;
    ipAddress?: string;
  };

  @Prop({ type: Types.ObjectId, ref: 'User' })
  userId?: Types.ObjectId;

  // TTL index for automatic expiration
  @Prop({ type: Date, default: Date.now, expires: '24h' })
  createdAt: Date;
}

export const MagicLinkTokenSchema =
  SchemaFactory.createForClass(MagicLinkToken);

// Additional indexes for performance (token unique index created by @Prop)
MagicLinkTokenSchema.index({ email: 1, used: 1 });
MagicLinkTokenSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 }); // 24 hours
