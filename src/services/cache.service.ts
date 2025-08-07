import { estimateTokens } from '../utils/tokenCounter';
import { calculateCost } from '../utils/pricing';

interface CacheCheckRequest {
  prompt: string;
  model: string;
  provider: string;
  includeFallbacks?: boolean;
  includeCacheDetails?: boolean;
}

interface CacheResult {
  cacheStatus: 'HIT' | 'MISS';
  cacheDetails?: {
    key: string;
    age: string;
    size: string;
    ttl: number;
  };
  suggestions: Array<{
    type: string;
    action: string;
    reason: string;
    confidence: number;
  }>;
  fallbackRoutes: Array<{
    provider: string;
    model: string;
    priority: number;
    status: 'available' | 'unavailable';
    estimatedCost: number;
    reason?: string;
  }>;
  performance: {
    responseTime: number;
    hitRate: number;
    costSavings: number;
    bandwidthSaved: number;
  };
}

export class CacheService {
  // In-memory cache simulation (in production, this would be Redis or similar)
  private static cache = new Map<string, { data: any; timestamp: number; ttl: number }>();
  
  // Cache statistics
  private static stats = {
    hits: 0,
    misses: 0,
    totalRequests: 0,
    totalSavings: 0,
  };

  static async checkCache(request: CacheCheckRequest): Promise<CacheResult> {
    const startTime = Date.now();
    const cacheKey = this.generateCacheKey(request.prompt, request.model, request.provider);
    
    // Check if cache entry exists
    const cachedEntry = this.cache.get(cacheKey);
    const isHit = cachedEntry && (Date.now() - cachedEntry.timestamp) < cachedEntry.ttl;
    
    // Update statistics
    this.stats.totalRequests++;
    if (isHit) {
      this.stats.hits++;
    } else {
      this.stats.misses++;
    }

    // Generate cache details if requested
    const cacheDetails = request.includeCacheDetails ? this.getCacheDetails(cacheKey, cachedEntry) : undefined;

    // Generate suggestions based on cache status
    const suggestions = this.generateSuggestions(isHit || false, request);

    // Generate fallback routes
    const fallbackRoutes = this.generateFallbackRoutes(request);

    // Calculate performance metrics
    const performance = this.calculatePerformanceMetrics(startTime);

    return {
      cacheStatus: isHit ? 'HIT' : 'MISS',
      cacheDetails,
      suggestions,
      fallbackRoutes,
      performance,
    };
  }

  private static generateCacheKey(prompt: string, model: string, provider: string): string {
    // Create a hash of the prompt, model, and provider
    const content = `${prompt}:${model}:${provider}`;
    return Buffer.from(content).toString('base64').substring(0, 32);
  }

  private static getCacheDetails(key: string, entry: any): any {
    if (!entry) {
      return {
        key,
        age: 'N/A',
        size: '0B',
        ttl: 0,
      };
    }

    const age = Date.now() - entry.timestamp;
    const ageFormatted = this.formatAge(age);
    const size = this.estimateSize(entry.data);

    return {
      key,
      age: ageFormatted,
      size,
      ttl: entry.ttl,
    };
  }

  private static generateSuggestions(isHit: boolean, request: CacheCheckRequest): Array<{
    type: string;
    action: string;
    reason: string;
    confidence: number;
  }> {
    const suggestions = [];

    if (isHit) {
      suggestions.push({
        type: 'reuse',
        action: 'Use cached response',
        reason: 'Cache hit detected - reuse existing response for cost savings',
        confidence: 95,
      });
    } else {
      suggestions.push({
        type: 'retry',
        action: 'Make fresh API call',
        reason: 'Cache miss - no cached response available',
        confidence: 90,
      });

      // Suggest caching for future requests
      suggestions.push({
        type: 'cache',
        action: 'Enable caching for this prompt',
        reason: 'Frequent similar requests detected',
        confidence: 75,
      });
    }

    // Suggest model optimization if cost is high
    const estimatedTokens = estimateTokens(request.prompt, request.provider as any);
    const estimatedCost = calculateCost(estimatedTokens, 150, request.provider, request.model);
    
    if (estimatedCost > 0.01) {
      suggestions.push({
        type: 'optimization',
        action: 'Consider prompt optimization',
        reason: 'High token count detected - optimization could reduce costs',
        confidence: 80,
      });
    }

    return suggestions;
  }

  private static generateFallbackRoutes(request: CacheCheckRequest): Array<{
    provider: string;
    model: string;
    priority: number;
    status: 'available' | 'unavailable';
    estimatedCost: number;
    reason?: string;
  }> {
    const routes = [];

    // Primary route (original request)
    const primaryTokens = estimateTokens(request.prompt, request.provider as any);
    const primaryCost = calculateCost(primaryTokens, 150, request.provider, request.model);
    
    routes.push({
      provider: request.provider,
      model: request.model,
      priority: 1,
      status: 'available' as const,
      estimatedCost: primaryCost,
      reason: 'Primary route',
    });

    // Fallback routes based on provider
    const fallbacks = this.getFallbackRoutes(request.provider);
    routes.push(...fallbacks);

    return routes;
  }

  private static getFallbackRoutes(provider: string): Array<{
    provider: string;
    model: string;
    priority: number;
    status: 'available' | 'unavailable';
    estimatedCost: number;
    reason?: string;
  }> {
    const fallbacks = [];

    // Define fallback routes based on provider
    const fallbackConfigs = {
      'openai': [
        { provider: 'anthropic', model: 'claude-3-haiku-20240307', priority: 2 },
        { provider: 'google', model: 'gemini-1.5-flash', priority: 3 },
        { provider: 'cohere', model: 'command-light', priority: 4 },
      ],
      'anthropic': [
        { provider: 'openai', model: 'gpt-4o-mini', priority: 2 },
        { provider: 'google', model: 'gemini-1.5-flash', priority: 3 },
        { provider: 'cohere', model: 'command-light', priority: 4 },
      ],
      'google': [
        { provider: 'openai', model: 'gpt-4o-mini', priority: 2 },
        { provider: 'anthropic', model: 'claude-3-haiku-20240307', priority: 3 },
        { provider: 'cohere', model: 'command-light', priority: 4 },
      ],
    };

    const configs = fallbackConfigs[provider as keyof typeof fallbackConfigs] || [];
    
    for (const config of configs) {
      const estimatedTokens = estimateTokens('sample prompt', config.provider as any);
      const estimatedCost = calculateCost(estimatedTokens, 150, config.provider, config.model);
      
      fallbacks.push({
        provider: config.provider,
        model: config.model,
        priority: config.priority,
        status: 'available' as const,
        estimatedCost,
        reason: `Fallback route ${config.priority}`,
      });
    }

    return fallbacks;
  }

  private static calculatePerformanceMetrics(startTime: number): {
    responseTime: number;
    hitRate: number;
    costSavings: number;
    bandwidthSaved: number;
  } {
    const responseTime = Date.now() - startTime;
    const hitRate = this.stats.totalRequests > 0 ? (this.stats.hits / this.stats.totalRequests) * 100 : 0;
    
    // Estimate cost savings (simplified calculation)
    const costSavings = this.stats.hits * 0.001; // $0.001 per cache hit
    const bandwidthSaved = this.stats.hits * 2; // 2KB per cache hit

    return {
      responseTime,
      hitRate,
      costSavings,
      bandwidthSaved,
    };
  }

  private static formatAge(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
    return `${Math.floor(ms / 3600000)}h`;
  }

  private static estimateSize(data: any): string {
    const size = JSON.stringify(data).length;
    if (size < 1024) return `${size}B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)}KB`;
    return `${Math.round(size / (1024 * 1024))}MB`;
  }

  // Cache management methods
  static setCache(key: string, data: any, ttl: number = 3600000): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });
  }

  static getCache(key: string): any {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data;
  }

  static clearCache(): void {
    this.cache.clear();
    this.stats = {
      hits: 0,
      misses: 0,
      totalRequests: 0,
      totalSavings: 0,
    };
  }

  static getStats(): any {
    return {
      ...this.stats,
      cacheSize: this.cache.size,
      hitRate: this.stats.totalRequests > 0 ? (this.stats.hits / this.stats.totalRequests) * 100 : 0,
    };
  }
}
