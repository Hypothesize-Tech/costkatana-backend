/**
 * Default Resource Configuration Service
 * 
 * Manages default infrastructure (VPC, subnets, security groups, IAM roles)
 * for AWS accounts. Caches commonly used resources per connection.
 */

import { EC2Client, DescribeVpcsCommand, DescribeSubnetsCommand, DescribeSecurityGroupsCommand, CreateSecurityGroupCommand, AuthorizeSecurityGroupIngressCommand, DescribeKeyPairsCommand, CreateKeyPairCommand } from '@aws-sdk/client-ec2';
import { IAMClient, GetRoleCommand } from '@aws-sdk/client-iam';
import { RDSClient, DescribeDBSubnetGroupsCommand, CreateDBSubnetGroupCommand } from '@aws-sdk/client-rds';
import { loggingService } from '../logging.service';
import { stsCredentialService } from './stsCredential.service';
import { IAWSConnection } from '../../models/AWSConnection';
import { DefaultResourceConfig } from '../../types/awsResourceCreation.types';

class DefaultResourceConfigService {
  private static instance: DefaultResourceConfigService;
  private configCache = new Map<string, DefaultResourceConfig>();
  private cacheExpiry = 3600000; // 1 hour

  private constructor() {}

  public static getInstance(): DefaultResourceConfigService {
    if (!DefaultResourceConfigService.instance) {
      DefaultResourceConfigService.instance = new DefaultResourceConfigService();
    }
    return DefaultResourceConfigService.instance;
  }

  /**
   * Get or create default resources for a region
   */
  public async getDefaultConfig(
    connection: IAWSConnection,
    region: string
  ): Promise<DefaultResourceConfig> {
    const cacheKey = `${connection._id.toString()}-${region}`;

    // Check cache
    const cached = this.configCache.get(cacheKey);
    if (cached && Date.now() - cached.lastUpdated.getTime() < this.cacheExpiry) {
      return cached;
    }

    try {
      const config: DefaultResourceConfig = {
        region,
        lastUpdated: new Date(),
      };

      // Get or create VPC
      config.vpcId = await this.getOrCreateDefaultVPC(connection, region);

      // Get or create subnets
      config.subnetIds = await this.getOrCreateDefaultSubnets(connection, region, config.vpcId);

      // Get or create security group
      config.securityGroupId = await this.getOrCreateDefaultSecurityGroup(connection, region, config.vpcId);

      // Get or create IAM roles
      config.iamRoles = await this.getOrCreateDefaultIAMRoles(connection);

      // Get or create key pair
      config.keyPairName = await this.getOrCreateDefaultKeyPair(connection, region);

      // Get or create DB subnet group
      config.dbSubnetGroupName = await this.getOrCreateDefaultDBSubnetGroup(connection, region, config.subnetIds);

      // Cache the config
      this.configCache.set(cacheKey, config);

      loggingService.info('Default resource config retrieved/created', {
        component: 'DefaultResourceConfigService',
        connectionId: connection._id.toString(),
        region,
        vpcId: config.vpcId,
        subnetCount: config.subnetIds?.length,
      });

      return config;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      loggingService.error('Failed to get default resource config', {
        component: 'DefaultResourceConfigService',
        connectionId: connection._id.toString(),
        region,
        error: errorMessage,
      });
      throw error;
    }
  }

  /**
   * Get or create default VPC
   */
  private async getOrCreateDefaultVPC(
    connection: IAWSConnection,
    region: string
  ): Promise<string> {
    const credentials = await stsCredentialService.assumeRole(connection);
    const ec2Client = new EC2Client({
      region,
      credentials: {
        accessKeyId: credentials.credentials.accessKeyId,
        secretAccessKey: credentials.credentials.secretAccessKey,
        sessionToken: credentials.credentials.sessionToken,
      },
    });

    try {
      // Check if default VPC exists
      const describeCommand = new DescribeVpcsCommand({
        Filters: [{ Name: 'isDefault', Values: ['true'] }],
      });

      const response = await ec2Client.send(describeCommand);

      if (response.Vpcs && response.Vpcs.length > 0 && response.Vpcs[0].VpcId) {
        return response.Vpcs[0].VpcId;
      }

      // If no default VPC, use first available VPC
      const allVpcsCommand = new DescribeVpcsCommand({});
      const allVpcsResponse = await ec2Client.send(allVpcsCommand);

      if (allVpcsResponse.Vpcs && allVpcsResponse.Vpcs.length > 0 && allVpcsResponse.Vpcs[0].VpcId) {
        return allVpcsResponse.Vpcs[0].VpcId;
      }

      throw new Error('No VPC found in region');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      loggingService.error('Failed to get default VPC', {
        component: 'DefaultResourceConfigService',
        region,
        error: errorMessage,
      });
      throw error;
    }
  }

  /**
   * Get or create default subnets
   */
  private async getOrCreateDefaultSubnets(
    connection: IAWSConnection,
    region: string,
    vpcId: string
  ): Promise<string[]> {
    const credentials = await stsCredentialService.assumeRole(connection);
    const ec2Client = new EC2Client({
      region,
      credentials: {
        accessKeyId: credentials.credentials.accessKeyId,
        secretAccessKey: credentials.credentials.secretAccessKey,
        sessionToken: credentials.credentials.sessionToken,
      },
    });

    try {
      const command = new DescribeSubnetsCommand({
        Filters: [{ Name: 'vpc-id', Values: [vpcId] }],
      });

      const response = await ec2Client.send(command);

      if (response.Subnets && response.Subnets.length >= 2) {
        // Return first 2 subnets (for multi-AZ support)
        return response.Subnets.slice(0, 2)
          .map(s => s.SubnetId)
          .filter((id): id is string => !!id);
      }

      if (response.Subnets && response.Subnets.length > 0) {
        return response.Subnets
          .map(s => s.SubnetId)
          .filter((id): id is string => !!id);
      }

      throw new Error('No subnets found in VPC');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      loggingService.error('Failed to get default subnets', {
        component: 'DefaultResourceConfigService',
        region,
        vpcId,
        error: errorMessage,
      });
      throw error;
    }
  }

  /**
   * Get or create default security group
   */
  private async getOrCreateDefaultSecurityGroup(
    connection: IAWSConnection,
    region: string,
    vpcId: string
  ): Promise<string> {
    const credentials = await stsCredentialService.assumeRole(connection);
    const ec2Client = new EC2Client({
      region,
      credentials: {
        accessKeyId: credentials.credentials.accessKeyId,
        secretAccessKey: credentials.credentials.secretAccessKey,
        sessionToken: credentials.credentials.sessionToken,
      },
    });

    try {
      // Check if CostKatana security group exists
      const describeCommand = new DescribeSecurityGroupsCommand({
        Filters: [
          { Name: 'vpc-id', Values: [vpcId] },
          { Name: 'group-name', Values: ['costkatana-default'] },
        ],
      });

      const response = await ec2Client.send(describeCommand);

      if (response.SecurityGroups && response.SecurityGroups.length > 0 && response.SecurityGroups[0].GroupId) {
        return response.SecurityGroups[0].GroupId;
      }

      // Create new security group
      const createCommand = new CreateSecurityGroupCommand({
        GroupName: 'costkatana-default',
        Description: 'Default security group for CostKatana resources',
        VpcId: vpcId,
      });

      const createResponse = await ec2Client.send(createCommand);

      if (!createResponse.GroupId) {
        throw new Error('Failed to create security group');
      }

      // Add SSH ingress rule (allow from anywhere for now - user can restrict)
      const ingressCommand = new AuthorizeSecurityGroupIngressCommand({
        GroupId: createResponse.GroupId,
        IpPermissions: [
          {
            IpProtocol: 'tcp',
            FromPort: 22,
            ToPort: 22,
            IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'SSH access' }],
          },
          {
            IpProtocol: 'tcp',
            FromPort: 443,
            ToPort: 443,
            IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'HTTPS access' }],
          },
          {
            IpProtocol: 'tcp',
            FromPort: 80,
            ToPort: 80,
            IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'HTTP access' }],
          },
        ],
      });

      await ec2Client.send(ingressCommand);

      loggingService.info('Created default security group', {
        component: 'DefaultResourceConfigService',
        groupId: createResponse.GroupId,
        vpcId,
      });

      return createResponse.GroupId;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      loggingService.error('Failed to get/create default security group', {
        component: 'DefaultResourceConfigService',
        region,
        vpcId,
        error: errorMessage,
      });
      throw error;
    }
  }

  /**
   * Get or create default IAM roles
   */
  private async getOrCreateDefaultIAMRoles(
    connection: IAWSConnection
  ): Promise<{ ec2InstanceProfile?: string; lambdaExecutionRole?: string; rdsEnhancedMonitoringRole?: string }> {
    const credentials = await stsCredentialService.assumeRole(connection);
    const iamClient = new IAMClient({
      credentials: {
        accessKeyId: credentials.credentials.accessKeyId,
        secretAccessKey: credentials.credentials.secretAccessKey,
        sessionToken: credentials.credentials.sessionToken,
      },
    });

    const roles: { ec2InstanceProfile?: string; lambdaExecutionRole?: string; rdsEnhancedMonitoringRole?: string } = {};

    try {
      // EC2 Instance Profile
      try {
        const ec2RoleCommand = new GetRoleCommand({ RoleName: 'CostKatanaEC2Role' });
        const ec2RoleResponse = await iamClient.send(ec2RoleCommand);
        if (ec2RoleResponse.Role?.Arn) {
          roles.ec2InstanceProfile = ec2RoleResponse.Role.Arn;
        }
      } catch (error) {
        // Role doesn't exist, will be created on demand
      }

      // Lambda Execution Role
      try {
        const lambdaRoleCommand = new GetRoleCommand({ RoleName: 'CostKatanaLambdaExecutionRole' });
        const lambdaRoleResponse = await iamClient.send(lambdaRoleCommand);
        if (lambdaRoleResponse.Role?.Arn) {
          roles.lambdaExecutionRole = lambdaRoleResponse.Role.Arn;
        }
      } catch (error) {
        // Role doesn't exist, will be created on demand
      }

      return roles;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      loggingService.error('Failed to get default IAM roles', {
        component: 'DefaultResourceConfigService',
        error: errorMessage,
      });
      throw error;
    }
  }

  /**
   * Get or create default key pair
   */
  private async getOrCreateDefaultKeyPair(
    connection: IAWSConnection,
    region: string
  ): Promise<string> {
    const credentials = await stsCredentialService.assumeRole(connection);
    const ec2Client = new EC2Client({
      region,
      credentials: {
        accessKeyId: credentials.credentials.accessKeyId,
        secretAccessKey: credentials.credentials.secretAccessKey,
        sessionToken: credentials.credentials.sessionToken,
      },
    });

    try {
      // Check if CostKatana key pair exists
      const describeCommand = new DescribeKeyPairsCommand({
        KeyNames: ['costkatana-default'],
      });

      try {
        const response = await ec2Client.send(describeCommand);
        if (response.KeyPairs && response.KeyPairs.length > 0 && response.KeyPairs[0].KeyName) {
          return response.KeyPairs[0].KeyName;
        }
      } catch (error) {
        // Key pair doesn't exist, create it
      }

      // Create new key pair
      const createCommand = new CreateKeyPairCommand({
        KeyName: 'costkatana-default',
        KeyType: 'rsa',
      });

      const createResponse = await ec2Client.send(createCommand);

      if (!createResponse.KeyName) {
        throw new Error('Failed to create key pair');
      }

      loggingService.info('Created default key pair', {
        component: 'DefaultResourceConfigService',
        keyName: createResponse.KeyName,
        region,
      });

      return createResponse.KeyName;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      loggingService.error('Failed to get/create default key pair', {
        component: 'DefaultResourceConfigService',
        region,
        error: errorMessage,
      });
      throw error;
    }
  }

  /**
   * Get or create default DB subnet group
   */
  private async getOrCreateDefaultDBSubnetGroup(
    connection: IAWSConnection,
    region: string,
    subnetIds: string[]
  ): Promise<string> {
    const credentials = await stsCredentialService.assumeRole(connection);
    const rdsClient = new RDSClient({
      region,
      credentials: {
        accessKeyId: credentials.credentials.accessKeyId,
        secretAccessKey: credentials.credentials.secretAccessKey,
        sessionToken: credentials.credentials.sessionToken,
      },
    });

    try {
      // Check if CostKatana DB subnet group exists
      const describeCommand = new DescribeDBSubnetGroupsCommand({
        DBSubnetGroupName: 'costkatana-default',
      });

      try {
        const response = await rdsClient.send(describeCommand);
        if (response.DBSubnetGroups && response.DBSubnetGroups.length > 0 && response.DBSubnetGroups[0].DBSubnetGroupName) {
          return response.DBSubnetGroups[0].DBSubnetGroupName;
        }
      } catch (error) {
        // Subnet group doesn't exist, create it
      }

      // Create new DB subnet group
      const createCommand = new CreateDBSubnetGroupCommand({
        DBSubnetGroupName: 'costkatana-default',
        DBSubnetGroupDescription: 'Default DB subnet group for CostKatana resources',
        SubnetIds: subnetIds,
      });

      const createResponse = await rdsClient.send(createCommand);

      if (!createResponse.DBSubnetGroup?.DBSubnetGroupName) {
        throw new Error('Failed to create DB subnet group');
      }

      loggingService.info('Created default DB subnet group', {
        component: 'DefaultResourceConfigService',
        groupName: createResponse.DBSubnetGroup.DBSubnetGroupName,
        region,
      });

      return createResponse.DBSubnetGroup.DBSubnetGroupName;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      loggingService.error('Failed to get/create default DB subnet group', {
        component: 'DefaultResourceConfigService',
        region,
        error: errorMessage,
      });
      throw error;
    }
  }

  /**
   * Clear cache for a connection
   */
  public clearCache(connectionId: string): void {
    const keysToDelete: string[] = [];
    for (const key of this.configCache.keys()) {
      if (key.startsWith(connectionId)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => this.configCache.delete(key));
  }
}

export const defaultResourceConfigService = DefaultResourceConfigService.getInstance();
