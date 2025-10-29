import { Router } from 'express';
import { TeamController } from '../controllers/team.controller';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';
import { validate } from '../middleware/validation.middleware';
import {
  inviteMemberSchema,
  updateMemberRoleSchema,
  updateMemberPermissionsSchema,
  updateMemberProjectsSchema,
  updateWorkspaceSettingsSchema,
  deleteWorkspaceSchema,
  transferOwnershipSchema,
  switchWorkspaceSchema,
} from '../utils/validators';
import {
  requirePermission,
  requireRole,
  requireWorkspaceRole,
  requireAdminOrOwner,
  requireOwner,
  attachWorkspaceContext,
} from '../middleware/permission.middleware';

const router = Router();

// Apply authentication and workspace context to all routes
router.use(authenticate);
router.use(asyncHandler(attachWorkspaceContext));

/**
 * Get all workspace members
 * GET /api/team/members
 */
router.get(
  '/members',
  asyncHandler(TeamController.getWorkspaceMembers)
);

/**
 * Invite a new member
 * POST /api/team/invite
 * Requires: canManageTeam permission or admin/owner role
 */
router.post(
  '/invite',
  validate(inviteMemberSchema),
  asyncHandler(TeamController.inviteMember)
);

/**
 * Accept an invitation
 * POST /api/team/accept/:token
 * Public - authenticated users only
 */
router.post(
  '/accept/:token',
  asyncHandler(TeamController.acceptInvitation)
);

/**
 * Resend an invitation
 * POST /api/team/resend/:memberId
 * Requires: canManageTeam permission or admin/owner role
 */
router.post(
  '/resend/:memberId',
  asyncHandler(TeamController.resendInvitation)
);

/**
 * Get member details
 * GET /api/team/members/:memberId
 */
router.get(
  '/members/:memberId',
  asyncHandler(TeamController.getMemberDetails)
);

/**
 * Update member role
 * PUT /api/team/members/:memberId/role
 * Requires: admin or owner role
 */
router.put(
  '/members/:memberId/role',
  requireAdminOrOwner,
  validate(updateMemberRoleSchema),
  asyncHandler(TeamController.updateMemberRole)
);

/**
 * Update member permissions
 * PUT /api/team/members/:memberId/permissions
 * Requires: admin or owner role
 */
router.put(
  '/members/:memberId/permissions',
  requireAdminOrOwner,
  validate(updateMemberPermissionsSchema),
  asyncHandler(TeamController.updateMemberPermissions)
);

/**
 * Update member projects
 * PUT /api/team/members/:memberId/projects
 * Requires: canManageProjects permission or admin/owner role
 */
router.put(
  '/members/:memberId/projects',
  validate(updateMemberProjectsSchema),
  asyncHandler(TeamController.updateMemberProjects)
);

/**
 * Remove a member
 * DELETE /api/team/members/:memberId
 * Requires: canManageTeam permission or admin/owner role
 */
router.delete(
  '/members/:memberId',
  asyncHandler(TeamController.removeMember)
);

/**
 * Suspend a member
 * POST /api/team/members/:memberId/suspend
 * Requires: admin or owner role
 */
router.post(
  '/members/:memberId/suspend',
  requireAdminOrOwner,
  asyncHandler(TeamController.suspendMember)
);

/**
 * Reactivate a member
 * POST /api/team/members/:memberId/reactivate
 * Requires: admin or owner role
 */
router.post(
  '/members/:memberId/reactivate',
  requireAdminOrOwner,
  asyncHandler(TeamController.reactivateMember)
);

/**
 * Get all user's workspaces (more specific path first)
 * GET /api/team/workspaces
 * Returns all workspaces user is a member of with their roles
 */
router.get(
  '/workspaces',
  asyncHandler(TeamController.getUserWorkspaces)
);

/**
 * Switch primary workspace (specific action path before base)
 * POST /api/team/workspace/switch
 * Requires: user to be a member of the target workspace
 */
router.post(
  '/workspace/switch',
  validate(switchWorkspaceSchema),
  asyncHandler(TeamController.switchWorkspace)
);

/**
 * Transfer workspace ownership (specific action path before base)
 * POST /api/team/workspace/transfer
 * Requires: owner workspace role only
 */
router.post(
  '/workspace/transfer',
  requireWorkspaceRole('owner'),
  validate(transferOwnershipSchema),
  asyncHandler(TeamController.transferOwnership)
);

/**
 * Get current workspace details
 * GET /api/team/workspace
 * Any workspace member can view
 */
router.get(
  '/workspace',
  asyncHandler(TeamController.getWorkspaceDetails)
);

/**
 * Update workspace settings
 * PUT /api/team/workspace
 * Requires: admin or owner workspace role (hierarchy-based)
 */
router.put(
  '/workspace',
  requireWorkspaceRole('admin'),
  validate(updateWorkspaceSettingsSchema),
  asyncHandler(TeamController.updateWorkspace)
);

/**
 * Delete workspace
 * DELETE /api/team/workspace
 * Requires: owner workspace role only
 */
router.delete(
  '/workspace',
  requireWorkspaceRole('owner'),
  validate(deleteWorkspaceSchema),
  asyncHandler(TeamController.deleteWorkspace)
);

export default router;

