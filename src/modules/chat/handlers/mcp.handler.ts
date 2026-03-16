/**
 * MCP Handler
 * Handles MCP (Microservice Control Plane) integration requests
 *
 * Implements the core MCP logic for handling integration requests through
 * the Microservice Control Plane system.
 */

import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { HandlerRequest, HandlerResult } from './types/handler.types';
import { ConversationContext } from '../context';
import type { ChatService } from '../services/chat.service';

@Injectable()
export class MCPHandler {
  private readonly logger = new Logger(MCPHandler.name);

  constructor(
    @Inject(forwardRef(() => require('../services/chat.service').ChatService))
    private readonly chatService: ChatService,
  ) {}

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
  async handle(
    request: HandlerRequest,
    context: ConversationContext,
    recentMessages: any[],
    contextPreamble?: string,
  ): Promise<HandlerResult> {
    try {
      this.logger.log('🔌 MCP handler processing request', {
        userId: request.userId,
        messageLength: request.message?.length || 0,
      });

      // Convert HandlerRequest to ChatSendMessageRequest format
      const chatRequest = {
        userId: request.userId,
        message: request.message,
        originalMessage: request.originalMessage,
        modelId: request.modelId,
        conversationId: context.conversationId,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        chatMode: request.chatMode,
        useMultiAgent: request.useMultiAgent,
        useWebSearch: request.useWebSearch,
        documentIds: request.documentIds,
        mongodbContext: request.mongodbContext,
        githubContext: request.githubContext,
        vercelContext: request.vercelContext,
        templateId: request.templateId,
        templateVariables: request.templateVariables,
        attachments: request.attachments,
        req: request.req,
        selectionResponse: request.selectionResponse,
      };

      // Delegate to the real MCP implementation in ChatService
      const mcpResult = await this.chatService.processMCPRoute(
        chatRequest,
        context,
        recentMessages,
        contextPreamble,
      );

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
        success: !mcpResult.requiresConnection && !mcpResult.requiresSelection,
      };

      this.logger.log('MCP handler completed successfully', {
        userId: request.userId,
        agentPath: mcpResult.agentPath,
        hasConnectionRequirement: !!mcpResult.requiresConnection,
        hasSelectionRequirement: !!mcpResult.requiresSelection,
      });

      return result;
    } catch (error) {
      this.logger.error('MCP handler failed', {
        userId: request.userId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return error result
      return {
        response:
          'Sorry, I encountered an error while processing your integration request. Please try again.',
        agentPath: ['mcp_error'],
        optimizationsApplied: [],
        cacheHit: false,
        riskLevel: 'low',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown MCP error',
      };
    }
  }
}
