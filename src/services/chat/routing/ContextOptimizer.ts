/**
 * Context Optimizer
 * Optimizes conversation context size and builds context preambles
 */

import { Types } from 'mongoose';
import { ChatMessage } from '../../../models';
import { ConversationContext } from '../context';
import { ContextSizeConfig } from './types/routing.types';

export class ContextOptimizer {
    private static readonly CONTEXT_SIZE: ContextSizeConfig = {
        simple: 10,  // Simple messages can handle more context
        medium: 8,   // Medium messages
        complex: 5   // Complex messages need less context
    };

    /**
     * Get optimal context size based on message complexity
     */
    static getOptimalSize(messageLength: number): number {
        if (messageLength > 1000) return this.CONTEXT_SIZE.complex;
        if (messageLength > 500) return this.CONTEXT_SIZE.medium;
        return this.CONTEXT_SIZE.simple;
    }

    /**
     * Fetch recent messages with optimized context sizing
     */
    static async fetchOptimalContext(
        conversationId: string,
        messageLength: number
    ): Promise<any[]> {
        const contextSize = this.getOptimalSize(messageLength);
        
        return ChatMessage.find(
            { conversationId: new Types.ObjectId(conversationId) },
            { content: 1, role: 1, createdAt: 1, _id: 0 } // Project only needed fields
        )
        .sort({ createdAt: -1 })
        .limit(contextSize)
        .lean()
        .exec();
    }

    /**
     * Build context preamble for AI
     */
    static buildPreamble(context: ConversationContext, recentMessages: any[]): string {
        const preamble = [];
        
        if (context.currentSubject) {
            preamble.push(`Current subject: ${context.currentSubject}`);
        }
        
        if (context.currentIntent) {
            preamble.push(`Intent: ${context.currentIntent}`);
        }
        
        if (context.lastReferencedEntities.length > 0) {
            preamble.push(`Recent entities: ${context.lastReferencedEntities.slice(-3).join(', ')}`);
        }
        
        if (recentMessages.length > 0) {
            const recentContext = recentMessages.slice(-2).map(m => `${m.role}: ${m.content}`).join('\n');
            preamble.push(`\nRecent conversation:\n${recentContext}`);
        }
        
        return preamble.length > 0 ? preamble.join('\n') : '';
    }
}
