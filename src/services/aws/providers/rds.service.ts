import { RDSClient, DescribeDBInstancesCommand, StopDBInstanceCommand, StartDBInstanceCommand, CreateDBSnapshotCommand, DescribeDBSnapshotsCommand, ModifyDBInstanceCommand } from '@aws-sdk/client-rds';
import { loggingService } from '../../logging.service';
import { stsCredentialService } from '../stsCredential.service';
import { permissionBoundaryService } from '../permissionBoundary.service';
import { IAWSConnection } from '../../../models/AWSConnection';

/**
 * RDS Service Provider - RDS Operations
 * 
 * Allowed Operations:
 * - Read: DescribeDBInstances, DescribeDBSnapshots
 * - Write: StopDBInstance, StartDBInstance, CreateDBSnapshot (with approval)
 * - Blocked: DeleteDBInstance
 */

export interface RDSInstance {
  dbInstanceId: string;
  dbInstanceClass: string;
  engine: string;
  engineVersion: string;
  status: string;
  allocatedStorage: number;
  multiAZ: boolean;
  endpoint?: { address: string; port: number };
  tags: Record<string, string>;
}

export interface RDSSnapshot {
  snapshotId: string;
  dbInstanceId: string;
  snapshotCreateTime?: Date;
  status: string;
  allocatedStorage: number;
  snapshotType: string;
}

class RDSServiceProvider {
  private static instance: RDSServiceProvider;
  
  private constructor() {}
  
  public static getInstance(): RDSServiceProvider {
    if (!RDSServiceProvider.instance) {
      RDSServiceProvider.instance = new RDSServiceProvider();
    }
    return RDSServiceProvider.instance;
  }
  
  private async getClient(connection: IAWSConnection, region?: string): Promise<RDSClient> {
    const credentials = await stsCredentialService.assumeRole(connection);
    
    return new RDSClient({
      region: region || connection.allowedRegions[0] || 'us-east-1',
      credentials: {
        accessKeyId: credentials.credentials.accessKeyId,
        secretAccessKey: credentials.credentials.secretAccessKey,
        sessionToken: credentials.credentials.sessionToken,
      },
    });
  }
  
  /**
   * List RDS instances
   */
  public async listInstances(
    connection: IAWSConnection,
    region?: string
  ): Promise<RDSInstance[]> {
    const validation = permissionBoundaryService.validateAction(
      { service: 'rds', action: 'DescribeDBInstances', region },
      connection
    );
    
    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }
    
    const client = await this.getClient(connection, region);
    
    const command = new DescribeDBInstancesCommand({});
    const response = await client.send(command);
    
    const instances: RDSInstance[] = [];
    
    for (const db of response.DBInstances || []) {
      instances.push({
        dbInstanceId: db.DBInstanceIdentifier || '',
        dbInstanceClass: db.DBInstanceClass || '',
        engine: db.Engine || '',
        engineVersion: db.EngineVersion || '',
        status: db.DBInstanceStatus || 'unknown',
        allocatedStorage: db.AllocatedStorage || 0,
        multiAZ: db.MultiAZ || false,
        endpoint: db.Endpoint ? {
          address: db.Endpoint.Address || '',
          port: db.Endpoint.Port || 0,
        } : undefined,
        tags: this.parseTags(db.TagList),
      });
    }
    
    loggingService.info('RDS instances listed', {
      component: 'RDSServiceProvider',
      operation: 'listInstances',
      connectionId: connection._id.toString(),
      instanceCount: instances.length,
      region,
    });
    
    return instances;
  }
  
  /**
   * Stop RDS instance
   */
  public async stopInstance(
    connection: IAWSConnection,
    dbInstanceId: string,
    region?: string
  ): Promise<{ success: boolean; error?: string }> {
    const validation = permissionBoundaryService.validateAction(
      { service: 'rds', action: 'StopDBInstance', resources: [dbInstanceId], region },
      connection
    );
    
    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }
    
    const client = await this.getClient(connection, region);
    
    try {
      const command = new StopDBInstanceCommand({
        DBInstanceIdentifier: dbInstanceId,
      });
      
      await client.send(command);
      
      loggingService.info('RDS instance stopped', {
        component: 'RDSServiceProvider',
        operation: 'stopInstance',
        connectionId: connection._id.toString(),
        dbInstanceId,
        region,
      });
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
  
  /**
   * Start RDS instance
   */
  public async startInstance(
    connection: IAWSConnection,
    dbInstanceId: string,
    region?: string
  ): Promise<{ success: boolean; error?: string }> {
    const validation = permissionBoundaryService.validateAction(
      { service: 'rds', action: 'StartDBInstance', resources: [dbInstanceId], region },
      connection
    );
    
    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }
    
    const client = await this.getClient(connection, region);
    
    try {
      const command = new StartDBInstanceCommand({
        DBInstanceIdentifier: dbInstanceId,
      });
      
      await client.send(command);
      
      loggingService.info('RDS instance started', {
        component: 'RDSServiceProvider',
        operation: 'startInstance',
        connectionId: connection._id.toString(),
        dbInstanceId,
        region,
      });
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
  
  /**
   * Create RDS snapshot
   */
  public async createSnapshot(
    connection: IAWSConnection,
    dbInstanceId: string,
    snapshotId: string,
    region?: string
  ): Promise<{ success: boolean; snapshotId?: string; error?: string }> {
    const validation = permissionBoundaryService.validateAction(
      { service: 'rds', action: 'CreateDBSnapshot', resources: [dbInstanceId], region },
      connection
    );
    
    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }
    
    const client = await this.getClient(connection, region);
    
    try {
      const command = new CreateDBSnapshotCommand({
        DBInstanceIdentifier: dbInstanceId,
        DBSnapshotIdentifier: snapshotId,
      });
      
      const response = await client.send(command);
      
      loggingService.info('RDS snapshot created', {
        component: 'RDSServiceProvider',
        operation: 'createSnapshot',
        connectionId: connection._id.toString(),
        dbInstanceId,
        snapshotId,
        region,
      });
      
      return {
        success: true,
        snapshotId: response.DBSnapshot?.DBSnapshotIdentifier,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
  
  /**
   * List RDS snapshots
   */
  public async listSnapshots(
    connection: IAWSConnection,
    dbInstanceId?: string,
    region?: string
  ): Promise<RDSSnapshot[]> {
    const validation = permissionBoundaryService.validateAction(
      { service: 'rds', action: 'DescribeDBSnapshots', region },
      connection
    );
    
    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }
    
    const client = await this.getClient(connection, region);
    
    const command = new DescribeDBSnapshotsCommand({
      DBInstanceIdentifier: dbInstanceId,
    });
    
    const response = await client.send(command);
    
    return (response.DBSnapshots || []).map(snap => ({
      snapshotId: snap.DBSnapshotIdentifier || '',
      dbInstanceId: snap.DBInstanceIdentifier || '',
      snapshotCreateTime: snap.SnapshotCreateTime,
      status: snap.Status || 'unknown',
      allocatedStorage: snap.AllocatedStorage || 0,
      snapshotType: snap.SnapshotType || '',
    }));
  }
  
  /**
   * Find non-production instances (for cost optimization)
   */
  public async findNonProductionInstances(
    connection: IAWSConnection,
    region?: string
  ): Promise<RDSInstance[]> {
    const instances = await this.listInstances(connection, region);
    
    // Filter by tags or naming convention
    return instances.filter(instance => {
      const name = instance.dbInstanceId.toLowerCase();
      const env = instance.tags['Environment']?.toLowerCase() || '';
      
      return (
        name.includes('dev') ||
        name.includes('test') ||
        name.includes('staging') ||
        name.includes('qa') ||
        env === 'development' ||
        env === 'test' ||
        env === 'staging'
      );
    });
  }
  
  /**
   * Find oversized instances
   */
  public async findOversizedInstances(
    connection: IAWSConnection,
    region?: string
  ): Promise<Array<RDSInstance & { recommendation: string }>> {
    const instances = await this.listInstances(connection, region);
    
    // Simple heuristic: flag large instance classes
    const oversizedClasses = ['db.r5.2xlarge', 'db.r5.4xlarge', 'db.r5.8xlarge', 'db.r6g.2xlarge', 'db.r6g.4xlarge'];
    
    return instances
      .filter(instance => oversizedClasses.includes(instance.dbInstanceClass))
      .map(instance => ({
        ...instance,
        recommendation: `Consider downsizing from ${instance.dbInstanceClass}`,
      }));
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

export const rdsServiceProvider = RDSServiceProvider.getInstance();
