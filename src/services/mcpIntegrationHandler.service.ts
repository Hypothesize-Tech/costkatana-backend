import { loggingService } from './logging.service';
import { IntegrationChatService, IntegrationCommand, IntegrationCommandResult } from './integrationChat.service';
import { IntegrationService } from './integration.service';
import { IIntegration } from '../models/Integration';

export interface MCPIntegrationRequest {
  userId: string;
  command: IntegrationCommand;
  context?: Record<string, any>;
}

export interface MCPIntegrationResponse {
  success: boolean;
  result: IntegrationCommandResult;
  auditLog?: {
    timestamp: Date;
    userId: string;
    integration: string;
    operation: string;
    duration: number;
  };
}

export class MCPIntegrationHandler {
  /**
   * Handle integration operation via MCP protocol
   * This wraps operations in MCP middleware for security and logging
   */
  static async handleIntegrationOperation(
    request: MCPIntegrationRequest
  ): Promise<MCPIntegrationResponse> {
    const startTime = Date.now();
    const { userId, command, context = {} } = request;

    loggingService.info('MCP Integration operation started', {
      component: 'MCPIntegrationHandler',
      operation: 'handleIntegrationOperation',
      userId,
      integration: command.mention.integration,
      commandType: command.type,
      entity: command.entity
    });

    try {
      // Validate user has access to integration
      const hasAccess = await this.validateUserAccess(userId, command.mention.integration);
      if (!hasAccess) {
        return {
          success: false,
          result: {
            success: false,
            message: 'You do not have access to this integration',
            error: 'ACCESS_DENIED'
          },
          auditLog: {
            timestamp: new Date(),
            userId,
            integration: command.mention.integration,
            operation: `${command.type}_${command.entity}`,
            duration: Date.now() - startTime
          }
        };
      }

      // Check rate limiting (per user and per integration)
      const rateLimitCheck = await this.checkRateLimit(userId, command.mention.integration);
      if (!rateLimitCheck.allowed) {
        return {
          success: false,
          result: {
            success: false,
            message: `Rate limit exceeded. Please try again in ${rateLimitCheck.retryAfter} seconds`,
            error: 'RATE_LIMIT_EXCEEDED'
          },
          auditLog: {
            timestamp: new Date(),
            userId,
            integration: command.mention.integration,
            operation: `${command.type}_${command.entity}`,
            duration: Date.now() - startTime
          }
        };
      }

      // Execute command
      const result = await IntegrationChatService.executeCommand(userId, command);

      const duration = Date.now() - startTime;

      // Audit log
      const auditLog = {
        timestamp: new Date(),
        userId,
        integration: command.mention.integration,
        operation: `${command.type}_${command.entity}`,
        duration
      };

      // Log operation
      if (result.success) {
        loggingService.info('MCP Integration operation completed successfully', {
          component: 'MCPIntegrationHandler',
          ...auditLog,
          result: result.message
        });
      } else {
        loggingService.error('MCP Integration operation failed', {
          component: 'MCPIntegrationHandler',
          ...auditLog,
          error: result.error,
          message: result.message
        });
      }

      return {
        success: result.success,
        result,
        auditLog
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('MCP Integration operation error', {
        component: 'MCPIntegrationHandler',
        operation: 'handleIntegrationOperation',
        userId,
        integration: command.mention.integration,
        error: error.message,
        stack: error.stack,
        duration
      });

      return {
        success: false,
        result: {
          success: false,
          message: `Operation failed: ${error.message}`,
          error: error.message
        },
        auditLog: {
          timestamp: new Date(),
          userId,
          integration: command.mention.integration,
          operation: `${command.type}_${command.entity}`,
          duration
        }
      };
    }
  }

  /**
   * Validate user has access to integration
   */
  private static async validateUserAccess(
    userId: string,
    integrationType: string
  ): Promise<boolean> {
    try {
      const integrations = await IntegrationService.getUserIntegrations(userId, {
        status: 'active'
      });

      const hasIntegration = integrations.some(i => {
        if (integrationType === 'jira') return i.type === 'jira_oauth';
        if (integrationType === 'linear') return i.type === 'linear_oauth';
        if (integrationType === 'slack') return i.type === 'slack_oauth' || i.type === 'slack_webhook';
        if (integrationType === 'discord') return i.type === 'discord_oauth' || i.type === 'discord_webhook';
        if (integrationType === 'github') return i.type === 'github_oauth';
        if (integrationType === 'webhook') return i.type === 'custom_webhook';
        return false;
      });

      return hasIntegration;
    } catch (error: any) {
      loggingService.error('Failed to validate user access', {
        component: 'MCPIntegrationHandler',
        operation: 'validateUserAccess',
        userId,
        integrationType,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Check rate limiting per user and integration
   */
  private static async checkRateLimit(
    userId: string,
    integrationType: string
  ): Promise<{ allowed: boolean; retryAfter?: number }> {
    // Rate limit: 100 requests per minute per user per integration
    const MAX_REQUESTS = 100;
    const WINDOW_MS = 60000; // 1 minute

    try {
      // In a real implementation, this would use Redis or similar
      // For now, we'll use a simple in-memory cache
      // This should be replaced with proper rate limiting using the cache service
      
      // TODO: Implement proper rate limiting with Redis
      // For now, allow all requests
      return { allowed: true };
    } catch (error: any) {
      loggingService.error('Rate limit check failed', {
        component: 'MCPIntegrationHandler',
        operation: 'checkRateLimit',
        userId,
        integrationType,
        error: error.message
      });
      // On error, allow the request (fail open)
      return { allowed: true };
    }
  }

  /**
   * Refresh integration token if needed
   */
  static async refreshTokenIfNeeded(
    integration: IIntegration
  ): Promise<boolean> {
    try {
      const credentials = integration.getCredentials();
      
      // Check if token refresh is needed based on integration type
      // This is a placeholder - actual implementation would check token expiry
      
      // For OAuth integrations, tokens typically have refresh tokens
      if (credentials.refreshToken && credentials.accessToken) {
        // TODO: Implement token refresh logic
        // This would call the OAuth provider's token refresh endpoint
        return true;
      }

      return false;
    } catch (error: any) {
      loggingService.error('Failed to refresh token', {
        component: 'MCPIntegrationHandler',
        operation: 'refreshTokenIfNeeded',
        integrationId: integration._id,
        error: error.message
      });
      return false;
    }
  }
}

