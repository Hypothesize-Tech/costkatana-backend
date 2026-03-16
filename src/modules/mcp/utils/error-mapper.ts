/**
 * Error Code Mapping for MCP Tools
 * Maps errors to standardized MCP error codes and responses
 */

import { MCPErrorCode, MCPToolError } from '../types/mcp.types';

/**
 * Maps various error types to standardized MCP error codes
 */
export function mapErrorToMCPCode(error: any): MCPErrorCode {
  // Network errors
  if (
    error.code === 'ECONNABORTED' ||
    error.code === 'ETIMEDOUT' ||
    error.code === 'ECONNRESET'
  ) {
    return 'NETWORK_ERROR';
  }

  // HTTP status code errors
  if (error.response?.status) {
    switch (error.response.status) {
      case 401:
        return 'AUTH_FAILED';
      case 403:
        return 'PERMISSION_DENIED';
      case 404:
        return 'NOT_FOUND';
      case 429:
        return 'RATE_LIMIT';
      default:
        if (error.response.status >= 500) {
          return 'NETWORK_ERROR';
        }
    }
  }

  // Validation errors
  if (
    error.message?.includes('validation') ||
    error.message?.includes('invalid')
  ) {
    return 'INVALID_PARAMS';
  }

  // Scope/permission errors
  if (
    error.message?.includes('scope') ||
    error.message?.includes('permission')
  ) {
    return 'OAUTH_SCOPE_MISSING';
  }

  // Default to network error for unknown errors
  return 'NETWORK_ERROR';
}

/**
 * Creates a standardized MCP error from any error
 */
export function createMCPError(
  error: any,
  recoverable?: boolean,
): MCPToolError {
  const code = mapErrorToMCPCode(error);

  let message = error.message || 'Unknown error';
  let retryAfter: number | undefined;

  // Extract retry-after from rate limit errors
  if (code === 'RATE_LIMIT' && error.response?.headers?.['retry-after']) {
    retryAfter = parseInt(error.response.headers['retry-after']);
  }

  // Handle specific error types
  switch (code) {
    case 'AUTH_FAILED':
      message = 'Authentication failed. Please reconnect your account.';
      break;
    case 'PERMISSION_DENIED':
      message = 'Insufficient permissions for this operation.';
      break;
    case 'RATE_LIMIT':
      message = 'Rate limit exceeded. Please try again later.';
      break;
    case 'OAUTH_SCOPE_MISSING':
      message =
        'Required OAuth scope not granted. Please reconnect with additional permissions.';
      break;
    case 'RESOURCE_ACCESS_DENIED':
      message = 'Access to this resource is restricted.';
      break;
    case 'CONFIRMATION_REQUIRED':
      message = 'This operation requires user confirmation.';
      break;
    case 'CONFIRMATION_TIMEOUT':
      message = 'Confirmation request timed out.';
      break;
  }

  return {
    code,
    message,
    recoverable: recoverable ?? isRecoverableError(code),
    retryAfter,
  };
}

/**
 * Determines if an error code is recoverable
 */
export function isRecoverableError(code: MCPErrorCode): boolean {
  switch (code) {
    case 'NETWORK_ERROR':
    case 'RATE_LIMIT':
    case 'CONFIRMATION_TIMEOUT':
      return true;
    case 'AUTH_FAILED':
    case 'PERMISSION_DENIED':
    case 'OAUTH_SCOPE_MISSING':
    case 'RESOURCE_ACCESS_DENIED':
    case 'INVALID_PARAMS':
    case 'NOT_FOUND':
    case 'CONFIRMATION_REQUIRED':
    case 'FORBIDDEN':
    case 'PARTIAL_RESPONSE':
      return false;
    default:
      return false;
  }
}
