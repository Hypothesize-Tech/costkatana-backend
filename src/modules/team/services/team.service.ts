import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, Schema } from 'mongoose';
import * as crypto from 'crypto';
import {
  TeamMember,
  TeamMemberDocument,
} from '../../../schemas/team-project/team-member.schema';
import {
  Workspace,
  WorkspaceDocument,
} from '../../../schemas/user/workspace.schema';
import { User, UserDocument } from '../../../schemas/user/user.schema';
import { PermissionService } from './permission.service';
import { WorkspaceService } from './workspace.service';
import { EmailService } from '../../email/email.service';

const INVITATION_EXPIRY_DAYS = 7;

@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(
    @InjectModel(TeamMember.name)
    private teamMemberModel: Model<TeamMemberDocument>,
    @InjectModel(Workspace.name)
    private workspaceModel: Model<WorkspaceDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private permissionService: PermissionService,
    private workspaceService: WorkspaceService,
    private emailService: EmailService,
  ) {}

  /**
   * Invite a new member to the workspace
   */
  async inviteMember(
    workspaceId: string,
    email: string,
    role: 'admin' | 'developer' | 'viewer',
    invitedBy: string,
    projectIds?: string[],
  ): Promise<TeamMemberDocument> {
    try {
      // Verify inviter has permission
      const canInvite = await this.permissionService.canInviteMembers(
        invitedBy,
        workspaceId,
      );
      if (!canInvite) {
        throw new ForbiddenException(
          'Insufficient permissions to invite members',
        );
      }

      // Get workspace details
      const workspace = await this.workspaceModel.findById(workspaceId);
      if (!workspace) {
        throw new NotFoundException('Workspace not found');
      }

      // Check if email already exists in workspace
      const existingMember = await this.teamMemberModel.findOne({
        workspaceId,
        email: email.toLowerCase(),
      });

      if (existingMember) {
        if (existingMember.status === 'active') {
          throw new BadRequestException(
            'User is already a member of this workspace',
          );
        }
        if (existingMember.status === 'invited') {
          throw new BadRequestException(
            'Invitation already sent to this email',
          );
        }
      }

      // Check seat availability
      const activeMembers = await this.teamMemberModel.countDocuments({
        workspaceId,
        status: { $in: ['active', 'invited'] },
      });

      const totalSeats =
        workspace.billing.seatsIncluded + workspace.billing.additionalSeats;
      if (activeMembers >= totalSeats) {
        throw new BadRequestException(
          'No available seats. Please upgrade your plan.',
        );
      }

      // Check if user exists
      const existingUser = await this.userModel.findOne({
        email: email.toLowerCase(),
      });

      // Generate invitation token
      const invitationToken = crypto.randomBytes(32).toString('hex');
      const invitationExpires = new Date();
      invitationExpires.setDate(
        invitationExpires.getDate() + INVITATION_EXPIRY_DAYS,
      );

      // Get default permissions for role
      const defaultPermissions = this.getDefaultPermissionsForRole(role);

      // Create team member record
      const teamMember = new this.teamMemberModel({
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
      const inviter = await this.userModel.findById(invitedBy);
      const inviterName = inviter?.name || 'Team Admin';

      // Send invitation email
      const inviteUrl = `${process.env.FRONTEND_URL}/accept-invite/${invitationToken}`;
      await this.emailService.sendTeamInvitation(
        email,
        inviterName,
        workspace.name,
        inviteUrl,
        role,
      );

      this.logger.log('Team member invited', {
        workspaceId,
        email,
        role,
        invitedBy,
      });

      return teamMember;
    } catch (error) {
      this.logger.error('Error inviting team member', {
        error,
        workspaceId,
        email,
      });
      throw error;
    }
  }

  /**
   * Accept an invitation
   */
  async acceptInvitation(
    token: string,
    userId: string,
  ): Promise<TeamMemberDocument> {
    try {
      const invitation = await this.teamMemberModel.findOne({
        invitationToken: token,
        status: 'invited',
      });

      if (!invitation) {
        throw new BadRequestException('Invalid or expired invitation');
      }

      if (
        invitation.invitationExpires &&
        invitation.invitationExpires < new Date()
      ) {
        throw new BadRequestException('Invitation has expired');
      }

      // Get user details
      const user = await this.userModel.findById(userId);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Verify email matches
      if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
        throw new BadRequestException(
          'Email mismatch. Please sign up with the invited email.',
        );
      }

      // Update team member
      invitation.userId = user._id as any;
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
        (m) => m.workspaceId.toString() === invitation.workspaceId.toString(),
      );

      if (!membershipExists) {
        user.workspaceMemberships.push({
          workspaceId: invitation.workspaceId,
          role: invitation.role,
          joinedAt: new Date(),
        });
        await user.save();
      }

      this.logger.log('Invitation accepted', {
        userId,
        workspaceId: invitation.workspaceId.toString(),
        email: invitation.email,
      });

      return invitation;
    } catch (error) {
      this.logger.error('Error accepting invitation', { error, token });
      throw error;
    }
  }

  /**
   * Resend invitation
   */
  async resendInvitation(
    workspaceId: string,
    memberId: string,
    userId: string,
  ): Promise<void> {
    try {
      // Check permissions
      const canInvite = await this.permissionService.canInviteMembers(
        userId,
        workspaceId,
      );
      if (!canInvite) {
        throw new ForbiddenException('Insufficient permissions');
      }

      const member = await this.teamMemberModel.findOne({
        _id: memberId,
        workspaceId,
        status: 'invited',
      });

      if (!member) {
        throw new NotFoundException('Pending invitation not found');
      }

      // Generate new token and expiry
      const invitationToken = crypto.randomBytes(32).toString('hex');
      const invitationExpires = new Date();
      invitationExpires.setDate(
        invitationExpires.getDate() + INVITATION_EXPIRY_DAYS,
      );

      member.invitationToken = invitationToken;
      member.invitationExpires = invitationExpires;
      await member.save();

      // Get workspace and inviter details
      const [workspace, inviter] = await Promise.all([
        this.workspaceModel.findById(workspaceId),
        this.userModel.findById(userId),
      ]);

      if (!workspace) {
        throw new NotFoundException('Workspace not found');
      }

      const inviterName = inviter?.name || 'Team Admin';
      const inviteUrl = `${process.env.FRONTEND_URL}/accept-invite/${invitationToken}`;

      await this.emailService.sendTeamInvitation(
        member.email,
        inviterName,
        workspace.name,
        inviteUrl,
        member.role,
      );

      this.logger.log('Invitation resent', {
        workspaceId,
        memberId,
        email: member.email,
      });
    } catch (error) {
      this.logger.error('Error resending invitation', {
        error,
        workspaceId,
        memberId,
      });
      throw error;
    }
  }

  /**
   * Remove a member from workspace
   */
  async removeMember(
    workspaceId: string,
    memberId: string,
    removedBy: string,
  ): Promise<void> {
    try {
      // Check permissions
      const canRemove = await this.permissionService.canRemoveMembers(
        removedBy,
        workspaceId,
      );
      if (!canRemove) {
        throw new ForbiddenException(
          'Insufficient permissions to remove members',
        );
      }

      const member = await this.teamMemberModel.findOne({
        _id: memberId,
        workspaceId,
      });

      if (!member) {
        throw new NotFoundException('Team member not found');
      }

      // Cannot remove owner
      if (member.role === 'owner') {
        throw new BadRequestException('Cannot remove workspace owner');
      }

      // Ensure at least one admin remains
      if (member.role === 'admin') {
        const hasOtherAdmin = await this.permissionService.ensureAdminExists(
          workspaceId,
          memberId,
        );
        if (!hasOtherAdmin) {
          throw new BadRequestException(
            'Cannot remove the last admin. Promote another member first.',
          );
        }
      }

      // Get workspace for email
      const workspace = await this.workspaceModel.findById(workspaceId);
      const remover = await this.userModel.findById(removedBy);

      // Delete team member record
      await this.teamMemberModel.deleteOne({ _id: memberId });

      // Update user's workspace memberships if user exists
      if (member.userId) {
        await this.userModel.updateOne(
          { _id: member.userId },
          {
            $pull: {
              workspaceMemberships: { workspaceId },
            },
          },
        );
      }

      // Send notification email
      if (workspace && member.status === 'active') {
        try {
          await this.emailService.sendMemberRemoved(
            member.email,
            member.email,
            workspace.name,
            removedBy,
          );
          this.logger.log('Member removal notification email sent', {
            memberId,
            email: member.email,
            workspaceName: workspace.name,
          });
        } catch (error) {
          this.logger.error(
            'Failed to send member removal notification email',
            {
              error,
              memberId,
              email: member.email,
            },
          );
        }
      }

      this.logger.log('Team member removed', {
        workspaceId,
        memberId,
        email: member.email,
        removedBy,
      });
    } catch (error) {
      this.logger.error('Error removing team member', {
        error,
        workspaceId,
        memberId,
      });
      throw error;
    }
  }

  /**
   * Update member role
   */
  async updateMemberRole(
    workspaceId: string,
    memberId: string,
    newRole: 'admin' | 'developer' | 'viewer',
    updatedBy: string,
  ): Promise<TeamMemberDocument> {
    try {
      // Check permissions
      const isAdminOrOwner = await this.permissionService.isAdminOrOwner(
        updatedBy,
        workspaceId,
      );
      if (!isAdminOrOwner) {
        throw new ForbiddenException(
          'Insufficient permissions to update roles',
        );
      }

      const member = await this.teamMemberModel.findOne({
        _id: memberId,
        workspaceId,
      });

      if (!member) {
        throw new NotFoundException('Team member not found');
      }

      // Cannot change owner role
      if (member.role === 'owner') {
        throw new BadRequestException('Cannot change owner role');
      }

      // If downgrading from admin, ensure another admin exists
      if (member.role === 'admin' && newRole !== 'admin') {
        const hasOtherAdmin = await this.permissionService.ensureAdminExists(
          workspaceId,
          memberId,
        );
        if (!hasOtherAdmin) {
          throw new BadRequestException(
            'Cannot downgrade the last admin. Promote another member first.',
          );
        }
      }

      const oldRole = member.role;
      member.role = newRole;

      // Update permissions to role defaults
      member.customPermissions = this.getDefaultPermissionsForRole(newRole);
      await member.save();

      // Update user's workspace memberships
      if (member.userId) {
        await this.userModel.updateOne(
          {
            _id: member.userId,
            'workspaceMemberships.workspaceId': workspaceId,
          },
          {
            $set: {
              'workspaceMemberships.$.role': newRole,
            },
          },
        );
      }

      // Send notification email
      const workspace = await this.workspaceModel.findById(workspaceId);
      if (workspace && member.status === 'active') {
        try {
          await this.emailService.sendRoleChanged(
            member.email,
            member.email,
            workspace.name,
            oldRole,
            newRole,
            updatedBy,
          );
          this.logger.log('Role change notification email sent', {
            memberId,
            email: member.email,
            workspaceName: workspace.name,
            oldRole,
            newRole,
          });
        } catch (error) {
          this.logger.error('Failed to send role change notification email', {
            error,
            memberId,
            email: member.email,
            oldRole,
            newRole,
          });
        }
      }

      this.logger.log('Member role updated', {
        workspaceId,
        memberId,
        oldRole,
        newRole,
        updatedBy,
      });

      return member;
    } catch (error) {
      this.logger.error('Error updating member role', {
        error,
        workspaceId,
        memberId,
      });
      throw error;
    }
  }

  /**
   * Update member's assigned projects
   */
  async updateMemberProjects(
    workspaceId: string,
    memberId: string,
    projectIds: string[],
    updatedBy: string,
  ): Promise<TeamMemberDocument> {
    try {
      // Check permissions
      const canAssign = await this.permissionService.canAssignProjects(
        updatedBy,
        workspaceId,
      );
      if (!canAssign) {
        throw new ForbiddenException(
          'Insufficient permissions to assign projects',
        );
      }

      const member = await this.teamMemberModel.findOne({
        _id: memberId,
        workspaceId,
      });

      if (!member) {
        throw new NotFoundException('Team member not found');
      }

      // Admins and owners get all projects automatically
      if (['owner', 'admin'].includes(member.role)) {
        throw new BadRequestException(
          'Admins and owners have access to all projects',
        );
      }

      member.assignedProjects = projectIds as any;
      await member.save();

      this.logger.log('Member projects updated', {
        workspaceId,
        memberId,
        projectCount: projectIds.length,
        updatedBy,
      });

      return member;
    } catch (error) {
      this.logger.error('Error updating member projects', {
        error,
        workspaceId,
        memberId,
      });
      throw error;
    }
  }

  /**
   * Update member permissions
   */
  async updateMemberPermissions(
    workspaceId: string,
    memberId: string,
    permissions: any,
    updatedBy: string,
  ): Promise<TeamMemberDocument> {
    try {
      await this.permissionService.updateMemberPermissions(
        updatedBy,
        memberId,
        workspaceId,
        permissions,
      );

      const member = await this.teamMemberModel.findById(memberId);
      if (!member) {
        throw new NotFoundException('Team member not found');
      }

      return member;
    } catch (error) {
      this.logger.error('Error updating member permissions', {
        error,
        workspaceId,
        memberId,
      });
      throw error;
    }
  }

  /**
   * Get all workspace members
   */
  async getWorkspaceMembers(
    workspaceId: string,
  ): Promise<TeamMemberDocument[]> {
    try {
      const members = await this.teamMemberModel
        .find({ workspaceId })
        .populate('userId', 'name email avatar')
        .populate('invitedBy', 'name email')
        .populate('assignedProjects', 'name')
        .sort({ joinedAt: -1, invitedAt: -1 });

      return members;
    } catch (error) {
      this.logger.error('Error fetching workspace members', {
        error,
        workspaceId,
      });
      throw error;
    }
  }

  /**
   * Get member details
   */
  async getMemberDetails(
    workspaceId: string,
    memberId: string,
  ): Promise<TeamMemberDocument> {
    try {
      const member = await this.teamMemberModel
        .findOne({
          _id: memberId,
          workspaceId,
        })
        .populate('userId', 'name email avatar lastLogin')
        .populate('invitedBy', 'name email')
        .populate('assignedProjects', 'name description');

      if (!member) {
        throw new NotFoundException('Team member not found');
      }

      return member;
    } catch (error) {
      this.logger.error('Error fetching member details', {
        error,
        workspaceId,
        memberId,
      });
      throw error;
    }
  }

  /**
   * Suspend member
   */
  async suspendMember(
    workspaceId: string,
    memberId: string,
    suspendedBy: string,
  ): Promise<TeamMemberDocument> {
    try {
      const canRemove = await this.permissionService.canRemoveMembers(
        suspendedBy,
        workspaceId,
      );
      if (!canRemove) {
        throw new ForbiddenException('Insufficient permissions');
      }

      const member = await this.teamMemberModel.findOne({
        _id: memberId,
        workspaceId,
      });

      if (!member) {
        throw new NotFoundException('Team member not found');
      }

      if (member.role === 'owner') {
        throw new BadRequestException('Cannot suspend workspace owner');
      }

      member.status = 'suspended';
      await member.save();

      this.logger.log('Member suspended', {
        workspaceId,
        memberId,
        suspendedBy,
      });

      return member;
    } catch (error) {
      this.logger.error('Error suspending member', {
        error,
        workspaceId,
        memberId,
      });
      throw error;
    }
  }

  /**
   * Reactivate member
   */
  async reactivateMember(
    workspaceId: string,
    memberId: string,
    reactivatedBy: string,
  ): Promise<TeamMemberDocument> {
    try {
      const isAdminOrOwner = await this.permissionService.isAdminOrOwner(
        reactivatedBy,
        workspaceId,
      );
      if (!isAdminOrOwner) {
        throw new ForbiddenException('Insufficient permissions');
      }

      const member = await this.teamMemberModel.findOne({
        _id: memberId,
        workspaceId,
        status: 'suspended',
      });

      if (!member) {
        throw new NotFoundException('Suspended member not found');
      }

      member.status = 'active';
      await member.save();

      this.logger.log('Member reactivated', {
        workspaceId,
        memberId,
        reactivatedBy,
      });

      return member;
    } catch (error) {
      this.logger.error('Error reactivating member', {
        error,
        workspaceId,
        memberId,
      });
      throw error;
    }
  }

  /**
   * Get default permissions for a role
   */
  private getDefaultPermissionsForRole(role: string): any {
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
