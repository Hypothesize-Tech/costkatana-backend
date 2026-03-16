/**
 * Connection Checker
 * Verifies user's integration connections
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Types } from 'mongoose';

export interface ConnectionStatus {
  isConnected: boolean;
  connectionId?: string;
  connectionName?: string;
}

export type IntegrationType =
  | 'vercel'
  | 'github'
  | 'google'
  | 'mongodb'
  | 'slack'
  | 'discord'
  | 'jira'
  | 'linear'
  | 'aws';

@Injectable()
export class ConnectionChecker {
  private readonly logger = new Logger(ConnectionChecker.name);

  constructor(
    @InjectModel('VercelConnection')
    private readonly vercelConnectionModel: Model<any>,
    @InjectModel('GitHubConnection')
    private readonly githubConnectionModel: Model<any>,
    @InjectModel('GoogleConnection')
    private readonly googleConnectionModel: Model<any>,
    @InjectModel('MongoDBConnection')
    private readonly mongodbConnectionModel: Model<any>,
    @InjectModel('Integration')
    private readonly integrationModel: Model<any>,
    @InjectModel('AWSConnection')
    private readonly awsConnectionModel: Model<any>,
  ) {}

  /**
   * Check if user has connected a specific integration
   */
  async check(
    userId: string,
    integration: IntegrationType,
  ): Promise<ConnectionStatus> {
    try {
      switch (integration) {
        case 'vercel':
          return await this.checkVercel(userId);
        case 'github':
          return await this.checkGitHub(userId);
        case 'google':
          return await this.checkGoogle(userId);
        case 'mongodb':
          return await this.checkMongoDB(userId);
        case 'slack':
          return await this.checkSlack(userId);
        case 'discord':
          return await this.checkDiscord(userId);
        case 'jira':
          return await this.checkJira(userId);
        case 'linear':
          return await this.checkLinear(userId);
        case 'aws':
          return await this.checkAWS(userId);
        default:
          return { isConnected: false };
      }
    } catch (error) {
      this.logger.error('Failed to check integration connection', {
        userId,
        integration,
        error: error instanceof Error ? error.message : String(error),
      });
      return { isConnected: false };
    }
  }

  /**
   * Check multiple integrations at once
   */
  async checkMultiple(
    userId: string,
    integrations: IntegrationType[],
  ): Promise<Map<IntegrationType, ConnectionStatus>> {
    const results = new Map<IntegrationType, ConnectionStatus>();

    await Promise.all(
      integrations.map(async (integration) => {
        const status = await this.check(userId, integration);
        results.set(integration, status);
      }),
    );

    return results;
  }

  private async checkVercel(userId: string): Promise<ConnectionStatus> {
    const connection = (await this.vercelConnectionModel
      .findOne({
        userId: new Types.ObjectId(userId),
        isActive: true,
      })
      .lean()) as {
      _id?: Types.ObjectId;
      teamSlug?: string;
      vercelUsername?: string;
    } | null;

    return {
      isConnected: !!connection,
      connectionId: connection?._id?.toString(),
      connectionName:
        connection?.teamSlug || connection?.vercelUsername || 'Vercel',
    };
  }

  private async checkGitHub(userId: string): Promise<ConnectionStatus> {
    const connection = (await this.githubConnectionModel
      .findOne({
        userId: new Types.ObjectId(userId),
        isActive: true,
      })
      .lean()) as { _id?: Types.ObjectId; githubUsername?: string } | null;

    return {
      isConnected: !!connection,
      connectionId: connection?._id?.toString(),
      connectionName: connection?.githubUsername || 'GitHub',
    };
  }

  private async checkGoogle(userId: string): Promise<ConnectionStatus> {
    const connection = (await this.googleConnectionModel
      .findOne({
        userId: new Types.ObjectId(userId),
        isActive: true,
      })
      .lean()) as { _id?: Types.ObjectId; googleEmail?: string } | null;

    return {
      isConnected: !!connection,
      connectionId: connection?._id?.toString(),
      connectionName: connection?.googleEmail || 'Google',
    };
  }

  private async checkMongoDB(userId: string): Promise<ConnectionStatus> {
    const connection = (await this.mongodbConnectionModel
      .findOne({
        userId: new Types.ObjectId(userId),
        isActive: true,
      })
      .lean()) as { _id?: Types.ObjectId; alias?: string } | null;

    return {
      isConnected: !!connection,
      connectionId: connection?._id?.toString(),
      connectionName: connection?.alias || 'MongoDB',
    };
  }

  private async checkSlack(userId: string): Promise<ConnectionStatus> {
    const connection = (await this.integrationModel
      .findOne({
        userId: new Types.ObjectId(userId),
        type: { $in: ['slack_webhook', 'slack_oauth'] },
        status: 'active',
      })
      .lean()) as { _id?: Types.ObjectId; name?: string } | null;

    return {
      isConnected: !!connection,
      connectionId: connection?._id?.toString(),
      connectionName: connection?.name || 'Slack',
    };
  }

  private async checkDiscord(userId: string): Promise<ConnectionStatus> {
    const connection = (await this.integrationModel
      .findOne({
        userId: new Types.ObjectId(userId),
        type: { $in: ['discord_webhook', 'discord_oauth'] },
        status: 'active',
      })
      .lean()) as { _id?: Types.ObjectId; name?: string } | null;

    return {
      isConnected: !!connection,
      connectionId: connection?._id?.toString(),
      connectionName: connection?.name || 'Discord',
    };
  }

  private async checkJira(userId: string): Promise<ConnectionStatus> {
    const connection = (await this.integrationModel
      .findOne({
        userId: new Types.ObjectId(userId),
        type: 'jira_oauth',
        status: 'active',
      })
      .lean()) as { _id?: Types.ObjectId; name?: string } | null;

    return {
      isConnected: !!connection,
      connectionId: connection?._id?.toString(),
      connectionName: connection?.name || 'Jira',
    };
  }

  private async checkLinear(userId: string): Promise<ConnectionStatus> {
    const connection = (await this.integrationModel
      .findOne({
        userId: new Types.ObjectId(userId),
        type: 'linear_oauth',
        status: 'active',
      })
      .lean()) as { _id?: Types.ObjectId; name?: string } | null;

    return {
      isConnected: !!connection,
      connectionId: connection?._id?.toString(),
      connectionName: connection?.name || 'Linear',
    };
  }

  private async checkAWS(userId: string): Promise<ConnectionStatus> {
    const connection = (await this.awsConnectionModel
      .findOne({
        userId: new Types.ObjectId(userId),
      })
      .lean()) as {
      _id?: Types.ObjectId;
      connectionName?: string;
      awsAccountId?: string;
    } | null;

    return {
      isConnected: !!connection,
      connectionId: connection?._id?.toString(),
      connectionName:
        connection?.connectionName || connection?.awsAccountId || 'AWS',
    };
  }
}
