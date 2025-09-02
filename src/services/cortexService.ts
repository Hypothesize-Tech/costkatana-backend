/**
 * Cortex Service
 * Main service for integrating Cortex optimization into the AI Cost Optimizer platform
 */

import { CortexRelayEngine } from '../cortex/relay/relayEngine';
import { CortexEncoder } from '../cortex/core/encoder';
import { CortexDecoder } from '../cortex/core/decoder';
import { ModelRouter } from '../cortex/relay/modelRouter';
import { 
  CortexQuery, 
  CortexResponse, 
  CortexConfig,
  ResponseMetrics,
  EncodeOptions,
  DecodeOptions,
  ModelSelection
} from '../cortex/types';
import { loggingService } from './logging.service';
import { cacheService } from './cache.service';

export class CortexService {
  private relay: CortexRelayEngine;
  private encoder: CortexEncoder;
  private decoder: CortexDecoder;
  private modelRouter: ModelRouter;
  private config: CortexConfig;
  private metricsHistory: ResponseMetrics[] = [];
  
  constructor() {
    this.relay = new CortexRelayEngine();
    this.encoder = new CortexEncoder();
    this.decoder = new CortexDecoder();
    this.modelRouter = new ModelRouter();
    
    this.config = this.loadConfiguration();
    this.initializeService();
  }
  
  /**
   * Load Cortex configuration from environment variables
   */
  private loadConfiguration(): CortexConfig {
    return {
      enabled: process.env.CORTEX_ENABLED !== 'false',
      mode: (process.env.CORTEX_MODE as 'mandatory' | 'optional' | 'disabled') || 'optional',
      
      optimization: {
        tokenReduction: process.env.CORTEX_TOKEN_REDUCTION !== 'false',
        semanticCaching: process.env.CORTEX_SEMANTIC_CACHING !== 'false',
        modelRouting: process.env.CORTEX_MODEL_ROUTING !== 'false',
        binarySerialization: process.env.CORTEX_BINARY_SERIALIZATION === 'true',
        neuralCompression: process.env.CORTEX_NEURAL_COMPRESSION === 'true',
        fragmentCaching: process.env.CORTEX_FRAGMENT_CACHING !== 'false',
        predictivePrefetching: process.env.CORTEX_PREDICTIVE_PREFETCHING === 'true'
      },
      
      gateway: {
        headerName: process.env.CORTEX_HEADER_NAME || 'x-cortex-enabled',
        queryParam: process.env.CORTEX_QUERY_PARAM || 'cortex',
        cookieName: process.env.CORTEX_COOKIE_NAME || 'cortex_enabled',
        defaultEnabled: process.env.CORTEX_DEFAULT_ENABLED === 'true',
        allowOverride: process.env.CORTEX_ALLOW_OVERRIDE !== 'false'
      },
      
      cache: {
        provider: (process.env.CORTEX_CACHE_PROVIDER as 'redis' | 'memory' | 'hybrid') || 'hybrid',
        ttl: parseInt(process.env.CORTEX_CACHE_TTL || '3600'),
        maxSize: parseInt(process.env.CORTEX_CACHE_MAX_SIZE || '1000'),
        evictionPolicy: (process.env.CORTEX_CACHE_EVICTION as 'lru' | 'lfu' | 'fifo') || 'lru'
      },
      
      plugins: {
        enabled: process.env.CORTEX_PLUGINS?.split(',') || [],
        config: {},
        autoLoad: process.env.CORTEX_PLUGINS_AUTOLOAD === 'true',
        directory: process.env.CORTEX_PLUGINS_DIR
      },
      
      monitoring: {
        metricsEnabled: process.env.CORTEX_METRICS_ENABLED !== 'false',
        loggingLevel: (process.env.CORTEX_LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
        traceEnabled: process.env.CORTEX_TRACE_ENABLED === 'true',
        sampleRate: parseFloat(process.env.CORTEX_SAMPLE_RATE || '1.0')
      },
      
      limits: {
        maxExpressionDepth: parseInt(process.env.CORTEX_MAX_EXPRESSION_DEPTH || '10'),
        maxRoleCount: parseInt(process.env.CORTEX_MAX_ROLE_COUNT || '50'),
        maxReferenceDepth: parseInt(process.env.CORTEX_MAX_REFERENCE_DEPTH || '5'),
        maxCacheSize: parseInt(process.env.CORTEX_MAX_CACHE_SIZE || '10000')
      }
    };
  }
  
  /**
   * Initialize the Cortex service
   */
  private initializeService(): void {
    if (!this.config.enabled) {
      loggingService.warn('Cortex service is disabled');
      return;
    }
    
    loggingService.info('Initializing Cortex service', {
      mode: this.config.mode,
      optimization: this.config.optimization,
      cache: this.config.cache.provider
    });
    
    // Warmup removed to avoid unnecessary API calls
  }
  

  
  /**
   * Process text through Cortex optimization
   */
  public async process(
    input: string, 
    options: { 
      useCache?: boolean;
      modelOverride?: string;
      coreModel?: string;
      encoderModel?: string;
      decoderModel?: string;
      encodeOptions?: EncodeOptions;
      decodeOptions?: DecodeOptions;
    } = {}
  ): Promise<{ 
    response: string; 
    metrics: ResponseMetrics;
    optimized: boolean;
  }> {
    // Check if Cortex is enabled
    if (!this.config.enabled || this.config.mode === 'disabled') {
      return {
        response: input,
        metrics: this.createDefaultMetrics(),
        optimized: false
      };
    }
    
    try {
      // Check cache first if enabled
      if (options.useCache !== false && this.config.optimization.semanticCaching) {
        const cached = await this.getCachedResponse(input);
        if (cached) {
          loggingService.info('Cortex cache hit', { input: input.substring(0, 50) });
          return {
            response: cached.response,
            metrics: { ...cached.metrics, cacheHit: true },
            optimized: true
          };
        }
      }
      
      // Process through Cortex relay with model options
      const modelOptions = {
        coreModel: options.coreModel || options.modelOverride,
        encoderModel: options.encoderModel,
        decoderModel: options.decoderModel,
        format: options.decodeOptions?.format,
        style: options.decodeOptions?.style
      };
      
      const result = (options.coreModel || options.encoderModel || options.decoderModel || options.modelOverride)
        ? await this.relay.executeWithModel(input, modelOptions)
        : await this.relay.execute(input);
      
      // Cache the result if enabled
      if (this.config.optimization.semanticCaching) {
        await this.cacheResponse(input, result);
      }
      
      // Track metrics if enabled
      if (this.config.monitoring.metricsEnabled) {
        this.trackMetrics(result.metrics);
      }
      
      return {
        ...result,
        optimized: true
      };
    } catch (error) {
      loggingService.error('Cortex processing failed', { error, input: input.substring(0, 50) });
      
      // Fallback to unoptimized response
      return {
        response: input,
        metrics: this.createDefaultMetrics(),
        optimized: false
      };
    }
  }
  
  /**
   * Encode text to Cortex expression
   */
  public async encode(input: string, options?: EncodeOptions): Promise<CortexQuery> {
    return this.encoder.encode(input, options);
  }
  
  /**
   * Decode Cortex expression to text
   */
  public async decode(response: CortexResponse, options?: DecodeOptions): Promise<string> {
    return this.decoder.decode(response, options);
  }
  
  /**
   * Get model recommendations for a query
   */
  public async getModelRecommendations(input: string): Promise<ModelSelection[]> {
    const query = await this.encoder.encode(input);
    const recommendations = this.modelRouter.getRecommendations(query);
    
    return recommendations.map(profile => ({
      modelId: profile.modelId,
      provider: profile.provider,
      capabilities: profile.capabilities,
      estimatedCost: profile.capabilities.costPerToken * 1000 / 1000000,
      estimatedLatency: profile.capabilities.averageLatency,
      confidence: 0.85
    }));
  }
  
  /**
   * Get cached response
   */
  private async getCachedResponse(input: string): Promise<{ 
    response: string; 
    metrics: ResponseMetrics 
  } | null> {
    const cacheKey = `cortex:${this.hashInput(input)}`;
    
    try {
      // Use unified cache service
      const cachedResult = await cacheService.get<string>(cacheKey);
      if (cachedResult) {
        try {
          return JSON.parse(cachedResult);
        } catch {
          return null;
        }
      }
    } catch (error) {
      loggingService.warn('Cache retrieval failed', { error, cacheKey });
    }
    
    return null;
  }
  
  /**
   * Cache response
   */
  private async cacheResponse(
    input: string, 
    result: { response: string; metrics: ResponseMetrics }
  ): Promise<void> {
    const cacheKey = `cortex:${this.hashInput(input)}`;
    const cacheData = JSON.stringify(result);
    
    try {
      // Use unified cache service
      await cacheService.set(cacheKey, cacheData, this.config.cache.ttl);
    } catch (error) {
      loggingService.warn('Cache storage failed', { error, cacheKey });
    }
  }
  
  /**
   * Hash input for cache key
   */
  private hashInput(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }
  
  /**
   * Create default metrics
   */
  private createDefaultMetrics(): ResponseMetrics {
    return {
      originalTokens: 0,
      optimizedTokens: 0,
      tokenReduction: 0,
      processingTime: 0,
      costSavings: 0,
      modelUsed: 'none',
      cacheHit: false
    };
  }
  
  /**
   * Track metrics
   */
  private trackMetrics(metrics: ResponseMetrics): void {
    this.metricsHistory.push(metrics);
    
    // Keep only last 1000 metrics
    if (this.metricsHistory.length > 1000) {
      this.metricsHistory.shift();
    }
    
    // Log aggregate metrics every 100 requests
    if (this.metricsHistory.length % 100 === 0) {
      this.logAggregateMetrics();
    }
  }
  
  /**
   * Log aggregate metrics
   */
  private logAggregateMetrics(): void {
    const total = this.metricsHistory.length;
    const avgTokenReduction = this.metricsHistory.reduce((sum, m) => sum + m.tokenReduction, 0) / total;
    const avgCostSavings = this.metricsHistory.reduce((sum, m) => sum + m.costSavings, 0) / total;
    const avgProcessingTime = this.metricsHistory.reduce((sum, m) => sum + m.processingTime, 0) / total;
    const cacheHitRate = this.metricsHistory.filter(m => m.cacheHit).length / total;
    
    loggingService.info('Cortex aggregate metrics', {
      totalRequests: total,
      avgTokenReduction: `${(avgTokenReduction * 100).toFixed(1)}%`,
      avgCostSavings: `${(avgCostSavings * 100).toFixed(1)}%`,
      avgProcessingTime: `${avgProcessingTime.toFixed(0)}ms`,
      cacheHitRate: `${(cacheHitRate * 100).toFixed(1)}%`
    });
  }
  
  /**
   * Get service metrics
   */
  public getMetrics(): {
    totalRequests: number;
    avgTokenReduction: number;
    avgCostSavings: number;
    avgProcessingTime: number;
    cacheHitRate: number;
    recentMetrics: ResponseMetrics[];
  } {
    const total = this.metricsHistory.length;
    
    if (total === 0) {
      return {
        totalRequests: 0,
        avgTokenReduction: 0,
        avgCostSavings: 0,
        avgProcessingTime: 0,
        cacheHitRate: 0,
        recentMetrics: []
      };
    }
    
    return {
      totalRequests: total,
      avgTokenReduction: this.metricsHistory.reduce((sum, m) => sum + m.tokenReduction, 0) / total,
      avgCostSavings: this.metricsHistory.reduce((sum, m) => sum + m.costSavings, 0) / total,
      avgProcessingTime: this.metricsHistory.reduce((sum, m) => sum + m.processingTime, 0) / total,
      cacheHitRate: this.metricsHistory.filter(m => m.cacheHit).length / total,
      recentMetrics: this.metricsHistory.slice(-10)
    };
  }
  
  /**
   * Clear cache
   */
  public async clearCache(): Promise<void> {
    try {
      // Clear all cache entries with cortex prefix
      // Note: This clears all cache, not just cortex-specific
      // In production, we should implement pattern-based clearing
      await cacheService.clear();
      
      loggingService.info('Cortex cache cleared');
    } catch (error) {
      loggingService.error('Failed to clear Cortex cache', { error });
    }
  }
  
  /**
   * Update configuration
   */
  public updateConfiguration(config: Partial<CortexConfig>): void {
    this.config = { ...this.config, ...config };
    loggingService.info('Cortex configuration updated', { config });
  }
  
  /**
   * Get configuration
   */
  public getConfiguration(): CortexConfig {
    return this.config;
  }
  
  /**
   * Check if Cortex is enabled
   */
  public isEnabled(): boolean {
    return this.config.enabled && this.config.mode !== 'disabled';
  }
  
  /**
   * Stream process text
   */
  public async *streamProcess(input: string): AsyncGenerator<string> {
    if (!this.config.enabled) {
      yield input;
      return;
    }
    
    yield* this.relay.streamExecute(input);
  }
}

// Export singleton instance
export const cortexService = new CortexService();
