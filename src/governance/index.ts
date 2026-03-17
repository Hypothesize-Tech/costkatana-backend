/**
 * Governance infrastructure (sandbox, audit, identity).
 * Central export for governance-related components.
 */

// Schemas (re-export from module)
export { AgentIdentity } from '../modules/governance/schemas/agent-identity.schema';
export type {
  IAgentIdentity,
  IAgentCapability,
} from '../modules/governance/schemas/agent-identity.schema';
export { AgentDecisionAudit } from '../modules/governance/schemas/agent-decision-audit.schema';
export type {
  IAgentDecisionAudit,
  IAlternativeConsidered,
  IDecisionImpact,
  IExecutionContext,
  IHumanReview,
} from '../modules/governance/schemas/agent-decision-audit.schema';
export { AgentExecution } from '../schemas/agent/agent-execution.schema';
export type {
  IAgentExecution,
  ISandboxResourceLimits,
  ISandboxNetworkPolicy,
  ISandboxFilesystemPolicy,
  IResourceUsageSnapshot,
  ISecurityViolation,
} from '../schemas/agent/agent-execution.schema';

// Services (re-export from module)
export {
  getAgentIdentityService,
  AgentIdentityService,
} from '../modules/governance/services/agent-identity.service';
export type { AgentTokenPayload } from '../modules/governance/services/agent-identity.service';

export {
  AgentDecisionAuditService,
} from '../modules/governance/services/agent-decision-audit.service';
export type { RecordDecisionOptions } from '../modules/governance/services/agent-decision-audit.service';

export {
  AgentRateLimitService,
} from '../modules/governance/services/agent-rate-limit.service';
export type {
  RateLimitLevel,
  RateLimitResult,
  RateLimitConfig,
} from '../modules/governance/services/agent-rate-limit.service';

// Middleware
export {
  agentSandboxMiddleware,
  requireAgentIdentity,
  requireAgentAction,
} from '../middleware/agentSandbox.middleware';

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
  // Legacy shutdown - agent sandbox/audit services use Nest DI
  console.log('✅ Governance infrastructure shutdown complete');
}
