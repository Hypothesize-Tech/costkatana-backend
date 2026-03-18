import { Injectable } from '@nestjs/common';
import {
  RDSClient,
  DescribeDBInstancesCommand,
  StartDBInstanceCommand,
  StopDBInstanceCommand,
  CreateDBInstanceCommand,
  CreateDBSnapshotCommand,
  DescribeDBSnapshotsCommand,
} from '@aws-sdk/client-rds';
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from '@aws-sdk/client-cloudwatch';
import { LoggerService } from '../../../common/logger/logger.service';
import { StsCredentialService } from './sts-credential.service';
import { PermissionBoundaryService } from './permission-boundary.service';
import { AwsPricingService } from './aws-pricing.service';
import { AWSConnectionDocument } from '@/schemas/integration/aws-connection.schema';

export interface RDSDatabase {
  dbInstanceIdentifier: string;
  dbInstanceClass: string;
  engine: string;
  engineVersion: string;
  dbInstanceStatus: string;
  masterUsername: string;
  allocatedStorage: number;
  availabilityZone: string;
  backupRetentionPeriod: number;
  multiAZ: boolean;
  publiclyAccessible: boolean;
  vpcId?: string;
  dbSubnetGroupName?: string;
}

@Injectable()
export class RdsService {
  constructor(
    private readonly stsCredentialService: StsCredentialService,
    private readonly permissionBoundaryService: PermissionBoundaryService,
    private readonly awsPricingService: AwsPricingService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Get RDS client for a connection
   */
  private async getClient(
    connection: AWSConnectionDocument,
    region?: string,
  ): Promise<RDSClient> {
    const credentials = await this.stsCredentialService.assumeRole(connection);

    return new RDSClient({
      region: region || connection.allowedRegions?.[0] || 'us-east-1',
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
    });
  }

  /**
   * List RDS instances
   */
  async listInstances(
    connection: AWSConnectionDocument,
    region?: string,
  ): Promise<RDSDatabase[]> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'rds', action: 'DescribeDBInstances', region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const client = await this.getClient(connection, region);

    const command = new DescribeDBInstancesCommand({});
    const response = await client.send(command);

    const databases: RDSDatabase[] = (response.DBInstances || []).map(
      (instance) => ({
        dbInstanceIdentifier: instance.DBInstanceIdentifier || '',
        dbInstanceClass: instance.DBInstanceClass || '',
        engine: instance.Engine || '',
        engineVersion: instance.EngineVersion || '',
        dbInstanceStatus: instance.DBInstanceStatus || '',
        masterUsername: instance.MasterUsername || '',
        allocatedStorage: instance.AllocatedStorage || 0,
        availabilityZone: instance.AvailabilityZone || '',
        backupRetentionPeriod: instance.BackupRetentionPeriod || 0,
        multiAZ: instance.MultiAZ || false,
        publiclyAccessible: instance.PubliclyAccessible || false,
        vpcId: instance.DBSubnetGroup?.VpcId,
        dbSubnetGroupName: instance.DBSubnetGroup?.DBSubnetGroupName,
      }),
    );

    this.logger.log('RDS instances listed', {
      connectionId: connection._id.toString(),
      region: region || 'default',
      instanceCount: databases.length,
    });

    return databases;
  }

  /**
   * Start RDS instance
   */
  async startInstance(
    connection: AWSConnectionDocument,
    dbInstanceIdentifier: string,
    region?: string,
  ): Promise<{ dbInstanceIdentifier: string; status: string }> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'rds', action: 'StartDBInstance', region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const client = await this.getClient(connection, region);

    const command = new StartDBInstanceCommand({
      DBInstanceIdentifier: dbInstanceIdentifier,
    });

    const response = await client.send(command);

    const result = {
      dbInstanceIdentifier:
        response.DBInstance?.DBInstanceIdentifier || dbInstanceIdentifier,
      status: response.DBInstance?.DBInstanceStatus || 'starting',
    };

    this.logger.log('RDS instance started', {
      connectionId: connection._id.toString(),
      region: region || 'default',
      dbInstanceIdentifier,
    });

    return result;
  }

  /**
   * Stop RDS instance
   */
  async stopInstance(
    connection: AWSConnectionDocument,
    dbInstanceIdentifier: string,
    region?: string,
  ): Promise<{ dbInstanceIdentifier: string; status: string }> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'rds', action: 'StopDBInstance', region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const client = await this.getClient(connection, region);

    const command = new StopDBInstanceCommand({
      DBInstanceIdentifier: dbInstanceIdentifier,
    });

    const response = await client.send(command);

    const result = {
      dbInstanceIdentifier:
        response.DBInstance?.DBInstanceIdentifier || dbInstanceIdentifier,
      status: response.DBInstance?.DBInstanceStatus || 'stopping',
    };

    this.logger.log('RDS instance stopped', {
      connectionId: connection._id.toString(),
      region: region || 'default',
      dbInstanceIdentifier,
    });

    return result;
  }

  /**
   * Create RDS instance
   */
  async createInstance(
    connection: AWSConnectionDocument,
    params: {
      dbInstanceIdentifier: string;
      dbInstanceClass: string;
      engine: string;
      masterUsername: string;
      masterUserPassword: string;
      allocatedStorage: number;
      region?: string;
    },
  ): Promise<{ dbInstanceIdentifier: string; status: string }> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'rds', action: 'CreateDBInstance', region: params.region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const client = await this.getClient(connection, params.region);

    const command = new CreateDBInstanceCommand({
      DBInstanceIdentifier: params.dbInstanceIdentifier,
      DBInstanceClass: params.dbInstanceClass,
      Engine: params.engine,
      MasterUsername: params.masterUsername,
      MasterUserPassword: params.masterUserPassword,
      AllocatedStorage: params.allocatedStorage,
      // Security defaults
      BackupRetentionPeriod: 7,
      MultiAZ: false,
      PubliclyAccessible: false,
      StorageEncrypted: true,
    });

    const response = await client.send(command);

    const result = {
      dbInstanceIdentifier:
        response.DBInstance?.DBInstanceIdentifier ||
        params.dbInstanceIdentifier,
      status: response.DBInstance?.DBInstanceStatus || 'creating',
    };

    this.logger.log('RDS instance created', {
      connectionId: connection._id.toString(),
      region: params.region || 'default',
      dbInstanceIdentifier: params.dbInstanceIdentifier,
      dbInstanceClass: params.dbInstanceClass,
      engine: params.engine,
    });

    return result;
  }

  /**
   * Get RDS instance details
   */
  async getInstanceDetails(
    connection: AWSConnectionDocument,
    dbInstanceIdentifier: string,
    region?: string,
  ): Promise<RDSDatabase | null> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'rds', action: 'DescribeDBInstances', region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const client = await this.getClient(connection, region);

    const command = new DescribeDBInstancesCommand({
      DBInstanceIdentifier: dbInstanceIdentifier,
    });

    const response = await client.send(command);

    if (!response.DBInstances?.length) {
      return null;
    }

    const instance = response.DBInstances[0];

    return {
      dbInstanceIdentifier: instance.DBInstanceIdentifier || '',
      dbInstanceClass: instance.DBInstanceClass || '',
      engine: instance.Engine || '',
      engineVersion: instance.EngineVersion || '',
      dbInstanceStatus: instance.DBInstanceStatus || '',
      masterUsername: instance.MasterUsername || '',
      allocatedStorage: instance.AllocatedStorage || 0,
      availabilityZone: instance.AvailabilityZone || '',
      backupRetentionPeriod: instance.BackupRetentionPeriod || 0,
      multiAZ: instance.MultiAZ || false,
      publiclyAccessible: instance.PubliclyAccessible || false,
      vpcId: instance.DBSubnetGroup?.VpcId,
      dbSubnetGroupName: instance.DBSubnetGroup?.DBSubnetGroupName,
    };
  }

  /**
   * Format databases for chat response
   */
  formatDatabasesForChat(databases: RDSDatabase[]): string {
    if (databases.length === 0) {
      return 'No RDS instances found.';
    }

    let message = `🗄️ **RDS Instances (${databases.length})**\n\n`;

    for (const db of databases.slice(0, 10)) {
      // Limit to first 10
      const stateEmoji =
        db.dbInstanceStatus === 'available'
          ? '🟢'
          : db.dbInstanceStatus === 'stopped'
            ? '🔴'
            : '🟡';

      message += `${stateEmoji} **${db.dbInstanceIdentifier}**\n`;
      message += `   Engine: ${db.engine} ${db.engineVersion}\n`;
      message += `   Class: ${db.dbInstanceClass}\n`;
      message += `   Status: ${db.dbInstanceStatus}\n`;
      message += `   Storage: ${db.allocatedStorage} GB\n`;

      if (db.multiAZ) {
        message += `   Multi-AZ: Yes\n`;
      }

      if (db.publiclyAccessible) {
        message += `   ⚠️ Publicly accessible\n`;
      }

      message += '\n';
    }

    if (databases.length > 10) {
      message += `*... and ${databases.length - 10} more instances*`;
    }

    return message;
  }

  /**
   * Get RDS engine options
   */
  getSupportedEngines(): Array<{ engine: string; description: string }> {
    return [
      { engine: 'mysql', description: 'MySQL Community Edition' },
      { engine: 'postgres', description: 'PostgreSQL' },
      { engine: 'mariadb', description: 'MariaDB' },
      {
        engine: 'oracle-ee',
        description: 'Oracle Database Enterprise Edition',
      },
      {
        engine: 'oracle-se2',
        description: 'Oracle Database Standard Edition 2',
      },
      {
        engine: 'sqlserver-ee',
        description: 'Microsoft SQL Server Enterprise Edition',
      },
      {
        engine: 'sqlserver-se',
        description: 'Microsoft SQL Server Standard Edition',
      },
      {
        engine: 'sqlserver-ex',
        description: 'Microsoft SQL Server Express Edition',
      },
    ];
  }

  /**
   * Get RDS instance class options
   */
  getInstanceClasses(): Array<{
    class: string;
    description: string;
    vcpu: number;
    memory: string;
  }> {
    return [
      {
        class: 'db.t3.micro',
        description: 'Burstable, general purpose',
        vcpu: 2,
        memory: '1 GiB',
      },
      {
        class: 'db.t3.small',
        description: 'Burstable, general purpose',
        vcpu: 2,
        memory: '2 GiB',
      },
      {
        class: 'db.t3.medium',
        description: 'Burstable, general purpose',
        vcpu: 2,
        memory: '4 GiB',
      },
      {
        class: 'db.t3.large',
        description: 'Burstable, general purpose',
        vcpu: 2,
        memory: '8 GiB',
      },
      {
        class: 'db.m6g.large',
        description: 'General purpose, Graviton2',
        vcpu: 2,
        memory: '8 GiB',
      },
      {
        class: 'db.m6g.xlarge',
        description: 'General purpose, Graviton2',
        vcpu: 4,
        memory: '16 GiB',
      },
      {
        class: 'db.r6g.large',
        description: 'Memory optimized, Graviton2',
        vcpu: 2,
        memory: '16 GiB',
      },
      {
        class: 'db.r6g.xlarge',
        description: 'Memory optimized, Graviton2',
        vcpu: 4,
        memory: '32 GiB',
      },
    ];
  }

  /**
   * Create RDS snapshot
   */
  async createSnapshot(
    connection: AWSConnectionDocument,
    dbInstanceIdentifier: string,
    snapshotIdentifier: string,
    region?: string,
  ): Promise<{ snapshotIdentifier: string; status: string; type: string }> {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'rds', action: 'CreateDBSnapshot', region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const client = await this.getClient(connection, region);

    const command = new CreateDBSnapshotCommand({
      DBInstanceIdentifier: dbInstanceIdentifier,
      DBSnapshotIdentifier: snapshotIdentifier,
    });

    const response = await client.send(command);
    const snapshot = response.DBSnapshot;

    if (!snapshot) {
      throw new Error('Failed to create DB snapshot');
    }

    this.logger.log('RDS snapshot created', {
      connectionId: connection._id.toString(),
      dbInstanceIdentifier,
      snapshotIdentifier,
      status: snapshot.Status,
      region,
    });

    return {
      snapshotIdentifier: snapshot.DBSnapshotIdentifier || snapshotIdentifier,
      status: snapshot.Status || 'creating',
      type: snapshot.SnapshotType || 'manual',
    };
  }

  /**
   * List RDS snapshots
   */
  async listSnapshots(
    connection: AWSConnectionDocument,
    dbInstanceIdentifier?: string,
    snapshotType?: 'manual' | 'automated',
    region?: string,
  ): Promise<
    Array<{
      snapshotIdentifier: string;
      dbInstanceIdentifier: string;
      status: string;
      type: string;
      snapshotCreateTime?: Date;
      allocatedStorage: number;
      engine: string;
    }>
  > {
    const validation = this.permissionBoundaryService.validateAction(
      { service: 'rds', action: 'DescribeDBSnapshots', region },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const client = await this.getClient(connection, region);

    const command = new DescribeDBSnapshotsCommand({
      DBInstanceIdentifier: dbInstanceIdentifier,
      SnapshotType: snapshotType,
    });

    const response = await client.send(command);

    const snapshots = (response.DBSnapshots || []).map((snapshot) => ({
      snapshotIdentifier: snapshot.DBSnapshotIdentifier || '',
      dbInstanceIdentifier: snapshot.DBInstanceIdentifier || '',
      status: snapshot.Status || '',
      type: snapshot.SnapshotType || '',
      snapshotCreateTime: snapshot.SnapshotCreateTime,
      allocatedStorage: snapshot.AllocatedStorage || 0,
      engine: snapshot.Engine || '',
    }));

    this.logger.log('RDS snapshots listed', {
      connectionId: connection._id.toString(),
      dbInstanceIdentifier,
      snapshotCount: snapshots.length,
      snapshotType,
      region,
    });

    return snapshots;
  }

  /**
   * Find non-production RDS instances
   */
  async findNonProductionInstances(
    connection: AWSConnectionDocument,
    region?: string,
  ): Promise<
    Array<{
      dbInstanceIdentifier: string;
      dbInstanceClass: string;
      engine: string;
      reason: string;
      estimatedMonthlySavings: number;
    }>
  > {
    const instances = await this.listInstances(connection, region);
    const targetRegion = region ?? 'us-east-1';

    const nonProdInstances: Array<{
      dbInstanceIdentifier: string;
      dbInstanceClass: string;
      engine: string;
      reason: string;
      estimatedMonthlySavings: number;
    }> = [];

    for (const instance of instances) {
      // Check for development/staging indicators
      const identifier = instance.dbInstanceIdentifier.toLowerCase();

      if (
        identifier.includes('dev') ||
        identifier.includes('staging') ||
        identifier.includes('test') ||
        identifier.includes('demo')
      ) {
        const savings = this.calculateInstanceSavings(
          instance.dbInstanceClass,
          targetRegion,
        );

        nonProdInstances.push({
          dbInstanceIdentifier: instance.dbInstanceIdentifier,
          dbInstanceClass: instance.dbInstanceClass,
          engine: instance.engine,
          reason: 'Instance identifier suggests non-production environment',
          estimatedMonthlySavings: savings,
        });
      }

      // Check for small instance classes often used for dev
      if (
        instance.dbInstanceClass.includes('micro') ||
        instance.dbInstanceClass.includes('small')
      ) {
        const savings = this.calculateInstanceSavings(
          instance.dbInstanceClass,
          targetRegion,
        );

        // Only add if not already added
        if (
          !nonProdInstances.find(
            (i) => i.dbInstanceIdentifier === instance.dbInstanceIdentifier,
          )
        ) {
          nonProdInstances.push({
            dbInstanceIdentifier: instance.dbInstanceIdentifier,
            dbInstanceClass: instance.dbInstanceClass,
            engine: instance.engine,
            reason: 'Small instance class suggests development usage',
            estimatedMonthlySavings: savings,
          });
        }
      }
    }

    this.logger.log('Non-production RDS instances identified', {
      connectionId: connection._id.toString(),
      totalInstances: instances.length,
      nonProdInstances: nonProdInstances.length,
      region,
    });

    return nonProdInstances;
  }

  /**
   * Find oversized RDS instances by analyzing CloudWatch CPU metrics
   * Identifies instances with consistently low CPU utilization that could be downsized
   */
  async findOversizedInstances(
    connection: AWSConnectionDocument,
    cpuThreshold: number = 20, // CPU utilization threshold percentage
    region?: string,
  ): Promise<
    Array<{
      dbInstanceIdentifier: string;
      dbInstanceClass: string;
      engine: string;
      averageCpuUtilization: number;
      reason: string;
      recommendedClass?: string;
      estimatedMonthlySavings: number;
    }>
  > {
    const validation = this.permissionBoundaryService.validateAction(
      {
        service: 'rds',
        action: 'DescribeDBInstances',
        region,
      },
      connection,
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const instances = await this.listInstances(connection, region);
    const oversizedInstances: Array<{
      dbInstanceIdentifier: string;
      dbInstanceClass: string;
      engine: string;
      averageCpuUtilization: number;
      reason: string;
      recommendedClass?: string;
      estimatedMonthlySavings: number;
    }> = [];

    const targetRegion = region || 'us-east-1';

    // Get CloudWatch metrics for each instance
    for (const instance of instances) {
      try {
        const credentials =
          await this.stsCredentialService.assumeRole(connection);
        const cloudWatchClient = new CloudWatchClient({
          region: targetRegion,
          credentials: {
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey,
            sessionToken: credentials.sessionToken,
          },
        });

        // Get CPU utilization for the last 7 days (hourly average)
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);

        const command = new GetMetricStatisticsCommand({
          Namespace: 'AWS/RDS',
          MetricName: 'CPUUtilization',
          Dimensions: [
            {
              Name: 'DBInstanceIdentifier',
              Value: instance.dbInstanceIdentifier,
            },
          ],
          StartTime: startTime,
          EndTime: endTime,
          Period: 3600, // 1 hour granularity
          Statistics: ['Average'],
        });

        const response = await cloudWatchClient.send(command);
        const dataPoints = response.Datapoints || [];

        if (dataPoints.length === 0) {
          this.logger.debug('No CPU metrics available for instance', {
            component: 'RdsService',
            operation: 'findOversizedInstances',
            dbInstanceIdentifier: instance.dbInstanceIdentifier,
            region: targetRegion,
          });
          continue;
        }

        // Calculate average CPU utilization
        const avgCpu =
          dataPoints.reduce((sum, dp) => sum + (dp.Average || 0), 0) /
          dataPoints.length;

        // Check if instance is underutilized
        if (avgCpu < cpuThreshold) {
          const recommendedClass = this.getRecommendedInstanceClass(
            instance.dbInstanceClass,
          );
          const estimatedSavings = this.calculateInstanceClassSavings(
            instance.dbInstanceClass,
            recommendedClass,
            targetRegion,
          );

          oversizedInstances.push({
            dbInstanceIdentifier: instance.dbInstanceIdentifier,
            dbInstanceClass: instance.dbInstanceClass,
            engine: instance.engine,
            averageCpuUtilization: avgCpu,
            reason: `Average CPU utilization is ${avgCpu.toFixed(2)}% over the last 7 days, which is below the ${cpuThreshold}% threshold`,
            recommendedClass,
            estimatedMonthlySavings: estimatedSavings,
          });

          this.logger.log('Found oversized RDS instance', {
            component: 'RdsService',
            operation: 'findOversizedInstances',
            dbInstanceIdentifier: instance.dbInstanceIdentifier,
            currentClass: instance.dbInstanceClass,
            recommendedClass,
            averageCpu: avgCpu.toFixed(2),
            estimatedMonthlySavings: estimatedSavings,
            region: targetRegion,
          });
        }
      } catch (error) {
        this.logger.warn('Failed to analyze instance metrics', {
          component: 'RdsService',
          operation: 'findOversizedInstances',
          dbInstanceIdentifier: instance.dbInstanceIdentifier,
          region: targetRegion,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue to next instance even if one fails
      }
    }

    this.logger.log('RDS oversized instances analysis completed', {
      component: 'RdsService',
      operation: 'findOversizedInstances',
      connectionId: connection._id.toString(),
      totalInstances: instances.length,
      oversizedInstances: oversizedInstances.length,
      cpuThreshold,
      region: targetRegion,
    });

    return oversizedInstances;
  }

  /**
   * Get recommended smaller instance class based on current class
   */
  private getRecommendedInstanceClass(
    currentClass: string,
  ): string | undefined {
    // Instance class sizing hierarchy (from largest to smallest for each family)
    const instanceHierarchy: Record<string, string[]> = {
      'db.r6g': [
        'db.r6g.16xlarge',
        'db.r6g.8xlarge',
        'db.r6g.4xlarge',
        'db.r6g.2xlarge',
        'db.r6g.xlarge',
        'db.r6g.large',
      ],
      'db.r6i': [
        'db.r6i.16xlarge',
        'db.r6i.8xlarge',
        'db.r6i.4xlarge',
        'db.r6i.2xlarge',
        'db.r6i.xlarge',
        'db.r6i.large',
      ],
      'db.r5': [
        'db.r5.24xlarge',
        'db.r5.16xlarge',
        'db.r5.12xlarge',
        'db.r5.8xlarge',
        'db.r5.4xlarge',
        'db.r5.2xlarge',
        'db.r5.xlarge',
        'db.r5.large',
      ],
      'db.r4': [
        'db.r4.16xlarge',
        'db.r4.8xlarge',
        'db.r4.4xlarge',
        'db.r4.2xlarge',
        'db.r4.xlarge',
        'db.r4.large',
      ],
      'db.m6g': [
        'db.m6g.16xlarge',
        'db.m6g.8xlarge',
        'db.m6g.4xlarge',
        'db.m6g.2xlarge',
        'db.m6g.xlarge',
        'db.m6g.large',
      ],
      'db.m6i': [
        'db.m6i.16xlarge',
        'db.m6i.8xlarge',
        'db.m6i.4xlarge',
        'db.m6i.2xlarge',
        'db.m6i.xlarge',
        'db.m6i.large',
      ],
      'db.m5': [
        'db.m5.24xlarge',
        'db.m5.16xlarge',
        'db.m5.12xlarge',
        'db.m5.8xlarge',
        'db.m5.4xlarge',
        'db.m5.2xlarge',
        'db.m5.xlarge',
        'db.m5.large',
      ],
      'db.m4': [
        'db.m4.16xlarge',
        'db.m4.10xlarge',
        'db.m4.4xlarge',
        'db.m4.2xlarge',
        'db.m4.xlarge',
        'db.m4.large',
      ],
      'db.t4g': [
        'db.t4g.2xlarge',
        'db.t4g.xlarge',
        'db.t4g.large',
        'db.t4g.medium',
        'db.t4g.micro',
        'db.t4g.small',
      ],
      'db.t3': [
        'db.t3.2xlarge',
        'db.t3.xlarge',
        'db.t3.large',
        'db.t3.medium',
        'db.t3.micro',
        'db.t3.small',
      ],
      'db.t2': [
        'db.t2.2xlarge',
        'db.t2.xlarge',
        'db.t2.large',
        'db.t2.medium',
        'db.t2.micro',
        'db.t2.small',
      ],
    };

    // Find the instance family
    let family: string | undefined;
    for (const key of Object.keys(instanceHierarchy)) {
      if (currentClass.startsWith(key)) {
        family = key;
        break;
      }
    }

    if (!family) {
      return undefined;
    }

    const hierarchy = instanceHierarchy[family];
    const currentIndex = hierarchy.indexOf(currentClass);

    if (currentIndex === -1 || currentIndex >= hierarchy.length - 1) {
      return undefined;
    }

    // Recommend the next smaller size
    return hierarchy[currentIndex + 1];
  }

  /**
   * Calculate estimated monthly savings from downsizing.
   * Uses AwsPricingService for consistent pricing.
   */
  private calculateInstanceClassSavings(
    currentClass: string,
    recommendedClass?: string,
    region: string = 'us-east-1',
  ): number {
    if (!recommendedClass) return 0;

    const current = this.awsPricingService.getFallbackPricing(
      'AmazonRDS',
      currentClass,
      region,
    );
    const recommended = this.awsPricingService.getFallbackPricing(
      'AmazonRDS',
      recommendedClass,
      region,
    );

    const currentHourly = current.pricePerHour ?? 0.5;
    const recommendedHourly = recommended.pricePerHour ?? currentHourly * 0.5;
    const hourlySavings = currentHourly - recommendedHourly;
    const monthlySavings = hourlySavings * 730;

    return Math.round(monthlySavings * 100) / 100;
  }

  /**
   * Calculate monthly savings from stopping a non-production instance.
   * Uses AwsPricingService; stopping saves full compute cost (storage continues).
   */
  private calculateInstanceSavings(
    instanceClass: string,
    region: string = 'us-east-1',
  ): number {
    const pricing = this.awsPricingService.getFallbackPricing(
      'AmazonRDS',
      instanceClass,
      region,
    );
    const hourlyRate = pricing.pricePerHour ?? 0.1;
    return Math.round(hourlyRate * 730 * 100) / 100;
  }
}
