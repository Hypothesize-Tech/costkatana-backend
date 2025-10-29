import { Request, Response, NextFunction } from 'express';
import { teamService } from '../services/team.service';
import { WorkspaceService } from '../services/workspace.service';
import { Workspace } from '../models/Workspace';
import { loggingService } from '../services/logging.service';
import { AppError } from '../middleware/error.middleware';

export class TeamController {
  /**
   * Get all workspace members
   * GET /api/team/members
   */
  static async getWorkspaceMembers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      const workspaceId = req.workspaceId ?? (req as any).user?.workspaceId;

      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      loggingService.info(`User ${userId} fetching workspace members for workspace ${workspaceId}`);
      const members = await teamService.getWorkspaceMembers(workspaceId);

      res.json({
        success: true,
        data: members,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Invite a new member
   * POST /api/team/invite
   */
  static async inviteMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      const workspaceId = req.workspaceId ?? (req as any).user?.workspaceId;
      const { email, role, projectIds } = req.body;

      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      const member = await teamService.inviteMember(
        workspaceId,
        email,
        role,
        userId,
        projectIds
      );

      res.status(201).json({
        success: true,
        message: 'Invitation sent successfully',
        data: member,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Accept an invitation
   * POST /api/team/accept/:token
   */
  static async acceptInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      const { token } = req.params;

      loggingService.info('Accept invitation request', {
        userId,
        token: token ? `${token.substring(0, 10)}...` : 'missing',
        hasAuth: !!(req as any).user,
      });

      if (!userId) {
        loggingService.error('Accept invitation: No userId found');
        throw new AppError('Authentication required', 401);
      }

      if (!token) {
        loggingService.error('Accept invitation: No token provided');
        throw new AppError('Invitation token is required', 400);
      }

      const member = await teamService.acceptInvitation(token, userId);

      loggingService.info('Invitation accepted successfully', {
        userId,
        workspaceId: member.workspaceId,
      });

      res.json({
        success: true,
        message: 'Invitation accepted successfully',
        data: member,
      });
    } catch (error) {
      loggingService.error('Error accepting invitation', {
        error: error instanceof Error ? error.message : String(error),
        userId: (req as any).user?.id,
        token: req.params.token ? `${req.params.token.substring(0, 10)}...` : 'missing',
      });
      next(error);
    }
  }

  /**
   * Resend an invitation
   * POST /api/team/resend/:memberId
   */
  static async resendInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      const workspaceId = req.workspaceId ?? (req as any).user?.workspaceId;
      const { memberId } = req.params;

      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      await teamService.resendInvitation(workspaceId, memberId, userId);

      res.json({
        success: true,
        message: 'Invitation resent successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Remove a member
   * DELETE /api/team/members/:memberId
   */
  static async removeMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      const workspaceId = req.workspaceId ?? (req as any).user?.workspaceId;
      const { memberId } = req.params;

      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      await teamService.removeMember(workspaceId, memberId, userId);

      res.json({
        success: true,
        message: 'Member removed successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update member role
   * PUT /api/team/members/:memberId/role
   */
  static async updateMemberRole(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      const workspaceId = req.workspaceId ?? (req as any).user?.workspaceId;
      const { memberId } = req.params;
      const { role } = req.body;

      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      const member = await teamService.updateMemberRole(
        workspaceId,
        memberId,
        role,
        userId
      );

      res.json({
        success: true,
        message: 'Member role updated successfully',
        data: member,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update member permissions
   * PUT /api/team/members/:memberId/permissions
   */
  static async updateMemberPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      const workspaceId = req.workspaceId ?? (req as any).user?.workspaceId;
      const { memberId } = req.params;
      const { permissions } = req.body;

      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      const member = await teamService.updateMemberPermissions(
        workspaceId,
        memberId,
        permissions,
        userId
      );

      res.json({
        success: true,
        message: 'Member permissions updated successfully',
        data: member,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update member projects
   * PUT /api/team/members/:memberId/projects
   */
  static async updateMemberProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      const workspaceId = req.workspaceId ?? (req as any).user?.workspaceId;
      const { memberId } = req.params;
      const { projectIds } = req.body;

      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      const member = await teamService.updateMemberProjects(
        workspaceId,
        memberId,
        projectIds,
        userId
      );

      res.json({
        success: true,
        message: 'Member projects updated successfully',
        data: member,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get member details
   * GET /api/team/members/:memberId
   */
  static async getMemberDetails(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const workspaceId = req.workspaceId ?? (req as any).user?.workspaceId;
      const { memberId } = req.params;

      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      const member = await teamService.getMemberDetails(workspaceId, memberId);

      res.json({
        success: true,
        data: member,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get workspace settings
   * GET /api/team/workspace
   */
  static async getWorkspaceSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const workspaceId = req.workspaceId ?? (req as any).user?.workspaceId;

      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      const workspace = await Workspace.findById(workspaceId).populate('ownerId', 'name email');

      if (!workspace) {
        throw new AppError('Workspace not found', 404);
      }

      res.json({
        success: true,
        data: workspace,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update workspace settings
   * PUT /api/team/workspace
   */
  static async updateWorkspaceSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const workspaceId = req.workspaceId ?? (req as any).user?.workspaceId;
      const { name, settings } = req.body;

      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      const workspace = await Workspace.findById(workspaceId);

      if (!workspace) {
        throw new AppError('Workspace not found', 404);
      }

      if (name) {
        workspace.name = name;
        // Update slug based on name
        workspace.slug = name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '');
      }

      if (settings) {
        workspace.settings = {
          ...workspace.settings,
          ...settings,
        };
      }

      await workspace.save();

      res.json({
        success: true,
        message: 'Workspace settings updated successfully',
        data: workspace,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Suspend a member
   * POST /api/team/members/:memberId/suspend
   */
  static async suspendMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      const workspaceId = req.workspaceId ?? (req as any).user?.workspaceId;
      const { memberId } = req.params;

      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      const member = await teamService.suspendMember(workspaceId, memberId, userId);

      res.json({
        success: true,
        message: 'Member suspended successfully',
        data: member,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Reactivate a member
   * POST /api/team/members/:memberId/reactivate
   */
  static async reactivateMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      const workspaceId = req.workspaceId ?? (req as any).user?.workspaceId;
      const { memberId } = req.params;

      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      const member = await teamService.reactivateMember(workspaceId, memberId, userId);

      res.json({
        success: true,
        message: 'Member reactivated successfully',
        data: member,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get current workspace details
   * GET /api/team/workspace
   */
  static async getWorkspaceDetails(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      const workspaceId = req.workspaceId ?? (req as any).user?.workspaceId;

      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      const workspace = await WorkspaceService.getWorkspaceDetails(workspaceId, userId);

      res.json({
        success: true,
        data: workspace,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all workspaces user is a member of
   * GET /api/team/workspaces
   */
  static async getUserWorkspaces(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        throw new AppError('Authentication required', 401);
      }

      const workspaces = await WorkspaceService.getUserWorkspaces(userId);

      res.json({
        success: true,
        data: workspaces,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Switch primary workspace
   * POST /api/team/workspace/switch
   */
  static async switchWorkspace(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      const { workspaceId } = req.body;

      if (!userId) {
        throw new AppError('Authentication required', 401);
      }

      if (!workspaceId) {
        throw new AppError('Workspace ID is required', 400);
      }

      await WorkspaceService.switchPrimaryWorkspace(userId, workspaceId);

      res.json({
        success: true,
        message: 'Workspace switched successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update workspace settings
   * PUT /api/team/workspace
   */
  static async updateWorkspace(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      const workspaceId = req.workspaceId ?? (req as any).user?.workspaceId;
      const updates = req.body;

      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      const workspace = await WorkspaceService.updateWorkspaceSettings(
        workspaceId,
        userId,
        updates
      );

      res.json({
        success: true,
        message: 'Workspace updated successfully',
        data: workspace,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete workspace (owner only)
   * DELETE /api/team/workspace
   */
  static async deleteWorkspace(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      const workspaceId = req.workspaceId ?? (req as any).user?.workspaceId;
      const { password } = req.body;

      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      if (!password) {
        throw new AppError('Password is required', 400);
      }

      await WorkspaceService.deleteWorkspace(workspaceId, userId, password);

      res.json({
        success: true,
        message: 'Workspace deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Transfer workspace ownership
   * POST /api/team/workspace/transfer
   */
  static async transferOwnership(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      const workspaceId = req.workspaceId ?? (req as any).user?.workspaceId;
      const { newOwnerId, password } = req.body;

      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      if (!newOwnerId || !password) {
        throw new AppError('New owner ID and password are required', 400);
      }

      await WorkspaceService.transferOwnership(workspaceId, userId, newOwnerId, password);

      res.json({
        success: true,
        message: 'Ownership transferred successfully',
      });
    } catch (error) {
      next(error);
    }
  }
}

export const teamController = TeamController;
