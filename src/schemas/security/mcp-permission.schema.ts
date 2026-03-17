import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type IntegrationType =
  | 'vercel'
  | 'github'
  | 'google'
  | 'slack'
  | 'discord'
  | 'jira'
  | 'linear'
  | 'mongodb'
  | 'aws';

export interface IResourceRestrictions {
  projectIds: string[];
  repoIds: string[];
  fileIds: string[];
  channelIds: string[];
  ownOnly: boolean;
}

export interface IToolPermissions {
  tools: string[];
  scopes: string[];
  httpMethods: string[];
  resources: IResourceRestrictions;
}

export type McpPermissionDocument = HydratedDocument<McpPermission>;
export type IMcpPermission = McpPermission;

@Schema({ timestamps: true })
export class McpPermission {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: String,
    enum: [
      'vercel',
      'github',
      'google',
      'slack',
      'discord',
      'jira',
      'linear',
      'mongodb',
      'aws',
    ],
    required: true,
    index: true,
  })
  integration: IntegrationType;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  connectionId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: {
      tools: [String],
      scopes: [String],
      httpMethods: [String],
      resources: {
        projectIds: [String],
        repoIds: [String],
        fileIds: [String],
        channelIds: [String],
        ownOnly: { type: Boolean, default: false },
      },
    },
  })
  permissions: IToolPermissions;

  @Prop({ default: Date.now })
  grantedAt: Date;

  @Prop()
  expiresAt?: Date;

  @Prop({
    type: String,
    enum: ['user', 'admin'],
    required: true,
    default: 'user',
  })
  grantedBy: 'user' | 'admin';

  @Prop()
  lastUsed?: Date;

  @Prop({ default: 0 })
  usageCount: number;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const McpPermissionSchema = SchemaFactory.createForClass(McpPermission);

// Compound index for fast lookups
McpPermissionSchema.index({ userId: 1, integration: 1, connectionId: 1 });

// Auto-expire documents if expiresAt is set
McpPermissionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
