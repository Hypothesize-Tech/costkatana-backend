/**
 * Model Token Limits Utility
 *
 * Provides model-specific maximum token limits for AI model invocations.
 * Based on AWS Bedrock model capabilities and output token limits.
 *
 * References:
 * - https://docs.anthropic.com/en/docs/about-claude/models
 * - AWS Bedrock model documentation
 */

/**
 * Get the maximum tokens for a given model ID based on its capabilities.
 *
 * @param modelId - The model identifier (e.g., 'anthropic.claude-3-5-sonnet-20240620-v1:0')
 * @param defaultTokens - Fallback value if model is not recognized (default: 4096)
 * @returns Maximum token limit for the model
 */
export function getMaxTokensForModel(
  modelId: string,
  defaultTokens = 4096,
): number {
  // AWS Bedrock output token limits per model
  // Reference: https://docs.anthropic.com/en/docs/about-claude/models

  // Claude 4.6 models - highest limits (64K output)
  if (modelId.includes('claude-opus-4-6')) {
    return 65536; // Claude Opus 4.6 - supports up to 64K output
  }
  if (modelId.includes('claude-sonnet-4-6')) {
    return 65536; // Claude Sonnet 4.6 - supports up to 64K output
  }

  // Claude 4.5 models - high limits (32K output)
  if (
    modelId.includes('claude-sonnet-4-5') ||
    modelId.includes('claude-opus-4-5')
  ) {
    return 32768; // Claude Sonnet 4.5 / Opus 4.5 - supports up to 32K output
  }

  // Claude 4 models - medium-high limits (16K output)
  if (modelId.includes('claude-opus-4')) {
    return 16384; // Claude Opus 4 - increased for large outputs
  }
  if (
    modelId.includes('claude-haiku-4-5') ||
    modelId.includes('claude-haiku-4')
  ) {
    return 16384; // Claude Haiku 4.5 / 4 - supports large outputs
  }

  // Claude 3.5 models - medium limits (8K output)
  if (modelId.includes('claude-3-5-sonnet')) {
    return 8192; // Claude 3.5 Sonnet - standard limit
  }
  if (modelId.includes('claude-3-5-haiku')) {
    return 8192; // Claude 3.5 Haiku - standard limit
  }

  // Mistral Large 3 - 8K output
  if (
    modelId.includes('mistral-large-3') ||
    modelId.includes('mistral-large-2411')
  ) {
    return 8192;
  }

  // Nova models - lower limits
  if (modelId.includes('nova-pro')) {
    return 5000; // Nova Pro actual limit
  }
  if (modelId.includes('nova')) {
    return 5000; // Other Nova models actual limit
  }

  // Default fallback for unrecognized models
  return defaultTokens;
}

/**
 * Get a conservative token limit for model operations.
 * This is a safer default than the absolute maximum for operational stability.
 *
 * @param modelId - The model identifier
 * @returns Conservative token limit (typically 50-75% of max)
 */
export function getConservativeMaxTokens(modelId: string): number {
  const maxTokens = getMaxTokensForModel(modelId);
  // Use 75% of max for conservative operations to leave buffer
  return Math.floor(maxTokens * 0.75);
}

/**
 * Validate if a requested token count is within model limits.
 *
 * @param modelId - The model identifier
 * @param requestedTokens - Number of tokens being requested
 * @returns true if within limits, false otherwise
 */
export function isWithinModelLimits(
  modelId: string,
  requestedTokens: number,
): boolean {
  const maxTokens = getMaxTokensForModel(modelId);
  return requestedTokens <= maxTokens;
}
