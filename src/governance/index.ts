/**
 * Agent Governance System
 * Central export for all governance components
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

export {
  agentGovernanceService,
  AgentGovernanceService,
  GovernanceCheckResult,
  GovernedExecutionRequest
} from '../services/agentGovernance.service';

// Middleware
export {
  agentSandboxMiddleware,
  requireAgentIdentity,
  requireAgentAction
} from '../middleware/agentSandbox.middleware';

// Controllers
export { AgentGovernanceController } from '../controllers/agentGovernance.controller';

// Configuration
export {
  AgentGovernanceConfig,
  DEFAULT_AGENT_GOVERNANCE_CONFIG,
  getAgentGovernanceConfig,
  validateGovernanceConfig
} from '../config/agentGovernance.config';

import { getAgentGovernanceConfig, validateGovernanceConfig } from '../config/agentGovernance.config';
import { agentSandboxService } from '../services/agentSandbox.service';
import { agentDecisionAuditService } from '../services/agentDecisionAudit.service';

/**
 * Initialize governance system
 */
export async function initializeGovernance(): Promise<void> {
  const config = getAgentGovernanceConfig();
  validateGovernanceConfig(config);
  
  console.log('✅ Agent Governance System initialized');
  console.log(`   - Governance: ${config.enabled ? 'ENABLED' : 'DISABLED'}`);
  console.log(`   - Sandbox: ${config.sandbox.defaultIsolation}`);
  console.log(`   - Audit Level: ${config.audit.level}`);
  console.log(`   - Rate Limits: ${config.rateLimit.defaultRequestsPerMinute}/min`);
  console.log(`   - Budget: $${config.budget.defaultBudgetPerRequest}/request`);
}

/**
 * Shutdown governance system
 */
export async function shutdownGovernance(): Promise<void> {
  await agentSandboxService.shutdown();
  agentDecisionAuditService.stopFlushTimer();
  
  console.log('✅ Agent Governance System shutdown complete');
}

