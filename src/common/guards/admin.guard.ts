import {
  Injectable,
  ExecutionContext,
  ForbiddenException,
  CanActivate,
} from '@nestjs/common';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Check if user has admin role or is an admin user
    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    // Check for admin role or admin flag
    const isAdmin =
      user.role === 'admin' ||
      user.roles?.includes('admin') ||
      user.isAdmin === true ||
      user.admin === true;

    if (!isAdmin) {
      throw new ForbiddenException('Admin access required');
    }

    return true;
  }
}
