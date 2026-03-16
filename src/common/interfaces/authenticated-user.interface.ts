export interface AuthenticatedUser {
  id: string;
  email: string;
  role?: string;
  permissions?: string[];
  apiKeyAuth?: boolean;
  jti?: string;
  workspaceId?: string;
}
