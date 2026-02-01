/**
 * Governance infrastructure (sandbox, audit, identity).
 * Central export for governance-related components.
 */

// Models
export { AgentIdentity, IAgentIdentity, IAgentCapability } from '../models/AgentIdentity';
export { 
  AgentDecisionAudit, 
  IAgentDecisionAudit, 
  IAlternativeConsidered,
  IDecisionImpact,
  IExecutionContext,
  IHumanReview
} from '../models/AgentDecisionAudit';
export {
  AgentExecution,
  IAgentExecution,
  ISandboxResourceLimits,
  ISandboxNetworkPolicy,
  ISandboxFilesystemPolicy,
  IResourceUsageSnapshot,
  ISecurityViolation
} from '../models/AgentExecution';

// Services
export { 
  agentIdentityService, 
  AgentIdentityService,
  AgentTokenPayload
} from '../services/agentIdentity.service';

export {
  agentDecisionAuditService,
  AgentDecisionAuditService,
  RecordDecisionOptions
} from '../services/agentDecisionAudit.service';

export {
  agentRateLimitService,
  AgentRateLimitService,
  RateLimitLevel,
  RateLimitResult,
  RateLimitConfig
} from '../services/agentRateLimit.service';

export {
  agentSandboxService,
  AgentSandboxService,
  SandboxExecutionRequest,
  SandboxExecutionResult
} from '../services/agentSandbox.service';

// Middleware
export {
  agentSandboxMiddleware,
  requireAgentIdentity,
  requireAgentAction
} from '../middleware/agentSandbox.middleware';

import { agentSandboxService } from '../services/agentSandbox.service';
import { agentDecisionAuditService } from '../services/agentDecisionAudit.service';

/**
 * Initialize governance system (sandbox and audit services).
 * Agent Governance feature has been removed; this initializes remaining infrastructure.
 */
export async function initializeGovernance(): Promise<void> {
  console.log('✅ Governance infrastructure (sandbox, audit) ready');
}

/**
 * Shutdown governance system
 */
export async function shutdownGovernance(): Promise<void> {
  await agentSandboxService.shutdown();
  agentDecisionAuditService.stopFlushTimer();
  
  console.log('✅ Governance infrastructure shutdown complete');
}

