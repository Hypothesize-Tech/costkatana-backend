import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ChatMessage,
  ChatMessageDocument,
} from '../../../schemas/chat/chat-message.schema';
import { ConversationContext } from '../context';
import { LoggerService } from '../../../common/logger/logger.service';

export interface ContextSizeConfig {
  simple: number;
  medium: number;
  complex: number;
}

export interface OptimizedContext {
  preamble: string;
  messages: any[];
  totalTokens: number;
  truncated: boolean;
}

@Injectable()
export class ContextOptimizer {
  private readonly contextSize: ContextSizeConfig = {
    simple: 10, // Simple messages can handle more context
    medium: 8, // Medium messages
    complex: 5, // Complex messages need less context
  };

  private readonly charsPerToken = 4;
  private readonly maxContextTokens = 8000; // Conservative limit for most models

  constructor(
    @InjectModel(ChatMessage.name)
    private chatMessageModel: Model<ChatMessageDocument>,
    private readonly loggingService: LoggerService,
  ) {}

  /**
   * Get optimal context size based on message complexity
   */
  getOptimalSize(messageLength: number): number {
    if (messageLength > 1000) return this.contextSize.complex;
    if (messageLength > 500) return this.contextSize.medium;
    return this.contextSize.simple;
  }

  /**
   * Fetch recent messages with optimized context sizing
   */
  async fetchOptimalContext(
    conversationId: string,
    messageLength: number,
  ): Promise<any[]> {
    const contextSize = this.getOptimalSize(messageLength);

    const messages = await this.chatMessageModel
      .find({ conversationId }, { content: 1, role: 1, createdAt: 1 })
      .sort({ createdAt: -1 })
      .limit(contextSize)
      .lean()
      .exec();

    // Reverse to get chronological order (oldest first)
    return messages.reverse();
  }

  /**
   * Build optimized context with preamble and token management
   */
  async buildOptimizedContext(
    conversationId: string,
    userMessage: string,
    context: ConversationContext,
  ): Promise<OptimizedContext> {
    const messageLength = userMessage.length;
    const contextSize = this.getOptimalSize(messageLength);

    // Fetch recent messages
    const recentMessages = await this.fetchOptimalContext(
      conversationId,
      messageLength,
    );

    // Build preamble
    const preamble = this.buildPreamble(context, recentMessages);

    // Calculate total tokens
    const preambleTokens = this.estimateTokens(preamble);
    const messageTokens = this.estimateTokens(userMessage);
    const contextTokens = this.estimateConversationTokens(recentMessages);

    const totalTokens = preambleTokens + messageTokens + contextTokens;
    const truncated = totalTokens > this.maxContextTokens;

    // If over limit, truncate context
    let optimizedMessages = recentMessages;
    if (truncated) {
      optimizedMessages = this.truncateContext(
        recentMessages,
        preambleTokens + messageTokens,
        this.maxContextTokens,
      );

      this.loggingService.info('Context truncated due to token limit', {
        originalMessages: recentMessages.length,
        optimizedMessages: optimizedMessages.length,
        totalTokens,
        maxTokens: this.maxContextTokens,
      });
    }

    return {
      preamble,
      messages: optimizedMessages,
      totalTokens:
        totalTokens > this.maxContextTokens
          ? this.maxContextTokens
          : totalTokens,
      truncated,
    };
  }

  /**
   * Build context preamble for AI
   */
  buildPreamble(context: ConversationContext, recentMessages: any[]): string {
    const preamble = [];

    if (context.currentSubject) {
      preamble.push(`Current subject: ${context.currentSubject}`);
    }

    if (context.currentIntent) {
      preamble.push(`Intent: ${context.currentIntent}`);
    }

    if (context.lastReferencedEntities.length > 0) {
      preamble.push(
        `Recent entities: ${context.lastReferencedEntities.slice(-3).join(', ')}`,
      );
    }

    if (context.lastDomain) {
      preamble.push(`Domain: ${context.lastDomain}`);
    }

    if (context.languageFramework) {
      preamble.push(`Language/Framework: ${context.languageFramework}`);
    }

    if (recentMessages.length > 0) {
      const recentContext = recentMessages
        .slice(-2)
        .map(
          (m: any) =>
            `${m.role}: ${m.content?.substring(0, 100)}${m.content?.length > 100 ? '...' : ''}`,
        )
        .join('\n');
      preamble.push(`\nRecent conversation:\n${recentContext}`);
    }

    return preamble.length > 0 ? preamble.join('\n') : '';
  }

  /**
   * Estimate tokens from text
   */
  private estimateTokens(text: string | number): number {
    const length = typeof text === 'string' ? text.length : text;
    return Math.ceil(length / this.charsPerToken);
  }

  /**
   * Estimate tokens for conversation messages
   */
  private estimateConversationTokens(messages: any[]): number {
    // Add 4 tokens per message for structure overhead (role, formatting, etc.)
    const messageOverhead = messages.length * 4;
    const contentTokens = messages.reduce((total, msg) => {
      return total + this.estimateTokens(msg.content || '');
    }, 0);

    return contentTokens + messageOverhead;
  }

  /**
   * Truncate context to fit within token limit
   */
  private truncateContext(
    messages: any[],
    fixedTokens: number, // preamble + user message
    maxTotalTokens: number,
  ): any[] {
    const availableTokens = maxTotalTokens - fixedTokens;
    let currentTokens = 0;
    const truncatedMessages = [];

    // Start from most recent messages and work backwards
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      const messageTokens = this.estimateTokens(message.content || '') + 4; // +4 for overhead

      if (currentTokens + messageTokens <= availableTokens) {
        truncatedMessages.unshift(message); // Add to beginning to maintain order
        currentTokens += messageTokens;
      } else {
        break;
      }
    }

    return truncatedMessages;
  }

  /**
   * Get context statistics for debugging
   */
  getContextStats(
    conversationId: string,
    preamble: string,
    messages: any[],
    totalTokens: number,
  ) {
    return {
      conversationId,
      preambleLength: preamble.length,
      preambleTokens: this.estimateTokens(preamble),
      messageCount: messages.length,
      contextTokens: this.estimateConversationTokens(messages),
      totalTokens,
      isOverLimit: totalTokens > this.maxContextTokens,
      utilizationPercent: Math.round(
        (totalTokens / this.maxContextTokens) * 100,
      ),
    };
  }

  /**
   * Optimize context for specific model constraints
   */
  optimizeForModel(
    optimizedContext: OptimizedContext,
    modelMaxTokens: number,
    reservedTokens: number = 1000, // Reserve for response
  ): OptimizedContext {
    const availableTokens = modelMaxTokens - reservedTokens;

    if (optimizedContext.totalTokens <= availableTokens) {
      return optimizedContext; // No optimization needed
    }

    // Recalculate with model constraints
    const messages = this.truncateContext(
      optimizedContext.messages,
      this.estimateTokens(optimizedContext.preamble),
      availableTokens,
    );

    const totalTokens =
      this.estimateTokens(optimizedContext.preamble) +
      this.estimateConversationTokens(messages);

    return {
      preamble: optimizedContext.preamble,
      messages,
      totalTokens,
      truncated: true,
    };
  }
}
