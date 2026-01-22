import { Request, Response, NextFunction } from 'express';
import { teamService } from '../services/team.service';
import { WorkspaceService } from '../services/workspace.service';
import { Workspace } from '../models/Workspace';
import { loggingService } from '../services/logging.service';
import { AppError } from '../middleware/error.middleware';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

export class TeamController {
  /**
   * Get all workspace members
   * GET /api/team/members
   */
  static async getWorkspaceMembers(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    const workspaceId = (req as any).workspaceId ?? (req as any).user?.workspaceId;

    ControllerHelper.logRequestStart('getWorkspaceMembers', req, { workspaceId });

    try {
      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      ServiceHelper.validateObjectId(workspaceId, 'workspaceId');
      const members = await teamService.getWorkspaceMembers(workspaceId);

      ControllerHelper.logRequestSuccess('getWorkspaceMembers', req, startTime, {
        workspaceId,
        membersCount: members.length
      });

      res.json({
        success: true,
        data: members,
      });
    } catch (error) {
      ControllerHelper.handleError('getWorkspaceMembers', error, req, res, startTime, { workspaceId });
      next(error);
    }
  }

  /**
   * Invite a new member
   * POST /api/team/invite
   */
  static async inviteMember(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    const workspaceId = (req as any).workspaceId ?? (req as any).user?.workspaceId;
    const { email, role, projectIds } = req.body;

    ControllerHelper.logRequestStart('inviteMember', req, { workspaceId, email, role });

    try {
      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      ServiceHelper.validateObjectId(workspaceId, 'workspaceId');
      const member = await teamService.inviteMember(
        workspaceId,
        email,
        role,
        userId,
        projectIds
      );

      ControllerHelper.logRequestSuccess('inviteMember', req, startTime, {
        workspaceId,
        email,
        role,
        memberId: member._id
      });

      res.status(201).json({
        success: true,
        message: 'Invitation sent successfully',
        data: member,
      });
    } catch (error) {
      ControllerHelper.handleError('inviteMember', error, req, res, startTime, { workspaceId, email, role });
      next(error);
    }
  }

  /**
   * Accept an invitation
   * POST /api/team/accept/:token
   */
  static async acceptInvitation(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    const { token } = req.params;

    ControllerHelper.logRequestStart('acceptInvitation', req, {
      hasToken: !!token,
      tokenPreview: token ? `${token.substring(0, 10)}...` : 'missing'
    });

    try {
      if (!token) {
        throw new AppError('Invitation token is required', 400);
      }

      const member = await teamService.acceptInvitation(token, userId);

      ControllerHelper.logRequestSuccess('acceptInvitation', req, startTime, {
        userId,
        workspaceId: member.workspaceId
      });

      res.json({
        success: true,
        message: 'Invitation accepted successfully',
        data: member,
      });
    } catch (error) {
      ControllerHelper.handleError('acceptInvitation', error, req, res, startTime, {
        hasToken: !!token,
        tokenPreview: token ? `${token.substring(0, 10)}...` : 'missing'
      });
      next(error);
    }
  }

  /**
   * Resend an invitation
   * POST /api/team/resend/:memberId
   */
  static async resendInvitation(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    const workspaceId = (req as any).workspaceId ?? (req as any).user?.workspaceId;
    const { memberId } = req.params;

    ControllerHelper.logRequestStart('resendInvitation', req, { workspaceId, memberId });

    try {
      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      ServiceHelper.validateObjectId(workspaceId, 'workspaceId');
      ServiceHelper.validateObjectId(memberId, 'memberId');
      await teamService.resendInvitation(workspaceId, memberId, userId);

      ControllerHelper.logRequestSuccess('resendInvitation', req, startTime, { workspaceId, memberId });

      res.json({
        success: true,
        message: 'Invitation resent successfully',
      });
    } catch (error) {
      ControllerHelper.handleError('resendInvitation', error, req, res, startTime, { workspaceId, memberId });
      next(error);
    }
  }

  /**
   * Remove a member
   * DELETE /api/team/members/:memberId
   */
  static async removeMember(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    const workspaceId = (req as any).workspaceId ?? (req as any).user?.workspaceId;
    const { memberId } = req.params;

    ControllerHelper.logRequestStart('removeMember', req, { workspaceId, memberId });

    try {
      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      ServiceHelper.validateObjectId(workspaceId, 'workspaceId');
      ServiceHelper.validateObjectId(memberId, 'memberId');
      await teamService.removeMember(workspaceId, memberId, userId);

      ControllerHelper.logRequestSuccess('removeMember', req, startTime, { workspaceId, memberId });

      res.json({
        success: true,
        message: 'Member removed successfully',
      });
    } catch (error) {
      ControllerHelper.handleError('removeMember', error, req, res, startTime, { workspaceId, memberId });
      next(error);
    }
  }

  /**
   * Update member role
   * PUT /api/team/members/:memberId/role
   */
  static async updateMemberRole(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    const workspaceId = (req as any).workspaceId ?? (req as any).user?.workspaceId;
    const { memberId } = req.params;
    const { role } = req.body;

    ControllerHelper.logRequestStart('updateMemberRole', req, { workspaceId, memberId, role });

    try {
      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      ServiceHelper.validateObjectId(workspaceId, 'workspaceId');
      ServiceHelper.validateObjectId(memberId, 'memberId');
      const member = await teamService.updateMemberRole(
        workspaceId,
        memberId,
        role,
        userId
      );

      ControllerHelper.logRequestSuccess('updateMemberRole', req, startTime, {
        workspaceId,
        memberId,
        role
      });

      res.json({
        success: true,
        message: 'Member role updated successfully',
        data: member,
      });
    } catch (error) {
      ControllerHelper.handleError('updateMemberRole', error, req, res, startTime, { workspaceId, memberId, role });
      next(error);
    }
  }

  /**
   * Update member permissions
   * PUT /api/team/members/:memberId/permissions
   */
  static async updateMemberPermissions(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    const workspaceId = (req as any).workspaceId ?? (req as any).user?.workspaceId;
    const { memberId } = req.params;
    const { permissions } = req.body;

    ControllerHelper.logRequestStart('updateMemberPermissions', req, { workspaceId, memberId });

    try {
      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      ServiceHelper.validateObjectId(workspaceId, 'workspaceId');
      ServiceHelper.validateObjectId(memberId, 'memberId');
      const member = await teamService.updateMemberPermissions(
        workspaceId,
        memberId,
        permissions,
        userId
      );

      ControllerHelper.logRequestSuccess('updateMemberPermissions', req, startTime, {
        workspaceId,
        memberId
      });

      res.json({
        success: true,
        message: 'Member permissions updated successfully',
        data: member,
      });
    } catch (error) {
      ControllerHelper.handleError('updateMemberPermissions', error, req, res, startTime, { workspaceId, memberId });
      next(error);
    }
  }

  /**
   * Update member projects
   * PUT /api/team/members/:memberId/projects
   */
  static async updateMemberProjects(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    const workspaceId = (req as any).workspaceId ?? (req as any).user?.workspaceId;
    const { memberId } = req.params;
    const { projectIds } = req.body;

    ControllerHelper.logRequestStart('updateMemberProjects', req, { workspaceId, memberId });

    try {
      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      ServiceHelper.validateObjectId(workspaceId, 'workspaceId');
      ServiceHelper.validateObjectId(memberId, 'memberId');
      const member = await teamService.updateMemberProjects(
        workspaceId,
        memberId,
        projectIds,
        userId
      );

      ControllerHelper.logRequestSuccess('updateMemberProjects', req, startTime, {
        workspaceId,
        memberId,
        projectIdsCount: projectIds?.length || 0
      });

      res.json({
        success: true,
        message: 'Member projects updated successfully',
        data: member,
      });
    } catch (error) {
      ControllerHelper.handleError('updateMemberProjects', error, req, res, startTime, { workspaceId, memberId });
      next(error);
    }
  }

  /**
   * Get member details
   * GET /api/team/members/:memberId
   */
  static async getMemberDetails(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    const workspaceId = (req as any).workspaceId ?? (req as any).user?.workspaceId;
    const { memberId } = req.params;

    ControllerHelper.logRequestStart('getMemberDetails', req, { workspaceId, memberId });

    try {
      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      ServiceHelper.validateObjectId(workspaceId, 'workspaceId');
      ServiceHelper.validateObjectId(memberId, 'memberId');
      const member = await teamService.getMemberDetails(workspaceId, memberId);

      ControllerHelper.logRequestSuccess('getMemberDetails', req, startTime, { workspaceId, memberId });

      res.json({
        success: true,
        data: member,
      });
    } catch (error) {
      ControllerHelper.handleError('getMemberDetails', error, req, res, startTime, { workspaceId, memberId });
      next(error);
    }
  }

  /**
   * Get workspace settings
   * GET /api/team/workspace
   */
  static async getWorkspaceSettings(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    const workspaceId = (req as any).workspaceId ?? (req as any).user?.workspaceId;

    ControllerHelper.logRequestStart('getWorkspaceSettings', req, { workspaceId });

    try {
      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      ServiceHelper.validateObjectId(workspaceId, 'workspaceId');
      const workspace = await Workspace.findById(workspaceId).populate('ownerId', 'name email');

      if (!workspace) {
        throw new AppError('Workspace not found', 404);
      }

      ControllerHelper.logRequestSuccess('getWorkspaceSettings', req, startTime, { workspaceId });

      res.json({
        success: true,
        data: workspace,
      });
    } catch (error) {
      ControllerHelper.handleError('getWorkspaceSettings', error, req, res, startTime, { workspaceId });
      next(error);
    }
  }

  /**
   * Update workspace settings
   * PUT /api/team/workspace
   */
  static async updateWorkspaceSettings(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    const workspaceId = (req as any).workspaceId ?? (req as any).user?.workspaceId;
    const { name, settings } = req.body;

    ControllerHelper.logRequestStart('updateWorkspaceSettings', req, { workspaceId, hasName: !!name, hasSettings: !!settings });

    try {
      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      ServiceHelper.validateObjectId(workspaceId, 'workspaceId');
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

      ControllerHelper.logRequestSuccess('updateWorkspaceSettings', req, startTime, { workspaceId });

      res.json({
        success: true,
        message: 'Workspace settings updated successfully',
        data: workspace,
      });
    } catch (error) {
      ControllerHelper.handleError('updateWorkspaceSettings', error, req, res, startTime, { workspaceId });
      next(error);
    }
  }

  /**
   * Suspend a member
   * POST /api/team/members/:memberId/suspend
   */
  static async suspendMember(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    const workspaceId = (req as any).workspaceId ?? (req as any).user?.workspaceId;
    const { memberId } = req.params;

    ControllerHelper.logRequestStart('suspendMember', req, { workspaceId, memberId });

    try {
      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      ServiceHelper.validateObjectId(workspaceId, 'workspaceId');
      ServiceHelper.validateObjectId(memberId, 'memberId');
      const member = await teamService.suspendMember(workspaceId, memberId, userId);

      ControllerHelper.logRequestSuccess('suspendMember', req, startTime, { workspaceId, memberId });

      res.json({
        success: true,
        message: 'Member suspended successfully',
        data: member,
      });
    } catch (error) {
      ControllerHelper.handleError('suspendMember', error, req, res, startTime, { workspaceId, memberId });
      next(error);
    }
  }

  /**
   * Reactivate a member
   * POST /api/team/members/:memberId/reactivate
   */
  static async reactivateMember(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    const workspaceId = (req as any).workspaceId ?? (req as any).user?.workspaceId;
    const { memberId } = req.params;

    ControllerHelper.logRequestStart('reactivateMember', req, { workspaceId, memberId });

    try {
      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      ServiceHelper.validateObjectId(workspaceId, 'workspaceId');
      ServiceHelper.validateObjectId(memberId, 'memberId');
      const member = await teamService.reactivateMember(workspaceId, memberId, userId);

      ControllerHelper.logRequestSuccess('reactivateMember', req, startTime, { workspaceId, memberId });

      res.json({
        success: true,
        message: 'Member reactivated successfully',
        data: member,
      });
    } catch (error) {
      ControllerHelper.handleError('reactivateMember', error, req, res, startTime, { workspaceId, memberId });
      next(error);
    }
  }

  /**
   * Get current workspace details
   * GET /api/team/workspace
   */
  static async getWorkspaceDetails(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    const workspaceId = (req as any).workspaceId ?? (req as any).user?.workspaceId;

    ControllerHelper.logRequestStart('getWorkspaceDetails', req, { workspaceId });

    try {
      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      ServiceHelper.validateObjectId(workspaceId, 'workspaceId');
      const workspace = await WorkspaceService.getWorkspaceDetails(workspaceId, userId);

      ControllerHelper.logRequestSuccess('getWorkspaceDetails', req, startTime, { workspaceId });

      res.json({
        success: true,
        data: workspace,
      });
    } catch (error) {
      ControllerHelper.handleError('getWorkspaceDetails', error, req, res, startTime, { workspaceId });
      next(error);
    }
  }

  /**
   * Get all workspaces user is a member of
   * GET /api/team/workspaces
   */
  static async getUserWorkspaces(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;

    ControllerHelper.logRequestStart('getUserWorkspaces', req);

    try {
      const workspaces = await WorkspaceService.getUserWorkspaces(userId);

      ControllerHelper.logRequestSuccess('getUserWorkspaces', req, startTime, {
        workspacesCount: workspaces.length
      });

      res.json({
        success: true,
        data: workspaces,
      });
    } catch (error) {
      ControllerHelper.handleError('getUserWorkspaces', error, req, res, startTime);
      next(error);
    }
  }

  /**
   * Switch primary workspace
   * POST /api/team/workspace/switch
   */
  static async switchWorkspace(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    const { workspaceId } = req.body;

    ControllerHelper.logRequestStart('switchWorkspace', req, { workspaceId });

    try {
      if (!workspaceId) {
        throw new AppError('Workspace ID is required', 400);
      }

      ServiceHelper.validateObjectId(workspaceId, 'workspaceId');
      await WorkspaceService.switchPrimaryWorkspace(userId, workspaceId);

      ControllerHelper.logRequestSuccess('switchWorkspace', req, startTime, { workspaceId });

      res.json({
        success: true,
        message: 'Workspace switched successfully',
      });
    } catch (error) {
      ControllerHelper.handleError('switchWorkspace', error, req, res, startTime, { workspaceId });
      next(error);
    }
  }

  /**
   * Update workspace settings
   * PUT /api/team/workspace
   */
  static async updateWorkspace(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    const workspaceId = (req as any).workspaceId ?? (req as any).user?.workspaceId;
    const updates = req.body;

    ControllerHelper.logRequestStart('updateWorkspace', req, { workspaceId, updatesKeys: Object.keys(updates || {}) });

    try {
      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      ServiceHelper.validateObjectId(workspaceId, 'workspaceId');
      const workspace = await WorkspaceService.updateWorkspaceSettings(
        workspaceId,
        userId,
        updates
      );

      ControllerHelper.logRequestSuccess('updateWorkspace', req, startTime, { workspaceId });

      res.json({
        success: true,
        message: 'Workspace updated successfully',
        data: workspace,
      });
    } catch (error) {
      ControllerHelper.handleError('updateWorkspace', error, req, res, startTime, { workspaceId });
      next(error);
    }
  }

  /**
   * Delete workspace (owner only)
   * DELETE /api/team/workspace
   */
  static async deleteWorkspace(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    const workspaceId = (req as any).workspaceId ?? (req as any).user?.workspaceId;
    const { password } = req.body;

    ControllerHelper.logRequestStart('deleteWorkspace', req, { workspaceId, hasPassword: !!password });

    try {
      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      if (!password) {
        throw new AppError('Password is required', 400);
      }

      ServiceHelper.validateObjectId(workspaceId, 'workspaceId');
      await WorkspaceService.deleteWorkspace(workspaceId, userId, password);

      ControllerHelper.logRequestSuccess('deleteWorkspace', req, startTime, { workspaceId });

      res.json({
        success: true,
        message: 'Workspace deleted successfully',
      });
    } catch (error) {
      ControllerHelper.handleError('deleteWorkspace', error, req, res, startTime, { workspaceId });
      next(error);
    }
  }

  /**
   * Transfer workspace ownership
   * POST /api/team/workspace/transfer
   */
  static async transferOwnership(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    const workspaceId = (req as any).workspaceId ?? (req as any).user?.workspaceId;
    const { newOwnerId, password } = req.body;

    ControllerHelper.logRequestStart('transferOwnership', req, {
      workspaceId,
      newOwnerId,
      hasPassword: !!password
    });

    try {
      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      if (!newOwnerId || !password) {
        throw new AppError('New owner ID and password are required', 400);
      }

      ServiceHelper.validateObjectId(workspaceId, 'workspaceId');
      ServiceHelper.validateObjectId(newOwnerId, 'newOwnerId');
      await WorkspaceService.transferOwnership(workspaceId, userId, newOwnerId, password);

      ControllerHelper.logRequestSuccess('transferOwnership', req, startTime, {
        workspaceId,
        newOwnerId
      });

      res.json({
        success: true,
        message: 'Ownership transferred successfully',
      });
    } catch (error) {
      ControllerHelper.handleError('transferOwnership', error, req, res, startTime, { workspaceId, newOwnerId });
      next(error);
    }
  }
}

export const teamController = TeamController;
