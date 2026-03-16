import { estimateTokens, estimateTokensForMessages } from './tokenCounter';

export class TokenEstimator {
  /**
   * Estimate tokens for a simple text prompt
   */
  static estimatePrompt(prompt: string): number {
    return estimateTokens(prompt);
  }

  /**
   * Estimate tokens for chat messages
   */
  static estimateChat(
    messages: Array<{ role: string; content: string }>,
  ): number {
    return estimateTokensForMessages(messages);
  }

  /**
   * Estimate tokens for text with context
   */
  static estimateWithContext(text: string, context?: string): number {
    let tokens = estimateTokens(text);

    if (context) {
      tokens += estimateTokens(context);
      // Add overhead for context switching
      tokens += 50;
    }

    return tokens;
  }

  /**
   * Estimate completion tokens based on prompt tokens
   */
  static estimateCompletion(promptTokens: number, maxTokens?: number): number {
    // Conservative estimate: completion is typically 25-50% of prompt length
    const estimated = Math.ceil(promptTokens * 0.3);

    if (maxTokens && estimated > maxTokens) {
      return maxTokens;
    }

    return Math.max(estimated, 50); // Minimum 50 tokens
  }

  /**
   * Estimate total tokens for a request
   */
  static estimateTotal(
    prompt: string,
    context?: string,
    maxCompletionTokens?: number,
  ): { promptTokens: number; completionTokens: number; totalTokens: number } {
    const promptTokens = this.estimateWithContext(prompt, context);
    const completionTokens = this.estimateCompletion(
      promptTokens,
      maxCompletionTokens,
    );
    const totalTokens = promptTokens + completionTokens;

    return {
      promptTokens,
      completionTokens,
      totalTokens,
    };
  }

  /**
   * Validate token counts against model limits
   */
  static validateLimits(
    promptTokens: number,
    completionTokens: number,
    contextWindow: number,
    maxOutputTokens?: number,
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    const totalTokens = promptTokens + completionTokens;

    if (totalTokens > contextWindow) {
      errors.push(
        `Total tokens (${totalTokens}) exceed context window (${contextWindow})`,
      );
    }

    if (maxOutputTokens && completionTokens > maxOutputTokens) {
      errors.push(
        `Completion tokens (${completionTokens}) exceed maximum output (${maxOutputTokens})`,
      );
    }

    if (promptTokens < 1) {
      errors.push('Prompt tokens must be at least 1');
    }

    if (completionTokens < 1) {
      errors.push('Completion tokens must be at least 1');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}
