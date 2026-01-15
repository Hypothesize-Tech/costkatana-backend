/**
 * Standard Response Types for MCP Tools
 * Ensures consistent error handling and response format
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
  httpMethod: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
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
 * Helper to create successful response
 */
export function createSuccessResponse<T>(
  data: T,
  metadata: Partial<MCPToolMetadata>
): MCPToolResponse<T> {
  return {
    success: true,
    data,
    metadata: {
      integration: metadata.integration || 'unknown',
      operation: metadata.operation || 'unknown',
      latency: metadata.latency || 0,
      cached: metadata.cached || false,
      httpMethod: metadata.httpMethod || 'GET',
      permissionChecked: metadata.permissionChecked || false,
      dangerousOperation: metadata.dangerousOperation || false,
      ...metadata,
    },
  };
}

/**
 * Helper to create error response
 */
export function createErrorResponse(
  error: MCPToolError,
  metadata: Partial<MCPToolMetadata>
): MCPToolResponse {
  return {
    success: false,
    error,
    metadata: {
      integration: metadata.integration || 'unknown',
      operation: metadata.operation || 'unknown',
      latency: metadata.latency || 0,
      cached: false,
      httpMethod: metadata.httpMethod || 'GET',
      permissionChecked: metadata.permissionChecked || false,
      dangerousOperation: metadata.dangerousOperation || false,
      ...metadata,
    },
  };
}

/**
 * Helper to create confirmation required response
 */
export function createConfirmationResponse(
  confirmation: MCPConfirmationRequest,
  metadata: Partial<MCPToolMetadata>
): MCPToolResponse {
  return {
    success: false,
    requiresConfirmation: confirmation,
    error: {
      code: 'CONFIRMATION_REQUIRED',
      message: `Confirmation required for ${confirmation.action} on ${confirmation.resource}`,
      recoverable: true,
    },
    metadata: {
      integration: metadata.integration || 'unknown',
      operation: metadata.operation || 'unknown',
      latency: metadata.latency || 0,
      cached: false,
      httpMethod: metadata.httpMethod || 'DELETE',
      permissionChecked: metadata.permissionChecked || true,
      dangerousOperation: true,
      ...metadata,
    },
  };
}
