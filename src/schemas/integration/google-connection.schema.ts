import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ConnectionStatus =
  | 'active'
  | 'inactive'
  | 'error'
  | 'pending_verification';

export interface IGoogleScope {
  scope: string;
  description?: string;
}

export type GoogleConnectionDocument = HydratedDocument<GoogleConnection>;

@Schema({ timestamps: true, collection: 'google_connections' })
export class GoogleConnection {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: false })
  name?: string;

  /** Nest/OAuth format: JSON string of { encrypted, iv } from encryptCBC, or legacy combined "enc:iv:tag" */
  @Prop({ required: false, select: false })
  encryptedAccessToken?: string;

  @Prop({ required: false, select: false })
  encryptedRefreshToken?: string;

  /** Express legacy: combined format encrypted token. Select explicitly when needed. */
  @Prop({ select: false })
  accessToken?: string;

  @Prop({ select: false })
  refreshToken?: string;

  @Prop({ default: 'oauth' })
  tokenType?: string;

  /** Space-separated OAuth scopes (Express style) */
  @Prop()
  scope?: string;

  @Prop({
    type: String,
    enum: ['active', 'inactive', 'error', 'pending_verification'],
    default: 'pending_verification',
  })
  status: ConnectionStatus;

  /** Health status for API compatibility: healthy | needs_reconnect | error */
  @Prop({
    type: String,
    enum: ['healthy', 'needs_reconnect', 'error'],
    default: 'healthy',
  })
  healthStatus?: string;

  @Prop({
    type: [
      {
        scope: { type: String, required: true },
        description: String,
      },
    ],
    _id: false,
  })
  scopes?: IGoogleScope[];

  @Prop()
  googleUserId?: string;

  @Prop()
  googleEmail?: string;

  @Prop()
  googleName?: string;

  @Prop()
  avatarUrl?: string;

  @Prop()
  lastSyncedAt?: Date;

  @Prop({
    type: [
      {
        id: { type: String, required: true },
        name: { type: String, required: true },
        mimeType: String,
        webViewLink: String,
        iconLink: String,
        createdTime: Date,
        modifiedTime: Date,
        size: Number,
        parents: [String],
      },
    ],
    _id: false,
  })
  driveFiles?: {
    id: string;
    name: string;
    mimeType?: string;
    webViewLink?: string;
    iconLink?: string;
    createdTime?: Date;
    modifiedTime?: Date;
    size?: number;
    parents?: string[];
  }[];

  @Prop()
  expiresAt?: Date;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const GoogleConnectionSchema =
  SchemaFactory.createForClass(GoogleConnection);

GoogleConnectionSchema.index({ userId: 1, status: 1 });
GoogleConnectionSchema.index({ userId: 1, isActive: 1 });
GoogleConnectionSchema.index({ googleUserId: 1 });
GoogleConnectionSchema.index({ googleEmail: 1 });
GoogleConnectionSchema.index({ healthStatus: 1 });
GoogleConnectionSchema.index({ expiresAt: 1 }, { sparse: true });
