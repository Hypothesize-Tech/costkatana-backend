/**
 * Canonical token-counting types for costkatana-backend.
 *
 * Source-of-truth ranking (most -> least accurate):
 *   1. response_usage : pulled from the provider's API response
 *   2. provider_api   : count-tokens API endpoint (Anthropic / Gemini / Cohere)
 *   3. local_tokenizer: real BPE/SentencePiece run locally (tiktoken, etc.)
 *   4. heuristic      : char/word approximation
 *
 * Anything not in (1) or (2) is `estimated: true` and downstream cost reports
 * should mark the value as approximate.
 */

export type TokenSource =
  | 'response_usage'
  | 'provider_api'
  | 'local_tokenizer'
  | 'heuristic';

export type ProviderName =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'cohere'
  | 'mistral'
  | 'meta'
  | 'amazon'
  | 'bedrock'
  | 'unknown';

export interface TokenCount {
  tokens: number;
  source: TokenSource;
  estimated: boolean;
  provider: ProviderName;
  model?: string;
}

export interface UsageBreakdown {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;

  /** Anthropic prompt caching: tokens read from the cache (billed at ~0.1x). */
  cacheReadInputTokens?: number;
  /** Anthropic prompt caching: tokens written to the cache (billed at ~1.25x). */
  cacheCreationInputTokens?: number;

  /** OpenAI o1-family reasoning tokens (counted within output). */
  reasoningTokens?: number;

  source: TokenSource;
  estimated: boolean;
  provider: ProviderName;
  model?: string;
}

export interface CountOptions {
  provider?: string;
  model?: string;
}

export interface AsyncCountOptions extends CountOptions {
  /** Provider API key for authoritative count-tokens endpoints. */
  apiKey?: string;
  /** Disable network calls; force local tokenizer or heuristic. */
  offline?: boolean;
}
