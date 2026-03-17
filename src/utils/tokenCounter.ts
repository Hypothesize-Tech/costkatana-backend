/**
 * Token counting utilities
 * Accepts optional provider/model for future provider-specific tokenization
 */

/**
 * Estimates the number of tokens for a piece of text, using
 * provider/model-specific heuristics when those are known, and falls back to
 * a default estimation otherwise.
 *
 * @param text - The text to estimate token count for.
 * @param provider - The AI provider (e.g., 'openai', 'anthropic', 'cohere', ...).
 * @param model - The specific model name (e.g., 'gpt-3.5-turbo', 'claude-instant').
 * @returns The estimated token count.
 */
export function estimateTokens(
  text: string,
  provider?: string,
  model?: string,
): number {
  if (!text || typeof text !== 'string') {
    return 0;
  }

  const cleanText = text.trim();

  // Fast lookup heuristics per provider/model, fallback to default approximation
  // For future: Plug in true tokenizers where available

  // OpenAI heuristics (incl. GPT-3/GPT-4, Whisper, DALL-E, etc)
  if (provider?.toLowerCase() === 'openai') {
    if (!model || model.toLowerCase().includes('gpt')) {
      // OpenAI estimates: ~4 chars/token for English, ~1.33 tokens/word
      const charCount = cleanText.length;
      const estimatedTokens = Math.ceil(charCount / 4);
      // Overhead for system/user/assistant role & special tokens
      const overhead = Math.ceil(estimatedTokens * 0.1) + 3;
      return estimatedTokens + overhead;
    }
    // Other OpenAI models: fallback to char-based estimation
  }

  // Anthropic Claude models
  if (provider?.toLowerCase() === 'anthropic') {
    // Claude is somewhat more efficient: closer to 5 chars/token
    const charCount = cleanText.length;
    const estimatedTokens = Math.ceil(charCount / 5);
    const overhead = Math.ceil(estimatedTokens * 0.08) + 2;
    return estimatedTokens + overhead;
  }

  // Cohere models
  if (provider?.toLowerCase() === 'cohere') {
    // Cohere's BPE is similar to OpenAI's, usually 4 chars/token
    const charCount = cleanText.length;
    const estimatedTokens = Math.ceil(charCount / 4);
    const overhead = Math.ceil(estimatedTokens * 0.1);
    return estimatedTokens + overhead;
  }

  // Stable Diffusion/Other Image Models - not meaningful for text; caller should use estimateTokensForImage

  // Google Palm/Bard models (notoriously word-based)
  if (
    provider?.toLowerCase() === 'google' ||
    provider?.toLowerCase() === 'palm'
  ) {
    // Usually 1 token ≈ 1 word
    const wordCount = cleanText
      .split(/\s+/)
      .filter((word) => word.length > 0).length;
    const overhead = Math.ceil(wordCount * 0.05);
    return wordCount + overhead;
  }

  // Add additional provider/model heuristics here as needed

  // Generic fallback: English-like text, 4 chars/token
  const charCount = cleanText.length;
  const estimatedTokens = Math.ceil(charCount / 4);
  const overhead = Math.ceil(estimatedTokens * 0.1);
  return estimatedTokens + overhead;
}

/** Async version for consistency with legacy callers */
export async function estimateTokensAsync(text: string): Promise<number> {
  return estimateTokens(text);
}

/** Re-export AIProvider for callers that need it */
export { AIProvider } from '../types/aiCostTracker.types';

export function countWords(text: string): number {
  if (!text || typeof text !== 'string') {
    return 0;
  }

  // Split by whitespace and filter out empty strings
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
}

export function estimateTokensFromWords(wordCount: number): number {
  // Rough approximation: 1.3 tokens per word on average
  return Math.ceil(wordCount * 1.3);
}

export function estimateTokensForImage(
  width: number = 512,
  height: number = 512,
): number {
  // Rough estimation for image tokens
  // Different models have different tokenization for images
  // This is a simple approximation
  const pixels = width * height;
  const tokensPerPixel = 0.001; // Very rough approximation
  return Math.ceil(pixels * tokensPerPixel);
}

export function estimateTokensForMessages(
  messages: Array<{ role: string; content: string }>,
): number {
  let totalTokens = 0;

  for (const message of messages) {
    // Add tokens for role indicator
    totalTokens += 10; // Rough estimate for role metadata

    // Add tokens for content
    totalTokens += estimateTokens(message.content);

    // Add spacing/formatting overhead
    totalTokens += 5;
  }

  return totalTokens;
}
