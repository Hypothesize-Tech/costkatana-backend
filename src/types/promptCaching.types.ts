/**
 * Prompt Caching Types
 *
 * Defines interfaces and types for true prompt caching (KV-pair caching)
 * as opposed to output/response caching.
 */

export interface PromptCachingConfig {
  enabled: boolean;
  provider: 'anthropic' | 'openai' | 'google' | 'auto';
  mode: 'automatic' | 'explicit';
  minTokens: number; // Default: 1024
  ttl: number; // Cache TTL in seconds (5-10 minutes)
  structureOptimization: boolean; // Put static content first
  breakpointsEnabled: boolean; // Allow cache breakpoints
}

export interface CacheBreakpoint {
  type: 'system' | 'tools' | 'documents' | 'history';
  minTokens: number;
  position: number; // Index in message array
}

export interface PromptCacheMetrics {
  cacheCreationTokens: number;
  cacheReadTokens: number;
  regularTokens: number;
  totalSavings: number; // USD
  hitRate: number;
  cacheHits: number;
  cacheMisses: number;
  averageSavingsPerRequest: number;
}

export interface CacheAnalysisResult {
  isCacheable: boolean;
  reason?: string;
  estimatedSavings: number;
  tokenCount: number;
  breakpoints: CacheBreakpoint[];
  recommendedStructure: boolean;
}

export interface PromptCacheRequest {
  messages: any[];
  model: string;
  provider: string;
  userId?: string;
  totalTokens: number;
  config: PromptCachingConfig;
}

export interface PromptCacheResponse {
  modifiedMessages: any[];
  cacheHeaders: Record<string, string>;
  metrics: PromptCacheMetrics;
  cacheUsed: boolean;
  cacheType: 'automatic' | 'explicit' | 'none';
}

export interface ProviderCacheSupport {
  provider: string;
  supportsCaching: boolean;
  supportedModels: string[];
  cacheType: 'automatic' | 'explicit';
  minTokens: number;
  maxBreakpoints: number;
  defaultTTL: number;
  cachePricing: {
    writePrice: number; // per 1M tokens
    readPrice: number; // per 1M tokens
    storagePrice?: number; // per 1M tokens per hour (for Gemini)
  };
}

export interface CachedPrompt {
  id: string;
  provider: string;
  model: string;
  userId?: string;
  promptHash: string;
  tokenCount: number;
  breakpoints: CacheBreakpoint[];
  createdAt: Date;
  lastUsedAt: Date;
  ttl: number;
  hitCount: number;
  savings: number; // Total USD saved
}