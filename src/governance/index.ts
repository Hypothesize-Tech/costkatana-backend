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

export { AgentDecisionAuditService } from '../modules/governance/services/agent-decision-audit.service';
export type { RecordDecisionOptions } from '../modules/governance/services/agent-decision-audit.service';

export { AgentRateLimitService } from '../modules/governance/services/agent-rate-limit.service';
export type {
  RateLimitLevel,
  RateLimitResult,
  RateLimitConfig,
} from '../modules/governance/services/agent-rate-limit.service';

// Middleware - use common/middleware (AgentSandboxMiddleware for Nest; require* for Express)
export {
  AgentSandboxMiddleware,
  requireAgentIdentity,
  requireAgentAction,
} from '../common/middleware/agent-sandbox.middleware';

import { Logger } from '@nestjs/common';

const governanceLogger = new Logger('Governance');

/**
 * Initialize governance system (sandbox and audit services).
 *
 * Note: Actual lifecycle is handled by NestJS dependency injection. AgentSandboxService,
 * AgentDecisionAuditService, and related governance services are registered in GovernanceModule
 * and initialized when the application boots. This function exists for legacy callers that
 * expect an explicit init; it performs no runtime work. Do not rely on it for readiness.
 *
 * @see GovernanceModule
 * @see AgentSandboxService
 * @see AgentDecisionAuditService
 */
export async function initializeGovernance(): Promise<void> {
  governanceLogger.log('Governance infrastructure (sandbox, audit) ready');
}

/**
 * Shutdown governance system.
 *
 * Note: Agent sandbox and audit services use Nest DI; their disposal is handled by
 * NestJS module lifecycle (onModuleDestroy). This function exists for legacy callers.
 * It performs no runtime work.
 */
export async function shutdownGovernance(): Promise<void> {
  governanceLogger.log('Governance infrastructure shutdown complete');
}
