/**
 * OAuth Token Manager
 * Handles token refresh and validation
 */

import { loggingService } from '../../services/logging.service';
import { IntegrationType } from '../types/permission.types';

export class TokenManager {
  /**
   * Check if token needs refresh
   */
  static async needsRefresh(connectionId: string, integration: IntegrationType): Promise<boolean> {
    try {
      let expiresAt: Date | undefined;

      switch (integration) {
        case 'vercel': {
          const { VercelConnection } = await import('../../models/VercelConnection');
          const conn = await VercelConnection.findById(connectionId).select('expiresAt').lean();
          expiresAt = conn?.expiresAt;
          break;
        }
        case 'github': {
          const { GitHubConnection } = await import('../../models/GitHubConnection');
          const conn = await GitHubConnection.findById(connectionId).select('expiresAt').lean();
          expiresAt = conn?.expiresAt;
          break;
        }
        case 'google': {
          const { GoogleConnection } = await import('../../models/GoogleConnection');
          const conn = await GoogleConnection.findById(connectionId).select('expiresAt').lean();
          expiresAt = conn?.expiresAt;
          break;
        }
        case 'jira':
        case 'linear':
        case 'slack':
        case 'discord': {
          // These use the generic Integration model
          const { Integration } = await import('../../models/Integration');
          const conn = await Integration.findById(connectionId).select('metadata').lean();
          // Check if tokenExpiresAt is in metadata
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
        loggingService.warn('No token expiry date found, assuming refresh needed', {
          connectionId,
          integration,
        });
        return true;
      }

      // Refresh if expires in next 5 minutes
      const now = new Date();
      const timeUntilExpiry = expiresAt.getTime() - now.getTime();
      const needsRefresh = timeUntilExpiry < 5 * 60 * 1000;
      
      loggingService.debug('Token expiry check', {
        connectionId,
        integration,
        expiresAt,
        timeUntilExpiry,
        needsRefresh,
      });
      
      return needsRefresh;
    } catch (error) {
      loggingService.error('Failed to check token expiry', {
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
  static async refreshIfNeeded(connectionId: string, integration: IntegrationType): Promise<boolean> {
    const needsRefresh = await this.needsRefresh(connectionId, integration);
    if (!needsRefresh) {
      loggingService.debug('Token does not need refresh', {
        connectionId,
        integration,
      });
      return true;
    }

    loggingService.info('Token refresh needed', {
      connectionId,
      integration,
    });

    // Use existing refresh logic from MCPIntegrationHandler or service-specific logic
    try {
      let refreshed = false;
      
      switch (integration) {
        case 'github': {
          const { GitHubConnection } = await import('../../models/GitHubConnection');
          const connection = await GitHubConnection.findById(connectionId).select('+accessToken +refreshToken');
          
          if (!connection) {
            loggingService.error('GitHub connection not found for token refresh', { connectionId });
            return false;
          }
          
          const { GitHubService } = await import('../../services/github.service');
          const newAccessToken = await GitHubService.refreshAccessToken(connection as any);
          refreshed = !!newAccessToken;
          break;
        }
        
        case 'google': {
          const { GoogleConnection } = await import('../../models/GoogleConnection');
          const connection = await GoogleConnection.findById(connectionId).select('+accessToken +refreshToken expiresAt');
          
          if (!connection) {
            loggingService.error('Google connection not found for token refresh', { connectionId });
            return false;
          }
          
          // Actually refresh the Google token using GoogleService
          try {
            const { google } = await import('googleapis');
            const clientId = process.env.GOOGLE_CLIENT_ID;
            const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
            const redirectUri = process.env.GOOGLE_CALLBACK_URL || `${process.env.BACKEND_URL || 'http://localhost:8000'}/api/auth/oauth/google/callback`;
            
            if (!clientId || !clientSecret) {
              loggingService.error('Google OAuth credentials not configured');
              return false;
            }
            
            const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
            
            const refreshToken = connection.decryptRefreshToken?.();
            if (!refreshToken) {
              loggingService.warn('No refresh token available for Google connection', { connectionId });
              return false;
            }
            
            oauth2Client.setCredentials({
              refresh_token: refreshToken,
            });
            
            // Refresh the token
            const { credentials } = await oauth2Client.refreshAccessToken();
            
            if (credentials.access_token) {
              connection.accessToken = connection.encryptToken(credentials.access_token);
              if (credentials.refresh_token) {
                connection.refreshToken = connection.encryptToken(credentials.refresh_token);
              }
              if (credentials.expiry_date) {
                connection.expiresAt = new Date(credentials.expiry_date);
              }
              connection.healthStatus = 'healthy';
              await connection.save();
              
              loggingService.info('Google token refreshed successfully', { connectionId });
              refreshed = true;
            } else {
              loggingService.warn('Google token refresh did not return access token', { connectionId });
              refreshed = false;
            }
          } catch (error) {
            loggingService.error('Google token refresh failed', {
              connectionId,
              error: error instanceof Error ? error.message : String(error),
            });
            connection.healthStatus = 'needs_reconnect';
            await connection.save();
            refreshed = false;
          }
          
          break;
        }
        
        case 'jira':
        case 'linear':
        case 'slack':
        case 'discord': {
          // These use the generic Integration model
          const { Integration } = await import('../../models/Integration');
          const integration_doc = await Integration.findById(connectionId);
          
          if (!integration_doc) {
            loggingService.error('Integration connection not found for token refresh', {
              connectionId,
              integration,
            });
            return false;
          }
          
          const { MCPIntegrationHandler } = await import('../../services/mcpIntegrationHandler.service');
          refreshed = await MCPIntegrationHandler.refreshTokenIfNeeded(integration_doc);
          break;
        }
        
        default:
          loggingService.warn('Token refresh not supported for integration', { integration });
          return false;
      }
      
      if (refreshed) {
        loggingService.info('Token refreshed successfully', {
          connectionId,
          integration,
        });
      } else {
        loggingService.warn('Token refresh returned false', {
          connectionId,
          integration,
        });
      }

      return refreshed;
    } catch (error) {
      loggingService.error('Failed to refresh token', {
        error: error instanceof Error ? error.message : String(error),
        connectionId,
        integration,
      });
      return false;
    }
  }
}
