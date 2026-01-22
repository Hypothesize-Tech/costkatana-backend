/**
 * Legacy Router
 * Regex-based routing fallback when AI router fails
 */

import { ConversationContext } from '../context';
import { RouteType } from './types/routing.types';

export class LegacyRouter {
    /**
     * Decide route using regex patterns
     */
    static route(
        context: ConversationContext,
        message: string,
        useWebSearch?: boolean
    ): RouteType {
        const lowerMessage = message.toLowerCase();
        
        // If web search is explicitly enabled, force web scraper route
        if (useWebSearch === true) {
            return 'web_scraper';
        }
        
        // Integration commands should go to conversational flow
        if (message.includes('@vercel') || message.includes('@github') || message.includes('@google')) {
            return 'conversational_flow';
        }
        
        // High confidence CostKatana queries go to knowledge base
        if (context.lastDomain === 'costkatana' && context.subjectConfidence > 0.7) {
            return 'knowledge_base';
        }
        
        // CostKatana specific queries
        const costKatanaTerms = ['costkatana', 'cost katana', 'cortex', 'documentation', 'guide'];
        if (costKatanaTerms.some(term => lowerMessage.includes(term))) {
            return 'knowledge_base';
        }
        
        // Web scraping for external content
        if ((lowerMessage.includes('latest') || lowerMessage.includes('news')) &&
            (lowerMessage.includes('search') || lowerMessage.includes('find'))) {
            return 'web_scraper';
        }
        
        // Analytics queries about user's own data
        if (lowerMessage.includes('my cost') || lowerMessage.includes('my usage')) {
            return 'multi_agent';
        }
        
        // Default to conversational flow
        return 'conversational_flow';
    }
}
