import { Conversation, IConversation, ChatMessage } from '@models/index';
import { DocumentModel } from '@models/Document';
import { Types } from 'mongoose';
import mongoose from 'mongoose';
import { StateGraph, Annotation } from '@langchain/langgraph';
import { ChatBedrockConverse } from '@langchain/aws';
import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { Tool } from '@langchain/core/tools';
import { AgentExecutor } from 'langchain/agents';
import { multiAgentFlowService } from '@services/multiAgentFlow.service';
import { loggingService } from '@services/logging.service';
import { IntegrationChatService, ParsedMention } from '@services/integrationChat.service';
import { MCPIntegrationHandler } from '@services/mcpIntegrationHandler.service';
import { IntegrationFormatter } from './chat/formatters';
import { ModelRegistry, ModelMetadata, CostEstimator } from './chat/models';
import { ContextManager, ConversationContext } from './chat/context';
import { RouteDecider, IntegrationDetector, ConnectionChecker, ContextOptimizer } from './chat/routing';
import { 
    KnowledgeBaseHandler, 
    WebScraperHandler, 
    MultiAgentHandler, 
    ConversationalFlowHandler, 
    FallbackHandler,
    HandlerRequest
} from './chat/handlers';
export type { ConversationContext, CoreferenceResult } from './chat/context';
import { LangchainHelpers } from './chat/langchain/helpers';
import { AttachmentProcessor } from './chat/attachments';
import { AutonomousDetector, GovernedPlanMessageCreator } from './chat/autonomous';

// Enhanced Langchain Multi-Agent State Management
const LangchainChatState = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
        reducer: (x, y) => x.concat(y),
    }),
    currentAgent: Annotation<string>({
        reducer: (x, y) => y ?? x,
        default: () => 'coordinator',
    }),
    userId: Annotation<string>(),
    userMessage: Annotation<string>(),
    userIntent: Annotation<string>(),
    contextData: Annotation<Record<string, any>>(),
    integrationContext: Annotation<{
        aws?: any;
        google?: any;
        github?: any;
        vercel?: any;
        mongodb?: any;
    }>(),
    strategyFormation: Annotation<{
        questions: string[];
        responses: Record<string, any>;
        currentQuestion: number;
        isComplete: boolean;
        adaptiveQuestions?: string[];
    }>(),
    autonomousDecisions: Annotation<string[]>({
        reducer: (x, y) => [...(x || []), ...(y || [])],
        default: () => [],
    }),
    userInputCollection: Annotation<{
        active: boolean;
        currentField?: any;
        collectedData: Record<string, any>;
        progress: number;
    }>(),
    taskPriority: Annotation<number>({
        reducer: (x, y) => y ?? x,
        default: () => 1,
    }),
    conversationDepth: Annotation<number>({
        reducer: (x, y) => y ?? x,
        default: () => 0,
    }),
    proactiveInsights: Annotation<string[]>({
        reducer: (x, y) => [...(x || []), ...(y || [])],
        default: () => [],
    }),
    worldClassFeatures: Annotation<{
        emotionalIntelligence: boolean;
        contextualMemory: boolean;
        predictiveAnalytics: boolean;
        crossModalUnderstanding: boolean;
    }>({
        reducer: (x, y) => y ?? x,
        default: () => ({
            emotionalIntelligence: true,
            contextualMemory: true,
            predictiveAnalytics: true,
            crossModalUnderstanding: true,
        }),
    }),
});

type LangchainChatStateType = typeof LangchainChatState.State;

// Enhanced Agent Configuration Interface
export interface LangchainAgentConfig {
    name: string;
    type: 'coordinator' | 'specialist' | 'integration' | 'autonomous' | 'strategy';
    model: 'claude' | 'gpt4' | 'bedrock';
    specialization: string;
    tools: Tool[];
    systemPrompt: string;
    autonomyLevel: 'low' | 'medium' | 'high' | 'full';
}

// Dynamic User Input Strategy Interface
export interface DynamicInputStrategy {
    collectUserInput: boolean;
    questionFlow: string[];
    adaptiveQuestioning: boolean;
    maxInteractions: number;
    strategyFormation: boolean;
    personalizedApproach: boolean;
}

export interface ChatMessageResponse {
    id: string;
    conversationId: string;
    role: 'user' | 'assistant';
    content: string;
    modelId?: string;
    // Governed Agent fields
    messageType?: 'user' | 'assistant' | 'system' | 'governed_plan';
    governedTaskId?: string;
    planState?: 'SCOPE' | 'CLARIFY' | 'PLAN' | 'BUILD' | 'VERIFY' | 'DONE';
    attachedDocuments?: Array<{
        documentId: string;
        fileName: string;
        chunksCount: number;
        fileType?: string;
    }>;
    attachments?: Array<{
        type: 'uploaded' | 'google';
        fileId: string;
        fileName: string;
        fileSize: number;
        mimeType: string;
        fileType: string;
        url: string;
    }>;
    timestamp: Date;
    metadata?: {
        temperature?: number;
        maxTokens?: number;
        cost?: number;
        latency?: number;
        tokenCount?: number;
    };
    // MongoDB integration fields
    mongodbSelectedViewType?: 'table' | 'json' | 'schema' | 'stats' | 'chart' | 'text' | 'error' | 'empty' | 'explain' | 'list';
    integrationSelectorData?: any;
    mongodbIntegrationData?: any;
    // All integration data fields
    githubIntegrationData?: any;
    vercelIntegrationData?: any;
    slackIntegrationData?: any;
    discordIntegrationData?: any;
    jiraIntegrationData?: any;
    linearIntegrationData?: any;
    googleIntegrationData?: any;
    awsIntegrationData?: any;
    formattedResult?: {
        type: 'table' | 'json' | 'schema' | 'stats' | 'chart' | 'error' | 'empty' | 'text' | 'explain' | 'list';
        data: any;
    };
    // Agent metadata
    agentPath?: string[];
    optimizationsApplied?: string[];
    cacheHit?: boolean;
    riskLevel?: string;
}

export interface ConversationResponse {
    id: string;
    userId: string;
    title: string;
    modelId: string;
    createdAt: Date;
    updatedAt: Date;
    messageCount: number;
    lastMessage?: string;
    totalCost?: number;
    isPinned?: boolean;
    isArchived?: boolean;
    githubContext?: {
        connectionId?: string;
        repositoryId?: number;
        repositoryName?: string;
        repositoryFullName?: string;
        integrationId?: string;
        branchName?: string;
    };
}

export interface ChatSendMessageRequest {
    userId: string;
    message?: string; // Enriched message for AI processing (may include instructions)
    originalMessage?: string; // Original user message for storage/display (if different from message)
    modelId: string;
    conversationId?: string;
    temperature?: number;
    maxTokens?: number;
    chatMode?: 'fastest' | 'cheapest' | 'balanced';
    useMultiAgent?: boolean;
    useWebSearch?: boolean; // Enable web search for this query
    documentIds?: string[]; // Document IDs for RAG context
    githubContext?: {
        connectionId: string;
        repositoryId: number;
        repositoryName: string;
        repositoryFullName: string;
    };
    vercelContext?: {
        connectionId: string;
        projectId: string;
        projectName: string;
    };
    mongodbContext?: {
        connectionId: string;
        activeDatabase?: string;
        activeCollection?: string;
    };
    // Template support
    templateId?: string; // Use a prompt template
    templateVariables?: Record<string, any>; // Variables for template
    attachments?: Array<{
        type: 'uploaded' | 'google';
        fileId: string;
        fileName: string;
        fileSize: number;
        mimeType: string;
        fileType: string;
        url: string;
    }>;
    req?: any;
    // Integration agent selection response (for multi-turn parameter collection)
    selectionResponse?: {
        parameterName: string;
        value: string | number | boolean;
        pendingAction: string;
        collectedParams: Record<string, unknown>;
        integration?: string;
    };
}

export interface ChatSendMessageResponse {
    messageId: string;
    conversationId: string;
    response: string;
    cost: number;
    latency: number;
    tokenCount: number;
    model: string;
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
    // Multi-agent enhancements
    optimizationsApplied?: string[];
    cacheHit?: boolean;
    agentPath?: string[];
    riskLevel?: string;
    strategyFormed?: any;
    autonomousActions?: string[];
    proactiveInsights?: string[];
    // GitHub integration data
    githubIntegrationData?: {
        integrationId?: string;
        status?: string;
        progress?: number;
        currentStep?: string;
        prUrl?: string;
        issueUrl?: string;
        commitSha?: string;
        branchName?: string;
    };
    // Vercel integration data
    vercelIntegrationData?: {
        deploymentUrl?: string;
        deploymentId?: string;
        status?: string;
    };
    // MongoDB integration data
    mongodbIntegrationData?: any;
    resultType?: string;
    formattedResult?: any;
    suggestions?: string[];
    // Google integration data
    googleIntegrationData?: any;
    // Slack integration data
    slackIntegrationData?: {
        channelId?: string;
        messageTs?: string;
        permalink?: string;
    };
    // Discord integration data
    discordIntegrationData?: {
        messageId?: string;
        channelId?: string;
    };
    // Jira integration data
    jiraIntegrationData?: {
        issueKey?: string;
        issueUrl?: string;
    };
    // Linear integration data
    linearIntegrationData?: {
        issueId?: string;
        issueUrl?: string;
    };
    // MCP metadata
    mcpToolsUsed?: string[];
    mcpExecutionTime?: number;
    // Connection requirement (when integration not connected)
    requiresConnection?: {
        integration: string;
        message: string;
        connectUrl: string;
    };
    // Template metadata
    templateUsed?: {
        id: string;
        name: string;
        category: string;
        variablesResolved: Array<{
            variableName: string;
            value: string;
            confidence: number;
            source: 'user_provided' | 'context_inferred' | 'default' | 'missing';
            reasoning?: string;
        }>;
    };
    // Google services view links
    viewLinks?: Array<{
        label: string;
        url: string;
        type: 'document' | 'spreadsheet' | 'presentation' | 'file' | 'email' | 'calendar' | 'form';
    }>;
    // Web search metadata
    webSearchUsed?: boolean;
    quotaUsed?: number;
    metadata?: any;
    // Integration agent selection (for interactive parameter collection)
    requiresSelection?: boolean;
    selection?: {
        parameterName: string;
        question: string;
        options: Array<{
            id: string;
            label: string;
            value: string;
            description?: string;
            icon?: string;
        }>;
        allowCustom: boolean;
        customPlaceholder?: string;
        integration: string;
        pendingAction: string;
        collectedParams: Record<string, unknown>;
        originalMessage?: string;
    };
    // IntegrationSelector data (for MongoDB and other integrations)
    requiresIntegrationSelector?: boolean;
    integrationSelectorData?: any;
}

export class ChatService {
    // Enhanced Langchain Multi-Agent System
    private static langchainGraph?: StateGraph<LangchainChatStateType>;
    private static langchainAgents: Map<string, AgentExecutor> = new Map();
    private static langchainModels: Map<string, any> = new Map();
    private static initialized = false;

    // Dynamic User Input Collection System
    private static userInputSessions: Map<string, any> = new Map();
    private static strategyFormationSessions: Map<string, any> = new Map();
    private static readonly SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

    /**
     * Clean up expired user input sessions
     */
    private static cleanupExpiredSessions() {
        const now = Date.now();
        
        // Clean userInputSessions
        for (const [sessionId, session] of this.userInputSessions.entries()) {
            if (now - session.timestamp.getTime() > this.SESSION_TIMEOUT) {
                this.userInputSessions.delete(sessionId);
                loggingService.debug('Cleaned up expired user input session', { sessionId });
            }
        }
        
        // Clean strategyFormationSessions
        for (const [sessionId, session] of this.strategyFormationSessions.entries()) {
            if (now - session.timestamp.getTime() > this.SESSION_TIMEOUT) {
                this.strategyFormationSessions.delete(sessionId);
                loggingService.debug('Cleaned up expired strategy formation session', { sessionId });
            }
        }
    }

    // Run cleanup every 10 minutes
    static {
        setInterval(() => this.cleanupExpiredSessions(), 10 * 60 * 1000);
    }

    /**
     * Initialize Langchain Multi-Agent Ecosystem
     */
    private static async initializeLangchainSystem(): Promise<void> {
        if (this.initialized) return;

        try {
            loggingService.info('🚀 Initializing Langchain Multi-Agent Ecosystem');

            // Initialize models
            this.setupLangchainModels();
            
            // Create specialized agents
            this.createLangchainAgents();
            
            // Build the state graph
            this.buildLangchainGraph();
            
            this.initialized = true;
            loggingService.info('✅ Langchain Multi-Agent Ecosystem initialized successfully');
        } catch (error) {
            loggingService.error('❌ Failed to initialize Langchain system', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Setup Langchain Models for different capabilities - ALL AWS BEDROCK
     */
    private static setupLangchainModels(): void {
        // Master Coordinator - Claude Opus 4.1 on Bedrock for high-level reasoning
        this.langchainModels.set('master_coordinator', new ChatBedrockConverse({
            model: 'us.anthropic.claude-opus-4-1-20250805-v1:0',
            region: process.env.AWS_REGION || 'us-east-1',
            temperature: 0.7,
            maxTokens: 8000,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
            },
        }));

        // Strategy Formation - Claude Haiku 4.5 on Bedrock for strategic planning
        this.langchainModels.set('strategy_agent', new ChatBedrockConverse({
            model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
            region: process.env.AWS_REGION || 'us-east-1',
            temperature: 0.8,
            maxTokens: 6000,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
            },
        }));

        // AWS Integration - Nova Pro on Bedrock for AWS-specific operations
        this.langchainModels.set('aws_specialist', new ChatBedrockConverse({
            model: 'us.amazon.nova-pro-v1:0',
            region: process.env.AWS_REGION || 'us-east-1',
            temperature: 0.6,
            maxTokens: 6000,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
            },
        }));

        // Google Integration - Claude Opus 4.1 on Bedrock for Google services
        this.langchainModels.set('google_specialist', new ChatBedrockConverse({
            model: 'us.anthropic.claude-opus-4-1-20250805-v1:0',
            region: process.env.AWS_REGION || 'us-east-1',
            temperature: 0.6,
            maxTokens: 6000,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
            },
        }));

        // GitHub Integration - Claude Opus 4.1 on Bedrock for code understanding
        this.langchainModels.set('github_specialist', new ChatBedrockConverse({
            model: 'us.anthropic.claude-opus-4-1-20250805-v1:0',
            region: process.env.AWS_REGION || 'us-east-1',
            temperature: 0.5,
            maxTokens: 8000,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
            },
        }));

        // Autonomous Decision Engine - Nova Pro on Bedrock for autonomous capabilities
        this.langchainModels.set('autonomous_engine', new ChatBedrockConverse({
            model: 'amazon.nova-pro-v1:0',
            region: process.env.AWS_REGION || 'us-east-1',
            temperature: 0.9,
            maxTokens: 6000,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
            },
        }));

        // User Input Coordinator - Nova Lite on Bedrock for dynamic input collection
        this.langchainModels.set('input_coordinator', new ChatBedrockConverse({
            model: 'amazon.nova-lite-v1:0',
            region: process.env.AWS_REGION || 'us-east-1',
            temperature: 0.7,
            maxTokens: 4000,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
            },
        }));

        loggingService.info('🤖 Langchain models initialized (ALL AWS BEDROCK)', {
            modelCount: this.langchainModels.size,
            models: [
                'Claude 3.5 Sonnet (Master, Google, GitHub)',
                'Claude 3.5 Haiku (Strategy)',
                'Nova Pro (AWS, Autonomous)',
                'Nova Lite (User Input)'
            ]
        });
    }

    /**
     * Create specialized Langchain agents
     */
    private static createLangchainAgents(): void {
        const agentConfigs: LangchainAgentConfig[] = [
            {
                name: 'master_coordinator',
                type: 'coordinator',
                model: 'claude',
                specialization: 'Master coordination and orchestration',
                tools: [],
                autonomyLevel: 'high',
                systemPrompt: `You are the Master Coordinator Agent in a world-class multi-agent system. Your role:
1. Analyze user requests and orchestrate appropriate specialist agents
2. Collect user input strategically to form comprehensive strategies
3. Make autonomous decisions when sufficient context is available
4. Ensure seamless integration across all services (AWS, Google, GitHub)
5. Go beyond simple responses to provide intelligent, proactive assistance
6. Coordinate with specialist agents using advanced reasoning
7. Implement dynamic user input collection for strategy formation`
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
7. Coordinate with other agents to execute complex multi-step strategies`
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
7. Make autonomous decisions for cost optimization within user parameters`
            },
            {
                name: 'google_integration_agent',
                type: 'integration',
                model: 'gpt4',
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
7. Make intelligent decisions for workspace optimization`
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
7. Make autonomous decisions for code optimization and deployment strategies`
            },
            {
                name: 'autonomous_decision_agent',
                type: 'autonomous',
                model: 'gpt4',
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
7. Provide world-class AI assistance that goes far beyond traditional chatbots`
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
7. Implement intelligent follow-up questions and clarification requests`
            }
        ];

        // Create agents (simplified for now, can be enhanced with actual tools)
        for (const config of agentConfigs) {
            const model = this.langchainModels.get(config.name);
            if (!model) continue;

            // For now, create simple chat-based agents
            // In production, these would be enhanced with proper tool integration
            const agent = {
                name: config.name,
                model: model,
                config: config,
                invoke: async (messages: BaseMessage[]) => {
                    const systemMessage = new SystemMessage(config.systemPrompt);
                    const allMessages = [systemMessage, ...messages];
                    return await model.invoke(allMessages);
                }
            };

            this.langchainAgents.set(config.name, agent as any);
        }

        loggingService.info('🤖 Langchain agents created', {
            agentCount: this.langchainAgents.size,
            agents: Array.from(this.langchainAgents.keys())
        });
    }

    /**
     * Build Langchain State Graph for multi-agent coordination
     */
    private static buildLangchainGraph(): void {
        const workflow = new StateGraph(LangchainChatState)
            .addNode('coordinator', this.coordinatorAgent.bind(this))
            .addNode('strategy_formation', this.strategyFormationAgent.bind(this))
            .addNode('user_input_collection', this.userInputCollectionAgent.bind(this))
            .addNode('aws_integration', this.awsIntegrationAgent.bind(this))
            .addNode('google_integration', this.googleIntegrationAgent.bind(this))
            .addNode('github_integration', this.githubIntegrationAgent.bind(this))
            .addNode('autonomous_decision', this.autonomousDecisionAgent.bind(this))
            .addNode('response_synthesis', this.responseSynthesisAgent.bind(this))
            
            // Enhanced routing with world-class capabilities
            .addEdge('__start__', 'coordinator')
            .addConditionalEdges('coordinator', this.routeFromCoordinator.bind(this), [
                'strategy_formation',
                'user_input_collection',
                'aws_integration',
                'google_integration',
                'github_integration',
                'autonomous_decision'
            ])
            .addConditionalEdges('strategy_formation', this.routeFromStrategy.bind(this), [
                'user_input_collection',
                'autonomous_decision',
                'response_synthesis'
            ])
            .addConditionalEdges('user_input_collection', this.routeFromUserInput.bind(this), [
                'strategy_formation',
                'aws_integration',
                'google_integration',
                'github_integration',
                'response_synthesis'
            ])
            .addConditionalEdges('aws_integration', this.routeFromIntegration.bind(this), [
                'google_integration',
                'github_integration',
                'response_synthesis'
            ])
            .addConditionalEdges('google_integration', this.routeFromIntegration.bind(this), [
                'aws_integration',
                'github_integration',
                'response_synthesis'
            ])
            .addConditionalEdges('github_integration', this.routeFromIntegration.bind(this), [
                'aws_integration',
                'google_integration',
                'response_synthesis'
            ])
            .addConditionalEdges('autonomous_decision', this.routeFromAutonomous.bind(this), [
                'aws_integration',
                'google_integration',
                'github_integration',
                'response_synthesis'
            ])
            .addEdge('response_synthesis', '__end__');

        this.langchainGraph = workflow.compile() as any;
        loggingService.info('🌐 Langchain State Graph built with advanced multi-agent coordination');
    }

    // =================== LANGCHAIN AGENT IMPLEMENTATIONS ===================

    /**
     * Master Coordinator Agent - Orchestrates the entire system
     */
    private static async coordinatorAgent(state: LangchainChatStateType): Promise<Partial<LangchainChatStateType>> {
        try {
            loggingService.info('🧭 Master Coordinator analyzing request');
            
            const lastMessage = state.messages[state.messages.length - 1];
            const userMessage = lastMessage?.content as string || '';

            // Analyze user intent and determine strategy
            const agent = this.langchainAgents.get('master_coordinator');
            if (!agent) throw new Error('Master coordinator agent not found');

            const analysisPrompt = new HumanMessage(`Analyze this user request and determine the best coordination strategy:
            
            User Message: "${userMessage}"
            
            Consider:
            1. Does this require strategy formation through user input collection?
            2. Which integration services (AWS, Google, GitHub) might be needed?
            3. Can we make autonomous decisions or need more user input?
            4. What is the complexity and priority level?
            
            Respond with coordination analysis.`);

            const response = await agent.invoke([analysisPrompt]);
            const coordinationAnalysis = response.content as string;

            // Determine user intent based on analysis
            const userIntent = LangchainHelpers.analyzeUserIntent(userMessage, coordinationAnalysis);

            return {
                currentAgent: 'coordinator',
                userIntent,
                contextData: {
                    coordinationAnalysis,
                    complexity: LangchainHelpers.assessComplexity(userMessage),
                    requiresStrategy: userMessage.toLowerCase().includes('strategy') || userMessage.toLowerCase().includes('plan'),
                    requiresInput: LangchainHelpers.requiresUserInput(userMessage),
                    integrationNeeds: LangchainHelpers.identifyIntegrationNeeds(userMessage)
                },
                conversationDepth: (state.conversationDepth || 0) + 1,
                autonomousDecisions: [`Analyzed request: ${userIntent}`]
            };
        } catch (error) {
            loggingService.error('❌ Coordinator agent failed', { error });
            return { currentAgent: 'coordinator_error' };
        }
    }

    /**
     * Strategy Formation Agent - Creates comprehensive strategies
     */
    private static async strategyFormationAgent(state: LangchainChatStateType): Promise<Partial<LangchainChatStateType>> {
        try {
            loggingService.info('📋 Strategy Formation Agent creating comprehensive plan');
            
            const agent = this.langchainAgents.get('strategy_formation_agent');
            if (!agent) throw new Error('Strategy formation agent not found');

            const userMessage = state.messages[state.messages.length - 1]?.content as string || '';
            
            const strategyPrompt = new HumanMessage(`Create a comprehensive strategy for this user request:
            
            Request: "${userMessage}"
            User Intent: ${state.userIntent}
            Context: ${JSON.stringify(state.contextData, null, 2)}
            
            Generate:
            1. Strategic questions to understand user needs better
            2. Step-by-step action plan
            3. Required integrations and resources
            4. Success metrics and timelines
            5. Adaptive follow-up questions
            
            Focus on creating an actionable, intelligent strategy.`);

            const response = await agent.invoke([strategyPrompt]);
            const strategyContent = response.content as string;

            // Extract strategic questions (simplified extraction)
            const questions = LangchainHelpers.extractStrategicQuestions(strategyContent);
            
            return {
                currentAgent: 'strategy_formation',
                strategyFormation: {
                    questions,
                    responses: {},
                    currentQuestion: 0,
                    isComplete: false,
                    adaptiveQuestions: LangchainHelpers.generateAdaptiveQuestions(userMessage, state.contextData)
                },
                autonomousDecisions: [
                    ...(state.autonomousDecisions || []),
                    `Formed strategy with ${questions.length} key questions`
                ]
            };
        } catch (error) {
            loggingService.error('❌ Strategy formation agent failed', { error });
            return { currentAgent: 'strategy_error' };
        }
    }

    /**
     * User Input Collection Agent - Dynamic input gathering with IntegrationSelector support
     */
    private static async userInputCollectionAgent(state: LangchainChatStateType): Promise<Partial<LangchainChatStateType>> {
        try {
            loggingService.info('💬 User Input Collection Agent engaging');
            
            const agent = this.langchainAgents.get('user_input_coordinator');
            if (!agent) throw new Error('User input coordinator not found');

            const strategy = state.strategyFormation;
            if (!strategy || strategy.isComplete) {
                return { currentAgent: 'user_input_complete' };
            }

            // Get current question and context
            const currentQuestion = strategy.questions[strategy.currentQuestion];
            const previousResponses = strategy.responses;
            const userContext = state.contextData;
            
            // Determine if we need to generate options for IntegrationSelector
            const needsOptions = LangchainHelpers.shouldGenerateOptions(currentQuestion, userContext);
            
            if (needsOptions) {
                // Generate options for IntegrationSelector UI
                const optionsPrompt = new HumanMessage(`Generate options for user selection based on:
                
                Question: "${currentQuestion}"
                User Context: ${JSON.stringify(userContext, null, 2)}
                Previous Responses: ${JSON.stringify(previousResponses, null, 2)}
                
                Generate 3-5 relevant options that:
                1. Are specific and actionable
                2. Cover common use cases
                3. Allow for custom input if needed
                4. Include helpful descriptions
                
                Format as JSON array with: {id, label, value, description, icon}`);

                const optionsResponse = await agent.invoke([optionsPrompt]);
                const optionsContent = optionsResponse.content as string;
                
                // Parse options (in production, use proper JSON parsing)
                const options = LangchainHelpers.parseOptionsFromResponse(optionsContent);
                
                // Create IntegrationSelector-compatible response
                const sessionId = `${state.contextData.conversationId}_${Date.now()}`;
                this.userInputSessions.set(sessionId, {
                    state: state,
                    questionIndex: strategy.currentQuestion,
                    timestamp: new Date()
                });
                
                return {
                    currentAgent: 'user_input_collection',
                    messages: [new AIMessage(currentQuestion)],
                    userInputCollection: {
                        active: true,
                        currentField: {
                            type: 'selection',
                            sessionId: sessionId,
                            parameterName: LangchainHelpers.extractParameterName(currentQuestion),
                            question: currentQuestion,
                            options: options,
                            allowCustom: true,
                            customPlaceholder: 'Enter custom value...',
                            integration: 'strategy',
                            pendingAction: 'strategy_formation',
                            collectedParams: previousResponses
                        },
                        collectedData: previousResponses,
                        progress: Math.round(((strategy.currentQuestion + 1) / strategy.questions.length) * 100)
                    }
                };
            } else {
                // Generate conversational question without options
                const inputPrompt = new HumanMessage(`Generate an engaging follow-up question for strategic input collection:
                
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

                const response = await agent.invoke([inputPrompt]);
                const questionResponse = response.content as string;

                return {
                    currentAgent: 'user_input_collection',
                    messages: [new AIMessage(questionResponse)],
                    userInputCollection: {
                        active: true,
                        currentField: {
                            name: `question_${strategy.currentQuestion}`,
                            type: 'text',
                            label: currentQuestion,
                            required: true
                        },
                        collectedData: previousResponses,
                        progress: Math.round(((strategy.currentQuestion + 1) / strategy.questions.length) * 100)
                    },
                    strategyFormation: {
                        ...strategy,
                        currentQuestion: strategy.currentQuestion + 1
                    }
                };
            }
        } catch (error) {
            loggingService.error('❌ User input collection agent failed', { error });
            return { currentAgent: 'input_error' };
        }
    }

    /**
     * Determine if we should generate options for IntegrationSelector
     */
    private static shouldGenerateOptions(question: string, _context: any): boolean {
        const lowerQuestion = question.toLowerCase();
        
        // Questions that benefit from options
        const optionKeywords = [
            'which', 'choose', 'select', 'pick', 'prefer',
            'option', 'type of', 'kind of', 'category',
            'priority', 'level', 'mode', 'approach'
        ];
        
        return optionKeywords.some(keyword => lowerQuestion.includes(keyword));
    }

    /**
     * Parse options from AI response
     */
    private static parseOptionsFromResponse(content: string): Array<{
        id: string;
        label: string;
        value: string;
        description?: string;
        icon?: string;
    }> {
        try {
            // Try to extract JSON from response
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch (error) {
            loggingService.warn('Failed to parse options JSON', { error });
        }
        
        // Fallback: Generate default options
        return [
            {
                id: 'option1',
                label: 'High Priority',
                value: 'high',
                description: 'Critical tasks requiring immediate attention',
                icon: 'exclamation'
            },
            {
                id: 'option2',
                label: 'Medium Priority',
                value: 'medium',
                description: 'Important tasks with flexible timeline',
                icon: 'clock'
            },
            {
                id: 'option3',
                label: 'Low Priority',
                value: 'low',
                description: 'Nice-to-have improvements',
                icon: 'check'
            }
        ];
    }

    /**
     * Extract parameter name from question
     */
    private static extractParameterName(question: string): string {
        const lowerQuestion = question.toLowerCase();
        
        if (lowerQuestion.includes('priority')) return 'priority';
        if (lowerQuestion.includes('timeline')) return 'timeline';
        if (lowerQuestion.includes('budget')) return 'budget';
        if (lowerQuestion.includes('approach')) return 'approach';
        if (lowerQuestion.includes('integration')) return 'integration';
        if (lowerQuestion.includes('feature')) return 'feature';
        
        return 'parameter';
    }

    /**
     * AWS Integration Agent - Advanced AWS operations (using Vercel MCP)
     */
    private static async awsIntegrationAgent(state: LangchainChatStateType): Promise<Partial<LangchainChatStateType>> {
        try {
            loggingService.info('☁️ AWS Integration Agent executing via Vercel MCP');
            
            const userId = state.userId;
            const userMessage = state.userMessage;
            
            // Import MCP client
            const { MCPClientService } = await import('./mcp-client.service');
            
            // Initialize MCP with userId (JWT authentication)
            const initialized = await MCPClientService.initialize(userId);
            if (!initialized) {
                loggingService.warn('Failed to initialize MCP for AWS/Vercel agent', { userId });
                return {
                    currentAgent: 'aws_error',
                    integrationContext: {
                        ...state.integrationContext,
                        aws: {
                            error: 'Failed to initialize integration system',
                        }
                    }
                };
            }
            
            // Find Vercel tools for deployment operations
            const tools = await MCPClientService.findToolsForIntent(
                userId,
                userMessage,
                ['vercel'] // Using Vercel as the deployment platform
            );
            
            if (tools.length === 0) {
                loggingService.warn('No Vercel tools found for deployment intent', { userId, userMessage });
                return {
                    currentAgent: 'aws_integration',
                    integrationContext: {
                        ...state.integrationContext,
                        aws: {
                            summary: 'No deployment tools available for this request',
                            autonomous: false
                        }
                    }
                };
            }
            
            // Execute the most relevant tool via MCP
            const result = await MCPClientService.executeWithAI(
                userId,
                tools[0].name,
                userMessage,
                state.contextData
            );
            
            if (!result.success) {
                loggingService.error('Vercel MCP tool execution failed', {
                    error: result.error,
                    tool: tools[0].name
                });
                return {
                    currentAgent: 'aws_error',
                    integrationContext: {
                        ...state.integrationContext,
                        aws: {
                            error: result.error?.message || 'Failed to execute deployment action',
                        }
                    }
                };
            }
            
            return {
                currentAgent: 'aws_integration',
                integrationContext: {
                    ...state.integrationContext,
                    aws: {
                        actions: result.data?.message || 'Deployment action completed',
                        summary: 'Deployment operations executed via Vercel MCP',
                        optimizations: ['vercel_deployment'],
                        autonomous: true,
                        result: result.data
                    }
                },
                autonomousDecisions: [
                    ...(state.autonomousDecisions || []),
                    `Executed Vercel ${tools[0].name} via MCP`
                ]
            };
        } catch (error) {
            loggingService.error('❌ AWS/Vercel integration agent failed', { error });
            return { currentAgent: 'aws_error' };
        }
    }

    /**
     * Google Integration Agent - Comprehensive Google services
     */
    private static async googleIntegrationAgent(state: LangchainChatStateType): Promise<Partial<LangchainChatStateType>> {
        try {
            loggingService.info('🔍 Google Integration Agent executing via MCP');
            
            const userId = state.userId;
            const userMessage = state.userMessage;
            
            // Import MCP client
            const { MCPClientService } = await import('./mcp-client.service');
            
            // Initialize MCP with userId (JWT authentication)
            const initialized = await MCPClientService.initialize(userId);
            if (!initialized) {
                loggingService.warn('Failed to initialize MCP for Google agent', { userId });
                return {
                    currentAgent: 'google_error',
                    integrationContext: {
                        ...state.integrationContext,
                        google: {
                            error: 'Failed to initialize integration system',
                        }
                    }
                };
            }
            
            // Find Google tools for the intent
            const tools = await MCPClientService.findToolsForIntent(
                userId,
                userMessage,
                ['google']
            );
            
            if (tools.length === 0) {
                loggingService.warn('No Google tools found for intent', { userId, userMessage });
                return {
                    currentAgent: 'google_integration',
                    integrationContext: {
                        ...state.integrationContext,
                        google: {
                            summary: 'No Google Workspace tools available for this request',
                            autonomous: false
                        }
                    }
                };
            }
            
            // Execute the most relevant tool via MCP
            const result = await MCPClientService.executeWithAI(
                userId,
                tools[0].name,
                userMessage,
                state.contextData
            );
            
            if (!result.success) {
                loggingService.error('Google MCP tool execution failed', {
                    error: result.error,
                    tool: tools[0].name
                });
                return {
                    currentAgent: 'google_error',
                    integrationContext: {
                        ...state.integrationContext,
                        google: {
                            error: result.error?.message || 'Failed to execute Google Workspace action',
                        }
                    }
                };
            }
            
            return {
                currentAgent: 'google_integration',
                integrationContext: {
                    ...state.integrationContext,
                    google: {
                        actions: result.data?.message || 'Google Workspace action completed',
                        summary: 'Google Workspace operations executed via MCP',
                        services: ['mcp_execution'],
                        autonomous: true,
                        result: result.data
                    }
                },
                autonomousDecisions: [
                    ...(state.autonomousDecisions || []),
                    `Executed Google ${tools[0].name} via MCP`
                ]
            };
        } catch (error) {
            loggingService.error('❌ Google integration agent failed', { error });
            return { currentAgent: 'google_error' };
        }
    }

    /**
     * GitHub Integration Agent - Advanced development workflows
     */
    private static async githubIntegrationAgent(state: LangchainChatStateType): Promise<Partial<LangchainChatStateType>> {
        try {
            loggingService.info('🐙 GitHub Integration Agent executing via MCP');
            
            const userId = state.userId;
            const userMessage = state.userMessage;
            
            // Import MCP client
            const { MCPClientService } = await import('./mcp-client.service');
            
            // Initialize MCP with userId (JWT authentication)
            const initialized = await MCPClientService.initialize(userId);
            if (!initialized) {
                loggingService.warn('Failed to initialize MCP for GitHub agent', { userId });
                return {
                    currentAgent: 'github_error',
                    integrationContext: {
                        ...state.integrationContext,
                        github: {
                            error: 'Failed to initialize integration system',
                        }
                    }
                };
            }
            
            // Find GitHub tools for the intent
            const tools = await MCPClientService.findToolsForIntent(
                userId,
                userMessage,
                ['github']
            );
            
            if (tools.length === 0) {
                loggingService.warn('No GitHub tools found for intent', { userId, userMessage });
                return {
                    currentAgent: 'github_integration',
                    integrationContext: {
                        ...state.integrationContext,
                        github: {
                            summary: 'No GitHub tools available for this request',
                            autonomous: false
                        }
                    }
                };
            }
            
            // Execute the most relevant tool via MCP
            const result = await MCPClientService.executeWithAI(
                userId,
                tools[0].name,
                userMessage,
                state.contextData
            );
            
            if (!result.success) {
                loggingService.error('GitHub MCP tool execution failed', {
                    error: result.error,
                    tool: tools[0].name
                });
                return {
                    currentAgent: 'github_error',
                    integrationContext: {
                        ...state.integrationContext,
                        github: {
                            error: result.error?.message || 'Failed to execute GitHub action',
                        }
                    }
                };
            }
            
            return {
                currentAgent: 'github_integration',
                integrationContext: {
                    ...state.integrationContext,
                    github: {
                        actions: result.data?.message || 'GitHub action completed',
                        summary: 'GitHub operations executed via MCP',
                        workflows: ['mcp_execution'],
                        autonomous: true,
                        result: result.data
                    }
                },
                autonomousDecisions: [
                    ...(state.autonomousDecisions || []),
                    `Executed GitHub ${tools[0].name} via MCP`
                ]
            };
        } catch (error) {
            loggingService.error('❌ GitHub integration agent failed', { error });
            return { currentAgent: 'github_error' };
        }
    }

    /**
     * Autonomous Decision Agent - Full autonomy AI operations
     */
    private static async autonomousDecisionAgent(state: LangchainChatStateType): Promise<Partial<LangchainChatStateType>> {
        try {
            loggingService.info('🤖 Autonomous Decision Agent making intelligent decisions');
            
            // Use the master coordinator model for autonomous decisions
            const model = this.langchainModels.get('master_coordinator');
            if (!model) throw new Error('Master coordinator model not found');

            // Analyze current state for autonomous actions
            const autonomousContext = {
                userIntent: state.userIntent,
                contextData: state.contextData,
                integrations: state.integrationContext,
                conversationDepth: state.conversationDepth,
                previousDecisions: state.autonomousDecisions || [],
                userPreferences: await this.getUserPreferences(state.contextData?.userId)
            };

            // Determine autonomous actions based on context
            const autonomousActions = await LangchainHelpers.determineAutonomousActions(autonomousContext);
            
            // Execute autonomous workflows
            const executionResults = await LangchainHelpers.executeAutonomousWorkflows(autonomousActions, state);

            // Generate proactive insights
            const proactiveInsights = LangchainHelpers.generateProactiveInsights(state);
            
            // Predict next user needs
            const predictedNeeds = await LangchainHelpers.predictUserNeeds(state);
            
            // Generate autonomous response
            const autonomousPrompt = new HumanMessage(`Based on the analysis, generate intelligent autonomous actions:
            
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
            const autonomousResponse = response.content as string;

            return {
                currentAgent: 'autonomous_decision',
                autonomousDecisions: [
                    ...(state.autonomousDecisions || []),
                    ...autonomousActions.map(a => `Executed: ${a.action}`),
                    autonomousResponse
                ],
                proactiveInsights: [
                    ...proactiveInsights,
                    ...predictedNeeds.map(n => `Predicted need: ${n}`)
                ],
                taskPriority: LangchainHelpers.calculateTaskPriority(state),
                worldClassFeatures: {
                    ...state.worldClassFeatures,
                    emotionalIntelligence: true,
                    contextualMemory: true,
                    predictiveAnalytics: true,
                    crossModalUnderstanding: true,
                }
            };
        } catch (error) {
            loggingService.error('❌ Autonomous decision agent failed', { error });
            return { currentAgent: 'autonomous_error' };
        }
    }

    /**
     * Response Synthesis Agent - World-class response generation
     */
    private static async responseSynthesisAgent(state: LangchainChatStateType): Promise<Partial<LangchainChatStateType>> {
        try {
            loggingService.info('🎨 Response Synthesis Agent creating world-class response');
            
            const agent = this.langchainAgents.get('master_coordinator');
            if (!agent) throw new Error('Response synthesis agent not found');

            const synthesisPrompt = new HumanMessage(`Synthesize a world-class response that demonstrates advanced AI capabilities:
            
            Original Request: ${state.messages[0]?.content}
            User Intent: ${state.userIntent}
            
            Agent Coordination Results:
            - AWS Integration: ${JSON.stringify(state.integrationContext?.aws, null, 2)}
            - Google Integration: ${JSON.stringify(state.integrationContext?.google, null, 2)}
            - GitHub Integration: ${JSON.stringify(state.integrationContext?.github, null, 2)}
            - Autonomous Decisions: ${state.autonomousDecisions?.join('; ')}
            - Proactive Insights: ${state.proactiveInsights?.join('; ')}
            - Strategy Formation: ${JSON.stringify(state.strategyFormation, null, 2)}
            
            Create a comprehensive response that:
            1. Directly addresses the user's request with intelligence
            2. Incorporates insights from all relevant agents
            3. Demonstrates autonomous capabilities and proactive thinking
            4. Provides actionable recommendations and next steps
            5. Shows cross-system coordination and optimization
            6. Goes beyond simple chatbot responses to provide genuine value
            7. Maintains conversational flow while showcasing advanced AI capabilities
            
            Generate a response that represents the pinnacle of AI assistance.`);

            const response = await agent.invoke([synthesisPrompt]);
            const worldClassResponse = response.content as string;

            return {
                currentAgent: 'response_synthesis',
                messages: [new AIMessage(worldClassResponse)]
            };
        } catch (error) {
            loggingService.error('❌ Response synthesis agent failed', { error });
            return {
                currentAgent: 'synthesis_error',
                messages: [new AIMessage('I encountered an issue generating the response, but I\'ve processed your request using advanced multi-agent coordination.')]
            };
        }
    }

    // =================== ROUTING METHODS ===================

    /**
     * Route from Coordinator based on analysis
     */
    private static routeFromCoordinator(state: LangchainChatStateType): string {
        const context = state.contextData;
        const intent = state.userIntent;
        
        // Prioritize strategy formation for complex requests
        if (context?.requiresStrategy || intent?.includes('strategy') || intent?.includes('plan')) {
            return 'strategy_formation';
        }
        
        // Route to specific integrations based on context
        if (context?.integrationNeeds?.includes('aws') || intent?.includes('aws') || intent?.includes('cost')) {
            return 'aws_integration';
        }
        if (context?.integrationNeeds?.includes('google') || intent?.includes('google') || intent?.includes('workspace')) {
            return 'google_integration';
        }
        if (context?.integrationNeeds?.includes('github') || intent?.includes('github') || intent?.includes('code')) {
            return 'github_integration';
        }
        
        // Route to user input collection if more information is needed
        if (context?.requiresInput) {
            return 'user_input_collection';
        }
        
        // Use GAN coordination for complex multi-agent scenarios
        if ((state.conversationDepth || 0) > 2 && context?.complexity === 'high') {
            return 'gan_coordination';
        }
        
        // Default to autonomous decision making
        return 'autonomous_decision';
    }

    private static routeFromStrategy(state: LangchainChatStateType): string {
        const strategy = state.strategyFormation;
        
        if (!strategy?.isComplete && strategy?.questions && strategy.questions.length > 0) {
            return 'user_input_collection';
        }
        if (state.contextData?.integrationNeeds?.length > 0) {
            return 'autonomous_decision';
        }
        return 'response_synthesis';
    }

    private static routeFromUserInput(state: LangchainChatStateType): string {
        const inputState = state.userInputCollection;
        const strategy = state.strategyFormation;
        
        if (strategy?.isComplete || (inputState?.progress || 0) >= 100) {
            // Input collection complete, route to integrations
            const needs = state.contextData?.integrationNeeds || [];
            if (needs.includes('aws')) return 'aws_integration';
            if (needs.includes('google')) return 'google_integration';
            if (needs.includes('github')) return 'github_integration';
            return 'response_synthesis';
        }
        return 'strategy_formation';
    }

    private static routeFromIntegration(state: LangchainChatStateType): string {
        const integrations = state.integrationContext;
        const needs = state.contextData?.integrationNeeds || [];
        
        // Check if we need other integrations
        if (needs.includes('aws') && !integrations?.aws) return 'aws_integration';
        if (needs.includes('google') && !integrations?.google) return 'google_integration';  
        if (needs.includes('github') && !integrations?.github) return 'github_integration';
        
        return 'response_synthesis';
    }

    private static routeFromAutonomous(state: LangchainChatStateType): string {
        const decisions = state.autonomousDecisions || [];
        
        // Route based on autonomous decisions
        if (decisions.some(d => d.includes('aws'))) return 'aws_integration';
        if (decisions.some(d => d.includes('google'))) return 'google_integration';
        if (decisions.some(d => d.includes('github'))) return 'github_integration';
        
        return 'response_synthesis';
    }

    // =================== HELPER METHODS (for Langchain Integration Agents) ===================

    /**
     * Get user preferences with AI-enhanced analysis using AWS Bedrock Nova Lite
     * Production-quality preference inference using actual user data
     */
    private static async getUserPreferences(userId: string): Promise<any> {
        try {
            // Fetch actual user usage history from database
            const { Usage } = await import('../models/Usage');
            
            const usageData = await Usage.find({ userId }).sort({ createdAt: -1 }).limit(100).lean();
            
            // Analyze usage patterns for AI inference
            const usageSummary = this.analyzeUsagePatterns(usageData);
            
            const llm = new ChatBedrockConverse({
                model: 'amazon.nova-lite-v1:0',
                region: process.env.AWS_REGION || 'us-east-1',
                temperature: 0.3,
                maxTokens: 800,
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
                },
            });

            const preferencePrompt = new HumanMessage(`Analyze user behavior and infer intelligent preferences for an AI cost optimization platform user.

User Data Analysis:
- User ID: ${userId}
- Top Used Models: ${usageSummary.topModels.join(', ') || 'None yet'}
- Average Daily Requests: ${usageSummary.avgDailyRequests}
- Average Cost Per Request: $${usageSummary.avgCostPerRequest.toFixed(4)}
- Total Spend (Last 30 days): $${usageSummary.totalSpend.toFixed(2)}
- Most Active Hours: ${usageSummary.peakHours.join(', ') || 'N/A'}
- Cost Sensitivity: ${usageSummary.costSensitivity}

Based on this ACTUAL user behavior, generate personalized preferences:

Return a JSON object with this structure:
{
  "preferredModels": ["model-id-1", "model-id-2"],
  "chatMode": "fastest" | "cheapest" | "balanced",
  "automationLevel": "low" | "medium" | "high",
  "notificationPreferences": {
    "costAlerts": boolean,
    "optimizationTips": boolean,
    "weeklyReports": boolean
  },
  "workingHours": "9-5 EST",
  "costSensitivity": "low" | "medium" | "high"
}

Use the actual usage data to make intelligent inferences. Return ONLY the JSON object.`);

            const response = await llm.invoke([preferencePrompt]);
            const responseText = response.content.toString().trim();
            
            let preferences: any = {
                preferredModels: usageSummary.topModels.slice(0, 2).length > 0 
                    ? usageSummary.topModels.slice(0, 2)
                    : ['us.anthropic.claude-opus-4-1-20250805-v1:0', 'us.amazon.nova-pro-v1:0'],
                chatMode: usageSummary.preferredChatMode || 'balanced',
                automationLevel: 'high',
                notificationPreferences: {
                    costAlerts: usageSummary.costSensitivity === 'high',
                    optimizationTips: true,
                    weeklyReports: usageSummary.totalSpend > 10
                },
                workingHours: usageSummary.workingHours || '9-5 EST',
                costSensitivity: usageSummary.costSensitivity
            };
            
            try {
                const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    // Merge AI insights with actual usage data (AI takes precedence)
                    preferences = { ...preferences, ...parsed };
                }
            } catch (parseError) {
                loggingService.warn('Failed to parse AI preferences, using usage-based defaults', {
                    error: parseError instanceof Error ? parseError.message : String(parseError)
                });
            }

            loggingService.info('User preferences retrieved with AI analysis', {
                userId,
                chatMode: preferences.chatMode,
                automationLevel: preferences.automationLevel,
                basedOnUsageRecords: usageData?.length || 0
            });

            return preferences;

        } catch (error) {
            loggingService.error('Failed to get user preferences', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            
            // Return safe defaults
            return {
                preferredModels: ['us.anthropic.claude-opus-4-1-20250805-v1:0', 'us.amazon.nova-pro-v1:0'],
                chatMode: 'balanced',
                automationLevel: 'medium',
                notificationPreferences: {
                    costAlerts: true,
                    optimizationTips: true,
                    weeklyReports: false
                },
                workingHours: '9-5 EST',
                costSensitivity: 'medium'
            };
        }
    }

    /**
     * Analyze usage patterns from user data
     * Helper method for getUserPreferences
     */
    private static analyzeUsagePatterns(usageData: any[]): {
        topModels: string[];
        avgDailyRequests: number;
        avgCostPerRequest: number;
        totalSpend: number;
        peakHours: number[];
        costSensitivity: 'low' | 'medium' | 'high';
        preferredChatMode: 'fastest' | 'cheapest' | 'balanced';
        workingHours: string;
    } {
        if (!usageData || usageData.length === 0) {
            return {
                topModels: [],
                avgDailyRequests: 0,
                avgCostPerRequest: 0,
                totalSpend: 0,
                peakHours: [],
                costSensitivity: 'medium',
                preferredChatMode: 'balanced',
                workingHours: '9-5 EST'
            };
        }

        // Analyze model usage frequency
        const modelCounts: Record<string, number> = {};
        let totalCost = 0;
        const hourCounts: Record<number, number> = {};

        usageData.forEach((usage: any) => {
            const model = usage.model || 'unknown';
            modelCounts[model] = (modelCounts[model] || 0) + 1;
            totalCost += usage.cost || 0;

            // Track usage by hour
            const hour = new Date(usage.createdAt).getHours();
            hourCounts[hour] = (hourCounts[hour] || 0) + 1;
        });

        // Get top 3 most used models
        const topModels = Object.entries(modelCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 3)
            .map(([model]) => model);

        // Calculate average daily requests (last 30 days)
        const oldestDate = usageData[usageData.length - 1]?.createdAt;
        const daysSinceOldest = oldestDate 
            ? Math.max(1, Math.ceil((Date.now() - new Date(oldestDate).getTime()) / (1000 * 60 * 60 * 24)))
            : 30;
        const avgDailyRequests = Math.round(usageData.length / Math.min(daysSinceOldest, 30));

        // Calculate average cost per request
        const avgCostPerRequest = usageData.length > 0 ? totalCost / usageData.length : 0;

        // Determine peak usage hours
        const peakHours = Object.entries(hourCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 3)
            .map(([hour]) => parseInt(hour));

        // Infer cost sensitivity based on spending patterns
        let costSensitivity: 'low' | 'medium' | 'high' = 'medium';
        if (avgCostPerRequest < 0.001) {
            costSensitivity = 'high'; // Uses cheap models
        } else if (avgCostPerRequest > 0.01) {
            costSensitivity = 'low'; // Uses expensive models
        }

        // Infer preferred chat mode based on model choices
        let preferredChatMode: 'fastest' | 'cheapest' | 'balanced' = 'balanced';
        const cheapModels = topModels.filter(m => m.includes('micro') || m.includes('lite'));
        const fastModels = topModels.filter(m => m.includes('haiku') || m.includes('nova'));
        
        if (cheapModels.length >= 2) {
            preferredChatMode = 'cheapest';
        } else if (fastModels.length >= 2) {
            preferredChatMode = 'fastest';
        }

        // Infer working hours from peak usage
        const workingHours = peakHours.length > 0 
            ? `${Math.min(...peakHours)}-${Math.max(...peakHours)} Local`
            : '9-5 EST';

        return {
            topModels,
            avgDailyRequests,
            avgCostPerRequest,
            totalSpend: totalCost,
            peakHours,
            costSensitivity,
            preferredChatMode,
            workingHours
        };
    }

    /**
     * Enhanced sendMessage method with Langchain Multi-Agent Integration
     */
    private static async processWithLangchainMultiAgent(
        request: ChatSendMessageRequest,
        conversation: IConversation,
        recentMessages: any[]
    ): Promise<{
        response: string;
        agentThinking?: any;
        agentPath: string[];
        optimizationsApplied: string[];
        cacheHit: boolean;
        riskLevel: string;
        strategyFormed?: any;
        autonomousActions?: string[];
        proactiveInsights?: string[];
        requiresSelection?: boolean;
        selection?: any;
        requiresIntegrationSelector?: boolean;
        integrationSelectorData?: any;
        metadata?: Record<string, any>;
        mongodbIntegrationData?: any;
        formattedResult?: any;
    }> {
        // Initialize Langchain system if needed
        if (!this.initialized) {
            await this.initializeLangchainSystem();
        }

        try {
            loggingService.info('🔄 Processing with Langchain Multi-Agent System', {
                userId: request.userId,
                useMultiAgent: request.useMultiAgent
            });

            loggingService.info('⚡ Using optimized multi-agent processing with autonomous web search');
            
            // Use NEW AgentService with autonomous web search decision-making
            try {
                const { AgentService } = await import('./agent.service');
                
                loggingService.info('🤖 Creating AgentService instance for autonomous web search');
                
                // Create AgentService instance
                const agentService = new AgentService();
                
                const agentResponse = await agentService.queryWithMultiLlm({
                    query: request.message || '',
                    userId: request.userId,
                    context: {
                        conversationId: conversation._id.toString(),
                        previousMessages: recentMessages,
                        documentIds: request.documentIds
                    }
                });
                
                loggingService.info('✅ AgentService.queryWithMultiLlm completed', {
                    success: agentResponse.success,
                    hasMetadata: !!agentResponse.metadata,
                    webSearchUsed: agentResponse.metadata?.webSearchUsed,
                    aiWebSearchDecision: agentResponse.metadata?.aiWebSearchDecision
                });
                
                const returnData = {
                    response: agentResponse.response || 'No response generated',
                    agentThinking: agentResponse.thinking,
                    agentPath: [],
                    optimizationsApplied: [],
                    cacheHit: agentResponse.metadata?.fromCache || false,
                    riskLevel: 'low',
                    requiresIntegrationSelector: false,
                    integrationSelectorData: undefined,
                    metadata: agentResponse.metadata,
                    // Extract web search metadata to top level for easier access
                    webSearchUsed: agentResponse.metadata?.webSearchUsed || false,
                    aiWebSearchDecision: agentResponse.metadata?.aiWebSearchDecision,
                    mongodbIntegrationData: undefined,
                    formattedResult: undefined
                };
                
                loggingService.info('📤 [FLOW-3] chat.service.processWithLangchainMultiAgent RETURNING with AgentService data', {
                    webSearchUsed: returnData.metadata?.webSearchUsed,
                    aiWebSearchDecision: returnData.metadata?.aiWebSearchDecision
                });
                
                return returnData;
                
            } catch (agentError) {
                loggingService.warn('⚠️ AgentService failed, falling back to MultiAgentFlowService', {
                    error: agentError instanceof Error ? agentError.message : String(agentError)
                });
                
                // Fallback to old LangGraph flow
                const multiAgentResult = await multiAgentFlowService.processMessage(
                    conversation._id.toString(),
                    request.userId,
                    request.message || '',
                    {
                        chatMode: (request.chatMode as any) || 'balanced',
                        costBudget: 0.10,
                        previousMessages: recentMessages,
                        selectionResponse: request.selectionResponse,
                        documentIds: request.documentIds
                    }
                );
                
                return {
                    response: multiAgentResult.response,
                    agentThinking: multiAgentResult.thinking,
                    agentPath: multiAgentResult.agentPath,
                    optimizationsApplied: multiAgentResult.optimizationsApplied,
                    cacheHit: multiAgentResult.cacheHit,
                    riskLevel: multiAgentResult.riskLevel,
                    requiresIntegrationSelector: multiAgentResult.requiresIntegrationSelector,
                    integrationSelectorData: multiAgentResult.integrationSelectorData,
                    metadata: multiAgentResult.metadata,
                    mongodbIntegrationData: multiAgentResult.mongodbIntegrationData,
                    formattedResult: multiAgentResult.formattedResult
                };
            }
        } catch (error) {
            loggingService.error('❌ Langchain multi-agent processing failed', {
                error: error instanceof Error ? error.message : String(error)
            });
            
            // Fallback to existing system
            return this.processWithFallback(request, conversation, recentMessages);
        }
    }


    // Circuit breaker for error handling
    private static errorCounts = new Map<string, number>();
    private static readonly MAX_ERRORS = 5;
    private static readonly ERROR_RESET_TIME = 5 * 60 * 1000; // 5 minutes


    /**
     * Process message with circuit breaker pattern
     */
    private static async processWithFallback(
        request: ChatSendMessageRequest,
        conversation: IConversation,
        recentMessages: any[]
    ): Promise<{ response: string; agentThinking?: any; agentPath: string[]; optimizationsApplied: string[]; cacheHit: boolean; riskLevel: string; requiresIntegrationSelector?: boolean; integrationSelectorData?: any; mongodbIntegrationData?: any; formattedResult?: any; webSearchUsed?: boolean; aiWebSearchDecision?: any; metadata?: any }> {
        
        const userId = request.userId;
        const errorKey = `${userId}-processing`;
        
        // Check circuit breaker
        if ((this.errorCounts.get(errorKey) || 0) >= this.MAX_ERRORS) {
            loggingService.warn('Circuit breaker open for user, using direct Bedrock', { userId });
            return this.directBedrockFallback(request, recentMessages);
        }
        
        try {
            // Try enhanced processing
            const processingResult = await this.tryEnhancedProcessing(request, conversation, recentMessages);
            
            loggingService.info('📥 [FLOW-6] chat.service.processWithFallback RECEIVED from tryEnhancedProcessing', {
                hasMongodbIntegrationData: !!processingResult.mongodbIntegrationData && Object.keys(processingResult.mongodbIntegrationData).length > 0,
                hasFormattedResult: !!processingResult.formattedResult && Object.keys(processingResult.formattedResult).length > 0,
                mongodbIntegrationDataKeys: processingResult.mongodbIntegrationData ? Object.keys(processingResult.mongodbIntegrationData) : [],
                formattedResultKeys: processingResult.formattedResult ? Object.keys(processingResult.formattedResult) : []
            });
            
            return processingResult;
        } catch (error) {
            // Increment error count
            this.errorCounts.set(errorKey, (this.errorCounts.get(errorKey) || 0) + 1);
            
            // Reset error count after timeout
            setTimeout(() => {
                this.errorCounts.delete(errorKey);
            }, this.ERROR_RESET_TIME);
            
            loggingService.warn('Enhanced processing failed, using Bedrock fallback', { 
                userId, 
                error: error instanceof Error ? error.message : String(error)
            });
            
            return this.directBedrockFallback(request, recentMessages);
        }
    }

    /**
     * Try enhanced processing (multi-agent or conversational flow)
     */
    private static async tryEnhancedProcessing(
        request: ChatSendMessageRequest,
        conversation: IConversation,
        recentMessages: any[]
    ): Promise<{ response: string; agentThinking?: any; agentPath: string[]; optimizationsApplied: string[]; cacheHit: boolean; riskLevel: string; requiresIntegrationSelector?: boolean; integrationSelectorData?: any; mongodbIntegrationData?: any; formattedResult?: any; webSearchUsed?: boolean; aiWebSearchDecision?: any; metadata?: any }> {
        
        // Use Langchain Multi-Agent System only if explicitly requested
        const shouldUseLangchain = request.useMultiAgent;
        
        if (shouldUseLangchain) {
            loggingService.info('🚀 Routing to Langchain Multi-Agent System', {
                useMultiAgent: request.useMultiAgent,
                message: request.message?.substring(0, 100)
            });
            
            const langchainResult = await this.processWithLangchainMultiAgent(
                request,
                conversation,
                recentMessages
            );
            
            loggingService.info('📥 [FLOW-4] chat.service.tryEnhancedProcessing RECEIVED from processWithLangchainMultiAgent', {
                hasMongodbIntegrationData: !!langchainResult.mongodbIntegrationData && Object.keys(langchainResult.mongodbIntegrationData).length > 0,
                hasFormattedResult: !!langchainResult.formattedResult && Object.keys(langchainResult.formattedResult).length > 0,
                mongodbIntegrationDataKeys: langchainResult.mongodbIntegrationData ? Object.keys(langchainResult.mongodbIntegrationData) : [],
                formattedResultKeys: langchainResult.formattedResult ? Object.keys(langchainResult.formattedResult) : []
            });

            // Convert Langchain result to expected format
            const returnData = {
                response: langchainResult.response,
                agentThinking: langchainResult.agentThinking,
                agentPath: langchainResult.agentPath,
                optimizationsApplied: langchainResult.optimizationsApplied,
                cacheHit: langchainResult.cacheHit,
                riskLevel: langchainResult.riskLevel,
                requiresIntegrationSelector: langchainResult.requiresIntegrationSelector,
                integrationSelectorData: langchainResult.integrationSelectorData,
                mongodbIntegrationData: langchainResult.mongodbIntegrationData,
                formattedResult: langchainResult.formattedResult,
                // Include web search metadata - extract from metadata if available
                webSearchUsed: (langchainResult as any).webSearchUsed || langchainResult.metadata?.webSearchUsed || false,
                aiWebSearchDecision: (langchainResult as any).aiWebSearchDecision || langchainResult.metadata?.aiWebSearchDecision,
                metadata: langchainResult.metadata
            };

            loggingService.info('📤 [FLOW-5] chat.service.tryEnhancedProcessing RETURNING', {
                hasMongodbIntegrationData: !!returnData.mongodbIntegrationData && Object.keys(returnData.mongodbIntegrationData).length > 0,
                hasFormattedResult: !!returnData.formattedResult && Object.keys(returnData.formattedResult).length > 0
            });

            return returnData;
        }
        
        // Build conversation context
        const context = ContextManager.buildContext(
            conversation._id.toString(),
            request.message || '',
            recentMessages
        );
        
        // Resolve coreference if needed
            const corefResult = await ContextManager.resolveCoreference(request.message || '', context, recentMessages);
        let resolvedMessage = request.message;
        
        if (corefResult.resolved && corefResult.subject && request.message) {
            resolvedMessage = request.message.replace(
                /\b(this|that|it|the package|the tool|the service)\b/gi,
                corefResult.subject
            );
            
            loggingService.info('🔗 Coreference resolved', {
                original: request.message,
                resolved: resolvedMessage,
                subject: corefResult.subject,
                confidence: corefResult.confidence,
                method: corefResult.method
            });
        }
        
        // If documentIds are provided, always route to knowledge_base for RAG
        let route: 'knowledge_base' | 'conversational_flow' | 'multi_agent' | 'web_scraper';
        if (request.documentIds && request.documentIds.length > 0) {
            route = 'knowledge_base';
            loggingService.info('📄 Routing to knowledge_base due to document context', {
                documentCount: request.documentIds.length
            });
        } else {
            // Use AI-powered routing instead of regex-based routing
            route = await RouteDecider.decide(context, resolvedMessage || '', request.userId, request.useWebSearch);
        }
        
        loggingService.info('🎯 Route decision', {
            route,
            subject: context.currentSubject,
            domain: context.lastDomain,
            confidence: context.subjectConfidence,
            intent: context.currentIntent,
            hasDocuments: !!request.documentIds?.length
        });
        
        // Build context preamble
        const contextPreamble = ContextOptimizer.buildPreamble(context, recentMessages);
        
        // Route to appropriate handler
        switch (route) {
            case 'knowledge_base':
                return await this.handleKnowledgeBaseRoute(request, context, contextPreamble, recentMessages);
            case 'web_scraper':
                return await this.handleWebScraperRoute(request, context, contextPreamble, recentMessages);
            case 'multi_agent':
                return await this.handleMultiAgentRoute(request, context, contextPreamble, recentMessages);
            case 'conversational_flow':
            default:
                return await this.handleConversationalFlowRoute(request, context, contextPreamble, recentMessages);
        }
    }

    private static async handleKnowledgeBaseRoute(
        request: ChatSendMessageRequest,
        context: ConversationContext,
        contextPreamble: string,
        recentMessages: any[]
    ): Promise<{ response: string; agentThinking?: any; agentPath: string[]; optimizationsApplied: string[]; cacheHit: boolean; riskLevel: string }> {
        // Delegate to KnowledgeBaseHandler
        return await KnowledgeBaseHandler.handle(
            this.convertToHandlerRequest(request),
            context,
            contextPreamble,
            recentMessages
        );
    }

    private static async handleWebScraperRoute(
        request: ChatSendMessageRequest,
        context: ConversationContext,
        contextPreamble: string,
        recentMessages: any[]
    ): Promise<{ response: string; agentThinking?: any; agentPath: string[]; optimizationsApplied: string[]; cacheHit: boolean; riskLevel: string; webSearchUsed?: boolean; quotaUsed?: number }> {
        // Delegate to WebScraperHandler
        return await WebScraperHandler.handle(
            this.convertToHandlerRequest(request),
            context,
            contextPreamble,
            recentMessages
        );
    }


    private static async handleMultiAgentRoute(
        request: ChatSendMessageRequest,
        context: ConversationContext,
        contextPreamble: string,
        recentMessages: any[]
    ): Promise<{ response: string; agentThinking?: any; agentPath: string[]; optimizationsApplied: string[]; cacheHit: boolean; riskLevel: string }> {
        // Delegate to MultiAgentHandler
        return await MultiAgentHandler.handle(
            this.convertToHandlerRequest(request),
            context,
            contextPreamble,
            recentMessages
        );
    }

    private static async handleConversationalFlowRoute(
        request: ChatSendMessageRequest,
        context: ConversationContext,
        contextPreamble: string,
        recentMessages: any[]
    ): Promise<{ response: string; agentThinking?: any; agentPath: string[]; optimizationsApplied: string[]; cacheHit: boolean; riskLevel: string }> {
        // Delegate to ConversationalFlowHandler
        return await ConversationalFlowHandler.handle(
            this.convertToHandlerRequest(request),
            context,
            contextPreamble,
            recentMessages
        );
    }

    /**
     * Direct Bedrock fallback with ChatGPT-style context
     */
    private static async directBedrockFallback(
        request: ChatSendMessageRequest,
        recentMessages: any[]
    ): Promise<{ response: string; agentThinking?: any; agentPath: string[]; optimizationsApplied: string[]; cacheHit: boolean; riskLevel: string }> {
        // Delegate to FallbackHandler
        return await FallbackHandler.directBedrock(
            this.convertToHandlerRequest(request),
            recentMessages
        );
    }

    /**
     * Handle MCP route for integration requests
     */
    private static async handleMCPRoute(
        request: ChatSendMessageRequest,
        context: ConversationContext,
        recentMessages: any[]
    ): Promise<{
        response: string;
        agentPath: string[];
        optimizationsApplied: string[];
        cacheHit: boolean;
        riskLevel: string;
        mongodbIntegrationData?: any;
        formattedResult?: any;
        githubIntegrationData?: any;
        vercelIntegrationData?: any;
        slackIntegrationData?: any;
        discordIntegrationData?: any;
        jiraIntegrationData?: any;
        linearIntegrationData?: any;
        googleIntegrationData?: any;
        awsIntegrationData?: any;
        requiresConnection?: {
            integration: string;
            message: string;
            connectUrl: string;
        };
        requiresSelection?: boolean;
        selection?: {
            parameterName: string;
            question: string;
            options: Array<{
                id: string;
                label: string;
                value: string;
                description?: string;
                icon?: string;
            }>;
            allowCustom: boolean;
            customPlaceholder?: string;
            integration: string;
            pendingAction: string;
            collectedParams: Record<string, unknown>;
            originalMessage?: string;
        };
    }> {
        try {
            loggingService.info('Starting MCP route handling', {
                userId: request.userId,
                message: request.message?.substring(0, 100),
            });

            // 1. Detect which integrations are needed
            const integrationIntent = await IntegrationDetector.detect(
                request.message || '',
                request.userId
            );

            if (!integrationIntent.needsIntegration) {
                loggingService.info('No integration needed, falling back to direct response');
                return this.directBedrockFallback(request, recentMessages);
            }

            // 2. Check if all required integrations are connected
            for (const integration of integrationIntent.integrations) {
                const connectionStatus = await ConnectionChecker.check(
                    request.userId,
                    integration
                );

                if (!connectionStatus.isConnected) {
                    loggingService.info('Integration not connected', {
                        userId: request.userId,
                        integration,
                    });

                    const integrationDisplayName = integration.charAt(0).toUpperCase() + integration.slice(1);
                    
                    return {
                        response: `To use ${integrationDisplayName} features, you need to connect your ${integrationDisplayName} account first. Please visit the integrations page to connect.`,
                        agentPath: ['mcp_connection_required'],
                        optimizationsApplied: [],
                        cacheHit: false,
                        riskLevel: 'low',
                        requiresConnection: {
                            integration,
                            message: `${integrationDisplayName} connection required`,
                            connectUrl: `/integrations?connect=${integration}`,
                        },
                    };
                }
            }

            // 3. Initialize MCP for user (using JWT authentication)
            const { MCPClientService } = await import('./mcp-client.service');
            const initialized = await MCPClientService.initialize(request.userId);
            
            if (!initialized) {
                loggingService.error('Failed to initialize MCP', { userId: request.userId });
                return {
                    response: 'Failed to initialize integration system. Please try again.',
                    agentPath: ['mcp_init_failed'],
                    optimizationsApplied: [],
                    cacheHit: false,
                    riskLevel: 'low',
                };
            }

            // 4. Discover available tools
            const availableTools = await MCPClientService.discoverTools(request.userId);
            
            if (availableTools.length === 0) {
                loggingService.warn('No MCP tools available', { userId: request.userId });
                return this.directBedrockFallback(request, recentMessages);
            }

            // 6. Find relevant tools for the intent
            const relevantTools = await MCPClientService.findToolsForIntent(
                request.userId,
                request.message || '',
                integrationIntent.integrations
            );

            if (relevantTools.length === 0) {
                loggingService.warn('No relevant tools found for intent', {
                    userId: request.userId,
                    integrations: integrationIntent.integrations,
                });
                return this.directBedrockFallback(request, recentMessages);
            }

            // 7. Execute the most relevant tool with AI
            const toolToExecute = relevantTools[0];
            loggingService.info('Executing MCP tool', {
                userId: request.userId,
                tool: toolToExecute.name,
                integration: integrationIntent.integrations[0],
            });

            const mcpResult = await MCPClientService.executeWithAI(
                request.userId,
                toolToExecute.name,
                request.message || '',
                {
                    conversationId: context.conversationId,
                    recentMessages: recentMessages.slice(-5),
                    mongodbContext: request.mongodbContext,
                    githubContext: request.githubContext,
                    vercelContext: request.vercelContext,
                }
            );

            // 8. Format results appropriately
            if (!mcpResult.success) {
                loggingService.error('MCP tool execution failed', {
                    userId: request.userId,
                    tool: toolToExecute.name,
                    error: mcpResult.error,
                });

                // Check if this is a missing parameter error that should trigger IntegrationSelector
                // Parse error message to detect missing parameters
                const errorMessage = mcpResult.error?.message || 'Failed to execute integration action';
                const missingParamMatch = errorMessage.match(/Missing required parameters?: (.+)/i);
                
                if (missingParamMatch) {
                    // Extract missing parameters from error message
                    const missingParams = missingParamMatch[1].split(/,?\s+and\s+|,\s+/).map(p => p.trim());
                    const integration = integrationIntent.integrations[0]; // Get the primary integration
                    
                    loggingService.info('MCP detected missing parameters, triggering IntegrationSelector', {
                        integration,
                        missingParams,
                        toolName: toolToExecute.name,
                    });

                    // Use IntegrationAgent to handle parameter collection
                    const { IntegrationAgentService } = await import('./integrationAgent.service');
                    const agentResult = await IntegrationAgentService.processIntegrationCommand({
                        message: request.message || '',
                        integration,
                        userId: request.userId,
                    });

                    // If agent returns requiresSelection, propagate it
                    if (agentResult.requiresSelection && agentResult.selection) {
                        return {
                            response: agentResult.message || errorMessage,
                            agentPath: ['mcp', 'integration_agent', 'parameter_collection'],
                            optimizationsApplied: ['main_mcp_route'],
                            cacheHit: false,
                            riskLevel: 'low',
                            requiresSelection: true,
                            selection: agentResult.selection,
                        };
                    }
                }

                return {
                    response: errorMessage,
                    agentPath: ['mcp_error'],
                    optimizationsApplied: [],
                    cacheHit: false,
                    riskLevel: 'low',
                };
            }

            // 9. Format integration-specific data
            const integrationData: any = {};
            const integration = mcpResult.metadata.integration;

            // Extract the actual data from the response
            const actualData = mcpResult.data?.data || mcpResult.data;

            switch (integration) {
                case 'mongodb':
                    integrationData.mongodbIntegrationData = actualData;
                    integrationData.formattedResult = await IntegrationFormatter.formatMongoDBResult({ 
                        metadata: mcpResult.metadata, 
                        data: actualData 
                    });
                    break;
                case 'github':
                    // For GitHub, extract repositories array if it exists
                    const githubData = actualData?.repositories || actualData;
                    integrationData.githubIntegrationData = githubData;
                    integrationData.formattedResult = await IntegrationFormatter.formatGitHubResult({ 
                        metadata: mcpResult.metadata, 
                        data: githubData 
                    });
                    break;
                case 'vercel':
                    integrationData.vercelIntegrationData = actualData;
                    integrationData.formattedResult = await IntegrationFormatter.formatVercelResult({ 
                        metadata: mcpResult.metadata, 
                        data: actualData 
                    });
                    break;
                case 'google':
                    integrationData.googleIntegrationData = actualData;
                    integrationData.formattedResult = await IntegrationFormatter.formatGoogleResult({ 
                        metadata: mcpResult.metadata, 
                        data: actualData 
                    });
                    break;
                case 'slack':
                    integrationData.slackIntegrationData = actualData;
                    integrationData.formattedResult = await IntegrationFormatter.formatSlackResult({ 
                        metadata: mcpResult.metadata, 
                        data: actualData 
                    });
                    break;
                case 'discord':
                    integrationData.discordIntegrationData = actualData;
                    integrationData.formattedResult = await IntegrationFormatter.formatDiscordResult({ 
                        metadata: mcpResult.metadata, 
                        data: actualData 
                    });
                    break;
                case 'jira':
                    integrationData.jiraIntegrationData = actualData;
                    integrationData.formattedResult = await IntegrationFormatter.formatJiraResult({ 
                        metadata: mcpResult.metadata, 
                        data: actualData 
                    });
                    break;
                case 'linear':
                    integrationData.linearIntegrationData = actualData;
                    integrationData.formattedResult = await IntegrationFormatter.formatLinearResult({ 
                        metadata: mcpResult.metadata, 
                        data: actualData 
                    });
                    break;
                case 'aws':
                    integrationData.awsIntegrationData = actualData;
                    integrationData.formattedResult = await IntegrationFormatter.formatAWSResult({ 
                        metadata: mcpResult.metadata, 
                        data: actualData 
                    });
                    break;
            }

            // Generate a readable text summary with clickable links
            let textSummary = '';
            if (integration === 'github' && mcpResult.metadata?.operation === 'github_list_repos') {
                const repos = actualData?.repositories || actualData;
                if (Array.isArray(repos) && repos.length > 0) {
                    textSummary = `Found ${repos.length} GitHub repositories:\n\n`;
                    textSummary += repos.slice(0, 10).map((repo: any) => {
                        // Ensure we have a proper GitHub web URL
                        let githubUrl = repo.html_url;
                        if (!githubUrl && repo.url) {
                            // Convert API URL to web URL if needed
                            if (repo.url.includes('api.github.com')) {
                                githubUrl = repo.url.replace('api.github.com/repos', 'github.com');
                            } else if (!repo.url.startsWith('http')) {
                                // If it's a relative URL or just the repo path
                                githubUrl = `https://github.com/${repo.full_name || repo.name}`;
                            } else {
                                githubUrl = repo.url;
                            }
                        } else if (!githubUrl) {
                            // Fallback to constructing URL from repo name
                            githubUrl = `https://github.com/${repo.full_name || repo.name}`;
                        }
                        
                        return `• **${repo.full_name || repo.name}** ${repo.private ? '🔒' : '🌍'}\n` +
                            `  ${repo.description || 'No description'}\n` +
                            `  [View on GitHub](${githubUrl})\n` +
                            `  Language: ${repo.language || 'N/A'} | Stars: ${repo.stargazers_count || 0}`;
                    }).join('\n\n');
                    
                    if (repos.length > 10) {
                        textSummary += `\n\n... and ${repos.length - 10} more repositories`;
                    }
                }
            } else if (integration === 'mongodb') {
                const operation = mcpResult.metadata?.operation;
                if (operation === 'mongodb_find' && actualData?.documents) {
                    textSummary = `Found ${actualData.documents.length} documents in MongoDB`;
                } else if (operation === 'mongodb_insert' && actualData?.insertedCount) {
                    textSummary = `Successfully inserted ${actualData.insertedCount} document(s) into MongoDB`;
                } else if (operation === 'mongodb_update' && actualData?.modifiedCount) {
                    textSummary = `Successfully updated ${actualData.modifiedCount} document(s) in MongoDB`;
                } else if (operation === 'mongodb_delete' && actualData?.deletedCount) {
                    textSummary = `Successfully deleted ${actualData.deletedCount} document(s) from MongoDB`;
                }
            }

            return {
                response: textSummary || (mcpResult.data as any)?.message || 'Action completed successfully',
                agentPath: ['mcp', integration],
                optimizationsApplied: ['mcp_integration', 'main_mcp_route'],
                cacheHit: mcpResult.metadata?.cached || false,
                riskLevel: mcpResult.metadata?.dangerousOperation ? 'high' : 'low',
                ...integrationData,
            };
        } catch (error) {
            loggingService.error('MCP route handling failed', {
                userId: request.userId,
                error: error instanceof Error ? error.message : String(error),
            });

            // Fallback to direct Bedrock
            return this.directBedrockFallback(request, recentMessages);
        }
    }


    /**
     * Update the selected view type for a MongoDB result message
     */
    static async updateChatMessageViewType(
        messageId: string,
        userId: string,
        viewType: 'table' | 'json' | 'schema' | 'stats' | 'chart' | 'text' | 'error' | 'empty' | 'explain'
    ): Promise<boolean> {
        try {
            // Validate ObjectId format
            if (!Types.ObjectId.isValid(messageId)) {
                loggingService.error('Invalid message ID format', { messageId, userId });
                throw new Error('Invalid message ID format');
            }

            const result = await ChatMessage.updateOne(
                { _id: messageId, userId, 'mongodbIntegrationData.action': { $exists: true } }, // Ensure it's a MongoDB result message
                { $set: { mongodbSelectedViewType: viewType } }
            );

            if (result.matchedCount === 0) {
                loggingService.warn('MongoDB message not found for view type update', { messageId, userId, viewType });
                return false;
            }

            loggingService.info('MongoDB message view type updated successfully', { messageId, userId, viewType });
            return true;
        } catch (error) {
            loggingService.error('Failed to update MongoDB message view type:', {
                messageId, userId, viewType,
                error: error instanceof Error ? error.message : String(error)
            });
            throw new Error('Failed to update chat message view type');
        }
    }

    /**
     * Send a message to AWS Bedrock model
     */
    static async sendMessage(request: ChatSendMessageRequest): Promise<ChatSendMessageResponse> {
        try {
            const startTime = Date.now();
            
            // Debug: Log the incoming request
            loggingService.info('🔍 sendMessage called with request', {
                hasSelectionResponse: !!request.selectionResponse,
                selectionResponse: request.selectionResponse,
                message: request.message
            });
            
            // Generate messageId
            const messageId = new Types.ObjectId().toString();
            
            // Validate that either message, templateId, or attachments is provided
            if (!request.message && !request.templateId && !request.attachments?.length) {
                throw new Error('Either message, templateId, or attachments must be provided');
            }

            let conversation: IConversation;
            let recentMessages: any[] = [];
            let processedAttachments: any[] | undefined;
            let attachmentsContext = '';
            let templateMetadata: {
                id: string;
                name: string;
                category: string;
                variablesResolved: Array<{
                    variableName: string;
                    value: string;
                    confidence: number;
                    source: 'user_provided' | 'context_inferred' | 'default' | 'missing';
                    reasoning?: string;
                }>;
            } | undefined;
            let actualMessage = request.message || '';
            
            // Optimized: Use MongoDB session for transaction
            const session = await mongoose.startSession();
            
            try {
                await session.withTransaction(async () => {
                    // Get or create conversation
                    if (request.conversationId) {
                        const foundConversation = await Conversation.findById(request.conversationId).session(session);
                        if (!foundConversation || foundConversation.userId !== request.userId) {
                            throw new Error('Conversation not found or access denied');
                        }
                        conversation = foundConversation;
                    } else {
                    // Create new conversation with smart title from first message or template
                    const title = request.templateId 
                        ? 'Template Chat'  // Will be updated after template resolution
                        : this.generateSimpleTitle(request.message || 'New Chat', request.modelId);
                        const newConversation = new Conversation({
                            userId: request.userId,
                            title: title,
                            modelId: request.modelId,
                            messageCount: 0,
                            totalCost: 0
                        });
                        conversation = await newConversation.save({ session });
                    }

                    // Optimized: Get recent messages with dynamic context sizing
                    recentMessages = await ContextOptimizer.fetchOptimalContext(
                        conversation!._id.toString(), 
                        request.message?.length || 50
                    );

                    // Fetch attached document metadata if documentIds provided
                    let attachedDocuments: Array<{
                        documentId: string;
                        fileName: string;
                        chunksCount: number;
                        fileType?: string;
                    }> | undefined;
                    
                    if (request.documentIds && request.documentIds.length > 0) {
                        const docs = await DocumentModel.aggregate<{
                            _id: string;
                            fileName: string;
                            fileType?: string;
                            chunksCount: number;
                        }>([
                            {
                                $match: {
                                    'metadata.documentId': { $in: request.documentIds },
                                    'metadata.userId': request.userId,
                                    status: 'active'
                                }
                            },
                            {
                                $group: {
                                    _id: '$metadata.documentId',
                                    fileName: { $first: '$metadata.fileName' },
                                    fileType: { $first: '$metadata.fileType' },
                                    chunksCount: { $sum: 1 }
                                }
                            }
                        ]);
                        
                        attachedDocuments = docs.map((doc) => ({
                            documentId: doc._id,
                            fileName: doc.fileName || 'Unknown',
                            chunksCount: doc.chunksCount,
                            fileType: doc.fileType
                        }));
                    }

                    // Process attachments if present
                    if (request.attachments && request.attachments.length > 0) {
                        const { processedAttachments: processed, contextString } = await AttachmentProcessor.processAttachments(
                            request.attachments,
                            request.userId
                        );
                        processedAttachments = processed;
                        attachmentsContext = contextString;
                    }

                    // Save user message with attached documents (only if not using template initially)
                    // Template messages will be saved after resolution
                    if (!request.templateId) {
                        // Use originalMessage for storage (what user actually typed), 
                        // message is enriched version for AI only
                        const messageToStore = request.originalMessage ?? request.message ?? '';
                        await ChatMessage.create([{
                            conversationId: conversation!._id,
                            userId: request.userId,
                            role: 'user',
                            content: messageToStore,
                            attachedDocuments: attachedDocuments,
                            attachments: processedAttachments
                        }], { session });
                    }
                });
            } finally {
                await session.endSession();
            }
            
            // Ensure conversation is assigned
            if (!conversation!) {
                throw new Error('Failed to get or create conversation');
            }

            // Handle template resolution if templateId is provided
            if (request.templateId) {
                loggingService.info('Processing template request', {
                    templateId: request.templateId,
                    userId: request.userId,
                    hasVariables: !!request.templateVariables
                });

                const { PromptTemplateService } = await import('./promptTemplate.service');

                // Use template with context-aware resolution
                const templateResult = await PromptTemplateService.useTemplateWithContext(
                    request.templateId,
                    request.userId,
                    {
                        userProvidedVariables: request.templateVariables,
                        conversationHistory: recentMessages.map(msg => ({
                            role: msg.role,
                            content: msg.content
                        }))
                    }
                );

                // Update actualMessage with resolved template
                actualMessage = templateResult.prompt;

                // Store template metadata for response
                templateMetadata = {
                    id: templateResult.template.id,
                    name: templateResult.template.name,
                    category: templateResult.template.category,
                    variablesResolved: templateResult.resolutionDetails
                };

                // Update conversation title if it's a new conversation
                if (conversation.messageCount === 0) {
                    conversation.title = this.generateSimpleTitle(actualMessage, request.modelId);
                    await conversation.save();
                }

                // Save the resolved prompt as the user message
                const session2 = await mongoose.startSession();
                try {
                    await session2.withTransaction(async () => {
                        await ChatMessage.create([{
                            conversationId: conversation._id,
                            userId: request.userId,
                            role: 'user',
                            content: actualMessage,
                            metadata: {
                                templateId: request.templateId,
                                templateName: templateResult.template.name,
                                variablesResolved: templateResult.resolutionDetails
                            }
                        }], { session: session2 });
                    });
                } finally {
                    await session2.endSession();
                }

                loggingService.info('Template resolved successfully', {
                    templateId: request.templateId,
                    templateName: templateResult.template.name,
                    variablesResolved: templateResult.resolutionDetails.length,
                    resolvedLength: actualMessage.length
                });

                // Update request.message with resolved template for downstream processing
                request.message = actualMessage;
            }

            // Check for integration mentions in the message
            // Pattern 1: @integration:entityType:entityId:subEntityType:subEntityId (original format)
            // Pattern 2: @integration:command (e.g., @linear:list-issues, @linear:list-projects)
            // Pattern to match @integration:command-with-dashes or @integration:entityType:entityId
            const mentionPattern = /@([a-z]+)(?::([a-z]+(?:-[a-z]+)*)(?::([a-zA-Z0-9_-]+))?(?::([a-z]+):([a-zA-Z0-9_-]+))?)?/g;
            const mentions: ParsedMention[] = [];
            let match;
            
            while (actualMessage && (match = mentionPattern.exec(actualMessage)) !== null) {
                const [, integration, part1, part2, subEntityType, subEntityId] = match;
                if (['jira', 'linear', 'slack', 'discord', 'github', 'webhook', 'gmail', 'calendar', 'drive', 'sheets', 'docs', 'slides', 'forms', 'google', 'vercel', 'aws'].includes(integration)) {
                    // If part2 exists, it's entityId (Pattern 1: @integration:entityType:entityId)
                    // If part2 doesn't exist but part1 exists, it might be a command (Pattern 2: @integration:command)
                    // Commands with dashes (like list-issues) will be in part1
                    // We'll let the parseCommand function handle command detection
                    mentions.push({
                        integration,
                        entityType: part1 && part2 ? part1 : undefined,
                        entityId: part2 || undefined,
                        subEntityType: subEntityType || undefined,
                        subEntityId: subEntityId || undefined
                    });
                }
            }
            
            // Also detect simple @integration format (without colon)
            const simpleMentionPattern = /@([a-z]+)(?![:\w])/g;
            let simpleMatch;
            while (actualMessage && (simpleMatch = simpleMentionPattern.exec(actualMessage)) !== null) {
                const [, integration] = simpleMatch;
                if (['jira', 'linear', 'slack', 'discord', 'github', 'webhook', 'gmail', 'calendar', 'drive', 'sheets', 'docs', 'slides', 'forms', 'google', 'vercel', 'aws'].includes(integration)) {
                    // Check if this integration is already in mentions
                    if (!mentions.some(m => m.integration === integration)) {
                        mentions.push({
                            integration,
                            entityType: undefined,
                            entityId: undefined,
                            subEntityType: undefined,
                            subEntityId: undefined
                        });
                    }
                }
            }

            // Handle Langchain strategy formation responses
            if (request.selectionResponse && request.selectionResponse.integration === 'strategy') {
                try {
                    const sessionId = (request.selectionResponse as any).sessionId;
                    const session = this.userInputSessions.get(sessionId);
                    
                    if (session) {
                        const { state, questionIndex } = session;
                        
                        // Update strategy with user response
                        state.strategyFormation.responses[`question_${questionIndex}`] = request.selectionResponse.value;
                        
                        // Check if more questions remain
                        if (questionIndex < state.strategyFormation.questions.length - 1) {
                            // Continue with next question
                            state.strategyFormation.currentQuestion = questionIndex + 1;
                            
                            // Process next question through Langchain
                            const updatedState = await (this.langchainGraph as any).invoke({
                                ...state,
                                messages: [...state.messages, new HumanMessage(String(request.selectionResponse.value))],
                                currentAgent: 'user_input_collection'
                            });
                            
                            // Extract the response
                            const lastMessage = updatedState.messages[updatedState.messages.length - 1];
                            const response = lastMessage?.content as string || 'Processing your input...';
                            
                            // Check if we need IntegrationSelector for next question
                            if (updatedState.userInputCollection?.currentField?.type === 'selection') {
                                // Update session for next question
                                this.userInputSessions.set(sessionId, {
                                    state: updatedState,
                                    questionIndex: questionIndex + 1,
                                    timestamp: new Date()
                                });
                                
                                // Return with selection UI
                                const selectionField = updatedState.userInputCollection.currentField as any;
                                return {
                                    messageId: messageId,
                                    conversationId: conversation!._id.toString(),
                                    response: selectionField.question,
                                    cost: 0,
                                    latency: Date.now() - startTime,
                                    tokenCount: 0,
                                    model: request.modelId,
                                    requiresSelection: true,
                                    selection: {
                                        parameterName: selectionField.parameterName,
                                        question: selectionField.question,
                                        options: selectionField.options,
                                        allowCustom: selectionField.allowCustom,
                                        customPlaceholder: selectionField.customPlaceholder,
                                        integration: 'strategy',
                                        pendingAction: 'strategy_formation',
                                        collectedParams: selectionField.collectedParams,
                                        originalMessage: request.originalMessage
                                    }
                                };
                            }
                            
                            // Save messages and return response
                            const session2 = await mongoose.startSession();
                            try {
                                await session2.withTransaction(async () => {
                                    await ChatMessage.create([
                                        {
                                            conversationId: conversation._id,
                                            userId: request.userId,
                                            role: 'user',
                                            content: `Selected: ${request.selectionResponse?.value}`,
                                            metadata: { type: 'strategy_response', value: request.selectionResponse?.value }
                                        },
                                        {
                                            conversationId: conversation._id,
                                            userId: request.userId,
                                            role: 'assistant',
                                            content: response,
                                            modelId: request.modelId
                                        }
                                    ], { session: session2 });
                                    
                                    conversation!.messageCount = (conversation!.messageCount || 0) + 2;
                                    await conversation!.save({ session: session2 });
                                });
                            } finally {
                                await session2.endSession();
                            }
                            
                            return {
                                messageId: messageId,
                                conversationId: conversation!._id.toString(),
                                response,
                                cost: 0,
                                latency: Date.now() - startTime,
                                tokenCount: 0,
                                model: request.modelId,
                                agentPath: ['langchain_strategy_formation'],
                                optimizationsApplied: ['dynamic_user_input'],
                                cacheHit: false,
                                riskLevel: 'low'
                            };
                        } else {
                            // Strategy formation complete - execute final synthesis
                            state.strategyFormation.isComplete = true;
                            
                            const finalState = await (this.langchainGraph as any).invoke({
                                ...state,
                                messages: [...state.messages, new HumanMessage(String(request.selectionResponse.value))],
                                currentAgent: 'response_synthesis'
                            });
                            
                            const finalMessage = finalState.messages[finalState.messages.length - 1];
                            const finalResponse = finalMessage?.content as string || 'Strategy formation complete!';
                            
                            // Clean up session
                            this.userInputSessions.delete(sessionId);
                            
                            // Save final messages
                            const session2 = await mongoose.startSession();
                            try {
                                await session2.withTransaction(async () => {
                                    await ChatMessage.create([
                                        {
                                            conversationId: conversation._id,
                                            userId: request.userId,
                                            role: 'user',
                                            content: `Selected: ${request.selectionResponse?.value}`,
                                            metadata: { type: 'strategy_response', value: request.selectionResponse?.value }
                                        },
                                        {
                                            conversationId: conversation._id,
                                            userId: request.userId,
                                            role: 'assistant',
                                            content: finalResponse,
                                            modelId: request.modelId,
                                            metadata: {
                                                type: 'strategy_complete',
                                                strategyFormation: state.strategyFormation
                                            }
                                        }
                                    ], { session: session2 });
                                    
                                    conversation!.messageCount = (conversation!.messageCount || 0) + 2;
                                    await conversation!.save({ session: session2 });
                                });
                            } finally {
                                await session2.endSession();
                            }
                            
                            return {
                                messageId: messageId,
                                conversationId: conversation!._id.toString(),
                                response: finalResponse,
                                cost: 0,
                                latency: Date.now() - startTime,
                                tokenCount: 0,
                                model: request.modelId,
                                agentPath: ['langchain_strategy_complete'],
                                optimizationsApplied: ['strategy_formation', 'dynamic_user_input'],
                                cacheHit: false,
                                riskLevel: 'low',
                                strategyFormed: state.strategyFormation
                            };
                        }
                    } else {
                        throw new Error('Strategy formation session not found');
                    }
                } catch (error) {
                    loggingService.error('Strategy formation response handling failed', {
                        error: error instanceof Error ? error.message : String(error),
                        sessionId: (request.selectionResponse as any).sessionId
                    });
                    // Fall through to normal processing
                }
            }

            // ========================================
            // EARLY MCP ROUTING CHECK (MAIN INTEGRATION HANDLER)
            // This ensures ALL integration requests go through MCP FIRST
            // Before any legacy chat agents (VercelChatAgent, MongoDBChatAgent, GitHubChatAgent)
            // ========================================
            try {
                const integrationIntent = await IntegrationDetector.detect(
                    actualMessage,
                    request.userId
                );
                
                if (integrationIntent.needsIntegration && integrationIntent.confidence > 0.6) {
                    loggingService.info('🔌 MAIN MCP ROUTING: Integration intent detected in sendMessage', {
                        integrations: integrationIntent.integrations,
                        confidence: integrationIntent.confidence,
                        suggestedTools: integrationIntent.suggestedTools,
                        bypassing: 'legacy chat agents'
                    });
                    
                    // Build conversation context
                    const context = ContextManager.buildContext(
                        conversation!._id.toString(),
                        actualMessage,
                        recentMessages
                    );
                    
                    // Route through MCP (this is now the MAIN path, not fallback)
                    const mcpResult = await this.handleMCPRoute(request, context, recentMessages);
                    
                    // Save the response
                    const session2 = await mongoose.startSession();
                    try {
                        await session2.withTransaction(async () => {
                            await ChatMessage.create([{
                                conversationId: conversation._id,
                                userId: request.userId,
                                role: 'assistant',
                                content: mcpResult.response,
                                modelId: request.modelId,
                                messageType: 'assistant', // Explicitly set messageType
                                metadata: {
                                    mcpRoute: true,
                                    integration: integrationIntent.integrations[0],
                                    confidence: integrationIntent.confidence
                                },
                                // Save ALL integration data fields
                                mongodbIntegrationData: mcpResult.mongodbIntegrationData,
                                githubIntegrationData: mcpResult.githubIntegrationData,
                                vercelIntegrationData: mcpResult.vercelIntegrationData,
                                slackIntegrationData: mcpResult.slackIntegrationData,
                                discordIntegrationData: mcpResult.discordIntegrationData,
                                jiraIntegrationData: mcpResult.jiraIntegrationData,
                                linearIntegrationData: mcpResult.linearIntegrationData,
                                googleIntegrationData: mcpResult.googleIntegrationData,
                                awsIntegrationData: mcpResult.awsIntegrationData,
                                formattedResult: mcpResult.formattedResult,
                                agentPath: mcpResult.agentPath,
                                optimizationsApplied: mcpResult.optimizationsApplied,
                                cacheHit: mcpResult.cacheHit,
                                riskLevel: mcpResult.riskLevel
                            }], { session: session2 });

                            conversation!.messageCount = (conversation!.messageCount || 0) + 2;
                            conversation!.lastMessage = mcpResult.response.substring(0, 100);
                            conversation!.lastMessageAt = new Date();
                            await conversation!.save({ session: session2 });
                        });
                    } finally {
                        await session2.endSession();
                    }
                    
                    const latency = Date.now() - startTime;
                    
                    // Return MCP result directly
                    return {
                        messageId,
                        conversationId: conversation!._id.toString(),
                        response: mcpResult.response,
                        cost: 0,
                        latency,
                        tokenCount: 0,
                        model: request.modelId,
                        agentPath: mcpResult.agentPath,
                        optimizationsApplied: [...mcpResult.optimizationsApplied, 'main_mcp_route'],
                        cacheHit: mcpResult.cacheHit,
                        riskLevel: mcpResult.riskLevel,
                        mongodbIntegrationData: mcpResult.mongodbIntegrationData,
                        formattedResult: mcpResult.formattedResult,
                        githubIntegrationData: mcpResult.githubIntegrationData,
                        vercelIntegrationData: mcpResult.vercelIntegrationData,
                        slackIntegrationData: mcpResult.slackIntegrationData,
                        discordIntegrationData: mcpResult.discordIntegrationData,
                        jiraIntegrationData: mcpResult.jiraIntegrationData,
                        linearIntegrationData: mcpResult.linearIntegrationData,
                        googleIntegrationData: mcpResult.googleIntegrationData,
                        requiresConnection: mcpResult.requiresConnection,
                        requiresSelection: (mcpResult as any).requiresSelection, // Add requiresSelection support
                        selection: (mcpResult as any).selection, // Add selection support
                    };
                }
            } catch (error) {
                loggingService.warn('Main MCP routing check failed, continuing with legacy handlers', {
                    error: error instanceof Error ? error.message : String(error)
                });
                // Continue with legacy handlers if MCP fails
            }

            // If mentions found, try to execute integration command
            // Process ALL mentions including Vercel through the new Integration Agent
            // Also handle selection response continuation (multi-turn parameter collection)
            // EXCEPT: MongoDB requests should go to multi-agent flow (it has its own tool)
            const isMongoDBRequest = mentions.some(m => m.integration === 'mongodb') || 
                                   (request.selectionResponse && request.selectionResponse.integration === 'mongodb');
            
            // Handle MongoDB selection responses - preserve selectionResponse for multi-agent flow
            loggingService.info('🔍 Checking MongoDB request status', {
                isMongoDBRequest,
                hasSelectionResponse: !!request.selectionResponse,
                selectionResponseIntegration: request.selectionResponse?.integration,
                message: actualMessage
            });
            
            if (isMongoDBRequest && request.selectionResponse && request.selectionResponse.integration === 'mongodb') {
                loggingService.info('🔍 MongoDB selection response detected, preserving for multi-agent flow', {
                    parameterName: request.selectionResponse.parameterName,
                    value: request.selectionResponse.value,
                    pendingAction: request.selectionResponse.pendingAction
                });
            }
            
            if ((mentions.length > 0 || (request.selectionResponse && request.selectionResponse.integration !== 'strategy')) && !isMongoDBRequest) {
                try {
                    // Use the new AI-powered Integration Agent for parameter extraction
                    const { IntegrationAgentService } = await import('./integrationAgent.service');
                    
                    // Determine integration from mentions or selection response
                    const integration = mentions.length > 0 
                        ? mentions[0].integration 
                        : (request.selectionResponse as { parameterName: string; value: string | number | boolean; pendingAction: string; collectedParams: Record<string, unknown>; integration?: string })?.integration || 'vercel';
                    
                    const agentResult = await IntegrationAgentService.processIntegrationCommand({
                        message: actualMessage,
                        integration,
                        userId: request.userId,
                        selectionResponse: request.selectionResponse
                    });

                    // If the agent needs user to select from options, return the selection UI
                    if (agentResult.requiresSelection && agentResult.selection) {
                        // Save assistant message with the question
                        const session2 = await mongoose.startSession();
                        try {
                            await session2.withTransaction(async () => {
                                await ChatMessage.create([{
                                    conversationId: conversation._id,
                                    userId: request.userId,
                                    role: 'assistant',
                                    content: agentResult.selection!.question,
                                    modelId: request.modelId,
                                    metadata: {
                                        type: 'integration_selection',
                                        selection: agentResult.selection
                                    }
                                }], { session: session2 });

                                conversation!.messageCount = (conversation!.messageCount || 0) + 2;
                                conversation!.lastMessage = agentResult.selection!.question.substring(0, 100);
                                conversation!.lastMessageAt = new Date();
                                await conversation!.save({ session: session2 });
                            });
                        } finally {
                            await session2.endSession();
                        }

                        const latency = Date.now() - startTime;
                        return {
                            messageId: messageId,
                            conversationId: conversation!._id.toString(),
                            response: agentResult.selection.question,
                            cost: 0,
                            latency,
                            tokenCount: 0,
                            model: request.modelId,
                            agentPath: ['integration_agent'],
                            optimizationsApplied: [],
                            cacheHit: false,
                            riskLevel: 'low' as const,
                            // Include selection data for frontend to render interactive UI
                            requiresSelection: true,
                            selection: agentResult.selection
                        };
                    }

                    // If agent succeeded, format and return the result
                    if (agentResult.success) {
                        const { formatIntegrationResultForDisplay } = await import('../utils/responseSanitizer');
                        const formattedResult = formatIntegrationResultForDisplay({
                            success: true,
                            message: agentResult.message,
                            data: agentResult.data
                        });

                        const sanitizedMessage = typeof formattedResult === 'string' 
                            ? formattedResult 
                            : formattedResult.message;
                        const viewLinks = typeof formattedResult === 'object' ? formattedResult.viewLinks : undefined;
                        const resultMetadata = typeof formattedResult === 'object' ? formattedResult.metadata : undefined;

                        // Build integration metadata
                        let integrationMetadata: any = undefined;
                        if (agentResult.data && typeof agentResult.data === 'object') {
                            integrationMetadata = {
                                type: 'integration_data',
                                data: agentResult.data
                            };
                        }

                        // Save assistant response
                        const session2 = await mongoose.startSession();
                        try {
                            await session2.withTransaction(async () => {
                                await ChatMessage.create([{
                                    conversationId: conversation._id,
                                    userId: request.userId,
                                    role: 'assistant',
                                    content: sanitizedMessage,
                                    modelId: request.modelId,
                                    metadata: integrationMetadata
                                }], { session: session2 });

                                conversation!.messageCount = (conversation!.messageCount || 0) + 2;
                                conversation!.lastMessage = sanitizedMessage.substring(0, 100);
                                conversation!.lastMessageAt = new Date();
                                await conversation!.save({ session: session2 });
                            });
                        } finally {
                            await session2.endSession();
                        }

                        const latency = Date.now() - startTime;
                        return {
                            messageId: messageId,
                            conversationId: conversation!._id.toString(),
                            response: sanitizedMessage,
                            cost: 0,
                            latency,
                            tokenCount: 0,
                            model: request.modelId,
                            agentPath: ['integration_agent'],
                            optimizationsApplied: [],
                            cacheHit: false,
                            riskLevel: 'low' as const,
                            viewLinks: viewLinks,
                            metadata: resultMetadata
                        };
                    }

                    // Agent returned an error - show it to user
                    const errorMessage = agentResult.message || agentResult.error || 'Integration command failed';
                    
                    const session2 = await mongoose.startSession();
                    try {
                        await session2.withTransaction(async () => {
                            await ChatMessage.create([{
                                conversationId: conversation._id,
                                userId: request.userId,
                                role: 'assistant',
                                content: `❌ ${errorMessage}`,
                                modelId: request.modelId
                            }], { session: session2 });

                            conversation!.messageCount = (conversation!.messageCount || 0) + 2;
                            conversation!.lastMessage = errorMessage.substring(0, 100);
                            conversation!.lastMessageAt = new Date();
                            await conversation!.save({ session: session2 });
                        });
                    } finally {
                        await session2.endSession();
                    }

                    const latency = Date.now() - startTime;
                    return {
                        messageId: messageId,
                        conversationId: conversation!._id.toString(),
                        response: `❌ ${errorMessage}`,
                        cost: 0,
                        latency,
                        tokenCount: 0,
                        model: request.modelId,
                        agentPath: ['integration_agent'],
                        optimizationsApplied: [],
                        cacheHit: false,
                        riskLevel: 'low' as const
                    };
                } catch (error) {
                    // Unexpected error - fall back to original handler
                    const errorMessage = error instanceof Error ? error.message : 'Unknown integration error';
                    loggingService.error('Integration agent failed, falling back to original handler', {
                        error: errorMessage,
                        userId: request.userId,
                        message: request.message
                    });
                    
                    // Fall back to the original integration handler
                    const command = await IntegrationChatService.parseCommand(actualMessage, mentions);
                    if (command) {
                        // Execute via MCP handler
                        const result = await MCPIntegrationHandler.handleIntegrationOperation({
                            userId: request.userId,
                            command,
                            context: {
                                message: request.message,
                                mentions
                            }
                        });

                        // Handle both success and failure cases explicitly
                        if (result.success && result.result.success) {
                            // Sanitize response for display (remove MongoDB IDs, etc.)
                            const { formatIntegrationResultForDisplay } = await import('../utils/responseSanitizer');
                            const formattedResult = formatIntegrationResultForDisplay(result.result);

                            // Extract message and metadata from formatted result
                            const sanitizedMessage = typeof formattedResult === 'string' 
                                ? formattedResult 
                                : formattedResult.message;
                            const viewLinks = typeof formattedResult === 'object' ? formattedResult.viewLinks : result.result.viewLinks;
                            const resultMetadata = typeof formattedResult === 'object' ? formattedResult.metadata : result.result.metadata;

                            // If result contains document content (from @docs:read), store it in metadata for AI context
                            let integrationMetadata: any = undefined;
                            if (result.result.data?.content && result.result.data?.documentId) {
                                integrationMetadata = {
                                    type: 'document_content',
                                    documentId: result.result.data.documentId,
                                    content: result.result.data.content,
                                    characterCount: result.result.data.characterCount
                                };
                            } else if (result.result.data?.files && Array.isArray(result.result.data.files)) {
                                // Store file list for reference
                                integrationMetadata = {
                                    type: 'file_list',
                                    files: result.result.data.files.map((f: any) => ({
                                        id: f.id,
                                        name: f.name,
                                        mimeType: f.mimeType
                                    }))
                                };
                            } else if (result.result.data && typeof result.result.data === 'object') {
                                // Store other integration data
                                integrationMetadata = {
                                    type: 'integration_data',
                                    data: result.result.data
                                };
                            }

                            // Save assistant response with integration result
                            const session2 = await mongoose.startSession();
                            try {
                                await session2.withTransaction(async () => {
                                    await ChatMessage.create([{
                                        conversationId: conversation._id,
                                        userId: request.userId,
                                        role: 'assistant',
                                        content: sanitizedMessage,
                                        modelId: request.modelId,
                                        metadata: integrationMetadata
                                    }], { session: session2 });

                                    conversation!.messageCount = (conversation!.messageCount || 0) + 2;
                                    conversation!.lastMessage = sanitizedMessage.substring(0, 100);
                                    conversation!.lastMessageAt = new Date();
                                    await conversation!.save({ session: session2 });
                                });
                            } finally {
                                await session2.endSession();
                            }

                            const latency = Date.now() - startTime;
                            return {
                                messageId: messageId, // Use pre-generated messageId
                                conversationId: conversation!._id.toString(),
                                response: sanitizedMessage,
                                cost: 0, // Integration operations don't cost tokens
                                latency,
                                tokenCount: 0,
                                model: request.modelId,
                                agentPath: ['integration_handler'],
                                optimizationsApplied: [],
                                cacheHit: false,
                                riskLevel: 'low' as const,
                                viewLinks: viewLinks, // Pass through view links for Google services
                                metadata: resultMetadata // Pass through metadata
                            };
                        } else {
                            // Integration command failed - return error message directly
                            const errorMessage = result.result?.message || result.result?.error || 'Integration command failed';
                            
                            // Save error response
                            const session2 = await mongoose.startSession();
                            try {
                                await session2.withTransaction(async () => {
                                    await ChatMessage.create([{
                                        conversationId: conversation._id,
                                        userId: request.userId,
                                        role: 'assistant',
                                        content: `❌ ${errorMessage}`,
                                        modelId: request.modelId
                                    }], { session: session2 });

                                    conversation!.messageCount = (conversation!.messageCount || 0) + 2;
                                    conversation!.lastMessage = errorMessage.substring(0, 100);
                                    conversation!.lastMessageAt = new Date();
                                    await conversation!.save({ session: session2 });
                                });
                            } finally {
                                await session2.endSession();
                            }

                            const latency = Date.now() - startTime;
                            return {
                                messageId: messageId, // Use pre-generated messageId
                                conversationId: conversation!._id.toString(),
                                response: `❌ ${errorMessage}`,
                                cost: 0,
                                latency,
                                tokenCount: 0,
                                model: request.modelId,
                                agentPath: ['integration_handler'],
                                optimizationsApplied: [],
                                cacheHit: false,
                                riskLevel: 'low' as const
                            };
                        }
                    } else {
                        // Could not parse command - return helpful error
                        const integration = mentions[0].integration;
                        const errorMessage = `I couldn't understand the ${integration} command. Please use a format like @${integration}:list-issues or @${integration}:create-issue with title "..."`;
                        
                        const session2 = await mongoose.startSession();
                        try {
                            await session2.withTransaction(async () => {
                                await ChatMessage.create([{
                                    conversationId: conversation._id,
                                    userId: request.userId,
                                    role: 'assistant',
                                    content: `❓ ${errorMessage}`,
                                    modelId: request.modelId
                                }], { session: session2 });

                                conversation!.messageCount = (conversation!.messageCount || 0) + 2;
                                conversation!.lastMessage = errorMessage.substring(0, 100);
                                conversation!.lastMessageAt = new Date();
                                await conversation!.save({ session: session2 });
                            });
                        } finally {
                            await session2.endSession();
                        }

                        const latency = Date.now() - startTime;
                        return {
                            messageId: new Types.ObjectId().toString(),
                            conversationId: conversation!._id.toString(),
                            response: `❓ ${errorMessage}`,
                            cost: 0,
                            latency,
                            tokenCount: 0,
                            model: request.modelId,
                            agentPath: ['integration_handler'],
                            optimizationsApplied: [],
                            cacheHit: false,
                            riskLevel: 'low' as const
                        };
                    }
                }
            }

            // Check if this is a GitHub-related message with repository context
            // Use request.githubContext if provided, otherwise check conversation.githubContext
            const githubContext = request.githubContext || (conversation!.githubContext ? {
                connectionId: conversation!.githubContext.connectionId?.toString(),
                repositoryId: conversation!.githubContext.repositoryId,
                repositoryName: conversation!.githubContext.repositoryName,
                repositoryFullName: conversation!.githubContext.repositoryFullName
            } : null);

            // Handle Vercel context
            const vercelContext = request.vercelContext;
            if (vercelContext) {
                try {
                    const { VercelChatAgentService } = await import('./vercelChatAgent.service');
                    const { VercelConnection, Conversation: ConversationModel } = await import('../models');
                    
                    // Get Vercel connection
                    const connectionId = typeof vercelContext.connectionId === 'string' 
                        ? vercelContext.connectionId 
                        : vercelContext.connectionId;
                    const connection = await VercelConnection.findById(connectionId);
                    if (!connection || !connection.isActive) {
                        throw new Error('Vercel connection not found or inactive');
                    }

                    // Get conversation Vercel context if exists, otherwise create from request
                    let conversationVercelContext = null;
                    if (conversation!.vercelContext) {
                        conversationVercelContext = conversation!.vercelContext;
                    } else {
                        // Create Vercel context from request
                        conversationVercelContext = {
                            connectionId: connection._id,
                            projectId: vercelContext.projectId,
                            projectName: vercelContext.projectName
                        };
                        // Save to conversation
                        await ConversationModel.findByIdAndUpdate(conversation!._id, {
                            vercelContext: conversationVercelContext
                        });
                    }

                    // Process with Vercel chat agent
                    const vercelResponse = await VercelChatAgentService.processMessage(
                        request.message || '',
                        {
                            conversationId: conversation!._id.toString(),
                            userId: request.userId,
                            vercelConnectionId: connection._id.toString()
                        }
                    );

                    // Format response - include integration data for frontend polling
                    const processingResult = {
                        response: vercelResponse.message,
                        agentPath: ['vercel_agent'],
                        optimizationsApplied: [],
                        cacheHit: false,
                        riskLevel: 'low' as const,
                        agentThinking: undefined,
                        // Include Vercel integration data if present
                        vercelIntegrationData: vercelResponse.data || undefined,
                        suggestions: vercelResponse.suggestions
                    };

                    // Save assistant response
                    const session2 = await mongoose.startSession();
                    try {
                        await session2.withTransaction(async () => {
                            await ChatMessage.create([{
                                conversationId: conversation._id,
                                userId: request.userId,
                                role: 'assistant',
                                content: vercelResponse.message,
                                modelId: request.modelId
                            }], { session: session2 });

                            conversation!.messageCount = (conversation!.messageCount || 0) + 2;
                            conversation!.lastMessage = vercelResponse.message.substring(0, 100);
                            conversation!.lastMessageAt = new Date();
                            await conversation!.save({ session: session2 });
                        });
                    } finally {
                        await session2.endSession();
                    }

                    const latency = Date.now() - startTime;
                    const inputTokens = Math.ceil((request.message || '').length / 4);
                    const outputTokens = Math.ceil(vercelResponse.message.length / 4);
                    const cost = CostEstimator.estimateCost(request.modelId, inputTokens, outputTokens);

                    return {
                        messageId: new Types.ObjectId().toString(),
                        conversationId: conversation!._id.toString(),
                        response: vercelResponse.message,
                        cost,
                        latency,
                        tokenCount: inputTokens + outputTokens,
                        model: request.modelId,
                        agentPath: processingResult.agentPath,
                        optimizationsApplied: processingResult.optimizationsApplied,
                        cacheHit: processingResult.cacheHit,
                        riskLevel: processingResult.riskLevel,
                        vercelIntegrationData: processingResult.vercelIntegrationData,
                        suggestions: processingResult.suggestions
                    };
                } catch (error) {
                    loggingService.warn('Vercel chat agent failed, falling back to normal processing', {
                        error: error instanceof Error ? error.message : String(error)
                    });
                    // Fall through to normal processing
                }
            }

            // Handle MongoDB context
            const mongodbContext = request.mongodbContext;
            if (mongodbContext) {
                try {
                    const { MongoDBChatAgentService } = await import('./mongodbChatAgent.service');
                    const { MongoDBConnection, Conversation: ConversationModel } = await import('../models');
                    
                    // Get MongoDB connection
                    const connectionId = typeof mongodbContext.connectionId === 'string' 
                        ? mongodbContext.connectionId 
                        : mongodbContext.connectionId;
                    const connection = await MongoDBConnection.findById(connectionId);
                    if (!connection || !connection.isActive) {
                        throw new Error('MongoDB connection not found or inactive');
                    }

                    // Get conversation MongoDB context if exists, otherwise create from request
                    let conversationMongoDBContext = null;
                    if (conversation!.mongodbContext) {
                        conversationMongoDBContext = conversation!.mongodbContext;
                    } else {
                        // Create MongoDB context from request
                        conversationMongoDBContext = {
                            connectionId: connection._id,
                            activeDatabase: mongodbContext.activeDatabase,
                            activeCollection: mongodbContext.activeCollection,
                            recentQueries: []
                        };
                        // Save to conversation
                        await ConversationModel.findByIdAndUpdate(conversation!._id, {
                            mongodbContext: conversationMongoDBContext
                        });
                    }

                    // Process with MongoDB chat agent
                    const mongodbResponse = await MongoDBChatAgentService.processMessage(
                        request.userId,
                        String(connection._id),
                        request.message || '',
                        {
                            conversationId: conversation!._id.toString(),
                            userId: request.userId,
                            connectionId: String(connection._id),
                            activeDatabase: conversationMongoDBContext.activeDatabase,
                            activeCollection: conversationMongoDBContext.activeCollection,
                            recentQueries: conversationMongoDBContext.recentQueries || []
                        }
                    );

                    // Format response - include integration data for frontend polling
                    const processingResult = {
                        response: mongodbResponse.message,
                        agentPath: ['mongodb_agent'],
                        optimizationsApplied: [],
                        cacheHit: false,
                        riskLevel: 'low' as const,
                        agentThinking: undefined,
                        // Include MongoDB integration data if present
                        mongodbIntegrationData: mongodbResponse.data || undefined,
                        suggestions: mongodbResponse.suggestions,
                        resultType: mongodbResponse.resultType,
                        formattedResult: mongodbResponse.formattedResult,
                    };

                    // Save assistant response
                    const session2 = await mongoose.startSession();
                    try {
                        await session2.withTransaction(async () => {
                            await ChatMessage.create([{
                                conversationId: conversation._id,
                                userId: request.userId,
                                role: 'assistant',
                                content: mongodbResponse.message,
                                modelId: request.modelId,
                                messageType: 'assistant', // Explicitly set messageType
                                // Save all MongoDB integration data
                                mongodbIntegrationData: processingResult.mongodbIntegrationData,
                                mongodbSelectedViewType: processingResult.formattedResult?.type || 'table',
                                mongodbResultData: processingResult.formattedResult?.data,
                                formattedResult: processingResult.formattedResult,
                                agentPath: processingResult.agentPath,
                                optimizationsApplied: processingResult.optimizationsApplied,
                                cacheHit: processingResult.cacheHit,
                                riskLevel: processingResult.riskLevel
                                
                            }], { session: session2 });

                            conversation!.messageCount = (conversation!.messageCount || 0) + 2;
                            conversation!.lastMessage = mongodbResponse.message.substring(0, 100);
                            conversation!.lastMessageAt = new Date();
                            await conversation!.save({ session: session2 });
                        });
                    } finally {
                        await session2.endSession();
                    }

                    const latency = Date.now() - startTime;
                    const inputTokens = Math.ceil((request.message || '').length / 4);
                    const outputTokens = Math.ceil(mongodbResponse.message.length / 4);
                    const cost = CostEstimator.estimateCost(request.modelId, inputTokens, outputTokens);

                    return {
                        messageId: new Types.ObjectId().toString(),
                        conversationId: conversation!._id.toString(),
                        response: mongodbResponse.message,
                        cost,
                        latency,
                        tokenCount: inputTokens + outputTokens,
                        model: request.modelId,
                        agentPath: processingResult.agentPath,
                        optimizationsApplied: processingResult.optimizationsApplied,
                        cacheHit: processingResult.cacheHit,
                        riskLevel: processingResult.riskLevel,
                        mongodbIntegrationData: processingResult.mongodbIntegrationData,
                        suggestions: processingResult.suggestions?.map((s: any) => s.command) || [],
                        resultType: processingResult.resultType,
                        formattedResult: processingResult.formattedResult
                    };
                } catch (error) {
                    loggingService.warn('MongoDB chat agent failed, falling back to normal processing', {
                        error: error instanceof Error ? error.message : String(error)
                    });
                    // Fall through to normal processing
                }
            }

            if (githubContext) {
                try {
                    const { GitHubChatAgentService } = await import('./githubChatAgent.service');
                    const { GitHubConnection, Conversation: ConversationModel } = await import('../models');
                    
                    // Get GitHub connection
                    const connectionId = typeof githubContext.connectionId === 'string' 
                        ? githubContext.connectionId 
                        : githubContext.connectionId;
                    const connection = await GitHubConnection.findById(connectionId);
                    if (!connection || !connection.isActive) {
                        throw new Error('GitHub connection not found or inactive');
                    }

                    // Get conversation GitHub context if exists, otherwise create from request
                    let conversationGithubContext = null;
                    if (conversation!.githubContext) {
                        conversationGithubContext = conversation!.githubContext;
                    } else {
                        // Create GitHub context from request
                        conversationGithubContext = {
                            connectionId: connection._id,
                            repositoryId: githubContext.repositoryId,
                            repositoryName: githubContext.repositoryName,
                            repositoryFullName: githubContext.repositoryFullName
                        };
                        // Save to conversation
                        await ConversationModel.findByIdAndUpdate(conversation!._id, {
                            githubContext: conversationGithubContext
                        });
                    }

                    // Process with GitHub chat agent
                    const githubResponse = await GitHubChatAgentService.processChatMessage({
                        conversationId: conversation!._id.toString(),
                        userId: request.userId,
                        githubContext: conversationGithubContext
                    }, request.message || '');

                    // Format response - include integration data for frontend polling
                    const processingResult = {
                        response: githubResponse.message,
                        agentPath: ['github_agent'],
                        optimizationsApplied: [],
                        cacheHit: false,
                        riskLevel: 'low' as const,
                        agentThinking: undefined,
                        // Include GitHub integration data if present
                        githubIntegrationData: githubResponse.data || undefined
                    };

                    // Save assistant response
                    const session2 = await mongoose.startSession();
                    try {
                        await session2.withTransaction(async () => {
                            await ChatMessage.create([{
                                conversationId: conversation._id,
                                userId: request.userId,
                                role: 'assistant',
                                content: githubResponse.message,
                                modelId: request.modelId,
                                messageType: 'assistant', // Explicitly set messageType
                                // Save GitHub integration data
                                githubIntegrationData: processingResult.githubIntegrationData,
                                agentPath: processingResult.agentPath,
                                optimizationsApplied: processingResult.optimizationsApplied,
                                cacheHit: processingResult.cacheHit,
                                riskLevel: processingResult.riskLevel
                            }], { session: session2 });

                            conversation!.messageCount = (conversation!.messageCount || 0) + 2;
                            conversation!.lastMessage = githubResponse.message.substring(0, 100);
                            conversation!.lastMessageAt = new Date();
                            await conversation!.save({ session: session2 });
                        });
                    } finally {
                        await session2.endSession();
                    }

                    const latency = Date.now() - startTime;
                    const inputTokens = Math.ceil((request.message || '').length / 4);
                    const outputTokens = Math.ceil(githubResponse.message.length / 4);
                    const cost = CostEstimator.estimateCost(request.modelId, inputTokens, outputTokens);

                    return {
                        messageId: new Types.ObjectId().toString(),
                        conversationId: conversation!._id.toString(),
                        response: githubResponse.message,
                        cost,
                        latency,
                        tokenCount: inputTokens + outputTokens,
                        model: request.modelId,
                        agentPath: processingResult.agentPath,
                        optimizationsApplied: processingResult.optimizationsApplied,
                        cacheHit: processingResult.cacheHit,
                        riskLevel: processingResult.riskLevel,
                        githubIntegrationData: processingResult.githubIntegrationData
                    };
                } catch (error) {
                    loggingService.warn('GitHub chat agent failed, falling back to normal processing', {
                        error: error instanceof Error ? error.message : String(error)
                    });
                    // Fall through to normal processing
                }
            }

            // Optimized: Enhanced processing with circuit breaker
            // Add attachments context to the message if present
            const finalMessage = attachmentsContext ? actualMessage + attachmentsContext : actualMessage;
            
            // Debug: Log the request before passing to processWithFallback
            loggingService.info('🔍 Before processWithFallback', {
                hasSelectionResponse: !!request.selectionResponse,
                selectionResponse: request.selectionResponse,
                message: request.message,
                finalMessage
            });
            
            // Check if this is an autonomous request before processing
            // BUT skip autonomous detection if useMultiAgent is explicitly true
            // (to allow autonomous web search feature to work)
            const isAutonomousRequest = !request.useMultiAgent && await AutonomousDetector.detect(finalMessage);
            
            if (isAutonomousRequest) {
                loggingService.info('🤖 Autonomous request detected, initiating governed agent', {
                    userId: request.userId,
                    conversationId: conversation!._id.toString(),
                    message: finalMessage
                });
                
                try {
                    // Import GovernedAgentService
                    const { GovernedAgentService } = await import('./governedAgent.service');
                    
                    // Initiate governed task
                    const task = await GovernedAgentService.initiateTask(
                        finalMessage,
                        request.userId,
                        conversation!._id.toString(),
                        messageId
                    );
                    
                    // Create governed plan message
                    const planMessage = await GovernedPlanMessageCreator.createPlanMessage(
                        conversation!._id.toString(),
                        task.id,
                        request.userId
                    );
                    
                    // Return response indicating plan creation
                    return {
                        messageId: planMessage._id.toString(),
                        conversationId: conversation!._id.toString(),
                        response: planMessage.content,
                        cost: 0,
                        latency: Date.now() - startTime,
                        tokenCount: 0,
                        model: request.modelId,
                        agentPath: ['governed_agent'],
                        optimizationsApplied: ['autonomous_detection'],
                        cacheHit: false,
                        riskLevel: 'medium' as const,
                        governedTaskId: task.id,
                        messageType: 'governed_plan' as const
                    } as ChatSendMessageResponse & { governedTaskId: string; messageType: string };
                    
                } catch (error) {
                    loggingService.error('Failed to initiate governed agent', {
                        error: error instanceof Error ? error.message : String(error),
                        userId: request.userId,
                        conversationId: conversation!._id.toString()
                    });
                    // Fall through to normal processing
                }
            }
            
            const processingResult = await this.processWithFallback(
                { ...request, message: finalMessage }, 
                conversation!, 
                recentMessages
            );
            
            loggingService.info('📥 [FLOW-7] chat.service.sendMessage RECEIVED from processWithFallback', {
                hasMongodbIntegrationData: !!processingResult.mongodbIntegrationData && Object.keys(processingResult.mongodbIntegrationData || {}).length > 0,
                hasFormattedResult: !!processingResult.formattedResult && Object.keys(processingResult.formattedResult || {}).length > 0,
                mongodbIntegrationDataKeys: processingResult.mongodbIntegrationData ? Object.keys(processingResult.mongodbIntegrationData) : [],
                formattedResultKeys: processingResult.formattedResult ? Object.keys(processingResult.formattedResult) : [],
                allProcessingResultKeys: Object.keys(processingResult)
            });
            
            const response = processingResult.response;
            const agentThinking = processingResult.agentThinking;
            const optimizationsApplied = processingResult.optimizationsApplied;
            const cacheHit = processingResult.cacheHit;
            const agentPath = processingResult.agentPath;
            let riskLevel = processingResult.riskLevel;
            
            // Get predictive analytics for risk assessment (only for multi-agent)
            if (agentPath.includes('multi_agent')) {
                try {
                    const { multiAgentFlowService } = await import('./multiAgentFlow.service');
                    const analytics = await multiAgentFlowService.getPredictiveCostAnalytics(request.userId);
                    riskLevel = analytics.riskLevel;
                } catch (error) {
                    loggingService.warn('Could not get predictive analytics:', { error: error instanceof Error ? error.message : String(error) });
                }
            }

            const latency = Date.now() - startTime;
            
            // Calculate cost (rough estimation)
            const inputTokens = Math.ceil(actualMessage.length / 4);
            const outputTokens = Math.ceil(response.length / 4);
            const cost = CostEstimator.estimateCost(request.modelId, inputTokens, outputTokens);

            // Optimized: Save assistant response and update conversation in transaction
            const session2 = await mongoose.startSession();
            
            try {
                await session2.withTransaction(async () => {
                    // Save assistant response
                    await ChatMessage.create([{
                        conversationId: conversation._id,
                        userId: request.userId,
                        role: 'assistant',
                        content: response,
                        modelId: request.modelId,
                        metadata: {
                            temperature: request.temperature,
                            maxTokens: request.maxTokens,
                            cost,
                            latency,
                            tokenCount: outputTokens,
                            inputTokens,
                            outputTokens
                        },
                        // Save all integration-related fields
                        integrationSelectorData: processingResult.integrationSelectorData,
                        mongodbIntegrationData: processingResult.mongodbIntegrationData,
                        mongodbSelectedViewType: processingResult.formattedResult?.type || 'table',
                        mongodbResultData: processingResult.formattedResult?.data,
                        githubIntegrationData: (processingResult as any).githubIntegrationData,
                        vercelIntegrationData: (processingResult as any).vercelIntegrationData,
                        slackIntegrationData: (processingResult as any).slackIntegrationData,
                        discordIntegrationData: (processingResult as any).discordIntegrationData,
                        jiraIntegrationData: (processingResult as any).jiraIntegrationData,
                        linearIntegrationData: (processingResult as any).linearIntegrationData,
                        googleIntegrationData: (processingResult as any).googleIntegrationData,
                        awsIntegrationData: (processingResult as any).awsIntegrationData,
                        formattedResult: processingResult.formattedResult,
                        agentPath: processingResult.agentPath,
                        optimizationsApplied: processingResult.optimizationsApplied,
                        cacheHit: processingResult.cacheHit,
                        riskLevel: processingResult.riskLevel,
                    }], { session: session2 });

                    // Optimized: Increment message count instead of counting
                    conversation!.messageCount = (conversation!.messageCount || 0) + 2; // +2 for user + assistant
                    conversation!.totalCost = (conversation!.totalCost || 0) + cost;
                    conversation!.lastMessage = response.substring(0, 100) + (response.length > 100 ? '...' : '');
                    conversation!.lastMessageAt = new Date();
                    await conversation!.save({ session: session2 });
                });
            } finally {
                await session2.endSession();
            }

            // Track usage for analytics if template was used
            if (templateMetadata) {
                try {
                    const { UsageService } = await import('./usage.service');
                    // Helper function to truncate sensitive variable values
                    const truncateValue = (value: string, maxLength: number = 100): string => {
                        if (!value) return '';
                        return value.length > maxLength ? value.substring(0, maxLength) + '...' : value;
                    };

                    await UsageService.trackUsage({
                        userId: request.userId,
                        service: 'aws-bedrock',
                        model: request.modelId,
                        prompt: actualMessage.substring(0, 500), // Truncate for storage
                        completion: response.substring(0, 500), // Truncate for storage
                        promptTokens: inputTokens,
                        completionTokens: outputTokens,
                        totalTokens: inputTokens + outputTokens,
                        cost,
                        responseTime: latency,
                        metadata: {
                            source: 'chat',
                            conversationId: conversation!._id.toString(),
                            temperature: request.temperature,
                            maxTokens: request.maxTokens
                        },
                        tags: ['chat', 'template'],
                        optimizationApplied: false,
                        errorOccurred: false,
                        templateUsage: {
                            templateId: templateMetadata.id,
                            templateName: templateMetadata.name,
                            templateCategory: templateMetadata.category,
                            variablesResolved: templateMetadata.variablesResolved.map((v: any) => ({
                                variableName: v.variableName,
                                value: truncateValue(v.value),
                                confidence: v.confidence,
                                source: v.source,
                                reasoning: v.reasoning
                            })),
                            context: 'chat',
                            templateVersion: 1
                        }
                    });
                } catch (usageError) {
                    loggingService.warn('Failed to track template usage:', { 
                        error: usageError instanceof Error ? usageError.message : String(usageError) 
                    });
                }
            }

            loggingService.info(`Chat message sent successfully for user ${request.userId} with model ${request.modelId}`);

            const finalReturn = {
                messageId, // Use pre-generated messageId for activity streaming
                conversationId: conversation!._id.toString(),
                response,
                cost,
                latency,
                tokenCount: outputTokens,
                model: request.modelId,
                thinking: agentThinking,
                // Multi-agent enhancements
                optimizationsApplied,
                cacheHit,
                agentPath,
                riskLevel,
                templateUsed: templateMetadata,
                // Web search metadata
                webSearchUsed: (processingResult as any).webSearchUsed || (processingResult as any).metadata?.webSearchUsed || false,
                quotaUsed: (processingResult as any).quotaUsed,
                // AI autonomous web search decision metadata
                aiWebSearchDecision: (processingResult as any).aiWebSearchDecision || (processingResult as any).metadata?.aiWebSearchDecision,
                // IntegrationSelector data
                requiresIntegrationSelector: processingResult.requiresIntegrationSelector,
                integrationSelectorData: processingResult.integrationSelectorData,
                // MongoDB integration data
                mongodbIntegrationData: processingResult.mongodbIntegrationData,
                formattedResult: processingResult.formattedResult
            };

            loggingService.info('📤 [FLOW-8] chat.service.sendMessage FINAL RETURN', {
                hasMongodbIntegrationData: !!finalReturn.mongodbIntegrationData && Object.keys(finalReturn.mongodbIntegrationData || {}).length > 0,
                hasFormattedResult: !!finalReturn.formattedResult && Object.keys(finalReturn.formattedResult || {}).length > 0,
                allKeys: Object.keys(finalReturn)
            });

            return finalReturn;

        } catch (error) {
            loggingService.error('Error sending chat message:', { error: error instanceof Error ? error.message : String(error) });
            throw new Error('Failed to send chat message');
        }
    }
    
    /**
     * Get conversation history
     */
    static async getConversationHistory(
        conversationId: string, 
        userId: string, 
        limit: number = 50, 
        offset: number = 0
    ): Promise<{ messages: ChatMessageResponse[]; total: number; conversation: ConversationResponse | null }> {
        try {
            // Validate ObjectId format
            if (!Types.ObjectId.isValid(conversationId)) {
                loggingService.error('Invalid conversation ID format', { conversationId, userId });
                throw new Error('Invalid conversation ID format');
            }

            // Verify conversation ownership
            const conversation = await Conversation.findOne({
                _id: new Types.ObjectId(conversationId),
                userId: userId,
                isActive: true
            });
            
            if (!conversation) {
                loggingService.warn('Conversation not found or access denied', { conversationId, userId });
                throw new Error('Conversation not found or access denied');
            }

            const conversationObjectId = new Types.ObjectId(conversationId);

            // Get messages with pagination
            const messages = await ChatMessage.find({
                conversationId: conversationObjectId
            })
            .sort({ createdAt: 1 })
            .skip(offset)
            .limit(limit)
            .lean();

            // Debug logging to see what fields are in the messages
            if (messages.length > 0) {
                loggingService.info('Sample message fields from DB:', {
                    messageId: messages[0]._id,
                    hasGithubData: !!messages[0].githubIntegrationData,
                    hasFormattedResult: !!messages[0].formattedResult,
                    hasAgentPath: !!messages[0].agentPath,
                    allFields: Object.keys(messages[0])
                });
            }

            const total = await ChatMessage.countDocuments({
                conversationId: conversationObjectId
            });

            return {
                messages: messages.map(msg => this.convertMessageToResponse(msg)),
                total,
                conversation: this.convertConversationToResponse(conversation)
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            loggingService.error('Error getting conversation history', { 
                error: errorMessage,
                stack: errorStack,
                conversationId,
                userId,
                limit,
                offset
            });
            throw new Error(`Failed to get conversation history: ${errorMessage}`);
        }
    }

    /**
     * Get all conversations for a user
     */
    static async getUserConversations(
        userId: string, 
        limit: number = 20, 
        offset: number = 0,
        includeArchived: boolean = false
    ): Promise<{ conversations: ConversationResponse[]; total: number }> {
        try {
            const query: any = {
                userId: userId,
                isActive: true
            };

            if (!includeArchived) {
                query.isArchived = { $ne: true };
            }

            const conversations = await Conversation.find(query)
            .sort({ isPinned: -1, updatedAt: -1 })
            .skip(offset)
            .limit(limit)
            .lean();

            const total = await Conversation.countDocuments(query);

            return {
                conversations: conversations.map(this.convertConversationToResponse),
                total
            };

        } catch (error) {
            loggingService.error('Error getting user conversations:', { error: error instanceof Error ? error.message : String(error) });
            throw new Error('Failed to get user conversations');
        }
    }

    /**
     * Create a new conversation
     */
    static async createConversation(request: {
        userId: string;
        title: string;
        modelId: string;
    }): Promise<ConversationResponse> {
        try {
            const conversation = new Conversation({
                userId: request.userId,
                title: request.title,
                modelId: request.modelId,
                messageCount: 0,
                totalCost: 0,
                isActive: true
            });

            await conversation.save();

            loggingService.info(`New conversation created: ${conversation._id} for user ${request.userId}`);

            return this.convertConversationToResponse(conversation);

        } catch (error) {
            loggingService.error('Error creating conversation:', { error: error instanceof Error ? error.message : String(error) });
            throw new Error('Failed to create conversation');
        }
    }

    /**
     * Delete a conversation (soft delete)
     */
    static async deleteConversation(conversationId: string, userId: string): Promise<void> {
        try {
            const result = await Conversation.updateOne(
                { 
                    _id: conversationId,
                    userId: userId
                },
                { 
                    isActive: false,
                    deletedAt: new Date()
                }
            );

            if (result.matchedCount === 0) {
                throw new Error('Conversation not found or access denied');
            }

            loggingService.info(`Conversation soft deleted: ${conversationId} for user ${userId}`);

        } catch (error) {
            loggingService.error('Error deleting conversation:', { error: error instanceof Error ? error.message : String(error) });
            throw new Error('Failed to delete conversation');
        }
    }

    /**
     * Rename a conversation
     */
    static async renameConversation(userId: string, conversationId: string, title: string): Promise<ConversationResponse> {
        try {
            const conversation = await Conversation.findOneAndUpdate(
                { 
                    _id: conversationId,
                    userId: userId,
                    isActive: true
                },
                { 
                    title: title
                },
                { new: true }
            );

            if (!conversation) {
                throw new Error('Conversation not found or access denied');
            }

            loggingService.info(`Conversation renamed: ${conversationId} to "${title}" for user ${userId}`);

            return this.convertConversationToResponse(conversation);

        } catch (error) {
            loggingService.error('Error renaming conversation:', { error: error instanceof Error ? error.message : String(error) });
            throw new Error('Failed to rename conversation');
        }
    }

    /**
     * Archive or unarchive a conversation
     */
    static async archiveConversation(userId: string, conversationId: string, archived: boolean): Promise<ConversationResponse> {
        try {
            const conversation = await Conversation.findOneAndUpdate(
                { 
                    _id: conversationId,
                    userId: userId,
                    isActive: true
                },
                { 
                    isArchived: archived
                },
                { new: true }
            );

            if (!conversation) {
                throw new Error('Conversation not found or access denied');
            }

            loggingService.info(`Conversation ${archived ? 'archived' : 'unarchived'}: ${conversationId} for user ${userId}`);

            return this.convertConversationToResponse(conversation);

        } catch (error) {
            loggingService.error('Error archiving conversation:', { error: error instanceof Error ? error.message : String(error) });
            throw new Error('Failed to archive conversation');
        }
    }

    /**
     * Pin or unpin a conversation
     */
    static async pinConversation(userId: string, conversationId: string, pinned: boolean): Promise<ConversationResponse> {
        try {
            const conversation = await Conversation.findOneAndUpdate(
                { 
                    _id: conversationId,
                    userId: userId,
                    isActive: true
                },
                { 
                    isPinned: pinned
                },
                { new: true }
            );

            if (!conversation) {
                throw new Error('Conversation not found or access denied');
            }

            loggingService.info(`Conversation ${pinned ? 'pinned' : 'unpinned'}: ${conversationId} for user ${userId}`);

            return this.convertConversationToResponse(conversation);

        } catch (error) {
            loggingService.error('Error pinning conversation:', { error: error instanceof Error ? error.message : String(error) });
            throw new Error('Failed to pin conversation');
        }
    }

    /**
     * Convert ChatSendMessageRequest to HandlerRequest
     */
    private static convertToHandlerRequest(request: ChatSendMessageRequest): HandlerRequest {
        return {
            userId: request.userId,
            conversationId: request.conversationId || '',
            message: request.message,
            originalMessage: request.originalMessage,
            modelId: request.modelId,
            temperature: request.temperature,
            maxTokens: request.maxTokens,
            chatMode: request.chatMode,
            useMultiAgent: request.useMultiAgent,
            useWebSearch: request.useWebSearch,
            documentIds: request.documentIds,
            githubContext: request.githubContext,
            vercelContext: request.vercelContext,
            mongodbContext: request.mongodbContext,
            templateId: request.templateId,
            templateVariables: request.templateVariables,
            attachments: request.attachments,
            selectionResponse: request.selectionResponse
        };
    }

    /**
     * Generate a simple, descriptive title from the first message
     */
    static getAvailableModels(): Array<{
        id: string;
        name: string;
        provider: string;
        description: string;
        capabilities: string[];
        pricing?: {
            input: number;
            output: number;
            unit: string;
        };
    }> {
        return ModelRegistry.getAvailableModels();
    }

    /**
     * Generate a simple, descriptive title from the first message
     */
    private static generateSimpleTitle(firstMessage: string, modelId: string): string {
        // Remove markdown, code blocks, etc.
        let cleaned = firstMessage
            .replace(/```[\s\S]*?```/g, '')
            .replace(/`[^`]+`/g, '')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            .trim();
        
        // Get first sentence or first 60 characters
        const firstSentence = cleaned.split(/[.!?]/)[0].trim();
        
        if (firstSentence.length > 60) {
            return firstSentence.substring(0, 57) + '...';
        } else if (firstSentence.length > 0) {
            return firstSentence;
        } else {
            return `Chat with ${ModelMetadata.getDisplayName(modelId)}`;
        }
    }

    /**
     * Convert MongoDB conversation document to response format
     */
    private static convertConversationToResponse(conversation: any): ConversationResponse {
        return {
            id: conversation._id.toString(),
            userId: conversation.userId,
            title: conversation.title,
            modelId: conversation.modelId,
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,
            messageCount: conversation.messageCount || 0,
            lastMessage: conversation.lastMessage,
            totalCost: conversation.totalCost || 0,
            isPinned: conversation.isPinned || false,
            isArchived: conversation.isArchived || false,
            githubContext: conversation.githubContext ? {
                connectionId: conversation.githubContext.connectionId?.toString(),
                repositoryId: conversation.githubContext.repositoryId,
                repositoryName: conversation.githubContext.repositoryName,
                repositoryFullName: conversation.githubContext.repositoryFullName,
                integrationId: conversation.githubContext.integrationId?.toString(),
                branchName: conversation.githubContext.branchName
            } : undefined
        };
    }

    /**
     * Convert MongoDB message document to response format
     */
    private static convertMessageToResponse(message: any): ChatMessageResponse {
        try {
            // Debug log for troubleshooting
            if (message.role === 'assistant') {
                loggingService.debug('Converting assistant message:', {
                    id: message._id,
                    hasGithubData: !!message.githubIntegrationData,
                    hasFormattedResult: !!message.formattedResult,
                    hasAgentPath: !!message.agentPath,
                    agentPathValue: message.agentPath,
                    formattedResultType: message.formattedResult?.type
                });
            }
            
            return {
                id: message._id ? (typeof message._id === 'string' ? message._id : message._id.toString()) : '',
                conversationId: message.conversationId ? (typeof message.conversationId === 'string' ? message.conversationId : message.conversationId.toString()) : '',
                role: message.role || 'user',
                content: message.content || '',
                modelId: message.modelId,
                // Governed Agent fields
                messageType: message.messageType || message.role, // Default messageType to role if not set
                governedTaskId: message.governedTaskId ? (typeof message.governedTaskId === 'string' ? message.governedTaskId : message.governedTaskId.toString()) : undefined,
                planState: message.planState,
                attachedDocuments: message.attachedDocuments || [],
                attachments: message.attachments || [],
                timestamp: message.createdAt || message.timestamp || new Date(),
                metadata: message.metadata || {},
                // Include MongoDB integration fields
                mongodbSelectedViewType: message.mongodbSelectedViewType,
                integrationSelectorData: message.integrationSelectorData,
                mongodbIntegrationData: message.mongodbIntegrationData,
                // Include all integration data fields
                githubIntegrationData: message.githubIntegrationData,
                vercelIntegrationData: message.vercelIntegrationData,
                slackIntegrationData: message.slackIntegrationData,
                discordIntegrationData: message.discordIntegrationData,
                jiraIntegrationData: message.jiraIntegrationData,
                linearIntegrationData: message.linearIntegrationData,
                googleIntegrationData: message.googleIntegrationData,
                awsIntegrationData: message.awsIntegrationData,
                // Include formatted result and other metadata
                formattedResult: message.formattedResult || (message.mongodbResultData ? {
                    type: message.mongodbSelectedViewType || 'table',
                    data: message.mongodbResultData
                } : undefined),
                // Include agent metadata
                agentPath: message.agentPath || [],
                optimizationsApplied: message.optimizationsApplied || [],
                cacheHit: message.cacheHit,
                riskLevel: message.riskLevel
            };
        } catch (error) {
            loggingService.error('Error converting message to response', { 
                error: error instanceof Error ? error.message : String(error),
                messageId: message._id
            });
            // Return a safe default response
            return {
                id: message._id ? String(message._id) : '',
                conversationId: message.conversationId ? String(message.conversationId) : '',
                role: 'user',
                content: message.content || '',
                modelId: message.modelId,
                attachedDocuments: [],
                attachments: [],
                timestamp: new Date(),
                metadata: {}
            };
        }
    }

}
