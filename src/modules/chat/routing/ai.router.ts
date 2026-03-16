/**
 * AI Router
 * Intelligent routing using existing AI Router services for chat message routing
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConversationContext } from '../context';
import { RouteType } from './types/routing.types';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  VercelConnection,
  VercelConnectionDocument,
} from '../../../schemas/integration/vercel-connection.schema';
import {
  GitHubConnection,
  GitHubConnectionDocument,
} from '../../../schemas/integration/github-connection.schema';
import {
  GoogleConnection,
  GoogleConnectionDocument,
} from '../../../schemas/integration/google-connection.schema';
import { IntelligentRouterService } from '../../ingestion/services/intelligent-router.service';
import {
  ModelCapabilityRegistryService,
  ModelSelectionStrategy,
} from '../../ingestion/services/model-capability-registry.service';
import { ModelCapability } from '../../ingestion/services/model-registry.service';
import { BedrockService } from '../../../services/bedrock.service';

export interface RouterContext {
  userId: string;
  hasVercelConnection: boolean;
  hasGithubConnection: boolean;
  hasGoogleConnection: boolean;
  conversationSubject?: string;
}

@Injectable()
export class AIRouter {
  private readonly logger = new Logger(AIRouter.name);

  constructor(
    @InjectModel(VercelConnection.name)
    private vercelConnectionModel: Model<VercelConnectionDocument>,
    @InjectModel(GitHubConnection.name)
    private githubConnectionModel: Model<GitHubConnectionDocument>,
    @InjectModel(GoogleConnection.name)
    private googleConnectionModel: Model<GoogleConnectionDocument>,
    private readonly intelligentRouterService: IntelligentRouterService,
    private readonly modelCapabilityRegistry: ModelCapabilityRegistryService,
    private readonly bedrockService: BedrockService,
  ) {}

  /**
   * Get optimal model for routing decisions using intelligent router
   */
  async getOptimalModelForRouting(
    userId: string,
    message: string,
  ): Promise<any> {
    try {
      // Use intelligent router to select optimal model for routing analysis
      const routingResult = await this.intelligentRouterService.route({
        strategy: 'balanced',
        requirements: {
          requiredCapabilities: [
            ModelCapability.Chat,
            ModelCapability.Reasoning,
          ],
        },
        estimatedInputTokens: Math.ceil(message.length / 4),
        estimatedOutputTokens: 200,
        constraints: {
          maxCostPerRequest: 0.01, // Keep routing costs low
          maxLatencyMs: 5000,
        },
      });

      if (routingResult) {
        this.logger.debug('Selected optimal model for routing', {
          modelId: routingResult.modelId,
          score: routingResult.score,
          estimatedCost: routingResult.estimatedCost,
        });
        return routingResult;
      }

      // Fallback to capability-based selection
      const modelSelection = await this.modelCapabilityRegistry.selectModel({
        strategy: ModelSelectionStrategy.BALANCED,
        constraints: {
          requiredCapabilities: [
            ModelCapability.Chat,
            ModelCapability.Reasoning,
          ],
          maxCostPerMillion: 10000, // $0.01 per 1000 tokens
          maxLatency: 5000,
        },
      });

      if (modelSelection?.selectedModel) {
        return {
          modelId: modelSelection.selectedModel.modelId,
          score: modelSelection.score,
          estimatedCost: modelSelection.estimatedCost,
          modelName: modelSelection.selectedModel.displayName,
        };
      }

      return null;
    } catch (error) {
      this.logger.warn('Failed to get optimal model for routing', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Route using intelligent decision making
   */
  async route(
    context: ConversationContext,
    message: string,
    userId: string,
    useWebSearch?: boolean,
  ): Promise<RouteType> {
    // If web search is explicitly enabled, force web scraper route
    if (useWebSearch === true) {
      this.logger.log(
        '🌐 Web search explicitly enabled, routing to web scraper',
        {
          query: message.substring(0, 100),
        },
      );
      return 'web_scraper';
    }

    try {
      // Check user's integration connections
      const [vercelConn, githubConn, googleConn] = await Promise.all([
        this.vercelConnectionModel
          .findOne({ userId, isActive: true })
          .lean()
          .exec(),
        this.githubConnectionModel
          .findOne({ userId, isActive: true })
          .lean()
          .exec(),
        this.googleConnectionModel
          .findOne({ userId, isActive: true })
          .lean()
          .exec(),
      ]);

      // Build router context
      const routerContext: RouterContext = {
        userId,
        hasVercelConnection: !!vercelConn,
        hasGithubConnection: !!githubConn,
        hasGoogleConnection: !!googleConn,
        conversationSubject: context.currentSubject,
      };

      // Use AI-powered routing decision logic with existing service
      const decision = await this.makeAIRoutingDecision(
        message,
        context,
        routerContext,
      );

      this.logger.log('🧠 AI Router decision', {
        route: decision.route,
        confidence: decision.confidence,
        reasoning: decision.reasoning,
        userId,
      });

      // Map AI router routes to internal routes
      return this.mapRoute(decision.route);
    } catch (error: unknown) {
      this.logger.warn('AI Router failed', {
        error: error instanceof Error ? error.message : String(error),
        message: message.substring(0, 100),
      });

      throw error; // Re-throw to trigger fallback
    }
  }

  /**
   * Make AI-powered routing decision using existing AI Router service
   */
  private async makeAIRoutingDecision(
    message: string,
    conversationContext: ConversationContext,
    routerContext: RouterContext,
  ): Promise<{
    route: string;
    confidence: number;
    reasoning: string;
  }> {
    try {
      // First try AI-powered routing with LLM call
      this.logger.debug('Attempting AI-powered routing with LLM call');
      const aiDecision = await this.analyzeRoutingWithAIService(
        message,
        conversationContext,
        routerContext,
      );
      this.logger.debug('AI routing successful', {
        route: aiDecision.route,
        confidence: aiDecision.confidence,
      });
      return aiDecision;
    } catch (error) {
      this.logger.warn('AI routing failed, falling back to heuristics', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback to enhanced heuristics
      return this.makeEnhancedHeuristicDecision(
        message,
        conversationContext,
        routerContext,
      );
    }
  }

  /**
   * Analyze routing decision using the existing AI Router service with LLM call
   */
  private async analyzeRoutingWithAIService(
    message: string,
    conversationContext: ConversationContext,
    routerContext: RouterContext,
  ): Promise<{
    route: string;
    confidence: number;
    reasoning: string;
  }> {
    const routingPrompt = this.buildIntelligentRoutingPrompt(
      message,
      conversationContext,
      routerContext,
    );

    try {
      // Select optimal model for routing analysis
      const routingResult = await this.intelligentRouterService.route({
        strategy: 'balanced',
        requirements: {
          requiredCapabilities: [
            ModelCapability.Chat,
            ModelCapability.Reasoning,
          ],
        },
        estimatedInputTokens: Math.ceil(message.length / 4),
        estimatedOutputTokens: 200,
        constraints: {
          maxCostPerRequest: 0.01,
          maxLatencyMs: 5000,
        },
      });

      if (!routingResult) {
        throw new Error('No suitable model available for routing analysis');
      }

      const selectedModel = routingResult.modelId;
      this.logger.debug('Selected model for routing analysis', {
        modelId: selectedModel,
        estimatedCost: routingResult.estimatedCost,
      });

      // Invoke the model with the routing prompt
      const invokeResult = await BedrockService.invokeModel(
        routingPrompt,
        selectedModel,
        {
          maxTokens: 200,
          temperature: 0.3, // Lower temperature for more consistent routing decisions
          userId: routerContext.userId,
          metadata: {
            routingAnalysis: true,
            messageLength: message.length,
            conversationSubject: conversationContext.currentSubject,
          },
        },
      );

      const aiResponse = invokeResult.response;
      this.logger.debug('Received AI routing response', {
        responseLength: aiResponse.length,
        inputTokens: invokeResult.inputTokens,
        outputTokens: invokeResult.outputTokens,
        cost: invokeResult.cost,
      });

      // Parse the AI response
      const parsedDecision = this.parseIntelligentRoutingResponse(aiResponse);
      if (parsedDecision) {
        return parsedDecision;
      } else {
        throw new Error('Failed to parse AI routing response');
      }
    } catch (error) {
      this.logger.warn('AI Router service analysis failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Build intelligent routing prompt using existing service capabilities
   */
  private buildIntelligentRoutingPrompt(
    message: string,
    conversationContext: ConversationContext,
    routerContext: RouterContext,
  ): string {
    const availableRoutes = [
      {
        route: 'web_search',
        description:
          'Web scraping and search for current information, news, or data not in our knowledge base',
        useCase:
          'When user needs real-time information, current events, or data that changes frequently',
      },
      {
        route: 'github_tools',
        description:
          'GitHub repository operations, code analysis, pull requests, issues, and version control',
        useCase:
          'For code-related queries, repository management, or development workflow',
      },
      {
        route: 'vercel_tools',
        description:
          'Vercel deployment, project management, domain configuration, and hosting',
        useCase: 'For deployment, hosting, or Vercel-specific operations',
      },
      {
        route: 'google_tools',
        description:
          'Google Workspace integration (Sheets, Docs, Drive, Calendar)',
        useCase:
          'For document management, spreadsheet operations, or Google services',
      },
      {
        route: 'mcp',
        description:
          'Model Context Protocol integration for database queries, external API calls, and tool execution',
        useCase:
          'For database operations, external integrations, or when specific tools are needed',
      },
      {
        route: 'multi_agent',
        description:
          'Complex multi-step tasks requiring coordination between multiple specialized agents',
        useCase:
          'For comprehensive analysis, multi-step workflows, or tasks needing multiple perspectives',
      },
      {
        route: 'knowledge_base',
        description:
          'Retrieving information from stored knowledge base or documentation',
        useCase:
          'For explanations, how-to guides, or reference information we have stored',
      },
      {
        route: 'analytics',
        description:
          'Cost analysis, performance metrics, usage analytics, and optimization recommendations',
        useCase:
          'For data analysis, performance insights, or cost optimization queries',
      },
      {
        route: 'direct_response',
        description:
          'Simple conversational responses, greetings, general chat, and straightforward questions',
        useCase:
          'For casual conversation, simple questions, or when no specialized handling is needed',
      },
    ];

    const connectionStatus = {
      github: routerContext.hasGithubConnection ? 'AVAILABLE' : 'NOT_CONNECTED',
      vercel: routerContext.hasVercelConnection ? 'AVAILABLE' : 'NOT_CONNECTED',
      google: routerContext.hasGoogleConnection ? 'AVAILABLE' : 'NOT_CONNECTED',
    };

    return `You are an intelligent routing assistant for a cost optimization platform. Analyze this user message and determine the best routing destination.

USER MESSAGE: "${message}"

CONTEXT INFORMATION:
- Conversation Subject: ${conversationContext.currentSubject || 'Not specified'}
- Current Intent: ${conversationContext.currentIntent || 'Unknown'}
- Programming Language/Framework: ${conversationContext.languageFramework || 'Not specified'}
- Recent Conversation Entities: ${conversationContext.lastReferencedEntities.slice(0, 3).join(', ') || 'None'}
- Integration Availability:
  - GitHub: ${connectionStatus.github}
  - Vercel: ${connectionStatus.vercel}
  - Google Workspace: ${connectionStatus.google}

ROUTING OPTIONS:
${availableRoutes.map((r) => `${r.route.toUpperCase()}: ${r.description}\n  Best for: ${r.useCase}`).join('\n\n')}

ROUTING GUIDELINES:
1. ALWAYS check integration availability before routing to integration-specific handlers
2. Route to WEB_SEARCH for questions requiring current/fresh information or external data
3. Route to MULTI_AGENT for complex, multi-step tasks or comprehensive analysis
4. Route to ANALYTICS for cost/performance/optimization queries
5. Route to KNOWLEDGE_BASE for stored information, documentation, or explanations
6. Route to DIRECT_RESPONSE for simple conversation, greetings, or basic questions
7. Consider conversation context - if user was discussing code, prefer GITHUB_TOOLS if available
8. If multiple routes could work, choose the most specific and capable one
9. Prioritize user experience - choose routes that will provide the most helpful response

RESPONSE FORMAT (JSON only):
{
  "route": "exact_route_name_from_options",
  "confidence": 0.0_to_1.0,
  "reasoning": "2-3 sentence explanation of routing decision"
}

Analyze carefully and respond with ONLY the JSON:`;
  }

  /**
   * Parse intelligent routing response from AI Router service
   */
  private parseIntelligentRoutingResponse(response: string): {
    route: string;
    confidence: number;
    reasoning: string;
  } | null {
    try {
      // Extract JSON from AI response
      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        this.logger.debug('No JSON found in routing response', {
          response: response.substring(0, 200),
        });
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        route?: string;
        confidence?: number;
        reasoning?: string;
      };

      // Validate required fields
      if (
        !parsed.route ||
        typeof parsed.confidence !== 'number' ||
        !parsed.reasoning
      ) {
        this.logger.debug('Invalid routing response structure', { parsed });
        return null;
      }

      // Normalize route name (convert to lowercase)
      const normalizedRoute = parsed.route.toLowerCase();

      // Validate route is one of our supported routes
      const validRoutes = [
        'web_search',
        'github_tools',
        'vercel_tools',
        'google_tools',
        'mcp',
        'multi_agent',
        'knowledge_base',
        'analytics',
        'direct_response',
      ];

      if (!validRoutes.includes(normalizedRoute)) {
        this.logger.debug('Invalid route in response', {
          route: normalizedRoute,
        });
        return null;
      }

      // Validate confidence range
      const confidence = Math.max(0, Math.min(1, parsed.confidence));

      return {
        route: normalizedRoute,
        confidence,
        reasoning: parsed.reasoning,
      };
    } catch (error) {
      this.logger.debug('Failed to parse intelligent routing response', {
        error: error instanceof Error ? error.message : String(error),
        response: response.substring(0, 200),
      });
      return null;
    }
  }

  /**
   * Enhanced heuristic routing with context awareness
   */
  private makeEnhancedHeuristicDecision(
    message: string,
    conversationContext: ConversationContext,
    routerContext: RouterContext,
  ): {
    route: string;
    confidence: number;
    reasoning: string;
  } {
    const lowerMessage = message.toLowerCase();
    const messageWords = lowerMessage.split(/\s+/);

    // Priority 1: Explicit web search requests
    if (
      this.containsKeywords(messageWords, [
        'search',
        'find',
        'google',
        'web',
        'online',
        'browse',
        'latest',
      ])
    ) {
      return {
        route: 'web_search',
        confidence: 0.85,
        reasoning: 'Message contains explicit web search keywords',
      };
    }

    // Priority 2: Integration-specific queries (only if connected)
    const integrationRoutes = [
      {
        route: 'github_tools',
        keywords: [
          'github',
          'repository',
          'repo',
          'code',
          'pull',
          'request',
          'issue',
          'branch',
          'commit',
          'git',
        ],
        connected: routerContext.hasGithubConnection,
        service: 'GitHub',
      },
      {
        route: 'vercel_tools',
        keywords: [
          'vercel',
          'deployment',
          'deploy',
          'project',
          'domain',
          'hosting',
          'build',
        ],
        connected: routerContext.hasVercelConnection,
        service: 'Vercel',
      },
      {
        route: 'google_tools',
        keywords: [
          'google',
          'sheet',
          'drive',
          'document',
          'spreadsheet',
          'calendar',
          'workspace',
        ],
        connected: routerContext.hasGoogleConnection,
        service: 'Google Workspace',
      },
    ];

    for (const integration of integrationRoutes) {
      if (this.containsKeywords(messageWords, integration.keywords)) {
        if (integration.connected) {
          return {
            route: integration.route,
            confidence: 0.9,
            reasoning: `${integration.service} integration available and query matches ${integration.service} operations`,
          };
        } else {
          // Route to conversational flow to suggest connection
          return {
            route: 'direct_response',
            confidence: 0.7,
            reasoning: `${integration.service} query detected but no connection available`,
          };
        }
      }
    }

    // Priority 3: Complex task indicators
    if (
      this.containsKeywords(messageWords, [
        'analyze',
        'comprehensive',
        'deep',
        'complex',
        'multi-step',
        'workflow',
      ])
    ) {
      return {
        route: 'multi_agent',
        confidence: 0.8,
        reasoning:
          'Message indicates complex multi-step task requiring multiple agents',
      };
    }

    // Priority 4: Analytics and optimization
    if (
      this.containsKeywords(messageWords, [
        'analytics',
        'optimize',
        'performance',
        'cost',
        'metrics',
        'usage',
        'efficiency',
      ])
    ) {
      return {
        route: 'analytics',
        confidence: 0.75,
        reasoning:
          'Message relates to analytics, optimization, or cost analysis',
      };
    }

    // Priority 5: Knowledge base queries
    if (
      this.containsKeywords(messageWords, [
        'what',
        'how',
        'explain',
        'documentation',
        'knowledge',
        'reference',
        'guide',
      ])
    ) {
      return {
        route: 'knowledge_base',
        confidence: 0.7,
        reasoning:
          'Message appears to be seeking information from knowledge base',
      };
    }

    // Priority 6: Context-aware routing based on conversation history
    if (conversationContext.currentSubject) {
      const subject = conversationContext.currentSubject.toLowerCase();

      // If conversation is about code/development, prefer GitHub if connected
      if (
        (subject.includes('code') || subject.includes('project')) &&
        routerContext.hasGithubConnection
      ) {
        return {
          route: 'github_tools',
          confidence: 0.6,
          reasoning:
            'Conversation context suggests development/project work with GitHub available',
        };
      }

      // If conversation is about deployment/hosting, prefer Vercel if connected
      if (
        (subject.includes('deploy') || subject.includes('host')) &&
        routerContext.hasVercelConnection
      ) {
        return {
          route: 'vercel_tools',
          confidence: 0.6,
          reasoning:
            'Conversation context suggests deployment work with Vercel available',
        };
      }
    }

    // Default: conversational flow for general queries
    return {
      route: 'direct_response',
      confidence: 0.5,
      reasoning:
        'General conversational query, no specific routing indicators detected',
    };
  }

  /**
   * Check if message contains keywords (with fuzzy matching)
   */
  private containsKeywords(
    messageWords: string[],
    keywords: string[],
  ): boolean {
    return keywords.some((keyword) =>
      messageWords.some(
        (word) =>
          word.includes(keyword) ||
          keyword.includes(word) ||
          this.calculateSimilarity(word, keyword) > 0.8,
      ),
    );
  }

  /**
   * Calculate string similarity for fuzzy matching
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  /**
   * Calculate Levenshtein distance for string similarity
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j] + 1, // deletion
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Map AI router routes to internal route types
   */
  private mapRoute(aiRoute: string): RouteType {
    switch (aiRoute) {
      case 'vercel_tools':
      case 'github_tools':
      case 'google_tools':
      case 'multi_agent':
        // These go to conversational flow which uses the agent with appropriate tools
        return 'conversational_flow';

      case 'mcp':
        return 'mcp';

      case 'knowledge_base':
        return 'knowledge_base';

      case 'analytics':
      case 'optimization':
        return 'multi_agent';

      case 'web_search':
        return 'web_scraper';

      case 'direct_response':
      default:
        return 'conversational_flow';
    }
  }
}
