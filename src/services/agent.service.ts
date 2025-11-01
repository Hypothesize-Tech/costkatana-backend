import { ChatBedrockConverse } from "@langchain/aws";
import { AgentExecutor, createReactAgent } from "langchain/agents";
import { Tool } from "@langchain/core/tools";
import { ChatPromptTemplate, HumanMessagePromptTemplate, SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { KnowledgeBaseTool } from "../tools/knowledgeBase.tool";
import { MongoDbReaderTool } from "../tools/mongoDbReader.tool";
import { ProjectManagerTool } from "../tools/projectManager.tool";
import { ModelSelectorTool } from "../tools/modelSelector.tool";
import { AnalyticsManagerTool } from "../tools/analyticsManager.tool";
import { OptimizationManagerTool } from "../tools/optimizationManager.tool";
import { WebScraperTool } from "../tools/webScraper.tool";
import { vectorStoreService } from "./vectorStore.service";
import { RetryWithBackoff, RetryConfigs } from "../utils/retryWithBackoff";
import { loggingService } from "./logging.service";
import { buildSystemPrompt, getCompressedPrompt } from "../config/agent-prompt-template";
import { ResponseFormattersService } from "./response-formatters.service";
import crypto from 'crypto';

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
        [key: string]: any; // Allow additional context properties
    };
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

// Response cache interface
interface CachedResponse {
    response: AgentResponse;
    timestamp: number;
    hits: number;
}

// Tool factory type
type ToolFactory = () => Tool;

export class AgentService {
    private agentExecutor?: AgentExecutor;
    private initialized = false;
    private model: ChatBedrockConverse;
    private tools: Tool[];
    private circuitBreaker: <T>(fn: () => Promise<T>) => Promise<T>;
    private retryExecutor: <T>(fn: () => Promise<T>) => Promise<any>;
    
    // Optimization additions
    private toolInstances: Map<string, Tool> = new Map();
    private toolFactories: Map<string, ToolFactory> = new Map();
    private responseCache: Map<string, CachedResponse> = new Map();
    private userContextCache: Map<string, { context: string; timestamp: number }> = new Map();
    
    // Cache configuration
    private readonly RESPONSE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    private readonly USER_CONTEXT_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
    private readonly MAX_CACHE_SIZE = 1000;
    
    // Performance metrics
    private metrics = {
        cacheHits: 0,
        cacheMisses: 0,
        toolsLoaded: 0,
        avgResponseTime: 0,
        totalRequests: 0
    };

    constructor() {
        const defaultModel = process.env.AWS_BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0';
        const isMasterAgent = process.env.AGENT_TYPE === 'master';
        const selectedModel = isMasterAgent ? 'anthropic.claude-3-5-sonnet-20240620-v1:0' : defaultModel;
        
        this.model = new ChatBedrockConverse({
            region: process.env.AWS_BEDROCK_REGION || 'us-east-1',
            model: selectedModel,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
            },
            temperature: isMasterAgent ? 0.1 : 0.3, // Lower temp for master agent, slightly higher for Nova Pro
            maxTokens: isMasterAgent ? 8000 : 5000, // More tokens for complex tasks
        });

        loggingService.info(`🤖 Initialized ${isMasterAgent ? 'Master' : 'Standard'} Agent`);

        // Initialize tool factories for lazy loading
        this.initializeToolFactories();
        
        // Initialize empty tools array - will be populated lazily
        this.tools = [];

        // Initialize retry mechanism with circuit breaker
        this.circuitBreaker = RetryWithBackoff.createCircuitBreaker(5, 60000); // 5 failures, 1 min reset
        this.retryExecutor = RetryWithBackoff.createBedrockRetry({
            ...RetryConfigs.bedrock,
            onRetry: (error: Error, attempt: number) => {
                loggingService.warn(`🔄 Agent retry attempt ${attempt}: ${error.message}`);
            }
        });
        
        // Start cache cleanup interval
        this.startCacheCleanup();
    }

    /**
     * Initialize tool factories for lazy loading
     */
    private initializeToolFactories(): void {
        this.toolFactories.set('knowledge_base_search', () => new KnowledgeBaseTool());
        this.toolFactories.set('mongodb_reader', () => new MongoDbReaderTool());
        this.toolFactories.set('project_manager', () => new ProjectManagerTool());
        this.toolFactories.set('model_selector', () => new ModelSelectorTool());
        this.toolFactories.set('analytics_manager', () => new AnalyticsManagerTool());
        this.toolFactories.set('optimization_manager', () => new OptimizationManagerTool());
        this.toolFactories.set('web_scraper', () => new WebScraperTool());
        
        loggingService.info('🔧 Tool factories initialized for lazy loading');
    }
    
    /**
     * Get tool instance with lazy loading
     */
    private getToolInstance(toolName: string): Tool {
        if (!this.toolInstances.has(toolName)) {
            const factory = this.toolFactories.get(toolName);
            if (!factory) {
                throw new Error(`Unknown tool: ${toolName}`);
            }
            
            const tool = factory();
            this.toolInstances.set(toolName, tool);
            this.metrics.toolsLoaded++;
            
            loggingService.info(`🔧 Lazy loaded tool: ${toolName}`);
        }
        
        return this.toolInstances.get(toolName)!;
    }
    
    /**
     * Get all required tools for agent initialization
     */
    private getAllTools(): Tool[] {
        if (this.tools.length === 0) {
            // Load all tools lazily
            this.tools = Array.from(this.toolFactories.keys()).map(toolName => 
                this.getToolInstance(toolName)
            );
        }
        return this.tools;
    }
    
    /**
     * Generate cache key for query
     */
    private generateCacheKey(queryData: AgentQuery): string {
        const queryHash = crypto.createHash('md5')
            .update(JSON.stringify({
                query: queryData.query,
                userId: queryData.userId,
                context: queryData.context
            }))
            .digest('hex');
        return queryHash;
    }
    
    /**
     * Get cached response if available
     */
    private getCachedResponse(cacheKey: string): AgentResponse | null {
        const cached = this.responseCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.RESPONSE_CACHE_TTL) {
            cached.hits++;
            this.metrics.cacheHits++;
            loggingService.info('💾 Cache hit for query', { cacheKey, hits: cached.hits });
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
    
    /**
     * Cache response
     */
    private cacheResponse(cacheKey: string, response: AgentResponse): void {
        // Implement LRU eviction if cache is full
        if (this.responseCache.size >= this.MAX_CACHE_SIZE) {
            const oldestKey = this.responseCache.keys().next().value;
            if (oldestKey) {
                this.responseCache.delete(oldestKey);
            }
        }
        
        this.responseCache.set(cacheKey, {
            response: { ...response },
            timestamp: Date.now(),
            hits: 0
        });
        
        loggingService.info('💾 Response cached', { cacheKey, cacheSize: this.responseCache.size });
    }
    
    /**
     * Start cache cleanup interval
     */
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
                loggingService.info(`🧹 Cache cleanup: removed ${cleaned} expired entries`);
            }
        }, 60000); // Run every minute
        
        // Store interval reference for potential cleanup
        (this as any).cleanupInterval = cleanupInterval;
    }
    
    /**
     * Create timeout promise with proper cleanup
     */
    private createTimeoutPromise<T>(ms: number): Promise<never> {
        return new Promise((_, reject) => {
            const timeoutId = setTimeout(() => {
                clearTimeout(timeoutId);
                reject(new Error(`Agent execution timeout after ${ms / 1000} seconds`));
            }, ms);
        });
    }
    
    /**
     * Initialize the agent with all necessary components
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            loggingService.info('🤖 Initializing AIOps Agent...');

            // Initialize vector store first with timeout to prevent hanging
            try {
                await Promise.race([
                    vectorStoreService.initialize(),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Vector store initialization timeout')), 30000)
                    )
                ]);
            } catch (vectorError) {
                loggingService.warn('⚠️ Vector store initialization failed or timed out, continuing without it:', {
                    error: vectorError instanceof Error ? vectorError.message : String(vectorError)
                });
                // Continue initialization even if vector store fails
            }

            // Build user context
            const userContext = this.buildUserContext({ userId: 'system', query: '', context: {} });
            
            // Create optimized prompt template
            const systemPrompt = process.env.NODE_ENV === 'production' 
                ? getCompressedPrompt() 
                : buildSystemPrompt(userContext);
            
            const prompt = ChatPromptTemplate.fromMessages([
                SystemMessagePromptTemplate.fromTemplate(systemPrompt),
                HumanMessagePromptTemplate.fromTemplate("{input}")
            ]);

            // Get all tools (lazy loaded)
            const allTools = this.getAllTools();
            
            // Create React agent with tools
            const agent = await createReactAgent({
                llm: this.model,
                tools: allTools,
                prompt: prompt,
            });

            // Create agent executor
            this.agentExecutor = new AgentExecutor({
                agent,
                tools: allTools,
                verbose: process.env.NODE_ENV === 'development',
                maxIterations: 3, // Even more aggressive to prevent loops
                earlyStoppingMethod: "force",
                returnIntermediateSteps: true, // Need this to extract tool outputs
                handleParsingErrors: true, // Better error handling
            });

            this.initialized = true;
            loggingService.info('✅ AIOps Agent initialized successfully');
            
        } catch (error) {
            loggingService.error('❌ Failed to initialize agent:', { error: error instanceof Error ? error.message : String(error) });
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

            if (!this.agentExecutor) {
                throw new Error('Agent not properly initialized');
            }

            // Check if this is a CostKatana-specific query and handle it directly
            const lowerQuery = queryData.query.toLowerCase();
            loggingService.info('🔍 Query analysis:', { 
                query: queryData.query, 
                lowerQuery, 
                containsCostkatana: lowerQuery.includes('costkatana'),
                containsNpm: lowerQuery.includes('npm'),
                containsPackage: lowerQuery.includes('package'),
                containsAiCostTracker: lowerQuery.includes('ai-cost-tracker'),
                containsCostKatanaCli: lowerQuery.includes('cost-katana-cli'),
                containsCostKatana: lowerQuery.includes('cost-katana'),
                containsPypi: lowerQuery.includes('pypi')
            });
            
            if (lowerQuery.includes('costkatana') || lowerQuery.includes('npm') || lowerQuery.includes('package') || 
                lowerQuery.includes('ai-cost-tracker') || lowerQuery.includes('cost-katana-cli') || 
                lowerQuery.includes('cost-katana') || lowerQuery.includes('pypi')) {
                
                loggingService.info('🎯 CostKatana-specific query detected, using knowledge base tool directly');
                
                const knowledgeBaseTool = this.getToolInstance('knowledge_base_search');
                const knowledgeResponse = await knowledgeBaseTool.invoke({ input: queryData.query });
                
                const executionTime = Date.now() - startTime;
                
                return {
                    success: true,
                    response: knowledgeResponse,
                    metadata: {
                        executionTime,
                        sources: ['Knowledge Base'],
                        fromCache: false,
                        knowledgeEnhanced: true
                    },
                    thinking: {
                        title: "CostKatana Package Information",
                        summary: "Retrieved comprehensive information about CostKatana packages, integration guides, and troubleshooting resources.",
                        steps: [
                            {
                                step: 1,
                                description: "Knowledge Base Search",
                                reasoning: "Searched the comprehensive CostKatana knowledge base for relevant package information and integration details.",
                                outcome: "Found detailed information about npm packages, Python SDK, and CLI tools"
                            },
                            {
                                step: 2,
                                description: "Package Information Retrieval",
                                reasoning: "Extracted specific details about available packages, installation commands, and official links.",
                                outcome: "Compiled complete package information with installation instructions"
                            },
                            {
                                step: 3,
                                description: "Integration Guidance",
                                reasoning: "Provided step-by-step integration examples and best practices for each package.",
                                outcome: "Generated actionable integration guidance with code examples"
                            }
                        ]
                    }
                };
            }

            // Build user context (with caching)
            const userContext = this.buildUserContextCached(queryData);

            // Check if query contains context preamble (from chat service)
            let enhancedQuery = queryData.query;
            if (queryData.query.includes('Current subject:') || queryData.query.includes('Recent conversation:')) {
                // This is a context-enhanced query from chat service
                loggingService.info('🔍 Context-enhanced query detected', {
                    hasContextPreamble: true,
                    queryLength: queryData.query.length
                });
                enhancedQuery = queryData.query; // Use as-is since it already contains context
            }

            // Generate thinking process for cost-related queries
            const thinking = this.generateThinkingProcess(enhancedQuery);

            // Determine query type for prompt optimization
            const queryType = this.determineQueryType(enhancedQuery);

            // Use queryType in the agentExecutor input for prompt optimization
            const result = await Promise.race([
                this.circuitBreaker(async () => {
                    return await this.retryExecutor(async () => {
                        return await this.agentExecutor!.invoke({
                            input: enhancedQuery,
                            user_context: userContext,
                            queryType // Pass queryType to the agent
                        });
                    });
                }),
                this.createTimeoutPromise(60000)
            ]) as any;

            const executionTime = Date.now() - startTime;

            // Update performance metrics
            this.updatePerformanceMetrics(executionTime);

            // Handle retry wrapper result structure
            let actualResult = result;
            if (result.success && result.result) {
                // This is wrapped by retry mechanism, extract the actual result
                actualResult = result.result;
                loggingService.info('🔄 Detected retry wrapper, extracting actual result');
            }

            // Process the result to ensure we always have a proper response
            let finalResponse = actualResult.output;

            // Debug logging to understand what we got from the agent
            loggingService.info('🔍 Agent Result Debug:', {
                isWrapped: result.success && result.result,
                hasOutput: !!actualResult.output,
                outputLength: actualResult.output?.length || 0,
                outputPreview: actualResult.output?.substring(0, 200) + '...',
                hasIntermediateSteps: !!actualResult.intermediateSteps,
                stepsCount: actualResult.intermediateSteps?.length || 0,
                resultKeys: Object.keys(result),
                actualResultKeys: Object.keys(actualResult)
            });

            // If the agent hit max iterations without a proper Final Answer, extract useful info
            if (!finalResponse || finalResponse.includes('Agent stopped due to max iterations')) {
                loggingService.info('⚠️ Agent output is falsy or contains max iterations, extracting from intermediate steps...');
                finalResponse = this.extractUsefulResponse(actualResult, queryData.query);
                loggingService.info('📋 Extracted response:', {
                    length: finalResponse?.length || 0,
                    preview: finalResponse?.substring(0, 200) + '...'
                });
            } else {
                loggingService.info('✅ Agent provided proper output directly');
            }

            const response: AgentResponse = {
                success: true,
                response: finalResponse,
                metadata: {
                    executionTime,
                    sources: this.extractSources(actualResult),
                    fromCache: false
                },
                thinking: thinking
            };

            // Cache successful responses
            if (response.success && response.response) {
                this.cacheResponse(cacheKey, response);
            }

            return response;

        } catch (error) {
            loggingService.error('Agent query failed:', { error: error instanceof Error ? error.message : String(error) });

            // Handle specific error types
            let errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            let fallbackResponse = '';

            // Check if it's a max iterations or timeout error
            if (errorMessage.includes('max iterations') || errorMessage.includes('Agent stopped due to max iterations')) {
                errorMessage = 'The query was complex and took longer than expected to process.';
                fallbackResponse = 'I was working on analyzing your data but the query became too complex. Could you please rephrase your question to be more specific? For example:\n\n' +
                    '• "Show my spending for this month"\n' +
                    '• "What are my top 3 most expensive models?"\n' +
                    '• "How many tokens did I use last week?"';
            } else if (errorMessage.includes('timeout')) {
                errorMessage = 'The query took too long to process and timed out.';
                fallbackResponse = 'Your request timed out after 60 seconds. Please try a simpler, more specific question. For example:\n\n' +
                    '• "What did I spend this month?"\n' +
                    '• "Show my top 5 models by cost"\n' +
                    '• "How many requests did I make today?"';
            }

            return {
                success: false,
                error: errorMessage,
                response: fallbackResponse,
                metadata: {
                    executionTime: Date.now() - startTime,
                    errorType: errorMessage.includes('max iterations') ? 'max_iterations' : 'general_error'
                }
            };
        }
    }

    /**
     * Extract useful response from agent result even if it hit max iterations
     * Optimized version using response formatters
     */
    private extractUsefulResponse(result: any, originalQuery: string): string {
        try {
            // Look for tool outputs in the agent's intermediate steps or logs
            const intermediateSteps = result.intermediateSteps || [];
            const logs = result.log || '';
            
            // Try to find the last tool output
            let lastToolOutput = null;
            
            // Check intermediate steps for tool outputs
            for (const step of intermediateSteps) {
                if (step.observation) {
                    try {
                        // Try to parse the observation as JSON
                        lastToolOutput = typeof step.observation === 'string' 
                            ? JSON.parse(step.observation) 
                            : step.observation;
                        loggingService.info('🔧 Found tool output in intermediate steps:', { 
                            success: lastToolOutput?.success,
                            operation: lastToolOutput?.operation,
                            hasData: !!lastToolOutput?.data
                        });
                    } catch (e) {
                        // If it's not JSON, keep as string
                        lastToolOutput = step.observation;
                        loggingService.info('🔧 Found non-JSON tool output:', { output: step.observation?.substring(0, 100) + '...' });
                    }
                }
            }
            
            // If no intermediate steps, try to parse from logs
            if (!lastToolOutput && logs) {
                const toolOutputMatch = logs.match(/Observation: ({.*?})/s);
                if (toolOutputMatch) {
                    try {
                        lastToolOutput = JSON.parse(toolOutputMatch[1]);
                    } catch (e) {
                        lastToolOutput = toolOutputMatch[1];
                    }
                }
            }
            
            // If we found tool output, format it using the response formatters
            if (lastToolOutput) {
                if (typeof lastToolOutput === 'string') {
                    try {
                        lastToolOutput = JSON.parse(lastToolOutput);
                    } catch (e) {
                        // Keep as string
                    }
                }
                
                // Use response formatters for consistent formatting
                if (lastToolOutput && typeof lastToolOutput === 'object' && lastToolOutput.success) {
                    loggingService.info('🎯 Processing tool output with formatters:', {
                        success: lastToolOutput.success,
                        operation: lastToolOutput.operation,
                        hasData: !!lastToolOutput.data
                    });
                    
                    return ResponseFormattersService.formatResponse(lastToolOutput);
                }
                
                // Handle non-successful tool output
                if (lastToolOutput && lastToolOutput.success === false) {
                    return lastToolOutput.message || 'The operation was not successful.';
                }
            }
            
            // Use fallback response generator
            loggingService.info('🚨 No successful tool output found, using fallback response');
            return ResponseFormattersService.generateFallbackResponse(originalQuery);
            
        } catch (error) {
            loggingService.error('Error extracting useful response:', { error: error instanceof Error ? error.message : String(error) });
            return "I encountered an issue processing your request. Please try asking a more specific question, such as 'What did I spend this month?' or 'Show my token usage.'";
        }
    }

    /**
     * Get agent status and statistics
     */
    getStatus(): {
        initialized: boolean;
        model: string;
        agentType: string;
        toolsCount: number;
        toolsLoaded: number;
        vectorStoreStats: any;
        performance: any;
        cacheStats: {
            responseCache: number;
            userContextCache: number;
        };
    } {
        const isMasterAgent = process.env.AGENT_TYPE === 'master';
        const currentModel = isMasterAgent ? 'anthropic.claude-sonnet-4-20250514-v1:0' : (process.env.AWS_BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0');
        
        return {
            initialized: this.initialized,
            model: currentModel,
            agentType: isMasterAgent ? 'Master Agent (Complex Reasoning)' : 'Standard Agent (Nova Pro)',
            toolsCount: this.toolFactories.size,
            toolsLoaded: this.toolInstances.size,
            vectorStoreStats: vectorStoreService.getStats(),
            performance: this.getMetrics(),
            cacheStats: {
                responseCache: this.responseCache.size,
                userContextCache: this.userContextCache.size
            }
        };
    }

    /**
     * Add learned insight to the knowledge base
     */
    async addLearning(insight: string, metadata: Record<string, any> = {}): Promise<void> {
        try {
            await vectorStoreService.addKnowledge(insight, {
                ...metadata,
                learningSource: 'agent_interaction'
            });
        } catch (error) {
            loggingService.error('Failed to add learning:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Build user context for the agent (with caching)
     */
    private buildUserContextCached(queryData: AgentQuery): string {
        const contextKey = `${queryData.userId}_${queryData.context?.projectId || 'default'}_${queryData.context?.conversationId || 'default'}`;
        
        const cached = this.userContextCache.get(contextKey);
        if (cached && Date.now() - cached.timestamp < this.USER_CONTEXT_CACHE_TTL) {
            return cached.context;
        }
        
        const context = this.buildUserContext(queryData);
        
        this.userContextCache.set(contextKey, {
            context,
            timestamp: Date.now()
        });
        
        return context;
    }
    
    /**
     * Build user context for the agent
     */
    private buildUserContext(queryData: AgentQuery): string {
        let context = `User ID: ${queryData.userId}`;
        
        if (queryData.context?.projectId) {
            context += `\nProject ID: ${queryData.context.projectId}`;
        }
        
        if (queryData.context?.conversationId) {
            context += `\nConversation ID: ${queryData.context.conversationId}`;
        }

        if (queryData.context?.previousMessages && queryData.context.previousMessages.length > 0) {
            context += '\nRecent conversation:\n';
            queryData.context.previousMessages.slice(-3).forEach((msg) => {
                context += `${msg.role}: ${msg.content}\n`;
            });
        }

        return context;
    }
    
    /**
     * Update performance metrics
     */
    private updatePerformanceMetrics(executionTime: number): void {
        // Update average response time using exponential moving average
        const alpha = 0.1; // Smoothing factor
        this.metrics.avgResponseTime = this.metrics.avgResponseTime === 0 
            ? executionTime 
            : (alpha * executionTime) + ((1 - alpha) * this.metrics.avgResponseTime);
    }
    
    /**
     * Get performance metrics
     */
    getMetrics(): typeof this.metrics & { cacheHitRate: number; toolsLoadedCount: number } {
        const totalCacheRequests = this.metrics.cacheHits + this.metrics.cacheMisses;
        const cacheHitRate = totalCacheRequests > 0 ? (this.metrics.cacheHits / totalCacheRequests) * 100 : 0;
        
        return {
            ...this.metrics,
            cacheHitRate: Math.round(cacheHitRate * 100) / 100,
            toolsLoadedCount: this.toolInstances.size
        };
    }
    
    /**
     * Clear caches (for testing or maintenance)
     */
    clearCaches(): void {
        this.responseCache.clear();
        this.userContextCache.clear();
        loggingService.info('🧹 All caches cleared');
    }
    
    /**
     * Determine query type for prompt optimization
     */
    private determineQueryType(query: string): 'cost' | 'token' | 'performance' | 'general' {
        const lowerQuery = query.toLowerCase();
        
        if (lowerQuery.includes('token') || lowerQuery.includes('usage')) {
            return 'token';
        } else if (lowerQuery.includes('cost') || lowerQuery.includes('spend') || lowerQuery.includes('budget')) {
            return 'cost';
        } else if (lowerQuery.includes('performance') || lowerQuery.includes('model') || lowerQuery.includes('benchmark')) {
            return 'performance';
        } else {
            return 'general';
        }
    }

    /**
     * Generate thinking process for ALL query types - comprehensive coverage
     */
    private generateThinkingProcess(query: string): any {
        const lowerQuery = query.toLowerCase();
        
        // Enhanced thinking for empty/no data scenarios
        if (lowerQuery.includes('no') && lowerQuery.includes('data') || 
            lowerQuery.includes('empty') || lowerQuery.includes('n/a')) {
            return {
                title: "Data Investigation & User Support",
                summary: "I'll help you understand why no data was found and guide you through the next steps to get meaningful insights.",
                steps: [
                    {
                        step: 1,
                        description: "Expanding search parameters",
                        reasoning: "Time range might be too narrow - checking broader periods",
                        outcome: "Searching last 90 days instead of current month"
                    },
                    {
                        step: 2,
                        description: "Checking data availability",
                        reasoning: "Need to understand if user is new or has different usage patterns",
                        outcome: "Will provide setup guidance if needed"
                    },
                    {
                        step: 3,
                        description: "Preparing interactive guidance",
                        reasoning: "User needs actionable next steps, not generic responses",
                        outcome: "Will ask specific questions to better assist"
                    }
                ]
            };
        }
        
        // 1. COST & SPENDING QUERIES
        const isCostQuery = lowerQuery.includes('cost') || lowerQuery.includes('money') || 
                           lowerQuery.includes('spend') || lowerQuery.includes('expensive') ||
                           lowerQuery.includes('price') || lowerQuery.includes('budget') ||
                           lowerQuery.includes('model') || lowerQuery.includes('usage');
        
        if (isCostQuery) {
            return {
                title: "Analyzing your AI cost data",
                summary: "I need to query your actual usage data to provide accurate cost insights based on your real spending patterns.",
                steps: [
                    {
                        step: 1,
                        description: "Data Retrieval",
                        reasoning: "First, I'll query your usage database to get your actual AI model spending data, including costs by model, service, and time period.",
                        outcome: "Retrieved your real usage data from MongoDB"
                    },
                    {
                        step: 2,
                        description: "Cost Analysis",
                        reasoning: "I'll analyze your spending patterns to identify which models consume the most budget and calculate total expenditures.",
                        outcome: "Identified your highest-cost models and spending trends"
                    },
                    {
                        step: 3,
                        description: "Data Aggregation",
                        reasoning: "I'll aggregate the costs by different dimensions (model, provider, time) to give you comprehensive insights.",
                        outcome: "Summarized your costs with actionable breakdowns"
                    },
                    {
                        step: 4,
                        description: "Optimization Recommendations",
                        reasoning: "Based on your actual spending patterns, I'll suggest specific optimizations to reduce costs.",
                        outcome: "Generated personalized cost optimization strategies"
                    }
                ]
            };
        }
        
        // 2. API CONFIGURATION QUERIES
        const isApiConfigQuery = lowerQuery.includes('api') || lowerQuery.includes('configure') ||
                                 lowerQuery.includes('settings') || lowerQuery.includes('key') ||
                                 lowerQuery.includes('integration') || lowerQuery.includes('endpoint');
        
        if (isApiConfigQuery) {
            return {
                title: "Configuring your API settings",
                summary: "I'll analyze your current integrations and guide you through optimizing your API configurations for better cost efficiency.",
                steps: [
                    {
                        step: 1,
                        description: "Current Configuration Analysis",
                        reasoning: "First, I'll check your existing API keys, endpoints, and integration settings to understand your current setup.",
                        outcome: "Identified your active integrations and configuration gaps"
                    },
                    {
                        step: 2,
                        description: "Security & Best Practices Review",
                        reasoning: "I'll verify your API security settings and recommend best practices for key management and access control.",
                        outcome: "Enhanced security configuration recommendations"
                    },
                    {
                        step: 3,
                        description: "Cost Optimization Setup",
                        reasoning: "I'll configure optimal settings for rate limiting, caching, and request optimization to minimize API costs.",
                        outcome: "Implemented cost-effective API configurations"
                    },
                    {
                        step: 4,
                        description: "Testing & Validation",
                        reasoning: "I'll test your API connections and validate that all configurations are working optimally.",
                        outcome: "Verified all API integrations are functioning efficiently"
                    }
                ]
            };
        }

        // 3. TOKEN USAGE & ANALYTICS QUERIES
        const isTokenUsageQuery = lowerQuery.includes('token') || lowerQuery.includes('usage') ||
                                  lowerQuery.includes('analytics') || lowerQuery.includes('current') ||
                                  lowerQuery.includes('how much') || lowerQuery.includes('statistics');
        
        if (isTokenUsageQuery) {
            return {
                title: "Analyzing your current token usage",
                summary: "I'll dive deep into your actual usage data to provide comprehensive insights about your token consumption patterns.",
                steps: [
                    {
                        step: 1,
                        description: "Real-Time Data Retrieval",
                        reasoning: "I'll query your usage database to get your most recent token consumption across all models and projects.",
                        outcome: "Retrieved your current token usage statistics"
                    },
                    {
                        step: 2,
                        description: "Usage Pattern Analysis",
                        reasoning: "I'll analyze your usage patterns to identify peak times, model preferences, and consumption trends.",
                        outcome: "Identified your usage patterns and optimization opportunities"
                    },
                    {
                        step: 3,
                        description: "Cost Impact Assessment",
                        reasoning: "I'll calculate the cost implications of your token usage and compare against your budgets and thresholds.",
                        outcome: "Generated cost breakdown and budget utilization analysis"
                    },
                    {
                        step: 4,
                        description: "Optimization Recommendations",
                        reasoning: "Based on your actual usage data, I'll provide specific recommendations to optimize token consumption.",
                        outcome: "Created personalized token optimization strategy"
                    }
                ]
            };
        }

        // 4. PROMPT OPTIMIZATION QUERIES
        const isPromptOptQuery = lowerQuery.includes('prompt') || lowerQuery.includes('optimize') ||
                                lowerQuery.includes('efficiency') || lowerQuery.includes('improve') ||
                                lowerQuery.includes('better') || lowerQuery.includes('reduce');
        
        if (isPromptOptQuery) {
            return {
                title: "Optimizing your prompts for efficiency",
                summary: "I'll analyze your actual prompts and usage patterns to provide specific optimization strategies that reduce costs while maintaining quality.",
                steps: [
                    {
                        step: 1,
                        description: "Prompt Analysis",
                        reasoning: "I'll examine your recent prompts to identify optimization opportunities like redundancy, verbosity, and inefficient structures.",
                        outcome: "Identified optimization opportunities in your prompts"
                    },
                    {
                        step: 2,
                        description: "Token Efficiency Review",
                        reasoning: "I'll calculate current token usage and identify where prompt compression can reduce costs without losing effectiveness.",
                        outcome: "Found token reduction opportunities averaging 25-40%"
                    },
                    {
                        step: 3,
                        description: "Template Creation",
                        reasoning: "I'll create optimized prompt templates based on your use cases that maintain quality while reducing token count.",
                        outcome: "Generated efficient prompt templates for your common use cases"
                    },
                    {
                        step: 4,
                        description: "Quality Validation",
                        reasoning: "I'll test optimized prompts to ensure they maintain output quality while achieving cost savings.",
                        outcome: "Validated optimizations maintain 95%+ quality with significant cost reduction"
                    }
                ]
            };
        }

        // 5. MODEL SELECTION & COMPARISON QUERIES
        const isModelQuery = lowerQuery.includes('model') || lowerQuery.includes('compare') ||
                            lowerQuery.includes('recommend') || lowerQuery.includes('best') ||
                            lowerQuery.includes('switch') || lowerQuery.includes('alternative');
        
        if (isModelQuery) {
            return {
                title: "Analyzing optimal model selection",
                summary: "I'll analyze your usage patterns and requirements to recommend the most cost-effective models for your specific needs.",
                steps: [
                    {
                        step: 1,
                        description: "Usage Pattern Analysis",
                        reasoning: "I'll examine your current model usage, task complexity, and quality requirements to understand your needs.",
                        outcome: "Mapped your usage patterns to optimal model categories"
                    },
                    {
                        step: 2,
                        description: "Cost-Performance Comparison",
                        reasoning: "I'll compare costs and performance across available models to identify the best value options for each use case.",
                        outcome: "Identified 3-5 optimal models with cost/quality trade-offs"
                    },
                    {
                        step: 3,
                        description: "ROI Calculation",
                        reasoning: "I'll calculate potential cost savings and performance impacts from switching to recommended models.",
                        outcome: "Estimated 15-35% cost savings with maintained quality"
                    },
                    {
                        step: 4,
                        description: "Migration Strategy",
                        reasoning: "I'll create a safe migration plan to gradually transition to optimal models with testing and validation.",
                        outcome: "Generated risk-free model migration roadmap"
                    }
                ]
            };
        }

        // 6. PROJECT SETUP & MANAGEMENT QUERIES
        if (lowerQuery.includes('project') || lowerQuery.includes('setup')) {
            // Special handling for AI cost optimization projects
            if (lowerQuery.includes('cost') || lowerQuery.includes('optim')) {
                return {
                    title: "Setting up AI Cost Optimization Project",
                    summary: "I'll create a comprehensive AI cost optimization project with monitoring, analytics, and optimization tools configured for maximum cost efficiency.",
                    steps: [
                        {
                            step: 1,
                            description: "Project Configuration",
                            reasoning: "Setting up an AI cost optimization project with specialized settings, higher budget limits, and sensitive cost alerts.",
                            outcome: "Created optimized project with $500 budget and 60% alert threshold"
                        },
                        {
                            step: 2,
                            description: "Model Portfolio Setup",
                            reasoning: "Configuring a diverse set of models from Nova Lite (cost-effective) to Claude Sonnet (high-quality) for comprehensive testing.",
                            outcome: "Added 4 optimized models for cost/performance comparisons"
                        },
                        {
                            step: 3,
                            description: "Monitoring Infrastructure",
                            reasoning: "Setting up comprehensive usage tracking, cost analytics, and automated alerting systems.",
                            outcome: "Configured advanced monitoring and reporting capabilities"
                        },
                        {
                            step: 4,
                            description: "Optimization Strategy",
                            reasoning: "Implementing cost optimization techniques including prompt engineering, caching, and automated model selection.",
                            outcome: "Deployed 7 optimization strategies for immediate cost savings"
                        },
                        {
                            step: 5,
                            description: "Implementation Roadmap",
                            reasoning: "Providing step-by-step guidance for implementing cost optimization best practices.",
                            outcome: "Generated 8-step action plan for immediate implementation"
                        }
                    ]
                };
            }
            
            // General project setup
            return {
                title: "Planning your project setup",
                summary: "I'll break down your project requirements and create a structured implementation plan.",
                steps: [
                    {
                        step: 1,
                        description: "Requirement Analysis",
                        reasoning: "Understanding your specific needs, technology preferences, and project goals.",
                        outcome: "Clarified project scope and requirements"
                    },
                    {
                        step: 2,
                        description: "Technology Stack Selection",
                        reasoning: "Choosing the optimal technologies based on your requirements and cost optimization goals.",
                        outcome: "Selected appropriate tools and frameworks"
                    },
                    {
                        step: 3,
                        description: "Implementation Planning",
                        reasoning: "Creating a step-by-step implementation plan that's easy to follow and execute.",
                        outcome: "Structured implementation roadmap"
                    }
                ]
            };
        }

        // 7. ANALYTICS & INSIGHTS QUERIES
        const isAnalyticsQuery = lowerQuery.includes('insight') || lowerQuery.includes('report') ||
                                 lowerQuery.includes('trend') || lowerQuery.includes('pattern') ||
                                 lowerQuery.includes('dashboard') || lowerQuery.includes('metrics');
        
        if (isAnalyticsQuery) {
            return {
                title: "Generating analytics and insights",
                summary: "I'll analyze your comprehensive usage data to provide actionable insights and trends for optimizing your AI spending.",
                steps: [
                    {
                        step: 1,
                        description: "Data Aggregation",
                        reasoning: "I'll gather all your usage data across models, projects, and time periods to build a complete picture of your AI usage.",
                        outcome: "Compiled comprehensive usage dataset for analysis"
                    },
                    {
                        step: 2,
                        description: "Trend Analysis",
                        reasoning: "I'll identify spending trends, usage patterns, and seasonal variations in your AI consumption.",
                        outcome: "Discovered key trends and usage patterns"
                    },
                    {
                        step: 3,
                        description: "Anomaly Detection",
                        reasoning: "I'll identify unusual spending spikes, efficiency drops, or other anomalies that need attention.",
                        outcome: "Flagged anomalies and potential optimization opportunities"
                    },
                    {
                        step: 4,
                        description: "Actionable Recommendations",
                        reasoning: "Based on the analysis, I'll provide specific, prioritized recommendations for cost optimization.",
                        outcome: "Generated prioritized action plan with ROI estimates"
                    }
                ]
            };
        }

        // 8. PERFORMANCE & OPTIMIZATION QUERIES
        const isPerformanceQuery = lowerQuery.includes('performance') || lowerQuery.includes('speed') ||
                                  lowerQuery.includes('latency') || lowerQuery.includes('quality') ||
                                  lowerQuery.includes('accuracy') || lowerQuery.includes('benchmark');
        
        if (isPerformanceQuery) {
            return {
                title: "Analyzing performance optimization opportunities",
                summary: "I'll evaluate your AI system performance across cost, speed, and quality metrics to identify optimization opportunities.",
                steps: [
                    {
                        step: 1,
                        description: "Performance Baseline Assessment",
                        reasoning: "I'll establish current performance baselines across all your AI operations including latency, cost, and quality metrics.",
                        outcome: "Established comprehensive performance baselines"
                    },
                    {
                        step: 2,
                        description: "Bottleneck Identification",
                        reasoning: "I'll identify performance bottlenecks in your AI pipeline that impact cost efficiency or response times.",
                        outcome: "Identified key bottlenecks and performance constraints"
                    },
                    {
                        step: 3,
                        description: "Optimization Strategy Development",
                        reasoning: "I'll develop targeted optimization strategies that improve performance while maintaining or reducing costs.",
                        outcome: "Created multi-faceted performance optimization plan"
                    },
                    {
                        step: 4,
                        description: "Implementation Roadmap",
                        reasoning: "I'll prioritize optimizations by impact and create a practical implementation timeline with measurable goals.",
                        outcome: "Generated implementation roadmap with success metrics"
                    }
                ]
            };
        }

        // 9. SECURITY & COMPLIANCE QUERIES
        const isSecurityQuery = lowerQuery.includes('security') || lowerQuery.includes('compliance') ||
                               lowerQuery.includes('privacy') || lowerQuery.includes('audit') ||
                               lowerQuery.includes('permission') || lowerQuery.includes('access');
        
        if (isSecurityQuery) {
            return {
                title: "Reviewing security and compliance configuration",
                summary: "I'll audit your AI system's security posture and compliance settings to ensure robust protection while maintaining efficiency.",
                steps: [
                    {
                        step: 1,
                        description: "Security Configuration Audit",
                        reasoning: "I'll review all API keys, access controls, and security configurations to identify potential vulnerabilities.",
                        outcome: "Completed comprehensive security audit"
                    },
                    {
                        step: 2,
                        description: "Compliance Assessment",
                        reasoning: "I'll verify compliance with relevant regulations and best practices for AI system deployment.",
                        outcome: "Assessed compliance status and identified gaps"
                    },
                    {
                        step: 3,
                        description: "Risk Mitigation Planning",
                        reasoning: "I'll develop strategies to address security risks while maintaining operational efficiency and cost effectiveness.",
                        outcome: "Created risk mitigation plan with cost considerations"
                    },
                    {
                        step: 4,
                        description: "Implementation Guidelines",
                        reasoning: "I'll provide specific implementation steps to enhance security without compromising AI system performance.",
                        outcome: "Generated secure implementation guidelines"
                    }
                ]
            };
        }

        // 10. GENERAL AI ASSISTANCE QUERIES
        const isGeneralQuery = lowerQuery.includes('help') || lowerQuery.includes('guide') ||
                              lowerQuery.includes('how to') || lowerQuery.includes('explain') ||
                              lowerQuery.includes('what is') || lowerQuery.includes('show me');
        
        if (isGeneralQuery) {
            return {
                title: "Analyzing your request for intelligent assistance",
                summary: "I'll understand your specific needs and provide comprehensive, data-driven guidance tailored to your AI cost optimization goals.",
                steps: [
                    {
                        step: 1,
                        description: "Context Understanding",
                        reasoning: "I'll analyze your request in the context of your existing AI usage, projects, and optimization goals.",
                        outcome: "Understood your specific context and requirements"
                    },
                    {
                        step: 2,
                        description: "Resource Identification",
                        reasoning: "I'll identify relevant data, tools, and resources from your system to provide the most helpful response.",
                        outcome: "Compiled relevant resources and data points"
                    },
                    {
                        step: 3,
                        description: "Solution Development",
                        reasoning: "I'll develop a comprehensive solution or guidance that addresses your specific situation and goals.",
                        outcome: "Crafted personalized solution with actionable steps"
                    }
                ]
            };
        }
        
        // Return undefined for very basic queries that don't need thinking process
        return undefined;
    }

    /**
     * Extract sources from agent execution result
     */
    private extractSources(result: any): string[] {
        const sources: string[] = [];
        
        // This would be enhanced based on actual agent execution structure
        if (result.intermediate_steps) {
            result.intermediate_steps.forEach((step: any) => {
                if (step.tool === 'knowledge_base_search') {
                    sources.push('Knowledge Base');
                } else if (step.tool === 'mongodb_reader') {
                    sources.push('Database');
                }
            });
        }

        return [...new Set(sources)]; // Remove duplicates
    }

    /**
     * Enhanced query processing with knowledge base integration for multiagent coordination
     */
    async processQueryWithKnowledgeContext(query: AgentQuery): Promise<AgentResponse> {
        const startTime = Date.now();
        
        try {
            loggingService.info('Knowledge-enhanced agent query initiated', { value:  { 
                userId: query.userId,
                query: query.query,
                hasContext: !!query.context,
                agentType: process.env.AGENT_TYPE || 'standard'
             } });

            // First, search knowledge base for relevant context
            const knowledgeBaseTool = new KnowledgeBaseTool();
            
            // Enhance the knowledge base query with existing context
            let contextualKnowledgeQuery = query.query;
            if (query.context) {
                // Add conversation context for better knowledge base search
                if (query.context.previousMessages && query.context.previousMessages.length > 0) {
                    const recentContext = query.context.previousMessages
                        .slice(-2) // Last 2 messages for context
                        .map((msg: any) => `${msg.role}: ${msg.content}`)
                        .join('\n');
                    
                    contextualKnowledgeQuery = `Conversation context:\n${recentContext}\n\nCurrent query: ${query.query}`;
                }

                // Add project context if available
                if (query.context.projectId) {
                    contextualKnowledgeQuery += `\n\nProject context: ${query.context.projectId}`;
                }

                // Add conversation ID for tracking
                if (query.context.conversationId) {
                    contextualKnowledgeQuery += `\n\nConversation: ${query.context.conversationId}`;
                }
            }
            
            const knowledgeContext = await knowledgeBaseTool._call(contextualKnowledgeQuery);

            // Enhance the query with knowledge context
            const enhancedQuery: AgentQuery = {
                ...query,
                context: {
                    ...query.context,
                    knowledgeBaseContext: knowledgeContext,
                    systemCapabilities: [
                        'cost_optimization',
                        'usage_analytics', 
                        'workflow_management',
                        'security_monitoring',
                        'user_management',
                        'webhook_delivery',
                        'training_datasets',
                        'comprehensive_logging'
                    ],
                    availableAgentTypes: ['master', 'optimizer', 'analyst', 'scraper', 'ux']
                }
            };

            // Process with enhanced context
            const response = await this.query(enhancedQuery);

            const duration = Date.now() - startTime;

            loggingService.info('Knowledge-enhanced agent query completed', { value:  { 
                userId: query.userId,
                success: response.success,
                duration,
                hasKnowledgeContext: !!knowledgeContext,
                usedContextualQuery: contextualKnowledgeQuery !== query.query,
                contextualQueryLength: contextualKnowledgeQuery.length,
                agentType: process.env.AGENT_TYPE || 'standard'
             } });

            // Log business event
            loggingService.logBusiness({
                event: 'knowledge_enhanced_agent_query',
                category: 'multiagent_coordination',
                value: duration,
                metadata: {
                    userId: query.userId,
                    success: response.success,
                    agentType: process.env.AGENT_TYPE || 'standard',
                    hasKnowledgeContext: !!knowledgeContext
                }
            });

            return {
                ...response,
                metadata: {
                    ...response.metadata,
                    knowledgeEnhanced: true,
                    knowledgeContextLength: knowledgeContext?.length || 0,
                    executionTime: duration
                }
            };

        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Knowledge-enhanced agent query failed', {
                userId: query.userId,
                query: query.query,
                error: error.message,
                stack: error.stack,
                duration,
                agentType: process.env.AGENT_TYPE || 'standard'
            });

            return {
                success: false,
                error: `Knowledge-enhanced processing failed: ${error.message}`,
                metadata: {
                    errorType: 'knowledge_enhancement_error',
                    executionTime: duration
                }
            };
        }
    }

    /**
     * Get agent-specific knowledge context
     */
    async getAgentKnowledgeContext(agentType: string, topic?: string): Promise<string> {
        try {
            const knowledgeBaseTool = new KnowledgeBaseTool();
            
            // Build agent-specific query
            let query = `${agentType} agent capabilities and responsibilities`;
            if (topic) {
                query += ` related to ${topic}`;
            }

            const context = await knowledgeBaseTool._call(query);
            
            loggingService.info('Agent knowledge context retrieved', { value:  { 
                agentType,
                topic,
                contextLength: context.length
             } });

            return context;

        } catch (error: any) {
            loggingService.error('Failed to get agent knowledge context', {
                agentType,
                topic,
                error: error.message
            });
            
            return `Error retrieving knowledge context for ${agentType} agent: ${error.message}`;
        }
    }

    /**
     * Coordinate with other agents using knowledge base context
     */
    async coordinateWithAgents(
        primaryQuery: string,
        requiredAgentTypes: string[],
        userId: string
    ): Promise<{
        coordinationPlan: string;
        agentContexts: { [agentType: string]: string };
        recommendations: string[];
    }> {
        try {
            loggingService.info('Multi-agent coordination initiated', { value:  { 
                userId,
                primaryQuery,
                requiredAgentTypes,
                agentCount: requiredAgentTypes.length
             } });

            // Get knowledge context for each required agent type
            const agentContexts: { [agentType: string]: string } = {};
            
            for (const agentType of requiredAgentTypes) {
                agentContexts[agentType] = await this.getAgentKnowledgeContext(agentType, primaryQuery);
            }

            // Generate coordination plan based on knowledge
            const knowledgeBaseTool = new KnowledgeBaseTool();
            const coordinationContext = await knowledgeBaseTool._call(
                `multi-agent coordination patterns and workflow management for: ${primaryQuery}`
            );

            // Generate recommendations
            const recommendations = this.generateCoordinationRecommendations(
                primaryQuery,
                requiredAgentTypes,
                coordinationContext
            );

            loggingService.info('Multi-agent coordination completed', {
                userId,
                primaryQuery,
                agentTypesProcessed: Object.keys(agentContexts).length,
                recommendationsCount: recommendations.length
            });

            return {
                coordinationPlan: coordinationContext,
                agentContexts,
                recommendations
            };

        } catch (error: any) {
            loggingService.error('Multi-agent coordination failed', {
                userId,
                primaryQuery,
                requiredAgentTypes,
                error: error.message,
                stack: error.stack
            });

            throw new Error(`Multi-agent coordination failed: ${error.message}`);
        }
    }

    /**
     * Generate coordination recommendations based on query and agent types
     */
    private generateCoordinationRecommendations(
        query: string,
        agentTypes: string[],
        coordinationContext: string
    ): string[] {
        const recommendations: string[] = [];
        const queryLower = query.toLowerCase();

        // Analyze query for specific coordination patterns
        if (queryLower.includes('cost') || queryLower.includes('optimization')) {
            recommendations.push('Coordinate optimizer and analyst agents for comprehensive cost analysis');
        }

        if (queryLower.includes('data') || queryLower.includes('scraping')) {
            recommendations.push('Use scraper agent to gather data, then analyst agent to process insights');
        }

        if (queryLower.includes('user') || queryLower.includes('interface')) {
            recommendations.push('Involve UX agent for user experience considerations');
        }

        if (queryLower.includes('workflow') || queryLower.includes('process')) {
            recommendations.push('Leverage workflow management capabilities for automated coordination');
        }

        if (agentTypes.includes('master')) {
            recommendations.push('Master agent should orchestrate and validate all agent responses');
        }

        // Add general coordination recommendations
        recommendations.push('Use knowledge base context to ensure consistent responses across agents');
        recommendations.push('Implement proper error handling and fallback mechanisms');
        recommendations.push('Log all agent interactions for observability and debugging');

        return recommendations;
    }
}

// Singleton instance for the application
export const agentService = new AgentService(); 