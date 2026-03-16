import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { BaseMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { LoggerService } from '../../../common/logger/logger.service';
import { MemoryService } from '../../../modules/memory/services/memory.service';
import { GroundingConfidenceService } from '../../../modules/utils/services/grounding-confidence.service';
import { SemanticCacheService } from '../../../modules/ingestion/services/semantic-cache.service';
import { WebSearchService } from './web-search.service';
import { TrendingDetectorService } from './trending-detector.service';
import { MongoDBChatAgentService } from './mongodb-chat-agent.service';
import { LangchainOrchestratorService } from '../langchain/langchain-orchestrator.service';
import { BedrockService } from '../../../services/bedrock.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Usage } from '../../../schemas/core/usage.schema';

// MultiAgentStateAnnotation with all Express fields and reducers
const MultiAgentStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    value: (current: BaseMessage[], update: BaseMessage[]) =>
      current.concat(update),
    default: () => [],
  }),
  currentAgent: Annotation<string>({
    value: (x: string, y: string) => y ?? x,
    default: () => 'master',
  }),
  taskType: Annotation<string>({ value: (x, y) => y ?? x }),
  userId: Annotation<string>({ value: (x, y) => y ?? x }),
  conversationId: Annotation<string>({ value: (x, y) => y ?? x }),
  costBudget: Annotation<number>({
    value: (x, y) => y ?? x,
    default: () => 0.1,
  }),
  chatMode: Annotation<'fastest' | 'cheapest' | 'balanced'>({
    value: (x, y) => y ?? x,
    default: () => 'balanced',
  }),
  optimizationsApplied: Annotation<string[]>({
    value: (c, u) => c.concat(u),
  }),
  cacheHit: Annotation<boolean>({
    value: (x, y) => y ?? x,
    default: () => false,
  }),
  agentPath: Annotation<string[]>({
    value: (c, u) => c.concat(u),
  }),
  memoryContext: Annotation<any | null>({
    value: (x, y) => y ?? x,
    default: () => null,
  }),
  personalizedRecommendations: Annotation<string[]>({
    value: (c, u) => c.concat(u),
  }),
  userPreferences: Annotation<any>({ value: (x, y) => y ?? x }),
  riskLevel: Annotation<string>({ value: (x, y) => y ?? x }),
  promptCost: Annotation<number>({ value: (x, y) => y ?? x, default: () => 0 }),
  refinedPrompt: Annotation<string>({ value: (x, y) => y ?? x }),
  semanticCacheResult: Annotation<any>({ value: (x, y) => y ?? x }),
  failureCount: Annotation<number>({
    value: (x, y) => (y ?? 0) + (x ?? 0),
  }),
  metadata: Annotation<Record<string, any>>({
    value: (x, y) => ({ ...x, ...y }),
  }),
  needsWebData: Annotation<boolean>({
    value: (x, y) => y ?? x,
    default: () => false,
  }),
  scrapingResults: Annotation<any[]>({
    value: (c, u) => c.concat(u),
  }),
  webSources: Annotation<string[]>({
    value: (c, u) => c.concat(u),
  }),
  userInputCollection: Annotation<{
    active: boolean;
    currentField: string;
    collectedData: any;
    progress: number;
  }>({
    value: (x, y) => y ?? x,
    default: () => ({
      active: false,
      currentField: '',
      collectedData: {},
      progress: 0,
    }),
  }),
  strategyFormation: Annotation<{
    questions: string[];
    responses: string[];
    currentQuestion: string;
    isComplete: boolean;
    adaptiveQuestions: string[];
  }>({
    value: (x, y) => y ?? x,
    default: () => ({
      questions: [],
      responses: [],
      currentQuestion: '',
      isComplete: false,
      adaptiveQuestions: [],
    }),
  }),
  requiresIntegrationSelector: Annotation<boolean | undefined>({
    value: (x, y) => y ?? x,
  }),
  integrationSelectorData: Annotation<any>({ value: (x, y) => y ?? x }),
  mongodbIntegrationData: Annotation<any>({ value: (x, y) => y ?? x }),
  formattedResult: Annotation<any>({ value: (x, y) => y ?? x }),
  groundingDecision: Annotation<any | undefined>({ value: (x, y) => y ?? x }),
  clarificationAttempts: Annotation<number>({
    value: (x, y) => (y ?? 0) + (x ?? 0),
  }),
  searchAttempts: Annotation<number>({
    value: (x, y) => (y ?? 0) + (x ?? 0),
  }),
  requiresClarification: Annotation<boolean>({
    value: (x, y) => y ?? x,
    default: () => false,
  }),
  refused: Annotation<boolean>({
    value: (x, y) => y ?? x,
    default: () => false,
  }),
  queryDomain: Annotation<string | undefined>({ value: (x, y) => y ?? x }),
  contextDriftHigh: Annotation<boolean>({
    value: (x, y) => y ?? x,
    default: () => false,
  }),
  prohibitMemoryWrite: Annotation<boolean>({
    value: (x, y) => y ?? x,
    default: () => false,
  }),
});

type MultiAgentState = typeof MultiAgentStateAnnotation.State;

export interface MultiAgentQuery {
  userId: string;
  query: string;
  context?: Partial<MultiAgentState>;
  /** Optional priority for scheduling (e.g. 'low' | 'medium' | 'high') */
  priority?: string;
  /** Optional list of agent names to prefer in the workflow */
  requiredAgents?: string[];
}

export interface MultiAgentResponse {
  success: boolean;
  response?: string;
  error?: string;
  agentPath: string[];
  optimizationsApplied: string[];
  costSavings?: number;
  executionTime: number;
  metadata: Record<string, any>;
}

@Injectable()
export class MultiAgentFlowService {
  private workflow: any;
  private costHistory: Array<{
    timestamp: number;
    cost: number;
    chatMode: string;
    cacheHit: boolean;
    agentPath: string[];
  }> = [];

  constructor(
    private readonly logger: LoggerService,
    @Inject(forwardRef(() => MemoryService))
    private readonly memoryService: MemoryService,
    @Inject(forwardRef(() => GroundingConfidenceService))
    private readonly groundingConfidence: GroundingConfidenceService,
    @Inject(forwardRef(() => SemanticCacheService))
    private readonly semanticCache: SemanticCacheService,
    @Inject(forwardRef(() => WebSearchService))
    private readonly webSearchService: WebSearchService,
    private readonly trendingDetector: TrendingDetectorService,
    private readonly bedrockService: BedrockService,
    private readonly mongodbChatAgentService: MongoDBChatAgentService,
    private readonly langchainOrchestrator: LangchainOrchestratorService,
    @InjectModel(Usage.name) private readonly usageModel: Model<Usage>,
  ) {
    this.initializeWorkflow();
  }

  /**
   * Initialize the 15-node LangGraph workflow
   */
  private initializeWorkflow(): void {
    this.workflow = new StateGraph(MultiAgentStateAnnotation)
      .addNode('memory_reader', this.memoryReaderNode.bind(this))
      .addNode('prompt_analyzer', this.promptAnalyzerNode.bind(this))
      .addNode('trending_detector', this.trendingDetectorNode.bind(this))
      .addNode('web_scraper', this.webScrapingNode.bind(this))
      .addNode('content_summarizer', this.contentSummarizerNode.bind(this))
      .addNode('semantic_cache', this.semanticCacheNode.bind(this))
      .addNode('grounding_gate', this.groundingGateNode.bind(this))
      .addNode('clarification_needed', this.clarificationNeededNode.bind(this))
      .addNode('refuse_safely', this.refuseSafelyNode.bind(this))
      .addNode('master_agent', this.masterAgentNode.bind(this))
      .addNode(
        'master_agent_with_langchain',
        this.masterAgentWithLangchain.bind(this),
      )
      .addNode('cost_optimizer', this.costOptimizerNode.bind(this))
      .addNode('quality_analyst', this.qualityAnalystNode.bind(this))
      .addNode('memory_writer', this.memoryWriterNode.bind(this))
      .addNode('failure_recovery', this.failureRecoveryNode.bind(this))

      // Fixed edges
      .addEdge(START, 'memory_reader')
      .addEdge('memory_reader', 'prompt_analyzer')
      .addEdge('cost_optimizer', 'quality_analyst')
      .addEdge('quality_analyst', 'memory_writer')
      .addEdge('memory_writer', END)
      .addEdge('failure_recovery', END)
      .addEdge('clarification_needed', END)
      .addEdge('refuse_safely', END)

      // Conditional edges
      .addConditionalEdges(
        'prompt_analyzer',
        this.routeAfterPromptAnalysis.bind(this),
        ['trending_detector', 'semantic_cache', 'grounding_gate'],
      )
      .addConditionalEdges(
        'trending_detector',
        this.routeAfterTrendingDetection.bind(this),
        ['web_scraper', 'semantic_cache', 'grounding_gate'],
      )
      .addConditionalEdges(
        'web_scraper',
        this.routeAfterWebScraping.bind(this),
        ['content_summarizer', 'grounding_gate'],
      )
      .addConditionalEdges(
        'content_summarizer',
        this.routeAfterContentSummarization.bind(this),
        ['grounding_gate', END],
      )
      .addConditionalEdges('semantic_cache', this.routeAfterCache.bind(this), [
        'grounding_gate',
        END,
      ])
      .addConditionalEdges(
        'grounding_gate',
        this.routeAfterGroundingGate.bind(this),
        [
          'master_agent',
          'clarification_needed',
          'web_scraper',
          'refuse_safely',
        ],
      )
      .addConditionalEdges('master_agent', this.routeFromMaster.bind(this), [
        'master_agent_with_langchain',
        'cost_optimizer',
        'quality_analyst',
        'failure_recovery',
        END,
      ])

      .compile();
  }

  /**
   * Return workflow capabilities (agents and workflow names) for health/readiness checks.
   */
  getCapabilities(): { agents: string[]; workflows: string[] } {
    const agents = [
      'memory_reader',
      'prompt_analyzer',
      'trending_detector',
      'web_scraper',
      'content_summarizer',
      'semantic_cache',
      'grounding_gate',
      'clarification_needed',
      'refuse_safely',
      'master_agent',
      'cost_optimizer',
      'quality_analyst',
      'memory_writer',
      'failure_recovery',
    ];
    return {
      agents,
      workflows: ['langgraph_multi_agent'],
    };
  }

  /**
   * Extract string content from LangGraph message
   */
  private extractMessageContent(message: BaseMessage): string {
    if (!message || !message.content) return '';

    if (typeof message.content === 'string') {
      return message.content;
    }

    if (Array.isArray(message.content)) {
      return message.content
        .map((item) => {
          if (typeof item === 'string') return item;
          if (typeof item === 'object' && item && 'text' in item)
            return (item as any).text || '';
          return '';
        })
        .join('');
    }

    return String(message.content);
  }

  /**
   * Retry executor with exponential backoff
   */
  private async retryExecutor<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000,
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt === maxRetries) {
          break;
        }

        const delay = baseDelay * Math.pow(2, attempt);
        this.logger.warn(
          `Attempt ${attempt + 1} failed, retrying in ${delay}ms`,
          {
            error: lastError.message,
          },
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError!;
  }

  // ===== NODE METHODS =====

  /**
   * Memory Reader Node - Loads conversation context
   */
  private async memoryReaderNode(
    state: MultiAgentState,
  ): Promise<Partial<MultiAgentState>> {
    this.logger.debug('Memory Reader Node: Loading context', {
      userId: state.userId,
    });

    const query =
      this.extractMessageContent(state.messages[state.messages.length - 1]) ||
      '';

    try {
      const memoryContext = await this.memoryService.processMemoryRead({
        userId: state.userId,
        conversationId: state.conversationId,
        query,
      });

      return {
        memoryContext,
        agentPath: ['memory_reader'],
      };
    } catch (error) {
      this.logger.warn('Memory reader failed, continuing without context', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        memoryContext: null,
        agentPath: ['memory_reader'],
      };
    }
  }

  /**
   * Prompt Analyzer Node - Analyzes query for cost/complexity/trending patterns
   */
  private async promptAnalyzerNode(
    state: MultiAgentState,
  ): Promise<Partial<MultiAgentState>> {
    const message =
      this.extractMessageContent(state.messages[state.messages.length - 1]) ||
      '';
    this.logger.debug('Prompt Analyzer Node: Analyzing query', {
      messageLength: message.length,
    });

    // Heuristic analysis for cost and domain detection
    const isCostQuery =
      /\b(cost|spend|budget|expensive|cheap|optimize|save|money)\b/i.test(
        message,
      );
    const isComplexQuery =
      message.length > 200 ||
      /\b(analyze|compare|research|comprehensive|detailed)\b/i.test(message);
    const needsWebData =
      /\b(current|latest|news|trending|breaking|today|recent)\b/i.test(message);

    const taskType = isCostQuery
      ? 'cost_optimization'
      : isComplexQuery
        ? 'complex_analysis'
        : 'general';

    return {
      taskType,
      needsWebData,
      agentPath: ['prompt_analyzer'],
      metadata: {
        analyzedCost: isCostQuery,
        analyzedComplexity: isComplexQuery,
        analyzedWebNeed: needsWebData,
      },
    };
  }

  /**
   * Trending Detector Node - Checks if query needs fresh web data
   */
  private async trendingDetectorNode(
    state: MultiAgentState,
  ): Promise<Partial<MultiAgentState>> {
    const message = this.extractMessageContent(
      state.messages[state.messages.length - 1],
    );
    const shouldCheckTrending = this.trendingDetector.quickCheck(message);

    this.logger.debug('Trending Detector Node', {
      messageSnippet: message.substring(0, 100),
      trendingDetected: shouldCheckTrending,
    });

    return {
      needsWebData: shouldCheckTrending,
      agentPath: ['trending_detector'],
    };
  }

  /**
   * Web Scraping Node - Performs web search when needed
   */
  private async webScrapingNode(
    state: MultiAgentState,
  ): Promise<Partial<MultiAgentState>> {
    if (!state.needsWebData) {
      return { agentPath: ['web_scraper'] };
    }

    if (!this.webSearchService.isConfigured?.()) {
      this.logger.debug('Web Scraper Node: Search not configured, skipping');
      return {
        agentPath: ['web_scraper'],
        metadata: { webSearchSkipped: true, reason: 'not_configured' },
      };
    }

    const query = this.extractMessageContent(
      state.messages[state.messages.length - 1],
    );
    this.logger.debug('Web Scraper Node: Searching', {
      queryLength: query.length,
    });

    try {
      const results = await this.webSearchService.search(query, {
        maxResults: 5,
      });

      return {
        scrapingResults: results ?? [],
        webSources: (results ?? []).map(
          (r: any) => r.url || r.title || 'unknown',
        ),
        agentPath: ['web_scraper'],
        metadata: {
          webSearchCompleted: true,
          resultsCount: (results ?? []).length,
        },
      };
    } catch (error) {
      this.logger.warn('Web scraping failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        agentPath: ['web_scraper'],
        metadata: { webSearchError: true },
      };
    }
  }

  /**
   * Content Summarizer Node - Summarizes web results using Bedrock
   */
  private async contentSummarizerNode(
    state: MultiAgentState,
  ): Promise<Partial<MultiAgentState>> {
    if (!state.scrapingResults || state.scrapingResults.length === 0) {
      return { agentPath: ['content_summarizer'] };
    }

    const prompt = `Summarize the following web search results into key insights and facts:

${state.scrapingResults
  .map((r: any, i: number) => {
    const text =
      r.content?.content ||
      r.content?.extractedText ||
      r.snippet ||
      'No content';
    return `[${i + 1}] ${r.title || 'No title'}\n${text}`;
  })
  .join('\n\n')}

Provide a concise summary highlighting the most relevant and current information.`;

    try {
      const response = await this.retryExecutor(async () => {
        return await this.bedrockService.invokeModel(
          prompt,
          'amazon.nova-pro-v1:0',
          {
            temperature: 0.1,
            maxTokens: 1000,
          },
        );
      });

      const summary =
        typeof response === 'string' ? response : response?.response || '';
      const cost =
        typeof response === 'object' && response && 'cost' in response
          ? (response as any).cost
          : 0;

      return {
        agentPath: ['content_summarizer'],
        promptCost: (state.promptCost ?? 0) + cost,
        metadata: { contentSummary: summary, summaryLength: summary.length },
      };
    } catch (error) {
      this.logger.warn('Content summarization failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        agentPath: ['content_summarizer'],
        metadata: { summarizationError: true },
      };
    }
  }

  /**
   * Semantic Cache Node - Checks for cached similar queries
   */
  private async semanticCacheNode(
    state: MultiAgentState,
  ): Promise<Partial<MultiAgentState>> {
    const message = this.extractMessageContent(
      state.messages[state.messages.length - 1],
    );

    try {
      const cacheResult = await this.semanticCache.detectCachingOpportunity(
        state.userId,
        message,
        0.85, // 85% similarity threshold
      );

      if (cacheResult?.found && cacheResult.cachedResponse != null) {
        const cachedText =
          typeof cacheResult.cachedResponse === 'string'
            ? cacheResult.cachedResponse
            : (cacheResult.cachedResponse?.response ??
              cacheResult.cachedResponse?.content ??
              String(cacheResult.cachedResponse));
        const cachedMessage = new AIMessage(cachedText);

        return {
          cacheHit: true,
          semanticCacheResult: cacheResult,
          messages: [cachedMessage],
          agentPath: ['semantic_cache'],
          metadata: {
            cacheHit: true,
            similarityScore: cacheResult.similarityScore,
          },
        };
      }

      return {
        cacheHit: false,
        agentPath: ['semantic_cache'],
        metadata: { cacheMiss: true },
      };
    } catch (error) {
      this.logger.warn('Semantic cache check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        cacheHit: false,
        agentPath: ['semantic_cache'],
        metadata: { cacheError: true },
      };
    }
  }

  /**
   * Grounding Gate Node - Evaluates confidence before generation
   */
  private async groundingGateNode(
    state: MultiAgentState,
  ): Promise<Partial<MultiAgentState>> {
    const message = this.extractMessageContent(
      state.messages[state.messages.length - 1],
    );
    const context = {
      query: message,
      queryType: 'factual' as const,
      hasMemoryContext: !!state.memoryContext,
      hasWebData: state.scrapingResults && state.scrapingResults.length > 0,
      cacheHit: state.cacheHit,
      searchAttempts: state.searchAttempts,
      clarificationAttempts: state.clarificationAttempts,
      retrieval: {
        hitCount: state.memoryContext ? 1 : 0,
        relevantHits: state.memoryContext ? 1 : 0,
        sources: state.memoryContext ? ['memory'] : [],
      },
      intent: { clarity: 0.5, specificity: 0.5 },
      freshness: { averageAgeHours: 24, freshnessScore: 0.5 },
    };

    try {
      const decision = await this.groundingConfidence.evaluate(context);

      return {
        groundingDecision: decision,
        agentPath: ['grounding_gate'],
        requiresClarification: decision.decision === 'ASK_CLARIFY',
        refused: decision.decision === 'REFUSE',
        metadata: { groundingDecision: decision },
      };
    } catch (error) {
      this.logger.warn('Grounding confidence evaluation failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Default to generate on error
      return {
        groundingDecision: { decision: 'GENERATE', confidence: 0.5 },
        agentPath: ['grounding_gate'],
        metadata: { groundingError: true },
      };
    }
  }

  /**
   * Clarification Needed Node - Generates clarification request
   */
  private async clarificationNeededNode(
    state: MultiAgentState,
  ): Promise<Partial<MultiAgentState>> {
    const clarificationMessage = new AIMessage(
      "I need more specific information to provide a helpful response. Could you please clarify what you're looking for?",
    );

    return {
      messages: [clarificationMessage],
      clarificationAttempts: (state.clarificationAttempts ?? 0) + 1,
      agentPath: ['clarification_needed'],
    };
  }

  /**
   * Refuse Safely Node - Generates safe refusal
   */
  private async refuseSafelyNode(
    state: MultiAgentState,
  ): Promise<Partial<MultiAgentState>> {
    const refusalMessage = new AIMessage(
      "I'm sorry, but I cannot assist with this request as it may violate safety guidelines or require information I don't have access to.",
    );

    return {
      messages: [refusalMessage],
      agentPath: ['refuse_safely'],
    };
  }

  /**
   * Master Agent Node - Main AI generation with optional Langchain integration
   */
  private async masterAgentNode(
    state: MultiAgentState,
  ): Promise<Partial<MultiAgentState>> {
    const userMessage = this.extractMessageContent(
      state.messages[state.messages.length - 1],
    );
    const useLangchainIntegration =
      this.shouldUseLangchainIntegration(userMessage);

    const systemPrompt = `You are Cost Katana, an AI-powered cost optimization assistant for developers and organizations.

You help users monitor, analyze, and optimize their AI API costs across multiple providers. Provide helpful, accurate responses while being mindful of API costs.

${state.memoryContext ? `Context from previous conversations: ${JSON.stringify(state.memoryContext)}` : ''}
${
  state.scrapingResults && state.scrapingResults.length > 0
    ? `Web search results: ${state.scrapingResults
        .map(
          (r: any) =>
            r.content?.content || r.content?.extractedText || r.snippet || '',
        )
        .filter(Boolean)
        .join(' ')}`
    : ''
}`;

    const prompt = `${systemPrompt}\n\nUser: ${userMessage}\n\nAssistant:`;

    try {
      const modelId = useLangchainIntegration
        ? 'anthropic.claude-sonnet-4-5-20250929-v1:0'
        : 'amazon.nova-pro-v1:0';

      const response = await this.retryExecutor(async () => {
        return await this.bedrockService.invokeModel(prompt, modelId, {
          temperature: 0.7,
          maxTokens: 2000,
        });
      });

      const aiResponse =
        typeof response === 'string' ? response : response?.response || '';
      const responseMessage = new AIMessage(aiResponse);
      const cost =
        typeof response === 'object' && response && 'cost' in response
          ? (response as any).cost
          : 0;

      return {
        messages: [responseMessage],
        agentPath: ['master_agent'],
        promptCost: (state.promptCost ?? 0) + cost,
        metadata: {
          modelUsed: modelId,
          langchainIntegration: useLangchainIntegration,
          responseLength: aiResponse.length,
        },
      };
    } catch (error) {
      this.logger.error('Master agent failed', {
        error: error instanceof Error ? error.message : String(error),
        modelId: useLangchainIntegration ? 'claude-sonnet' : 'nova-pro',
      });

      // Fallback response
      const fallbackMessage = new AIMessage(
        'I apologize, but I encountered an issue processing your request. Please try rephrasing your question.',
      );

      return {
        messages: [fallbackMessage],
        failureCount: state.failureCount + 1,
        agentPath: ['master_agent'],
        metadata: { masterAgentError: true },
      };
    }
  }

  /**
   * Cost Optimizer Node - Updates cost tracking metadata
   */
  private async costOptimizerNode(
    state: MultiAgentState,
  ): Promise<Partial<MultiAgentState>> {
    const estimatedCost = this.estimateCost(state);
    const optimizations = this.identifyOptimizations(state);
    const currentCost = state.promptCost ?? 0;

    return {
      promptCost: currentCost + estimatedCost,
      optimizationsApplied: optimizations,
      agentPath: ['cost_optimizer'],
      metadata: {
        estimatedCost,
        optimizationsApplied: optimizations,
      },
    };
  }

  /**
   * Quality Analyst Node - Evaluates response quality using Bedrock
   */
  private async qualityAnalystNode(
    state: MultiAgentState,
  ): Promise<Partial<MultiAgentState>> {
    const lastMessage = state.messages[state.messages.length - 1];
    if (!lastMessage || lastMessage._getType() !== 'ai') {
      return { agentPath: ['quality_analyst'] };
    }

    const responseText = this.extractMessageContent(lastMessage);
    const qualityPrompt = `Evaluate the quality of this AI response on a scale of 1-10:

Response: "${responseText}"

Consider: accuracy, helpfulness, completeness, relevance, and clarity.
Return only a JSON object: {"passed": boolean, "score": number, "issues": string[]}`;

    try {
      const evaluation = await this.retryExecutor(async () => {
        return await this.bedrockService.invokeModel(
          qualityPrompt,
          'amazon.nova-pro-v1:0',
          {
            temperature: 0.1,
            maxTokens: 500,
          },
        );
      });

      const evalText =
        typeof evaluation === 'string'
          ? evaluation
          : evaluation?.response || '';
      const evalData = this.parseQualityEvaluation(evalText);

      return {
        agentPath: ['quality_analyst'],
        metadata: {
          qualityScore: evalData.score,
          qualityPassed: evalData.passed,
          qualityIssues: evalData.issues,
        },
      };
    } catch (error) {
      this.logger.warn('Quality analysis failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        agentPath: ['quality_analyst'],
        metadata: { qualityAnalysisError: true },
      };
    }
  }

  /**
   * Memory Writer Node - Saves conversation to memory
   */
  private async memoryWriterNode(
    state: MultiAgentState,
  ): Promise<Partial<MultiAgentState>> {
    if (state.prohibitMemoryWrite) {
      return { agentPath: ['memory_writer'] };
    }

    const messages = state.messages ?? [];
    const lastUserIdx = [...messages]
      .reverse()
      .findIndex((m) => m._getType() === 'human');
    const lastAiIdx = [...messages]
      .reverse()
      .findIndex((m) => m._getType() === 'ai');
    const lastUser =
      lastUserIdx >= 0 ? messages[messages.length - 1 - lastUserIdx] : null;
    const lastAi =
      lastAiIdx >= 0 ? messages[messages.length - 1 - lastAiIdx] : null;
    const query = lastUser ? this.extractMessageContent(lastUser) : '';
    const response = lastAi ? this.extractMessageContent(lastAi) : undefined;

    try {
      await this.memoryService.processMemoryWrite({
        userId: state.userId,
        conversationId: state.conversationId,
        query,
        response,
        metadata: {
          taskType: state.taskType,
          agentPath: state.agentPath,
          optimizationsApplied: state.optimizationsApplied,
        },
      });

      return {
        agentPath: ['memory_writer'],
        metadata: { memoryWriteSuccess: true },
      };
    } catch (error) {
      this.logger.warn('Memory write failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        agentPath: ['memory_writer'],
        metadata: { memoryWriteError: true },
      };
    }
  }

  /**
   * Failure Recovery Node - Handles failures with exponential backoff
   */
  private async failureRecoveryNode(
    state: MultiAgentState,
  ): Promise<Partial<MultiAgentState>> {
    const recoveryMessage = new AIMessage(
      `I've encountered multiple issues processing your request. This appears to be a complex query that may need manual review. Please try breaking it down into smaller, more specific questions.`,
    );

    return {
      messages: [recoveryMessage],
      agentPath: ['failure_recovery'],
    };
  }

  // ===== ROUTING METHODS =====

  private routeAfterPromptAnalysis(state: MultiAgentState): string {
    // Route to trending_detector if trending keywords detected
    if (state.needsWebData) {
      return 'trending_detector';
    }
    // Otherwise check semantic cache
    return 'semantic_cache';
  }

  private routeAfterTrendingDetection(state: MultiAgentState): string {
    if (state.needsWebData) {
      return 'web_scraper';
    }
    return 'semantic_cache';
  }

  private routeAfterWebScraping(state: MultiAgentState): string {
    if (state.scrapingResults && state.scrapingResults.length > 0) {
      return 'content_summarizer';
    }
    return 'grounding_gate';
  }

  private routeAfterContentSummarization(state: MultiAgentState): string {
    // Always route to grounding gate for final evaluation
    return 'grounding_gate';
  }

  private routeAfterCache(state: MultiAgentState): string {
    if (state.cacheHit) {
      return END;
    }
    return 'grounding_gate';
  }

  private routeAfterGroundingGate(state: MultiAgentState): string {
    const decision = state.groundingDecision?.decision;
    switch (decision) {
      case 'GENERATE':
        return 'master_agent';
      case 'ASK_CLARIFY':
        return 'clarification_needed';
      case 'SEARCH_MORE':
        return 'web_scraper';
      case 'REFUSE':
        return 'refuse_safely';
      default:
        return 'master_agent'; // Default to generate
    }
  }

  private routeFromMaster(state: MultiAgentState): string {
    if (
      state.failureCount >= 3 ||
      state.agentPath.includes('master_agent_error')
    ) {
      return 'failure_recovery';
    }

    // Check if this is a MongoDB selection response that needs Langchain enhancement
    const lastMessage = state.messages[state.messages.length - 1];
    const userMessage = lastMessage?.content?.toString() || '';
    const selectionResponse = state.metadata?.selectionResponse;
    const isMongoDBSelectionResponse =
      selectionResponse?.integration === 'mongodb' &&
      userMessage.startsWith('Selected:');

    if (isMongoDBSelectionResponse) {
      return 'master_agent_with_langchain';
    }

    // Check for other complex integration scenarios
    const hasComplexIntegration =
      /\b@mongodb|@mongodb\b/i.test(userMessage) ||
      state.metadata?.complexIntegration === true;

    if (hasComplexIntegration) {
      return 'master_agent_with_langchain';
    }

    if (state.chatMode === 'fastest') {
      return END;
    }

    // For balanced/cheapest modes, run cost optimization
    return 'cost_optimizer';
  }

  // ===== HELPER METHODS =====

  private shouldUseLangchainIntegration(message: string): boolean {
    // Check for complex patterns that benefit from stronger Claude model
    return (
      /\b(analyze|compare|research|strategy|comprehensive|detailed)\b.*\b(and|versus|vs|with)\b/i.test(
        message,
      ) ||
      message.length > 500 ||
      /\b@mongodb|@mongodb\b/i.test(message)
    );
  }

  private estimateCost(state: MultiAgentState): number {
    const lastMsg = state.messages[state.messages.length - 1];
    const contentLen = lastMsg ? this.extractMessageContent(lastMsg).length : 0;
    const baseCost = contentLen * 0.00001;
    const agentMultiplier = (state.agentPath?.length ?? 0) * 0.001;
    return Math.min(
      baseCost + agentMultiplier,
      (state.costBudget ?? 0.1) * 0.1,
    );
  }

  private identifyOptimizations(state: MultiAgentState): string[] {
    const optimizations: string[] = [];

    if (state.cacheHit) {
      optimizations.push('semantic_cache_hit');
    }

    if (state.memoryContext) {
      optimizations.push('memory_context_used');
    }

    if (state.scrapingResults && state.scrapingResults.length > 0) {
      optimizations.push('web_search_optimization');
    }

    if (state.chatMode === 'cheapest') {
      optimizations.push('cost_optimized_mode');
    }

    return optimizations;
  }

  private parseQualityEvaluation(evalText: string): {
    passed: boolean;
    score: number;
    issues: string[];
  } {
    try {
      const parsed = JSON.parse(evalText);
      return {
        passed: parsed.passed ?? parsed.score >= 7,
        score: parsed.score ?? 5,
        issues: parsed.issues ?? [],
      };
    } catch {
      // Default evaluation if parsing fails
      return { passed: true, score: 7, issues: [] };
    }
  }

  /**
   * Execute multi-agent workflow using LangGraph
   */
  async executeMultiAgentFlow(
    query: MultiAgentQuery,
  ): Promise<MultiAgentResponse> {
    const startTime = Date.now();

    try {
      this.logger.info('🚀 Starting LangGraph multi-agent workflow', {
        userId: query.userId,
        queryLength: query.query.length,
      });

      // Initialize LangGraph state
      const initialState: Partial<MultiAgentState> = {
        messages: [new HumanMessage(query.query)],
        userId: query.userId,
        conversationId: query.context?.conversationId,
        costBudget: query.context?.costBudget ?? 0.1,
        chatMode: query.context?.chatMode || 'balanced',
        agentPath: [],
        optimizationsApplied: [],
        metadata: {},
        ...query.context,
      };

      // Execute the compiled LangGraph workflow
      const finalState = await this.workflow.invoke(initialState);

      // Extract response from final state (support cache hit and normal flow)
      const lastMessage = finalState.messages?.[finalState.messages.length - 1];
      let response: string;

      if (
        finalState.cacheHit &&
        finalState.semanticCacheResult?.cachedResponse != null
      ) {
        const cached = finalState.semanticCacheResult.cachedResponse;
        response =
          typeof cached === 'string'
            ? cached
            : (cached?.response ?? cached?.content ?? String(cached));
      } else if (lastMessage && lastMessage._getType() === 'ai') {
        const content = lastMessage.content;
        response =
          typeof content === 'string'
            ? content
            : this.extractMessageContent(lastMessage);
      } else {
        response = 'Workflow completed but no response generated';
      }

      const executionTime = Date.now() - startTime;

      const result: MultiAgentResponse = {
        success: true,
        response,
        agentPath: finalState.agentPath,
        optimizationsApplied: finalState.optimizationsApplied,
        costSavings: this.calculateCostSavings(finalState),
        executionTime,
        metadata: finalState.metadata,
      };

      this.logger.info('🚀 LangGraph workflow completed', {
        userId: query.userId,
        agentPath: result.agentPath.join(' → '),
        optimizationsCount: result.optimizationsApplied.length,
        executionTime,
        costSavings: result.costSavings,
      });

      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;

      this.logger.error('LangGraph workflow failed', {
        error: error instanceof Error ? error.message : String(error),
        userId: query.userId,
        executionTime,
      });

      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'LangGraph execution failed',
        agentPath: [],
        optimizationsApplied: [],
        executionTime,
        metadata: { error: true },
      };
    }
  }

  /**
   * Calculate cost savings from optimizations applied during the workflow
   */
  private calculateCostSavings(state: MultiAgentState): number {
    const lastMsg = state.messages?.[state.messages.length - 1];
    const contentLen = lastMsg ? this.extractMessageContent(lastMsg).length : 0;
    const baselineEstimate = contentLen * 0.00001;
    const actualCost = state.promptCost || 0;
    const optimizationBonus = (state.optimizationsApplied?.length ?? 0) * 0.001;
    const savings = Math.max(
      0,
      baselineEstimate - actualCost + optimizationBonus,
    );
    return Math.round(savings * 10000) / 10000;
  }

  /**
   * Get predictive cost analytics and risk assessment for a user
   */
  async getPredictiveCostAnalytics(userId: string): Promise<{
    predictedCost: number;
    dailyAverage: number;
    trend: string;
    riskLevel: string;
    cacheHitRate: number;
    recommendations: string[];
    analytics: any;
  }> {
    try {
      // Get usage data from the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Query actual usage data from the database
      const usageHistory = await this.usageModel
        .find({
          userId: new Types.ObjectId(userId),
          createdAt: { $gte: thirtyDaysAgo },
        })
        .sort({ createdAt: -1 })
        .limit(1000)
        .lean();

      // Transform usage data to the expected format
      const combinedHistory = usageHistory.map((usage) => ({
        timestamp: new Date(usage.createdAt).getTime(),
        cost: usage.cost || 0,
        chatMode: usage.metadata?.chatMode || 'balanced',
        cacheHit: usage.metadata?.cacheHit || false,
        agentPath: usage.metadata?.agentPath || [],
      }));

      // If no usage data, provide some default data for analysis
      if (combinedHistory.length === 0) {
        combinedHistory.push(
          {
            timestamp: Date.now() - 86400000,
            cost: 0.02,
            chatMode: 'balanced',
            cacheHit: false,
            agentPath: [],
          },
          {
            timestamp: Date.now() - 172800000,
            cost: 0.015,
            chatMode: 'balanced',
            cacheHit: true,
            agentPath: [],
          },
        );
      }

      const totalCost = combinedHistory.reduce(
        (sum, entry) => sum + entry.cost,
        0,
      );
      const avgCost =
        combinedHistory.length > 0 ? totalCost / combinedHistory.length : 0.01;

      // Calculate trends
      const recent30 = combinedHistory.slice(-30);
      const previous30 = combinedHistory.slice(-60, -30);
      const recentAvg =
        recent30.reduce((sum, entry) => sum + entry.cost, 0) /
        Math.max(recent30.length, 1);
      const previousAvg =
        previous30.reduce((sum, entry) => sum + entry.cost, 0) /
        Math.max(previous30.length, 1);

      let trend = 'stable';
      if (recentAvg > previousAvg * 1.1) trend = 'increasing';
      else if (recentAvg < previousAvg * 0.9) trend = 'decreasing';

      // Cache hit rate analysis
      const cacheHitRate =
        combinedHistory.filter((entry) => entry.cacheHit).length /
        Math.max(combinedHistory.length, 1);

      // Generate recommendations
      const recommendations = this.generateCostRecommendations(
        combinedHistory,
        cacheHitRate,
        trend,
      );

      // Predict next week's cost
      const dailyInteractions = await this.estimateDailyInteractions(userId);
      const dailyAvg = avgCost * dailyInteractions;
      const weeklyPrediction = dailyAvg * 7;

      // Risk assessment
      const riskLevel = this.assessCostRisk(trend, avgCost, cacheHitRate);

      return {
        predictedCost: weeklyPrediction,
        dailyAverage: dailyAvg,
        trend,
        riskLevel,
        cacheHitRate: Math.round(cacheHitRate * 100),
        recommendations,
        analytics: {
          totalInteractions: combinedHistory.length,
          averageCostPerInteraction: avgCost,
          mostExpensiveMode: this.getMostExpensiveMode(combinedHistory),
          costSavings: this.calculateCostSavingsFromHistory(combinedHistory),
          forecast: this.generateCostForecast(combinedHistory),
        },
      };
    } catch (error) {
      this.logger.error('❌ Predictive cost analytics failed:', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        predictedCost: 0.01,
        dailyAverage: 0.001,
        trend: 'unknown',
        riskLevel: 'low',
        cacheHitRate: 0,
        recommendations: ['Enable analytics tracking for better predictions'],
        analytics: {},
      };
    }
  }

  private generateCostRecommendations(
    history: any[],
    cacheHitRate: number,
    trend: string,
  ): string[] {
    const recommendations = [];

    if (cacheHitRate < 0.2) {
      recommendations.push(
        'Consider enabling semantic caching to reduce costs',
      );
    }

    if (trend === 'increasing') {
      recommendations.push(
        'Review recent queries for optimization opportunities',
      );
      recommendations.push(
        'Consider using "cheapest" mode for non-critical queries',
      );
    }

    const fastestModeUsage =
      history.filter((h) => h.chatMode === 'fastest').length /
      Math.max(history.length, 1);
    if (fastestModeUsage > 0.5) {
      recommendations.push(
        'You use "fastest" mode frequently - consider "balanced" for cost optimization',
      );
    }

    return recommendations;
  }

  private assessCostRisk(
    trend: string,
    avgCost: number,
    cacheHitRate: number,
  ): string {
    if (trend === 'increasing' && avgCost > 0.1 && cacheHitRate < 0.1)
      return 'high';
    if (trend === 'increasing' || avgCost > 0.05) return 'medium';
    return 'low';
  }

  private async estimateDailyInteractions(userId: string): Promise<number> {
    try {
      // Get usage data from the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Count actual interactions in the last 30 days
      const recentInteractions = await this.usageModel.countDocuments({
        userId: new Types.ObjectId(userId),
        createdAt: { $gte: thirtyDaysAgo },
      });

      // Calculate daily average
      const days = 30;
      const dailyAverage = recentInteractions / days;

      // Ensure minimum of 1 interaction per day and maximum of 50
      const estimated = Math.max(1, Math.min(50, Math.round(dailyAverage)));

      this.logger.debug('Estimated daily interactions', {
        userId,
        recentInteractions,
        days,
        dailyAverage: dailyAverage.toFixed(2),
        estimated,
      });

      return estimated;
    } catch (error) {
      this.logger.warn('Failed to estimate daily interactions, using default', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return 5; // Fallback to default
    }
  }

  private getMostExpensiveMode(history: any[]): string {
    const modeCosts = history.reduce((acc, entry) => {
      acc[entry.chatMode] = (acc[entry.chatMode] || 0) + entry.cost;
      return acc;
    }, {});

    return (
      Object.entries(modeCosts).sort(
        ([, a], [, b]) => (b as number) - (a as number),
      )[0]?.[0] || 'unknown'
    );
  }

  private calculateCostSavingsFromHistory(history: any[]): number {
    const cacheHits = history.filter((h) => h.cacheHit);
    const avgNonCacheCost =
      history.filter((h) => !h.cacheHit).reduce((sum, h) => sum + h.cost, 0) /
      Math.max(history.filter((h) => !h.cacheHit).length, 1);
    return cacheHits.length * avgNonCacheCost * 0.8; // Assume 80% cost savings from cache
  }

  private generateCostForecast(history: any[]): any[] {
    const last7Days = history.slice(-7).map((_, index) => ({
      day: index + 1,
      cost: history
        .slice(-(7 - index), history.length - (6 - index))
        .reduce((sum, h) => sum + h.cost, 0),
      interactions: history.slice(-(7 - index), history.length - (6 - index))
        .length,
    }));

    return last7Days;
  }

  /**
   * Master Agent with Langchain - Enhanced master agent for complex integrations
   */
  private async masterAgentWithLangchain(
    state: MultiAgentState,
  ): Promise<Partial<MultiAgentState>> {
    try {
      const lastMessage = state.messages[state.messages.length - 1];
      const userMessage = lastMessage?.content?.toString() || '';

      this.logger.debug('Master agent with Langchain processing', {
        userMessage: userMessage.substring(0, 100),
        hasMetadata: !!state.metadata,
        hasSelectionResponse: !!state.metadata?.selectionResponse,
      });

      // Check if this is a selection response for MongoDB
      const selectionResponse = state.metadata?.selectionResponse;
      const isMongoDBSelectionResponse =
        selectionResponse?.integration === 'mongodb' &&
        userMessage.startsWith('Selected:');

      if (isMongoDBSelectionResponse) {
        this.logger.debug('Processing MongoDB selection response', {
          parameterName: selectionResponse.parameterName,
          value: selectionResponse.value,
          collectedParams: selectionResponse.collectedParams,
        });

        // Reconstruct the MongoDB command with collected parameters
        const collectedParams = {
          ...selectionResponse.collectedParams,
          [selectionResponse.parameterName]: selectionResponse.value,
        };

        const connectionId =
          state.metadata?.mongodbConnectionId ??
          state.metadata?.connectionId ??
          selectionResponse.connectionId;

        if (!connectionId || !state.userId) {
          const msg = new AIMessage(
            '✅ Selection recorded. To run this MongoDB operation, please use the integration chat with a MongoDB connection selected (e.g. @mongodb).',
          );
          return {
            messages: [msg],
            currentAgent: 'master_langchain',
            agentPath: [
              ...(state.agentPath || []),
              'master_langchain_enhanced',
            ],
            optimizationsApplied: [
              ...(state.optimizationsApplied || []),
              'mongodb_integration_tool',
            ],
            metadata: {
              ...state.metadata,
              langchainEnhanced: true,
              toolUsed: 'mongodb_integration',
            },
            mongodbIntegrationData: collectedParams,
          };
        }

        const naturalLanguageQuery =
          this.buildMongoDBMessageFromParams(collectedParams);
        const mongoContext = {
          conversationId: state.conversationId,
          connectionId,
          userId: state.userId,
          activeDatabase: state.metadata?.activeDatabase,
          activeCollection:
            collectedParams.collection ?? state.metadata?.activeCollection,
        };

        try {
          const mongoResult = await this.mongodbChatAgentService.processMessage(
            state.userId,
            String(connectionId),
            naturalLanguageQuery,
            mongoContext,
          );

          const successMessage = new AIMessage(
            mongoResult.message ?? 'MongoDB operation completed.',
          );
          return {
            messages: [successMessage],
            currentAgent: 'master_langchain',
            agentPath: [
              ...(state.agentPath || []),
              'master_langchain_enhanced',
            ],
            optimizationsApplied: [
              ...(state.optimizationsApplied || []),
              'mongodb_integration_tool',
            ],
            metadata: {
              ...state.metadata,
              langchainEnhanced: true,
              toolUsed: 'mongodb_integration',
              toolSuccess: true,
            },
            mongodbIntegrationData: collectedParams,
            formattedResult: mongoResult.formattedResult,
          };
        } catch (mongoErr: any) {
          this.logger.warn('MongoDB tool execution failed in master agent', {
            error: mongoErr?.message,
            userId: state.userId,
            connectionId,
          });
          const errMsg = new AIMessage(
            `MongoDB operation could not be completed: ${mongoErr?.message ?? 'Unknown error'}. You can retry via @mongodb with a connection selected.`,
          );
          return {
            messages: [errMsg],
            currentAgent: 'master_langchain',
            agentPath: [
              ...(state.agentPath || []),
              'master_langchain_mongo_error',
            ],
            metadata: {
              ...state.metadata,
              langchainEnhanced: true,
              toolUsed: 'mongodb_integration',
              toolSuccess: false,
            },
            mongodbIntegrationData: collectedParams,
          };
        }
      }

      // Check if this is a MongoDB operation request
      const isMongoDBRequest =
        /\b@mongodb|@mongodb\b/i.test(userMessage) ||
        state.metadata?.primaryIntegration === 'mongodb';

      if (isMongoDBRequest) {
        const connectionId =
          state.metadata?.mongodbConnectionId ?? state.metadata?.connectionId;

        if (!connectionId || !state.userId) {
          const mongoMessage = new AIMessage(
            "MongoDB integration detected. To run MongoDB operations, please use the integration chat and select a MongoDB connection (e.g. @mongodb), or set the conversation's MongoDB context.",
          );
          return {
            messages: [mongoMessage],
            currentAgent: 'master_langchain',
            agentPath: [...(state.agentPath || []), 'master_langchain_mongo'],
            optimizationsApplied: [
              ...(state.optimizationsApplied || []),
              'mongodb_detection',
            ],
            metadata: {
              ...state.metadata,
              langchainEnhanced: true,
              integrationDetected: 'mongodb',
            },
          };
        }

        const mongoContext = {
          conversationId: state.conversationId,
          connectionId: String(connectionId),
          userId: state.userId,
          activeDatabase: state.metadata?.activeDatabase,
          activeCollection: state.metadata?.activeCollection,
        };

        try {
          const mongoResult = await this.mongodbChatAgentService.processMessage(
            state.userId,
            String(connectionId),
            userMessage,
            mongoContext,
          );
          const mongoMessage = new AIMessage(
            mongoResult.message ?? 'MongoDB operation completed.',
          );
          return {
            messages: [mongoMessage],
            currentAgent: 'master_langchain',
            agentPath: [...(state.agentPath || []), 'master_langchain_mongo'],
            optimizationsApplied: [
              ...(state.optimizationsApplied || []),
              'mongodb_execution',
            ],
            metadata: {
              ...state.metadata,
              langchainEnhanced: true,
              integrationDetected: 'mongodb',
            },
            formattedResult: mongoResult.formattedResult,
            mongodbIntegrationData: mongoContext,
          };
        } catch (mongoErr: any) {
          this.logger.warn('MongoDB processMessage failed in master agent', {
            error: mongoErr?.message,
            userId: state.userId,
          });
          const mongoMessage = new AIMessage(
            `MongoDB request could not be completed: ${mongoErr?.message ?? 'Unknown error'}. Ensure your MongoDB connection is set up and try again.`,
          );
          return {
            messages: [mongoMessage],
            currentAgent: 'master_langchain',
            agentPath: [
              ...(state.agentPath || []),
              'master_langchain_mongo_error',
            ],
            metadata: {
              ...state.metadata,
              langchainEnhanced: true,
              integrationDetected: 'mongodb',
            },
          };
        }
      }

      // Default: try Langchain orchestrator if initialized, else return helpful message
      if (this.langchainOrchestrator.isInitialized()) {
        const graph = this.langchainOrchestrator.getGraph();
        if (graph && state.userId && state.conversationId) {
          try {
            const inputState = {
              messages: state.messages ?? [],
              userId: state.userId,
              conversationId: state.conversationId,
              context: state.metadata ?? {},
            };
            const result = await graph.invoke(inputState);
            const finalMessages = result?.messages ?? result?.finalResponse;
            const responseText =
              typeof finalMessages === 'string'
                ? finalMessages
                : Array.isArray(finalMessages) && finalMessages.length > 0
                  ? (finalMessages[finalMessages.length - 1]?.content ??
                    String(finalMessages[finalMessages.length - 1]))
                  : ((result as any)?.finalResponse ?? '');
            const enhancedMessage = new AIMessage(
              responseText || 'Request processed with enhanced coordination.',
            );
            return {
              messages: [enhancedMessage],
              currentAgent: 'master_langchain',
              agentPath: [
                ...(state.agentPath || []),
                'master_langchain_enhanced',
              ],
              optimizationsApplied: [
                ...(state.optimizationsApplied || []),
                'langchain_orchestrator',
              ],
              metadata: { ...state.metadata, langchainEnhanced: true },
            };
          } catch (invokeErr: any) {
            this.logger.debug('Langchain graph invoke failed, using fallback', {
              error: invokeErr?.message,
              userId: state.userId,
            });
          }
        }
      }

      const enhancedMessage = new AIMessage(
        'Your request is being processed. For integrations (e.g. @mongodb, @github, @vercel), use the integration chat or ensure the conversation has the right context.',
      );
      return {
        messages: [enhancedMessage],
        currentAgent: 'master_langchain',
        agentPath: [...(state.agentPath || []), 'master_langchain_enhanced'],
        optimizationsApplied: [
          ...(state.optimizationsApplied || []),
          'langchain_enhancement',
        ],
        metadata: { ...state.metadata, langchainEnhanced: true },
      };
    } catch (error: any) {
      this.logger.error('Master agent with Langchain failed', {
        error: error.message,
        userId: state.userId,
        conversationId: state.conversationId,
      });

      const errorMessage = new AIMessage(
        'I encountered an issue with the enhanced processing. Please try your request again or use a simpler approach.',
      );

      return {
        messages: [errorMessage],
        failureCount: state.failureCount + 1,
        agentPath: [...(state.agentPath || []), 'master_langchain_error'],
        metadata: {
          ...state.metadata,
          langchainError: error.message,
        },
      };
    }
  }

  /**
   * Build a natural-language message for MongoDBChatAgentService from collected params
   */
  private buildMongoDBMessageFromParams(
    collectedParams: Record<string, any>,
  ): string {
    const action = collectedParams.action ?? collectedParams.command ?? 'find';
    const collection =
      collectedParams.collection ?? collectedParams.collectionName ?? '';
    const filter =
      collectedParams.filter ??
      collectedParams.query ??
      collectedParams.parameters ??
      {};
    if (
      action === 'find' ||
      action === 'listCollections' ||
      action === 'getDatabaseStats'
    ) {
      if (collection) {
        if (Object.keys(filter).length > 0) {
          return `Find documents in collection ${collection} with filter ${JSON.stringify(filter)}`;
        }
        return `Find documents in collection ${collection}`;
      }
      if (action === 'listCollections') return 'List all collections';
      if (action === 'getDatabaseStats') return 'Get database stats';
    }
    return collection
      ? `Run ${action} on collection ${collection}`
      : `Run ${action}`;
  }

  public recordCostEvent(
    cost: number,
    chatMode: string,
    cacheHit: boolean,
    agentPath: string[],
  ): void {
    this.costHistory.push({
      timestamp: Date.now(),
      cost,
      chatMode,
      cacheHit,
      agentPath,
    });

    // Keep only last 1000 entries to prevent memory issues
    if (this.costHistory.length > 1000) {
      this.costHistory = this.costHistory.slice(-1000);
    }
  }
}
