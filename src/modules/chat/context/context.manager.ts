/**
 * Context Manager
 * Main orchestrator for conversation context management
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConversationContext, CoreferenceResult } from './types/context.types';
import { EntityExtractor } from './entity-extractor';
import { MessageAnalyzer } from './message-analyzer';
import { CoreferenceResolver } from './coreference-resolver';

@Injectable()
export class ContextManager {
  private readonly logger = new Logger(ContextManager.name);
  private readonly contextCache = new Map<string, ConversationContext>();

  constructor(
    private readonly entityExtractor: EntityExtractor,
    private readonly messageAnalyzer: MessageAnalyzer,
    private readonly coreferenceResolver: CoreferenceResolver,
  ) {}

  /**
   * Build conversation context from message and history
   */
  buildContext(
    conversationId: string,
    userMessage: string,
    recentMessages: any[],
  ): ConversationContext {
    const existingContext = this.contextCache.get(conversationId);

    // Extract entities from current message and recent history
    const entities = this.entityExtractor.extractEntities(
      userMessage,
      recentMessages,
    );

    // Determine current subject, intent, and domain
    const { subject, intent, domain, confidence } =
      this.messageAnalyzer.analyzeMessage(userMessage, recentMessages);

    // Detect language/framework
    const languageFramework =
      this.messageAnalyzer.detectLanguageFramework(userMessage);

    const context: ConversationContext = {
      conversationId,
      currentSubject: subject || existingContext?.currentSubject,
      currentIntent: intent,
      lastReferencedEntities: [
        ...(existingContext?.lastReferencedEntities || []),
        ...entities,
      ].slice(-10), // Keep last 10
      lastToolUsed: existingContext?.lastToolUsed,
      lastDomain: domain || existingContext?.lastDomain,
      languageFramework:
        languageFramework || existingContext?.languageFramework,
      subjectConfidence: confidence,
      timestamp: new Date(),
    };

    // Cache the context
    this.contextCache.set(conversationId, context);

    this.logger.log('🔍 Built conversation context', {
      conversationId,
      subject: context.currentSubject,
      intent: context.currentIntent,
      domain: context.lastDomain,
      confidence: context.subjectConfidence,
      entitiesCount: context.lastReferencedEntities.length,
    });

    return context;
  }

  /**
   * Get cached context for a conversation
   */
  getContext(conversationId: string): ConversationContext | undefined {
    return this.contextCache.get(conversationId);
  }

  /**
   * Clear context cache for a conversation
   */
  clearContext(conversationId: string): void {
    this.contextCache.delete(conversationId);
    this.logger.log('Context cache cleared', { conversationId });
  }

  /**
   * Update last tool used in context
   */
  updateLastToolUsed(conversationId: string, toolName: string): void {
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
  async resolveCoreference(
    message: string,
    context: ConversationContext,
    recentMessages: any[],
  ): Promise<CoreferenceResult> {
    return this.coreferenceResolver.resolve(message, context, recentMessages);
  }
}
