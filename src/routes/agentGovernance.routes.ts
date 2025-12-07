import { Router } from 'express';
import { AgentGovernanceController } from '../controllers/agentGovernance.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * Agent Identity Management
 */

// Create new agent identity
router.post(
  '/identities',
  requirePermission('canManageApiKeys'), // Treat similar to API keys
  AgentGovernanceController.createAgentIdentity
);

// List agent identities
router.get(
  '/identities',
  AgentGovernanceController.listAgentIdentities
);

// Get specific agent identity
router.get(
  '/identities/:agentId',
  AgentGovernanceController.getAgentIdentity
);

// Update agent identity
router.patch(
  '/identities/:agentId',
  requirePermission('canManageApiKeys'),
  AgentGovernanceController.updateAgentIdentity
);

// Revoke agent (standard)
router.post(
  '/identities/:agentId/revoke',
  requirePermission('canManageApiKeys'),
  AgentGovernanceController.revokeAgent
);

// Emergency kill-switch
router.post(
  '/identities/:agentId/emergency-kill',
  requirePermission('canManageApiKeys'),
  AgentGovernanceController.emergencyKillSwitch
);

/**
 * Agent Audit & Monitoring
 */

// Get agent decision history
router.get(
  '/identities/:agentId/decisions',
  AgentGovernanceController.getAgentDecisions
);

// Get agent execution history
router.get(
  '/identities/:agentId/executions',
  AgentGovernanceController.getAgentExecutions
);

// Get agent rate limit status
router.get(
  '/identities/:agentId/rate-limits',
  AgentGovernanceController.getAgentRateLimitStatus
);

// Get agent analytics
router.get(
  '/identities/:agentId/analytics',
  AgentGovernanceController.getAgentAnalytics
);

/**
 * Governance System Status
 */

// Get overall governance status
router.get(
  '/status',
  AgentGovernanceController.getGovernanceStatus
);

export default router;

