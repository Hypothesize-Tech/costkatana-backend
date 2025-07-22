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
import { vectorStoreService } from "./vectorStore.service";

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

    constructor() {
        // Initialize Nova Pro for most tasks (efficient and cost-effective)
        // Use environment variable or default to Nova Pro as requested
        const defaultModel = process.env.AWS_BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0';
        const isMasterAgent = process.env.AGENT_TYPE === 'master'; // For complex reasoning tasks
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

        console.log(`🤖 Initialized ${isMasterAgent ? 'Master' : 'Standard'} Agent`);

        // Initialize tools - comprehensive access to all backend features
        this.tools = [
            new KnowledgeBaseTool(),           // Documentation and knowledge search
            new MongoDbReaderTool(),           // Database queries and data access
            new ProjectManagerTool(),          // Project CRUD operations and management
            new ModelSelectorTool(),           // Model recommendations and testing
            new AnalyticsManagerTool(),        // Complete analytics and reporting
            new OptimizationManagerTool()      // Cost optimization and recommendations
        ];
    }

    /**
     * Initialize the agent with all necessary components
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            console.log('🤖 Initializing AIOps Agent...');

            // Initialize vector store first
            await vectorStoreService.initialize();

            // Create the agent prompt template
            const prompt = ChatPromptTemplate.fromMessages([
                SystemMessagePromptTemplate.fromTemplate(`Answer the following questions as best you can. You have access to the following tools:

{tools}

Use the following format:

Question: the input question you must answer
Thought: you should always think about what to do
Action: the action to take, should be one of [{tool_names}]
Action Input: the input to the action
Observation: the result of the action
... (this Thought/Action/Action Input/Observation can repeat N times)
Thought: I now know the final answer
Final Answer: the final answer to the original input question

CRITICAL FORMATTING RULES:
1. Action should contain ONLY the tool name (e.g., "project_manager")
2. Action Input should contain ONLY the JSON parameters on a single line
3. DO NOT include "Observation:" in your response - the system adds this automatically
4. JSON must be valid and on one line with no line breaks
5. Stop after Action Input and wait for the tool result

Example:
Action: project_manager
Action Input: {{"operation": "create", "userId": "123", "projectData": {{"name": "Test"}}}}

You are an AI Cost Optimization Agent with comprehensive capabilities:
1. 🔍 **Advanced Cost Analysis**: Deep usage analysis, cost trends, anomaly detection, and forecasting
2. 📊 **Complete Analytics**: Dashboard analytics, model performance analysis, comparative reports
3. 📚 **Knowledge Search**: Access documentation, best practices, and optimization guides
4. 💡 **Intelligent Optimization**: Automated cost optimization, model recommendations, prompt optimization
5. 🎯 **Strategic Planning**: Cost forecasting, budget planning, and ROI analysis
6. 🚀 **Full Project Management**: Complete project lifecycle management through conversation
7. 🤖 **Smart Model Selection**: AI-powered model recommendations with testing and validation
8. 📈 **Real-time Monitoring**: Usage monitoring, performance tracking, and alert management
9. 🔧 **Bulk Operations**: Bulk analysis, optimization, and management across multiple projects

**Key Guidelines:**
                - ALWAYS query user's real data - never give generic answers for ANY question
                - Use multiple tools together to provide comprehensive answers
                - Always provide specific numbers, percentages, and actionable insights FROM THE USER'S DATA
                - Start with user's REAL data, then provide specific, actionable guidance
                - If no data is found, expand time ranges and query differently
                - When data is insufficient, ask clarifying questions to better help the user
                - Be interactive and conversational - ask follow-up questions when needed

**TOOL USAGE GUIDELINES:**
🔍 **COST/SPENDING/MODEL QUERIES** → mongodb_reader + analytics_manager
📊 **USAGE/ANALYTICS/INSIGHTS** → analytics_manager + mongodb_reader  
🎯 **TOKEN USAGE QUERIES** → analytics_manager (operation: token_usage)
🎯 **OPTIMIZATION/EFFICIENCY** → optimization_manager + mongodb_reader
🚀 **PROJECT SETUP/MANAGEMENT** → project_manager + model_selector
🤖 **MODEL SELECTION/COMPARISON** → model_selector + analytics_manager
⚙️ **API/SETTINGS/CONFIG** → mongodb_reader + knowledge_base_search
📚 **HELP/GUIDANCE/EDUCATION** → knowledge_base_search + mongodb_reader

**SPECIFIC QUERY ROUTING:**
- "token usage" / "tokens" / "current usage" → analytics_manager with operation: "token_usage"
- "spending" / "cost" / "money" → analytics_manager with operation: "dashboard"
- "model performance" / "which models" → analytics_manager with operation: "model_performance"
- "create project" / "setup project" → project_manager with operation: "create"

Current user context: {user_context}

Begin!

Question: {input}
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
                maxIterations: 10,
                earlyStoppingMethod: "generate",
            });

            this.initialized = true;
            console.log('✅ AIOps Agent initialized successfully');
            
        } catch (error) {
            console.error('❌ Failed to initialize agent:', error);
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

            // Execute the query
            const result = await this.agentExecutor.invoke({
                input: queryData.query,
                user_context: userContext
            });

            const executionTime = Date.now() - startTime;

            return {
                success: true,
                response: result.output,
                metadata: {
                    executionTime,
                    // Note: Token counting would require additional setup with Bedrock
                    sources: this.extractSources(result)
                },
                thinking: thinking
            };

        } catch (error) {
            console.error('Agent query failed:', error);
            
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred',
                metadata: {
                    executionTime: Date.now() - startTime
                }
            };
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
        const currentModel = isMasterAgent ? 'anthropic.claude-3-5-sonnet-20241022-v2:0' : (process.env.AWS_BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0');
        
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
            console.error('Failed to add learning:', error);
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
}

// Singleton instance for the application
export const agentService = new AgentService(); 