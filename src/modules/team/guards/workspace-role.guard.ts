import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionService } from '../services/permission.service';
import { REQUIRE_WORKSPACE_ROLE_KEY } from '../decorators/require-workspace-role.decorator';

@Injectable()
export class WorkspaceRoleGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private permissionService: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRole = this.reflector.getAllAndOverride<string>(
      REQUIRE_WORKSPACE_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRole) {
      return true; // No role requirement, allow access
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.id || !user?.workspaceId) {
      throw new ForbiddenException(
        'User not authenticated or no workspace context',
      );
    }

    // Get user's role in workspace
    const userRole = await this.permissionService.getUserRole(
      user.id,
      user.workspaceId,
    );

    if (!userRole) {
      throw new ForbiddenException('User is not a member of this workspace');
    }

    // Define role hierarchy: viewer < developer < admin < owner
    const roleHierarchy = {
      viewer: 0,
      developer: 1,
      admin: 2,
      owner: 3,
    };

    const userLevel =
      roleHierarchy[userRole as keyof typeof roleHierarchy] ?? -1;
    const requiredLevel =
      roleHierarchy[requiredRole as keyof typeof roleHierarchy] ?? 999;

    if (userLevel < requiredLevel) {
      throw new ForbiddenException(
        `Insufficient permissions. Required: ${requiredRole}, Current: ${userRole}`,
      );
    }

    return true;
  }
}
