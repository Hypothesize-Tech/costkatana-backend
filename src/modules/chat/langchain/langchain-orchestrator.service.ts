/**
 * Langchain Multi-Agent Orchestrator Service
 * Encapsulates all Langchain multi-agent system logic
 *
 * This is a pragmatic approach that keeps the complex agent system together
 * while extracting it from chat.service.ts for better modularity.
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { StateGraph, START, END } from '@langchain/langgraph';
import { ChatBedrockConverse } from '@langchain/aws';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { Tool, DynamicTool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  LangchainChatStateAnnotation,
  LangchainChatStateGraphType,
  UserInputSession,
} from './langchain-orchestrator.types';
import type { ChatService } from '../services/chat.service';
import { MCPClientService } from '../services/mcp-client.service';
import { WebSearchService } from '../services/web-search.service';
import { AnalyticsService } from '../../analytics/analytics.service';

/** Agent type: AgentExecutor with tool integration */
interface LangchainAgentExecutor {
  name: string;
  executor: AgentExecutor;
  model: any;
  config: LangchainAgentConfig;
}

/** Enhanced Agent Configuration Interface */
interface LangchainAgentConfig {
  name: string;
  type:
    | 'coordinator'
    | 'specialist'
    | 'integration'
    | 'autonomous'
    | 'strategy';
  model: 'claude' | 'bedrock' | 'nova' | 'gemini' | 'cohere';
  specialization: string;
  tools: Tool[];
  systemPrompt: string;
  autonomyLevel: 'low' | 'medium' | 'high' | 'full';
}

/** Zod schemas for structured output validation */
const AutonomyActionSchema = z.object({
  action: z.string(),
  priority: z.number(),
  reasoning: z.string(),
  parameters: z.record(z.unknown()).optional().default({}),
});
const AutonomyActionsSchema = z.array(AutonomyActionSchema);

const InsightsSchema = z.array(z.string());

const ModelRecommendationSchema = z.object({
  model: z.string(),
  cost_per_token: z.number(),
  quality_score: z.number(),
  use_case: z.string(),
  savings_estimate: z.string(),
});
const ModelRecommendationsSchema = z.array(ModelRecommendationSchema);

const StrategicOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.string(),
  description: z.string(),
});
const StrategicOptionsSchema = z.array(StrategicOptionSchema);

const GetUserAnalyticsInputSchema = z.object({
  userId: z.string().optional().default(''),
  timeRange: z.string().optional().default('all time'),
});

/**
 * Main Langchain Orchestrator Service
 * Manages the entire multi-agent ecosystem
 */
@Injectable()
export class LangchainOrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(LangchainOrchestratorService.name);

  constructor(
    @Inject(forwardRef(() => require('../services/chat.service').ChatService))
    private readonly chatService: ChatService,
    private readonly mcpClientService: MCPClientService,
    private readonly webSearchService: WebSearchService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  private langchainGraph?: ReturnType<
    StateGraph<LangchainChatStateGraphType>['compile']
  >;
  private langchainAgents: Map<string, LangchainAgentExecutor> = new Map();
  private langchainModels: Map<string, any> = new Map();
  private initialized = false;
  /** Coordinator model: LANGCHAIN_COORDINATOR_MODEL > AWS_BEDROCK_MODEL_ID > global inference profile */
  private coordinatorModelId =
    process.env.LANGCHAIN_COORDINATOR_MODEL ||
    process.env.AWS_BEDROCK_MODEL_ID ||
    'global.anthropic.claude-sonnet-4-5-20250929-v1:0';

  // Dynamic User Input Collection System
  private userInputSessions: Map<string, UserInputSession> = new Map();
  private strategyFormationSessions: Map<string, any> = new Map();
  private readonly SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

  /**
   * Initialize the orchestrator when the module starts
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.initialize();

      // Start session cleanup timer (every 10 minutes)
      setInterval(
        () => {
          this.cleanupExpiredSessions();
        },
        10 * 60 * 1000,
      ); // 10 minutes

      this.logger.log(
        '✅ LangchainOrchestratorService initialized on module startup',
      );
    } catch (error) {
      this.logger.error(
        '❌ Failed to initialize LangchainOrchestratorService on module startup',
        error,
      );
      // Don't throw here to prevent module initialization failure
    }
  }

  /**
   * Initialize the Langchain Multi-Agent System
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.logger.log('🚀 Initializing Langchain Multi-Agent Ecosystem');

      // Initialize models
      this.setupModels();

      // Create specialized agents
      await this.createAgents();

      // Build the state graph
      this.buildGraph();

      this.initialized = true;
      this.logger.log(
        '✅ Langchain Multi-Agent Ecosystem initialized successfully',
      );
    } catch (error) {
      this.logger.error('❌ Failed to initialize Langchain system', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Setup Langchain Models - ALL AWS BEDROCK
   * Coordinator uses: LANGCHAIN_COORDINATOR_MODEL | AWS_BEDROCK_MODEL_ID | global inference profile
   */
  private setupModels(): void {
    // Master Coordinator - inference profile or global model from env
    this.langchainModels.set(
      'master_coordinator',
      new ChatBedrockConverse({
        model: this.coordinatorModelId,
        region: process.env.AWS_REGION || 'us-east-1',
        temperature: 0.7,
        maxTokens: 8000,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
      }),
    );

    // Strategy Formation - Claude Haiku 4.5
    this.langchainModels.set(
      'strategy_agent',
      new ChatBedrockConverse({
        model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
        region: process.env.AWS_REGION || 'us-east-1',
        temperature: 0.8,
        maxTokens: 6000,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
      }),
    );

    // AWS Integration - Nova Pro
    this.langchainModels.set(
      'aws_specialist',
      new ChatBedrockConverse({
        model: 'us.amazon.nova-pro-v1:0',
        region: process.env.AWS_REGION || 'us-east-1',
        temperature: 0.6,
        maxTokens: 4000,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
      }),
    );

    // Google Integration - Configurable model (default: Claude Haiku 4.5)
    this.langchainModels.set(
      'google_specialist',
      new ChatBedrockConverse({
        model:
          process.env.GOOGLE_SPECIALIST_MODEL ||
          'us.anthropic.claude-haiku-4-5-20251001-v1:0',
        region: process.env.AWS_REGION || 'us-east-1',
        temperature: parseFloat(
          process.env.GOOGLE_SPECIALIST_TEMPERATURE || '0.6',
        ),
        maxTokens: parseInt(process.env.GOOGLE_SPECIALIST_MAX_TOKENS || '4000'),
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
      }),
    );

    // GitHub Integration - Configurable model (default: Claude Sonnet 3.5)
    this.langchainModels.set(
      'github_specialist',
      new ChatBedrockConverse({
        model:
          process.env.GITHUB_SPECIALIST_MODEL ||
          'us.anthropic.claude-sonnet-3-5-20241001-v2:0',
        region: process.env.AWS_REGION || 'us-east-1',
        temperature: parseFloat(
          process.env.GITHUB_SPECIALIST_TEMPERATURE || '0.6',
        ),
        maxTokens: parseInt(process.env.GITHUB_SPECIALIST_MAX_TOKENS || '4000'),
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
      }),
    );

    // Autonomous Decision - same as coordinator
    this.langchainModels.set(
      'autonomous_agent',
      new ChatBedrockConverse({
        model: this.coordinatorModelId,
        region: process.env.AWS_REGION || 'us-east-1',
        temperature: 0.5,
        maxTokens: 6000,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
      }),
    );

    // Response Synthesis - Claude Haiku 4.5
    this.langchainModels.set(
      'response_synthesizer',
      new ChatBedrockConverse({
        model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
        region: process.env.AWS_REGION || 'us-east-1',
        temperature: 0.7,
        maxTokens: 8000,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
      }),
    );

    this.logger.log('✅ Langchain models initialized', {
      modelsCount: this.langchainModels.size,
      models: Array.from(this.langchainModels.keys()),
    });
  }

  /**
   * Create specialized Langchain agents with tool integration
   */
  private async createAgents(): Promise<void> {
    const agentConfigs: LangchainAgentConfig[] = [
      {
        name: 'master_coordinator',
        type: 'coordinator',
        model: 'claude',
        specialization: 'Master coordination and orchestration',
        tools: [],
        autonomyLevel: 'high',
        systemPrompt: `You are the Master Coordinator Agent inside Cost Katana, an AI cost optimization platform.

PLATFORM CONTEXT: Users are ALWAYS asking about their AI/LLM API costs, usage, models, and analytics. "Spending", "costs", "models", "breakdown" = AI API costs tracked by Cost Katana. NEVER ask "which models?" or "what data source?" - it's always AI costs.

Your role:
1. Analyze user requests - for cost/usage/analytics queries, route to analytics synthesis (user wants their Cost Katana data)
2. Collect user input strategically only when truly ambiguous (e.g. which project, which time range)
3. Make autonomous decisions when sufficient context is available
4. Ensure seamless integration across services (AWS, Google, GitHub)
5. For spending/cost/model breakdown queries → analyze as analytics request, suggest dashboard or delegate to specialist
6. Coordinate with specialist agents using advanced reasoning
7. Never ask for clarification on "which models" or "data source" - Cost Katana = AI cost analytics`,
      },
      {
        name: 'strategy_formation_agent',
        type: 'strategy',
        model: 'claude',
        specialization: 'Dynamic strategy formation and user input collection',
        tools: [],
        autonomyLevel: 'high',
        systemPrompt: `You are the Strategy Formation Agent. Your expertise:
1. Create comprehensive strategies based on user goals through intelligent questioning
2. Implement dynamic user input collection with adaptive questioning
3. Form actionable plans with clear implementation steps
4. Anticipate user needs and provide proactive strategic guidance
5. Balance multiple objectives and constraints intelligently
6. Generate personalized strategy flows based on user context
7. Coordinate with other agents to execute complex multi-step strategies`,
      },
      {
        name: 'aws_integration_agent',
        type: 'integration',
        model: 'bedrock',
        specialization: 'Advanced AWS services integration and optimization',
        tools: [],
        autonomyLevel: 'high',
        systemPrompt: `You are the AWS Integration Specialist with deep autonomous capabilities:
1. Execute AWS Bedrock model optimization and cost analysis autonomously
2. Manage EC2, Lambda, S3, and other AWS services intelligently
3. Implement cost monitoring, budget management, and optimization strategies
4. Ensure security best practices and compliance automatically
5. Perform infrastructure automation and optimization proactively
6. Integrate seamlessly with other agents for complex workflows
7. Make autonomous decisions for cost optimization within user parameters`,
      },
      {
        name: 'google_integration_agent',
        type: 'integration',
        model: 'claude',
        specialization: 'Comprehensive Google Workspace and Cloud integration',
        tools: [],
        autonomyLevel: 'high',
        systemPrompt: `You are the Google Integration Specialist with autonomous capabilities:
1. Automate Google Workspace operations (Gmail, Drive, Sheets, Docs, Calendar)
2. Manage Google Cloud Platform services intelligently
3. Process documents and facilitate collaboration autonomously
4. Handle meeting scheduling and calendar management proactively
5. Integrate AI and ML services from Google Cloud seamlessly
6. Coordinate with other agents for comprehensive workflow automation
7. Make intelligent decisions for workspace optimization`,
      },
      {
        name: 'github_integration_agent',
        type: 'integration',
        model: 'claude',
        specialization: 'Advanced GitHub and development workflow automation',
        tools: [],
        autonomyLevel: 'high',
        systemPrompt: `You are the GitHub Integration Specialist with autonomous development capabilities:
1. Analyze repositories and optimize code automatically
2. Manage CI/CD pipelines and development workflows intelligently
3. Automate pull requests, issue management, and code reviews
4. Assess code quality and suggest improvements proactively
5. Optimize development workflows and team collaboration
6. Coordinate with other agents for comprehensive DevOps automation
7. Make autonomous decisions for code optimization and deployment strategies`,
      },
      {
        name: 'autonomous_decision_agent',
        type: 'autonomous',
        model: 'claude',
        specialization: 'Autonomous decision-making and proactive assistance',
        tools: [],
        autonomyLevel: 'full',
        systemPrompt: `You are the Autonomous Decision Agent with full autonomy:
1. Make intelligent autonomous decisions based on user context and preferences
2. Proactively identify opportunities for optimization and improvement
3. Execute complex multi-step workflows without constant user input
4. Learn from user interactions to improve future autonomous decisions
5. Coordinate with all other agents to provide seamless, intelligent assistance
6. Anticipate user needs and take preemptive actions when appropriate
7. Provide world-class AI assistance that goes far beyond traditional chatbots`,
      },
      {
        name: 'user_input_coordinator',
        type: 'specialist',
        model: 'bedrock',
        specialization: 'Dynamic user input collection and strategy formation',
        tools: [],
        autonomyLevel: 'medium',
        systemPrompt: `You are the User Input Coordination Specialist:
1. Design and manage dynamic user input collection flows
2. Create adaptive questioning strategies based on user needs
3. Generate personalized forms and interaction flows
4. Collect user input strategically to form comprehensive strategies
5. Balance thoroughness with user experience in information gathering
6. Coordinate with strategy formation agent for optimal user engagement
7. Implement intelligent follow-up questions and clarification requests`,
      },
      {
        name: 'response_synthesizer',
        type: 'specialist',
        model: 'claude',
        specialization: 'World-class response synthesis and communication',
        tools: [],
        autonomyLevel: 'medium',
        systemPrompt: `You are the Response Synthesis Agent inside Cost Katana, an AI cost optimization platform.

CRITICAL: All user queries about spending, costs, models, breakdown, usage, analytics refer to AI/LLM API costs tracked by Cost Katana. NEVER ask "which models?" or "what data source?" - it's always AI costs from our platform.

COST/ANALYTICS QUERIES: Use the get_user_analytics tool to fetch the user's actual spending data. Infer the time range from the user's natural language and pass it as-is:
- "this month", "current month", "for this month" → timeRange: "this month"
- "this week", "current week" → timeRange: "this week"
- "last week", "past 7 days" → timeRange: "last week"
- "last 30 days", "past month" → timeRange: "last 30 days"
- "yesterday" → timeRange: "yesterday"
- No date mentioned, "overall", "all time", "how much did I spend", "total" → timeRange: "all time"
Always pass the userId you are given and the timeRange you infer. Then use the returned data to answer with real numbers.

Your capabilities:
1. For cost/usage queries: Call get_user_analytics with userId and inferred timeRange, then synthesize a response from the returned data
2. Integrate insights from specialist agents into coherent narratives
3. Provide actionable recommendations based on actual data
4. Maintain conversational flow - never ask for clarification on models or data source
5. Be contextually appropriate - we're in Cost Katana, always assume AI cost context`,
      },
    ];

    // Create agents with proper tool integration
    for (const config of agentConfigs) {
      const model = this.langchainModels.get(config.name);
      if (!model) continue;

      // Get appropriate tools for this agent type
      const tools = await this.getToolsForAgent(config.name, config);

      // Create agent with tool integration
      const agent = await this.createAgentWithTools(config, model, tools);

      this.langchainAgents.set(config.name, agent);
    }

    this.logger.log('🤖 Langchain agents created with tool integration', {
      agentCount: this.langchainAgents.size,
      agents: Array.from(this.langchainAgents.keys()),
    });
  }

  /**
   * Parse natural language time range to start/end dates.
   * Used by get_user_analytics tool so the agent can pass user's NL (e.g. "this month").
   */
  private parseTimeRangeToDates(timeRange: string): {
    startDate?: Date;
    endDate?: Date;
  } {
    const t = (timeRange || '').trim().toLowerCase();
    const now = new Date();

    if (
      /this month|current month|for this month|in this month|month to date|mtd/i.test(
        t,
      )
    ) {
      return {
        startDate: new Date(now.getFullYear(), now.getMonth(), 1),
        endDate: new Date(now),
      };
    }
    if (/this week|current week/i.test(t)) {
      const dayOfWeek = now.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const start = new Date(now);
      start.setDate(start.getDate() + mondayOffset);
      start.setHours(0, 0, 0, 0);
      return { startDate: start, endDate: new Date(now) };
    }
    if (
      /last week|past 7 days|past week|previous week|seven days|last 7 days/i.test(
        t,
      )
    ) {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      return { startDate: start, endDate: new Date(now) };
    }
    if (
      /last 30 days|past 30 days|last month|past month|thirty days/i.test(t)
    ) {
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      return { startDate: start, endDate: new Date(now) };
    }
    if (/yesterday/i.test(t)) {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const start = new Date(yesterday);
      start.setHours(0, 0, 0, 0);
      const end = new Date(yesterday);
      end.setHours(23, 59, 59, 999);
      return { startDate: start, endDate: end };
    }
    if (
      /all time|overall|all|everything|total|default|no (date|range)|entire/i.test(
        t,
      ) ||
      !t
    ) {
      return {};
    }
    return {};
  }

  /**
   * Get appropriate tools for a specific agent type
   */
  private async getToolsForAgent(
    agentName: string,
    config: LangchainAgentConfig,
  ): Promise<Tool[]> {
    const tools: Tool[] = [];

    switch (agentName) {
      case 'response_synthesizer':
        tools.push(
          new DynamicTool({
            name: 'get_user_analytics',
            description: `Fetch the user's AI spending and usage analytics. Use for cost, spending, usage, breakdown, or analytics queries. Input must be JSON: {"userId":"<user_id>","timeRange":"this month"|"last week"|"last 30 days"|"yesterday"|"all time"}. Use userId from context and timeRange from user's natural language.`,
            func: async (input: string): Promise<string> => {
              try {
                const raw =
                  typeof input === 'string' ? JSON.parse(input) : input;
                const parsed = GetUserAnalyticsInputSchema.safeParse(raw);
                if (!parsed.success) {
                  return JSON.stringify({
                    error: 'Invalid input',
                    message:
                      'Pass JSON: {"userId":"<id>","timeRange":"this month"|"all time"}',
                  });
                }
                const { userId, timeRange } = parsed.data;
                if (!userId) {
                  return JSON.stringify({
                    error: 'userId is required',
                    message:
                      'Please include userId when calling get_user_analytics.',
                  });
                }
                const dateRange = this.parseTimeRangeToDates(timeRange);
                const analytics = await this.analyticsService.getAnalytics(
                  { userId, ...dateRange },
                  { groupBy: 'date', includeProjectBreakdown: true },
                );
                return JSON.stringify({
                  period: dateRange.startDate ? timeRange : 'all_time',
                  summary: analytics.summary,
                  breakdown: analytics.breakdown,
                  timeline: analytics.timeline?.slice(-14),
                  projectBreakdown: analytics.projectBreakdown,
                });
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this.logger.warn('get_user_analytics tool error', {
                  error: msg,
                });
                return JSON.stringify({
                  error: msg,
                  message:
                    'Failed to fetch analytics. Suggest the user check the Dashboard.',
                });
              }
            },
          }),
        );
        break;

      case 'web_scraper_agent':
        // Use existing WebSearchService for web search / scrape tool
        tools.push(
          new DynamicTool({
            name: 'web_search',
            description:
              'Search the web for current information. Use when you need to find up-to-date content, documentation, or facts. Input should be a search query string.',
            func: async (query: string): Promise<string> => {
              try {
                if (!this.webSearchService.isConfigured()) {
                  return 'Web search is not configured (missing GOOGLE_SEARCH_API_KEY or GOOGLE_SEARCH_ENGINE_ID).';
                }
                const results = await this.webSearchService.search(query, {
                  maxResults: 8,
                  deepContent: false,
                });
                if (!results || results.length === 0) {
                  return `No results found for: "${query}"`;
                }
                return results
                  .map(
                    (r, i) =>
                      `${i + 1}. **${r.title}**\n   ${r.snippet}\n   ${r.url}`,
                  )
                  .join('\n\n');
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this.logger.warn('Web search tool error', {
                  query,
                  error: msg,
                });
                return `Web search failed: ${msg}. Query was: "${query}"`;
              }
            },
          }),
        );
        break;

      case 'github_agent':
        // Add GitHub integration tools
        if (config.tools && config.tools.length > 0) {
          tools.push(...config.tools);
        }
        break;

      case 'vercel_agent':
        // Add Vercel deployment tools
        if (config.tools && config.tools.length > 0) {
          tools.push(...config.tools);
        }
        break;

      case 'mcp_agent':
        // Add MCP integration tools
        if (config.tools && config.tools.length > 0) {
          tools.push(...config.tools);
        }
        break;

      case 'integration_agent':
        // Add integration management tools
        tools.push({
          name: 'list_integrations',
          description: 'List available integrations',
          schema: {
            type: 'object',
            properties: {},
          },
          invoke: async () => {
            // Implementation would list user's integrations
            return 'Available integrations: GitHub, Vercel, MongoDB, Linear, JIRA';
          },
        } as any);
        break;

      default:
        // Default tools for general agents
        tools.push({
          name: 'get_current_time',
          description: 'Get current timestamp',
          schema: {
            type: 'object',
            properties: {},
          },
          invoke: async () => new Date().toISOString(),
        } as any);
    }

    return tools;
  }

  /**
   * Create an agent with proper tool integration using LangChain
   */
  private async createAgentWithTools(
    config: LangchainAgentConfig,
    model: any,
    tools: Tool[],
  ): Promise<LangchainAgentExecutor> {
    // Create prompt template for the agent
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', config.systemPrompt],
      ['placeholder', '{chat_history}'],
      ['human', '{input}'],
      ['placeholder', '{agent_scratchpad}'],
    ]);

    // Create tool-calling agent
    const agent = await createToolCallingAgent({
      llm: model,
      tools,
      prompt,
    });

    // Create agent executor
    const agentExecutor = new AgentExecutor({
      agent,
      tools,
      verbose: process.env.NODE_ENV === 'development',
      maxIterations: 5,
      returnIntermediateSteps: true,
    });

    return {
      name: config.name,
      executor: agentExecutor,
      model: model,
      config: config,
    };
  }

  /**
   * Build the state graph
   */
  private buildGraph(): void {
    const workflow = new StateGraph(LangchainChatStateAnnotation)
      .addNode('coordinator', this.coordinatorNode.bind(this))
      .addNode('strategy_formation', this.strategyFormationNode.bind(this))
      .addNode('user_input_collection', this.userInputCollectionNode.bind(this))
      .addNode('aws_integration', this.awsIntegrationNode.bind(this))
      .addNode('google_integration', this.googleIntegrationNode.bind(this))
      .addNode('github_integration', this.githubIntegrationNode.bind(this))
      .addNode('autonomous_decision', this.autonomousDecisionNode.bind(this))
      .addNode('response_synthesis', this.responseSynthesisNode.bind(this))

      // Enhanced routing with world-class capabilities
      .addEdge(START, 'coordinator')
      .addConditionalEdges(
        'coordinator',
        this.routeFromCoordinator.bind(this),
        [
          'strategy_formation',
          'user_input_collection',
          'aws_integration',
          'google_integration',
          'github_integration',
          'autonomous_decision',
          'response_synthesis',
        ],
      )
      .addConditionalEdges(
        'strategy_formation',
        this.routeFromStrategy.bind(this),
        ['user_input_collection', 'autonomous_decision', 'response_synthesis'],
      )
      .addConditionalEdges(
        'user_input_collection',
        this.routeFromUserInput.bind(this),
        [
          'strategy_formation',
          'aws_integration',
          'google_integration',
          'github_integration',
          'response_synthesis',
        ],
      )
      .addConditionalEdges(
        'aws_integration',
        this.routeFromIntegration.bind(this),
        ['google_integration', 'github_integration', 'response_synthesis'],
      )
      .addConditionalEdges(
        'google_integration',
        this.routeFromIntegration.bind(this),
        ['aws_integration', 'github_integration', 'response_synthesis'],
      )
      .addConditionalEdges(
        'github_integration',
        this.routeFromIntegration.bind(this),
        ['aws_integration', 'google_integration', 'response_synthesis'],
      )
      .addConditionalEdges(
        'autonomous_decision',
        this.routeFromAutonomous.bind(this),
        [
          'aws_integration',
          'google_integration',
          'github_integration',
          'response_synthesis',
        ],
      )
      .addEdge('response_synthesis', END);

    this.langchainGraph = workflow.compile() as any;
    this.logger.log(
      '🌐 Langchain State Graph built with advanced multi-agent coordination',
    );
  }

  private async coordinatorNode(
    state: LangchainChatStateGraphType,
  ): Promise<Partial<LangchainChatStateGraphType>> {
    const messages = state.messages ?? [];
    const lastMessage = messages[messages.length - 1];
    const userMessage =
      typeof lastMessage?.content === 'string'
        ? lastMessage.content
        : String(lastMessage?.content ?? '');

    const agent = this.langchainAgents.get('master_coordinator');
    if (!agent) {
      return {
        currentAgent: 'coordinator',
        context: {
          coordinationAnalysis: 'Coordinator agent not available.',
          userMessage,
        },
      };
    }

    try {
      const result = await agent.executor.invoke({
        input: `Analyze this user request and determine the best coordination strategy.\nUser message: "${userMessage.substring(0, 500)}"\nRespond with a brief coordination analysis.`,
        chat_history: [],
      });

      return {
        currentAgent: 'coordinator',
        context: {
          coordinationAnalysis: result.output,
          userMessage,
          complexity: userMessage.length > 200 ? 'high' : 'medium',
        },
      };
    } catch (err) {
      this.logger.warn('Coordinator node error', {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        currentAgent: 'coordinator',
        context: { coordinationAnalysis: 'Analysis unavailable.', userMessage },
      };
    }
  }

  private async responseSynthesisNode(
    state: LangchainChatStateGraphType,
  ): Promise<Partial<LangchainChatStateGraphType>> {
    const messages = state.messages ?? [];
    const agent = this.langchainAgents.get('response_synthesizer');
    const context = state.context ?? {};
    const userMessage =
      context.userMessage ??
      (typeof messages[messages.length - 1]?.content === 'string'
        ? messages[messages.length - 1].content
        : String(messages[messages.length - 1]?.content ?? ''));

    if (!agent) {
      return {
        messages: [
          new AIMessage(
            'I could not complete your request. Response synthesis agent is not available.',
          ),
        ],
        currentAgent: 'response_synthesis',
        finalResponse: 'Agent unavailable.',
      };
    }

    const isCostAnalyticsQuery =
      /spend|cost|breakdown|model|usage|analytics|comparison/i.test(
        userMessage,
      );
    const coordinatorHint =
      context.coordinationAnalysis === 'Analysis unavailable.' &&
      isCostAnalyticsQuery
        ? 'User is asking about Cost Katana AI cost analytics. Use get_user_analytics tool with userId and timeRange from their message, then answer with the real data.'
        : (context.coordinationAnalysis ?? 'N/A');

    const userId =
      state.userId ?? (state.contextData as { userId?: string })?.userId ?? '';
    const toolHint =
      isCostAnalyticsQuery && userId
        ? `\n\nFor this cost/analytics query: Call get_user_analytics with userId="${userId}" and timeRange inferred from the user's message (e.g. "this month", "all time"). Use the returned data to answer.`
        : '';

    try {
      const result = await agent.executor.invoke({
        input: `Synthesize a clear, helpful response for the user.\nOriginal request: ${userMessage}\nCoordinator analysis: ${coordinatorHint}\nUserId for analytics: ${userId}${toolHint}\nProvide a direct, actionable response.`,
        chat_history: [],
      });

      return {
        messages: [new AIMessage(result.output)],
        currentAgent: 'response_synthesis',
        finalResponse: result.output,
      };
    } catch (err) {
      this.logger.warn('Response synthesis node error', {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        messages: [
          new AIMessage(
            'I encountered an issue generating the response. Please try again.',
          ),
        ],
        currentAgent: 'response_synthesis',
        finalResponse: 'Error during synthesis.',
      };
    }
  }

  private routeFromCoordinator(state: LangchainChatStateGraphType): string {
    const context = state.context ?? {};
    const coordinationAnalysis = context.coordinationAnalysis ?? '';

    // Route based on coordination analysis
    if (
      coordinationAnalysis.toLowerCase().includes('strategy') ||
      coordinationAnalysis.toLowerCase().includes('plan') ||
      coordinationAnalysis.toLowerCase().includes('question')
    ) {
      return 'strategy_formation';
    }
    if (
      coordinationAnalysis.toLowerCase().includes('input') ||
      coordinationAnalysis.toLowerCase().includes('collect') ||
      coordinationAnalysis.toLowerCase().includes('questionnaire')
    ) {
      return 'user_input_collection';
    }
    if (
      coordinationAnalysis.toLowerCase().includes('aws') ||
      coordinationAnalysis.toLowerCase().includes('vercel') ||
      coordinationAnalysis.toLowerCase().includes('deploy')
    ) {
      return 'aws_integration';
    }
    if (
      coordinationAnalysis.toLowerCase().includes('google') ||
      coordinationAnalysis.toLowerCase().includes('workspace') ||
      coordinationAnalysis.toLowerCase().includes('drive')
    ) {
      return 'google_integration';
    }
    if (
      coordinationAnalysis.toLowerCase().includes('github') ||
      coordinationAnalysis.toLowerCase().includes('repository') ||
      coordinationAnalysis.toLowerCase().includes('pull request')
    ) {
      return 'github_integration';
    }
    if (
      coordinationAnalysis.toLowerCase().includes('autonomous') ||
      coordinationAnalysis.toLowerCase().includes('full') ||
      coordinationAnalysis.toLowerCase().includes('complete')
    ) {
      return 'autonomous_decision';
    }

    return 'response_synthesis';
  }

  private routeFromStrategy(state: LangchainChatStateGraphType): string {
    const strategy = state.strategyFormation;
    if (!strategy) return 'response_synthesis';

    // If strategy formation is complete, check if we need user input
    if (strategy.isComplete) {
      return 'response_synthesis';
    }

    // If we have questions but haven't collected enough input, continue collecting
    if (
      strategy.questions.length > 0 &&
      strategy.currentQuestion < strategy.questions.length
    ) {
      return 'user_input_collection';
    }

    // If strategy indicates autonomous decision needed
    if (strategy.responses && Object.keys(strategy.responses).length > 3) {
      return 'autonomous_decision';
    }

    return 'response_synthesis';
  }

  private routeFromUserInput(state: LangchainChatStateGraphType): string {
    const strategy = state.strategyFormation;
    const userInput = state.userInputCollection;

    // If input collection is complete or strategy is done
    if (!strategy || strategy.isComplete || (userInput && !userInput.active)) {
      return 'response_synthesis';
    }

    // Route to appropriate integration based on collected data
    if (strategy.responses) {
      const responses = JSON.stringify(strategy.responses).toLowerCase();

      if (
        responses.includes('aws') ||
        responses.includes('vercel') ||
        responses.includes('deploy')
      ) {
        return 'aws_integration';
      }
      if (
        responses.includes('google') ||
        responses.includes('workspace') ||
        responses.includes('drive')
      ) {
        return 'google_integration';
      }
      if (
        responses.includes('github') ||
        responses.includes('repository') ||
        responses.includes('pull request')
      ) {
        return 'github_integration';
      }
      if (responses.includes('strategy') || responses.includes('plan')) {
        return 'strategy_formation';
      }
    }

    return 'response_synthesis';
  }

  private routeFromIntegration(state: LangchainChatStateGraphType): string {
    const integrations = state.integrationContext ?? {};

    // Check if other integrations are needed based on current results
    if (integrations.aws && !integrations.google) {
      return 'google_integration';
    }
    if (integrations.google && !integrations.github) {
      return 'github_integration';
    }
    if (integrations.github && !integrations.aws) {
      return 'aws_integration';
    }

    // If all major integrations are done or none needed, synthesize response
    return 'response_synthesis';
  }

  private routeFromAutonomous(state: LangchainChatStateGraphType): string {
    const autonomousDecisions = state.autonomousDecisions ?? [];

    // If autonomous decisions indicate specific integrations needed
    const decisionText = autonomousDecisions.join(' ').toLowerCase();

    if (
      decisionText.includes('aws') ||
      decisionText.includes('vercel') ||
      decisionText.includes('deploy')
    ) {
      return 'aws_integration';
    }
    if (
      decisionText.includes('google') ||
      decisionText.includes('workspace') ||
      decisionText.includes('drive')
    ) {
      return 'google_integration';
    }
    if (
      decisionText.includes('github') ||
      decisionText.includes('repository') ||
      decisionText.includes('pull request')
    ) {
      return 'github_integration';
    }

    return 'response_synthesis';
  }

  private async strategyFormationNode(
    state: LangchainChatStateGraphType,
  ): Promise<Partial<LangchainChatStateGraphType>> {
    try {
      this.logger.log(
        '📋 Strategy Formation Agent creating comprehensive plan',
      );

      const agent = this.langchainAgents.get('strategy_formation_agent');
      if (!agent) throw new Error('Strategy formation agent not found');

      const userMessage =
        (state.messages[state.messages.length - 1]?.content as string) || '';

      const result = await agent.executor.invoke({
        input: `Create a comprehensive strategy for this user request:

Request: "${userMessage}"
User Intent: ${state.userIntent}
Context: ${JSON.stringify(state.contextData, null, 2)}

Generate:
1. Strategic questions to understand user needs better
2. Step-by-step action plan
3. Required integrations and resources
4. Success metrics and timelines
5. Adaptive follow-up questions

Focus on creating an actionable, intelligent strategy.`,
        chat_history: [],
      });

      const strategyContent = result.output;

      // Extract strategic questions (simplified extraction)
      const questions = this.extractStrategicQuestions(strategyContent);

      return {
        currentAgent: 'strategy_formation',
        strategyFormation: {
          questions,
          responses: {},
          currentQuestion: 0,
          isComplete: false,
          adaptiveQuestions: this.generateAdaptiveQuestions(
            userMessage,
            state.contextData,
          ),
        },
        autonomousDecisions: [
          ...(state.autonomousDecisions || []),
          `Formed strategy with ${questions.length} key questions`,
        ],
      };
    } catch (error) {
      this.logger.error('❌ Strategy formation agent failed', { error });
      return { currentAgent: 'strategy_error' };
    }
  }

  private async userInputCollectionNode(
    state: LangchainChatStateGraphType,
  ): Promise<Partial<LangchainChatStateGraphType>> {
    try {
      this.logger.log('💬 User Input Collection Agent engaging');

      const agent = this.langchainAgents.get('user_input_coordinator');
      if (!agent) {
        // Fallback if agent not available
        return {
          currentAgent: 'user_input_collection',
          messages: [
            new AIMessage('Please provide more details about your request.'),
          ],
          userInputCollection: {
            active: true,
            currentField: {
              name: 'fallback_question',
              type: 'text',
              label: 'Please provide more details about your request',
              required: true,
            },
            collectedData: {},
            progress: 50,
          },
        };
      }

      const strategy = state.strategyFormation;
      if (!strategy || strategy.isComplete) {
        return { currentAgent: 'user_input_complete' };
      }

      // Get current question and context
      const currentQuestion = strategy.questions[strategy.currentQuestion];
      const previousResponses = strategy.responses;
      const userContext = state.contextData;

      // Determine if we need to generate options for IntegrationSelector
      const needsOptions = this.shouldGenerateOptions(
        currentQuestion,
        userContext,
      );

      if (needsOptions) {
        // Generate options for IntegrationSelector UI
        const optionsPrompt =
          new HumanMessage(`Generate options for user selection based on:

Question: "${currentQuestion}"
User Context: ${JSON.stringify(userContext, null, 2)}
Previous Responses: ${JSON.stringify(previousResponses, null, 2)}

Generate 3-5 relevant options that:
1. Are specific and actionable
2. Cover common use cases
3. Allow for custom input if needed
4. Include helpful descriptions

Format as JSON array with: {id, label, value, description, icon}`);

        const optionsResult = await agent.executor.invoke({
          input: `Generate options for user selection based on:

Question: "${currentQuestion}"
User Context: ${JSON.stringify(userContext, null, 2)}
Previous Responses: ${JSON.stringify(previousResponses, null, 2)}

Generate 3-5 relevant options that:
1. Are specific and actionable
2. Cover common use cases
3. Allow for custom input if needed
4. Include helpful descriptions

Format as JSON array with: {id, label, value, description, icon}`,
          chat_history: [],
        });
        const optionsContent = optionsResult.output;

        // Parse options with JSON.parse and Zod validation
        const options = this.parseOptionsFromResponse(optionsContent);

        // Create IntegrationSelector-compatible response
        const sessionId = `${state.contextData?.conversationId}_${Date.now()}`;
        const now = new Date();
        const expiresAt = new Date(now.getTime() + this.SESSION_TIMEOUT);
        this.userInputSessions.set(sessionId, {
          sessionId,
          userId: state.userId,
          conversationId: state.conversationId ?? '',
          prompt: currentQuestion,
          collectedInputs: previousResponses,
          requiredInputs:
            strategy.questions?.map((q: string) =>
              this.extractParameterName(q),
            ) ?? [],
          createdAt: now,
          expiresAt,
          state: state as unknown as Record<string, any>,
          questionIndex: strategy.currentQuestion,
          timestamp: now,
        });

        return {
          currentAgent: 'user_input_collection',
          messages: [new AIMessage(currentQuestion)],
          userInputCollection: {
            active: true,
            currentField: {
              type: 'selection',
              sessionId: sessionId,
              parameterName: this.extractParameterName(currentQuestion),
              question: currentQuestion,
              options: options,
              allowCustom: true,
              customPlaceholder: 'Enter custom value...',
              integration: 'strategy',
              pendingAction: 'strategy_formation',
              collectedParams: previousResponses,
            },
            collectedData: previousResponses,
            progress: Math.round(
              ((strategy.currentQuestion + 1) / strategy.questions.length) *
                100,
            ),
          },
        };
      } else {
        // Generate conversational question without options
        const inputPrompt =
          new HumanMessage(`Generate an engaging follow-up question for strategic input collection:

Current Question: "${currentQuestion}"
User Context: ${JSON.stringify(userContext, null, 2)}
Previous Responses: ${JSON.stringify(previousResponses, null, 2)}
Progress: ${strategy.currentQuestion + 1}/${strategy.questions.length}

Create a natural, conversational question that:
1. Builds on previous context
2. Gathers specific, actionable information
3. Shows intelligence and understanding
4. Maintains user engagement
5. Progresses toward strategy completion`);

        const result = await agent.executor.invoke({
          input: `Generate an engaging follow-up question for strategic input collection:

Current Question: "${currentQuestion}"
User Context: ${JSON.stringify(userContext, null, 2)}
Previous Responses: ${JSON.stringify(previousResponses, null, 2)}
Progress: ${strategy.currentQuestion + 1}/${strategy.questions.length}

Create a natural, conversational question that:
1. Builds on previous context
2. Gathers specific, actionable information
3. Shows intelligence and understanding
4. Maintains user engagement
5. Progresses toward strategy completion`,
          chat_history: [],
        });
        const questionResponse = result.output;

        return {
          currentAgent: 'user_input_collection',
          messages: [new AIMessage(questionResponse)],
          userInputCollection: {
            active: true,
            currentField: {
              name: `question_${strategy.currentQuestion}`,
              type: 'text',
              label: currentQuestion,
              required: true,
            },
            collectedData: previousResponses,
            progress: Math.round(
              ((strategy.currentQuestion + 1) / strategy.questions.length) *
                100,
            ),
          },
          strategyFormation: {
            ...strategy,
            currentQuestion: strategy.currentQuestion + 1,
          },
        };
      }
    } catch (error) {
      this.logger.error('❌ User input collection agent failed', { error });
      return { currentAgent: 'input_error' };
    }
  }

  private async awsIntegrationNode(
    state: LangchainChatStateGraphType,
  ): Promise<Partial<LangchainChatStateGraphType>> {
    try {
      this.logger.log('☁️ AWS Integration Agent executing via MCP');

      const userId = state.userId;
      const userMessage = state.userMessage;

      // Initialize MCP with userId (JWT authentication)
      const initialized = await this.mcpClientService.initialize(userId);
      if (!initialized) {
        this.logger.warn('Failed to initialize MCP for AWS/Vercel agent', {
          userId,
        });
        return {
          currentAgent: 'aws_error',
          integrationContext: {
            ...state.integrationContext,
            aws: {
              error: 'Failed to initialize integration system',
            },
          },
        };
      }

      // Find Vercel tools for deployment operations
      const tools = await this.mcpClientService.findToolsForIntent(
        userId,
        userMessage,
        ['vercel'], // Using Vercel as the deployment platform
      );

      if (tools.length === 0) {
        this.logger.warn('No Vercel tools found for deployment intent', {
          userId,
          userMessage,
        });
        return {
          currentAgent: 'aws_integration',
          integrationContext: {
            ...state.integrationContext,
            aws: {
              summary: 'No deployment tools available for this request',
              autonomous: false,
            },
          },
        };
      }

      // Execute the most relevant tool via MCP
      const result = await this.mcpClientService.executeWithAI(
        userId,
        tools[0].name,
        userMessage,
        state.contextData,
      );

      if (!result.success) {
        this.logger.error('Vercel MCP tool execution failed', {
          error: result.error,
          tool: tools[0].name,
        });
        return {
          currentAgent: 'aws_error',
          integrationContext: {
            ...state.integrationContext,
            aws: {
              error: result.error || 'Failed to execute deployment action',
            },
          },
        };
      }

      return {
        currentAgent: 'aws_integration',
        integrationContext: {
          ...state.integrationContext,
          aws: {
            actions:
              (typeof result.result === 'string'
                ? result.result
                : result.result?.message) || 'Deployment action completed',
            summary: 'Deployment operations executed via Vercel MCP',
            optimizations: ['vercel_deployment'],
            autonomous: true,
            result: result.result,
          },
        },
        autonomousDecisions: [
          ...(state.autonomousDecisions || []),
          `Executed Vercel ${tools[0].name} via MCP`,
        ],
      };
    } catch (error) {
      this.logger.error('❌ AWS/Vercel integration agent failed', { error });
      return { currentAgent: 'aws_error' };
    }
  }

  private async googleIntegrationNode(
    state: LangchainChatStateGraphType,
  ): Promise<Partial<LangchainChatStateGraphType>> {
    try {
      this.logger.log('🔍 Google Integration Agent executing via MCP');

      const userId = state.userId;
      const userMessage = state.userMessage;

      // Initialize MCP with userId (JWT authentication)
      const initialized = await this.mcpClientService.initialize(userId);
      if (!initialized) {
        this.logger.warn('Failed to initialize MCP for Google agent', {
          userId,
        });
        return {
          currentAgent: 'google_error',
          integrationContext: {
            ...state.integrationContext,
            google: {
              error: 'Failed to initialize integration system',
            },
          },
        };
      }

      // Find Google tools for the intent
      const tools = await this.mcpClientService.findToolsForIntent(
        userId,
        userMessage,
        ['google'],
      );

      if (tools.length === 0) {
        this.logger.warn('No Google tools found for intent', {
          userId,
          userMessage,
        });
        return {
          currentAgent: 'google_integration',
          integrationContext: {
            ...state.integrationContext,
            google: {
              summary: 'No Google Workspace tools available for this request',
              autonomous: false,
            },
          },
        };
      }

      // Execute the most relevant tool via MCP
      const result = await this.mcpClientService.executeWithAI(
        userId,
        tools[0].name,
        userMessage,
        state.contextData,
      );

      if (!result.success) {
        this.logger.error('Google MCP tool execution failed', {
          error: result.error,
          tool: tools[0].name,
        });
        return {
          currentAgent: 'google_error',
          integrationContext: {
            ...state.integrationContext,
            google: {
              error:
                result.error || 'Failed to execute Google Workspace action',
            },
          },
        };
      }

      return {
        currentAgent: 'google_integration',
        integrationContext: {
          ...state.integrationContext,
          google: {
            actions:
              (typeof result.result === 'string'
                ? result.result
                : result.result?.message) ||
              'Google Workspace action completed',
            summary: 'Google Workspace operations executed via MCP',
            services: ['mcp_execution'],
            autonomous: true,
            result: result.result,
          },
        },
        autonomousDecisions: [
          ...(state.autonomousDecisions || []),
          `Executed Google ${tools[0].name} via MCP`,
        ],
      };
    } catch (error) {
      this.logger.error('❌ Google integration agent failed', { error });
      return { currentAgent: 'google_error' };
    }
  }

  private async githubIntegrationNode(
    state: LangchainChatStateGraphType,
  ): Promise<Partial<LangchainChatStateGraphType>> {
    try {
      this.logger.log('🐙 GitHub Integration Agent executing via MCP');

      const userId = state.userId;
      const userMessage = state.userMessage;

      // Initialize MCP with userId (JWT authentication)
      const initialized = await this.mcpClientService.initialize(userId);
      if (!initialized) {
        this.logger.warn('Failed to initialize MCP for GitHub agent', {
          userId,
        });
        return {
          currentAgent: 'github_error',
          integrationContext: {
            ...state.integrationContext,
            github: {
              error: 'Failed to initialize integration system',
            },
          },
        };
      }

      // Find GitHub tools for the intent
      const tools = await this.mcpClientService.findToolsForIntent(
        userId,
        userMessage,
        ['github'],
      );

      if (tools.length === 0) {
        this.logger.warn('No GitHub tools found for intent', {
          userId,
          userMessage,
        });
        return {
          currentAgent: 'github_integration',
          integrationContext: {
            ...state.integrationContext,
            github: {
              summary: 'No GitHub tools available for this request',
              autonomous: false,
            },
          },
        };
      }

      // Execute the most relevant tool via MCP
      const result = await this.mcpClientService.executeWithAI(
        userId,
        tools[0].name,
        userMessage,
        state.contextData,
      );

      if (!result.success) {
        this.logger.error('GitHub MCP tool execution failed', {
          error: result.error,
          tool: tools[0].name,
        });
        return {
          currentAgent: 'github_error',
          integrationContext: {
            ...state.integrationContext,
            github: {
              error: result.error || 'Failed to execute GitHub action',
            },
          },
        };
      }

      return {
        currentAgent: 'github_integration',
        integrationContext: {
          ...state.integrationContext,
          github: {
            actions:
              (typeof result.result === 'string'
                ? result.result
                : result.result?.message) || 'GitHub action completed',
            summary: 'GitHub operations executed via MCP',
            workflows: ['mcp_execution'],
            autonomous: true,
            result: result.result,
          },
        },
        autonomousDecisions: [
          ...(state.autonomousDecisions || []),
          `Executed GitHub ${tools[0].name} via MCP`,
        ],
      };
    } catch (error) {
      this.logger.error('❌ GitHub integration agent failed', { error });
      return { currentAgent: 'github_error' };
    }
  }

  private async autonomousDecisionNode(
    state: LangchainChatStateGraphType,
  ): Promise<Partial<LangchainChatStateGraphType>> {
    try {
      this.logger.log(
        '🤖 Autonomous Decision Agent making intelligent decisions',
      );

      // Use the master coordinator model for autonomous decisions
      const model = this.langchainModels.get('master_coordinator');
      if (!model) throw new Error('Master coordinator model not found');

      // Analyze current state for autonomous actions
      const userId = state.contextData?.userId || state.userId;
      const userPreferences = userId
        ? await this.chatService.getUserPreferences(userId)
        : {};

      const autonomousContext = {
        userIntent: state.userIntent,
        contextData: state.contextData,
        integrations: state.integrationContext,
        conversationDepth: state.conversationDepth,
        previousDecisions: state.autonomousDecisions || [],
        userPreferences: userPreferences,
      };

      // Determine autonomous actions based on context
      const autonomousActions =
        await this.determineAutonomousActions(autonomousContext);

      // Execute autonomous workflows
      const executionResults = await this.executeAutonomousWorkflows(
        autonomousActions,
        state,
      );

      // Generate proactive insights
      const proactiveInsights = this.generateProactiveInsights(state);

      // Predict next user needs
      const predictedNeeds = await this.predictUserNeeds(state);

      // Generate autonomous response
      const autonomousPrompt =
        new HumanMessage(`Based on the analysis, generate intelligent autonomous actions:

Context: ${JSON.stringify(autonomousContext, null, 2)}
Identified Actions: ${JSON.stringify(autonomousActions, null, 2)}
Execution Results: ${JSON.stringify(executionResults, null, 2)}
Predicted Needs: ${JSON.stringify(predictedNeeds, null, 2)}

Provide:
1. Summary of autonomous actions taken
2. Proactive recommendations
3. Next steps for user
4. Anticipated questions and prepared responses
5. Cross-system optimization opportunities`);

      const response = await model.invoke([autonomousPrompt]);
      const autonomousResponse =
        typeof response.content === 'string'
          ? response.content
          : String(response.content ?? '');

      return {
        currentAgent: 'autonomous_decision',
        autonomousDecisions: [
          ...(state.autonomousDecisions || []),
          ...autonomousActions.map((a) => `Executed: ${a.action}`),
          autonomousResponse,
        ],
        proactiveInsights: [
          ...proactiveInsights,
          ...predictedNeeds.map((n) => `Predicted need: ${n}`),
        ],
        taskPriority: this.calculateTaskPriority(state),
        worldClassFeatures: {
          ...state.worldClassFeatures,
          emotionalIntelligence: true,
          contextualMemory: true,
          predictiveAnalytics: true,
          crossModalUnderstanding: true,
        },
      };
    } catch (error) {
      this.logger.error('❌ Autonomous decision agent failed', { error });
      return { currentAgent: 'autonomous_error' };
    }
  }

  // Helper methods for autonomous decision agent
  private async determineAutonomousActions(context: any): Promise<
    Array<{
      action: string;
      priority: number;
      reasoning: string;
      parameters: any;
    }>
  > {
    try {
      const llm = new ChatBedrockConverse({
        model: this.coordinatorModelId,
        region: process.env.AWS_REGION || 'us-east-1',
        temperature: 0.7,
        maxTokens: 2000,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
      });

      const analysisPrompt =
        new HumanMessage(`You are an autonomous AI decision-making system. Analyze the following context and determine what autonomous actions should be taken to help the user.

Context:
- User Intent: ${context.userIntent || 'Not specified'}
- Conversation Depth: ${context.conversationDepth || 0}
- Available Integrations: ${JSON.stringify(Object.keys(context.integrations || {}))}
- Previous Decisions: ${JSON.stringify(context.previousDecisions?.slice(-3) || [])}
- User Preferences: ${JSON.stringify(context.userPreferences || {})}

Analyze and return a JSON array of autonomous actions. Each action should have:
{
  "action": "specific_action_name",
  "priority": 1-10 (10 being highest),
  "reasoning": "why this action is beneficial",
  "parameters": { /* action-specific parameters */ }
}

Consider these action types:
- enable_cortex_optimization: Enable AI cost optimization (40-75% savings)
- analyze_usage_patterns: Analyze user's AI usage for insights
- suggest_aws_integration: Recommend AWS connection for deployment
- suggest_google_integration: Recommend Google Workspace automation
- suggest_github_integration: Recommend GitHub workflow automation
- suggest_workflow_automation: Create automation for repetitive tasks
- optimize_model_selection: Suggest better models for user's use case
- enable_semantic_cache: Enable caching for cost savings
- configure_budget_alerts: Set up cost monitoring alerts
- recommend_batch_processing: Suggest batching for efficiency

Return ONLY the JSON array, no other text.`);

      const response = await llm.invoke([analysisPrompt]);
      const responseText = response.content.toString().trim();

      let actions: z.infer<typeof AutonomyActionsSchema> = [];

      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          const result = AutonomyActionsSchema.safeParse(parsed);
          if (result.success) {
            actions = result.data;
          } else {
            this.logger.warn('AI action response failed Zod validation', {
              error: result.error.message,
            });
          }
        } catch (parseError) {
          this.logger.warn('Failed to parse AI action response', {
            error:
              parseError instanceof Error
                ? parseError.message
                : String(parseError),
          });
        }
      }

      actions = actions.sort((a, b) => b.priority - a.priority).slice(0, 5);

      this.logger.log('AI determined autonomous actions', {
        actionCount: actions.length,
        topAction: actions[0]?.action,
      });

      return actions;
    } catch (error) {
      this.logger.error('Failed to determine autonomous actions with AI', {
        error: error instanceof Error ? error.message : String(error),
      });

      const fallbackActions = [];

      if (
        context.userIntent?.includes('cost') ||
        context.userIntent?.includes('optimization')
      ) {
        fallbackActions.push({
          action: 'enable_cortex_optimization',
          priority: 9,
          reasoning:
            'User interested in cost optimization - Cortex provides 40-75% savings',
          parameters: { autoEnable: false, notifyUser: true },
        });
      }

      if (
        !context.integrations?.aws &&
        context.userIntent?.includes('deploy')
      ) {
        fallbackActions.push({
          action: 'suggest_aws_integration',
          priority: 7,
          reasoning: 'User wants deployment but AWS not connected',
          parameters: { showBenefits: true },
        });
      }

      return fallbackActions;
    }
  }

  private async executeAutonomousWorkflows(
    actions: Array<{
      action: string;
      priority: number;
      reasoning: string;
      parameters: any;
    }>,
    state: LangchainChatStateGraphType,
  ): Promise<
    Array<{
      action: string;
      success: boolean;
      message: string;
      impact: string;
      [key: string]: any;
    }>
  > {
    const llm = new ChatBedrockConverse({
      model: this.coordinatorModelId,
      region: process.env.AWS_REGION || 'us-east-1',
      temperature: 0.7,
      maxTokens: 2000,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });

    const results = [];

    for (const action of actions.slice(0, 3)) {
      try {
        let executionResult: any = {
          action: action.action,
          success: false,
          message: '',
          impact: 'unknown',
        };

        switch (action.action) {
          case 'enable_cortex_optimization':
            executionResult = {
              action: action.action,
              success: true,
              message:
                'Cortex optimization recommended for 40-75% cost savings',
              impact: 'high',
              nextSteps: [
                'Enable in settings',
                'Review optimization strategies',
                'Monitor savings',
              ],
              estimatedSavings: '40-75%',
            };
            break;

          case 'analyze_usage_patterns': {
            const analysisPrompt =
              new HumanMessage(`Analyze AI usage patterns and provide insights:

Context: ${JSON.stringify(state.contextData, null, 2)}
Conversation Depth: ${state.conversationDepth}

Provide 3-5 actionable insights about usage patterns, cost optimization, and efficiency improvements.
Format as JSON array of strings.`);

            const analysisResponse = await llm.invoke([analysisPrompt]);
            const analysisText = String(analysisResponse.content ?? '');

            let insights: string[] = ['Usage pattern analysis in progress'];
            const jsonMatch = analysisText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              try {
                const parsed = JSON.parse(jsonMatch[0]);
                const result = InsightsSchema.safeParse(parsed);
                insights = result.success ? result.data : insights;
              } catch {
                // Use fallback insights
              }
            }

            executionResult = {
              action: action.action,
              success: true,
              insights: insights.slice(0, 5),
              message: 'Usage pattern analysis completed',
              impact: 'medium',
              recommendations: insights.slice(0, 3),
            };
            break;
          }

          case 'suggest_aws_integration':
            executionResult = {
              action: action.action,
              success: true,
              message:
                'AWS integration recommended for deployment capabilities',
              impact: 'high',
              benefits: [
                'One-click deployments',
                'Serverless functions',
                'Database hosting',
                'CDN integration',
              ],
              setupSteps: [
                'Connect AWS account',
                'Configure IAM permissions',
                'Choose deployment regions',
              ],
            };
            break;

          case 'suggest_google_integration':
            executionResult = {
              action: action.action,
              success: true,
              message:
                'Google Workspace integration recommended for productivity',
              impact: 'medium',
              benefits: [
                'Calendar integration',
                'Drive file access',
                'Gmail automation',
                'Sheets integration',
              ],
              setupSteps: [
                'Authorize Google OAuth',
                'Select workspace permissions',
                'Configure data access',
              ],
            };
            break;

          case 'suggest_github_integration':
            executionResult = {
              action: action.action,
              success: true,
              message:
                'GitHub integration recommended for development workflow',
              impact: 'high',
              benefits: [
                'Repository management',
                'PR automation',
                'Issue tracking',
                'Code review assistance',
              ],
              setupSteps: [
                'Connect GitHub account',
                'Select repositories',
                'Configure webhook events',
              ],
            };
            break;

          case 'optimize_model_selection': {
            const optimizationPrompt =
              new HumanMessage(`Based on the conversation context, recommend the most cost-effective AI model configuration:

Context: ${JSON.stringify(state.contextData, null, 2)}
Current Models Used: ${JSON.stringify((state as { modelUsage?: Record<string, unknown> }).modelUsage ?? {}, null, 2)}

Recommend 2-3 optimal model configurations that balance cost, quality, and speed.
Format as JSON array of objects with: model, cost_per_token, quality_score, use_case, savings_estimate.`);

            const optimizationResponse = await llm.invoke([optimizationPrompt]);
            const optimizationText = String(optimizationResponse.content ?? '');

            let recommendations: z.infer<typeof ModelRecommendationsSchema> = [
              {
                model: 'claude-haiku',
                cost_per_token: 0.0001,
                quality_score: 8,
                use_case: 'General queries',
                savings_estimate: '60%',
              },
            ];
            const recMatch = optimizationText.match(/\[[\s\S]*\]/);
            if (recMatch) {
              try {
                const parsed = JSON.parse(recMatch[0]);
                const result = ModelRecommendationsSchema.safeParse(parsed);
                recommendations = result.success
                  ? result.data
                  : recommendations;
              } catch {
                // Use fallback recommendations
              }
            }

            executionResult = {
              action: action.action,
              success: true,
              recommendations: recommendations.slice(0, 3),
              message: 'Model optimization analysis completed',
              impact: 'high',
              potentialSavings:
                recommendations[0]?.savings_estimate || '30-50%',
            };
            break;
          }

          default:
            executionResult = {
              action: action.action,
              success: true,
              message: `Executed autonomous action: ${action.action}`,
              impact: 'low',
            };
        }

        results.push(executionResult);
      } catch (error) {
        this.logger.error(
          `Failed to execute autonomous action ${action.action}`,
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );

        results.push({
          action: action.action,
          success: false,
          message: `Failed to execute ${action.action}`,
          impact: 'none',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  private generateProactiveInsights(
    state: LangchainChatStateGraphType,
  ): string[] {
    const insights = [];
    if (state.conversationDepth > 3) {
      insights.push('Consider creating a comprehensive plan for your project');
    }
    return insights;
  }

  private async predictUserNeeds(
    state: LangchainChatStateGraphType,
  ): Promise<string[]> {
    try {
      const llm = new ChatBedrockConverse({
        model: this.coordinatorModelId,
        region: process.env.AWS_REGION || 'us-east-1',
        temperature: 0.7,
        maxTokens: 1500,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
      });

      const predictionPrompt =
        new HumanMessage(`You are an AI assistant predicting user needs based on conversation context.

Current Context:
- User Intent: ${state.userIntent || 'Not specified'}
- Conversation Depth: ${state.conversationDepth || 0}
- Recent Topics: ${state.messages
          .slice(-3)
          .map((m) => m.content)
          .join('; ')}
- Autonomous Decisions Made: ${state.autonomousDecisions?.slice(-3).join('; ') || 'None'}

Predict 3-5 things the user might need next. Consider:
- Natural conversation flow
- Common follow-up questions
- Related tasks or actions
- Proactive assistance opportunities

Return ONLY a JSON array of predicted needs as strings.`);

      const response = await llm.invoke([predictionPrompt]);
      const responseText = response.content.toString().trim();

      let predictions: string[] = [];

      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          const result = InsightsSchema.safeParse(parsed);
          predictions = result.success ? result.data : predictions;
        } catch (parseError) {
          this.logger.warn('Failed to parse AI predictions', {
            error:
              parseError instanceof Error
                ? parseError.message
                : String(parseError),
          });
        }
      }

      predictions = predictions
        .filter((p) => typeof p === 'string' && p.length > 5 && p.length < 100)
        .slice(0, 5);

      this.logger.log('AI predicted user needs', {
        predictionCount: predictions.length,
      });

      return predictions.length > 0
        ? predictions
        : [
            'View detailed cost breakdown',
            'Set up budget alerts',
            'Optimize model selection',
          ];
    } catch (error) {
      this.logger.error('Failed to predict user needs', {
        error: error instanceof Error ? error.message : String(error),
      });

      return [
        'View detailed cost breakdown',
        'Set up budget alerts',
        'Optimize model selection',
      ];
    }
  }

  private calculateTaskPriority(state: LangchainChatStateGraphType): number {
    if (state.userIntent?.includes('urgent')) return 10;
    if (state.conversationDepth > 5) return 7;
    return 5;
  }

  // Helper methods for strategy formation
  private extractStrategicQuestions(strategyContent: string): string[] {
    // Extract question-like lines (numbered lists, ?-ending, what/how/which)
    const lines = strategyContent.split('\n');
    return lines
      .filter(
        (line) =>
          line.includes('?') ||
          line.toLowerCase().includes('what') ||
          line.toLowerCase().includes('how') ||
          line.toLowerCase().includes('which'),
      )
      .slice(0, 5);
  }

  private generateAdaptiveQuestions(message: string, context: any): string[] {
    const questions = [];
    if (message.includes('project')) {
      questions.push('What is the main goal of your project?');
    }
    return questions;
  }

  private shouldGenerateOptions(question: string, context: any): boolean {
    const lowerQuestion = question.toLowerCase();

    // Questions that benefit from options
    const optionKeywords = [
      'which',
      'choose',
      'select',
      'pick',
      'prefer',
      'option',
      'type of',
      'kind of',
      'category',
      'priority',
      'level',
      'mode',
      'approach',
    ];

    return optionKeywords.some((keyword) => lowerQuestion.includes(keyword));
  }

  private parseOptionsFromResponse(
    content: string,
  ): z.infer<typeof StrategicOptionsSchema> {
    try {
      const parsed = JSON.parse(content);
      const result = StrategicOptionsSchema.safeParse(
        Array.isArray(parsed) ? parsed : [parsed],
      );
      return result.success ? result.data : [];
    } catch {
      return [];
    }
  }

  private extractParameterName(question: string): string {
    // Extract parameter name from question
    const words = question.toLowerCase().split(' ');
    if (words.includes('which') || words.includes('what')) {
      // Find noun after question word
      const questionIndex = words.findIndex(
        (w) => w === 'which' || w === 'what',
      );
      if (questionIndex < words.length - 1) {
        return words[questionIndex + 1];
      }
    }
    return 'parameter';
  }

  /**
   * Get user input sessions
   */
  getUserInputSessions(): Map<string, UserInputSession> {
    return this.userInputSessions;
  }

  /**
   * Get strategy formation sessions
   */
  getStrategyFormationSessions(): Map<string, any> {
    return this.strategyFormationSessions;
  }

  /**
   * Get the state graph
   */
  getGraph():
    | ReturnType<StateGraph<LangchainChatStateGraphType>['compile']>
    | undefined {
    return this.langchainGraph;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Cleanup expired sessions
   */
  cleanupExpiredSessions(): void {
    const now = Date.now();
    const expiredSessions: string[] = [];

    // Clean up user input sessions
    for (const [sessionId, session] of this.userInputSessions.entries()) {
      if (now > session.expiresAt.getTime()) {
        expiredSessions.push(sessionId);
      }
    }

    expiredSessions.forEach((sessionId) => {
      this.userInputSessions.delete(sessionId);
    });

    if (expiredSessions.length > 0) {
      this.logger.log('🧹 Cleaned up expired user input sessions', {
        cleanedCount: expiredSessions.length,
      });
    }
  }
}
