/**
 * Google Search API Configuration
 * Values from environment variables with sensible defaults
 */

const DEFAULT_COST_DOMAINS = [
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
  'gemini.google.com',
];

function getCostDomains(): string[] {
  const env = process.env.SEARCH_COST_DOMAINS;
  if (env && env.trim()) {
    return env.split(',').map((d) => d.trim()).filter(Boolean);
  }
  return DEFAULT_COST_DOMAINS;
}

export const SEARCH_CONFIG = {
  // Cache configuration (env: SEARCH_CACHE_TTL)
  CACHE_TTL: parseInt(
    process.env.SEARCH_CACHE_TTL ?? '3600',
    10,
  ) as number,

  // Search limits (env: SEARCH_MAX_RESULTS, SEARCH_DAILY_QUOTA_LIMIT, SEARCH_DEEP_CONTENT_PAGES)
  MAX_RESULTS: parseInt(process.env.SEARCH_MAX_RESULTS ?? '10', 10) as number,
  DAILY_QUOTA_LIMIT: parseInt(
    process.env.SEARCH_DAILY_QUOTA_LIMIT ?? '100',
    10,
  ) as number,
  DEEP_CONTENT_PAGES: parseInt(
    process.env.SEARCH_DEEP_CONTENT_PAGES ?? '5',
    10,
  ) as number,

  // Cost intelligence domains (env: SEARCH_COST_DOMAINS, comma-separated)
  COST_DOMAINS: getCostDomains(),

  // API configuration (env: SEARCH_API_URL)
  GOOGLE_SEARCH_API_URL:
    process.env.SEARCH_API_URL ??
    'https://www.googleapis.com/customsearch/v1',

  // Quota tracking (env: SEARCH_QUOTA_WARNING_THRESHOLD, SEARCH_QUOTA_BLOCK_THRESHOLD)
  QUOTA_WARNING_THRESHOLD: parseFloat(
    process.env.SEARCH_QUOTA_WARNING_THRESHOLD ?? '0.8',
  ) as number,
  QUOTA_BLOCK_THRESHOLD: parseFloat(
    process.env.SEARCH_QUOTA_BLOCK_THRESHOLD ?? '0.9',
  ) as number,

  // Content extraction (env: SEARCH_CONTENT_TIMEOUT, SEARCH_MAX_CONTENT_LENGTH)
  CONTENT_TIMEOUT: parseInt(
    process.env.SEARCH_CONTENT_TIMEOUT ?? '10000',
    10,
  ) as number,
  MAX_CONTENT_LENGTH: parseInt(
    process.env.SEARCH_MAX_CONTENT_LENGTH ?? '50000',
    10,
  ) as number,
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
