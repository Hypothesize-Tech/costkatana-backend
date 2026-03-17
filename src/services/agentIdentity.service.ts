/**
 * Bridge: Re-exports for legacy Express middleware.
 * For NestJS usage, use getAgentIdentityService() from governance or inject AgentIdentityService.
 */
import { getAgentIdentityService } from '../modules/governance/services/agent-identity.service';

function getService() {
  try {
    return getAgentIdentityService();
  } catch {
    return null;
  }
}

export const agentIdentityService = {
  authenticateAgent: async (token: string) => {
    const svc = getService();
    return svc ? svc.authenticateAgent(token) : null;
  },
  checkPermission: async (identity: unknown, action: string) => {
    const svc = getService();
    if (!svc) return { allowed: false, reason: 'Service not initialized' };
    return svc.checkPermission(identity as any, action);
  },
};
