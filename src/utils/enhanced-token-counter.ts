/**
 * Enhanced token counter — delegates to the canonical token-counting module.
 *
 * The legacy `length / 4 * 1.1` and `* 1.15` heuristics produced numbers
 * 10-15% higher than reality for OpenAI/Anthropic. We now run a real
 * tokenizer when possible.
 */
import { countTokens } from './token-counting';

export function estimateInputTokens(
  text: string,
  provider?: string,
  model?: string,
): number {
  if (typeof text !== 'string') return 0;
  return countTokens(text, { provider, model }).tokens;
}

export function estimateOutputTokens(
  text: string,
  provider?: string,
  model?: string,
): number {
  if (typeof text !== 'string') return 0;
  return countTokens(text, { provider, model }).tokens;
}

export function estimateTotalTokens(
  input: string,
  output: string,
  provider?: string,
  model?: string,
): { input: number; output: number; total: number } {
  const inputTokens = estimateInputTokens(input, provider, model);
  const outputTokens = estimateOutputTokens(output, provider, model);
  return {
    input: inputTokens,
    output: outputTokens,
    total: inputTokens + outputTokens,
  };
}
