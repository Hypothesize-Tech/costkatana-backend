import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ChatBedrockConverse } from '@langchain/aws';
import { AgentExecutor, createReactAgent } from 'langchain/agents';
import { Tool } from '@langchain/core/tools';
import {
  ChatPromptTemplate,
  SystemMessagePromptTemplate,
  HumanMessagePromptTemplate,
} from '@langchain/core/prompts';

// Types
import { AgentQuery, AgentResponse } from '../../../types/agent.types';
import { VercelConnection } from '../../../schemas/integration/vercel-connection.schema';

// Services
import { RetryService } from './retry.service';
import { AgentPromptTemplateConfig } from '../config/agent-prompt-template.config';
import { ContextEngineeringService } from './context-engineering.service';
import { VectorStoreService } from './vector-store.service';
import type { VectorStoreStats } from './vector-store.service';

export interface AgentStatusResponse {
  initialized: boolean;
  model: string;
  agentType: string;
  toolsCount: number;
  toolsLoaded: number;
  vectorStoreStats: VectorStoreStats;
  performance: Awaited<ReturnType<AgentService['getMetrics']>>;
  cacheStats: { responseCache: number; userContextCache: number };
}
import { MultiLlmOrchestratorService } from './multi-llm-orchestrator.service';
import { ResponseFormattersService } from './response-formatters.service';
import { ToolRegistryService } from './tool-registry.service';
import { McpToolSyncerService } from './mcp-tool-syncer.service';
import { VercelToolsService } from './vercel-tools.service';

// Tools
import { KnowledgeBaseToolService } from '../tools/knowledge-base.tool';
import { MongoDbReaderToolService } from '../tools/mongodb-reader.tool';
import { ProjectManagerToolService } from '../tools/project-manager.tool';
import { ModelSelectorToolService } from '../tools/model-selector.tool';
import { AnalyticsManagerToolService } from '../tools/analytics-manager.tool';
import { OptimizationManagerToolService } from '../tools/optimization-manager.tool';
import { WebSearchToolService } from '../tools/web-search.tool';
import { MongoDBIntegrationToolService } from '../tools/mongodb-integration.tool';
import { FileSystemToolService } from '../tools/file-system.tool';
import { AWSIntegrationToolService } from '../tools/aws-integration.tool';
import { GenericHTTPTool } from '../tools/generic-http.tool';

// RAG
import { ModularRAGOrchestrator } from '../../rag/orchestrator/modular-rag.orchestrator';

// Vercel
import { VercelService } from '../../vercel/vercel.service';

// Schema for production user history / tool usage / performance from Usage
import { Usage } from '../../../schemas/core/usage.schema';

@Injectable()
export class AgentService implements OnModuleInit {
  private readonly logger = new Logger(AgentService.name);
  private initialized = false;
  private agentExecutor?: AgentExecutor;
  private model: ChatBedrockConverse;

  // Caching
  private readonly responseCache = new Map<
    string,
    { response: AgentResponse; timestamp: number; hits: number }
  >();
  private readonly userContextCache = new Map<
    string,
    { context: string; timestamp: number }
  >();

  // Performance metrics
  private metrics = {
    cacheHits: 0,
    cacheMisses: 0,
    toolsLoaded: 0,
    avgResponseTime: 0,
    totalRequests: 0,
  };

  // Cache configuration
  private readonly RESPONSE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly USER_CONTEXT_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

  /** Interval handle for cache cleanup (cleared on module destroy if needed) */
  private cleanupIntervalRef: NodeJS.Timeout | null = null;

  /** Dynamically added tools (e.g. Vercel) per user */
  private agentTools: Tool[] = [];

  constructor(
    @Inject(RetryService)
    private readonly retryService: RetryService,
    @Inject(AgentPromptTemplateConfig)
    private readonly promptConfig: AgentPromptTemplateConfig,
    @Inject(ContextEngineeringService)
    private readonly contextEngineering: ContextEngineeringService,
    @Inject(VectorStoreService)
    private readonly vectorStore: VectorStoreService,
    @Inject(MultiLlmOrchestratorService)
    private readonly multiLlmOrchestrator: MultiLlmOrchestratorService,
    @Inject(ResponseFormattersService)
    private readonly responseFormatters: ResponseFormattersService,
    @Inject(ToolRegistryService)
    private readonly toolRegistry: ToolRegistryService,
    @Inject(McpToolSyncerService)
    private readonly mcpToolSyncer: McpToolSyncerService,
    @Inject(VercelToolsService)
    private readonly vercelTools: VercelToolsService,
    @Inject(ModularRAGOrchestrator)
    private readonly ragOrchestrator: ModularRAGOrchestrator,
    @Inject(VercelService)
    private readonly vercelService: VercelService,
    @InjectModel(VercelConnection.name)
    private readonly vercelConnectionModel: Model<VercelConnection>,
    // Tools
    @Inject(KnowledgeBaseToolService)
    private readonly knowledgeBaseTool: KnowledgeBaseToolService,
    @Inject(MongoDbReaderToolService)
    private readonly mongoDbReaderTool: MongoDbReaderToolService,
    @Inject(ProjectManagerToolService)
    private readonly projectManagerTool: ProjectManagerToolService,
    @Inject(ModelSelectorToolService)
    private readonly modelSelectorTool: ModelSelectorToolService,
    @Inject(AnalyticsManagerToolService)
    private readonly analyticsManagerTool: AnalyticsManagerToolService,
    @Inject(OptimizationManagerToolService)
    private readonly optimizationManagerTool: OptimizationManagerToolService,
    @Inject(WebSearchToolService)
    private readonly webSearchTool: WebSearchToolService,
    @Inject(MongoDBIntegrationToolService)
    private readonly mongoDbIntegrationTool: MongoDBIntegrationToolService,
    @Inject(FileSystemToolService)
    private readonly fileSystemTool: FileSystemToolService,
    @Inject(AWSIntegrationToolService)
    private readonly awsIntegrationTool: AWSIntegrationToolService,
    @Inject(GenericHTTPTool)
    private readonly genericHttpTool: GenericHTTPTool,
    @InjectModel(Usage.name)
    private readonly usageModel: Model<Usage>,
  ) {
    // Initialize AWS Bedrock model
    const defaultModel =
      process.env.AWS_BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0';
    const isMasterAgent = process.env.AGENT_TYPE === 'master';
    const selectedModel = isMasterAgent
      ? 'anthropic.claude-3-5-sonnet-20240620-v1:0'
      : defaultModel;

    this.model = new ChatBedrockConverse({
      region: process.env.AWS_BEDROCK_REGION || 'us-east-1',
      model: selectedModel,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
      temperature: isMasterAgent ? 0.1 : 0.3,
      maxTokens: isMasterAgent ? 8000 : 5000,
    });

    this.logger.log(
      `🤖 Initialized ${isMasterAgent ? 'Master' : 'Standard'} Agent`,
    );

    // Start cache cleanup
    this.startCacheCleanup();
  }

  async onModuleInit(): Promise<void> {
    await this.initialize();
  }

  /**
   * Initialize the agent with all necessary components
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.logger.log('🤖 Initializing AIOps Agent...');

      // Initialize tool registry
      await this.toolRegistry.initialize();
      await this.mcpToolSyncer.syncCoreTools();

      // Initialize vector store
      await this.vectorStore.initialize();

      // Build system prompt
      const systemPrompt = this.promptConfig.getCompressedPrompt();

      // Create prompt template
      const prompt = ChatPromptTemplate.fromMessages([
        SystemMessagePromptTemplate.fromTemplate(systemPrompt),
        ['placeholder', '{agent_scratchpad}'],
        HumanMessagePromptTemplate.fromTemplate('{input}'),
      ]);

      // Get all tools
      const tools = this.getAllTools();

      // Create React agent
      const agent = await createReactAgent({
        llm: this.model,
        tools,
        prompt,
      });

      // Create agent executor
      this.agentExecutor = new AgentExecutor({
        agent,
        tools,
        verbose: process.env.NODE_ENV === 'development',
        maxIterations: 3,
        earlyStoppingMethod: 'force',
        returnIntermediateSteps: true,
        handleParsingErrors: true,
      });

      this.initialized = true;
      this.logger.log('✅ AIOps Agent initialized successfully');
    } catch (error: any) {
      this.logger.error('❌ Failed to initialize agent:', error.message);
      throw new Error('Agent initialization failed');
    }
  }

  /**
   * Process a query from a user
   */
  async query(queryData: AgentQuery): Promise<AgentResponse> {
    const startTime = Date.now();
    this.metrics.totalRequests++;

    try {
      // Check cache first
      const cacheKey = this.generateCacheKey(queryData);
      const cachedResponse = this.getCachedResponse(cacheKey);
      if (cachedResponse) {
        return cachedResponse;
      }

      if (!this.initialized) {
        await this.initialize();
      }

      // Use multi-LLM orchestration if complex query
      if (this.shouldUseMultiLlm(queryData)) {
        return await this.queryWithMultiLlm(queryData);
      }

      if (!this.agentExecutor) {
        throw new Error('Agent not properly initialized');
      }

      // Add Vercel tools if user has connection
      await this.addVercelToolsIfConnected(queryData.userId);

      // Build user context
      const userContext = this.buildUserContextCached(queryData);

      // Generate thinking process
      const thinking = this.generateThinkingProcess(queryData.query);

      // Determine query type
      const queryType = this.determineQueryType(queryData.query);

      // Execute agent query
      const result = await this.retryService.execute(async () => {
        return await this.agentExecutor!.invoke({
          input: queryData.query,
          user_context: userContext,
          queryType,
        });
      });

      const executionTime = Date.now() - startTime;

      // Update metrics
      this.updatePerformanceMetrics(executionTime);

      // Process result
      const chainValues = result.result;
      const outputStr =
        chainValues &&
        typeof chainValues === 'object' &&
        'output' in chainValues &&
        typeof (chainValues as { output?: unknown }).output === 'string'
          ? (chainValues as { output: string }).output
          : this.extractUsefulResponse(chainValues, queryData.query);
      const finalResponse = outputStr;

      const response: AgentResponse = {
        success: true,
        response: finalResponse,
        metadata: {
          executionTime,
          sources: this.extractSources(result),
          fromCache: false,
        },
        thinking,
      };

      // Cache successful responses
      if (response.success && response.response) {
        this.cacheResponse(cacheKey, response);
      }

      return response;
    } catch (error: any) {
      this.logger.error('Agent query failed:', error.message);

      return {
        success: false,
        error: error.message,
        response:
          'I encountered an error processing your request. Please try again.',
        metadata: {
          executionTime: Date.now() - startTime,
          errorType: 'agent_error',
        },
      };
    }
  }

  /**
   * Query with multi-LLM orchestration
   */
  async queryWithMultiLlm(queryData: AgentQuery): Promise<AgentResponse> {
    const startTime = Date.now();

    try {
      this.logger.log('🚀 Processing query with multi-LLM orchestration', {
        userId: queryData.userId,
        query: queryData.query.substring(0, 100),
      });

      // Get available tools with descriptions
      const availableTools = this.getAllToolsWithDescriptions();

      // Create tool executor
      const toolExecutor = async (
        toolName: string,
        params?: Record<string, any>,
      ) => {
        try {
          const tool = this.getToolInstance(toolName);
          const input = params ? JSON.stringify(params) : queryData.query;
          return await tool.invoke({ input });
        } catch (error: any) {
          this.logger.error(
            `Tool execution failed: ${toolName}`,
            error.message,
          );
          throw error;
        }
      };

      // Build context
      const userContext = this.buildUserContextCached(queryData);

      // Execute orchestration
      const orchestrationResult = await this.multiLlmOrchestrator.orchestrate(
        queryData.query,
        availableTools,
        toolExecutor,
        userContext,
      );

      const executionTime = Date.now() - startTime;

      return {
        success: true,
        response: orchestrationResult.finalResponse,
        metadata: {
          executionTime,
          sources: orchestrationResult.toolSelection.selectedTools.map(
            (t) => t.name,
          ),
          fromCache: false,
          webSearchUsed: orchestrationResult.toolSelection.selectedTools.some(
            (t) => t.name === 'web_search',
          ),
        },
        thinking: {
          title: `Query Analysis: ${orchestrationResult.analysis.intent}`,
          summary: `Used ${orchestrationResult.toolSelection.selectedTools.length} tools with ${(orchestrationResult.confidence * 100).toFixed(1)}% confidence`,
          steps: orchestrationResult.toolSelection.selectedTools.map(
            (tool, idx) => ({
              step: idx + 1,
              description: `Execute ${tool.name}`,
              reasoning: tool.reason,
              outcome: `Tool executed with priority ${tool.priority}`,
            }),
          ),
        },
      };
    } catch (error: any) {
      this.logger.error('Multi-LLM query processing failed', error.message);

      return {
        success: false,
        error: error.message,
        response:
          'Failed to process your query with multi-LLM orchestration. Please try again.',
        metadata: {
          executionTime: Date.now() - startTime,
          errorType: 'multi_llm_error',
        },
      };
    }
  }

  /**
   * Process query with knowledge context enhancement
   */
  async processQueryWithKnowledgeContext(
    queryData: AgentQuery,
  ): Promise<AgentResponse> {
    try {
      // Use RAG orchestrator for knowledge enhancement
      const ragResult = await this.ragOrchestrator.execute({
        query: queryData.query,
        context: {
          userId: queryData.userId,
          conversationId: queryData.context?.conversationId,
          projectId: queryData.context?.projectId,
          recentMessages: queryData.context?.previousMessages || [],
        },
      });

      // Format knowledge context
      let knowledgeContext = '';
      if (ragResult.success && ragResult.documents.length > 0) {
        knowledgeContext = `Knowledge Base Context:\n`;
        ragResult.documents.slice(0, 3).forEach((doc, idx) => {
          knowledgeContext += `${idx + 1}. ${doc.content.substring(0, 300)}...\n`;
        });
        knowledgeContext += `\nSources: ${ragResult.sources.join(', ')}`;
      }

      // Enhance query with knowledge context
      const enhancedQuery: AgentQuery = {
        ...queryData,
        context: {
          ...queryData.context,
          knowledgeBaseContext: knowledgeContext,
        },
      };

      // Process with enhanced context
      const response = await this.query(enhancedQuery);

      return {
        ...response,
        metadata: {
          ...response.metadata,
          knowledgeEnhanced: true,
          knowledgeContextLength: knowledgeContext?.length || 0,
        },
      };
    } catch (error: any) {
      this.logger.error('Knowledge-enhanced query failed', error.message);
      // Fallback to regular query
      return this.query(queryData);
    }
  }

  /**
   * Get agent status and statistics
   */
  async getStatus(): Promise<AgentStatusResponse> {
    const isMasterAgent = process.env.AGENT_TYPE === 'master';
    const currentModel = isMasterAgent
      ? 'anthropic.claude-3-5-sonnet-20240620-v1:0'
      : process.env.AWS_BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0';

    // Get real tool count from registry
    let toolsCount = 0;
    try {
      const allTools = await this.toolRegistry.listTools();
      toolsCount = allTools.length;
    } catch (error) {
      // Fallback to metrics if registry fails
      toolsCount = this.metrics.toolsLoaded;
    }

    return {
      initialized: this.initialized,
      model: currentModel,
      agentType: isMasterAgent
        ? 'Master Agent (Complex Reasoning)'
        : 'Standard Agent (Nova Pro)',
      toolsCount,
      toolsLoaded: this.metrics.toolsLoaded,
      vectorStoreStats: this.vectorStore.getStats(),
      performance: await this.getMetrics(),
      cacheStats: {
        responseCache: this.responseCache.size,
        userContextCache: this.userContextCache.size,
      },
    };
  }

  /**
   * Add learning/feedback to the knowledge base
   */
  async addLearning(
    insight: string,
    metadata: Record<string, any> = {},
  ): Promise<void> {
    try {
      await this.vectorStore.addKnowledge(insight, metadata);
    } catch (error: any) {
      this.logger.error('Failed to add learning:', error.message);
    }
  }

  // Private helper methods

  private shouldUseMultiLlm(queryData: AgentQuery): boolean {
    const query = queryData.query.toLowerCase();

    const complexIndicators = [
      'analyze and optimize',
      'comprehensive report',
      'multiple services',
      'cross-platform',
      'integrate with',
    ];

    return (
      complexIndicators.some((indicator) => query.includes(indicator)) ||
      queryData.context?.useMultiAgent === true
    );
  }

  private generateThinkingProcess(query: string): any {
    const lowerQuery = query.toLowerCase();

    // Cost queries
    if (
      lowerQuery.includes('cost') ||
      lowerQuery.includes('spend') ||
      lowerQuery.includes('budget')
    ) {
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
            outcome: 'Retrieved your real usage data from MongoDB',
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

    // Default thinking process
    return {
      title: 'Processing your query',
      summary:
        "I'll analyze your request and provide the most relevant information.",
      steps: [
        {
          step: 1,
          description: 'Query Analysis',
          reasoning:
            'Understanding your specific request and determining the best approach.',
          outcome: 'Identified query type and requirements',
        },
        {
          step: 2,
          description: 'Data Retrieval',
          reasoning: 'Gathering relevant information from available sources.',
          outcome: 'Retrieved necessary data and context',
        },
        {
          step: 3,
          description: 'Response Generation',
          reasoning:
            'Processing the information to provide a clear, helpful response.',
          outcome: 'Generated comprehensive response',
        },
      ],
    };
  }

  private determineQueryType(
    query: string,
  ): 'cost' | 'token' | 'performance' | 'general' {
    const lowerQuery = query.toLowerCase();

    if (lowerQuery.includes('token') || lowerQuery.includes('usage')) {
      return 'token';
    } else if (
      lowerQuery.includes('cost') ||
      lowerQuery.includes('spend') ||
      lowerQuery.includes('budget')
    ) {
      return 'cost';
    } else if (
      lowerQuery.includes('performance') ||
      lowerQuery.includes('model') ||
      lowerQuery.includes('benchmark')
    ) {
      return 'performance';
    } else {
      return 'general';
    }
  }

  private extractUsefulResponse(result: any, originalQuery: string): string {
    try {
      const intermediateSteps = result.intermediateSteps || [];

      // Look for tool outputs
      for (const step of intermediateSteps) {
        if (step.observation) {
          const observation =
            typeof step.observation === 'string'
              ? step.observation
              : JSON.stringify(step.observation);

          if (
            observation.includes('success') ||
            observation.includes('result')
          ) {
            return observation;
          }
        }
      }

      // Fallback response
      return this.responseFormatters.generateFallbackResponse(originalQuery);
    } catch (error: any) {
      this.logger.error('Error extracting useful response:', error.message);
      return "I encountered an issue processing your request. Please try asking a more specific question, such as 'What did I spend this month?' or 'Show my token usage.'";
    }
  }

  private extractSources(result: any): string[] {
    const sources: string[] = [];

    if (result.intermediateSteps) {
      result.intermediateSteps.forEach((step: any) => {
        if (step.tool === 'knowledge_base_search') {
          sources.push('Knowledge Base');
        } else if (step.tool === 'mongodb_reader') {
          sources.push('Database');
        }
      });
    }

    return [...new Set(sources)];
  }

  private buildUserContextCached(queryData: AgentQuery): string {
    const contextKey = `${queryData.userId}_${queryData.context?.projectId || 'default'}_${queryData.context?.conversationId || 'default'}`;

    const cached = this.userContextCache.get(contextKey);
    if (cached && Date.now() - cached.timestamp < this.USER_CONTEXT_CACHE_TTL) {
      return cached.context;
    }

    const context = this.buildUserContext(queryData);

    this.userContextCache.set(contextKey, {
      context,
      timestamp: Date.now(),
    });

    return context;
  }

  private buildUserContext(queryData: AgentQuery): string {
    const history = queryData.context?.previousMessages || [];

    // Use context engineering service
    const optimized = this.contextEngineering.buildOptimizedContext(
      queryData.userId,
      queryData.context?.projectId || 'default',
      history.map((msg) => ({ role: msg.role, content: msg.content })),
      'Tools will be provided by the agent system',
    );

    return `${optimized.staticContext}\n\nCONVERSATION HISTORY:\n${optimized.dynamicHistory}`;
  }

  private updatePerformanceMetrics(executionTime: number): void {
    const alpha = 0.1;
    this.metrics.avgResponseTime =
      this.metrics.avgResponseTime === 0
        ? executionTime
        : alpha * executionTime + (1 - alpha) * this.metrics.avgResponseTime;
  }

  private async getMetrics() {
    const totalCacheRequests =
      this.metrics.cacheHits + this.metrics.cacheMisses;
    const cacheHitRate =
      totalCacheRequests > 0
        ? (this.metrics.cacheHits / totalCacheRequests) * 100
        : 0;

    // Get real tool count
    let toolsLoadedCount = 0;
    try {
      const allTools = await this.toolRegistry.listTools();
      toolsLoadedCount = allTools.length;
    } catch (error) {
      // Fallback to metrics if registry fails
      toolsLoadedCount = this.metrics.toolsLoaded;
    }

    return {
      ...this.metrics,
      cacheHitRate: Math.round(cacheHitRate * 100) / 100,
      toolsLoadedCount,
    };
  }

  private generateCacheKey(queryData: AgentQuery): string {
    const crypto = require('crypto');
    return crypto
      .createHash('md5')
      .update(
        JSON.stringify({
          query: queryData.query,
          userId: queryData.userId,
          context: queryData.context,
        }),
      )
      .digest('hex');
  }

  private getCachedResponse(cacheKey: string): AgentResponse | null {
    const cached = this.responseCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.RESPONSE_CACHE_TTL) {
      cached.hits++;
      this.metrics.cacheHits++;
      const cachedResponse = { ...cached.response };
      if (cachedResponse.metadata) {
        cachedResponse.metadata.fromCache = true;
      } else {
        cachedResponse.metadata = { fromCache: true };
      }
      return cachedResponse;
    }

    if (cached) {
      this.responseCache.delete(cacheKey);
    }

    this.metrics.cacheMisses++;
    return null;
  }

  private cacheResponse(cacheKey: string, response: AgentResponse): void {
    if (this.responseCache.size >= 1000) {
      const oldestKey = this.responseCache.keys().next().value;
      if (oldestKey) {
        this.responseCache.delete(oldestKey);
      }
    }

    this.responseCache.set(cacheKey, {
      response: { ...response },
      timestamp: Date.now(),
      hits: 0,
    });
  }

  private startCacheCleanup(): void {
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      let cleaned = 0;

      // Clean response cache
      for (const [key, cached] of this.responseCache.entries()) {
        if (now - cached.timestamp > this.RESPONSE_CACHE_TTL) {
          this.responseCache.delete(key);
          cleaned++;
        }
      }

      // Clean user context cache
      for (const [key, cached] of this.userContextCache.entries()) {
        if (now - cached.timestamp > this.USER_CONTEXT_CACHE_TTL) {
          this.userContextCache.delete(key);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        this.logger.log(`🧹 Cache cleanup: removed ${cleaned} expired entries`);
      }
    }, 60000);

    this.cleanupIntervalRef = cleanupInterval;
  }

  private async addVercelToolsIfConnected(userId: string): Promise<void> {
    try {
      const vercelConnection = await this.vercelConnectionModel.findOne({
        userId,
        isActive: true,
      });

      if (vercelConnection) {
        const connectionId =
          (vercelConnection as any)._id?.toString?.() ??
          String(vercelConnection._id);
        const vercelTools = this.vercelTools.createVercelTools(connectionId);
        if (vercelTools.length > 0) {
          this.agentTools.push(...vercelTools);
          this.logger.debug('Vercel tools added to agent', {
            userId,
            toolCount: vercelTools.length,
            tools: vercelTools.map((t: { name: string }) => t.name),
          });
        }
      } else {
        this.logger.debug(
          'No active Vercel connection found, skipping Vercel tools',
          { userId },
        );
      }
    } catch (error: any) {
      this.logger.warn('Failed to add Vercel tools', {
        userId,
        error: error.message,
      });
    }
  }

  private getAllTools(): Tool[] {
    return [
      this.knowledgeBaseTool,
      this.mongoDbReaderTool,
      this.projectManagerTool,
      this.modelSelectorTool,
      this.analyticsManagerTool,
      this.optimizationManagerTool,
      this.webSearchTool,
      this.mongoDbIntegrationTool,
      this.fileSystemTool,
      this.awsIntegrationTool,
      this.genericHttpTool,
      ...this.agentTools,
    ];
  }

  private getToolInstance(toolName: string): Tool {
    const tools = this.getAllTools();
    const tool = tools.find((t) => t.name === toolName);
    if (!tool) {
      throw new Error(`Unknown tool: ${toolName}`);
    }
    return tool;
  }

  private getAllToolsWithDescriptions(): Array<{
    name: string;
    description: string;
  }> {
    return this.getAllTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
    }));
  }

  /**
   * Clear all caches (for testing/maintenance)
   */
  clearCaches(): void {
    this.responseCache.clear();
    this.userContextCache.clear();
    this.logger.log('🧹 All caches cleared');
  }

  /**
   * Coordinate with other agents for complex multi-agent workflows
   */
  async coordinateWithAgents(
    primaryQuery: string,
    coordinationContext: {
      participatingAgents: string[];
      workflowType: 'parallel' | 'sequential' | 'hierarchical';
      sharedContext?: Record<string, any>;
      timeout?: number;
    },
    userId: string,
  ): Promise<{
    coordinatedResponse: AgentResponse;
    agentContributions: Array<{
      agentId: string;
      contribution: any;
      executionTime: number;
    }>;
    coordinationMetadata: {
      totalExecutionTime: number;
      agentsCoordinated: number;
      workflowType: string;
      treeDepth?: number;
      executionBranches?: number;
    };
  }> {
    const startTime = Date.now();
    const contributions: Array<{
      agentId: string;
      contribution: any;
      executionTime: number;
    }> = [];

    try {
      this.logger.log('Starting multi-agent coordination', {
        workflowType: coordinationContext.workflowType,
        participatingAgents: coordinationContext.participatingAgents.length,
        userId,
      });

      if (coordinationContext.workflowType === 'parallel') {
        // Execute agents in parallel
        const agentPromises = coordinationContext.participatingAgents.map(
          async (agentType) => {
            const agentStartTime = Date.now();
            try {
              const response = await this.query({
                userId,
                query: primaryQuery,
                context: coordinationContext.sharedContext,
              });

              contributions.push({
                agentId: agentType,
                contribution: response,
                executionTime: Date.now() - agentStartTime,
              });

              return response;
            } catch (error) {
              this.logger.error(`Agent ${agentType} failed in coordination`, {
                error: error instanceof Error ? error.message : String(error),
              });
              contributions.push({
                agentId: agentType,
                contribution: { error: 'Agent execution failed' },
                executionTime: Date.now() - agentStartTime,
              });
              return null;
            }
          },
        );

        const results = await Promise.allSettled(agentPromises);
        const successfulResults = results
          .filter(
            (result) =>
              result.status === 'fulfilled' &&
              (result as PromiseFulfilledResult<any>).value,
          )
          .map((result) => (result as PromiseFulfilledResult<any>).value);

        // Combine results using the primary agent's response format
        const coordinatedResponse: AgentResponse = {
          success: true,
          response: successfulResults
            .map((r) => r.response)
            .join('\n\n---\n\n'),
          metadata: {
            coordinated: true,
            participatingAgents: coordinationContext.participatingAgents,
            workflowType: coordinationContext.workflowType,
            totalAgents: coordinationContext.participatingAgents.length,
            successfulAgents: successfulResults.length,
          },
          usage: successfulResults.reduce(
            (acc, r) => ({
              tokens: (acc.tokens || 0) + (r.usage?.tokens || 0),
              cost: (acc.cost || 0) + (r.usage?.cost || 0),
            }),
            { tokens: 0, cost: 0 },
          ),
        };
        return {
          coordinatedResponse,
          agentContributions: contributions,
          coordinationMetadata: {
            totalExecutionTime: Date.now() - startTime,
            agentsCoordinated: coordinationContext.participatingAgents.length,
            workflowType: coordinationContext.workflowType,
          },
        };
      } else if (coordinationContext.workflowType === 'sequential') {
        // Execute agents sequentially, passing context between them
        let currentContext = coordinationContext.sharedContext || {};
        let finalResponse: AgentResponse | null = null;

        for (const agentType of coordinationContext.participatingAgents) {
          const agentStartTime = Date.now();

          try {
            const response = await this.query({
              userId,
              query: primaryQuery,
              context: {
                ...currentContext,
                previousAgentResults: contributions,
              },
            });

            contributions.push({
              agentId: agentType,
              contribution: response,
              executionTime: Date.now() - agentStartTime,
            });

            // Update context for next agent
            currentContext = {
              ...currentContext,
              [agentType]: response,
            };

            finalResponse = response;
          } catch (error) {
            this.logger.error(
              `Agent ${agentType} failed in sequential coordination`,
              {
                error: error instanceof Error ? error.message : String(error),
              },
            );
            contributions.push({
              agentId: agentType,
              contribution: { error: 'Agent execution failed' },
              executionTime: Date.now() - agentStartTime,
            });
          }
        }

        return {
          coordinatedResponse: finalResponse || {
            success: true,
            response: 'Sequential coordination completed with some failures',
            metadata: { coordinated: true },
            usage: { tokens: 0, cost: 0 },
          },
          agentContributions: contributions,
          coordinationMetadata: {
            totalExecutionTime: Date.now() - startTime,
            agentsCoordinated: coordinationContext.participatingAgents.length,
            workflowType: coordinationContext.workflowType,
          },
        };
      } else if (coordinationContext.workflowType === 'hierarchical') {
        // Implement hierarchical coordination with tree structure
        this.logger.log('Executing hierarchical agent coordination');
        coordinationContext.workflowType = 'hierarchical';

        // Build hierarchical execution tree
        const executionTree = await this.buildHierarchicalExecutionTree(
          coordinationContext.participatingAgents,
          primaryQuery,
          userId,
        );

        // Execute agents hierarchically
        const hierarchicalContributions: Array<{
          agentId: string;
          contribution: any;
          executionTime: number;
          level: number;
          parentAgent?: string;
          childAgents?: string[];
        }> = [];

        const finalResponse = await this.executeHierarchicalTree(
          executionTree,
          hierarchicalContributions,
          coordinationContext.sharedContext || {},
        );

        // Calculate coordination statistics
        const coordinationStats = {
          totalAgents: coordinationContext.participatingAgents.length,
          treeDepth: this.calculateTreeDepth(executionTree),
          executionBranches: hierarchicalContributions.filter(
            (c) => c.childAgents?.length,
          ).length,
          leafNodes: hierarchicalContributions.filter(
            (c) => !c.childAgents?.length,
          ).length,
        };

        this.logger.log('Hierarchical coordination completed', {
          agentsCoordinated: hierarchicalContributions.length,
          treeDepth: coordinationStats.treeDepth,
          executionBranches: coordinationStats.executionBranches,
        });

        return {
          coordinatedResponse: {
            success: true,
            response: finalResponse.response,
            metadata: {
              coordinated: true,
              coordinationType: 'hierarchical',
              executionTree,
              coordinationStats,
            } as any,
            usage: (finalResponse as any).usage ?? { tokens: 0, cost: 0 },
          },
          agentContributions: hierarchicalContributions.map((c) => ({
            agentId: c.agentId,
            contribution: c.contribution,
            executionTime: c.executionTime,
          })),
          coordinationMetadata: {
            totalExecutionTime: Date.now() - startTime,
            agentsCoordinated: hierarchicalContributions.length,
            workflowType: 'hierarchical',
            treeDepth: coordinationStats.treeDepth,
          },
        };
      } else {
        // Fallback sequential coordination (original implementation)
        this.logger.warn(
          'Fallback to sequential coordination due to coordination type issues',
        );
        coordinationContext.workflowType = 'sequential';

        // Execute agents sequentially, passing context between them
        let currentContext = coordinationContext.sharedContext || {};
        const fallbackContributions: Array<{
          agentId: string;
          contribution: any;
          executionTime: number;
        }> = [];
        let finalResponse: AgentResponse | undefined;

        for (const agentType of coordinationContext.participatingAgents) {
          const agentStartTime = Date.now();

          try {
            const response = await this.query({
              userId,
              query:
                (coordinationContext as { taskData?: { query?: string } })
                  .taskData?.query ?? primaryQuery,
              context: {
                ...currentContext,
                coordinationContext: {
                  participatingAgents: coordinationContext.participatingAgents,
                  currentAgentIndex:
                    coordinationContext.participatingAgents.indexOf(agentType),
                  totalAgents: coordinationContext.participatingAgents.length,
                },
              },
            });

            fallbackContributions.push({
              agentId: agentType,
              contribution: response,
              executionTime: Date.now() - agentStartTime,
            });

            // Update context for next agent
            currentContext = {
              ...currentContext,
              [agentType]: response,
            };

            finalResponse = response;
          } catch (err: unknown) {
            const errMessage: string =
              err instanceof Error ? err.message : String(err);
            this.logger.error(
              `Agent ${agentType} failed in fallback sequential coordination`,
              { error: errMessage },
            );
            fallbackContributions.push({
              agentId: agentType,
              contribution: { error: 'Agent execution failed' },
              executionTime: Date.now() - agentStartTime,
            });
          }
        }

        return {
          coordinatedResponse: finalResponse || {
            success: true,
            response:
              'Hierarchical coordination fell back to sequential with some failures',
            metadata: { coordinated: true, fallbackUsed: true },
            usage: { tokens: 0, cost: 0 },
          },
          agentContributions: fallbackContributions,
          coordinationMetadata: {
            totalExecutionTime: Date.now() - startTime,
            agentsCoordinated: coordinationContext.participatingAgents.length,
            workflowType: 'hierarchical_fallback_sequential',
          },
        };
      }
    } catch (error: unknown) {
      this.logger.error('Multi-agent coordination failed', {
        error: error instanceof Error ? error.message : String(error),
        workflowType: coordinationContext.workflowType,
        participatingAgents: coordinationContext.participatingAgents.length,
      });
      throw error;
    }
  }

  /**
   * Get agent knowledge context for better responses
   */
  async getAgentKnowledgeContext(
    userId: string,
    contextType:
      | 'user_history'
      | 'domain_expertise'
      | 'tool_usage'
      | 'performance',
    options?: {
      timeRange?: { from: Date; to: Date };
      limit?: number;
      includeEmbeddings?: boolean;
    },
  ): Promise<{
    context: Record<string, any>;
    metadata: {
      contextType: string;
      dataPoints: number;
      timeRange?: { from: Date; to: Date };
      lastUpdated: Date;
    };
    embeddings?: number[];
  }> {
    try {
      this.logger.log('Retrieving agent knowledge context', {
        userId,
        contextType,
        options,
      });

      const context: Record<string, any> = {};
      const metadata = {
        contextType,
        dataPoints: 0,
        timeRange: options?.timeRange,
        lastUpdated: new Date(),
      };

      switch (contextType) {
        case 'user_history': {
          const userHistory = await this.getUserInteractionHistory(
            userId,
            options
              ? { timeRange: options.timeRange, limit: options.limit }
              : undefined,
          );
          context.interactionHistory = userHistory;
          context.frequentQueries = this.extractFrequentQueries(userHistory);
          context.preferredTools = this.extractPreferredTools(userHistory);
          metadata.dataPoints = userHistory.length;
          break;
        }
        case 'domain_expertise': {
          const domainKnowledge = await this.getDomainExpertise(
            userId,
            options,
          );
          context.expertiseAreas = domainKnowledge.expertiseAreas;
          context.confidenceScores = domainKnowledge.confidenceScores;
          context.knowledgeGaps = domainKnowledge.knowledgeGaps;
          metadata.dataPoints = domainKnowledge.expertiseAreas.length;
          break;
        }
        case 'tool_usage': {
          const toolUsage = await this.getToolUsagePatterns(userId, options);
          context.toolPreferences = toolUsage.preferences;
          context.usageFrequency = toolUsage.frequency;
          context.successRates = toolUsage.successRates;
          metadata.dataPoints = Object.keys(toolUsage.preferences).length;
          break;
        }
        case 'performance': {
          const performance = await this.getPerformanceMetrics(userId, options);
          context.responseTimes = performance.responseTimes;
          context.accuracy = performance.accuracy;
          context.costEfficiency = performance.costEfficiency;
          context.optimizationSuggestions = performance.suggestions;
          metadata.dataPoints = performance.responseTimes.length;
          break;
        }
        default: {
          const unknownType: string = contextType;
          throw new Error(`Unknown context type: ${unknownType}`);
        }
      }

      let embeddings: number[] | undefined;
      if (options?.includeEmbeddings) {
        // Generate embeddings for the context (simplified - would use actual embedding service)
        const contextString = JSON.stringify(context);
        embeddings = await this.generateContextEmbeddings(contextString);
      }

      this.logger.log('Agent knowledge context retrieved', {
        userId,
        contextType,
        dataPoints: metadata.dataPoints,
      });

      return {
        context,
        metadata,
        embeddings,
      };
    } catch (error) {
      this.logger.error('Failed to get agent knowledge context', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        contextType,
      });
      throw error;
    }
  }

  /**
   * Helper method to get user interaction history from Usage collection.
   * Maps prompt/completion and createdAt to query/response/timestamp; tools from metadata or tags.
   */
  private async getUserInteractionHistory(
    userId: string,
    options?: { timeRange?: { from: Date; to: Date }; limit?: number },
  ): Promise<
    Array<{ query: string; response: string; timestamp: Date; tools: string[] }>
  > {
    if (options?.limit !== undefined && options.limit <= 0) {
      return [];
    }
    const limit = Math.min(options?.limit ?? 100, 500);
    const filter: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
    };
    if (options?.timeRange?.from || options?.timeRange?.to) {
      filter.createdAt = {};
      if (options.timeRange.from) {
        (filter.createdAt as Record<string, Date>).$gte =
          options.timeRange.from;
      }
      if (options.timeRange.to) {
        (filter.createdAt as Record<string, Date>).$lte = options.timeRange.to;
      }
    }
    const docs = await this.usageModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('prompt completion createdAt metadata tags')
      .lean()
      .exec();
    return docs.map(
      (d: {
        prompt?: string;
        completion?: string;
        createdAt?: Date;
        metadata?: { toolsUsed?: string[]; endpoint?: string };
        tags?: string[];
      }) => ({
        query: d.prompt ?? '',
        response: d.completion ?? '',
        timestamp: d.createdAt ? new Date(d.createdAt) : new Date(),
        tools: Array.isArray(d.metadata?.toolsUsed)
          ? d.metadata.toolsUsed
          : (d.tags ?? []).filter((t): t is string => typeof t === 'string'),
      }),
    );
  }

  /**
   * Helper method to extract frequent queries
   */
  private extractFrequentQueries(history: Array<{ query: string }>): string[] {
    const queryCount: Record<string, number> = {};
    history.forEach((item) => {
      // Only use trimmed and non-empty queries
      if (item.query && typeof item.query === 'string') {
        const cleaned = item.query.trim();
        if (cleaned) {
          queryCount[cleaned] = (queryCount[cleaned] || 0) + 1;
        }
      }
    });

    return Object.entries(queryCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([query]) => query);
  }

  /**
   * Helper method to extract preferred tools
   */
  private extractPreferredTools(
    history: Array<{ tools: string[] }>,
  ): Record<string, number> {
    const toolCount: Record<string, number> = {};
    history.forEach((item) => {
      if (Array.isArray(item.tools)) {
        item.tools.forEach((tool: string) => {
          const cleanTool = (tool || '').trim();
          if (cleanTool) {
            toolCount[cleanTool] = (toolCount[cleanTool] || 0) + 1;
          }
        });
      }
    });
    return toolCount;
  }

  /**
   * Helper method to get domain expertise
   */
  private async getDomainExpertise(
    userId: string,
    options?: {
      recentOnly?: boolean;
      minInteractions?: number;
      timeRange?: { from: Date; to: Date };
      limit?: number;
    },
  ): Promise<{
    expertiseAreas: string[];
    confidenceScores: Record<string, number>;
    knowledgeGaps: string[];
  }> {
    const timeRange =
      options?.timeRange ??
      (options?.recentOnly
        ? {
            from: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
            to: new Date(),
          }
        : undefined);

    const history = await this.getUserInteractionHistory(userId, {
      timeRange,
      limit: options?.limit,
    });

    const requiredForExpertise = options?.minInteractions ?? 5;
    const domainCount: Record<string, number> = {};
    history.forEach(
      (item: {
        query: string;
        response: string;
        timestamp: Date;
        tools: string[];
      }) => {
        (item.tools || []).forEach((tool: string) => {
          // Use a mapping of tools to domains (could be moved to config)
          if (tool.includes('web-search'))
            domainCount['research'] = (domainCount['research'] || 0) + 1;
          if (tool.includes('knowledge-base'))
            domainCount['general'] = (domainCount['general'] || 0) + 1;
          if (tool.includes('finance'))
            domainCount['finance'] = (domainCount['finance'] || 0) + 1;
          if (tool.includes('ai'))
            domainCount['ai'] = (domainCount['ai'] || 0) + 1;
          if (tool.includes('cloud'))
            domainCount['cloud-architecture'] =
              (domainCount['cloud-architecture'] || 0) + 1;
          // Add more domain mappings as needed
        });
      },
    );

    const expertiseAreas = Object.entries(domainCount)
      .filter(
        (entry): entry is [string, number] => entry[1] >= requiredForExpertise,
      )
      .map(([domain]) => domain);

    const confidenceScores: Record<string, number> = {};
    const maxCount = Math.max(...Object.values(domainCount), 1);
    Object.entries(domainCount).forEach(([domain, count]) => {
      confidenceScores[domain] = +(count / maxCount).toFixed(2);
    });

    // 4. Find knowledge gaps from underrepresented domains
    const allDomains = [
      'general',
      'technical',
      'finance',
      'research',
      'ai',
      'cloud-architecture',
    ];
    const knowledgeGaps = allDomains.filter(
      (d) =>
        !expertiseAreas.includes(d) &&
        (domainCount[d] || 0) < requiredForExpertise / 2,
    );

    return {
      expertiseAreas: expertiseAreas.length ? expertiseAreas : ['general'],
      confidenceScores,
      knowledgeGaps,
    };
  }

  /**
   * Helper method to get tool usage patterns from Usage collection.
   * Uses model + metadata.endpoint as "tool" and derives preferences, frequency, success rates.
   */
  private async getToolUsagePatterns(
    userId: string,
    options?: { timeRange?: { from: Date; to: Date }; limit?: number },
  ): Promise<{
    preferences: Record<string, number>;
    frequency: Record<string, number>;
    successRates: Record<string, number>;
  }> {
    const filter: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
    };
    if (options?.timeRange?.from || options?.timeRange?.to) {
      filter.createdAt = {};
      if (options.timeRange.from) {
        (filter.createdAt as Record<string, Date>).$gte =
          options.timeRange.from;
      }
      if (options.timeRange.to) {
        (filter.createdAt as Record<string, Date>).$lte = options.timeRange.to;
      }
    }
    const limit = Math.min(options?.limit ?? 1000, 5000);
    const docs = await this.usageModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('model metadata cost errorOccurred')
      .lean()
      .exec();
    const frequency: Record<string, number> = {};
    const successTotals: Record<string, { succ: number; total: number }> = {};
    for (const d of docs as Array<{
      model?: string;
      metadata?: { endpoint?: string };
      errorOccurred?: boolean;
    }>) {
      const tool = d.metadata?.endpoint ?? d.model ?? 'unknown';
      frequency[tool] = (frequency[tool] ?? 0) + 1;
      if (!successTotals[tool]) {
        successTotals[tool] = { succ: 0, total: 0 };
      }
      successTotals[tool].total += 1;
      if (!d.errorOccurred) {
        successTotals[tool].succ += 1;
      }
    }
    const maxFreq = Math.max(...Object.values(frequency), 1);
    const preferences: Record<string, number> = {};
    for (const [tool, count] of Object.entries(frequency)) {
      preferences[tool] = Number(((count / maxFreq) * 100) / 100);
    }
    const successRates: Record<string, number> = {};
    for (const [tool, st] of Object.entries(successTotals)) {
      successRates[tool] =
        st.total > 0 ? Number((st.succ / st.total).toFixed(2)) : 0;
    }
    return { preferences, frequency, successRates };
  }

  /**
   * Helper method to get performance metrics from Usage collection.
   * Aggregates responseTime, errorOccurred, and cost for the user.
   */
  private async getPerformanceMetrics(
    userId: string,
    options?: { timeRange?: { from: Date; to: Date }; limit?: number },
  ): Promise<{
    responseTimes: number[];
    accuracy: number;
    costEfficiency: number;
    suggestions: string[];
  }> {
    const filter: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
    };
    if (options?.timeRange?.from || options?.timeRange?.to) {
      filter.createdAt = {};
      if (options.timeRange.from) {
        (filter.createdAt as Record<string, Date>).$gte =
          options.timeRange.from;
      }
      if (options.timeRange.to) {
        (filter.createdAt as Record<string, Date>).$lte = options.timeRange.to;
      }
    }
    const limit = Math.min(options?.limit ?? 500, 2000);
    const docs = await this.usageModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('responseTime cost errorOccurred totalTokens')
      .lean()
      .exec();
    const responseTimes = (docs as Array<{ responseTime?: number }>)
      .map((d) => d.responseTime ?? 0)
      .filter((t) => t > 0);
    const total = docs.length;
    const successCount = (docs as Array<{ errorOccurred?: boolean }>).filter(
      (d) => !d.errorOccurred,
    ).length;
    const accuracy = total > 0 ? Number((successCount / total).toFixed(2)) : 0;
    const totalCost = (docs as Array<{ cost?: number }>).reduce(
      (sum, d) => sum + (d.cost ?? 0),
      0,
    );
    const totalTokens = (docs as Array<{ totalTokens?: number }>).reduce(
      (sum, d) => sum + (d.totalTokens ?? 0),
      1,
    );
    const costEfficiency =
      totalTokens > 0
        ? Number(
            (1 - Math.min(totalCost / (totalTokens * 0.0001), 1)).toFixed(2),
          )
        : 0;
    const suggestions: string[] = [];
    const avgResp =
      responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : 0;
    if (avgResp > 1000) {
      suggestions.push('Consider using caching or optimizing slow queries.');
    }
    if (accuracy < 0.7) {
      suggestions.push('Increase accuracy by reviewing output validation.');
    }
    if (costEfficiency < 0.5) {
      suggestions.push('Analyze and reduce resource usage or redundant calls.');
    }
    if (suggestions.length === 0) {
      suggestions.push('System performance is within expected parameters.');
    }
    return {
      responseTimes,
      accuracy,
      costEfficiency,
      suggestions,
    };
  }

  /**
   * Generate context embeddings for RAG/knowledge context.
   * Uses VectorStoreService (Bedrock Titan) when available; falls back to deterministic hash-based vector.
   */
  private async generateContextEmbeddings(
    contextString: string,
  ): Promise<number[]> {
    try {
      if (
        this.vectorStore &&
        typeof this.vectorStore.embedText === 'function'
      ) {
        return await this.vectorStore.embedText(contextString);
      }
    } catch (err) {
      this.logger.warn('Vector store embedText failed, using fallback', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
    const hash = contextString
      .split('')
      .reduce((acc, char, idx) => acc + char.charCodeAt(0) * (idx + 1), 0);
    return Array.from(
      { length: 384 },
      (_, i) => ((hash + i * 17) % 1000) / 1000,
    );
  }

  /**
   * Build hierarchical execution tree for agent coordination
   */
  private async buildHierarchicalExecutionTree(
    participatingAgents: string[],
    primaryQuery: string,
    userId: string,
  ): Promise<HierarchicalExecutionNode> {
    // Create a tree structure where agents are organized hierarchically
    // Root node coordinates, intermediate nodes specialize, leaf nodes execute

    const rootNode: HierarchicalExecutionNode = {
      agentId: 'coordinator',
      level: 0,
      children: [],
      context: { primaryQuery, userId },
      executionStrategy: 'parallel',
    };

    // Categorize agents by type
    const specializedAgents = participatingAgents.filter(
      (agent) => agent.includes('specialist') || agent.includes('expert'),
    );
    const utilityAgents = participatingAgents.filter(
      (agent) => agent.includes('utility') || agent.includes('tool'),
    );
    const analysisAgents = participatingAgents.filter(
      (agent) => agent.includes('analyzer') || agent.includes('reviewer'),
    );

    // Build hierarchical structure
    if (specializedAgents.length > 0) {
      const specialistNode: HierarchicalExecutionNode = {
        agentId: 'specialist_coordinator',
        level: 1,
        parentId: 'coordinator',
        children: specializedAgents.map((agentId) => ({
          agentId,
          level: 2,
          parentId: 'specialist_coordinator',
          children: [],
          executionStrategy: 'sequential',
        })),
        executionStrategy: 'parallel',
      };
      rootNode.children.push(specialistNode);
    }

    if (analysisAgents.length > 0) {
      const analysisNode: HierarchicalExecutionNode = {
        agentId: 'analysis_coordinator',
        level: 1,
        parentId: 'coordinator',
        children: analysisAgents.map((agentId) => ({
          agentId,
          level: 2,
          parentId: 'analysis_coordinator',
          children: [],
          executionStrategy: 'parallel',
        })),
        executionStrategy: 'parallel',
      };
      rootNode.children.push(analysisNode);
    }

    if (utilityAgents.length > 0) {
      const utilityNode: HierarchicalExecutionNode = {
        agentId: 'utility_coordinator',
        level: 1,
        parentId: 'coordinator',
        children: utilityAgents.map((agentId) => ({
          agentId,
          level: 2,
          parentId: 'utility_coordinator',
          children: [],
          executionStrategy: 'parallel',
        })),
        executionStrategy: 'parallel',
      };
      rootNode.children.push(utilityNode);
    }

    return rootNode;
  }

  /**
   * Execute hierarchical tree structure
   */
  private async executeHierarchicalTree(
    tree: HierarchicalExecutionNode,
    contributions: Array<{
      agentId: string;
      contribution: any;
      executionTime: number;
      level: number;
      parentAgent?: string;
      childAgents?: string[];
    }>,
    sharedContext: Record<string, any>,
  ): Promise<AgentResponse> {
    // Execute root coordinator
    const rootResult = await this.executeAgentNode(
      tree,
      sharedContext,
      contributions,
    );

    // Execute child branches in parallel
    const childPromises = tree.children.map((child) =>
      this.executeHierarchicalTree(child, contributions, {
        ...sharedContext,
        parentResult: rootResult,
      }),
    );

    const childResults = await Promise.allSettled(childPromises);
    const successfulResults = childResults
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);

    // Aggregate results from all branches
    return this.aggregateHierarchicalResults([
      rootResult,
      ...successfulResults,
    ]);
  }

  /**
   * Execute individual agent node in hierarchy
   */
  private async executeAgentNode(
    node: HierarchicalExecutionNode,
    context: Record<string, any>,
    contributions: Array<{
      agentId: string;
      contribution: any;
      executionTime: number;
      level: number;
      parentAgent?: string;
      childAgents?: string[];
    }>,
  ): Promise<AgentResponse> {
    const startTime = Date.now();

    try {
      // Special handling for coordinator nodes
      if (node.agentId.includes('coordinator')) {
        const coordinatorResult: AgentResponse = {
          success: true,
          response: `Coordinated execution of ${node.children.length} agent branches`,
          metadata: {
            coordinator: true,
            childBranches: node.children.length,
            executionStrategy: node.executionStrategy,
          },
          usage: { tokens: 0, cost: 0 },
        };

        contributions.push({
          agentId: node.agentId,
          contribution: coordinatorResult,
          executionTime: Date.now() - startTime,
          level: node.level,
          parentAgent: node.parentId,
          childAgents: node.children.map((child) => child.agentId),
        });

        return coordinatorResult;
      }

      // Execute actual agent
      const agentResponse = await this.query({
        userId: context.userId || 'system',
        query: context.primaryQuery || 'Execute hierarchical task',
        context: {
          ...context,
          hierarchicalLevel: node.level,
          parentAgent: node.parentId,
          executionStrategy: node.executionStrategy,
        },
      });

      contributions.push({
        agentId: node.agentId,
        contribution: agentResponse,
        executionTime: Date.now() - startTime,
        level: node.level,
        parentAgent: node.parentId,
        childAgents: node.children?.map((child) => child.agentId),
      });

      return agentResponse;
    } catch (error) {
      this.logger.error(`Agent node execution failed: ${node.agentId}`, {
        error: error instanceof Error ? error.message : String(error),
        level: node.level,
      });

      const errorResponse: AgentResponse = {
        success: false,
        response: `Agent execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        metadata: { error: true },
        usage: { tokens: 0, cost: 0 },
      };

      contributions.push({
        agentId: node.agentId,
        contribution: errorResponse,
        executionTime: Date.now() - startTime,
        level: node.level,
        parentAgent: node.parentId,
      });

      return errorResponse;
    }
  }

  /**
   * Aggregate results from hierarchical execution
   */
  private aggregateHierarchicalResults(
    results: AgentResponse[],
  ): AgentResponse {
    const validResults = results.filter((r) => !r.metadata?.error);

    if (validResults.length === 0) {
      return {
        success: false,
        response: 'All hierarchical executions failed',
        metadata: { error: true, hierarchicalFailure: true },
        usage: { tokens: 0, cost: 0 },
      };
    }

    // Combine responses from different branches
    const combinedResponse = validResults
      .map((r) => r.response)
      .filter((r) => r && typeof r === 'string')
      .join('\n\n');

    const totalTokens = validResults.reduce(
      (sum, r) => sum + (r.usage?.tokens || 0),
      0,
    );
    const totalCost = validResults.reduce(
      (sum, r) => sum + (r.usage?.cost || 0),
      0,
    );

    return {
      success: true,
      response: combinedResponse || 'Hierarchical execution completed',
      metadata: {
        hierarchicalExecution: true,
        branchesExecuted: validResults.length,
        totalBranches: results.length,
      },
      usage: { tokens: totalTokens, cost: totalCost },
    };
  }

  /**
   * Calculate depth of hierarchical tree
   */
  private calculateTreeDepth(tree: HierarchicalExecutionNode): number {
    if (!tree.children || tree.children.length === 0) {
      return tree.level;
    }

    const childDepths = tree.children.map((child) =>
      this.calculateTreeDepth(child),
    );
    return Math.max(...childDepths);
  }
}

/**
 * Interfaces for hierarchical coordination
 */
interface HierarchicalExecutionNode {
  agentId: string;
  level: number;
  parentId?: string;
  children: HierarchicalExecutionNode[];
  context?: Record<string, any>;
  executionStrategy: 'parallel' | 'sequential';
}
