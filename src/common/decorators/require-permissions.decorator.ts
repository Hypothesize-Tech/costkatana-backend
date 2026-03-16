import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Require one or more permissions for the route.
 * User must have at least one of the listed permissions, or 'admin'.
 * Use with JwtAuthGuard and PermissionsGuard.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
