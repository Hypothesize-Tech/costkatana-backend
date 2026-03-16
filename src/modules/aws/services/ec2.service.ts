import { Injectable } from '@nestjs/common';
import {
  EC2Client,
  DescribeInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  RunInstancesCommand,
  RebootInstancesCommand,
  DescribeVolumesCommand,
  DescribeSecurityGroupsCommand,
  DescribeImagesCommand,
} from '@aws-sdk/client-ec2';
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from '@aws-sdk/client-cloudwatch';
import { LoggerService } from '../../../common/logger/logger.service';
import { StsCredentialService } from './sts-credential.service';
import { PermissionBoundaryService } from './permission-boundary.service';
import { AwsPricingService } from './aws-pricing.service';
import { AWSConnectionDocument } from '@/schemas/integration/aws-connection.schema';

export interface EC2Instance {
  instanceId: string;
  instanceType: string;
  state: string;
  stateCode: number;
  publicIpAddress?: string;
  privateIpAddress?: string;
  launchTime?: Date;
  availabilityZone: string;
  tags: Array<{ key: string; value: string }>;
  cpuUtilization?: number;
  networkIn?: number;
  networkOut?: number;
}

@Injectable()
export class Ec2Service {
  constructor(
    private readonly stsCredentialService: StsCredentialService,
    private readonly permissionBoundaryService: PermissionBoundaryService,
    private readonly awsPricingService: AwsPricingService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Get EC2 client for a connection
   */
  private async getClient(
    connection: AWSConnectionDocument,
    region?: string,
  ): Promise<{
    ec2Client: EC2Client;
    cloudWatchClient: CloudWatchClient;
  }> {
    const credentials = await this.stsCredentialService.assumeRole(connection);

    const targetRegion =
      region || connection.allowedRegions?.[0] || 'us-east-1';

    const ec2Client = new EC2Client({
      region: targetRegion,
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
    });

    const cloudWatchClient = new CloudWatchClient({
      region: targetRegion,
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
    });

    return { ec2Client, cloudWatchClient };
  }

  /**
   * List EC2 instances
   */
  async listInstances(
    connection: AWSConnectionDocument,
    filters?: Array<{ Name: string; Values: string[] }>,
    region?: string,
  ): Promise<EC2Instance[]> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'ec2', action: 'DescribeInstances', region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const { ec2Client } = await this.getClient(connection, region);

    const command = new DescribeInstancesCommand({
      Filters: filters,
      MaxResults: 100,
    });

    const response = await ec2Client.send(command);

    const instances: EC2Instance[] = [];

    for (const reservation of response.Reservations || []) {
      for (const instance of reservation.Instances || []) {
        instances.push({
          instanceId: instance.InstanceId || '',
          instanceType: instance.InstanceType || '',
          state: instance.State?.Name || '',
          stateCode: instance.State?.Code || 0,
          publicIpAddress: instance.PublicIpAddress,
          privateIpAddress: instance.PrivateIpAddress,
          launchTime: instance.LaunchTime,
          availabilityZone: instance.Placement?.AvailabilityZone || '',
          tags: (instance.Tags || []).map((tag) => ({
            key: tag.Key || '',
            value: tag.Value || '',
          })),
        });
      }
    }

    this.logger.log('EC2 instances listed', {
      connectionId: connection._id.toString(),
      region: region || 'default',
      instanceCount: instances.length,
    });

    return instances;
  }

  /**
   * Start EC2 instances
   */
  async startInstances(
    connection: AWSConnectionDocument,
    instanceIds: string[],
    region?: string,
  ): Promise<
    Array<{ instanceId: string; currentState: string; previousState: string }>
  > {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'ec2', action: 'StartInstances', region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const { ec2Client } = await this.getClient(connection, region);

    const command = new StartInstancesCommand({
      InstanceIds: instanceIds,
    });

    const response = await ec2Client.send(command);

    const results = (response.StartingInstances || []).map((instance) => ({
      instanceId: instance.InstanceId || '',
      currentState: instance.CurrentState?.Name || '',
      previousState: instance.PreviousState?.Name || '',
    }));

    this.logger.log('EC2 instances started', {
      connectionId: connection._id.toString(),
      region: region || 'default',
      instanceIds,
    });

    return results;
  }

  /**
   * Stop EC2 instances
   */
  async stopInstances(
    connection: AWSConnectionDocument,
    instanceIds: string[],
    region?: string,
  ): Promise<
    Array<{ instanceId: string; currentState: string; previousState: string }>
  > {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'ec2', action: 'StopInstances', region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const { ec2Client } = await this.getClient(connection, region);

    const command = new StopInstancesCommand({
      InstanceIds: instanceIds,
    });

    const response = await ec2Client.send(command);

    const results = (response.StoppingInstances || []).map((instance) => ({
      instanceId: instance.InstanceId || '',
      currentState: instance.CurrentState?.Name || '',
      previousState: instance.PreviousState?.Name || '',
    }));

    this.logger.log('EC2 instances stopped', {
      connectionId: connection._id.toString(),
      region: region || 'default',
      instanceIds,
    });

    return results;
  }

  /**
   * Create EC2 instance
   */
  async createInstance(
    connection: AWSConnectionDocument,
    params: {
      imageId: string;
      instanceType: string;
      minCount?: number;
      maxCount?: number;
      region?: string;
      keyName?: string;
      securityGroupIds?: string[];
      userData?: string;
      tags?: Array<{ key: string; value: string }>;
    },
  ): Promise<{ instanceId: string; state: string }[]> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'ec2', action: 'RunInstances', region: params.region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const { ec2Client } = await this.getClient(connection, params.region);

    const command = new RunInstancesCommand({
      ImageId: params.imageId,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      InstanceType: params.instanceType as any,
      MinCount: params.minCount || 1,
      MaxCount: params.maxCount || 1,
      KeyName: params.keyName,
      SecurityGroupIds: params.securityGroupIds,
      UserData: params.userData
        ? Buffer.from(params.userData).toString('base64')
        : undefined,
      TagSpecifications: params.tags
        ? [
            {
              ResourceType: 'instance',
              Tags: params.tags.map((tag) => ({
                Key: tag.key,
                Value: tag.value,
              })),
            },
          ]
        : undefined,
    });

    const response = await ec2Client.send(command);

    const results = (response.Instances || []).map((instance) => ({
      instanceId: instance.InstanceId || '',
      state: instance.State?.Name || '',
    }));

    this.logger.log('EC2 instance created', {
      connectionId: connection._id.toString(),
      region: params.region || 'default',
      instanceType: params.instanceType,
      results,
    });

    return results;
  }

  /**
   * Find idle or underutilized instances
   */
  async findIdleInstances(
    connection: AWSConnectionDocument,
    threshold: number = 5,
    region?: string,
  ): Promise<
    Array<{
      instanceId: string;
      instanceType: string;
      averageCpuUtilization: number;
      isIdle: boolean;
    }>
  > {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'ec2', action: 'DescribeInstances', region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    // Get running instances
    const instances = await this.listInstances(
      connection,
      [{ Name: 'instance-state-name', Values: ['running'] }],
      region,
    );

    if (instances.length === 0) {
      return [];
    }

    const { cloudWatchClient } = await this.getClient(connection, region);

    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000); // Last 7 days

    const results: Array<{
      instanceId: string;
      instanceType: string;
      averageCpuUtilization: number;
      isIdle: boolean;
    }> = [];

    // Check CPU utilization for each instance
    for (const instance of instances) {
      try {
        const command = new GetMetricStatisticsCommand({
          Namespace: 'AWS/EC2',
          MetricName: 'CPUUtilization',
          Dimensions: [
            {
              Name: 'InstanceId',
              Value: instance.instanceId,
            },
          ],
          StartTime: startTime,
          EndTime: endTime,
          Period: 3600, // 1 hour
          Statistics: ['Average'],
        });

        const response = await cloudWatchClient.send(command);

        const dataPoints = response.Datapoints || [];
        const averageCpu =
          dataPoints.length > 0
            ? dataPoints.reduce((sum, dp) => sum + (dp.Average || 0), 0) /
              dataPoints.length
            : 0;

        results.push({
          instanceId: instance.instanceId,
          instanceType: instance.instanceType,
          averageCpuUtilization: averageCpu,
          isIdle: averageCpu < threshold,
        });
      } catch (error) {
        // If we can't get metrics, assume not idle
        results.push({
          instanceId: instance.instanceId,
          instanceType: instance.instanceType,
          averageCpuUtilization: 0,
          isIdle: false,
        });
      }
    }

    this.logger.log('EC2 idle instances analysis completed', {
      connectionId: connection._id.toString(),
      region: region || 'default',
      totalInstances: instances.length,
      idleInstances: results.filter((r) => r.isIdle).length,
      threshold,
    });

    return results;
  }

  /**
   * Get instance details with metrics
   */
  async getInstanceDetails(
    connection: AWSConnectionDocument,
    instanceId: string,
    region?: string,
  ): Promise<EC2Instance | null> {
    const instances = await this.listInstances(
      connection,
      [{ Name: 'instance-id', Values: [instanceId] }],
      region,
    );

    if (instances.length === 0) {
      return null;
    }

    const instance = instances[0];

    // Get CPU utilization for the last hour
    try {
      const { cloudWatchClient } = await this.getClient(connection, region);

      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 60 * 60 * 1000); // Last hour

      const cpuCommand = new GetMetricStatisticsCommand({
        Namespace: 'AWS/EC2',
        MetricName: 'CPUUtilization',
        Dimensions: [
          {
            Name: 'InstanceId',
            Value: instanceId,
          },
        ],
        StartTime: startTime,
        EndTime: endTime,
        Period: 300, // 5 minutes
        Statistics: ['Average'],
      });

      const cpuResponse = await cloudWatchClient.send(cpuCommand);
      const cpuDataPoints = cpuResponse.Datapoints || [];
      instance.cpuUtilization =
        cpuDataPoints.length > 0
          ? cpuDataPoints.reduce((sum, dp) => sum + (dp.Average || 0), 0) /
            cpuDataPoints.length
          : undefined;
    } catch (error) {
      // Metrics might not be available
      this.logger.debug('Failed to get EC2 metrics', {
        instanceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return instance;
  }

  /**
   * Format instances for chat response
   */
  formatInstancesForChat(instances: EC2Instance[]): string {
    if (instances.length === 0) {
      return 'No EC2 instances found.';
    }

    let message = `🖥️ **EC2 Instances (${instances.length})**\n\n`;

    for (const instance of instances.slice(0, 10)) {
      // Limit to first 10
      const stateEmoji =
        instance.state === 'running'
          ? '🟢'
          : instance.state === 'stopped'
            ? '🔴'
            : '🟡';

      message += `${stateEmoji} **${instance.instanceId}**\n`;
      message += `   Type: ${instance.instanceType}\n`;
      message += `   State: ${instance.state}\n`;
      message += `   Zone: ${instance.availabilityZone}\n`;

      if (instance.publicIpAddress) {
        message += `   Public IP: ${instance.publicIpAddress}\n`;
      }

      // Show tags
      const nameTag = instance.tags.find((tag) => tag.key === 'Name');
      if (nameTag?.value) {
        message += `   Name: ${nameTag.value}\n`;
      }

      message += '\n';
    }

    if (instances.length > 10) {
      message += `*... and ${instances.length - 10} more instances*`;
    }

    return message;
  }

  /**
   * Reboot EC2 instances
   */
  async rebootInstances(
    connection: AWSConnectionDocument,
    instanceIds: string[],
    region?: string,
  ): Promise<Array<{ instanceId: string; success: boolean }>> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'ec2', action: 'RebootInstances', region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const { ec2Client } = await this.getClient(connection, region);

    const command = new RebootInstancesCommand({
      InstanceIds: instanceIds,
    });

    await ec2Client.send(command);

    const results = instanceIds.map((instanceId) => ({
      instanceId,
      success: true,
    }));

    this.logger.log('EC2 instances rebooted', {
      connectionId: connection._id.toString(),
      region: region || 'default',
      instanceIds,
    });

    return results;
  }

  /**
   * List EBS volumes
   */
  async listVolumes(
    connection: AWSConnectionDocument,
    filters?: Array<{ Name: string; Values: string[] }>,
    region?: string,
    maxResults?: number,
    nextToken?: string,
  ): Promise<{
    volumes: Array<{
      volumeId: string;
      size: number;
      state: string;
      volumeType: string;
      iops?: number;
      availabilityZone: string;
      encrypted: boolean;
      tags: Array<{ key: string; value: string }>;
    }>;
    nextToken?: string;
  }> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'ec2', action: 'DescribeVolumes', region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const { ec2Client } = await this.getClient(connection, region);

    const command = new DescribeVolumesCommand({
      Filters: filters,
      MaxResults: maxResults || 100,
      NextToken: nextToken,
    });

    const response = await ec2Client.send(command);

    const volumes = (response.Volumes || []).map((volume) => ({
      volumeId: volume.VolumeId || '',
      size: volume.Size || 0,
      state: volume.State || '',
      volumeType: volume.VolumeType || '',
      iops: volume.Iops,
      availabilityZone: volume.AvailabilityZone || '',
      encrypted: volume.Encrypted || false,
      tags: (volume.Tags || []).map((tag) => ({
        key: tag.Key || '',
        value: tag.Value || '',
      })),
    }));

    this.logger.log('EBS volumes listed', {
      connectionId: connection._id.toString(),
      region: region || 'default',
      volumeCount: volumes.length,
      nextToken: response.NextToken,
    });

    return {
      volumes,
      nextToken: response.NextToken,
    };
  }

  /**
   * List security groups
   */
  async listSecurityGroups(
    connection: AWSConnectionDocument,
    filters?: Array<{ Name: string; Values: string[] }>,
    region?: string,
    maxResults?: number,
    nextToken?: string,
  ): Promise<{
    securityGroups: Array<{
      groupId: string;
      groupName: string;
      description?: string;
      vpcId?: string;
      tags: Array<{ key: string; value: string }>;
    }>;
    nextToken?: string;
  }> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'ec2', action: 'DescribeSecurityGroups', region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const { ec2Client } = await this.getClient(connection, region);

    const command = new DescribeSecurityGroupsCommand({
      Filters: filters,
      MaxResults: maxResults || 100,
      NextToken: nextToken,
    });

    const response = await ec2Client.send(command);

    const securityGroups = (response.SecurityGroups || []).map((sg) => ({
      groupId: sg.GroupId || '',
      groupName: sg.GroupName || '',
      description: sg.Description,
      vpcId: sg.VpcId,
      tags: (sg.Tags || []).map((tag) => ({
        key: tag.Key || '',
        value: tag.Value || '',
      })),
    }));

    this.logger.log('Security groups listed', {
      connectionId: connection._id.toString(),
      region: region || 'default',
      securityGroupCount: securityGroups.length,
      nextToken: response.NextToken,
    });

    return {
      securityGroups,
      nextToken: response.NextToken,
    };
  }

  /**
   * Get instance by ID
   */
  async getInstance(
    connection: AWSConnectionDocument,
    instanceId: string,
    region?: string,
  ): Promise<EC2Instance | null> {
    const instances = await this.listInstances(
      connection,
      [{ Name: 'instance-id', Values: [instanceId] }],
      region,
    );

    return instances.length > 0 ? instances[0] : null;
  }

  /**
   * List instances with pagination
   */
  async listInstancesPaginated(
    connection: AWSConnectionDocument,
    filters?: Array<{ Name: string; Values: string[] }>,
    region?: string,
    maxResults?: number,
    nextToken?: string,
  ): Promise<{
    instances: EC2Instance[];
    nextToken?: string;
  }> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'ec2', action: 'DescribeInstances', region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const { ec2Client } = await this.getClient(connection, region);

    const command = new DescribeInstancesCommand({
      Filters: filters,
      MaxResults: maxResults || 100,
      NextToken: nextToken,
    });

    const response = await ec2Client.send(command);

    const instances: EC2Instance[] = [];

    for (const reservation of response.Reservations || []) {
      for (const instance of reservation.Instances || []) {
        instances.push({
          instanceId: instance.InstanceId || '',
          instanceType: instance.InstanceType || '',
          state: instance.State?.Name || '',
          stateCode: instance.State?.Code || 0,
          publicIpAddress: instance.PublicIpAddress,
          privateIpAddress: instance.PrivateIpAddress,
          launchTime: instance.LaunchTime,
          availabilityZone: instance.Placement?.AvailabilityZone || '',
          tags: (instance.Tags || []).map((tag) => ({
            key: tag.Key || '',
            value: tag.Value || '',
          })),
        });
      }
    }

    return {
      instances,
      nextToken: response.NextToken,
    };
  }

  /**
   * Find idle instances with detailed recommendations
   */
  async findIdleInstancesDetailed(
    connection: AWSConnectionDocument,
    cpuThreshold: number = 5,
    networkThreshold: number = 1000000, // 1MB
    region?: string,
  ): Promise<
    Array<{
      instanceId: string;
      instanceType: string;
      averageCpuUtilization: number;
      averageNetworkIn: number;
      averageNetworkOut: number;
      isIdle: boolean;
      estimatedMonthlySavings: number;
      priority: 'low' | 'medium' | 'high';
      recommendation: string;
    }>
  > {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'ec2', action: 'DescribeInstances', region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    // Get running instances
    const instances = await this.listInstances(
      connection,
      [{ Name: 'instance-state-name', Values: ['running'] }],
      region,
    );

    if (instances.length === 0) {
      return [];
    }

    const { cloudWatchClient } = await this.getClient(connection, region);

    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000); // Last 7 days

    const results: Array<{
      instanceId: string;
      instanceType: string;
      averageCpuUtilization: number;
      averageNetworkIn: number;
      averageNetworkOut: number;
      isIdle: boolean;
      estimatedMonthlySavings: number;
      priority: 'low' | 'medium' | 'high';
      recommendation: string;
    }> = [];

    // Check metrics for each instance
    for (const instance of instances) {
      try {
        // Get CPU metrics
        const cpuCommand = new GetMetricStatisticsCommand({
          Namespace: 'AWS/EC2',
          MetricName: 'CPUUtilization',
          Dimensions: [{ Name: 'InstanceId', Value: instance.instanceId }],
          StartTime: startTime,
          EndTime: endTime,
          Period: 3600,
          Statistics: ['Average'],
        });

        const cpuResponse = await cloudWatchClient.send(cpuCommand);
        const cpuDataPoints = cpuResponse.Datapoints || [];
        const averageCpu =
          cpuDataPoints.length > 0
            ? cpuDataPoints.reduce((sum, dp) => sum + (dp.Average || 0), 0) /
              cpuDataPoints.length
            : 0;

        // Get Network metrics
        const networkInCommand = new GetMetricStatisticsCommand({
          Namespace: 'AWS/EC2',
          MetricName: 'NetworkIn',
          Dimensions: [{ Name: 'InstanceId', Value: instance.instanceId }],
          StartTime: startTime,
          EndTime: endTime,
          Period: 3600,
          Statistics: ['Average'],
        });

        const networkOutCommand = new GetMetricStatisticsCommand({
          Namespace: 'AWS/EC2',
          MetricName: 'NetworkOut',
          Dimensions: [{ Name: 'InstanceId', Value: instance.instanceId }],
          StartTime: startTime,
          EndTime: endTime,
          Period: 3600,
          Statistics: ['Average'],
        });

        const [networkInResponse, networkOutResponse] = await Promise.all([
          cloudWatchClient.send(networkInCommand),
          cloudWatchClient.send(networkOutCommand),
        ]);

        const networkInDataPoints = networkInResponse.Datapoints || [];
        const networkOutDataPoints = networkOutResponse.Datapoints || [];

        const averageNetworkIn =
          networkInDataPoints.length > 0
            ? networkInDataPoints.reduce(
                (sum, dp) => sum + (dp.Average || 0),
                0,
              ) / networkInDataPoints.length
            : 0;

        const averageNetworkOut =
          networkOutDataPoints.length > 0
            ? networkOutDataPoints.reduce(
                (sum, dp) => sum + (dp.Average || 0),
                0,
              ) / networkOutDataPoints.length
            : 0;

        const isIdle =
          averageCpu < cpuThreshold &&
          averageNetworkIn + averageNetworkOut < networkThreshold;

        // Calculate estimated savings using AWS Pricing API
        const hourlyRate = await this.getInstanceHourlyRate(
          instance.instanceType,
          region,
        );
        const estimatedMonthlySavings = isIdle ? hourlyRate * 24 * 30 : 0;

        // Determine priority
        let priority: 'low' | 'medium' | 'high' = 'low';
        let recommendation = 'Instance is actively used';

        if (isIdle) {
          if (averageCpu < 1) {
            priority = 'high';
            recommendation =
              'Consider stopping this instance - extremely low utilization';
          } else if (averageCpu < 3) {
            priority = 'medium';
            recommendation =
              'Consider stopping this instance - very low utilization';
          } else {
            priority = 'low';
            recommendation =
              'Consider stopping this instance - low utilization';
          }
        }

        results.push({
          instanceId: instance.instanceId,
          instanceType: instance.instanceType,
          averageCpuUtilization: averageCpu,
          averageNetworkIn,
          averageNetworkOut,
          isIdle,
          estimatedMonthlySavings,
          priority,
          recommendation,
        });
      } catch (error) {
        // If we can't get metrics, assume not idle
        results.push({
          instanceId: instance.instanceId,
          instanceType: instance.instanceType,
          averageCpuUtilization: 0,
          averageNetworkIn: 0,
          averageNetworkOut: 0,
          isIdle: false,
          estimatedMonthlySavings: 0,
          priority: 'low',
          recommendation: 'Unable to analyze metrics',
        });
      }
    }

    // Sort by potential savings (descending)
    results.sort(
      (a, b) => b.estimatedMonthlySavings - a.estimatedMonthlySavings,
    );

    this.logger.log('EC2 idle instances detailed analysis completed', {
      connectionId: connection._id.toString(),
      region: region || 'default',
      totalInstances: instances.length,
      idleInstances: results.filter((r) => r.isIdle).length,
      totalPotentialSavings: results.reduce(
        (sum, r) => sum + r.estimatedMonthlySavings,
        0,
      ),
    });

    return results;
  }

  /**
   * Format idle recommendations for chat
   */
  formatIdleRecommendationsForChat(
    recommendations: Array<{
      instanceId: string;
      instanceType: string;
      averageCpuUtilization: number;
      isIdle: boolean;
      estimatedMonthlySavings: number;
      priority: 'low' | 'medium' | 'high';
      recommendation: string;
    }>,
  ): string {
    const idleInstances = recommendations.filter((r) => r.isIdle);

    if (idleInstances.length === 0) {
      return '✅ **No idle EC2 instances found**\n\nAll running instances show active usage patterns.';
    }

    let message = `💡 **Idle EC2 Instances Found (${idleInstances.length})**\n\n`;
    message += `Potential monthly savings: **$${idleInstances.reduce((sum, r) => sum + r.estimatedMonthlySavings, 0).toFixed(2)}**\n\n`;

    // Group by priority
    const highPriority = idleInstances.filter((r) => r.priority === 'high');
    const mediumPriority = idleInstances.filter((r) => r.priority === 'medium');
    const lowPriority = idleInstances.filter((r) => r.priority === 'low');

    if (highPriority.length > 0) {
      message += '🚨 **High Priority (Stop Immediately):**\n';
      for (const instance of highPriority.slice(0, 5)) {
        message += `• \`${instance.instanceId}\` (${instance.instanceType}) - $${instance.estimatedMonthlySavings.toFixed(2)}/month saved\n`;
        message += `  CPU: ${instance.averageCpuUtilization.toFixed(1)}%\n`;
      }
      message += '\n';
    }

    if (mediumPriority.length > 0) {
      message += '⚠️ **Medium Priority:**\n';
      for (const instance of mediumPriority.slice(0, 5)) {
        message += `• \`${instance.instanceId}\` (${instance.instanceType}) - $${instance.estimatedMonthlySavings.toFixed(2)}/month saved\n`;
      }
      message += '\n';
    }

    if (lowPriority.length > 0 && idleInstances.length <= 10) {
      message += 'ℹ️ **Low Priority:**\n';
      for (const instance of lowPriority.slice(0, 5)) {
        message += `• \`${instance.instanceId}\` (${instance.instanceType}) - $${instance.estimatedMonthlySavings.toFixed(2)}/month saved\n`;
      }
      message += '\n';
    }

    message +=
      '*💡 Recommendation: Stop idle instances to reduce costs. Use "ec2 stop <instance-id>" command.*';

    return message;
  }

  /**
   * Create EC2 instance with AMI lookup
   */
  async createInstanceWithAmiLookup(
    connection: AWSConnectionDocument,
    params: {
      instanceType: string;
      region?: string;
      amiName?: string; // e.g., 'amzn2-ami-hvm-*-x86_64-gp2'
      amiId?: string; // Direct AMI ID
      keyName?: string;
      securityGroupIds?: string[];
      userData?: string;
      tags?: Array<{ key: string; value: string }>;
    },
  ): Promise<{ instanceId: string; state: string }[]> {
    if (!params.amiId && !params.amiName) {
      throw new Error('Either amiId or amiName must be provided');
    }

    const validation = this.permissionBoundaryService.validateAction(
      { service: 'ec2', action: 'RunInstances', region: params.region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    let amiId = params.amiId;

    // If amiName is provided, lookup the AMI ID
    if (!amiId && params.amiName) {
      this.logger.log('Looking up AMI by name', {
        component: 'Ec2Service',
        amiName: params.amiName,
        region: params.region,
      });

      amiId =
        (await this.lookupAmiByName(
          connection,
          params.amiName,
          params.region,
        )) ?? undefined;

      if (!amiId) {
        throw new Error(
          `No AMI found matching name pattern: ${params.amiName}`,
        );
      }

      this.logger.log('AMI lookup successful', {
        component: 'Ec2Service',
        amiName: params.amiName,
        amiId,
      });
    }

    return this.createInstance(connection, {
      imageId: amiId!,
      instanceType: params.instanceType,
      region: params.region,
      minCount: 1,
      maxCount: 1,
      keyName: params.keyName,
      securityGroupIds: params.securityGroupIds,
      userData: params.userData,
      tags: params.tags,
    });
  }

  /**
   * Lookup AMI ID by name pattern
   */
  private async lookupAmiByName(
    connection: AWSConnectionDocument,
    amiNamePattern: string,
    region?: string,
  ): Promise<string | null> {
    const { ec2Client } = await this.getClient(connection, region);

    const command = new DescribeImagesCommand({
      Filters: [
        {
          Name: 'name',
          Values: [amiNamePattern],
        },
        {
          Name: 'state',
          Values: ['available'],
        },
        {
          Name: 'virtualization-type',
          Values: ['hvm'],
        },
      ],
      Owners: ['amazon', 'self'], // Amazon AMIs and AMIs owned by the account
    });

    const response = await ec2Client.send(command);

    if (!response.Images || response.Images.length === 0) {
      return null;
    }

    // Sort by creation date (newest first) and return the first one
    const sortedImages = response.Images.sort((a, b) => {
      const dateA = new Date(a.CreationDate || 0);
      const dateB = new Date(b.CreationDate || 0);
      return dateB.getTime() - dateA.getTime();
    });

    const selectedAmi = sortedImages[0];

    this.logger.log('AMI selected from lookup', {
      component: 'Ec2Service',
      amiId: selectedAmi.ImageId,
      amiName: selectedAmi.Name,
      creationDate: selectedAmi.CreationDate,
    });

    return selectedAmi.ImageId || null;
  }

  /**
   * Get approximate hourly rate for instance type using AWS Pricing API
   */
  private async getInstanceHourlyRate(
    instanceType: string,
    region: string = 'us-east-1',
  ): Promise<number> {
    try {
      // Use AWS Pricing API for accurate pricing
      const pricing = await this.awsPricingService.getPricing({
        serviceCode: 'AmazonEC2',
        region,
        instanceType,
        operation: 'RunInstances',
      });

      if (pricing && pricing.pricePerHour) {
        return pricing.pricePerHour;
      }

      // Fallback to cached/default pricing if API fails
      this.logger.warn('AWS Pricing API unavailable, using fallback pricing', {
        instanceType,
        region,
      });

      return this.getFallbackPricing(instanceType);
    } catch (error) {
      this.logger.error('Failed to get instance pricing', {
        instanceType,
        region,
        error: error instanceof Error ? error.message : String(error),
      });

      return this.getFallbackPricing(instanceType);
    }
  }

  /**
   * Get fallback pricing when AWS Pricing API is unavailable
   */
  private getFallbackPricing(instanceType: string): number {
    // Last known pricing as fallback (should be updated periodically)
    const pricing: Record<string, number> = {
      't3.micro': 0.0104,
      't3.small': 0.0208,
      't3.medium': 0.0416,
      'm5.large': 0.096,
      'm5.xlarge': 0.192,
      'c5.large': 0.085,
      'c5.xlarge': 0.17,
    };

    return pricing[instanceType] || 0.1; // Default fallback
  }
}
