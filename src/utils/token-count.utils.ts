/**
 * Token counting utilities using tiktoken for accurate counts.
 * Uses cl100k_base (OpenAI GPT-3.5/GPT-4) as default encoding.
 * Falls back to 4-char heuristic when tiktoken is unavailable.
 */

const FALLBACK_CHARS_PER_TOKEN = 4;

let encoder: { encode: (text: string) => number[] } | null = null;

function getEncoder(): { encode: (text: string) => number[] } | null {
  if (encoder) return encoder;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getEncoding } = require('js-tiktoken');
    encoder = getEncoding('cl100k_base');
    return encoder;
  } catch {
    return null;
  }
}

/**
 * Estimate token count for text using tiktoken when available.
 * Falls back to 4 characters per token heuristic for non-OpenAI models or when tiktoken fails.
 *
 * @param text - Text to count tokens for
 * @param encoding - Optional encoding name; defaults to cl100k_base (OpenAI)
 * @returns Estimated token count
 */
export function estimateTokenCount(text: string): number {
  if (!text || typeof text !== 'string') return 0;
  const enc = getEncoder();
  if (enc) {
    try {
      const tokens = enc.encode(text);
      return tokens.length;
    } catch {
      // Fallback to heuristic
    }
  }
  return Math.ceil(text.length / FALLBACK_CHARS_PER_TOKEN);
}

/**
 * Fallback heuristic: ~4 characters per token for English text.
 * Use when provider-specific token count from API is not available.
 */
export function estimateTokenCountHeuristic(text: string): number {
  if (!text || typeof text !== 'string') return 0;
  return Math.ceil(text.length / FALLBACK_CHARS_PER_TOKEN);
}
