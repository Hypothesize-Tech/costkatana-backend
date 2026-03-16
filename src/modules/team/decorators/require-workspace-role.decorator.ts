import { SetMetadata } from '@nestjs/common';

export const REQUIRE_WORKSPACE_ROLE_KEY = 'workspaceRole';
export const RequireWorkspaceRole = (
  role: 'viewer' | 'developer' | 'admin' | 'owner',
) => SetMetadata(REQUIRE_WORKSPACE_ROLE_KEY, role);
