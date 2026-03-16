/**
 * Standard Response Helpers for MCP Tools
 * Creates consistent response formats for MCP tool operations
 */

import {
  MCPToolResponse,
  MCPToolMetadata,
  MCPToolError,
  MCPConfirmationRequest,
} from '../types/mcp.types';

/**
 * Helper to create successful response
 */
export function createSuccessResponse<T>(
  data: T,
  metadata: Partial<MCPToolMetadata>,
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
  metadata: Partial<MCPToolMetadata>,
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
  metadata: Partial<MCPToolMetadata>,
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
/**
 * Helper to create partial response for recoverable errors
 */
export function createPartialResponse(
  partialData: any,
  error: MCPToolError,
  metadata: Partial<MCPToolMetadata>,
): MCPToolResponse {
  return {
    success: false,
    data: partialData,
    error: {
      ...error,
      code: 'PARTIAL_RESPONSE',
    },
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
