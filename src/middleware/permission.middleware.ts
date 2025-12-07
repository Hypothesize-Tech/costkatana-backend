import { Request, Response, NextFunction } from 'express';
import { permissionService, Permissions } from '../services/permission.service';
import { AppError } from './error.middleware';
import { loggingService } from '../services/logging.service';
import { agentIdentityService } from '../services/agentIdentity.service';

// Extend Express Request type to include workspace info
declare global {
  namespace Express {
    interface Request {
      workspaceId?: string;
      userRole?: string;
      userPermissions?: Permissions;
    }
  }
}

/**
 * Middleware to require specific permission
 * Supports both user and agent RBAC
 */
export const requirePermission = (permission: keyof Permissions) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Check if this is an agent request
      const isAgentRequest = req.gatewayContext?.isAgentRequest;
      
      if (isAgentRequest && req.gatewayContext?.agentToken) {
        loggingService.info('Agent permission check', {
          component: 'PermissionMiddleware',
          operation: 'requirePermission',
          agentId: req.gatewayContext.agentId,
          permission
        });
        
        // Agent RBAC check
        const agentIdentity = await agentIdentityService.authenticateAgent(req.gatewayContext.agentToken);
        if (!agentIdentity) {
          throw new AppError('Agent authentication failed', 401);
        }
        
        // Map permission to agent action
        const action = mapPermissionToAgentAction(permission);
        const permissionResult = await agentIdentityService.checkPermission(
          agentIdentity,
          action
        );
        
        if (!permissionResult.allowed) {
          loggingService.warn('Agent permission denied', {
            agentId: agentIdentity.agentId,
            permission,
            action,
            reason: permissionResult.reason
          });
          throw new AppError(`Agent permission denied: ${permissionResult.reason}`, 403);
        }
        
        next();
        return;
      }
      
      // Standard user permission check
      const userId = (req as any).user?.id;
      const workspaceId = req.workspaceId || (req as any).user?.workspaceId;

      if (!userId) {
        throw new AppError('Authentication required', 401);
      }

      if (!workspaceId) {
        throw new AppError('Workspace context required', 400);
      }

      const hasPermission = await permissionService.hasPermission(userId, workspaceId, permission);

      if (!hasPermission) {
        loggingService.warn('Permission denied', {
          userId,
          workspaceId,
          permission,
        });
        throw new AppError(`Permission denied: ${permission}`, 403);
      }

      // Attach permissions to request for later use
      if (!req.userPermissions) {
        req.userPermissions = await permissionService.getMemberPermissions(userId, workspaceId);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Map workspace permission to agent action
 */
function mapPermissionToAgentAction(permission: keyof Permissions): string {
  const permissionActionMap: Record<string, string> = {
    canManageBilling: 'write',
    canManageTeam: 'admin',
    canManageProjects: 'write',
    canViewAnalytics: 'read',
    canManageApiKeys: 'admin',
    canManageIntegrations: 'write',
    canExportData: 'read'
  };
  
  return permissionActionMap[permission] || 'read';
}

/**
 * Middleware to require specific role(s) - exact match
 */
export const requireRole = (...roles: Array<'owner' | 'admin' | 'developer' | 'viewer'>) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      const workspaceId = req.workspaceId || (req as any).user?.workspaceId;

      if (!userId) {
        throw new AppError('Authentication required', 401);
      }

      if (!workspaceId) {
        throw new AppError('Workspace context required', 400);
      }

      const userRole = await permissionService.getUserRole(userId, workspaceId);

      if (!userRole || !roles.includes(userRole as any)) {
        loggingService.warn('Role requirement not met', {
          userId,
          workspaceId,
          userRole,
          requiredRoles: roles,
        });
        throw new AppError('Insufficient role permissions', 403);
      }

      // Attach role to request for later use
      req.userRole = userRole;

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Middleware to require minimum workspace role using role hierarchy
 * viewer < developer < admin < owner
 */
export const requireWorkspaceRole = (minimumRole: 'owner' | 'admin' | 'developer' | 'viewer') => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      const workspaceId = req.workspaceId || (req as any).user?.workspaceId;

      if (!userId) {
        throw new AppError('Authentication required', 401);
      }

      if (!workspaceId) {
        throw new AppError('Workspace context required', 400);
      }

      const userRole = await permissionService.getUserRole(userId, workspaceId);

      if (!userRole) {
        loggingService.warn('User not a member of workspace', {
          userId,
          workspaceId,
        });
        throw new AppError('Not a member of this workspace', 403);
      }

      // Define role hierarchy
      const roleHierarchy = ['viewer', 'developer', 'admin', 'owner'];
      const requiredIndex = roleHierarchy.indexOf(minimumRole);
      const userIndex = roleHierarchy.indexOf(userRole);

      if (userIndex < requiredIndex) {
        loggingService.warn('Insufficient workspace role', {
          userId,
          workspaceId,
          userRole,
          requiredRole: minimumRole,
        });
        throw new AppError(`Requires ${minimumRole} role or higher`, 403);
      }

      // Attach role to request for later use
      req.userRole = userRole;

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Middleware to require project access
 */
export const requireProjectAccess = () => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      const projectId = req.params.projectId || req.body.projectId || req.query.projectId;

      if (!userId) {
        throw new AppError('Authentication required', 401);
      }

      if (!projectId) {
        throw new AppError('Project ID required', 400);
      }

      const hasAccess = await permissionService.canAccessProject(userId, projectId);

      if (!hasAccess) {
        loggingService.warn('Project access denied', {
          userId,
          projectId,
        });
        throw new AppError('Project access denied', 403);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Middleware to attach workspace context to request
 */
export const attachWorkspaceContext = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return next();
    }

    // Get workspace from user or from request params/body
    const workspaceId = req.params.workspaceId || req.body.workspaceId || (req as any).user?.workspaceId;

    if (workspaceId) {
      req.workspaceId = workspaceId.toString();
      
      // Optionally fetch and attach role and permissions
      const [role, permissions] = await Promise.all([
        permissionService.getUserRole(userId, workspaceId),
        permissionService.getMemberPermissions(userId, workspaceId),
      ]);

      if (role) {
        req.userRole = role;
      }
      req.userPermissions = permissions;
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware to check if user is workspace owner
 */
export const requireOwner = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    const workspaceId = req.workspaceId || (req as any).user?.workspaceId;

    if (!userId) {
      throw new AppError('Authentication required', 401);
    }

    if (!workspaceId) {
      throw new AppError('Workspace context required', 400);
    }

    const isOwner = await permissionService.isWorkspaceOwner(userId, workspaceId);

    if (!isOwner) {
      loggingService.warn('Owner permission required', {
        userId,
        workspaceId,
      });
      throw new AppError('Only workspace owner can perform this action', 403);
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware to check if user is admin or owner
 */
export const requireAdminOrOwner = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    const workspaceId = req.workspaceId || (req as any).user?.workspaceId;

    if (!userId) {
      throw new AppError('Authentication required', 401);
    }

    if (!workspaceId) {
      throw new AppError('Workspace context required', 400);
    }

    const isAdminOrOwner = await permissionService.isAdminOrOwner(userId, workspaceId);

    if (!isAdminOrOwner) {
      loggingService.warn('Admin or owner permission required', {
        userId,
        workspaceId,
      });
      throw new AppError('Admin or owner permissions required', 403);
    }

    next();
  } catch (error) {
    next(error);
  }
};

