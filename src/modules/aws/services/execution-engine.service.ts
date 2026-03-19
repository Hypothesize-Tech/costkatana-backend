import { Injectable, OnModuleInit } from '@nestjs/common';
import { LoggerService } from '../../../common/logger/logger.service';
import { StsCredentialService } from './sts-credential.service';
import { KillSwitchService } from './kill-switch.service';
import { PermissionBoundaryService } from './permission-boundary.service';
import { PlanGeneratorService } from './plan-generator.service';
import { randomBytes } from 'crypto';
import { Interval } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ExecutionPlan,
  ExecutionStep,
  APICall,
  StepResult,
} from '../types/aws-dsl.types';
import {
  AWSConnection,
  AWSConnectionDocument,
} from '@/schemas/integration/aws-connection.schema';
import {
  EC2Client,
  StopInstancesCommand,
  StartInstancesCommand,
  ModifyInstanceAttributeCommand,
} from '@aws-sdk/client-ec2';
import {
  S3Client,
  PutBucketLifecycleConfigurationCommand,
  PutBucketIntelligentTieringConfigurationCommand,
} from '@aws-sdk/client-s3';
import {
  RDSClient,
  StopDBInstanceCommand,
  StartDBInstanceCommand,
  CreateDBSnapshotCommand,
  ModifyDBInstanceCommand,
} from '@aws-sdk/client-rds';
import {
  LambdaClient,
  UpdateFunctionConfigurationCommand,
} from '@aws-sdk/client-lambda';

/**
 * Execution Engine Service - Controlled AWS Action Execution
 *
 * Security Guarantees:
 * - Validate approval before execution
 * - Assume role with minimal duration
 * - Execute steps with circuit breaker
 * - Automatic rollback on critical errors
 * - Real-time progress updates via SSE
 * - NO autonomous scheduling - every execution requires fresh approval
 * - Approval tokens expire in 15 minutes
 */

export interface ExecutionContext {
  executionId: string;
  planId: string;
  userId: string;
  connectionId: string;
  approvalToken: string;
  approvedAt: Date;
  startedAt: Date;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'rolled_back';
  currentStep: number;
  totalSteps: number;
  progress: number; // 0-100
}

export interface ExecutionResult {
  executionId: string;
  planId: string;
  status: 'completed' | 'partial' | 'failed' | 'rolled_back';
  executedSteps: number;
  failedSteps: number;
  totalSteps: number;
  startedAt: Date;
  completedAt: Date;
  duration: number;
  steps: StepResult[];
  error?: string;
  rollbackPerformed?: boolean;
}

export interface ExecutionProgress {
  executionId: string;
  planId: string;
  currentStep: number;
  totalSteps: number;
  stepId: string;
  stepStatus: string;
  progress: number; // 0-100
  message: string;
}

type ProgressCallback = (progress: ExecutionProgress) => void;

// Approval token expiration (15 minutes)
const APPROVAL_TOKEN_EXPIRATION_MS = 15 * 60 * 1000;

interface ApprovalTokenData {
  planId: string;
  userId: string;
  connectionId: string;
  createdAt: Date;
  expiresAt: Date;
  used: boolean;
}

interface ActiveExecution {
  context: ExecutionContext;
  cancelled: boolean;
  onProgress?: ProgressCallback;
}

@Injectable()
export class ExecutionEngineService implements OnModuleInit {
  // Active executions (for tracking and cancellation)
  private activeExecutions: Map<string, ActiveExecution> = new Map();

  // Approval tokens (short-lived)
  private approvalTokens: Map<string, ApprovalTokenData> = new Map();

  constructor(
    private readonly logger: LoggerService,
    private readonly stsCredentialService: StsCredentialService,
    private readonly killSwitchService: KillSwitchService,
    private readonly permissionBoundaryService: PermissionBoundaryService,
    private readonly planGeneratorService: PlanGeneratorService,
    @InjectModel(AWSConnection.name)
    private readonly awsConnectionModel: Model<AWSConnectionDocument>,
  ) {}

  onModuleInit(): void {
    this.logger.log('ExecutionEngineService initialized', {
      component: 'ExecutionEngineService',
      operation: 'onModuleInit',
    });
  }

  /**
   * Clean up expired approval tokens (runs every minute)
   */
  @Interval(60000)
  private cleanupExpiredTokens(): void {
    const now = new Date();
    let cleaned = 0;

    for (const [token, data] of this.approvalTokens) {
      if (data.expiresAt < now || data.used) {
        this.approvalTokens.delete(token);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.log('Cleaned up expired approval tokens', {
        component: 'ExecutionEngineService',
        operation: 'cleanupExpiredTokens',
        tokensRemoved: cleaned,
      });
    }
  }

  /**
   * Generate an approval token for a plan
   * This token must be used within 15 minutes
   */
  generateApprovalToken(
    planId: string,
    userId: string,
    connectionId: string,
  ): { token: string; expiresAt: Date } {
    const token = `approval-${Date.now()}-${randomBytes(8).toString('hex')}`;
    const expiresAt = new Date(Date.now() + APPROVAL_TOKEN_EXPIRATION_MS);

    this.approvalTokens.set(token, {
      planId,
      userId,
      connectionId,
      createdAt: new Date(),
      expiresAt,
      used: false,
    });

    this.logger.log('Approval token generated', {
      component: 'ExecutionEngineService',
      operation: 'generateApprovalToken',
      planId,
      userId,
      expiresAt: expiresAt.toISOString(),
    });

    return { token, expiresAt };
  }

  /**
   * Validate an approval token
   */
  validateApprovalToken(
    token: string,
    planId: string,
    userId: string,
  ): { valid: boolean; reason?: string } {
    const tokenData = this.approvalTokens.get(token);

    if (!tokenData) {
      return { valid: false, reason: 'Invalid approval token' };
    }

    if (tokenData.used) {
      return { valid: false, reason: 'Approval token has already been used' };
    }

    if (tokenData.expiresAt < new Date()) {
      return { valid: false, reason: 'Approval token has expired' };
    }

    if (tokenData.planId !== planId) {
      return { valid: false, reason: 'Approval token does not match plan' };
    }

    if (tokenData.userId !== userId) {
      return { valid: false, reason: 'Approval token does not match user' };
    }

    return { valid: true };
  }

  /**
   * Mark approval token as used
   */
  markTokenAsUsed(token: string): void {
    const tokenData = this.approvalTokens.get(token);
    if (tokenData) {
      tokenData.used = true;
    }
  }

  /**
   * Execute an approved plan
   * This is the main entry point for execution
   */
  async execute(
    plan: ExecutionPlan,
    connection: AWSConnectionDocument,
    approvalToken: string,
    userId: string,
    onProgress?: ProgressCallback,
  ): Promise<ExecutionResult> {
    const executionId = `exec-${Date.now()}-${randomBytes(4).toString('hex')}`;
    const startedAt = new Date();

    // 1. Validate approval token
    const tokenValidation = this.validateApprovalToken(
      approvalToken,
      plan.planId,
      userId,
    );

    if (!tokenValidation.valid) {
      throw new Error(`Approval validation failed: ${tokenValidation.reason}`);
    }

    // Mark token as used
    this.markTokenAsUsed(approvalToken);

    // 2. Validate plan is still valid
    const planValidation = this.planGeneratorService.validatePlan(plan);
    if (!planValidation.valid) {
      throw new Error(
        `Plan validation failed: ${planValidation.errors?.join(', ') || 'Unknown error'}`,
      );
    }

    // 3. Check kill switch
    const killSwitchCheck = this.killSwitchService.checkKillSwitch({
      customerId: userId,
      connectionId: connection._id.toString(),
      service: plan.steps[0]?.service || 'unknown',
      action: plan.steps[0]?.action || 'unknown',
      isWrite: true,
      riskLevel:
        plan.summary?.riskScore && plan.summary.riskScore > 75
          ? 'high'
          : plan.summary?.riskScore && plan.summary.riskScore > 50
            ? 'medium'
            : 'low',
    });

    if (!killSwitchCheck.allowed) {
      throw new Error(`Kill switch active: ${killSwitchCheck.reason}`);
    }

    // 4. Create execution context
    const context: ExecutionContext = {
      executionId,
      planId: plan.planId,
      userId,
      connectionId: connection._id.toString(),
      approvalToken,
      approvedAt: new Date(),
      startedAt,
      status: 'running',
      currentStep: 0,
      totalSteps: plan.steps.length,
      progress: 0,
    };

    // 5. Register active execution
    this.activeExecutions.set(executionId, {
      context,
      cancelled: false,
      onProgress,
    });

    // 6. Obtain temporary credentials
    const credentials = await this.stsCredentialService.assumeRole(connection);

    this.logger.log('Execution started', {
      component: 'ExecutionEngineService',
      operation: 'execute',
      executionId,
      planId: plan.planId,
      stepCount: plan.steps.length,
      userId,
    });

    // 7. Execute steps
    const stepResults: StepResult[] = [];
    let lastCompletedStep = -1;
    let executionError: string | undefined;

    try {
      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        context.currentStep = i;
        context.progress = Math.round((i / plan.steps.length) * 100);

        // Check for cancellation
        const activeExecution = this.activeExecutions.get(executionId);
        if (activeExecution?.cancelled) {
          throw new Error('Execution cancelled by user');
        }

        // Report progress
        if (onProgress) {
          onProgress({
            executionId,
            planId: plan.planId,
            currentStep: i + 1,
            totalSteps: plan.steps.length,
            stepId: step.stepId,
            stepStatus: 'running',
            progress: Math.round((i / plan.steps.length) * 100),
            message: `Executing: ${step.description || step.action}`,
          });
        }

        // Execute the step
        const stepResult = await this.executeStep(
          step,
          connection,
          credentials,
        );
        stepResults.push(stepResult);

        if (!stepResult.success) {
          executionError = stepResult.error;

          // Check if we should rollback
          if (plan.rollbackPlan && i > 0) {
            this.logger.warn('Step failed - initiating rollback', {
              component: 'ExecutionEngineService',
              operation: 'execute',
              executionId,
              planId: plan.planId,
              failedStep: step.stepId,
              error: stepResult.error,
            });

            // Execute rollback
            try {
              await this.executeRollback(
                plan.rollbackPlan,
                connection,
                credentials,
                executionId,
                onProgress,
              );

              context.status = 'rolled_back';

              return {
                executionId,
                planId: plan.planId,
                status: 'rolled_back',
                executedSteps: i,
                failedSteps: 1,
                totalSteps: plan.steps.length,
                startedAt,
                completedAt: new Date(),
                duration: Date.now() - startedAt.getTime(),
                steps: stepResults,
                error: executionError,
                rollbackPerformed: true,
              };
            } catch (rollbackError) {
              this.logger.error('Rollback failed', {
                component: 'ExecutionEngineService',
                operation: 'execute',
                executionId,
                error:
                  rollbackError instanceof Error
                    ? rollbackError.message
                    : String(rollbackError),
              });
              context.status = 'failed';
              break;
            }
          }

          context.status = 'failed';
          break;
        }

        lastCompletedStep = i;

        // Report progress
        if (onProgress) {
          onProgress({
            executionId,
            planId: plan.planId,
            currentStep: i + 1,
            totalSteps: plan.steps.length,
            stepId: step.stepId,
            stepStatus: 'completed',
            progress: Math.round(((i + 1) / plan.steps.length) * 100),
            message: `Completed: ${step.description || step.action}`,
          });
        }
      }
    } finally {
      // Clean up
      this.activeExecutions.delete(executionId);

      // Update connection usage statistics
      if (context.status !== 'cancelled') {
        await this.updateConnectionStats(connection);
      }
    }

    const completedAt = new Date();
    const allCompleted = lastCompletedStep === plan.steps.length - 1;
    const failedSteps = executionError ? 1 : 0;
    const executedSteps = lastCompletedStep + 1;

    this.logger.log('Execution completed', {
      component: 'ExecutionEngineService',
      operation: 'execute',
      executionId,
      planId: plan.planId,
      status: allCompleted
        ? 'completed'
        : executionError
          ? 'failed'
          : 'partial',
      stepsCompleted: executedSteps,
      totalSteps: plan.steps.length,
      duration: completedAt.getTime() - startedAt.getTime(),
    });

    return {
      executionId,
      planId: plan.planId,
      status: allCompleted
        ? 'completed'
        : executionError
          ? 'failed'
          : 'partial',
      executedSteps,
      failedSteps,
      totalSteps: plan.steps.length,
      startedAt,
      completedAt,
      duration: completedAt.getTime() - startedAt.getTime(),
      steps: stepResults,
      error: executionError,
    };
  }

  /**
   * Update connection usage statistics
   */
  private async updateConnectionStats(
    connection: AWSConnectionDocument,
  ): Promise<void> {
    try {
      connection.lastUsedAt = new Date();
      await connection.save();
    } catch (error) {
      this.logger.warn('Failed to update connection stats', {
        component: 'ExecutionEngineService',
        operation: 'updateConnectionStats',
        connectionId: connection._id.toString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    step: ExecutionStep,
    connection: AWSConnectionDocument,
    credentials: {
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken: string;
    },
  ): Promise<StepResult> {
    const startedAt = new Date();
    const awsRequestIds: string[] = [];

    try {
      // Pre/post checks: run lightweight AWS describe/head calls to verify state.
      // No artificial delay - actual API calls provide latency.
      if (
        step.action.startsWith('precheck:') ||
        step.action.startsWith('postcheck:')
      ) {
        if (step.apiCalls?.length) {
          for (const apiCall of step.apiCalls) {
            const region = connection.allowedRegions?.[0] || 'us-east-1';
            const permCheck = this.permissionBoundaryService.validateAction(
              {
                service: apiCall.service.toLowerCase(),
                action: apiCall.operation,
                region,
              },
              connection,
            );
            if (permCheck.allowed) {
              const result = await this.executeAwsApiCall(
                apiCall,
                credentials,
                step.resources || [],
                region,
              );
              if (result.requestId) awsRequestIds.push(result.requestId);
            }
          }
        }

        return {
          success: true,
          startedAt,
          completedAt: new Date(),
          duration: Date.now() - startedAt.getTime(),
          awsRequestIds,
        };
      }

      // Execute API calls
      for (const apiCall of step.apiCalls || []) {
        // Get region from step resources or use connection default
        const region = connection.allowedRegions?.[0] || 'us-east-1';

        // Validate against permission boundary
        const permCheck = this.permissionBoundaryService.validateAction(
          {
            service: apiCall.service.toLowerCase(),
            action: apiCall.operation,
            region,
          },
          connection,
        );

        if (!permCheck.allowed) {
          throw new Error(`Permission denied: ${permCheck.reason}`);
        }

        // Execute the actual AWS API call
        const result = await this.executeAwsApiCall(
          apiCall,
          credentials,
          step.resources || [],
          region,
        );

        if (result.requestId) {
          awsRequestIds.push(result.requestId);
        }
      }

      return {
        success: true,
        startedAt,
        completedAt: new Date(),
        duration: Date.now() - startedAt.getTime(),
        awsRequestIds,
      };
    } catch (error) {
      return {
        success: false,
        startedAt,
        completedAt: new Date(),
        duration: Date.now() - startedAt.getTime(),
        awsRequestIds,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Execute an AWS API call using real AWS SDK
   */
  private async executeAwsApiCall(
    apiCall: APICall,
    credentials: {
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken: string;
    },
    resources: string[],
    region: string,
  ): Promise<{ requestId?: string; output?: Record<string, unknown> }> {
    this.logger.log('Executing AWS API call', {
      component: 'ExecutionEngineService',
      operation: 'executeAwsApiCall',
      service: apiCall.service,
      awsOperation: apiCall.operation,
      region,
      resourceCount: resources.length,
    });

    const awsCredentials = {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    };

    try {
      const serviceName = apiCall.service.toLowerCase();
      switch (serviceName) {
        case 'ec2':
          return await this.executeEC2Operation(
            apiCall,
            awsCredentials,
            resources,
            region,
          );
        case 's3':
          return await this.executeS3Operation(
            apiCall,
            awsCredentials,
            resources,
            region,
          );
        case 'rds':
          return await this.executeRDSOperation(
            apiCall,
            awsCredentials,
            resources,
            region,
          );
        case 'lambda':
          return await this.executeLambdaOperation(
            apiCall,
            awsCredentials,
            resources,
            region,
          );
        default:
          throw new Error(`Unsupported AWS service: ${apiCall.service}`);
      }
    } catch (error) {
      this.logger.error('AWS API call failed', {
        component: 'ExecutionEngineService',
        operation: 'executeAwsApiCall',
        service: apiCall.service,
        awsOperation: apiCall.operation,
        region,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Execute EC2 operations
   */
  private async executeEC2Operation(
    apiCall: APICall,
    credentials: {
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken: string;
    },
    resources: string[],
    region: string,
  ): Promise<{ requestId?: string; output?: Record<string, unknown> }> {
    const client = new EC2Client({
      region,
      credentials,
    });

    switch (apiCall.operation) {
      case 'StopInstances': {
        const command = new StopInstancesCommand({
          InstanceIds: resources,
          ...(apiCall.parameters as Record<string, unknown>),
        });
        const response = await client.send(command);
        return {
          requestId: response.$metadata.requestId,
          output: {
            StoppingInstances:
              response.StoppingInstances?.map((inst) => ({
                InstanceId: inst.InstanceId,
                CurrentState: inst.CurrentState,
                PreviousState: inst.PreviousState,
              })) ?? [],
          },
        };
      }

      case 'StartInstances': {
        const command = new StartInstancesCommand({
          InstanceIds: resources,
          ...(apiCall.parameters as Record<string, unknown>),
        });
        const response = await client.send(command);
        return {
          requestId: response.$metadata.requestId,
          output: {
            StartingInstances:
              response.StartingInstances?.map((inst) => ({
                InstanceId: inst.InstanceId,
                CurrentState: inst.CurrentState,
                PreviousState: inst.PreviousState,
              })) ?? [],
          },
        };
      }

      case 'ModifyInstanceAttribute': {
        const instanceId = resources[0];
        if (!instanceId) {
          throw new Error(
            'Instance ID is required for ModifyInstanceAttribute',
          );
        }

        const { attribute, value, ...otherParams } = apiCall.parameters || {};

        const command = new ModifyInstanceAttributeCommand({
          InstanceId: instanceId,
          ...(attribute === 'InstanceType' &&
            typeof value === 'string' && { InstanceType: { Value: value } }),
          ...(attribute === 'InstanceInitiatedShutdownBehavior' &&
            typeof value === 'string' && {
              InstanceInitiatedShutdownBehavior: { Value: value },
            }),
          ...otherParams,
        });
        const response = await client.send(command);
        return {
          requestId: response.$metadata.requestId,
          output: {
            InstanceId: instanceId,
            Modified: true,
          },
        };
      }

      default:
        throw new Error(`Unsupported EC2 operation: ${apiCall.operation}`);
    }
  }

  /**
   * Execute S3 operations
   */
  private async executeS3Operation(
    apiCall: APICall,
    credentials: {
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken: string;
    },
    resources: string[],
    region: string,
  ): Promise<{ requestId?: string; output?: Record<string, unknown> }> {
    const client = new S3Client({
      region,
      credentials,
    });

    switch (apiCall.operation) {
      case 'PutBucketLifecycleConfiguration': {
        const bucketName = resources[0];
        if (!bucketName) {
          throw new Error(
            'Bucket name is required for PutBucketLifecycleConfiguration',
          );
        }

        const { LifecycleConfiguration, ...otherParams } =
          apiCall.parameters || {};

        const command = new PutBucketLifecycleConfigurationCommand({
          Bucket: bucketName,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          LifecycleConfiguration,
          ...otherParams,
        });
        const response = await client.send(command);
        return {
          requestId: response.$metadata.requestId,
          output: {
            Bucket: bucketName,
            LifecycleConfigurationApplied: true,
          },
        };
      }

      case 'PutBucketIntelligentTieringConfiguration': {
        const bucketName = resources[0];
        if (!bucketName) {
          throw new Error(
            'Bucket name is required for PutBucketIntelligentTieringConfiguration',
          );
        }

        const { Id, IntelligentTieringConfiguration, ...tieringParams } =
          apiCall.parameters || {};

        const command = new PutBucketIntelligentTieringConfigurationCommand({
          Bucket: bucketName,
          Id: typeof Id === 'string' ? Id : 'CostKatanaOptimization',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          IntelligentTieringConfiguration,
          ...tieringParams,
        });
        const response = await client.send(command);
        return {
          requestId: response.$metadata.requestId,
          output: {
            Bucket: bucketName,
            IntelligentTieringConfigurationApplied: true,
          },
        };
      }

      default:
        throw new Error(`Unsupported S3 operation: ${apiCall.operation}`);
    }
  }

  /**
   * Execute RDS operations
   */
  private async executeRDSOperation(
    apiCall: APICall,
    credentials: {
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken: string;
    },
    resources: string[],
    region: string,
  ): Promise<{ requestId?: string; output?: Record<string, unknown> }> {
    const client = new RDSClient({
      region,
      credentials,
    });

    switch (apiCall.operation) {
      case 'StopDBInstance': {
        const dbInstanceId = resources[0];
        if (!dbInstanceId) {
          throw new Error('DB Instance ID is required for StopDBInstance');
        }

        const command = new StopDBInstanceCommand({
          DBInstanceIdentifier: dbInstanceId,
          ...(apiCall.parameters as Record<string, unknown>),
        });
        const response = await client.send(command);
        return {
          requestId: response.$metadata.requestId,
          output: {
            DBInstance: {
              DBInstanceIdentifier: response.DBInstance?.DBInstanceIdentifier,
              DBInstanceStatus: response.DBInstance?.DBInstanceStatus,
            },
          },
        };
      }

      case 'StartDBInstance': {
        const startDbInstanceId = resources[0];
        if (!startDbInstanceId) {
          throw new Error('DB Instance ID is required for StartDBInstance');
        }

        const command = new StartDBInstanceCommand({
          DBInstanceIdentifier: startDbInstanceId,
          ...(apiCall.parameters as Record<string, unknown>),
        });
        const response = await client.send(command);
        return {
          requestId: response.$metadata.requestId,
          output: {
            DBInstance: {
              DBInstanceIdentifier: response.DBInstance?.DBInstanceIdentifier,
              DBInstanceStatus: response.DBInstance?.DBInstanceStatus,
            },
          },
        };
      }

      case 'CreateDBSnapshot': {
        const snapshotDbInstanceId = resources[0];
        if (!snapshotDbInstanceId) {
          throw new Error('DB Instance ID is required for CreateDBSnapshot');
        }

        const { DBSnapshotIdentifier, ...snapshotParams } =
          apiCall.parameters || {};
        if (!DBSnapshotIdentifier || typeof DBSnapshotIdentifier !== 'string') {
          throw new Error(
            'DBSnapshotIdentifier is required for CreateDBSnapshot',
          );
        }

        const command = new CreateDBSnapshotCommand({
          DBInstanceIdentifier: snapshotDbInstanceId,
          DBSnapshotIdentifier,
          ...snapshotParams,
        });
        const response = await client.send(command);
        return {
          requestId: response.$metadata.requestId,
          output: {
            DBSnapshot: {
              DBSnapshotIdentifier: response.DBSnapshot?.DBSnapshotIdentifier,
              DBInstanceIdentifier: response.DBSnapshot?.DBInstanceIdentifier,
              Status: response.DBSnapshot?.Status,
            },
          },
        };
      }

      case 'ModifyDBInstance': {
        const modifyDbInstanceId = resources[0];
        if (!modifyDbInstanceId) {
          throw new Error('DB Instance ID is required for ModifyDBInstance');
        }

        const { DBInstanceClass, AllocatedStorage, ...modifyParams } =
          apiCall.parameters || {};

        const command = new ModifyDBInstanceCommand({
          DBInstanceIdentifier: modifyDbInstanceId,
          ...(typeof DBInstanceClass === 'string' && { DBInstanceClass }),
          ...(typeof AllocatedStorage === 'number' && { AllocatedStorage }),
          ApplyImmediately: apiCall.parameters?.ApplyImmediately !== false,
          ...modifyParams,
        });
        const response = await client.send(command);
        return {
          requestId: response.$metadata.requestId,
          output: {
            DBInstance: {
              DBInstanceIdentifier: response.DBInstance?.DBInstanceIdentifier,
              DBInstanceStatus: response.DBInstance?.DBInstanceStatus,
              DBInstanceClass: response.DBInstance?.DBInstanceClass,
            },
          },
        };
      }

      default:
        throw new Error(`Unsupported RDS operation: ${apiCall.operation}`);
    }
  }

  /**
   * Execute Lambda operations
   */
  private async executeLambdaOperation(
    apiCall: APICall,
    credentials: {
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken: string;
    },
    resources: string[],
    region: string,
  ): Promise<{ requestId?: string; output?: Record<string, unknown> }> {
    const client = new LambdaClient({
      region,
      credentials,
    });

    switch (apiCall.operation) {
      case 'UpdateFunctionConfiguration': {
        const functionName = resources[0];
        if (!functionName) {
          throw new Error(
            'Function name is required for UpdateFunctionConfiguration',
          );
        }

        const { MemorySize, Timeout, ...lambdaParams } =
          apiCall.parameters || {};

        const command = new UpdateFunctionConfigurationCommand({
          FunctionName: functionName,
          ...(typeof MemorySize === 'number' && { MemorySize }),
          ...(typeof Timeout === 'number' && { Timeout }),
          ...(lambdaParams as Record<string, unknown>),
        });
        const response = await client.send(command);
        return {
          requestId: response.$metadata.requestId,
          output: {
            FunctionName: response.FunctionName,
            MemorySize: response.MemorySize,
            Timeout: response.Timeout,
            LastModified: response.LastModified,
          },
        };
      }

      default:
        throw new Error(`Unsupported Lambda operation: ${apiCall.operation}`);
    }
  }

  /**
   * Execute rollback plan
   */
  private async executeRollback(
    rollbackPlan: ExecutionPlan,
    connection: AWSConnectionDocument,
    credentials: {
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken: string;
    },
    executionId: string,
    onProgress?: ProgressCallback,
  ): Promise<void> {
    this.logger.warn('Executing rollback', {
      component: 'ExecutionEngineService',
      operation: 'executeRollback',
      executionId,
      planId: rollbackPlan.planId,
    });

    for (let i = 0; i < rollbackPlan.steps.length; i++) {
      const step = rollbackPlan.steps[i];

      if (onProgress) {
        onProgress({
          executionId,
          planId: rollbackPlan.planId,
          currentStep: i + 1,
          totalSteps: rollbackPlan.steps.length,
          stepId: step.stepId,
          stepStatus: 'rolling_back',
          progress: Math.round((i / rollbackPlan.steps.length) * 100),
          message: `Rolling back: ${step.description || step.action}`,
        });
      }

      await this.executeStep(step, connection, credentials);
    }
  }

  /**
   * Cancel an active execution
   */
  cancelExecution(
    executionId: string,
    userId: string,
  ): { success: boolean; reason?: string } {
    const activeExecution = this.activeExecutions.get(executionId);

    if (!activeExecution) {
      return { success: false, reason: 'No active execution found' };
    }

    if (activeExecution.context.userId !== userId) {
      return {
        success: false,
        reason: 'Not authorized to cancel this execution',
      };
    }

    activeExecution.cancelled = true;
    activeExecution.context.status = 'cancelled';

    this.logger.log('Execution cancelled', {
      component: 'ExecutionEngineService',
      operation: 'cancelExecution',
      executionId,
      userId,
    });

    return { success: true };
  }

  /**
   * Get execution status
   */
  getExecutionStatus(executionId: string): ExecutionContext | null {
    const activeExecution = this.activeExecutions.get(executionId);
    return activeExecution ? { ...activeExecution.context } : null;
  }

  /**
   * Get active executions for a user
   */
  getActiveExecutions(userId: string): Array<{
    executionId: string;
    planId: string;
    startedAt: Date;
    connectionId: string;
    progress: number;
  }> {
    const executions: Array<{
      executionId: string;
      planId: string;
      startedAt: Date;
      connectionId: string;
      progress: number;
    }> = [];

    for (const [executionId, execution] of this.activeExecutions) {
      if (execution.context.userId === userId) {
        executions.push({
          executionId,
          planId: execution.context.planId,
          startedAt: execution.context.startedAt,
          connectionId: execution.context.connectionId,
          progress: execution.context.progress,
        });
      }
    }

    return executions;
  }

}
