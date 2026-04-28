/**
 * Token counting utilities — delegates to the canonical token-counting module
 * so all call sites get provider-aware tokenization (real BPE for OpenAI,
 * Anthropic, Mistral; provider heuristics for Google/Cohere).
 *
 * Public API is preserved for backwards compatibility with the call sites
 * already importing from this file.
 */
import { countTokens, countChatMessageTokens } from './token-counting';

/**
 * Estimates the number of tokens for a piece of text using a provider-aware
 * tokenizer. Returns 0 for empty/non-string input.
 *
 * For maximum accuracy use `countTokensAuthoritative` from
 * `./token-counting` instead — that calls the provider's count-tokens
 * endpoint when an API key is supplied.
 */
export function estimateTokens(
  text: string,
  provider?: string,
  model?: string,
): number {
  if (!text || typeof text !== 'string') return 0;
  return countTokens(text, { provider, model }).tokens;
}

/** Async version for consistency with legacy callers */
export async function estimateTokensAsync(
  text: string,
  provider?: string,
  model?: string,
): Promise<number> {
  return estimateTokens(text, provider, model);
}

export { AIProvider } from '../types/aiCostTracker.types';

export function countWords(text: string): number {
  if (!text || typeof text !== 'string') return 0;
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
}

export function estimateTokensFromWords(wordCount: number): number {
  // Rough conversion when only a word count is available.
  return Math.ceil(wordCount * 1.3);
}

/**
 * Token estimate for an image input. Image tokenization is highly
 * model-specific (OpenAI tile-based, Anthropic patches, Gemini area-based);
 * this is a coarse approximation. For accurate counts, use the response
 * `usage` field after the call.
 */
export function estimateTokensForImage(
  width: number = 512,
  height: number = 512,
): number {
  const pixels = width * height;
  const tokensPerPixel = 0.001;
  return Math.ceil(pixels * tokensPerPixel);
}

export function estimateTokensForMessages(
  messages: Array<{ role: string; content: string }>,
  provider?: string,
  model?: string,
): number {
  return countChatMessageTokens(messages, { provider, model }).tokens;
}
