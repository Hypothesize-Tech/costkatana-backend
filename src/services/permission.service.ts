import mongoose, { ObjectId } from 'mongoose';
import { TeamMember, ITeamMember } from '../models/TeamMember';
import { Workspace } from '../models/Workspace';
import { User } from '../models/User';
import { loggingService } from './logging.service';
import { AppError } from '../middleware/error.middleware';

export interface Permissions {
  canManageBilling: boolean;
  canManageTeam: boolean;
  canManageProjects: boolean;
  canViewAnalytics: boolean;
  canManageApiKeys: boolean;
  canManageIntegrations: boolean;
  canExportData: boolean;
}

export class PermissionService {
  /**
   * Get team member record for a user in a workspace
   */
  static async getTeamMember(userId: string, workspaceId: string): Promise<ITeamMember | null> {
    try {
      loggingService.info('🔍 Getting team member', {
        userId,
        workspaceId,
        userIdType: typeof userId,
        workspaceIdType: typeof workspaceId,
      });

      const member = await TeamMember.findOne({
        userId: new mongoose.Types.ObjectId(userId),
        workspaceId: new mongoose.Types.ObjectId(workspaceId),
        status: { $in: ['active', 'invited'] },
      });

      loggingService.info('👤 Team member query result', {
        found: !!member,
        memberId: member?._id,
        memberRole: member?.role,
        memberStatus: member?.status,
      });

      return member;
    } catch (error) {
      loggingService.error('❌ Error fetching team member', { 
        error, 
        userId: userId,
        workspaceId: workspaceId 
      });
      return null;
    }
  }

  /**
   * Check if user can manage billing
   */
  static async canManageBilling(userId: string | ObjectId, workspaceId: string | ObjectId): Promise<boolean> {
    const member = await this.getTeamMember(
      typeof userId === 'string' ? userId : userId.toString(),
      typeof workspaceId === 'string' ? workspaceId : workspaceId.toString()
    );
    if (!member) return false;

    if (member.role === 'owner') return true;
    return member.customPermissions.canManageBilling;
  }

  /**
   * Check if user can invite members
   */
  static async canInviteMembers(userId: string | ObjectId, workspaceId: string | ObjectId): Promise<boolean> {
    const userIdStr = typeof userId === 'string' ? userId : userId.toString();
    const workspaceIdStr = typeof workspaceId === 'string' ? workspaceId : workspaceId.toString();
    
    loggingService.info('🔐 Checking canInviteMembers permission', {
      userId: userIdStr,
      workspaceId: workspaceIdStr,
    });

    const member = await this.getTeamMember(userIdStr, workspaceIdStr);
    
    if (!member) {
      loggingService.warn('⚠️ Member not found, denying invite permission', {
        userId: userIdStr,
        workspaceId: workspaceIdStr,
      });
      return false;
    }

    loggingService.info('✅ Member found, checking role', {
      memberRole: member.role,
      isOwnerOrAdmin: ['owner', 'admin'].includes(member.role),
    });

    if (['owner', 'admin'].includes(member.role)) return true;

    // Check workspace settings for member invites
    const workspace = await Workspace.findById(workspaceIdStr);
    if (workspace?.settings.allowMemberInvites) {
      return member.customPermissions.canManageTeam;
    }

    return false;
  }

  /**
   * Check if user can remove members
   */
  static async canRemoveMembers(userId: string | ObjectId, workspaceId: string | ObjectId): Promise<boolean> {
    const userIdStr = typeof userId === 'string' ? userId : userId.toString();
    const workspaceIdStr = typeof workspaceId === 'string' ? workspaceId : workspaceId.toString();
    const member = await this.getTeamMember(userIdStr, workspaceIdStr);
    if (!member) return false;

    if (['owner', 'admin'].includes(member.role)) return true;
    return member.customPermissions.canManageTeam;
  }

  /**
   * Check if user can assign projects to members
   */
  static async canAssignProjects(userId: string | ObjectId, workspaceId: string | ObjectId): Promise<boolean> {
    const userIdStr = typeof userId === 'string' ? userId : userId.toString();
    const workspaceIdStr = typeof workspaceId === 'string' ? workspaceId : workspaceId.toString();
    const member = await this.getTeamMember(userIdStr, workspaceIdStr);
    if (!member) return false;

    if (['owner', 'admin'].includes(member.role)) return true;
    return member.customPermissions.canManageProjects;
  }

  /**
   * Check if user can access a specific project
   */
  static async canAccessProject(userId: string | ObjectId, projectId: string | ObjectId): Promise<boolean> {
    try {
      const userIdStr = typeof userId === 'string' ? userId : userId.toString();
      const projectIdStr = typeof projectId === 'string' ? projectId : projectId.toString();
      
      // Get user's workspace
      const user = await User.findById(userIdStr).select('workspaceId');
      if (!user?.workspaceId) return false;

      const member = await this.getTeamMember(userIdStr, user.workspaceId.toString());
      if (!member) return false;

      // Admins and owners can access all projects
      if (['owner', 'admin'].includes(member.role)) return true;

      // Check if project is assigned to the member
      return member.assignedProjects.some(
        (id) => id.toString() === projectIdStr
      );
    } catch (error) {
      loggingService.error('Error checking project access', { 
        error, 
        userId: typeof userId === 'string' ? userId : userId.toString(), 
        projectId: typeof projectId === 'string' ? projectId : projectId.toString() 
      });
      return false;
    }
  }

  /**
   * Get all permissions for a member
   */
  static async getMemberPermissions(userId: string | ObjectId, workspaceId: string | ObjectId): Promise<Permissions> {
    const member = await this.getTeamMember(
      typeof userId === 'string' ? userId : userId.toString(),
      typeof workspaceId === 'string' ? workspaceId : workspaceId.toString()
    );
    
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
  static async updateMemberPermissions(
    adminId: string | ObjectId,
    memberId: string | ObjectId,
    workspaceId: string | ObjectId,
    permissions: Partial<Permissions>
  ): Promise<void> {
    // Check if admin has permission
    const canManage = await this.canRemoveMembers(adminId, workspaceId);
    if (!canManage) {
      throw new AppError('Insufficient permissions to update member permissions', 403);
    }

    // Get target member
    const member = await TeamMember.findOne({
      _id: memberId,
      workspaceId,
    });

    if (!member) {
      throw new AppError('Team member not found', 404);
    }

    // Cannot modify owner permissions
    if (member.role === 'owner') {
      throw new AppError('Cannot modify owner permissions', 403);
    }

    // Update permissions
    member.customPermissions = {
      ...member.customPermissions,
      ...permissions,
    };

    await member.save();

    loggingService.info('Member permissions updated', {
      adminId,
      memberId,
      workspaceId,
      permissions,
    });
  }

  /**
   * Check if user is workspace owner
   */
  static async isWorkspaceOwner(userId: string | ObjectId, workspaceId: string | ObjectId): Promise<boolean> {
    const userIdStr = typeof userId === 'string' ? userId : userId.toString();
    const workspaceIdStr = typeof workspaceId === 'string' ? workspaceId : workspaceId.toString();
    const member = await this.getTeamMember(userIdStr, workspaceIdStr);
    return member?.role === 'owner';
  }

  /**
   * Check if user is admin or owner
   */
  static async isAdminOrOwner(userId: string | ObjectId, workspaceId: string | ObjectId): Promise<boolean> {
    const userIdStr = typeof userId === 'string' ? userId : userId.toString();
    const workspaceIdStr = typeof workspaceId === 'string' ? workspaceId : workspaceId.toString();
    const member = await this.getTeamMember(userIdStr, workspaceIdStr);
    return member ? ['owner', 'admin'].includes(member.role) : false;
  }

  /**
   * Get user's role in workspace
   */
  static async getUserRole(userId: string | ObjectId, workspaceId: string | ObjectId): Promise<string | null> {
    const userIdStr = typeof userId === 'string' ? userId : userId.toString();
    const workspaceIdStr = typeof workspaceId === 'string' ? workspaceId : workspaceId.toString();
    const member = await this.getTeamMember(userIdStr, workspaceIdStr);
    return member?.role || null;
  }

  /**
   * Check if user can manage a specific permission
   */
  static async hasPermission(
    userId: string | ObjectId,
    workspaceId: string | ObjectId,
    permission: keyof Permissions
  ): Promise<boolean> {
    const permissions = await this.getMemberPermissions(userId, workspaceId);
    return permissions[permission];
  }

  /**
   * Validate that workspace has at least one admin
   */
  static async ensureAdminExists(workspaceId: string | ObjectId, excludeMemberId?: string | ObjectId): Promise<boolean> {
    const query: any = {
      workspaceId,
      role: { $in: ['owner', 'admin'] },
      status: 'active',
    };

    if (excludeMemberId) {
      query._id = { $ne: excludeMemberId };
    }

    const adminCount = await TeamMember.countDocuments(query);
    return adminCount > 0;
  }
}

export const permissionService = PermissionService;

