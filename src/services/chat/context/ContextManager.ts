/**
 * Context Manager
 * Main orchestrator for conversation context management
 */

import { ConversationContext, CoreferenceResult } from './types/context.types';
import { EntityExtractor } from './EntityExtractor';
import { MessageAnalyzer } from './MessageAnalyzer';
import { CoreferenceResolver } from './CoreferenceResolver';
import { loggingService } from '@services/logging.service';

export class ContextManager {
    private static contextCache = new Map<string, ConversationContext>();

    /**
     * Build conversation context from message and history
     */
    static buildContext(
        conversationId: string,
        userMessage: string,
        recentMessages: any[]
    ): ConversationContext {
        const existingContext = this.contextCache.get(conversationId);
        
        // Extract entities from current message and recent history
        const entities = EntityExtractor.extractEntities(userMessage, recentMessages);
        
        // Determine current subject, intent, and domain
        const { subject, intent, domain, confidence } = MessageAnalyzer.analyzeMessage(userMessage, recentMessages);
        
        // Detect language/framework
        const languageFramework = MessageAnalyzer.detectLanguageFramework(userMessage);
        
        const context: ConversationContext = {
            conversationId,
            currentSubject: subject || existingContext?.currentSubject,
            currentIntent: intent,
            lastReferencedEntities: [...(existingContext?.lastReferencedEntities || []), ...entities].slice(-10), // Keep last 10
            lastToolUsed: existingContext?.lastToolUsed,
            lastDomain: domain || existingContext?.lastDomain,
            languageFramework: languageFramework || existingContext?.languageFramework,
            subjectConfidence: confidence,
            timestamp: new Date()
        };

        // Cache the context
        this.contextCache.set(conversationId, context);
        
        loggingService.info('🔍 Built conversation context', {
            conversationId,
            subject: context.currentSubject,
            intent: context.currentIntent,
            domain: context.lastDomain,
            confidence: context.subjectConfidence,
            entitiesCount: context.lastReferencedEntities.length
        });

        return context;
    }

    /**
     * Get cached context for a conversation
     */
    static getContext(conversationId: string): ConversationContext | undefined {
        return this.contextCache.get(conversationId);
    }

    /**
     * Clear context cache for a conversation
     */
    static clearContext(conversationId: string): void {
        this.contextCache.delete(conversationId);
        loggingService.info('Context cache cleared', { conversationId });
    }

    /**
     * Update last tool used in context
     */
    static updateLastToolUsed(conversationId: string, toolName: string): void {
        const context = this.contextCache.get(conversationId);
        if (context) {
            context.lastToolUsed = toolName;
            context.timestamp = new Date();
            this.contextCache.set(conversationId, context);
        }
    }

    /**
     * Resolve coreferences in message
     */
    static async resolveCoreference(
        message: string,
        context: ConversationContext,
        recentMessages: any[]
    ): Promise<CoreferenceResult> {
        return await CoreferenceResolver.resolve(message, context, recentMessages);
    }
}
