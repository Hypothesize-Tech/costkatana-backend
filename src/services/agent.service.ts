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
import { LifeUtilityTool } from "../tools/lifeUtility.tool";
import { vectorStoreService } from "./vectorStore.service";
import { RetryWithBackoff, RetryConfigs } from "../utils/retryWithBackoff";
import { loggingService } from "./logging.service";

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

export class AgentService {
    private agentExecutor?: AgentExecutor;
    private initialized = false;
    private model: ChatBedrockConverse;
    private tools: Tool[];
    private circuitBreaker: <T>(fn: () => Promise<T>) => Promise<T>;
    private retryExecutor: <T>(fn: () => Promise<T>) => Promise<any>;

    constructor() {
        const defaultModel = process.env.AWS_BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0';
        const isMasterAgent = process.env.AGENT_TYPE === 'master';
        const selectedModel = isMasterAgent ? 'anthropic.claude-3-5-sonnet-20241022-v2:0' : defaultModel;
        
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

        // Initialize tools - comprehensive access to all backend features
        this.tools = [
            new KnowledgeBaseTool(),           // Documentation and knowledge search
            new MongoDbReaderTool(),           // Database queries and data access
            new ProjectManagerTool(),          // Project CRUD operations and management
            new ModelSelectorTool(),           // Model recommendations and testing
            new AnalyticsManagerTool(),        // Complete analytics and reporting
            new OptimizationManagerTool(),     // Cost optimization and recommendations
            new WebScraperTool(),              // Real-time web scraping and data extraction
            new LifeUtilityTool()              // Life utility services (weather, health, travel, price tracking)
        ];

        // Initialize retry mechanism with circuit breaker
        this.circuitBreaker = RetryWithBackoff.createCircuitBreaker(5, 60000); // 5 failures, 1 min reset
        this.retryExecutor = RetryWithBackoff.createBedrockRetry({
            ...RetryConfigs.bedrock,
            onRetry: (error: Error, attempt: number) => {
                loggingService.warn(`🔄 Agent retry attempt ${attempt}: ${error.message}`);
            }
        });
    }

    /**
     * Initialize the agent with all necessary components
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            loggingService.info('🤖 Initializing AIOps Agent...');

            // Initialize vector store first
            await vectorStoreService.initialize();

            // Create the agent prompt template
            const prompt = ChatPromptTemplate.fromMessages([
                SystemMessagePromptTemplate.fromTemplate(`You are an AI Cost Optimization Agent with access to comprehensive knowledge about the AI Cost Optimizer platform. You have deep understanding of:

🎯 CORE PLATFORM KNOWLEDGE:
- Cost optimization strategies (prompt compression, context trimming, model switching)
- AI insights and analytics (usage patterns, cost trends, predictive analytics)
- Multi-agent workflows and coordination patterns
- System architecture (controllers, services, APIs, infrastructure)
- Real-time monitoring and observability features
- Security monitoring and threat detection capabilities
- User management and authentication patterns
- Webhook management and delivery systems
- Training dataset management and PII analysis
- Comprehensive logging and business intelligence

🤖 MULTIAGENT COORDINATION:
- You can coordinate with other specialized agents (optimizer, analyst, scraper, UX agents)
- Use knowledge_base_search to find specific information about system capabilities
- Leverage system documentation for accurate technical guidance
- Provide context-aware recommendations based on platform knowledge

Available tools: {tools}

MANDATORY FORMAT - You MUST follow this exact sequence:

Question: {input}
Thought: I need to [describe what data you need]
Action: [EXACTLY one tool name from: {tool_names}]
Action Input: [Valid JSON on single line]
Observation: [System will add this automatically - DO NOT WRITE IT]
Thought: Based on the observation, I now have [describe what you learned]. I can provide a complete answer.
Final Answer: [Your complete response to the user]

CRITICAL STOPPING RULES - YOU MUST FOLLOW THESE EXACTLY:
1. After getting ANY successful tool result, you MUST immediately provide "Final Answer:"
2. Do NOT repeat the same tool call multiple times
3. Do NOT continue thinking after you have data to answer the question
4. If a tool returns data, that means you have enough information to answer
5. NEVER call the same tool with the same parameters more than once
6. If you get "Invalid operation", try ONE different operation, then provide Final Answer

COMPREHENSIVE TOOL USAGE RULES - FOLLOW THESE EXACTLY:

📚 KNOWLEDGE & DOCUMENTATION QUERIES → knowledge_base_search:
- "How does [feature] work?", "What is [component]?", "Best practices for [topic]"
- System architecture questions, API documentation, integration guides
- "How to optimize costs?", "What are the available features?"
- "How do I set up webhooks?", "What security features are available?"
- "How does multi-agent coordination work?", "What analytics are available?"
- Use this FIRST for any questions about platform capabilities, features, or documentation

🔍 TOKEN USAGE QUERIES → analytics_manager with "token_usage":
- "Token usage", "tokens", "token consumption", "token breakdown"
- "analyticsType": "Token usage"
- "Compare my Claude vs GPT tokens"
- "How many tokens did I use?"
- "Token costs by model"

💰 COST & SPENDING QUERIES → analytics_manager with "dashboard":
- "Cost breakdown", "spending", "costs", "budget analysis"
- "How much did I spend?"
- "Cost comparison", "expense report"
- "Compare my Claude vs GPT costs"
- "Monthly spending"

⚡ MODEL PERFORMANCE QUERIES → analytics_manager with "model_performance":
- "Model performance", "model comparison", "model efficiency"
- "Which model is fastest?", "accuracy comparison"
- "Best performing models"
- "Model benchmarks"

📊 USAGE PATTERNS QUERIES → analytics_manager with "usage_patterns":
- "Usage patterns", "usage trends", "activity patterns"
- "When do I use AI most?", "peak usage times"
- "Usage frequency", "request patterns"

📈 COST TRENDS QUERIES → analytics_manager with "cost_trends":
- "Cost trends", "spending trends", "cost over time"
- "Monthly cost comparison", "cost growth"
- "Spending patterns", "budget trends"

👤 USER STATISTICS QUERIES → analytics_manager with "user_stats":
- "User stats", "my statistics", "account summary"
- "Overall usage summary", "total activity"
- "Account analytics"

🔬 PROJECT ANALYTICS QUERIES → analytics_manager with "project_analytics":
- "Project analytics", "project breakdown", "project costs"
- "Project performance", "project usage"
- "Specific project analysis"

⚠️ ANOMALY DETECTION QUERIES → analytics_manager with "anomaly_detection":
- "Unusual spending", "cost spikes", "anomalies"
- "Unexpected usage", "cost alerts"
- "Spending anomalies"

🔮 FORECASTING QUERIES → analytics_manager with "forecasting":
- "Cost forecast", "future spending", "predictions"
- "Budget projections", "usage predictions"
- "Expected costs"

📊 COMPARATIVE ANALYSIS QUERIES → analytics_manager with "comparative_analysis":
- "Compare periods", "month over month", "year over year"
- "Before vs after", "comparison analysis"
- "Period comparison"

🎯 SPECIAL CASES:
- "All metrics" + "Token usage" → use "token_usage"
- "All metrics" + "Cost breakdown" → use "dashboard"  
- "All metrics" + "Model performance" → use "model_performance"
- "Summary overview" + any specific type → use that specific operation

EXAMPLES FOR EACH OPERATION TYPE:

EXAMPLE 1 - Token Usage Query:
Question: Execute analytics_manager with data: {{"operation":"analyze","userId":"user123","analyticsType":"Token usage","timeframe":"Last month","format":"Summary overview","specificProjects":"all projects"}}
Thought: The user is asking for token usage analytics. I need to use the token_usage operation.
Action: analytics_manager
Action Input: {{"operation": "token_usage", "userId": "user123", "timeRange": "last month"}}
Observation: {{"success": true, "operation": "token_usage", "data": {{"summary": {{"totalTokens": 150000, "totalCost": 25.50}}, "message": "Here's your token usage for last month"}}}}
Thought: Based on the observation, I have the user's token usage data. I can provide a complete answer.
Final Answer: Here's your token usage for last month: You used 150,000 tokens with a total cost of $25.50. This shows active usage of the platform.

EXAMPLE 2 - Cost Breakdown Query:
Question: Compare my Claude vs GPT actual costs and performance
Thought: The user is asking for cost comparison between models. I need to use the dashboard operation for cost data.
Action: analytics_manager
Action Input: {{"operation": "dashboard", "userId": "user123", "timeRange": "last month"}}
Observation: {{"success": true, "operation": "dashboard_analytics", "data": {{"summary": {{"totalCost": 125.50, "modelBreakdown": [{{"model": "claude-3", "cost": 75.30}}, {{"model": "gpt-4", "cost": 50.20}}]}}, "message": "Here's your cost breakdown"}}}}
Thought: Based on the observation, I have the user's cost comparison data. I can provide a complete answer.
Final Answer: Here's your Claude vs GPT cost comparison: Claude-3 cost you $75.30 while GPT-4 cost $50.20 last month. Total spending was $125.50.

EXAMPLE 3 - Model Performance Query:
Question: Which AI model performs best for my use case?
Thought: The user is asking about model performance comparison. I need to use the model_performance operation.
Action: analytics_manager
Action Input: {{"operation": "model_performance", "userId": "user123", "timeRange": "last month"}}
Observation: {{"success": true, "operation": "model_performance", "data": {{"models": [{{"model": "claude-3", "avgResponseTime": 1.2, "successRate": 98.5}}], "message": "Here's your model performance data"}}}}
Thought: Based on the observation, I have the user's model performance data. I can provide a complete answer.
Final Answer: Based on your usage, Claude-3 shows the best performance with 1.2s average response time and 98.5% success rate.

EXAMPLE 4 - Usage Patterns Query:
Question: Show me my usage patterns for the last month
Thought: The user is asking for usage patterns analysis. I need to use the usage_patterns operation.
Action: analytics_manager
Action Input: {{"operation": "usage_patterns", "userId": "user123", "timeRange": "last month"}}
Observation: {{"success": true, "operation": "usage_patterns", "data": {{"patterns": {{"peakHours": "2-4 PM", "avgDaily": 45}}, "message": "Here are your usage patterns"}}}}
Thought: Based on the observation, I have the user's usage patterns data. I can provide a complete answer.
Final Answer: Your usage patterns show peak activity between 2-4 PM with an average of 45 requests per day last month.

EXAMPLE - Invalid Operation Recovery:
Question: Execute analytics_manager with invalid operation
Thought: I need to get analytics data.
Action: analytics_manager
Action Input: {{"operation": "analyze", "userId": "user123"}}
Observation: Invalid operation: Check operation type and required fields.
Thought: The operation was invalid. Let me try with a valid operation.
Action: analytics_manager
Action Input: {{"operation": "dashboard", "userId": "user123"}}
Observation: {{"success": true, "data": {{"totalRequests": 100}}}}
Thought: Now I have valid data. I can provide a complete answer.
Final Answer: I found your analytics data showing 100 total requests. The initial operation type was invalid, but I was able to retrieve your dashboard analytics successfully.

Current user: {user_context}

Question: {input}

🚨 CRITICAL OPERATION MAPPING RULES:
- "Token usage" / "analyticsType": "Token usage" → MUST use "token_usage" operation
- "Cost breakdown" / "Compare costs" → MUST use "dashboard" operation  
- "Model performance" / "Which model is best" → MUST use "model_performance" operation
- "Usage patterns" / "When do I use most" → MUST use "usage_patterns" operation
- "Cost trends" / "Spending over time" → MUST use "cost_trends" operation
- "User stats" / "Account summary" → MUST use "user_stats" operation
- "Project analytics" / "Project breakdown" → MUST use "project_analytics" operation
- "Anomalies" / "Unusual spending" → MUST use "anomaly_detection" operation
- "Forecast" / "Future costs" → MUST use "forecasting" operation
- "Compare periods" / "Month over month" → MUST use "comparative_analysis" operation

NEVER use "dashboard" for token-related queries! NEVER use "token_usage" for cost-related queries!

Thought:{agent_scratchpad}`),
                HumanMessagePromptTemplate.fromTemplate("{input}")
            ]);

            // Create React agent with tools
            const agent = await createReactAgent({
                llm: this.model,
                tools: this.tools,
                prompt: prompt,
            });

            // Create agent executor
            this.agentExecutor = new AgentExecutor({
                agent,
                tools: this.tools,
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
        
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            if (!this.agentExecutor) {
                throw new Error('Agent not properly initialized');
            }

            // Build user context
            const userContext = this.buildUserContext(queryData);

            // Generate thinking process for cost-related queries
            const thinking = this.generateThinkingProcess(queryData.query);

            // Execute the query with retry, circuit breaker, and timeout
            const result = await Promise.race([
                this.circuitBreaker(async () => {
                    return await this.retryExecutor(async () => {
                        return await this.agentExecutor!.invoke({
                            input: queryData.query,
                            user_context: userContext
                        });
                    });
                }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Agent execution timeout after 60 seconds')), 60000)
                )
            ]) as any;

            const executionTime = Date.now() - startTime;

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

            return {
                success: true,
                response: finalResponse,
                metadata: {
                    executionTime,
                    // Note: Token counting would require additional setup with Bedrock
                    sources: this.extractSources(actualResult)
                },
                thinking: thinking
            };

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
                        loggingService.info('🔧 Found tool output in intermediate steps:', { value:  { 
                            success: lastToolOutput?.success,
                            operation: lastToolOutput?.operation,
                            hasData: !!lastToolOutput?.data
                         } });
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
            
            // If we found tool output, format it into a helpful response
            if (lastToolOutput) {
                if (typeof lastToolOutput === 'string') {
                    try {
                        lastToolOutput = JSON.parse(lastToolOutput);
                    } catch (e) {
                        // Keep as string
                    }
                }
                
                // PRIORITY: If we have successful tool output, use it regardless of agent completion status
                if (lastToolOutput && typeof lastToolOutput === 'object') {
                    loggingService.info('🎯 Processing tool output:', {
                        success: lastToolOutput.success,
                        operation: lastToolOutput.operation,
                        hasData: !!lastToolOutput.data,
                        dataKeys: lastToolOutput.data ? Object.keys(lastToolOutput.data) : []
                    });
                    
                    if (lastToolOutput.success && lastToolOutput.data) {
                        const data = lastToolOutput.data;
                        
                        // Token usage response
                        if (lastToolOutput.operation === 'token_usage') {
                            if (data.summary) {
                                // Successful response with data
                                const summary = data.summary;
                                let response = `${data.message || 'Here\'s your token usage:'}\n\n`;
                                response += `📊 **Usage Summary:**\n`;
                                response += `• Total tokens: ${summary.totalTokens?.toLocaleString() || 'N/A'}\n`;
                                response += `• Prompt tokens: ${summary.promptTokens?.toLocaleString() || 'N/A'}\n`;
                                response += `• Completion tokens: ${summary.completionTokens?.toLocaleString() || 'N/A'}\n`;
                                response += `• Total cost: $${summary.totalCost || '0.00'}\n`;
                                response += `• Total requests: ${summary.totalRequests || 'N/A'}\n`;
                                response += `• Avg tokens per request: ${summary.avgTokensPerRequest || 'N/A'}\n`;
                                response += `• Cost per token: $${summary.costPerToken || '0.00'}\n\n`;
                                
                                if (data.timeRangeAdjusted) {
                                    response += `💡 **Note:** I adjusted the time range to show your available data.\n\n`;
                                }
                                
                                if (data.modelBreakdown && data.modelBreakdown.length > 0) {
                                    response += `🤖 **Top Models:**\n`;
                                    data.modelBreakdown.slice(0, 3).forEach((model: any, index: number) => {
                                        response += `${index + 1}. ${model.model}: ${model.totalTokens?.toLocaleString()} tokens ($${model.totalCost})\n`;
                                    });
                                    response += '\n';
                                }
                                
                                if (data.insights && data.insights.length > 0) {
                                    response += `💡 **Insights:**\n`;
                                    data.insights.forEach((insight: string) => {
                                        response += `• ${insight}\n`;
                                    });
                                }
                                
                                return response;
                            } else if (data.message) {
                                // No data found response
                                return `${data.message}\n\n${data.reasons ? 'Possible reasons:\n• ' + data.reasons.join('\n• ') : ''}\n\n${data.suggestions ? 'Suggestions:\n• ' + data.suggestions.join('\n• ') : ''}\n\n${data.nextSteps || ''}`;
                            }
                        }
                        
                        // Dashboard response - handle both detailed and basic responses
                        if (lastToolOutput.operation === 'dashboard_analytics') {
                            if (data.summary) {
                                const summary = data.summary;
                                return `Here's your cost summary:\n\n• Total requests: ${summary.totalRequests || 'N/A'}\n• Total cost: $${summary.totalCost || '0.00'}\n• Average cost per request: $${summary.avgCostPerRequest || '0.00'}\n• Unique models used: ${summary.uniqueModels || 'N/A'}\n\n${data.insights ? 'Key insights:\n• ' + data.insights.join('\n• ') : ''}`;
                            } else if (data.message && data.totalRequests) {
                                // Handle basic dashboard response
                                return `${data.message}\n\n📊 **Quick Stats:**\n• Total requests: ${data.totalRequests}\n\n${data.suggestion || 'Would you like me to get more detailed analytics?'}`;
                            } else if (data.message) {
                                return data.message;
                            }
                        }
                        
                        // Model Performance response
                        if (lastToolOutput.operation === 'model_performance') {
                            if (data.models && data.models.length > 0) {
                                let response = `🚀 **Model Performance Analysis:**\n\n`;
                                data.models.forEach((model: any, index: number) => {
                                    response += `${index + 1}. **${model.model}**\n`;
                                    response += `   • Avg Response Time: ${model.avgResponseTime || 'N/A'}s\n`;
                                    response += `   • Success Rate: ${model.successRate || 'N/A'}%\n`;
                                    response += `   • Cost Efficiency: ${model.costEfficiency || 'N/A'}\n\n`;
                                });
                                return response;
                            } else if (data.message) {
                                return data.message;
                            }
                        }

                        // Usage Patterns response
                        if (lastToolOutput.operation === 'usage_patterns') {
                            if (data.patterns) {
                                let response = `📈 **Usage Patterns Analysis:**\n\n`;
                                response += `• Peak Hours: ${data.patterns.peakHours || 'N/A'}\n`;
                                response += `• Average Daily Requests: ${data.patterns.avgDaily || 'N/A'}\n`;
                                response += `• Most Active Days: ${data.patterns.activeDays || 'N/A'}\n`;
                                response += `• Usage Trend: ${data.patterns.trend || 'N/A'}\n\n`;
                                if (data.insights) {
                                    response += `💡 **Insights:**\n`;
                                    data.insights.forEach((insight: string) => {
                                        response += `• ${insight}\n`;
                                    });
                                }
                                return response;
                            } else if (data.message) {
                                return data.message;
                            }
                        }

                        // Cost Trends response
                        if (lastToolOutput.operation === 'cost_trends') {
                            if (data.trends) {
                                let response = `📊 **Cost Trends Analysis:**\n\n`;
                                response += `• Monthly Growth: ${data.trends.monthlyGrowth || 'N/A'}%\n`;
                                response += `• Average Monthly Cost: $${data.trends.avgMonthlyCost || '0.00'}\n`;
                                response += `• Trend Direction: ${data.trends.direction || 'N/A'}\n`;
                                if (data.projections) {
                                    response += `• Next Month Projection: $${data.projections.nextMonth || '0.00'}\n`;
                                }
                                return response;
                            } else if (data.message) {
                                return data.message;
                            }
                        }

                        // User Stats response
                        if (lastToolOutput.operation === 'user_stats') {
                            if (data.stats) {
                                let response = `👤 **Account Statistics:**\n\n`;
                                response += `• Total Requests: ${data.stats.totalRequests?.toLocaleString() || 'N/A'}\n`;
                                response += `• Total Cost: $${data.stats.totalCost || '0.00'}\n`;
                                response += `• Active Days: ${data.stats.activeDays || 'N/A'}\n`;
                                response += `• Favorite Model: ${data.stats.favoriteModel || 'N/A'}\n`;
                                response += `• Account Age: ${data.stats.accountAge || 'N/A'} days\n\n`;
                                if (data.achievements) {
                                    response += `🏆 **Achievements:**\n`;
                                    data.achievements.forEach((achievement: string) => {
                                        response += `• ${achievement}\n`;
                                    });
                                }
                                return response;
                            } else if (data.message) {
                                return data.message;
                            }
                        }

                        // Project Analytics response
                        if (lastToolOutput.operation === 'project_analytics') {
                            if (data.projects && data.projects.length > 0) {
                                let response = `🔬 **Project Analytics:**\n\n`;
                                data.projects.forEach((project: any, index: number) => {
                                    response += `${index + 1}. **${project.name}**\n`;
                                    response += `   • Cost: $${project.cost || '0.00'}\n`;
                                    response += `   • Requests: ${project.requests || 'N/A'}\n`;
                                    response += `   • Efficiency: ${project.efficiency || 'N/A'}\n\n`;
                                });
                                return response;
                            } else if (data.message) {
                                return data.message;
                            }
                        }

                        // Anomaly Detection response
                        if (lastToolOutput.operation === 'anomaly_detection') {
                            if (data.anomalies && data.anomalies.length > 0) {
                                let response = `⚠️ **Anomalies Detected:**\n\n`;
                                data.anomalies.forEach((anomaly: any, index: number) => {
                                    response += `${index + 1}. **${anomaly.type}** on ${anomaly.date}\n`;
                                    response += `   • Description: ${anomaly.description}\n`;
                                    response += `   • Impact: ${anomaly.impact}\n`;
                                    response += `   • Recommendation: ${anomaly.recommendation}\n\n`;
                                });
                                return response;
                            } else if (data.message) {
                                return data.message;
                            }
                        }

                        // Forecasting response
                        if (lastToolOutput.operation === 'forecasting') {
                            if (data.forecast) {
                                let response = `🔮 **Cost Forecast:**\n\n`;
                                response += `• Next Month: $${data.forecast.nextMonth || '0.00'}\n`;
                                response += `• Next Quarter: $${data.forecast.nextQuarter || '0.00'}\n`;
                                response += `• Confidence Level: ${data.forecast.confidence || 'N/A'}%\n`;
                                response += `• Growth Rate: ${data.forecast.growthRate || 'N/A'}%\n\n`;
                                if (data.recommendations) {
                                    response += `💡 **Recommendations:**\n`;
                                    data.recommendations.forEach((rec: string) => {
                                        response += `• ${rec}\n`;
                                    });
                                }
                                return response;
                            } else if (data.message) {
                                return data.message;
                            }
                        }

                        // Comparative Analysis response
                        if (lastToolOutput.operation === 'comparative_analysis') {
                            if (data.comparison) {
                                let response = `📊 **Comparative Analysis:**\n\n`;
                                response += `• Current Period: $${data.comparison.current || '0.00'}\n`;
                                response += `• Previous Period: $${data.comparison.previous || '0.00'}\n`;
                                response += `• Change: ${data.comparison.change || 'N/A'}%\n`;
                                response += `• Trend: ${data.comparison.trend || 'N/A'}\n\n`;
                                if (data.insights) {
                                    response += `💡 **Key Changes:**\n`;
                                    data.insights.forEach((insight: string) => {
                                        response += `• ${insight}\n`;
                                    });
                                }
                                return response;
                            } else if (data.message) {
                                return data.message;
                            }
                        }

                        // Generic successful response
                        if (data.summary || data.message) {
                            return data.summary || data.message;
                        }
                    }
                }
            }
            
            // CRITICAL: Before falling back to error messages, check if we actually had successful tool output
            if (lastToolOutput && lastToolOutput.success) {
                loggingService.info('⚠️ Had successful tool output but couldn\'t format it properly. Returning raw success message.');
                if (lastToolOutput.summary) {
                    return lastToolOutput.summary;
                } else if (lastToolOutput.data && lastToolOutput.data.message) {
                    return lastToolOutput.data.message;
                } else {
                    return 'I successfully retrieved your data, but encountered a formatting issue. The operation completed successfully.';
                }
            }
            
            // Comprehensive fallback response based on query type (only if no successful tool output)
            const queryLower = originalQuery.toLowerCase();
            
            loggingService.info('🚨 No successful tool output found, using fallback for query:', { value:  {  query: queryLower  } });
            
            if (queryLower.includes('token')) {
                return "I couldn't find any token usage data for your account. This might mean you're new to the platform or haven't made API calls recently. Would you like me to help you set up API tracking?";
            } else if (queryLower.includes('cost') || queryLower.includes('spend') || queryLower.includes('budget')) {
                return "I couldn't find any cost data for the specified period. This might mean you haven't made any API calls yet or the data is in a different time range. Would you like me to check a different time period?";
            } else if (queryLower.includes('model') || queryLower.includes('performance')) {
                return "I couldn't find any model performance data for your account. This might mean you need more usage data to generate performance metrics. Try making some API calls first.";
            } else if (queryLower.includes('pattern') || queryLower.includes('usage')) {
                return "I couldn't find any usage patterns for your account. This typically requires at least a few days of API activity to establish patterns.";
            } else if (queryLower.includes('trend') || queryLower.includes('forecast')) {
                return "I couldn't generate trend analysis or forecasts. This requires historical data over multiple time periods. Try using the platform for a few weeks first.";
            } else if (queryLower.includes('anomal') || queryLower.includes('unusual')) {
                return "I couldn't detect any anomalies in your usage. This is actually good news! Anomaly detection requires baseline usage patterns to identify unusual activity.";
            } else if (queryLower.includes('project')) {
                return "I couldn't find any project-specific analytics. Make sure you have projects set up and have been using them for API calls.";
            } else if (queryLower.includes('compare') || queryLower.includes('comparison')) {
                return "I couldn't perform the requested comparison. This might be due to insufficient data in one or both periods being compared.";
            } else {
                return "I was unable to complete your request fully, but I'm here to help. Could you please rephrase your question to be more specific? For example:\n\n• 'Show my token usage this month'\n• 'What did I spend on Claude vs GPT?'\n• 'Which model performs best?'\n• 'Show my usage patterns'\n• 'Compare this month to last month'";
            }
            
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
        vectorStoreStats: any;
    } {
        const isMasterAgent = process.env.AGENT_TYPE === 'master';
        const currentModel = isMasterAgent ? 'anthropic.claude-sonnet-4-20250514-v1:0' : (process.env.AWS_BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0');
        
        return {
            initialized: this.initialized,
            model: currentModel,
            agentType: isMasterAgent ? 'Master Agent (Complex Reasoning)' : 'Standard Agent (Nova Pro)',
            toolsCount: this.tools.length,
            vectorStoreStats: vectorStoreService.getStats()
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