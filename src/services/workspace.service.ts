import { Workspace, IWorkspace } from '../models/Workspace';
import { User } from '../models/User';
import { TeamMember } from '../models/TeamMember';
import { loggingService } from './logging.service';
import { AppError } from '../middleware/error.middleware';
import mongoose from 'mongoose';

export class WorkspaceService {
  /**
   * Create a default workspace for a new user
   */
  static async createDefaultWorkspace(
    userId: string,
    userName: string
  ): Promise<IWorkspace> {
    try {
      const baseName = `${userName}'s Workspace`;
      const slug = await this.generateUniqueSlug(baseName);

      const workspace = await Workspace.create({
        name: baseName,
        slug,
        ownerId: new mongoose.Types.ObjectId(userId),
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

      loggingService.info('Default workspace created', {
        workspaceId: workspace._id,
        userId,
        workspaceName: workspace.name,
      });

      return workspace;
    } catch (error: unknown) {
      const err = error as Error;
      loggingService.error('Failed to create default workspace', {
        userId,
        userName,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Generate a unique URL-safe slug from a base name
   */
  static async generateUniqueSlug(baseName: string): Promise<string> {
    // Convert to lowercase, replace spaces and special chars with hyphens
    let slug = baseName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens

    // Check if slug exists
    const existingWorkspace = await Workspace.findOne({ slug });
    
    if (!existingWorkspace) {
      return slug;
    }

    // If exists, append a number
    let counter = 1;
    let uniqueSlug = `${slug}-${counter}`;
    
    while (await Workspace.findOne({ slug: uniqueSlug })) {
      counter++;
      uniqueSlug = `${slug}-${counter}`;
    }

    return uniqueSlug;
  }

  /**
   * Get workspace details with owner info and member count
   */
  static async getWorkspaceDetails(
    workspaceId: string,
    userId: string
  ): Promise<any> {
    try {
      const workspace = await Workspace.findById(workspaceId)
        .populate('ownerId', 'name email')
        .lean();

      if (!workspace) {
        throw new AppError('Workspace not found', 404);
      }

      // Get member count
      const memberCount = await TeamMember.countDocuments({
        workspaceId: new mongoose.Types.ObjectId(workspaceId),
        status: { $in: ['active', 'invited'] },
      });

      // Get current user's role in this workspace
      const user = await User.findById(userId);
      const membership = user?.workspaceMemberships.find(
        (m) => m.workspaceId.toString() === workspaceId
      );

      return {
        ...workspace,
        memberCount,
        currentUserRole: membership?.role || null,
      };
    } catch (error: unknown) {
      const err = error as Error;
      loggingService.error('Failed to get workspace details', {
        workspaceId,
        userId,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Get all workspaces a user is a member of
   */
  static async getUserWorkspaces(userId: string): Promise<any[]> {
    try {
      const user = await User.findById(userId);
      
      if (!user) {
        throw new AppError('User not found', 404);
      }

      const workspaceIds = user.workspaceMemberships.map((m) => m.workspaceId);
      
      const workspaces = await Workspace.find({
        _id: { $in: workspaceIds },
        isActive: true,
      })
        .populate('ownerId', 'name email')
        .lean();

      // Combine workspace data with user's role
      const userWorkspaces = workspaces.map((workspace) => {
        const membership = user.workspaceMemberships.find(
          (m) => m.workspaceId.toString() === workspace._id.toString()
        );

        return {
          workspace,
          role: membership?.role || 'viewer',
          joinedAt: membership?.joinedAt,
          isPrimary: user.workspaceId?.toString() === workspace._id.toString(),
        };
      });

      return userWorkspaces;
    } catch (error: unknown) {
      const err = error as Error;
      loggingService.error('Failed to get user workspaces', {
        userId,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Switch user's primary workspace
   */
  static async switchPrimaryWorkspace(
    userId: string,
    workspaceId: string
  ): Promise<void> {
    try {
      const user = await User.findById(userId);
      
      if (!user) {
        throw new AppError('User not found', 404);
      }

      // Verify user is a member of this workspace
      const isMember = user.workspaceMemberships.some(
        (m) => m.workspaceId.toString() === workspaceId
      );

      if (!isMember) {
        throw new AppError('You are not a member of this workspace', 403);
      }

      // Update primary workspace
      user.workspaceId = new mongoose.Types.ObjectId(workspaceId) as any;
      await user.save();

      loggingService.info('Primary workspace switched', {
        userId,
        workspaceId,
      });
    } catch (error: unknown) {
      const err = error as Error;
      loggingService.error('Failed to switch workspace', {
        userId,
        workspaceId,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Update workspace settings
   */
  static async updateWorkspaceSettings(
    workspaceId: string,
    userId: string,
    updates: {
      name?: string;
      settings?: {
        allowMemberInvites?: boolean;
        defaultProjectAccess?: 'all' | 'assigned';
        requireEmailVerification?: boolean;
      };
    }
  ): Promise<IWorkspace> {
    try {
      // Verify user has admin or owner role in workspace
      const hasPermission = await this.verifyWorkspaceRole(
        userId,
        workspaceId,
        ['owner', 'admin']
      );

      if (!hasPermission) {
        throw new AppError('Insufficient permissions to update workspace', 403);
      }

      const workspace = await Workspace.findById(workspaceId);
      
      if (!workspace) {
        throw new AppError('Workspace not found', 404);
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

      loggingService.info('Workspace updated', {
        workspaceId,
        userId,
        updates,
      });

      return workspace;
    } catch (error: unknown) {
      const err = error as Error;
      loggingService.error('Failed to update workspace', {
        workspaceId,
        userId,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Delete a workspace (owner only)
   */
  static async deleteWorkspace(
    workspaceId: string,
    userId: string,
    password: string
  ): Promise<void> {
    try {
      // Verify user is the workspace owner
      const isOwner = await this.verifyWorkspaceRole(userId, workspaceId, ['owner']);

      if (!isOwner) {
        throw new AppError('Only workspace owner can delete the workspace', 403);
      }

      // Verify password
      const user = await User.findById(userId);
      if (!user) {
        throw new AppError('User not found', 404);
      }

      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        throw new AppError('Invalid password', 401);
      }

      // Check if this is user's last workspace
      const userWorkspaces = await this.getUserWorkspaces(userId);
      if (userWorkspaces.length === 1) {
        throw new AppError('Cannot delete your only workspace', 400);
      }

      // Soft delete workspace
      await Workspace.findByIdAndUpdate(workspaceId, { isActive: false });

      // Remove workspace from all members
      await User.updateMany(
        { 'workspaceMemberships.workspaceId': new mongoose.Types.ObjectId(workspaceId) },
        {
          $pull: {
            workspaceMemberships: { workspaceId: new mongoose.Types.ObjectId(workspaceId) },
          },
        }
      );

      // If this was user's primary workspace, switch to another one
      if (user.workspaceId?.toString() === workspaceId) {
        const otherWorkspace = userWorkspaces.find(
          (w) => w.workspace._id.toString() !== workspaceId
        );
        if (otherWorkspace) {
          user.workspaceId = otherWorkspace.workspace._id;
          await user.save();
        }
      }

      loggingService.info('Workspace deleted', {
        workspaceId,
        userId,
      });
    } catch (error: unknown) {
      const err = error as Error;
      loggingService.error('Failed to delete workspace', {
        workspaceId,
        userId,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Transfer workspace ownership
   */
  static async transferOwnership(
    workspaceId: string,
    currentOwnerId: string,
    newOwnerId: string,
    password: string
  ): Promise<void> {
    try {
      // Verify current user is the owner
      const isOwner = await this.verifyWorkspaceRole(
        currentOwnerId,
        workspaceId,
        ['owner']
      );

      if (!isOwner) {
        throw new AppError('Only workspace owner can transfer ownership', 403);
      }

      // Verify password
      const currentOwner = await User.findById(currentOwnerId);
      if (!currentOwner) {
        throw new AppError('User not found', 404);
      }

      const isPasswordValid = await currentOwner.comparePassword(password);
      if (!isPasswordValid) {
        throw new AppError('Invalid password', 401);
      }

      // Verify new owner is a member of the workspace
      const newOwner = await User.findById(newOwnerId);
      if (!newOwner) {
        throw new AppError('New owner not found', 404);
      }

      const newOwnerMembership = newOwner.workspaceMemberships.find(
        (m) => m.workspaceId.toString() === workspaceId
      );

      if (!newOwnerMembership) {
        throw new AppError('New owner must be a member of the workspace', 400);
      }

      // Update workspace owner
      await Workspace.findByIdAndUpdate(workspaceId, {
        ownerId: new mongoose.Types.ObjectId(newOwnerId),
      });

      // Update current owner's role to admin
      const currentOwnerMembershipIndex = currentOwner.workspaceMemberships.findIndex(
        (m) => m.workspaceId.toString() === workspaceId
      );
      if (currentOwnerMembershipIndex !== -1) {
        currentOwner.workspaceMemberships[currentOwnerMembershipIndex].role = 'admin';
        await currentOwner.save();
      }

      // Update TeamMember record for current owner
      await TeamMember.findOneAndUpdate(
        {
          workspaceId: new mongoose.Types.ObjectId(workspaceId),
          userId: new mongoose.Types.ObjectId(currentOwnerId),
        },
        { role: 'admin' }
      );

      // Update new owner's role to owner
      const newOwnerMembershipIndex = newOwner.workspaceMemberships.findIndex(
        (m) => m.workspaceId.toString() === workspaceId
      );
      if (newOwnerMembershipIndex !== -1) {
        newOwner.workspaceMemberships[newOwnerMembershipIndex].role = 'owner';
        await newOwner.save();
      }

      // Update TeamMember record for new owner
      await TeamMember.findOneAndUpdate(
        {
          workspaceId: new mongoose.Types.ObjectId(workspaceId),
          userId: new mongoose.Types.ObjectId(newOwnerId),
        },
        { role: 'owner' }
      );

      loggingService.info('Workspace ownership transferred', {
        workspaceId,
        from: currentOwnerId,
        to: newOwnerId,
      });
    } catch (error: unknown) {
      const err = error as Error;
      loggingService.error('Failed to transfer ownership', {
        workspaceId,
        currentOwnerId,
        newOwnerId,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Verify user has specific role(s) in workspace
   */
  private static async verifyWorkspaceRole(
    userId: string,
    workspaceId: string,
    allowedRoles: string[]
  ): Promise<boolean> {
    try {
      const user = await User.findById(userId);
      
      if (!user) {
        return false;
      }

      const membership = user.workspaceMemberships.find(
        (m) => m.workspaceId.toString() === workspaceId
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

