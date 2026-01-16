/**
 * Permission Validator Middleware
 * Validates permissions before tool execution
 */

import { PermissionManager } from './permission-manager';
import { ConfirmationService } from './confirmation-service';
import {
  IntegrationType,
  HttpMethod,
  PermissionCheckContext,
  PermissionCheckResult,
} from '../types/permission.types';
import { ToolExecutionContext } from '../types/tool-schema';
import { MCPToolResponse, createErrorResponse, createConfirmationResponse } from '../types/standard-response';
import { loggingService } from '../../services/logging.service';

export class PermissionValidator {
  /**
   * Validate and execute tool with permission checks
   */
  static async validateAndExecute(
    toolName: string,
    httpMethod: HttpMethod,
    integration: IntegrationType,
    context: ToolExecutionContext,
    handler: (context: ToolExecutionContext) => Promise<any>,
    resourceId?: string
  ): Promise<MCPToolResponse> {
    const startTime = Date.now();

    try {
      // Build permission check context
      const permissionContext: PermissionCheckContext = {
        userId: context.userId,
        integration,
        connectionId: context.connectionId,
        toolName,
        httpMethod,
        resourceId,
      };

      // Check permissions
      const permissionResult = await PermissionManager.checkPermission(permissionContext);

      if (!permissionResult.allowed) {
        loggingService.warn('Permission denied', {
          toolName,
          userId: context.userId,
          reason: permissionResult.reason,
        });

        return createErrorResponse(
          {
            code: 'PERMISSION_DENIED',
            message: permissionResult.reason || 'Permission denied',
            recoverable: false,
            missingPermission: permissionResult.missingPermission,
            requiredScope: permissionResult.missingScope,
          },
          {
            integration,
            operation: toolName,
            latency: Date.now() - startTime,
            httpMethod,
            permissionChecked: true,
            dangerousOperation: false,
            userId: context.userId,
            connectionId: context.connectionId,
          }
        );
      }

      // Check if confirmation is required
      if (permissionResult.requiresConfirmation) {
        // Check if admin can bypass
        if (context.isAdmin && ConfirmationService.canBypassConfirmation(true)) {
          loggingService.info('Admin bypassed confirmation', {
            toolName,
            userId: context.userId,
            integration,
          });
          // Continue to execution
        } else {
          // Return confirmation required response
          const confirmationId = `confirm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const impact = ConfirmationService.generateImpactDescription(
            integration,
            toolName,
            resourceId || 'resource'
          );

          return createConfirmationResponse(
            {
              confirmationId,
              resource: resourceId || toolName,
              action: toolName,
              impact,
              expiresIn: 120,
            },
            {
              integration,
              operation: toolName,
              latency: Date.now() - startTime,
              httpMethod,
              permissionChecked: true,
              dangerousOperation: true,
              userId: context.userId,
              connectionId: context.connectionId,
            }
          );
        }
      }

      // Execute tool handler
      loggingService.info('Executing tool with permissions validated', {
        toolName,
        userId: context.userId,
        integration,
        httpMethod,
      });

      const result = await handler(context);

      // Return success response (handler should already return properly formatted response)
      return result;
    } catch (error) {
      loggingService.error('Permission validation or execution failed', {
        error: error instanceof Error ? error.message : String(error),
        toolName,
        userId: context.userId,
        integration,
      });

      return createErrorResponse(
        {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Execution failed',
          recoverable: true,
        },
        {
          integration,
          operation: toolName,
          latency: Date.now() - startTime,
          httpMethod,
          permissionChecked: true,
          dangerousOperation: false,
          userId: context.userId,
          connectionId: context.connectionId,
        }
      );
    }
  }

  /**
   * Validate permissions without executing
   */
  static async validateOnly(
    toolName: string,
    httpMethod: HttpMethod,
    integration: IntegrationType,
    context: ToolExecutionContext,
    resourceId?: string
  ): Promise<PermissionCheckResult> {
    const permissionContext: PermissionCheckContext = {
      userId: context.userId,
      integration,
      connectionId: context.connectionId,
      toolName,
      httpMethod,
      resourceId,
    };

    return await PermissionManager.checkPermission(permissionContext);
  }

  /**
   * Get user's effective permissions for integration
   */
  static async getUserEffectivePermissions(
    userId: string,
    integration: IntegrationType,
    connectionId: string
  ) {
    const permissions = await PermissionManager.getPermissions(
      userId,
      integration,
      connectionId
    );

    if (!permissions) {
      return {
        hasAccess: false,
        tools: [],
        scopes: [],
        httpMethods: [],
      };
    }

    return {
      hasAccess: true,
      tools: permissions.tools,
      scopes: permissions.scopes,
      httpMethods: permissions.httpMethods,
      resourceRestrictions: permissions.resources,
    };
  }
}
