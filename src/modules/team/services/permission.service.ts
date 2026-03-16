import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  TeamMember,
  TeamMemberDocument,
  ICustomPermissions,
} from '../../../schemas/team-project/team-member.schema';
import {
  Workspace,
  WorkspaceDocument,
} from '../../../schemas/user/workspace.schema';
import { User, UserDocument } from '../../../schemas/user/user.schema';

export interface Permissions {
  canManageBilling: boolean;
  canManageTeam: boolean;
  canManageProjects: boolean;
  canViewAnalytics: boolean;
  canManageApiKeys: boolean;
  canManageIntegrations: boolean;
  canExportData: boolean;
}

@Injectable()
export class PermissionService {
  private readonly logger = new Logger(PermissionService.name);

  constructor(
    @InjectModel(TeamMember.name)
    private teamMemberModel: Model<TeamMemberDocument>,
    @InjectModel(Workspace.name)
    private workspaceModel: Model<WorkspaceDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  /**
   * Get team member record for a user in a workspace
   */
  async getTeamMember(
    userId: string,
    workspaceId: string,
  ): Promise<TeamMemberDocument | null> {
    try {
      this.logger.debug('🔍 Getting team member', {
        userId,
        workspaceId,
        userIdType: typeof userId,
        workspaceIdType: typeof workspaceId,
      });

      const member = await this.teamMemberModel.findOne({
        userId,
        workspaceId,
        status: { $in: ['active', 'invited'] },
      });

      this.logger.debug('👤 Team member query result', {
        found: !!member,
        memberId: member?._id,
        memberRole: member?.role,
        memberStatus: member?.status,
      });

      return member;
    } catch (error) {
      this.logger.error('❌ Error fetching team member', {
        error,
        userId,
        workspaceId,
      });
      return null;
    }
  }

  /**
   * Check if user can manage billing
   */
  async canManageBilling(
    userId: string,
    workspaceId: string,
  ): Promise<boolean> {
    const member = await this.getTeamMember(userId, workspaceId);
    if (!member) return false;

    if (member.role === 'owner') return true;
    return member.customPermissions.canManageBilling;
  }

  /**
   * Check if user can invite members
   */
  async canInviteMembers(
    userId: string,
    workspaceId: string,
  ): Promise<boolean> {
    this.logger.debug('🔐 Checking canInviteMembers permission', {
      userId,
      workspaceId,
    });

    const member = await this.getTeamMember(userId, workspaceId);

    if (!member) {
      this.logger.warn('⚠️ Member not found, denying invite permission', {
        userId,
        workspaceId,
      });
      return false;
    }

    this.logger.debug('✅ Member found, checking role', {
      memberRole: member.role,
      isOwnerOrAdmin: ['owner', 'admin'].includes(member.role),
    });

    if (['owner', 'admin'].includes(member.role)) return true;

    // Check workspace settings for member invites
    const workspace = await this.workspaceModel.findById(workspaceId);
    if (workspace?.settings.allowMemberInvites) {
      return member.customPermissions.canManageTeam;
    }

    return false;
  }

  /**
   * Check if user can remove members
   */
  async canRemoveMembers(
    userId: string,
    workspaceId: string,
  ): Promise<boolean> {
    const member = await this.getTeamMember(userId, workspaceId);
    if (!member) return false;

    if (['owner', 'admin'].includes(member.role)) return true;
    return member.customPermissions.canManageTeam;
  }

  /**
   * Check if user can assign projects to members
   */
  async canAssignProjects(
    userId: string,
    workspaceId: string,
  ): Promise<boolean> {
    const member = await this.getTeamMember(userId, workspaceId);
    if (!member) return false;

    if (['owner', 'admin'].includes(member.role)) return true;
    return member.customPermissions.canManageProjects;
  }

  /**
   * Check if user can access a specific project
   */
  async canAccessProject(userId: string, projectId: string): Promise<boolean> {
    try {
      // Get user's workspace
      const user = await this.userModel.findById(userId).select('workspaceId');
      if (!user?.workspaceId) return false;

      const member = await this.getTeamMember(
        userId,
        user.workspaceId.toString(),
      );
      if (!member) return false;

      // Admins and owners can access all projects
      if (['owner', 'admin'].includes(member.role)) return true;

      // Check if project is assigned to the member
      return member.assignedProjects.some((id) => id.toString() === projectId);
    } catch (error) {
      this.logger.error('Error checking project access', {
        error,
        userId,
        projectId,
      });
      return false;
    }
  }

  /**
   * Get all permissions for a member
   */
  async getMemberPermissions(
    userId: string,
    workspaceId: string,
  ): Promise<Permissions> {
    const member = await this.getTeamMember(userId, workspaceId);

    if (!member) {
      return {
        canManageBilling: false,
        canManageTeam: false,
        canManageProjects: false,
        canViewAnalytics: false,
        canManageApiKeys: false,
        canManageIntegrations: false,
        canExportData: false,
      };
    }

    // Owner gets all permissions
    if (member.role === 'owner') {
      return {
        canManageBilling: true,
        canManageTeam: true,
        canManageProjects: true,
        canViewAnalytics: true,
        canManageApiKeys: true,
        canManageIntegrations: true,
        canExportData: true,
      };
    }

    // Return custom permissions for other roles
    return member.customPermissions;
  }

  /**
   * Update member permissions (only by admins/owner)
   */
  async updateMemberPermissions(
    adminId: string,
    memberId: string,
    workspaceId: string,
    permissions: Partial<Permissions>,
  ): Promise<void> {
    // Check if admin has permission
    const canManage = await this.canRemoveMembers(adminId, workspaceId);
    if (!canManage) {
      throw new ForbiddenException(
        'Insufficient permissions to update member permissions',
      );
    }

    // Get target member
    const member = await this.teamMemberModel.findOne({
      _id: memberId,
      workspaceId,
    });

    if (!member) {
      throw new NotFoundException('Team member not found');
    }

    // Cannot modify owner permissions
    if (member.role === 'owner') {
      throw new ForbiddenException('Cannot modify owner permissions');
    }

    // Update permissions
    member.customPermissions = {
      ...member.customPermissions,
      ...permissions,
    };

    await member.save();

    this.logger.log('Member permissions updated', {
      adminId,
      memberId,
      workspaceId,
      permissions,
    });
  }

  /**
   * Check if user is workspace owner
   */
  async isWorkspaceOwner(
    userId: string,
    workspaceId: string,
  ): Promise<boolean> {
    const member = await this.getTeamMember(userId, workspaceId);
    return member?.role === 'owner';
  }

  /**
   * Check if user is admin or owner
   */
  async isAdminOrOwner(userId: string, workspaceId: string): Promise<boolean> {
    const member = await this.getTeamMember(userId, workspaceId);
    return member ? ['owner', 'admin'].includes(member.role) : false;
  }

  /**
   * Get user's role in workspace
   */
  async getUserRole(
    userId: string,
    workspaceId: string,
  ): Promise<string | null> {
    const member = await this.getTeamMember(userId, workspaceId);
    return member?.role || null;
  }

  /**
   * Check if user can manage a specific permission
   */
  async hasPermission(
    userId: string,
    workspaceId: string,
    permission: keyof Permissions,
  ): Promise<boolean> {
    const permissions = await this.getMemberPermissions(userId, workspaceId);
    return permissions[permission];
  }

  /**
   * Validate that workspace has at least one admin
   */
  async ensureAdminExists(
    workspaceId: string,
    excludeMemberId?: string,
  ): Promise<boolean> {
    const query: any = {
      workspaceId,
      role: { $in: ['owner', 'admin'] },
      status: 'active',
    };

    if (excludeMemberId) {
      query._id = { $ne: excludeMemberId };
    }

    const adminCount = await this.teamMemberModel.countDocuments(query);
    return adminCount > 0;
  }
}
