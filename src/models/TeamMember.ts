import { Schema, model, Document, ObjectId } from 'mongoose';

export interface ITeamMember extends Document {
  _id: ObjectId;
  workspaceId: ObjectId;
  userId?: ObjectId;
  email: string;
  role: 'owner' | 'admin' | 'developer' | 'viewer';
  customPermissions: {
    canManageBilling: boolean;
    canManageTeam: boolean;
    canManageProjects: boolean;
    canViewAnalytics: boolean;
    canManageApiKeys: boolean;
    canManageIntegrations: boolean;
    canExportData: boolean;
  };
  assignedProjects: ObjectId[];
  status: 'active' | 'invited' | 'suspended';
  invitationToken?: string;
  invitationExpires?: Date;
  invitedBy?: ObjectId;
  invitedAt: Date;
  joinedAt?: Date;
  lastActiveAt?: Date;
}

const teamMemberSchema = new Schema<ITeamMember>(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    role: {
      type: String,
      enum: ['owner', 'admin', 'developer', 'viewer'],
      required: true,
    },
    customPermissions: {
      canManageBilling: {
        type: Boolean,
        default: false,
      },
      canManageTeam: {
        type: Boolean,
        default: false,
      },
      canManageProjects: {
        type: Boolean,
        default: false,
      },
      canViewAnalytics: {
        type: Boolean,
        default: true,
      },
      canManageApiKeys: {
        type: Boolean,
        default: false,
      },
      canManageIntegrations: {
        type: Boolean,
        default: false,
      },
      canExportData: {
        type: Boolean,
        default: false,
      },
    },
    assignedProjects: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Project',
      },
    ],
    status: {
      type: String,
      enum: ['active', 'invited', 'suspended'],
      default: 'invited',
    },
    invitationToken: {
      type: String,
      sparse: true,
    },
    invitationExpires: {
      type: Date,
    },
    invitedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    invitedAt: {
      type: Date,
      default: Date.now,
    },
    joinedAt: {
      type: Date,
    },
    lastActiveAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
teamMemberSchema.index({ workspaceId: 1, email: 1 }, { unique: true });
teamMemberSchema.index({ workspaceId: 1, userId: 1 });
teamMemberSchema.index({ invitationToken: 1 });
teamMemberSchema.index({ status: 1 });
teamMemberSchema.index({ invitationExpires: 1 });

// Method to get default permissions based on role
teamMemberSchema.methods.getDefaultPermissions = function (role: string) {
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

export const TeamMember = model<ITeamMember>('TeamMember', teamMemberSchema);

