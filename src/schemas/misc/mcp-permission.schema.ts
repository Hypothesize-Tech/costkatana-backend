import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

class ResourceRestrictions {
  @Prop([String])
  projectIds?: string[];

  @Prop([String])
  repoIds?: string[];

  @Prop([String])
  fileIds?: string[];

  @Prop([String])
  channelIds?: string[];

  @Prop({ default: false })
  ownOnly?: boolean;
}

class ToolPermissions {
  @Prop([String])
  tools?: string[];

  @Prop([String])
  scopes?: string[];

  @Prop([String])
  httpMethods?: string[];

  @Prop({ type: ResourceRestrictions })
  resources?: ResourceRestrictions;
}

@Schema({ timestamps: true, collection: 'mcppermissions' })
export class McpPermission {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({
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
  integration: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    index: true,
  })
  connectionId: MongooseSchema.Types.ObjectId;

  @Prop({ type: ToolPermissions, required: true })
  permissions: ToolPermissions;

  @Prop({ default: Date.now })
  grantedAt: Date;

  @Prop()
  expiresAt?: Date;

  @Prop({
    enum: ['user', 'admin'],
    required: true,
    default: 'user',
  })
  grantedBy: 'user' | 'admin';

  @Prop()
  lastUsed?: Date;

  @Prop({ default: 0 })
  usageCount: number;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const McpPermissionSchema = SchemaFactory.createForClass(McpPermission);

// Compound index for fast lookups
McpPermissionSchema.index({ userId: 1, integration: 1, connectionId: 1 });

// Auto-expire documents if expiresAt is set
McpPermissionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type McpPermissionDocument = HydratedDocument<McpPermission>;
