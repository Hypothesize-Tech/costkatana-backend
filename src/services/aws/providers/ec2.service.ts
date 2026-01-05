import { 
  EC2Client, 
  DescribeInstancesCommand, 
  StopInstancesCommand, 
  StartInstancesCommand, 
  DescribeVolumesCommand, 
  DescribeSecurityGroupsCommand,
  RebootInstancesCommand,
  RunInstancesCommand,
  DescribeImagesCommand,
  CreateTagsCommand,
} from '@aws-sdk/client-ec2';
import { 
  CloudWatchClient, 
  GetMetricStatisticsCommand,
  Dimension
} from '@aws-sdk/client-cloudwatch';
import { loggingService } from '../../logging.service';
import { stsCredentialService } from '../stsCredential.service';
import { permissionBoundaryService } from '../permissionBoundary.service';
import { IAWSConnection } from '../../../models/AWSConnection';

/**
 * EC2 Service Provider - Production-Ready EC2 Operations
 * 
 * Capabilities:
 * - List instances with comprehensive details
 * - Start/Stop/Reboot instances with batching
 * - Get instance utilization metrics from CloudWatch
 * - Find idle/underutilized instances for cost optimization
 * - List EBS volumes and security groups
 * 
 * Security:
 * - All operations validated against permission boundaries
 * - Destructive operations (Terminate, Delete) are blocked
 * - Audit logging for all write operations
 */

export interface EC2Instance {
  instanceId: string;
  instanceType: string;
  state: string;
  launchTime?: Date;
  tags: Record<string, string>;
  name?: string;
  privateIpAddress?: string;
  publicIpAddress?: string;
  vpcId?: string;
  subnetId?: string;
  availabilityZone?: string;
  platform?: string;
  architecture?: string;
  rootDeviceType?: string;
  monitoring?: string;
  securityGroups?: Array<{ groupId: string; groupName: string }>;
  iamInstanceProfile?: string;
  ebsOptimized?: boolean;
}

export interface EC2Volume {
  volumeId: string;
  size: number;
  volumeType: string;
  state: string;
  iops?: number;
  throughput?: number;
  encrypted: boolean;
  attachments: Array<{ instanceId: string; device: string; state: string }>;
  tags: Record<string, string>;
  availabilityZone?: string;
  createTime?: Date;
}

export interface EC2SecurityGroup {
  groupId: string;
  groupName: string;
  description: string;
  vpcId?: string;
  inboundRules: number;
  outboundRules: number;
  tags: Record<string, string>;
}

export interface EC2InstanceUtilization {
  instanceId: string;
  cpuUtilization: number;
  networkIn: number;
  networkOut: number;
  diskReadOps: number;
  diskWriteOps: number;
  period: { start: Date; end: Date };
  dataPoints: number;
}

export interface IdleInstanceRecommendation {
  instance: EC2Instance;
  avgCpuUtilization: number;
  avgNetworkIn: number;
  avgNetworkOut: number;
  idleDays: number;
  recommendation: string;
  estimatedMonthlySavings?: number;
  priority: 'high' | 'medium' | 'low';
}

class EC2ServiceProvider {
  private static instance: EC2ServiceProvider;
  
  // Instance type pricing estimates (hourly, us-east-1)
  private static readonly INSTANCE_PRICING: Record<string, number> = {
    't2.micro': 0.0116,
    't2.small': 0.023,
    't2.medium': 0.0464,
    't2.large': 0.0928,
    't3.micro': 0.0104,
    't3.small': 0.0208,
    't3.medium': 0.0416,
    't3.large': 0.0832,
    'm5.large': 0.096,
    'm5.xlarge': 0.192,
    'm5.2xlarge': 0.384,
    'c5.large': 0.085,
    'c5.xlarge': 0.17,
    'r5.large': 0.126,
    'r5.xlarge': 0.252,
  };
  
  private constructor() {}
  
  public static getInstance(): EC2ServiceProvider {
    if (!EC2ServiceProvider.instance) {
      EC2ServiceProvider.instance = new EC2ServiceProvider();
    }
    return EC2ServiceProvider.instance;
  }
  
  private async getEC2Client(connection: IAWSConnection, region?: string): Promise<EC2Client> {
    const credentials = await stsCredentialService.assumeRole(connection);
    
    return new EC2Client({
      region: region || connection.allowedRegions[0] || 'us-east-1',
      credentials: {
        accessKeyId: credentials.credentials.accessKeyId,
        secretAccessKey: credentials.credentials.secretAccessKey,
        sessionToken: credentials.credentials.sessionToken,
      },
    });
  }
  
  private async getCloudWatchClient(connection: IAWSConnection, region?: string): Promise<CloudWatchClient> {
    const credentials = await stsCredentialService.assumeRole(connection);
    
    return new CloudWatchClient({
      region: region || connection.allowedRegions[0] || 'us-east-1',
      credentials: {
        accessKeyId: credentials.credentials.accessKeyId,
        secretAccessKey: credentials.credentials.secretAccessKey,
        sessionToken: credentials.credentials.sessionToken,
      },
    });
  }
  
  /**
   * List EC2 instances with comprehensive details
   */
  public async listInstances(
    connection: IAWSConnection,
    filters?: Array<{ Name: string; Values: string[] }>,
    region?: string
  ): Promise<EC2Instance[]> {
    const validation = permissionBoundaryService.validateAction(
      { service: 'ec2', action: 'DescribeInstances', region },
      connection
    );
    
    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }
    
    const client = await this.getEC2Client(connection, region);
    const instances: EC2Instance[] = [];
    let nextToken: string | undefined;
    
    do {
      const command = new DescribeInstancesCommand({
        Filters: filters,
        MaxResults: 100,
        NextToken: nextToken,
      });
      
      const response = await client.send(command);
      
      for (const reservation of response.Reservations || []) {
        for (const instance of reservation.Instances || []) {
          const tags = this.parseTags(instance.Tags);
          instances.push({
            instanceId: instance.InstanceId || '',
            instanceType: instance.InstanceType || '',
            state: instance.State?.Name || 'unknown',
            launchTime: instance.LaunchTime,
            tags,
            name: tags['Name'] || instance.InstanceId || '',
            privateIpAddress: instance.PrivateIpAddress,
            publicIpAddress: instance.PublicIpAddress,
            vpcId: instance.VpcId,
            subnetId: instance.SubnetId,
            availabilityZone: instance.Placement?.AvailabilityZone,
            platform: instance.Platform || 'linux',
            architecture: instance.Architecture,
            rootDeviceType: instance.RootDeviceType,
            monitoring: instance.Monitoring?.State,
            securityGroups: instance.SecurityGroups?.map(sg => ({
              groupId: sg.GroupId || '',
              groupName: sg.GroupName || '',
            })),
            iamInstanceProfile: instance.IamInstanceProfile?.Arn,
            ebsOptimized: instance.EbsOptimized,
          });
        }
      }
      
      nextToken = response.NextToken;
    } while (nextToken);
    
    loggingService.info('EC2 instances listed', {
      component: 'EC2ServiceProvider',
      operation: 'listInstances',
      connectionId: connection._id.toString(),
      instanceCount: instances.length,
      region,
    });
    
    return instances;
  }
  
  /**
   * Get a single instance by ID
   */
  public async getInstance(
    connection: IAWSConnection,
    instanceId: string,
    region?: string
  ): Promise<EC2Instance | null> {
    const instances = await this.listInstances(
      connection,
      [{ Name: 'instance-id', Values: [instanceId] }],
      region
    );
    return instances[0] || null;
  }
  
  /**
   * Stop EC2 instances with batching and error handling
   */
  public async stopInstances(
    connection: IAWSConnection,
    instanceIds: string[],
    region?: string
  ): Promise<{ stoppedInstances: string[]; errors: Array<{ instanceId: string; error: string }> }> {
    const validation = permissionBoundaryService.validateAction(
      { service: 'ec2', action: 'StopInstances', resources: instanceIds, region },
      connection
    );
    
    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }
    
    const client = await this.getEC2Client(connection, region);
    const stoppedInstances: string[] = [];
    const errors: Array<{ instanceId: string; error: string }> = [];
    
    // Process in batches of 10 (AWS limit)
    for (let i = 0; i < instanceIds.length; i += 10) {
      const batch = instanceIds.slice(i, i + 10);
      
      try {
        const command = new StopInstancesCommand({
          InstanceIds: batch,
        });
        
        const response = await client.send(command);
        
        for (const change of response.StoppingInstances || []) {
          if (change.InstanceId) {
            stoppedInstances.push(change.InstanceId);
            loggingService.info('EC2 instance stopping', {
              component: 'EC2ServiceProvider',
              operation: 'stopInstances',
              instanceId: change.InstanceId,
              previousState: change.PreviousState?.Name,
              currentState: change.CurrentState?.Name,
            });
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        for (const instanceId of batch) {
          errors.push({ instanceId, error: errorMessage });
        }
        loggingService.error('Failed to stop EC2 instances', {
          component: 'EC2ServiceProvider',
          operation: 'stopInstances',
          batch,
          error: errorMessage,
        });
      }
    }
    
    return { stoppedInstances, errors };
  }
  
  /**
   * Start EC2 instances with batching and error handling
   */
  public async startInstances(
    connection: IAWSConnection,
    instanceIds: string[],
    region?: string
  ): Promise<{ startedInstances: string[]; errors: Array<{ instanceId: string; error: string }> }> {
    const validation = permissionBoundaryService.validateAction(
      { service: 'ec2', action: 'StartInstances', resources: instanceIds, region },
      connection
    );
    
    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }
    
    const client = await this.getEC2Client(connection, region);
    const startedInstances: string[] = [];
    const errors: Array<{ instanceId: string; error: string }> = [];
    
    // Process in batches of 10
    for (let i = 0; i < instanceIds.length; i += 10) {
      const batch = instanceIds.slice(i, i + 10);
      
      try {
        const command = new StartInstancesCommand({
          InstanceIds: batch,
        });
        
        const response = await client.send(command);
        
        for (const change of response.StartingInstances || []) {
          if (change.InstanceId) {
            startedInstances.push(change.InstanceId);
            loggingService.info('EC2 instance starting', {
              component: 'EC2ServiceProvider',
              operation: 'startInstances',
              instanceId: change.InstanceId,
              previousState: change.PreviousState?.Name,
              currentState: change.CurrentState?.Name,
            });
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        for (const instanceId of batch) {
          errors.push({ instanceId, error: errorMessage });
        }
        loggingService.error('Failed to start EC2 instances', {
          component: 'EC2ServiceProvider',
          operation: 'startInstances',
          batch,
          error: errorMessage,
        });
      }
    }
    
    return { startedInstances, errors };
  }
  
  /**
   * Reboot EC2 instances
   */
  public async rebootInstances(
    connection: IAWSConnection,
    instanceIds: string[],
    region?: string
  ): Promise<{ rebootedInstances: string[]; errors: Array<{ instanceId: string; error: string }> }> {
    const validation = permissionBoundaryService.validateAction(
      { service: 'ec2', action: 'RebootInstances', resources: instanceIds, region },
      connection
    );
    
    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }
    
    const client = await this.getEC2Client(connection, region);
    const rebootedInstances: string[] = [];
    const errors: Array<{ instanceId: string; error: string }> = [];
    
    for (let i = 0; i < instanceIds.length; i += 10) {
      const batch = instanceIds.slice(i, i + 10);
      
      try {
        const command = new RebootInstancesCommand({
          InstanceIds: batch,
        });
        
        await client.send(command);
        rebootedInstances.push(...batch);
        
        loggingService.info('EC2 instances rebooted', {
          component: 'EC2ServiceProvider',
          operation: 'rebootInstances',
          instanceIds: batch,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        for (const instanceId of batch) {
          errors.push({ instanceId, error: errorMessage });
        }
      }
    }
    
    return { rebootedInstances, errors };
  }
  
  /**
   * List EBS volumes with comprehensive details
   */
  public async listVolumes(
    connection: IAWSConnection,
    filters?: Array<{ Name: string; Values: string[] }>,
    region?: string
  ): Promise<EC2Volume[]> {
    const validation = permissionBoundaryService.validateAction(
      { service: 'ec2', action: 'DescribeVolumes', region },
      connection
    );
    
    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }
    
    const client = await this.getEC2Client(connection, region);
    const volumes: EC2Volume[] = [];
    let nextToken: string | undefined;
    
    do {
      const command = new DescribeVolumesCommand({
        Filters: filters,
        MaxResults: 100,
        NextToken: nextToken,
      });
      
      const response = await client.send(command);
      
      for (const volume of response.Volumes || []) {
        volumes.push({
          volumeId: volume.VolumeId || '',
          size: volume.Size || 0,
          volumeType: volume.VolumeType || '',
          state: volume.State || 'unknown',
          iops: volume.Iops,
          throughput: volume.Throughput,
          encrypted: volume.Encrypted || false,
          attachments: (volume.Attachments || []).map(a => ({
            instanceId: a.InstanceId || '',
            device: a.Device || '',
            state: a.State || '',
          })),
          tags: this.parseTags(volume.Tags),
          availabilityZone: volume.AvailabilityZone,
          createTime: volume.CreateTime,
        });
      }
      
      nextToken = response.NextToken;
    } while (nextToken);
    
    return volumes;
  }
  
  /**
   * List security groups
   */
  public async listSecurityGroups(
    connection: IAWSConnection,
    filters?: Array<{ Name: string; Values: string[] }>,
    region?: string
  ): Promise<EC2SecurityGroup[]> {
    const validation = permissionBoundaryService.validateAction(
      { service: 'ec2', action: 'DescribeSecurityGroups', region },
      connection
    );
    
    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }
    
    const client = await this.getEC2Client(connection, region);
    
    const command = new DescribeSecurityGroupsCommand({
      Filters: filters,
      MaxResults: 100,
    });
    
    const response = await client.send(command);
    
    return (response.SecurityGroups || []).map(sg => ({
      groupId: sg.GroupId || '',
      groupName: sg.GroupName || '',
      description: sg.Description || '',
      vpcId: sg.VpcId,
      inboundRules: sg.IpPermissions?.length || 0,
      outboundRules: sg.IpPermissionsEgress?.length || 0,
      tags: this.parseTags(sg.Tags),
    }));
  }
  
  /**
   * Get instance utilization metrics from CloudWatch
   */
  public async getInstanceUtilization(
    connection: IAWSConnection,
    instanceId: string,
    periodHours: number = 24,
    region?: string
  ): Promise<EC2InstanceUtilization> {
    const cwClient = await this.getCloudWatchClient(connection, region);
    
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - periodHours * 60 * 60 * 1000);
    
    const dimensions: Dimension[] = [
      { Name: 'InstanceId', Value: instanceId },
    ];
    
    const getMetric = async (metricName: string, namespace: string = 'AWS/EC2'): Promise<number> => {
      try {
        const command = new GetMetricStatisticsCommand({
          Namespace: namespace,
          MetricName: metricName,
          Dimensions: dimensions,
          StartTime: startTime,
          EndTime: endTime,
          Period: 3600, // 1 hour
          Statistics: ['Average'],
        });
        
        const response = await cwClient.send(command);
        const datapoints = response.Datapoints || [];
        
        if (datapoints.length === 0) return 0;
        
        const sum = datapoints.reduce((acc, dp) => acc + (dp.Average || 0), 0);
        return sum / datapoints.length;
      } catch (error) {
        loggingService.warn('Failed to get CloudWatch metric', {
          component: 'EC2ServiceProvider',
          metricName,
          instanceId,
          error: error instanceof Error ? error.message : String(error),
        });
        return 0;
      }
    };
    
    const [cpuUtilization, networkIn, networkOut, diskReadOps, diskWriteOps] = await Promise.all([
      getMetric('CPUUtilization'),
      getMetric('NetworkIn'),
      getMetric('NetworkOut'),
      getMetric('DiskReadOps'),
      getMetric('DiskWriteOps'),
    ]);
    
    return {
      instanceId,
      cpuUtilization,
      networkIn,
      networkOut,
      diskReadOps,
      diskWriteOps,
      period: { start: startTime, end: endTime },
      dataPoints: periodHours,
    };
  }
  
  /**
   * Find idle/underutilized instances for cost optimization
   */
  public async findIdleInstances(
    connection: IAWSConnection,
    options: {
      cpuThreshold?: number;
      networkThreshold?: number;
      periodDays?: number;
      region?: string;
    } = {}
  ): Promise<IdleInstanceRecommendation[]> {
    const {
      cpuThreshold = 5, // 5% average CPU
      networkThreshold = 1000000, // 1 MB/hour average
      periodDays = 7,
      region,
    } = options;
    
    // Get running instances
    const instances = await this.listInstances(
      connection,
      [{ Name: 'instance-state-name', Values: ['running'] }],
      region
    );
    
    const recommendations: IdleInstanceRecommendation[] = [];
    
    // Check utilization for each instance
    for (const instance of instances) {
      try {
        const utilization = await this.getInstanceUtilization(
          connection,
          instance.instanceId,
          periodDays * 24,
          region
        );
        
        const isIdle = 
          utilization.cpuUtilization < cpuThreshold &&
          utilization.networkIn < networkThreshold &&
          utilization.networkOut < networkThreshold;
        
        if (isIdle) {
          const hourlyPrice = EC2ServiceProvider.INSTANCE_PRICING[instance.instanceType] || 0.05;
          const estimatedMonthlySavings = hourlyPrice * 730; // 730 hours/month
          
          let priority: 'high' | 'medium' | 'low' = 'low';
          if (estimatedMonthlySavings > 100) priority = 'high';
          else if (estimatedMonthlySavings > 30) priority = 'medium';
          
          recommendations.push({
            instance,
            avgCpuUtilization: utilization.cpuUtilization,
            avgNetworkIn: utilization.networkIn,
            avgNetworkOut: utilization.networkOut,
            idleDays: periodDays,
            recommendation: utilization.cpuUtilization < 1 
              ? 'Consider stopping or terminating this instance - it appears completely idle'
              : 'Consider downsizing or scheduling stop during off-hours',
            estimatedMonthlySavings,
            priority,
          });
        }
      } catch (error) {
        loggingService.warn('Failed to check instance utilization', {
          component: 'EC2ServiceProvider',
          instanceId: instance.instanceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    
    // Sort by potential savings
    recommendations.sort((a, b) => (b.estimatedMonthlySavings || 0) - (a.estimatedMonthlySavings || 0));
    
    loggingService.info('Idle instances analysis complete', {
      component: 'EC2ServiceProvider',
      operation: 'findIdleInstances',
      totalInstances: instances.length,
      idleInstances: recommendations.length,
      totalPotentialSavings: recommendations.reduce((sum, r) => sum + (r.estimatedMonthlySavings || 0), 0),
    });
    
    return recommendations;
  }
  
  /**
   * Get instance summary for chat responses
   */
  public formatInstancesForChat(instances: EC2Instance[]): string {
    if (instances.length === 0) {
      return 'No EC2 instances found.';
    }
    
    const runningCount = instances.filter(i => i.state === 'running').length;
    const stoppedCount = instances.filter(i => i.state === 'stopped').length;
    const otherCount = instances.length - runningCount - stoppedCount;
    
    let summary = `Found **${instances.length}** EC2 instances:\n`;
    summary += `- 🟢 Running: ${runningCount}\n`;
    summary += `- 🔴 Stopped: ${stoppedCount}\n`;
    if (otherCount > 0) summary += `- ⚪ Other: ${otherCount}\n`;
    summary += '\n';
    
    // Group by state
    const running = instances.filter(i => i.state === 'running').slice(0, 10);
    const stopped = instances.filter(i => i.state === 'stopped').slice(0, 5);
    
    if (running.length > 0) {
      summary += '**Running Instances:**\n';
      for (const instance of running) {
        summary += `- \`${instance.instanceId}\` (${instance.name || 'unnamed'}) - ${instance.instanceType}`;
        if (instance.publicIpAddress) summary += ` - ${instance.publicIpAddress}`;
        summary += '\n';
      }
      if (runningCount > 10) summary += `  _...and ${runningCount - 10} more_\n`;
    }
    
    if (stopped.length > 0) {
      summary += '\n**Stopped Instances:**\n';
      for (const instance of stopped) {
        summary += `- \`${instance.instanceId}\` (${instance.name || 'unnamed'}) - ${instance.instanceType}\n`;
      }
      if (stoppedCount > 5) summary += `  _...and ${stoppedCount - 5} more_\n`;
    }
    
    return summary;
  }
  
  /**
   * Format idle instance recommendations for chat
   */
  public formatIdleRecommendationsForChat(recommendations: IdleInstanceRecommendation[]): string {
    if (recommendations.length === 0) {
      return '✅ No idle instances found! Your EC2 resources appear to be well-utilized.';
    }
    
    const totalSavings = recommendations.reduce((sum, r) => sum + (r.estimatedMonthlySavings || 0), 0);
    
    let summary = `Found **${recommendations.length}** potentially idle instances\n`;
    summary += `💰 Estimated monthly savings: **$${totalSavings.toFixed(2)}**\n\n`;
    
    const highPriority = recommendations.filter(r => r.priority === 'high');
    const mediumPriority = recommendations.filter(r => r.priority === 'medium');
    
    if (highPriority.length > 0) {
      summary += '🔴 **High Priority:**\n';
      for (const rec of highPriority.slice(0, 5)) {
        summary += `- \`${rec.instance.instanceId}\` (${rec.instance.name || 'unnamed'})\n`;
        summary += `  CPU: ${rec.avgCpuUtilization.toFixed(1)}% | Savings: $${rec.estimatedMonthlySavings?.toFixed(2)}/mo\n`;
      }
    }
    
    if (mediumPriority.length > 0) {
      summary += '\n🟡 **Medium Priority:**\n';
      for (const rec of mediumPriority.slice(0, 3)) {
        summary += `- \`${rec.instance.instanceId}\` (${rec.instance.name || 'unnamed'})\n`;
        summary += `  CPU: ${rec.avgCpuUtilization.toFixed(1)}% | Savings: $${rec.estimatedMonthlySavings?.toFixed(2)}/mo\n`;
      }
    }
    
    return summary;
  }
  
  private parseTags(tags?: Array<{ Key?: string; Value?: string }>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const tag of tags || []) {
      if (tag.Key) {
        result[tag.Key] = tag.Value || '';
      }
    }
    return result;
  }

  /**
   * Create EC2 instance with comprehensive configuration
   */
  public async createInstance(
    connection: IAWSConnection,
    config: {
      instanceName: string;
      instanceType?: string;
      vpcId?: string;
      subnetId?: string;
      securityGroupId?: string;
      keyPairName?: string;
      region?: string;
      tags?: Record<string, string>;
    }
  ): Promise<{ instanceId: string; state: string; privateIpAddress?: string; publicIpAddress?: string; keyPairName?: string }> {
    const validation = permissionBoundaryService.validateAction(
      { service: 'ec2', action: 'RunInstances', region: config.region },
      connection
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const region = config.region ?? connection.allowedRegions[0] ?? 'us-east-1';
    const client = await this.getEC2Client(connection, region);
    const instanceType = config.instanceType ?? 't3.micro';

    try {
      // Get latest Amazon Linux 2023 AMI
      const amiCommand = new DescribeImagesCommand({
        Filters: [
          { Name: 'name', Values: ['al2023-ami-*'] },
          { Name: 'state', Values: ['available'] },
          { Name: 'root-device-type', Values: ['ebs'] },
          { Name: 'virtualization-type', Values: ['hvm'] },
        ],
        Owners: ['amazon'],
        MaxResults: 1,
      });

      const amiResponse = await client.send(amiCommand);
      const imageId = amiResponse.Images?.[0]?.ImageId;

      if (!imageId) {
        throw new Error('No suitable AMI found for region');
      }

      // Create instance
      const runCommand = new RunInstancesCommand({
        ImageId: imageId,
        InstanceType: instanceType as any,
        MinCount: 1,
        MaxCount: 1,
        KeyName: config.keyPairName,
        SubnetId: config.subnetId,
        SecurityGroupIds: config.securityGroupId ? [config.securityGroupId] : undefined,
        BlockDeviceMappings: [
          {
            DeviceName: '/dev/xvda',
            Ebs: {
              VolumeSize: 8,
              VolumeType: 'gp3',
              Encrypted: true,
              DeleteOnTermination: true,
            },
          },
        ],
        Monitoring: { Enabled: false },
        TagSpecifications: [
          {
            ResourceType: 'instance',
            Tags: [
              { Key: 'Name', Value: config.instanceName },
              { Key: 'ManagedBy', Value: 'CostKatana' },
              { Key: 'CreatedBy', Value: connection.userId?.toString() ?? 'unknown' },
              { Key: 'CreatedAt', Value: new Date().toISOString() },
              { Key: 'ConnectionId', Value: connection._id.toString() },
              ...Object.entries(config.tags ?? {}).map(([Key, Value]) => ({ Key, Value })),
            ],
          },
          {
            ResourceType: 'volume',
            Tags: [
              { Key: 'Name', Value: `${config.instanceName}-root` },
              { Key: 'ManagedBy', Value: 'CostKatana' },
            ],
          },
        ],
      });

      const response = await client.send(runCommand);
      const instance = response.Instances?.[0];

      if (!instance?.InstanceId) {
        throw new Error('Failed to create instance');
      }

      loggingService.info('EC2 instance created', {
        component: 'EC2ServiceProvider',
        operation: 'createInstance',
        instanceId: instance.InstanceId,
        instanceType,
        region,
        connectionId: connection._id.toString(),
      });

      return {
        instanceId: instance.InstanceId,
        state: instance.State?.Name ?? 'pending',
        privateIpAddress: instance.PrivateIpAddress,
        publicIpAddress: instance.PublicIpAddress,
        keyPairName: config.keyPairName,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      loggingService.error('Failed to create EC2 instance', {
        component: 'EC2ServiceProvider',
        operation: 'createInstance',
        instanceName: config.instanceName,
        instanceType,
        region,
        error: errorMessage,
      });
      throw error;
    }
  }
}

export const ec2ServiceProvider = EC2ServiceProvider.getInstance();
