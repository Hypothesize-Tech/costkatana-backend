/**
 * AI Router
 * AI-powered intelligent routing using aiQueryRouter service
 */

import { ConversationContext } from '../context';
import { RouteType, RouterContext } from './types/routing.types';
import { loggingService } from '@services/logging.service';

export class AIRouter {
    /**
     * Route using AI-powered decision making
     */
    static async route(
        context: ConversationContext,
        message: string,
        userId: string,
        useWebSearch?: boolean
    ): Promise<RouteType> {
        // If web search is explicitly enabled, force web scraper route
        if (useWebSearch === true) {
            loggingService.info('🌐 Web search explicitly enabled, routing to web scraper', {
                query: message.substring(0, 100)
            });
            return 'web_scraper';
        }

        try {
            // Import AI router dynamically to avoid circular dependencies
            const { aiQueryRouter } = await import('../../aiQueryRouter.service');
            const { VercelConnection } = await import('../../../models');
            const { GitHubConnection } = await import('../../../models/GitHubConnection');
            const { GoogleConnection } = await import('../../../models/GoogleConnection');

            // Check user's integration connections
            const [vercelConn, githubConn, googleConn] = await Promise.all([
                VercelConnection.findOne({ userId, isActive: true }).lean(),
                GitHubConnection.findOne({ userId, isActive: true }).lean(),
                GoogleConnection.findOne({ userId, isActive: true }).lean()
            ]);

            // Build router context
            const routerContext: RouterContext = {
                userId,
                hasVercelConnection: !!vercelConn,
                hasGithubConnection: !!githubConn,
                hasGoogleConnection: !!googleConn,
                conversationSubject: context.currentSubject
            };

            // Get AI routing decision
            const decision = await aiQueryRouter.routeQuery(message, routerContext);

            loggingService.info('🧠 AI Router decision', {
                route: decision.route,
                confidence: decision.confidence,
                reasoning: decision.reasoning,
                userId
            });

            // Map AI router routes to internal routes
            return this.mapRoute(decision.route);

        } catch (error: any) {
            loggingService.warn('AI Router failed', {
                error: error.message,
                message: message.substring(0, 100)
            });

            throw error; // Re-throw to trigger fallback
        }
    }

    /**
     * Map AI router routes to internal route types
     */
    private static mapRoute(aiRoute: string): RouteType {
        switch (aiRoute) {
            case 'vercel_tools':
            case 'github_tools':
            case 'google_tools':
            case 'multi_agent':
                // These go to conversational flow which uses the agent with appropriate tools
                return 'conversational_flow';
            
            case 'knowledge_base':
                return 'knowledge_base';
            
            case 'analytics':
            case 'optimization':
                return 'multi_agent';
            
            case 'web_search':
                return 'web_scraper';
            
            case 'direct_response':
            default:
                return 'conversational_flow';
        }
    }
}
