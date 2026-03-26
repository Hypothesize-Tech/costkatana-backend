import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ConnectionStatus =
  | 'active'
  | 'inactive'
  | 'error'
  | 'pending_verification';

export type DeploymentState =
  | 'BUILDING'
  | 'ERROR'
  | 'INITIALIZING'
  | 'QUEUED'
  | 'READY'
  | 'CANCELED';

export interface IVercelTeam {
  id: string;
  slug: string;
  name: string;
  avatar?: string;
}

export interface IVercelDeployment {
  id: string;
  url: string;
  state: DeploymentState;
  createdAt: Date;
}

export interface IVercelProject {
  id: string;
  name: string;
  framework?: string;
  latestDeployment?: IVercelDeployment;
  targets?: {
    production?: {
      url: string;
    };
  };
  createdAt?: Date;
  updatedAt?: Date;
}

export type VercelConnectionDocument = HydratedDocument<VercelConnection>;

@Schema({ timestamps: true, collection: 'vercel_connections' })
export class VercelConnection {
  _id: string;

  @Prop({ required: true, index: true })
  userId: string;

  /** Friendly label for UI; OAuth flow sets this explicitly; default prevents validation failures if omitted. */
  @Prop({ required: true, default: 'Vercel' })
  name: string;

  @Prop({ required: true })
  encryptedAccessToken: string;

  @Prop({
    type: String,
    enum: ['active', 'inactive', 'error', 'pending_verification'],
    default: 'pending_verification',
  })
  status: ConnectionStatus;

  @Prop({
    type: [
      {
        id: { type: String, required: true },
        name: { type: String, required: true },
        framework: String,
        latestDeployment: {
          id: String,
          url: String,
          state: {
            type: String,
            enum: [
              'BUILDING',
              'ERROR',
              'INITIALIZING',
              'QUEUED',
              'READY',
              'CANCELED',
            ],
          },
          createdAt: Date,
        },
        targets: {
          production: {
            url: String,
          },
        },
        createdAt: Date,
        updatedAt: Date,
      },
    ],
    _id: false,
  })
  projects: IVercelProject[];

  @Prop()
  vercelUserId?: string;

  @Prop()
  vercelUsername?: string;

  @Prop()
  vercelEmail?: string;

  @Prop()
  avatarUrl?: string;

  @Prop()
  teamId?: string;

  @Prop()
  teamSlug?: string;

  @Prop()
  teamName?: string;

  @Prop({
    type: {
      id: String,
      slug: String,
      name: String,
      avatar: String,
    },
    _id: false,
  })
  team?: IVercelTeam;

  @Prop()
  tokenType?: string;

  @Prop()
  lastSyncedAt?: Date;

  @Prop()
  expiresAt?: Date;

  /** In-memory / decrypted access token when used during refresh flow */
  accessToken?: string;
  /** In-memory / decrypted refresh token when used during refresh flow */
  refreshToken?: string;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const VercelConnectionSchema =
  SchemaFactory.createForClass(VercelConnection);

/** Ensure `name` is never empty (required path) when other identity fields exist */
VercelConnectionSchema.pre('save', function (next) {
  const doc = this as VercelConnectionDocument;
  const trimmed = doc.name?.trim();
  if (!trimmed) {
    doc.name =
      doc.teamName?.trim() ||
      doc.vercelUsername?.trim() ||
      doc.vercelEmail?.split('@')[0]?.trim() ||
      'Vercel';
  } else {
    doc.name = trimmed;
  }
  next();
});

// Indexes
VercelConnectionSchema.index({ userId: 1, status: 1 });
VercelConnectionSchema.index({ vercelUserId: 1 });
VercelConnectionSchema.index({ vercelUsername: 1 });
VercelConnectionSchema.index({ teamId: 1 }, { sparse: true });
VercelConnectionSchema.index({ expiresAt: 1 }, { sparse: true });
