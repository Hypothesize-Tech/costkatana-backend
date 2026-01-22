/**
 * Multi-Agent Handler
 * Handles routing to multi-agent flow service
 */

import { HandlerRequest, HandlerResult } from './types/handler.types';
import { ConversationContext } from '../context';
import { loggingService } from '@services/logging.service';

export class MultiAgentHandler {
    /**
     * Handle multi-agent route
     */
    static async handle(
        request: HandlerRequest,
        context: ConversationContext,
        contextPreamble: string,
        recentMessages: any[]
    ): Promise<HandlerResult> {
        
        loggingService.info('🤖 Routing to multi-agent', {
            subject: context.currentSubject,
            domain: context.lastDomain,
            recentMessagesCount: recentMessages.length
        });
        
        try {
            const { multiAgentFlowService } = await import('../../multiAgentFlow.service');
            
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
            
            const result = await multiAgentFlowService.processMessage(
                context.conversationId,
                request.userId,
                enhancedQuery,
                {
                    chatMode: 'balanced',
                    costBudget: 0.10
                }
            );

            if (result.response) {
                return {
                    response: result.response,
                    agentThinking: result.thinking as string,
                    agentPath: ['multi_agent'],
                    optimizationsApplied: ['context_enhancement', 'multi_agent_routing', 'conversation_history'],
                    cacheHit: false,
                    riskLevel: result.riskLevel || 'medium'
                };
            }
            
            // If no response, throw to trigger fallback
            throw new Error('Multi-agent returned no response');
            
        } catch (error) {
            loggingService.warn('Multi-agent routing failed', {
                error: error instanceof Error ? error.message : String(error)
            });
            
            throw error; // Re-throw to allow caller to handle fallback
        }
    }
}
