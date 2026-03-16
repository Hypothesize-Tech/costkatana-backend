/**
 * Conversational Flow Handler
 * Handles standard conversational chat flow
 */

import { Injectable, Logger } from '@nestjs/common';
import { HandlerRequest, HandlerResult } from './types/handler.types';
import { ConversationContext } from '../context/types/context.types';
import { ConversationalFlowService } from '../services/conversational-flow.service';

@Injectable()
export class ConversationalFlowHandler {
  private readonly logger = new Logger(ConversationalFlowHandler.name);

  constructor(
    private readonly conversationalFlowService: ConversationalFlowService,
  ) {}

  /**
   * Handle conversational flow route
   */
  async handle(
    request: HandlerRequest,
    context: ConversationContext,
    contextPreamble: string,
    recentMessages: any[],
  ): Promise<HandlerResult> {
    this.logger.log('💬 Routing to conversational flow', {
      subject: context.currentSubject,
      domain: context.lastDomain,
      recentMessagesCount: recentMessages.length,
    });

    try {
      const enhancedQuery = `${contextPreamble}\n\nUser query: ${request.message ?? ''}`;

      const result = await this.conversationalFlowService.processMessage(
        context.conversationId,
        request.userId,
        enhancedQuery,
        {
          previousMessages: recentMessages,
          selectedModel: request.modelId,
        },
      );

      if (result.response) {
        return {
          response: result.response,
          agentThinking: result.thinking as string,
          agentPath: ['conversational_flow'],
          optimizationsApplied: [
            'context_enhancement',
            'conversational_routing',
          ],
          cacheHit: false,
          riskLevel: 'low',
        };
      }

      // If no response, throw to trigger fallback
      throw new Error('Conversational flow returned no response');
    } catch (error) {
      this.logger.warn('Conversational flow failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      throw error; // Re-throw to allow caller to handle fallback
    }
  }
}
