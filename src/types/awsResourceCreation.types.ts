/**
 * AWS Resource Creation Types
 * 
 * Comprehensive type definitions for all resource creation operations
 * across EC2, RDS, Lambda, DynamoDB, ECS, and S3 services.
 */

// ============================================================================
// Base Types
// ============================================================================

export interface ResourceCreationRequest {
  userId: string;
  connectionId: string;
  resourceType: 'ec2' | 'rds' | 'lambda' | 'dynamodb' | 'ecs' | 's3';
  config: Record<string, unknown>;
  region?: string;
}

export interface ResourceCreationPlan {
  planId: string;
  resourceType: string;
  resourceName: string;
  steps: ResourceCreationStep[];
  costEstimate: CostEstimate;
  dependencies: ResourceDependency[];
  rollbackPlan?: RollbackStep[];
  estimatedDuration: number; // seconds
  riskLevel: 'low' | 'medium' | 'high';
  warnings: string[];
  createdAt: Date;
  expiresAt: Date; // 15 minutes from creation
}

export interface ResourceCreationStep {
  stepId: string;
  order: number;
  action: string;
  description: string;
  parameters: Record<string, unknown>;
  estimatedDuration: number; // seconds
  critical: boolean; // if fails, entire operation fails
}

export interface ResourceDependency {
  resourceType: string;
  resourceId?: string;
  action: 'create' | 'use_existing' | 'verify';
  description: string;
}

export interface CostEstimate {
  hourly: number;
  monthly: number;
  currency: string;
  freeEligible: boolean;
  breakdown: Array<{ component: string; hourly: number; monthly: number }>;
}

export interface RollbackStep {
  stepId: string;
  action: string;
  resourceId?: string;
  description: string;
}

export interface ResourceCreationResult {
  success: boolean;
  resourceId: string;
  resourceArn?: string;
  resourceName: string;
  resourceType: string;
  createdAt: Date;
  metadata: Record<string, unknown>;
  error?: string;
  rollbackPerformed?: boolean;
}

// ============================================================================
// EC2 Types
// ============================================================================

export interface EC2CreationConfig {
  instanceName: string;
  instanceType?: string; // default: t3.micro
  region?: string;
  vpcId?: string; // if not provided, use default
  subnetId?: string; // if not provided, use default
  securityGroupIds?: string[];
  keyPairName?: string; // if not provided, create new
  iamInstanceProfile?: string;
  userData?: string; // base64 encoded
  ebsVolumeSize?: number; // default: 8
  ebsVolumeType?: 'gp3' | 'gp2' | 'io1'; // default: gp3
  ebsEncrypted?: boolean; // default: true
  monitoring?: 'basic' | 'detailed'; // default: basic
  tags?: Record<string, string>;
}

export interface EC2CreationResult extends ResourceCreationResult {
  instanceId: string;
  privateIpAddress?: string;
  publicIpAddress?: string;
  keyPairName?: string;
  keyMaterial?: string; // only returned once, encrypted
  securityGroupId?: string;
}

// ============================================================================
// RDS Types
// ============================================================================

export interface RDSCreationConfig {
  dbInstanceIdentifier: string;
  engine: 'mysql' | 'postgres' | 'mariadb' | 'oracle' | 'sqlserver';
  dbInstanceClass?: string; // default: db.t3.micro
  allocatedStorage?: number; // default: 20 GB
  region?: string;
  dbName?: string;
  masterUsername?: string; // default: admin
  masterUserPassword?: string; // if not provided, generate random
  dbSubnetGroupName?: string; // if not provided, create default
  vpcSecurityGroupIds?: string[];
  backupRetentionPeriod?: number; // default: 7 days
  multiAZ?: boolean; // default: false
  storageType?: 'gp3' | 'gp2' | 'io1'; // default: gp3
  storageEncrypted?: boolean; // default: true
  enableCloudwatchLogsExports?: string[];
  tags?: Record<string, string>;
}

export interface RDSCreationResult extends ResourceCreationResult {
  dbInstanceIdentifier: string;
  endpoint: string;
  port: number;
  masterUsername: string;
  masterUserPassword?: string; // encrypted, only returned once
  connectionString?: string;
  dbSubnetGroupName?: string;
  securityGroupId?: string;
}

// ============================================================================
// Lambda Types
// ============================================================================

export interface LambdaCreationConfig {
  functionName: string;
  runtime?: 'nodejs18.x' | 'nodejs20.x' | 'python3.11' | 'python3.12' | 'java17' | 'go1.x'; // default: nodejs20.x
  handler?: string; // default: index.handler
  code?: {
    zipFile?: Buffer;
    s3Bucket?: string;
    s3Key?: string;
  };
  role?: string; // IAM role ARN, if not provided, create default
  timeout?: number; // default: 3 seconds
  memorySize?: number; // default: 128 MB
  architecture?: 'x86_64' | 'arm64'; // default: arm64
  ephemeralStorage?: number; // default: 512 MB
  environment?: Record<string, string>;
  vpcConfig?: {
    subnetIds: string[];
    securityGroupIds: string[];
  };
  layers?: string[];
  tracingConfig?: 'Active' | 'PassThrough'; // default: PassThrough
  deadLetterConfig?: {
    targetArn: string;
  };
  tags?: Record<string, string>;
}

export interface LambdaCreationResult extends ResourceCreationResult {
  functionName: string;
  functionArn: string;
  functionUrl?: string;
  roleArn: string;
  codeSize: number;
  handler: string;
  runtime: string;
}

// ============================================================================
// DynamoDB Types
// ============================================================================

export interface DynamoDBAttributeDefinition {
  attributeName: string;
  attributeType: 'S' | 'N' | 'B'; // String, Number, Binary
}

export interface DynamoDBKeySchema {
  attributeName: string;
  keyType: 'HASH' | 'RANGE'; // Partition key or Sort key
}

export interface DynamoDBGlobalSecondaryIndex {
  indexName: string;
  keySchema: DynamoDBKeySchema[];
  projection: {
    projectionType: 'ALL' | 'KEYS_ONLY' | 'INCLUDE';
    nonKeyAttributes?: string[];
  };
  provisionedThroughput?: {
    readCapacityUnits: number;
    writeCapacityUnits: number;
  };
}

export interface DynamoDBCreationConfig {
  tableName: string;
  attributeDefinitions: DynamoDBAttributeDefinition[];
  keySchema: DynamoDBKeySchema[];
  billingMode?: 'PAY_PER_REQUEST' | 'PROVISIONED'; // default: PAY_PER_REQUEST
  provisionedThroughput?: {
    readCapacityUnits: number;
    writeCapacityUnits: number;
  };
  globalSecondaryIndexes?: DynamoDBGlobalSecondaryIndex[];
  streamSpecification?: {
    streamViewType: 'NEW_IMAGE' | 'OLD_IMAGE' | 'NEW_AND_OLD_IMAGES' | 'KEYS_ONLY';
  };
  ttlAttributeName?: string;
  sseSpecification?: {
    enabled: boolean;
    sseType?: 'KMS' | 'AES256'; // default: AES256
    kmsMasterKeyId?: string;
  };
  deletionProtectionEnabled?: boolean; // default: true
  pointInTimeRecoverySpecification?: {
    pointInTimeRecoveryEnabled: boolean;
  };
  tags?: Record<string, string>;
}

export interface DynamoDBCreationResult extends ResourceCreationResult {
  tableName: string;
  tableArn: string;
  tableStatus: string;
  itemCount: number;
  billingModeSummary: {
    billingMode: string;
    lastUpdateToPayPerRequestDateTime?: Date;
  };
}

// ============================================================================
// ECS Types
// ============================================================================

export interface ECSCapacityProviderStrategy {
  capacityProvider: string;
  weight?: number;
  base?: number;
}

export interface ECSCreationConfig {
  clusterName: string;
  region?: string;
  capacityProviders?: string[]; // default: ['FARGATE', 'FARGATE_SPOT']
  defaultCapacityProviderStrategy?: ECSCapacityProviderStrategy[];
  containerInsights?: 'enabled' | 'disabled'; // default: enabled
  configuration?: {
    executeCommandConfiguration?: {
      logging: 'DEFAULT' | 'OVERRIDE';
      logConfiguration?: {
        cloudWatchLogGroupName: string;
      };
    };
  };
  tags?: Record<string, string>;
}

export interface ECSCreationResult extends ResourceCreationResult {
  clusterName: string;
  clusterArn: string;
  clusterStatus: string;
  capacityProviders: string[];
  defaultCapacityProviderStrategy: ECSCapacityProviderStrategy[];
}

// ============================================================================
// S3 Types
// ============================================================================

export interface S3CreationConfig {
  bucketName: string;
  region?: string; // default: us-east-1
  acl?: 'private' | 'public-read' | 'public-read-write'; // default: private
  versioning?: boolean; // default: false
  encryption?: {
    enabled: boolean;
    sseAlgorithm?: 'AES256' | 'aws:kms'; // default: AES256
    kmsMasterKeyId?: string;
  };
  blockPublicAccess?: {
    blockPublicAcls: boolean;
    blockPublicPolicy: boolean;
    ignorePublicAcls: boolean;
    restrictPublicBuckets: boolean;
  };
  lifecycleRules?: Array<{
    id: string;
    status: 'Enabled' | 'Disabled';
    prefix?: string;
    transitions?: Array<{
      days: number;
      storageClass: string;
    }>;
    expiration?: {
      days: number;
    };
  }>;
  tags?: Record<string, string>;
}

export interface S3CreationResult extends ResourceCreationResult {
  bucketName: string;
  bucketArn: string;
  region: string;
  creationDate: Date;
}

// ============================================================================
// Default Resource Configuration
// ============================================================================

export interface DefaultResourceConfig {
  region: string;
  vpcId?: string;
  subnetIds?: string[];
  securityGroupId?: string;
  iamRoles?: {
    ec2InstanceProfile?: string;
    lambdaExecutionRole?: string;
    rdsEnhancedMonitoringRole?: string;
  };
  keyPairName?: string;
  dbSubnetGroupName?: string;
  lastUpdated: Date;
}

// ============================================================================
// Approval & Execution Types
// ============================================================================

export interface ApprovalRequest {
  approvalId: string;
  userId: string;
  connectionId: string;
  plan: ResourceCreationPlan;
  approvalToken: string;
  createdAt: Date;
  expiresAt: Date;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  approvedBy?: string;
  approvedAt?: Date;
  rejectionReason?: string;
}

export interface ExecutionContext {
  userId: string;
  connectionId: string;
  approvalToken: string;
  plan: ResourceCreationPlan;
  startedAt: Date;
  status: 'running' | 'completed' | 'failed' | 'rolled_back';
  progress: number; // 0-100
  currentStep?: ResourceCreationStep;
  result?: ResourceCreationResult;
  error?: string;
}
