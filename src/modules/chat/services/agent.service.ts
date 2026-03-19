import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoggerService } from '../../../common/logger/logger.service';
import { CacheService } from '../../../common/cache/cache.service';
import { RouteDecider } from '../utils/route-decider';
import { ContextManager } from '../context/context.manager';
import { ConnectionChecker } from '../utils/connection-checker';
import { LangchainHelpers } from '../utils/langchain-helpers';
import { WebSearchService } from './web-search.service';
import { VectorStoreService } from '../../agent/services/vector-store.service';
import {
  MultiAgentFlowService,
  MultiAgentQuery,
} from './multi-agent-flow.service';
import { McpIntegrationHandlerService } from './mcp-integration-handler.service';
import { IntegrationChatService } from './integration-chat.service';
import { BedrockService } from '../../bedrock/bedrock.service';
import { VercelToolsService } from '../../agent/services/vercel-tools.service';
import { getMaxTokensForModel } from '../../../utils/model-tokens';
import { Usage, UsageDocument } from '../../../schemas/core/usage.schema';
import { Tool } from 'openai/resources/responses/responses';
import { generateSecureId } from '../../../common/utils/secure-id.util';

export interface AgentQuery {
  userId: string;
  query: string;
  context?: {
    projectId?: string;
    conversationId?: string;
    previousMessages?: Array<{ role: string; content: string }>;
    isProjectWizard?: boolean;
    projectType?: string;
    wizardState?: any;
    previousResponses?: any;
    [key: string]: any;
  };
  callbacks?: any[];
}

export interface AgentResponse {
  success: boolean;
  response?: string;
  error?: string;
  metadata?: {
    tokensUsed?: number;
    sources?: string[];
    executionTime?: number;
    errorType?: string;
    knowledgeEnhanced?: boolean;
    knowledgeContextLength?: number;
    fromCache?: boolean;
    langchainEnhanced?: boolean;
    webSearchUsed?: boolean;
    aiWebSearchDecision?: {
      required: boolean;
      reason: string;
    };
  };
  thinking?: {
    title: string;
    steps: Array<{
      step: number;
      description: string;
      reasoning: string;
      outcome?: string;
    }>;
    summary?: string;
  };
}

@Injectable()
export class AgentService {
  constructor(
    private readonly loggingService: LoggerService,
    private readonly cacheService: CacheService,
    private readonly routeDecider: RouteDecider,
    private readonly contextManager: ContextManager,
    private readonly connectionChecker: ConnectionChecker,
    private readonly langchainHelpers: LangchainHelpers,
    private readonly webSearchService: WebSearchService,
    private readonly multiAgentFlowService: MultiAgentFlowService,
    private readonly mcpIntegrationHandler: McpIntegrationHandlerService,
    private readonly bedrockService: BedrockService,
    @Inject(VectorStoreService)
    private readonly vectorStoreService: VectorStoreService,
    @InjectModel(Usage.name) private usageModel: Model<UsageDocument>,
    @Inject(forwardRef(() => IntegrationChatService))
    private readonly integrationChatService: IntegrationChatService,
    private readonly vercelToolsService: VercelToolsService,
  ) {}

  /**
   * Execute agent query with routing and tool coordination
   */
  async executeAgent(query: AgentQuery): Promise<AgentResponse> {
    const startTime = Date.now();
    const executionTime = Date.now() - startTime;

    try {
      this.loggingService.info('🤖 Executing agent query', {
        userId: query.userId,
        queryLength: query.query.length,
        hasContext: !!query.context,
        conversationId: query.context?.conversationId,
      });

      // Check cache first
      const cacheKey = `agent:${query.userId}:${Buffer.from(query.query).toString('base64').slice(0, 32)}`;
      const cachedResponse =
        await this.cacheService.get<AgentResponse>(cacheKey);

      if (cachedResponse) {
        this.loggingService.info('🤖 Agent response from cache', {
          userId: query.userId,
          cacheKey,
        });
        return {
          ...cachedResponse,
          metadata: {
            ...cachedResponse.metadata,
            fromCache: true,
          },
        };
      }

      const builtContext = query.context?.conversationId
        ? this.contextManager.buildContext(
            query.context.conversationId,
            query.query,
            query.context.previousMessages || [],
          )
        : undefined;
      const context = builtContext
        ? {
            ...builtContext,
            selectedModel:
              query.context?.selectedModel ?? (query.context as any)?.modelId,
            previousMessages: query.context?.previousMessages,
          }
        : query.context;

      // Determine routing strategy (decide expects ConversationContext)
      const routingDecision = await this.routeDecider.decide(
        builtContext || {
          conversationId: generateSecureId('temp').replace('_', '-'),
          currentSubject: undefined,
          currentIntent: 'general',
          lastReferencedEntities: [],
          subjectConfidence: 0.5,
          timestamp: new Date(),
        },
        query.query,
        query.userId,
        query.context?.webSearchEnabled || false,
      );

      // Execute based on routing decision (pass merged context so agent has selectedModel)
      const result = await this.executeWithRouting(
        query,
        routingDecision,
        context,
      );

      // Cache successful responses
      if (result.success && result.response) {
        await this.cacheService.set(cacheKey, result, 300); // 5 minute cache
      }

      this.loggingService.info('🤖 Agent execution completed', {
        userId: query.userId,
        success: result.success,
      });

      return result;
    } catch (error) {
      this.loggingService.error('Agent execution failed', {
        error: error instanceof Error ? error.message : String(error),
        userId: query.userId,
        query: query.query.substring(0, 100),
        executionTime,
      });

      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Agent execution failed',
        metadata: {
          executionTime,
          errorType:
            error instanceof Error ? error.constructor.name : 'Unknown',
        },
      };
    }
  }

  /**
   * Execute agent with specific routing decision
   */
  async executeWithRouting(
    query: AgentQuery,
    route: string,
    context: any,
  ): Promise<AgentResponse> {
    this.loggingService.info('🤖 Executing agent with routing', {
      route,
      userId: query.userId,
      contextKeys: Object.keys(context || {}),
    });

    // Execute based on routing decision
    switch (route) {
      case 'knowledge_base':
        return await this.executeKnowledgeBaseAgent(query, context);

      case 'web_scraper':
        return await this.executeWebScraperAgent(query, context);

      case 'multi_agent':
        return await this.executeMultiAgentWorkflow(query, context);

      case 'conversational_flow':
      default:
        return await this.executeConversationalAgent(query, context);
    }
  }

  /**
   * Get agent capabilities and available tools
   */
  getCapabilities(): {
    tools: string[];
    routes: string[];
    features: string[];
  } {
    return {
      tools: [
        'web_search',
        'knowledge_base',
        'integration_handler',
        'code_executor',
        'file_processor',
      ],
      routes: [
        'knowledge_base',
        'web_scraper',
        'multi_agent',
        'conversational_flow',
      ],
      features: [
        'context_awareness',
        'tool_coordination',
        'multi_agent_orchestration',
        'response_caching',
        'error_recovery',
      ],
    };
  }

  /**
   * Warm up agent services and caches
   */
  async warmup(): Promise<void> {
    this.loggingService.info('🔥 Warming up agent services');

    const warmupStart = Date.now();
    const results = {
      routeDecider: false,
      contextManager: false,
      langchainHelpers: false,
      webSearchService: false,
      multiAgentFlowService: false,
      integrationServices: false,
      cacheService: false,
    };

    try {
      // Test route decider with warmup query
      await this.routeDecider.decide(
        {
          conversationId: 'warmup-' + Date.now(),
          currentSubject: undefined,
          currentIntent: 'test',
          lastReferencedEntities: [],
          subjectConfidence: 0.5,
          timestamp: new Date(),
        },
        'warmup query for testing agent routing capabilities',
        'system',
        false,
      );
      results.routeDecider = true;

      // Test context manager with sample conversation
      this.contextManager.buildContext(
        'warmup-' + Date.now(),
        'test message for context building and entity extraction',
        [
          { role: 'user', content: 'test user message for context analysis' },
          {
            role: 'assistant',
            content: 'test assistant response for context continuity',
          },
        ],
      );
      results.contextManager = true;

      // Test langchain helpers with various inputs
      this.langchainHelpers.analyzeUserIntent(
        'help me optimize AWS costs',
        'intent_analysis',
      );
      this.langchainHelpers.assessComplexity(
        'complex multi-step optimization request with integrations',
      );
      this.langchainHelpers.identifyIntegrationNeeds(
        'connect to github repository and run cost analysis',
      );
      this.langchainHelpers.shouldUseWebSearch('latest AWS pricing changes');
      results.langchainHelpers = true;

      // Test web search service availability and configuration
      const webSearchHealth = await this.webSearchService.checkHealth();
      results.webSearchService = webSearchHealth.healthy;

      if (!webSearchHealth.healthy) {
        this.loggingService.warn('Web search service warmup detected issues', {
          configured: webSearchHealth.configured,
          quotaRemaining: webSearchHealth.quotaRemaining,
          lastError: webSearchHealth.lastError,
        });
      }

      // Test multi-agent flow service capabilities
      const capabilities = this.multiAgentFlowService.getCapabilities();
      if (capabilities.agents && capabilities.agents.length > 0) {
        results.multiAgentFlowService = true;
      }

      // Test integration services availability
      try {
        await this.integrationChatService.detectImplicitMentions(
          'test message',
        );
        results.integrationServices = true;
      } catch (error) {
        this.loggingService.warn('Integration services warmup failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Test cache service connectivity
      const cacheTest = await this.cacheService.ping();
      results.cacheService = cacheTest;

      // Clear any stale cache entries older than 1 hour
      await this.clearCaches();

      const warmupDuration = Date.now() - warmupStart;
      const successfulTests = Object.values(results).filter(Boolean).length;
      const totalTests = Object.keys(results).length;

      this.loggingService.info('🔥 Agent services warmup completed', {
        duration: warmupDuration,
        successRate: `${successfulTests}/${totalTests}`,
        results,
        allHealthy: successfulTests === totalTests,
      });
    } catch (error) {
      const warmupDuration = Date.now() - warmupStart;
      this.loggingService.error('Agent warmup failed with critical error', {
        error: error instanceof Error ? error.message : String(error),
        duration: warmupDuration,
        partialResults: results,
      });

      // Don't throw - warmup failures shouldn't crash the service
      // The service can still operate with degraded functionality
    }
  }

  /**
   * Get agent health status
   */
  async getHealthStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: Record<string, boolean>;
    metrics: Record<string, number>;
    details: Record<string, any>;
  }> {
    const startTime = Date.now();
    const checks: Record<string, boolean> = {};
    const metrics: Record<string, number> = {};
    const details: Record<string, any> = {};

    try {
      // Check cache service connectivity
      try {
        checks.cacheService = await this.cacheService.ping();
        details.cacheService = { ping: checks.cacheService };
      } catch (error) {
        checks.cacheService = false;
        details.cacheService = {
          error: error instanceof Error ? error.message : String(error),
        };
      }

      // Check route decider (synchronous check)
      try {
        const testDecision = await this.routeDecider.decide(
          {
            conversationId: 'health-check',
            currentSubject: undefined,
            currentIntent: 'health',
            lastReferencedEntities: [],
            subjectConfidence: 0.5,
            timestamp: new Date(),
          },
          'health check query',
          'system',
          false,
        );
        checks.routeDecider = !!testDecision;
        details.routeDecider = { route: testDecision };
      } catch (error) {
        checks.routeDecider = false;
        details.routeDecider = {
          error: error instanceof Error ? error.message : String(error),
        };
      }

      // Check context manager
      try {
        const testContext = this.contextManager.buildContext(
          'health-check',
          'test',
          [],
        );
        checks.contextManager = !!testContext;
        details.contextManager = { contextBuilt: true };
      } catch (error) {
        checks.contextManager = false;
        details.contextManager = {
          error: error instanceof Error ? error.message : String(error),
        };
      }

      // Check langchain helpers
      try {
        const testIntent = this.langchainHelpers.analyzeUserIntent(
          'test query',
          'health',
        );
        const testComplexity =
          this.langchainHelpers.assessComplexity('test query');
        checks.langchainHelpers = !!(testIntent && testComplexity);
        details.langchainHelpers = {
          intent: testIntent,
          complexity: testComplexity,
        };
      } catch (error) {
        checks.langchainHelpers = false;
        details.langchainHelpers = {
          error: error instanceof Error ? error.message : String(error),
        };
      }

      // Check web search service
      try {
        const webSearchHealth = await this.webSearchService.checkHealth();
        checks.webSearchService = webSearchHealth.healthy;
        details.webSearchService = {
          configured: webSearchHealth.configured,
          quotaRemaining: webSearchHealth.quotaRemaining,
          lastUsed: webSearchHealth.lastUsed,
        };
      } catch (error) {
        checks.webSearchService = false;
        details.webSearchService = {
          error: error instanceof Error ? error.message : String(error),
        };
      }

      // Check multi-agent flow service
      try {
        const capabilities = this.multiAgentFlowService.getCapabilities();
        checks.multiAgentFlowService = !!(
          capabilities.agents && capabilities.agents.length > 0
        );
        details.multiAgentFlowService = {
          agents: capabilities.agents?.length || 0,
          workflows: capabilities.workflows?.length || 0,
        };
      } catch (error) {
        checks.multiAgentFlowService = false;
        details.multiAgentFlowService = {
          error: error instanceof Error ? error.message : String(error),
        };
      }

      // Check MCP integration handler
      try {
        const rateLimitStatus =
          await this.mcpIntegrationHandler.getRateLimitStatus(
            'system',
            'github',
          );
        checks.mcpIntegrationHandler = true;
        details.mcpIntegrationHandler = { rateLimitChecked: true };
      } catch (error) {
        checks.mcpIntegrationHandler = false;
        details.mcpIntegrationHandler = {
          error: error instanceof Error ? error.message : String(error),
        };
      }

      // Check integration chat service
      try {
        const mentions =
          await this.integrationChatService.detectImplicitMentions(
            'test github integration',
          );
        checks.integrationChatService = Array.isArray(mentions);
        details.integrationChatService = {
          mentionsDetected: mentions?.length || 0,
        };
      } catch (error) {
        checks.integrationChatService = false;
        details.integrationChatService = {
          error: error instanceof Error ? error.message : String(error),
        };
      }

      // Gather metrics
      metrics.activeAgents = 4; // knowledge_base, web_scraper, multi_agent, conversational
      metrics.availableTools = this.getCapabilities().tools.length;
      metrics.routes = this.getCapabilities().routes.length;
      metrics.healthCheckDuration = Date.now() - startTime;

      // Determine overall status
      const criticalServices = ['cacheService'];
      const importantServices = [
        'routeDecider',
        'contextManager',
        'langchainHelpers',
      ];
      const optionalServices = [
        'webSearchService',
        'multiAgentFlowService',
        'mcpIntegrationHandler',
        'integrationChatService',
      ];

      const criticalHealthy = criticalServices.every(
        (service) => checks[service],
      );
      const importantHealthy = importantServices.every(
        (service) => checks[service],
      );
      const optionalHealthy = optionalServices.every(
        (service) => checks[service],
      );

      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

      if (!criticalHealthy) {
        status = 'unhealthy';
      } else if (!importantHealthy) {
        status = 'degraded';
      } else if (!optionalHealthy) {
        status = 'degraded'; // Optional services down but core functionality works
      }

      const totalServices = Object.keys(checks).length;
      const healthyServices = Object.values(checks).filter(Boolean).length;

      return {
        status,
        checks,
        metrics: {
          ...metrics,
          healthyServices,
          totalServices,
          healthPercentage: Math.round((healthyServices / totalServices) * 100),
        },
        details,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.loggingService.error('Health check failed catastrophically', {
        error: error instanceof Error ? error.message : String(error),
        duration,
      });

      return {
        status: 'unhealthy',
        checks: {
          healthCheckSystem: false,
        },
        metrics: {
          duration,
          error: 1,
        },
        details: {
          criticalError: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Execute knowledge base agent
   */
  private async executeKnowledgeBaseAgent(
    query: AgentQuery,
    context?: any,
  ): Promise<AgentResponse> {
    const startTime = Date.now();

    try {
      this.loggingService.info('📚 Executing knowledge base agent', {
        userId: query.userId,
        queryLength: query.query.length,
        hasContext: !!context,
      });

      // Analyze query to determine knowledge domains
      const queryAnalysis = this.langchainHelpers.analyzeUserIntent(
        query.query,
        'knowledge_base',
      ) as string | { domains?: string[]; complexity?: string };
      const analysisObj =
        typeof queryAnalysis === 'object' && queryAnalysis !== null
          ? queryAnalysis
          : {};
      // Build search context
      const searchContext = {
        query: query.query,
        userId: query.userId,
        domains: analysisObj.domains || ['general'],
        complexity: analysisObj.complexity || 'simple',
        context: context,
      };

      // Execute knowledge base search using available documentation and guides
      const searchResults =
        await this.performKnowledgeBaseSearch(searchContext);

      const executionTime = Date.now() - startTime;
      const responseText = this.formatKnowledgeBaseResponse(
        searchResults,
        query.query,
      );

      return {
        success: true,
        response: responseText,
        metadata: {
          tokensUsed: Math.floor(
            (query.query.length + responseText.length) / 4,
          ),
          executionTime,
          sources: searchResults.sources,
          knowledgeEnhanced: true,
          knowledgeContextLength: searchResults.totalContextLength,
        },
        thinking: {
          title: 'Knowledge Base Search',
          steps: [
            {
              step: 1,
              description: 'Analyzed query for knowledge domains',
              reasoning: `Identified domains: ${searchContext.domains.join(', ')}`,
              outcome: 'Search scope defined',
            },
            {
              step: 2,
              description: 'Searched knowledge base',
              reasoning: `Executed semantic search across ${searchResults.sources.length} sources`,
              outcome: `Found ${searchResults.results.length} relevant results`,
            },
            {
              step: 3,
              description: 'Synthesized response',
              reasoning: 'Combined and formatted knowledge base results',
              outcome: 'Response generated',
            },
          ],
          summary: 'Knowledge base search completed successfully',
        },
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.loggingService.error('Knowledge base agent failed', {
        error: error instanceof Error ? error.message : String(error),
        userId: query.userId,
        executionTime,
      });

      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Knowledge base search failed',
        metadata: {
          executionTime,
          errorType: 'knowledge_base_error',
        },
      };
    }
  }

  /**
   * Execute web scraper agent
   */
  private async executeWebScraperAgent(
    query: AgentQuery,
    context?: any,
  ): Promise<AgentResponse> {
    const startTime = Date.now();

    try {
      this.loggingService.info('🌐 Executing web scraper agent', {
        userId: query.userId,
        queryLength: query.query.length,
        hasContext: !!context,
      });

      // Determine if web search is needed
      const webSearchDecision = await this.langchainHelpers.shouldUseWebSearch(
        query.query,
        context,
      );

      if (!webSearchDecision.required) {
        return {
          success: true,
          response:
            'Web search not required for this query. Using existing knowledge base.',
          metadata: {
            tokensUsed: Math.floor(query.query.length / 4),
            executionTime: Date.now() - startTime,
            webSearchUsed: false,
            aiWebSearchDecision: webSearchDecision,
          },
        };
      }

      // Execute web search
      const searchOptions = {
        maxResults: 5,
        deepContent: true,
      };
      const searchResults = await this.webSearchService.search(
        query.query,
        searchOptions,
      );

      const executionTime = Date.now() - startTime;
      const responseText = this.formatWebSearchResponse(searchResults);

      return {
        success: true,
        response: responseText,
        metadata: {
          tokensUsed: Math.floor(
            (query.query.length + responseText.length) / 4,
          ),
          executionTime,
          sources: searchResults.map((r) => r.url),
          webSearchUsed: true,
          aiWebSearchDecision: webSearchDecision,
        },
        thinking: {
          title: 'Web Search & Scraping',
          steps: [
            {
              step: 1,
              description: 'Analyzed search requirements',
              reasoning: webSearchDecision.reason,
              outcome: 'Search strategy defined',
            },
            {
              step: 2,
              description: 'Executed web search',
              reasoning: `Searched for "${query.query}" across web sources`,
              outcome: `Retrieved ${searchResults.length} results`,
            },
            {
              step: 3,
              description: 'Processed and filtered results',
              reasoning: 'Extracted relevant content and removed duplicates',
              outcome: 'Content synthesized',
            },
          ],
          summary: 'Web scraping completed successfully',
        },
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.loggingService.error('Web scraper agent failed', {
        error: error instanceof Error ? error.message : String(error),
        userId: query.userId,
        executionTime,
      });

      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Web search and scraping failed',
        metadata: {
          executionTime,
          errorType: 'web_search_error',
          webSearchUsed: true,
        },
      };
    }
  }

  /**
   * Execute multi-agent workflow
   */
  private async executeMultiAgentWorkflow(
    query: AgentQuery,
    context?: any,
  ): Promise<AgentResponse> {
    const startTime = Date.now();

    try {
      this.loggingService.info('🤝 Executing multi-agent workflow', {
        userId: query.userId,
        queryLength: query.query.length,
        hasContext: !!context,
      });

      // Execute multi-agent flow using the service's main method
      const multiAgentQuery: MultiAgentQuery = {
        userId: query.userId,
        query: query.query,
        context: context,
        priority: 'medium',
        requiredAgents: ['master_coordinator'], // Start with master coordinator
      };

      const workflowResult =
        await this.multiAgentFlowService.executeMultiAgentFlow(multiAgentQuery);

      const executionTime = Date.now() - startTime;
      const taskClassification = (
        workflowResult as {
          taskClassification?: {
            taskType?: string;
            complexity?: string;
            requiredAgents?: string[];
          };
        }
      ).taskClassification ?? {
        taskType: 'general',
        complexity: 'medium',
        requiredAgents: [] as string[],
      };
      const extendedResult = workflowResult as {
        tokensUsed?: number;
        sources?: string[];
      };

      return {
        success: workflowResult.success,
        response: workflowResult.response,
        error: workflowResult.error,
        metadata: {
          tokensUsed:
            extendedResult.tokensUsed ?? Math.floor(query.query.length / 4),
          executionTime,
          sources: extendedResult.sources ?? ['multi_agent_coordination'],
          langchainEnhanced: true,
          ...workflowResult.metadata,
        },
        thinking: {
          title: 'Multi-Agent Coordination',
          steps: [
            {
              step: 1,
              description: 'Analyzed task complexity',
              reasoning: `Classified as ${taskClassification.taskType} with complexity ${taskClassification.complexity}`,
              outcome: `${taskClassification.requiredAgents?.length ?? 0} agents assigned`,
            },
            {
              step: 2,
              description: 'Coordinated agent execution',
              reasoning: 'Managed inter-agent communication and handoffs',
              outcome: 'Complex task completed',
            },
            ...(
              (
                workflowResult as {
                  thinking?: {
                    steps?: Array<{
                      step: number;
                      description: string;
                      reasoning: string;
                      outcome?: string;
                    }>;
                  };
                }
              ).thinking?.steps ?? []
            ).filter(
              (
                s,
              ): s is {
                step: number;
                description: string;
                reasoning: string;
                outcome?: string;
              } =>
                typeof s === 'object' &&
                s !== null &&
                'step' in s &&
                'description' in s &&
                'reasoning' in s,
            ),
          ],
          summary: workflowResult.success
            ? 'Multi-agent workflow executed successfully'
            : 'Multi-agent workflow encountered issues',
        },
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.loggingService.error('Multi-agent workflow failed', {
        error: error instanceof Error ? error.message : String(error),
        userId: query.userId,
        executionTime,
      });

      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Multi-agent workflow failed',
        metadata: {
          executionTime,
          errorType: 'multi_agent_error',
          langchainEnhanced: true,
        },
      };
    }
  }

  /**
   * Execute conversational agent
   */
  private async executeConversationalAgent(
    query: AgentQuery,
    context?: any,
  ): Promise<AgentResponse> {
    const startTime = Date.now();

    try {
      this.loggingService.info('💬 Executing conversational agent', {
        userId: query.userId,
        queryLength: query.query.length,
        hasContext: !!context,
      });

      // Analyze conversational intent and integration needs
      const intentAnalysis = this.langchainHelpers.analyzeUserIntent(
        query.query,
        'conversational',
      );
      const integrations = this.langchainHelpers.identifyIntegrationNeeds(
        query.query,
      );

      let response = '';
      let sources = ['conversational_ai'];
      let hasIntegrationResponse = false;

      // Handle integration commands if detected
      if (integrations.length > 0) {
        try {
          const integrationResults = await this.handleIntegrationCommands(
            query,
            integrations,
          );
          if (integrationResults.length > 0) {
            response = this.formatIntegrationResponse(integrationResults);
            sources = ['integration_commands'];
            hasIntegrationResponse = true;
          }
        } catch (integrationError) {
          this.loggingService.warn(
            'Integration handling failed, falling back to conversational',
            {
              error:
                integrationError instanceof Error
                  ? integrationError.message
                  : String(integrationError),
              userId: query.userId,
            },
          );
        }
      }

      // Generate conversational response if no integration commands were handled
      if (!hasIntegrationResponse) {
        response = await this.generateConversationalResponse(
          query,
          context,
          intentAnalysis,
        );
      }

      const executionTime = Date.now() - startTime;

      return {
        success: true,
        response,
        metadata: {
          tokensUsed: Math.floor((query.query.length + response.length) / 4),
          executionTime,
          sources,
          knowledgeEnhanced: !hasIntegrationResponse,
        },
        thinking: {
          title: 'Conversational Processing',
          steps: [
            {
              step: 1,
              description: 'Analyzed conversational intent',
              reasoning: `Identified intent: ${(intentAnalysis as { intent?: string })?.intent ?? (typeof intentAnalysis === 'string' ? intentAnalysis : 'general')}`,
              outcome: `Found ${integrations.length} integration needs`,
            },
            {
              step: 2,
              description: hasIntegrationResponse
                ? 'Executed integration commands'
                : 'Generated conversational response',
              reasoning: hasIntegrationResponse
                ? 'Processed integration requests and executed commands'
                : 'Created contextually appropriate conversational reply',
              outcome: 'Response formulated',
            },
          ],
          summary: 'Conversational interaction completed successfully',
        },
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.loggingService.error('Conversational agent failed', {
        error: error instanceof Error ? error.message : String(error),
        userId: query.userId,
        executionTime,
      });

      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Conversational processing failed',
        metadata: {
          executionTime,
          errorType: 'conversational_error',
        },
      };
    }
  }

  /**
   * Clear agent caches and reset state
   */
  async clearCaches(): Promise<void> {
    this.loggingService.info('🧹 Clearing agent caches');

    try {
      // Clear agent-related cache entries
      // Use specific prefixes to avoid affecting other cached data
      const agentCacheKeys = [
        'agent:',
        'route:',
        'context:',
        'kb:',
        'websearch:',
      ];

      // Attempt to clear known cache patterns
      const cacheSupportsPatternDeletion =
        typeof this.cacheService.deleteByPattern === 'function';

      if (cacheSupportsPatternDeletion) {
        for (const prefix of agentCacheKeys) {
          try {
            const deletedCount = await this.cacheService.deleteByPattern(
              `${prefix}*`,
            );
            this.loggingService.debug('Cleared cache entries by pattern', {
              prefix,
              deletedCount,
            });
          } catch (error) {
            this.loggingService.warn('Pattern deletion failed for prefix', {
              prefix,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } else {
        this.loggingService.warn(
          'Cache service does not support pattern deletion. Consider implementing clearAll() or individual key deletion as fallback.',
          {
            agentCacheKeys,
          },
        );

        // Fallback: try to clear all cache if available
        if (typeof (this.cacheService as any).clearAll === 'function') {
          try {
            await (this.cacheService as any).clearAll();
            this.loggingService.info('Cleared all cache as fallback');
          } catch (error) {
            this.loggingService.error('Fallback cache clear failed', {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      this.loggingService.info('🧹 Agent caches cleared successfully');
    } catch (error) {
      this.loggingService.error('Failed to clear agent caches', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - cache clearing failures shouldn't crash the service
    }
  }

  /**
   * 4-stage multi-LLM orchestration pipeline (Express parity)
   * Stage 1: AI analysis for web search requirement
   * Stage 2: Tool selection and execution
   * Stage 3: Response orchestration
   * Stage 4: Result synthesis
   */
  async queryWithMultiLlm(queryData: AgentQuery): Promise<AgentResponse> {
    const startTime = Date.now();

    try {
      this.loggingService.info(
        '🚀 Processing query with multi-LLM orchestration',
        {
          userId: queryData.userId,
          query: queryData.query.substring(0, 100),
        },
      );

      // Stage 1: AI analysis for web search requirement
      const initialAnalysis = await this.analyzeQueryForWebSearch(
        queryData.query,
      );

      // Stage 2: Route to appropriate handler based on analysis
      if (initialAnalysis.requiresWebSearch) {
        this.loggingService.info(
          '✅ Web search required, routing to web scraper agent',
        );
        return await this.executeWebScraperAgent(queryData, initialAnalysis);
      }

      // Check if this should use multi-agent workflow
      const conversationId =
        queryData.context?.conversationId ?? `anon-${queryData.userId}`;
      const context = this.contextManager.getContext(conversationId) ?? {
        conversationId,
        lastReferencedEntities: [],
        subjectConfidence: 0.5,
        timestamp: new Date(),
      };
      const routeDecision = await this.routeDecider.decide(
        context,
        queryData.query,
        queryData.userId,
      );

      if (routeDecision === 'multi_agent') {
        this.loggingService.info('🎯 Multi-agent route selected');
        return await this.executeMultiAgentWorkflow(queryData);
      }

      // Stage 3: Default to conversational agent
      this.loggingService.info('💬 Using conversational agent');
      const response = await this.executeConversationalAgent(queryData);

      const executionTime = Date.now() - startTime;

      return {
        success: true,
        response: response.response,
        metadata: {
          executionTime,
          sources: response.metadata?.sources || [],
          fromCache: false,
          webSearchUsed: initialAnalysis.requiresWebSearch,
          aiWebSearchDecision: {
            required: initialAnalysis.requiresWebSearch,
            reason: initialAnalysis.searchReason || 'Not needed',
          },
        },
        thinking: response.thinking || {
          title: 'Query processed via conversational agent',
          summary: 'Standard conversational response generated',
          steps: [],
        },
      };
    } catch (error: any) {
      this.loggingService.error('Multi-LLM query processing failed', {
        error: error.message,
        userId: queryData.userId,
      });

      return {
        success: false,
        error: error.message,
        response:
          'Failed to process your query with multi-LLM orchestration. Please try again.',
        metadata: {
          executionTime: Date.now() - startTime,
          errorType: 'orchestration_failure',
        },
      };
    }
  }

  /**
   * Analyze query to determine if web search is needed (Stage 1)
   */
  private async analyzeQueryForWebSearch(query: string): Promise<{
    requiresWebSearch: boolean;
    searchReason?: string;
    confidence?: number;
  }> {
    // Simple heuristic-based analysis (can be enhanced with AI later)
    const webSearchKeywords = [
      'latest',
      'current',
      'news',
      'today',
      'recent',
      '2024',
      '2023',
      'price',
      'cost',
      'pricing',
      'market',
      'trending',
      'popular',
      'real-time',
      'live',
      'now',
      'update',
      'breaking',
    ];

    const lowerQuery = query.toLowerCase();
    const hasWebSearchTrigger = webSearchKeywords.some((keyword) =>
      lowerQuery.includes(keyword),
    );

    return {
      requiresWebSearch: hasWebSearchTrigger,
      searchReason: hasWebSearchTrigger
        ? 'Query contains time-sensitive or market keywords'
        : 'Not needed',
      confidence: hasWebSearchTrigger ? 0.8 : 0.2,
    };
  }

  /**
   * Generate visible AI thinking process for different query types (Express parity)
   * Returns structured thinking data for UI display
   */
  private generateThinkingProcess(query: string): any {
    const lowerQuery = query.toLowerCase();

    // COST & SPENDING QUERIES
    const isCostQuery =
      lowerQuery.includes('cost') ||
      lowerQuery.includes('money') ||
      lowerQuery.includes('spend') ||
      lowerQuery.includes('expensive') ||
      lowerQuery.includes('price') ||
      lowerQuery.includes('budget') ||
      lowerQuery.includes('model') ||
      lowerQuery.includes('usage');

    if (isCostQuery) {
      return {
        title: 'Analyzing your AI cost data',
        summary:
          'I need to query your actual usage data to provide accurate cost insights based on your real spending patterns.',
        steps: [
          {
            step: 1,
            description: 'Data Retrieval',
            reasoning:
              "First, I'll query your usage database to get your actual AI model spending data, including costs by model, service, and time period.",
            outcome: 'Retrieved your real usage data from database',
          },
          {
            step: 2,
            description: 'Cost Analysis',
            reasoning:
              "I'll analyze your spending patterns to identify which models consume the most budget and calculate total expenditures.",
            outcome: 'Identified your highest-cost models and spending trends',
          },
          {
            step: 3,
            description: 'Data Aggregation',
            reasoning:
              "I'll aggregate the costs by different dimensions (model, provider, time) to give you comprehensive insights.",
            outcome: 'Summarized your costs with actionable breakdowns',
          },
          {
            step: 4,
            description: 'Optimization Recommendations',
            reasoning:
              "Based on your actual spending patterns, I'll suggest specific optimizations to reduce costs.",
            outcome: 'Generated personalized cost optimization strategies',
          },
        ],
      };
    }

    // API CONFIGURATION QUERIES
    const isApiConfigQuery =
      lowerQuery.includes('api') ||
      lowerQuery.includes('configure') ||
      lowerQuery.includes('settings') ||
      lowerQuery.includes('key') ||
      lowerQuery.includes('integration') ||
      lowerQuery.includes('endpoint');

    if (isApiConfigQuery) {
      return {
        title: 'Configuring your API settings',
        summary:
          "I'll analyze your current integrations and guide you through optimizing your API configurations for better cost efficiency.",
        steps: [
          {
            step: 1,
            description: 'Integration Assessment',
            reasoning:
              "First, I'll check which AI providers and tools you have connected to understand your current setup.",
            outcome: 'Reviewed your active integrations and API keys',
          },
          {
            step: 2,
            description: 'Configuration Analysis',
            reasoning:
              "I'll analyze your current API settings to identify optimization opportunities and potential issues.",
            outcome:
              'Identified configuration improvements and security enhancements',
          },
        ],
      };
    }

    // MODEL COMPARISON QUERIES
    const isModelQuery =
      lowerQuery.includes('model') ||
      lowerQuery.includes('compare') ||
      lowerQuery.includes('vs') ||
      lowerQuery.includes('versus') ||
      lowerQuery.includes('better') ||
      lowerQuery.includes('best');

    if (isModelQuery) {
      return {
        title: 'Comparing AI models',
        summary:
          "I'll analyze different AI models to help you choose the best option for your specific use case.",
        steps: [
          {
            step: 1,
            description: 'Use Case Analysis',
            reasoning:
              'Understanding your specific requirements to recommend the most suitable models.',
            outcome: 'Analyzed your use case requirements',
          },
          {
            step: 2,
            description: 'Model Comparison',
            reasoning:
              'Comparing models based on performance, cost, and capabilities for your use case.',
            outcome: 'Generated model comparison with recommendations',
          },
        ],
      };
    }

    // WEB SEARCH QUERIES
    const isWebSearchQuery =
      lowerQuery.includes('latest') ||
      lowerQuery.includes('current') ||
      lowerQuery.includes('news') ||
      lowerQuery.includes('today') ||
      lowerQuery.includes('recent') ||
      lowerQuery.includes('search');

    if (isWebSearchQuery) {
      return {
        title: 'Searching for current information',
        summary:
          "I'll search the web to find the most up-to-date information for your query.",
        steps: [
          {
            step: 1,
            description: 'Query Analysis',
            reasoning:
              'Understanding what specific information you need to search for.',
            outcome: 'Prepared targeted search queries',
          },
          {
            step: 2,
            description: 'Web Search',
            reasoning:
              'Searching reliable sources for current and accurate information.',
            outcome: 'Retrieved relevant search results',
          },
          {
            step: 3,
            description: 'Information Synthesis',
            reasoning:
              'Combining and summarizing the most relevant information from search results.',
            outcome: 'Provided comprehensive answer with sources',
          },
        ],
      };
    }

    // DEFAULT THINKING PROCESS
    return {
      title: 'Processing your query',
      summary: "I'll analyze your request and provide a helpful response.",
      steps: [
        {
          step: 1,
          description: 'Query Analysis',
          reasoning:
            'Understanding your request and determining the best approach.',
          outcome: 'Analyzed query requirements',
        },
        {
          step: 2,
          description: 'Response Generation',
          reasoning: 'Generating a comprehensive and helpful response.',
          outcome: 'Created response tailored to your needs',
        },
      ],
    };
  }

  /**
   * Add learning insight to knowledge base (Express parity)
   */
  async addLearning(
    insight: string,
    metadata: Record<string, any> = {},
  ): Promise<void> {
    try {
      this.loggingService.info('Learning insight captured', {
        insight: insight.substring(0, 100),
        metadataKeys: Object.keys(metadata),
      });

      // Persist learning insight to vector store for future retrieval
      await this.vectorStoreService.addKnowledge(insight, {
        ...metadata,
        learningSource: 'agent_interaction',
        timestamp: new Date().toISOString(),
      });

      this.loggingService.info('Learning insight persisted to vector store', {
        insightLength: insight.length,
        metadataKeys: Object.keys(metadata),
      });
    } catch (error) {
      this.loggingService.error('Failed to add learning', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - learning failures shouldn't break the main flow
    }
  }

  /**
   * Coordinate with multiple agents for complex queries (Express parity)
   */
  async coordinateWithAgents(
    primaryQuery: string,
    requiredAgentTypes: string[],
    userId: string,
  ): Promise<{
    coordinationPlan: any;
    agentContexts: { [agentType: string]: string };
    recommendations: any[];
  }> {
    try {
      this.loggingService.info('Multi-agent coordination initiated', {
        userId,
        primaryQuerySubstring: primaryQuery.substring(0, 100),
        requiredAgentTypes,
        agentCount: requiredAgentTypes.length,
      });

      // Get knowledge context for each required agent type
      const agentContexts: { [agentType: string]: string } = {};

      for (const agentType of requiredAgentTypes) {
        agentContexts[agentType] = await this.getAgentKnowledgeContext(
          agentType,
          primaryQuery,
        );
      }

      // Generate coordination recommendations
      const recommendations = this.generateCoordinationRecommendations(
        primaryQuery,
        requiredAgentTypes,
        agentContexts,
      );

      return {
        coordinationPlan: {
          primaryQuery,
          agentTypes: requiredAgentTypes,
          strategy: 'parallel_execution',
        },
        agentContexts,
        recommendations,
      };
    } catch (error: any) {
      this.loggingService.error('Multi-agent coordination failed', {
        userId,
        primaryQuerySubstring: primaryQuery.substring(0, 100),
        requiredAgentTypes,
        errorMessage: error.message,
      });

      throw new Error(`Multi-agent coordination failed: ${error.message}`);
    }
  }

  /**
   * Get knowledge context for a specific agent type (Express parity)
   */
  async getAgentKnowledgeContext(
    agentType: string,
    query: string,
  ): Promise<string> {
    // Simple implementation - can be enhanced with actual knowledge retrieval
    const contexts: { [key: string]: string } = {
      web_search:
        'Specializes in finding current information, news, and real-time data from the internet.',
      mongodb:
        'Expert at database queries, schema analysis, and data retrieval operations.',
      github:
        'Handles repository management, code analysis, and development workflow.',
      vercel:
        'Manages deployments, project configuration, and hosting operations.',
      jira: 'Manages project tracking, issue management, and agile workflows.',
      slack:
        'Handles team communication, notifications, and workspace management.',
    };

    return (
      contexts[agentType] ||
      `General purpose agent capable of handling ${agentType} operations.`
    );
  }

  /**
   * Generate coordination recommendations for multi-agent workflows (Express parity)
   */
  private generateCoordinationRecommendations(
    primaryQuery: string,
    agentTypes: string[],
    agentContexts: { [agentType: string]: string },
  ): any[] {
    // Generate recommendations based on agent types and query
    const recommendations = [];

    if (agentTypes.includes('web_search')) {
      recommendations.push({
        type: 'parallel_search',
        description:
          'Execute web search alongside other operations for comprehensive results',
        priority: 'high',
      });
    }

    if (agentTypes.includes('mongodb') && agentTypes.includes('github')) {
      recommendations.push({
        type: 'data_code_integration',
        description: 'Combine database insights with code repository analysis',
        priority: 'medium',
      });
    }

    return recommendations;
  }

  /**
   * Get Vercel tools for a user if they have a Vercel connection
   */
  async getVercelToolsForUser(userId: string): Promise<Tool[]> {
    try {
      // Check if user has Vercel connection
      const vercelStatus = await this.connectionChecker.check(userId, 'vercel');
      if (!vercelStatus.isConnected) {
        return []; // No Vercel tools available
      }

      // Get the connection ID to create tools
      const connectionId = (vercelStatus as any).connectionId;
      if (!connectionId) {
        this.loggingService.warn(
          'Vercel connection found but no connectionId available',
          {
            userId,
          },
        );
        return [];
      }

      this.loggingService.debug(
        'Vercel connection found, creating tools for user',
        {
          userId,
          connectionId,
          connectionName: (vercelStatus as any).connectionName,
        },
      );

      // Create Vercel tools using the VercelToolsService
      const vercelTools =
        this.vercelToolsService.createVercelTools(connectionId);

      this.loggingService.info(
        `Created ${vercelTools.length} Vercel tools for user`,
        {
          userId,
          toolNames: vercelTools.map((t) => t.name),
        },
      );

      return vercelTools as unknown as Tool[];
    } catch (error) {
      this.loggingService.warn('Failed to create Vercel tools for user', {
        userId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Perform knowledge base search
   */
  private async performKnowledgeBaseSearch(searchContext: any): Promise<{
    results: Array<{
      title: string;
      content: string;
      relevance: number;
      source: string;
    }>;
    sources: string[];
    totalContextLength: number;
  }> {
    const results: Array<{
      title: string;
      content: string;
      relevance: number;
      source: string;
    }> = [];
    const sources: string[] = [];

    try {
      // Get relevant knowledge base entries based on query analysis
      const knowledgeEntries = await this.getKnowledgeBaseEntries(
        searchContext.query,
        searchContext.userId,
      );

      // Score and filter results based on relevance to the query
      const scoredResults = knowledgeEntries
        .map((entry) => ({
          ...entry,
          relevance: this.calculateRelevanceScore(
            searchContext.query,
            entry,
            searchContext.domains,
          ),
        }))
        .filter((result) => result.relevance > 0.3) // Minimum relevance threshold
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, 10); // Top 10 results

      results.push(...scoredResults);

      // Track sources that contributed results
      const contributingSources = new Set(scoredResults.map((r) => r.source));
      sources.push(...Array.from(contributingSources));

      // If no relevant results found, provide fallback general information
      if (results.length === 0) {
        results.push({
          title: 'Cost Katana Overview',
          content:
            'Cost Katana is an AI-powered cost optimization platform that helps developers monitor, analyze, and optimize AI API costs across multiple providers including AWS Bedrock, OpenAI, Anthropic, and Google.',
          relevance: 0.5,
          source: 'general',
        });
        sources.push('general');
      }
    } catch (error) {
      this.loggingService.warn('Knowledge base search failed, using fallback', {
        error: error instanceof Error ? error.message : String(error),
        query: searchContext.query,
      });

      // Fallback to basic information
      results.push({
        title: 'Cost Katana Platform',
        content:
          'Cost Katana provides intelligent cost optimization for AI workloads, real-time monitoring across 400+ AI models, predictive analytics, and automated prompt optimization.',
        relevance: 0.6,
        source: 'platform',
      });
      sources.push('platform');
    }

    const totalContextLength = results.reduce(
      (total, result) => total + result.content.length,
      0,
    );

    this.loggingService.debug('Knowledge base search completed', {
      query: searchContext.query,
      resultsCount: results.length,
      sources: sources.join(', '),
      totalContextLength,
    });

    return {
      results,
      sources,
      totalContextLength,
    };
  }

  /**
   * Query user's real analytics data from the database
   * Returns formatted analytics information for injection into responses
   */
  private async queryUserAnalytics(userId: string): Promise<string> {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const [aggResult, recentUsage] = await Promise.all([
        this.usageModel
          .aggregate([
            {
              $match: {
                userId: userId,
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
                avgCostPerRequest: { $avg: '$cost' },
              },
            },
          ])
          .exec(),
        this.usageModel
          .find({ userId })
          .sort({ createdAt: -1 })
          .limit(5)
          .select('model provider cost createdAt')
          .lean(),
      ]);

      const stats = aggResult[0] ?? {
        totalCost: 0,
        totalRequests: 0,
        totalTokens: 0,
        uniqueModels: [],
        uniqueProviders: [],
        avgCostPerRequest: 0,
      };

      const topModels =
        (stats.uniqueModels as string[]).slice(0, 5).join(', ') || 'none yet';
      const providers =
        (stats.uniqueProviders as string[]).join(', ') || 'none yet';
      const recentActivity =
        recentUsage.length > 0
          ? recentUsage
              .map(
                (u: any) =>
                  `${u.model ?? 'unknown'} ($${u.cost?.toFixed(4) ?? '0'})`,
              )
              .join(', ')
          : 'no recent activity';

      return [
        `Total spend (last 30 days): $${stats.totalCost.toFixed(4)}`,
        `Total API requests (last 30 days): ${stats.totalRequests}`,
        `Total tokens used: ${stats.totalTokens.toLocaleString()}`,
        `Avg cost per request: $${stats.avgCostPerRequest.toFixed(6)}`,
        `Models used: ${topModels}`,
        `Providers: ${providers}`,
        `Recent calls: ${recentActivity}`,
      ].join('\n');
    } catch (error) {
      this.loggingService.warn('Failed to query user analytics', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return 'Analytics data temporarily unavailable.';
    }
  }

  /**
   * Get all available knowledge base entries
   * Returns real user analytics data if query mentions analytics/cost/spend,
   * otherwise returns static platform knowledge
   */
  private async getKnowledgeBaseEntries(
    query?: string,
    userId?: string,
  ): Promise<
    Array<{
      title: string;
      content: string;
      source: string;
      tags: string[];
    }>
  > {
    // Check if query mentions analytics/cost/spend keywords
    const analyticsKeywords = [
      'spend',
      'cost',
      'analytics',
      'usage',
      'requests',
      'tokens',
      'models',
      'budget',
      'expensive',
      'cheaper',
      'optimization',
    ];
    const isAnalyticsQuery =
      query &&
      analyticsKeywords.some((keyword) =>
        query.toLowerCase().includes(keyword),
      );

    if (isAnalyticsQuery && userId) {
      try {
        const realAnalytics = await this.queryUserAnalytics(userId);
        return [
          {
            title: 'Your Cost Katana Analytics',
            content: realAnalytics,
            source: 'user_analytics',
            tags: ['analytics', 'cost', 'usage', 'real_data'],
          },
        ];
      } catch (error) {
        this.loggingService.warn(
          'Failed to get real analytics, falling back to static KB',
          {
            userId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    // Fall back to static knowledge base entries
    return [
      // Platform Overview
      {
        title: 'Cost Katana Overview',
        content:
          "Cost Katana is the world's first AI-powered cost optimization platform designed to help developers and organizations monitor, analyze, and optimize their AI API costs across multiple providers.",
        source: 'platform',
        tags: ['overview', 'platform', 'introduction'],
      },

      // Getting Started
      {
        title: 'Getting Started with Cost Katana',
        content:
          'To get started with Cost Katana: 1) Create an account, 2) Connect your AI provider accounts, 3) Set up cost monitoring, 4) Configure optimization rules, 5) Start using the chat interface for cost-aware AI interactions.',
        source: 'getting-started',
        tags: ['getting-started', 'setup', 'onboarding'],
      },

      // Cost Optimization
      {
        title: 'AI Cost Optimization Strategies',
        content:
          'Key strategies for AI cost optimization: 1) Model selection based on cost-performance curves, 2) Prompt optimization to reduce token usage by 40-75%, 3) Semantic caching for repeated queries, 4) Usage pattern analysis and automated model switching, 5) Batch processing for high-volume requests.',
        source: 'optimization',
        tags: ['optimization', 'cost-saving', 'strategies'],
      },

      // Model Selection
      {
        title: 'Choosing the Right AI Model',
        content:
          'Select AI models based on your use case: For text generation use GPT-4 for quality or Claude-3 for cost-efficiency. For analysis tasks, consider specialized models like GPT-3.5-turbo. Cost Katana automatically recommends the optimal model based on your requirements and budget.',
        source: 'models',
        tags: ['models', 'selection', 'recommendation'],
      },

      // Integration Guides
      {
        title: 'AWS Bedrock Integration',
        content:
          'Integrate AWS Bedrock with Cost Katana: Configure your AWS credentials, set up IAM permissions for Bedrock access, enable cost tracking, and use the unified API for seamless model switching based on cost and performance.',
        source: 'integrations',
        tags: ['aws', 'bedrock', 'integration'],
      },

      {
        title: 'OpenAI API Integration',
        content:
          'Connect OpenAI API to Cost Katana: Add your API key, configure rate limits, enable cost monitoring, and use intelligent model routing to automatically switch between GPT-4, GPT-3.5-turbo, and other models based on cost efficiency.',
        source: 'integrations',
        tags: ['openai', 'api', 'integration'],
      },

      {
        title: 'Google AI Integration',
        content:
          "Integrate Google AI services: Connect Gemini models through Vertex AI, enable cost tracking for PaLM and Gemini models, configure automatic failover, and optimize for Google's pricing structure.",
        source: 'integrations',
        tags: ['google', 'gemini', 'vertex-ai', 'integration'],
      },

      // Monitoring and Analytics
      {
        title: 'Real-time Cost Monitoring',
        content:
          'Cost Katana provides real-time monitoring of AI API costs across all connected providers. Track spending by project, model, and time period with detailed breakdowns and cost predictions.',
        source: 'monitoring',
        tags: ['monitoring', 'real-time', 'analytics'],
      },

      // API Documentation
      {
        title: 'Cost Katana API Reference',
        content:
          'The Cost Katana API provides endpoints for: cost monitoring, model recommendations, usage analytics, integration management, and automated optimization. All endpoints support JSON and include comprehensive error handling.',
        source: 'api',
        tags: ['api', 'documentation', 'reference'],
      },

      // Troubleshooting
      {
        title: 'Common Issues and Solutions',
        content:
          'Common issues: API rate limits - implement request queuing; Cost spikes - review usage patterns; Model errors - check provider status; Integration failures - verify credentials and permissions.',
        source: 'troubleshooting',
        tags: ['troubleshooting', 'issues', 'support'],
      },

      // Best Practices
      {
        title: 'Cost Optimization Best Practices',
        content:
          'Best practices: Monitor usage patterns, implement caching strategies, use smaller models for simple tasks, optimize prompt length, batch similar requests, set up cost alerts, and regularly review optimization recommendations.',
        source: 'best-practices',
        tags: ['best-practices', 'optimization', 'efficiency'],
      },

      // Security
      {
        title: 'Security and Compliance',
        content:
          'Cost Katana implements enterprise-grade security: API key encryption, OAuth 2.0 integration, audit logging, GDPR compliance, SOC 2 certification, and secure data handling across all AI providers.',
        source: 'security',
        tags: ['security', 'compliance', 'enterprise'],
      },
    ];
  }

  /**
   * Calculate relevance score for a knowledge base entry
   */
  private calculateRelevanceScore(
    query: string,
    entry: any,
    domains: string[],
  ): number {
    const queryLower = query.toLowerCase();
    const titleLower = entry.title.toLowerCase();
    const contentLower = entry.content.toLowerCase();

    let score = 0;

    // Exact title match gets highest score
    if (titleLower.includes(queryLower) || queryLower.includes(titleLower)) {
      score += 1.0;
    }

    // Content keyword matches
    const queryWords = queryLower
      .split(/\s+/)
      .filter((word) => word.length > 2);
    const contentMatches = queryWords.filter(
      (word) => contentLower.includes(word) || titleLower.includes(word),
    ).length;
    score += (contentMatches / queryWords.length) * 0.7;

    // Domain relevance
    const domainMatches = domains.filter((domain) =>
      entry.tags.some((tag: string) =>
        tag.toLowerCase().includes(domain.toLowerCase()),
      ),
    ).length;
    score += (domainMatches / domains.length) * 0.3;

    // Tag relevance bonus
    const tagMatches = entry.tags.filter((tag: string) =>
      queryLower.includes(tag.toLowerCase()),
    ).length;
    score += tagMatches * 0.2;

    return Math.min(score, 1.0); // Cap at 1.0
  }

  /**
   * Format knowledge base response
   */
  private formatKnowledgeBaseResponse(
    searchResults: any,
    originalQuery: string,
  ): string {
    if (searchResults.results.length === 0) {
      return `I searched our knowledge base for "${originalQuery}" but couldn't find specific relevant information. Could you rephrase your question or provide more context?`;
    }

    let response = `Based on our knowledge base, here's what I found regarding "${originalQuery}":\n\n`;

    searchResults.results.forEach((result: any, index: number) => {
      response += `${index + 1}. **${result.title}**\n`;
      response += `${result.content}\n\n`;
    });

    if (searchResults.sources.length > 0) {
      response += `Sources: ${searchResults.sources.join(', ')}\n`;
    }

    return response;
  }

  /**
   * Format web search response
   */
  private formatWebSearchResponse(searchResults: any[]): string {
    if (!searchResults || searchResults.length === 0) {
      return "I performed a web search but couldn't find relevant current information. This might be due to network issues or very specific search terms.";
    }

    let response = 'Here are the most relevant results from my web search:\n\n';

    searchResults.slice(0, 5).forEach((result, index) => {
      response += `${index + 1}. **${result.title}**\n`;
      response += `   ${result.snippet}\n`;
      response += `   *Source: ${result.url}*\n\n`;
    });

    if (searchResults.length > 5) {
      response += `*And ${searchResults.length - 5} more results available.*\n\n`;
    }

    response +=
      'Please note that web information can change rapidly, so verify current details from the original sources.';

    return response;
  }

  /**
   * Handle integration commands
   */
  private async handleIntegrationCommands(
    query: AgentQuery,
    integrations: string[],
  ): Promise<
    Array<{
      integration: string;
      command: string;
      result: any;
      success: boolean;
    }>
  > {
    const results = [];

    try {
      // First detect implicit mentions in the message
      const mentions = await this.integrationChatService.detectImplicitMentions(
        query.query,
      );

      if (mentions.length === 0) {
        return []; // No mentions detected
      }

      // Parse command using detected mentions
      const parsedCommand = await this.integrationChatService.parseCommand(
        query.query,
        mentions,
      );

      if (!parsedCommand) {
        return []; // No command could be parsed
      }

      // Execute the command
      const result = await this.integrationChatService.executeCommand(
        query.userId,
        parsedCommand,
      );

      results.push({
        integration: parsedCommand.mention.integration,
        command: parsedCommand.type,
        result: result.data,
        success: result.success,
      });
    } catch (error) {
      this.loggingService.warn('Integration command processing failed', {
        error: error instanceof Error ? error.message : String(error),
        userId: query.userId,
        integrations: integrations.join(','),
      });

      results.push({
        integration: integrations[0] || 'unknown',
        command: 'unknown',
        result: { error: 'Command processing failed' },
        success: false,
      });
    }

    return results;
  }

  /**
   * Format integration response
   */
  private formatIntegrationResponse(integrationResults: any[]): string {
    if (integrationResults.length === 0) {
      return "I detected integration needs but couldn't execute any commands. Please try rephrasing your request.";
    }

    let response = "I've executed the following integration commands:\n\n";

    integrationResults.forEach((result, index) => {
      const status = result.success ? '✅ Success' : '❌ Failed';
      response += `${index + 1}. **${result.integration.toUpperCase()}** - ${status}\n`;

      if (result.success) {
        response += `   Command: ${result.command}\n`;
        if (result.result && typeof result.result === 'object') {
          response += `   Result: ${JSON.stringify(result.result, null, 2)}\n`;
        } else {
          response += `   Result: ${result.result}\n`;
        }
      } else {
        response += `   Error: ${result.result?.error || 'Unknown error'}\n`;
      }

      response += '\n';
    });

    return response;
  }

  /**
   * Generate conversational response.
   * When selectedModel is in context, invokes Bedrock with that model.
   * Otherwise falls back to template-based response.
   */
  private async generateConversationalResponse(
    query: AgentQuery,
    context?: any,
    intentAnalysis?: any,
  ): Promise<string> {
    const selectedModel =
      (context?.selectedModel as string | undefined) ||
      (query.context as any)?.selectedModel ||
      (query.context as any)?.modelId ||
      'anthropic.claude-sonnet-4-5-20250929-v1:0';
    const temperature = context?.temperature ?? 0.7;
    const maxTokens = context?.maxTokens ?? 2048;
    const previousMessages = (context?.previousMessages ??
      (query.context as any)?.previousMessages ??
      []) as Array<{ role: string; content: string }>;

    if (selectedModel && selectedModel.trim()) {
      try {
        const prompt = this.buildConversationalPrompt(
          query.query,
          previousMessages,
        );
        const modelMaxTokens = getMaxTokensForModel(selectedModel, 4096);
        const effectiveMaxTokens = Math.min(maxTokens, modelMaxTokens);
        const isNova = selectedModel.toLowerCase().includes('nova');
        const isMetaLlama =
          selectedModel.startsWith('meta.') ||
          selectedModel.toLowerCase().includes('llama');

        let payload: Record<string, unknown>;
        if (isNova) {
          payload = {
            messages: [{ role: 'user', content: [{ text: prompt }] }],
            inferenceConfig: {
              max_new_tokens: effectiveMaxTokens,
              temperature,
            },
          };
        } else if (isMetaLlama) {
          payload = {
            prompt,
            max_gen_len: effectiveMaxTokens,
            temperature,
            top_p: 1,
            top_k: 250,
          };
        } else {
          payload = {
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: effectiveMaxTokens,
            temperature,
            messages: [{ role: 'user', content: prompt }],
          };
        }

        const result = await BedrockService.invokeModelDirectly(
          selectedModel,
          payload,
        );
        const response = result?.response?.trim?.();
        if (response) {
          this.loggingService.info('Conversational response from Bedrock', {
            model: selectedModel,
            promptLength: prompt.length,
            responseLength: response.length,
          });
          return response;
        }
      } catch (err) {
        this.loggingService.warn(
          'Bedrock invocation failed, falling back to template',
          {
            model: selectedModel,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
    }

    return this.langchainHelpers.generateConversationalResponse(
      query.query,
      context,
      intentAnalysis,
    );
  }

  /**
   * Build Cost-Katana-aware prompt with system identity and conversation history
   */
  private buildConversationalPrompt(
    query: string,
    previousMessages: Array<{ role: string; content: string }>,
  ): string {
    const systemBlock = [
      'You are Cost Katana, an AI-powered cost optimization assistant.',
      'Your mission is to help users monitor, analyze, and reduce their AI API spending across all providers.',
      "You have access to this user's actual Cost Katana account data shown below.",
      'Always answer questions about their usage, costs, and models using this data — never say you lack access to their records.',
      '',
      '=== USER ACCOUNT DATA ===',
      'Real-time analytics data will be provided as context when available.',
      '=== END USER ACCOUNT DATA ===',
    ].join('\n');

    const recent = previousMessages.slice(-6);
    const historyLines = recent.map(
      (m) =>
        `${m.role === 'user' ? 'Human' : 'Assistant'}: ${(m.content || '').trim()}`,
    );

    return [
      `System: ${systemBlock}`,
      '',
      ...historyLines,
      `Human: ${query}`,
      'Assistant:',
    ].join('\n\n');
  }
}
