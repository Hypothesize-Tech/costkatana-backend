/**
 * Route Decider
 * Main orchestrator for routing decisions
 */

import { ConversationContext } from '../context';
import { RouteType } from './types/routing.types';
import { AIRouter } from './AIRouter';
import { LegacyRouter } from './LegacyRouter';
import { loggingService } from '@services/logging.service';

export class RouteDecider {
    /**
     * Decide route using AI with fallback to legacy routing
     */
    static async decide(
        context: ConversationContext,
        message: string,
        userId: string,
        useWebSearch?: boolean
    ): Promise<RouteType> {
        try {
            // Try AI-powered routing first
            const route = await AIRouter.route(context, message, userId, useWebSearch);
            
            loggingService.info('🎯 Route decision (AI)', {
                route,
                subject: context.currentSubject,
                domain: context.lastDomain,
                confidence: context.subjectConfidence,
                intent: context.currentIntent
            });
            
            return route;
        } catch (error) {
            // Fallback to legacy routing
            loggingService.warn('Using legacy routing fallback', {
                error: error instanceof Error ? error.message : String(error)
            });
            
            const route = LegacyRouter.route(context, message, useWebSearch);
            
            loggingService.info('🎯 Route decision (Legacy)', {
                route,
                subject: context.currentSubject,
                domain: context.lastDomain,
                confidence: context.subjectConfidence,
                intent: context.currentIntent
            });
            
            return route;
        }
    }
}
