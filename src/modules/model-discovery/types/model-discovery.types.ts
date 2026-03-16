/**
 * Model Discovery Types
 * Shared interfaces and types for model discovery functionality
 */

export interface SearchResult {
  title: string;
  snippet: string;
  link: string;
}

/**
 * Raw pricing data extracted from search results
 */
export interface RawPricingData {
  modelId: string;
  modelName: string;
  inputPricePerMToken: number;
  outputPricePerMToken: number;
  cachedInputPricePerMToken?: number;
  contextWindow: number;
  capabilities: string[];
  category: 'text' | 'multimodal' | 'embedding' | 'code';
  isLatest: boolean;
}

/**
 * Model discovery result
 */
export interface ModelDiscoveryResult {
  provider: string;
  modelsDiscovered: number;
  modelsSkipped?: number;
  modelsValidated: number;
  modelsFailed: number;
  errors: string[];
  discoveryDate: Date;
  duration: number;
}

/**
 * Discovery job status
 */
export interface DiscoveryJobStatus {
  isRunning: boolean;
  lastRun?: Date | null;
  nextScheduled?: Date | null;
  totalModels: number;
  providerStats: Record<
    string,
    {
      total: number;
      verified: number;
      pending: number;
      failed: number;
      lastUpdated: Date | null;
    }
  >;
  recentErrors: Array<{
    provider: string;
    error: string;
    timestamp: Date;
  }>;
}

/**
 * Search query configuration
 */
export interface SearchQueryConfig {
  provider: string;
  phase: 'discovery' | 'pricing';
  modelName?: string;
  maxResults?: number;
}

/**
 * Extraction result from LLM
 */
export interface LLMExtractionResult {
  success: boolean;
  data?: RawPricingData | string[];
  error?: string;
  prompt: string;
  response: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  normalizedData?: RawPricingData;
}

/**
 * Provider configuration for discovery
 */
export interface ProviderDiscoveryConfig {
  provider: string;
  discoveryQuery: string;
  pricingQueryTemplate: string;
  officialDocsUrl: string;
  expectedModelPatterns: RegExp[];
}

/**
 * Scraped pricing data from web scraper
 */
export interface ScrapedPricingData {
  provider: string;
  url: string;
  content: string;
  scrapedAt: Date;
  success: boolean;
  error?: string;
}
