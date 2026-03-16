import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export interface ILocation {
  city?: string;
  country?: string;
}

export type UserSessionDocument = HydratedDocument<UserSession>;

@Schema({ timestamps: true, collection: 'user_sessions' })
export class UserSession {
  @Prop({ required: true, unique: true, index: true })
  userSessionId: string;

  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  deviceName: string;

  @Prop({ required: true })
  userAgent: string;

  @Prop({ required: true, index: true })
  ipAddress: string;

  @Prop({
    type: {
      city: String,
      country: String,
    },
    _id: false,
  })
  location?: ILocation;

  @Prop()
  browser?: string;

  @Prop()
  os?: string;

  @Prop({ type: Date, default: Date.now, required: true })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now, required: true, index: true })
  lastActiveAt: Date;

  @Prop({ required: true })
  expiresAt: Date;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ required: true })
  refreshTokenHash: string;

  @Prop()
  revokeToken?: string;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const UserSessionSchema = SchemaFactory.createForClass(UserSession);

// Compound indexes for common queries
UserSessionSchema.index({ userId: 1, isActive: 1 });
UserSessionSchema.index({ userId: 1, expiresAt: 1 });
UserSessionSchema.index({ refreshTokenHash: 1 });
UserSessionSchema.index({ revokeToken: 1 }, { sparse: true });

// TTL index for automatic cleanup of expired sessions
UserSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
