/**
 * ConversationalFlowExecutor
 *
 * Owns the legacy `ChatService.handleConversationalFlow` body — the default
 * route taken when a chat request isn't routed to KB / web-scraper / MCP /
 * multi-agent. This is the trickiest of the five route handlers because it
 * carries three responsibilities chained together:
 *
 *   1. Integration mention detection (parses `@github` / `@mongodb` / etc.).
 *      If a mention is found, hand off to the integration-command handler
 *      (still owned by ChatService — passed in here as a callback).
 *   2. Direct Bedrock invocation (the fast happy path with the user's
 *      account data injected into the system prompt).
 *   3. Fallback to `AgentService.executeWithRouting` if Bedrock returns
 *      empty or throws.
 *
 * Helpers `detectMentions`, `getUserStats`, and `buildConversationalPrompt`
 * move with this executor. `handleIntegrationCommands` stays in ChatService
 * (it's ~120 lines with three injected services) and is invoked via the
 * `integrationCommandHandler` callback.
 *
 * Behaviour mirrors the legacy method exactly — no semantic changes; this
 * is a pure decomposition.
 */
import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Usage, UsageDocument } from '../../../../schemas/core/usage.schema';
import { BedrockService } from '../../../bedrock/bedrock.service';
import type { DispatchParams, DispatchResult } from './route-dispatcher.service';
import type { ParsedMention } from '../../interceptors/chat-mentions.interceptor';

/**
 * Structural contract for `AgentService.executeWithRouting`. Used in place of
 * a direct import to avoid pulling the agent service's transitive deps
 * (mcp-permission.service) into jest test isolation. DI binds the real
 * `AgentService` to this token at module-init time.
 */
export interface AgentRoutingExecutor {
  executeWithRouting(
    input: {
      userId: string;
      query: string;
      context: Record<string, unknown>;
    },
    intent: string,
    contextBag?: unknown,
  ): Promise<{
    response?: string;
    metadata?: { tokensUsed?: number; [key: string]: unknown };
    [key: string]: unknown;
  }>;
}

export const AGENT_ROUTING_EXECUTOR = Symbol('AGENT_ROUTING_EXECUTOR');

/** Integrations the mention parser will surface. Mirrors ChatService.KNOWN_INTEGRATIONS. */
const KNOWN_INTEGRATIONS = new Set([
  'jira',
  'linear',
  'slack',
  'discord',
  'github',
  'vercel',
  'mongodb',
  'aws',
  'google',
  'gmail',
  'drive',
  'sheets',
  'calendar',
  'webhook',
]);

/**
 * Callback for the integration-command path. The legacy implementation lives
 * in `ChatService.handleIntegrationCommands` and threads through 3 services
 * we don't want to drag into this executor. The executor calls back when
 * mentions are detected.
 */
export type IntegrationCommandHandler = (
  userId: string,
  message: string,
  mentions: ParsedMention[],
  githubContext?: any,
  userPreferences?: any,
  contextPreamble?: string,
) => Promise<DispatchResult>;

@Injectable()
export class ConversationalFlowExecutor {
  private readonly logger = new Logger(ConversationalFlowExecutor.name);

  constructor(
    @InjectModel(Usage.name)
    private readonly usageModel: Model<UsageDocument>,
    @Inject(AGENT_ROUTING_EXECUTOR)
    private readonly agentService: AgentRoutingExecutor,
  ) {}

  async run(
    params: DispatchParams,
    startTime: number,
    integrationCommandHandler: IntegrationCommandHandler,
  ): Promise<DispatchResult> {
    // 1. Integration mentions — hand off to ChatService's integration handler.
    const mentions =
      params.parsedMentions ??
      (await this.detectMentions(params.message));
    if (mentions.length > 0) {
      return integrationCommandHandler(
        params.userId,
        params.message,
        mentions,
        params.githubContext,
        params.userPreferences,
        params.contextPreamble,
      );
    }

    // 2. Direct Bedrock — happy path with real user-stats injected.
    const selectedModel = params.modelId;
    if (selectedModel && selectedModel.trim()) {
      try {
        const responseText = await this.tryBedrock(params, selectedModel);
        if (responseText) {
          this.logger.log('Conversational response from direct Bedrock', {
            model: selectedModel,
            promptLength: params.message.length,
            responseLength: responseText.length,
          });
          return {
            content: responseText,
            agentPath: ['conversational_flow', 'direct_bedrock'],
            optimizationsApplied: ['direct_bedrock'],
            riskLevel: 'low',
            metadata: {
              latency: Date.now() - startTime,
              tokenCount: Math.ceil(responseText.length / 4),
            },
          };
        }
      } catch (err) {
        this.logger.warn('Direct Bedrock failed, falling back to agent', {
          model: selectedModel,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 3. Agent fallback — `AgentService.executeWithRouting` always returns a
    //    response, so this branch is the conservative default.
    const result = await this.agentService.executeWithRouting(
      {
        userId: params.userId,
        query: params.message,
        context: {
          ...params.context,
          preamble: params.contextPreamble,
          previousMessages: params.previousMessages ?? [],
          githubContext: params.githubContext,
          userPreferences: params.userPreferences,
          selectedModel: params.modelId,
          temperature: params.temperature,
          maxTokens: params.maxTokens,
        },
      },
      'conversational_flow',
      params.context,
    );

    const responseContent =
      result.response ??
      `I understand you said: "${params.message}". How can I help you with that?`;

    return {
      content: responseContent,
      response: responseContent,
      agentPath: ['conversational_flow'],
      optimizationsApplied: ['agent_service'],
      riskLevel: 'low',
      // `thinking` is propagated when the agent returns it.
      ...((result as { thinking?: any }).thinking !== undefined
        ? { agentThinking: (result as { thinking?: any }).thinking }
        : {}),
      metadata: {
        ...(result.metadata
          ? { cost: undefined, tokenCount: result.metadata.tokensUsed }
          : {}),
        latency: Date.now() - startTime,
      },
    };
  }

  // === Helpers (lifted from ChatService) ===

  private async tryBedrock(
    params: DispatchParams,
    model: string,
  ): Promise<string | null> {
    const previousMessages = params.previousMessages ?? [];
    const userStats = await this.getUserStats(params.userId);
    const prompt = this.buildConversationalPrompt(
      params.message,
      previousMessages,
      userStats,
    );
    const result = await BedrockService.invokeModel(prompt, model, {
      recentMessages: previousMessages,
      useSystemPrompt: params.useSystemPrompt ?? true,
      system: params.system,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
    });
    const responseText = typeof result === 'string' ? result : '';
    return responseText?.trim() || null;
  }

  /**
   * Parse @-mentions from the message. Same regex as the legacy
   * `ChatService.detectMentions` — supports both
   *   `@integration:entityType:entityId:subEntity:subEntityId`  (complex)
   *   `@integration` (simple)
   */
  private async detectMentions(message: string): Promise<ParsedMention[]> {
    const mentions: ParsedMention[] = [];

    const complexMentionRegex =
      /@([a-z]+)(?::([a-z]+(?:-[a-z]+)*)(?::([a-zA-Z0-9_-]+))?(?::([a-z]+):([a-zA-Z0-9_-]+))?)?/g;
    const simpleMentionRegex = /@([a-z]+)(?![:\w])/g;

    let match: RegExpExecArray | null;

    while ((match = complexMentionRegex.exec(message)) !== null) {
      const [, integration, entityType, entityId, subEntityType, subEntityId] =
        match;
      if (KNOWN_INTEGRATIONS.has(integration.toLowerCase())) {
        mentions.push({
          integration,
          entityType,
          entityId,
          subEntityType,
          subEntityId,
          originalMention: match[0],
        } as any);
      }
    }

    // Fall through to simple regex if no complex matches were found.
    if (mentions.length === 0) {
      while ((match = simpleMentionRegex.exec(message)) !== null) {
        const [, integration] = match;
        if (KNOWN_INTEGRATIONS.has(integration.toLowerCase())) {
          mentions.push({
            integration,
            originalMention: match[0],
          } as any);
        }
      }
    }

    return mentions;
  }

  /**
   * Build a system-prompt-ready string of the user's last-30-day usage stats.
   * Embedded in `buildConversationalPrompt` so the model can answer
   * "how much have I spent" without fetching anything else.
   *
   * Returns a short summary on aggregation failure (never throws — the
   * conversational flow must always proceed).
   */
  private async getUserStats(userId: string): Promise<string> {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const aggResult = await this.usageModel.aggregate([
        {
          $match: {
            userId: new Types.ObjectId(userId),
            createdAt: { $gte: thirtyDaysAgo },
          },
        },
        {
          $group: {
            _id: null,
            totalCost: { $sum: '$cost' },
            totalRequests: { $sum: 1 },
            totalTokens: {
              $sum: { $add: ['$promptTokens', '$completionTokens'] },
            },
            uniqueModels: { $addToSet: '$model' },
            uniqueProviders: { $addToSet: '$provider' },
          },
        },
      ]);
      if (aggResult.length === 0) return 'No usage data available yet.';
      const stats = aggResult[0];
      return [
        `Total cost (30d): $${(stats.totalCost ?? 0).toFixed(4)}`,
        `Requests: ${stats.totalRequests}`,
        `Tokens: ${stats.totalTokens}`,
        `Models used: ${(stats.uniqueModels ?? []).join(', ')}`,
        `Providers: ${(stats.uniqueProviders ?? []).join(', ')}`,
      ].join('\n');
    } catch (err) {
      this.logger.warn('Failed to fetch user stats; continuing without them', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
      return 'No usage data available yet.';
    }
  }

  /**
   * Build the system + user prompt sent to Bedrock. Mirrors the legacy
   * `ChatService.buildConversationalPrompt` exactly.
   */
  private buildConversationalPrompt(
    query: string,
    previousMessages: Array<{ role: string; content: string }>,
    userStats?: string,
  ): string {
    const roleDirectives = [
      'You are Cost Katana, an AI-powered cost optimization assistant.',
      'Your mission is to help users monitor, analyze, and reduce their AI API spending across all providers.',
      "You have access to this user's actual Cost Katana account data in <costkatana_user_account_data> below.",
      'Always answer questions about their usage, costs, and models using that data',
      '— never say you lack access to their records.',
    ].join('\n');
    const accountData = userStats ?? 'No usage data available yet.';
    const recent = (previousMessages ?? []).slice(-6);
    const historyInner = recent
      .map(
        (m) =>
          `${m.role === 'user' ? 'Human' : 'Assistant'}: ${(m.content || '').trim()}`,
      )
      .join('\n\n');
    const parts: string[] = [
      '<costkatana_assistant_directives>',
      roleDirectives,
      '</costkatana_assistant_directives>',
      '',
      '<costkatana_user_account_data>',
      accountData,
      '</costkatana_user_account_data>',
    ];
    if (historyInner.trim().length > 0) {
      parts.push('', '<recent_conversation>', historyInner, '</recent_conversation>');
    }
    parts.push('', `Human: ${query}`, 'Assistant:');
    return parts.join('\n');
  }
}
