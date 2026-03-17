/**
 * Redis Configuration Module
 *
 * Provides centralized Redis URL resolution and connection options
 */

import { loggingService } from '../common/services/logging.service';

/**
 * Single source of truth for whether Redis should be used.
 * Returns false when REDIS_ENABLED=false or when in NODE_ENV=development
 * with no Redis configuration (REDIS_HOST/REDIS_URL/FORCE_REDIS) set.
 */
export function isRedisEnabled(): boolean {
  // Explicit disable takes precedence
  if (process.env.REDIS_ENABLED === 'false') {
    return false;
  }

  // Explicit enable
  if (
    process.env.REDIS_ENABLED === 'true' ||
    process.env.FORCE_REDIS === 'true'
  ) {
    return true;
  }

  // In development without explicit Redis config, disable
  if (process.env.NODE_ENV === 'development') {
    const hasRedisConfig =
      !!process.env.REDIS_HOST ||
      !!process.env.REDIS_URL ||
      !!process.env.ELASTICACHE_URL;
    if (!hasRedisConfig) {
      return false;
    }
  }

  return true;
}

/**
 * Resolves the Redis URL based on environment configuration
 * This provides a single source of truth for all Redis clients
 */
export function resolveRedisUrl(): string {
  // Check if we're running in AWS environment
  const inAws =
    !!process.env.ECS_CONTAINER_METADATA_URI_V4 ||
    !!process.env.AWS_EXECUTION_ENV ||
    !!process.env.AWS_REGION;

  // Highest priority: explicit REDIS_URL
  if (process.env.REDIS_URL) {
    loggingService.info('🔧 Redis: Using explicit REDIS_URL configuration', {
      component: 'RedisConfig',
      operation: 'resolveRedisUrl',
      type: 'redis',
      configuration: 'explicit_url',
    });
    return process.env.REDIS_URL;
  }

  // If running in AWS, prefer ElastiCache URL (must be reachable inside VPC)
  if (inAws && process.env.ELASTICACHE_URL) {
    loggingService.info(
      '🔧 Redis: AWS environment detected, using ELASTICACHE_URL',
      {
        component: 'RedisConfig',
        operation: 'resolveRedisUrl',
        type: 'redis',
        configuration: 'elasticache_url',
        environment: 'aws',
      },
    );
    return process.env.ELASTICACHE_URL;
  }

  // If REDIS_HOST is provided (AWS ElastiCache)
  if (process.env.REDIS_HOST) {
    const redisHost = process.env.REDIS_HOST;
    const redisPort = process.env.REDIS_PORT || '6379';
    const url = `redis://${redisHost}:${redisPort}`;
    loggingService.info(
      `🔧 Redis: Using host configuration: ${redisHost}:${redisPort}`,
      {
        component: 'RedisConfig',
        operation: 'resolveRedisUrl',
        type: 'redis',
        configuration: 'host_port',
        host: redisHost,
        port: redisPort,
      },
    );
    return url;
  }

  // Local dev default
  loggingService.info('🔧 Redis: Using local development configuration', {
    component: 'RedisConfig',
    operation: 'resolveRedisUrl',
    type: 'redis',
    configuration: 'local_default',
  });
  return process.env.REDIS_LOCAL_URL || 'redis://127.0.0.1:6379';
}

/**
 * Get Redis connection options with appropriate security settings
 */
export function getRedisOptions(isBullMQ: boolean = false): any {
  const useTLS =
    process.env.REDIS_TLS === '1' || process.env.REDIS_TLS === 'true';
  const username = process.env.REDIS_USERNAME;
  const password = process.env.REDIS_PASSWORD;

  // Log connection details (masking sensitive parts)
  const redisUrl = resolveRedisUrl();
  const maskedUrl = redisUrl.replace(/\/\/([^@]*@)?/, '//');
  loggingService.info(
    `🔧 Redis: Connecting to ${maskedUrl} ${useTLS ? 'with TLS' : 'without TLS'}${password ? ' using AUTH' : ''}`,
    {
      component: 'RedisConfig',
      operation: 'getRedisOptions',
      type: 'redis',
      maskedUrl,
      useTLS,
      hasPassword: !!password,
      hasUsername: !!username,
    },
  );

  // Common options for all Redis clients
  const commonOptions = {
    // Connection settings
    connectTimeout: 10000, // 10 seconds for AWS

    // Retry strategy for AWS ElastiCache
    retryStrategy: (times: number) => {
      if (times > 5) return null; // Stop after 5 attempts
      return Math.min(times * 1000, 10000); // Longer delays, up to 10 seconds
    },

    // Error handling
    reconnectOnError: (err: Error) => {
      // Only reconnect on specific errors
      const targetErrors = ['READONLY', 'ETIMEDOUT', 'ECONNRESET'];
      for (const targetError of targetErrors) {
        if (err.message.includes(targetError)) return true;
      }
      return false;
    },

    // Queue behavior
    enableOfflineQueue: true,

    // Authentication
    username,
    password,

    // TLS settings if enabled
    ...(useTLS ? { tls: {} } : {}),
  };

  // BullMQ specific options
  if (isBullMQ) {
    return {
      ...commonOptions,
      maxRetriesPerRequest: null, // BullMQ requirement
      enableReadyCheck: false, // BullMQ requirement
    };
  }

  return commonOptions;
}

/**
 * Parse Redis URL into BullMQ connection options.
 * Use this instead of IORedis instance to avoid ioredis version conflicts with BullMQ.
 */
export function getBullMQConnectionOptions(): Record<string, unknown> {
  const redisUrl = resolveRedisUrl();
  const useTLS =
    process.env.REDIS_TLS === '1' ||
    process.env.REDIS_TLS === 'true' ||
    redisUrl.startsWith('rediss://');

  let host = '127.0.0.1';
  let port = 6379;
  let password: string | undefined = process.env.REDIS_PASSWORD;
  let username: string | undefined = process.env.REDIS_USERNAME;

  try {
    const match = redisUrl.match(
      /^(?:rediss?):\/\/(?:([^:@]*):?([^@]*)@)?([^:]+):?(\d+)?/,
    );
    if (match) {
      username = username || match[1] || undefined;
      password = password || match[2] || undefined;
      host = match[3];
      port = match[4] ? parseInt(match[4], 10) : 6379;
    }
  } catch {
    // Fallback to env or defaults
    if (process.env.REDIS_HOST) host = process.env.REDIS_HOST;
    if (process.env.REDIS_PORT) port = parseInt(process.env.REDIS_PORT, 10);
  }

  return {
    host,
    port,
    username,
    password,
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
    retryStrategy: (times: number) => {
      if (times > 5) return null;
      return Math.min(times * 1000, 10000);
    },
    connectTimeout: 10000,
    ...(useTLS ? { tls: {} } : {}),
  };
}

/**
 * Determine if Redis connection error is due to specific causes and provide helpful messages
 */
export function getRedisErrorDiagnostic(error: any): string {
  const errorMessage = error?.message || String(error);

  // Network connectivity issues
  if (
    errorMessage.includes('ETIMEDOUT') ||
    errorMessage.includes('ECONNREFUSED')
  ) {
    return 'Network unreachable to Redis (likely VPC/private network issue). For local development, ensure Redis is running locally or use in-memory fallback.';
  }

  // Authentication issues
  if (errorMessage.includes('NOAUTH') || errorMessage.includes('AUTH')) {
    return 'Redis authentication required — set REDIS_PASSWORD and REDIS_USERNAME (if using ACL).';
  }

  // TLS issues
  if (errorMessage.includes('SSL') || errorMessage.includes('TLS')) {
    return 'TLS connection issue — set REDIS_TLS=1 or use rediss:// protocol in your URL.';
  }

  // Default message
  return `Redis connection error: ${errorMessage}`;
}
