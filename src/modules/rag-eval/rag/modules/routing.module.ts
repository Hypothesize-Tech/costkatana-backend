/**
 * Routing Module
 * Intelligently routes queries to appropriate data sources and retrieval strategies
 */

import { BaseRAGModule } from './base.module';
import {
  RAGModuleInput,
  RAGModuleOutput,
  RoutingConfig,
  RouteDefinition,
} from '../types/rag.types';
import { ChatBedrockConverse } from '@langchain/aws';

export interface RoutingDecision {
  route: string;
  confidence: number;
  reasoning: string;
  datasource?: string;
  strategy?: string;
}

export class RoutingModule extends BaseRAGModule {
  protected config: RoutingConfig;

  constructor(config: RoutingConfig = { enabled: true, strategy: 'hybrid' }) {
    super('RoutingModule', 'routing', config);
    this.config = config;
  }

  protected async executeInternal(
    input: RAGModuleInput,
  ): Promise<RAGModuleOutput> {
    const { query, config } = input;

    // Merge config
    const effectiveConfig = { ...this.config, ...config };

    // Analyze query and determine routing
    const decision = await this.determineRoute(query, effectiveConfig);

    this.logger.log('Query routed', {
      component: 'RoutingModule',
      query: query.substring(0, 100),
      route: decision.route,
      confidence: decision.confidence,
      strategy: effectiveConfig.strategy,
    });

    return {
      ...this.createSuccessOutput(decision, {
        route: decision.route,
        confidence: decision.confidence,
        strategy: effectiveConfig.strategy,
      }),
      query,
    };
  }

  /**
   * Determine the best route for a query
   */
  private async determineRoute(
    query: string,
    config: RoutingConfig,
  ): Promise<RoutingDecision> {
    const strategy = config.strategy ?? 'hybrid';

    switch (strategy) {
      case 'semantic':
        return this.semanticRouting(query, config);

      case 'keyword':
        return this.keywordRouting(query, config);

      case 'ml-based':
        return this.mlBasedRouting(query, config);

      case 'hybrid':
      default:
        return this.hybridRouting(query, config);
    }
  }

  /**
   * Route based on semantic understanding
   */
  private async semanticRouting(
    query: string,
    config: RoutingConfig,
  ): Promise<RoutingDecision> {
    // Analyze query semantics to determine route
    const lowerQuery = query.toLowerCase();

    // Route to documentation for technical queries
    if (
      lowerQuery.match(
        /\b(api|function|method|class|documentation|docs?|code)\b/,
      )
    ) {
      return {
        route: 'documentation',
        confidence: 0.8,
        reasoning: 'Query appears to be about technical documentation or code',
        datasource: 'docs',
        strategy: 'semantic',
      };
    }

    // Route to knowledge base for general questions
    if (lowerQuery.match(/\b(what|how|why|explain)\b/)) {
      return {
        route: 'knowledge-base',
        confidence: 0.7,
        reasoning:
          'Query appears to be seeking general knowledge or explanation',
        datasource: 'kb',
        strategy: 'semantic',
      };
    }

    // Route to conversation history for follow-ups
    if (
      lowerQuery.match(/\b(that|this|it|those|these)\b/) ||
      lowerQuery.includes('you said') ||
      lowerQuery.includes('mentioned')
    ) {
      return {
        route: 'conversation',
        confidence: 0.9,
        reasoning: 'Query appears to reference previous conversation',
        datasource: 'memory',
        strategy: 'semantic',
      };
    }

    // Default to general search
    return {
      route: 'general',
      confidence: 0.5,
      reasoning: 'No specific semantic pattern detected',
      datasource: 'all',
      strategy: 'semantic',
    };
  }

  /**
   * Route based on keyword matching
   */
  private keywordRouting(
    query: string,
    config: RoutingConfig,
  ): Promise<RoutingDecision> {
    const routes = config.routes ?? this.getDefaultRoutes();
    const lowerQuery = query.toLowerCase();

    // Find matching routes
    const matches = routes
      .map((route) => ({
        route,
        score: this.calculateKeywordMatch(lowerQuery, route),
      }))
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score);

    if (matches.length > 0) {
      const bestMatch = matches[0];
      return Promise.resolve({
        route: bestMatch.route.name,
        confidence: Math.min(bestMatch.score / 10, 0.9), // Normalize score
        reasoning: `Keyword match for route: ${bestMatch.route.name}`,
        datasource: bestMatch.route.datasource,
        strategy: 'keyword',
      });
    }

    return Promise.resolve({
      route: 'default',
      confidence: 0.3,
      reasoning: 'No keyword matches found',
      datasource: 'all',
      strategy: 'keyword',
    });
  }

  /**
   * ML-based routing using LLM analysis
   */
  private async mlBasedRouting(
    query: string,
    config: RoutingConfig,
  ): Promise<RoutingDecision> {
    try {
      const llm = new ChatBedrockConverse({
        model: 'amazon.nova-micro-v1:0',
        region: process.env.AWS_REGION ?? 'us-east-1',
        temperature: 0.1,
        maxTokens: 100,
      });

      const prompt = `Analyze this query and determine the best data source to search. Choose from: documentation, knowledge-base, conversation, web, code, or general.

Query: "${query}"

Respond with only the data source name.`;

      const response = await llm.invoke([{ role: 'user', content: prompt }]);
      const content =
        typeof response.content === 'string'
          ? response.content.toLowerCase().trim()
          : 'general';

      const validRoutes = [
        'documentation',
        'knowledge-base',
        'conversation',
        'web',
        'code',
        'general',
      ];
      const route = validRoutes.includes(content) ? content : 'general';

      return {
        route,
        confidence: 0.8,
        reasoning: `LLM analysis determined route: ${route}`,
        datasource: this.routeToDatasource(route),
        strategy: 'ml-based',
      };
    } catch (error) {
      this.logger.warn('ML-based routing failed, falling back to keyword', {
        component: 'RoutingModule',
        error: error instanceof Error ? error.message : String(error),
      });

      return this.keywordRouting(query, config);
    }
  }

  /**
   * Hybrid routing combining multiple strategies
   */
  private async hybridRouting(
    query: string,
    config: RoutingConfig,
  ): Promise<RoutingDecision> {
    // Get decisions from multiple strategies
    const [semantic, keyword, ml] = await Promise.allSettled([
      this.semanticRouting(query, config),
      this.keywordRouting(query, config),
      this.mlBasedRouting(query, config),
    ]);

    // Extract successful results
    const decisions: RoutingDecision[] = [];

    if (semantic.status === 'fulfilled') decisions.push(semantic.value);
    if (keyword.status === 'fulfilled') decisions.push(keyword.value);
    if (ml.status === 'fulfilled') decisions.push(ml.value);

    if (decisions.length === 0) {
      return {
        route: 'general',
        confidence: 0.3,
        reasoning: 'All routing strategies failed',
        datasource: 'all',
        strategy: 'hybrid',
      };
    }

    // Find consensus or highest confidence
    const routeCounts = new Map<
      string,
      { count: number; totalConfidence: number; decisions: RoutingDecision[] }
    >();

    for (const decision of decisions) {
      const existing = routeCounts.get(decision.route) || {
        count: 0,
        totalConfidence: 0,
        decisions: [],
      };
      existing.count++;
      existing.totalConfidence += decision.confidence;
      existing.decisions.push(decision);
      routeCounts.set(decision.route, existing);
    }

    // Sort by consensus (count) then by average confidence
    const sortedRoutes = Array.from(routeCounts.entries())
      .map(([route, data]) => ({
        route,
        consensus: data.count,
        avgConfidence: data.totalConfidence / data.count,
        decisions: data.decisions,
      }))
      .sort((a, b) => {
        if (a.consensus !== b.consensus) return b.consensus - a.consensus;
        return b.avgConfidence - a.avgConfidence;
      });

    const bestRoute = sortedRoutes[0];

    return {
      route: bestRoute.route,
      confidence: bestRoute.avgConfidence,
      reasoning: `Hybrid routing consensus: ${bestRoute.consensus}/${decisions.length} strategies agreed`,
      datasource: bestRoute.decisions[0].datasource,
      strategy: 'hybrid',
    };
  }

  /**
   * Calculate keyword match score for a route
   */
  private calculateKeywordMatch(query: string, route: RouteDefinition): number {
    let score = 0;

    for (const pattern of route.patterns) {
      if (query.includes(pattern.toLowerCase())) {
        score += route.priority;
      }
    }

    return score;
  }

  /**
   * Get default routing rules
   */
  private getDefaultRoutes(): RouteDefinition[] {
    return [
      {
        name: 'documentation',
        patterns: [
          'api',
          'function',
          'method',
          'class',
          'documentation',
          'docs',
          'code',
          'implementation',
        ],
        priority: 5,
        datasource: 'docs',
      },
      {
        name: 'knowledge-base',
        patterns: ['what is', 'how to', 'explain', 'guide', 'tutorial'],
        priority: 4,
        datasource: 'kb',
      },
      {
        name: 'conversation',
        patterns: ['you said', 'mentioned', 'earlier', 'before', 'previous'],
        priority: 6,
        datasource: 'memory',
      },
      {
        name: 'web',
        patterns: ['latest', 'current', 'news', 'recent', 'update'],
        priority: 3,
        datasource: 'web',
      },
    ];
  }

  /**
   * Convert route name to datasource
   */
  private routeToDatasource(route: string): string {
    const mapping: Record<string, string> = {
      documentation: 'docs',
      'knowledge-base': 'kb',
      conversation: 'memory',
      web: 'web',
      code: 'code',
      general: 'all',
    };

    return mapping[route] || 'all';
  }

  resetConfig(): void {
    this.config = {
      enabled: true,
      strategy: 'hybrid',
    };
  }

  protected getDescription(): string {
    return 'Intelligent query routing and datasource selection module';
  }

  protected getCapabilities(): string[] {
    return [
      'Semantic routing',
      'Keyword-based routing',
      'ML-based routing',
      'Hybrid routing',
      'Query analysis',
      'Datasource selection',
      'Route optimization',
    ];
  }
}
