/**
 * RouteDispatcher
 *
 * Owns the per-route fan-out previously hard-coded inside
 * `ChatService.routeMessage`. Each route mapping (request shape →
 * handler.handle()) lives here so future stages / executors can dispatch
 * without going through `ChatService` at all.
 *
 * Routes covered natively:
 *   - `knowledge_base`  → `KnowledgeBaseHandler`
 *   - `web_scraper`     → `WebScraperHandler`
 *   - `multi_agent`     → `MultiAgentFlowService`
 *   - `mcp`             → `MCPHandler`
 *
 * `conversational_flow` (and unrecognised routes) fall through to the
 * caller-supplied `conversationalFlowFallback` callback because that path
 * still has heavy logic (integration-mention detection, Bedrock direct,
 * agentService fallback) tightly coupled to private ChatService helpers.
 * Phase 2.9 will extract that path too.
 */
import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { KnowledgeBaseHandler } from '../../handlers/knowledge-base.handler';
import { WebScraperHandler } from '../../handlers/web-scraper.handler';
import { MCPHandler } from '../../handlers/mcp.handler';
import {
  ConversationalFlowExecutor,
  type IntegrationCommandHandler,
} from './conversational-flow-executor.service';
import type { ProcessingContext } from '../../handlers/types/handler.types';
import type { ConversationContext } from '../../context';
import type { ParsedMention } from '../../interceptors/chat-mentions.interceptor';

/**
 * Minimal contract for the multi-agent flow executor. We use a structural
 * type instead of importing `MultiAgentFlowService` directly because that
 * service's transitive imports (vercel.service → mcp-permission.service)
 * trip a pre-existing path-alias resolution bug under jest. A structural
 * type lets us keep RouteDispatcher tested in isolation while DI still
 * supplies the concrete `MultiAgentFlowService` at runtime via the
 * `MULTI_AGENT_FLOW_EXECUTOR` token.
 */
export interface MultiAgentFlowExecutor {
  executeMultiAgentFlow(input: {
    userId: string;
    query: string;
    context: Record<string, unknown>;
  }): Promise<{
    response?: string;
    agentPath?: string[];
    optimizationsApplied?: string[];
    [key: string]: unknown;
  }>;
}

export const MULTI_AGENT_FLOW_EXECUTOR = Symbol('MULTI_AGENT_FLOW_EXECUTOR');

export interface DispatchParams {
  userId: string;
  message: string;
  modelId: string;
  context: any;
  contextPreamble?: string;
  attachments?: any[];
  documentIds?: string[];
  attachmentContext?: string;
  conversationId: string;
  githubContext?: any;
  vercelContext?: any;
  mongodbContext?: any;
  userPreferences?: any;
  temperature?: number;
  maxTokens?: number;
  previousMessages?: Array<{ role: string; content: string }>;
  selectionResponse?: any;
  parsedMentions?: ParsedMention[];
  system?: string;
  useSystemPrompt?: boolean;
}

export interface DispatchResult {
  content: string;
  response?: string;
  agentPath?: string[];
  optimizationsApplied?: string[];
  cacheHit?: boolean;
  riskLevel?: string;
  agentThinking?: any;
  webSearchUsed?: boolean;
  aiWebSearchDecision?: string;
  quotaUsed?: number;
  requiresIntegrationSelector?: boolean;
  integrationSelectorData?: any;
  metadata?: { cost?: number; tokenCount?: number; latency?: number };
  // MCP integration data (passed through when route === 'mcp')
  mongodbIntegrationData?: any;
  formattedResult?: any;
  githubIntegrationData?: any;
  vercelIntegrationData?: any;
  slackIntegrationData?: any;
  discordIntegrationData?: any;
  jiraIntegrationData?: any;
  linearIntegrationData?: any;
  googleIntegrationData?: any;
  awsIntegrationData?: any;
  requiresConnection?: any;
  requiresSelection?: boolean;
  selection?: any;
}

export type ConversationalFlowFallback = (
  params: DispatchParams,
  startTime: number,
) => Promise<DispatchResult>;

/**
 * Optional callback invoked by `runMultiAgent` to extract the structured
 * `agentThinking` blob from the raw multi-agent result. This is private
 * helper logic on `ChatService` today; the callback keeps the dispatcher
 * decoupled from it.
 */
export type MultiAgentThinkingExtractor = (raw: unknown) => any;

@Injectable()
export class RouteDispatcher {
  private readonly logger = new Logger(RouteDispatcher.name);

  constructor(
    private readonly knowledgeBaseHandler: KnowledgeBaseHandler,
    private readonly webScraperHandler: WebScraperHandler,
    private readonly mcpHandler: MCPHandler,
    @Inject(MULTI_AGENT_FLOW_EXECUTOR)
    private readonly multiAgentFlowService: MultiAgentFlowExecutor,
    @Optional()
    private readonly conversationalFlowExecutor?: ConversationalFlowExecutor,
  ) {}

  async dispatch(
    route: string,
    params: DispatchParams,
    startTime: number,
    conversationalFlowFallback: ConversationalFlowFallback,
    multiAgentThinkingExtractor?: MultiAgentThinkingExtractor,
    integrationCommandHandler?: IntegrationCommandHandler,
  ): Promise<DispatchResult> {
    switch (route) {
      case 'knowledge_base':
        return this.runKnowledgeBase(params);

      case 'web_scraper':
        return this.runWebScraper(params);

      case 'multi_agent':
        return this.runMultiAgent(params, multiAgentThinkingExtractor);

      case 'mcp':
        return this.runMCP(params);

      case 'conversational_flow':
      default:
        // Prefer the dedicated executor (Phase 2.9). It needs a callback for
        // integration-command dispatch because that path still lives in
        // ChatService. If the executor isn't wired (e.g. unit-test harness),
        // fall back to the legacy callback.
        if (this.conversationalFlowExecutor && integrationCommandHandler) {
          return this.conversationalFlowExecutor.run(
            params,
            startTime,
            integrationCommandHandler,
          );
        }
        return conversationalFlowFallback(params, startTime);
    }
  }

  private async runKnowledgeBase(
    params: DispatchParams,
  ): Promise<DispatchResult> {
    const handlerRequest = {
      userId: params.userId,
      message: params.message,
      modelId: params.modelId,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      chatMode: params.userPreferences?.chatMode || 'balanced',
      useMultiAgent: false,
      useWebSearch: false,
      documentIds: params.documentIds,
      attachments: params.attachments,
      githubContext: params.githubContext,
      vercelContext: params.vercelContext,
      mongodbContext: params.mongodbContext,
      selectionResponse: params.selectionResponse,
    };
    const processingContext: ProcessingContext = {
      recentMessages: params.previousMessages || [],
      userId: params.userId,
      conversation: {
        _id: params.conversationId as any,
        userId: params.userId,
        title: '',
        modelId: params.modelId || '',
      } as any,
    };
    const result = await this.knowledgeBaseHandler.handle(
      handlerRequest,
      processingContext,
      params.contextPreamble,
    );
    return {
      content: result.response,
      agentPath: result.agentPath,
      optimizationsApplied: result.optimizationsApplied,
      cacheHit: result.cacheHit,
      riskLevel: result.riskLevel,
      agentThinking: result.agentThinking,
      metadata: result.metadata,
    };
  }

  private async runWebScraper(
    params: DispatchParams,
  ): Promise<DispatchResult> {
    const handlerRequest = {
      userId: params.userId,
      message: params.message,
      modelId: params.modelId,
      useWebSearch: true,
    };
    const conversationContext: ConversationContext = {
      conversationId: params.conversationId,
      currentSubject: params.context?.currentSubject,
      currentIntent: params.context?.currentIntent,
      languageFramework: params.context?.languageFramework,
      lastReferencedEntities: params.context?.lastReferencedEntities || [],
      timestamp: new Date(),
    };
    const result = await this.webScraperHandler.handle(
      handlerRequest,
      conversationContext,
      params.contextPreamble || '',
      params.previousMessages || [],
    );
    return {
      content: result.response ?? '',
      agentPath: result.agentPath,
      optimizationsApplied: result.optimizationsApplied,
      cacheHit: result.cacheHit,
      riskLevel: result.riskLevel,
      agentThinking: result.agentThinking,
      webSearchUsed: result.webSearchUsed,
      aiWebSearchDecision: result.aiWebSearchDecision,
      quotaUsed: result.quotaUsed,
      metadata: result.metadata,
    };
  }

  private async runMultiAgent(
    params: DispatchParams,
    thinkingExtractor?: MultiAgentThinkingExtractor,
  ): Promise<DispatchResult> {
    const result = await this.multiAgentFlowService.executeMultiAgentFlow({
      userId: params.userId,
      query: params.message,
      context: {
        ...params.context,
        preamble: params.contextPreamble,
        githubContext: params.githubContext,
        userPreferences: params.userPreferences,
        selectedModel: params.modelId,
      },
    });
    return {
      content: result.response || 'Multi-agent processing completed',
      agentPath: result.agentPath,
      optimizationsApplied: result.optimizationsApplied,
      agentThinking: thinkingExtractor
        ? thinkingExtractor(result)
        : undefined,
      riskLevel: 'medium',
    };
  }

  private async runMCP(params: DispatchParams): Promise<DispatchResult> {
    const handlerRequest = {
      userId: params.userId,
      message: params.message,
      modelId: params.modelId,
      githubContext: params.githubContext,
      vercelContext: params.vercelContext,
      mongodbContext: params.mongodbContext,
      selectionResponse: params.selectionResponse,
    };
    const conversationContext: ConversationContext = {
      ...params.context,
      conversationId: params.conversationId,
      currentSubject: params.context?.currentSubject,
      currentIntent: params.context?.currentIntent,
      languageFramework: params.context?.languageFramework,
      lastReferencedEntities: params.context?.lastReferencedEntities || [],
      timestamp: new Date(),
    };
    const result = await this.mcpHandler.handle(
      handlerRequest,
      conversationContext,
      params.previousMessages || [],
      params.contextPreamble,
    );
    return {
      content: result.response ?? '',
      agentPath: result.agentPath,
      optimizationsApplied: result.optimizationsApplied,
      cacheHit: result.cacheHit,
      riskLevel: result.riskLevel,
      agentThinking: result.agentThinking,
      mongodbIntegrationData: result.mongodbIntegrationData,
      formattedResult: result.formattedResult,
      githubIntegrationData: result.githubIntegrationData,
      vercelIntegrationData: result.vercelIntegrationData,
      slackIntegrationData: result.slackIntegrationData,
      discordIntegrationData: result.discordIntegrationData,
      jiraIntegrationData: result.jiraIntegrationData,
      linearIntegrationData: result.linearIntegrationData,
      googleIntegrationData: result.googleIntegrationData,
      awsIntegrationData: result.awsIntegrationData,
      requiresConnection: result.requiresConnection,
      requiresSelection: result.requiresSelection,
      selection: result.selection,
    };
  }
}
