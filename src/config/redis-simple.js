/**
 * Simple Redis Configuration Module
 * 
 * This module provides Redis configuration without any dependencies.
 */

// Resolve Redis URL based on environment
function resolveRedisUrl() {
  // Check if we're running in AWS environment
  const inAws =
    !!process.env.ECS_CONTAINER_METADATA_URI_V4 ||
    !!process.env.AWS_EXECUTION_ENV ||
    !!process.env.AWS_REGION;

  // Highest priority: explicit REDIS_URL
  if (process.env.REDIS_URL) {
    console.log(`🔧 Redis: Using explicit REDIS_URL configuration`);
    return process.env.REDIS_URL;
  }

  // If running in AWS, prefer ElastiCache URL (must be reachable inside VPC)
  if (inAws && process.env.ELASTICACHE_URL) {
    console.log(`🔧 Redis: AWS environment detected, using ELASTICACHE_URL`);
    return process.env.ELASTICACHE_URL;
  }

  // If REDIS_HOST is provided (AWS ElastiCache)
  if (process.env.REDIS_HOST) {
    const redisHost = process.env.REDIS_HOST;
    const redisPort = process.env.REDIS_PORT || '6379';
    const url = `redis://${redisHost}:${redisPort}`;
    console.log(`🔧 Redis: Using host configuration: ${redisHost}:${redisPort}`);
    return url;
  }

  // Local dev default
  console.log(`🔧 Redis: Using local development configuration`);
  return process.env.REDIS_LOCAL_URL || 'redis://127.0.0.1:6379';
}

// Get Redis connection options
function getRedisOptions(isBullMQ = false) {
  const useTLS = process.env.REDIS_TLS === '1' || process.env.REDIS_TLS === 'true';
  const username = process.env.REDIS_USERNAME;
  const password = process.env.REDIS_PASSWORD;

  // Log connection details (masking sensitive parts)
  const redisUrl = resolveRedisUrl();
  const maskedUrl = redisUrl.replace(/\/\/([^@]*@)?/, '//');
  console.log(`🔧 Redis: Connecting to ${maskedUrl} ${useTLS ? 'with TLS' : 'without TLS'}${password ? ' using AUTH' : ''}`);

  // Common options for all Redis clients
  const commonOptions = {
    // Connection settings
    connectTimeout: 10000, // 10 seconds for AWS
    
    // Retry strategy for AWS ElastiCache
    retryStrategy: (times) => {
      if (times > 5) return null; // Stop after 5 attempts
      return Math.min(times * 1000, 10000); // Longer delays, up to 10 seconds
    },
    
    // Error handling
    reconnectOnError: (err) => {
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
    ...(useTLS ? { tls: {} } : {})
  };

  // BullMQ specific options
  if (isBullMQ) {
    return {
      ...commonOptions,
      maxRetriesPerRequest: null, // BullMQ requirement
      enableReadyCheck: false,    // BullMQ requirement
    };
  }

  return commonOptions;
}

// Get diagnostic message for Redis errors
function getRedisErrorDiagnostic(error) {
  const errorMessage = error?.message || String(error);
  
  // Network connectivity issues
  if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('ECONNREFUSED')) {
    return "Network unreachable to Redis (likely VPC/private network issue). For local development, ensure Redis is running locally or use in-memory fallback.";
  }
  
  // Authentication issues
  if (errorMessage.includes('NOAUTH') || errorMessage.includes('AUTH')) {
    return "Redis authentication required — set REDIS_PASSWORD and REDIS_USERNAME (if using ACL).";
  }
  
  // TLS issues
  if (errorMessage.includes('SSL') || errorMessage.includes('TLS')) {
    return "TLS connection issue — set REDIS_TLS=1 or use rediss:// protocol in your URL.";
  }
  
  // Default message
  return `Redis connection error: ${errorMessage}`;
}

// Export functions
module.exports = {
  resolveRedisUrl,
  getRedisOptions,
  getRedisErrorDiagnostic
};
