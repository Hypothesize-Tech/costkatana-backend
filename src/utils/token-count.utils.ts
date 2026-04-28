/**
 * Token counting utilities — delegates to the canonical token-counting module.
 *
 * Historically used for OpenAI tiktoken counts. Now provider-aware: pass
 * `provider`/`model` to get the right tokenizer for any supported provider.
 */
import { countTokens } from './token-counting';

const FALLBACK_CHARS_PER_TOKEN = 4;

/**
 * Estimate token count for text. Defaults to OpenAI tokenization when no
 * provider/model is specified (the historical behaviour of this helper).
 */
export function estimateTokenCount(
  text: string,
  options?: { provider?: string; model?: string },
): number {
  if (!text || typeof text !== 'string') return 0;
  return countTokens(text, {
    provider: options?.provider || 'openai',
    model: options?.model,
  }).tokens;
}

/**
 * Pure-heuristic fallback (~4 chars/token). Use only when you explicitly want
 * to bypass real tokenizers — most callers should use `estimateTokenCount`.
 */
export function estimateTokenCountHeuristic(text: string): number {
  if (!text || typeof text !== 'string') return 0;
  return Math.ceil(text.length / FALLBACK_CHARS_PER_TOKEN);
}
