/**
 * Google Search API Configuration
 * All settings are hardcoded for simplicity - only API key and Engine ID are from env
 */

export const SEARCH_CONFIG = {
  // Cache configuration
  CACHE_TTL: 3600, // 1 hour in seconds
  
  // Search limits
  MAX_RESULTS: 10,
  DAILY_QUOTA_LIMIT: 100,
  DEEP_CONTENT_PAGES: 5,
  
  // Cost intelligence domains (auto-filtered for pricing/cost queries)
  COST_DOMAINS: [
    'aws.amazon.com',
    'cloud.google.com',
    'learn.microsoft.com',
    'azure.microsoft.com',
    'pricing.aws.amazon.com',
    'azure.microsoft.com/pricing',
    'openai.com',
    'anthropic.com',
    'cohere.com',
    'ai.meta.com',
    'ai.google.dev',
    'mistral.ai',
    'huggingface.co',
    'replicate.com',
    'together.ai',
    'perplexity.ai',
    'claude.ai',
    'gemini.google.com'
  ],
  
  // API configuration
  GOOGLE_SEARCH_API_URL: 'https://www.googleapis.com/customsearch/v1',
  
  // Quota tracking
  QUOTA_WARNING_THRESHOLD: 0.8, // Warn at 80%
  QUOTA_BLOCK_THRESHOLD: 0.9, // Block at 90%
  
  // Content extraction
  CONTENT_TIMEOUT: 10000, // 10 seconds per page
  MAX_CONTENT_LENGTH: 50000, // 50KB max per page
};

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
  displayUrl?: string;
  metadata?: {
    publishedDate?: string;
    author?: string;
  };
}

export interface ContentResult {
  url: string;
  title: string;
  content: string;
  cleanedText: string;
  wordCount: number;
  summary?: string;
}

export interface SearchOptions {
  domains?: string[];
  maxResults?: number;
  deepContent?: boolean;
}

