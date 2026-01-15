/**
 * Resource Creation Plan Generator Service
 * 
 * Generates step-by-step creation plans with cost estimates, dependencies,
 * and rollback strategies for all AWS resource types.
 */

import crypto from 'crypto';
import { loggingService } from '../logging.service';
import { permissionBoundaryService } from './permissionBoundary.service';
import { defaultResourceConfigService } from './defaultResourceConfig.service';
import { IAWSConnection } from '../../models/AWSConnection';
import {
  ResourceCreationPlan,
  ResourceCreationStep,
  ResourceDependency,
  RollbackStep,
  EC2CreationConfig,
  RDSCreationConfig,
  LambdaCreationConfig,
  DynamoDBCreationConfig,
  ECSCreationConfig,
  S3CreationConfig,
} from '../../types/awsResourceCreation.types';

// Cost estimates per resource (simplified - in production, use AWS Pricing API)
const COST_ESTIMATES: Record<string, { hourly: number; monthly: number }> = {
  'ec2.t3.micro': { hourly: 0.0104, monthly: 7.50 },
  'ec2.t3.small': { hourly: 0.0208, monthly: 15.00 },
  'rds.db.t3.micro': { hourly: 0.017, monthly: 12.24 },
  'rds.db.t3.small': { hourly: 0.034, monthly: 24.48 },
  'lambda.128mb': { hourly: 0, monthly: 0.20 }, // per 1M requests
  'dynamodb.on_demand': { hourly: 0, monthly: 1.25 }, // per 1M write units
  's3.storage': { hourly: 0, monthly: 0.023 }, // per GB
};

// Duration estimates per action (seconds)
const DURATION_ESTIMATES: Record<string, number> = {
  'ec2.create': 60,
  'ec2.create_security_group': 10,
  'ec2.create_key_pair': 5,
  'rds.create': 600,
  'rds.create_subnet_group': 30,
  'lambda.create': 30,
  'lambda.create_iam_role': 20,
  'dynamodb.create': 30,
  'ecs.create': 30,
  's3.create': 10,
};

class ResourceCreationPlanGeneratorService {
  private static instance: ResourceCreationPlanGeneratorService;

  private constructor() {}

  public static getInstance(): ResourceCreationPlanGeneratorService {
    if (!ResourceCreationPlanGeneratorService.instance) {
      ResourceCreationPlanGeneratorService.instance = new ResourceCreationPlanGeneratorService();
    }
    return ResourceCreationPlanGeneratorService.instance;
  }

  /**
   * Generate EC2 creation plan
   */
  public async generateEC2Plan(
    connection: IAWSConnection,
    config: EC2CreationConfig
  ): Promise<ResourceCreationPlan> {
    const planId = `plan-ec2-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const region = config.region ?? connection.allowedRegions[0] ?? 'us-east-1';

    // Validate permissions
    const validation = permissionBoundaryService.validateAction(
      { service: 'ec2', action: 'RunInstances', region },
      connection
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    // Get default resources
    const defaultConfig = await defaultResourceConfigService.getDefaultConfig(connection, region);

    const steps: ResourceCreationStep[] = [];
    const dependencies: ResourceDependency[] = [];
    const rollbackSteps: RollbackStep[] = [];

    // Step 1: Verify/Create VPC
    if (!config.vpcId) {
      steps.push({
        stepId: `${planId}-vpc`,
        order: 1,
        action: 'verify_vpc',
        description: `Verify VPC ${defaultConfig.vpcId} exists`,
        parameters: { vpcId: defaultConfig.vpcId },
        estimatedDuration: 5,
        critical: true,
      });
      dependencies.push({
        resourceType: 'vpc',
        resourceId: defaultConfig.vpcId,
        action: 'use_existing',
        description: `Using default VPC ${defaultConfig.vpcId}`,
      });
    }

    // Step 2: Verify/Create Security Group
    if (!config.securityGroupIds) {
      steps.push({
        stepId: `${planId}-sg`,
        order: 2,
        action: 'verify_security_group',
        description: `Verify security group ${defaultConfig.securityGroupId} exists`,
        parameters: { securityGroupId: defaultConfig.securityGroupId },
        estimatedDuration: 5,
        critical: true,
      });
      dependencies.push({
        resourceType: 'security_group',
        resourceId: defaultConfig.securityGroupId,
        action: 'use_existing',
        description: `Using default security group ${defaultConfig.securityGroupId}`,
      });
    }

    // Step 3: Verify/Create Key Pair
    if (!config.keyPairName) {
      steps.push({
        stepId: `${planId}-keypair`,
        order: 3,
        action: 'verify_key_pair',
        description: `Verify key pair ${defaultConfig.keyPairName} exists`,
        parameters: { keyPairName: defaultConfig.keyPairName },
        estimatedDuration: 5,
        critical: true,
      });
      dependencies.push({
        resourceType: 'key_pair',
        resourceId: defaultConfig.keyPairName,
        action: 'use_existing',
        description: `Using default key pair ${defaultConfig.keyPairName}`,
      });
    }

    // Step 4: Create EC2 Instance
    steps.push({
      stepId: `${planId}-instance`,
      order: 4,
      action: 'create_instance',
      description: `Create EC2 instance: ${config.instanceName} (${config.instanceType ?? 't3.micro'})`,
      parameters: {
        instanceName: config.instanceName,
        instanceType: config.instanceType ?? 't3.micro',
        vpcId: config.vpcId ?? defaultConfig.vpcId,
        subnetId: config.subnetId ?? defaultConfig.subnetIds?.[0],
        securityGroupId: config.securityGroupIds?.[0] ?? defaultConfig.securityGroupId,
        keyPairName: config.keyPairName ?? defaultConfig.keyPairName,
      },
      estimatedDuration: DURATION_ESTIMATES['ec2.create'],
      critical: true,
    });

    // Rollback: Terminate instance
    rollbackSteps.push({
      stepId: `${planId}-rollback-instance`,
      action: 'terminate_instance',
      description: 'Terminate EC2 instance',
    });

    // Calculate cost estimate
    const instanceType = config.instanceType ?? 't3.micro';
    const costKey = `ec2.${instanceType}`;
    const costEstimate = COST_ESTIMATES[costKey] ?? { hourly: 0.01, monthly: 7.50 };

    const plan: ResourceCreationPlan = {
      planId,
      resourceType: 'ec2',
      resourceName: config.instanceName,
      steps,
      costEstimate: {
        hourly: costEstimate.hourly,
        monthly: costEstimate.monthly,
        currency: 'USD',
        freeEligible: instanceType === 't3.micro' || instanceType === 't2.micro',
        breakdown: [
          { component: 'EC2 Instance', hourly: costEstimate.hourly, monthly: costEstimate.monthly },
        ],
      },
      dependencies,
      rollbackPlan: rollbackSteps,
      estimatedDuration: steps.reduce((sum, s) => sum + s.estimatedDuration, 0),
      riskLevel: 'medium',
      warnings: [],
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
    };

    loggingService.info('EC2 creation plan generated', {
      component: 'ResourceCreationPlanGenerator',
      planId,
      instanceName: config.instanceName,
      instanceType,
      estimatedCost: costEstimate.monthly,
    });

    return plan;
  }

  /**
   * Generate RDS creation plan
   */
  public async generateRDSPlan(
    connection: IAWSConnection,
    config: RDSCreationConfig
  ): Promise<ResourceCreationPlan> {
    const planId = `plan-rds-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const region = config.region ?? connection.allowedRegions[0] ?? 'us-east-1';

    // Validate permissions
    const validation = permissionBoundaryService.validateAction(
      { service: 'rds', action: 'CreateDBInstance', region },
      connection
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    // Get default resources
    const defaultConfig = await defaultResourceConfigService.getDefaultConfig(connection, region);

    const steps: ResourceCreationStep[] = [];
    const dependencies: ResourceDependency[] = [];
    const rollbackSteps: RollbackStep[] = [];

    // Step 1: Verify DB Subnet Group
    if (!config.dbSubnetGroupName) {
      steps.push({
        stepId: `${planId}-subnet-group`,
        order: 1,
        action: 'verify_db_subnet_group',
        description: `Verify DB subnet group ${defaultConfig.dbSubnetGroupName} exists`,
        parameters: { dbSubnetGroupName: defaultConfig.dbSubnetGroupName },
        estimatedDuration: DURATION_ESTIMATES['rds.create_subnet_group'],
        critical: true,
      });
      dependencies.push({
        resourceType: 'db_subnet_group',
        resourceId: defaultConfig.dbSubnetGroupName,
        action: 'use_existing',
        description: `Using default DB subnet group ${defaultConfig.dbSubnetGroupName}`,
      });
    }

    // Step 2: Create RDS Instance
    steps.push({
      stepId: `${planId}-instance`,
      order: 2,
      action: 'create_db_instance',
      description: `Create RDS ${config.engine} instance: ${config.dbInstanceIdentifier}`,
      parameters: {
        dbInstanceIdentifier: config.dbInstanceIdentifier,
        engine: config.engine,
        dbInstanceClass: config.dbInstanceClass ?? 'db.t3.micro',
        allocatedStorage: config.allocatedStorage ?? 20,
        dbSubnetGroupName: config.dbSubnetGroupName ?? defaultConfig.dbSubnetGroupName,
      },
      estimatedDuration: DURATION_ESTIMATES['rds.create'],
      critical: true,
    });

    // Rollback: Delete instance
    rollbackSteps.push({
      stepId: `${planId}-rollback-instance`,
      action: 'delete_db_instance',
      description: 'Delete RDS instance',
    });

    // Calculate cost estimate
    const dbClass = config.dbInstanceClass ?? 'db.t3.micro';
    const costKey = `rds.${dbClass}`;
    const costEstimate = COST_ESTIMATES[costKey] ?? { hourly: 0.017, monthly: 12.24 };

    const plan: ResourceCreationPlan = {
      planId,
      resourceType: 'rds',
      resourceName: config.dbInstanceIdentifier,
      steps,
      costEstimate: {
        hourly: costEstimate.hourly,
        monthly: costEstimate.monthly,
        currency: 'USD',
        freeEligible: dbClass === 'db.t3.micro' || dbClass === 'db.t2.micro',
        breakdown: [
          { component: 'RDS Instance', hourly: costEstimate.hourly, monthly: costEstimate.monthly },
          { component: 'Storage (20GB)', hourly: 0.0023, monthly: 1.66 },
        ],
      },
      dependencies,
      rollbackPlan: rollbackSteps,
      estimatedDuration: steps.reduce((sum, s) => sum + s.estimatedDuration, 0),
      riskLevel: 'high',
      warnings: [
        'Database creation typically takes 5-10 minutes',
        'Ensure backup window does not conflict with maintenance window',
      ],
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    };

    loggingService.info('RDS creation plan generated', {
      component: 'ResourceCreationPlanGenerator',
      planId,
      dbInstanceIdentifier: config.dbInstanceIdentifier,
      engine: config.engine,
      estimatedCost: costEstimate.monthly,
    });

    return plan;
  }

  /**
   * Generate Lambda creation plan
   */
  public async generateLambdaPlan(
    connection: IAWSConnection,
    config: LambdaCreationConfig & { region?: string }
  ): Promise<ResourceCreationPlan> {
    const planId = `plan-lambda-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const region = config.region ?? connection.allowedRegions[0] ?? 'us-east-1';

    // Validate permissions
    const validation = permissionBoundaryService.validateAction(
      { service: 'lambda', action: 'CreateFunction', region },
      connection
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const steps: ResourceCreationStep[] = [];
    const dependencies: ResourceDependency[] = [];
    const rollbackSteps: RollbackStep[] = [];

    // Step 1: Create IAM Role (if not provided)
    if (!config.role) {
      steps.push({
        stepId: `${planId}-role`,
        order: 1,
        action: 'create_iam_role',
        description: 'Create Lambda execution IAM role',
        parameters: { roleName: 'CostKatanaLambdaExecutionRole' },
        estimatedDuration: DURATION_ESTIMATES['lambda.create_iam_role'],
        critical: true,
      });
      dependencies.push({
        resourceType: 'iam_role',
        action: 'create',
        description: 'Create Lambda execution role with CloudWatch Logs permissions',
      });
      rollbackSteps.push({
        stepId: `${planId}-rollback-role`,
        action: 'delete_iam_role',
        description: 'Delete Lambda execution role',
      });
    }

    // Step 2: Create Lambda Function
    steps.push({
      stepId: `${planId}-function`,
      order: 2,
      action: 'create_function',
      description: `Create Lambda function: ${config.functionName}`,
      parameters: {
        functionName: config.functionName,
        runtime: config.runtime ?? 'nodejs20.x',
        handler: config.handler ?? 'index.handler',
        memorySize: config.memorySize ?? 128,
        timeout: config.timeout ?? 3,
      },
      estimatedDuration: DURATION_ESTIMATES['lambda.create'],
      critical: true,
    });

    // Rollback: Delete function
    rollbackSteps.push({
      stepId: `${planId}-rollback-function`,
      action: 'delete_function',
      description: 'Delete Lambda function',
    });

    const plan: ResourceCreationPlan = {
      planId,
      resourceType: 'lambda',
      resourceName: config.functionName,
      steps,
      costEstimate: {
        hourly: 0,
        monthly: 0.20,
        currency: 'USD',
        freeEligible: true,
        breakdown: [
          { component: 'Lambda Invocations (1M/month)', hourly: 0, monthly: 0.20 },
        ],
      },
      dependencies,
      rollbackPlan: rollbackSteps,
      estimatedDuration: steps.reduce((sum, s) => sum + s.estimatedDuration, 0),
      riskLevel: 'low',
      warnings: [],
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    };

    loggingService.info('Lambda creation plan generated', {
      component: 'ResourceCreationPlanGenerator',
      planId,
      functionName: config.functionName,
      runtime: config.runtime ?? 'nodejs20.x',
    });

    return plan;
  }

  /**
   * Generate DynamoDB creation plan
   */
  public async generateDynamoDBPlan(
    connection: IAWSConnection,
    config: DynamoDBCreationConfig & { region?: string }
  ): Promise<ResourceCreationPlan> {
    const planId = `plan-dynamodb-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const region = config.region ?? connection.allowedRegions[0] ?? 'us-east-1';

    // Validate permissions
    const validation = permissionBoundaryService.validateAction(
      { service: 'dynamodb', action: 'CreateTable', region },
      connection
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const steps: ResourceCreationStep[] = [];
    const rollbackSteps: RollbackStep[] = [];

    // Step 1: Create DynamoDB Table
    steps.push({
      stepId: `${planId}-table`,
      order: 1,
      action: 'create_table',
      description: `Create DynamoDB table: ${config.tableName}`,
      parameters: {
        tableName: config.tableName,
        billingMode: config.billingMode ?? 'PAY_PER_REQUEST',
        keySchema: config.keySchema,
      },
      estimatedDuration: DURATION_ESTIMATES['dynamodb.create'],
      critical: true,
    });

    // Rollback: Delete table
    rollbackSteps.push({
      stepId: `${planId}-rollback-table`,
      action: 'delete_table',
      description: 'Delete DynamoDB table',
    });

    const plan: ResourceCreationPlan = {
      planId,
      resourceType: 'dynamodb',
      resourceName: config.tableName,
      steps,
      costEstimate: {
        hourly: 0,
        monthly: 1.25,
        currency: 'USD',
        freeEligible: true,
        breakdown: [
          { component: 'On-Demand Billing (1M write units)', hourly: 0, monthly: 1.25 },
        ],
      },
      dependencies: [],
      rollbackPlan: rollbackSteps,
      estimatedDuration: steps.reduce((sum, s) => sum + s.estimatedDuration, 0),
      riskLevel: 'low',
      warnings: [],
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    };

    loggingService.info('DynamoDB creation plan generated', {
      component: 'ResourceCreationPlanGenerator',
      planId,
      tableName: config.tableName,
      billingMode: config.billingMode ?? 'PAY_PER_REQUEST',
    });

    return plan;
  }

  /**
   * Generate ECS creation plan
   */
  public async generateECSPlan(
    connection: IAWSConnection,
    config: ECSCreationConfig
  ): Promise<ResourceCreationPlan> {
    const planId = `plan-ecs-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const region = config.region ?? connection.allowedRegions[0] ?? 'us-east-1';

    // Validate permissions
    const validation = permissionBoundaryService.validateAction(
      { service: 'ecs', action: 'CreateCluster', region },
      connection
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const steps: ResourceCreationStep[] = [];
    const rollbackSteps: RollbackStep[] = [];

    // Step 1: Create ECS Cluster
    steps.push({
      stepId: `${planId}-cluster`,
      order: 1,
      action: 'create_cluster',
      description: `Create ECS cluster: ${config.clusterName}`,
      parameters: {
        clusterName: config.clusterName,
        capacityProviders: config.capacityProviders ?? ['FARGATE', 'FARGATE_SPOT'],
      },
      estimatedDuration: DURATION_ESTIMATES['ecs.create'],
      critical: true,
    });

    // Rollback: Delete cluster
    rollbackSteps.push({
      stepId: `${planId}-rollback-cluster`,
      action: 'delete_cluster',
      description: 'Delete ECS cluster',
    });

    const plan: ResourceCreationPlan = {
      planId,
      resourceType: 'ecs',
      resourceName: config.clusterName,
      steps,
      costEstimate: {
        hourly: 0,
        monthly: 0,
        currency: 'USD',
        freeEligible: true,
        breakdown: [
          { component: 'ECS Cluster (no charge)', hourly: 0, monthly: 0 },
          { component: 'Fargate tasks (pay per use)', hourly: 0, monthly: 0 },
        ],
      },
      dependencies: [],
      rollbackPlan: rollbackSteps,
      estimatedDuration: steps.reduce((sum, s) => sum + s.estimatedDuration, 0),
      riskLevel: 'low',
      warnings: ['Cluster creation is free; costs apply only when running tasks'],
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    };

    loggingService.info('ECS creation plan generated', {
      component: 'ResourceCreationPlanGenerator',
      planId,
      clusterName: config.clusterName,
    });

    return plan;
  }

  /**
   * Generate S3 creation plan
   */
  public async generateS3Plan(
    connection: IAWSConnection,
    config: S3CreationConfig
  ): Promise<ResourceCreationPlan> {
    const planId = `plan-s3-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const region = config.region ?? 'us-east-1';

    // Validate permissions
    const validation = permissionBoundaryService.validateAction(
      { service: 's3', action: 'CreateBucket' },
      connection
    );

    if (!validation.allowed) {
      throw new Error(`Permission denied: ${validation.reason}`);
    }

    const steps: ResourceCreationStep[] = [];
    const rollbackSteps: RollbackStep[] = [];

    // Step 1: Create S3 Bucket
    steps.push({
      stepId: `${planId}-bucket`,
      order: 1,
      action: 'create_bucket',
      description: `Create S3 bucket: ${config.bucketName}`,
      parameters: {
        bucketName: config.bucketName,
        region,
        encryption: config.encryption ?? { enabled: true, sseAlgorithm: 'AES256' },
      },
      estimatedDuration: DURATION_ESTIMATES['s3.create'],
      critical: true,
    });

    // Rollback: Delete bucket
    rollbackSteps.push({
      stepId: `${planId}-rollback-bucket`,
      action: 'delete_bucket',
      description: 'Delete S3 bucket',
    });

    const plan: ResourceCreationPlan = {
      planId,
      resourceType: 's3',
      resourceName: config.bucketName,
      steps,
      costEstimate: {
        hourly: 0,
        monthly: 0.023,
        currency: 'USD',
        freeEligible: true,
        breakdown: [
          { component: 'S3 Storage (per GB)', hourly: 0, monthly: 0.023 },
        ],
      },
      dependencies: [],
      rollbackPlan: rollbackSteps,
      estimatedDuration: steps.reduce((sum, s) => sum + s.estimatedDuration, 0),
      riskLevel: 'low',
      warnings: ['Bucket name must be globally unique across all AWS accounts'],
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    };

    loggingService.info('S3 creation plan generated', {
      component: 'ResourceCreationPlanGenerator',
      planId,
      bucketName: config.bucketName,
      region,
    });

    return plan;
  }
}

export const resourceCreationPlanGeneratorService = ResourceCreationPlanGeneratorService.getInstance();
