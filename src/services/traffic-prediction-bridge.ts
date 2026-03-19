/**
 * Legacy bridge for TrafficPredictionService and CacheService.
 * Used by legacy enterpriseTrafficManagement.middleware when it needs to record traffic.
 * Wired via setTrafficPredictionBridge() during app bootstrap.
 */

import { randomUUID } from 'crypto';
import type { TrafficPredictionService } from '../modules/analytics/services/traffic-prediction.service';
import type { CacheService } from '../common/cache/cache.service';

const TRAFFIC_WINDOW_MS = 1000;
const TRAFFIC_RPS_KEY = 'traffic:rps:window';
const TRAFFIC_USERS_KEY = 'traffic:users:window';

let trafficPredictionService: TrafficPredictionService | null = null;
let cacheService: CacheService | null = null;

export function setTrafficPredictionBridge(
  tps: TrafficPredictionService | null,
  cs: CacheService | null,
): void {
  trafficPredictionService = tps;
  cacheService = cs;
}

export async function recordTrafficDataLegacy(
  req: {
    path: string;
    user?: { tier?: string; id?: string };
    headers?: Record<string, string | string[] | undefined>;
    ip?: string;
  },
  systemStatus: {
    performance_metrics: {
      average_response_time: number;
      error_rate: number;
      cpu_usage: number;
      memory_usage: number;
    };
  },
): Promise<void> {
  if (!trafficPredictionService) return;
  try {
    if (cacheService) {
      const now = Date.now();
      const userKey = req.user?.id
        ? `u:${req.user.id}`
        : `ip:${req.ip || (req.headers?.['x-forwarded-for'] as string) || 'unknown'}`;
      await cacheService.zadd(TRAFFIC_RPS_KEY, now, `${now}:${randomUUID()}`);
      await cacheService.zadd(TRAFFIC_USERS_KEY, now, userKey);
      await cacheService.zremrangebyscore(
        TRAFFIC_RPS_KEY,
        0,
        now - TRAFFIC_WINDOW_MS,
      );
      await cacheService.zremrangebyscore(
        TRAFFIC_USERS_KEY,
        0,
        now - TRAFFIC_WINDOW_MS,
      );
    }
    let requestsPerSecond = 1;
    let uniqueUsers = 1;
    if (cacheService) {
      const now = Date.now();
      await cacheService.zremrangebyscore(
        TRAFFIC_RPS_KEY,
        0,
        now - TRAFFIC_WINDOW_MS,
      );
      await cacheService.zremrangebyscore(
        TRAFFIC_USERS_KEY,
        0,
        now - TRAFFIC_WINDOW_MS,
      );
      const rps = await cacheService.zcard(TRAFFIC_RPS_KEY);
      const uu = await cacheService.zcard(TRAFFIC_USERS_KEY);
      requestsPerSecond = rps || 1;
      uniqueUsers = Math.max(1, uu);
    }
    await trafficPredictionService.recordTrafficData({
      requestsPerSecond,
      uniqueUsers,
      responseTime: systemStatus.performance_metrics.average_response_time,
      errorRate: systemStatus.performance_metrics.error_rate,
      cpuUsage: systemStatus.performance_metrics.cpu_usage,
      memoryUsage: systemStatus.performance_metrics.memory_usage,
      endpointDistribution: { [req.path]: 1 },
      userTierDistribution: { [req.user?.tier || 'free']: 1 },
      geographicDistribution: {
        [(req.headers?.['x-forwarded-for'] as string) || 'unknown']: 1,
      },
    });
  } catch {
    // Non-critical
  }
}
