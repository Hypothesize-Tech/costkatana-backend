import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Workspace,
  WorkspaceDocument,
} from '../../../schemas/user/workspace.schema';
import { User, UserDocument } from '../../../schemas/user/user.schema';
import {
  TeamMember,
  TeamMemberDocument,
} from '../../../schemas/team-project/team-member.schema';

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    @InjectModel(Workspace.name)
    private workspaceModel: Model<WorkspaceDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(TeamMember.name)
    private teamMemberModel: Model<TeamMemberDocument>,
  ) {}

  /**
   * Create a default workspace for a new user
   */
  async createDefaultWorkspace(
    userId: string,
    userName: string,
  ): Promise<WorkspaceDocument> {
    try {
      const baseName = `${userName}'s Workspace`;
      const slug = await this.generateUniqueSlug(baseName);

      const workspace = await this.workspaceModel.create({
        name: baseName,
        slug,
        ownerId: userId,
        settings: {
          allowMemberInvites: false,
          defaultProjectAccess: 'assigned',
          requireEmailVerification: true,
        },
        billing: {
          seatsIncluded: 5, // Free tier: 5 team members
          additionalSeats: 0,
          pricePerSeat: 10,
          billingCycle: 'monthly',
        },
        isActive: true,
      });

      this.logger.log('Default workspace created', {
        workspaceId: workspace._id,
        userId,
        workspaceName: workspace.name,
      });

      return workspace;
    } catch (error) {
      this.logger.error('Failed to create default workspace', {
        userId,
        userName,
        error,
      });
      throw error;
    }
  }

  /**
   * Generate a unique URL-safe slug from a base name
   */
  async generateUniqueSlug(baseName: string): Promise<string> {
    // Convert to lowercase, replace spaces and special chars with hyphens
    const slug = baseName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens

    // Check if slug exists
    const existingWorkspace = await this.workspaceModel.findOne({ slug });

    if (!existingWorkspace) {
      return slug;
    }

    // If exists, append a number
    let counter = 1;
    let uniqueSlug = `${slug}-${counter}`;

    while (await this.workspaceModel.findOne({ slug: uniqueSlug })) {
      counter++;
      uniqueSlug = `${slug}-${counter}`;
    }

    return uniqueSlug;
  }

  /**
   * Get workspace details with owner info and member count
   */
  async getWorkspaceDetails(workspaceId: string, userId: string): Promise<any> {
    try {
      const workspace = await this.workspaceModel
        .findById(workspaceId)
        .populate('ownerId', 'name email')
        .lean();

      if (!workspace) {
        throw new NotFoundException('Workspace not found');
      }

      // Get member count
      const memberCount = await this.teamMemberModel.countDocuments({
        workspaceId,
        status: { $in: ['active', 'invited'] },
      });

      // Get current user's role in this workspace
      const user = await this.userModel.findById(userId);
      const membership = user?.workspaceMemberships.find(
        (m) => m.workspaceId.toString() === workspaceId,
      );

      return {
        ...workspace,
        memberCount,
        currentUserRole: membership?.role || null,
      };
    } catch (error) {
      this.logger.error('Failed to get workspace details', {
        workspaceId,
        userId,
        error,
      });
      throw error;
    }
  }

  /**
   * Get user's default/primary workspace ID.
   * Resolves from: user.workspaceId, first workspaceMembership, owned workspace,
   * or creates a default workspace for users who have none (e.g. OAuth users).
   */
  async getUserDefaultWorkspaceId(userId: string): Promise<string | null> {
    try {
      const user = await this.userModel
        .findById(userId)
        .select('workspaceId workspaceMemberships name email');
      if (!user) return null;

      const userDoc = user as any;
      // 1. Primary workspace
      if (userDoc.workspaceId) {
        return userDoc.workspaceId.toString();
      }
      // 2. First workspace from memberships
      if (userDoc.workspaceMemberships?.length > 0) {
        return userDoc.workspaceMemberships[0].workspaceId?.toString() ?? null;
      }
      // 3. Workspace where user is owner
      const owned = await this.workspaceModel
        .findOne({ ownerId: userId, isActive: true })
        .select('_id')
        .lean();
      if (owned?._id) return owned._id.toString();

      // 4. Create default workspace for users with none (OAuth, legacy)
      const workspace = await this.createDefaultWorkspace(
        userId,
        userDoc.name ?? userDoc.email ?? 'User',
      );
      if (!workspace?._id) return null;

      // Link user to workspace and create owner TeamMember
      await this.userModel.updateOne(
        { _id: userId },
        {
          $set: {
            workspaceId: workspace._id,
            workspaceMemberships: [
              {
                workspaceId: workspace._id,
                role: 'owner',
                joinedAt: new Date(),
              },
            ],
          },
        },
      );
      await this.teamMemberModel.create({
        workspaceId: workspace._id,
        userId,
        email: userDoc.email,
        role: 'owner',
        status: 'active',
        joinedAt: new Date(),
        customPermissions: {
          canManageBilling: true,
          canManageTeam: true,
          canManageProjects: true,
          canManageIntegrations: true,
          canViewAnalytics: true,
          canExportData: true,
        },
      });

      return workspace._id.toString();
    } catch {
      return null;
    }
  }

  /**
   * Get all workspaces a user is a member of
   */
  async getUserWorkspaces(userId: string): Promise<any[]> {
    try {
      const user = await this.userModel.findById(userId);

      if (!user) {
        throw new NotFoundException('User not found');
      }

      const workspaceIds = user.workspaceMemberships.map((m) => m.workspaceId);

      const workspaces = await this.workspaceModel
        .find({
          _id: { $in: workspaceIds },
          isActive: true,
        })
        .populate('ownerId', 'name email')
        .lean();

      // Combine workspace data with user's role
      const userWorkspaces = workspaces.map((workspace) => {
        const membership = user.workspaceMemberships.find(
          (m) => m.workspaceId.toString() === workspace._id.toString(),
        );

        return {
          workspace,
          role: membership?.role || 'viewer',
          joinedAt: membership?.joinedAt,
          isPrimary: user.workspaceId?.toString() === workspace._id.toString(),
        };
      });

      return userWorkspaces;
    } catch (error) {
      this.logger.error('Failed to get user workspaces', {
        userId,
        error,
      });
      throw error;
    }
  }

  /**
   * Switch user's primary workspace
   */
  async switchPrimaryWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    try {
      const user = await this.userModel.findById(userId);

      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Verify user is a member of this workspace
      const isMember = user.workspaceMemberships.some(
        (m) => m.workspaceId.toString() === workspaceId,
      );

      if (!isMember) {
        throw new ForbiddenException('You are not a member of this workspace');
      }

      // Update primary workspace
      user.workspaceId = workspaceId as any;
      await user.save();

      this.logger.log('Primary workspace switched', {
        userId,
        workspaceId,
      });
    } catch (error) {
      this.logger.error('Failed to switch workspace', {
        userId,
        workspaceId,
        error,
      });
      throw error;
    }
  }

  /**
   * Update workspace settings
   */
  async updateWorkspaceSettings(
    workspaceId: string,
    userId: string,
    updates: {
      name?: string;
      settings?: {
        allowMemberInvites?: boolean;
        defaultProjectAccess?: 'all' | 'assigned';
        requireEmailVerification?: boolean;
      };
    },
  ): Promise<WorkspaceDocument> {
    try {
      // Verify user has admin or owner role in workspace
      const hasPermission = await this.verifyWorkspaceRole(
        userId,
        workspaceId,
        ['owner', 'admin'],
      );

      if (!hasPermission) {
        throw new ForbiddenException(
          'Insufficient permissions to update workspace',
        );
      }

      const workspace = await this.workspaceModel.findById(workspaceId);

      if (!workspace) {
        throw new NotFoundException('Workspace not found');
      }

      // Update name if provided
      if (updates.name && updates.name !== workspace.name) {
        workspace.name = updates.name;
        workspace.slug = await this.generateUniqueSlug(updates.name);
      }

      // Update settings if provided
      if (updates.settings) {
        workspace.settings = {
          ...workspace.settings,
          ...updates.settings,
        };
      }

      await workspace.save();

      this.logger.log('Workspace updated', {
        workspaceId,
        userId,
        updates,
      });

      return workspace;
    } catch (error) {
      this.logger.error('Failed to update workspace', {
        workspaceId,
        userId,
        error,
      });
      throw error;
    }
  }

  /**
   * Delete a workspace (owner only)
   */
  async deleteWorkspace(
    workspaceId: string,
    userId: string,
    password: string,
  ): Promise<void> {
    try {
      // Verify user is the workspace owner
      const isOwner = await this.verifyWorkspaceRole(userId, workspaceId, [
        'owner',
      ]);

      if (!isOwner) {
        throw new ForbiddenException(
          'Only workspace owner can delete the workspace',
        );
      }

      // Verify password
      const user = await this.userModel.findById(userId);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        throw new UnauthorizedException('Invalid password');
      }

      // Check if this is user's last workspace
      const userWorkspaces = await this.getUserWorkspaces(userId);
      if (userWorkspaces.length === 1) {
        throw new BadRequestException('Cannot delete your only workspace');
      }

      // Soft delete workspace
      await this.workspaceModel.findByIdAndUpdate(workspaceId, {
        isActive: false,
      });

      // Remove workspace from all members
      await this.userModel.updateMany(
        { 'workspaceMemberships.workspaceId': workspaceId },
        {
          $pull: {
            workspaceMemberships: { workspaceId },
          },
        },
      );

      // If this was user's primary workspace, switch to another one
      if (user.workspaceId?.toString() === workspaceId) {
        const otherWorkspace = userWorkspaces.find(
          (w) => w.workspace._id.toString() !== workspaceId,
        );
        if (otherWorkspace) {
          user.workspaceId = otherWorkspace.workspace._id;
          await user.save();
        }
      }

      this.logger.log('Workspace deleted', {
        workspaceId,
        userId,
      });
    } catch (error) {
      this.logger.error('Failed to delete workspace', {
        workspaceId,
        userId,
        error,
      });
      throw error;
    }
  }

  /**
   * Transfer workspace ownership
   */
  async transferOwnership(
    workspaceId: string,
    currentOwnerId: string,
    newOwnerId: string,
    password: string,
  ): Promise<void> {
    try {
      // Verify current user is the owner
      const isOwner = await this.verifyWorkspaceRole(
        currentOwnerId,
        workspaceId,
        ['owner'],
      );

      if (!isOwner) {
        throw new ForbiddenException(
          'Only workspace owner can transfer ownership',
        );
      }

      // Verify password
      const currentOwner = await this.userModel.findById(currentOwnerId);
      if (!currentOwner) {
        throw new NotFoundException('User not found');
      }

      const isPasswordValid = await currentOwner.comparePassword(password);
      if (!isPasswordValid) {
        throw new UnauthorizedException('Invalid password');
      }

      // Verify new owner is a member of the workspace
      const newOwner = await this.userModel.findById(newOwnerId);
      if (!newOwner) {
        throw new NotFoundException('New owner not found');
      }

      const newOwnerMembership = newOwner.workspaceMemberships.find(
        (m) => m.workspaceId.toString() === workspaceId,
      );

      if (!newOwnerMembership) {
        throw new BadRequestException(
          'New owner must be a member of the workspace',
        );
      }

      // Update workspace owner
      await this.workspaceModel.findByIdAndUpdate(workspaceId, {
        ownerId: newOwnerId,
      });

      // Update current owner's role to admin
      const currentOwnerMembershipIndex =
        currentOwner.workspaceMemberships.findIndex(
          (m) => m.workspaceId.toString() === workspaceId,
        );
      if (currentOwnerMembershipIndex !== -1) {
        currentOwner.workspaceMemberships[currentOwnerMembershipIndex].role =
          'admin';
        await currentOwner.save();
      }

      // Update TeamMember record for current owner
      await this.teamMemberModel.findOneAndUpdate(
        {
          workspaceId,
          userId: currentOwnerId,
        },
        { role: 'admin' },
      );

      // Update new owner's role to owner
      const newOwnerMembershipIndex = newOwner.workspaceMemberships.findIndex(
        (m) => m.workspaceId.toString() === workspaceId,
      );
      if (newOwnerMembershipIndex !== -1) {
        newOwner.workspaceMemberships[newOwnerMembershipIndex].role = 'owner';
        await newOwner.save();
      }

      // Update TeamMember record for new owner
      await this.teamMemberModel.findOneAndUpdate(
        {
          workspaceId,
          userId: newOwnerId,
        },
        { role: 'owner' },
      );

      this.logger.log('Workspace ownership transferred', {
        workspaceId,
        from: currentOwnerId,
        to: newOwnerId,
      });
    } catch (error) {
      this.logger.error('Failed to transfer ownership', {
        workspaceId,
        currentOwnerId,
        newOwnerId,
        error,
      });
      throw error;
    }
  }

  /**
   * Verify user has specific role(s) in workspace
   */
  private async verifyWorkspaceRole(
    userId: string,
    workspaceId: string,
    allowedRoles: string[],
  ): Promise<boolean> {
    try {
      const user = await this.userModel.findById(userId);

      if (!user) {
        return false;
      }

      const membership = user.workspaceMemberships.find(
        (m) => m.workspaceId.toString() === workspaceId,
      );

      if (!membership) {
        return false;
      }

      return allowedRoles.includes(membership.role);
    } catch (error) {
      return false;
    }
  }
}
