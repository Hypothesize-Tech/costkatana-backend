import { IAgentIdentity } from '../models/AgentIdentity';
import { loggingService } from './logging.service';
import { cacheService } from './cache.service';

/**
 * Rate Limit Level - Hierarchical enforcement
 */
export type RateLimitLevel = 'organization' | 'user' | 'agent' | 'request';

/**
 * Rate Limit Result
 */
export interface RateLimitResult {
  allowed: boolean;
  level: RateLimitLevel;
  limit: number;
  current: number;
  remaining: number;
  resetAt: Date;
  retryAfter?: number;
  reason?: string;
}

/**
 * Rate Limit Configuration
 */
export interface RateLimitConfig {
  organization?: {
    requestsPerHour: number;
    requestsPerDay: number;
  };
  user?: {
    requestsPerMinute: number;
    requestsPerHour: number;
    requestsPerDay: number;
  };
  agent?: {
    requestsPerMinute: number;
    requestsPerHour: number;
    requestsPerDay: number;
    maxConcurrent: number;
  };
  request?: {
    burstLimit: number;
    burstWindowMs: number;
  };
}

/**
 * Agent Rate Limit Service
 * Hierarchical rate limiting: Organization → User → Agent → Request
 * Independent quotas prevent single agent from draining resources
 */
export class AgentRateLimitService {
  private static instance: AgentRateLimitService;

  // Default limits - Conservative by default
  private readonly DEFAULT_LIMITS: RateLimitConfig = {
    organization: {
      requestsPerHour: 10000,
      requestsPerDay: 100000
    },
    user: {
      requestsPerMinute: 100,
      requestsPerHour: 1000,
      requestsPerDay: 10000
    },
    agent: {
      requestsPerMinute: 10,
      requestsPerHour: 100,
      requestsPerDay: 1000,
      maxConcurrent: 5
    },
    request: {
      burstLimit: 20,
      burstWindowMs: 1000 // 1 second
    }
  };

  private constructor() {}

  public static getInstance(): AgentRateLimitService {
    if (!AgentRateLimitService.instance) {
      AgentRateLimitService.instance = new AgentRateLimitService();
    }
    return AgentRateLimitService.instance;
  }

  /**
   * Check all hierarchical rate limits
   * Enforces limits at all levels: org → user → agent → request
   */
  public async checkRateLimits(
    agentIdentity: IAgentIdentity,
    customLimits?: Partial<RateLimitConfig>
  ): Promise<RateLimitResult> {
    try {
      const limits = this.mergeLimits(customLimits);

      // Level 1: Organization limits
      if (agentIdentity.organizationId) {
        const orgResult = await this.checkOrganizationLimits(
          agentIdentity.organizationId.toString(),
          limits.organization!
        );
        if (!orgResult.allowed) {
          return orgResult;
        }
      }

      // Level 2: User limits (separate from agent)
      const userResult = await this.checkUserLimits(
        agentIdentity.userId.toString(),
        limits.user!
      );
      if (!userResult.allowed) {
        return userResult;
      }

      // Level 3: Agent limits (most restrictive)
      const agentResult = await this.checkAgentLimits(
        agentIdentity.agentId,
        agentIdentity,
        limits.agent!
      );
      if (!agentResult.allowed) {
        return agentResult;
      }

      // Level 4: Request burst protection
      const requestResult = await this.checkRequestBurst(
        agentIdentity.agentId,
        limits.request!
      );
      if (!requestResult.allowed) {
        return requestResult;
      }

      // All limits passed
      await this.incrementCounters(agentIdentity);

      return {
        allowed: true,
        level: 'request',
        limit: limits.agent!.requestsPerMinute,
        current: agentResult.current + 1,
        remaining: agentResult.remaining - 1,
        resetAt: agentResult.resetAt
      };
    } catch (error) {
      loggingService.error('Rate limit check error', {
        component: 'AgentRateLimitService',
        operation: 'checkRateLimits',
        agentId: agentIdentity.agentId,
        error: error instanceof Error ? error.message : String(error)
      });

      // Fail open to avoid blocking on errors
      return {
        allowed: true,
        level: 'request',
        limit: 0,
        current: 0,
        remaining: 0,
        resetAt: new Date(),
        reason: 'Rate limit check failed - allowing request'
      };
    }
  }

  /**
   * Check organization-level limits
   */
  private async checkOrganizationLimits(
    organizationId: string,
    limits: { requestsPerHour: number; requestsPerDay: number }
  ): Promise<RateLimitResult> {
    const hourKey = `ratelimit:org:${organizationId}:hour`;
    const dayKey = `ratelimit:org:${organizationId}:day`;

    // Check hourly limit
    const hourCount = await this.getCount(hourKey);
    if (hourCount >= limits.requestsPerHour) {
      const ttl = await this.getTTL(hourKey) || 3600;
      return {
        allowed: false,
        level: 'organization',
        limit: limits.requestsPerHour,
        current: hourCount,
        remaining: 0,
        resetAt: new Date(Date.now() + ttl * 1000),
        retryAfter: ttl,
        reason: 'Organization hourly rate limit exceeded'
      };
    }

    // Check daily limit
    const dayCount = await this.getCount(dayKey);
    if (dayCount >= limits.requestsPerDay) {
      const ttl = await this.getTTL(dayKey) || 86400;
      return {
        allowed: false,
        level: 'organization',
        limit: limits.requestsPerDay,
        current: dayCount,
        remaining: 0,
        resetAt: new Date(Date.now() + ttl * 1000),
        retryAfter: ttl,
        reason: 'Organization daily rate limit exceeded'
      };
    }

    return {
      allowed: true,
      level: 'organization',
      limit: limits.requestsPerHour,
      current: hourCount,
      remaining: limits.requestsPerHour - hourCount,
      resetAt: new Date(Date.now() + 3600000)
    };
  }

  /**
   * Check user-level limits (for all agent requests by this user)
   */
  private async checkUserLimits(
    userId: string,
    limits: { requestsPerMinute: number; requestsPerHour: number; requestsPerDay: number }
  ): Promise<RateLimitResult> {
    const minuteKey = `ratelimit:user:${userId}:minute`;
    const hourKey = `ratelimit:user:${userId}:hour`;
    const dayKey = `ratelimit:user:${userId}:day`;

    // Check minute limit
    const minuteCount = await this.getCount(minuteKey);
    if (minuteCount >= limits.requestsPerMinute) {
      const ttl = await this.getTTL(minuteKey) || 60;
      return {
        allowed: false,
        level: 'user',
        limit: limits.requestsPerMinute,
        current: minuteCount,
        remaining: 0,
        resetAt: new Date(Date.now() + ttl * 1000),
        retryAfter: ttl,
        reason: 'User per-minute rate limit exceeded'
      };
    }

    // Check hourly limit
    const hourCount = await this.getCount(hourKey);
    if (hourCount >= limits.requestsPerHour) {
      const ttl = await this.getTTL(hourKey) || 3600;
      return {
        allowed: false,
        level: 'user',
        limit: limits.requestsPerHour,
        current: hourCount,
        remaining: 0,
        resetAt: new Date(Date.now() + ttl * 1000),
        retryAfter: ttl,
        reason: 'User hourly rate limit exceeded'
      };
    }

    // Check daily limit
    const dayCount = await this.getCount(dayKey);
    if (dayCount >= limits.requestsPerDay) {
      const ttl = await this.getTTL(dayKey) || 86400;
      return {
        allowed: false,
        level: 'user',
        limit: limits.requestsPerDay,
        current: dayCount,
        remaining: 0,
        resetAt: new Date(Date.now() + ttl * 1000),
        retryAfter: ttl,
        reason: 'User daily rate limit exceeded'
      };
    }

    return {
      allowed: true,
      level: 'user',
      limit: limits.requestsPerMinute,
      current: minuteCount,
      remaining: limits.requestsPerMinute - minuteCount,
      resetAt: new Date(Date.now() + 60000)
    };
  }

  /**
   * Check agent-specific limits
   */
  private async checkAgentLimits(
    agentId: string,
    agentIdentity: IAgentIdentity,
    limits: { requestsPerMinute: number; requestsPerHour: number; requestsPerDay: number; maxConcurrent: number }
  ): Promise<RateLimitResult> {
    // Use agent's configured limits if available
    const agentLimits = {
      requestsPerMinute: agentIdentity.maxRequestsPerMinute || limits.requestsPerMinute,
      requestsPerHour: agentIdentity.maxRequestsPerHour || limits.requestsPerHour,
      maxConcurrent: agentIdentity.maxConcurrentExecutions || limits.maxConcurrent
    };

    const minuteKey = `ratelimit:agent:${agentId}:minute`;
    const hourKey = `ratelimit:agent:${agentId}:hour`;
    const concurrentKey = `ratelimit:agent:${agentId}:concurrent`;

    // Check concurrent executions
    const concurrent = await this.getCount(concurrentKey);
    if (concurrent >= agentLimits.maxConcurrent) {
      return {
        allowed: false,
        level: 'agent',
        limit: agentLimits.maxConcurrent,
        current: concurrent,
        remaining: 0,
        resetAt: new Date(Date.now() + 60000),
        retryAfter: 60,
        reason: 'Agent concurrent execution limit exceeded'
      };
    }

    // Check minute limit
    const minuteCount = await this.getCount(minuteKey);
    if (minuteCount >= agentLimits.requestsPerMinute) {
      const ttl = await this.getTTL(minuteKey) || 60;
      return {
        allowed: false,
        level: 'agent',
        limit: agentLimits.requestsPerMinute,
        current: minuteCount,
        remaining: 0,
        resetAt: new Date(Date.now() + ttl * 1000),
        retryAfter: ttl,
        reason: 'Agent per-minute rate limit exceeded'
      };
    }

    // Check hourly limit
    const hourCount = await this.getCount(hourKey);
    if (hourCount >= agentLimits.requestsPerHour) {
      const ttl = await this.getTTL(hourKey) || 3600;
      return {
        allowed: false,
        level: 'agent',
        limit: agentLimits.requestsPerHour,
        current: hourCount,
        remaining: 0,
        resetAt: new Date(Date.now() + ttl * 1000),
        retryAfter: ttl,
        reason: 'Agent hourly rate limit exceeded'
      };
    }

    return {
      allowed: true,
      level: 'agent',
      limit: agentLimits.requestsPerMinute,
      current: minuteCount,
      remaining: agentLimits.requestsPerMinute - minuteCount,
      resetAt: new Date(Date.now() + 60000)
    };
  }

  /**
   * Check request burst protection
   */
  private async checkRequestBurst(
    agentId: string,
    limits: { burstLimit: number; burstWindowMs: number }
  ): Promise<RateLimitResult> {
    const burstKey = `ratelimit:burst:${agentId}`;
    const burstCount = await this.getCount(burstKey);

    if (burstCount >= limits.burstLimit) {
      const ttl = Math.ceil(limits.burstWindowMs / 1000);
      return {
        allowed: false,
        level: 'request',
        limit: limits.burstLimit,
        current: burstCount,
        remaining: 0,
        resetAt: new Date(Date.now() + limits.burstWindowMs),
        retryAfter: ttl,
        reason: 'Burst limit exceeded'
      };
    }

    return {
      allowed: true,
      level: 'request',
      limit: limits.burstLimit,
      current: burstCount,
      remaining: limits.burstLimit - burstCount,
      resetAt: new Date(Date.now() + limits.burstWindowMs)
    };
  }

  /**
   * Increment all rate limit counters
   */
  private async incrementCounters(agentIdentity: IAgentIdentity): Promise<void> {
    const agentId = agentIdentity.agentId;
    const userId = agentIdentity.userId.toString();
    const orgId = agentIdentity.organizationId?.toString();

    // Increment with TTLs
    const promises: Promise<any>[] = [];

    // Organization counters
    if (orgId) {
      promises.push(this.increment(`ratelimit:org:${orgId}:hour`, 3600));
      promises.push(this.increment(`ratelimit:org:${orgId}:day`, 86400));
    }

    // User counters
    promises.push(this.increment(`ratelimit:user:${userId}:minute`, 60));
    promises.push(this.increment(`ratelimit:user:${userId}:hour`, 3600));
    promises.push(this.increment(`ratelimit:user:${userId}:day`, 86400));

    // Agent counters
    promises.push(this.increment(`ratelimit:agent:${agentId}:minute`, 60));
    promises.push(this.increment(`ratelimit:agent:${agentId}:hour`, 3600));
    promises.push(this.increment(`ratelimit:agent:${agentId}:concurrent`, 300)); // 5 min TTL for concurrent

    // Burst counter
    promises.push(this.increment(`ratelimit:burst:${agentId}`, 1));

    await Promise.all(promises);
  }

  /**
   * Decrement concurrent execution counter
   */
  public async decrementConcurrent(agentId: string): Promise<void> {
    const key = `ratelimit:agent:${agentId}:concurrent`;
    await this.decrement(key);
  }

  /**
   * Get current rate limit status for agent
   */
  public async getRateLimitStatus(agentId: string): Promise<{
    minute: { current: number; limit: number };
    hour: { current: number; limit: number };
    concurrent: { current: number; limit: number };
  }> {
    const minuteKey = `ratelimit:agent:${agentId}:minute`;
    const hourKey = `ratelimit:agent:${agentId}:hour`;
    const concurrentKey = `ratelimit:agent:${agentId}:concurrent`;

    const [minute, hour, concurrent] = await Promise.all([
      this.getCount(minuteKey),
      this.getCount(hourKey),
      this.getCount(concurrentKey)
    ]);

    return {
      minute: { current: minute, limit: this.DEFAULT_LIMITS.agent!.requestsPerMinute },
      hour: { current: hour, limit: this.DEFAULT_LIMITS.agent!.requestsPerHour },
      concurrent: { current: concurrent, limit: this.DEFAULT_LIMITS.agent!.maxConcurrent }
    };
  }

  /**
   * Reset rate limits for agent (emergency use)
   */
  public async resetRateLimits(agentId: string): Promise<void> {
    const keys = [
      `ratelimit:agent:${agentId}:minute`,
      `ratelimit:agent:${agentId}:hour`,
      `ratelimit:agent:${agentId}:concurrent`,
      `ratelimit:burst:${agentId}`
    ];

    await Promise.all(keys.map(key => this.deleteKey(key)));

    loggingService.warn('Rate limits reset for agent', {
      component: 'AgentRateLimitService',
      operation: 'resetRateLimits',
      agentId
    });
  }

  /**
   * Merge custom limits with defaults
   */
  private mergeLimits(customLimits?: Partial<RateLimitConfig>): RateLimitConfig {
    return {
      organization: { ...this.DEFAULT_LIMITS.organization!, ...customLimits?.organization },
      user: { ...this.DEFAULT_LIMITS.user!, ...customLimits?.user },
      agent: { ...this.DEFAULT_LIMITS.agent!, ...customLimits?.agent },
      request: { ...this.DEFAULT_LIMITS.request!, ...customLimits?.request }
    };
  }

  /**
   * Cache operations using existing cacheService
   */
  private async getCount(key: string): Promise<number> {
    try {
      const value = await cacheService.get(key);
      return value ? parseInt(value as string, 10) : 0;
    } catch (error) {
      return 0;
    }
  }

  private async increment(key: string, ttl: number): Promise<void> {
    try {
      const current = await this.getCount(key);
      await cacheService.set(key, (current + 1).toString(), ttl);
    } catch (error) {
      loggingService.error('Failed to increment counter', {
        component: 'AgentRateLimitService',
        key,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async decrement(key: string): Promise<void> {
    try {
      const current = await this.getCount(key);
      if (current > 0) {
        await cacheService.set(key, (current - 1).toString(), 300);
      }
    } catch (error) {
      loggingService.error('Failed to decrement counter', {
        component: 'AgentRateLimitService',
        key,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async getTTL(key: string): Promise<number | null> {
    // Note: cacheService doesn't expose TTL - estimate based on key type
    if (key.includes(':minute')) return 60;
    if (key.includes(':hour')) return 3600;
    if (key.includes(':day')) return 86400;
    if (key.includes(':burst')) return 1;
    return null;
  }

  private async deleteKey(key: string): Promise<void> {
    try {
      await cacheService.delete(key);
    } catch (error) {
      loggingService.error('Failed to delete key', {
        component: 'AgentRateLimitService',
        key,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

// Export singleton instance
export const agentRateLimitService = AgentRateLimitService.getInstance();

