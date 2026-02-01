import { Request, Response, NextFunction } from 'express';
import { loggingService } from '../services/logging.service';

// Extend Express Request type to include agent context
declare global {
  namespace Express {
    interface Request {
      agentContext?: {
        agentId: string;
        agentIdentityId: string;
        userId: string;
        workspaceId?: string;
        organizationId?: string;
        token: string;
        governanceCheckPassed: boolean;
      };
    }
  }
}

/**
 * Agent Sandbox Middleware
 * Enforces sandbox execution requirements and governance checks
 * Must be used after authentication/gateway middleware
 */
export const agentSandboxMiddleware = (options: {
  action: string;
  resource?: {
    model?: string;
    provider?: string;
    capability?: string;
  };
  requireSandbox?: boolean;
} = { action: 'execute' }) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const startTime = Date.now();
    
    loggingService.info('=== AGENT SANDBOX MIDDLEWARE STARTED ===', {
      component: 'AgentSandboxMiddleware',
      operation: 'agentSandboxMiddleware',
      path: req.path,
      method: req.method,
      action: options.action
    });

    try {
      // Check if this is an agent request
      const agentToken = extractAgentToken(req);
      
      if (!agentToken) {
        // Not an agent request - skip sandbox checks
        loggingService.info('No agent token found - skipping sandbox checks', {
          component: 'AgentSandboxMiddleware',
          operation: 'agentSandboxMiddleware'
        });
        next();
        return;
      }

      loggingService.info('Agent token detected - Agent Governance disabled', {
        component: 'AgentSandboxMiddleware',
        operation: 'agentSandboxMiddleware'
      });

      // Agent Governance feature removed: deny agent token requests with 403
      res.status(403).json({
        error: 'Agent governance disabled',
        message: 'Agent Governance has been removed. Agent token authentication is not available.'
      });
      return;
    } catch (error) {
      loggingService.error('Agent sandbox middleware error', {
        component: 'AgentSandboxMiddleware',
        operation: 'agentSandboxMiddleware',
        error: error instanceof Error ? error.message : String(error),
        totalTime: `${Date.now() - startTime}ms`
      });

      // Fail secure - deny on error
      res.status(500).json({
        error: 'Agent sandbox middleware error',
        message: 'Internal error during request processing'
      });
    }
  };
};

/**
 * Extract agent token from request
 * Supports multiple token locations for flexibility
 */
function extractAgentToken(req: Request): string | null {
  // Check Authorization header
  const authHeader = req.headers['authorization'] as string;
  if (authHeader?.startsWith('Bearer ck-agent-')) {
    return authHeader.substring(7); // Remove 'Bearer '
  }

  // Check X-Agent-Token header
  const agentTokenHeader = req.headers['x-agent-token'] as string;
  if (agentTokenHeader?.startsWith('ck-agent-')) {
    return agentTokenHeader;
  }

  // Check CostKatana-Auth header (for gateway requests)
  const costkatanaAuth = req.headers['costkatana-auth'] as string;
  if (costkatanaAuth?.includes('ck-agent-')) {
    const match = costkatanaAuth.match(/ck-agent-[a-f0-9]+/);
    return match ? match[0] : null;
  }

  // Check query parameter (least preferred)
  const queryToken = req.query.agent_token as string;
  if (queryToken?.startsWith('ck-agent-')) {
    return queryToken;
  }

  return null;
}

/**
 * Require agent identity - ensures request is from an agent
 */
export const requireAgentIdentity = () => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.agentContext) {
      res.status(401).json({
        error: 'Agent identity required',
        message: 'This endpoint requires an authenticated agent'
      });
      return;
    }

    next();
  };
};

/**
 * Require specific agent action permission
 */
export const requireAgentAction = (...actions: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.agentContext) {
      res.status(401).json({
        error: 'Agent identity required',
        message: 'This endpoint requires an authenticated agent'
      });
      return;
    }

    // Check if agent is allowed to perform the required action(s)
    // Assumes agentContext contains allowedActions: string[]
    // If agentContext does not include allowedActions, treat as forbidden

    const allowedActions = (req.agentContext as any).allowedActions as string[] | undefined;

    if (!allowedActions || !Array.isArray(allowedActions)) {
      res.status(403).json({
        error: 'Action not allowed',
        message: 'Agent action permissions not found'
      });
      return;
    }

    const hasAction =
      actions.length === 0 ||
      actions.some(action =>
        allowedActions.includes(action)
      );

    if (!hasAction) {
      res.status(403).json({
        error: 'Action not allowed',
        message: 'Agent does not have permission to perform the requested action',
        requiredAction: actions
      });
      return;
    }

    next();
  };
};

