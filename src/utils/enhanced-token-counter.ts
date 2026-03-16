/**
 * Enhanced token counter that estimates input/output tokens for common model families.
 */

export function estimateInputTokens(text: string): number {
  if (typeof text !== 'string') return 0;
  return Math.ceil((text.length / 4) * 1.1);
}

export function estimateOutputTokens(text: string): number {
  if (typeof text !== 'string') return 0;
  return Math.ceil((text.length / 4) * 1.15);
}

export function estimateTotalTokens(
  input: string,
  output: string,
): { input: number; output: number; total: number } {
  const inputTokens = estimateInputTokens(input);
  const outputTokens = estimateOutputTokens(output);
  return {
    input: inputTokens,
    output: outputTokens,
    total: inputTokens + outputTokens,
  };
}
