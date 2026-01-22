/**
 * Conversational Flow Handler
 * Handles standard conversational chat flow
 */

import { HandlerRequest, HandlerResult } from './types/handler.types';
import { ConversationContext } from '../context';
import { loggingService } from '@services/logging.service';

export class ConversationalFlowHandler {
    /**
     * Handle conversational flow route
     */
    static async handle(
        request: HandlerRequest,
        context: ConversationContext,
        contextPreamble: string,
        recentMessages: any[]
    ): Promise<HandlerResult> {
        
        loggingService.info('💬 Routing to conversational flow', {
            subject: context.currentSubject,
            domain: context.lastDomain,
            recentMessagesCount: recentMessages.length
        });
        
        try {
            const { conversationalFlowService } = await import('../../conversationFlow.service');
            
            const enhancedQuery = `${contextPreamble}\n\nUser query: ${request.message ?? ''}`;
            
            const result = await conversationalFlowService.processMessage(
                context.conversationId,
                request.userId,
                enhancedQuery,
                {
                    previousMessages: recentMessages,
                    selectedModel: request.modelId
                }
            );

            if (result.response) {
                return {
                    response: result.response,
                    agentThinking: result.thinking as string,
                    agentPath: ['conversational_flow'],
                    optimizationsApplied: ['context_enhancement', 'conversational_routing'],
                    cacheHit: false,
                    riskLevel: 'low'
                };
            }
            
            // If no response, throw to trigger fallback
            throw new Error('Conversational flow returned no response');
            
        } catch (error) {
            loggingService.warn('Conversational flow failed', {
                error: error instanceof Error ? error.message : String(error)
            });
            
            throw error; // Re-throw to allow caller to handle fallback
        }
    }
}
