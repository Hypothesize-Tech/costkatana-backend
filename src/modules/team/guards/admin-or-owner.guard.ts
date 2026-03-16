import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { PermissionService } from '../services/permission.service';

@Injectable()
export class AdminOrOwnerGuard implements CanActivate {
  constructor(private permissionService: PermissionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.id || !user?.workspaceId) {
      throw new ForbiddenException(
        'User not authenticated or no workspace context',
      );
    }

    const isAdminOrOwner = await this.permissionService.isAdminOrOwner(
      user.id,
      user.workspaceId,
    );

    if (!isAdminOrOwner) {
      throw new ForbiddenException('Admin or owner permissions required');
    }

    return true;
  }
}
