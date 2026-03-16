/**
 * MCP (Model Context Protocol) Types and Interfaces
 * Based on Model Context Protocol specification
 */

export type MCPMessageType =
  | 'initialize'
  | 'initialized'
  | 'tools/list'
  | 'tools/call'
  | 'resources/list'
  | 'resources/read'
  | 'ping'
  | 'error';

export interface MCPMessage {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: any;
  result?: any;
  error?: MCPError;
}

export interface MCPError {
  code: number;
  message: string;
  data?: any;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface MCPToolCallRequest {
  name: string;
  arguments: Record<string, any>;
}

export interface MCPToolCallResponse {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPCapabilities {
  tools?: {
    listChanged?: boolean;
  };
  resources?: {
    subscribe?: boolean;
    listChanged?: boolean;
  };
}

export interface MCPInitializeParams {
  protocolVersion: string;
  capabilities: MCPCapabilities;
  clientInfo: {
    name: string;
    version: string;
  };
}

export interface MCPInitializeResult {
  protocolVersion: string;
  capabilities: MCPCapabilities;
  serverInfo: {
    name: string;
    version: string;
  };
}

export interface MCPTransport {
  send(message: MCPMessage): Promise<void>;
  receive(): Promise<MCPMessage>;
  close(): Promise<void>;
}

/**
 * Tool Schema and Validation Types
 */

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required: boolean;
  default?: any;
  enum?: any[];
  pattern?: string;
}

export interface ToolSchema {
  name: string;
  integration: IntegrationType;
  description: string;
  httpMethod: HttpMethod;
  parameters: ToolParameter[];
  requiredScopes: string[];
  dangerous: boolean;
  examples?: string[];
  version: string;
}

export interface ToolRegistryEntry {
  schema: ToolSchema;
  handler: ToolHandler;
  enabled: boolean;
  rateLimitOverride?: number;
}

export type ToolHandler = (
  params: any,
  context: ToolExecutionContext,
) => Promise<any>;

export interface ToolExecutionContext {
  userId: string;
  connectionId: string;
  integration: IntegrationType;
  permissions: string[];
  scopes: string[];
  isAdmin: boolean;
}

export interface ToolValidationResult {
  valid: boolean;
  errors?: Array<{
    parameter: string;
    message: string;
  }>;
}

/**
 * Rate Limiting Types
 */

export interface RateLimitConfig {
  requests: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfter?: number;
}

/**
 * MCP Authentication Types
 */

export interface MCPAuthContext {
  userId: string;
  user: any;
  isAdmin: boolean;
  integrations: IntegrationType[];
}

/**
 * SSE Transport Types
 */

export interface SSEConnection {
  connectionId: string;
  userId: string;
  res: any;
  lastActivity: Date;
}

/**
 * Standard Response Types
 */

export type MCPErrorCode =
  | 'NETWORK_ERROR'
  | 'AUTH_FAILED'
  | 'PARTIAL_RESPONSE'
  | 'RATE_LIMIT'
  | 'INVALID_PARAMS'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'PERMISSION_DENIED'
  | 'CONFIRMATION_REQUIRED'
  | 'CONFIRMATION_TIMEOUT'
  | 'OAUTH_SCOPE_MISSING'
  | 'RESOURCE_ACCESS_DENIED';

export interface MCPToolError {
  code: MCPErrorCode;
  message: string;
  recoverable: boolean;
  retryAfter?: number;
  requiredScope?: string;
  missingPermission?: string;
}

export interface MCPConfirmationRequest {
  confirmationId: string;
  resource: string;
  action: string;
  impact: string;
  expiresIn: number; // seconds
}

export interface MCPToolMetadata {
  integration: string;
  operation: string;
  latency: number;
  cached: boolean;
  httpMethod: HttpMethod;
  permissionChecked: boolean;
  dangerousOperation: boolean;
  userId?: string;
  connectionId?: string;
}

export interface MCPToolResponse<T = any> {
  success: boolean;
  data?: T;
  error?: MCPToolError;
  requiresConfirmation?: MCPConfirmationRequest;
  metadata: MCPToolMetadata;
}

/**
 * Permission System Types for MCP
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
  endpoint?: string;
  requestBody?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
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
