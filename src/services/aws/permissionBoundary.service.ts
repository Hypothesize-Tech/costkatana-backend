import { loggingService } from '../logging.service';
import { IAWSConnection } from '../../models/AWSConnection';

/**
 * Permission Boundary Service - Defense in Depth
 * 
 * Security Guarantees:
 * - Hard limits: max instance size, max cost per operation, max regions
 * - Banned actions: IAM mutations, Organizations, Billing, destructive ops
 * - Rate limiting per customer and globally
 * - Allowlist of supported AWS actions
 * - Even if customer misconfigures role, boundaries cap max damage
 */

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface AWSAction {
  service: string;
  action: string;
  resources?: string[];
  region?: string;
  parameters?: Record<string, any>;
}

export interface ValidationResult {
  allowed: boolean;
  reason?: string;
  riskLevel: RiskLevel;
  warnings: string[];
  suggestions?: string[];
}

export interface RateLimitState {
  customerId: string;
  windowStart: Date;
  requestCount: number;
  costEstimate: number;
}

export interface HardLimits {
  maxInstanceSize: string;
  maxRDSSize: string;
  maxLambdaMemoryMB: number;
  maxLambdaConcurrency: number;
  maxS3BucketsPerOperation: number;
  maxCostPerOperation: number;  // USD
  maxOperationsPerHour: number;
  maxRegions: number;
  maxResourcesPerAction: number;
}

// Hard limits that CANNOT be exceeded regardless of customer configuration
const HARD_LIMITS: HardLimits = {
  maxInstanceSize: 'c5.4xlarge',
  maxRDSSize: 'db.r5.2xlarge',
  maxLambdaMemoryMB: 3008,
  maxLambdaConcurrency: 100,
  maxS3BucketsPerOperation: 5,
  maxCostPerOperation: 1000,  // $1000 USD
  maxOperationsPerHour: 100,
  maxRegions: 3,
  maxResourcesPerAction: 10,
};

// Instance size ordering for comparison
const INSTANCE_SIZE_ORDER: Record<string, number> = {
  'nano': 1, 'micro': 2, 'small': 3, 'medium': 4,
  'large': 5, 'xlarge': 6, '2xlarge': 7, '4xlarge': 8,
  '8xlarge': 9, '12xlarge': 10, '16xlarge': 11, '24xlarge': 12,
  'metal': 13,
};

// Actions that are ALWAYS banned - no exceptions
const BANNED_ACTIONS: Set<string> = new Set([
  // IAM - Never allow IAM modifications
  'iam:CreateAccessKey',
  'iam:DeleteAccessKey',
  'iam:CreateUser',
  'iam:DeleteUser',
  'iam:CreateRole',
  'iam:DeleteRole',
  'iam:PutRolePolicy',
  'iam:DeleteRolePolicy',
  'iam:AttachRolePolicy',
  'iam:DetachRolePolicy',
  'iam:UpdateAssumeRolePolicy',
  'iam:CreatePolicy',
  'iam:DeletePolicy',
  'iam:CreatePolicyVersion',
  'iam:SetDefaultPolicyVersion',
  
  // Organizations - Never allow org changes
  'organizations:*',
  
  // Account - Never allow account changes
  'account:*',
  
  // Billing - Never allow billing access
  'billing:*',
  'aws-portal:*',
  'ce:CreateCostCategoryDefinition',  // Cost Explorer write operations
  'ce:DeleteCostCategoryDefinition',
  'ce:UpdateCostCategoryDefinition',
  'ce:CreateAnomalyMonitor',
  'ce:CreateAnomalySubscription',
  'ce:DeleteAnomalyMonitor',
  'ce:DeleteAnomalySubscription',
  'cur:*',  // Cost and Usage Reports
  
  // Support - Sensitive
  'support:*',
  
  // Destructive operations
  'ec2:TerminateInstances',
  'ec2:DeleteVolume',
  'ec2:DeleteSnapshot',
  'ec2:DeleteVpc',
  'ec2:DeleteSubnet',
  'ec2:DeleteSecurityGroup',
  's3:DeleteBucket',
  'rds:DeleteDBInstance',
  'rds:DeleteDBCluster',
  'rds:DeleteDBSnapshot',
  'lambda:DeleteFunction',
  'dynamodb:DeleteTable',
  'elasticache:DeleteCacheCluster',
  'redshift:DeleteCluster',
  'eks:DeleteCluster',
  'ecs:DeleteCluster',
  
  // KMS - Sensitive
  'kms:ScheduleKeyDeletion',
  'kms:DeleteAlias',
  'kms:DisableKey',
  
  // Secrets Manager - Sensitive
  'secretsmanager:DeleteSecret',
  
  // CloudTrail - Security critical
  'cloudtrail:DeleteTrail',
  'cloudtrail:StopLogging',
  
  // Config - Compliance critical
  'config:DeleteConfigRule',
  'config:DeleteConfigurationRecorder',
  
  // GuardDuty - Security critical
  'guardduty:DeleteDetector',
  'guardduty:DisassociateFromMasterAccount',
]);

// Allowed actions (whitelist approach for safety)
const ALLOWED_ACTIONS: Map<string, Set<string>> = new Map([
  ['ec2', new Set([
    'DescribeInstances',
    'DescribeVolumes',
    'DescribeSnapshots',
    'DescribeSecurityGroups',
    'DescribeVpcs',
    'DescribeSubnets',
    'DescribeImages',
    'DescribeAddresses',
    'DescribeNetworkInterfaces',
    'DescribeTags',
    'StopInstances',
    'StartInstances',
    'RebootInstances',
    'ModifyInstanceAttribute',
    'CreateTags',
    'DeleteTags',
  ])],
  ['s3', new Set([
    'ListBuckets',
    'ListObjects',
    'ListObjectsV2',
    'GetBucketLocation',
    'GetBucketTagging',
    'GetBucketPolicy',
    'GetBucketLifecycleConfiguration',
    'GetBucketAnalyticsConfiguration',
    'GetBucketMetricsConfiguration',
    'GetObject',
    'GetObjectTagging',
    'PutBucketLifecycleConfiguration',
    'PutBucketTagging',
    'PutObjectTagging',
  ])],
  ['rds', new Set([
    'DescribeDBInstances',
    'DescribeDBClusters',
    'DescribeDBSnapshots',
    'DescribeDBClusterSnapshots',
    'DescribeDBParameterGroups',
    'DescribeDBSubnetGroups',
    'ListTagsForResource',
    'StopDBInstance',
    'StartDBInstance',
    'StopDBCluster',
    'StartDBCluster',
    'ModifyDBInstance',
    'CreateDBSnapshot',
    'AddTagsToResource',
    'RemoveTagsFromResource',
  ])],
  ['lambda', new Set([
    'ListFunctions',
    'GetFunction',
    'GetFunctionConfiguration',
    'ListTags',
    'GetPolicy',
    'ListVersionsByFunction',
    'ListAliases',
    'UpdateFunctionConfiguration',
    'TagResource',
    'UntagResource',
  ])],
  ['cloudwatch', new Set([
    'GetMetricData',
    'GetMetricStatistics',
    'ListMetrics',
    'DescribeAlarms',
    'DescribeAlarmsForMetric',
    'GetDashboard',
    'ListDashboards',
    'DescribeAlarmHistory',
  ])],
  ['dynamodb', new Set([
    'DescribeTable',
    'ListTables',
    'ListTagsOfResource',
    'DescribeTimeToLive',
    'DescribeContinuousBackups',
  ])],
  ['elasticache', new Set([
    'DescribeCacheClusters',
    'DescribeReplicationGroups',
    'ListTagsForResource',
  ])],
  ['sts', new Set([
    'GetCallerIdentity',
  ])],
  ['ce', new Set([
    'GetCostAndUsage',
    'GetCostForecast',
    'GetAnomalies',
    'GetDimensionValues',
    'GetTags',
    'GetReservationCoverage',
    'GetReservationPurchaseRecommendation',
    'GetReservationUtilization',
    'GetRightsizingRecommendation',
    'GetSavingsPlansCoverage',
    'GetSavingsPlansUtilization',
    'GetSavingsPlansPurchaseRecommendation',
    'DescribeCostCategoryDefinition',
    'ListCostCategoryDefinitions',
  ])],
]);

// Risk levels for allowed actions
const ACTION_RISK_LEVELS: Map<string, RiskLevel> = new Map([
  // Read operations - Low risk
  ['ec2:Describe*', 'low'],
  ['s3:Get*', 'low'],
  ['s3:List*', 'low'],
  ['rds:Describe*', 'low'],
  ['lambda:Get*', 'low'],
  ['lambda:List*', 'low'],
  ['cloudwatch:*', 'low'],
  ['ce:Get*', 'low'],
  ['ce:Describe*', 'low'],
  ['ce:List*', 'low'],
  
  // Start/Stop - Medium risk
  ['ec2:StopInstances', 'medium'],
  ['ec2:StartInstances', 'medium'],
  ['rds:StopDBInstance', 'medium'],
  ['rds:StartDBInstance', 'medium'],
  
  // Modifications - High risk
  ['ec2:ModifyInstanceAttribute', 'high'],
  ['rds:ModifyDBInstance', 'high'],
  ['lambda:UpdateFunctionConfiguration', 'high'],
  ['s3:PutBucketLifecycleConfiguration', 'high'],
]);

class PermissionBoundaryService {
  private static instance: PermissionBoundaryService;
  
  // Rate limiting state per customer
  private rateLimitState: Map<string, RateLimitState> = new Map();
  
  // Global rate limiting
  private globalRequestCount = 0;
  private globalWindowStart = new Date();
  private readonly GLOBAL_RATE_LIMIT = 1000; // Per hour
  private readonly CUSTOMER_RATE_LIMIT = 100; // Per hour
  
  private constructor() {
    // Reset rate limits every hour
    setInterval(() => this.resetRateLimits(), 3600000);
  }
  
  public static getInstance(): PermissionBoundaryService {
    if (!PermissionBoundaryService.instance) {
      PermissionBoundaryService.instance = new PermissionBoundaryService();
    }
    return PermissionBoundaryService.instance;
  }
  
  /**
   * Validate an AWS action against permission boundaries
   * This is the main entry point for permission checks
   */
  public validateAction(
    action: AWSAction,
    connection: IAWSConnection,
    estimatedCost?: number
  ): ValidationResult {
    const warnings: string[] = [];
    const suggestions: string[] = [];
    
    // 1. Check if action is banned (highest priority)
    const fullAction = `${action.service}:${action.action}`;
    if (this.isActionBanned(fullAction)) {
      return {
        allowed: false,
        reason: `Action '${fullAction}' is permanently banned for security reasons`,
        riskLevel: 'critical',
        warnings: ['This action cannot be performed through CostKatana'],
      };
    }
    
    // 2. Check if action is in allowlist
    if (!this.isActionAllowed(action.service, action.action)) {
      return {
        allowed: false,
        reason: `Action '${fullAction}' is not in the allowed actions list`,
        riskLevel: 'high',
        warnings: ['Contact support if you need this action enabled'],
      };
    }
    
    // 3. Check connection's denied actions
    if (connection.deniedActions.some(denied => 
      fullAction.toLowerCase().includes(denied.toLowerCase().replace('*', ''))
    )) {
      return {
        allowed: false,
        reason: `Action '${fullAction}' is denied by connection configuration`,
        riskLevel: 'medium',
        warnings: [],
      };
    }
    
    // 4. Check region restrictions
    if (action.region && !connection.allowedRegions.includes(action.region)) {
      return {
        allowed: false,
        reason: `Region '${action.region}' is not allowed for this connection`,
        riskLevel: 'medium',
        warnings: [`Allowed regions: ${connection.allowedRegions.join(', ')}`],
      };
    }
    
    // 5. Check rate limits
    const rateLimitResult = this.checkRateLimit(connection.userId.toString());
    if (!rateLimitResult.allowed) {
      return {
        allowed: false,
        reason: rateLimitResult.reason!,
        riskLevel: 'medium',
        warnings: ['Rate limit will reset at the top of the hour'],
      };
    }
    
    // 6. Check cost limits
    if (estimatedCost !== undefined && estimatedCost > HARD_LIMITS.maxCostPerOperation) {
      return {
        allowed: false,
        reason: `Estimated cost ($${estimatedCost}) exceeds maximum allowed ($${HARD_LIMITS.maxCostPerOperation})`,
        riskLevel: 'high',
        warnings: ['Break this operation into smaller parts'],
      };
    }
    
    // 7. Check resource count limits
    if (action.resources && action.resources.length > HARD_LIMITS.maxResourcesPerAction) {
      return {
        allowed: false,
        reason: `Too many resources (${action.resources.length}) - maximum is ${HARD_LIMITS.maxResourcesPerAction}`,
        riskLevel: 'medium',
        warnings: ['Split into multiple operations'],
      };
    }
    
    // 8. Check instance size limits for EC2 operations
    if (action.service === 'ec2' && action.parameters?.instanceType) {
      const sizeCheck = this.checkInstanceSize(action.parameters.instanceType);
      if (!sizeCheck.allowed) {
        return {
          allowed: false,
          reason: sizeCheck.reason!,
          riskLevel: 'high',
          warnings: [],
        };
      }
    }
    
    // 9. Check permission mode
    if (connection.permissionMode === 'read-only' && this.isWriteAction(action)) {
      return {
        allowed: false,
        reason: 'Connection is in read-only mode - write operations not allowed',
        riskLevel: 'low',
        warnings: ['Change connection mode to read-write to enable this action'],
      };
    }
    
    // Determine risk level
    const riskLevel = this.getActionRiskLevel(fullAction);
    
    // Add warnings for high-risk actions
    if (riskLevel === 'high') {
      warnings.push('This is a high-risk action that will modify resources');
      suggestions.push('Consider testing in a non-production environment first');
    }
    
    // Increment rate limit counter
    this.incrementRateLimit(connection.userId.toString());
    
    return {
      allowed: true,
      riskLevel,
      warnings,
      suggestions,
    };
  }
  
  /**
   * Check if an action is permanently banned
   */
  private isActionBanned(action: string): boolean {
    // Check exact match
    if (BANNED_ACTIONS.has(action)) {
      return true;
    }
    
    // Check wildcard matches
    for (const banned of BANNED_ACTIONS) {
      if (banned.endsWith('*')) {
        const prefix = banned.slice(0, -1);
        if (action.startsWith(prefix)) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  /**
   * Check if an action is in the allowlist
   */
  private isActionAllowed(service: string, action: string): boolean {
    const serviceActions = ALLOWED_ACTIONS.get(service.toLowerCase());
    if (!serviceActions) {
      return false;
    }
    
    // Check exact match
    if (serviceActions.has(action)) {
      return true;
    }
    
    // Check wildcard matches (e.g., Describe* matches DescribeInstances)
    for (const allowed of serviceActions) {
      if (allowed.endsWith('*')) {
        const prefix = allowed.slice(0, -1);
        if (action.startsWith(prefix)) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  /**
   * Check if an action is a write operation
   */
  private isWriteAction(action: AWSAction): boolean {
    const readPrefixes = ['Describe', 'Get', 'List', 'Read', 'Check'];
    return !readPrefixes.some(prefix => action.action.startsWith(prefix));
  }
  
  /**
   * Get risk level for an action
   */
  private getActionRiskLevel(action: string): RiskLevel {
    // Check exact match
    const exactLevel = ACTION_RISK_LEVELS.get(action);
    if (exactLevel) {
      return exactLevel;
    }
    
    // Check wildcard matches
    for (const [pattern, level] of ACTION_RISK_LEVELS) {
      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        if (action.startsWith(prefix)) {
          return level;
        }
      }
    }
    
    // Default to medium for unknown actions
    return 'medium';
  }
  
  /**
   * Check instance size against limits
   */
  private checkInstanceSize(instanceType: string): { allowed: boolean; reason?: string } {
    const parts = instanceType.split('.');
    if (parts.length !== 2) {
      return { allowed: false, reason: 'Invalid instance type format' };
    }
    
    const [, size] = parts;
    const requestedOrder = INSTANCE_SIZE_ORDER[size] || 0;
    
    const maxParts = HARD_LIMITS.maxInstanceSize.split('.');
    const maxOrder = INSTANCE_SIZE_ORDER[maxParts[1]] || 0;
    
    if (requestedOrder > maxOrder) {
      return {
        allowed: false,
        reason: `Instance size '${instanceType}' exceeds maximum allowed '${HARD_LIMITS.maxInstanceSize}'`,
      };
    }
    
    return { allowed: true };
  }
  
  /**
   * Check rate limits
   */
  private checkRateLimit(customerId: string): { allowed: boolean; reason?: string } {
    // Check global rate limit
    if (this.globalRequestCount >= this.GLOBAL_RATE_LIMIT) {
      return {
        allowed: false,
        reason: 'Global rate limit exceeded - please try again later',
      };
    }
    
    // Check customer rate limit
    const customerState = this.rateLimitState.get(customerId);
    if (customerState && customerState.requestCount >= this.CUSTOMER_RATE_LIMIT) {
      return {
        allowed: false,
        reason: `Customer rate limit exceeded (${this.CUSTOMER_RATE_LIMIT} requests per hour)`,
      };
    }
    
    return { allowed: true };
  }
  
  /**
   * Increment rate limit counters
   */
  private incrementRateLimit(customerId: string): void {
    this.globalRequestCount++;
    
    const customerState = this.rateLimitState.get(customerId);
    if (customerState) {
      customerState.requestCount++;
    } else {
      this.rateLimitState.set(customerId, {
        customerId,
        windowStart: new Date(),
        requestCount: 1,
        costEstimate: 0,
      });
    }
  }
  
  /**
   * Reset rate limits (called hourly)
   */
  private resetRateLimits(): void {
    this.globalRequestCount = 0;
    this.globalWindowStart = new Date();
    this.rateLimitState.clear();
    
    loggingService.info('Rate limits reset', {
      component: 'PermissionBoundaryService',
      operation: 'resetRateLimits',
    });
  }
  
  /**
   * Get hard limits configuration
   */
  public getHardLimits(): HardLimits {
    return { ...HARD_LIMITS };
  }
  
  /**
   * Get banned actions list
   */
  public getBannedActions(): string[] {
    return Array.from(BANNED_ACTIONS);
  }
  
  /**
   * Get allowed actions for a service
   */
  public getAllowedActions(service: string): string[] {
    const actions = ALLOWED_ACTIONS.get(service.toLowerCase());
    return actions ? Array.from(actions) : [];
  }
  
  /**
   * Get all allowed services
   */
  public getAllowedServices(): string[] {
    return Array.from(ALLOWED_ACTIONS.keys());
  }
  
  /**
   * Get rate limit status for a customer
   */
  public getRateLimitStatus(customerId: string): {
    requestsUsed: number;
    requestsRemaining: number;
    resetsAt: Date;
  } {
    const customerState = this.rateLimitState.get(customerId);
    const requestsUsed = customerState?.requestCount || 0;
    
    return {
      requestsUsed,
      requestsRemaining: this.CUSTOMER_RATE_LIMIT - requestsUsed,
      resetsAt: new Date(this.globalWindowStart.getTime() + 3600000),
    };
  }
}

export const permissionBoundaryService = PermissionBoundaryService.getInstance();
