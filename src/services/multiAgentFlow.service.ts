import { loggingService } from './logging.service';
import { ChatBedrockConverse } from "@langchain/aws";
import { StateGraph, Annotation } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { langSmithService } from './langsmith.service';
import { RetryWithBackoff, RetryConfigs } from '@utils/retryWithBackoff';
import { TokenEstimator } from '@utils/tokenEstimator';
import { WebSearchTool } from '../tools/webSearch.tool';
import { TrendingDetectorService } from './trendingDetector.service';
import { memoryService, MemoryContext, MemoryService } from './memory.service';
import { userPreferenceService } from './userPreference.service';
import { LRUCache } from 'lru-cache';
import { EventEmitter } from 'events';
import { groundingConfidenceService } from './groundingConfidence.service';
import { CortexContextManagerService } from './cortexContextManager.service';
import { GroundingContext, QueryType, AgentType } from '../types/grounding.types';

// Multi-Agent State using LangGraph Annotation
const MultiAgentStateAnnotation = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
        reducer: (current: BaseMessage[], update: BaseMessage[]) => current.concat(update),
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
        default: () => 0.10,
    }),
    chatMode: Annotation<'fastest' | 'cheapest' | 'balanced'>({
        reducer: (x: 'fastest' | 'cheapest' | 'balanced', y: 'fastest' | 'cheapest' | 'balanced') => y ?? x,
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
        reducer: (x: Record<string, any>, y: Record<string, any>) => ({ ...x, ...y }),
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
    // Add support for IntegrationSelector
    userInputCollection: Annotation<{
        active: boolean;
        currentField?: any;
        collectedData: Record<string, any>;
        progress: number;
    }>({
        reducer: (x: any, y: any) => y ?? x,
        default: () => ({
            active: false,
            collectedData: {},
            progress: 0
        }),
    }),
    strategyFormation: Annotation<{
        questions: string[];
        responses: Record<string, any>;
        currentQuestion: number;
        isComplete: boolean;
        adaptiveQuestions?: string[];
    }>({
        reducer: (x: any, y: any) => y ?? x,
        default: () => ({
            questions: [],
            responses: {},
            currentQuestion: 0,
            isComplete: false
        }),
    }),
    // IntegrationSelector fields
    requiresIntegrationSelector: Annotation<boolean | undefined>({
        reducer: (x: boolean | undefined, y: boolean | undefined) => y ?? x,
        default: () => undefined,
    }),
    integrationSelectorData: Annotation<any>({
        reducer: (x: any, y: any) => y ?? x,
        default: () => undefined,
    }),
    // MongoDB integration data
    mongodbIntegrationData: Annotation<any>({
        reducer: (x: any, y: any) => y ?? x,
        default: () => undefined,
    }),
    formattedResult: Annotation<any>({
        reducer: (x: any, y: any) => y ?? x,
        default: () => undefined,
    }),
    // Grounding Confidence Layer (GCL) state
    groundingDecision: Annotation<any | undefined>({
        reducer: (x: any | undefined, y: any | undefined) => y ?? x,
        default: () => undefined,
    }),
    clarificationAttempts: Annotation<number>({
        reducer: (x: number, y: number) => (y ?? 0) + (x ?? 0),
        default: () => 0,
    }),
    searchAttempts: Annotation<number>({
        reducer: (x: number, y: number) => (y ?? 0) + (x ?? 0),
        default: () => 0,
    }),
    requiresClarification: Annotation<boolean>({
        reducer: (x: boolean, y: boolean) => y ?? x,
        default: () => false,
    }),
    refused: Annotation<boolean>({
        reducer: (x: boolean, y: boolean) => y ?? x,
        default: () => false,
    }),
    queryDomain: Annotation<string | undefined>({
        reducer: (x: string | undefined, y: string | undefined) => y ?? x,
        default: () => undefined,
    }),
    contextDriftHigh: Annotation<boolean>({
        reducer: (x: boolean, y: boolean) => y ?? x,
        default: () => false,
    }),
    prohibitMemoryWrite: Annotation<boolean>({
        reducer: (x: boolean, y: boolean) => y ?? x,
        default: () => false,
    }),
});

type MultiAgentState = typeof MultiAgentStateAnnotation.State;

export class MultiAgentFlowService {
    private masterAgent!: ChatBedrockConverse;
    private costOptimizerAgent!: ChatBedrockConverse;
    private qualityAnalystAgent!: ChatBedrockConverse;
    private webScrapingAgent!: ChatBedrockConverse;
    private graph: any;
    private retryExecutor: <T>(fn: () => Promise<T>) => Promise<any>;
    private webSearchTool: WebSearchTool;
    private trendingDetector: TrendingDetectorService;
    
    // Semantic cache with LRU limits
    private semanticCache: LRUCache<string, { response: string; embedding: number[]; timestamp: number; hits: number }>;
    
    // Langchain Integration
    private langchainIntegrationEnabled = false;
    private langchainCoordinatorAgent?: ChatBedrockConverse;
    private langchainStrategyAgent?: ChatBedrockConverse;
    

    constructor() {
        // Increase EventEmitter limits to prevent memory leak warnings
        EventEmitter.defaultMaxListeners = 20;
        
        // Initialize semantic cache with proper size limits
        this.semanticCache = new LRUCache({
            max: 1000, // Maximum 1000 cached responses
            ttl: 60 * 60 * 1000, // 1 hour TTL
            updateAgeOnGet: true,
            allowStale: false
        });
        
        this.webSearchTool = new WebSearchTool();
        this.trendingDetector = new TrendingDetectorService();
        
        this.initializeAgents();
        this.initializeGraph();
        
        // Initialize web search components
        this.webSearchTool = new WebSearchTool();
        this.trendingDetector = new TrendingDetectorService();
        
        // Initialize retry mechanism for multi-agent operations
        this.retryExecutor = RetryWithBackoff.createBedrockRetry({
            ...RetryConfigs.bedrock,
            maxRetries: 3, // Slightly fewer retries for multi-agent to avoid long delays
            onRetry: (error: Error, attempt: number) => {
                loggingService.warn(`🔄 Multi-agent retry attempt ${attempt}: ${error.message}`);
            }
        });
        
        // Initialize Langchain integration
        this.initializeLangchainIntegration();
    }

    /**
     * Initialize Langchain integration for enhanced coordination
     */
    private initializeLangchainIntegration(): void {
        try {
            // Create Langchain Coordinator Agent
            this.langchainCoordinatorAgent = new ChatBedrockConverse({
                model: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
                region: process.env.AWS_REGION ?? 'us-east-1',
                temperature: 0.6,
                maxTokens: 6000,
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
                },
            });
            
            // Create Langchain Strategy Agent for strategic planning and coordination
            this.langchainStrategyAgent = new ChatBedrockConverse({
                model: 'amazon.nova-pro-v1:0',
                region: process.env.AWS_REGION ?? 'us-east-1',
                temperature: 0.7,
                maxTokens: 4000,
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
                },
            });
            
            this.langchainIntegrationEnabled = true;
            loggingService.info('✅ Langchain integration enabled for MultiAgentFlowService');
        } catch (error) {
            loggingService.warn('⚠️ Langchain integration failed to initialize', {
                error: error instanceof Error ? error.message : String(error)
            });
            this.langchainIntegrationEnabled = false;
        }
    }

    private initializeAgents() {
        this.masterAgent = new ChatBedrockConverse({
            model: "amazon.nova-pro-v1:0", // Use Nova Pro since Sonnet isn't available
            region: process.env.AWS_REGION || 'us-east-1',
            temperature: 0.7,
        });

        this.costOptimizerAgent = new ChatBedrockConverse({
            model: "amazon.nova-pro-v1:0", // Use Nova Pro since Haiku isn't available
            region: process.env.AWS_REGION || 'us-east-1',
            temperature: 0.3,
        });

        this.qualityAnalystAgent = new ChatBedrockConverse({
            model: "amazon.nova-pro-v1:0", // Use Nova Pro since Sonnet isn't available
            region: process.env.AWS_REGION || 'us-east-1',
            temperature: 0.1,
        });

        this.webScrapingAgent = new ChatBedrockConverse({
            model: "amazon.nova-pro-v1:0", // Use Nova Pro since Haiku isn't available
            region: process.env.AWS_REGION || 'us-east-1',
            temperature: 0.2, // Low temperature for consistent extraction
        });

        // Future: Initialize embeddings for semantic caching
        // this.embeddings = new BedrockEmbeddings({
        //     region: process.env.AWS_REGION || 'us-east-1',
        //     model: "amazon.titan-embed-text-v1",
        // });
    }

    private initializeGraph() {
        const workflow = new StateGraph(MultiAgentStateAnnotation)
            .addNode("prompt_analyzer", this.promptAnalyzer.bind(this))
            .addNode("trending_detector", this.trendingDetectorNode.bind(this))
            .addNode("web_scraper", this.webScrapingNode.bind(this))
            .addNode("content_summarizer", this.contentSummarizerNode.bind(this))
            .addNode("memory_reader", this.memoryReaderNode.bind(this))
            .addNode("memory_writer", this.memoryWriterNode.bind(this))
            .addNode("grounding_gate", this.groundingGateNode.bind(this))
            .addNode("clarification_needed", this.clarificationNeededNode.bind(this))
            .addNode("refuse_safely", this.refuseSafelyNode.bind(this))
            .addNode("master_agent", this.masterAgentNode.bind(this))
            .addNode("cost_optimizer", this.costOptimizerNode.bind(this))
            .addNode("quality_analyst", this.qualityAnalystNode.bind(this))
            .addNode("semantic_cache", this.semanticCacheNode.bind(this))
            .addNode("failure_recovery", this.failureRecoveryNode.bind(this))
            // Start with memory reading, then prompt analysis
            .addEdge("__start__", "memory_reader")
            .addEdge("memory_reader", "prompt_analyzer")
            .addConditionalEdges("prompt_analyzer", this.routeAfterPromptAnalysis.bind(this), ["trending_detector", "semantic_cache", "grounding_gate"])
            .addConditionalEdges("trending_detector", this.routeAfterTrendingDetection.bind(this), ["web_scraper", "semantic_cache", "grounding_gate"])
            .addConditionalEdges("web_scraper", this.routeAfterWebScraping.bind(this), ["content_summarizer", "grounding_gate"])
            .addConditionalEdges("content_summarizer", this.routeAfterContentSummarization.bind(this), ["grounding_gate", "__end__"])
            .addConditionalEdges("semantic_cache", this.routeAfterCache.bind(this), ["grounding_gate", "__end__"])
            .addConditionalEdges("grounding_gate", this.routeAfterGroundingGate.bind(this), ["master_agent", "clarification_needed", "web_scraper", "refuse_safely"])
            .addConditionalEdges("master_agent", this.routeFromMaster.bind(this), ["cost_optimizer", "quality_analyst", "failure_recovery", "__end__"])
            .addEdge("cost_optimizer", "quality_analyst")
            .addEdge("quality_analyst", "memory_writer")
            .addEdge("memory_writer", "__end__")
            .addEdge("failure_recovery", "__end__")
            .addEdge("clarification_needed", "__end__")
            .addEdge("refuse_safely", "__end__");

        this.graph = workflow.compile();
    }

    // Main processing method
    public async processMessage(
        conversationId: string,
        userId: string,
        message: string,
        options: {
            chatMode?: 'fastest' | 'cheapest' | 'balanced';
            costBudget?: number;
            previousMessages?: BaseMessage[];
            callbacks?: BaseCallbackHandler[]; // Optional callbacks for activity streaming
            selectionResponse?: any; // Selection response from IntegrationSelector
            documentIds?: string[]; // Document IDs for RAG context
        } = {}
    ): Promise<{
        response: string;
        cost: number;
        agentPath: string[];
        optimizationsApplied: string[];
        cacheHit: boolean;
        riskLevel: string;
        thinking?: any;
        requiresIntegrationSelector?: boolean;
        integrationSelectorData?: any;
        metadata: Record<string, any>;
        mongodbIntegrationData?: any;
        formattedResult?: any;
        githubIntegrationData?: any;
        vercelIntegrationData?: any;
        googleIntegrationData?: any;
        slackIntegrationData?: any;
        discordIntegrationData?: any;
        jiraIntegrationData?: any;
        linearIntegrationData?: any;
        awsIntegrationData?: any;
    }> {
        // Start LangSmith tracing
        const runId = await langSmithService.createRun(
            'multi-agent-chat',
            'chain',
            {
                message,
                conversationId,
                userId,
                chatMode: options.chatMode || 'balanced',
                costBudget: options.costBudget || 0.10
            },
            {
                service: 'multi-agent-flow',
                version: '2.0.0'
            }
        );

        try {
            // Setup LangSmith run for tracing
            const runId = `run_${Date.now()}_${Math.random().toString(36).substring(7)}`;
            loggingService.info(`📊 LangSmith run created: ${runId}`);

            // Debug: Log what options were received
            loggingService.info('🔍 processMessage called with options', {
                hasOptions: !!options,
                hasSelectionResponse: !!options.selectionResponse,
                selectionResponse: options.selectionResponse,
                selectionResponseKeys: options.selectionResponse ? Object.keys(options.selectionResponse) : [],
                selectionResponseIntegration: options.selectionResponse?.integration,
                optionsKeys: Object.keys(options),
                hasDocumentIds: !!options.documentIds && options.documentIds.length > 0,
                documentIdsCount: options.documentIds?.length || 0,
                message
            });
            
            // Check if message needs MCP routing
            const { ChatService } = await import('./chat.service');
            const integrationIntent = await (ChatService as any).detectIntegrationIntent(message, userId);
            
            if (integrationIntent.needsIntegration) {
                loggingService.info('MCP routing detected in MultiAgentFlow', {
                    integrations: integrationIntent.integrations,
                    suggestedTools: integrationIntent.suggestedTools,
                    confidence: integrationIntent.confidence
                });
                
                // Route through MCP instead of specialist agents
                const { MCPClientService } = await import('./mcp-client.service');
                
                const initialized = await MCPClientService.initialize(userId);
                if (!initialized) {
                    loggingService.error('Failed to initialize MCP in MultiAgentFlow');
                    // Fall through to normal multi-agent processing
                } else {
                    // Find relevant tools
                    const tools = await MCPClientService.findToolsForIntent(
                        userId,
                        message,
                        integrationIntent.integrations
                    );
                    
                    if (tools.length > 0) {
                        // Execute via MCP
                        const mcpResult = await MCPClientService.executeWithAI(
                            userId,
                            tools[0].name,
                            message,
                            { 
                                previousMessages: options.previousMessages,
                                conversationId,
                            }
                        );
                        
                        if (mcpResult.success) {
                            // Format integration-specific data
                            const integrationData: any = {};
                            const integration = mcpResult.metadata.integration;
                            
                            switch (integration) {
                                case 'mongodb':
                                    integrationData.mongodbIntegrationData = mcpResult.data;
                                    const { MCPResultFormatterService } = await import('./mcp-result-formatter.service');
                                    integrationData.formattedResult = MCPResultFormatterService.formatMongoDBResult(mcpResult);
                                    break;
                                case 'github':
                                    integrationData.githubIntegrationData = mcpResult.data;
                                    break;
                                case 'vercel':
                                    integrationData.vercelIntegrationData = mcpResult.data;
                                    break;
                                case 'google':
                                    integrationData.googleIntegrationData = mcpResult.data;
                                    break;
                                case 'slack':
                                    integrationData.slackIntegrationData = mcpResult.data;
                                    break;
                                case 'discord':
                                    integrationData.discordIntegrationData = mcpResult.data;
                                    break;
                                case 'jira':
                                    integrationData.jiraIntegrationData = mcpResult.data;
                                    break;
                                case 'linear':
                                    integrationData.linearIntegrationData = mcpResult.data;
                                    break;
                                case 'aws':
                                    integrationData.awsIntegrationData = mcpResult.data;
                                    break;
                            }
                            
                            return {
                                response: mcpResult.data?.message || 'Action completed successfully',
                                cost: 0, // MCP handles its own cost tracking
                                agentPath: ['mcp', integration],
                                optimizationsApplied: ['mcp_integration'],
                                cacheHit: mcpResult.metadata.cached || false,
                                riskLevel: mcpResult.metadata.dangerousOperation ? 'high' : 'low',
                                metadata: {
                                    mcpToolUsed: tools[0].name,
                                    mcpExecutionTime: mcpResult.metadata.latency,
                                },
                                ...integrationData,
                            };
                        }
                    }
                }
            }

            // If documentIds are provided, retrieve document content and prepend to message
            let enrichedMessage = message;
            if (options.documentIds && options.documentIds.length > 0) {
                try {
                    const { retrievalService } = await import('./retrieval.service');
                    const retrievalResult = await retrievalService.retrieve(message, {
                        userId,
                        limit: 20,
                        filters: {
                            documentIds: options.documentIds
                        }
                    });

                    if (retrievalResult.documents.length > 0) {
                        const documentContext = retrievalResult.documents
                            .map((doc, idx) => `[Document ${idx + 1}]:\n${doc.pageContent}`)
                            .join('\n\n');
                        
                        enrichedMessage = `The user has uploaded document(s) for analysis. Here is the document content:\n\n${documentContext}\n\n---\n\nUser's question: ${message}`;
                        
                        loggingService.info('📄 Document context added to message', {
                            documentsFound: retrievalResult.documents.length,
                            documentIds: options.documentIds,
                            enrichedMessageLength: enrichedMessage.length
                        });
                    } else {
                        loggingService.warn('⚠️ No documents found for provided documentIds', {
                            documentIds: options.documentIds,
                            userId
                        });
                    }
                } catch (docError) {
                    loggingService.error('❌ Failed to retrieve documents for context', {
                        error: docError instanceof Error ? docError.message : String(docError),
                        documentIds: options.documentIds
                    });
                }
            }

            const initialState: Partial<MultiAgentState> = {
                messages: [new HumanMessage(enrichedMessage)],
                userId,
                conversationId,
                chatMode: options.chatMode || 'balanced',
                costBudget: options.costBudget || 0.10,
                metadata: { 
                    startTime: Date.now(),
                    langSmithRunId: runId,
                    userId,
                    documentIds: options.documentIds,
                    ...(options.selectionResponse ? { selectionResponse: options.selectionResponse } : {})
                }
            };

            // Debug: Log initial state
            loggingService.info('🔍 Initial state created', {
                hasMetadata: !!initialState.metadata,
                hasSelectionResponse: !!(initialState.metadata as any)?.selectionResponse,
                selectionResponse: (initialState.metadata as any)?.selectionResponse,
                message
            });

            if (options.previousMessages && options.previousMessages.length > 0) {
                initialState.messages = [...options.previousMessages, new HumanMessage(message)];
            }

            const result = await this.graph.invoke(initialState, {
                callbacks: options.callbacks // Pass callbacks if provided
            });
            
            // Debug logging to understand the entire result structure
            loggingService.info('🔍 Multi-agent result structure:', { value:  { 
                messagesCount: result.messages?.length || 0,
                agentPath: result.agentPath,
                hasMessages: !!result.messages,
                lastMessageIndex: result.messages ? result.messages.length - 1 : -1
             } });
            
            const finalMessage = result.messages[result.messages.length - 1];
            
            // Debug logging to understand the final message structure
            loggingService.info('🔍 Multi-agent final message structure:', {
                hasFinalMessage: !!finalMessage,
                messageType: finalMessage?.constructor?.name,
                contentType: typeof finalMessage?.content,
                contentLength: finalMessage?.content?.length || 0,
                contentPreview: typeof finalMessage?.content === 'string' ? finalMessage.content.substring(0, 200) + '...' : 'Not a string',
                messageKeys: finalMessage ? Object.keys(finalMessage) : []
            });
            
            let response: string;
            
            // Check if the final message is a retry wrapper
            if (finalMessage && typeof finalMessage === 'object' && 'success' in finalMessage && 'result' in finalMessage) {
                loggingService.info('🔄 Detected retry wrapper, extracting actual result');
                // This is a retry wrapper, extract the actual result
                const actualResult = finalMessage.result;
                if (actualResult && typeof actualResult.content === 'string') {
                    response = actualResult.content;
                } else if (actualResult && actualResult.content) {
                    response = Array.isArray(actualResult.content) 
                        ? actualResult.content.map((item: any) => typeof item === 'string' ? item : JSON.stringify(item)).join('\n')
                        : JSON.stringify(actualResult.content);
                } else {
                    response = 'Response generated successfully';
                }
            } else if (typeof finalMessage?.content === 'string') {
                response = finalMessage.content;
            } else if (finalMessage?.content) {
                // Handle AIMessage content that might be an array
                response = Array.isArray(finalMessage.content) 
                    ? finalMessage.content.map((item: any) => typeof item === 'string' ? item : JSON.stringify(item)).join('\n')
                    : JSON.stringify(finalMessage.content);
            } else {
                // Fallback - try to extract from the last few messages
                const lastMessages = result.messages.slice(-3);
                const textContent = lastMessages
                    .map((msg: any) => typeof msg.content === 'string' ? msg.content : '')
                    .filter((text: string) => text.length > 0)
                    .join('\n\n');
                
                response = textContent || 'Response generated successfully';
            }

            const cost = this.calculateTotalCost(result);
            const agentPath = result.agentPath || [];
            const cacheHit = result.cacheHit || false;
            const chatMode = result.chatMode || 'balanced';

            let mongodbIntegrationData = result.mongodbIntegrationData;
            let formattedResult = result.formattedResult;
            
            // Debug: Log MongoDB integration data - AGGRESSIVE LOGGING
            loggingService.info('🔍🔍🔍 FINAL RESULT STATE CHECK 🔍🔍🔍', {
                hasMongodbIntegrationData: !!mongodbIntegrationData,
                mongodbIntegrationData: JSON.stringify(mongodbIntegrationData),
                hasFormattedResult: !!formattedResult,
                formattedResult: formattedResult ? JSON.stringify(formattedResult).substring(0, 200) : null,
                resultKeys: Object.keys(result),
                resultKeysCount: Object.keys(result).length,
                resultHasMongodbIntegrationData: 'mongodbIntegrationData' in result,
                resultHasFormattedResult: 'formattedResult' in result
            });

            // Record cost event for predictive analytics
            this.recordCostEvent(cost, chatMode, cacheHit, agentPath);

            // Log cost information to LangSmith
            if (runId) {
                await langSmithService.logCostEvent(runId, cost, {
                    promptTokens: this.estimateTokens(message),
                    completionTokens: this.estimateTokens(response),
                    totalTokens: this.estimateTokens(message + response)
                }, 'claude-3-5-sonnet');

                // End LangSmith run with success
                await langSmithService.endRun(runId, {
                    response,
                    cost,
                    agentPath,
                    optimizationsApplied: result.optimizationsApplied || [],
                    cacheHit,
                    riskLevel: result.riskLevel || 'low',
                    processingTime: Date.now() - (result.metadata?.startTime || Date.now())
                });
            }

            const finalResult = {
                response,
                cost,
                agentPath,
                optimizationsApplied: result.optimizationsApplied || [],
                cacheHit,
                riskLevel: result.riskLevel || 'low',
                thinking: this.generateThinkingSteps(result),
                // Pass IntegrationSelector data if present
                requiresIntegrationSelector: result.requiresIntegrationSelector,
                integrationSelectorData: result.integrationSelectorData,
                metadata: result.metadata || {},
                // ALWAYS include these fields, even if empty
                mongodbIntegrationData: mongodbIntegrationData || {},
                formattedResult: formattedResult || {}
            };

            loggingService.info('📤 [FLOW-1] multiAgentFlow.processMessage RETURNING', {
                hasMongodbIntegrationData: !!finalResult.mongodbIntegrationData && Object.keys(finalResult.mongodbIntegrationData).length > 0,
                hasFormattedResult: !!finalResult.formattedResult && Object.keys(finalResult.formattedResult).length > 0,
                mongodbIntegrationDataKeys: finalResult.mongodbIntegrationData ? Object.keys(finalResult.mongodbIntegrationData) : [],
                formattedResultKeys: finalResult.formattedResult ? Object.keys(finalResult.formattedResult) : []
            });

            return finalResult;

        } catch (error) {
            loggingService.error('❌ Multi-agent flow processing failed:', { error: error instanceof Error ? error.message : String(error) });
            
            // End LangSmith run with error
            if (runId) {
                await langSmithService.endRun(runId, {
                    error: error instanceof Error ? error.message : 'Unknown error'
                }, error instanceof Error ? error.message : 'Unknown error');
            }

            return {
                response: "I apologize, but I encountered an issue processing your request. Please try again.",
                cost: 0.001,
                agentPath: ['error_fallback'],
                optimizationsApplied: [],
                cacheHit: false,
                riskLevel: 'high',
                metadata: { error: error instanceof Error ? error.message : 'Unknown error' }
            };
        }
    }

    // Node implementations

    private async promptAnalyzer(state: MultiAgentState): Promise<Partial<MultiAgentState>> {
        try {
            const lastMessage = state.messages[state.messages.length - 1];
            if (!lastMessage || typeof lastMessage.content !== 'string') {
                return { agentPath: ['prompt_analysis_skipped'] };
            }

            // Estimate cost and complexity
            const promptCost = this.estimatePromptCost(lastMessage.content);
            const complexity = this.analyzeComplexity(lastMessage.content);
            
            loggingService.info(`💰 Prompt cost estimate: $${promptCost.toFixed(6)}, Complexity: ${complexity}`);

            // Check if prompt needs refinement
            const needsRefinement = promptCost > (state.costBudget || 0.10) || complexity === 'high';
            
            if (needsRefinement) {
                const refinedPrompt = this.refinePrompt(lastMessage.content);
                const refinedMessages = [...state.messages.slice(0, -1), new HumanMessage(refinedPrompt)];
                
                return {
                    messages: refinedMessages,
                    promptCost: this.estimatePromptCost(refinedPrompt),
                    refinedPrompt,
                    optimizationsApplied: ['prompt_refinement'],
                    agentPath: ['prompt_refined'],
                    metadata: { ...state.metadata } // Preserve metadata
                };
            }

            return {
                promptCost,
                agentPath: ['prompt_acceptable'],
                metadata: { ...state.metadata } // Preserve metadata
            };
        } catch (error) {
            loggingService.error('❌ Prompt analysis failed:', { error: error instanceof Error ? error.message : String(error) });
            return { agentPath: ['prompt_analysis_error'], failureCount: 1 };
        }
    }

    private async semanticCacheNode(state: MultiAgentState): Promise<Partial<MultiAgentState>> {
        try {
            const lastMessage = state.messages[state.messages.length - 1];
            if (!lastMessage || typeof lastMessage.content !== 'string') {
                return { 
                    agentPath: ['cache_miss'],
                    metadata: { ...state.metadata } // Preserve metadata
                };
            }

            // Enhanced semantic similarity check
            const cacheResult = await this.getCachedResponse(lastMessage.content);
            
            if (cacheResult && cacheResult.cacheHit) {
                loggingService.info('🎯 Semantic cache hit! Returning cached response');
                return {
                    messages: [...state.messages, new AIMessage(cacheResult.response)],
                    cacheHit: true,
                    optimizationsApplied: ['semantic_cache'],
                    agentPath: [...(state.agentPath || []), 'cache_hit'],
                    metadata: {
                        ...(state.metadata || {}),
                        cacheHitDetails: {
                            source: 'semantic_similarity',
                            timestamp: new Date().toISOString()
                        }
                    }
                };
            }

            return {
                cacheHit: false,
                agentPath: [...(state.agentPath || []), 'cache_miss'],
                metadata: { ...state.metadata } // Preserve metadata
            };
        } catch (error) {
            loggingService.error('❌ Semantic cache failed:', { error: error instanceof Error ? error.message : String(error) });
            return { 
                agentPath: [...(state.agentPath || []), 'cache_error'], 
                failureCount: (state.failureCount || 0) + 1,
                metadata: { ...state.metadata } // Preserve metadata
            };
        }
    }

    /**
     * Grounding Gate Node - THE CRITICAL DECISION POINT
     * Evaluates grounding confidence before allowing generation
     */
    private async groundingGateNode(state: MultiAgentState): Promise<Partial<MultiAgentState>> {
        try {
            loggingService.info('🔒 Evaluating grounding confidence...');
            
            // Build grounding context from state
            const context: GroundingContext = this.buildGroundingContext(state);
            
            // Evaluate grounding
            const decision = await groundingConfidenceService.evaluate(context);
            
            // Store decision in state
            return {
                groundingDecision: decision,
                agentPath: [...(state.agentPath || []), `grounding_${decision.decision.toLowerCase()}`],
                prohibitMemoryWrite: decision.prohibitMemoryWrite,
                metadata: {
                    ...state.metadata,
                    groundingScore: decision.groundingScore,
                    groundingDecision: decision.decision,
                    groundingReasons: decision.reasons,
                    groundingMetrics: decision.metrics
                }
            };
            
        } catch (error) {
            loggingService.error('❌ Grounding gate failed', {
                error: error instanceof Error ? error.message : String(error)
            });
            
            // FAIL SAFE: If grounding check crashes, ask for clarification
            return {
                groundingDecision: {
                    groundingScore: 0,
                    decision: 'ASK_CLARIFY',
                    reasons: ['Grounding evaluation failed', 'Internal error'],
                    metrics: { 
                        retrievalScore: 0, 
                        intentScore: 0, 
                        freshnessScore: 0, 
                        sourceDiversityScore: 0, 
                        finalScore: 0 
                    },
                    timestamp: Date.now(),
                    prohibitMemoryWrite: true
                },
                agentPath: [...(state.agentPath || []), 'grounding_error'],
                failureCount: (state.failureCount || 0) + 1,
                requiresClarification: true,
                prohibitMemoryWrite: true
            };
        }
    }

    /**
     * Clarification Node - Generates clarifying questions
     */
    private async clarificationNeededNode(state: MultiAgentState): Promise<Partial<MultiAgentState>> {
        const decision = state.groundingDecision;
        const lastMessage = state.messages[state.messages.length - 1];
        const query = lastMessage?.content?.toString() || '';
        
        // Build clarification message
        let clarificationMessage = "I want to make sure I give you an accurate answer. ";
        
        if (decision?.reasons.some((r: string) => r.includes('Intent confidence') || r.includes('ambiguous'))) {
            clarificationMessage += `Could you clarify what you mean by "${query.substring(0, 50)}${query.length > 50 ? '...' : ''}"? `;
            
            // Offer specific clarification options based on query type
            const queryType = this.classifyQueryType(query);
            if (queryType === 'ACTION') {
                clarificationMessage += "\n\nFor example, are you asking me to:\n";
                clarificationMessage += "1. Explain how to do something?\n";
                clarificationMessage += "2. Actually perform an action?\n";
                clarificationMessage += "3. Provide recommendations?";
            } else if (queryType === 'FACTUAL') {
                clarificationMessage += "\n\nCould you provide more context about what specific information you're looking for?";
            }
        } else if (decision?.reasons.some((r: string) => r.includes('topic shift') || r.includes('drift'))) {
            clarificationMessage += "It seems like we may have shifted to a new topic. ";
            clarificationMessage += "Could you provide some more context about what you're asking?";
        } else if (decision?.groundingScore && decision.groundingScore < 0.45) {
            clarificationMessage += "I couldn't find enough reliable information to answer this confidently. ";
            clarificationMessage += "Could you provide more context or rephrase your question?";
        } else {
            clarificationMessage += "Could you provide more details so I can give you the best answer?";
        }
        
        loggingService.info('❓ Clarification requested', {
            originalQuery: query,
            groundingScore: decision?.groundingScore,
            reasons: decision?.reasons,
            attempts: state.clarificationAttempts || 0
        });
        
        return {
            messages: [...state.messages, new AIMessage({
                content: clarificationMessage,
                additional_kwargs: {
                    clarification_requested: true,
                    grounding_reasons: decision?.reasons,
                    grounding_score: decision?.groundingScore
                }
            })],
            requiresClarification: true,
            clarificationAttempts: (state.clarificationAttempts || 0) + 1,
            agentPath: [...(state.agentPath || []), 'clarification_requested']
        };
    }

    /**
     * Refusal Node - Safe rejection with helpful explanation
     */
    private async refuseSafelyNode(state: MultiAgentState): Promise<Partial<MultiAgentState>> {
        const decision = state.groundingDecision;
        const lastMessage = state.messages[state.messages.length - 1];
        const query = lastMessage?.content?.toString() || '';
        
        let refusalMessage = "I don't have enough reliable information to answer this question confidently. ";
        
        // Check for loop exhaustion
        if (decision?.reasons.some((r: string) => r.includes('Maximum clarification attempts'))) {
            refusalMessage = "I've tried to clarify your question, but I'm still not confident I can provide an accurate answer. ";
            refusalMessage += "This might be outside my current knowledge base. ";
        } else if (decision?.reasons.some((r: string) => r.includes('Maximum search attempts'))) {
            refusalMessage = "I've attempted to find current information multiple times, but haven't been successful. ";
            refusalMessage += "The information might not be available or the sources may be temporarily unavailable. ";
        } else if (state.metadata?.retrievalResult?.hitCount === 0) {
            refusalMessage += "I couldn't find any relevant information in my knowledge base. ";
        } else if (decision?.metrics?.retrievalScore && decision.metrics.retrievalScore < 0.3) {
            refusalMessage += "The information I found doesn't seem directly relevant to your question. ";
        }
        
        // Add helpful next steps
        refusalMessage += "\n\nYou might want to:\n";
        refusalMessage += "- Upload relevant documents if you have them\n";
        refusalMessage += "- Rephrase your question with more specific details\n";
        refusalMessage += "- Ask about a different topic I have information about";
        
        loggingService.warn('🚫 Safe refusal triggered', {
            originalQuery: query,
            groundingScore: decision?.groundingScore,
            reasons: decision?.reasons,
            hitCount: state.metadata?.retrievalResult?.hitCount
        });
        
        return {
            messages: [...state.messages, new AIMessage({
                content: refusalMessage,
                additional_kwargs: {
                    refusal: true,
                    grounding_reasons: decision?.reasons,
                    grounding_score: decision?.groundingScore
                }
            })],
            refused: true,
            agentPath: [...(state.agentPath || []), 'refused_safely']
        };
    }

    private async masterAgentNode(state: MultiAgentState): Promise<Partial<MultiAgentState>> {
        try {
            // 🔒 REDUNDANT SAFETY CHECK - Catch GCL bypass scenarios
            if (!state.groundingDecision) {
                loggingService.error('🚨 CRITICAL: Master agent invoked without grounding check');
                
                // Get the query for context
                const lastMessage = state.messages[state.messages.length - 1];
                const query = lastMessage?.content?.toString() || '';
                
                // Emergency re-check
                const groundingContext = this.buildGroundingContext(state);
                const decision = await groundingConfidenceService.evaluate(groundingContext);
                
                if (decision.decision !== 'GENERATE') {
                    loggingService.error('🚨 Grounding bypass prevented. Decision was: ' + decision.decision, {
                        query,
                        groundingScore: decision.groundingScore,
                        reasons: decision.reasons
                    });
                    
                    
                    return {
                        groundingDecision: decision,
                        requiresClarification: true,
                        prohibitMemoryWrite: true,
                        messages: [...state.messages, new AIMessage({
                            content: `I need to verify my confidence before answering your question about "${query}". Could you rephrase your question?`,
                            additional_kwargs: {
                                emergency_check: true,
                                grounding_reasons: decision.reasons,
                                original_query: query
                            }
                        })],
                        agentPath: [...(state.agentPath || []), 'emergency_grounding_check']
                    };
                }
                
                // Update state with emergency decision
                state = { ...state, groundingDecision: decision, prohibitMemoryWrite: false };
            }
            
            // Use Langchain coordination if enabled
            if (this.langchainIntegrationEnabled && this.langchainCoordinatorAgent) {
                return await this.masterAgentWithLangchain(state);
            }
            
            // Check if web scraping failed and provide fallback
            if (state.metadata?.scrapingFailed) {
                const lastMessage = state.messages[state.messages.length - 1];
                const query = lastMessage?.content?.toString() || '';
                
                // Provide helpful fallback response
                const fallbackResponse = new AIMessage(`I understand you're asking about "${query}". While I couldn't access real-time web data due to technical limitations, I can provide you with general information based on my knowledge.

For the most current and accurate information, I recommend:
1. Checking official websites directly
2. Using search engines like Google or Bing
3. Visiting relevant news or information sites

Would you like me to help you with anything else, or would you prefer to check these sources directly?`);
                
                return {
                    messages: [fallbackResponse],
                    currentAgent: 'master_fallback',
                    agentPath: [...(state.agentPath || []), 'master_agent_fallback'],
                    metadata: { 
                        ...state.metadata, 
                        strategy: state.chatMode,
                        fallbackUsed: true,
                        originalQuery: query
                    }
                };
            }
            
            // Determine strategy based on chat mode
            const strategy = this.getStrategyPrompt(state.chatMode);
            const systemMessage = new HumanMessage(`${strategy}\n\nConversation context:`);
            
            const response = await this.retryExecutor(async () => {
                return await this.masterAgent.invoke([systemMessage, ...state.messages]);
            });
            
            // Store successful response in semantic cache for future use
            const lastUserMessage = state.messages[state.messages.length - 1];
            if (lastUserMessage && typeof lastUserMessage.content === 'string' && response.content) {
                await this.storeInCache(lastUserMessage.content, response.content as string);
            }
            
            return {
                messages: [response],
                currentAgent: 'master',
                agentPath: [...(state.agentPath || []), 'master_agent'],
                metadata: { 
                    ...state.metadata, 
                    strategy: state.chatMode,
                    processingTime: Date.now() - (state.metadata?.startTime ?? Date.now())
                }
            };
        } catch (error) {
            loggingService.error('❌ Master agent failed:', { error: error instanceof Error ? error.message : String(error) });
            return { 
                agentPath: [...(state.agentPath || []), 'master_agent_error'],
                failureCount: (state.failureCount || 0) + 1
            };
        }
    }

    /**
     * Enhanced master agent with Langchain coordination and tool access
     */
    private async masterAgentWithLangchain(state: MultiAgentState): Promise<Partial<MultiAgentState>> {
        try {
            const lastMessage = state.messages[state.messages.length - 1];
            const userMessage = lastMessage.content as string;
            
            // Debug: Log state metadata
            loggingService.info('🔍 Master agent state check', {
                hasMetadata: !!state.metadata,
                hasSelectionResponse: !!state.metadata?.selectionResponse,
                selectionResponse: state.metadata?.selectionResponse,
                userMessage,
                messageStartsWith: userMessage.startsWith('Selected:')
            });
            
            // Check if this is a selection response for MongoDB
            const selectionResponse = state.metadata?.selectionResponse as any;
            const isMongoDBSelectionResponse = selectionResponse?.integration === 'mongodb' && 
                                              userMessage.startsWith('Selected:');
            
            loggingService.info('🔍 MongoDB selection check', {
                isMongoDBSelectionResponse,
                hasSelectionResponse: !!selectionResponse,
                integration: selectionResponse?.integration,
                startsWithSelected: userMessage.startsWith('Selected:')
            });
            
            if (isMongoDBSelectionResponse) {
                loggingService.info('🔗 Master agent processing MongoDB selection response', {
                    parameterName: selectionResponse.parameterName,
                    value: selectionResponse.value,
                    pendingAction: selectionResponse.pendingAction,
                    collectedParams: selectionResponse.collectedParams
                });
                
                // Reconstruct the MongoDB command with collected parameters
                const collectedParams = {
                    ...selectionResponse.collectedParams,
                    [selectionResponse.parameterName]: selectionResponse.value
                };
                
                // Import and use the MongoDB integration tool
                const { MongoDBIntegrationTool } = await import('../tools/mongodbIntegrationTool');
                const mongodbTool = new MongoDBIntegrationTool(state.metadata?.userId || 'unknown');
                
                // Call the tool with the collected parameters
                const toolInput = JSON.stringify(collectedParams);
                loggingService.info('🔧 Calling MongoDB tool with collected params', { toolInput });
                
                const toolResult = await mongodbTool._call(toolInput);
                
                // Parse the tool result
                let parsedResult;
                try {
                    parsedResult = JSON.parse(toolResult);
                } catch {
                    parsedResult = { success: false, error: 'Failed to parse tool response' };
                }
                
                // If the tool still requires more parameters, continue the flow
                if (parsedResult.requiresIntegrationSelector) {
                    const userFriendlyMessage = parsedResult.integrationSelectorData?.question || 'Please provide additional information to continue.';
                    
                    return {
                        messages: [new AIMessage(userFriendlyMessage)],
                        currentAgent: 'master_langchain',
                        agentPath: [...(state.agentPath || []), 'master_langchain_enhanced'],
                        optimizationsApplied: [...(state.optimizationsApplied || []), 'mongodb_integration_tool'],
                        requiresIntegrationSelector: true,
                        integrationSelectorData: parsedResult.integrationSelectorData,
                        metadata: {
                            ...state.metadata,
                            langchainEnhanced: true,
                            toolUsed: 'mongodb_integration',
                            toolSuccess: false,
                            requiresIntegrationSelector: true,
                            integrationSelectorData: parsedResult.integrationSelectorData,
                        }
                    };
                }
                
                // Return the successful result
                return {
                    messages: [new AIMessage(parsedResult.message || toolResult)],
                    currentAgent: 'master_langchain',
                    agentPath: [...(state.agentPath || []), 'master_langchain_enhanced'],
                    optimizationsApplied: [...(state.optimizationsApplied || []), 'mongodb_integration_tool'],
                    metadata: {
                        ...state.metadata,
                        langchainEnhanced: true,
                        toolUsed: 'mongodb_integration',
                        toolSuccess: parsedResult.success,
                    },
                    mongodbIntegrationData: parsedResult.mongodbIntegrationData,
                    formattedResult: parsedResult.formattedResult
                };
            }
            
            // Check if this is a MongoDB operation request
            // Only trigger if explicitly mentioned with @mongodb
            const isMongoDBRequest = /@mongodb[:\s]/i.test(userMessage);
            
            if (isMongoDBRequest) {
                loggingService.info('🔧 Detected MongoDB request, invoking mongodb_integration tool');
                
                // Import and use the MongoDB integration tool
                const { MongoDBIntegrationTool } = await import('../tools/mongodbIntegrationTool');
                const mongodbTool = new MongoDBIntegrationTool(state.metadata?.userId || 'unknown');
                
                // Call the tool with the user's request
                const toolResult = await mongodbTool._call(userMessage);
                
                // Parse the tool result
                let parsedResult;
                try {
                    parsedResult = JSON.parse(toolResult);
                } catch {
                    parsedResult = { success: false, error: 'Failed to parse tool response' };
                }
                
                // If the tool requires parameter collection, pass this back to frontend
                if (parsedResult.requiresIntegrationSelector) {
                    loggingService.info('🔧 MongoDB tool requires parameter collection', {
                        parameterName: parsedResult.integrationSelectorData?.parameterName,
                        question: parsedResult.integrationSelectorData?.question,
                    });
                    
                    // Use the question from selectorData as the message, not the error
                    const userFriendlyMessage = parsedResult.integrationSelectorData?.question || 'Please provide additional information to continue.';
                    
                    return {
                        messages: [new AIMessage(userFriendlyMessage)],
                        currentAgent: 'master_langchain',
                        agentPath: [...(state.agentPath || []), 'master_langchain_enhanced'],
                        optimizationsApplied: [...(state.optimizationsApplied || []), 'mongodb_integration_tool'],
                        // Add at root level for proper propagation
                        requiresIntegrationSelector: true,
                        integrationSelectorData: parsedResult.integrationSelectorData,
                        metadata: {
                            ...state.metadata,
                            langchainEnhanced: true,
                            toolUsed: 'mongodb_integration',
                            toolSuccess: false,
                            requiresIntegrationSelector: true,
                            integrationSelectorData: parsedResult.integrationSelectorData,
                        }
                    };
                }
                
                // Return the tool result directly as the response
                return {
                    messages: [new AIMessage(parsedResult.message || toolResult)],
                    currentAgent: 'master_langchain',
                    agentPath: [...(state.agentPath || []), 'master_langchain_enhanced'],
                    optimizationsApplied: [...(state.optimizationsApplied || []), 'mongodb_integration_tool'],
                    // Pass IntegrationSelector data at root level so frontend can access it
                    requiresIntegrationSelector: parsedResult.requiresIntegrationSelector,
                    integrationSelectorData: parsedResult.integrationSelectorData,
                    metadata: {
                        ...state.metadata,
                        langchainEnhanced: true,
                        toolUsed: 'mongodb_integration',
                        toolSuccess: parsedResult.success,
                        requiresIntegrationSelector: parsedResult.requiresIntegrationSelector,
                        integrationSelectorData: parsedResult.integrationSelectorData,
                    },
                    mongodbIntegrationData: parsedResult.mongodbIntegrationData,
                    formattedResult: parsedResult.formattedResult
                };
            }
            
            // Check if this is an AWS operation request
            const isAWSRequest = /create|list|stop|start|show.*(?:bucket|s3|ec2|instance|rds|database|lambda|function|dynamodb|table|ecs|cluster|cost)/i.test(userMessage);
            
            if (isAWSRequest) {
                loggingService.info('🔧 Detected AWS request, invoking aws_integration tool');
                
                // Import and use the AWS integration tool
                const { AWSIntegrationTool } = await import('../tools/awsIntegrationTool');
                const awsTool = new AWSIntegrationTool(state.metadata?.userId || 'unknown');
                
                // Call the tool with the user's request
                const toolResult = await awsTool._call(userMessage);
                
                // Parse the tool result
                let parsedResult;
                try {
                    parsedResult = JSON.parse(toolResult);
                } catch {
                    parsedResult = { success: false, error: 'Failed to parse tool response' };
                }
                
                // Return the tool result directly as the response
                return {
                    messages: [new AIMessage(parsedResult.message || toolResult)],
                    currentAgent: 'master_langchain',
                    agentPath: [...(state.agentPath || []), 'master_langchain_enhanced'],
                    optimizationsApplied: [...(state.optimizationsApplied || []), 'aws_integration_tool'],
                    metadata: {
                        ...state.metadata,
                        langchainEnhanced: true,
                        toolUsed: 'aws_integration',
                        toolSuccess: parsedResult.success,
                        requiresApproval: parsedResult.requiresApproval,
                        approvalToken: parsedResult.approvalToken,
                    }
                };
            }
            
            // For non-AWS/MongoDB requests, use simple direct response
            const simplePrompt = new HumanMessage(`${userMessage}\n\nProvide a direct, concise, and helpful response. Do not add fluff or overly formal language.`);
            const response = await this.langchainCoordinatorAgent!.invoke([simplePrompt]);
            
            return {
                messages: [new AIMessage(response.content as string)],
                currentAgent: 'master_langchain',
                agentPath: [...(state.agentPath || []), 'master_langchain_enhanced'],
                optimizationsApplied: [...(state.optimizationsApplied || []), 'langchain_coordination'],
                metadata: {
                    ...state.metadata,
                    langchainEnhanced: true,
                }
            };
            
        } catch (error) {
            loggingService.error('Langchain master agent failed, falling back', { error });
            // Remove the Langchain flag and retry with regular master agent
            this.langchainIntegrationEnabled = false;
            return this.masterAgentNode(state);
        }
    }

    private async costOptimizerNode(state: MultiAgentState): Promise<Partial<MultiAgentState>> {
        // Cost optimization is handled in metadata, no new message needed
        return {
            currentAgent: 'cost_optimizer',
            agentPath: ['cost_optimizer'],
            // Preserve MongoDB integration data
            mongodbIntegrationData: state.mongodbIntegrationData,
            formattedResult: state.formattedResult
        };
    }

    private async qualityAnalystNode(state: MultiAgentState): Promise<Partial<MultiAgentState>> {
        try {
            const qualityPrompt = `Analyze the quality of this conversation and provide a quality score (1-10) and recommendations:
            
            Messages: ${state.messages.map(m => m.content).join('\n')}
            Applied optimizations: ${state.optimizationsApplied.join(', ')}
            
            Provide your analysis in JSON format with: qualityScore, strengths, weaknesses, recommendations`;

            const response = await this.retryExecutor(async () => {
                return await this.qualityAnalystAgent.invoke([new HumanMessage(qualityPrompt)]);
            });
            
            // Extract quality metrics from response
            const qualityMetrics = this.extractQualityMetrics(response.content as string);
            
            return {
                // Don't add a new message, just update metadata
                currentAgent: 'quality_analyst',
                agentPath: ['quality_analyst'],
                metadata: {
                    ...state.metadata,
                    qualityScore: qualityMetrics.score,
                    qualityRecommendations: qualityMetrics.recommendations
                },
                riskLevel: this.assessRiskLevel(qualityMetrics.score, state.optimizationsApplied),
                mongodbIntegrationData: state.mongodbIntegrationData,
                formattedResult: state.formattedResult
            };
        } catch (error) {
            loggingService.error('❌ Quality analyst failed:', { error: error instanceof Error ? error.message : String(error) });
            return { 
                agentPath: ['quality_analyst_error'],
                failureCount: (state.failureCount || 0) + 1,
                // Preserve MongoDB integration data even on error
                mongodbIntegrationData: state.mongodbIntegrationData,
                formattedResult: state.formattedResult
            };
        }
    }

    private async failureRecoveryNode(state: MultiAgentState): Promise<Partial<MultiAgentState>> {
        try {
            loggingService.warn(`🔄 Failure recovery activated. Failure count: ${state.failureCount}`);
            
            // Implement exponential backoff
            const delay = Math.min(1000 * Math.pow(2, state.failureCount || 0), 30000);
            await new Promise(resolve => setTimeout(resolve, delay));
            
            // Use simpler model for recovery
            const fallbackResponse = await this.costOptimizerAgent.invoke([
                new HumanMessage("I apologize for the technical difficulties. Let me provide a helpful response to your query.")
            ]);

            return {
                messages: [fallbackResponse],
                currentAgent: 'failure_recovery',
                agentPath: ['failure_recovery'],
                optimizationsApplied: ['failure_recovery'],
                metadata: {
                    ...state.metadata,
                    recoveryMethod: 'fallback_model',
                    recoveryDelay: delay
                }
            };
        } catch (error) {
            loggingService.error('❌ Failure recovery failed:', { error: error instanceof Error ? error.message : String(error) });
            return {
                messages: [new HumanMessage("I apologize, but I'm experiencing technical difficulties. Please try again later.")],
                agentPath: ['failure_recovery_final'],
                failureCount: (state.failureCount || 0) + 1
            };
        }
    }

    // Web Scraping Nodes
    private async trendingDetectorNode(state: MultiAgentState): Promise<Partial<MultiAgentState>> {
        try {
            const lastMessage = state.messages[state.messages.length - 1];
            if (!lastMessage || typeof lastMessage.content !== 'string') {
                return { agentPath: ['trending_detection_skipped'] };
            }

            // IMPORTANT: Skip web search when user has provided documents for analysis
            // The user wants to analyze their uploaded documents, not search the web
            const hasDocumentContext = state.metadata?.documentIds && 
                (state.metadata.documentIds as string[]).length > 0;
            
            if (hasDocumentContext) {
                loggingService.info('📄 Skipping web search - user has uploaded documents for analysis', {
                    documentIds: state.metadata?.documentIds
                });
                return { 
                    needsWebData: false,
                    webSources: [],
                    agentPath: ['trending_skipped_document_context'],
                    metadata: {
                        ...(state.metadata || {}),
                        trendingAnalysis: {
                            confidence: 1.0,
                            queryType: 'document_analysis',
                            skipReason: 'user_provided_documents'
                        }
                    }
                };
            }

            const query = lastMessage.content;
            loggingService.info(`🔍 Analyzing query with trending detection: "${query}"`);
            
            // Use trending detector for platform detection and source analysis
            const trendingAnalysis = await this.trendingDetector.analyzeQuery(query);
            
            loggingService.info(`🎯 Trending analysis result:`, {
                needsWebData: trendingAnalysis.needsRealTimeData,
                confidence: trendingAnalysis.confidence,
                queryType: trendingAnalysis.queryType,
                sourcesCount: trendingAnalysis.suggestedSources.length
            });

            // Use trending analysis for web sources
            const webSources = trendingAnalysis.suggestedSources;

            return {
                needsWebData: trendingAnalysis.needsRealTimeData,
                webSources,
                agentPath: [`trending_detected_${trendingAnalysis.queryType}`],
                metadata: {
                    ...(state.metadata || {}),
                    trendingAnalysis: {
                        confidence: trendingAnalysis.confidence,
                        queryType: trendingAnalysis.queryType,
                        extractionStrategy: trendingAnalysis.extractionStrategy,
                        cacheStrategy: trendingAnalysis.cacheStrategy,
                        suggestedSources: trendingAnalysis.suggestedSources
                    }
                }
            };

        } catch (error) {
            loggingService.error('❌ Smart tag generation failed:', { error: error instanceof Error ? error.message : String(error) });
            return { 
                needsWebData: false,
                agentPath: ['trending_detection_error'], 
                failureCount: 1 
            };
        }
    }

    private async webScrapingNode(state: MultiAgentState): Promise<Partial<MultiAgentState>> {
        try {
            const lastMessage = state.messages[state.messages.length - 1];
            if (!lastMessage || typeof lastMessage.content !== 'string') {
                return { agentPath: ['web_scraping_skipped'] };
            }

            const trendingAnalysis = state.metadata?.trendingAnalysis;
            const sources = state.webSources || [];
            
            if (sources.length === 0) {
                loggingService.warn('No web sources provided for scraping');
                return { agentPath: ['web_scraping_no_sources'] };
            }

            loggingService.info(`🔍 Starting web search from ${sources.length} sources...`);
            if (trendingAnalysis?.suggestedSources) {
                loggingService.info(`🎯 Using trending analysis for ${sources.length} sources`);
            }
            
            const scrapingResults = [];
            const maxSources = Math.min(sources.length, 3); // Limit to 3 sources for performance

            for (let i = 0; i < maxSources; i++) {
                const source = sources[i];
                
                try {
                    loggingService.info(`📄 Fetching: ${source}`);
                    
                    // Use simplified scraping request (no Puppeteer, just axios + cheerio)
                    const scrapingRequest = {
                        operation: 'scrape' as const,
                        url: source,
                        cache: {
                            enabled: true,
                            key: `scrape_${Buffer.from(source).toString('base64')}`
                        }
                    };

                    const result = await this.webSearchTool._call(JSON.stringify(scrapingRequest));
                    const parsedResult = JSON.parse(result);
                    
                    if (parsedResult.success) {
                        scrapingResults.push(parsedResult);
                        loggingService.info(`✅ Successfully fetched: ${source}`);
                        loggingService.info(`📄 Extracted content length: ${parsedResult.data?.extractedText?.length || 0} chars`);
                        loggingService.info(`📄 Title: ${parsedResult.data?.title || 'No title'}`);
                    } else {
                        loggingService.warn(`❌ Failed to fetch: ${source} - ${parsedResult.error}`);
                    }

                } catch (error) {
                    loggingService.error(`❌ Error fetching ${source}:`, { error: error instanceof Error ? error.message : String(error) });
                }
            }

            if (scrapingResults.length === 0) {
                loggingService.warn('❌ All web fetches failed, providing fallback response');
                return { 
                    agentPath: ['web_scraping_failed'],
                    failureCount: 1,
                    metadata: {
                        ...(state.metadata || {}),
                        scrapingFailed: true,
                        fallbackUsed: true
                    }
                };
            }

            loggingService.info(`🎉 Successfully fetched ${scrapingResults.length} sources`);

            return {
                scrapingResults,
                agentPath: [`web_scraped_${scrapingResults.length}_sources`],
                metadata: {
                    ...(state.metadata || {}),
                    scrapingStats: {
                        sourcesAttempted: maxSources,
                        sourcesSuccessful: scrapingResults.length,
                        totalContentLength: scrapingResults.reduce((sum, r) => sum + (r.data?.extractedText?.length || 0), 0)
                    }
                }
            };

        } catch (error) {
            loggingService.error('❌ Web scraping failed:', { error: error instanceof Error ? error.message : String(error) });
            return { 
                agentPath: ['web_scraping_error'], 
                failureCount: 1 
            };
        }
    }

    private async contentSummarizerNode(state: MultiAgentState): Promise<Partial<MultiAgentState>> {
        try {
            const scrapingResults = state.scrapingResults || [];
            
            if (scrapingResults.length === 0) {
                return { agentPath: ['content_summarizer_skipped'] };
            }

            loggingService.info(`📝 Summarizing content from ${scrapingResults.length} sources...`);

            // Combine all scraped content
            const combinedContent = scrapingResults
                .map(result => ({
                    source: result.data?.url || 'unknown',
                    title: result.data?.title || '',
                    content: result.data?.extractedText || '',
                    summary: result.data?.summary || ''
                }))
                .filter(item => item.content.length > 0);

            loggingService.info(`📝 Combined content details:`, {
                totalSources: scrapingResults.length,
                validSources: combinedContent.length,
                contentLengths: combinedContent.map(item => ({
                    source: item.source,
                    contentLength: item.content.length,
                    title: item.title
                }))
            });

            if (combinedContent.length === 0) {
                return { agentPath: ['content_summarizer_no_content'] };
            }

            // Create a concise summary using the web scraping agent
            const userQuery = state.messages[state.messages.length - 1]?.content?.toString() || '';
            const isLinkedInQuery = userQuery.toLowerCase().includes('linkedin');
            
            const summaryPrompt = `You are a helpful assistant. Analyze the following web content and provide a direct, concise answer to the user's query.

User Query: ${userQuery}

Scraped Content:
${combinedContent.map((item, index) => `
Source ${index + 1}: ${item.source}
Content: ${item.content.substring(0, 2000)}...
`).join('\n---\n')}

${isLinkedInQuery ? `
SPECIAL INSTRUCTIONS FOR LINKEDIN QUERIES:
- If content mentions login/authentication requirements, acknowledge this but also extract any visible profile information
- Look for LinkedIn profile URLs, names, job titles, companies, or locations in search results
- If you find multiple potential matches, list them clearly
- Provide actionable next steps like "You can search directly on LinkedIn" or "Try connecting on LinkedIn"
- Be helpful despite access limitations
` : ''}

Provide a direct, helpful answer that directly addresses the user's question. Focus on the most relevant information and provide actionable guidance. Keep it concise but informative.`;

            const summaryResponse = await this.retryExecutor(async () => {
                return await this.webScrapingAgent.invoke([
                    new HumanMessage(summaryPrompt)
                ]);
            });

            // Debug logging to see what the AI model returned
            loggingService.info('🔍 Summary response structure:', {
                hasResponse: !!summaryResponse,
                responseType: summaryResponse?.constructor?.name,
                hasContent: !!summaryResponse?.content,
                contentType: typeof summaryResponse?.content,
                contentLength: summaryResponse?.content?.length || 0,
                contentPreview: summaryResponse?.content?.toString()?.substring(0, 200) || 'No content'
            });

            // Handle potential undefined content
            let actualResponse = summaryResponse;
            
            // Check if response is wrapped by retry mechanism
            if (summaryResponse && typeof summaryResponse === 'object' && 'success' in summaryResponse && 'result' in summaryResponse) {
                loggingService.info('🔄 Detected retry wrapper in summary response, extracting actual result');
                actualResponse = summaryResponse.result;
            }
            
            const comprehensiveSummary = actualResponse?.content?.toString() || 'Unable to generate summary from web content.';

            loggingService.info('✅ Content summarization completed');

            // Create the summary message
            const summaryMessage = new AIMessage(`${comprehensiveSummary}

Sources: ${combinedContent.map((item, index) => `${index + 1}. ${item.source}`).join(', ')}`);

            loggingService.info('✅ Content summarization completed - adding summary message to state');

            return {
                messages: [summaryMessage], // Return only the new message, LangGraph will merge it
                agentPath: ['content_summarized'],
                optimizationsApplied: ['web_content_integration'],
                metadata: {
                    ...(state.metadata || {}),
                    contentSummary: {
                        sourcesUsed: combinedContent.length,
                        summaryLength: comprehensiveSummary.length,
                        sources: combinedContent.map(item => ({ url: item.source, title: item.title }))
                    }
                }
            };

        } catch (error) {
            loggingService.error('❌ Content summarization failed:', { error: error instanceof Error ? error.message : String(error) });
            return { 
                agentPath: ['content_summarizer_error'], 
                failureCount: 1 
            };
        }
    }

    // Routing functions
    private routeAfterPromptAnalysis(state: MultiAgentState): string {
        const lastPath = state.agentPath[state.agentPath.length - 1];
        
        if (lastPath === 'prompt_analysis_error') {
            return 'grounding_gate'; // Go to grounding gate even on error
        }
        
        // Check if query might need real-time web data
        const lastMessage = state.messages[state.messages.length - 1];
        if (lastMessage && typeof lastMessage.content === 'string') {
            const quickCheck = this.trendingDetector.quickCheck(lastMessage.content);
            if (quickCheck) {
                return 'trending_detector'; // Analyze for web scraping needs
            }
        }
        
        return 'semantic_cache'; // Default: check cache first
    }

    private routeAfterTrendingDetection(state: MultiAgentState): string {
        if (state.needsWebData && state.webSources && state.webSources.length > 0) {
            return 'web_scraper'; // Proceed with web scraping
        }
        
        // No web scraping needed, check cache or go to master agent
        return 'semantic_cache';
    }

    private routeAfterWebScraping(state: MultiAgentState): string {
        const lastPath = state.agentPath[state.agentPath.length - 1];
        
        if (lastPath === 'web_scraping_error' || lastPath === 'web_scraping_failed') {
            return 'grounding_gate'; // Proceed to grounding gate even without web data
        }
        
        if (state.scrapingResults && state.scrapingResults.length > 0) {
            return 'content_summarizer'; // Summarize the scraped content
        }
        
        return 'master_agent'; // No content to summarize
    }

    private routeAfterCache(state: MultiAgentState): string {
        if (state.cacheHit) {
            return '__end__'; // Cache hit, we're done
        }
        
        return 'grounding_gate'; // Cache miss, proceed to grounding gate
    }

    /**
     * Route after grounding gate - Critical decision routing
     */
    private routeAfterGroundingGate(state: MultiAgentState): string {
        const decision = state.groundingDecision?.decision;
        const config = groundingConfidenceService.getConfig();
        
        // Emergency bypass check (for critical incidents)
        if (config.flags.emergencyBypass) {
            loggingService.warn('🚨 Emergency bypass active - routing to master_agent');
            return 'master_agent';
        }
        
        // In shadow mode, always generate (but log the decision)
        if (config.flags.shadowMode && !config.flags.blockingEnabled) {
            loggingService.info('🔍 Shadow mode: Would have decided ' + decision + ', but allowing generation');
            return 'master_agent';
        }
        
        // Blocking mode: enforce decisions
        switch (decision) {
            case 'GENERATE':
                return 'master_agent';
            
            case 'ASK_CLARIFY':
                return 'clarification_needed';
            
            case 'SEARCH_MORE':
                // Re-trigger web search or tool retry
                loggingService.info('🔍 GCL requesting fresh search');
                return 'web_scraper';
            
            case 'REFUSE':
                // Only enforce REFUSE if strict refusal is enabled
                if (config.flags.strictRefusal) {
                    return 'refuse_safely';
                }
                // Otherwise, log but allow generation (Phase 2 behavior)
                loggingService.info('🔍 Would REFUSE but strict refusal not enabled, allowing generation');
                return 'master_agent';
            
            default:
                // Fail safe: ask for clarification on unknown decision
                loggingService.error('Unknown grounding decision: ' + decision);
                return 'clarification_needed';
        }
    }

    private routeAfterContentSummarization(state: MultiAgentState): string {
        // If we have web scraping results, proceed to grounding gate
        if (state.metadata?.contentSummary?.sourcesUsed > 0) {
            loggingService.info('✅ Web scraping completed successfully, proceeding to grounding gate');
            return 'grounding_gate';
        }
        
        // If no web scraping was done, still go to grounding gate (it will handle the decision)
        loggingService.info('⚠️ No web scraping results, proceeding to grounding gate anyway');
        return 'grounding_gate';
    }

    /**
     * Build grounding context from current multi-agent state
     */
    private buildGroundingContext(state: MultiAgentState): GroundingContext {
        const lastMessage = state.messages[state.messages.length - 1];
        const query = lastMessage?.content?.toString() || '';
        
        // Extract retrieval signals from state metadata
        const retrievalData = state.metadata?.retrievalResult || { documents: [], sources: [], totalResults: 0 };
        const documents = retrievalData.documents || [];
        
        // Build sources array
        const sources = documents.map((doc: any) => ({
            sourceType: this.mapSourceType(doc.metadata?.source),
            sourceId: doc.metadata?._id || doc.metadata?.documentId || 'unknown',
            similarity: doc.metadata?.score || 0,
            timestamp: doc.metadata?.createdAt ? new Date(doc.metadata.createdAt).getTime() : undefined
        }));
        
        // Calculate similarities
        const similarities = sources.map((s: any) => s.similarity).filter((s: number) => s > 0);
        const maxSimilarity = similarities.length > 0 ? Math.max(...similarities) : 0;
        const meanSimilarity = similarities.length > 0 
            ? similarities.reduce((a: number, b: number) => a + b, 0) / similarities.length 
            : 0;
        
        // Determine query type
        const queryType = this.classifyQueryType(query);
        
        // Check if time-sensitive (from trending detector or query patterns)
        const timeSensitive = state.metadata?.trendingAnalysis?.queryType === 'realtime' || 
                             state.needsWebData || 
                             this.isTimeSensitiveQuery(query);
        
        // Cache information
        const cacheInfo = state.cacheHit ? {
            used: true,
            freshnessScore: this.calculateCacheFreshness(state),
            cacheType: state.metadata?.cacheType || 'semantic'
        } : undefined;
        
        // Intent signals (default to reasonable values if not present)
        const intentConfidence = state.metadata?.intentConfidence || 0.8;
        const intentAmbiguous = state.metadata?.intentAmbiguous || false;
        
        // Get context drift from cortexContextManager if available
        const contextDriftHigh = this.detectContextDrift(state);
        
        return {
            query,
            queryType,
            retrieval: {
                hitCount: documents.length,
                maxSimilarity,
                meanSimilarity,
                sources
            },
            cache: cacheInfo,
            intent: {
                confidence: intentConfidence,
                ambiguous: intentAmbiguous
            },
            agentType: this.mapAgentType(state.currentAgent),
            timeSensitive,
            userId: state.userId,
            conversationId: state.conversationId,
            documentIds: state.metadata?.documentIds,
            contextDriftHigh,
            clarificationAttempts: state.clarificationAttempts,
            searchAttempts: state.searchAttempts
        };
    }

    /**
     * Classify query type for grounding evaluation
     */
    private classifyQueryType(query: string): QueryType {
        const lowerQuery = query.toLowerCase();
        
        // Action indicators
        if (lowerQuery.match(/\b(create|delete|update|execute|run|deploy|start|stop|build|install|configure)\b/)) {
            return 'ACTION';
        }
        
        // Opinion indicators
        if (lowerQuery.match(/\b(think|feel|opinion|recommend|should|better|best|prefer|suggest)\b/)) {
            return 'OPINION';
        }
        
        // Factual indicators
        if (lowerQuery.match(/\b(what|when|where|who|how many|how much|define|explain)\b/)) {
            return 'FACTUAL';
        }
        
        return 'MIXED';
    }

    /**
     * Detect context drift from cortexContextManager
     */
    private detectContextDrift(state: MultiAgentState): boolean {
        // Check if cortexContextManager has detected high drift
        if (state.metadata?.contextDrift !== undefined) {
            return state.metadata.contextDrift > 0.7; // High drift threshold
        }
        
        // Alternative: Check if state explicitly set contextDriftHigh
        if (state.contextDriftHigh !== undefined) {
            return state.contextDriftHigh;
        }
        
        // Try to get from cortexContextManager service if available
        try {
            const cortexManager = CortexContextManagerService.getInstance();
            const stats = cortexManager.getContextStats(state.userId);
            // Check if there's a recent topic shift indicator in metadata
            if (stats && (stats as any).topicShiftDetected) {
                return true;
            }
        } catch (error) {
            // cortexContextManager not available or error, assume no drift
        }
        
        return false;
    }

    /**
     * Check if query is time-sensitive
     */
    private isTimeSensitiveQuery(query: string): boolean {
        const lowerQuery = query.toLowerCase();
        return lowerQuery.match(/\b(now|current|today|latest|recent|real-time|live|this week|this month)\b/) !== null;
    }

    /**
     * Calculate cache freshness score
     */
    private calculateCacheFreshness(state: MultiAgentState): number {
        // If cache has explicit timestamp, calculate age-based freshness
        const cacheTimestamp = state.semanticCacheResult?.timestamp;
        if (cacheTimestamp) {
            const ageMs = Date.now() - cacheTimestamp;
            const ageMinutes = ageMs / (60 * 1000);
            
            // Decay function: fresh for 5 minutes, then exponential decay
            if (ageMinutes < 5) return 1.0;
            if (ageMinutes < 15) return 0.8;
            if (ageMinutes < 60) return 0.5;
            return 0.2;
        }
        
        // Default: assume moderately fresh
        return 0.7;
    }

    /**
     * Map source type from metadata
     */
    private mapSourceType(source: string): 'doc' | 'memory' | 'web' | 'integration' {
        if (!source) return 'doc';
        const lowerSource = source.toLowerCase();
        if (lowerSource.includes('memory') || lowerSource.includes('conversation')) return 'memory';
        if (lowerSource.includes('web') || lowerSource.includes('scrape')) return 'web';
        if (lowerSource.includes('mongodb') || lowerSource.includes('aws') || lowerSource.includes('github') || 
            lowerSource.includes('vercel') || lowerSource.includes('google') || lowerSource.includes('slack')) return 'integration';
        return 'doc';
    }

    /**
     * Map current agent to AgentType
     */
    private mapAgentType(currentAgent: string): AgentType {
        if (!currentAgent) return 'MASTER';
        const lowerAgent = currentAgent.toLowerCase();
        if (lowerAgent.includes('optimizer')) return 'OPTIMIZER';
        if (lowerAgent.includes('quality')) return 'QA';
        if (lowerAgent.includes('memory')) return 'MEMORY';
        if (lowerAgent.includes('web')) return 'WEB_SCRAPER';
        return 'MASTER';
    }

    private routeFromMaster(state: MultiAgentState): string {
        // Check for failures first
        if ((state.failureCount || 0) >= 3) {
            return 'failure_recovery';
        }
        
        const lastPath = state.agentPath[state.agentPath.length - 1];
        
        // If master agent failed, go to recovery
        if (lastPath === 'master_agent_error') {
            return 'failure_recovery';
        }
        
        // Based on chat mode, decide next step
        switch (state.chatMode) {
            case 'cheapest':
                return 'cost_optimizer';
            case 'fastest':
                return '__end__'; // Skip optimization for speed
            case 'balanced':
            default:
                return 'cost_optimizer'; // Optimize then check quality
        }
    }

    // Helper methods
    private estimatePromptCost(prompt: string): number {
        // Simple cost estimation based on token count
        const tokenCount = prompt.split(/\s+/).length * 1.3; // Rough token estimation
        return tokenCount * 0.000008; // Approximate cost per token for Claude
    }

    private analyzeComplexity(prompt: string): 'low' | 'medium' | 'high' {
        const wordCount = prompt.split(/\s+/).length;
        const hasCodeBlocks = prompt.includes('```') || prompt.includes('code');
        const hasMultipleQuestions = (prompt.match(/\?/g) || []).length > 2;
        
        if (wordCount > 500 || hasCodeBlocks || hasMultipleQuestions) {
            return 'high';
        } else if (wordCount > 100) {
            return 'medium';
        }
        return 'low';
    }

    private refinePrompt(prompt: string): string {
        // Simple prompt refinement - remove redundancy, clarify intent
        return prompt
            .replace(/\s+/g, ' ') // Normalize whitespace
            .replace(/\b(please|kindly|could you)\b/gi, '') // Remove politeness tokens
            .replace(/\b(um|uh|well|you know)\b/gi, '') // Remove filler words
            .trim();
    }

    private generateCacheKey(content: string): string {
        // Generate a more sophisticated cache key using content hash
        const crypto = require('crypto');
        return crypto.createHash('sha256').update(content.toLowerCase().trim()).digest('hex').substring(0, 32);
    }

    private async getCachedResponse(message: string): Promise<{ response: string; cacheHit: boolean } | null> {
        try {
            const messageEmbedding = await this.generateEmbedding(message);
            const threshold = 0.85; // Similarity threshold
            
            // Check for semantic similarity with existing cache entries
            for (const [_cacheKey, cacheEntry] of this.semanticCache.entries()) {
                const similarity = this.calculateCosineSimilarity(messageEmbedding, cacheEntry.embedding);
                
                if (similarity > threshold) {
                    // Update cache statistics
                    cacheEntry.hits++;
                    cacheEntry.timestamp = Date.now();
                    
                    loggingService.info(`🎯 Semantic cache hit with similarity: ${similarity.toFixed(3)}`);
                    return {
                        response: cacheEntry.response,
                        cacheHit: true
                    };
                }
            }
            
            return null;
        } catch (error) {
            loggingService.error('❌ Semantic cache lookup failed:', { error: error instanceof Error ? error.message : String(error) });
            return null;
        }
    }

    private async storeInCache(message: string, response: string): Promise<void> {
        try {
            const cacheKey = this.generateCacheKey(message);
            const embedding = await this.generateEmbedding(message);
            
            // Clean up old cache entries (keep last 100)
            if (this.semanticCache.size > 100) {
                const oldestKey = Array.from(this.semanticCache.entries())
                    .sort(([,a], [,b]) => a.timestamp - b.timestamp)[0][0];
                this.semanticCache.delete(oldestKey);
            }
            
            this.semanticCache.set(cacheKey, {
                response,
                embedding,
                timestamp: Date.now(),
                hits: 0
            });
            
            loggingService.info(`💾 Stored response in semantic cache (${this.semanticCache.size} entries)`);
        } catch (error) {
            loggingService.error('❌ Failed to store in semantic cache:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    private async generateEmbedding(text: string): Promise<number[]> {
        // Simple embedding generation - in production, use proper embedding models
        // This is a placeholder that creates a simple hash-based embedding
        const words = text.toLowerCase().split(/\s+/);
        const embedding = new Array(384).fill(0); // 384-dimensional embedding
        
        words.forEach((word, index) => {
            const hash = this.simpleHash(word);
            const position = Math.abs(hash) % embedding.length;
            embedding[position] += 1 / (index + 1); // Weight by position
        });
        
        // Normalize the embedding
        const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
        return magnitude > 0 ? embedding.map(val => val / magnitude) : embedding;
    }

    private simpleHash(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash;
    }

    private calculateCosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) return 0;
        
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        
        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    private estimateTokens(text: string): number {
        // Use centralized token estimation utility
        return TokenEstimator.estimate(text);
    }

    private getStrategyPrompt(chatMode: 'fastest' | 'cheapest' | 'balanced'): string {
        switch (chatMode) {
            case 'fastest':
                return 'You are an AI assistant optimized for speed. Provide concise, direct answers without unnecessary elaboration.';
            case 'cheapest':
                return 'You are an AI assistant optimized for cost efficiency. Provide helpful but concise responses using minimal tokens.';
            case 'balanced':
            default:
                return 'You are an AI assistant that balances response quality with efficiency. Provide thorough but focused answers.';
        }
    }

    private extractQualityMetrics(response: string): { score: number; recommendations: string[] } {
        // Handle undefined or null response
        if (!response || typeof response !== 'string') {
            return {
                score: 7.0,
                recommendations: ['Response quality could not be assessed']
            };
        }

        try {
            // Try to extract JSON from response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    score: parsed.qualityScore || 7.5,
                    recommendations: parsed.recommendations || []
                };
            }
        } catch (error) {
            // Fallback to text parsing
        }
        
        // Fallback scoring
        const scoreMatch = response.match(/(?:score|rating):\s*(\d+(?:\.\d+)?)/i);
        return {
            score: scoreMatch ? parseFloat(scoreMatch[1]) : 7.5,
            recommendations: ['Improve response clarity', 'Add more specific examples']
        };
    }

    private assessRiskLevel(qualityScore: number, optimizations: string[]): string {
        if (qualityScore < 6 || optimizations.includes('failure_recovery')) {
            return 'high';
        } else if (qualityScore < 8 || optimizations.length > 2) {
            return 'medium';
        }
        return 'low';
    }

    private calculateTotalCost(state: MultiAgentState): number {
        let totalCost = state.promptCost || 0;
        
        // Add costs for each agent used
        state.agentPath.forEach(agent => {
            switch (agent) {
                case 'master_agent':
                    totalCost += 0.001; // Sonnet cost
                    break;
                case 'cost_optimizer':
                case 'failure_recovery':
                    totalCost += 0.0005; // Haiku cost
                    break;
                case 'quality_analyst':
                    totalCost += 0.001; // Sonnet cost
                    break;
                default:
                    totalCost += 0.0001; // Minimal processing cost
            }
        });
        
        return totalCost;
    }

    private generateThinkingSteps(result: MultiAgentState): any {
        return {
            title: "Multi-Agent Processing",
            steps: result.agentPath.map((agent, index) => ({
                step: index + 1,
                description: `Processed: ${agent}`,
                reasoning: `Executed ${agent} processing step`,
                outcome: index === result.agentPath.length - 1 ? "Completed" : "Proceeding"
            })),
            summary: `Processed through ${result.agentPath.length} agents.`
        };
    }

    // Enhanced predictive cost analytics with historical data analysis
    private costHistory: Array<{ timestamp: number; cost: number; chatMode: string; cacheHit: boolean; agentPath: string[] }> = [];

    public async getPredictiveCostAnalytics(userId: string): Promise<any> {
        try {
            // Get data from both local history and LangSmith
            const recentHistory = this.costHistory.slice(-100); // Last 100 interactions
            
            // Try to get additional data from LangSmith if configured
            let langSmithData: any[] = [];
            if (langSmithService.isConfigured() && process.env.LANGCHAIN_PROJECT) {
                const endTime = new Date();
                const startTime = new Date(endTime.getTime() - (30 * 24 * 60 * 60 * 1000)); // Last 30 days
                langSmithData = await langSmithService.getHistoricalCostData(
                    process.env.LANGCHAIN_PROJECT,
                    startTime,
                    endTime
                );
            }

            // Combine local and LangSmith data
            const combinedHistory = [...recentHistory];
            if (langSmithData.length > 0) {
                const langSmithEntries = langSmithData.map(entry => ({
                    timestamp: new Date(entry.timestamp).getTime(),
                    cost: entry.cost,
                    chatMode: entry.metadata?.chatMode || 'balanced',
                    cacheHit: entry.metadata?.cacheHit || false,
                    agentPath: entry.metadata?.agentPath || []
                }));
                combinedHistory.push(...langSmithEntries);
            }

            const totalCost = combinedHistory.reduce((sum, entry) => sum + entry.cost, 0);
            const avgCost = combinedHistory.length > 0 ? totalCost / combinedHistory.length : 0.01;
            
            // Calculate trends using combined history
            const recent30 = combinedHistory.slice(-30);
            const previous30 = combinedHistory.slice(-60, -30);
            const recentAvg = recent30.reduce((sum, entry) => sum + entry.cost, 0) / Math.max(recent30.length, 1);
            const previousAvg = previous30.reduce((sum, entry) => sum + entry.cost, 0) / Math.max(previous30.length, 1);
            
            let trend = 'stable';
            if (recentAvg > previousAvg * 1.1) trend = 'increasing';
            else if (recentAvg < previousAvg * 0.9) trend = 'decreasing';
            
            // Cache hit rate analysis
            const cacheHitRate = combinedHistory.filter(entry => entry.cacheHit).length / Math.max(combinedHistory.length, 1);
            
            // Generate recommendations based on patterns
            const recommendations = this.generateCostRecommendations(combinedHistory, cacheHitRate, trend);
            
            // Predict next week's cost based on historical patterns
            const dailyAvg = avgCost * this.estimateDailyInteractions(userId);
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
                    localInteractions: recentHistory.length,
                    langSmithInteractions: langSmithData.length,
                    averageCostPerInteraction: avgCost,
                    mostExpensiveMode: this.getMostExpensiveMode(combinedHistory),
                    costSavings: this.calculateCostSavings(combinedHistory),
                    forecast: this.generateCostForecast(combinedHistory)
                }
            };
        } catch (error) {
            loggingService.error('❌ Predictive cost analytics failed:', { error: error instanceof Error ? error.message : String(error) });
            return {
                predictedCost: 0.01,
                trend: 'unknown',
                riskLevel: 'low',
                recommendations: ['Enable analytics tracking for better predictions']
            };
        }
    }

    private generateCostRecommendations(history: any[], cacheHitRate: number, trend: string): string[] {
        const recommendations = [];
        
        if (cacheHitRate < 0.2) {
            recommendations.push('Consider enabling semantic caching to reduce costs');
        }
        
        if (trend === 'increasing') {
            recommendations.push('Review recent queries for optimization opportunities');
            recommendations.push('Consider using "cheapest" mode for non-critical queries');
        }
        
        const fastestModeUsage = history.filter(h => h.chatMode === 'fastest').length / history.length;
        if (fastestModeUsage > 0.5) {
            recommendations.push('High "fastest" mode usage detected - consider balanced mode for cost savings');
        }
        
        const complexQueries = history.filter(h => h.agentPath.length > 3).length;
        if (complexQueries > history.length * 0.3) {
            recommendations.push('Many complex queries detected - consider prompt optimization');
        }
        
        if (recommendations.length === 0) {
            recommendations.push('Cost patterns look optimal - continue current usage');
        }
        
        return recommendations;
    }

    private estimateDailyInteractions(_userId: string): number {
        // Simple estimation based on historical patterns
        // In production, this would analyze actual user patterns
        const recentDays = this.costHistory.slice(-50);
        return Math.max(recentDays.length / 7, 5); // Minimum 5 interactions per day
    }

    private assessCostRisk(trend: string, avgCost: number, cacheHitRate: number): string {
        if (trend === 'increasing' && avgCost > 0.1 && cacheHitRate < 0.1) return 'high';
        if (trend === 'increasing' || avgCost > 0.05) return 'medium';
        return 'low';
    }

    private getMostExpensiveMode(history: any[]): string {
        const modeCosts = history.reduce((acc, entry) => {
            acc[entry.chatMode] = (acc[entry.chatMode] || 0) + entry.cost;
            return acc;
        }, {});
        
        return Object.entries(modeCosts).sort(([,a], [,b]) => (b as number) - (a as number))[0]?.[0] || 'unknown';
    }

    private calculateCostSavings(history: any[]): number {
        const cacheHits = history.filter(h => h.cacheHit);
        const avgNonCacheCost = history.filter(h => !h.cacheHit).reduce((sum, h) => sum + h.cost, 0) / Math.max(history.filter(h => !h.cacheHit).length, 1);
        return cacheHits.length * avgNonCacheCost * 0.8; // Assume 80% cost savings from cache
    }

    private generateCostForecast(history: any[]): any[] {
        const last7Days = history.slice(-7).map((_, index) => ({
            day: index + 1,
            cost: history.slice(-(7-index), history.length - (6-index)).reduce((sum, h) => sum + h.cost, 0),
            interactions: history.slice(-(7-index), history.length - (6-index)).length
        }));
        
        return last7Days;
    }

    // Method to record cost history for analytics
    public recordCostEvent(cost: number, chatMode: string, cacheHit: boolean, agentPath: string[]): void {
        this.costHistory.push({
            timestamp: Date.now(),
            cost,
            chatMode,
            cacheHit,
            agentPath
        });
        
        // Keep only last 1000 entries to prevent memory issues
        if (this.costHistory.length > 1000) {
            this.costHistory = this.costHistory.slice(-1000);
        }
    }

    /**
     * Memory Reader Node - Retrieves user memory and personalizes the experience
     */
    private async memoryReaderNode(state: MultiAgentState): Promise<Partial<MultiAgentState>> {
        try {
            loggingService.info(`🧠 Memory Reader processing for user: ${state.userId}`);

            // Create memory state for consolidated memory service
            const memoryState = {
                userId: state.userId,
                conversationId: state.conversationId,
                query: state.messages[state.messages.length - 1]?.content?.toString() || '',
                metadata: state.metadata
            };

            // Process memory reading using consolidated memoryService
            const memoryResult = await memoryService.processMemoryRead(memoryState);

            // Get personalized model recommendation
            const recommendedModel = await userPreferenceService.getRecommendedModel(
                state.userId, 
                memoryState.query
            );

            // Get personalized chat mode
            const recommendedChatMode = await userPreferenceService.getRecommendedChatMode(state.userId);

            // Update state with memory context
            const updatedMemoryContext = {
                ...memoryState,
                ...memoryResult
            };

            loggingService.info(`✅ Memory Reader completed for user: ${state.userId}`);

            return {
                memoryContext: updatedMemoryContext,
                personalizedRecommendations: memoryResult.personalizedRecommendations || [],
                userPreferences: memoryResult.userPreferences,
                chatMode: recommendedChatMode, // Override chat mode with user preference
                agentPath: [...state.agentPath, 'memory_reader'],
                metadata: {
                    ...state.metadata,
                    memoryProcessed: true,
                    recommendedModel,
                    hasMemoryContext: (memoryResult.memoryInsights?.length || 0) > 0,
                    hasSimilarConversations: (memoryResult.similarConversations?.length || 0) > 0,
                    securityFlags: memoryResult.securityFlags || []
                }
            };
        } catch (error) {
            loggingService.error('❌ Memory Reader failed:', { error: error instanceof Error ? error.message : String(error) });
            return {
                memoryContext: null,
                personalizedRecommendations: [],
                agentPath: [...state.agentPath, 'memory_reader_error'],
                metadata: {
                    ...state.metadata,
                    memoryError: error instanceof Error ? error.message : 'Memory processing failed'
                }
            };
        }
    }

    /**
     * Memory Writer Node - Stores conversation memory and learns from interactions
     */
    private async memoryWriterNode(state: MultiAgentState): Promise<Partial<MultiAgentState>> {
        try {
            loggingService.info(`💾 Memory Writer processing for user: ${state.userId}`);

            // 🔒 CRITICAL: Check if memory writes are prohibited by GCL
            if (state.prohibitMemoryWrite) {
                loggingService.warn('🚫 Memory write blocked by Grounding Confidence Layer', {
                    userId: state.userId,
                    conversationId: state.conversationId,
                    groundingDecision: state.groundingDecision?.decision,
                    groundingScore: state.groundingDecision?.groundingScore
                });
                return state; // Skip memory write
            }

            // Get the final response from messages
            const finalMessage = state.messages[state.messages.length - 1];
            const response = finalMessage?.content?.toString() || '';

            // Skip memory storage if response is empty or invalid
            if (!response || response.trim().length === 0) {
                loggingService.warn('💾 Skipping memory storage - empty response', {
                    userId: state.userId,
                    conversationId: state.conversationId,
                    responseLength: response.length
                });
                return state;
            }

            // Check for ambiguous subject context
            const conversationContext = await MemoryService.getConversationContext(state.conversationId);
            if (conversationContext && conversationContext.subjectConfidence < 0.6) {
                loggingService.warn('💾 Skipping memory storage - ambiguous subject', {
                    userId: state.userId,
                    conversationId: state.conversationId,
                    subjectConfidence: conversationContext.subjectConfidence,
                    currentSubject: conversationContext.currentSubject
                });
                return state;
            }

            // Create memory context for storage
            const memoryContext: MemoryContext = {
                userId: state.userId,
                conversationId: state.conversationId,
                query: state.messages[0]?.content?.toString() || '', // Original query
                response: response,
                metadata: {
                    ...state.metadata,
                    agentPath: state.agentPath,
                    chatMode: state.chatMode,
                    costBudget: state.costBudget,
                    optimizationsApplied: state.optimizationsApplied,
                    cacheHit: state.cacheHit,
                    riskLevel: state.riskLevel,
                    modelUsed: state.metadata?.recommendedModel || 'amazon.nova-pro-v1:0',
                    responseTime: Date.now() - (state.metadata?.startTime || Date.now()),
                    timestamp: new Date()
                }
            };

            // Store conversation memory
            await memoryService.storeConversationMemory(memoryContext);

            // Create memory state for consolidated memory service
            const memoryAgentState = {
                userId: state.userId,
                conversationId: state.conversationId,
                query: memoryContext.query,
                response: memoryContext.response,
                metadata: memoryContext.metadata,
                securityFlags: state.metadata?.securityFlags || []
            };

            // Process memory writing (learning and storage) using consolidated memoryService
            const memoryWriteResult = await memoryService.processMemoryWrite(memoryAgentState);

            // Learn from the interaction
            await userPreferenceService.learnFromInteraction(state.userId, {
                query: memoryContext.query,
                modelUsed: memoryContext.metadata.modelUsed,
                chatMode: state.chatMode,
                responseTime: memoryContext.metadata.responseTime,
                cost: state.metadata?.totalCost || 0
            });

            loggingService.info(`✅ Memory Writer completed for user: ${state.userId}`);

            return {
                agentPath: [...state.agentPath, 'memory_writer'],
                metadata: {
                    ...state.metadata,
                    memoryStored: true,
                    memoryOperations: memoryWriteResult.memoryOperations || [],
                    learningCompleted: true
                },
                mongodbIntegrationData: state.mongodbIntegrationData,
                formattedResult: state.formattedResult
            };
        } catch (error) {
            loggingService.error('❌ Memory Writer failed:', { error: error instanceof Error ? error.message : String(error) });
            return {
                agentPath: [...state.agentPath, 'memory_writer_error'],
                metadata: {
                    ...state.metadata,
                    memoryWriteError: error instanceof Error ? error.message : 'Memory storage failed'
                },
                mongodbIntegrationData: state.mongodbIntegrationData,
                formattedResult: state.formattedResult
            };
        }
    }

    /**
     * Cleanup resources when service is destroyed
     */
    async cleanup(): Promise<void> {
        try {
        
            // Reset EventEmitter max listeners to default
            EventEmitter.defaultMaxListeners = 10;
            
            loggingService.info('🧹 Multi-agent flow service cleanup completed');
        } catch (error) {
            loggingService.error('❌ Cleanup failed:', { error: error instanceof Error ? error.message : String(error) });
        }
    }
}

export const multiAgentFlowService = new MultiAgentFlowService();