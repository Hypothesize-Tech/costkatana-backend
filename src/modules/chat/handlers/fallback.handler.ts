/**
 * Fallback Handler for NestJS
 * Handles circuit breaker fallback and direct Bedrock responses
 */

import { Injectable, Logger } from '@nestjs/common';
import { BedrockService } from '../../../services/bedrock.service';
import {
  HandlerRequest,
  HandlerResult,
  ProcessingContext,
  FallbackResult,
} from './types/handler.types';

@Injectable()
export class FallbackHandler {
  private readonly logger = new Logger(FallbackHandler.name);

  // Circuit breaker state with exponential backoff
  private errorCounts: Map<string, number> = new Map();
  private errorResetLevels: Map<string, number> = new Map(); // Track backoff level per user
  private readonly MAX_ERRORS = 5;
  private readonly BASE_RESET_TIME = 1 * 60 * 1000; // 1 minute base
  private readonly MAX_RESET_TIME = 30 * 60 * 1000; // 30 minutes cap
  private readonly BACKOFF_MULTIPLIER = 2; // Double each time
  private readonly JITTER_PERCENTAGE = 0.1; // ±10% jitter

  constructor(private readonly bedrockService: BedrockService) {}

  /**
   * Handle circuit breaker fallback with exponential backoff
   */
  async handleWithCircuitBreaker(
    request: HandlerRequest,
    context: ProcessingContext,
    processFn: () => Promise<HandlerResult>,
  ): Promise<HandlerResult> {
    const userId = request.userId;
    const errorKey = `${userId}-processing`;

    // Check circuit breaker
    if ((this.errorCounts.get(errorKey) || 0) >= this.MAX_ERRORS) {
      this.logger.warn('Circuit breaker open for user, using direct Bedrock', {
        userId,
        errorCount: this.errorCounts.get(errorKey),
        backoffLevel: this.errorResetLevels.get(errorKey) || 0,
      });
      return this.directBedrock(request, context);
    }

    try {
      // Try enhanced processing
      const result = await processFn();

      // Reset circuit breaker on success
      this.errorCounts.delete(errorKey);
      this.errorResetLevels.delete(errorKey);

      return result;
    } catch (error) {
      // Increment error count and backoff level
      const currentErrorCount = this.errorCounts.get(errorKey) || 0;
      const newErrorCount = currentErrorCount + 1;
      this.errorCounts.set(errorKey, newErrorCount);

      const currentBackoffLevel = this.errorResetLevels.get(errorKey) || 0;
      const newBackoffLevel = currentBackoffLevel + 1;
      this.errorResetLevels.set(errorKey, newBackoffLevel);

      // Calculate exponential backoff with jitter
      const baseDelay = Math.min(
        this.BASE_RESET_TIME *
          Math.pow(this.BACKOFF_MULTIPLIER, currentBackoffLevel),
        this.MAX_RESET_TIME,
      );
      const jitter =
        baseDelay * this.JITTER_PERCENTAGE * (Math.random() * 2 - 1); // ±10%
      const delayWithJitter = Math.max(
        baseDelay + jitter,
        this.BASE_RESET_TIME,
      );

      // Schedule reset with exponential backoff
      setTimeout(() => {
        this.errorCounts.delete(errorKey);
        this.errorResetLevels.delete(errorKey);
        this.logger.log('Circuit breaker reset for user', {
          userId,
          backoffLevel: newBackoffLevel,
          delayMs: Math.round(delayWithJitter),
        });
      }, delayWithJitter);

      this.logger.warn('Enhanced processing failed, using Bedrock fallback', {
        userId,
        errorCount: newErrorCount,
        backoffLevel: newBackoffLevel,
        nextResetMs: Math.round(delayWithJitter),
        error: error instanceof Error ? error.message : String(error),
      });

      return this.directBedrock(request, context);
    }
  }

  /**
   * Direct Bedrock fallback
   */
  async directBedrock(
    request: HandlerRequest,
    context: ProcessingContext,
    streamingCallback?: (chunk: string, done: boolean) => void | Promise<void>,
  ): Promise<HandlerResult> {
    // Build contextual messages for streaming
    const messages = this.buildContextualMessages(
      context.recentMessages,
      request.message || '',
    );

    let responseText: string;
    let inputTokens = 0;
    let outputTokens = 0;

    if (streamingCallback) {
      // Use streaming response for real-time token delivery
      const streamResult = await this.bedrockService.streamModelResponse(
        messages,
        request.modelId || 'nova-pro-v1:0',
        {
          maxTokens: request.maxTokens || 1000,
          temperature: request.temperature || 0.7,
          onChunk: streamingCallback,
        },
      );
      responseText = streamResult.fullResponse;
      inputTokens = streamResult.inputTokens;
      outputTokens = streamResult.outputTokens;
    } else {
      // Use regular invocation for non-streaming
      const response = await this.bedrockService.invokeModel(
        messages[messages.length - 1]?.content || '',
        request.modelId || 'nova-pro-v1:0',
        {
          maxTokens: request.maxTokens || 1000,
          temperature: request.temperature || 0.7,
          recentMessages: context.recentMessages,
          useSystemPrompt: true,
          userId: request.userId,
        },
      );
      responseText = response.response || '';
      // Estimate tokens for non-streaming (could be improved)
      inputTokens = Math.ceil(
        (messages[messages.length - 1]?.content || '').length / 4,
      );
      outputTokens = Math.ceil(responseText.length / 4);
    }

    // Track optimizations based on context usage
    const optimizations = ['circuit_breaker'];
    if (streamingCallback) {
      optimizations.push('token_streaming');
    }
    if (context.recentMessages && context.recentMessages.length > 0) {
      optimizations.push('multi_turn_context');
      optimizations.push('system_prompt');
    }

    return {
      response: responseText,
      agentPath: ['bedrock_direct'],
      optimizationsApplied: optimizations,
      cacheHit: false,
      riskLevel: 'low',
      success: true,
    };
  }

  /**
   * Build contextual messages array for streaming
   */
  private buildContextualMessages(
    messages: any[],
    newMessage: string,
  ): Array<{ role: string; content: string }> {
    const contextualMessages: Array<{ role: string; content: string }> = [];

    if (messages && messages.length > 0) {
      // Take last 5 messages for context
      const recentMessages = messages.slice(-5);
      for (const msg of recentMessages) {
        contextualMessages.push({
          role: msg.role || 'user',
          content: msg.content || msg.message || '',
        });
      }
    }

    // Add the new message
    contextualMessages.push({
      role: 'user',
      content: newMessage,
    });

    return contextualMessages;
  }

  /**
   * Build contextual prompt from recent messages (legacy method for non-streaming)
   */
  private buildContextualPrompt(messages: any[], newMessage: string): string {
    if (!messages || messages.length === 0) {
      return newMessage;
    }

    // Take last 5 messages for context
    const recentContext = messages
      .slice(-5)
      .map((m) => `${m.role || 'user'}: ${m.content || m.message || ''}`)
      .join('\n');

    return `${recentContext}\nuser: ${newMessage}`;
  }

  /**
   * Get circuit breaker status for a user
   */
  getCircuitBreakerStatus(userId: string): {
    isOpen: boolean;
    errorCount: number;
    maxErrors: number;
    backoffLevel: number;
    nextResetTimeMs?: number;
  } {
    const errorKey = `${userId}-processing`;
    const errorCount = this.errorCounts.get(errorKey) || 0;
    const backoffLevel = this.errorResetLevels.get(errorKey) || 0;

    // Calculate next reset time if circuit is open
    let nextResetTimeMs: number | undefined;
    if (errorCount >= this.MAX_ERRORS) {
      const baseDelay = Math.min(
        this.BASE_RESET_TIME *
          Math.pow(this.BACKOFF_MULTIPLIER, backoffLevel - 1),
        this.MAX_RESET_TIME,
      );
      nextResetTimeMs = Math.round(baseDelay);
    }

    return {
      isOpen: errorCount >= this.MAX_ERRORS,
      errorCount,
      maxErrors: this.MAX_ERRORS,
      backoffLevel,
      nextResetTimeMs,
    };
  }

  /**
   * Reset circuit breaker for a user
   */
  resetCircuitBreaker(userId: string): void {
    const errorKey = `${userId}-processing`;
    this.errorCounts.delete(errorKey);
    this.errorResetLevels.delete(errorKey);
    this.logger.log('Circuit breaker manually reset for user', { userId });
  }
}
