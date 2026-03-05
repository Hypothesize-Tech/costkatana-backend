/**
 * MCP Handler
 * Handles MCP (Microservice Control Plane) integration requests
 *
 * Implements the core MCP logic for handling integration requests through
 * the Microservice Control Plane system.
 */

import { HandlerRequest, HandlerResult } from './types/handler.types';
import { ConversationContext } from '../context';
import { loggingService } from '../../logging.service';
import { ChatService, ChatSendMessageRequest } from '../../chat.service';

export class MCPHandler {
    /**
     * Handle MCP route for integration requests
     *
     * Processes integration commands through the MCP system, including:
     * - Integration intent detection
     * - Connection validation
     * - Tool discovery and execution
     * - Parameter collection for missing inputs
     * - Result formatting
     */
    static async handle(
        request: HandlerRequest,
        context: ConversationContext,
        recentMessages: any[]
    ): Promise<HandlerResult> {
        try {
            loggingService.info('🔌 MCP handler processing request', {
                userId: request.userId,
                messageLength: request.message?.length || 0
            });

            // Convert HandlerRequest to ChatSendMessageRequest format
            const chatRequest: ChatSendMessageRequest = {
                userId: request.userId,
                modelId: request.modelId,
                message: request.message,
                conversationId: context.conversationId,
                mongodbContext: request.mongodbContext,
                githubContext: request.githubContext,
                vercelContext: request.vercelContext,
                // Add other fields as needed
            };

            // Delegate to the real MCP implementation in ChatService
            const mcpResult = await ChatService.processMCPRoute(chatRequest, context, recentMessages);

            // Convert the result to HandlerResult format
            const result: HandlerResult = {
                response: mcpResult.response,
                agentPath: mcpResult.agentPath,
                optimizationsApplied: mcpResult.optimizationsApplied,
                cacheHit: mcpResult.cacheHit,
                riskLevel: mcpResult.riskLevel,
                mongodbIntegrationData: mcpResult.mongodbIntegrationData,
                formattedResult: mcpResult.formattedResult,
                githubIntegrationData: mcpResult.githubIntegrationData,
                vercelIntegrationData: mcpResult.vercelIntegrationData,
                slackIntegrationData: mcpResult.slackIntegrationData,
                discordIntegrationData: mcpResult.discordIntegrationData,
                jiraIntegrationData: mcpResult.jiraIntegrationData,
                linearIntegrationData: mcpResult.linearIntegrationData,
                googleIntegrationData: mcpResult.googleIntegrationData,
                awsIntegrationData: mcpResult.awsIntegrationData,
                requiresConnection: mcpResult.requiresConnection,
                requiresSelection: mcpResult.requiresSelection,
                selection: mcpResult.selection,
                // Add success indicator
                success: !mcpResult.requiresConnection && !mcpResult.requiresSelection
            };

            loggingService.info('MCP handler completed successfully', {
                userId: request.userId,
                agentPath: mcpResult.agentPath,
                hasConnectionRequirement: !!mcpResult.requiresConnection,
                hasSelectionRequirement: !!mcpResult.requiresSelection
            });

            return result;

        } catch (error) {
            loggingService.error('MCP handler failed', {
                userId: request.userId,
                error: error instanceof Error ? error.message : String(error)
            });

            // Return error result
            return {
                response: 'Sorry, I encountered an error while processing your integration request. Please try again.',
                agentPath: ['mcp_error'],
                optimizationsApplied: [],
                cacheHit: false,
                riskLevel: 'low',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown MCP error'
            };
        }
    }
}
