/**
 * Multi-Agent Handler
 * Handles routing to multi-agent flow service
 */

import { Injectable, Logger } from '@nestjs/common';
import { HandlerRequest, HandlerResult } from './types/handler.types';
import { ConversationContext } from '../context';
import { MultiAgentFlowService } from '../services/multi-agent-flow.service';

@Injectable()
export class MultiAgentHandler {
  private readonly logger = new Logger(MultiAgentHandler.name);

  constructor(private readonly multiAgentFlowService: MultiAgentFlowService) {}

  /**
   * Handle multi-agent route
   */
  async handle(
    request: HandlerRequest,
    context: ConversationContext,
    contextPreamble: string,
    recentMessages: any[],
  ): Promise<HandlerResult> {
    this.logger.log('🤖 Routing to multi-agent', {
      subject: context.currentSubject,
      domain: context.lastDomain,
      recentMessagesCount: recentMessages.length,
    });

    try {
      // Build enhanced query with context and recent messages
      let enhancedQuery = `${contextPreamble}\n\n`;

      // Add recent conversation history if available
      if (recentMessages.length > 0) {
        enhancedQuery += 'Recent conversation:\n';
        recentMessages.forEach((msg, index) => {
          const role = msg.role === 'user' ? 'User' : 'Assistant';
          enhancedQuery += `${role}: ${msg.content}\n`;
        });
        enhancedQuery += '\n';
      }

      enhancedQuery += `User query: ${request.message}`;

      const result = await this.multiAgentFlowService.executeMultiAgentFlow({
        userId: request.userId,
        query: enhancedQuery,
        context: {
          conversationId: context.conversationId,
          costBudget: (request as any).costBudget ?? 0.1,
          chatMode: request.chatMode ?? 'balanced',
        },
      });

      if (result.response) {
        return {
          response: result.response,
          agentThinking: `Multi-agent coordination completed with ${result.agentPath.length} agents`,
          agentPath: result.agentPath,
          optimizationsApplied: result.optimizationsApplied,
          cacheHit: false,
          riskLevel: 'medium',
        };
      }

      // If no response, throw to trigger fallback
      throw new Error('Multi-agent returned no response');
    } catch (error) {
      this.logger.warn('Multi-agent routing failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      throw error; // Re-throw to allow caller to handle fallback
    }
  }
}
