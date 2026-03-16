import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../../common/logger/logger.service';
import { ConversationContext } from '../context/types/context.types';
import type { RouteType } from './types/routing.types';

export type { RouteType };

export interface RouteDecision {
  route: RouteType;
  confidence: number;
  reasoning?: string;
  documentIds?: string[];
}

@Injectable()
export class LegacyRouter {
  constructor(private readonly loggingService: LoggerService) {}

  /**
   * Rule-based routing decision (legacy fallback)
   */
  async decideRuleBased(
    context: ConversationContext,
    message: string,
    useWebSearch?: boolean,
  ): Promise<RouteDecision> {
    const lowerMessage = message.toLowerCase();

    // If web search is explicitly enabled, force web scraper route
    if (useWebSearch === true) {
      return {
        route: 'web_scraper',
        confidence: 1.0,
        reasoning: 'Web search explicitly requested',
      };
    }

    // Integration commands should go to conversational flow
    if (
      message.includes('@vercel') ||
      message.includes('@github') ||
      message.includes('@google') ||
      message.includes('@jira') ||
      message.includes('@linear') ||
      message.includes('@slack') ||
      message.includes('@discord')
    ) {
      return {
        route: 'conversational_flow',
        confidence: 0.9,
        reasoning: 'Integration command detected',
      };
    }

    // High confidence CostKatana queries go to knowledge base
    if (
      context.lastDomain === 'costkatana' &&
      (context.subjectConfidence ?? 0) > 0.7
    ) {
      return {
        route: 'knowledge_base',
        confidence: 0.8,
        reasoning:
          'High confidence CostKatana domain with strong subject match',
      };
    }

    // CostKatana specific queries
    const costKatanaTerms = [
      'costkatana',
      'cost katana',
      'cortex',
      'documentation',
      'guide',
    ];
    if (costKatanaTerms.some((term) => lowerMessage.includes(term))) {
      return {
        route: 'knowledge_base',
        confidence: 0.7,
        reasoning: 'CostKatana-specific terminology detected',
      };
    }

    // Web scraping for external content
    if (
      (lowerMessage.includes('latest') || lowerMessage.includes('news')) &&
      (lowerMessage.includes('search') || lowerMessage.includes('find'))
    ) {
      return {
        route: 'web_scraper',
        confidence: 0.7,
        reasoning: 'Search for latest information or news',
      };
    }

    // Analytics / spending / cost queries: route to conversational_flow so the
    // actual LLM is invoked (like Express). Multi-agent workflows return static
    // templates and do not call the model.
    const isAnalyticsOrSpending =
      lowerMessage.includes('my cost') ||
      lowerMessage.includes('my usage') ||
      lowerMessage.includes('analytics') ||
      lowerMessage.includes('statistics') ||
      (lowerMessage.includes('money') &&
        (lowerMessage.includes('spent') ||
          lowerMessage.includes('spend') ||
          lowerMessage.includes('model'))) ||
      ((lowerMessage.includes('spent') || lowerMessage.includes('spending')) &&
        (lowerMessage.includes('model') ||
          lowerMessage.includes('money') ||
          lowerMessage.includes('cost'))) ||
      (lowerMessage.includes('how much') &&
        (lowerMessage.includes('spend') || lowerMessage.includes('cost'))) ||
      (lowerMessage.includes('most') &&
        (lowerMessage.includes('money') ||
          lowerMessage.includes('cost') ||
          lowerMessage.includes('spent')));
    if (isAnalyticsOrSpending) {
      return {
        route: 'conversational_flow',
        confidence: 0.7,
        reasoning:
          'Spending/cost/usage query – route to conversational flow so the LLM is invoked',
      };
    }

    // Questions about capabilities or help
    if (
      lowerMessage.includes('how to') ||
      lowerMessage.includes('help') ||
      lowerMessage.includes('can you') ||
      lowerMessage.includes('what can')
    ) {
      return {
        route: 'conversational_flow',
        confidence: 0.5,
        reasoning: 'Help or capability inquiry',
      };
    }

    // Complex multi-intent queries: route to multi_agent LangGraph for sophisticated processing
    const hasMultiIntent = this.detectMultiIntentQuery(lowerMessage);
    if (hasMultiIntent) {
      return {
        route: 'multi_agent',
        confidence: 0.8,
        reasoning:
          'Complex multi-intent query detected – routing to full LangGraph multi-agent workflow',
      };
    }

    // Analysis/optimization queries: route to conversational_flow for LLM invocation
    if (
      lowerMessage.includes('compare') ||
      lowerMessage.includes('analyze') ||
      lowerMessage.includes('optimize') ||
      lowerMessage.includes('multiple')
    ) {
      return {
        route: 'conversational_flow',
        confidence: 0.6,
        reasoning:
          'Analysis/optimization query – route to conversational flow to invoke the model',
      };
    }

    // Default to conversational flow
    return {
      route: 'conversational_flow',
      confidence: 0.5,
      reasoning: 'Default conversational routing',
    };
  }

  /**
   * Get route explanation for debugging
   */
  getRouteExplanation(route: RouteType): string {
    const explanations: Record<RouteType, string> = {
      knowledge_base:
        'Routes to CostKatana knowledge base for documentation and guides',
      conversational_flow:
        'Routes to conversational AI with integration capabilities',
      multi_agent:
        'Routes to multi-agent system for complex analysis and coordination',
      web_scraper: 'Routes to web scraping for external information and search',
      mcp: 'Routes to MCP (Model Context Protocol) tools and integrations',
      fallback:
        'Fallback route when AI routing is unavailable; uses conversational flow',
    };

    return explanations[route] || 'Unknown route';
  }

  /**
   * Check if route requires special permissions
   */
  requiresSpecialPermissions(route: RouteType): boolean {
    return (
      route === 'multi_agent' || route === 'web_scraper' || route === 'mcp'
    );
  }

  /**
   * Get recommended model for route
   */
  getRecommendedModel(route: RouteType): string {
    const recommendations: Record<RouteType, string> = {
      knowledge_base: 'nova-pro', // Fast, accurate for factual queries
      conversational_flow: 'nova-lite', // Balanced performance/cost
      multi_agent: 'nova-pro', // Higher reasoning for complex tasks
      web_scraper: 'nova-lite', // Cost-effective for search tasks
      mcp: 'nova-lite', // Tool use and integrations
      fallback: 'nova-lite', // Default fallback
    };

    return recommendations[route] || 'nova-lite';
  }

  /**
   * Detect complex multi-intent queries that should use the full LangGraph multi-agent workflow
   */
  private detectMultiIntentQuery(message: string): boolean {
    // Multi-step intent patterns
    const multiIntentPatterns = [
      // Analyze + Optimize/Compare/Evaluate
      /\b(analyze|analysis|analyzing)\b.*\b(and|then|followed by|also|plus)\b.*\b(optimize|optimization|optimizing|compare|comparison|comparing|evaluate|evaluation|evaluating)\b/i,
      /\b(optimize|optimization|optimizing|compare|comparison|comparing|evaluate|evaluation|evaluating)\b.*\b(and|then|followed by|also|plus)\b.*\b(analyze|analysis|analyzing)\b/i,

      // Research + Summarize/Analyze
      /\b(research|researching|find|search|searching)\b.*\b(and|then|followed by|also|plus)\b.*\b(summarize|summary|summarizing|analyze|analysis|analyzing)\b/i,
      /\b(summarize|summary|summarizing|analyze|analysis|analyzing)\b.*\b(and|then|followed by|also|plus)\b.*\b(research|researching|find|search|searching)\b/i,

      // Generate + Evaluate/Test
      /\b(generate|generation|generating|create|creating|build|building)\b.*\b(and|then|followed by|also|plus)\b.*\b(evaluate|evaluation|evaluating|test|testing|validate|validation|validating)\b/i,
      /\b(evaluate|evaluation|evaluating|test|testing|validate|validation|validating)\b.*\b(and|then|followed by|also|plus)\b.*\b(generate|generation|generating|create|creating|build|building)\b/i,

      // Complex multi-action patterns
      /\b(first|step 1|phase 1)\b.*\b(then|next|after|followed by|step 2|phase 2)\b/i,
      /\b(plan|strategy|approach)\b.*\b(and|then|followed by)\b.*\b(implement|implementation|execute|execution)\b/i,
      /\b(design|designing)\b.*\b(and|then|followed by)\b.*\b(implement|implementation|implementing)\b/i,

      // Sophisticated workflow indicators
      /\b(comprehensive|complete|full|thorough)\b.*\b(analysis|review|evaluation|assessment)\b/i,
      /\b(multi-step|step-by-step|systematic|structured)\b.*\b(process|approach|method|workflow)\b/i,
      /\b(end-to-end|comprehensive|holistic)\b.*\b(solution|approach|strategy)\b/i,
    ];

    // Check for multi-intent patterns
    if (multiIntentPatterns.some((pattern) => pattern.test(message))) {
      return true;
    }

    // Count complex intent keywords
    const complexIntents = [
      'analyze',
      'optimize',
      'research',
      'compare',
      'evaluate',
      'generate',
      'design',
      'implement',
      'test',
      'validate',
      'assess',
      'review',
      'strategy',
      'comprehensive',
      'systematic',
      'end-to-end',
      'multi-step',
    ];

    const intentCount = complexIntents.filter(
      (intent) =>
        message.includes(intent) ||
        message.includes(intent + 'ing') ||
        message.includes(intent + 'tion') ||
        message.includes(intent + 's'),
    ).length;

    // If message contains 3+ complex intents, route to multi-agent
    return intentCount >= 3;
  }
}
