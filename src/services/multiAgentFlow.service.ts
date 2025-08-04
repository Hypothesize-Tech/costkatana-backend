import { logger } from '../utils/logger';
import { ChatBedrockConverse } from "@langchain/aws";
import { StateGraph, Annotation } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { langSmithService } from './langsmith.service';
import { RetryWithBackoff, RetryConfigs } from '../utils/retryWithBackoff';
import { WebScraperTool } from '../tools/webScraper.tool';
import { LifeUtilityTool } from '../tools/lifeUtility.tool';
import { TrendingDetectorService } from './trendingDetector.service';

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
});

type MultiAgentState = typeof MultiAgentStateAnnotation.State;

export class MultiAgentFlowService {
    private masterAgent!: ChatBedrockConverse;
    private costOptimizerAgent!: ChatBedrockConverse;
    private qualityAnalystAgent!: ChatBedrockConverse;
    private webScrapingAgent!: ChatBedrockConverse;
    private graph: any;
    private retryExecutor: <T>(fn: () => Promise<T>) => Promise<any>;
    private webScraperTool: WebScraperTool;
    private lifeUtilityTool: LifeUtilityTool;
    private trendingDetector: TrendingDetectorService;

    constructor() {
        this.initializeAgents();
        this.initializeGraph();
        
        // Initialize web scraping components
        this.webScraperTool = new WebScraperTool();
        this.lifeUtilityTool = new LifeUtilityTool();
        this.trendingDetector = new TrendingDetectorService();
        
        // Initialize retry mechanism for multi-agent operations
        this.retryExecutor = RetryWithBackoff.createBedrockRetry({
            ...RetryConfigs.bedrock,
            maxRetries: 3, // Slightly fewer retries for multi-agent to avoid long delays
            onRetry: (error: Error, attempt: number) => {
                logger.warn(`🔄 Multi-agent retry attempt ${attempt}: ${error.message}`);
            }
        });
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
            .addNode("life_utility", this.lifeUtilityNode.bind(this))
            .addNode("web_scraper", this.webScrapingNode.bind(this))
            .addNode("content_summarizer", this.contentSummarizerNode.bind(this))
            .addNode("master_agent", this.masterAgentNode.bind(this))
            .addNode("cost_optimizer", this.costOptimizerNode.bind(this))
            .addNode("quality_analyst", this.qualityAnalystNode.bind(this))
            .addNode("semantic_cache", this.semanticCacheNode.bind(this))
            .addNode("failure_recovery", this.failureRecoveryNode.bind(this))
            .addEdge("__start__", "prompt_analyzer")
            .addConditionalEdges("prompt_analyzer", this.routeAfterPromptAnalysis.bind(this), ["trending_detector", "semantic_cache", "master_agent"])
            .addConditionalEdges("trending_detector", this.routeAfterTrendingDetection.bind(this), ["life_utility", "web_scraper", "semantic_cache", "master_agent"])
            .addConditionalEdges("web_scraper", this.routeAfterWebScraping.bind(this), ["content_summarizer", "master_agent"])
            .addConditionalEdges("content_summarizer", this.routeAfterContentSummarization.bind(this), ["master_agent", "__end__"])
            .addConditionalEdges("semantic_cache", this.routeAfterCache.bind(this), ["master_agent", "__end__"])
            .addConditionalEdges("master_agent", this.routeFromMaster.bind(this), ["cost_optimizer", "quality_analyst", "failure_recovery", "__end__"])
            .addEdge("life_utility", "__end__")
            .addEdge("cost_optimizer", "quality_analyst")
            .addEdge("quality_analyst", "__end__")
            .addEdge("failure_recovery", "__end__");

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
        } = {}
    ): Promise<{
        response: string;
        cost: number;
        agentPath: string[];
        optimizationsApplied: string[];
        cacheHit: boolean;
        riskLevel: string;
        thinking?: any;
        metadata: Record<string, any>;
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
            const initialState: Partial<MultiAgentState> = {
                messages: [new HumanMessage(message)],
                userId,
                conversationId,
                chatMode: options.chatMode || 'balanced',
                costBudget: options.costBudget || 0.10,
                metadata: { 
                    startTime: Date.now(),
                    langSmithRunId: runId
                }
            };

            if (options.previousMessages && options.previousMessages.length > 0) {
                initialState.messages = [...options.previousMessages, new HumanMessage(message)];
            }

            const result = await this.graph.invoke(initialState);
            
            // Debug logging to understand the entire result structure
            logger.info('🔍 Multi-agent result structure:', {
                messagesCount: result.messages?.length || 0,
                agentPath: result.agentPath,
                hasMessages: !!result.messages,
                lastMessageIndex: result.messages ? result.messages.length - 1 : -1
            });
            
            const finalMessage = result.messages[result.messages.length - 1];
            
            // Debug logging to understand the final message structure
            logger.info('🔍 Multi-agent final message structure:', {
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
                logger.info('🔄 Detected retry wrapper, extracting actual result');
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

            return {
                response,
                cost,
                agentPath,
                optimizationsApplied: result.optimizationsApplied || [],
                cacheHit,
                riskLevel: result.riskLevel || 'low',
                thinking: this.generateThinkingSteps(result),
                metadata: result.metadata || {}
            };

        } catch (error) {
            logger.error('❌ Multi-agent flow processing failed:', error);
            
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
            
            logger.info(`💰 Prompt cost estimate: $${promptCost.toFixed(6)}, Complexity: ${complexity}`);

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
                    agentPath: ['prompt_refined']
                };
            }

            return {
                promptCost,
                agentPath: ['prompt_acceptable']
            };
        } catch (error) {
            logger.error('❌ Prompt analysis failed:', error);
            return { agentPath: ['prompt_analysis_error'], failureCount: 1 };
        }
    }

    private async semanticCacheNode(state: MultiAgentState): Promise<Partial<MultiAgentState>> {
        try {
            const lastMessage = state.messages[state.messages.length - 1];
            if (!lastMessage || typeof lastMessage.content !== 'string') {
                return { agentPath: ['cache_miss'] };
            }

            // Enhanced semantic similarity check
            const cacheResult = await this.getCachedResponse(lastMessage.content);
            
            if (cacheResult && cacheResult.cacheHit) {
                logger.info('🎯 Semantic cache hit! Returning cached response');
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
                agentPath: [...(state.agentPath || []), 'cache_miss']
            };
        } catch (error) {
            logger.error('❌ Semantic cache failed:', error);
            return { agentPath: [...(state.agentPath || []), 'cache_error'], failureCount: (state.failureCount || 0) + 1 };
        }
    }

    private async masterAgentNode(state: MultiAgentState): Promise<Partial<MultiAgentState>> {
        try {
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
                        fallbackUsed: true
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
                    processingTime: Date.now() - (state.metadata?.startTime || Date.now())
                }
            };
        } catch (error) {
            logger.error('❌ Master agent failed:', error);
            return { 
                agentPath: [...(state.agentPath || []), 'master_agent_error'],
                failureCount: (state.failureCount || 0) + 1
            };
        }
    }

    private async costOptimizerNode(_state: MultiAgentState): Promise<Partial<MultiAgentState>> {
        // Cost optimization is handled in metadata, no new message needed
        return {
            currentAgent: 'cost_optimizer',
            agentPath: ['cost_optimizer']
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
                riskLevel: this.assessRiskLevel(qualityMetrics.score, state.optimizationsApplied)
            };
        } catch (error) {
            logger.error('❌ Quality analyst failed:', error);
            return { 
                agentPath: ['quality_analyst_error'],
                failureCount: (state.failureCount || 0) + 1
            };
        }
    }

    private async failureRecoveryNode(state: MultiAgentState): Promise<Partial<MultiAgentState>> {
        try {
            logger.warn(`🔄 Failure recovery activated. Failure count: ${state.failureCount}`);
            
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
            logger.error('❌ Failure recovery failed:', error);
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

            logger.info('🔍 Analyzing query for real-time data needs...');
            
            const trendingAnalysis = await this.trendingDetector.analyzeQuery(lastMessage.content);
            
            logger.info(`🎯 Trending analysis result:`, {
                needsWebData: trendingAnalysis.needsRealTimeData,
                confidence: trendingAnalysis.confidence,
                queryType: trendingAnalysis.queryType,
                sourcesCount: trendingAnalysis.suggestedSources.length
            });

            return {
                needsWebData: trendingAnalysis.needsRealTimeData,
                webSources: trendingAnalysis.suggestedSources,
                agentPath: [`trending_detected_${trendingAnalysis.queryType}`],
                metadata: {
                    ...(state.metadata || {}),
                    trendingAnalysis: {
                        confidence: trendingAnalysis.confidence,
                        queryType: trendingAnalysis.queryType,
                        extractionStrategy: trendingAnalysis.extractionStrategy,
                        cacheStrategy: trendingAnalysis.cacheStrategy
                    }
                }
            };

        } catch (error) {
            logger.error('❌ Trending detection failed:', error);
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
                logger.warn('No web sources provided for scraping');
                return { agentPath: ['web_scraping_no_sources'] };
            }

            logger.info(`🕷️ Starting web scraping from ${sources.length} sources...`);
            
            const scrapingResults = [];
            const maxSources = Math.min(sources.length, 3); // Limit to 3 sources for performance

            for (let i = 0; i < maxSources; i++) {
                const source = sources[i];
                
                try {
                    logger.info(`📄 Scraping: ${source}`);
                    
                    // Get scraping template for known sites
                    const template = this.trendingDetector.getScrapingTemplate(source);
                    
                    const scrapingRequest = {
                        operation: 'scrape' as const,
                        url: source,
                        selectors: template?.selectors || trendingAnalysis?.extractionStrategy?.selectors || {
                            title: 'h1, .title, .headline',
                            content: '.content, article, .post',
                            links: 'a[href]'
                        },
                        options: {
                            timeout: 15000, // 15 second timeout per site
                            javascript: template?.options?.javascript ?? trendingAnalysis?.extractionStrategy?.javascript ?? false,
                            waitFor: template?.options?.waitFor || trendingAnalysis?.extractionStrategy?.waitFor,
                            extractText: true
                        },
                        cache: {
                            enabled: true,
                            ttl: trendingAnalysis?.cacheStrategy?.ttl || 1800, // 30 minutes default
                            key: `scrape_${Buffer.from(source).toString('base64')}`
                        }
                    };

                    const result = await this.webScraperTool._call(JSON.stringify(scrapingRequest));
                    const parsedResult = JSON.parse(result);
                    
                    if (parsedResult.success) {
                        scrapingResults.push(parsedResult);
                        logger.info(`✅ Successfully scraped: ${source}`);
                        logger.info(`📄 Extracted content length: ${parsedResult.data?.extractedText?.length || 0} chars`);
                        logger.info(`📄 Title: ${parsedResult.data?.title || 'No title'}`);
                        logger.info(`📄 Content preview: ${(parsedResult.data?.extractedText || '').substring(0, 200)}...`);
                    } else {
                        logger.warn(`❌ Failed to scrape: ${source} - ${parsedResult.error}`);
                    }

                } catch (error) {
                    logger.error(`❌ Error scraping ${source}:`, error);
                }
            }

            if (scrapingResults.length === 0) {
                logger.warn('❌ All web scraping failed, providing fallback response');
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

            logger.info(`🎉 Successfully scraped ${scrapingResults.length} sources`);

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
            logger.error('❌ Web scraping failed:', error);
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

            logger.info(`📝 Summarizing content from ${scrapingResults.length} sources...`);

            // Combine all scraped content
            const combinedContent = scrapingResults
                .map(result => ({
                    source: result.data?.url || 'unknown',
                    title: result.data?.title || '',
                    content: result.data?.extractedText || '',
                    summary: result.data?.summary || ''
                }))
                .filter(item => item.content.length > 0);

            logger.info(`📝 Combined content details:`, {
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
            const summaryPrompt = `You are a helpful assistant. Analyze the following web content and provide a direct, concise answer to the user's query.

User Query: ${state.messages[state.messages.length - 1]?.content}

Scraped Content:
${combinedContent.map((item, index) => `
Source ${index + 1}: ${item.source}
Content: ${item.content.substring(0, 2000)}...
`).join('\n---\n')}

Provide a direct, simple answer that directly addresses the user's question. Focus on the most relevant information only. Keep it concise and to the point.`;

            const summaryResponse = await this.retryExecutor(async () => {
                return await this.webScrapingAgent.invoke([
                    new HumanMessage(summaryPrompt)
                ]);
            });

            // Debug logging to see what the AI model returned
            logger.info('🔍 Summary response structure:', {
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
                logger.info('🔄 Detected retry wrapper in summary response, extracting actual result');
                actualResponse = summaryResponse.result;
            }
            
            const comprehensiveSummary = actualResponse?.content?.toString() || 'Unable to generate summary from web content.';

            logger.info('✅ Content summarization completed');

            // Create the summary message
            const summaryMessage = new AIMessage(`${comprehensiveSummary}

Sources: ${combinedContent.map((item, index) => `${index + 1}. ${item.source}`).join(', ')}`);

            logger.info('✅ Content summarization completed - adding summary message to state');

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
            logger.error('❌ Content summarization failed:', error);
            return { 
                agentPath: ['content_summarizer_error'], 
                failureCount: 1 
            };
        }
    }

    private async lifeUtilityNode(state: MultiAgentState): Promise<Partial<MultiAgentState>> {
        try {
            const lastMessage = state.messages[state.messages.length - 1];
            const query = lastMessage?.content?.toString() || '';
            const queryType = state.metadata?.trendingAnalysis?.queryType;
            
            logger.info(`🎯 Processing Life Utility query: ${queryType}`);
            
            let lifeUtilityRequest: any = {};
            
            // Determine the operation based on query type
            switch (queryType) {
                case 'health':
                    lifeUtilityRequest = {
                        operation: 'health_guidance',
                        data: {
                            symptoms: this.extractSymptoms(query),
                            severity: 'moderate',
                            duration: 'recent'
                        }
                    };
                    break;
                
                case 'travel':
                    lifeUtilityRequest = {
                        operation: 'travel_plan',
                        data: {
                            from: this.extractLocation(query, 'from') || 'Mumbai',
                            to: this.extractLocation(query, 'to') || 'Delhi',
                            date: this.extractDate(query) || new Date().toISOString().split('T')[0],
                            budget: 15000
                        }
                    };
                    break;
                
                case 'shopping':
                    lifeUtilityRequest = {
                        operation: 'price_track',
                        data: {
                            product: this.extractProduct(query),
                            userId: state.userId,
                            notificationMethod: 'email'
                        }
                    };
                    break;
                
                case 'reverse_search':
                    lifeUtilityRequest = {
                        operation: 'reverse_search',
                        data: {
                            description: query,
                            category: 'electronics'
                        }
                    };
                    break;
                
                case 'weather':
                default:
                    lifeUtilityRequest = {
                        operation: 'weather_advice',
                        data: {
                            location: this.extractLocation(query) || 'bangalore',
                            query: query,
                            userProfile: {
                                preferences: ['comfortable', 'casual']
                            }
                        }
                    };
                    break;
            }
            
            const result = await this.lifeUtilityTool._call(JSON.stringify(lifeUtilityRequest));
            const parsedResult = JSON.parse(result);
            
            if (parsedResult.success) {
                const responseMessage = new AIMessage(parsedResult.result);
                return {
                    messages: [responseMessage],
                    agentPath: [`life_utility_${queryType}`],
                    currentAgent: 'life_utility',
                    metadata: {
                        ...state.metadata,
                        lifeUtilityResult: parsedResult
                    }
                };
            } else {
                logger.warn('❌ Life Utility operation failed:', parsedResult.error);
                return {
                    agentPath: ['life_utility_failed'],
                    failureCount: 1
                };
            }
            
        } catch (error) {
            logger.error('❌ Life Utility node failed:', error);
            return {
                agentPath: ['life_utility_error'],
                failureCount: 1
            };
        }
    }

    // Helper methods for Life Utility
    private extractSymptoms(query: string): string[] {
        const symptoms = [];
        const commonSymptoms = ['headache', 'fever', 'cough', 'pain', 'nausea', 'fatigue', 'cold', 'flu'];
        for (const symptom of commonSymptoms) {
            if (query.toLowerCase().includes(symptom)) {
                symptoms.push(symptom);
            }
        }
        return symptoms.length > 0 ? symptoms : ['general discomfort'];
    }

    private extractLocation(query: string, type?: 'from' | 'to'): string | null {
        const cities = ['mumbai', 'delhi', 'bangalore', 'bengaluru', 'chennai', 'kolkata', 'hyderabad', 'pune', 'ahmedabad', 'goa'];
        const queryLower = query.toLowerCase();
        
        if (type === 'from') {
            const fromMatch = queryLower.match(/from\s+(\w+)/);
            if (fromMatch) return fromMatch[1];
        }
        
        if (type === 'to') {
            const toMatch = queryLower.match(/to\s+(\w+)/);
            if (toMatch) return toMatch[1];
        }
        
        for (const city of cities) {
            if (queryLower.includes(city)) {
                return city;
            }
        }
        return null;
    }

    private extractDate(query: string): string | null {
        const dateMatch = query.match(/(\d{4}-\d{2}-\d{2})|(\d{1,2}\/\d{1,2}\/\d{4})|(\d{1,2}-\d{1,2}-\d{4})/);
        if (dateMatch) return dateMatch[0];
        
        if (query.includes('today')) return new Date().toISOString().split('T')[0];
        if (query.includes('tomorrow')) {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            return tomorrow.toISOString().split('T')[0];
        }
        
        return null;
    }

    private extractProduct(query: string): string {
        const products = ['iphone', 'macbook', 'samsung', 'oneplus', 'laptop', 'phone', 'headphones', 'watch'];
        const queryLower = query.toLowerCase();
        
        for (const product of products) {
            if (queryLower.includes(product)) {
                return product;
            }
        }
        
        // Extract product from common patterns
        const priceMatch = queryLower.match(/price\s+of\s+(.+?)(?:\s|$)/);
        if (priceMatch) return priceMatch[1];
        
        const trackMatch = queryLower.match(/track\s+(.+?)\s+price/);
        if (trackMatch) return trackMatch[1];
        
        return query.replace(/price|cost|track|of|the/gi, '').trim();
    }

    // Routing functions
    private routeAfterPromptAnalysis(state: MultiAgentState): string {
        const lastPath = state.agentPath[state.agentPath.length - 1];
        
        if (lastPath === 'prompt_analysis_error') {
            return 'master_agent'; // Skip everything on error
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
        const queryType = state.metadata?.trendingAnalysis?.queryType;
        
        // Route life utility queries directly to Life Utility Agent
        if (['health', 'travel', 'shopping', 'reverse_search'].includes(queryType) || 
            (queryType === 'weather' && state.messages[state.messages.length - 1]?.content?.toString().includes('wear'))) {
            logger.info(`🎯 Routing to Life Utility Agent for ${queryType} query`);
            return 'life_utility';
        }
        
        if (state.needsWebData && state.webSources && state.webSources.length > 0) {
            return 'web_scraper'; // Proceed with web scraping
        }
        
        // No web scraping needed, check cache or go to master agent
        return 'semantic_cache';
    }

    private routeAfterWebScraping(state: MultiAgentState): string {
        const lastPath = state.agentPath[state.agentPath.length - 1];
        
        if (lastPath === 'web_scraping_error' || lastPath === 'web_scraping_failed') {
            return 'master_agent'; // Proceed without web data
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
        
        return 'master_agent'; // Cache miss, proceed to master agent
    }

    private routeAfterContentSummarization(state: MultiAgentState): string {
        // If we have web scraping results, end here
        if (state.metadata?.contentSummary?.sourcesUsed > 0) {
            logger.info('✅ Web scraping completed successfully, ending flow');
            return '__end__';
        }
        
        // If no web scraping was done, go to master agent
        return 'master_agent';
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
            .trim()
            .substring(0, Math.min(prompt.length, 1000)); // Limit length
    }

    private semanticCache: Map<string, { response: string; embedding: number[]; timestamp: number; hits: number }> = new Map();

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
                    
                    logger.info(`🎯 Semantic cache hit with similarity: ${similarity.toFixed(3)}`);
                    return {
                        response: cacheEntry.response,
                        cacheHit: true
                    };
                }
            }
            
            return null;
        } catch (error) {
            logger.error('❌ Semantic cache lookup failed:', error);
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
            
            logger.info(`💾 Stored response in semantic cache (${this.semanticCache.size} entries)`);
        } catch (error) {
            logger.error('❌ Failed to store in semantic cache:', error);
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
        // Simple token estimation - roughly 4 characters per token
        return Math.ceil(text.length / 4);
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
            logger.error('❌ Predictive cost analytics failed:', error);
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
     * Cleanup resources when service is destroyed
     */
    async cleanup(): Promise<void> {
        try {
            await this.webScraperTool.cleanup();
            logger.info('🧹 Multi-agent flow service cleanup completed');
        } catch (error) {
            logger.error('❌ Cleanup failed:', error);
        }
    }
}

export const multiAgentFlowService = new MultiAgentFlowService();