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
import { BedrockService } from '../../bedrock/bedrock.service';
import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient } from '../../../config/aws';

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

    // Gold-standard LLM routing via Bedrock Converse + tool-use.
    //
    // Why tool-use beats free-form JSON:
    //   - The model is FORCED to emit a structured object matching the
    //     declared schema. It can't return an invalid route name; the
    //     `route` field is an enum.
    //   - No regex / JSON-extraction fallback parsing on our side.
    //   - Works reliably even on small models (the Converse API does the
    //     constraining at the API level, not the model level).
    //
    // We pass the routing instructions as the system message and the user
    // query as the user turn. `toolChoice` forces the model to call
    // `select_route` rather than reply with prose.
    // Pin Amazon Nova-Lite for routing.
    //
    // Why Nova-Lite, given the user's preference for Claude:
    //   - All Claude models in this AWS account are flagged "Legacy /
    //     not-used-in-30-days" and return ResourceNotFoundException on
    //     Converse calls (verified by direct probe + ListInferenceProfiles).
    //   - Nova-Lite is the only foundation model in the account that
    //     (a) accepts Converse + tool-use, (b) consistently emits valid
    //     enum-shape tool calls, and (c) on direct testing classifies
    //     greetings, self-ref, and freshness queries correctly with the
    //     few-shot prompt below — outperforming Nova-Pro on the self-ref
    //     case in this setup.
    //   - Routing is a constrained-output classification, not generation,
    //     so a smaller well-prompted model is the right tool.
    //
    // If Claude access is restored, change to `anthropic.claude-haiku-4-5`
    // or `anthropic.claude-sonnet-4-6-v1:0` — the prompt is model-agnostic.
    const selectedModel = 'amazon.nova-lite-v1:0';
    this.logger.debug('Routing via Converse tool-use (LLM-only)', {
      modelId: selectedModel,
    });

    try {
      const command = new ConverseCommand({
        modelId: selectedModel,
        system: [{ text: routingPrompt }],
        messages: [
          {
            role: 'user',
            content: [
              { text: `Classify this user message: "${message}"` },
            ],
          },
        ],
        inferenceConfig: { maxTokens: 200, temperature: 0 },
        toolConfig: {
          tools: [
            {
              toolSpec: {
                name: 'select_route',
                description:
                  'Select exactly one route for the user message based on the routing rules in the system prompt.',
                inputSchema: {
                  json: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['route', 'confidence', 'reasoning'],
                    properties: {
                      route: {
                        type: 'string',
                        enum: [
                          'direct_response',
                          'web_search',
                          'analytics',
                          'knowledge_base',
                          'github_tools',
                          'vercel_tools',
                          'google_tools',
                          'mcp',
                          'multi_agent',
                        ],
                        description: 'The chosen route name.',
                      },
                      confidence: {
                        type: 'number',
                        minimum: 0,
                        maximum: 1,
                        description: 'Confidence in the choice (0..1).',
                      },
                      reasoning: {
                        type: 'string',
                        maxLength: 200,
                        description:
                          'One short sentence explaining the choice.',
                      },
                    },
                  },
                },
              },
            },
          ],
          // Force the model to call the tool — no prose response allowed.
          toolChoice: { tool: { name: 'select_route' } },
        },
      });

      const response = await bedrockClient.send(command);

      // The model's tool call is in output.message.content[*].toolUse.input.
      const blocks =
        (response.output?.message?.content as Array<{
          toolUse?: { name?: string; input?: unknown };
        }> | undefined) ?? [];
      const toolCall = blocks.find(
        (b) => b.toolUse?.name === 'select_route',
      )?.toolUse;
      if (toolCall?.input && typeof toolCall.input === 'object') {
        const input = toolCall.input as {
          route?: string;
          confidence?: number;
          reasoning?: string;
        };
        if (input.route) {
          this.logger.debug('Routing tool-use returned', {
            route: input.route,
            confidence: input.confidence,
          });
          return {
            route: input.route,
            confidence: input.confidence ?? 0.8,
            reasoning: input.reasoning ?? 'tool-use',
          };
        }
      }
      throw new Error('Routing tool-use returned no select_route call');
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
          'Live web search for time-sensitive, external, or factual information not in the knowledge base. Pick ONLY when: (a) the user asks about pricing of external products/services with named providers (e.g. "Sonnet pricing"), (b) the user explicitly references freshness ("latest", "current", "recent", "as of"), or (c) the user asks for news/events about a NAMED external entity (a company, person, product). Do NOT pick this for greetings, casual conversation, self-referential questions about CostKatana itself, or questions whose answer comes from general AI knowledge.',
        useCase:
          'Pricing comparisons of named external products, latest releases of named products, news about named external entities. Never for greetings or self-referential questions.',
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
          'Integration commands that the user explicitly invokes with @mention syntax (e.g. "@github list issues", "@mongodb query users"). ONLY pick this when the message contains an "@" mention pointing at a connected integration. Do NOT pick this for general "external" or "API" questions — those should go to web_search or knowledge_base.',
        useCase:
          'ONLY when the user message contains an @mention referencing a registered integration (github, mongodb, vercel, slack, discord, jira, linear, aws, google).',
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
          'Default route for casual conversation. Pick for: greetings ("hi", "how are you"), self-referential questions about CostKatana, questions answerable from general AI knowledge or our docs, and any short message that does not explicitly need fresh external data or a tool. When in doubt between web_search and direct_response, prefer direct_response unless freshness is clearly required.',
        useCase:
          'Greetings, casual chat, self-referential queries about CostKatana, simple questions, or anything where the answer does not depend on external/fresh data.',
      },
    ];

    const connectionStatus = {
      github: routerContext.hasGithubConnection ? 'AVAILABLE' : 'NOT_CONNECTED',
      vercel: routerContext.hasVercelConnection ? 'AVAILABLE' : 'NOT_CONNECTED',
      google: routerContext.hasGoogleConnection ? 'AVAILABLE' : 'NOT_CONNECTED',
    };

    // Tight prompt tuned for Nova-Lite. Heavy route prose was confusing
    // the small model; few-shot pairs are doing the heavy lifting now.
    // Order matters: examples first, rules second, then call the tool.
    void availableRoutes;
    void connectionStatus;
    return `You route messages for CostKatana (an AI cost-optimization web app). Pick one route by calling select_route.

ROUTES:
direct_response | web_search | analytics | knowledge_base | github_tools | vercel_tools | google_tools | mcp | multi_agent

CostKatana is THIS APP — not a sword, not an external product. Questions about CostKatana are about us, not the world.

EXAMPLES (copy this pattern):
"Hi" → direct_response
"hello there" → direct_response
"how are you doing today" → direct_response
"thanks" → direct_response
"What is CostKatana" → direct_response
"What does CostKatana do" → direct_response
"What does CostKatana do in one sentence" → direct_response
"Who built this app" → direct_response
"Tell me about yourself" → direct_response
"@github list PRs" → mcp
"@mongodb show users" → mcp
"Latest Anthropic announcement" → web_search
"current GPT-4o price" → web_search
"What is the difference between Haiku and Sonnet pricing" → web_search
"OpenAI news today" → web_search
"What's my spend this month" → analytics
"Show cost trends" → analytics
"Deploy this to Vercel" → vercel_tools
"List my GitHub PRs" → github_tools
"How do I use the dashboard" → knowledge_base
"Explain prompt caching feature" → knowledge_base
"Audit my codebase and fix cost issues" → multi_agent

RULES:
- Greetings + small talk → direct_response (always).
- "CostKatana", "this app", "you" referring to the app → direct_response (NEVER web_search).
- web_search needs both a NAMED external entity AND a freshness/news/pricing intent.
- knowledge_base is for how-to questions about CostKatana features only.
- @mention of an integration → mcp.

Now call select_route with route, confidence (0..1), and a brief reasoning.`;
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
