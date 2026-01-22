/**
 * Coreference Resolver
 * Resolves references like "it", "this", "that" to actual subjects
 */

import { ConversationContext, CoreferenceResult } from './types/context.types';
import { BedrockService } from '@services/tracedBedrock.service';
import { loggingService } from '@services/logging.service';

export class CoreferenceResolver {
    /**
     * Resolve coreferences in message using context
     */
    static async resolve(
        message: string,
        context: ConversationContext,
        recentMessages: any[]
    ): Promise<CoreferenceResult> {
        const lowerMessage = message.toLowerCase();
        
        // Try rule-based resolution first
        const ruleBasedResult = this.ruleBasedResolution(lowerMessage, context);
        if (ruleBasedResult.resolved) {
            return ruleBasedResult;
        }

        // Fallback to LLM for ambiguous cases
        return await this.llmFallbackResolution(message, context, recentMessages);
    }

    /**
     * Rule-based coreference resolution
     */
    private static ruleBasedResolution(
        lowerMessage: string,
        context: ConversationContext
    ): CoreferenceResult {
        const corefPatterns = [
            { pattern: /this\s+(package|tool|service|model)/g, weight: 0.9 },
            { pattern: /that\s+(package|tool|service|model)/g, weight: 0.8 },
            { pattern: /the\s+(package|tool|service|model)/g, weight: 0.7 },
            { pattern: /\bit\b/g, weight: 0.6 }
        ];
        
        for (const { pattern, weight } of corefPatterns) {
            if (pattern.test(lowerMessage)) {
                if (context.currentSubject) {
                    return {
                        resolved: true,
                        subject: context.currentSubject,
                        confidence: weight * context.subjectConfidence,
                        method: 'rule-based'
                    };
                }
            }
        }

        return {
            resolved: false,
            confidence: 0,
            method: 'rule-based'
        };
    }

    /**
     * LLM-based fallback for complex coreference resolution
     */
    private static async llmFallbackResolution(
        message: string,
        context: ConversationContext,
        recentMessages: any[]
    ): Promise<CoreferenceResult> {
        try {
            const recentContext = recentMessages
                .slice(-3)
                .map(m => `${m.role}: ${m.content}`)
                .join('\n');

            // Include current context information in the prompt
            const contextInfo = context.currentSubject 
                ? `Current subject in context: ${context.currentSubject} (confidence: ${context.subjectConfidence})`
                : 'No current subject in context';

            const prompt = `Given this conversation context:
${recentContext}

${contextInfo}

Current message: "${message}"

What is the subject being referred to by pronouns like "it", "this", or "that"? 
Consider the current subject in context when making your determination.
Respond with ONLY the subject name or "UNKNOWN" if unclear.`;

            const response = await BedrockService.invokeModel(
                prompt,
                'global.anthropic.claude-haiku-4-5-20251001-v1:0',
                { recentMessages: [{ role: 'user', content: prompt }] }
            );

            const subject = response.trim();
            
            if (subject === 'UNKNOWN' || !subject) {
                return {
                    resolved: false,
                    confidence: 0.3,
                    method: 'llm-fallback'
                };
            }

            return {
                resolved: true,
                subject: subject.toLowerCase(),
                confidence: 0.7,
                method: 'llm-fallback'
            };
        } catch (error) {
            loggingService.error('LLM coreference resolution failed', {
                error: error instanceof Error ? error.message : String(error)
            });
            
            return {
                resolved: false,
                confidence: 0,
                method: 'llm-fallback'
            };
        }
    }
}
