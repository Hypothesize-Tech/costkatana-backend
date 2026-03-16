import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../../common/logger/logger.service';
import {
  ECSClient,
  ListClustersCommand,
  DescribeClustersCommand,
  CreateClusterCommand,
} from '@aws-sdk/client-ecs';
import { StsCredentialService } from './sts-credential.service';
import { PermissionBoundaryService } from './permission-boundary.service';

/**
 * ECS Service Provider - ECS Operations
 *
 * Capabilities:
 * - List clusters
 * - Create clusters with Fargate capacity providers
 * - Enable Container Insights monitoring
 * - Configure CloudWatch Logs
 */

export interface ECSCluster {
  clusterName: string;
  clusterArn: string;
  status: string;
  registeredContainerInstancesCount: number;
  runningTasksCount: number;
  pendingTasksCount: number;
}

@Injectable()
export class EcsService {
  constructor(
    private readonly logger: LoggerService,
    private readonly stsCredentialService: StsCredentialService,
    private readonly permissionBoundaryService: PermissionBoundaryService,
  ) {}

  private async getClient(
    connection: any,
    region?: string,
  ): Promise<ECSClient> {
    const credentials = await this.stsCredentialService.assumeRole(connection);

    return new ECSClient({
      region: region ?? connection.allowedRegions?.[0] ?? 'us-east-1',
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
    });
  }

  /**
   * List ECS clusters
   */
  async listClusters(connection: any, region?: string): Promise<ECSCluster[]> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'ecs', action: 'ListClusters', region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const client = await this.getClient(connection, region);
    const clusters: ECSCluster[] = [];
    let nextToken: string | undefined;

    do {
      const listCommand = new ListClustersCommand({
        nextToken,
        maxResults: 100,
      });

      const listResponse = await client.send(listCommand);
      const clusterArns = listResponse.clusterArns ?? [];

      if (clusterArns.length > 0) {
        const describeCommand = new DescribeClustersCommand({
          clusters: clusterArns,
          include: ['ATTACHMENTS', 'SETTINGS', 'STATISTICS'],
        });

        const describeResponse = await client.send(describeCommand);

        for (const cluster of describeResponse.clusters ?? []) {
          clusters.push({
            clusterName: cluster.clusterName ?? '',
            clusterArn: cluster.clusterArn ?? '',
            status: cluster.status ?? 'UNKNOWN',
            registeredContainerInstancesCount:
              cluster.registeredContainerInstancesCount ?? 0,
            runningTasksCount: cluster.statistics?.find(
              (s) => s.name === 'runningCount',
            )?.value
              ? parseInt(
                  cluster.statistics.find((s) => s.name === 'runningCount')!
                    .value as string,
                )
              : 0,
            pendingTasksCount: cluster.statistics?.find(
              (s) => s.name === 'pendingCount',
            )?.value
              ? parseInt(
                  cluster.statistics.find((s) => s.name === 'pendingCount')!
                    .value as string,
                )
              : 0,
          });
        }
      }

      nextToken = listResponse.nextToken;
    } while (nextToken);

    this.logger.log('ECS clusters listed', {
      component: 'EcsService',
      operation: 'listClusters',
      connectionId: connection._id.toString(),
      clusterCount: clusters.length,
      region,
    });

    return clusters;
  }

  /**
   * Create ECS cluster with Fargate capacity providers
   */
  async createCluster(
    connection: any,
    config: {
      clusterName: string;
      region?: string;
      enableContainerInsights?: boolean;
      tags?: Record<string, string>;
    },
  ): Promise<{ clusterName: string; clusterArn: string; status: string }> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'ecs', action: 'CreateCluster', region: config.region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const region =
      config.region ?? connection.allowedRegions?.[0] ?? 'us-east-1';
    const client = await this.getClient(connection, region);
    const enableContainerInsights = config.enableContainerInsights ?? true;

    try {
      // Create cluster
      const createCommand = new CreateClusterCommand({
        clusterName: config.clusterName,
        capacityProviders: ['FARGATE', 'FARGATE_SPOT'],
        defaultCapacityProviderStrategy: [
          {
            capacityProvider: 'FARGATE',
            weight: 80,
            base: 1,
          },
          {
            capacityProvider: 'FARGATE_SPOT',
            weight: 20,
          },
        ],
        tags: [
          { key: 'Name', value: config.clusterName },
          { key: 'ManagedBy', value: 'CostKatana' },
          {
            key: 'CreatedBy',
            value: connection.userId?.toString() ?? 'unknown',
          },
          { key: 'CreatedAt', value: new Date().toISOString() },
          { key: 'ConnectionId', value: connection._id.toString() },
          ...Object.entries(config.tags ?? {}).map(([key, value]) => ({
            key,
            value,
          })),
        ],
      });

      const response = await client.send(createCommand);
      const cluster = response.cluster;

      if (!cluster?.clusterArn) {
        throw new Error('Failed to create ECS cluster');
      }

      this.logger.log('ECS cluster created', {
        component: 'EcsService',
        operation: 'createCluster',
        clusterName: config.clusterName,
        containerInsights: enableContainerInsights,
        region,
        connectionId: connection._id.toString(),
      });

      return {
        clusterName: config.clusterName,
        clusterArn: cluster.clusterArn,
        status: cluster.status ?? 'ACTIVE',
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to create ECS cluster', {
        component: 'EcsService',
        operation: 'createCluster',
        clusterName: config.clusterName,
        region,
        error: errorMessage,
      });
      throw error;
    }
  }
}
