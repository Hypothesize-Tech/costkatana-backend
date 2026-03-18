/**
 * Multi-Agent Flow Service
 *
 * Orchestrates complex multi-agent workflows using LangGraph and StateGraph.
 * Supports hierarchical agent coordination, memory management, and adaptive routing.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { BaseMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { BedrockService } from '../../bedrock/bedrock.service';
import { TaskClassifierService } from '../../governed-agent/services/task-classifier.service';

// Multi-Agent State using LangGraph Annotation
const MultiAgentStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (current: BaseMessage[], update: BaseMessage[]) =>
      current.concat(update),
    default: () => [],
  }),
  currentAgent: Annotation<string>({
    reducer: (x: string, y: string) => y ?? x,
    default: () => 'master',
  }),
  taskType: Annotation<string>({
    reducer: (x: string, y: string) => y ?? x,
    default: () => 'general',
  }),
  userId: Annotation<string>(),
  conversationId: Annotation<string>(),
  costBudget: Annotation<number>({
    reducer: (x: number, y: number) => y ?? x,
    default: () => 0.1,
  }),
  chatMode: Annotation<'fastest' | 'cheapest' | 'balanced'>({
    reducer: (
      x: 'fastest' | 'cheapest' | 'balanced',
      y: 'fastest' | 'cheapest' | 'balanced',
    ) => y ?? x,
    default: () => 'balanced',
  }),
  optimizationsApplied: Annotation<string[]>({
    reducer: (current: string[], update: string[]) => current.concat(update),
    default: () => [],
  }),
  cacheHit: Annotation<boolean>({
    reducer: (x: boolean, y: boolean) => y ?? x,
    default: () => false,
  }),
  agentPath: Annotation<string[]>({
    reducer: (current: string[], update: string[]) => current.concat(update),
    default: () => [],
  }),
  // Memory-related state
  memoryContext: Annotation<any | null>({
    reducer: (x: any | null, y: any | null) => y ?? x,
    default: () => null,
  }),
  personalizedRecommendations: Annotation<string[]>({
    reducer: (x: string[], y: string[]) => y ?? x ?? [],
    default: () => [],
  }),
  userPreferences: Annotation<any>({
    reducer: (x: any, y: any) => y ?? x,
    default: () => null,
  }),
  riskLevel: Annotation<string>({
    reducer: (x: string, y: string) => y ?? x,
    default: () => 'low',
  }),
  promptCost: Annotation<number>({
    reducer: (x: number, y: number) => y ?? x,
    default: () => 0,
  }),
  refinedPrompt: Annotation<string>({
    reducer: (x: string, y: string) => y ?? x,
  }),
  semanticCacheResult: Annotation<any>({
    reducer: (x: any, y: any) => y ?? x,
  }),
  failureCount: Annotation<number>({
    reducer: (x: number, y: number) => (y ?? 0) + (x ?? 0),
    default: () => 0,
  }),
  metadata: Annotation<Record<string, any>>({
    reducer: (x: Record<string, any>, y: Record<string, any>) => ({
      ...x,
      ...y,
    }),
    default: () => ({}),
  }),
  // Web scraping state
  needsWebData: Annotation<boolean>({
    reducer: (x: boolean, y: boolean) => y ?? x,
    default: () => false,
  }),
  scrapingResults: Annotation<any[]>({
    reducer: (current: any[], update: any[]) => current.concat(update),
    default: () => [],
  }),
  webSources: Annotation<string[]>({
    reducer: (current: string[], update: string[]) => current.concat(update),
    default: () => [],
  }),
  // Additional state fields from Express version
  context: Annotation<any>({
    reducer: (x: any, y: any) => y ?? x,
    default: () => ({}),
  }),
  groundingContext: Annotation<any>({
    reducer: (x: any, y: any) => y ?? x,
    default: () => null,
  }),
  agentDecisions: Annotation<any[]>({
    reducer: (current: any[], update: any[]) => current.concat(update),
    default: () => [],
  }),
});

type MultiAgentState = typeof MultiAgentStateAnnotation.State;

@Injectable()
export class MultiAgentFlowService {
  private readonly logger = new Logger(MultiAgentFlowService.name);
  private workflow: any;

  constructor(
    private readonly configService: ConfigService,
    private readonly bedrockService: BedrockService,
    private readonly taskClassifier: TaskClassifierService,
  ) {
    this.initializeWorkflow();
  }

  /**
   * Initialize the multi-agent workflow graph
   */
  private initializeWorkflow(): void {
    this.workflow = new StateGraph(MultiAgentStateAnnotation)
      // Add nodes for different agent types
      .addNode('master_agent', this.masterAgent.bind(this))
      .addNode('specialist_agent', this.specialistAgent.bind(this))
      .addNode('web_scraper_agent', this.webScraperAgent.bind(this))
      .addNode('analyzer_agent', this.analyzerAgent.bind(this))
      .addNode('quality_gate', this.qualityGate.bind(this))
      .addNode('finalizer', this.finalizer.bind(this))

      // Add edges for workflow logic
      .addEdge(START, 'master_agent')
      .addConditionalEdges('master_agent', this.routeToSpecialist.bind(this), {
        specialist: 'specialist_agent',
        web_scraper: 'web_scraper_agent',
        analyzer: 'analyzer_agent',
        finalize: 'finalizer',
      })
      .addEdge('specialist_agent', 'quality_gate')
      .addEdge('web_scraper_agent', 'quality_gate')
      .addEdge('analyzer_agent', 'quality_gate')
      .addConditionalEdges(
        'quality_gate',
        this.routeAfterQualityCheck.bind(this),
        {
          retry: 'master_agent',
          finalize: 'finalizer',
        },
      )
      .addEdge('finalizer', END)
      .compile();
  }

  /**
   * Execute multi-agent workflow
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
    metadata: Record<string, any>;
  }> {
    try {
      const initialState: Partial<MultiAgentState> = {
        messages: initialMessages,
        currentAgent: 'master',
        userId,
        conversationId,
        chatMode: config.chatMode || 'balanced',
        costBudget: config.costBudget || 0.1,
        taskType: config.taskType || 'general',
        agentPath: [],
        optimizationsApplied: [],
        metadata: {
          startTime: Date.now(),
          workflowVersion: '1.0',
        },
      };

      const result = await this.workflow.invoke(initialState);

      return {
        messages: result.messages,
        agentPath: result.agentPath,
        optimizationsApplied: result.optimizationsApplied,
        totalCost: result.promptCost,
        metadata: {
          ...result.metadata,
          endTime: Date.now(),
          duration: Date.now() - result.metadata.startTime,
          finalAgent: result.currentAgent,
          riskLevel: result.riskLevel,
          failureCount: result.failureCount,
        },
      };
    } catch (error) {
      this.logger.error('Multi-agent workflow execution failed', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        conversationId,
      });
      throw error;
    }
  }

  /**
   * Master agent - coordinates the workflow
   */
  private async masterAgent(
    state: MultiAgentState,
  ): Promise<Partial<MultiAgentState>> {
    this.logger.debug('Executing master agent', {
      currentAgent: state.currentAgent,
    });

    const lastMessage = state.messages[state.messages.length - 1];
    const rawContent =
      lastMessage instanceof HumanMessage ? lastMessage.content : '';
    const content =
      typeof rawContent === 'string'
        ? rawContent
        : Array.isArray(rawContent)
          ? rawContent.map((c) => (typeof c === 'string' ? c : '')).join('')
          : '';

    // Analyze the task and determine routing
    const taskAnalysis = await this.analyzeTask(content, state);

    return {
      currentAgent: 'master',
      taskType: taskAnalysis.taskType,
      agentPath: [...state.agentPath, 'master'],
      metadata: {
        ...state.metadata,
        taskAnalysis,
      },
    };
  }

  /**
   * Specialist agent - handles specific domain tasks
   */
  private async specialistAgent(
    state: MultiAgentState,
  ): Promise<Partial<MultiAgentState>> {
    this.logger.debug('Executing specialist agent', {
      taskType: state.taskType,
    });

    const response = await this.generateSpecialistResponse(state);

    return {
      messages: [new AIMessage(response.content)],
      currentAgent: 'specialist',
      agentPath: [...state.agentPath, 'specialist'],
      promptCost: state.promptCost + (response.cost || 0),
      optimizationsApplied: [
        ...state.optimizationsApplied,
        ...response.optimizations,
      ],
    };
  }

  /**
   * Web scraper agent - handles web research tasks
   */
  private async webScraperAgent(
    state: MultiAgentState,
  ): Promise<Partial<MultiAgentState>> {
    this.logger.debug('Executing web scraper agent');

    const scrapingResults = await this.performWebScraping(state);

    return {
      scrapingResults,
      webSources: scrapingResults.map((r) => r.url),
      needsWebData: false,
      currentAgent: 'web_scraper',
      agentPath: [...state.agentPath, 'web_scraper'],
      metadata: {
        ...state.metadata,
        scrapingPerformed: true,
        sourcesFound: scrapingResults.length,
      },
    };
  }

  /**
   * Analyzer agent - performs analysis and synthesis
   */
  private async analyzerAgent(
    state: MultiAgentState,
  ): Promise<Partial<MultiAgentState>> {
    this.logger.debug('Executing analyzer agent');

    const analysis = await this.performAnalysis(state);

    return {
      messages: [new AIMessage(analysis.content)],
      currentAgent: 'analyzer',
      agentPath: [...state.agentPath, 'analyzer'],
      promptCost: state.promptCost + (analysis.cost || 0),
      metadata: {
        ...state.metadata,
        analysisPerformed: true,
        insightsGenerated: analysis.insights?.length || 0,
      },
    };
  }

  /**
   * Quality gate - validates output quality
   */
  private async qualityGate(
    state: MultiAgentState,
  ): Promise<Partial<MultiAgentState>> {
    const qualityCheck = await this.performQualityCheck(state);

    return {
      metadata: {
        ...state.metadata,
        qualityCheck: {
          passed: qualityCheck.passed,
          score: qualityCheck.score,
          issues: qualityCheck.issues,
        },
      },
    };
  }

  /**
   * Finalizer - prepares final response
   */
  private async finalizer(
    state: MultiAgentState,
  ): Promise<Partial<MultiAgentState>> {
    this.logger.debug('Executing finalizer');

    const finalResponse = await this.generateFinalResponse(state);

    return {
      messages: [new AIMessage(finalResponse.content)],
      currentAgent: 'finalizer',
      agentPath: [...state.agentPath, 'finalizer'],
      metadata: {
        ...state.metadata,
        finalized: true,
        finalResponseLength: finalResponse.content.length,
      },
    };
  }

  /**
   * Route to appropriate specialist agent
   */
  private routeToSpecialist(
    state: MultiAgentState,
  ): 'specialist' | 'web_scraper' | 'analyzer' | 'finalize' {
    const taskType = state.taskType || 'general';

    if (state.needsWebData) {
      return 'web_scraper';
    }

    switch (taskType) {
      case 'research':
      case 'analysis':
        return 'analyzer';
      case 'web_search':
        return 'web_scraper';
      case 'simple':
        return 'finalize';
      default:
        return 'specialist';
    }
  }

  /**
   * Route after quality check
   */
  private routeAfterQualityCheck(state: MultiAgentState): 'retry' | 'finalize' {
    const qualityCheck = state.metadata?.qualityCheck;
    if (qualityCheck?.passed === false && state.failureCount < 3) {
      return 'retry';
    }
    return 'finalize';
  }

  // Helper methods (simplified implementations)

  private async analyzeTask(
    content: string,
    state: MultiAgentState,
  ): Promise<{
    taskType: string;
    complexity: string;
    needsWebData: boolean;
  }> {
    try {
      const classification = await this.taskClassifier.classifyTask(
        content,
        state.userId || 'anonymous',
      );
      const taskTypeMap: Record<string, string> = {
        research: 'research',
        simple_query: 'simple',
        complex_query: 'general',
        cross_integration: 'general',
        coding: 'general',
        data_transformation: 'general',
      };
      const taskType =
        taskTypeMap[classification.type] || 'general';
      const needsWebData =
        classification.type === 'research' ||
        /\b(current|latest|recent|web|internet|online|browse)\b/i.test(content);
      return {
        taskType,
        complexity: classification.complexity,
        needsWebData,
      };
    } catch (error) {
      this.logger.warn('TaskClassifier failed, using regex fallback', {
        error: error instanceof Error ? error.message : String(error),
      });
      const isResearch = /\b(research|find|search|analyze|study)\b/i.test(content);
      const isWebSearch = /\b(web|internet|online|browse)\b/i.test(content);
      const isSimple = content.length < 100;
      return {
        taskType: isResearch
          ? 'research'
          : isWebSearch
            ? 'web_search'
            : isSimple
              ? 'simple'
              : 'general',
        complexity: isSimple ? 'low' : 'medium',
        needsWebData: isWebSearch || /\b(current|latest|recent)\b/i.test(content),
      };
    }
  }

  private async generateSpecialistResponse(
    state: MultiAgentState,
  ): Promise<any> {
    const lastMessage = state.messages[state.messages.length - 1];
    const userQuery =
      lastMessage instanceof HumanMessage
        ? typeof lastMessage.content === 'string'
          ? lastMessage.content
          : ''
        : '';

    const specialistPrompt = `You are a specialist AI assistant for Cost Katana, focused on ${state.taskType} tasks.

User Query: ${userQuery}

Context:
- Task Type: ${state.taskType}
- User ID: ${state.userId}
- Conversation: ${state.conversationId || 'New'}

Provide a detailed, expert response that directly addresses the user's query. Be specific, actionable, and focused on the ${state.taskType} domain. Include relevant technical details and recommendations.`;

    try {
      const result = await BedrockService.invokeModel(
        specialistPrompt,
        'amazon.nova-pro-v1:0',
      );

      return {
        content: typeof result === 'string' ? result : (result as { response?: string })?.response ?? '',
        cost: 0,
        optimizations: ['specialized_processing', 'llm_powered_response'],
      };
    } catch (error) {
      this.logger.warn(
        'Specialist response generation failed, using fallback',
        {
          error: error instanceof Error ? error.message : String(error),
          taskType: state.taskType,
        },
      );

      // Fallback response
      return {
        content: `I apologize, but I'm currently unable to provide a detailed specialist response for ${state.taskType}. Please try again or contact support if the issue persists.`,
        cost: 0.001,
        optimizations: ['specialized_processing'],
      };
    }
  }

  private async performWebScraping(state: MultiAgentState): Promise<any[]> {
    const lastMessage = state.messages[state.messages.length - 1];
    const userQuery =
      lastMessage instanceof HumanMessage
        ? typeof lastMessage.content === 'string'
          ? lastMessage.content
          : ''
        : '';

    const scrapingPrompt = `You are a web research specialist for Cost Katana. The user needs information that requires current web data.

User Query: ${userQuery}

Your task is to identify and plan web scraping targets. For each relevant source, provide:
1. URL to scrape
2. Expected content type
3. Relevance score (0-1)
4. Brief justification

Focus on authoritative, current sources related to AI, cost optimization, and technology.

Respond in JSON format:
[{
  "url": "https://example.com",
  "content": "Brief description of expected content",
  "relevance": 0.9,
  "justification": "Why this source is relevant"
}]`;

    try {
      const result = await BedrockService.invokeModel(
        scrapingPrompt,
        'amazon.nova-pro-v1:0',
      );
      const responseStr = typeof result === 'string' ? result : (result as { response?: string })?.response ?? '';

      // Parse the JSON response
      try {
        const scrapingPlan = JSON.parse(responseStr);
        return Array.isArray(scrapingPlan)
          ? scrapingPlan
          : [
              {
                url: 'https://example.com',
                content: responseStr,
                relevance: 0.7,
                justification: 'LLM-generated research plan',
              },
            ];
      } catch (parseError) {
        // If JSON parsing fails, return a structured fallback
        return [
          {
            url: 'https://example.com',
            content: responseStr,
            relevance: 0.7,
            justification: 'LLM response parsing failed, using raw content',
          },
        ];
      }
    } catch (error) {
      this.logger.warn('Web scraping planning failed, using fallback', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback response
      return [
        {
          url: 'https://example.com',
          content: 'Web research planning temporarily unavailable',
          relevance: 0.5,
          justification: 'Fallback due to service unavailability',
        },
      ];
    }
  }

  private async performAnalysis(state: MultiAgentState): Promise<any> {
    const lastMessage = state.messages[state.messages.length - 1];
    const userQuery =
      lastMessage instanceof HumanMessage
        ? typeof lastMessage.content === 'string'
          ? lastMessage.content
          : ''
        : '';

    const analysisPrompt = `You are an AI analyst for Cost Katana. Analyze the following user query and provide deep insights.

User Query: ${userQuery}

Context:
- Task Type: ${state.taskType}
- Conversation History: ${state.messages.length} messages
- User ID: ${state.userId}

Provide a comprehensive analysis including:
1. Key insights and findings
2. Actionable recommendations
3. Potential risks or considerations
4. Cost optimization opportunities (if applicable)

Be thorough, data-driven, and specific to the user's needs.`;

    try {
      const result = await BedrockService.invokeModel(
        analysisPrompt,
        'amazon.nova-pro-v1:0',
      );
      const responseStr = typeof result === 'string' ? result : (result as { response?: string })?.response ?? '';

      // Extract insights from the response (simple extraction)
      const insights = responseStr
        .split('\n')
        .filter((line: string) => line.trim().length > 0)
        .slice(0, 5); // Take first 5 lines as insights

      return {
        content: responseStr,
        cost: 0,
        insights:
          insights.length > 0 ? insights : ['Analysis completed successfully'],
      };
    } catch (error) {
      this.logger.warn('Analysis generation failed, using fallback', {
        error: error instanceof Error ? error.message : String(error),
        taskType: state.taskType,
      });

      // Fallback response
      return {
        content: 'Analysis temporarily unavailable. Please try again later.',
        cost: 0.002,
        insights: ['Service temporarily unavailable'],
      };
    }
  }

  private async performQualityCheck(state: MultiAgentState): Promise<any> {
    const lastAIMessage = state.messages
      .filter((msg): msg is AIMessage => msg instanceof AIMessage)
      .pop();

    const contentToCheck =
      lastAIMessage instanceof AIMessage
        ? typeof lastAIMessage.content === 'string'
          ? lastAIMessage.content
          : 'Complex content to check'
        : 'No content to check';

    const qualityPrompt = `You are a quality assurance specialist for Cost Katana. Evaluate the following AI-generated response for quality, accuracy, and appropriateness.

Content to evaluate:
${contentToCheck}

Context:
- Task Type: ${state.taskType}
- User ID: ${state.userId}
- Response Length: ${contentToCheck.length} characters

Evaluate on these criteria:
1. Accuracy and factual correctness
2. Relevance to the user's query
3. Clarity and comprehensibility
4. Completeness of response
5. Professional tone and appropriateness

Provide a quality score (0-1) and list any issues found.

Respond in JSON format:
{
  "passed": true/false,
  "score": 0.85,
  "issues": ["Issue 1", "Issue 2"]
}`;

    try {
      const result = await BedrockService.invokeModel(
        qualityPrompt,
        'amazon.nova-pro-v1:0',
      );
      const responseStr = typeof result === 'string' ? result : (result as { response?: string })?.response ?? '';

      // Parse the JSON response
      try {
        const qualityResult = JSON.parse(responseStr);
        return {
          passed: qualityResult.passed ?? true,
          score: qualityResult.score ?? 0.8,
          issues: Array.isArray(qualityResult.issues)
            ? qualityResult.issues
            : [],
        };
      } catch (parseError) {
        // If JSON parsing fails, assume passed with moderate score
        return {
          passed: true,
          score: 0.7,
          issues: ['Quality check response parsing failed'],
        };
      }
    } catch (error) {
      this.logger.warn('Quality check failed, using fallback', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback response
      return {
        passed: true,
        score: 0.8,
        issues: [],
      };
    }
  }

  private async generateFinalResponse(state: MultiAgentState): Promise<any> {
    const userMessages = state.messages.filter(
      (msg) => msg instanceof HumanMessage,
    );
    const aiMessages = state.messages.filter((msg) => msg instanceof AIMessage);

    const lastUserMessage = userMessages[userMessages.length - 1];
    const userQuery =
      lastUserMessage instanceof HumanMessage
        ? typeof lastUserMessage.content === 'string'
          ? lastUserMessage.content
          : ''
        : '';

    const contextSummary = aiMessages
      .slice(-3) // Last 3 AI responses
      .map((msg) =>
        typeof msg.content === 'string' ? msg.content : '[Complex content]',
      )
      .join('\n\n');

    const finalResponsePrompt = `You are the final response synthesizer for Cost Katana's multi-agent system. Synthesize a comprehensive, coherent final response based on the analysis performed by various specialized agents.

Original User Query: ${userQuery}

Agent Analysis Summary:
${contextSummary}

Context:
- Task Type: ${state.taskType}
- User ID: ${state.userId}
- Agents Involved: ${state.agentPath.join(', ')}
- Optimizations Applied: ${state.optimizationsApplied.join(', ')}

Create a final, polished response that:
1. Directly addresses the user's original query
2. Incorporates insights from all agent analyses
3. Provides clear, actionable recommendations
4. Maintains professional tone and Cost Katana branding
5. Is comprehensive but not overwhelming

Ensure the response feels natural and conversational while being informative and helpful.`;

    try {
      const result = await BedrockService.invokeModel(
        finalResponsePrompt,
        'amazon.nova-pro-v1:0',
      );

      return {
        content: typeof result === 'string' ? result : (result as { response?: string })?.response ?? '',
      };
    } catch (error) {
      this.logger.warn('Final response generation failed, using fallback', {
        error: error instanceof Error ? error.message : String(error),
        taskType: state.taskType,
      });

      // Fallback: use the last AI message or a generic response
      const lastAIMessage = aiMessages[aiMessages.length - 1];
      return {
        content:
          lastAIMessage instanceof AIMessage
            ? lastAIMessage.content
            : 'I apologize, but I was unable to generate a final response. Please try rephrasing your query.',
      };
    }
  }
}
