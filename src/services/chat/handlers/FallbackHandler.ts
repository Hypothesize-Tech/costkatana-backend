/**
 * Fallback Handler
 * Handles circuit breaker fallback and direct Bedrock responses
 */

import { BedrockService } from '@services/tracedBedrock.service';
import { HandlerRequest, FallbackResult } from './types/handler.types';
import { loggingService } from '@services/logging.service';

export class FallbackHandler {
    // Circuit breaker state
    private static errorCounts: Map<string, number> = new Map();
    private static readonly MAX_ERRORS = 3;
    private static readonly ERROR_RESET_TIME = 5 * 60 * 1000; // 5 minutes

    /**
     * Handle circuit breaker fallback
     */
    static async handleWithCircuitBreaker(
        request: HandlerRequest,
        recentMessages: any[],
        processFn: () => Promise<any>
    ): Promise<any> {
        const userId = request.userId;
        const errorKey = `${userId}-processing`;
        
        // Check circuit breaker
        if ((this.errorCounts.get(errorKey) || 0) >= this.MAX_ERRORS) {
            loggingService.warn('Circuit breaker open for user, using direct Bedrock', { userId });
            return this.directBedrock(request, recentMessages);
        }
        
        try {
            // Try enhanced processing
            const result = await processFn();
            return result;
        } catch (error) {
            // Increment error count
            this.errorCounts.set(errorKey, (this.errorCounts.get(errorKey) || 0) + 1);
            
            // Reset error count after timeout
            setTimeout(() => {
                this.errorCounts.delete(errorKey);
            }, this.ERROR_RESET_TIME);
            
            loggingService.warn('Enhanced processing failed, using Bedrock fallback', { 
                userId, 
                error: error instanceof Error ? error.message : String(error)
            });
            
            return this.directBedrock(request, recentMessages);
        }
    }

    /**
     * Direct Bedrock fallback
     */
    static async directBedrock(
        request: HandlerRequest,
        recentMessages: any[]
    ): Promise<FallbackResult> {
        
        // Build contextual prompt
        const contextualPrompt = this.buildContextualPrompt(recentMessages, request.message || '');
        
        // Enhanced: Pass context to BedrockService for ChatGPT-style conversation
        const response = await BedrockService.invokeModel(
            contextualPrompt,
            request.modelId,
            {
                recentMessages: recentMessages,
                useSystemPrompt: true
            }
        );
        
        // Track optimizations based on context usage
        const optimizations = ['circuit_breaker'];
        if (recentMessages && recentMessages.length > 0) {
            optimizations.push('multi_turn_context');
            optimizations.push('system_prompt');
        }
        
        return {
            response,
            agentPath: ['bedrock_direct'],
            optimizationsApplied: optimizations,
            cacheHit: false,
            riskLevel: 'low'
        };
    }

    /**
     * Build contextual prompt from recent messages
     */
    private static buildContextualPrompt(messages: any[], newMessage: string): string {
        if (!messages || messages.length === 0) {
            return newMessage;
        }
        
        // Take last 5 messages for context
        const recentContext = messages
            .slice(-5)
            .map(m => `${m.role}: ${m.content}`)
            .join('\n');
        
        return `${recentContext}\nuser: ${newMessage}`;
    }
}
