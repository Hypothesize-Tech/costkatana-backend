/**
 * MCP Handler
 * Handles MCP (Microservice Control Plane) integration requests
 * 
 * Note: The full MCP handler logic remains in chat.service.ts as handleMCPRoute
 * This is a placeholder for future full extraction.
 */

import { HandlerRequest, HandlerResult } from './types/handler.types';
import { ConversationContext } from '../context';
import { loggingService } from '../../logging.service';
import { IntegrationDetector, ConnectionChecker } from '../routing';

export class MCPHandler {
    /**
     * Handle MCP route for integration requests
     * 
     * Note: This is currently a stub. The actual implementation is in chat.service.ts
     * as handleMCPRoute due to its complexity. Future iterations will complete this extraction.
     */
    static async handle(
        request: HandlerRequest,
        context: ConversationContext,
        recentMessages: any[]
    ): Promise<HandlerResult> {
        loggingService.info('🔌 MCP handler called (stub)', {
            userId: request.userId
        });
        
        // This is a stub - actual logic is in chat.service.ts handleMCPRoute
        throw new Error('MCP Handler not fully implemented - use handleMCPRoute in chat.service.ts');
    }
}
