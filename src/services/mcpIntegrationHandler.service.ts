import { loggingService } from './logging.service';
import { IntegrationChatService, IntegrationCommand, IntegrationCommandResult } from './integrationChat.service';
import { IntegrationService } from './integration.service';
import { redisService } from './redis.service';
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
    const { userId, command } = request;

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
    const WINDOW_SECONDS = 60; // 1 minute

    try {
      // Create rate limit key: ratelimit:mcp:userId:integrationType
      const rateLimitKey = `ratelimit:mcp:${userId}:${integrationType}`;
      
      // Increment counter and get current count
      const currentCount = await redisService.incr(rateLimitKey);
      
      // Set TTL if this is the first request in the window
      if (currentCount === 1) {
        await redisService.set(rateLimitKey, '1', WINDOW_SECONDS);
      } else {
        // Get remaining TTL to ensure it's set
        const ttl = await redisService.getTTL(rateLimitKey);
        if (ttl === -1) {
          // Key exists but no TTL, set it
          await redisService.set(rateLimitKey, currentCount.toString(), WINDOW_SECONDS);
        }
      }
      
      // Check if limit exceeded
      if (currentCount > MAX_REQUESTS) {
        // Get remaining TTL for retry after
        const ttl = await redisService.getTTL(rateLimitKey);
        const retryAfter = ttl > 0 ? ttl : WINDOW_SECONDS;
        
        loggingService.warn('Rate limit exceeded', {
          component: 'MCPIntegrationHandler',
          operation: 'checkRateLimit',
          userId,
          integrationType,
          currentCount,
          maxRequests: MAX_REQUESTS,
          retryAfter
        });
        
        return {
          allowed: false,
          retryAfter
        };
      }
      
      return { allowed: true };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggingService.error('Rate limit check failed', {
        component: 'MCPIntegrationHandler',
        operation: 'checkRateLimit',
        userId,
        integrationType,
        error: errorMessage
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
      if (!credentials.refreshToken || !credentials.accessToken) {
        // No refresh token available, cannot refresh
        return false;
      }

      // Check token expiry from metadata if available
      const tokenExpiry = integration.metadata?.tokenExpiresAt;
      if (tokenExpiry) {
        let expiryDate: Date;
        if (typeof tokenExpiry === 'string') {
          expiryDate = new Date(tokenExpiry);
        } else if (tokenExpiry instanceof Date) {
          expiryDate = tokenExpiry;
        } else {
          expiryDate = new Date(String(tokenExpiry));
        }
        
        const now = new Date();
        const timeUntilExpiry = expiryDate.getTime() - now.getTime();
        
        // Only refresh if token is expired or expiring in next 5 minutes
        if (timeUntilExpiry > 5 * 60 * 1000) {
          // Token is still valid for more than 5 minutes
          return false;
        }
      }

      // Refresh token based on integration type
      let refreshed = false;
      
      switch (integration.type) {
        case 'github_oauth':
          refreshed = await this.refreshGitHubToken(integration, credentials);
          break;
          
        case 'linear_oauth':
          refreshed = await this.refreshLinearToken(integration, credentials);
          break;
          
        case 'jira_oauth':
          refreshed = await this.refreshJiraToken(integration, credentials);
          break;
          
        case 'slack_oauth':
          refreshed = await this.refreshSlackToken(integration, credentials);
          break;
          
        case 'discord_oauth':
          refreshed = await this.refreshDiscordToken(integration, credentials);
          break;
          
        default:
          // Webhook integrations don't need token refresh
          loggingService.info('Token refresh not applicable for integration type', {
            component: 'MCPIntegrationHandler',
            operation: 'refreshTokenIfNeeded',
            integrationId: integration._id,
            integrationType: integration.type
          });
          return false;
      }

      if (refreshed) {
        loggingService.info('Token refreshed successfully', {
          component: 'MCPIntegrationHandler',
          operation: 'refreshTokenIfNeeded',
          integrationId: integration._id,
          integrationType: integration.type
        });
      }

      return refreshed;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggingService.error('Failed to refresh token', {
        component: 'MCPIntegrationHandler',
        operation: 'refreshTokenIfNeeded',
        integrationId: integration._id,
        error: errorMessage
      });
      return false;
    }
  }

  /**
   * Refresh GitHub OAuth token
   */
  private static async refreshGitHubToken(
    integration: IIntegration,
    credentials: { accessToken?: string; refreshToken?: string }
  ): Promise<boolean> {
    try {
      const { GitHubService } = await import('./github.service');
      const { GitHubConnection } = await import('../models');
      
      // Find GitHub connection for this user
      const userIdStr = typeof integration.userId === 'string' 
        ? integration.userId 
        : integration.userId.toString();
      
      const connection = await GitHubConnection.findOne({
        userId: userIdStr,
        tokenType: 'oauth'
      }).select('+accessToken +refreshToken');
      
      if (!connection) {
        const integrationIdStr = typeof integration._id === 'string' 
          ? integration._id 
          : (integration._id as { toString: () => string }).toString();
        loggingService.warn('GitHub connection not found for token refresh', {
          userId: userIdStr,
          integrationId: integrationIdStr
        });
        return false;
      }

      const refreshedToken = await GitHubService.refreshAccessToken(connection);
      if (refreshedToken) {
        // Update integration credentials with new token
        const newCredentials = {
          ...credentials,
          accessToken: refreshedToken
        };
        integration.setCredentials(newCredentials);
        await integration.save();
        return true;
      }
      
      return false;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggingService.error('Failed to refresh GitHub token', {
        integrationId: integration._id,
        error: errorMessage
      });
      return false;
    }
  }

  /**
   * Refresh Linear OAuth token
   */
  private static async refreshLinearToken(
    integration: IIntegration,
    credentials: { accessToken?: string; refreshToken?: string }
  ): Promise<boolean> {
    try {
      if (!credentials.refreshToken) {
        return false;
      }

      const clientId = process.env.LINEAR_CLIENT_ID;
      const clientSecret = process.env.LINEAR_CLIENT_SECRET;
      
      if (!clientId || !clientSecret) {
        loggingService.error('Linear OAuth credentials not configured');
        return false;
      }

      // Linear uses OAuth 2.0 token refresh
      const response = await fetch('https://api.linear.app/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: credentials.refreshToken,
          client_id: clientId,
          client_secret: clientSecret
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        loggingService.error('Linear token refresh failed', {
          status: response.status,
          error: errorText
        });
        return false;
      }

      const data = await response.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      // Update integration credentials
      const newCredentials: { accessToken?: string; refreshToken?: string } = {
        ...credentials,
        accessToken: data.access_token
      };

      if (data.refresh_token) {
        newCredentials.refreshToken = data.refresh_token;
      }

      // Update token expiry in metadata
      if (data.expires_in) {
        const expiresAt = new Date(Date.now() + data.expires_in * 1000);
        if (!integration.metadata) {
          integration.metadata = {};
        }
        integration.metadata.tokenExpiresAt = expiresAt.toISOString();
      }

      integration.setCredentials(newCredentials);
      await integration.save();
      
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggingService.error('Failed to refresh Linear token', {
        integrationId: integration._id,
        error: errorMessage
      });
      return false;
    }
  }

  /**
   * Refresh Jira OAuth token
   */
  private static async refreshJiraToken(
    integration: IIntegration,
    credentials: { accessToken?: string; refreshToken?: string; siteUrl?: string }
  ): Promise<boolean> {
    try {
      if (!credentials.refreshToken || !credentials.siteUrl) {
        return false;
      }

      const clientId = process.env.JIRA_CLIENT_ID;
      const clientSecret = process.env.JIRA_CLIENT_SECRET;
      
      if (!clientId || !clientSecret) {
        loggingService.error('Jira OAuth credentials not configured');
        return false;
      }

      // Jira uses OAuth 2.0 token refresh
      const tokenUrl = `${credentials.siteUrl}/oauth/token`;
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: credentials.refreshToken,
          client_id: clientId,
          client_secret: clientSecret
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        loggingService.error('Jira token refresh failed', {
          status: response.status,
          error: errorText,
          siteUrl: credentials.siteUrl
        });
        return false;
      }

      const data = await response.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      // Update integration credentials
      const newCredentials = {
        ...credentials,
        accessToken: data.access_token
      };

      if (data.refresh_token) {
        newCredentials.refreshToken = data.refresh_token;
      }

      // Update token expiry in metadata
      if (data.expires_in) {
        const expiresAt = new Date(Date.now() + data.expires_in * 1000);
        if (!integration.metadata) {
          integration.metadata = {};
        }
        integration.metadata.tokenExpiresAt = expiresAt.toISOString();
      }

      integration.setCredentials(newCredentials);
      await integration.save();
      
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggingService.error('Failed to refresh Jira token', {
        integrationId: integration._id,
        error: errorMessage
      });
      return false;
    }
  }

  /**
   * Refresh Slack OAuth token
   */
  private static async refreshSlackToken(
    integration: IIntegration,
    credentials: { accessToken?: string; refreshToken?: string }
  ): Promise<boolean> {
    try {
      if (!credentials.refreshToken) {
        return false;
      }

      const clientId = process.env.SLACK_CLIENT_ID;
      const clientSecret = process.env.SLACK_CLIENT_SECRET;
      
      if (!clientId || !clientSecret) {
        loggingService.error('Slack OAuth credentials not configured');
        return false;
      }

      // Slack uses OAuth 2.0 token refresh
      const response = await fetch('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: credentials.refreshToken,
          client_id: clientId,
          client_secret: clientSecret
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        loggingService.error('Slack token refresh failed', {
          status: response.status,
          error: errorText
        });
        return false;
      }

      const data = await response.json() as {
        ok: boolean;
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error?: string;
      };

      if (!data.ok || !data.access_token) {
        loggingService.error('Slack token refresh returned error', {
          error: data.error
        });
        return false;
      }

      // Update integration credentials
      const newCredentials = {
        ...credentials,
        accessToken: data.access_token
      };

      if (data.refresh_token) {
        newCredentials.refreshToken = data.refresh_token;
      }

      // Update token expiry in metadata
      if (data.expires_in) {
        const expiresAt = new Date(Date.now() + data.expires_in * 1000);
        if (!integration.metadata) {
          integration.metadata = {};
        }
        integration.metadata.tokenExpiresAt = expiresAt.toISOString();
      }

      integration.setCredentials(newCredentials);
      await integration.save();
      
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggingService.error('Failed to refresh Slack token', {
        integrationId: integration._id,
        error: errorMessage
      });
      return false;
    }
  }

  /**
   * Refresh Discord OAuth token
   */
  private static async refreshDiscordToken(
    integration: IIntegration,
    credentials: { accessToken?: string; refreshToken?: string }
  ): Promise<boolean> {
    try {
      if (!credentials.refreshToken) {
        return false;
      }

      const clientId = process.env.DISCORD_CLIENT_ID;
      const clientSecret = process.env.DISCORD_CLIENT_SECRET;
      
      if (!clientId || !clientSecret) {
        loggingService.error('Discord OAuth credentials not configured');
        return false;
      }

      // Discord uses OAuth 2.0 token refresh
      const response = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: credentials.refreshToken,
          client_id: clientId,
          client_secret: clientSecret
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        loggingService.error('Discord token refresh failed', {
          status: response.status,
          error: errorText
        });
        return false;
      }

      const data = await response.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      // Update integration credentials
      const newCredentials = {
        ...credentials,
        accessToken: data.access_token
      };

      if (data.refresh_token) {
        newCredentials.refreshToken = data.refresh_token;
      }

      // Update token expiry in metadata
      if (data.expires_in) {
        const expiresAt = new Date(Date.now() + data.expires_in * 1000);
        if (!integration.metadata) {
          integration.metadata = {};
        }
        integration.metadata.tokenExpiresAt = expiresAt.toISOString();
      }

      integration.setCredentials(newCredentials);
      await integration.save();
      
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggingService.error('Failed to refresh Discord token', {
        integrationId: integration._id,
        error: errorMessage
      });
      return false;
    }
  }
}

