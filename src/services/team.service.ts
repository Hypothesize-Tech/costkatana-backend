import mongoose, { ObjectId } from 'mongoose';
import crypto from 'crypto';
import { TeamMember, ITeamMember } from '../models/TeamMember';
import { Workspace } from '../models/Workspace';
import { User } from '../models/User';
import { loggingService } from './logging.service';
import { permissionService, Permissions } from './permission.service';
import { AppError } from '../middleware/error.middleware';
import { EmailService } from './email.service';

const INVITATION_EXPIRY_DAYS = 7;

export class TeamService {
  /**
   * Invite a new member to the workspace
   */
  static async inviteMember(
    workspaceId: string | ObjectId,
    email: string,
    role: 'admin' | 'developer' | 'viewer',
    invitedBy: string | ObjectId,
    projectIds?: string[]
  ): Promise<ITeamMember> {
    try {
      // Verify inviter has permission
      const canInvite = await permissionService.canInviteMembers(invitedBy, workspaceId);
      if (!canInvite) {
        throw new AppError('Insufficient permissions to invite members', 403);
      }

      // Get workspace details
      const workspace = await Workspace.findById(workspaceId);
      if (!workspace) {
        throw new AppError('Workspace not found', 404);
      }

      // Check if email already exists in workspace
      const existingMember = await TeamMember.findOne({
        workspaceId,
        email: email.toLowerCase(),
      });

      if (existingMember) {
        if (existingMember.status === 'active') {
          throw new AppError('User is already a member of this workspace', 400);
        }
        if (existingMember.status === 'invited') {
          throw new AppError('Invitation already sent to this email', 400);
        }
      }

      // Check seat availability
      const activeMembers = await TeamMember.countDocuments({
        workspaceId,
        status: { $in: ['active', 'invited'] },
      });

      const totalSeats = workspace.billing.seatsIncluded + workspace.billing.additionalSeats;
      if (activeMembers >= totalSeats) {
        throw new AppError('No available seats. Please upgrade your plan.', 400);
      }

      // Check if user exists
      const existingUser = await User.findOne({ email: email.toLowerCase() });

      // Generate invitation token
      const invitationToken = crypto.randomBytes(32).toString('hex');
      const invitationExpires = new Date();
      invitationExpires.setDate(invitationExpires.getDate() + INVITATION_EXPIRY_DAYS);

      // Get default permissions for role
      const defaultPermissions = this.getDefaultPermissionsForRole(role);

      // Create team member record
      const teamMember = new TeamMember({
        workspaceId,
        userId: existingUser?._id,
        email: email.toLowerCase(),
        role,
        customPermissions: defaultPermissions,
        assignedProjects: projectIds || [],
        status: 'invited',
        invitationToken,
        invitationExpires,
        invitedBy,
        invitedAt: new Date(),
      });

      await teamMember.save();

      // Get inviter details
      const inviter = await User.findById(invitedBy);
      const inviterName = inviter?.name || 'Team Admin';

      // Send invitation email
      const inviteUrl = `${process.env.FRONTEND_URL}/accept-invite/${invitationToken}`;
      await EmailService.sendTeamInvitation(
        email,
        inviterName,
        workspace.name,
        inviteUrl,
        role
      );

      loggingService.info('Team member invited', {
        workspaceId,
        email,
        role,
        invitedBy,
      });

      return teamMember;
    } catch (error: any) {
      loggingService.error('Error inviting team member', { error, workspaceId, email });
      throw error;
    }
  }

  /**
   * Accept an invitation
   */
  static async acceptInvitation(token: string, userId: string | ObjectId): Promise<ITeamMember> {
    try {
      const invitation = await TeamMember.findOne({
        invitationToken: token,
        status: 'invited',
      });

      if (!invitation) {
        throw new AppError('Invalid or expired invitation', 400);
      }

      if (invitation.invitationExpires && invitation.invitationExpires < new Date()) {
        throw new AppError('Invitation has expired', 400);
      }

      // Get user details
      const user = await User.findById(userId);
      if (!user) {
        throw new AppError('User not found', 404);
      }

      // Verify email matches
      if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
        throw new AppError('Email mismatch. Please sign up with the invited email.', 400);
      }

      // Update team member
      invitation.userId = new mongoose.Types.ObjectId(user._id.toString()) as any;
      invitation.status = 'active';
      invitation.joinedAt = new Date();
      invitation.invitationToken = undefined;
      invitation.invitationExpires = undefined;
      await invitation.save();

      // Update user's workspace membership
      if (!user.workspaceId) {
        user.workspaceId = invitation.workspaceId;
      }

      const membershipExists = user.workspaceMemberships.some(
        (m) => m.workspaceId.toString() === invitation.workspaceId.toString()
      );

      if (!membershipExists) {
        user.workspaceMemberships.push({
          workspaceId: invitation.workspaceId as ObjectId,
          role: invitation.role,
          joinedAt: new Date(),
        });
        await user.save();
      }

      loggingService.info('Invitation accepted', {
        userId: typeof userId === 'string' ? userId : userId?.toString(),
        workspaceId: invitation.workspaceId.toString(),
        email: invitation.email,
      });

      return invitation;
    } catch (error: any) {
      loggingService.error('Error accepting invitation', { error, token });
      throw error;
    }
  }

  /**
   * Resend invitation
   */
  static async resendInvitation(workspaceId: string | ObjectId, memberId: string | ObjectId, userId: string | ObjectId): Promise<void> {
    try {
      // Check permissions
      const canInvite = await permissionService.canInviteMembers(userId, workspaceId);
      if (!canInvite) {
        throw new AppError('Insufficient permissions', 403);
      }

      const member = await TeamMember.findOne({
        _id: memberId,
        workspaceId,
        status: 'invited',
      });

      if (!member) {
        throw new AppError('Pending invitation not found', 404);
      }

      // Generate new token and expiry
      const invitationToken = crypto.randomBytes(32).toString('hex');
      const invitationExpires = new Date();
      invitationExpires.setDate(invitationExpires.getDate() + INVITATION_EXPIRY_DAYS);

      member.invitationToken = invitationToken;
      member.invitationExpires = invitationExpires;
      await member.save();

      // Get workspace and inviter details
      const [workspace, inviter] = await Promise.all([
        Workspace.findById(workspaceId),
        User.findById(userId),
      ]);

      if (!workspace) {
        throw new AppError('Workspace not found', 404);
      }

      const inviterName = inviter?.name || 'Team Admin';
      const inviteUrl = `${process.env.FRONTEND_URL}/accept-invite/${invitationToken}`;

      await EmailService.sendTeamInvitation(
        member.email,
        inviterName,
        workspace.name,
        inviteUrl,
        member.role
      );

      loggingService.info('Invitation resent', { workspaceId, memberId, email: member.email });
    } catch (error: any) {
      loggingService.error('Error resending invitation', { error, workspaceId, memberId });
      throw error;
    }
  }

  /**
   * Remove a member from workspace
   */
  static async removeMember(
    workspaceId: string | ObjectId,
    memberId: string | ObjectId,
    removedBy: string | ObjectId
  ): Promise<void> {
    try {
      // Check permissions
      const canRemove = await permissionService.canRemoveMembers(removedBy, workspaceId);
      if (!canRemove) {
        throw new AppError('Insufficient permissions to remove members', 403);
      }

      const member = await TeamMember.findOne({
        _id: memberId,
        workspaceId,
      });

      if (!member) {
        throw new AppError('Team member not found', 404);
      }

      // Cannot remove owner
      if (member.role === 'owner') {
        throw new AppError('Cannot remove workspace owner', 400);
      }

      // Ensure at least one admin remains
      if (member.role === 'admin') {
        const hasOtherAdmin = await permissionService.ensureAdminExists(workspaceId, memberId);
        if (!hasOtherAdmin) {
          throw new AppError('Cannot remove the last admin. Promote another member first.', 400);
        }
      }

      // Get workspace for email
      const workspace = await Workspace.findById(workspaceId);
      const remover = await User.findById(removedBy);

      // Delete team member record
      await TeamMember.deleteOne({ _id: memberId });

      // Update user's workspace memberships if user exists
      if (member.userId) {
        await User.updateOne(
          { _id: member.userId },
          {
            $pull: {
              workspaceMemberships: { workspaceId: workspaceId },
            },
          }
        );
      }

      // Send notification email
      if (workspace && member.status === 'active') {
        await EmailService.sendMemberRemoved(
          member.email,
          workspace.name,
          remover?.name || 'Team Admin'
        );
      }

      loggingService.info('Team member removed', {
        workspaceId,
        memberId,
        email: member.email,
        removedBy,
      });
    } catch (error: any) {
      loggingService.error('Error removing team member', { error, workspaceId, memberId });
      throw error;
    }
  }

  /**
   * Update member role
   */
  static async updateMemberRole(
    workspaceId: string | ObjectId,
    memberId: string | ObjectId,
    newRole: 'admin' | 'developer' | 'viewer',
    updatedBy: string | ObjectId
  ): Promise<ITeamMember> {
    try {
      // Check permissions
      const isAdminOrOwner = await permissionService.isAdminOrOwner(updatedBy, workspaceId);
      if (!isAdminOrOwner) {
        throw new AppError('Insufficient permissions to update roles', 403);
      }

      const member = await TeamMember.findOne({
        _id: memberId,
        workspaceId,
      });

      if (!member) {
        throw new AppError('Team member not found', 404);
      }

      // Cannot change owner role
      if (member.role === 'owner') {
        throw new AppError('Cannot change owner role', 400);
      }

      // If downgrading from admin, ensure another admin exists
      if (member.role === 'admin' && newRole !== 'admin') {
        const hasOtherAdmin = await permissionService.ensureAdminExists(workspaceId, memberId);
        if (!hasOtherAdmin) {
          throw new AppError('Cannot downgrade the last admin. Promote another member first.', 400);
        }
      }

      const oldRole = member.role;
      member.role = newRole;

      // Update permissions to role defaults
      member.customPermissions = this.getDefaultPermissionsForRole(newRole);
      await member.save();

      // Update user's workspace memberships
      if (member.userId) {
        await User.updateOne(
          {
            _id: member.userId,
            'workspaceMemberships.workspaceId': workspaceId,
          },
          {
            $set: {
              'workspaceMemberships.$.role': newRole,
            },
          }
        );
      }

      // Send notification email
      const workspace = await Workspace.findById(workspaceId);
      if (workspace && member.status === 'active') {
        await EmailService.sendRoleChanged(
          member.email,
          workspace.name,
          oldRole,
          newRole
        );
      }

      loggingService.info('Member role updated', {
        workspaceId,
        memberId,
        oldRole,
        newRole,
        updatedBy,
      });

      return member;
    } catch (error: any) {
      loggingService.error('Error updating member role', { error, workspaceId, memberId });
      throw error;
    }
  }

  /**
   * Update member's assigned projects
   */
  static async updateMemberProjects(
    workspaceId: string | ObjectId,
    memberId: string | ObjectId,
    projectIds: string[],
    updatedBy: string | ObjectId
  ): Promise<ITeamMember> {
    try {
      // Check permissions
      const canAssign = await permissionService.canAssignProjects(updatedBy, workspaceId);
      if (!canAssign) {
        throw new AppError('Insufficient permissions to assign projects', 403);
      }

      const member = await TeamMember.findOne({
        _id: memberId,
        workspaceId,
      });

      if (!member) {
        throw new AppError('Team member not found', 404);
      }

      // Admins and owners get all projects automatically
      if (['owner', 'admin'].includes(member.role)) {
        throw new AppError('Admins and owners have access to all projects', 400);
      }

      member.assignedProjects = projectIds as any;
      await member.save();

      loggingService.info('Member projects updated', {
        workspaceId,
        memberId,
        projectCount: projectIds.length,
        updatedBy,
      });

      return member;
    } catch (error: any) {
      loggingService.error('Error updating member projects', { error, workspaceId, memberId });
      throw error;
    }
  }

  /**
   * Update member permissions
   */
  static async updateMemberPermissions(
    workspaceId: string | ObjectId,
    memberId: string | ObjectId,
    permissions: Partial<Permissions>,
    updatedBy: string | ObjectId
  ): Promise<ITeamMember> {
    try {
      await permissionService.updateMemberPermissions(updatedBy, memberId, workspaceId, permissions);

      const member = await TeamMember.findById(memberId);
      if (!member) {
        throw new AppError('Team member not found', 404);
      }

      return member;
    } catch (error: any) {
      loggingService.error('Error updating member permissions', { error, workspaceId, memberId });
      throw error;
    }
  }

  /**
   * Get all workspace members
   */
  static async getWorkspaceMembers(workspaceId: string | ObjectId): Promise<ITeamMember[]> {
    try {
      const members = await TeamMember.find({ workspaceId })
        .populate('userId', 'name email avatar')
        .populate('invitedBy', 'name email')
        .populate('assignedProjects', 'name')
        .sort({ joinedAt: -1, invitedAt: -1 });

      return members;
    } catch (error: any) {
      loggingService.error('Error fetching workspace members', { error, workspaceId });
      throw error;
    }
  }

  /**
   * Get member details
   */
  static async getMemberDetails(workspaceId: string | ObjectId, memberId: string | ObjectId): Promise<ITeamMember> {
    try {
      const member = await TeamMember.findOne({
        _id: memberId,
        workspaceId,
      })
        .populate('userId', 'name email avatar lastLogin')
        .populate('invitedBy', 'name email')
        .populate('assignedProjects', 'name description');

      if (!member) {
        throw new AppError('Team member not found', 404);
      }

      return member;
    } catch (error: any) {
      loggingService.error('Error fetching member details', { error, workspaceId, memberId });
      throw error;
    }
  }

  /**
   * Suspend member
   */
  static async suspendMember(
    workspaceId: string | ObjectId,
    memberId: string | ObjectId,
    suspendedBy: string | ObjectId
  ): Promise<ITeamMember> {
    try {
      const canRemove = await permissionService.canRemoveMembers(suspendedBy, workspaceId);
      if (!canRemove) {
        throw new AppError('Insufficient permissions', 403);
      }

      const member = await TeamMember.findOne({
        _id: memberId,
        workspaceId,
      });

      if (!member) {
        throw new AppError('Team member not found', 404);
      }

      if (member.role === 'owner') {
        throw new AppError('Cannot suspend workspace owner', 400);
      }

      member.status = 'suspended';
      await member.save();

      loggingService.info('Member suspended', {
        workspaceId,
        memberId,
        suspendedBy,
      });

      return member;
    } catch (error: any) {
      loggingService.error('Error suspending member', { error, workspaceId, memberId });
      throw error;
    }
  }

  /**
   * Reactivate member
   */
  static async reactivateMember(
    workspaceId: string | ObjectId,
    memberId: string | ObjectId,
    reactivatedBy: string | ObjectId
  ): Promise<ITeamMember> {
    try {
      const isAdminOrOwner = await permissionService.isAdminOrOwner(reactivatedBy, workspaceId);
      if (!isAdminOrOwner) {
        throw new AppError('Insufficient permissions', 403);
      }

      const member = await TeamMember.findOne({
        _id: memberId,
        workspaceId,
        status: 'suspended',
      });

      if (!member) {
        throw new AppError('Suspended member not found', 404);
      }

      member.status = 'active';
      await member.save();

      loggingService.info('Member reactivated', {
        workspaceId,
        memberId,
        reactivatedBy,
      });

      return member;
    } catch (error: any) {
      loggingService.error('Error reactivating member', { error, workspaceId, memberId });
      throw error;
    }
  }

  /**
   * Get default permissions for a role
   */
  private static getDefaultPermissionsForRole(role: string): Permissions {
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

export const teamService = TeamService;

