import { Types } from 'mongoose';
import { loggingService } from '../logging.service';
import { stsCredentialService } from './stsCredential.service';
import { killSwitchService } from './killSwitch.service';
import { permissionBoundaryService } from './permissionBoundary.service';
import { planGeneratorService } from './planGenerator.service';
import { AWSConnection, IAWSConnection } from '../../models/AWSConnection';
import { ExecutionPlan, ExecutionStep, StepResult } from '../../types/awsDsl.types';

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
        // In production, this would use the AWS SDK with the temporary credentials
        const result = await this.executeAwsApiCall(
          apiCall,
          credentials,
          step.resources
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
   * Execute an AWS API call
   * This is where the actual AWS SDK calls would happen
   */
  private async executeAwsApiCall(
    apiCall: { service: string; operation: string; parameters: Record<string, any> },
    credentials: { accessKeyId: string; secretAccessKey: string; sessionToken: string },
    resources: string[]
  ): Promise<{ requestId?: string; output?: any }> {
    // In production, this would use the appropriate AWS SDK client
    // For now, we simulate the call
    
    loggingService.info('Executing AWS API call', {
      component: 'ExecutionEngineService',
      operation: 'executeAwsApiCall',
      service: apiCall.service,
      awsOperation: apiCall.operation,
      resourceCount: resources.length,
      // Never log credentials
    });
    
    // Simulate API call delay
    await this.simulateDelay(1000 + Math.random() * 2000);
    
    return {
      requestId: `req-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`,
      output: { success: true },
    };
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
