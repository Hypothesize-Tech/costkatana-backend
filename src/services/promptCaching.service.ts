/**
 * Prompt Caching Service
 *
 * Core service for implementing true prompt caching (KV-pair caching)
 * at the LLM level. Handles provider detection, configuration management,
 * and metrics tracking for cache operations.
 */

import { BaseService } from '../shared/BaseService';
import { loggingService } from './logging.service';
import { estimateTokens, AIProvider } from '../utils/tokenCounter';
import {
  PromptCachingConfig,
  CacheBreakpoint,
  PromptCacheMetrics,
  CacheAnalysisResult,
  PromptCacheRequest,
  PromptCacheResponse,
  ProviderCacheSupport,
  CachedPrompt
} from '../types/promptCaching.types';

export class PromptCachingService extends BaseService {
  private static instance: PromptCachingService;
  private providerSupport: Map<string, ProviderCacheSupport> = new Map();
  private activeCacheConfigs: Map<string, PromptCachingConfig> = new Map();

  // Cache hit/miss tracking for health monitoring
  private cacheHits: number = 0;
  private cacheMisses: number = 0;
  private lastHitRateReset: number = Date.now();

  private constructor() {
    super('PromptCachingService', {
      max: 1000, // Cache up to 1000 configurations
      ttl: 300000 // 5 minutes TTL
    });

    this.initializeProviderSupport();

    // Reset cache metrics daily to prevent overflow
    setInterval(() => {
      this.resetCacheMetrics();
    }, 24 * 60 * 60 * 1000); // 24 hours

    loggingService.info('🧠 Prompt Caching Service initialized');
  }

  public static getInstance(): PromptCachingService {
    if (!PromptCachingService.instance) {
      PromptCachingService.instance = new PromptCachingService();
    }
    return PromptCachingService.instance;
  }

  /**
   * Initialize provider support matrix
   */
  private initializeProviderSupport(): void {
    // Anthropic Claude support
    this.providerSupport.set('anthropic', {
      provider: 'anthropic',
      supportsCaching: true,
      supportedModels: [
        'claude-sonnet-4-5', 'claude-sonnet-4-5-20250929',
        'claude-haiku-4-5', 'claude-haiku-4-5-20251001',
        'claude-opus-4-5', 'claude-opus-4-5-20251101',
        'claude-opus-4-6', 'claude-opus-4-6-v1',
        'claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022',
        'claude-3-5-haiku-20241022'
      ],
      cacheType: 'explicit',
      minTokens: 1024,
      maxBreakpoints: 4,
      defaultTTL: 300, // 5 minutes
      cachePricing: {
        writePrice: 0.30, // $0.30 per 1M tokens (10% of base)
        readPrice: 0.30   // $0.30 per 1M tokens (90% discount)
      }
    });

    // OpenAI support
    this.providerSupport.set('openai', {
      provider: 'openai',
      supportsCaching: true,
      supportedModels: [
        'gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini',
        'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'
      ],
      cacheType: 'automatic',
      minTokens: 1024,
      maxBreakpoints: 0, // Automatic - no breakpoints needed
      defaultTTL: 600, // 10 minutes
      cachePricing: {
        writePrice: 1.50, // $1.50 per 1M tokens (50% discount)
        readPrice: 1.50  // $1.50 per 1M tokens (50% discount)
      }
    });

    // Google Gemini support
    this.providerSupport.set('google', {
      provider: 'google',
      supportsCaching: true,
      supportedModels: [
        'gemini-2.5-pro', 'gemini-2.5-flash'
      ],
      cacheType: 'explicit',
      minTokens: 32768, // 32K minimum
      maxBreakpoints: 1, // One cached content block
      defaultTTL: 3600, // 1 hour default
      cachePricing: {
        writePrice: 1.00, // $1.00 per 1M tokens per hour (storage)
        readPrice: 1.25, // $1.25 per 1M tokens (read cost)
        storagePrice: 1.00
      }
    });
  }

  /**
   * Get provider cache support information
   */
  public getProviderSupport(provider: string): ProviderCacheSupport | undefined {
    return this.providerSupport.get(provider.toLowerCase());
  }

  /**
   * Check if provider and model support prompt caching
   */
  public isProviderSupported(provider: string, model?: string): boolean {
    const support = this.getProviderSupport(provider);
    if (!support?.supportsCaching) return false;

    if (model) {
      // Normalize model name for comparison
      const normalizedModel = model.toLowerCase().replace(/[-_]/g, '');
      return support.supportedModels.some(supportedModel =>
        normalizedModel.includes(supportedModel.toLowerCase().replace(/[-_]/g, ''))
      );
    }

    return true;
  }

  /**
   * Get default configuration for provider
   */
  public getDefaultConfig(provider: string): PromptCachingConfig {
    const support = this.getProviderSupport(provider);
    if (!support) {
      throw new Error(`Provider ${provider} not supported for prompt caching`);
    }

    return {
      enabled: true,
      provider: provider as any,
      mode: support.cacheType,
      minTokens: support.minTokens,
      ttl: support.defaultTTL,
      structureOptimization: true,
      breakpointsEnabled: support.cacheType === 'explicit'
    };
  }

  /**
   * Set configuration for user/project
   */
  public setConfig(key: string, config: PromptCachingConfig): void {
    this.activeCacheConfigs.set(key, config);
    this.cacheSet(`config:${key}`, config);
    this.logOperation('info', 'Prompt caching configuration updated', 'setConfig', {
      key,
      provider: config.provider,
      enabled: config.enabled
    });
  }

  /**
   * Get configuration for user/project
   */
  public getConfig(key: string): PromptCachingConfig | undefined {
    // Try cache first
    let config = this.cacheGet<PromptCachingConfig>(`config:${key}`);
    if (!config) {
      config = this.activeCacheConfigs.get(key);
    }
    return config;
  }

  /**
   * Analyze prompt for cache potential
   */
  public analyzePrompt(
    messages: any[],
    model: string,
    provider: string,
    config?: PromptCachingConfig
  ): CacheAnalysisResult {
    try {
      const effectiveConfig = config || this.getDefaultConfig(provider);

      if (!effectiveConfig.enabled) {
        return {
          isCacheable: false,
          reason: 'Caching disabled in configuration',
          estimatedSavings: 0,
          tokenCount: 0,
          breakpoints: [],
          recommendedStructure: false
        };
      }

      // Check provider support
      if (!this.isProviderSupported(provider, model)) {
        return {
          isCacheable: false,
          reason: `Provider ${provider} or model ${model} does not support prompt caching`,
          estimatedSavings: 0,
          tokenCount: 0,
          breakpoints: [],
          recommendedStructure: false
        };
      }

      // Estimate total tokens
      const tokenCount = this.estimatePromptTokens(messages, provider);
      const support = this.getProviderSupport(provider)!;

      // Check minimum token threshold
      if (tokenCount < effectiveConfig.minTokens) {
        return {
          isCacheable: false,
          reason: `Prompt too small (${tokenCount} tokens < ${effectiveConfig.minTokens} minimum)`,
          estimatedSavings: 0,
          tokenCount,
          breakpoints: [],
          recommendedStructure: false
        };
      }

      // Analyze structure for caching potential
      const structureAnalysis = this.analyzePromptStructure(messages, support);

      // Calculate estimated savings
      const estimatedSavings = this.calculateEstimatedSavings(tokenCount, support);

      const result: CacheAnalysisResult = {
        isCacheable: structureAnalysis.hasStaticContent,
        reason: structureAnalysis.hasStaticContent
          ? 'Prompt has cacheable static content'
          : 'No static content found for caching',
        estimatedSavings,
        tokenCount,
        breakpoints: structureAnalysis.breakpoints,
        recommendedStructure: structureAnalysis.needsRestructuring
      };

      this.logOperation('debug', 'Prompt analysis completed', 'analyzePrompt', {
        provider,
        model,
        tokenCount,
        isCacheable: result.isCacheable,
        estimatedSavings: result.estimatedSavings.toFixed(6)
      });

      return result;

    } catch (error) {
      this.logOperation('error', 'Error analyzing prompt for caching', 'analyzePrompt', {
        error: error instanceof Error ? error.message : String(error),
        provider,
        model
      });

      return {
        isCacheable: false,
        reason: 'Analysis failed',
        estimatedSavings: 0,
        tokenCount: 0,
        breakpoints: [],
        recommendedStructure: false
      };
    }
  }

  /**
   * Process prompt for caching (main entry point)
   */
  public async processPrompt(request: PromptCacheRequest): Promise<PromptCacheResponse> {
    const startTime = Date.now();

    try {
      const analysis = this.analyzePrompt(
        request.messages,
        request.model,
        request.provider,
        request.config
      );

      if (!analysis.isCacheable) {
        // Record cache miss when caching is not possible
        this.recordCacheMiss();

        return {
          modifiedMessages: request.messages,
          cacheHeaders: {
            'x-cache-enabled': 'false',
            'x-cache-reason': analysis.reason || 'Not cacheable'
          },
          metrics: {
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            regularTokens: analysis.tokenCount,
            totalSavings: 0,
            hitRate: this.getCacheHitRate(),
            cacheHits: this.cacheHits,
            cacheMisses: this.cacheMisses,
            averageSavingsPerRequest: 0
          },
          cacheUsed: false,
          cacheType: 'none'
        };
      }

      // Apply caching transformations based on provider
      const support = this.getProviderSupport(request.provider)!;
      let modifiedMessages = request.messages;
      let cacheType: 'automatic' | 'explicit' = 'automatic';

      if (support.cacheType === 'explicit' && request.config.breakpointsEnabled) {
        modifiedMessages = this.applyExplicitCaching(request.messages, analysis.breakpoints);
        cacheType = 'explicit';
      }

      // Generate cache headers
      const cacheHeaders = {
        'x-cache-enabled': 'true',
        'x-cache-type': cacheType,
        'x-cache-token-count': analysis.tokenCount.toString(),
        'x-cache-breakpoints': analysis.breakpoints.length.toString(),
        'x-cache-estimated-savings': analysis.estimatedSavings.toFixed(6),
        'x-cache-min-tokens': request.config.minTokens.toString()
      };

      const processingTime = Date.now() - startTime;

      // Record cache hit when caching is successfully applied
      this.recordCacheHit();

      this.logOperation('info', 'Prompt processed for caching', 'processPrompt', {
        provider: request.provider,
        model: request.model,
        tokenCount: analysis.tokenCount,
        cacheType,
        breakpoints: analysis.breakpoints.length,
        estimatedSavings: analysis.estimatedSavings.toFixed(6),
        processingTimeMs: processingTime
      });

      return {
        modifiedMessages,
        cacheHeaders,
        metrics: {
          cacheCreationTokens: analysis.breakpoints.length > 0 ? analysis.tokenCount : 0,
          cacheReadTokens: 0, // Will be set when cache is actually used
          regularTokens: analysis.tokenCount,
          totalSavings: analysis.estimatedSavings,
          hitRate: this.getCacheHitRate(),
          cacheHits: this.cacheHits,
          cacheMisses: this.cacheMisses,
          averageSavingsPerRequest: analysis.estimatedSavings
        },
        cacheUsed: true,
        cacheType
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;

      // Record cache miss on error
      this.recordCacheMiss();

      this.logOperation('error', 'Error processing prompt for caching', 'processPrompt', {
        error: error instanceof Error ? error.message : String(error),
        provider: request.provider,
        model: request.model,
        processingTimeMs: processingTime
      });

      // Return safe fallback
      return {
        modifiedMessages: request.messages,
        cacheHeaders: {
          'x-cache-enabled': 'false',
          'x-cache-error': error instanceof Error ? error.message : 'Unknown error'
        },
        metrics: {
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          regularTokens: request.totalTokens,
          totalSavings: 0,
          hitRate: this.getCacheHitRate(),
          cacheHits: this.cacheHits,
          cacheMisses: this.cacheMisses,
          averageSavingsPerRequest: 0
        },
        cacheUsed: false,
        cacheType: 'none'
      };
    }
  }

  /**
   * Estimate tokens in prompt
   */
  private estimatePromptTokens(messages: any[], provider: string): number {
    try {
      // Extract text content from messages
      let totalText = '';

      for (const message of messages) {
        if (typeof message === 'string') {
          totalText += message + '\n';
        } else if (message.content) {
          if (typeof message.content === 'string') {
            totalText += message.content + '\n';
          } else if (Array.isArray(message.content)) {
            for (const part of message.content) {
              if (part.text) {
                totalText += part.text + '\n';
              }
            }
          }
        }
      }

      const aiProvider = provider === 'anthropic' ? AIProvider.Anthropic :
                        provider === 'openai' ? AIProvider.OpenAI :
                        provider === 'google' ? AIProvider.Google : AIProvider.OpenAI;

      return estimateTokens(totalText, aiProvider);
    } catch (error) {
      this.logOperation('warn', 'Error estimating prompt tokens', 'estimatePromptTokens', {
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }

  /**
   * Analyze prompt structure for caching potential
   */
  private analyzePromptStructure(messages: any[], support: ProviderCacheSupport): {
    hasStaticContent: boolean;
    breakpoints: CacheBreakpoint[];
    needsRestructuring: boolean;
  } {
    const breakpoints: CacheBreakpoint[] = [];
    let hasStaticContent = false;
    let needsRestructuring = false;

    // For explicit caching (Anthropic, Gemini), identify potential breakpoints
    if (support.cacheType === 'explicit') {
      let currentTokens = 0;

      for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        const messageTokens = this.estimateMessageTokens(message);

        // Check if this message could be a cache breakpoint
        if (messageTokens >= support.minTokens &&
            (message.role === 'system' || this.isLikelyStaticContent(message))) {

          breakpoints.push({
            type: message.role === 'system' ? 'system' :
                  this.detectContentType(message),
            minTokens: messageTokens,
            position: i
          });

          hasStaticContent = true;
          currentTokens += messageTokens;
        } else {
          currentTokens += messageTokens;
        }

        // Limit breakpoints to max allowed
        if (breakpoints.length >= support.maxBreakpoints) {
          break;
        }
      }
    }

    // For automatic caching (OpenAI), just check if there's enough static content at the beginning
    if (support.cacheType === 'automatic') {
      let staticTokens = 0;
      for (let i = 0; i < Math.min(messages.length, 3); i++) { // Check first few messages
        const message = messages[i];
        if (message.role === 'system' || this.isLikelyStaticContent(message)) {
          staticTokens += this.estimateMessageTokens(message);
        } else {
          break; // Dynamic content starts here
        }
      }

      hasStaticContent = staticTokens >= support.minTokens;

      // Check if structure needs optimization
      if (hasStaticContent && messages.length > 3) {
        // Check if there are dynamic messages before static ones
        const firstDynamicIndex = messages.findIndex(msg =>
          msg.role !== 'system' && !this.isLikelyStaticContent(msg)
        );

        if (firstDynamicIndex > 0 && firstDynamicIndex < messages.length - 1) {
          // There are static messages after dynamic ones - needs restructuring
          needsRestructuring = true;
        }
      }
    }

    return {
      hasStaticContent,
      breakpoints,
      needsRestructuring
    };
  }

  /**
   * Apply explicit caching transformations
   */
  private applyExplicitCaching(messages: any[], breakpoints: CacheBreakpoint[]): any[] {
    if (breakpoints.length === 0) {
      return messages;
    }

    const modifiedMessages = [...messages];

    // Add cache_control to identified breakpoints
    for (const breakpoint of breakpoints) {
      const message = modifiedMessages[breakpoint.position];
      if (message && message.content) {
        // Anthropic format
        if (Array.isArray(message.content)) {
          // Add cache_control to last text part
          for (let i = message.content.length - 1; i >= 0; i--) {
            if (message.content[i].type === 'text') {
              message.content[i].cache_control = { type: 'ephemeral' };
              break;
            }
          }
        } else if (typeof message.content === 'string') {
          // Convert to array format for cache control
          message.content = [
            {
              type: 'text',
              text: message.content,
              cache_control: { type: 'ephemeral' }
            }
          ];
        }
      }
    }

    return modifiedMessages;
  }

  /**
   * Calculate estimated savings from caching
   */
  private calculateEstimatedSavings(tokenCount: number, support: ProviderCacheSupport): number {
    // Assume 70% of tokens are cacheable on average
    const cacheableTokens = Math.floor(tokenCount * 0.7);
    const regularCost = (tokenCount * support.cachePricing.writePrice) / 1_000_000;
    const cachedCost = (cacheableTokens * support.cachePricing.readPrice) / 1_000_000;

    return Math.max(0, regularCost - cachedCost);
  }

  /**
   * Estimate tokens in a single message
   */
  private estimateMessageTokens(message: any): number {
    try {
      let text = '';

      if (typeof message === 'string') {
        text = message;
      } else if (message.content) {
        if (typeof message.content === 'string') {
          text = message.content;
        } else if (Array.isArray(message.content)) {
          for (const part of message.content) {
            if (part.text) {
              text += part.text + ' ';
            }
          }
        }
      }

      return text ? estimateTokens(text, AIProvider.OpenAI) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Check if message content is likely static/cacheable
   */
  private isLikelyStaticContent(message: any): boolean {
    if (!message || typeof message !== 'object') return false;

    const content = typeof message.content === 'string' ? message.content :
                   Array.isArray(message.content) ? message.content.map((p: any) => p.text || '').join('') :
                   '';

    if (!content) return false;

    const lowerContent = content.toLowerCase();

    // Static indicators
    const staticIndicators = [
      'you are', 'your role is', 'instructions:', 'system prompt',
      'always respond', 'you must', 'guidelines:', 'rules:',
      'context:', 'background:', 'company policy', 'manual:',
      'documentation:', 'reference:', 'knowledge base'
    ];

    return staticIndicators.some(indicator => lowerContent.includes(indicator));
  }

  /**
   * Detect content type for breakpoint classification
   */
  private detectContentType(message: any): 'system' | 'tools' | 'documents' | 'history' {
    if (!message || typeof message !== 'object') return 'history';

    const content = typeof message.content === 'string' ? message.content :
                   Array.isArray(message.content) ? message.content.map((p: any) => p.text || '').join('') :
                   '';

    if (!content) return 'history';

    const lowerContent = content.toLowerCase();

    if (lowerContent.includes('function') || lowerContent.includes('tool')) {
      return 'tools';
    }

    if (lowerContent.includes('document') || lowerContent.includes('manual') ||
        lowerContent.includes('pdf') || lowerContent.includes('file')) {
      return 'documents';
    }

    return 'history';
  }

  /**
   * Record a cache hit for metrics tracking
   */
  public recordCacheHit(): void {
    this.cacheHits++;
  }

  /**
   * Record a cache miss for metrics tracking
   */
  public recordCacheMiss(): void {
    this.cacheMisses++;
  }

  /**
   * Get current cache hit rate
   */
  public getCacheHitRate(): number {
    const totalRequests = this.cacheHits + this.cacheMisses;
    if (totalRequests === 0) {
      return 0;
    }
    return this.cacheHits / totalRequests;
  }

  /**
   * Reset cache hit/miss counters (call periodically to prevent memory issues)
   */
  public resetCacheMetrics(): void {
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.lastHitRateReset = Date.now();
    loggingService.debug('Cache metrics reset', {
      component: 'PromptCachingService',
      operation: 'resetCacheMetrics'
    });
  }

  /**
   * Get detailed cache metrics
   */
  public getCacheMetrics(): {
    hits: number;
    misses: number;
    totalRequests: number;
    hitRate: number;
    lastReset: number;
    uptimeSinceReset: number;
  } {
    const totalRequests = this.cacheHits + this.cacheMisses;
    const hitRate = this.getCacheHitRate();
    const uptimeSinceReset = Date.now() - this.lastHitRateReset;

    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      totalRequests,
      hitRate,
      lastReset: this.lastHitRateReset,
      uptimeSinceReset
    };
  }

  /**
   * Get service health status
   */
  public getHealthStatus() {
    const baseStatus = super.getHealthStatus();
    const cacheMetrics = this.getCacheMetrics();

    // Auto-reset metrics if it's been more than 24 hours to prevent overflow
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    if (cacheMetrics.uptimeSinceReset > ONE_DAY_MS) {
      this.resetCacheMetrics();
    }

    return {
      ...baseStatus,
      supportedProviders: Array.from(this.providerSupport.keys()),
      activeConfigs: this.activeCacheConfigs.size,
      cacheHitRate: Math.round(cacheMetrics.hitRate * 10000) / 100, // Percentage with 2 decimal places
      cacheMetrics: {
        totalRequests: cacheMetrics.totalRequests,
        hits: cacheMetrics.hits,
        misses: cacheMetrics.misses,
        uptimeSinceReset: cacheMetrics.uptimeSinceReset
      }
    };
  }
}

// Export singleton instance
export const promptCachingService = PromptCachingService.getInstance();