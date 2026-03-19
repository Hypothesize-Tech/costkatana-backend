/**
 * Token Manager Service for MCP
 * Handles OAuth token refresh and validation across different integrations
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoggerService } from '@/common/logger/logger.service';
import { IntegrationType } from '../types/mcp.types';
import { VercelConnection } from '@/schemas/integration/vercel-connection.schema';
import { GitHubConnection } from '@/schemas/integration/github-connection.schema';
import { GoogleConnection } from '@/schemas/integration/google-connection.schema';
import { Integration } from '@/schemas/integration/integration.schema';

@Injectable()
export class TokenManagerService {
  constructor(
    private logger: LoggerService,
    private configService: ConfigService,
    @InjectModel(VercelConnection.name)
    private vercelConnectionModel: Model<VercelConnection>,
    @InjectModel(GitHubConnection.name)
    private githubConnectionModel: Model<GitHubConnection>,
    @InjectModel(GoogleConnection.name)
    private googleConnectionModel: Model<GoogleConnection>,
    @InjectModel(Integration.name) private integrationModel: Model<Integration>,
  ) {}

  /**
   * Check if token needs refresh (expires within 5 minutes)
   */
  async needsRefresh(
    connectionId: string,
    integration: IntegrationType,
  ): Promise<boolean> {
    try {
      let expiresAt: Date | undefined;

      switch (integration) {
        case 'vercel': {
          const conn = await this.vercelConnectionModel
            .findById(connectionId)
            .select('expiresAt')
            .lean();
          expiresAt = conn?.expiresAt;
          break;
        }
        case 'github': {
          const conn = await this.githubConnectionModel
            .findById(connectionId)
            .select('expiresAt')
            .lean();
          expiresAt = conn?.expiresAt;
          break;
        }
        case 'google': {
          const conn = await this.googleConnectionModel
            .findById(connectionId)
            .select('expiresAt')
            .lean();
          expiresAt = conn?.expiresAt;
          break;
        }
        case 'jira':
        case 'linear':
        case 'slack':
        case 'discord': {
          // These use the generic Integration model with tokenExpiresAt in metadata
          const conn = await this.integrationModel
            .findById(connectionId)
            .select('metadata')
            .lean();
          if (conn?.metadata?.tokenExpiresAt) {
            expiresAt = new Date(conn.metadata.tokenExpiresAt);
          }
          break;
        }
        default:
          return false;
      }

      if (!expiresAt) {
        // If no expiry date, assume token might be expired (safer to refresh)
        this.logger.warn(
          'No token expiry date found, assuming refresh needed',
          {
            connectionId,
            integration,
          },
        );
        return true;
      }

      // Refresh if expires in next 5 minutes
      const now = new Date();
      const timeUntilExpiry = expiresAt.getTime() - now.getTime();
      const needsRefresh = timeUntilExpiry < 5 * 60 * 1000;

      this.logger.debug('Token expiry check', {
        connectionId,
        integration,
        expiresAt,
        timeUntilExpiry,
        needsRefresh,
      });

      return needsRefresh;
    } catch (error) {
      this.logger.error('Failed to check token expiry', {
        error: error instanceof Error ? error.message : String(error),
        connectionId,
        integration,
      });
      // Return true to attempt refresh on error (safer)
      return true;
    }
  }

  /**
   * Refresh token if needed
   */
  async refreshIfNeeded(
    connectionId: string,
    integration: IntegrationType,
  ): Promise<boolean> {
    const needsRefresh = await this.needsRefresh(connectionId, integration);
    if (!needsRefresh) {
      this.logger.debug('Token does not need refresh', {
        connectionId,
        integration,
      });
      return true;
    }

    this.logger.log('Token refresh needed', {
      connectionId,
      integration,
    });

    // Use existing refresh logic for different integrations
    try {
      let refreshed = false;

      switch (integration) {
        case 'github': {
          refreshed = await this.refreshGitHubToken(connectionId);
          break;
        }

        case 'google': {
          refreshed = await this.refreshGoogleToken(connectionId);
          break;
        }

        case 'jira':
        case 'linear':
        case 'slack':
        case 'discord': {
          refreshed = await this.refreshGenericIntegrationToken(connectionId);
          break;
        }

        default:
          this.logger.warn('Token refresh not supported for integration', {
            integration,
          });
          return false;
      }

      if (refreshed) {
        this.logger.log('Token refreshed successfully', {
          connectionId,
          integration,
        });
      } else {
        this.logger.warn('Token refresh returned false', {
          connectionId,
          integration,
        });
      }

      return refreshed;
    } catch (error) {
      this.logger.error('Failed to refresh token', {
        error: error instanceof Error ? error.message : String(error),
        connectionId,
        integration,
      });
      return false;
    }
  }

  /**
   * Refresh GitHub token
   */
  private async refreshGitHubToken(connectionId: string): Promise<boolean> {
    try {
      const connection = await this.githubConnectionModel
        .findById(connectionId)
        .select('+accessToken +refreshToken expiresAt')
        .exec();

      if (!connection) {
        this.logger.error('GitHub connection not found for token refresh', {
          connectionId,
        });
        return false;
      }

      if (!connection.refreshToken) {
        this.logger.warn('No refresh token available for GitHub connection', {
          connectionId,
        });
        return false;
      }

      // Call GitHub OAuth endpoint to refresh token
      const response = await fetch(
        'https://github.com/login/oauth/access_token',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            client_id: process.env.GITHUB_CLIENT_ID,
            client_secret: process.env.GITHUB_CLIENT_SECRET,
            refresh_token: connection.decryptRefreshToken(),
            grant_type: 'refresh_token',
          }),
        },
      );

      const data = await response.json();

      if (!response.ok || !data.access_token) {
        this.logger.error('GitHub token refresh failed', {
          connectionId,
          status: response.status,
          response: data,
        });
        return false;
      }

      // Update connection with new tokens
      connection.accessToken = connection.encryptToken(data.access_token);
      if (data.refresh_token) {
        connection.refreshToken = connection.encryptToken(data.refresh_token);
      }
      if (data.expires_in) {
        connection.expiresAt = new Date(Date.now() + data.expires_in * 1000);
      }

      await connection.save();

      this.logger.log('GitHub token refreshed successfully', { connectionId });
      return true;
    } catch (error) {
      this.logger.error('GitHub token refresh failed', {
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Refresh Google token
   */
  private async refreshGoogleToken(connectionId: string): Promise<boolean> {
    try {
      const connection = await this.googleConnectionModel
        .findById(connectionId)
        .select('+encryptedAccessToken +encryptedRefreshToken expiresAt')
        .exec();

      if (!connection) {
        this.logger.error('Google connection not found for token refresh', {
          connectionId,
        });
        return false;
      }

      // Actually refresh the Google token using Google APIs
      try {
        const { google } = await import('googleapis');

        // You'll need to configure these from environment variables or config service
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        const callbackUrl = this.configService.get<string>('GOOGLE_CALLBACK_URL');
        const backendUrl = this.configService.get<string>('BACKEND_URL');
        if (!callbackUrl && !backendUrl) {
          throw new Error(
            'GOOGLE_CALLBACK_URL or BACKEND_URL must be configured for Google OAuth callback.',
          );
        }
        const redirectUri =
          callbackUrl ||
          `${backendUrl}/api/auth/oauth/google/callback`;

        if (!clientId || !clientSecret) {
          this.logger.error('Google OAuth credentials not configured');
          return false;
        }

        const oauth2Client = new google.auth.OAuth2(
          clientId,
          clientSecret,
          redirectUri,
        );

        // Get the decrypted refresh token
        // Note: GoogleConnection uses encryptedRefreshToken, need to decrypt it
        if (!connection.encryptedRefreshToken) {
          this.logger.warn('No refresh token available for Google connection', {
            connectionId,
          });
          return false;
        }

        // Import EncryptionService to decrypt
        const { EncryptionService } = await import('@/utils/encryption');
        const refreshToken = EncryptionService.decryptFromCombinedFormat(
          connection.encryptedRefreshToken,
        );

        oauth2Client.setCredentials({
          refresh_token: refreshToken,
        });

        // Refresh the token
        const { credentials } = await oauth2Client.refreshAccessToken();

        if (credentials.access_token) {
          // Encrypt and update the new tokens
          connection.encryptedAccessToken =
            EncryptionService.encryptToCombinedFormat(credentials.access_token);
          if (credentials.refresh_token) {
            connection.encryptedRefreshToken =
              EncryptionService.encryptToCombinedFormat(
                credentials.refresh_token,
              );
          }
          if (credentials.expiry_date) {
            connection.expiresAt = new Date(credentials.expiry_date);
          }
          // Note: GoogleConnection doesn't have healthStatus field, skipping
          await connection.save();

          this.logger.log('Google token refreshed successfully', {
            connectionId,
          });
          return true;
        } else {
          this.logger.warn('Google token refresh did not return access token', {
            connectionId,
          });
          return false;
        }
      } catch (error) {
        this.logger.error('Google token refresh failed', {
          connectionId,
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    } catch (error) {
      this.logger.error('Google token refresh setup failed', {
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Refresh token for generic integrations (Jira, Linear, Slack, Discord)
   */
  private async refreshGenericIntegrationToken(
    connectionId: string,
  ): Promise<boolean> {
    try {
      const integration_doc = await this.integrationModel
        .findById(connectionId)
        .exec();

      if (!integration_doc) {
        this.logger.error(
          'Integration connection not found for token refresh',
          {
            connectionId,
          },
        );
        return false;
      }

      const credentials = integration_doc.getCredentials();
      if (!credentials?.refreshToken) {
        this.logger.warn('No refresh token available for integration', {
          connectionId,
          integration: integration_doc.type,
        });
        return false;
      }

      let refreshed = false;

      switch (integration_doc.type?.toLowerCase()) {
        case 'jira':
          refreshed = await this.refreshJiraToken(integration_doc, credentials);
          break;
        case 'linear':
          refreshed = await this.refreshLinearToken(
            integration_doc,
            credentials,
          );
          break;
        case 'slack':
          refreshed = await this.refreshSlackToken(
            integration_doc,
            credentials,
          );
          break;
        case 'discord':
          refreshed = await this.refreshDiscordToken(
            integration_doc,
            credentials,
          );
          break;
        default:
          this.logger.warn('Unsupported integration type for token refresh', {
            connectionId,
            integration: integration_doc.type,
          });
          return false;
      }

      if (refreshed) {
        this.logger.log('Generic integration token refreshed successfully', {
          connectionId,
          integration: integration_doc.type,
        });
      }

      return refreshed;
    } catch (error) {
      this.logger.error('Generic integration token refresh failed', {
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Refresh Jira token
   */
  private async refreshJiraToken(
    integration: any,
    credentials: any,
  ): Promise<boolean> {
    try {
      const response = await fetch('https://auth.atlassian.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: credentials.refreshToken,
          client_id: process.env.JIRA_CLIENT_ID,
          client_secret: process.env.JIRA_CLIENT_SECRET,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.access_token) {
        this.logger.error('Jira token refresh failed', {
          integrationId: integration._id,
          status: response.status,
          response: data,
        });
        return false;
      }

      integration.setCredentials({
        ...credentials,
        accessToken: data.access_token,
        refreshToken: data.refresh_token || credentials.refreshToken,
      });

      if (data.expires_in) {
        integration.metadata = integration.metadata || {};
        integration.metadata.tokenExpiresAt = new Date(
          Date.now() + data.expires_in * 1000,
        ).toISOString();
      }

      await integration.save();
      return true;
    } catch (error) {
      this.logger.error('Jira token refresh error', {
        integrationId: integration._id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Refresh Linear token
   */
  private async refreshLinearToken(
    integration: any,
    credentials: any,
  ): Promise<boolean> {
    try {
      const response = await fetch('https://api.linear.app/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: credentials.refreshToken,
          client_id: process.env.LINEAR_CLIENT_ID,
          client_secret: process.env.LINEAR_CLIENT_SECRET,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.access_token) {
        this.logger.error('Linear token refresh failed', {
          integrationId: integration._id,
          status: response.status,
          response: data,
        });
        return false;
      }

      integration.setCredentials({
        ...credentials,
        accessToken: data.access_token,
        refreshToken: data.refresh_token || credentials.refreshToken,
      });

      if (data.expires_in) {
        integration.metadata = integration.metadata || {};
        integration.metadata.tokenExpiresAt = new Date(
          Date.now() + data.expires_in * 1000,
        ).toISOString();
      }

      await integration.save();
      return true;
    } catch (error) {
      this.logger.error('Linear token refresh error', {
        integrationId: integration._id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Refresh Slack token
   */
  private async refreshSlackToken(
    integration: any,
    credentials: any,
  ): Promise<boolean> {
    try {
      const response = await fetch('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: credentials.refreshToken || '',
          client_id: process.env.SLACK_CLIENT_ID || '',
          client_secret: process.env.SLACK_CLIENT_SECRET || '',
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.ok || !data.access_token) {
        this.logger.error('Slack token refresh failed', {
          integrationId: integration._id,
          status: response.status,
          response: data,
        });
        return false;
      }

      integration.setCredentials({
        ...credentials,
        accessToken: data.access_token,
        refreshToken: data.refresh_token || credentials.refreshToken,
      });

      if (data.expires_in) {
        integration.metadata = integration.metadata || {};
        integration.metadata.tokenExpiresAt = new Date(
          Date.now() + data.expires_in * 1000,
        ).toISOString();
      }

      await integration.save();
      return true;
    } catch (error) {
      this.logger.error('Slack token refresh error', {
        integrationId: integration._id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Refresh Discord token
   */
  private async refreshDiscordToken(
    integration: any,
    credentials: any,
  ): Promise<boolean> {
    try {
      const response = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: credentials.refreshToken || '',
          client_id: process.env.DISCORD_CLIENT_ID || '',
          client_secret: process.env.DISCORD_CLIENT_SECRET || '',
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.access_token) {
        this.logger.error('Discord token refresh failed', {
          integrationId: integration._id,
          status: response.status,
          response: data,
        });
        return false;
      }

      integration.setCredentials({
        ...credentials,
        accessToken: data.access_token,
        refreshToken: data.refresh_token || credentials.refreshToken,
      });

      if (data.expires_in) {
        integration.metadata = integration.metadata || {};
        integration.metadata.tokenExpiresAt = new Date(
          Date.now() + data.expires_in * 1000,
        ).toISOString();
      }

      await integration.save();
      return true;
    } catch (error) {
      this.logger.error('Discord token refresh error', {
        integrationId: integration._id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Get token expiry information
   */
  async getTokenExpiryInfo(
    connectionId: string,
    integration: IntegrationType,
  ): Promise<{
    expiresAt?: Date;
    timeUntilExpiry?: number;
    needsRefresh: boolean;
  } | null> {
    try {
      let expiresAt: Date | undefined;

      switch (integration) {
        case 'vercel': {
          const conn = await this.vercelConnectionModel
            .findById(connectionId)
            .select('expiresAt')
            .lean();
          expiresAt = conn?.expiresAt;
          break;
        }
        case 'github': {
          const conn = await this.githubConnectionModel
            .findById(connectionId)
            .select('expiresAt')
            .lean();
          expiresAt = conn?.expiresAt;
          break;
        }
        case 'google': {
          const conn = await this.googleConnectionModel
            .findById(connectionId)
            .select('expiresAt')
            .lean();
          expiresAt = conn?.expiresAt;
          break;
        }
        case 'jira':
        case 'linear':
        case 'slack':
        case 'discord': {
          const conn = await this.integrationModel
            .findById(connectionId)
            .select('metadata')
            .lean();
          if (conn?.metadata?.tokenExpiresAt) {
            expiresAt = new Date(conn.metadata.tokenExpiresAt);
          }
          break;
        }
      }

      if (!expiresAt) {
        return {
          needsRefresh: true,
        };
      }

      const now = new Date();
      const timeUntilExpiry = expiresAt.getTime() - now.getTime();
      const needsRefresh = timeUntilExpiry < 5 * 60 * 1000;

      return {
        expiresAt,
        timeUntilExpiry,
        needsRefresh,
      };
    } catch (error) {
      this.logger.error('Failed to get token expiry info', {
        error: error instanceof Error ? error.message : String(error),
        connectionId,
        integration,
      });
      return null;
    }
  }

  /**
   * Force token refresh (for admin/manual operations)
   */
  async forceTokenRefresh(
    connectionId: string,
    integration: IntegrationType,
  ): Promise<boolean> {
    this.logger.log('Forcing token refresh', {
      connectionId,
      integration,
    });

    return await this.refreshIfNeeded(connectionId, integration);
  }
}
