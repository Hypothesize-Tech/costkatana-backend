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
import { loggingService } from '../../services/logging.service';

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
    input: RAGModuleInput
  ): Promise<RAGModuleOutput> {
    const { query, config } = input;

    // Merge config
    const effectiveConfig = { ...this.config, ...config };

    // Analyze query and determine routing
    const decision = await this.determineRoute(query, effectiveConfig);

    loggingService.info('Query routed', {
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
    config: RoutingConfig
  ): Promise<RoutingDecision> {
    const strategy = config.strategy || 'hybrid';

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
   * Semantic routing using query understanding
   */
  private async semanticRouting(
    query: string,
    config: RoutingConfig
  ): Promise<RoutingDecision> {
    const lowerQuery = query.toLowerCase();

    // Knowledge base patterns
    const knowledgePatterns = [
      'how',
      'what',
      'explain',
      'guide',
      'tutorial',
      'documentation',
      'architecture',
      'feature',
    ];

    // User data patterns
    const userDataPatterns = [
      'my',
      'our',
      'cost',
      'usage',
      'analytics',
      'project',
      'conversation',
      'document',
    ];

    // Real-time patterns
    const realTimePatterns = [
      'current',
      'latest',
      'now',
      'today',
      'recent',
      'status',
    ];

    // Calculate scores
    const knowledgeScore = this.calculatePatternScore(
      lowerQuery,
      knowledgePatterns
    );
    const userDataScore = this.calculatePatternScore(
      lowerQuery,
      userDataPatterns
    );
    const realTimeScore = this.calculatePatternScore(
      lowerQuery,
      realTimePatterns
    );

    // Determine route based on highest score
    if (
      knowledgeScore > userDataScore &&
      knowledgeScore > realTimeScore &&
      knowledgeScore > 0.3
    ) {
      return {
        route: 'knowledge_base',
        confidence: knowledgeScore,
        reasoning: 'Query matches knowledge base patterns',
        datasource: 'vector_store',
        strategy: 'semantic_search',
      };
    }

    if (userDataScore > realTimeScore && userDataScore > 0.3) {
      return {
        route: 'user_data',
        confidence: userDataScore,
        reasoning: 'Query requests user-specific data',
        datasource: 'mongodb',
        strategy: 'hybrid_search',
      };
    }

    if (realTimeScore > 0.3) {
      return {
        route: 'real_time',
        confidence: realTimeScore,
        reasoning: 'Query requires real-time data',
        datasource: 'web_scraper',
        strategy: 'web_search',
      };
    }

    // Default fallback
    return {
      route: 'general',
      confidence: 0.5,
      reasoning: 'No specific pattern detected, using general route',
      datasource: 'vector_store',
      strategy: 'hybrid_search',
    };
  }

  /**
   * Keyword-based routing
   */
  private keywordRouting(
    query: string,
    config: RoutingConfig
  ): RoutingDecision {
    const routes = config.routes || this.getDefaultRoutes();
    const lowerQuery = query.toLowerCase();

    for (const route of routes.sort((a, b) => b.priority - a.priority)) {
      for (const pattern of route.patterns) {
        if (lowerQuery.includes(pattern.toLowerCase())) {
          return {
            route: route.name,
            confidence: 0.8,
            reasoning: `Matched keyword pattern: ${pattern}`,
            datasource: route.datasource,
          };
        }
      }
    }

    return {
      route: config.fallbackRoute || 'general',
      confidence: 0.5,
      reasoning: 'No keyword match, using fallback',
    };
  }

  /**
   * ML-based routing using semantic analysis
   */
  private async mlBasedRouting(
    query: string,
    config: RoutingConfig
  ): Promise<RoutingDecision> {
    // Use semantic analysis as ML-based approach
    const semanticDecision = await this.semanticRouting(query, config);
    const keywordDecision = this.keywordRouting(query, config);
    
    // Combine decisions with weighted voting
    if (semanticDecision.confidence > 0.8 || keywordDecision.confidence > 0.8) {
      return semanticDecision.confidence > keywordDecision.confidence 
        ? semanticDecision 
        : keywordDecision;
    }
    
    return this.hybridRouting(query, config);
  }

  /**
   * Hybrid routing combining multiple strategies
   */
  private async hybridRouting(
    query: string,
    config: RoutingConfig
  ): Promise<RoutingDecision> {
    // Get decisions from both semantic and keyword routing
    const semanticDecision = await this.semanticRouting(query, config);
    const keywordDecision = this.keywordRouting(query, config);

    // Combine with weighted average
    if (
      semanticDecision.route === keywordDecision.route ||
      semanticDecision.confidence > 0.7
    ) {
      return {
        ...semanticDecision,
        confidence: Math.min(
          (semanticDecision.confidence + keywordDecision.confidence) / 2 + 0.1,
          1.0
        ),
        reasoning: `Hybrid: ${semanticDecision.reasoning} + keyword matching`,
      };
    }

    // If they disagree, choose the one with higher confidence
    return semanticDecision.confidence >= keywordDecision.confidence
      ? semanticDecision
      : keywordDecision;
  }

  /**
   * Calculate pattern matching score
   */
  private calculatePatternScore(query: string, patterns: string[]): number {
    const words = query.split(/\s+/);
    let matchCount = 0;

    for (const pattern of patterns) {
      if (query.includes(pattern)) {
        matchCount++;
      }
    }

    return Math.min(matchCount / Math.max(patterns.length * 0.5, 1), 1.0);
  }

  /**
   * Get default route definitions
   */
  private getDefaultRoutes(): RouteDefinition[] {
    return [
      {
        name: 'knowledge_base',
        patterns: [
          'how',
          'what',
          'explain',
          'guide',
          'documentation',
          'feature',
          'architecture',
          'best practice',
        ],
        priority: 10,
        datasource: 'vector_store',
      },
      {
        name: 'user_analytics',
        patterns: [
          'cost',
          'usage',
          'analytics',
          'spending',
          'token',
          'my',
          'our',
        ],
        priority: 9,
        datasource: 'mongodb',
      },
      {
        name: 'real_time_data',
        patterns: ['current', 'latest', 'now', 'today', 'status'],
        priority: 8,
        datasource: 'web_scraper',
      },
      {
        name: 'project_specific',
        patterns: ['project', 'conversation', 'document'],
        priority: 7,
        datasource: 'mongodb',
      },
    ];
  }

  protected getDescription(): string {
    return 'Routes queries to appropriate data sources and retrieval strategies';
  }

  protected getCapabilities(): string[] {
    return [
      'semantic_routing',
      'keyword_routing',
      'hybrid_routing',
      'confidence_scoring',
    ];
  }

  resetConfig(): void {
    this.config = {
      enabled: true,
      strategy: 'hybrid',
    };
  }

  validateConfig(): boolean {
    if (!this.config.strategy) {
      return false;
    }

    const validStrategies = ['semantic', 'keyword', 'hybrid', 'ml-based'];
    return validStrategies.includes(this.config.strategy);
  }
}

