/**
 * Error Mapping Utility
 * Maps internal errors to MCP error codes
 */

import { MCPToolError, MCPErrorCode } from '../types/standard-response';

/**
 * Map error to MCP error code
 */
export function mapErrorToMCPCode(error: any): MCPErrorCode {
  const message = error?.message || String(error);
  
  // Network errors
  if (message.includes('ECONNREFUSED') || message.includes('ENET') || message.includes('timeout')) {
    return 'NETWORK_ERROR';
  }
  
  // Authentication errors
  if (message.includes('401') || message.includes('Unauthorized') || message.includes('auth')) {
    return 'AUTH_FAILED';
  }
  
  // Permission errors
  if (message.includes('403') || message.includes('Forbidden') || message.includes('permission')) {
    return 'PERMISSION_DENIED';
  }
  
  // Not found errors
  if (message.includes('404') || message.includes('not found')) {
    return 'NOT_FOUND';
  }
  
  // Rate limit errors
  if (message.includes('429') || message.includes('rate limit') || message.includes('too many')) {
    return 'RATE_LIMIT';
  }
  
  // Validation errors
  if (message.includes('invalid') || message.includes('validation') || message.includes('required')) {
    return 'INVALID_PARAMS';
  }
  
  // OAuth scope errors
  if (message.includes('scope') || message.includes('insufficient')) {
    return 'OAUTH_SCOPE_MISSING';
  }
  
  // Default to network error
  return 'NETWORK_ERROR';
}

/**
 * Create MCP error from caught error
 */
export function createMCPError(error: any, recoverable: boolean = true): MCPToolError {
  const code = mapErrorToMCPCode(error);
  const message = error?.message || String(error);
  
  return {
    code,
    message,
    recoverable,
    retryAfter: code === 'RATE_LIMIT' ? 60 : undefined,
  };
}

/**
 * Check if error is recoverable
 */
export function isRecoverableError(code: MCPErrorCode): boolean {
  const nonRecoverable: MCPErrorCode[] = [
    'AUTH_FAILED',
    'PERMISSION_DENIED',
    'OAUTH_SCOPE_MISSING',
    'INVALID_PARAMS',
  ];
  
  return !nonRecoverable.includes(code);
}
