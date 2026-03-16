import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export interface ICustomPermissions {
  canManageBilling: boolean;
  canManageTeam: boolean;
  canManageProjects: boolean;
  canViewAnalytics: boolean;
  canManageApiKeys: boolean;
  canManageIntegrations: boolean;
  canExportData: boolean;
}

export interface ITeamMemberMethods {
  getDefaultPermissions(role: string): ICustomPermissions;
}

export type TeamMemberDocument = HydratedDocument<TeamMember> &
  ITeamMemberMethods;

@Schema({ timestamps: true })
export class TeamMember implements ITeamMemberMethods {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
  })
  workspaceId: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  userId?: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, lowercase: true, trim: true })
  email: string;

  @Prop({
    type: String,
    enum: ['owner', 'admin', 'developer', 'viewer'],
    required: true,
  })
  role: 'owner' | 'admin' | 'developer' | 'viewer';

  @Prop({
    type: {
      canManageBilling: { type: Boolean, default: false },
      canManageTeam: { type: Boolean, default: false },
      canManageProjects: { type: Boolean, default: false },
      canViewAnalytics: { type: Boolean, default: true },
      canManageApiKeys: { type: Boolean, default: false },
      canManageIntegrations: { type: Boolean, default: false },
      canExportData: { type: Boolean, default: false },
    },
  })
  customPermissions: ICustomPermissions;

  @Prop([{ type: MongooseSchema.Types.ObjectId, ref: 'Project' }])
  assignedProjects: MongooseSchema.Types.ObjectId[];

  @Prop({
    type: String,
    enum: ['active', 'invited', 'suspended'],
    default: 'invited',
  })
  status: 'active' | 'invited' | 'suspended';

  @Prop({ sparse: true })
  invitationToken?: string;

  @Prop()
  invitationExpires?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  invitedBy?: MongooseSchema.Types.ObjectId;

  @Prop({ type: Date, default: Date.now })
  invitedAt: Date;

  @Prop()
  joinedAt?: Date;

  @Prop()
  lastActiveAt?: Date;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;

  getDefaultPermissions(role: string): ICustomPermissions {
    const defaults = {
      owner: {
        canManageBilling: true,
        canManageTeam: true,
        canManageProjects: true,
        canViewAnalytics: true,
        canManageApiKeys: true,
        canManageIntegrations: true,
        canExportData: true,
      },
      admin: {
        canManageBilling: false,
        canManageTeam: true,
        canManageProjects: true,
        canViewAnalytics: true,
        canManageApiKeys: true,
        canManageIntegrations: true,
        canExportData: true,
      },
      developer: {
        canManageBilling: false,
        canManageTeam: false,
        canManageProjects: false,
        canViewAnalytics: true,
        canManageApiKeys: true,
        canManageIntegrations: false,
        canExportData: false,
      },
      viewer: {
        canManageBilling: false,
        canManageTeam: false,
        canManageProjects: false,
        canViewAnalytics: true,
        canManageApiKeys: false,
        canManageIntegrations: false,
        canExportData: false,
      },
    };
    return defaults[role as keyof typeof defaults] || defaults.viewer;
  }
}

export const TeamMemberSchema = SchemaFactory.createForClass(TeamMember);

// Indexes
TeamMemberSchema.index({ workspaceId: 1, email: 1 }, { unique: true });
TeamMemberSchema.index({ workspaceId: 1, userId: 1 });
TeamMemberSchema.index({ invitationToken: 1 });
TeamMemberSchema.index({ status: 1 });
TeamMemberSchema.index({ invitationExpires: 1 });

// Instance methods
TeamMemberSchema.methods.getDefaultPermissions = function (
  role: string,
): ICustomPermissions {
  const defaults = {
    owner: {
      canManageBilling: true,
      canManageTeam: true,
      canManageProjects: true,
      canViewAnalytics: true,
      canManageApiKeys: true,
      canManageIntegrations: true,
      canExportData: true,
    },
    admin: {
      canManageBilling: false,
      canManageTeam: true,
      canManageProjects: true,
      canViewAnalytics: true,
      canManageApiKeys: true,
      canManageIntegrations: true,
      canExportData: true,
    },
    developer: {
      canManageBilling: false,
      canManageTeam: false,
      canManageProjects: false,
      canViewAnalytics: true,
      canManageApiKeys: true,
      canManageIntegrations: false,
      canExportData: false,
    },
    viewer: {
      canManageBilling: false,
      canManageTeam: false,
      canManageProjects: false,
      canViewAnalytics: true,
      canManageApiKeys: false,
      canManageIntegrations: false,
      canExportData: false,
    },
  };
  return defaults[role as keyof typeof defaults] || defaults.viewer;
};
