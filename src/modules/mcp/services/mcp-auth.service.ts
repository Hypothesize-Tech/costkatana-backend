/**
 * MCP Authentication Service
 * Handles user authentication and integration access validation for MCP operations
 */

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoggerService } from '@/common/logger/logger.service';
import { MCPAuthContext, IntegrationType } from '../types/mcp.types';
import { User } from '@/schemas/user/user.schema';
import { VercelConnection } from '@/schemas/integration/vercel-connection.schema';
import { GitHubConnection } from '@/schemas/integration/github-connection.schema';
import { GoogleConnection } from '@/schemas/integration/google-connection.schema';
import { MongoDBConnection } from '@/schemas/integration/mongodb-connection.schema';
import { Integration } from '@/schemas/integration/integration.schema';
import { AWSConnection } from '@/schemas/integration/aws-connection.schema';

@Injectable()
export class McpAuthService {
  constructor(
    private logger: LoggerService,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(VercelConnection.name)
    private vercelConnectionModel: Model<VercelConnection>,
    @InjectModel(GitHubConnection.name)
    private githubConnectionModel: Model<GitHubConnection>,
    @InjectModel(GoogleConnection.name)
    private googleConnectionModel: Model<GoogleConnection>,
    @InjectModel(MongoDBConnection.name)
    private mongodbConnectionModel: Model<MongoDBConnection>,
    @InjectModel(AWSConnection.name)
    private awsConnectionModel: Model<AWSConnection>,
    @InjectModel(Integration.name) private integrationModel: Model<Integration>,
  ) {}

  /**
   * Authenticate userId and return user context for MCP operations
   */
  async authenticate(userId: string): Promise<MCPAuthContext | null> {
    if (!userId) {
      this.logger.warn('MCP authentication failed: no userId provided');
      return null;
    }

    try {
      this.logger.debug('MCP auth: Finding user', { userId });

      // Find user by ID
      const user = await this.userModel.findById(userId).lean();

      if (!user) {
        this.logger.warn('MCP authentication failed: user not found', {
          userId,
        });
        return null;
      }

      this.logger.debug('MCP auth: User found, checking active status', {
        userId,
        isActive: user.isActive,
      });

      // Check if user is active
      if (!user.isActive) {
        this.logger.warn('MCP authentication failed: user inactive', {
          userId,
        });
        return null;
      }

      this.logger.debug('MCP auth: Getting user integrations', { userId });

      // Get user's connected integrations
      const integrations = await this.getUserIntegrations(userId);

      this.logger.debug('MCP auth: Integrations retrieved', {
        userId,
        integrations,
        integrationCount: integrations.length,
      });

      const context: MCPAuthContext = {
        userId,
        user,
        isAdmin: user.role === 'admin',
        integrations,
      };

      this.logger.log('MCP authentication successful', {
        userId: context.userId,
        isAdmin: context.isAdmin,
        integrationCount: integrations.length,
        integrations: integrations,
      });

      return context;
    } catch (error) {
      this.logger.error('MCP authentication error', {
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
  private async getUserIntegrations(
    userId: string,
  ): Promise<IntegrationType[]> {
    const integrations: IntegrationType[] = [];

    try {
      // Check connection models for standard integrations (matches Express backend)
      const checks = await Promise.all([
        this.vercelConnectionModel.exists({ userId, isActive: true }),
        this.githubConnectionModel.exists({ userId, isActive: true }),
        this.googleConnectionModel.exists({ userId, isActive: true }),
        this.mongodbConnectionModel.exists({ userId, isActive: true }),
        this.awsConnectionModel.exists({ userId, status: 'active' }),
      ]);

      if (checks[0]) integrations.push('vercel');
      if (checks[1]) integrations.push('github');
      if (checks[2]) integrations.push('google');
      if (checks[3]) integrations.push('mongodb');
      if (checks[4]) integrations.push('aws');

      // Check standard Integration model for other integrations (Slack, Discord, Jira, Linear)
      const standardIntegrations = await this.integrationModel
        .find({
          userId,
          status: 'active',
        })
        .lean();

      for (const integration of standardIntegrations) {
        if (integration.type?.includes('slack')) integrations.push('slack');
        if (integration.type?.includes('discord')) integrations.push('discord');
        if (integration.type?.includes('jira')) integrations.push('jira');
        if (integration.type?.includes('linear')) integrations.push('linear');
      }

      // Remove duplicates
      return Array.from(new Set(integrations));
    } catch (error) {
      this.logger.error('Failed to get user integrations', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      return [];
    }
  }

  /**
   * Validate user has access to specific integration
   */
  async validateIntegrationAccess(
    userId: string,
    integration: IntegrationType,
  ): Promise<boolean> {
    try {
      switch (integration) {
        case 'vercel': {
          return (
            (await this.vercelConnectionModel.exists({
              userId,
              isActive: true,
            })) !== null
          );
        }
        case 'github': {
          return (
            (await this.githubConnectionModel.exists({
              userId,
              isActive: true,
            })) !== null
          );
        }
        case 'google': {
          return (
            (await this.googleConnectionModel.exists({
              userId,
              isActive: true,
            })) !== null
          );
        }
        case 'mongodb': {
          return (
            (await this.mongodbConnectionModel.exists({
              userId,
              isActive: true,
            })) !== null
          );
        }
        case 'aws': {
          return (
            (await this.awsConnectionModel.exists({
              userId,
              status: 'active',
            })) !== null
          );
        }
        default: {
          // For generic integrations (Slack, Discord, Jira, Linear, AWS)
          const typePattern = new RegExp(integration, 'i');
          return (
            (await this.integrationModel.exists({
              userId,
              status: 'active',
              type: typePattern,
            })) !== null
          );
        }
      }
    } catch (error) {
      this.logger.error('Failed to validate integration access', {
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
  async getConnectionId(
    userId: string,
    integration: IntegrationType,
  ): Promise<string | null> {
    try {
      switch (integration) {
        case 'vercel': {
          const conn = await this.vercelConnectionModel
            .findOne({ userId, isActive: true })
            .select('_id')
            .lean();
          return conn?._id.toString() || null;
        }
        case 'github': {
          const conn = await this.githubConnectionModel
            .findOne({ userId, isActive: true })
            .select('_id')
            .lean();
          return conn?._id.toString() || null;
        }
        case 'google': {
          const conn = await this.googleConnectionModel
            .findOne({ userId, isActive: true })
            .select('_id')
            .lean();
          return conn?._id.toString() || null;
        }
        case 'mongodb': {
          const conn = await this.mongodbConnectionModel
            .findOne({ userId, isActive: true })
            .select('_id')
            .lean();
          return conn?._id.toString() || null;
        }
        case 'aws': {
          // Dedicated AWSConnection collection (matches Express backend: mcp-client.service getConnectionId)
          const conn = await this.awsConnectionModel
            .findOne({ userId, status: 'active' })
            .select('_id')
            .lean();
          return conn?._id.toString() || null;
        }
        default: {
          // For generic integrations
          const typePattern = new RegExp(integration, 'i');
          const conn = await this.integrationModel
            .findOne({
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
      this.logger.error('Failed to get connection ID', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        integration,
      });
      return null;
    }
  }
}
