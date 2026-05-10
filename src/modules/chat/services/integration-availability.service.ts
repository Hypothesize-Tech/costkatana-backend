/**
 * Caches per-user "which integrations are connected" lookups.
 *
 * Today `ai.router.ts:142-155` runs three parallel Mongoose queries to
 * decide whether GitHub / Vercel / Google routing options should be
 * offered. With ~100 messages/min that's 300 cold queries on a
 * non-cached-at-driver level. This service consolidates them into one
 * batched aggregation + 5-minute in-memory TTL cache, and is shared with
 * the new `IntegrationStage`.
 *
 * Cache invalidation:
 *  - Time-based 5 min TTL (the user rarely connects/disconnects mid-burst).
 *  - Explicit `invalidate(userId)` for OAuth callback handlers to call when
 *    a connection is created or deleted.
 *
 * The cache is per-process — fine for a small fleet. For multi-replica
 * scaling, swap the `Map` for the existing `RedisService` with the same
 * key shape: `integration_availability:${userId}`.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { GitHubConnection } from '../../../schemas/integration/github-connection.schema';
import { VercelConnection } from '../../../schemas/integration/vercel-connection.schema';
import { GoogleConnection } from '../../../schemas/integration/google-connection.schema';

export interface IntegrationAvailability {
  github: boolean;
  vercel: boolean;
  google: boolean;
  /** Epoch ms when the row was computed; for debugging stale-cache issues. */
  computedAt: number;
}

const TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  value: IntegrationAvailability;
  expiresAt: number;
}

@Injectable()
export class IntegrationAvailabilityService {
  private readonly logger = new Logger(IntegrationAvailabilityService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @InjectModel(GitHubConnection.name)
    private readonly githubModel: Model<GitHubConnection>,
    @InjectModel(VercelConnection.name)
    private readonly vercelModel: Model<VercelConnection>,
    @InjectModel(GoogleConnection.name)
    private readonly googleModel: Model<GoogleConnection>,
  ) {}

  async getForUser(userId: string): Promise<IntegrationAvailability> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const userObjectId = Types.ObjectId.isValid(userId)
      ? new Types.ObjectId(userId)
      : null;
    if (!userObjectId) {
      // Defensive: malformed userId — return all-false rather than throw.
      return { github: false, vercel: false, google: false, computedAt: Date.now() };
    }

    const [github, vercel, google] = await Promise.all([
      this.githubModel.exists({ userId: userObjectId, isActive: true }),
      this.vercelModel.exists({ userId: userObjectId, isActive: true }),
      this.googleModel.exists({ userId: userObjectId, isActive: true }),
    ]);

    const value: IntegrationAvailability = {
      github: !!github,
      vercel: !!vercel,
      google: !!google,
      computedAt: Date.now(),
    };

    this.cache.set(userId, { value, expiresAt: Date.now() + TTL_MS });
    return value;
  }

  /**
   * Invalidate the cached row for `userId`. Call from OAuth connect/disconnect
   * handlers so the next chat request re-reads.
   */
  invalidate(userId: string): void {
    this.cache.delete(userId);
  }

  /** Test / ops helper. */
  clearAll(): void {
    this.cache.clear();
  }
}
