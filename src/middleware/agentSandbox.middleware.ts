import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { agentGovernanceService } from '../services/agentGovernance.service';
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

      loggingService.info('Agent token detected - performing governance checks', {
        component: 'AgentSandboxMiddleware',
        operation: 'agentSandboxMiddleware'
      });

      // Perform comprehensive governance check
      const governanceResult = await agentGovernanceService.performGovernanceCheck(
        agentToken,
        options.action,
        {
          resource: options.resource,
          estimatedCost: extractEstimatedCost(req)
        }
      );

      if (!governanceResult.allowed) {
        loggingService.warn('Agent governance check failed', {
          component: 'AgentSandboxMiddleware',
          operation: 'agentSandboxMiddleware',
          reason: governanceResult.reason,
          violations: governanceResult.violations
        });

        res.status(403).json({
          error: 'Agent governance check failed',
          message: governanceResult.reason || 'Permission denied',
          violations: governanceResult.violations,
          details: {
            permissionResult: governanceResult.permissionResult,
            rateLimitResult: governanceResult.rateLimitResult,
            budgetResult: governanceResult.budgetResult
          }
        });
        return;
      }

      // Attach agent context to request
      const identity = governanceResult.identity!;
      req.agentContext = {
        agentId: identity.agentId,
        agentIdentityId: (identity._id as mongoose.Types.ObjectId).toString(),
        userId: governanceResult.identity!.userId.toString(),
        workspaceId: governanceResult.identity!.workspaceId?.toString(),
        organizationId: governanceResult.identity!.organizationId?.toString(),
        token: agentToken,
        governanceCheckPassed: true
      };

      // Add governance headers
      res.setHeader('X-Agent-Governance', 'enabled');
      res.setHeader('X-Agent-Id', governanceResult.identity!.agentId);
      res.setHeader('X-Agent-Sandbox-Required', governanceResult.identity!.sandboxRequired.toString());
      
      if (governanceResult.rateLimitResult) {
        res.setHeader('X-Agent-RateLimit-Remaining', governanceResult.rateLimitResult.remaining.toString());
        res.setHeader('X-Agent-RateLimit-Limit', governanceResult.rateLimitResult.limit.toString());
        res.setHeader('X-Agent-RateLimit-Reset', governanceResult.rateLimitResult.resetAt.toISOString());
      }

      loggingService.info('Agent governance check passed', {
        component: 'AgentSandboxMiddleware',
        operation: 'agentSandboxMiddleware',
        agentId: governanceResult.identity!.agentId,
        totalTime: `${Date.now() - startTime}ms`
      });

      next();
    } catch (error) {
      loggingService.error('Agent sandbox middleware error', {
        component: 'AgentSandboxMiddleware',
        operation: 'agentSandboxMiddleware',
        error: error instanceof Error ? error.message : String(error),
        totalTime: `${Date.now() - startTime}ms`
      });

      // Fail secure - deny on error
      res.status(500).json({
        error: 'Agent governance check failed',
        message: 'Internal error during governance check'
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
 * Extract estimated cost from request
 */
function extractEstimatedCost(req: Request): number | undefined {
  // Check header
  const costHeader = req.headers['x-estimated-cost'] as string;
  if (costHeader) {
    const cost = parseFloat(costHeader);
    if (!isNaN(cost)) return cost;
  }

  // Check body
  if (req.body?.estimatedCost) {
    const cost = parseFloat(req.body.estimatedCost);
    if (!isNaN(cost)) return cost;
  }

  return undefined;
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

