import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import {
  AgentIdentity,
  IAgentIdentity,
} from '../../../schemas/agent/agent-identity.schema';

let agentIdentityServiceInstance: AgentIdentityService | null = null;

export function getAgentIdentityService(): AgentIdentityService {
  if (!agentIdentityServiceInstance) {
    throw new Error(
      'AgentIdentityService not initialized. Ensure GovernanceModule is imported.',
    );
  }
  return agentIdentityServiceInstance;
}

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
@Injectable()
export class AgentIdentityService {
  private readonly logger = new Logger(AgentIdentityService.name);

  // Token cache for performance (TTL: 5 minutes)
  private tokenCache = new Map<
    string,
    { identity: IAgentIdentity; cachedAt: number }
  >();
  private readonly TOKEN_CACHE_TTL = 5 * 60 * 1000;

  constructor(
    @InjectModel(AgentIdentity.name)
    private agentIdentityModel: Model<IAgentIdentity>,
  ) {
    agentIdentityServiceInstance = this;
  }

  /**
   * Create new agent identity with secure token generation
   */
  async createAgentIdentity(data: {
    agentName: string;
    agentType: IAgentIdentity['agentType'];
    userId: string | Types.ObjectId;
    workspaceId?: string | Types.ObjectId;
    organizationId?: string | Types.ObjectId;
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
      const identity = new this.agentIdentityModel({
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
        budgetCapPerRequest: data.budgetCapPerRequest || 0.1,
        budgetCapPerDay: data.budgetCapPerDay || 1.0,
        budgetCapPerMonth: data.budgetCapPerMonth || 10.0,
        sandboxRequired:
          data.sandboxRequired !== undefined ? data.sandboxRequired : true,
        sandboxConfig: data.sandboxConfig,
        description: data.description,
        status: 'active',
        auditLevel: 'comprehensive',
        requireReasoningCapture: true,
      });

      await identity.save();

      this.logger.log(`Agent identity created: ${identity.agentId}`, {
        agentType: identity.agentType,
        userId: data.userId.toString(),
      });

      return { identity, token };
    } catch (error) {
      this.logger.error('Failed to create agent identity', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Authenticate agent by token - Zero Trust verification
   */
  async authenticateAgent(token: string): Promise<IAgentIdentity | null> {
    try {
      // Check cache first
      const cached = this.tokenCache.get(token);
      if (cached && Date.now() - cached.cachedAt < this.TOKEN_CACHE_TTL) {
        // Verify still active
        const identity = cached.identity as any;
        if (identity.isActive && identity.isActive()) {
          return cached.identity;
        }
        this.tokenCache.delete(token);
      }

      // Hash token and lookup
      const tokenHash = this.hashToken(token);
      const identity = await this.agentIdentityModel
        .findOne({ tokenHash, status: 'active' })
        .select('+tokenHash');

      if (!identity) {
        this.logger.warn('Agent authentication failed - invalid token');
        return null;
      }

      // Check expiration
      const identityDoc = identity as any;
      if (identityDoc.isExpired && identityDoc.isExpired()) {
        this.logger.warn('Agent authentication failed - token expired', {
          agentId: identity.agentId,
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
        cachedAt: Date.now(),
      });

      this.logger.log('Agent authenticated successfully', {
        agentId: identity.agentId,
        agentType: identity.agentType,
      });

      return identity;
    } catch (error) {
      this.logger.error('Agent authentication error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Check if agent has permission to perform action
   */
  async checkPermission(
    identity: IAgentIdentity,
    action: string,
    resource?: {
      model?: string;
      provider?: string;
      capability?: string;
    },
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const identityDoc = identity as any;

      // Check active status
      if (!identityDoc.isActive || !identityDoc.isActive()) {
        return {
          allowed: false,
          reason: `Agent status is ${identity.status}`,
        };
      }

      // Check action permission
      if (
        !identityDoc.canExecuteAction ||
        !identityDoc.canExecuteAction(action)
      ) {
        return {
          allowed: false,
          reason: `Action '${action}' not in allowed actions`,
        };
      }

      // Check model permission
      if (
        resource?.model &&
        (!identityDoc.canUseModel || !identityDoc.canUseModel(resource.model))
      ) {
        return {
          allowed: false,
          reason: `Model '${resource.model}' not in allowed models`,
        };
      }

      // Check provider permission
      if (
        resource?.provider &&
        (!identityDoc.canUseProvider ||
          !identityDoc.canUseProvider(resource.provider))
      ) {
        return {
          allowed: false,
          reason: `Provider '${resource.provider}' not in allowed providers`,
        };
      }

      // Check capability permission
      if (resource?.capability) {
        const hasCapability = identity.capabilities.some(
          (cap) => cap.name === resource.capability,
        );
        if (!hasCapability) {
          return {
            allowed: false,
            reason: `Capability '${resource.capability}' not granted`,
          };
        }
      }

      return { allowed: true };
    } catch (error) {
      this.logger.error('Permission check error', {
        agentId: identity.agentId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { allowed: false, reason: 'Permission check failed' };
    }
  }

  /**
   * Check budget limits for request
   */
  async checkBudgetLimit(
    identity: IAgentIdentity,
    estimatedCost: number,
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      // Check per-request budget cap
      if (estimatedCost > identity.budgetCapPerRequest) {
        return {
          allowed: false,
          reason: `Estimated cost $${estimatedCost.toFixed(4)} exceeds per-request cap $${identity.budgetCapPerRequest.toFixed(4)}`,
        };
      }

      // If no day/month budget, treat as not allowed
      if (identity.budgetCapPerDay <= 0) {
        return {
          allowed: false,
          reason: 'Daily budget cap is zero - agent cannot make requests',
        };
      }
      if (identity.budgetCapPerMonth <= 0) {
        return {
          allowed: false,
          reason: 'Monthly budget cap is zero - agent cannot make requests',
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
      const dailyAgg = await this.agentIdentityModel.db
        .model('AgentExecution')
        .aggregate([
          {
            $match: {
              agentId: identity.agentId,
              createdAt: { $gte: todayStart, $lt: tomorrowStart },
              status: {
                $in: [
                  'completed',
                  'failed',
                  'timeout',
                  'killed',
                  'resource_exceeded',
                  'policy_violated',
                ],
              },
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: '$actualCost' },
            },
          },
        ]);
      const dailyUsed = (dailyAgg?.[0]?.total ?? 0) as number;

      // Aggregate monthly usage (sum of cost for month)
      const monthlyAgg = await this.agentIdentityModel.db
        .model('AgentExecution')
        .aggregate([
          {
            $match: {
              agentId: identity.agentId,
              createdAt: { $gte: monthStart, $lt: nextMonthStart },
              status: {
                $in: [
                  'completed',
                  'failed',
                  'timeout',
                  'killed',
                  'resource_exceeded',
                  'policy_violated',
                ],
              },
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: '$actualCost' },
            },
          },
        ]);
      const monthlyUsed = (monthlyAgg?.[0]?.total ?? 0) as number;

      // Check daily budget
      if (dailyUsed + estimatedCost > identity.budgetCapPerDay) {
        return {
          allowed: false,
          reason: `Daily budget cap of $${identity.budgetCapPerDay.toFixed(2)} would be exceeded (used $${dailyUsed.toFixed(4)}, +$${estimatedCost.toFixed(4)})`,
        };
      }

      // Check monthly budget
      if (monthlyUsed + estimatedCost > identity.budgetCapPerMonth) {
        return {
          allowed: false,
          reason: `Monthly budget cap of $${identity.budgetCapPerMonth.toFixed(2)} would be exceeded (used $${monthlyUsed.toFixed(4)}, +$${estimatedCost.toFixed(4)})`,
        };
      }

      return { allowed: true };
    } catch (error) {
      this.logger.error('Budget limit check error', {
        agentId: identity.agentId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { allowed: false, reason: 'Budget check failed' };
    }
  }

  /**
   * Update agent usage statistics
   */
  async recordUsage(
    agentId: string,
    data: {
      cost: number;
      tokens: number;
      success: boolean;
      failureReason?: string;
    },
  ): Promise<void> {
    try {
      const update: any = {
        $inc: {
          totalRequests: 1,
          totalCost: data.cost,
          totalTokens: data.tokens,
        },
        lastUsedAt: new Date(),
      };

      if (!data.success) {
        update.$inc.failureCount = 1;
        update.lastFailureAt = new Date();
        update.lastFailureReason = data.failureReason;
      }

      await this.agentIdentityModel.updateOne({ agentId }, update);

      // Invalidate cache
      this.invalidateCacheForAgent(agentId);
    } catch (error) {
      this.logger.error('Failed to record agent usage', {
        agentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Revoke agent token (kill-switch)
   */
  async revokeAgent(agentId: string, reason: string): Promise<void> {
    try {
      const identity = await this.agentIdentityModel.findOne({ agentId });
      if (!identity) {
        throw new Error(`Agent ${agentId} not found`);
      }

      identity.status = 'revoked';
      identity.lastFailureAt = new Date();
      identity.lastFailureReason = reason;
      await identity.save();

      // Invalidate all caches for this agent
      this.invalidateCacheForAgent(agentId);

      this.logger.warn('Agent token revoked', {
        agentId,
        reason,
      });
    } catch (error) {
      this.logger.error('Failed to revoke agent', {
        agentId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * List agents for user/workspace
   */
  async listAgents(filter: {
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

      const agents = await this.agentIdentityModel
        .find(query)
        .select('-tokenHash')
        .sort({ createdAt: -1 });

      return agents;
    } catch (error) {
      this.logger.error('Failed to list agents', {
        error: error instanceof Error ? error.message : String(error),
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
    return crypto.createHash('sha256').update(token).digest('hex');
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
   * Initialize agent identities (load from database, validate, etc.)
   */
  async initializeIdentities(): Promise<void> {
    try {
      this.logger.log('Initializing agent identities...');

      // Count existing identities
      const identityCount = await this.agentIdentityModel.countDocuments();
      this.logger.log(`Found ${identityCount} agent identities in database`);

      // Validate critical system identities exist
      await this.ensureSystemIdentities();

      // Cleanup expired tokens in cache
      this.cleanupCache();

      this.logger.log('Agent identities initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize agent identities', error);
      throw error;
    }
  }

  /**
   * Get deterministic system user ObjectId from env or well-known fallback
   */
  private getSystemUserId(): Types.ObjectId {
    const envId = process.env.SYSTEM_USER_ID;
    if (envId && /^[a-fA-F0-9]{24}$/.test(envId)) {
      return new Types.ObjectId(envId);
    }
    return new Types.ObjectId('000000000000000000000001');
  }

  /**
   * Ensure critical system identities exist
   */
  private async ensureSystemIdentities(): Promise<void> {
    const systemUserId = this.getSystemUserId();
    const systemIdentities = [
      {
        agentName: 'System Admin Agent',
        agentType: 'system' as const,
        userId: systemUserId,
        allowedActions: ['*'],
        capabilities: ['admin', 'system'],
        isActive: true,
      },
      {
        agentName: 'Audit Agent',
        agentType: 'system' as const,
        userId: systemUserId,
        allowedActions: ['read_audit_logs', 'write_audit_logs'],
        capabilities: ['audit', 'monitoring'],
        isActive: true,
      },
    ];

    for (const identity of systemIdentities) {
      const existing = await this.agentIdentityModel.findOne({
        agentName: identity.agentName,
        agentType: 'system',
      });

      if (!existing) {
        await this.agentIdentityModel.create(identity);
        this.logger.log(`Created system identity: ${identity.agentName}`);
      }
    }
  }

  /**
   * Cleanup expired cache entries
   */
  cleanupCache(): void {
    const now = Date.now();
    for (const [token, cached] of this.tokenCache.entries()) {
      if (now - cached.cachedAt > this.TOKEN_CACHE_TTL) {
        this.tokenCache.delete(token);
      }
    }
  }

  /**
   * Apply governance policies to agent identities
   */
  async applyPolicies(policies: any[]): Promise<void> {
    try {
      this.logger.log(`Applying ${policies.length} governance policies`);

      for (const policy of policies) {
        // Update existing identities to comply with policies
        await this.enforcePolicyOnIdentities(policy);
      }

      this.logger.log('Governance policies applied successfully');
    } catch (error) {
      this.logger.error('Failed to apply governance policies', error);
      throw error;
    }
  }

  /**
   * Validate all agent identities for compliance
   */
  async validateIdentities(): Promise<void> {
    try {
      const identities = await this.agentIdentityModel.find({ isActive: true });

      let validCount = 0;
      let invalidCount = 0;

      for (const identity of identities) {
        const isValid = await this.validateIdentity(identity);
        if (isValid) {
          validCount++;
        } else {
          invalidCount++;
          this.logger.warn(`Invalid agent identity: ${identity.agentName}`);
        }
      }

      this.logger.log(
        `Identity validation completed: ${validCount} valid, ${invalidCount} invalid`,
      );
    } catch (error) {
      this.logger.error('Identity validation failed', error);
      throw error;
    }
  }

  /**
   * Flush any pending identity operations
   */
  async flushPendingOperations(): Promise<void> {
    try {
      // Process any pending cache operations
      this.cleanupCache();

      // Force commit any pending database operations
      await (
        this.agentIdentityModel.db as unknown as {
          admin: () => { ping: () => Promise<void> };
        }
      )
        .admin()
        .ping();

      // Clear any temporary state
      this.logger.log('Pending identity operations flushed successfully');
    } catch (error) {
      this.logger.error('Failed to flush pending identity operations', error);
      throw error;
    }
  }

  /**
   * Get all agent identities (for policy generation)
   */
  async getAllIdentities(): Promise<any[]> {
    try {
      const identities = await this.agentIdentityModel
        .find({ isActive: true })
        .select('-encryptedTokens -privateKey') // Exclude sensitive data
        .lean();

      return identities;
    } catch (error) {
      this.logger.error('Failed to get all identities', error);
      return [];
    }
  }

  /**
   * Enforce a specific policy on existing identities
   */
  private async enforcePolicyOnIdentities(policy: any): Promise<void> {
    const updateQuery: any = {};

    if (policy.maxTokensPerRequest) {
      updateQuery.budgetCapPerRequest = Math.min(
        policy.maxTokensPerRequest,
        updateQuery.budgetCapPerRequest || Infinity,
      );
    }

    if (policy.allowedModels && policy.allowedModels.length > 0) {
      // Intersect with existing allowed models
      updateQuery.allowedModels = { $in: policy.allowedModels };
    }

    if (Object.keys(updateQuery).length > 0) {
      await this.agentIdentityModel.updateMany(
        { isActive: true },
        { $set: updateQuery },
      );
    }
  }

  /**
   * Validate a single agent identity
   */
  private async validateIdentity(identity: any): Promise<boolean> {
    // Check if identity has required fields
    if (!identity.agentName || !identity.agentType) {
      return false;
    }

    // Check if identity is within policy limits
    if (identity.budgetCapPerRequest && identity.budgetCapPerRequest < 0) {
      return false;
    }

    // Check token expiration
    if (identity.expiresAt && new Date(identity.expiresAt) < new Date()) {
      return false;
    }

    return true;
  }
}
