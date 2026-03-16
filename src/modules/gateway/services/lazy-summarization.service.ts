import { Injectable, Logger } from '@nestjs/common';

export interface SummarizationDecision {
  shouldApply: boolean;
  recommendedTarget: number;
}

export interface SummarizationResult {
  original: any[];
  compressed: any[];
  reductionPercentage: number;
}

/**
 * Lazy Summarization Service
 * Intelligently compresses conversation history when token limits are approached
 * Maintains context while reducing token usage for better performance
 */
@Injectable()
export class LazySummarizationService {
  private readonly logger = new Logger(LazySummarizationService.name);

  // Configuration
  private readonly MAX_TOKENS_BEFORE_SUMMARIZATION = 8000;
  private readonly TARGET_TOKENS_AFTER_SUMMARIZATION = 4000;
  private readonly MIN_MESSAGES_TO_SUMMARIZE = 10;
  private readonly MAX_SUMMARY_LENGTH = 500;

  /**
   * Determine if summarization should be applied based on token count
   */
  shouldApplySummarization(totalTokens: number): SummarizationDecision {
    const shouldApply = totalTokens > this.MAX_TOKENS_BEFORE_SUMMARIZATION;

    return {
      shouldApply,
      recommendedTarget: shouldApply
        ? this.TARGET_TOKENS_AFTER_SUMMARIZATION
        : totalTokens,
    };
  }

  /**
   * Compress conversation history by summarizing older messages
   */
  async compressConversationHistory(
    messages: any[],
  ): Promise<SummarizationResult> {
    try {
      if (messages.length < this.MIN_MESSAGES_TO_SUMMARIZE) {
        return {
          original: messages,
          compressed: messages,
          reductionPercentage: 0,
        };
      }

      // Separate recent messages from older ones
      const recentMessageCount = Math.max(5, Math.floor(messages.length * 0.3));
      const recentMessages = messages.slice(-recentMessageCount);
      const olderMessages = messages.slice(0, -recentMessageCount);

      if (olderMessages.length < 3) {
        return {
          original: messages,
          compressed: messages,
          reductionPercentage: 0,
        };
      }

      // Create summary of older messages
      const summaryMessage = await this.summarizeMessageHistory(olderMessages);

      // Combine summary with recent messages
      const compressedMessages = [summaryMessage, ...recentMessages];

      const reductionPercentage =
        ((messages.length - compressedMessages.length) / messages.length) * 100;

      return {
        original: messages,
        compressed: compressedMessages,
        reductionPercentage,
      };
    } catch (error) {
      this.logger.error('Failed to compress conversation history', {
        error: error instanceof Error ? error.message : String(error),
        messageCount: messages.length,
      });

      // Return original messages on error
      return {
        original: messages,
        compressed: messages,
        reductionPercentage: 0,
      };
    }
  }

  /**
   * Create a summary message from a batch of conversation messages
   */
  private async summarizeMessageHistory(messages: any[]): Promise<any> {
    try {
      // Extract key information from the message history
      const conversationTopics = this.extractConversationTopics(messages);
      const keyDecisions = this.extractKeyDecisions(messages);
      const unresolvedItems = this.extractUnresolvedItems(messages);
      const userPreferences = this.extractUserPreferences(messages);

      // Create a concise summary
      const summary = this.buildSummaryText({
        topics: conversationTopics,
        decisions: keyDecisions,
        unresolved: unresolvedItems,
        preferences: userPreferences,
        messageCount: messages.length,
      });

      // Create a summary message in the same format as other messages
      return {
        role: 'assistant',
        content: `## Conversation Summary\n\n${summary}\n\n*(This is a summary of the previous ${messages.length} messages to maintain context while reducing token usage)*`,
        metadata: {
          type: 'conversation_summary',
          originalMessageCount: messages.length,
          createdAt: new Date().toISOString(),
          summaryType: 'lazy_compression',
        },
      };
    } catch (error) {
      this.logger.error('Failed to create conversation summary', {
        error: error instanceof Error ? error.message : String(error),
        messageCount: messages.length,
      });

      // Return a simple fallback summary
      return {
        role: 'assistant',
        content: `Previous conversation context: ${messages.length} messages discussing various topics. Key context preserved for continuity.`,
        metadata: {
          type: 'conversation_summary',
          originalMessageCount: messages.length,
          createdAt: new Date().toISOString(),
          summaryType: 'fallback',
        },
      };
    }
  }

  /**
   * Extract main conversation topics from messages
   */
  private extractConversationTopics(messages: any[]): string[] {
    const topics = new Set<string>();

    // Simple keyword-based topic extraction
    const topicKeywords = {
      code: ['code', 'programming', 'function', 'class', 'api', 'database'],
      ai: ['ai', 'model', 'gpt', 'claude', 'anthropic', 'openai', 'training'],
      cost: ['cost', 'pricing', 'budget', 'usage', 'tokens', 'billing'],
      optimization: [
        'optimize',
        'performance',
        'efficiency',
        'speed',
        'memory',
      ],
      integration: ['integrate', 'api', 'webhook', 'oauth', 'authentication'],
      analysis: ['analyze', 'analytics', 'metrics', 'dashboard', 'report'],
    };

    for (const message of messages) {
      const content = message.content?.toLowerCase() || '';

      for (const [topic, keywords] of Object.entries(topicKeywords)) {
        if (keywords.some((keyword) => content.includes(keyword))) {
          topics.add(topic);
        }
      }
    }

    return Array.from(topics);
  }

  /**
   * Extract key decisions made during the conversation
   */
  private extractKeyDecisions(messages: any[]): string[] {
    const decisions: string[] = [];

    for (const message of messages) {
      const content = message.content || '';

      // Look for decision indicators
      const decisionPatterns = [
        /decided to/i,
        /will use/i,
        /going with/i,
        /chose/i,
        /selected/i,
        /implemented/i,
        /using/i,
      ];

      for (const pattern of decisionPatterns) {
        if (pattern.test(content)) {
          // Extract a brief summary of the decision
          const sentences = content
            .split(/[.!?]+/)
            .filter((s: string) => s.trim());
          const decisionSentence = sentences.find((s: string) =>
            pattern.test(s),
          );
          if (decisionSentence) {
            decisions.push(decisionSentence.trim().substring(0, 100));
          }
          break; // Only take the first decision indicator per message
        }
      }
    }

    return decisions.slice(0, 3); // Limit to top 3 decisions
  }

  /**
   * Extract unresolved items or questions
   */
  private extractUnresolvedItems(messages: any[]): string[] {
    const unresolved: string[] = [];

    for (const message of messages) {
      const content = message.content || '';

      // Look for questions or unresolved items
      if (
        content.includes('?') ||
        /\btodo\b|\bfix\b|\bissue\b/i.test(content)
      ) {
        const sentences = content
          .split(/[.!?]+/)
          .filter((s: string) => s.trim());
        const questionOrIssue = sentences.find(
          (s: string) =>
            s.includes('?') || /\btodo\b|\bfix\b|\bissue\b/i.test(s),
        );
        if (questionOrIssue) {
          unresolved.push(questionOrIssue.trim().substring(0, 80));
        }
      }
    }

    return unresolved.slice(0, 2); // Limit to top 2 unresolved items
  }

  /**
   * Extract user preferences mentioned in conversation
   */
  private extractUserPreferences(messages: any[]): string[] {
    const preferences: string[] = [];

    for (const message of messages) {
      const content = message.content || '';

      // Look for preference indicators
      const prefPatterns = [
        /prefer/i,
        /like/i,
        /want/i,
        /need/i,
        /always/i,
        /never/i,
      ];

      for (const pattern of prefPatterns) {
        if (pattern.test(content)) {
          const sentences = content
            .split(/[.!?]+/)
            .filter((s: string) => s.trim());
          const prefSentence = sentences.find((s: string) => pattern.test(s));
          if (prefSentence) {
            preferences.push(prefSentence.trim().substring(0, 80));
          }
          break;
        }
      }
    }

    return preferences.slice(0, 2); // Limit to top 2 preferences
  }

  /**
   * Build a cohesive summary text from extracted information
   */
  private buildSummaryText(data: {
    topics: string[];
    decisions: string[];
    unresolved: string[];
    preferences: string[];
    messageCount: number;
  }): string {
    const parts: string[] = [];

    // Topics
    if (data.topics.length > 0) {
      parts.push(`**Topics discussed:** ${data.topics.join(', ')}`);
    }

    // Key decisions
    if (data.decisions.length > 0) {
      parts.push(`**Key decisions:** ${data.decisions.join('; ')}`);
    }

    // Unresolved items
    if (data.unresolved.length > 0) {
      parts.push(`**Open items:** ${data.unresolved.join('; ')}`);
    }

    // User preferences
    if (data.preferences.length > 0) {
      parts.push(`**Preferences:** ${data.preferences.join('; ')}`);
    }

    // Add message count
    parts.push(
      `**${data.messageCount} messages summarized for context preservation**`,
    );

    return parts.join('\n\n');
  }
}
