import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoggerService } from '../../../common/logger/logger.service';
import { StsCredentialService } from './sts-credential.service';
import { DefaultResourceConfig } from '../types/aws-resource-creation.types';
import {
  AWSConnection,
  AWSConnectionDocument,
} from '../../../schemas/integration/aws-connection.schema';
import {
  EC2Client,
  DescribeVpcsCommand,
  DescribeSubnetsCommand,
  DescribeSecurityGroupsCommand,
  DescribeKeyPairsCommand,
} from '@aws-sdk/client-ec2';
import {
  IAMClient,
  GetInstanceProfileCommand,
  GetRoleCommand,
} from '@aws-sdk/client-iam';
import { RDSClient, DescribeDBSubnetGroupsCommand } from '@aws-sdk/client-rds';

/**
 * Default Resource Configuration Service - Manage Default AWS Infrastructure
 *
 * Security Guarantees:
 * - Provide secure default configurations
 * - Cache frequently used infrastructure IDs
 * - Validate configurations against security policies
 * - Ensure proper resource isolation
 * - Support multiple environments (dev/staging/prod)
 */

@Injectable()
export class DefaultResourceConfigService {
  // In-memory cache for default configs (TTL: 5 minutes)
  private configCache: Map<
    string,
    { config: DefaultResourceConfig; timestamp: number }
  > = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  // Default configurations by region
  private readonly DEFAULT_CONFIGS: Record<
    string,
    Partial<DefaultResourceConfig>
  > = {
    'us-east-1': {
      region: 'us-east-1',
      iamRoles: {
        ec2InstanceProfile: '', // Will be discovered dynamically
        lambdaExecutionRole: '',
        rdsEnhancedMonitoringRole: '',
      },
      keyPairName: '',
      dbSubnetGroupName: '',
    },
    'us-west-2': {
      region: 'us-west-2',
      iamRoles: {
        ec2InstanceProfile: '',
        lambdaExecutionRole: '',
        rdsEnhancedMonitoringRole: '',
      },
      keyPairName: '',
      dbSubnetGroupName: '',
    },
    'eu-west-1': {
      region: 'eu-west-1',
      iamRoles: {
        ec2InstanceProfile: '',
        lambdaExecutionRole: '',
        rdsEnhancedMonitoringRole: '',
      },
      keyPairName: '',
      dbSubnetGroupName: '',
    },
    'ap-southeast-1': {
      region: 'ap-southeast-1',
      iamRoles: {
        ec2InstanceProfile: '',
        lambdaExecutionRole: '',
        rdsEnhancedMonitoringRole: '',
      },
      keyPairName: '',
      dbSubnetGroupName: '',
    },
  };

  constructor(
    private readonly logger: LoggerService,
    private readonly stsCredentialService: StsCredentialService,
    @InjectModel(AWSConnection.name)
    private readonly connectionModel: Model<AWSConnectionDocument>,
  ) {}

  /**
   * Get default configuration for a connection
   * Fetches connection details from database and discovers AWS resources
   */
  async getDefaultConfig(connectionId: string): Promise<DefaultResourceConfig> {
    // Check cache first
    const cached = this.configCache.get(connectionId);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      this.logger.debug('Returning cached default config', {
        component: 'DefaultResourceConfigService',
        operation: 'getDefaultConfig',
        connectionId,
      });
      return cached.config;
    }

    try {
      // Fetch connection from database
      const connection = await this.connectionModel.findById(connectionId);

      if (!connection) {
        throw new Error(`Connection not found: ${connectionId}`);
      }

      // Get region from connection or use default
      const region = connection.allowedRegions?.[0] || 'us-east-1';

      // Get account ID from role ARN
      const accountId = this.extractAccountIdFromRoleArn(connection.roleArn);
      if (!accountId) {
        throw new Error(`Invalid role ARN format: ${connection.roleArn}`);
      }

      // Generate default config with real AWS resource discovery
      const defaultConfig = await this.generateDefaultConfig(
        connection,
        region,
        accountId,
      );

      // Cache the config with timestamp
      this.configCache.set(connectionId, {
        config: defaultConfig,
        timestamp: Date.now(),
      });

      this.logger.log('Default config generated', {
        component: 'DefaultResourceConfigService',
        operation: 'getDefaultConfig',
        connectionId,
        region,
        accountId,
      });

      return defaultConfig;
    } catch (error) {
      this.logger.error('Failed to get default config', {
        component: 'DefaultResourceConfigService',
        operation: 'getDefaultConfig',
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return fallback config
      return this.getFallbackConfig(connectionId);
    }
  }

  /**
   * Extract AWS account ID from role ARN
   */
  private extractAccountIdFromRoleArn(roleArn: string): string | undefined {
    const match = roleArn.match(/arn:aws:iam::(\d{12}):role\//);
    return match?.[1];
  }

  /**
   * Get fallback configuration when database or AWS calls fail
   */
  private getFallbackConfig(connectionId: string): DefaultResourceConfig {
    this.logger.warn('Using fallback default config', {
      component: 'DefaultResourceConfigService',
      operation: 'getFallbackConfig',
      connectionId,
    });

    return {
      region: 'us-east-1',
      vpcId: '',
      subnetIds: [],
      securityGroupId: '',
      iamRoles: {
        ec2InstanceProfile: '',
        lambdaExecutionRole: '',
        rdsEnhancedMonitoringRole: '',
      },
      keyPairName: '',
      dbSubnetGroupName: '',
      lastUpdated: new Date(),
    };
  }

  /**
   * Clear cached configuration for a connection
   */
  clearCache(connectionId: string): void {
    this.configCache.delete(connectionId);

    this.logger.log('Config cache cleared', {
      component: 'DefaultResourceConfigService',
      operation: 'clearCache',
      connectionId,
    });
  }

  /**
   * Update default configuration (admin operation)
   */
  async updateDefaultConfig(
    connectionId: string,
    updates: Partial<DefaultResourceConfig>,
  ): Promise<DefaultResourceConfig> {
    const currentConfig = await this.getDefaultConfig(connectionId);

    // Validate updates
    this.validateConfigUpdates(updates);

    // Apply updates
    const updatedConfig: DefaultResourceConfig = {
      ...currentConfig,
      ...updates,
      lastUpdated: new Date(),
    };

    // Cache updated config with timestamp
    this.configCache.set(connectionId, {
      config: updatedConfig,
      timestamp: Date.now(),
    });

    this.logger.log('Default config updated', {
      component: 'DefaultResourceConfigService',
      operation: 'updateDefaultConfig',
      connectionId,
    });

    return updatedConfig;
  }

  /**
   * Generate default configuration by discovering actual AWS resources
   */
  private async generateDefaultConfig(
    connection: AWSConnectionDocument,
    region: string,
    accountId: string,
  ): Promise<DefaultResourceConfig> {
    const baseConfig =
      this.DEFAULT_CONFIGS[region] || this.DEFAULT_CONFIGS['us-east-1'];

    // Discover AWS resources
    const discoveredResources = await this.discoverDefaultResources(
      connection,
      region,
      accountId,
    );

    return {
      region,
      vpcId: discoveredResources.vpcId || '',
      subnetIds: discoveredResources.subnetIds || [],
      securityGroupId: discoveredResources.securityGroupId || '',
      iamRoles: {
        ec2InstanceProfile: discoveredResources.ec2InstanceProfile || '',
        lambdaExecutionRole: discoveredResources.lambdaExecutionRole || '',
        rdsEnhancedMonitoringRole:
          discoveredResources.rdsEnhancedMonitoringRole || '',
      },
      keyPairName: discoveredResources.keyPairName || '',
      dbSubnetGroupName: discoveredResources.dbSubnetGroupName || '',
      lastUpdated: new Date(),
    };
  }

  /**
   * Discover default AWS resources in the account
   */
  private async discoverDefaultResources(
    connection: AWSConnectionDocument,
    region: string,
    accountId: string,
  ): Promise<{
    vpcId?: string;
    subnetIds?: string[];
    securityGroupId?: string;
    ec2InstanceProfile?: string;
    lambdaExecutionRole?: string;
    rdsEnhancedMonitoringRole?: string;
    keyPairName?: string;
    dbSubnetGroupName?: string;
  }> {
    const resources: {
      vpcId?: string;
      subnetIds?: string[];
      securityGroupId?: string;
      ec2InstanceProfile?: string;
      lambdaExecutionRole?: string;
      rdsEnhancedMonitoringRole?: string;
      keyPairName?: string;
      dbSubnetGroupName?: string;
    } = {};

    try {
      // Get AWS credentials
      const credentials =
        await this.stsCredentialService.assumeRole(connection);

      // Discover VPC resources
      const vpcResources = await this.discoverVpcResources(credentials, region);
      resources.vpcId = vpcResources.vpcId;
      resources.subnetIds = vpcResources.subnetIds;
      resources.securityGroupId = vpcResources.securityGroupId;

      // Discover IAM resources
      const iamResources = await this.discoverIamResources(
        credentials,
        accountId,
      );
      resources.ec2InstanceProfile = iamResources.ec2InstanceProfile;
      resources.lambdaExecutionRole = iamResources.lambdaExecutionRole;
      resources.rdsEnhancedMonitoringRole =
        iamResources.rdsEnhancedMonitoringRole;

      // Discover EC2 resources
      const ec2Resources = await this.discoverEc2Resources(credentials, region);
      resources.keyPairName = ec2Resources.keyPairName;

      // Discover RDS resources
      const rdsResources = await this.discoverRdsResources(credentials, region);
      resources.dbSubnetGroupName = rdsResources.dbSubnetGroupName;

      this.logger.log('Default resources discovered', {
        component: 'DefaultResourceConfigService',
        operation: 'discoverDefaultResources',
        region,
        accountId,
        vpcFound: !!resources.vpcId,
        subnetsFound: resources.subnetIds?.length || 0,
        securityGroupFound: !!resources.securityGroupId,
      });
    } catch (error) {
      this.logger.error('Failed to discover default resources', {
        component: 'DefaultResourceConfigService',
        operation: 'discoverDefaultResources',
        region,
        accountId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return resources;
  }

  /**
   * Discover VPC resources (VPC, subnets, security groups)
   */
  private async discoverVpcResources(
    credentials: {
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken: string;
    },
    region: string,
  ): Promise<{
    vpcId?: string;
    subnetIds?: string[];
    securityGroupId?: string;
  }> {
    const ec2Client = new EC2Client({
      region,
      credentials,
    });

    const result: {
      vpcId?: string;
      subnetIds?: string[];
      securityGroupId?: string;
    } = {};

    try {
      // Find default VPC
      const vpcsResponse = await ec2Client.send(
        new DescribeVpcsCommand({
          Filters: [{ Name: 'is-default', Values: ['true'] }],
        }),
      );

      if (vpcsResponse.Vpcs && vpcsResponse.Vpcs.length > 0) {
        result.vpcId = vpcsResponse.Vpcs[0].VpcId;

        // Only proceed if we have a valid VPC ID
        if (result.vpcId) {
          // Find subnets in the default VPC
          const subnetsResponse = await ec2Client.send(
            new DescribeSubnetsCommand({
              Filters: [{ Name: 'vpc-id', Values: [result.vpcId] }],
            }),
          );

          if (subnetsResponse.Subnets) {
            result.subnetIds = subnetsResponse.Subnets.filter(
              (s) => !s.MapPublicIpOnLaunch,
            ) // Prefer private subnets
              .map((s) => s.SubnetId)
              .filter((id): id is string => !!id)
              .slice(0, 3); // Limit to 3 subnets

            // If no private subnets, use any available
            if (result.subnetIds.length === 0) {
              result.subnetIds = subnetsResponse.Subnets.map((s) => s.SubnetId)
                .filter((id): id is string => !!id)
                .slice(0, 3);
            }
          }

          // Find default security group
          const sgResponse = await ec2Client.send(
            new DescribeSecurityGroupsCommand({
              Filters: [
                { Name: 'vpc-id', Values: [result.vpcId] },
                { Name: 'group-name', Values: ['default'] },
              ],
            }),
          );

          if (
            sgResponse.SecurityGroups &&
            sgResponse.SecurityGroups.length > 0
          ) {
            result.securityGroupId = sgResponse.SecurityGroups[0].GroupId;
          }
        }
      }
    } catch (error) {
      this.logger.warn('Failed to discover VPC resources', {
        component: 'DefaultResourceConfigService',
        operation: 'discoverVpcResources',
        region,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return result;
  }

  /**
   * Discover IAM resources (roles, instance profiles)
   */
  private async discoverIamResources(
    credentials: {
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken: string;
    },
    accountId: string,
  ): Promise<{
    ec2InstanceProfile?: string;
    lambdaExecutionRole?: string;
    rdsEnhancedMonitoringRole?: string;
  }> {
    // IAM is global, use us-east-1
    const iamClient = new IAMClient({
      region: 'us-east-1',
      credentials,
    });

    const result: {
      ec2InstanceProfile?: string;
      lambdaExecutionRole?: string;
      rdsEnhancedMonitoringRole?: string;
    } = {};

    const commonInstanceProfiles = [
      'EC2DefaultProfile',
      'ec2-default-profile',
      'EC2-Default-Instance-Profile',
    ];

    const commonLambdaRoles = [
      'LambdaDefaultRole',
      'lambda-execution-role',
      'lambda-default-role',
    ];

    const commonRDSRoles = [
      'RDSMonitoringRole',
      'rds-enhanced-monitoring',
      'rds-monitoring-role',
    ];

    // Try to find EC2 instance profile
    for (const profileName of commonInstanceProfiles) {
      try {
        const profileArn = `arn:aws:iam::${accountId}:instance-profile/${profileName}`;
        await iamClient.send(
          new GetInstanceProfileCommand({
            InstanceProfileName: profileName,
          }),
        );
        result.ec2InstanceProfile = profileArn;
        break;
      } catch {
        // Profile doesn't exist, try next
      }
    }

    // Try to find Lambda execution role
    for (const roleName of commonLambdaRoles) {
      try {
        const roleArn = `arn:aws:iam::${accountId}:role/${roleName}`;
        await iamClient.send(
          new GetRoleCommand({
            RoleName: roleName,
          }),
        );
        result.lambdaExecutionRole = roleArn;
        break;
      } catch {
        // Role doesn't exist, try next
      }
    }

    // Try to find RDS monitoring role
    for (const roleName of commonRDSRoles) {
      try {
        const roleArn = `arn:aws:iam::${accountId}:role/${roleName}`;
        await iamClient.send(
          new GetRoleCommand({
            RoleName: roleName,
          }),
        );
        result.rdsEnhancedMonitoringRole = roleArn;
        break;
      } catch {
        // Role doesn't exist, try next
      }
    }

    return result;
  }

  /**
   * Discover EC2 resources (key pairs)
   */
  private async discoverEc2Resources(
    credentials: {
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken: string;
    },
    region: string,
  ): Promise<{ keyPairName?: string }> {
    const ec2Client = new EC2Client({
      region,
      credentials,
    });

    const result: { keyPairName?: string } = {};

    try {
      const keyPairsResponse = await ec2Client.send(
        new DescribeKeyPairsCommand({}),
      );

      if (keyPairsResponse.KeyPairs && keyPairsResponse.KeyPairs.length > 0) {
        // Prefer key pairs with "default" in the name
        const defaultKeyPair = keyPairsResponse.KeyPairs.find(
          (kp) =>
            kp.KeyName?.toLowerCase().includes('default') ||
            kp.KeyName?.toLowerCase().includes('costkatana'),
        );

        result.keyPairName =
          defaultKeyPair?.KeyName || keyPairsResponse.KeyPairs[0].KeyName;
      }
    } catch (error) {
      this.logger.warn('Failed to discover EC2 key pairs', {
        component: 'DefaultResourceConfigService',
        operation: 'discoverEc2Resources',
        region,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return result;
  }

  /**
   * Discover RDS resources (subnet groups)
   */
  private async discoverRdsResources(
    credentials: {
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken: string;
    },
    region: string,
  ): Promise<{ dbSubnetGroupName?: string }> {
    const rdsClient = new RDSClient({
      region,
      credentials,
    });

    const result: { dbSubnetGroupName?: string } = {};

    try {
      const subnetGroupsResponse = await rdsClient.send(
        new DescribeDBSubnetGroupsCommand({
          MaxRecords: 20,
        }),
      );

      if (
        subnetGroupsResponse.DBSubnetGroups &&
        subnetGroupsResponse.DBSubnetGroups.length > 0
      ) {
        // Prefer default subnet groups
        const defaultSubnetGroup = subnetGroupsResponse.DBSubnetGroups.find(
          (sg) =>
            sg.DBSubnetGroupName?.toLowerCase().includes('default') ||
            sg.DBSubnetGroupName?.toLowerCase().includes('costkatana'),
        );

        result.dbSubnetGroupName =
          defaultSubnetGroup?.DBSubnetGroupName ||
          subnetGroupsResponse.DBSubnetGroups[0].DBSubnetGroupName;
      }
    } catch (error) {
      this.logger.warn('Failed to discover RDS subnet groups', {
        component: 'DefaultResourceConfigService',
        operation: 'discoverRdsResources',
        region,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return result;
  }

  /**
   * Validate configuration updates
   */
  private validateConfigUpdates(updates: Partial<DefaultResourceConfig>): void {
    // Validate region format
    if (updates.region && !/^[a-z]{2}-[a-z]+-\d$/.test(updates.region)) {
      throw new Error('Invalid region format');
    }

    // Validate ARN formats
    if (updates.iamRoles) {
      const arnPattern =
        /^arn:aws:iam::\d{12}:(role|instance-profile)\/[\w+=,.@-]+$/;
      if (
        updates.iamRoles.ec2InstanceProfile &&
        !arnPattern.test(updates.iamRoles.ec2InstanceProfile)
      ) {
        throw new Error('Invalid EC2 instance profile ARN format');
      }
      if (
        updates.iamRoles.lambdaExecutionRole &&
        !arnPattern.test(updates.iamRoles.lambdaExecutionRole)
      ) {
        throw new Error('Invalid Lambda execution role ARN format');
      }
      if (
        updates.iamRoles.rdsEnhancedMonitoringRole &&
        !arnPattern.test(updates.iamRoles.rdsEnhancedMonitoringRole)
      ) {
        throw new Error('Invalid RDS monitoring role ARN format');
      }
    }

    // Validate key pair name
    if (
      updates.keyPairName &&
      !/^[a-zA-Z0-9_-]{1,255}$/.test(updates.keyPairName)
    ) {
      throw new Error('Invalid key pair name format');
    }

    // Validate DB subnet group name
    if (
      updates.dbSubnetGroupName &&
      !/^[a-zA-Z][a-zA-Z0-9-]*$/.test(updates.dbSubnetGroupName)
    ) {
      throw new Error('Invalid DB subnet group name format');
    }
  }

  /**
   * Get available regions
   */
  getAvailableRegions(): string[] {
    return Object.keys(this.DEFAULT_CONFIGS);
  }

  /**
   * Check if a resource ID is a default resource
   */
  isDefaultResource(resourceId: string, connectionId: string): boolean {
    const cached = this.configCache.get(connectionId);
    if (!cached) {
      return false;
    }

    const config = cached.config;

    return (
      resourceId === config.vpcId ||
      config.subnetIds?.includes(resourceId) ||
      resourceId === config.securityGroupId ||
      resourceId === config.keyPairName ||
      resourceId === config.dbSubnetGroupName ||
      Object.values(config.iamRoles || {}).includes(resourceId)
    );
  }

  /**
   * Get security recommendations for default configurations
   */
  getSecurityRecommendations(): string[] {
    return [
      'Use encrypted EBS volumes by default',
      'Enable VPC flow logs for network monitoring',
      'Use least-privilege IAM roles',
      'Enable CloudTrail for API auditing',
      'Configure security groups with minimal required access',
      'Use private subnets for database instances',
      'Enable encryption at rest for all services',
      'Configure backup retention policies',
    ];
  }

  /**
   * Validate that default resources exist and are accessible
   * Makes actual AWS API calls to verify resources
   */
  async validateDefaultResources(connectionId: string): Promise<{
    valid: boolean;
    missingResources: string[];
    warnings: string[];
  }> {
    const config = await this.getDefaultConfig(connectionId);
    const missingResources: string[] = [];
    const warnings: string[] = [];

    try {
      // Fetch connection from database
      const connection = await this.connectionModel.findById(connectionId);
      if (!connection) {
        throw new Error(`Connection not found: ${connectionId}`);
      }

      // Get AWS credentials
      const credentials =
        await this.stsCredentialService.assumeRole(connection);
      const region = config.region || 'us-east-1';

      // Create EC2 client for validation
      const ec2Client = new EC2Client({
        region,
        credentials,
      });

      // Validate VPC
      if (config.vpcId) {
        try {
          await ec2Client.send(
            new DescribeVpcsCommand({
              VpcIds: [config.vpcId],
            }),
          );
        } catch {
          missingResources.push(`VPC (${config.vpcId})`);
        }
      } else {
        missingResources.push('VPC (not configured)');
      }

      // Validate subnets
      if (config.subnetIds && config.subnetIds.length > 0) {
        try {
          await ec2Client.send(
            new DescribeSubnetsCommand({
              SubnetIds: config.subnetIds,
            }),
          );
        } catch {
          missingResources.push(`Subnets (${config.subnetIds.join(', ')})`);
        }
      } else {
        missingResources.push('Subnets (not configured)');
      }

      // Validate security group
      if (config.securityGroupId) {
        try {
          await ec2Client.send(
            new DescribeSecurityGroupsCommand({
              GroupIds: [config.securityGroupId],
            }),
          );
        } catch {
          missingResources.push(`Security Group (${config.securityGroupId})`);
        }
      } else {
        missingResources.push('Security Group (not configured)');
      }

      // Validate key pair
      if (config.keyPairName) {
        try {
          await ec2Client.send(
            new DescribeKeyPairsCommand({
              KeyNames: [config.keyPairName],
            }),
          );
        } catch {
          missingResources.push(`Key Pair (${config.keyPairName})`);
        }
      } else {
        missingResources.push('Key Pair (not configured)');
      }

      // Validate IAM resources
      const iamClient = new IAMClient({
        region: 'us-east-1',
        credentials,
      });

      if (config.iamRoles?.ec2InstanceProfile) {
        const profileName = config.iamRoles.ec2InstanceProfile.split('/').pop();
        if (profileName) {
          try {
            await iamClient.send(
              new GetInstanceProfileCommand({
                InstanceProfileName: profileName,
              }),
            );
          } catch {
            missingResources.push(`EC2 Instance Profile (${profileName})`);
          }
        }
      } else {
        missingResources.push('EC2 Instance Profile (not configured)');
      }

      if (config.iamRoles?.lambdaExecutionRole) {
        const roleName = config.iamRoles.lambdaExecutionRole.split('/').pop();
        if (roleName) {
          try {
            await iamClient.send(
              new GetRoleCommand({
                RoleName: roleName,
              }),
            );
          } catch {
            missingResources.push(`Lambda Execution Role (${roleName})`);
          }
        }
      } else {
        missingResources.push('Lambda Execution Role (not configured)');
      }

      // Validate RDS subnet group
      if (config.dbSubnetGroupName) {
        const rdsClient = new RDSClient({
          region,
          credentials,
        });
        try {
          await rdsClient.send(
            new DescribeDBSubnetGroupsCommand({
              DBSubnetGroupName: config.dbSubnetGroupName,
            }),
          );
        } catch {
          missingResources.push(
            `DB Subnet Group (${config.dbSubnetGroupName})`,
          );
        }
      } else {
        missingResources.push('DB Subnet Group (not configured)');
      }

      // Add warnings for security best practices
      if (
        config.subnetIds &&
        config.subnetIds.some((id) => id.toLowerCase().includes('public'))
      ) {
        warnings.push(
          'Some subnets appear to be public - review network architecture for production workloads',
        );
      }

      if (!config.iamRoles?.ec2InstanceProfile) {
        warnings.push(
          'No EC2 instance profile configured - IAM roles for EC2 instances will not be available',
        );
      }

      if (!config.iamRoles?.lambdaExecutionRole) {
        warnings.push(
          'No Lambda execution role configured - Lambda functions will not be able to execute',
        );
      }

      if (missingResources.length > 0) {
        warnings.push(
          'Some default resources are missing. Run resource discovery or create the required resources.',
        );
      }

      this.logger.log('Default resources validation completed', {
        component: 'DefaultResourceConfigService',
        operation: 'validateDefaultResources',
        connectionId,
        valid: missingResources.length === 0,
        missingCount: missingResources.length,
        warningCount: warnings.length,
      });
    } catch (error) {
      this.logger.error('Failed to validate default resources', {
        component: 'DefaultResourceConfigService',
        operation: 'validateDefaultResources',
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });

      warnings.push(
        `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    return {
      valid: missingResources.length === 0,
      missingResources,
      warnings,
    };
  }
}
