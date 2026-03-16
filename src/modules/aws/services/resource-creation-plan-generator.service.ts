import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { LoggerService } from '../../../common/logger/logger.service';
import { PermissionBoundaryService } from './permission-boundary.service';
import { DefaultResourceConfigService } from './default-resource-config.service';
import { AwsPricingService } from './aws-pricing.service';
import {
  ResourceCreationPlan,
  ResourceCreationStep,
  ResourceDependency,
  CostEstimate,
  RollbackStep,
  EC2CreationConfig,
  RDSCreationConfig,
  LambdaCreationConfig,
  DynamoDBCreationConfig,
  ECSCreationConfig,
  S3CreationConfig,
} from '../types/aws-resource-creation.types';

/**
 * Resource Creation Plan Generator Service - Generate Safe Resource Creation Plans
 *
 * Security Guarantees:
 * - Generate step-by-step resource creation plans
 * - Validate against permission boundaries
 * - Cost estimation and budget checks
 * - Dependency management and ordering
 * - Rollback plan generation
 * - Resource isolation and naming
 */

@Injectable()
export class ResourceCreationPlanGeneratorService {
  constructor(
    private readonly logger: LoggerService,
    private readonly permissionBoundaryService: PermissionBoundaryService,
    private readonly defaultResourceConfigService: DefaultResourceConfigService,
    private readonly awsPricingService: AwsPricingService,
  ) {}

  /**
   * Generate EC2 instance creation plan
   */
  async generateEC2Plan(
    userId: string,
    connectionId: string,
    config: EC2CreationConfig,
  ): Promise<ResourceCreationPlan> {
    const planId = `ec2-plan-${Date.now()}-${randomBytes(4).toString('hex')}`;

    // Validate permissions
    const permissionCheck = this.permissionBoundaryService.validateAction(
      {
        service: 'ec2',
        action: 'RunInstances',
        region: config.region,
      },
      { _id: connectionId, userId } as any,
    );

    if (!permissionCheck.allowed) {
      throw new Error(`Permission denied: ${permissionCheck.reason}`);
    }

    // Get default config
    const defaultConfig =
      await this.defaultResourceConfigService.getDefaultConfig(connectionId);

    // Merge with defaults
    const finalConfig = {
      instanceName: config.instanceName,
      instanceType: config.instanceType || 't3.micro',
      region: config.region || defaultConfig.region,
      vpcId: config.vpcId || defaultConfig.vpcId,
      subnetId: config.subnetId || defaultConfig.subnetIds?.[0],
      securityGroupIds:
        config.securityGroupIds ||
        [defaultConfig.securityGroupId].filter(Boolean),
      keyPairName: config.keyPairName || defaultConfig.keyPairName,
      iamInstanceProfile:
        config.iamInstanceProfile || defaultConfig.iamRoles?.ec2InstanceProfile,
      userData: config.userData,
      ebsVolumeSize: config.ebsVolumeSize || 8,
      ebsVolumeType: config.ebsVolumeType || 'gp3',
      ebsEncrypted: config.ebsEncrypted ?? true,
      monitoring: config.monitoring || 'basic',
      tags: {
        ...config.tags,
        CreatedBy: userId,
        ManagedBy: 'CostKatana',
      },
    };

    // Generate steps
    const steps: ResourceCreationStep[] = [
      {
        stepId: 'validate-prerequisites',
        order: 0,
        action: 'validate',
        description: 'Validate VPC, subnet, security group, and key pair exist',
        parameters: {
          vpcId: finalConfig.vpcId,
          subnetId: finalConfig.subnetId,
          securityGroupIds: finalConfig.securityGroupIds,
          keyPairName: finalConfig.keyPairName,
        },
        estimatedDuration: 5,
        critical: true,
      },
      {
        stepId: 'create-instance',
        order: 1,
        action: 'runInstances',
        description: `Create EC2 instance ${finalConfig.instanceName}`,
        parameters: finalConfig,
        estimatedDuration: 60,
        critical: true,
      },
      {
        stepId: 'wait-for-running',
        order: 2,
        action: 'wait',
        description: 'Wait for instance to reach running state',
        parameters: {
          instanceId: '${create-instance.instanceId}',
          state: 'running',
        },
        estimatedDuration: 120,
        critical: true,
      },
      {
        stepId: 'tag-instance',
        order: 3,
        action: 'createTags',
        description: 'Apply tags to the instance',
        parameters: {
          resourceIds: ['${create-instance.instanceId}'],
          tags: Object.entries(finalConfig.tags).map(([key, value]) => ({
            key,
            value,
          })),
        },
        estimatedDuration: 10,
        critical: false,
      },
    ];

    // Dependencies
    const dependencies: ResourceDependency[] = [
      {
        resourceType: 'vpc',
        resourceId: finalConfig.vpcId,
        action: 'verify',
        description: 'VPC must exist',
      },
      {
        resourceType: 'subnet',
        resourceId: finalConfig.subnetId,
        action: 'verify',
        description: 'Subnet must exist',
      },
      {
        resourceType: 'security-group',
        resourceId: finalConfig.securityGroupIds[0],
        action: 'verify',
        description: 'Security group must exist',
      },
    ];

    // Cost estimate
    const costEstimate = this.calculateEC2Cost(finalConfig);

    // Rollback plan
    const rollbackPlan: RollbackStep[] = [
      {
        stepId: 'terminate-instance',
        action: 'terminateInstances',
        resourceId: '${create-instance.instanceId}',
        description: 'Terminate the created instance',
      },
    ];

    const plan: ResourceCreationPlan = {
      planId,
      resourceType: 'ec2',
      resourceName: finalConfig.instanceName,
      steps,
      costEstimate,
      dependencies,
      rollbackPlan,
      estimatedDuration: steps.reduce(
        (sum, step) => sum + step.estimatedDuration,
        0,
      ),
      riskLevel: 'medium',
      warnings: this.generateEC2Warnings(finalConfig),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
    };

    this.logger.log('EC2 creation plan generated', {
      component: 'ResourceCreationPlanGeneratorService',
      operation: 'generateEC2Plan',
      planId,
      instanceName: finalConfig.instanceName,
      instanceType: finalConfig.instanceType,
      estimatedMonthlyCost: costEstimate.monthly,
    });

    return plan;
  }

  /**
   * Generate RDS instance creation plan
   */
  async generateRDSPlan(
    userId: string,
    connectionId: string,
    config: RDSCreationConfig,
  ): Promise<ResourceCreationPlan> {
    const planId = `rds-plan-${Date.now()}-${randomBytes(4).toString('hex')}`;

    // Get default config
    const defaultConfig =
      await this.defaultResourceConfigService.getDefaultConfig(connectionId);

    const finalConfig = {
      dbInstanceIdentifier: config.dbInstanceIdentifier,
      engine: config.engine,
      dbInstanceClass: config.dbInstanceClass || 'db.t3.micro',
      allocatedStorage: config.allocatedStorage || 20,
      region: config.region || defaultConfig.region,
      dbName: config.dbName,
      masterUsername: config.masterUsername || 'admin',
      masterUserPassword:
        config.masterUserPassword || this.generateSecurePassword(),
      dbSubnetGroupName:
        config.dbSubnetGroupName || defaultConfig.dbSubnetGroupName,
      vpcSecurityGroupIds:
        config.vpcSecurityGroupIds ||
        [defaultConfig.securityGroupId].filter(Boolean),
      backupRetentionPeriod: config.backupRetentionPeriod || 7,
      multiAZ: config.multiAZ || false,
      storageType: config.storageType || 'gp3',
      storageEncrypted: config.storageEncrypted ?? true,
      enableCloudwatchLogsExports: config.enableCloudwatchLogsExports || [],
      tags: {
        ...config.tags,
        CreatedBy: userId,
        ManagedBy: 'CostKatana',
      },
    };

    const steps: ResourceCreationStep[] = [
      {
        stepId: 'validate-subnet-group',
        order: 0,
        action: 'validate',
        description: 'Validate DB subnet group exists',
        parameters: {
          dbSubnetGroupName: finalConfig.dbSubnetGroupName,
        },
        estimatedDuration: 5,
        critical: true,
      },
      {
        stepId: 'create-db-instance',
        order: 1,
        action: 'createDBInstance',
        description: `Create RDS instance ${finalConfig.dbInstanceIdentifier}`,
        parameters: finalConfig,
        estimatedDuration: 600, // 10 minutes
        critical: true,
      },
      {
        stepId: 'wait-for-available',
        order: 2,
        action: 'wait',
        description: 'Wait for DB instance to be available',
        parameters: {
          dbInstanceIdentifier: finalConfig.dbInstanceIdentifier,
          state: 'available',
        },
        estimatedDuration: 600,
        critical: true,
      },
    ];

    const costEstimate = this.calculateRDSCost(finalConfig);

    const rollbackPlan: RollbackStep[] = [
      {
        stepId: 'delete-db-instance',
        action: 'deleteDBInstance',
        resourceId: finalConfig.dbInstanceIdentifier,
        description: 'Delete the created DB instance',
      },
    ];

    const plan: ResourceCreationPlan = {
      planId,
      resourceType: 'rds',
      resourceName: finalConfig.dbInstanceIdentifier,
      steps,
      costEstimate,
      dependencies: [],
      rollbackPlan,
      estimatedDuration: steps.reduce(
        (sum, step) => sum + step.estimatedDuration,
        0,
      ),
      riskLevel: 'high',
      warnings: this.generateRDSWarnings(finalConfig),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    };

    this.logger.log('RDS creation plan generated', {
      component: 'ResourceCreationPlanGeneratorService',
      operation: 'generateRDSPlan',
      planId,
      dbInstanceIdentifier: finalConfig.dbInstanceIdentifier,
      dbInstanceClass: finalConfig.dbInstanceClass,
      estimatedMonthlyCost: costEstimate.monthly,
    });

    return plan;
  }

  /**
   * Generate Lambda function creation plan
   */
  async generateLambdaPlan(
    userId: string,
    connectionId: string,
    config: LambdaCreationConfig,
  ): Promise<ResourceCreationPlan> {
    const planId = `lambda-plan-${Date.now()}-${randomBytes(4).toString('hex')}`;

    // Get default config for region
    const defaultConfig =
      await this.defaultResourceConfigService.getDefaultConfig(connectionId);
    const region = defaultConfig.region || 'us-east-1';

    // Validate permissions
    const permissionCheck = this.permissionBoundaryService.validateAction(
      {
        service: 'lambda',
        action: 'CreateFunction',
        region,
      },
      { _id: connectionId, userId } as any,
    );

    if (!permissionCheck.allowed) {
      throw new Error(`Permission denied: ${permissionCheck.reason}`);
    }

    const finalConfig = {
      functionName: config.functionName,
      runtime: config.runtime || 'nodejs20.x',
      handler: config.handler || 'index.handler',
      code: config.code,
      role: config.role,
      timeout: config.timeout || 3,
      memorySize: config.memorySize || 128,
      architecture: config.architecture || 'arm64',
      ephemeralStorage: config.ephemeralStorage || 512,
      environment: config.environment,
      vpcConfig: config.vpcConfig,
      layers: config.layers,
      tracingConfig: config.tracingConfig || 'PassThrough',
      deadLetterConfig: config.deadLetterConfig,
      tags: {
        ...config.tags,
        CreatedBy: userId,
        ManagedBy: 'CostKatana',
      },
    };

    const steps: ResourceCreationStep[] = [
      {
        stepId: 'validate-role',
        order: 0,
        action: 'validate',
        description: 'Validate IAM role exists and has proper permissions',
        parameters: {
          roleArn: finalConfig.role,
        },
        estimatedDuration: 5,
        critical: true,
      },
      {
        stepId: 'create-function',
        order: 1,
        action: 'createFunction',
        description: `Create Lambda function ${finalConfig.functionName}`,
        parameters: finalConfig as unknown as Record<string, unknown>,
        estimatedDuration: 30,
        critical: true,
      },
      {
        stepId: 'verify-function',
        order: 2,
        action: 'getFunction',
        description: 'Verify function was created successfully',
        parameters: {
          functionName: finalConfig.functionName,
        },
        estimatedDuration: 5,
        critical: false,
      },
    ];

    const costEstimate = await this.calculateLambdaCost(finalConfig);

    const plan: ResourceCreationPlan = {
      planId,
      resourceType: 'lambda',
      resourceName: finalConfig.functionName,
      steps,
      costEstimate,
      dependencies: [],
      rollbackPlan: [
        {
          stepId: 'delete-function',
          action: 'deleteFunction',
          resourceId: finalConfig.functionName,
          description: 'Delete the created Lambda function',
        },
      ],
      estimatedDuration: steps.reduce(
        (sum, step) => sum + step.estimatedDuration,
        0,
      ),
      riskLevel: 'low',
      warnings: this.generateLambdaWarnings(finalConfig),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    };

    this.logger.log('Lambda creation plan generated', {
      component: 'ResourceCreationPlanGeneratorService',
      operation: 'generateLambdaPlan',
      planId,
      functionName: finalConfig.functionName,
      runtime: finalConfig.runtime,
      estimatedMonthlyCost: costEstimate.monthly,
    });

    return plan;
  }

  /**
   * Generate DynamoDB table creation plan
   */
  async generateDynamoDBPlan(
    userId: string,
    connectionId: string,
    config: DynamoDBCreationConfig,
  ): Promise<ResourceCreationPlan> {
    const planId = `dynamodb-plan-${Date.now()}-${randomBytes(4).toString('hex')}`;

    // Get default config for region
    const defaultConfig =
      await this.defaultResourceConfigService.getDefaultConfig(connectionId);
    const region = defaultConfig.region || 'us-east-1';

    // Validate permissions
    const permissionCheck = this.permissionBoundaryService.validateAction(
      {
        service: 'dynamodb',
        action: 'CreateTable',
        region,
      },
      { _id: connectionId, userId } as any,
    );

    if (!permissionCheck.allowed) {
      throw new Error(`Permission denied: ${permissionCheck.reason}`);
    }

    const finalConfig = {
      ...config,
      region,
      billingMode: config.billingMode || 'PAY_PER_REQUEST',
      tags: {
        ...config.tags,
        CreatedBy: userId,
        ManagedBy: 'CostKatana',
      },
    };

    const steps: ResourceCreationStep[] = [
      {
        stepId: 'create-table',
        order: 0,
        action: 'createTable',
        description: `Create DynamoDB table ${config.tableName}`,
        parameters: finalConfig as unknown as Record<string, unknown>,
        estimatedDuration: 60,
        critical: true,
      },
      {
        stepId: 'wait-for-active',
        order: 1,
        action: 'wait',
        description: 'Wait for table to become active',
        parameters: {
          tableName: config.tableName,
          status: 'ACTIVE',
        },
        estimatedDuration: 60,
        critical: true,
      },
    ];

    const costEstimate = this.calculateDynamoDBCost(finalConfig);

    const plan: ResourceCreationPlan = {
      planId,
      resourceType: 'dynamodb',
      resourceName: config.tableName,
      steps,
      costEstimate,
      dependencies: [],
      rollbackPlan: [
        {
          stepId: 'delete-table',
          action: 'deleteTable',
          resourceId: config.tableName,
          description: 'Delete the created DynamoDB table',
        },
      ],
      estimatedDuration: steps.reduce(
        (sum, step) => sum + step.estimatedDuration,
        0,
      ),
      riskLevel: 'medium',
      warnings: this.generateDynamoDBWarnings(finalConfig),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    };

    this.logger.log('DynamoDB creation plan generated', {
      component: 'ResourceCreationPlanGeneratorService',
      operation: 'generateDynamoDBPlan',
      planId,
      tableName: config.tableName,
      billingMode: finalConfig.billingMode,
      estimatedMonthlyCost: costEstimate.monthly,
    });

    return plan;
  }

  /**
   * Generate ECS cluster creation plan
   */
  async generateECSPlan(
    userId: string,
    connectionId: string,
    config: ECSCreationConfig,
  ): Promise<ResourceCreationPlan> {
    const planId = `ecs-plan-${Date.now()}-${randomBytes(4).toString('hex')}`;

    // Get default config for region
    const defaultConfig =
      await this.defaultResourceConfigService.getDefaultConfig(connectionId);
    const region = config.region || defaultConfig.region || 'us-east-1';

    // Validate permissions
    const permissionCheck = this.permissionBoundaryService.validateAction(
      {
        service: 'ecs',
        action: 'CreateCluster',
        region,
      },
      { _id: connectionId, userId } as any,
    );

    if (!permissionCheck.allowed) {
      throw new Error(`Permission denied: ${permissionCheck.reason}`);
    }

    const finalConfig = {
      ...config,
      region,
      capacityProviders: config.capacityProviders || [
        'FARGATE',
        'FARGATE_SPOT',
      ],
      tags: {
        ...config.tags,
        CreatedBy: userId,
        ManagedBy: 'CostKatana',
      },
    };

    const steps: ResourceCreationStep[] = [
      {
        stepId: 'create-cluster',
        order: 0,
        action: 'createCluster',
        description: `Create ECS cluster ${config.clusterName}`,
        parameters: finalConfig as unknown as Record<string, unknown>,
        estimatedDuration: 30,
        critical: true,
      },
    ];

    const costEstimate = this.calculateECSCost(finalConfig);

    const plan: ResourceCreationPlan = {
      planId,
      resourceType: 'ecs',
      resourceName: config.clusterName,
      steps,
      costEstimate,
      dependencies: [],
      rollbackPlan: [
        {
          stepId: 'delete-cluster',
          action: 'deleteCluster',
          resourceId: config.clusterName,
          description: 'Delete the created ECS cluster',
        },
      ],
      estimatedDuration: steps.reduce(
        (sum, step) => sum + step.estimatedDuration,
        0,
      ),
      riskLevel: 'low',
      warnings: this.generateECSWarnings(finalConfig),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    };

    this.logger.log('ECS creation plan generated', {
      component: 'ResourceCreationPlanGeneratorService',
      operation: 'generateECSPlan',
      planId,
      clusterName: config.clusterName,
      capacityProviders: finalConfig.capacityProviders,
    });

    return plan;
  }

  /**
   * Generate S3 bucket creation plan
   */
  async generateS3Plan(
    userId: string,
    connectionId: string,
    config: S3CreationConfig,
  ): Promise<ResourceCreationPlan> {
    const planId = `s3-plan-${Date.now()}-${randomBytes(4).toString('hex')}`;

    // Get default config for region
    const defaultConfig =
      await this.defaultResourceConfigService.getDefaultConfig(connectionId);
    const region = config.region || defaultConfig.region || 'us-east-1';

    // Validate permissions
    const permissionCheck = this.permissionBoundaryService.validateAction(
      {
        service: 's3',
        action: 'CreateBucket',
        region,
      },
      { _id: connectionId, userId } as any,
    );

    if (!permissionCheck.allowed) {
      throw new Error(`Permission denied: ${permissionCheck.reason}`);
    }

    const finalConfig = {
      ...config,
      region,
      encryption: config.encryption || {
        enabled: true,
        sseAlgorithm: 'AES256',
      },
      blockPublicAccess: config.blockPublicAccess || {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      tags: {
        ...config.tags,
        CreatedBy: userId,
        ManagedBy: 'CostKatana',
      },
    };

    const steps: ResourceCreationStep[] = [
      {
        stepId: 'create-bucket',
        order: 0,
        action: 'createBucket',
        description: `Create S3 bucket ${config.bucketName}`,
        parameters: finalConfig as unknown as Record<string, unknown>,
        estimatedDuration: 10,
        critical: true,
      },
      {
        stepId: 'configure-encryption',
        order: 1,
        action: 'putBucketEncryption',
        description: 'Configure default encryption',
        parameters: {
          bucketName: config.bucketName,
          encryption: finalConfig.encryption,
        },
        estimatedDuration: 5,
        critical: false,
      },
      {
        stepId: 'configure-public-access-block',
        order: 2,
        action: 'putPublicAccessBlock',
        description: 'Configure public access block',
        parameters: {
          bucketName: config.bucketName,
          blockPublicAccess: finalConfig.blockPublicAccess,
        },
        estimatedDuration: 5,
        critical: false,
      },
      {
        stepId: 'configure-lifecycle',
        order: 3,
        action: 'putBucketLifecycleConfiguration',
        description: 'Configure lifecycle rules',
        parameters: {
          bucketName: config.bucketName,
          lifecycleRules: config.lifecycleRules,
        },
        estimatedDuration: 5,
        critical: false,
      },
    ];

    const costEstimate = this.calculateS3Cost(finalConfig);

    const plan: ResourceCreationPlan = {
      planId,
      resourceType: 's3',
      resourceName: config.bucketName,
      steps,
      costEstimate,
      dependencies: [],
      rollbackPlan: [
        {
          stepId: 'delete-bucket',
          action: 'deleteBucket',
          resourceId: config.bucketName,
          description: 'Delete the created S3 bucket',
        },
      ],
      estimatedDuration: steps.reduce(
        (sum, step) => sum + step.estimatedDuration,
        0,
      ),
      riskLevel: 'low',
      warnings: this.generateS3Warnings(finalConfig),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    };

    this.logger.log('S3 creation plan generated', {
      component: 'ResourceCreationPlanGeneratorService',
      operation: 'generateS3Plan',
      planId,
      bucketName: config.bucketName,
      region,
      estimatedStorageCost: costEstimate.monthly,
    });

    return plan;
  }

  // Cost calculation methods (simplified estimates)
  private calculateEC2Cost(config: any): CostEstimate {
    const hourlyRate = config.instanceType === 't3.micro' ? 0.0104 : 0.0208; // Simplified
    const monthly = hourlyRate * 24 * 30;
    return {
      hourly: hourlyRate,
      monthly,
      currency: 'USD',
      freeEligible: false,
      breakdown: [{ component: 'compute', hourly: hourlyRate, monthly }],
    };
  }

  private calculateRDSCost(config: any): CostEstimate {
    const hourlyRate = config.dbInstanceClass === 'db.t3.micro' ? 0.017 : 0.034; // Simplified
    const storageRate = 0.115; // per GB/month
    const computeMonthly = hourlyRate * 24 * 30;
    const storageMonthly = storageRate * config.allocatedStorage;
    return {
      hourly: hourlyRate,
      monthly: computeMonthly + storageMonthly,
      currency: 'USD',
      freeEligible: false,
      breakdown: [
        { component: 'compute', hourly: hourlyRate, monthly: computeMonthly },
        { component: 'storage', hourly: 0, monthly: storageMonthly },
      ],
    };
  }

  private async calculateLambdaCost(config: any): Promise<CostEstimate> {
    try {
      // Try to get pricing from AWS Pricing API
      const pricing = await this.awsPricingService.getLambdaPricing(
        config.region || 'us-east-1',
      );

      if (pricing) {
        // Use real pricing data
        const requestCost = pricing.pricePerRequest || 0.2; // per 1M requests
        const gbSecondCost = pricing.pricePerGBSecond || 0.0000166667;

        // Estimate for typical usage: 1M requests/month with 128MB memory, 100ms duration
        const estimatedRequests = 1000000; // 1M requests
        const estimatedMemoryMB = config.memorySize || 128;
        const estimatedDurationMs = config.timeout || 3000; // 3 seconds
        const gbSeconds =
          (estimatedRequests *
            (estimatedDurationMs / 1000) *
            (estimatedMemoryMB / 1024)) /
          (30 * 24 * 3600); // Monthly GB-seconds

        const computeCost = gbSeconds * gbSecondCost * 1000; // Convert to proper units
        const totalRequestCost = (estimatedRequests / 1000000) * requestCost; // Cost for 1M requests
        const monthlyTotal = totalRequestCost + computeCost;

        return {
          hourly: monthlyTotal / (30 * 24), // Convert to hourly
          monthly: monthlyTotal,
          currency: pricing.currency,
          freeEligible: true,
          breakdown: [
            {
              component: `Lambda Requests (${estimatedRequests.toLocaleString()}/month)`,
              hourly: totalRequestCost / (30 * 24),
              monthly: totalRequestCost,
            },
            {
              component: `Lambda Compute (${gbSeconds.toFixed(2)} GB-seconds)`,
              hourly: computeCost / (30 * 24),
              monthly: computeCost,
            },
          ],
        };
      }
    } catch (error) {
      this.logger.warn(
        'Failed to get Lambda pricing from AWS API, using fallback',
        { error },
      );
    }

    // Fallback to hardcoded pricing if API fails
    const fallbackPricing =
      this.awsPricingService.getFallbackPricing('AWSLambda');
    const requestCost = fallbackPricing.pricePerRequest || 0.2;
    const gbSecondCost = fallbackPricing.pricePerGBSecond || 0.0000166667;

    // Estimate for typical usage
    const estimatedRequests = 1000000;
    const estimatedMemoryMB = config.memorySize || 128;
    const estimatedDurationMs = config.timeout || 3000;
    const gbSeconds =
      (estimatedRequests *
        (estimatedDurationMs / 1000) *
        (estimatedMemoryMB / 1024)) /
      (30 * 24 * 3600);

    const computeCost = gbSeconds * gbSecondCost * 1000;
    const totalRequestCost = (estimatedRequests / 1000000) * requestCost;
    const monthlyTotal = totalRequestCost + computeCost;

    return {
      hourly: monthlyTotal / (30 * 24),
      monthly: monthlyTotal,
      currency: fallbackPricing.currency,
      freeEligible: true,
      breakdown: [
        {
          component: `Lambda Requests (${estimatedRequests.toLocaleString()}/month)`,
          hourly: totalRequestCost / (30 * 24),
          monthly: totalRequestCost,
        },
        {
          component: `Lambda Compute (${gbSeconds.toFixed(2)} GB-seconds)`,
          hourly: computeCost / (30 * 24),
          monthly: computeCost,
        },
      ],
    };
  }

  private calculateDynamoDBCost(config: any): CostEstimate {
    const hourlyRate = config.billingMode === 'PAY_PER_REQUEST' ? 0 : 0.00065; // Simplified
    const monthly = hourlyRate * 24 * 30;
    return {
      hourly: hourlyRate,
      monthly,
      currency: 'USD',
      freeEligible: true,
      breakdown: [{ component: 'storage', hourly: hourlyRate, monthly }],
    };
  }

  private calculateECSCost(config: any): CostEstimate {
    // ECS cluster itself has no charge - only running tasks incur costs
    // Fargate pricing: per vCPU-hour and per GB-hour
    // Estimate based on configuration and capacity providers

    const capacityProviders = config.capacityProviders || ['FARGATE'];
    const hasFargateSpot = capacityProviders.includes('FARGATE_SPOT');
    const hasFargate = capacityProviders.includes('FARGATE');

    // Estimate: 1 task running continuously with 0.25 vCPU and 0.5 GB memory
    // Fargate: $0.04048/vCPU-hour + $0.004445/GB-hour
    // Fargate Spot: ~70% discount
    const baseVcpuRate = 0.04048;
    const baseMemoryRate = 0.004445;
    const estimatedVcpus = config.defaultTaskVcpu || 0.25;
    const estimatedMemory = config.defaultTaskMemory || 0.5;
    const discountFactor = hasFargateSpot ? 0.3 : 1; // 70% discount with Spot

    // Calculate hourly cost
    const vcpuCost = estimatedVcpus * baseVcpuRate * discountFactor;
    const memoryCost = estimatedMemory * baseMemoryRate * discountFactor;
    const hourlyTotal = vcpuCost + memoryCost;
    const monthlyTotal = hourlyTotal * 730; // ~730 hours per month

    const breakdown: Array<{
      component: string;
      hourly: number;
      monthly: number;
    }> = [{ component: 'ECS Cluster (no charge)', hourly: 0, monthly: 0 }];

    if (hasFargateSpot && hasFargate) {
      breakdown.push({
        component: 'Fargate/Fargate Spot Tasks (estimated, mixed capacity)',
        hourly: hourlyTotal,
        monthly: monthlyTotal,
      });
    } else if (hasFargateSpot) {
      breakdown.push({
        component: 'Fargate Spot Tasks (estimated, 70% discount)',
        hourly: hourlyTotal,
        monthly: monthlyTotal,
      });
    } else {
      breakdown.push({
        component: `Fargate Tasks (estimated, ${estimatedVcpus} vCPU, ${estimatedMemory}GB)`,
        hourly: hourlyTotal,
        monthly: monthlyTotal,
      });
    }

    return {
      hourly: hourlyTotal,
      monthly: monthlyTotal,
      currency: 'USD',
      freeEligible: true,
      breakdown,
    };
  }

  private calculateS3Cost(config: any): CostEstimate {
    // S3 Standard storage: $0.023 per GB/month
    // Estimate 10GB storage + requests + data transfer
    const storageSize = config.estimatedStorageGB || 10;
    const storageRate = 0.023; // per GB/month
    const requestCost = 0.5; // estimated API requests
    const transferCost = 1.0; // estimated data transfer
    const monthlyTotal = storageRate * storageSize + requestCost + transferCost;

    return {
      hourly: 0,
      monthly: monthlyTotal,
      currency: 'USD',
      freeEligible: true,
      breakdown: [
        {
          component: `S3 Storage (${storageSize}GB)`,
          hourly: 0,
          monthly: storageRate * storageSize,
        },
        { component: 'API Requests', hourly: 0, monthly: requestCost },
        { component: 'Data Transfer', hourly: 0, monthly: transferCost },
      ],
    };
  }

  // Warning generation methods
  private generateEC2Warnings(config: any): string[] {
    const warnings: string[] = [];
    if (
      config.instanceType.includes('t2') ||
      config.instanceType.includes('t3')
    ) {
      warnings.push('Burstable instance types may have variable performance');
    }
    if (!config.ebsEncrypted) {
      warnings.push(
        'EBS encryption is disabled - data at rest will not be encrypted',
      );
    }
    return warnings;
  }

  private generateRDSWarnings(config: any): string[] {
    const warnings: string[] = [];
    if (!config.multiAZ) {
      warnings.push('Single-AZ deployment - no automatic failover');
    }
    if (config.backupRetentionPeriod < 7) {
      warnings.push('Backup retention period is less than 7 days');
    }
    return warnings;
  }

  private generateLambdaWarnings(config: any): string[] {
    const warnings: string[] = [];
    if (config.timeout > 900) {
      warnings.push(
        'Lambda timeout exceeds 15 minutes - consider different architecture',
      );
    }
    if (config.memorySize > 3008) {
      warnings.push('High memory allocation may increase costs significantly');
    }
    return warnings;
  }

  private generateDynamoDBWarnings(config: any): string[] {
    const warnings: string[] = [];
    if (!config.deletionProtectionEnabled) {
      warnings.push(
        'Deletion protection is disabled - table can be accidentally deleted',
      );
    }
    return warnings;
  }

  private generateECSWarnings(config: any): string[] {
    const warnings: string[] = [];

    warnings.push(
      'ECS cluster creation is free; costs apply only when running Fargate tasks or EC2 instances',
    );

    if (config.capacityProviders?.includes('FARGATE_SPOT')) {
      warnings.push(
        'Using FARGATE_SPOT capacity provider can save up to 70% on compute costs but tasks may be interrupted',
      );
    }

    if (!config.capacityProviders || config.capacityProviders.length === 0) {
      warnings.push(
        'No capacity providers configured - you will need to add FARGATE or EC2 capacity before running tasks',
      );
    }

    return warnings;
  }

  private generateS3Warnings(config: any): string[] {
    const warnings: string[] = [];

    if (config.acl === 'public-read' || config.acl === 'public-read-write') {
      warnings.push(
        'Bucket ACL allows public access - review security requirements',
      );
    }

    if (
      !config.blockPublicAccess ||
      !config.blockPublicAccess.BlockPublicAcls ||
      !config.blockPublicAccess.BlockPublicPolicy
    ) {
      warnings.push(
        'Public access block is not fully enabled - consider enabling all block settings',
      );
    }

    if (!config.encryption?.enabled) {
      warnings.push(
        'Default encryption is disabled - data at rest will not be encrypted',
      );
    }

    warnings.push(
      'Bucket name must be globally unique across all AWS accounts',
    );

    if (!config.lifecycleRules || config.lifecycleRules.length === 0) {
      warnings.push(
        'No lifecycle rules configured - old versions will persist indefinitely',
      );
    }

    return warnings;
  }

  /**
   * Generate a secure random password for RDS master user
   * Meets AWS RDS password requirements:
   * - At least 8 characters
   * - Contains uppercase, lowercase, numbers, and special characters
   */
  private generateSecurePassword(): string {
    const length = 32;
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const special = '!#$%^&*()_+-=[]{}|;:,.<>?';

    const allChars = uppercase + lowercase + numbers + special;
    const bytes = randomBytes(length);

    let password = '';

    // Ensure at least one of each required character type
    password += uppercase[bytes[0] % uppercase.length];
    password += lowercase[bytes[1] % lowercase.length];
    password += numbers[bytes[2] % numbers.length];
    password += special[bytes[3] % special.length];

    // Fill remaining with random characters
    for (let i = 4; i < length; i++) {
      password += allChars[bytes[i] % allChars.length];
    }

    // Shuffle the password
    const passwordArray = password.split('');
    for (let i = passwordArray.length - 1; i > 0; i--) {
      const j = bytes[i % bytes.length] % (i + 1);
      [passwordArray[i], passwordArray[j]] = [
        passwordArray[j],
        passwordArray[i],
      ];
    }

    return passwordArray.join('');
  }
}
