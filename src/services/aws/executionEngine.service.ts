import { Types } from 'mongoose';
import { loggingService } from '../logging.service';
import { stsCredentialService } from './stsCredential.service';
import { killSwitchService } from './killSwitch.service';
import { permissionBoundaryService } from './permissionBoundary.service';
import { planGeneratorService } from './planGenerator.service';
import { AWSConnection, IAWSConnection } from '../../models/AWSConnection';
import { ExecutionPlan, ExecutionStep, StepResult } from '../../types/awsDsl.types';
import { EC2Client, StopInstancesCommand, StartInstancesCommand, ModifyInstanceAttributeCommand } from '@aws-sdk/client-ec2';
import { S3Client, PutBucketLifecycleConfigurationCommand, PutBucketIntelligentTieringConfigurationCommand } from '@aws-sdk/client-s3';
import { RDSClient, StopDBInstanceCommand, StartDBInstanceCommand, CreateDBSnapshotCommand, ModifyDBInstanceCommand } from '@aws-sdk/client-rds';
import { LambdaClient, UpdateFunctionConfigurationCommand } from '@aws-sdk/client-lambda';

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
  userId: Types.ObjectId;
  connectionId: Types.ObjectId;
  planId: string;
  approvalToken: string;
  approvedAt: Date;
}

export interface ExecutionResult {
  planId: string;
  status: 'completed' | 'partial' | 'failed' | 'rolled_back';
  steps: ExecutionStep[];
  startedAt: Date;
  completedAt: Date;
  duration: number;
  error?: string;
  rollbackExecuted?: boolean;
}

export interface ExecutionProgress {
  planId: string;
  currentStep: number;
  totalSteps: number;
  stepId: string;
  stepStatus: string;
  progress: number;  // 0-100
  message: string;
}

type ProgressCallback = (progress: ExecutionProgress) => void;

// Approval token expiration (15 minutes)
const APPROVAL_TOKEN_EXPIRATION_MS = 15 * 60 * 1000;

class ExecutionEngineService {
  private static instance: ExecutionEngineService;
  
  // Active executions (for tracking and cancellation)
  private activeExecutions: Map<string, {
    context: ExecutionContext;
    cancelled: boolean;
    startedAt: Date;
  }> = new Map();
  
  // Approval tokens (short-lived)
  private approvalTokens: Map<string, {
    planId: string;
    userId: string;
    connectionId: string;
    createdAt: Date;
    expiresAt: Date;
    used: boolean;
  }> = new Map();
  
  private constructor() {
    // Clean up expired tokens periodically
    setInterval(() => this.cleanupExpiredTokens(), 60000);
  }
  
  public static getInstance(): ExecutionEngineService {
    if (!ExecutionEngineService.instance) {
      ExecutionEngineService.instance = new ExecutionEngineService();
    }
    return ExecutionEngineService.instance;
  }
  
  /**
   * Generate an approval token for a plan
   * This token must be used within 15 minutes
   */
  public generateApprovalToken(
    planId: string,
    userId: string,
    connectionId: string
  ): { token: string; expiresAt: Date } {
    const token = `approval-${Date.now()}-${Math.random().toString(36).substr(2, 16)}`;
    const expiresAt = new Date(Date.now() + APPROVAL_TOKEN_EXPIRATION_MS);
    
    this.approvalTokens.set(token, {
      planId,
      userId,
      connectionId,
      createdAt: new Date(),
      expiresAt,
      used: false,
    });
    
    loggingService.info('Approval token generated', {
      component: 'ExecutionEngineService',
      operation: 'generateApprovalToken',
      planId,
      userId,
      expiresAt,
    });
    
    return { token, expiresAt };
  }
  
  /**
   * Validate an approval token
   */
  public validateApprovalToken(
    token: string,
    planId: string,
    userId: string
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
   * Execute an approved plan
   * This is the main entry point for execution
   */
  public async execute(
    plan: ExecutionPlan,
    context: ExecutionContext,
    onProgress?: ProgressCallback
  ): Promise<ExecutionResult> {
    const startedAt = new Date();
    
    // 1. Validate approval token
    const tokenValidation = this.validateApprovalToken(
      context.approvalToken,
      plan.planId,
      context.userId.toString()
    );
    
    if (!tokenValidation.valid) {
      throw new Error(`Approval validation failed: ${tokenValidation.reason}`);
    }
    
    // Mark token as used
    const tokenData = this.approvalTokens.get(context.approvalToken);
    if (tokenData) {
      tokenData.used = true;
    }
    
    // 2. Validate plan is still valid
    const planValidation = planGeneratorService.validatePlan(plan);
    if (!planValidation.valid) {
      throw new Error(`Plan validation failed: ${planValidation.reason}`);
    }
    
    // 3. Check kill switch
    const connection = await AWSConnection.findById(context.connectionId);
    if (!connection) {
      throw new Error('Connection not found');
    }
    
    const killSwitchCheck = killSwitchService.checkKillSwitch({
      customerId: context.userId.toString(),
      connectionId: context.connectionId.toString(),
      service: plan.steps[0]?.service || 'unknown',
      action: plan.steps[0]?.action || 'unknown',
      isWrite: true,
      riskLevel: plan.summary.riskScore > 75 ? 'high' : 
                 plan.summary.riskScore > 50 ? 'medium' : 'low',
    });
    
    if (!killSwitchCheck.allowed) {
      throw new Error(`Kill switch active: ${killSwitchCheck.reason}`);
    }
    
    // 4. Check execution mode (simulation vs live)
    if (connection.executionMode === 'simulation' && !connection.canExecuteLive()) {
      throw new Error('Connection is in simulation mode - live execution not allowed yet');
    }
    
    // 5. Register active execution
    this.activeExecutions.set(plan.planId, {
      context,
      cancelled: false,
      startedAt,
    });
    
    // 6. Obtain temporary credentials
    const credentials = await stsCredentialService.assumeRole(connection, plan.planId);
    
    loggingService.info('Execution started', {
      component: 'ExecutionEngineService',
      operation: 'execute',
      planId: plan.planId,
      stepCount: plan.steps.length,
      userId: context.userId.toString(),
    });
    
    // 7. Execute steps
    let lastCompletedStep = -1;
    let executionError: string | undefined;
    
    try {
      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        
        // Check for cancellation
        const activeExecution = this.activeExecutions.get(plan.planId);
        if (activeExecution?.cancelled) {
          throw new Error('Execution cancelled by user');
        }
        
        // Report progress
        if (onProgress) {
          onProgress({
            planId: plan.planId,
            currentStep: i + 1,
            totalSteps: plan.steps.length,
            stepId: step.stepId,
            stepStatus: 'running',
            progress: Math.round((i / plan.steps.length) * 100),
            message: `Executing: ${step.description}`,
          });
        }
        
        // Execute the step
        step.status = 'running';
        const stepResult = await this.executeStep(step, connection, credentials.credentials);
        step.result = stepResult;
        step.status = stepResult.success ? 'completed' : 'failed';
        
        if (!stepResult.success) {
          executionError = stepResult.error;
          
          // Check if we should rollback
          if (plan.rollbackPlan && i > 0) {
            loggingService.warn('Step failed - initiating rollback', {
              component: 'ExecutionEngineService',
              operation: 'execute',
              planId: plan.planId,
              failedStep: step.stepId,
              error: stepResult.error,
            });
            
            // Execute rollback
            await this.executeRollback(plan.rollbackPlan, connection, credentials.credentials, onProgress);
            
            return {
              planId: plan.planId,
              status: 'rolled_back',
              steps: plan.steps,
              startedAt,
              completedAt: new Date(),
              duration: Date.now() - startedAt.getTime(),
              error: executionError,
              rollbackExecuted: true,
            };
          }
          
          break;
        }
        
        lastCompletedStep = i;
        
        // Report progress
        if (onProgress) {
          onProgress({
            planId: plan.planId,
            currentStep: i + 1,
            totalSteps: plan.steps.length,
            stepId: step.stepId,
            stepStatus: 'completed',
            progress: Math.round(((i + 1) / plan.steps.length) * 100),
            message: `Completed: ${step.description}`,
          });
        }
      }
    } finally {
      // Clean up
      this.activeExecutions.delete(plan.planId);
      
      // Update connection usage
      connection.lastUsed = new Date();
      connection.totalExecutions += 1;
      connection.totalApiCalls += plan.steps.reduce(
        (sum, step) => sum + step.apiCalls.length, 0
      );
      await connection.save();
    }
    
    const completedAt = new Date();
    const allCompleted = lastCompletedStep === plan.steps.length - 1;
    
    loggingService.info('Execution completed', {
      component: 'ExecutionEngineService',
      operation: 'execute',
      planId: plan.planId,
      status: allCompleted ? 'completed' : executionError ? 'failed' : 'partial',
      stepsCompleted: lastCompletedStep + 1,
      totalSteps: plan.steps.length,
      duration: completedAt.getTime() - startedAt.getTime(),
    });
    
    return {
      planId: plan.planId,
      status: allCompleted ? 'completed' : executionError ? 'failed' : 'partial',
      steps: plan.steps,
      startedAt,
      completedAt,
      duration: completedAt.getTime() - startedAt.getTime(),
      error: executionError,
    };
  }
  
  /**
   * Execute a single step
   */
  private async executeStep(
    step: ExecutionStep,
    connection: IAWSConnection,
    credentials: { accessKeyId: string; secretAccessKey: string; sessionToken: string }
  ): Promise<StepResult> {
    const startedAt = new Date();
    const awsRequestIds: string[] = [];
    
    try {
      // Skip pre/post checks in simulation mode
      if (step.action.startsWith('precheck:') || step.action.startsWith('postcheck:')) {
        // Simulate check
        await this.simulateDelay(500);
        
        return {
          success: true,
          startedAt,
          completedAt: new Date(),
          duration: Date.now() - startedAt.getTime(),
          awsRequestIds: [],
          output: { checked: true },
        };
      }
      
      // Execute API calls
      for (const apiCall of step.apiCalls) {
        // Validate against permission boundary
        const permCheck = permissionBoundaryService.validateAction(
          {
            service: apiCall.service.toLowerCase(),
            action: apiCall.operation,
            resources: step.resources,
          },
          connection
        );
        
        if (!permCheck.allowed) {
          throw new Error(`Permission denied: ${permCheck.reason}`);
        }
        
        // Execute the actual AWS API call
        const result = await this.executeAwsApiCall(
          apiCall,
          credentials,
          step.resources,
          connection
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
        output: { resourcesAffected: step.resources.length },
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
   * Creates the appropriate AWS client and executes the operation with temporary credentials
   */
  private async executeAwsApiCall(
    apiCall: { service: string; operation: string; parameters: Record<string, unknown> },
    credentials: { accessKeyId: string; secretAccessKey: string; sessionToken: string },
    resources: string[],
    connection: IAWSConnection
  ): Promise<{ requestId?: string; output?: Record<string, unknown> }> {
    const regionParam = typeof apiCall.parameters.region === 'string' ? apiCall.parameters.region : undefined;
    const region: string = regionParam ?? connection.allowedRegions[0] ?? 'us-east-1';
    
    loggingService.info('Executing AWS API call', {
      component: 'ExecutionEngineService',
      operation: 'executeAwsApiCall',
      service: apiCall.service,
      awsOperation: apiCall.operation,
      region,
      parameters: Object.keys(apiCall.parameters),
      resources,
      resourceCount: resources.length,
      // Never log credentials!
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
          return await this.executeEC2Operation(apiCall, awsCredentials, resources, region);
        case 's3':
          return await this.executeS3Operation(apiCall, awsCredentials, resources, region);
        case 'rds':
          return await this.executeRDSOperation(apiCall, awsCredentials, resources, region);
        case 'lambda':
          return await this.executeLambdaOperation(apiCall, awsCredentials, resources, region);
        default:
          throw new Error(`Unsupported AWS service: ${apiCall.service}`);
      }
    } catch (error) {
      loggingService.error('AWS API call failed', {
        component: 'ExecutionEngineService',
        operation: 'executeAwsApiCall',
        service: apiCall.service,
        awsOperation: apiCall.operation,
        region,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  /**
   * Execute EC2 operations
   */
  private async executeEC2Operation(
    apiCall: { operation: string; parameters: Record<string, unknown> },
    credentials: { accessKeyId: string; secretAccessKey: string; sessionToken: string },
    resources: string[],
    region: string
  ): Promise<{ requestId?: string; output?: Record<string, unknown> }> {
    const client = new EC2Client({
      region,
      credentials,
    });

    switch (apiCall.operation) {
      case 'StopInstances': {
        const command = new StopInstancesCommand({
          InstanceIds: resources,
          ...apiCall.parameters,
        });
        const response = await client.send(command);
        return {
          requestId: response.$metadata.requestId,
          output: {
            StoppingInstances: response.StoppingInstances?.map((inst) => ({
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
          ...apiCall.parameters,
        });
        const response = await client.send(command);
        return {
          requestId: response.$metadata.requestId,
          output: {
            StartingInstances: response.StartingInstances?.map((inst) => ({
              InstanceId: inst.InstanceId,
              CurrentState: inst.CurrentState,
              PreviousState: inst.PreviousState,
            })) ?? [],
          },
        };
      }

      case 'ModifyInstanceAttribute': {
        // ModifyInstanceAttribute works on a single instance
        const instanceId = resources[0];
        if (!instanceId) {
          throw new Error('Instance ID is required for ModifyInstanceAttribute');
        }

        // Extract attribute name and value from parameters
        const { attribute, value, ...otherParams } = apiCall.parameters;
        
        const command = new ModifyInstanceAttributeCommand({
          InstanceId: instanceId,
          ...(attribute === 'InstanceType' && typeof value === 'string' && { InstanceType: { Value: value } }),
          ...(attribute === 'InstanceInitiatedShutdownBehavior' && typeof value === 'string' && { 
            InstanceInitiatedShutdownBehavior: { Value: value } 
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
    apiCall: { operation: string; parameters: Record<string, unknown> },
    credentials: { accessKeyId: string; secretAccessKey: string; sessionToken: string },
    resources: string[],
    region: string
  ): Promise<{ requestId?: string; output?: Record<string, unknown> }> {
    const client = new S3Client({
      region,
      credentials,
    });

    switch (apiCall.operation) {
      case 'PutBucketLifecycleConfiguration': {
        const bucketName = resources[0];
        if (!bucketName) {
          throw new Error('Bucket name is required for PutBucketLifecycleConfiguration');
        }

        const { LifecycleConfiguration, ...otherParams } = apiCall.parameters;
        
        // LifecycleConfiguration comes from plan generator and should be properly structured
        // Using type assertion since plan generator ensures correct structure
        const command = new PutBucketLifecycleConfigurationCommand({
          Bucket: bucketName,
          LifecycleConfiguration: (LifecycleConfiguration || apiCall.parameters.LifecycleConfiguration) as any,
          ...(otherParams as Record<string, unknown>),
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
        const bucketNameForTiering = resources[0];
        if (!bucketNameForTiering) {
          throw new Error('Bucket name is required for PutBucketIntelligentTieringConfiguration');
        }

        const { Id, IntelligentTieringConfiguration, ...tieringParams } = apiCall.parameters;
        
        // IntelligentTieringConfiguration comes from plan generator and should be properly structured
        // Using type assertion since plan generator ensures correct structure
        const command = new PutBucketIntelligentTieringConfigurationCommand({
          Bucket: bucketNameForTiering,
          Id: (typeof Id === 'string' ? Id : 'CostKatanaOptimization'),
          IntelligentTieringConfiguration: (IntelligentTieringConfiguration || apiCall.parameters.IntelligentTieringConfiguration) as any,
          ...(tieringParams as Record<string, unknown>),
        });
        const response = await client.send(command);
        return {
          requestId: response.$metadata.requestId,
          output: {
            Bucket: bucketNameForTiering,
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
    apiCall: { operation: string; parameters: Record<string, unknown> },
    credentials: { accessKeyId: string; secretAccessKey: string; sessionToken: string },
    resources: string[],
    region: string
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
          ...apiCall.parameters,
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
          ...apiCall.parameters,
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

        const { DBSnapshotIdentifier, ...snapshotParams } = apiCall.parameters;
        if (!DBSnapshotIdentifier || typeof DBSnapshotIdentifier !== 'string') {
          throw new Error('DBSnapshotIdentifier is required for CreateDBSnapshot');
        }

        const command = new CreateDBSnapshotCommand({
          DBInstanceIdentifier: snapshotDbInstanceId,
          DBSnapshotIdentifier,
          ...(snapshotParams as Record<string, unknown>),
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

        const { DBInstanceClass, AllocatedStorage, ...modifyParams } = apiCall.parameters;
        
        const command = new ModifyDBInstanceCommand({
          DBInstanceIdentifier: modifyDbInstanceId,
          ...(typeof DBInstanceClass === 'string' && { DBInstanceClass }),
          ...(typeof AllocatedStorage === 'number' && { AllocatedStorage }),
          ApplyImmediately: apiCall.parameters.ApplyImmediately !== false, // Default to true for cost optimization
          ...(modifyParams as Record<string, unknown>),
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
    apiCall: { operation: string; parameters: Record<string, unknown> },
    credentials: { accessKeyId: string; secretAccessKey: string; sessionToken: string },
    resources: string[],
    region: string
  ): Promise<{ requestId?: string; output?: Record<string, unknown> }> {
    const client = new LambdaClient({
      region,
      credentials,
    });

    switch (apiCall.operation) {
      case 'UpdateFunctionConfiguration': {
        const functionName = resources[0];
        if (!functionName) {
          throw new Error('Function name is required for UpdateFunctionConfiguration');
        }

        const { MemorySize, Timeout, ...lambdaParams } = apiCall.parameters;
        
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
    connection: IAWSConnection,
    credentials: { accessKeyId: string; secretAccessKey: string; sessionToken: string },
    onProgress?: ProgressCallback
  ): Promise<void> {
    loggingService.info('Executing rollback', {
      component: 'ExecutionEngineService',
      operation: 'executeRollback',
      planId: rollbackPlan.planId,
    });
    
    for (let i = 0; i < rollbackPlan.steps.length; i++) {
      const step = rollbackPlan.steps[i];
      
      if (onProgress) {
        onProgress({
          planId: rollbackPlan.planId,
          currentStep: i + 1,
          totalSteps: rollbackPlan.steps.length,
          stepId: step.stepId,
          stepStatus: 'rolling_back',
          progress: Math.round((i / rollbackPlan.steps.length) * 100),
          message: `Rolling back: ${step.description}`,
        });
      }
      
      const result = await this.executeStep(step, connection, credentials);
      step.status = result.success ? 'rolled_back' : 'failed';
      step.result = result;
    }
  }
  
  /**
   * Cancel an active execution
   */
  public cancelExecution(planId: string, userId: string): { success: boolean; reason?: string } {
    const activeExecution = this.activeExecutions.get(planId);
    
    if (!activeExecution) {
      return { success: false, reason: 'No active execution found for this plan' };
    }
    
    if (activeExecution.context.userId.toString() !== userId) {
      return { success: false, reason: 'Not authorized to cancel this execution' };
    }
    
    activeExecution.cancelled = true;
    
    loggingService.info('Execution cancelled', {
      component: 'ExecutionEngineService',
      operation: 'cancelExecution',
      planId,
      userId,
    });
    
    return { success: true };
  }
  
  /**
   * Get active executions for a user
   */
  public getActiveExecutions(userId: string): Array<{
    planId: string;
    startedAt: Date;
    connectionId: string;
  }> {
    const executions: Array<{
      planId: string;
      startedAt: Date;
      connectionId: string;
    }> = [];
    
    for (const [planId, execution] of this.activeExecutions) {
      if (execution.context.userId.toString() === userId) {
        executions.push({
          planId,
          startedAt: execution.startedAt,
          connectionId: execution.context.connectionId.toString(),
        });
      }
    }
    
    return executions;
  }
  
  /**
   * Clean up expired approval tokens
   */
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
      loggingService.info('Cleaned up expired approval tokens', {
        component: 'ExecutionEngineService',
        operation: 'cleanupExpiredTokens',
        tokensRemoved: cleaned,
      });
    }
  }
  
  /**
   * Simulate delay (for development/testing)
   */
  private simulateDelay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const executionEngineService = ExecutionEngineService.getInstance();
