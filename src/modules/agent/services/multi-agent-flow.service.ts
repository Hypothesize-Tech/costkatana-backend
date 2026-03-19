/**
 * Agent Multi-Agent Flow Service
 *
 * Facade that delegates to the full 15-node LangGraph implementation in
 * modules/chat/services/multi-agent-flow.service.ts. That implementation includes:
 * memory_reader, memory_writer, prompt_analyzer, trending_detector, web_scraper,
 * content_summarizer, semantic_cache, grounding_gate, clarification_needed,
 * refuse_safely, master_agent, cost_optimizer, quality_analyst, failure_recovery.
 *
 * This service provides the executeWorkflow API for agent module consumers.
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { BaseMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import {
  MultiAgentFlowService as ChatMultiAgentFlowService,
  MultiAgentQuery,
} from '../../chat/services/multi-agent-flow.service';

@Injectable()
export class AgentMultiAgentFlowService {
  constructor(
    @Inject(forwardRef(() => ChatMultiAgentFlowService))
    private readonly chatMultiAgentFlow: ChatMultiAgentFlowService,
  ) {}

  /**
   * Execute multi-agent workflow by delegating to the full 15-node chat implementation.
   */
  async executeWorkflow(
    initialMessages: BaseMessage[],
    userId: string,
    conversationId: string,
    config: {
      chatMode?: 'fastest' | 'cheapest' | 'balanced';
      costBudget?: number;
      taskType?: string;
    } = {},
  ): Promise<{
    messages: BaseMessage[];
    agentPath: string[];
    optimizationsApplied: string[];
    totalCost: number;
    metadata: Record<string, unknown>;
  }> {
    const query = this.extractQueryFromMessages(initialMessages);

    const multiAgentQuery: MultiAgentQuery = {
      userId,
      query,
      context: {
        conversationId,
        costBudget: config.costBudget ?? 0.1,
        chatMode: config.chatMode ?? 'balanced',
      },
    };

    const result =
      await this.chatMultiAgentFlow.executeMultiAgentFlow(multiAgentQuery);

    const messages: BaseMessage[] = result.response
      ? [...initialMessages, new AIMessage(result.response)]
      : initialMessages;

    return {
      messages,
      agentPath: result.agentPath ?? [],
      optimizationsApplied: result.optimizationsApplied ?? [],
      totalCost: 0, // Chat implementation does not return totalCost; could be derived from metadata
      metadata: {
        ...result.metadata,
        executionTime: result.executionTime,
        success: result.success,
      },
    };
  }

  private extractQueryFromMessages(messages: BaseMessage[]): string {
    if (!messages.length) return '';
    const last = messages[messages.length - 1];
    if (last instanceof HumanMessage) {
      const content = last.content;
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return content.map((c) => (typeof c === 'string' ? c : '')).join('');
      }
    }
    return '';
  }
}
