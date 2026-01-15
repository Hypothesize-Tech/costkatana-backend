/**
 * Permission System Types
 */

export type IntegrationType =
  | 'vercel'
  | 'github'
  | 'google'
  | 'slack'
  | 'discord'
  | 'jira'
  | 'linear'
  | 'mongodb'
  | 'aws';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ResourceRestrictions {
  projectIds?: string[];
  repoIds?: string[];
  fileIds?: string[];
  channelIds?: string[];
  ownOnly?: boolean;
}

export interface ToolPermissions {
  tools: string[]; // Allowed tool names
  scopes: string[]; // OAuth scopes
  httpMethods: HttpMethod[];
  resources?: ResourceRestrictions;
}

export interface PermissionGrant {
  userId: string;
  integration: IntegrationType;
  connectionId: string;
  permissions: ToolPermissions;
  grantedAt: Date;
  expiresAt?: Date;
  grantedBy: 'user' | 'admin';
}

export interface PermissionCheckContext {
  userId: string;
  integration: IntegrationType;
  connectionId: string;
  toolName: string;
  httpMethod: HttpMethod;
  resourceId?: string;
}

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  missingScope?: string;
  missingPermission?: string;
  requiresConfirmation?: boolean;
}

export interface OAuthScopeMapping {
  integration: IntegrationType;
  scope: string;
  tools: string[];
  httpMethods: HttpMethod[];
  description: string;
}

export interface DangerousOperation {
  toolName: string;
  integration: IntegrationType;
  requiresConfirmation: boolean;
  impact: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}
