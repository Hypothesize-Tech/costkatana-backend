import { EC2Client, DescribeInstancesCommand, StopInstancesCommand, StartInstancesCommand, DescribeVolumesCommand, DescribeSecurityGroupsCommand } from '@aws-sdk/client-ec2';
import { loggingService } from '../../logging.service';
import { stsCredentialService } from '../stsCredential.service';
import { permissionBoundaryService } from '../permissionBoundary.service';
import { IAWSConnection } from '../../../models/AWSConnection';

/**
 * EC2 Service Provider - EC2 Operations
 * 
 * Allowed Operations:
 * - Read: DescribeInstances, DescribeVolumes, DescribeSecurityGroups
 * - Write: StopInstances, StartInstances (with approval)
 * - Blocked: TerminateInstances, DeleteVolume
 */

export interface EC2Instance {
  instanceId: string;
  instanceType: string;
  state: string;
  launchTime?: Date;
  tags: Record<string, string>;
  privateIpAddress?: string;
  publicIpAddress?: string;
  vpcId?: string;
  subnetId?: string;
}

export interface EC2Volume {
  volumeId: string;
  size: number;
  volumeType: string;
  state: string;
  attachments: Array<{ instanceId: string; device: string }>;
  tags: Record<string, string>;
}

class EC2ServiceProvider {
  private static instance: EC2ServiceProvider;
  
  private constructor() {}
  
  public static getInstance(): EC2ServiceProvider {
    if (!EC2ServiceProvider.instance) {
      EC2ServiceProvider.instance = new EC2ServiceProvider();
    }
    return EC2ServiceProvider.instance;
  }
  
  private async getClient(connection: IAWSConnection, region?: string): Promise<EC2Client> {
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
  
  /**
   * List EC2 instances
   */
  public async listInstances(
    connection: IAWSConnection,
    filters?: Array<{ Name: string; Values: string[] }>,
    region?: string
  ): Promise<EC2Instance[]> {
    // Validate permission
    const validation = permissionBoundaryService.validateAction(
      { service: 'ec2', action: 'DescribeInstances', region },
      connection
    );
    
    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }
    
    const client = await this.getClient(connection, region);
    
    const command = new DescribeInstancesCommand({
      Filters: filters,
      MaxResults: 100,
    });
    
    const response = await client.send(command);
    
    const instances: EC2Instance[] = [];
    
    for (const reservation of response.Reservations || []) {
      for (const instance of reservation.Instances || []) {
        instances.push({
          instanceId: instance.InstanceId || '',
          instanceType: instance.InstanceType || '',
          state: instance.State?.Name || 'unknown',
          launchTime: instance.LaunchTime,
          tags: this.parseTags(instance.Tags),
          privateIpAddress: instance.PrivateIpAddress,
          publicIpAddress: instance.PublicIpAddress,
          vpcId: instance.VpcId,
          subnetId: instance.SubnetId,
        });
      }
    }
    
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
   * Stop EC2 instances
   */
  public async stopInstances(
    connection: IAWSConnection,
    instanceIds: string[],
    region?: string
  ): Promise<{ stoppedInstances: string[]; errors: Array<{ instanceId: string; error: string }> }> {
    // Validate permission
    const validation = permissionBoundaryService.validateAction(
      { service: 'ec2', action: 'StopInstances', resources: instanceIds, region },
      connection
    );
    
    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }
    
    const client = await this.getClient(connection, region);
    
    const stoppedInstances: string[] = [];
    const errors: Array<{ instanceId: string; error: string }> = [];
    
    // Stop in batches of 10
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
          }
        }
      } catch (error) {
        for (const instanceId of batch) {
          errors.push({
            instanceId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }
    
    loggingService.info('EC2 instances stopped', {
      component: 'EC2ServiceProvider',
      operation: 'stopInstances',
      connectionId: connection._id.toString(),
      stoppedCount: stoppedInstances.length,
      errorCount: errors.length,
      region,
    });
    
    return { stoppedInstances, errors };
  }
  
  /**
   * Start EC2 instances
   */
  public async startInstances(
    connection: IAWSConnection,
    instanceIds: string[],
    region?: string
  ): Promise<{ startedInstances: string[]; errors: Array<{ instanceId: string; error: string }> }> {
    // Validate permission
    const validation = permissionBoundaryService.validateAction(
      { service: 'ec2', action: 'StartInstances', resources: instanceIds, region },
      connection
    );
    
    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }
    
    const client = await this.getClient(connection, region);
    
    const startedInstances: string[] = [];
    const errors: Array<{ instanceId: string; error: string }> = [];
    
    // Start in batches of 10
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
          }
        }
      } catch (error) {
        for (const instanceId of batch) {
          errors.push({
            instanceId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }
    
    loggingService.info('EC2 instances started', {
      component: 'EC2ServiceProvider',
      operation: 'startInstances',
      connectionId: connection._id.toString(),
      startedCount: startedInstances.length,
      errorCount: errors.length,
      region,
    });
    
    return { startedInstances, errors };
  }
  
  /**
   * List EBS volumes
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
    
    const client = await this.getClient(connection, region);
    
    const command = new DescribeVolumesCommand({
      Filters: filters,
      MaxResults: 100,
    });
    
    const response = await client.send(command);
    
    const volumes: EC2Volume[] = [];
    
    for (const volume of response.Volumes || []) {
      volumes.push({
        volumeId: volume.VolumeId || '',
        size: volume.Size || 0,
        volumeType: volume.VolumeType || '',
        state: volume.State || 'unknown',
        attachments: (volume.Attachments || []).map(a => ({
          instanceId: a.InstanceId || '',
          device: a.Device || '',
        })),
        tags: this.parseTags(volume.Tags),
      });
    }
    
    return volumes;
  }
  
  /**
   * Find idle instances (not used recently)
   */
  public async findIdleInstances(
    connection: IAWSConnection,
    idleDays: number = 7,
    region?: string
  ): Promise<EC2Instance[]> {
    const instances = await this.listInstances(
      connection,
      [{ Name: 'instance-state-name', Values: ['running'] }],
      region
    );
    
    const now = new Date();
    const idleThreshold = idleDays * 24 * 60 * 60 * 1000;
    
    // Filter instances that have been running for longer than idleDays
    // In production, this would also check CloudWatch metrics for CPU/network usage
    return instances.filter(instance => {
      if (!instance.launchTime) return false;
      const runningTime = now.getTime() - instance.launchTime.getTime();
      return runningTime > idleThreshold;
    });
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
}

export const ec2ServiceProvider = EC2ServiceProvider.getInstance();
