/**
 * MCP Authentication Layer
 * Validates userId from JWT and manages user context
 */

import { loggingService } from '../../services/logging.service';
import { User } from '../../models';
import { IntegrationType } from '../types/permission.types';

export interface MCPAuthContext {
  userId: string;
  user: any;
  isAdmin: boolean;
  integrations: IntegrationType[];
}

export class MCPAuthService {
  /**
   * Authenticate userId and return user context
   * @param userId - User ID from JWT token authentication
   */
  static async authenticate(userId: string): Promise<MCPAuthContext | null> {
    if (!userId) {
      loggingService.warn('MCP authentication failed: no userId provided');
      return null;
    }

    try {
      loggingService.debug('MCP auth: Finding user', { userId });
      
      // Find user by ID
      const user = await User.findById(userId).lean();
      
      if (!user) {
        loggingService.warn('MCP authentication failed: user not found', {
          userId,
        });
        return null;
      }

      loggingService.debug('MCP auth: User found, checking active status', { userId, isActive: user.isActive });

      // Check if user is active
      if (!user.isActive) {
        loggingService.warn('MCP authentication failed: user inactive', {
          userId,
        });
        return null;
      }

      loggingService.debug('MCP auth: Getting user integrations', { userId });

      // Get user's connected integrations
      const integrations = await this.getUserIntegrations(userId);

      loggingService.debug('MCP auth: Integrations retrieved', { 
        userId, 
        integrations,
        integrationCount: integrations.length 
      });

      const context: MCPAuthContext = {
        userId,
        user,
        isAdmin: user.role === 'admin',
        integrations,
      };

      loggingService.info('MCP authentication successful', {
        userId: context.userId,
        isAdmin: context.isAdmin,
        integrationCount: integrations.length,
        integrations: integrations,
      });

      return context;
    } catch (error) {
      loggingService.error('MCP authentication error', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        userId,
      });
      return null;
    }
  }

  /**
   * Get user's connected integrations
   */
  private static async getUserIntegrations(userId: string): Promise<IntegrationType[]> {
    const integrations: IntegrationType[] = [];

    try {
      // Check connection models
      const [vercelConn, githubConn, googleConn, mongodbConn] = await Promise.all([
        import('../../models/VercelConnection'),
        import('../../models/GitHubConnection'),
        import('../../models/GoogleConnection'),
        import('../../models/MongoDBConnection'),
      ]);

      // Check each integration
      const checks = await Promise.all([
        vercelConn.VercelConnection.exists({ userId, isActive: true }),
        githubConn.GitHubConnection.exists({ userId, isActive: true }),
        googleConn.GoogleConnection.exists({ userId, isActive: true }),
        mongodbConn.MongoDBConnection.exists({ userId, isActive: true }),
      ]);

      if (checks[0]) integrations.push('vercel');
      if (checks[1]) integrations.push('github');
      if (checks[2]) integrations.push('google');
      if (checks[3]) integrations.push('mongodb');

      // Check standard Integration model for others
      const { Integration } = await import('../../models/Integration');
      const standardIntegrations = await Integration.find({
        userId,
        status: 'active',
      }).lean();

      for (const integration of standardIntegrations) {
        if (integration.type.includes('slack')) integrations.push('slack');
        if (integration.type.includes('discord')) integrations.push('discord');
        if (integration.type.includes('jira')) integrations.push('jira');
        if (integration.type.includes('linear')) integrations.push('linear');
      }

      // Remove duplicates
      return Array.from(new Set(integrations));
    } catch (error) {
      loggingService.error('Failed to get user integrations', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      return [];
    }
  }

  /**
   * Validate user has access to specific integration
   */
  static async validateIntegrationAccess(
    userId: string,
    integration: IntegrationType
  ): Promise<boolean> {
    try {
      switch (integration) {
        case 'vercel': {
          const { VercelConnection } = await import('../../models/VercelConnection');
          return await VercelConnection.exists({ userId, isActive: true }) !== null;
        }
        case 'github': {
          const { GitHubConnection } = await import('../../models/GitHubConnection');
          return await GitHubConnection.exists({ userId, isActive: true }) !== null;
        }
        case 'google': {
          const { GoogleConnection } = await import('../../models/GoogleConnection');
          return await GoogleConnection.exists({ userId, isActive: true }) !== null;
        }
        case 'mongodb': {
          const { MongoDBConnection } = await import('../../models/MongoDBConnection');
          return await MongoDBConnection.exists({ userId, isActive: true }) !== null;
        }
        default: {
          const { Integration } = await import('../../models/Integration');
          const typePattern = new RegExp(integration, 'i');
          return await Integration.exists({
            userId,
            status: 'active',
            type: typePattern,
          }) !== null;
        }
      }
    } catch (error) {
      loggingService.error('Failed to validate integration access', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        integration,
      });
      return false;
    }
  }

  /**
   * Get connection ID for user's integration
   */
  static async getConnectionId(
    userId: string,
    integration: IntegrationType
  ): Promise<string | null> {
    try {
      switch (integration) {
        case 'vercel': {
          const { VercelConnection } = await import('../../models/VercelConnection');
          const conn = await VercelConnection.findOne({ userId, isActive: true })
            .select('_id')
            .lean();
          return conn?._id.toString() || null;
        }
        case 'github': {
          const { GitHubConnection } = await import('../../models/GitHubConnection');
          const conn = await GitHubConnection.findOne({ userId, isActive: true })
            .select('_id')
            .lean();
          return conn?._id.toString() || null;
        }
        case 'google': {
          const { GoogleConnection } = await import('../../models/GoogleConnection');
          const conn = await GoogleConnection.findOne({ userId, isActive: true })
            .select('_id')
            .lean();
          return conn?._id.toString() || null;
        }
        case 'mongodb': {
          const { MongoDBConnection } = await import('../../models/MongoDBConnection');
          const conn = await MongoDBConnection.findOne({ userId, isActive: true })
            .select('_id')
            .lean();
          return conn?._id.toString() || null;
        }
        default: {
          const { Integration } = await import('../../models/Integration');
          const typePattern = new RegExp(integration, 'i');
          const conn = await Integration.findOne({
            userId,
            status: 'active',
            type: typePattern,
          })
            .select('_id')
            .lean();
          return conn?._id.toString() || null;
        }
      }
    } catch (error) {
      loggingService.error('Failed to get connection ID', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        integration,
      });
      return null;
    }
  }
}
