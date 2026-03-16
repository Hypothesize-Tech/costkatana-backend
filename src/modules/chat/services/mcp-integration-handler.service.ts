import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import { LoggerService } from '../../../common/logger/logger.service';
import { CacheService } from '../../../common/cache/cache.service';
import {
  IntegrationChatService,
  IntegrationCommand,
  IntegrationCommandResult,
} from './integration-chat.service';
import {
  Integration,
  IntegrationDocument,
} from '../../../schemas/integration/integration.schema';
import {
  GoogleConnection,
  GoogleConnectionDocument,
} from '../../../schemas/integration/google-connection.schema';
import {
  VercelConnection,
  VercelConnectionDocument,
} from '../../../schemas/integration/vercel-connection.schema';
import {
  McpPermissionAuditLog,
  McpPermissionAuditLogDocument,
} from '../../../schemas/security/mcp-permission-audit-log.schema';

export interface MCPIntegrationRequest {
  userId: string;
  command: IntegrationCommand;
  mentions?: any[]; // Additional mentions field
  context?: Record<string, any>;
}

export interface MCPIntegrationResponse {
  success: boolean;
  agentPath?: string[]; // Additional agentPath field
  optimizationsApplied?: string[]; // Additional optimizationsApplied field
  result: IntegrationCommandResult;
  auditLog?: {
    timestamp: Date;
    userId: string;
    integration: string;
    operation: string;
    duration: number;
  };
}

@Injectable()
export class McpIntegrationHandlerService {
  constructor(
    private readonly logger: LoggerService,
    private readonly cacheService: CacheService,
    private readonly integrationChatService: IntegrationChatService,
    @InjectModel(Integration.name)
    private integrationModel: Model<IntegrationDocument>,
    @InjectModel(GoogleConnection.name)
    private googleConnectionModel: Model<GoogleConnectionDocument>,
    @InjectModel(VercelConnection.name)
    private vercelConnectionModel: Model<VercelConnectionDocument>,
    @InjectModel(McpPermissionAuditLog.name)
    private auditLogModel: Model<McpPermissionAuditLogDocument>,
  ) {}

  /**
   * Handle integration operation via MCP protocol
   * This wraps operations in MCP middleware for security and logging
   */
  async handleIntegrationOperation(
    request: MCPIntegrationRequest,
  ): Promise<MCPIntegrationResponse> {
    const startTime = Date.now();
    const { userId, command, context } = request;

    // Use context for more relevant processing and logging
    if (context) {
      this.logger.log('MCP Integration operation started with context', {
        userId,
        integration: command.mention.integration,
        commandType: command.type,
        entity: command.entity,
        hasGitHubContext: !!context.github,
        hasUserPreferences: !!context.userPreferences,
        primaryIntegration: context.primaryIntegration,
        contextPreambleLength: context.contextPreamble?.length,
      });
    } else {
      this.logger.log('MCP Integration operation started', {
        userId,
        integration: command.mention.integration,
        commandType: command.type,
        entity: command.entity,
      });
    }

    try {
      // Validate user has access to integration
      const hasAccess = await this.validateUserAccess(
        userId,
        command.mention.integration,
      );
      if (!hasAccess) {
        return {
          success: false,
          result: {
            success: false,
            message: 'You do not have access to this integration',
            error: 'ACCESS_DENIED',
          },
          auditLog: {
            timestamp: new Date(),
            userId,
            integration: command.mention.integration,
            operation: `${command.type}_${command.entity}`,
            duration: Date.now() - startTime,
          },
        };
      }

      // Check rate limiting (per user and per integration)
      const rateLimitCheck = await this.checkRateLimit(
        userId,
        command.mention.integration,
      );
      if (!rateLimitCheck.allowed) {
        return {
          success: false,
          result: {
            success: false,
            message: `Rate limit exceeded. Please try again in ${rateLimitCheck.retryAfter} seconds`,
            error: 'RATE_LIMIT_EXCEEDED',
          },
          auditLog: {
            timestamp: new Date(),
            userId,
            integration: command.mention.integration,
            operation: `${command.type}_${command.entity}`,
            duration: Date.now() - startTime,
          },
        };
      }

      // Refresh token if needed
      await this.refreshTokenIfNeeded(userId, command.mention.integration);

      // Execute command with context-aware enhancements
      let enhancedCommand = command;

      // Enhance command with context-specific information
      if (context) {
        // For GitHub operations, use repository context if available
        if (command.mention.integration === 'github' && context.github) {
          enhancedCommand = {
            ...command,
            params: {
              ...command.params,
              repositoryId: context.github.repositoryId,
              repositoryName: context.github.repositoryName,
              repositoryFullName: context.github.repositoryFullName,
              branchName: context.github.branchName,
            },
          };
        }

        // Add user preferences to command params for personalized processing
        if (context.userPreferences) {
          enhancedCommand = {
            ...enhancedCommand,
            params: {
              ...enhancedCommand.params,
              userPreferences: context.userPreferences,
            },
          };
        }
      }

      const result = await this.integrationChatService.executeCommand(
        userId,
        enhancedCommand,
      );

      const duration = Date.now() - startTime;

      // Audit log
      const auditLog = {
        timestamp: new Date(),
        userId,
        integration: command.mention.integration,
        operation: `${command.type}_${command.entity}`,
        duration,
      };

      // Log operation result with context information
      if (result.success) {
        this.logger.log('MCP Integration operation completed successfully', {
          ...auditLog,
          result: result.message,
          contextUsed: !!context,
          githubContextUsed: !!context?.github,
          userPreferencesApplied: !!context?.userPreferences,
        });
      } else {
        this.logger.error('MCP Integration operation failed', {
          ...auditLog,
          error: result.error,
          message: result.message,
          contextProvided: !!context,
          contextDetails: context
            ? {
                hasGitHub: !!context.github,
                hasPreferences: !!context.userPreferences,
                primaryIntegration: context.primaryIntegration,
              }
            : undefined,
        });
      }

      return {
        success: result.success,
        result,
        auditLog,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;

      this.logger.error('MCP Integration operation error', {
        userId,
        integration: command.mention.integration,
        error: error.message,
        stack: error.stack,
        duration,
      });

      return {
        success: false,
        result: {
          success: false,
          message: `Operation failed: ${error.message}`,
          error: error.message,
        },
        auditLog: {
          timestamp: new Date(),
          userId,
          integration: command.mention.integration,
          operation: `${command.type}_${command.entity}`,
          duration,
        },
      };
    }
  }

  /**
   * Validate user has access to integration
   */
  private async validateUserAccess(
    userId: string,
    integrationType: string,
  ): Promise<boolean> {
    try {
      // Google Workspace services use GoogleConnection model
      const googleServices = [
        'gmail',
        'calendar',
        'drive',
        'sheets',
        'docs',
        'google',
      ];

      if (googleServices.includes(integrationType)) {
        const googleConnections = await this.googleConnectionModel.find({
          userId,
          isActive: true,
        });

        const hasGoogleAccess = googleConnections.length > 0;

        if (hasGoogleAccess) {
          this.logger.log('Google Workspace access validated', {
            userId,
            integrationType,
            connectionCount: googleConnections.length,
          });
        } else {
          this.logger.warn('Google Workspace access denied', {
            userId,
            integrationType,
          });
        }

        return hasGoogleAccess;
      }

      // For Vercel, check VercelConnection model
      if (integrationType === 'vercel') {
        const vercelConnections = await this.vercelConnectionModel.find({
          userId,
          isActive: true,
        });

        const hasVercelAccess = vercelConnections.length > 0;

        if (hasVercelAccess) {
          this.logger.log('Vercel access validated', {
            userId,
            integrationType,
            connectionCount: vercelConnections.length,
          });
        } else {
          this.logger.warn('Vercel access denied', {
            userId,
            integrationType,
          });
        }

        return hasVercelAccess;
      }

      // For standard integrations (Jira, Linear, Slack, Discord, GitHub)
      // Map integration types to database types
      const typeMapping: Record<string, string> = {
        jira: 'jira_oauth',
        linear: 'linear_oauth',
        slack: 'slack_oauth',
        discord: 'discord_oauth',
        github: 'github_oauth',
      };

      const dbType = typeMapping[integrationType];
      if (!dbType) {
        this.logger.warn('Unknown integration type for validation', {
          userId,
          integrationType,
        });
        return false;
      }

      const integration = await this.integrationModel.findOne({
        userId,
        type: dbType,
        status: 'active',
      });

      const hasAccess = !!integration;

      if (hasAccess) {
        this.logger.log('Integration access validated', {
          userId,
          integrationType,
          dbType,
          integrationId: integration._id.toString(),
        });
      } else {
        this.logger.warn('Integration access denied', {
          userId,
          integrationType,
          dbType,
        });
      }

      return hasAccess;
    } catch (error) {
      this.logger.error('Failed to validate user access', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        integrationType,
      });
      return false;
    }
  }

  /**
   * Check rate limiting per user and integration
   */
  private async checkRateLimit(
    userId: string,
    integrationType: string,
  ): Promise<{ allowed: boolean; retryAfter?: number }> {
    try {
      const now = Date.now();
      const windowSeconds = 60; // 1 minute window
      const maxUserRequests = 30; // 30 requests per user per minute
      const maxGlobalRequests = 100; // 100 requests globally per minute

      const userKey = `ratelimit:user:${userId}:${integrationType}`;
      const globalKey = `ratelimit:global:${integrationType}`;

      // Get current counters
      const userCount = (await this.cacheService.get<number>(userKey)) || 0;
      const globalCount = (await this.cacheService.get<number>(globalKey)) || 0;

      // Check limits
      const userAllowed = userCount < maxUserRequests;
      const globalAllowed = globalCount < maxGlobalRequests;

      if (!userAllowed || !globalAllowed) {
        const retryAfter =
          windowSeconds - (now % (windowSeconds * 1000)) / 1000;

        this.logger.warn('Rate limit exceeded', {
          userId,
          integrationType,
          userCount,
          globalCount,
          maxUserRequests,
          maxGlobalRequests,
          retryAfter: Math.ceil(retryAfter),
        });

        return {
          allowed: false,
          retryAfter: Math.ceil(retryAfter),
        };
      }

      // Increment counters (first request sets expiry)
      const newUserCount = userCount + 1;
      const newGlobalCount = globalCount + 1;

      await Promise.all([
        this.cacheService.set(userKey, newUserCount, windowSeconds),
        this.cacheService.set(globalKey, newGlobalCount, windowSeconds),
      ]);

      this.logger.debug('Rate limit check passed', {
        userId,
        integrationType,
        userCount: newUserCount,
        globalCount: newGlobalCount,
      });

      return { allowed: true };
    } catch (error) {
      this.logger.error('Rate limit check failed', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        integrationType,
      });
      // On error, allow the request to proceed (fail-open)
      return { allowed: true };
    }
  }

  /**
   * Refresh token if needed
   */
  private async refreshTokenIfNeeded(
    userId: string,
    integrationType: string,
  ): Promise<void> {
    try {
      // Check if token refresh is needed based on integration type
      const needsRefresh = await this.checkTokenExpiry(userId, integrationType);

      if (!needsRefresh) {
        return; // Token is still valid
      }

      this.logger.log('Token refresh needed', {
        userId,
        integrationType,
      });

      // Route to appropriate refresh method
      switch (integrationType) {
        case 'github':
          await this.refreshGitHubToken(userId);
          break;
        case 'linear':
          await this.refreshLinearToken(userId);
          break;
        case 'jira':
          await this.refreshJiraToken(userId);
          break;
        case 'slack':
          await this.refreshSlackToken(userId);
          break;
        case 'discord':
          await this.refreshDiscordToken(userId);
          break;
        case 'google':
        case 'gmail':
        case 'calendar':
        case 'drive':
        case 'sheets':
        case 'docs':
          await this.refreshGoogleToken(userId);
          break;
        case 'vercel':
          await this.refreshVercelToken(userId);
          break;
        default:
          this.logger.warn('Unknown integration type for token refresh', {
            userId,
            integrationType,
          });
      }
    } catch (error) {
      this.logger.error('Token refresh failed', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        integrationType,
      });
      // Don't throw - let the operation proceed (might still work with cached token)
    }
  }

  /**
   * Check if token expiry requires refresh
   */
  private async checkTokenExpiry(
    userId: string,
    integrationType: string,
  ): Promise<boolean> {
    try {
      // Check different models based on integration type
      const googleServices = [
        'gmail',
        'calendar',
        'drive',
        'sheets',
        'docs',
        'google',
      ];

      if (googleServices.includes(integrationType)) {
        const connection = await this.googleConnectionModel.findOne({
          userId,
          isActive: true,
        });

        if (!connection) return false;

        // Check if token expires within next 5 minutes
        const expiresAt = connection.expiresAt
          ? new Date(connection.expiresAt)
          : null;
        if (expiresAt) {
          const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
          return expiresAt <= fiveMinutesFromNow;
        }

        return false;
      }

      if (integrationType === 'vercel') {
        const connection = await this.vercelConnectionModel.findOne({
          userId,
          isActive: true,
        });

        if (!connection) return false;

        // Check if token expires within next 5 minutes
        const expiresAt = connection.expiresAt
          ? new Date(connection.expiresAt)
          : null;
        if (expiresAt) {
          const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
          return expiresAt <= fiveMinutesFromNow;
        }

        return false;
      }

      // For standard integrations, check Integration model
      const typeMapping: Record<string, string> = {
        github: 'github_oauth',
        linear: 'linear_oauth',
        jira: 'jira_oauth',
        slack: 'slack_oauth',
        discord: 'discord_oauth',
      };

      const dbType = typeMapping[integrationType];
      if (!dbType) return false;

      const integration = await this.integrationModel.findOne({
        userId,
        type: dbType,
        status: 'active',
      });

      if (!integration) return false;

      // Check token expiry in metadata
      const expiresAt = integration.metadata?.expiresAt;
      if (expiresAt) {
        const expiryDate = new Date(expiresAt);
        const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
        return expiryDate <= fiveMinutesFromNow;
      }

      return false;
    } catch (error) {
      this.logger.error('Token expiry check failed', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        integrationType,
      });
      return false; // Assume token is valid on error
    }
  }

  /**
   * Refresh GitHub token
   */
  private async refreshGitHubToken(userId: string): Promise<void> {
    try {
      const integration = await this.integrationModel.findOne({
        userId,
        type: 'github_oauth',
        status: 'active',
      });

      if (!integration) {
        throw new Error('GitHub integration not found');
      }

      const credentials = integration.getCredentials();
      const refreshToken = credentials?.refreshToken;

      // GitHub OAuth typically doesn't use refresh tokens for personal access tokens
      // But if we have a refresh token (from GitHub Apps), use it
      if (refreshToken) {
        try {
          // GitHub Apps can have refresh tokens for user-to-server token exchange
          const clientId = process.env.GITHUB_CLIENT_ID;
          const clientSecret = process.env.GITHUB_CLIENT_SECRET;

          if (!clientId || !clientSecret) {
            throw new Error('GitHub OAuth credentials not configured');
          }

          // Exchange refresh token for new access token
          const response = await fetch(
            'https://github.com/login/oauth/access_token',
            {
              method: 'POST',
              headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
              }),
            },
          );

          if (!response.ok) {
            throw new Error(
              `GitHub token refresh failed: ${response.status} ${response.statusText}`,
            );
          }

          const tokenData = await response.json();

          if (tokenData.error) {
            throw new Error(
              `GitHub token refresh error: ${tokenData.error_description || tokenData.error}`,
            );
          }

          // Update credentials with new tokens
          const updatedCredentials = {
            ...credentials,
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token || refreshToken, // May not be returned
            tokenType: tokenData.token_type || 'Bearer',
            scope: tokenData.scope || credentials.scope,
          };

          // Set new credentials
          integration.setCredentials(updatedCredentials);

          // Update metadata
          integration.metadata = {
            ...integration.metadata,
            lastTokenRefresh: new Date(),
            tokenExpiresAt: tokenData.expires_in
              ? new Date(Date.now() + tokenData.expires_in * 1000)
              : undefined,
          };

          await integration.save();

          this.logger.log('GitHub token refresh completed with OAuth', {
            userId,
            integrationId: integration._id.toString(),
            hasNewRefreshToken: !!tokenData.refresh_token,
          });
        } catch (oauthError) {
          this.logger.warn(
            'GitHub OAuth refresh failed, trying alternative methods',
            {
              error:
                oauthError instanceof Error
                  ? oauthError.message
                  : String(oauthError),
              userId,
              integrationId: integration._id.toString(),
            },
          );

          // For GitHub personal access tokens or apps without refresh tokens,
          // we might need to re-authorize or use app installation tokens
          throw oauthError;
        }
      } else {
        // No refresh token available - GitHub personal access tokens don't expire
        // Just validate the current token and update metadata
        try {
          const accessToken = credentials?.accessToken;
          if (!accessToken) {
            throw new Error('No access token available');
          }

          // Test token validity by making a simple API call
          const testResponse = await fetch('https://api.github.com/user', {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/vnd.github.v3+json',
              'User-Agent': 'CostKatana/1.0',
            },
          });

          if (!testResponse.ok) {
            if (testResponse.status === 401) {
              throw new Error('GitHub token is invalid or expired');
            }
            throw new Error(`GitHub API test failed: ${testResponse.status}`);
          }

          // Token is still valid, just update metadata
          integration.metadata = {
            ...integration.metadata,
            lastTokenValidation: new Date(),
            tokenValid: true,
          };

          await integration.save();

          this.logger.log(
            'GitHub token validation completed (no refresh needed)',
            {
              userId,
              integrationId: integration._id.toString(),
            },
          );
        } catch (validationError) {
          this.logger.error('GitHub token validation failed', {
            error:
              validationError instanceof Error
                ? validationError.message
                : String(validationError),
            userId,
            integrationId: integration._id.toString(),
          });

          // Mark integration as needing re-authorization
          integration.status = 'needs_reauth';
          integration.metadata = {
            ...integration.metadata,
            lastTokenValidation: new Date(),
            tokenValid: false,
            reauthReason: 'token_expired_or_invalid',
          };

          await integration.save();

          throw new Error('GitHub token is invalid and needs re-authorization');
        }
      }
    } catch (error) {
      this.logger.error('GitHub token refresh failed', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      throw error;
    }
  }

  /**
   * Refresh Linear token
   */
  private async refreshLinearToken(userId: string): Promise<void> {
    try {
      const integration = await this.integrationModel.findOne({
        userId,
        type: 'linear_oauth',
        status: 'active',
      });

      if (!integration) {
        throw new Error('Linear integration not found');
      }

      const credentials = integration.getCredentials();
      const refreshToken = credentials?.refreshToken;

      if (!refreshToken) {
        throw new Error('No refresh token available for Linear');
      }

      // Linear OAuth token refresh
      const clientId = process.env.LINEAR_CLIENT_ID;
      const clientSecret = process.env.LINEAR_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        throw new Error('Linear OAuth credentials not configured');
      }

      // Linear uses standard OAuth 2.0 refresh token flow
      const response = await fetch('https://api.linear.app/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Linear token refresh failed: ${response.status} ${response.statusText}`,
        );
      }

      const tokenData = await response.json();

      if (tokenData.error) {
        throw new Error(
          `Linear token refresh error: ${tokenData.error_description || tokenData.error}`,
        );
      }

      // Update credentials with new tokens
      const updatedCredentials = {
        ...credentials,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || refreshToken, // May not be returned
        tokenType: tokenData.token_type || 'Bearer',
        scope: tokenData.scope || credentials.scope,
      };

      // Set new credentials
      integration.setCredentials(updatedCredentials);

      // Update metadata
      integration.metadata = {
        ...integration.metadata,
        lastTokenRefresh: new Date(),
        tokenExpiresAt: tokenData.expires_in
          ? new Date(Date.now() + tokenData.expires_in * 1000)
          : undefined,
      };

      await integration.save();

      this.logger.log('Linear token refresh completed', {
        userId,
        integrationId: integration._id.toString(),
        hasNewRefreshToken: !!tokenData.refresh_token,
        expiresIn: tokenData.expires_in,
      });
    } catch (error) {
      this.logger.error('Linear token refresh failed', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });

      // Mark integration as needing re-authorization if refresh fails
      try {
        const integration = await this.integrationModel.findOne({
          userId,
          type: 'linear_oauth',
        });

        if (integration) {
          integration.status = 'needs_reauth';
          integration.metadata = {
            ...integration.metadata,
            lastTokenRefreshAttempt: new Date(),
            refreshError:
              error instanceof Error ? error.message : String(error),
          };
          await integration.save();
        }
      } catch (updateError) {
        this.logger.error(
          'Failed to update integration status after refresh failure',
          {
            error:
              updateError instanceof Error
                ? updateError.message
                : String(updateError),
            userId,
          },
        );
      }

      throw error;
    }
  }

  /**
   * Refresh Jira token
   */
  private async refreshJiraToken(userId: string): Promise<void> {
    try {
      const integration = await this.integrationModel.findOne({
        userId,
        type: 'jira_oauth',
        status: 'active',
      });

      if (!integration) {
        throw new Error('Jira integration not found');
      }

      const credentials = integration.getCredentials();

      // Determine if this is Jira Cloud or Server
      const isCloud =
        credentials?.siteUrl?.includes('atlassian.net') ||
        credentials?.cloudId !== undefined;

      if (isCloud) {
        await this.refreshJiraCloudToken(integration, credentials, userId);
      } else {
        await this.refreshJiraServerToken(integration, credentials, userId);
      }
    } catch (error) {
      this.logger.error('Jira token refresh failed', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });

      // Mark integration as needing re-authorization if refresh fails
      try {
        const integration = await this.integrationModel.findOne({
          userId,
          type: 'jira_oauth',
        });

        if (integration) {
          integration.status = 'needs_reauth';
          integration.metadata = {
            ...integration.metadata,
            lastTokenRefreshAttempt: new Date(),
            refreshError:
              error instanceof Error ? error.message : String(error),
          };
          await integration.save();
        }
      } catch (updateError) {
        this.logger.error(
          'Failed to update integration status after refresh failure',
          {
            error:
              updateError instanceof Error
                ? updateError.message
                : String(updateError),
            userId,
          },
        );
      }

      throw error;
    }
  }

  /**
   * Refresh Jira Cloud token using OAuth 2.0
   */
  private async refreshJiraCloudToken(
    integration: any,
    credentials: any,
    userId: string,
  ): Promise<void> {
    const refreshToken = credentials?.refreshToken;

    if (!refreshToken) {
      throw new Error('No refresh token available for Jira Cloud');
    }

    const clientId = process.env.JIRA_CLIENT_ID;
    const clientSecret = process.env.JIRA_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Jira OAuth credentials not configured');
    }

    const tokenEndpoint = 'https://auth.atlassian.com/oauth/token';

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Jira Cloud token refresh failed: ${response.status} ${response.statusText}`,
      );
    }

    const tokenData = await response.json();

    if (tokenData.error) {
      throw new Error(
        `Jira Cloud token refresh error: ${tokenData.error_description || tokenData.error}`,
      );
    }

    // Update credentials with new tokens
    const updatedCredentials = {
      ...credentials,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || refreshToken,
      tokenExpiresAt: tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000)
        : undefined,
    };

    integration.setCredentials(updatedCredentials);
    integration.metadata = {
      ...integration.metadata,
      lastTokenRefresh: new Date(),
      jiraInstanceType: 'cloud',
    };

    await integration.save();

    this.logger.log('Jira Cloud token refreshed successfully', {
      userId,
      integrationId: integration._id,
    });
  }

  /**
   * Refresh Jira Server/Data Center token
   * Jira Server uses different authentication mechanisms than Cloud
   */
  private async refreshJiraServerToken(
    integration: any,
    credentials: any,
    userId: string,
  ): Promise<void> {
    const siteUrl = credentials?.siteUrl;

    if (!siteUrl) {
      throw new Error('Site URL required for Jira Server token refresh');
    }

    // For Jira Server/Data Center, we support multiple authentication methods:

    // Method 1: Personal Access Token (PAT) - doesn't expire
    if (credentials?.personalAccessToken) {
      // PATs don't expire, so we just validate the token is still working
      await this.validateJiraServerToken(
        siteUrl,
        credentials.personalAccessToken,
      );

      // Update metadata to indicate successful validation
      integration.metadata = {
        ...integration.metadata,
        lastTokenRefresh: new Date(),
        jiraInstanceType: 'server',
        authMethod: 'personal_access_token',
      };

      await integration.save();

      this.logger.log('Jira Server PAT validated successfully', {
        userId,
        integrationId: integration._id,
        siteUrl,
      });

      return;
    }

    // Method 2: OAuth 1.0a - refresh the access token
    if (credentials?.oauthToken && credentials?.oauthTokenSecret) {
      await this.refreshJiraServerOAuth1Token(integration, credentials, userId);
      return;
    }

    // Method 3: Basic Auth with stored credentials (not recommended for production)
    if (credentials?.username && credentials?.password) {
      // Validate the stored credentials still work
      const authHeader = `Basic ${Buffer.from(
        `${credentials.username}:${credentials.password}`,
      ).toString('base64')}`;

      await this.validateJiraServerToken(siteUrl, null, authHeader);

      integration.metadata = {
        ...integration.metadata,
        lastTokenRefresh: new Date(),
        jiraInstanceType: 'server',
        authMethod: 'basic_auth',
        warning: 'Basic auth is not recommended for production use',
      };

      await integration.save();

      this.logger.log('Jira Server basic auth validated successfully', {
        userId,
        integrationId: integration._id,
        siteUrl,
      });

      return;
    }

    throw new Error(
      'No supported authentication method found for Jira Server. ' +
        'Supported: Personal Access Token, OAuth 1.0a, or Basic Auth',
    );
  }

  /**
   * Refresh Jira Server OAuth 1.0a token
   */
  private async refreshJiraServerOAuth1Token(
    integration: any,
    credentials: any,
    userId: string,
  ): Promise<void> {
    const siteUrl = credentials.siteUrl;
    const consumerKey = process.env.JIRA_SERVER_CONSUMER_KEY;
    const privateKey = process.env.JIRA_SERVER_PRIVATE_KEY;

    if (!consumerKey || !privateKey) {
      throw new Error('Jira Server OAuth 1.0a credentials not configured');
    }

    // OAuth 1.0a token refresh flow for Jira Server
    const tokenEndpoint = `${siteUrl}/plugins/servlet/oauth/access-token`;

    // Use manual OAuth 1.0a implementation (production-ready)
    await this.performOAuth1TokenRefresh(
      credentials,
      userId,
      tokenEndpoint,
      consumerKey,
      privateKey,
    );

    this.logger.log('Jira Server OAuth 1.0a token refreshed successfully', {
      component: 'MCPIntegrationHandlerService',
      operation: 'refreshJiraServerToken',
      userId,
      hasNewToken: !!credentials.oauthToken,
    });
  }

  /**
   * Perform OAuth 1.0a token refresh with manual implementation
   */
  private async performOAuth1TokenRefresh(
    credentials: any,
    userId: string,
    tokenEndpoint: string,
    consumerKey: string,
    privateKey: string,
  ): Promise<void> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = this.generateOAuthNonce();

    const params = {
      oauth_consumer_key: consumerKey,
      oauth_token: credentials.oauthToken,
      oauth_signature_method: 'RSA-SHA1',
      oauth_timestamp: timestamp,
      oauth_nonce: nonce,
      oauth_version: '1.0',
      oauth_session_handle: credentials.sessionHandle,
    };

    // Create signature base string per OAuth 1.0a specification
    const sortedParams = Object.keys(params)
      .sort()
      .map(
        (key) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(params[key as keyof typeof params])}`,
      )
      .join('&');

    const signatureBaseString = `POST&${encodeURIComponent(tokenEndpoint)}&${encodeURIComponent(sortedParams)}`;

    // Generate RSA-SHA1 signature
    const signature = this.generateOAuthSignature(
      signatureBaseString,
      privateKey,
    );

    const authHeader = `OAuth ${Object.keys(params)
      .sort()
      .map(
        (key) =>
          `${key}="${encodeURIComponent(params[key as keyof typeof params])}"`,
      )
      .join(', ')}, oauth_signature="${encodeURIComponent(signature)}"`;

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: authHeader,
      },
    });

    if (!response.ok) {
      throw new Error(
        `OAuth token refresh failed: ${response.status} ${response.statusText}`,
      );
    }

    const responseText = await response.text();
    const responseData = new URLSearchParams(responseText);

    credentials.oauthToken = responseData.get('oauth_token');
    credentials.oauthTokenSecret = responseData.get('oauth_token_secret');

    if (!credentials.oauthToken) {
      throw new Error('OAuth token refresh failed: no token received');
    }
  }

  /**
   * Fallback simplified OAuth implementation (development only)
   */
  private async fallbackOAuthRefresh(
    credentials: any,
    userId: string,
  ): Promise<void> {
    const siteUrl = credentials.siteUrl;
    const consumerKey = process.env.JIRA_SERVER_CONSUMER_KEY;
    const tokenEndpoint = `${siteUrl}/plugins/servlet/oauth/access-token`;
    const privateKey =
      process.env.JIRA_SERVER_PRIVATE_KEY || credentials.privateKey;

    if (!consumerKey) {
      throw new Error('Jira Server OAuth 1.0a credentials not configured');
    }

    if (!privateKey) {
      throw new Error('Jira Server private key not configured');
    }

    const integration = await this.integrationModel.findOne({
      userId,
      type: 'jira',
      status: 'active',
    });

    if (!integration) {
      throw new Error('Jira integration not found for user');
    }

    // Proper OAuth 1.0a signature generation
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = this.generateOAuthNonce();
    const params = {
      oauth_consumer_key: consumerKey,
      oauth_token: credentials.oauthToken,
      oauth_signature_method: 'RSA-SHA1',
      oauth_timestamp: timestamp,
      oauth_nonce: nonce,
      oauth_version: '1.0',
    };

    // Create signature base string per OAuth 1.0a specification
    const sortedParams = Object.keys(params)
      .sort()
      .map(
        (key) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(params[key as keyof typeof params])}`,
      )
      .join('&');

    const signatureBaseString = `POST&${encodeURIComponent(tokenEndpoint)}&${encodeURIComponent(sortedParams)}`;

    // Generate RSA-SHA1 signature with proper crypto implementation
    const signature = this.generateOAuthSignature(
      signatureBaseString,
      privateKey,
    );

    const authHeader = `OAuth ${Object.keys(params)
      .sort()
      .map(
        (key) =>
          `${key}="${encodeURIComponent(params[key as keyof typeof params])}"`,
      )
      .join(', ')}, oauth_signature="${encodeURIComponent(signature)}"`;

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: authHeader,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Jira Server OAuth token refresh failed: ${response.status} ${response.statusText}`,
      );
    }

    const responseText = await response.text();
    const tokenParams = new URLSearchParams(responseText);

    const newAccessToken = tokenParams.get('oauth_token');
    const newTokenSecret = tokenParams.get('oauth_token_secret');

    if (!newAccessToken || !newTokenSecret) {
      throw new Error('Invalid OAuth token refresh response from Jira Server');
    }

    // Update credentials
    const updatedCredentials = {
      ...credentials,
      oauthToken: newAccessToken,
      oauthTokenSecret: newTokenSecret,
    };

    integration.setCredentials(updatedCredentials);
    integration.metadata = {
      ...integration.metadata,
      lastTokenRefresh: new Date(),
      jiraInstanceType: 'server',
      authMethod: 'oauth1',
    };

    await integration.save();

    this.logger.log('Jira Server OAuth 1.0a token refreshed successfully', {
      userId,
      integrationId: integration._id,
      siteUrl: credentials.siteUrl,
    });
  }

  /**
   * Validate Jira Server token by making a test API call
   */
  private async validateJiraServerToken(
    siteUrl: string,
    token?: string | null,
    authHeader?: string,
  ): Promise<void> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    const response = await fetch(`${siteUrl}/rest/api/2/myself`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      throw new Error(
        `Jira Server token validation failed: ${response.status} ${response.statusText}`,
      );
    }
  }

  /**
   * Generate OAuth nonce using cryptographically secure random bytes
   */
  private generateOAuthNonce(): string {
    const randomBytes = crypto.randomBytes(16);
    return randomBytes.toString('hex') + Date.now().toString(36);
  }

  /**
   * Sign OAuth 1.0a request using RSA-SHA1
   */
  private generateOAuthSignature(
    baseString: string,
    privateKey: string,
  ): string {
    try {
      // Validate private key format (should be PEM format)
      if (
        !privateKey.includes('-----BEGIN') ||
        !privateKey.includes('-----END')
      ) {
        throw new Error('Invalid private key format - must be PEM encoded');
      }

      // Create RSA-SHA1 signature per OAuth 1.0a specification
      const sign = crypto.createSign('RSA-SHA1');
      sign.update(baseString, 'utf8');
      const signature = sign.sign(privateKey, 'base64');

      // URL encode the signature as required by OAuth 1.0a
      return encodeURIComponent(signature);
    } catch (error) {
      this.logger.error('Failed to create OAuth RSA-SHA1 signature', {
        error: error instanceof Error ? error.message : String(error),
        keyFormat: privateKey.substring(0, 50) + '...',
      });

      throw new Error(
        `OAuth signature generation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Refresh Slack token
   */
  private async refreshSlackToken(userId: string): Promise<void> {
    try {
      const integration = await this.integrationModel.findOne({
        userId,
        type: 'slack_oauth',
        status: 'active',
      });

      if (!integration) {
        throw new Error('Slack integration not found');
      }

      const credentials = integration.getCredentials();
      const accessToken = credentials?.accessToken;

      if (!accessToken) {
        throw new Error('No access token available for Slack');
      }

      // Slack OAuth tokens are long-lived, but we can validate them
      // and potentially refresh if they support refresh tokens
      const refreshToken = credentials?.refreshToken;

      if (refreshToken) {
        // Some Slack apps may support refresh tokens
        try {
          const clientId = process.env.SLACK_CLIENT_ID;
          const clientSecret = process.env.SLACK_CLIENT_SECRET;

          if (!clientId || !clientSecret) {
            throw new Error('Slack OAuth credentials not configured');
          }

          const response = await fetch(
            'https://slack.com/api/oauth.v2.access',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: clientId,
                client_secret: clientSecret,
              }),
            },
          );

          const tokenData = await response.json();

          if (!tokenData.ok) {
            throw new Error(`Slack token refresh error: ${tokenData.error}`);
          }

          // Update credentials with new tokens
          const updatedCredentials = {
            ...credentials,
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token || refreshToken,
            scope: tokenData.scope || credentials.scope,
          };

          // Set new credentials
          integration.setCredentials(updatedCredentials);

          integration.metadata = {
            ...integration.metadata,
            lastTokenRefresh: new Date(),
          };

          await integration.save();

          this.logger.log('Slack token refresh completed with OAuth', {
            userId,
            integrationId: integration._id.toString(),
            hasNewRefreshToken: !!tokenData.refresh_token,
          });
        } catch (oauthError) {
          this.logger.warn(
            'Slack OAuth refresh failed, validating existing token',
            {
              error:
                oauthError instanceof Error
                  ? oauthError.message
                  : String(oauthError),
              userId,
            },
          );

          // Fall back to token validation
          await this.validateSlackToken(integration, accessToken);
        }
      } else {
        // No refresh token, just validate the existing token
        await this.validateSlackToken(integration, accessToken);
      }
    } catch (error) {
      this.logger.error('Slack token refresh failed', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });

      // Mark integration as needing re-authorization if validation fails
      try {
        const integration = await this.integrationModel.findOne({
          userId,
          type: 'slack_oauth',
        });

        if (integration) {
          integration.status = 'needs_reauth';
          integration.metadata = {
            ...integration.metadata,
            lastTokenValidation: new Date(),
            tokenValid: false,
            reauthReason: 'token_invalid',
          };
          await integration.save();
        }
      } catch (updateError) {
        this.logger.error(
          'Failed to update integration status after Slack token failure',
          {
            error:
              updateError instanceof Error
                ? updateError.message
                : String(updateError),
            userId,
          },
        );
      }

      throw error;
    }
  }

  /**
   * Validate Slack token
   */
  private async validateSlackToken(
    integration: any,
    accessToken: string,
  ): Promise<void> {
    try {
      // Test token by calling Slack API
      const response = await fetch('https://slack.com/api/auth.test', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      const data = await response.json();

      if (!data.ok) {
        throw new Error(`Slack token validation failed: ${data.error}`);
      }

      // Token is valid, update metadata
      integration.metadata = {
        ...integration.metadata,
        lastTokenValidation: new Date(),
        tokenValid: true,
        slackUserId: data.user_id,
        slackTeamId: data.team_id,
      };

      await integration.save();

      this.logger.log('Slack token validation completed', {
        integrationId: integration._id.toString(),
        userId: integration.userId,
        slackUserId: data.user_id,
        teamId: data.team_id,
      });
    } catch (error) {
      this.logger.error('Slack token validation failed', {
        error: error instanceof Error ? error.message : String(error),
        integrationId: integration._id.toString(),
      });
      throw error;
    }
  }

  /**
   * Refresh Discord token
   */
  private async refreshDiscordToken(userId: string): Promise<void> {
    try {
      const integration = await this.integrationModel.findOne({
        userId,
        type: 'discord_oauth',
        status: 'active',
      });

      if (!integration) {
        throw new Error('Discord integration not found');
      }

      const credentials = integration.getCredentials();
      const refreshToken = credentials?.refreshToken;

      if (!refreshToken) {
        throw new Error('No refresh token available for Discord');
      }

      // Discord OAuth token refresh
      const clientId = process.env.DISCORD_CLIENT_ID;
      const clientSecret = process.env.DISCORD_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        throw new Error('Discord OAuth credentials not configured');
      }

      // Discord uses standard OAuth 2.0 refresh token flow
      const response = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Discord token refresh failed: ${response.status} ${response.statusText}`,
        );
      }

      const tokenData = await response.json();

      if (tokenData.error) {
        throw new Error(
          `Discord token refresh error: ${tokenData.error_description || tokenData.error}`,
        );
      }

      // Update credentials with new tokens
      const updatedCredentials = {
        ...credentials,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || refreshToken, // May not be returned
        tokenType: tokenData.token_type || 'Bearer',
        scope: tokenData.scope || credentials.scope,
      };

      // Set new credentials
      integration.setCredentials(updatedCredentials);

      // Update metadata
      integration.metadata = {
        ...integration.metadata,
        lastTokenRefresh: new Date(),
        tokenExpiresAt: tokenData.expires_in
          ? new Date(Date.now() + tokenData.expires_in * 1000)
          : undefined,
        discordUserId: tokenData.user?.id,
        discordUsername: tokenData.user?.username,
      };

      await integration.save();

      this.logger.log('Discord token refresh completed', {
        userId,
        integrationId: integration._id.toString(),
        hasNewRefreshToken: !!tokenData.refresh_token,
        expiresIn: tokenData.expires_in,
        discordUserId: tokenData.user?.id,
      });
    } catch (error) {
      this.logger.error('Discord token refresh failed', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });

      // Mark integration as needing re-authorization if refresh fails
      try {
        const integration = await this.integrationModel.findOne({
          userId,
          type: 'discord_oauth',
        });

        if (integration) {
          integration.status = 'needs_reauth';
          integration.metadata = {
            ...integration.metadata,
            lastTokenRefreshAttempt: new Date(),
            refreshError:
              error instanceof Error ? error.message : String(error),
          };
          await integration.save();
        }
      } catch (updateError) {
        this.logger.error(
          'Failed to update integration status after Discord token failure',
          {
            error:
              updateError instanceof Error
                ? updateError.message
                : String(updateError),
            userId,
          },
        );
      }

      throw error;
    }
  }

  /**
   * Refresh Google token
   */
  private async refreshGoogleToken(userId: string): Promise<void> {
    try {
      const connection = await this.googleConnectionModel.findOne({
        userId,
        isActive: true,
      });

      if (!connection) {
        throw new Error('Google connection not found');
      }

      const refreshToken = connection.refreshToken;
      if (!refreshToken) {
        throw new Error('No refresh token available for Google');
      }

      // Google OAuth token refresh
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        throw new Error('Google OAuth credentials not configured');
      }

      // Google OAuth 2.0 refresh token flow
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Google token refresh failed: ${response.status} ${response.statusText}`,
        );
      }

      const tokenData = await response.json();

      if (tokenData.error) {
        throw new Error(
          `Google token refresh error: ${tokenData.error_description || tokenData.error}`,
        );
      }

      // Update connection with new tokens
      connection.accessToken = tokenData.access_token;
      // Google may return a new refresh token, but typically the original one is still valid
      if (tokenData.refresh_token) {
        connection.refreshToken = tokenData.refresh_token;
      }
      connection.tokenType = tokenData.token_type || 'Bearer';
      connection.scope = tokenData.scope || connection.scope;

      // Calculate new expiry time
      if (tokenData.expires_in) {
        connection.expiresAt = new Date(
          Date.now() + tokenData.expires_in * 1000,
        );
      }

      connection.lastSyncedAt = new Date();

      await connection.save();

      this.logger.log('Google token refresh completed', {
        userId,
        connectionId: connection._id.toString(),
        hasNewRefreshToken: !!tokenData.refresh_token,
        expiresIn: tokenData.expires_in,
        scope: tokenData.scope,
      });
    } catch (error) {
      this.logger.error('Google token refresh failed', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });

      // Mark connection as inactive if refresh fails (use updateOne to avoid validation)
      try {
        await this.googleConnectionModel.updateOne(
          { userId, isActive: true },
          {
            $set: {
              isActive: false,
              healthStatus: 'token_expired',
              lastSyncedAt: new Date(),
            },
          },
        );
      } catch (updateError) {
        this.logger.error(
          'Failed to update Google connection status after refresh failure',
          {
            error:
              updateError instanceof Error
                ? updateError.message
                : String(updateError),
            userId,
          },
        );
      }

      throw error;
    }
  }

  /**
   * Refresh Vercel token
   */
  private async refreshVercelToken(userId: string): Promise<void> {
    try {
      const connection = await this.vercelConnectionModel.findOne({
        userId,
        isActive: true,
      });

      if (!connection) {
        throw new Error('Vercel connection not found');
      }

      const refreshToken = connection.refreshToken;
      if (!refreshToken) {
        throw new Error('No refresh token available for Vercel');
      }

      // Vercel OAuth token refresh
      const clientId = process.env.VERCEL_CLIENT_ID;
      const clientSecret = process.env.VERCEL_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        throw new Error('Vercel OAuth credentials not configured');
      }

      // Vercel uses standard OAuth 2.0 refresh token flow
      const response = await fetch(
        'https://api.vercel.com/v2/oauth/access_token',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Vercel token refresh failed: ${response.status} ${response.statusText}`,
        );
      }

      const tokenData = await response.json();

      if (tokenData.error) {
        throw new Error(
          `Vercel token refresh error: ${tokenData.error_description || tokenData.error}`,
        );
      }

      // Update connection with new tokens
      connection.accessToken = tokenData.access_token;
      if (tokenData.refresh_token) {
        connection.refreshToken = tokenData.refresh_token;
      }
      connection.tokenType = tokenData.token_type || 'Bearer';

      // Calculate new expiry time
      if (tokenData.expires_in) {
        connection.expiresAt = new Date(
          Date.now() + tokenData.expires_in * 1000,
        );
      }

      connection.updatedAt = new Date();

      await connection.save();

      this.logger.log('Vercel token refresh completed', {
        userId,
        connectionId: connection._id.toString(),
        hasNewRefreshToken: !!tokenData.refresh_token,
        expiresIn: tokenData.expires_in,
      });
    } catch (error) {
      this.logger.error('Vercel token refresh failed', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });

      // Mark connection as inactive if refresh fails (use updateOne to avoid validation)
      try {
        await this.vercelConnectionModel.updateOne(
          { userId, isActive: true },
          { $set: { isActive: false, updatedAt: new Date() } },
        );
      } catch (updateError) {
        this.logger.error(
          'Failed to update Vercel connection status after refresh failure',
          {
            error:
              updateError instanceof Error
                ? updateError.message
                : String(updateError),
            userId,
          },
        );
      }

      throw error;
    }
  }

  /**
   * Get rate limit status
   */
  async getRateLimitStatus(
    userId: string,
    integrationType: string,
  ): Promise<{
    userLimit: number;
    userRemaining: number;
    globalLimit: number;
    globalRemaining: number;
    resetTime: Date;
  }> {
    try {
      const userLimit = 30; // 30 requests per user per minute
      const globalLimit = 100; // 100 requests globally per minute

      const userKey = `ratelimit:user:${userId}:${integrationType}`;
      const globalKey = `ratelimit:global:${integrationType}`;

      // Get current counters
      const userCount = (await this.cacheService.get<number>(userKey)) || 0;
      const globalCount = (await this.cacheService.get<number>(globalKey)) || 0;

      // Calculate remaining requests
      const userRemaining = Math.max(0, userLimit - userCount);
      const globalRemaining = Math.max(0, globalLimit - globalCount);

      // Calculate reset time (next minute boundary)
      const now = new Date();
      const resetTime = new Date(
        now.getTime() + (60 - now.getSeconds()) * 1000,
      );

      return {
        userLimit,
        userRemaining,
        globalLimit,
        globalRemaining,
        resetTime,
      };
    } catch (error: unknown) {
      this.logger.error('Failed to get rate limit status', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        integrationType,
      });

      // Return default values on error
      return {
        userLimit: 30,
        userRemaining: 30,
        globalLimit: 100,
        globalRemaining: 100,
        resetTime: new Date(Date.now() + 60000), // 1 minute from now
      };
    }
  }

  /**
   * Get audit logs for user
   */
  async getAuditLogs(
    userId: string,
    integrationType?: string,
    limit: number = 50,
  ): Promise<
    Array<{
      timestamp: Date;
      integration: string;
      operation: string;
      duration: number;
      success: boolean;
    }>
  > {
    try {
      this.logger.debug('Retrieving audit logs', {
        userId,
        integrationType,
        limit,
      });

      // Build query filter
      const filter: any = {
        userId,
      };

      // Map integration type if provided
      if (integrationType) {
        // Convert common integration names to schema enum values
        const integrationMapping: Record<string, string> = {
          jira: 'jira',
          linear: 'linear',
          slack: 'slack',
          discord: 'discord',
          github: 'github',
          google: 'google_workspace',
          gmail: 'gmail',
          calendar: 'google_calendar',
          drive: 'google_drive',
          sheets: 'google_sheets',
          docs: 'google_docs',
          vercel: 'vercel',
        };

        const mappedIntegration =
          integrationMapping[integrationType] || integrationType;
        filter.integration = mappedIntegration;
      }

      // Query audit logs from database
      const auditLogs = await this.auditLogModel
        .find(filter, {
          createdAt: 1,
          integration: 1,
          method: 1,
          endpoint: 1,
          errorMessage: 1,
          metadata: 1,
        })
        .sort({ createdAt: -1 })
        .limit(Math.min(limit, 1000)) // Cap at 1000 for performance
        .lean();

      // Transform to the expected format
      const transformedLogs = auditLogs.map((log: Record<string, unknown>) => {
        const meta = log.metadata as { duration?: number } | undefined;
        return {
          timestamp: log.createdAt
            ? new Date(log.createdAt as string | Date)
            : new Date(),
          integration: String(log.integration ?? ''),
          operation: `${log.method} ${log.endpoint}`,
          duration: typeof meta?.duration === 'number' ? meta.duration : 0,
          success: !log.errorMessage,
        };
      });

      this.logger.log('Audit logs retrieved successfully', {
        userId,
        integrationType,
        requestedLimit: limit,
        actualCount: transformedLogs.length,
      });

      return transformedLogs;
    } catch (error: unknown) {
      this.logger.error('Failed to retrieve audit logs', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        integrationType,
        limit,
      });

      // Return empty array on error to maintain API stability
      return [];
    }
  }
}
