/**
 * Connection Checker
 * Verifies user's integration connections
 */

import { Types } from 'mongoose';
import { IntegrationType } from '@mcp/types/permission.types';
import { ConnectionStatus } from './types/routing.types';
import { loggingService } from '@services/logging.service';

export class ConnectionChecker {
    /**
     * Check if user has connected a specific integration
     */
    static async check(
        userId: string,
        integration: IntegrationType
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
            loggingService.error('Failed to check integration connection', {
                userId,
                integration,
                error: error instanceof Error ? error.message : String(error)
            });
            return { isConnected: false };
        }
    }

    /**
     * Check multiple integrations at once
     */
    static async checkMultiple(
        userId: string,
        integrations: IntegrationType[]
    ): Promise<Map<IntegrationType, ConnectionStatus>> {
        const results = new Map<IntegrationType, ConnectionStatus>();
        
        await Promise.all(
            integrations.map(async (integration) => {
                const status = await this.check(userId, integration);
                results.set(integration, status);
            })
        );
        
        return results;
    }

    private static async checkVercel(userId: string): Promise<ConnectionStatus> {
        const { VercelConnection } = await import('../../../models/VercelConnection');
        const connection = await VercelConnection.findOne({
            userId: new Types.ObjectId(userId),
            isActive: true,
        }).lean();
        
        return {
            isConnected: !!connection,
            connectionId: connection?._id?.toString(),
            connectionName: connection?.teamSlug || connection?.vercelUsername || 'Vercel'
        };
    }

    private static async checkGitHub(userId: string): Promise<ConnectionStatus> {
        const { GitHubConnection } = await import('../../../models/GitHubConnection');
        const connection = await GitHubConnection.findOne({
            userId: new Types.ObjectId(userId),
            isActive: true,
        }).lean();
        
        return {
            isConnected: !!connection,
            connectionId: connection?._id?.toString(),
            connectionName: connection?.githubUsername || 'GitHub'
        };
    }

    private static async checkGoogle(userId: string): Promise<ConnectionStatus> {
        const { GoogleConnection } = await import('../../../models/GoogleConnection');
        const connection = await GoogleConnection.findOne({
            userId: new Types.ObjectId(userId),
            isActive: true,
        }).lean();
        
        return {
            isConnected: !!connection,
            connectionId: connection?._id?.toString(),
            connectionName: connection?.googleEmail || 'Google'
        };
    }

    private static async checkMongoDB(userId: string): Promise<ConnectionStatus> {
        const { MongoDBConnection } = await import('../../../models/MongoDBConnection');
        const connection = await MongoDBConnection.findOne({
            userId: new Types.ObjectId(userId),
            isActive: true,
        }).lean();
        
        return {
            isConnected: !!connection,
            connectionId: connection?._id?.toString(),
            connectionName: connection?.alias || 'MongoDB'
        };
    }

    private static async checkSlack(userId: string): Promise<ConnectionStatus> {
        const { Integration } = await import('../../../models/Integration');
        const connection = await Integration.findOne({
            userId: new Types.ObjectId(userId),
            type: { $in: ['slack_webhook', 'slack_oauth'] },
            status: 'active',
        }).lean();
        
        return {
            isConnected: !!connection,
            connectionId: connection?._id?.toString(),
            connectionName: connection?.name || 'Slack'
        };
    }

    private static async checkDiscord(userId: string): Promise<ConnectionStatus> {
        const { Integration } = await import('../../../models/Integration');
        const connection = await Integration.findOne({
            userId: new Types.ObjectId(userId),
            type: { $in: ['discord_webhook', 'discord_oauth'] },
            status: 'active',
        }).lean();
        
        return {
            isConnected: !!connection,
            connectionId: connection?._id?.toString(),
            connectionName: connection?.name || 'Discord'
        };
    }

    private static async checkJira(userId: string): Promise<ConnectionStatus> {
        const { Integration } = await import('../../../models/Integration');
        const connection = await Integration.findOne({
            userId: new Types.ObjectId(userId),
            type: 'jira_oauth',
            status: 'active',
        }).lean();
        
        return {
            isConnected: !!connection,
            connectionId: connection?._id?.toString(),
            connectionName: connection?.name || 'Jira'
        };
    }

    private static async checkLinear(userId: string): Promise<ConnectionStatus> {
        const { Integration } = await import('../../../models/Integration');
        const connection = await Integration.findOne({
            userId: new Types.ObjectId(userId),
            type: 'linear_oauth',
            status: 'active',
        }).lean();
        
        return {
            isConnected: !!connection,
            connectionId: connection?._id?.toString(),
            connectionName: connection?.name || 'Linear'
        };
    }

    private static async checkAWS(userId: string): Promise<ConnectionStatus> {
        const { AWSConnection } = await import('../../../models/AWSConnection');
        const connection = await AWSConnection.findOne({
            userId: new Types.ObjectId(userId),
        }).lean();
        
        return {
            isConnected: !!connection,
            connectionId: connection?._id?.toString(),
            connectionName: connection?.connectionName || connection?.awsAccountId || 'AWS'
        };
    }
}
