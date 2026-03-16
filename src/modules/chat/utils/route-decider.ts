import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../../common/logger/logger.service';
import { ConversationContext } from '../context';
import { AIRouter } from '../routing/ai.router';
import { LegacyRouter } from '../routing/legacy-router';
import type { RouteType } from '../routing/types/routing.types';

export type { RouteType };

export interface RouteDecision {
  route: RouteType;
  confidence: number;
  reasoning?: string;
  documentIds?: string[];
}

@Injectable()
export class RouteDecider {
  constructor(
    private readonly loggingService: LoggerService,
    private readonly aiRouter: AIRouter,
    private readonly legacyRouter: LegacyRouter,
  ) {}

  /**
   * Decide route using AI-powered routing with rule-based fallback
   */
  async decide(
    context: ConversationContext,
    message: string,
    userId: string, // Retaining userId
    useWebSearch?: boolean,
    documentIds?: string[],
  ): Promise<RouteType> {
    // Force knowledge_base route when documentIds are present
    if (documentIds && documentIds.length > 0) {
      this.loggingService.info('🎯 Route decision (Document-based)', {
        userId,
        route: 'knowledge_base',
        documentCount: documentIds.length,
        reasoning: 'Document IDs provided - forcing knowledge base route',
      });
      return 'knowledge_base';
    }

    try {
      // Try AI-powered routing first
      const route = await this.aiRouter.route(
        context,
        message,
        userId,
        useWebSearch,
      );

      this.loggingService.info('🎯 Route decision (AI)', {
        userId, // Now including userId in the log context
        route,
        subject: context.currentSubject,
        domain: context.lastDomain,
        intent: context.currentIntent,
      });

      return route;
    } catch (error) {
      // Fallback to rule-based routing
      this.loggingService.warn('Using rule-based routing fallback', {
        userId, // Now including userId in the error context
        error: error instanceof Error ? error.message : String(error),
      });

      const decision = await this.legacyRouter.decideRuleBased(
        context,
        message,
        useWebSearch,
      );

      this.loggingService.info('🎯 Route decision (Rule-based)', {
        userId, // Now including userId in the log context
        route: decision.route,
        confidence: decision.confidence,
        subject: context.currentSubject,
        domain: context.lastDomain,
        intent: context.currentIntent,
        reasoning: decision.reasoning,
      });

      return decision.route;
    }
  }

  /**
   * Get route explanation for debugging
   */
  getRouteExplanation(route: RouteType): string {
    return this.legacyRouter.getRouteExplanation(route);
  }

  /**
   * Check if route requires special permissions
   */
  requiresSpecialPermissions(route: RouteType): boolean {
    return this.legacyRouter.requiresSpecialPermissions(route);
  }

  /**
   * Get recommended model for route
   */
  getRecommendedModel(route: RouteType): string {
    return this.legacyRouter.getRecommendedModel(route);
  }
}
