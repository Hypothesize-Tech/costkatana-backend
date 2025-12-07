import { EventEmitter } from 'events';
import mongoose from 'mongoose';
import { IAgentIdentity } from '../models/AgentIdentity';
import { agentIdentityService } from './agentIdentity.service';
import { agentRateLimitService, RateLimitResult } from './agentRateLimit.service';
import { agentSandboxService, SandboxExecutionRequest, SandboxExecutionResult } from './agentSandbox.service';
import { agentDecisionAuditService, RecordDecisionOptions } from './agentDecisionAudit.service';
import { loggingService } from './logging.service';

/**
 * Governance Check Result
 */
export interface GovernanceCheckResult {
  allowed: boolean;
  identity?: IAgentIdentity;
  rateLimitResult?: RateLimitResult;
  permissionResult?: { allowed: boolean; reason?: string };
  budgetResult?: { allowed: boolean; reason?: string };
  violations: string[];
  reason?: string;
}

/**
 * Governed Execution Request
 */
export interface GovernedExecutionRequest extends SandboxExecutionRequest {
  agentToken: string;
  action: string;
  resource?: {
    model?: string;
    provider?: string;
    capability?: string;
  };
}

/**
 * Agent Governance Service
 * Central orchestrator for all governance checks and enforcement
 * Implements Defense in Depth: Identity → Permission → Rate Limit → Budget → Sandbox → Audit
 */
export class AgentGovernanceService extends EventEmitter {
  private static instance: AgentGovernanceService;

  // Governance configuration
  private governanceEnabled = true;
  private readonly GOVERNANCE_OVERRIDE_KEY = process.env.GOVERNANCE_OVERRIDE_KEY;

  private constructor() {
    super();
    this.setupEventListeners();
  }

  public static getInstance(): AgentGovernanceService {
    if (!AgentGovernanceService.instance) {
      AgentGovernanceService.instance = new AgentGovernanceService();
    }
    return AgentGovernanceService.instance;
  }

  /**
   * Comprehensive governance check - All layers
   * Layer 1: Identity verification
   * Layer 2: Permission check (RBAC)
   * Layer 3: Rate limit check (hierarchical)
   * Layer 4: Budget check
   * Layer 5: Ready for sandbox execution
   */
  public async performGovernanceCheck(
    agentToken: string,
    action: string,
    options?: {
      resource?: {
        model?: string;
        provider?: string;
        capability?: string;
      };
      estimatedCost?: number;
      bypassGovernance?: boolean;
      overrideKey?: string;
    }
  ): Promise<GovernanceCheckResult> {
    const violations: string[] = [];

    try {
      // Check for bypass (emergency use only)
      if (options?.bypassGovernance && options?.overrideKey === this.GOVERNANCE_OVERRIDE_KEY) {
        loggingService.warn('Governance bypassed with override key', {
          component: 'AgentGovernanceService',
          operation: 'performGovernanceCheck',
          action
        });
        return {
          allowed: true,
          violations: ['governance_bypassed']
        };
      }

      // Check if governance is enabled
      if (!this.governanceEnabled) {
        loggingService.warn('Governance is disabled', {
          component: 'AgentGovernanceService',
          operation: 'performGovernanceCheck'
        });
        return {
          allowed: true,
          violations: ['governance_disabled']
        };
      }

      // Layer 1: Identity Verification (Zero Trust)
      loggingService.info('Layer 1: Verifying agent identity', {
        component: 'AgentGovernanceService',
        operation: 'performGovernanceCheck'
      });

      const identity = await agentIdentityService.authenticateAgent(agentToken);
      if (!identity) {
        violations.push('authentication_failed');
        return {
          allowed: false,
          violations,
          reason: 'Agent authentication failed'
        };
      }

      // Layer 2: Permission Check (RBAC)
      loggingService.info('Layer 2: Checking permissions', {
        component: 'AgentGovernanceService',
        operation: 'performGovernanceCheck',
        agentId: identity.agentId,
        action
      });

      const permissionResult = await agentIdentityService.checkPermission(
        identity,
        action,
        options?.resource
      );

      if (!permissionResult.allowed) {
        violations.push('permission_denied');
        
        // Emit security event
        this.emit('permission_denied', {
          agentId: identity.agentId,
          action,
          reason: permissionResult.reason
        });

        return {
          allowed: false,
          identity,
          permissionResult,
          violations,
          reason: permissionResult.reason
        };
      }

      // Layer 3: Rate Limit Check (Hierarchical)
      loggingService.info('Layer 3: Checking rate limits', {
        component: 'AgentGovernanceService',
        operation: 'performGovernanceCheck',
        agentId: identity.agentId
      });

      const rateLimitResult = await agentRateLimitService.checkRateLimits(identity);
      
      if (!rateLimitResult.allowed) {
        violations.push('rate_limit_exceeded');
        
        // Emit rate limit event
        this.emit('rate_limit_exceeded', {
          agentId: identity.agentId,
          level: rateLimitResult.level,
          limit: rateLimitResult.limit
        });

        return {
          allowed: false,
          identity,
          permissionResult,
          rateLimitResult,
          violations,
          reason: rateLimitResult.reason
        };
      }

      // Layer 4: Budget Check
      if (options?.estimatedCost) {
        loggingService.info('Layer 4: Checking budget limits', {
          component: 'AgentGovernanceService',
          operation: 'performGovernanceCheck',
          agentId: identity.agentId,
          estimatedCost: options.estimatedCost
        });

        const budgetResult = await agentIdentityService.checkBudgetLimit(
          identity,
          options.estimatedCost
        );

        if (!budgetResult.allowed) {
          violations.push('budget_exceeded');
          
          // Emit budget event
          this.emit('budget_exceeded', {
            agentId: identity.agentId,
            estimatedCost: options.estimatedCost,
            reason: budgetResult.reason
          });

          return {
            allowed: false,
            identity,
            permissionResult,
            rateLimitResult,
            budgetResult,
            violations,
            reason: budgetResult.reason
          };
        }
      }

      // Layer 5: All checks passed - ready for sandbox execution
      loggingService.info('All governance checks passed', {
        component: 'AgentGovernanceService',
        operation: 'performGovernanceCheck',
        agentId: identity.agentId,
        action
      });

      this.emit('governance_passed', {
        agentId: identity.agentId,
        action
      });

      return {
        allowed: true,
        identity,
        permissionResult,
        rateLimitResult,
        violations: []
      };
    } catch (error) {
      loggingService.error('Governance check error', {
        component: 'AgentGovernanceService',
        operation: 'performGovernanceCheck',
        error: error instanceof Error ? error.message : String(error)
      });

      // Fail secure - deny on error
      violations.push('governance_error');
      return {
        allowed: false,
        violations,
        reason: 'Governance check failed due to error'
      };
    }
  }

  /**
   * Execute agent request with full governance
   * Complete flow: Governance Check → Decision Audit → Sandbox Execution → Result Audit
   */
  public async executeWithGovernance(
    request: GovernedExecutionRequest
  ): Promise<SandboxExecutionResult> {
    const startTime = Date.now();
    let decisionId: string | undefined;

    try {
      // Step 1: Perform comprehensive governance check
      const governanceResult = await this.performGovernanceCheck(
        request.agentToken,
        request.action,
        {
          resource: request.resource,
          estimatedCost: request.estimatedCost
        }
      );

      if (!governanceResult.allowed || !governanceResult.identity) {
        throw new Error(governanceResult.reason || 'Governance check failed');
      }

      const identity = governanceResult.identity;

      // Step 2: Record decision audit BEFORE execution
      const decisionOptions: RecordDecisionOptions = {
        agentId: identity.agentId,
        agentIdentityId: identity._id as mongoose.Types.ObjectId,
        userId: request.userId,
        workspaceId: request.workspaceId,
        organizationId: request.organizationId,
        
        decisionType: this.mapActionToDecisionType(request.action),
        decision: `Execute ${request.action} with ${request.command}`,
        reasoning: `Agent executing action: ${request.action}`,
        alternativesConsidered: [], // Would be populated in production
        
        confidenceScore: 0.85,
        riskLevel: this.assessRiskLevel(request, identity),
        
        executionContext: {
          executionId: 'pending',
          startTime: new Date(),
          status: 'pending'
        },
        
        inputData: {
          command: request.command,
          arguments: request.arguments,
          action: request.action,
          resource: request.resource
        },
        
        humanOverrideable: true,
        reversible: true,
        requiresApproval: false,
        
        correlationId: request.correlationId,
        parentDecisionId: request.decisionId
      };

      decisionId = await agentDecisionAuditService.recordDecision(decisionOptions);

      // Step 3: Execute in sandbox
      loggingService.info('Executing agent request in sandbox', {
        component: 'AgentGovernanceService',
        operation: 'executeWithGovernance',
        agentId: identity.agentId,
        decisionId
      });

      const sandboxRequest: SandboxExecutionRequest = {
        ...request,
        agentIdentity: identity,
        decisionId
      };

      const result = await agentSandboxService.executeInSandbox(sandboxRequest);

      // Step 4: Update decision audit with results
      // Map sandbox status to execution context status
      const mapStatus = (status: string): 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'killed' => {
        if (status === 'completed') return 'completed';
        if (status === 'failed' || status === 'resource_exceeded' || status === 'policy_violated') return 'failed';
        if (status === 'timeout') return 'timeout';
        if (status === 'killed') return 'killed';
        if (status === 'running' || status === 'starting' || status === 'provisioning') return 'running';
        return 'pending';
      };
      
      await agentDecisionAuditService.updateDecisionResult(decisionId, {
        executionContext: {
          status: mapStatus(result.status),
          endTime: new Date(),
          durationMs: result.executionTimeMs,
          exitCode: result.exitCode,
          errorMessage: result.errorMessage
        },
        outputData: result.outputData,
        wasSuccessful: result.status === 'completed',
        successMetrics: {
          executionTimeMs: result.executionTimeMs,
          cost: result.actualCost || 0
        }
      });

      // Step 5: Record usage statistics
      await agentIdentityService.recordUsage(identity.agentId, {
        cost: result.actualCost || request.estimatedCost,
        tokens: 0, // Would be calculated from result
        success: result.status === 'completed',
        failureReason: result.errorMessage
      });

      // Step 6: Decrement concurrent counter
      await agentRateLimitService.decrementConcurrent(identity.agentId);

      // Emit completion event
      this.emit('execution_completed', {
        agentId: identity.agentId,
        decisionId,
        executionId: result.executionId,
        status: result.status,
        durationMs: Date.now() - startTime
      });

      return result;
    } catch (error) {
      loggingService.error('Governed execution failed', {
        component: 'AgentGovernanceService',
        operation: 'executeWithGovernance',
        error: error instanceof Error ? error.message : String(error),
        decisionId
      });

      // Update decision audit with failure
      if (decisionId) {
        await agentDecisionAuditService.updateDecisionResult(decisionId, {
          executionContext: {
            status: 'failed',
            endTime: new Date(),
            durationMs: Date.now() - startTime,
            errorMessage: error instanceof Error ? error.message : String(error)
          },
          wasSuccessful: false
        });
      }

      throw error;
    }
  }

  /**
   * Emergency kill-switch - Revoke agent and kill all executions
   */
  public async emergencyKillSwitch(
    agentId: string,
    reason: string,
    initiatedBy: string
  ): Promise<void> {
    loggingService.warn('Emergency kill-switch activated', {
      component: 'AgentGovernanceService',
      operation: 'emergencyKillSwitch',
      agentId,
      reason,
      initiatedBy
    });

    try {
      // 1. Revoke agent identity
      await agentIdentityService.revokeAgent(agentId, reason);

      // 2. Kill all active executions for this agent
      // Real implementation: terminate any running executions from this agent
      const sandboxService = agentSandboxService as any;
      if (typeof sandboxService.killExecutionsForAgent === 'function') {
        await sandboxService.killExecutionsForAgent(agentId, reason ?? 'Emergency kill-switch');
      } else if (
        // fallback: agentSandboxService may expose internal activeExecutions
        sandboxService.activeExecutions
        && typeof sandboxService.activeExecutions.forEach === 'function'
      ) {
        const sandbox = sandboxService;
        const executionsToKill: string[] = [];
        sandbox.activeExecutions.forEach((exec: any, executionId: string) => {
          if (exec.execution?.agentId === agentId || exec.execution?.agentIdentity?.agentId === agentId) {
            executionsToKill.push(executionId);
          }
        });

        for (const executionId of executionsToKill) {
          if (typeof sandbox.killExecution === "function") {
            try {
              await sandbox.killExecution(executionId, reason ?? 'Emergency kill-switch');
              loggingService.warn(`Killed execution ${executionId} for agent ${agentId}`, {
                component: 'AgentGovernanceService',
                operation: 'emergencyKillSwitch',
                executionId,
                agentId
              });
            } catch (e) {
              loggingService.error('Failed to kill execution', {
                component: 'AgentGovernanceService',
                operation: 'emergencyKillSwitch',
                executionId,
                agentId,
                error: e instanceof Error ? e.message : String(e)
              });
            }
          }
        }
      } else {
        loggingService.warn('Could not terminate executions: agentSandboxService does not expose execution controls', {
          component: 'AgentGovernanceService',
          operation: 'emergencyKillSwitch',
          agentId,
        });
      }

      // 3. Clear rate limits (so the agent can't make new requests)
      await agentRateLimitService.resetRateLimits(agentId);

      // 4. Emit emergency event
      this.emit('emergency_killswitch', {
        agentId,
        reason,
        initiatedBy,
        timestamp: new Date()
      });

      loggingService.warn('Emergency kill-switch completed', {
        component: 'AgentGovernanceService',
        operation: 'emergencyKillSwitch',
        agentId
      });
    } catch (error) {
      loggingService.error('Emergency kill-switch failed', {
        component: 'AgentGovernanceService',
        operation: 'emergencyKillSwitch',
        agentId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Enable/disable governance (emergency use)
   */
  public setGovernanceEnabled(enabled: boolean, overrideKey?: string): boolean {
    if (!enabled && overrideKey !== this.GOVERNANCE_OVERRIDE_KEY) {
      loggingService.error('Attempted to disable governance without valid override key', {
        component: 'AgentGovernanceService',
        operation: 'setGovernanceEnabled'
      });
      return false;
    }

    this.governanceEnabled = enabled;
    
    loggingService.warn('Governance state changed', {
      component: 'AgentGovernanceService',
      operation: 'setGovernanceEnabled',
      enabled
    });

    this.emit('governance_state_changed', { enabled });
    return true;
  }

  /**
   * Get governance status
   */
  public getGovernanceStatus(): {
    enabled: boolean;
    services: {
      identity: boolean;
      rateLimit: boolean;
      sandbox: boolean;
      audit: boolean;
    };
  } {
    return {
      enabled: this.governanceEnabled,
      services: {
        identity: true, // Services are always available
        rateLimit: true,
        sandbox: true,
        audit: true
      }
    };
  }

  /**
   * Helper: Map action to decision type
   */
  private mapActionToDecisionType(action: string): RecordDecisionOptions['decisionType'] {
    if (action.includes('model') || action.includes('select')) return 'model_selection';
    if (action.includes('execute') || action.includes('run')) return 'action_execution';
    if (action.includes('resource') || action.includes('allocate')) return 'resource_allocation';
    if (action.includes('capability')) return 'capability_invocation';
    if (action.includes('data') || action.includes('access')) return 'data_access';
    if (action.includes('api') || action.includes('call')) return 'api_call';
    return 'other';
  }

  /**
   * Helper: Assess risk level
   */
  private assessRiskLevel(
    request: GovernedExecutionRequest,
    identity: IAgentIdentity
  ): 'low' | 'medium' | 'high' | 'critical' {
    // Assess based on multiple factors
    let riskScore = 0;

    // High-cost operations
    if (request.estimatedCost > identity.budgetCapPerRequest * 0.8) {
      riskScore += 2;
    }

    // Write/delete actions
    if (identity.allowedActions.includes('write') || identity.allowedActions.includes('delete')) {
      riskScore += 1;
    }

    // Admin actions
    if (identity.allowedActions.includes('admin')) {
      riskScore += 3;
    }

    // Map score to risk level
    if (riskScore >= 5) return 'critical';
    if (riskScore >= 3) return 'high';
    if (riskScore >= 1) return 'medium';
    return 'low';
  }

  /**
   * Setup event listeners for cross-service coordination
   */
  private setupEventListeners(): void {
    // Listen to sandbox events
    agentSandboxService.on('execution_killed', (data) => {
      this.emit('agent_execution_killed', data);
    });

    // Listen to audit events
    agentDecisionAuditService.on('decision_recorded', (data) => {
      if (data.riskLevel === 'high' || data.riskLevel === 'critical') {
        this.emit('high_risk_decision', data);
      }
    });
  }
}

// Export singleton instance
export const agentGovernanceService = AgentGovernanceService.getInstance();

