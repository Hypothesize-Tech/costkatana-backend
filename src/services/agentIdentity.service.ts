import crypto from 'crypto';
import { AgentIdentity, IAgentIdentity } from '../models/AgentIdentity';
import { loggingService } from './logging.service';
import mongoose from 'mongoose';

/**
 * Agent Token Payload
 */
export interface AgentTokenPayload {
  agentId: string;
  agentType: string;
  userId: string;
  workspaceId?: string;
  capabilities: string[];
  expiresAt?: Date;
}

/**
 * Agent Identity Service
 * Manages agent authentication, authorization, and RBAC
 * Implements Principle of Least Privilege and Zero Trust
 */
export class AgentIdentityService {
  private static instance: AgentIdentityService;
  
  // Token cache for performance (TTL: 5 minutes)
  private tokenCache = new Map<string, { identity: IAgentIdentity; cachedAt: number }>();
  private readonly TOKEN_CACHE_TTL = 5 * 60 * 1000;

  private constructor() {}

  public static getInstance(): AgentIdentityService {
    if (!AgentIdentityService.instance) {
      AgentIdentityService.instance = new AgentIdentityService();
    }
    return AgentIdentityService.instance;
  }

  /**
   * Create new agent identity with secure token generation
   */
  public async createAgentIdentity(data: {
    agentName: string;
    agentType: IAgentIdentity['agentType'];
    userId: string | mongoose.Types.ObjectId;
    workspaceId?: string | mongoose.Types.ObjectId;
    organizationId?: string | mongoose.Types.ObjectId;
    allowedModels?: string[];
    allowedProviders?: string[];
    allowedActions?: string[];
    capabilities?: any[];
    budgetCapPerRequest?: number;
    budgetCapPerDay?: number;
    budgetCapPerMonth?: number;
    sandboxRequired?: boolean;
    sandboxConfig?: any;
    description?: string;
  }): Promise<{ identity: IAgentIdentity; token: string }> {
    try {
      // Generate secure agent token
      const token = this.generateAgentToken();
      const tokenHash = this.hashToken(token);
      const tokenPrefix = token.substring(0, 12); // First 12 chars for display
      
      // Generate unique agent ID
      const agentId = this.generateAgentId(data.agentType);

      // Create identity with secure defaults
      const identity = new AgentIdentity({
        agentId,
        agentName: data.agentName,
        agentType: data.agentType,
        userId: data.userId,
        workspaceId: data.workspaceId,
        organizationId: data.organizationId,
        tokenHash,
        tokenPrefix,
        allowedModels: data.allowedModels || [],
        allowedProviders: data.allowedProviders || [],
        allowedActions: data.allowedActions || ['read'], // Read-only by default
        capabilities: data.capabilities || [],
        budgetCapPerRequest: data.budgetCapPerRequest || 0.10,
        budgetCapPerDay: data.budgetCapPerDay || 1.00,
        budgetCapPerMonth: data.budgetCapPerMonth || 10.00,
        sandboxRequired: data.sandboxRequired !== undefined ? data.sandboxRequired : true,
        sandboxConfig: data.sandboxConfig,
        description: data.description,
        status: 'active',
        auditLevel: 'comprehensive',
        requireReasoningCapture: true
      });

      await identity.save();

      loggingService.info('Agent identity created', {
        component: 'AgentIdentityService',
        operation: 'createAgentIdentity',
        agentId: identity.agentId,
        agentType: identity.agentType,
        userId: data.userId.toString()
      });

      return { identity, token };
    } catch (error) {
      loggingService.error('Failed to create agent identity', {
        component: 'AgentIdentityService',
        operation: 'createAgentIdentity',
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Authenticate agent by token - Zero Trust verification
   */
  public async authenticateAgent(token: string): Promise<IAgentIdentity | null> {
    try {
      // Check cache first
      const cached = this.tokenCache.get(token);
      if (cached && (Date.now() - cached.cachedAt) < this.TOKEN_CACHE_TTL) {
        // Verify still active
        const identity = cached.identity as any;
        if (identity.isActive && identity.isActive()) {
          return cached.identity;
        }
        this.tokenCache.delete(token);
      }

      // Hash token and lookup
      const tokenHash = this.hashToken(token);
      const identity = await AgentIdentity.findOne({ 
        tokenHash,
        status: 'active'
      }).select('+tokenHash');

      if (!identity) {
        loggingService.warn('Agent authentication failed - invalid token', {
          component: 'AgentIdentityService',
          operation: 'authenticateAgent'
        });
        return null;
      }

      // Check expiration
      const identityDoc = identity as any;
      if (identityDoc.isExpired && identityDoc.isExpired()) {
        loggingService.warn('Agent authentication failed - token expired', {
          component: 'AgentIdentityService',
          operation: 'authenticateAgent',
          agentId: identity.agentId
        });
        identity.status = 'expired';
        await identity.save();
        return null;
      }

      // Update last used
      identity.lastUsedAt = new Date();
      await identity.save();

      // Cache for performance
      this.tokenCache.set(token, {
        identity,
        cachedAt: Date.now()
      });

      loggingService.info('Agent authenticated successfully', {
        component: 'AgentIdentityService',
        operation: 'authenticateAgent',
        agentId: identity.agentId,
        agentType: identity.agentType
      });

      return identity;
    } catch (error) {
      loggingService.error('Agent authentication error', {
        component: 'AgentIdentityService',
        operation: 'authenticateAgent',
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Check if agent has permission to perform action
   */
  public async checkPermission(
    identity: IAgentIdentity,
    action: string,
    resource?: {
      model?: string;
      provider?: string;
      capability?: string;
    }
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const identityDoc = identity as any;
      
      // Check active status
      if (!identityDoc.isActive || !identityDoc.isActive()) {
        return { 
          allowed: false, 
          reason: `Agent status is ${identity.status}` 
        };
      }

      // Check action permission
      if (!identityDoc.canExecuteAction || !identityDoc.canExecuteAction(action)) {
        return { 
          allowed: false, 
          reason: `Action '${action}' not in allowed actions` 
        };
      }

      // Check model permission
      if (resource?.model && (!identityDoc.canUseModel || !identityDoc.canUseModel(resource.model))) {
        return { 
          allowed: false, 
          reason: `Model '${resource.model}' not in allowed models` 
        };
      }

      // Check provider permission
      if (resource?.provider && (!identityDoc.canUseProvider || !identityDoc.canUseProvider(resource.provider))) {
        return { 
          allowed: false, 
          reason: `Provider '${resource.provider}' not in allowed providers` 
        };
      }

      // Check capability permission
      if (resource?.capability) {
        const hasCapability = identity.capabilities.some(
          cap => cap.name === resource.capability
        );
        if (!hasCapability) {
          return { 
            allowed: false, 
            reason: `Capability '${resource.capability}' not granted` 
          };
        }
      }

      return { allowed: true };
    } catch (error) {
      loggingService.error('Permission check error', {
        component: 'AgentIdentityService',
        operation: 'checkPermission',
        agentId: identity.agentId,
        error: error instanceof Error ? error.message : String(error)
      });
      return { allowed: false, reason: 'Permission check failed' };
    }
  }

  /**
   * Check budget limits for request
   * Fully implemented: checks per-request, per-day, and per-month budget by aggregating past usage.
   */
  public async checkBudgetLimit(
    identity: IAgentIdentity,
    estimatedCost: number
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      // Check per-request budget cap
      if (estimatedCost > identity.budgetCapPerRequest) {
        return {
          allowed: false,
          reason: `Estimated cost $${estimatedCost.toFixed(4)} exceeds per-request cap $${identity.budgetCapPerRequest.toFixed(4)}`
        };
      }

      // If no day/month budget, treat as not allowed
      if (identity.budgetCapPerDay <= 0) {
        return {
          allowed: false,
          reason: "Daily budget cap is zero - agent cannot make requests"
        };
      }
      if (identity.budgetCapPerMonth <= 0) {
        return {
          allowed: false,
          reason: "Monthly budget cap is zero - agent cannot make requests"
        };
      }

      // Calculate date ranges for aggregation
      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const tomorrowStart = new Date(todayStart);
      tomorrowStart.setDate(todayStart.getDate() + 1);

      const monthStart = new Date(now);
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const nextMonthStart = new Date(monthStart);
      nextMonthStart.setMonth(monthStart.getMonth() + 1);

      // Aggregate daily usage (sum of cost for today)
      const dailyAgg = await (mongoose.model('AgentExecution') as any).aggregate([
        {
          $match: {
            agentId: identity.agentId,
            createdAt: { $gte: todayStart, $lt: tomorrowStart },
            status: { $in: ['completed', 'failed', 'timeout', 'killed', 'resource_exceeded', 'policy_violated'] }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$actualCost" }
          }
        }
      ]);
      const dailyUsed = (dailyAgg?.[0]?.total ?? 0) as number;

      // Aggregate monthly usage (sum of cost for month)
      const monthlyAgg = await (mongoose.model('AgentExecution') as any).aggregate([
        {
          $match: {
            agentId: identity.agentId,
            createdAt: { $gte: monthStart, $lt: nextMonthStart },
            status: { $in: ['completed', 'failed', 'timeout', 'killed', 'resource_exceeded', 'policy_violated'] }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$actualCost" }
          }
        }
      ]);
      const monthlyUsed = (monthlyAgg?.[0]?.total ?? 0) as number;

      // Check daily budget
      if (dailyUsed + estimatedCost > identity.budgetCapPerDay) {
        return {
          allowed: false,
          reason: `Daily budget cap of $${identity.budgetCapPerDay.toFixed(2)} would be exceeded (used $${dailyUsed.toFixed(4)}, +$${estimatedCost.toFixed(4)})`
        };
      }

      // Check monthly budget
      if (monthlyUsed + estimatedCost > identity.budgetCapPerMonth) {
        return {
          allowed: false,
          reason: `Monthly budget cap of $${identity.budgetCapPerMonth.toFixed(2)} would be exceeded (used $${monthlyUsed.toFixed(4)}, +$${estimatedCost.toFixed(4)})`
        };
      }

      return { allowed: true };
    } catch (error) {
      loggingService.error('Budget limit check error', {
        component: 'AgentIdentityService',
        operation: 'checkBudgetLimit',
        agentId: identity.agentId,
        error: error instanceof Error ? error.message : String(error)
      });
      return { allowed: false, reason: 'Budget check failed' };
    }
  }

  /**
   * Update agent usage statistics
   */
  public async recordUsage(
    agentId: string,
    data: {
      cost: number;
      tokens: number;
      success: boolean;
      failureReason?: string;
    }
  ): Promise<void> {
    try {
      const update: any = {
        $inc: {
          totalRequests: 1,
          totalCost: data.cost,
          totalTokens: data.tokens
        },
        lastUsedAt: new Date()
      };

      if (!data.success) {
        update.$inc.failureCount = 1;
        update.lastFailureAt = new Date();
        update.lastFailureReason = data.failureReason;
      }

      await AgentIdentity.updateOne({ agentId }, update);

      // Invalidate cache
      this.invalidateCacheForAgent(agentId);
    } catch (error) {
      loggingService.error('Failed to record agent usage', {
        component: 'AgentIdentityService',
        operation: 'recordUsage',
        agentId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Revoke agent token (kill-switch)
   */
  public async revokeAgent(agentId: string, reason: string): Promise<void> {
    try {
      const identity = await AgentIdentity.findOne({ agentId });
      if (!identity) {
        throw new Error(`Agent ${agentId} not found`);
      }

      identity.status = 'revoked';
      identity.lastFailureAt = new Date();
      identity.lastFailureReason = reason;
      await identity.save();

      // Invalidate all caches for this agent
      this.invalidateCacheForAgent(agentId);

      loggingService.warn('Agent token revoked', {
        component: 'AgentIdentityService',
        operation: 'revokeAgent',
        agentId,
        reason
      });
    } catch (error) {
      loggingService.error('Failed to revoke agent', {
        component: 'AgentIdentityService',
        operation: 'revokeAgent',
        agentId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * List agents for user/workspace
   */
  public async listAgents(filter: {
    userId?: string;
    workspaceId?: string;
    organizationId?: string;
    status?: string;
    agentType?: string;
  }): Promise<IAgentIdentity[]> {
    try {
      const query: any = {};
      
      if (filter.userId) query.userId = filter.userId;
      if (filter.workspaceId) query.workspaceId = filter.workspaceId;
      if (filter.organizationId) query.organizationId = filter.organizationId;
      if (filter.status) query.status = filter.status;
      if (filter.agentType) query.agentType = filter.agentType;

      const agents = await AgentIdentity.find(query)
        .select('-tokenHash')
        .sort({ createdAt: -1 });

      return agents;
    } catch (error) {
      loggingService.error('Failed to list agents', {
        component: 'AgentIdentityService',
        operation: 'listAgents',
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Generate secure agent token
   */
  private generateAgentToken(): string {
    const randomBytes = crypto.randomBytes(32);
    const token = `ck-agent-${randomBytes.toString('hex')}`;
    return token;
  }

  /**
   * Hash token for storage
   */
  private hashToken(token: string): string {
    return crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');
  }

  /**
   * Generate unique agent ID
   */
  private generateAgentId(agentType: string): string {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(6).toString('hex');
    return `${agentType}-${timestamp}-${random}`;
  }

  /**
   * Invalidate cache for agent
   */
  private invalidateCacheForAgent(agentId: string): void {
    for (const [token, cached] of this.tokenCache.entries()) {
      if (cached.identity.agentId === agentId) {
        this.tokenCache.delete(token);
      }
    }
  }

  /**
   * Cleanup expired cache entries
   */
  public cleanupCache(): void {
    const now = Date.now();
    for (const [token, cached] of this.tokenCache.entries()) {
      if ((now - cached.cachedAt) > this.TOKEN_CACHE_TTL) {
        this.tokenCache.delete(token);
      }
    }
  }
}

// Export singleton instance
export const agentIdentityService = AgentIdentityService.getInstance();

