import { BedrockService } from './tracedBedrock.service';
import { AWS_BEDROCK_PRICING } from '../utils/pricing/aws-bedrock';
import { Conversation, IConversation, ChatMessage } from '../models';
import { DocumentModel } from '../models/Document';
import { Types } from 'mongoose';
import mongoose from 'mongoose';
import { StateGraph, Annotation } from '@langchain/langgraph';
import { ChatBedrockConverse } from '@langchain/aws';
import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { Tool } from '@langchain/core/tools';
import { AgentExecutor } from 'langchain/agents';
import { multiAgentFlowService } from './multiAgentFlow.service';
import { loggingService } from './logging.service';
import { IntegrationChatService, ParsedMention } from './integrationChat.service';
import { MCPIntegrationHandler } from './mcpIntegrationHandler.service';
import { GoogleService } from './google.service';
import { TextExtractionService } from './textExtraction.service';
import { IntegrationType } from '../mcp/types/permission.types';

// Conversation Context Types
export interface ConversationContext {
    conversationId: string;
    currentSubject?: string;
    currentIntent?: string;
    lastReferencedEntities: string[];
    lastToolUsed?: string;
    lastDomain?: string;
    languageFramework?: string;
    subjectConfidence: number;
    timestamp: Date;
}

export interface CoreferenceResult {
    resolved: boolean;
    subject?: string;
    confidence: number;
    method: 'rule-based' | 'llm-fallback';
}

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
    // Context management
    private static contextCache = new Map<string, ConversationContext>();

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
            const userIntent = this.analyzeUserIntent(userMessage, coordinationAnalysis);

            return {
                currentAgent: 'coordinator',
                userIntent,
                contextData: {
                    coordinationAnalysis,
                    complexity: this.assessComplexity(userMessage),
                    requiresStrategy: userMessage.toLowerCase().includes('strategy') || userMessage.toLowerCase().includes('plan'),
                    requiresInput: this.requiresUserInput(userMessage),
                    integrationNeeds: this.identifyIntegrationNeeds(userMessage)
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
            const questions = this.extractStrategicQuestions(strategyContent);
            
            return {
                currentAgent: 'strategy_formation',
                strategyFormation: {
                    questions,
                    responses: {},
                    currentQuestion: 0,
                    isComplete: false,
                    adaptiveQuestions: this.generateAdaptiveQuestions(userMessage, state.contextData)
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
            const needsOptions = this.shouldGenerateOptions(currentQuestion, userContext);
            
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
                const options = this.parseOptionsFromResponse(optionsContent);
                
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
                            parameterName: this.extractParameterName(currentQuestion),
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
            const autonomousActions = await this.determineAutonomousActions(autonomousContext);
            
            // Execute autonomous workflows
            const executionResults = await this.executeAutonomousWorkflows(autonomousActions, state);

            // Generate proactive insights
            const proactiveInsights = this.generateProactiveInsights(state);
            
            // Predict next user needs
            const predictedNeeds = await this.predictUserNeeds(state);
            
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
                taskPriority: this.calculateTaskPriority(state),
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

    // =================== HELPER METHODS ===================

    private static analyzeUserIntent(message: string, _analysis: string): string {
        const lowerMessage = message.toLowerCase();
        
        if (lowerMessage.includes('strategy') || lowerMessage.includes('plan')) {
            return 'strategic_planning';
        }
        if (lowerMessage.includes('optimize') || lowerMessage.includes('improve')) {
            return 'optimization_request';
        }
        if (lowerMessage.includes('integrate') || lowerMessage.includes('connect')) {
            return 'integration_request';
        }
        if (lowerMessage.includes('analyze') || lowerMessage.includes('report')) {
            return 'analytics_request';
        }
        if (lowerMessage.includes('automate') || lowerMessage.includes('workflow')) {
            return 'automation_request';
        }
        
        return 'general_assistance';
    }

    private static assessComplexity(message: string): 'low' | 'medium' | 'high' {
        const wordCount = message.split(' ').length;
        const hasMultipleQuestions = (message.match(/\?/g) || []).length > 1;
        const hasIntegrationTerms = ['aws', 'google', 'github', 'integrate', 'connect'].some(term => 
            message.toLowerCase().includes(term)
        );
        
        if (wordCount > 100 || hasMultipleQuestions || hasIntegrationTerms) {
            return 'high';
        } else if (wordCount > 30) {
            return 'medium';
        }
        return 'low';
    }

    private static requiresUserInput(message: string): boolean {
        const inputIndicators = [
            'how should', 'what would you', 'which option', 'help me choose',
            'need to know', 'strategy', 'plan', 'configure', 'setup'
        ];
        return inputIndicators.some(indicator => message.toLowerCase().includes(indicator));
    }

    private static identifyIntegrationNeeds(message: string): string[] {
        const integrations: string[] = [];
        const lowerMessage = message.toLowerCase();
        
        if (lowerMessage.includes('aws') || lowerMessage.includes('bedrock') || lowerMessage.includes('cost')) {
            integrations.push('aws');
        }
        if (lowerMessage.includes('google') || lowerMessage.includes('workspace') || lowerMessage.includes('gmail') || 
            lowerMessage.includes('drive') || lowerMessage.includes('sheets')) {
            integrations.push('google');
        }
        if (lowerMessage.includes('github') || lowerMessage.includes('repository') || lowerMessage.includes('code')) {
            integrations.push('github');
        }
        if (lowerMessage.includes('vercel') || lowerMessage.includes('deployment')) {
            integrations.push('vercel');
        }
        
        return integrations;
    }

    private static extractStrategicQuestions(content: string): string[] {
        // Simple extraction - in production, use more sophisticated parsing
        const questions = content.split(/[.!?]/)
            .filter(sentence => sentence.includes('?') || sentence.toLowerCase().includes('need to'))
            .map(q => q.trim())
            .filter(q => q.length > 10)
            .slice(0, 5);
            
        return questions.length > 0 ? questions : [
            'What is your primary goal with this request?',
            'What timeline are you working with?',
            'Are there any specific constraints or requirements?'
        ];
    }

    private static generateAdaptiveQuestions(message: string, _context: any): string[] {
        return [
            `Based on "${message}", what specific outcomes are you looking for?`,
            'Are there any additional requirements or constraints?',
            'How would you measure success for this initiative?'
        ];
    }

    private static generateProactiveInsights(state: LangchainChatStateType): string[] {
        const insights = [];
        
        if (state.integrationContext?.aws) {
            insights.push('Cost optimization opportunities identified in AWS usage');
        }
        if (state.integrationContext?.google) {
            insights.push('Workflow automation potential detected in Google Workspace');
        }
        if (state.integrationContext?.github) {
            insights.push('Development efficiency improvements available in GitHub workflows');
        }
        if ((state.conversationDepth || 0) > 3) {
            insights.push('Complex multi-step workflow detected - automation recommended');
        }
        
        return insights;
    }

    private static calculateTaskPriority(state: LangchainChatStateType): number {
        const urgencyKeywords = ['urgent', 'asap', 'critical', 'emergency', 'immediately'];
        const lastMessage = state.messages[state.messages.length - 1]?.content as string || '';
        
        if (urgencyKeywords.some(keyword => lastMessage.toLowerCase().includes(keyword))) {
            return 10;
        }
        
        const complexityBonus = state.contextData?.complexity === 'high' ? 3 : 
                              state.contextData?.complexity === 'medium' ? 1 : 0;
        const integrationBonus = Object.keys(state.integrationContext || {}).length;
        
        return Math.min((state.conversationDepth || 1) + complexityBonus + integrationBonus, 10);
    }

    /**
     * Determine autonomous actions using AWS Bedrock Claude 3.5 Sonnet
     * Production-quality AI-driven action determination
     */
    private static async determineAutonomousActions(context: any): Promise<Array<{
        action: string;
        priority: number;
        reasoning: string;
        parameters: any;
    }>> {
        try {
            // Use Claude Opus 4.1 for complex reasoning about autonomous actions
            const llm = new ChatBedrockConverse({
                model: 'us.anthropic.claude-opus-4-1-20250805-v1:0',
                region: process.env.AWS_REGION || 'us-east-1',
                temperature: 0.7,
                maxTokens: 2000,
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
                },
            });

            const analysisPrompt = new HumanMessage(`You are an autonomous AI decision-making system. Analyze the following context and determine what autonomous actions should be taken to help the user.

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
            
            // Parse AI response
            let actions: Array<{ action: string; priority: number; reasoning: string; parameters: any }> = [];
            
            try {
                // Try to extract JSON from response
                const jsonMatch = responseText.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    actions = JSON.parse(jsonMatch[0]);
                }
            } catch (parseError) {
                loggingService.warn('Failed to parse AI action response, using fallback', {
                    error: parseError instanceof Error ? parseError.message : String(parseError)
                });
            }

            // Validate and sanitize actions
            actions = actions
                .filter(a => a.action && typeof a.priority === 'number' && a.reasoning)
                .sort((a, b) => b.priority - a.priority)
                .slice(0, 5); // Top 5 actions

            loggingService.info('AI determined autonomous actions', {
                actionCount: actions.length,
                topAction: actions[0]?.action
            });

            return actions;

        } catch (error) {
            loggingService.error('Failed to determine autonomous actions with AI', {
                error: error instanceof Error ? error.message : String(error)
            });
            
            // Fallback: Return basic actions based on context
            const fallbackActions = [];
            
            if (context.userIntent?.includes('cost') || context.userIntent?.includes('optimization')) {
                fallbackActions.push({
                    action: 'enable_cortex_optimization',
                    priority: 9,
                    reasoning: 'User interested in cost optimization - Cortex provides 40-75% savings',
                    parameters: { autoEnable: false, notifyUser: true }
                });
            }
            
            if (!context.integrations?.aws && context.userIntent?.includes('deploy')) {
                fallbackActions.push({
                    action: 'suggest_aws_integration',
                    priority: 7,
                    reasoning: 'User wants deployment but AWS not connected',
                    parameters: { showBenefits: true }
                });
            }
            
            return fallbackActions;
        }
    }

    /**
     * Execute autonomous workflows using AWS Bedrock Nova Pro
     * Production-quality workflow execution with AI validation
     */
    private static async executeAutonomousWorkflows(
        actions: Array<{ action: string; parameters: any }>,
        state: LangchainChatStateType
    ): Promise<any[]> {
        const results = [];
        
        try {
            // Use Nova Pro for fast execution coordination
            const llm = new ChatBedrockConverse({
                model: 'amazon.nova-pro-v1:0',
                region: process.env.AWS_REGION || 'us-east-1',
                temperature: 0.3,
                maxTokens: 1500,
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
                },
            });

            for (const action of actions.slice(0, 3)) { // Execute top 3 actions
                try {
                    let executionResult: any = {
                        action: action.action,
                        success: false,
                        message: '',
                        impact: 'unknown'
                    };

                    // Execute specific action types
                    switch (action.action) {
                        case 'enable_cortex_optimization':
                            executionResult = {
                                action: action.action,
                                success: true,
                                message: 'Cortex optimization recommended for 40-75% cost savings',
                                impact: 'high',
                                nextSteps: ['Enable in settings', 'Review optimization strategies', 'Monitor savings'],
                                estimatedSavings: '40-75%'
                            };
                            break;

                        case 'analyze_usage_patterns':
                            // Use AI to analyze patterns
                            const analysisPrompt = new HumanMessage(`Analyze AI usage patterns and provide insights:
                            
Context: ${JSON.stringify(state.contextData, null, 2)}
Conversation Depth: ${state.conversationDepth}

Provide 3-5 actionable insights about usage patterns, cost optimization, and efficiency improvements.
Format as JSON array of strings.`);
                            
                            const analysisResponse = await llm.invoke([analysisPrompt]);
                            const analysisText = analysisResponse.content.toString();
                            
                            let insights = ['Usage pattern analysis in progress'];
                            try {
                                const jsonMatch = analysisText.match(/\[[\s\S]*\]/);
                                if (jsonMatch) {
                                    insights = JSON.parse(jsonMatch[0]);
                                }
                            } catch (e) {
                                // Use fallback insights
                            }
                            
                            executionResult = {
                                action: action.action,
                                success: true,
                                insights: insights.slice(0, 5),
                                message: `Analyzed usage patterns - ${insights.length} insights found`,
                                impact: 'medium'
                            };
                            break;

                        case 'suggest_workflow_automation':
                            executionResult = {
                                action: action.action,
                                success: true,
                                workflow: {
                                    name: 'AI Cost Optimization Workflow',
                                    steps: 5,
                                    estimatedSavings: '3 hours/week',
                                    features: ['Automated reporting', 'Cost alerts', 'Usage optimization']
                                },
                                message: 'Workflow automation recommended for efficiency',
                                impact: 'high'
                            };
                            break;

                        case 'optimize_model_selection':
                            // Use AI to suggest optimal models
                            const modelPrompt = new HumanMessage(`Based on this chat mode and usage: ${state.contextData?.chatMode || 'balanced'}, recommend optimal AI models.
                            
Consider: cost, speed, quality balance.
Return JSON object with: { recommended: [model names], reasoning: "why" }`);
                            
                            const modelResponse = await llm.invoke([modelPrompt]);
                            const modelText = modelResponse.content.toString();
                            
                            let modelSuggestion = { 
                                recommended: ['amazon.nova-pro-v1:0'], 
                                reasoning: 'Balanced performance and cost' 
                            };
                            
                            try {
                                const jsonMatch = modelText.match(/\{[\s\S]*\}/);
                                if (jsonMatch) {
                                    modelSuggestion = JSON.parse(jsonMatch[0]);
                                }
                            } catch (e) {
                                // Use fallback
                            }
                            
                            executionResult = {
                                action: action.action,
                                success: true,
                                ...modelSuggestion,
                                message: 'Model optimization suggestions generated',
                                impact: 'medium'
                            };
                            break;

                        case 'suggest_aws_integration':
                        case 'suggest_google_integration':
                        case 'suggest_github_integration':
                            const integration = action.action.replace('suggest_', '').replace('_integration', '');
                            executionResult = {
                                action: action.action,
                                success: true,
                                integration: integration.toUpperCase(),
                                benefits: [
                                    'Seamless automation',
                                    'Enhanced productivity',
                                    'Cost optimization',
                                    'Intelligent workflows'
                                ],
                                message: `${integration.toUpperCase()} integration recommended for enhanced capabilities`,
                                impact: 'high'
                            };
                            break;

                        default:
                            executionResult = {
                                action: action.action,
                                success: true,
                                message: `Action ${action.action} identified for execution`,
                                impact: 'low'
                            };
                    }

                    results.push(executionResult);
                    
                } catch (actionError) {
                    loggingService.warn('Action execution failed', {
                        action: action.action,
                        error: actionError instanceof Error ? actionError.message : String(actionError)
                    });
                    
                    results.push({
                        action: action.action,
                        success: false,
                        error: actionError instanceof Error ? actionError.message : 'Unknown error',
                        impact: 'none'
                    });
                }
            }

            loggingService.info('Autonomous workflows executed', {
                totalActions: actions.length,
                executedActions: results.length,
                successfulActions: results.filter(r => r.success).length
            });

        } catch (error) {
            loggingService.error('Failed to execute autonomous workflows', {
                error: error instanceof Error ? error.message : String(error)
            });
        }

        return results;
    }

    /**
     * Predict user needs using AWS Bedrock Nova Pro
     * Production-quality predictive analytics
     */
    private static async predictUserNeeds(state: LangchainChatStateType): Promise<string[]> {
        try {
            // Use Nova Pro for fast pattern analysis and prediction
            const llm = new ChatBedrockConverse({
                model: 'amazon.nova-pro-v1:0',
                region: process.env.AWS_REGION || 'us-east-1',
                temperature: 0.6,
                maxTokens: 1000,
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
                },
            });

            const predictionPrompt = new HumanMessage(`You are a predictive AI assistant. Analyze the conversation and predict what the user might need next.

Current Context:
- User Intent: ${state.userIntent || 'Not specified'}
- Conversation Depth: ${state.conversationDepth || 0}
- Recent Topics: ${state.messages.slice(-3).map(m => m.content).join('; ')}
- Autonomous Decisions Made: ${state.autonomousDecisions?.slice(-3).join('; ') || 'None'}
- Time: ${new Date().getHours()}:00 (${new Date().toLocaleTimeString('en-US', { timeZone: 'UTC', hour12: false }).split(':')[0] >= '09' && new Date().toLocaleTimeString('en-US', { timeZone: 'UTC', hour12: false }).split(':')[0] <= '17' ? 'Business hours' : 'After hours'})

Predict 3-5 things the user might need next. Consider:
- Natural conversation flow
- Common follow-up questions
- Related tasks or actions
- Time-based needs
- Proactive assistance opportunities

Return ONLY a JSON array of predicted needs as strings. Example: ["View cost breakdown", "Set up budget alerts", "Optimize model selection"]`);

            const response = await llm.invoke([predictionPrompt]);
            const responseText = response.content.toString().trim();
            
            let predictions: string[] = [];
            
            try {
                const jsonMatch = responseText.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    predictions = JSON.parse(jsonMatch[0]);
                }
            } catch (parseError) {
                loggingService.warn('Failed to parse AI predictions, using fallback', {
                    error: parseError instanceof Error ? parseError.message : String(parseError)
                });
            }

            // Validate and sanitize predictions
            predictions = predictions
                .filter(p => typeof p === 'string' && p.length > 5 && p.length < 100)
                .slice(0, 5);

            // Add time-based predictions
            const hour = new Date().getHours();
            if (hour >= 9 && hour <= 11 && !predictions.some(p => p.toLowerCase().includes('report'))) {
                predictions.push('Review daily cost report');
            }

            loggingService.info('AI predicted user needs', {
                predictionCount: predictions.length,
                topPrediction: predictions[0]
            });

            return predictions.slice(0, 5);

        } catch (error) {
            loggingService.error('Failed to predict user needs with AI', {
                error: error instanceof Error ? error.message : String(error)
            });
            
            // Fallback predictions based on context
            const fallbackPredictions = [];
            const userIntent = state.userIntent?.toLowerCase() || '';
            
            if (userIntent.includes('cost') || userIntent.includes('budget')) {
                fallbackPredictions.push('View cost breakdown by service');
                fallbackPredictions.push('Set up budget alerts');
                fallbackPredictions.push('Explore optimization recommendations');
            }
            
            if (userIntent.includes('integration')) {
                fallbackPredictions.push('Check integration health');
                fallbackPredictions.push('Discover new integration opportunities');
            }
            
            if ((state.conversationDepth || 0) > 10) {
                fallbackPredictions.push('Save conversation as workflow');
                fallbackPredictions.push('Create automation from this chat');
            }
            
            return fallbackPredictions.slice(0, 5);
        }
    }

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

    // Static fallback models to prevent memory allocation on every error
    private static readonly FALLBACK_MODELS = [
        {
            id: 'amazon.nova-micro-v1:0',
            name: 'Nova Micro',
            provider: 'Amazon',
            description: 'Fast and cost-effective model for simple tasks',
            capabilities: ['text', 'chat'],
            pricing: { input: 0.035, output: 0.14, unit: 'Per 1M tokens' }
        },
        {
            id: 'amazon.nova-lite-v1:0',
            name: 'Nova Lite',
            provider: 'Amazon',
            description: 'Balanced performance and cost for general use',
            capabilities: ['text', 'chat'],
            pricing: { input: 0.06, output: 0.24, unit: 'Per 1M tokens' }
        },
        {
            id: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
            name: 'Claude 3.5 Haiku',
            provider: 'Anthropic',
            description: 'Fast and intelligent for quick responses',
            capabilities: ['text', 'chat'],
            pricing: { input: 1.0, output: 5.0, unit: 'Per 1M tokens' }
        },
        {
            id: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
            name: 'Claude 3.5 Sonnet',
            provider: 'Anthropic',
            description: 'Advanced reasoning and analysis capabilities',
            capabilities: ['text', 'chat'],
            pricing: { input: 3.0, output: 15.0, unit: 'Per 1M tokens' }
        },
        {
            id: 'meta.llama3-1-8b-instruct-v1:0',
            name: 'Llama 3.1 8B',
            provider: 'Meta',
            description: 'Good balance of performance and efficiency',
            capabilities: ['text', 'chat'],
            pricing: { input: 0.3, output: 0.6, unit: 'Per 1M tokens' }
        }
    ];

    // Circuit breaker for error handling
    private static errorCounts = new Map<string, number>();
    private static readonly MAX_ERRORS = 5;
    private static readonly ERROR_RESET_TIME = 5 * 60 * 1000; // 5 minutes

    // Context Management Methods
    private static buildConversationContext(
        conversationId: string, 
        userMessage: string, 
        recentMessages: any[]
    ): ConversationContext {
        const existingContext = this.contextCache.get(conversationId);
        
        // Extract entities from current message and recent history
        const entities = this.extractEntities(userMessage, recentMessages);
        
        // Determine current subject and intent
        const { subject, intent, domain, confidence } = this.analyzeMessage(userMessage, recentMessages);
        
        const context: ConversationContext = {
            conversationId,
            currentSubject: subject || existingContext?.currentSubject,
            currentIntent: intent,
            lastReferencedEntities: [...(existingContext?.lastReferencedEntities || []), ...entities].slice(-10), // Keep last 10
            lastToolUsed: existingContext?.lastToolUsed,
            lastDomain: domain || existingContext?.lastDomain,
            languageFramework: this.detectLanguageFramework(userMessage),
            subjectConfidence: confidence,
            timestamp: new Date()
        };

        // Cache the context
        this.contextCache.set(conversationId, context);
        
        loggingService.info('🔍 Built conversation context', {
            conversationId,
            subject: context.currentSubject,
            intent: context.currentIntent,
            domain: context.lastDomain,
            confidence: context.subjectConfidence,
            entitiesCount: context.lastReferencedEntities.length
        });

        return context;
    }

    private static extractEntities(message: string, recentMessages: any[]): string[] {
        const entities: string[] = [];
        const text = `${message} ${recentMessages.map(m => m.content).join(' ')}`.toLowerCase();
        
        // Package entities
        const packagePatterns = [
            /cost-katana/g, /cost-katana-cli/g,
            /npm\s+package/g, /pypi\s+package/g, /python\s+package/g,
            /javascript\s+package/g, /typescript\s+package/g
        ];
        
        packagePatterns.forEach(pattern => {
            const matches = text.match(pattern);
            if (matches) entities.push(...matches);
        });

        // Service entities
        const servicePatterns = [
            /costkatana/g, /cost katana/g, /backend/g, /api/g,
            /claude/g, /gpt/g, /bedrock/g, /openai/g
        ];
        
        servicePatterns.forEach(pattern => {
            const matches = text.match(pattern);
            if (matches) entities.push(...matches);
        });

        return [...new Set(entities)]; // Remove duplicates
    }

    private static analyzeMessage(message: string, recentMessages: any[]): {
        subject?: string;
        intent?: string;
        domain?: string;
        confidence: number;
    } {
        const lowerMessage = message.toLowerCase();
        
        // Intent detection
        let intent = 'general';
        if (lowerMessage.includes('how to') || lowerMessage.includes('integrate') || lowerMessage.includes('install')) {
            intent = 'integration';
        } else if (lowerMessage.includes('example') || lowerMessage.includes('code')) {
            intent = 'example';
        } else if (lowerMessage.includes('error') || lowerMessage.includes('issue') || lowerMessage.includes('problem')) {
            intent = 'troubleshooting';
        }

        // Domain detection
        let domain = 'general';
        let subject: string | undefined;
        let confidence = 0.5;

        if (lowerMessage.includes('costkatana') || lowerMessage.includes('cost katana')) {
            domain = 'costkatana';
            confidence = 0.9;
            
            if (lowerMessage.includes('python') || lowerMessage.includes('pypi')) {
                subject = 'cost-katana';
            } else if (lowerMessage.includes('npm') || lowerMessage.includes('javascript') || lowerMessage.includes('typescript')) {
                subject = 'cost-katana';
            } else if (lowerMessage.includes('cli') || lowerMessage.includes('command')) {
                subject = 'cost-katana-cli';
            }
        } else if (lowerMessage.includes('package') || lowerMessage.includes('npm') || lowerMessage.includes('pypi')) {
            domain = 'packages';
            confidence = 0.8;
        } else if (lowerMessage.includes('cost') || lowerMessage.includes('billing') || lowerMessage.includes('pricing')) {
            domain = 'billing';
            confidence = 0.7;
        }

        // Check for coreference (this, that, it, the package, etc.)
        const corefPatterns = [
            /this\s+(package|tool|service|model)/g,
            /that\s+(package|tool|service|model)/g,
            /the\s+(package|tool|service|model)/g,
            /\bit\b/g
        ];
        
        const hasCoref = corefPatterns.some(pattern => pattern.test(lowerMessage));
        if (hasCoref && recentMessages.length > 0) {
            // Try to resolve from recent context
            const recentContext = recentMessages.slice(-3).map(m => m.content).join(' ');
            if (recentContext.includes('cost-katana') || recentContext.includes('python') || recentContext.includes('npm')) {
                subject = 'cost-katana';
            } else if (recentContext.includes('cost-katana-cli') || recentContext.includes('cli')) {
                subject = 'cost-katana-cli';
            }
            confidence = Math.max(confidence, 0.6);
        }

        return { subject, intent, domain, confidence };
    }

    private static detectLanguageFramework(message: string): string | undefined {
        const lowerMessage = message.toLowerCase();
        
        if (lowerMessage.includes('python') || lowerMessage.includes('pip') || lowerMessage.includes('pypi')) {
            return 'python';
        } else if (lowerMessage.includes('javascript') || lowerMessage.includes('typescript') || lowerMessage.includes('node') || lowerMessage.includes('npm')) {
            return 'javascript';
        } else if (lowerMessage.includes('react') || lowerMessage.includes('vue') || lowerMessage.includes('angular')) {
            return 'frontend';
        }
        
        return undefined;
    }

    private static async resolveCoreference(
        message: string, 
        context: ConversationContext, 
        recentMessages: any[]
    ): Promise<CoreferenceResult> {
        const lowerMessage = message.toLowerCase();
        
        // Rule-based coreference resolution
        const corefPatterns = [
            { pattern: /this\s+(package|tool|service|model)/g, weight: 0.9 },
            { pattern: /that\s+(package|tool|service|model)/g, weight: 0.8 },
            { pattern: /the\s+(package|tool|service|model)/g, weight: 0.7 },
            { pattern: /\bit\b/g, weight: 0.6 }
        ];
        
        for (const { pattern, weight } of corefPatterns) {
            if (pattern.test(lowerMessage)) {
                if (context.currentSubject) {
                    return {
                        resolved: true,
                        subject: context.currentSubject,
                        confidence: weight * context.subjectConfidence,
                        method: 'rule-based'
                    };
                }
            }
        }

        // LLM fallback for ambiguous cases
        if (context.subjectConfidence < 0.6) {
            try {
                const llm = new (await import('@langchain/aws')).ChatBedrockConverse({
                    model: "global.anthropic.claude-haiku-4-5-20251001-v1:0",  // Using inference profile
                    region: process.env.AWS_REGION ?? 'us-east-1',
                    temperature: 0.1,
                    maxTokens: 200,
                });

                const contextSummary = recentMessages.slice(-2).map(m => `${m.role}: ${m.content}`).join('\n');
                const prompt = `Context: ${contextSummary}\n\nUser query: ${message}\n\nWhat is the user referring to with "this", "that", "it", or "the package"? Respond with just the entity name or "unclear".`;

                const response = await llm.invoke([new (await import('@langchain/core/messages')).HumanMessage(prompt)]);
                const resolvedSubject = response.content?.toString().trim().toLowerCase();

                if (resolvedSubject && resolvedSubject !== 'unclear') {
                    return {
                        resolved: true,
                        subject: resolvedSubject,
                        confidence: 0.7,
                        method: 'llm-fallback'
                    };
                }
            } catch (error) {
                loggingService.warn('LLM coreference resolution failed', { error: error instanceof Error ? error.message : String(error) });
            }
        }

        return {
            resolved: false,
            confidence: 0.3,
            method: 'rule-based'
        };
    }

    /**
     * AI-powered route decision using the AI Query Router
     * Replaces regex-based routing with intelligent AI decisions
     */
    private static async decideRouteWithAI(
        context: ConversationContext, 
        message: string, 
        userId: string,
        useWebSearch?: boolean
    ): Promise<'knowledge_base' | 'conversational_flow' | 'multi_agent' | 'web_scraper'> {
        // If web search is explicitly enabled, force web scraper route
        if (useWebSearch === true) {
            loggingService.info('🌐 Web search explicitly enabled, routing to web scraper', {
                query: message.substring(0, 100)
            });
            return 'web_scraper';
        }

        try {
            // Import AI router dynamically to avoid circular dependencies
            const { aiQueryRouter } = await import('./aiQueryRouter.service');
            const { VercelConnection } = await import('../models');
            const { GitHubConnection } = await import('../models/GitHubConnection');
            const { GoogleConnection } = await import('../models/GoogleConnection');

            // Check user's integration connections
            const [vercelConn, githubConn, googleConn] = await Promise.all([
                VercelConnection.findOne({ userId, isActive: true }).lean(),
                GitHubConnection.findOne({ userId, isActive: true }).lean(),
                GoogleConnection.findOne({ userId, isActive: true }).lean()
            ]);

            // Build router context
            const routerContext = {
                userId,
                hasVercelConnection: !!vercelConn,
                hasGithubConnection: !!githubConn,
                hasGoogleConnection: !!googleConn,
                conversationSubject: context.currentSubject
            };

            // Get AI routing decision
            const decision = await aiQueryRouter.routeQuery(message, routerContext);

            loggingService.info('🧠 AI Router decision', {
                route: decision.route,
                confidence: decision.confidence,
                reasoning: decision.reasoning,
                userId
            });

            // Map AI router routes to internal routes
            switch (decision.route) {
                case 'vercel_tools':
                case 'github_tools':
                case 'google_tools':
                case 'multi_agent':
                    // These go to conversational flow which uses the agent with appropriate tools
                    return 'conversational_flow';
                
                case 'knowledge_base':
                    return 'knowledge_base';
                
                case 'analytics':
                case 'optimization':
                    return 'multi_agent';
                
                case 'web_search':
                    return 'web_scraper';
                
                case 'direct_response':
                default:
                    return 'conversational_flow';
            }

        } catch (error: any) {
            loggingService.warn('AI Router failed, using legacy routing', {
                error: error.message,
                message: message.substring(0, 100)
            });

            // Fallback to legacy regex-based routing
            return this.decideRouteLegacy(context, message, useWebSearch);
        }
    }

    /**
     * Legacy regex-based routing (fallback when AI router fails)
     */
    private static decideRouteLegacy(
        context: ConversationContext, 
        message: string, 
        useWebSearch?: boolean
    ): 'knowledge_base' | 'conversational_flow' | 'multi_agent' | 'web_scraper' {
        const lowerMessage = message.toLowerCase();
        
        // If web search is explicitly enabled, force web scraper route
        if (useWebSearch === true) {
            return 'web_scraper';
        }
        
        // Integration commands should go to conversational flow
        if (message.includes('@vercel') || message.includes('@github') || message.includes('@google')) {
            return 'conversational_flow';
        }
        
        // High confidence CostKatana queries go to knowledge base
        if (context.lastDomain === 'costkatana' && context.subjectConfidence > 0.7) {
            return 'knowledge_base';
        }
        
        // CostKatana specific queries
        const costKatanaTerms = ['costkatana', 'cost katana', 'cortex', 'documentation', 'guide'];
        if (costKatanaTerms.some(term => lowerMessage.includes(term))) {
            return 'knowledge_base';
        }
        
        // Web scraping for external content
        if ((lowerMessage.includes('latest') || lowerMessage.includes('news')) &&
            (lowerMessage.includes('search') || lowerMessage.includes('find'))) {
            return 'web_scraper';
        }
        
        // Analytics queries about user's own data
        if (lowerMessage.includes('my cost') || lowerMessage.includes('my usage')) {
            return 'multi_agent';
        }
        
        // Default to conversational flow
        return 'conversational_flow';
    }

    private static buildContextPreamble(context: ConversationContext, recentMessages: any[]): string {
        const preamble = [];
        
        if (context.currentSubject) {
            preamble.push(`Current subject: ${context.currentSubject}`);
        }
        
        if (context.currentIntent) {
            preamble.push(`Intent: ${context.currentIntent}`);
        }
        
        if (context.lastReferencedEntities.length > 0) {
            preamble.push(`Recent entities: ${context.lastReferencedEntities.slice(-3).join(', ')}`);
        }
        
        if (recentMessages.length > 0) {
            const recentContext = recentMessages.slice(-2).map(m => `${m.role}: ${m.content}`).join('\n');
            preamble.push(`Recent conversation:\n${recentContext}`);
        }
        
        return preamble.join('\n\n');
    }

    /**
     * Get optimal context size based on message complexity
     */
    private static getOptimalContextSize(messageLength: number): number {
        if (messageLength > 1000) return 5;  // Complex messages need less context
        if (messageLength > 500) return 8;   // Medium messages
        return 10; // Simple messages can handle more context
    }

    /**
     * Get recent messages with optimized context sizing
     */
    private static async getOptimalContext(
        conversationId: string, 
        messageLength: number
    ): Promise<any[]> {
        const contextSize = this.getOptimalContextSize(messageLength);
        
        return ChatMessage.find(
            { conversationId: new Types.ObjectId(conversationId) },
            { content: 1, role: 1, createdAt: 1, _id: 0 } // Project only needed fields
        )
        .sort({ createdAt: -1 })
        .limit(contextSize)
        .lean()
        .exec();
    }

    /**
     * Detect if message requires integration tools
     */
    private static async detectIntegrationIntent(
        message: string,
        userId: string
    ): Promise<{
        needsIntegration: boolean;
        integrations: IntegrationType[];
        suggestedTools: string[];
        confidence: number;
    }> {
        try {
            // Use AI to analyze the message
            const model = new ChatBedrockConverse({
                model: 'anthropic.claude-3-haiku-20240307-v1:0',
                region: process.env.AWS_REGION || 'us-east-1',
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
                },
            });

            const systemPrompt = `Analyze the user's message to determine if it requires integration tools.

Integration keywords and patterns:
- Vercel: deploy, deployment, hosting, vercel, build logs, environment variables
- GitHub: pull request, PR, issue, branch, commit, repository, github, merge
- Google: drive, docs, sheets, gmail, calendar, google workspace
- MongoDB: database, collection, query, find, aggregate, insert, update, delete, mongodb
- Slack: channel, message, slack, notify, send to slack
- Discord: discord, server, channel, message
- Jira: ticket, issue, jira, epic, sprint
- Linear: linear, issue, project, cycle

Return a JSON object with:
{
  "needsIntegration": boolean,
  "integrations": ["vercel", "github", etc.],
  "suggestedTools": ["vercel_deploy", "github_create_pr", etc.],
  "confidence": 0.0-1.0
}

If no integration is needed, return needsIntegration: false with empty arrays.`;

            const response = await model.invoke([
                new SystemMessage(systemPrompt),
                new HumanMessage(message),
            ]);

            try {
                const result = JSON.parse(response.content.toString());
                
                loggingService.info('Integration intent detected', {
                    userId,
                    messagePreview: message.substring(0, 100),
                    result,
                });

                return result;
            } catch (parseError) {
                // Fallback to keyword matching
                return this.detectIntegrationIntentFallback(message);
            }
        } catch (error) {
            loggingService.error('Failed to detect integration intent', {
                userId,
                error: error instanceof Error ? error.message : String(error),
            });

            // Fallback to keyword matching
            return this.detectIntegrationIntentFallback(message);
        }
    }

    /**
     * Fallback method for detecting integration intent using keywords
     */
    private static detectIntegrationIntentFallback(message: string): {
        needsIntegration: boolean;
        integrations: IntegrationType[];
        suggestedTools: string[];
        confidence: number;
    } {
        const lowerMessage = message.toLowerCase();
        const integrations: IntegrationType[] = [];
        const suggestedTools: string[] = [];

        // Check for Vercel keywords
        if (lowerMessage.match(/\b(deploy|deployment|vercel|hosting|build\s+log)/)) {
            integrations.push('vercel');
            if (lowerMessage.includes('deploy')) suggestedTools.push('vercel_deploy_project');
            if (lowerMessage.includes('log')) suggestedTools.push('vercel_get_deployment_logs');
        }

        // Check for GitHub keywords
        if (lowerMessage.match(/\b(github|pull\s+request|pr|issue|branch|commit|repository|merge)/)) {
            integrations.push('github');
            if (lowerMessage.match(/\b(create|new)\s+(pull\s+request|pr)/)) suggestedTools.push('github_create_pr');
            if (lowerMessage.match(/\b(create|new)\s+issue/)) suggestedTools.push('github_create_issue');
            if (lowerMessage.match(/\blist\s+(pr|pull\s+request)/)) suggestedTools.push('github_list_prs');
        }

        // Check for Google keywords
        if (lowerMessage.match(/\b(google|drive|docs|sheets|gmail|calendar|workspace)/)) {
            integrations.push('google');
            if (lowerMessage.includes('drive')) suggestedTools.push('google_drive_list_files');
            if (lowerMessage.includes('sheet')) suggestedTools.push('google_sheets_read');
            if (lowerMessage.includes('doc')) suggestedTools.push('google_docs_create');
        }

        // Check for MongoDB keywords
        if (lowerMessage.match(/\b(mongodb|database|collection|query|find|aggregate|insert|update|delete)\b/)) {
            integrations.push('mongodb');
            if (lowerMessage.includes('find') || lowerMessage.includes('query')) suggestedTools.push('mongodb_find');
            if (lowerMessage.includes('insert')) suggestedTools.push('mongodb_insert');
            if (lowerMessage.includes('update')) suggestedTools.push('mongodb_update');
            if (lowerMessage.includes('delete')) suggestedTools.push('mongodb_delete');
            if (lowerMessage.includes('aggregate')) suggestedTools.push('mongodb_aggregate');
        }

        // Check for Slack keywords
        if (lowerMessage.match(/\b(slack|channel|notify)/)) {
            integrations.push('slack');
            suggestedTools.push('slack_send_message');
        }

        // Check for Discord keywords
        if (lowerMessage.match(/\b(discord|server)/)) {
            integrations.push('discord');
            suggestedTools.push('discord_send_message');
        }

        // Check for Jira keywords
        if (lowerMessage.match(/\b(jira|ticket|epic|sprint)/)) {
            integrations.push('jira');
            if (lowerMessage.match(/\b(create|new)\s+(ticket|issue)/)) suggestedTools.push('jira_create_issue');
        }

        // Check for Linear keywords
        if (lowerMessage.match(/\b(linear|cycle)/)) {
            integrations.push('linear');
            if (lowerMessage.match(/\b(create|new)\s+issue/)) suggestedTools.push('linear_create_issue');
        }

        return {
            needsIntegration: integrations.length > 0,
            integrations,
            suggestedTools,
            confidence: integrations.length > 0 ? 0.8 : 0.0,
        };
    }

    /**
     * Check if user has connected the required integration
     */
    private static async checkIntegrationConnection(
        userId: string,
        integration: IntegrationType
    ): Promise<{
        isConnected: boolean;
        connectionId?: string;
        connectionName?: string;
    }> {
        try {
            switch (integration) {
                case 'vercel': {
                    const { VercelConnection } = await import('../models/VercelConnection');
                    const connection = await VercelConnection.findOne({
                        userId: new Types.ObjectId(userId),
                        isActive: true,
                    }).lean();
                    
                    return {
                        isConnected: !!connection,
                        connectionId: connection?._id?.toString(),
                        connectionName: connection?.userId?.toString() || 'Vercel',
                    };
                }

                case 'github': {
                    const { GitHubConnection } = await import('../models/GitHubConnection');
                    const connection = await GitHubConnection.findOne({
                        userId: new Types.ObjectId(userId),
                        isActive: true,
                    }).lean();
                    
                    return {
                        isConnected: !!connection,
                        connectionId: connection?._id?.toString(),
                        connectionName: connection?.userId?.toString() || 'GitHub',
                    };
                }

                case 'google': {
                    const { GoogleConnection } = await import('../models/GoogleConnection');
                    const connection = await GoogleConnection.findOne({
                        userId: new Types.ObjectId(userId),
                        isActive: true,
                    }).lean();
                    
                    return {
                        isConnected: !!connection,
                        connectionId: connection?._id?.toString(),
                        connectionName: connection?.userId?.toString() || 'Google',
                    };
                }

                case 'mongodb': {
                    const { MongoDBConnection } = await import('../models/MongoDBConnection');
                    const connection = await MongoDBConnection.findOne({
                        userId: new Types.ObjectId(userId),
                        isActive: true,
                    }).lean();
                    
                    return {
                        isConnected: !!connection,
                        connectionId: connection?._id?.toString(),
                        connectionName: connection?.alias || connection?.userId?.toString() || 'MongoDB',
                    };
                }

                case 'slack': {
                    const { Integration } = await import('../models/Integration');
                    const connection = await Integration.findOne({
                        userId: new Types.ObjectId(userId),
                        type: { $in: ['slack_webhook', 'slack_oauth'] },
                        status: 'active',
                    }).lean();
                    
                    return {
                        isConnected: !!connection,
                        connectionId: connection?._id?.toString(),
                        connectionName: connection?.name,
                    };
                }

                case 'discord': {
                    const { Integration } = await import('../models/Integration');
                    const connection = await Integration.findOne({
                        userId: new Types.ObjectId(userId),
                        type: { $in: ['discord_webhook', 'discord_oauth'] },
                        status: 'active',
                    }).lean();
                    
                    return {
                        isConnected: !!connection,
                        connectionId: connection?._id?.toString(),
                        connectionName: connection?.name,
                    };
                }

                case 'jira': {
                    const { Integration } = await import('../models/Integration');
                    const connection = await Integration.findOne({
                        userId: new Types.ObjectId(userId),
                        type: 'jira_oauth',
                        status: 'active',
                    }).lean();
                    
                    return {
                        isConnected: !!connection,
                        connectionId: connection?._id?.toString(),
                        connectionName: connection?.name,
                    };
                }

                case 'linear': {
                    const { Integration } = await import('../models/Integration');
                    const connection = await Integration.findOne({
                        userId: new Types.ObjectId(userId),
                        type: 'linear_oauth',
                        status: 'active',
                    }).lean();
                    
                    return {
                        isConnected: !!connection,
                        connectionId: connection?._id?.toString(),
                        connectionName: connection?.name,
                    };
                }

                case 'aws': {
                    const { AWSConnection } = await import('../models/AWSConnection');
                    const connection = await AWSConnection.findOne({
                        userId: new Types.ObjectId(userId),
                    }).lean();
                    
                    return {
                        isConnected: !!connection,
                        connectionId: connection?._id?.toString(),
                        connectionName: connection?.connectionName || connection?.awsAccountId || 'AWS',
                    };
                }

                default:
                    return { isConnected: false };
            }
        } catch (error) {
            loggingService.error('Failed to check integration connection', {
                userId,
                integration,
                error: error instanceof Error ? error.message : String(error),
            });
            return { isConnected: false };
        }
    }

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
        
        // Use Langchain Multi-Agent System if explicitly requested or for complex queries
        const shouldUseLangchain = request.useMultiAgent || this.shouldUseLangchainForQuery(request.message || '');
        
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
        const context = this.buildConversationContext(
            conversation._id.toString(),
            request.message || '',
            recentMessages
        );
        
        // Resolve coreference if needed
            const corefResult = await this.resolveCoreference(request.message || '', context, recentMessages);
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
            route = await this.decideRouteWithAI(context, resolvedMessage || '', request.userId, request.useWebSearch);
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
        const contextPreamble = this.buildContextPreamble(context, recentMessages);
        
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

    /**
     * Determine if Langchain should be used based on query complexity
     */
    private static shouldUseLangchainForQuery(message: string): boolean {
        const lowerMessage = message.toLowerCase();
        
        // Use Langchain for strategy, planning, and complex coordination
        const langchainKeywords = [
            'strategy', 'plan', 'coordinate', 'integrate',
            'automate', 'optimize', 'analyze', 'comprehensive',
            'multi-step', 'workflow', 'autonomous', 'proactive'
        ];
        
        // Check for integration mentions
        const hasIntegrations = ['aws', 'google', 'github', 'vercel'].some(
            service => lowerMessage.includes(service)
        );
        
        // Check for complexity indicators
        const isComplex = message.split(' ').length > 50 || 
                         (message.match(/\?/g) || []).length > 2;
        
        return langchainKeywords.some(keyword => lowerMessage.includes(keyword)) || 
               (hasIntegrations && isComplex);
    }

    private static async handleKnowledgeBaseRoute(
        request: ChatSendMessageRequest,
        context: ConversationContext,
        contextPreamble: string,
        recentMessages: any[]
    ): Promise<{ response: string; agentThinking?: any; agentPath: string[]; optimizationsApplied: string[]; cacheHit: boolean; riskLevel: string }> {
        
        loggingService.info('📚 Routing to knowledge base with Modular RAG', {
            subject: context.currentSubject,
            domain: context.lastDomain
        });
        
        try {
            // Check if message contains a link - if so, skip Google Drive files to avoid confusion
            const urlPattern = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;
            const messageContainsLink = request.message && urlPattern.test(request.message);
            
            // Check for accessible Google Drive files (only if no link is present)
            let googleDriveContext = '';
            let accessibleFiles: any[] = [];
            
            if (!messageContainsLink) {
                try {
                    const { GoogleService } = await import('./google.service');
                    const { GoogleConnection } = await import('../models/GoogleConnection');
                    
                    // Get user's Google connections
                    const connections = await GoogleConnection.find({ 
                        userId: request.userId, 
                        isActive: true,
                        healthStatus: 'healthy' // Only use healthy connections
                    }).select('+accessToken +refreshToken');
                    
                    if (connections.length > 0) {
                        // Get accessible files from the first active connection
                        const connection = connections[0];
                        
                        // Validate that connection has required token
                        if (!connection.accessToken) {
                            loggingService.warn('Google connection missing access token', {
                                connectionId: connection._id.toString(),
                                userId: request.userId
                            });
                        } else {
                            // Don't filter by fileType - get all accessible files (docs, sheets, drive)
                            accessibleFiles = await GoogleService.getAccessibleFiles(
                                request.userId,
                                connection._id.toString()
                            );
                            
                            if (accessibleFiles.length > 0) {
                                // Try to read content from the most recently accessed Google Drive file
                                const recentFiles = accessibleFiles.slice(0, 1); // Only the most recent file
                                const fileContents: string[] = [];
                                
                                for (const file of recentFiles) {
                                    try {
                                        let content = '';
                                        if (file.mimeType === 'application/vnd.google-apps.document') {
                                            // Read Google Docs content
                                            content = await GoogleService.readDocument(connection, file.id);
                                        } else if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
                                            // Read Google Sheets content (first sheet)
                                            const sheetData = await GoogleService.readSpreadsheet(connection, file.id, 'Sheet1!A1:Z100');
                                            if (Array.isArray(sheetData)) {
                                                content = sheetData.map((row: any[]) => Array.isArray(row) ? row.join('\t') : '').join('\n') || '';
                                            }
                                        }
                                        
                                        if (content && content.length > 50) {
                                            fileContents.push(`File: ${file.name}\nContent: ${content.substring(0, 2000)}...`);
                                            loggingService.info('Added Google Drive file content to context', {
                                                fileName: file.name,
                                                fileId: file.id,
                                                contentLength: content.length
                                            });
                                        }
                                    } catch (error) {
                                        loggingService.warn('Failed to read Google Drive file content', {
                                            fileName: file.name,
                                            fileId: file.id,
                                            error: error instanceof Error ? error.message : String(error)
                                        });
                                    }
                                }
                                
                                if (fileContents.length > 0) {
                                    googleDriveContext = `\n\nSelected Google Drive file:\n${fileContents.join('\n\n')}`;
                                }
                            }
                        }
                    }
                } catch (error) {
                    loggingService.warn('Failed to load Google Drive context', {
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            } else {
                loggingService.debug('Skipping Google Drive files - message contains link', {
                    userId: request.userId,
                    messagePreview: request.message?.substring(0, 100)
                });
            }

            // Use new Modular RAG Orchestrator
            const { modularRAGOrchestrator } = await import('../rag');
            
            // Build RAG context with Google Drive context
            const ragContext: any = {
                userId: request.userId,
                conversationId: context.conversationId,
                recentMessages: recentMessages.slice(-3).map(msg => ({
                    role: msg.role,
                    content: msg.content
                })),
                currentTopic: context.currentSubject,
                googleDriveFiles: accessibleFiles,
                additionalContext: googleDriveContext,
            };

            // Configure RAG based on query characteristics
            const config: any = {};
            if (request.documentIds && request.documentIds.length > 0) {
                config.modules = {
                    retrieve: {
                        limit: 10,
                        filters: {
                            documentIds: request.documentIds,
                        },
                    },
                };
            }

            // Execute modular RAG
            const ragResult = await modularRAGOrchestrator.execute({
                query: request.message || '',
                context: ragContext,
                config,
            });

            loggingService.info('📚 Modular RAG completed', {
                success: ragResult.success,
                pattern: ragResult.metadata.pattern,
                documentsFound: ragResult.documents.length,
                sources: ragResult.sources,
                userId: request.userId,
                hasGoogleDriveFiles: accessibleFiles.length > 0,
            });

            if (ragResult.success && ragResult.answer) {
                // Enhance response with Google Drive context if available but no knowledge base results
                let enhancedResponse = ragResult.answer;
                if (ragResult.documents.length === 0 && googleDriveContext) {
                    // If RAG found no documents but we have Google Drive files, create a response using that context
                    const { BedrockService } = await import('./bedrock.service');
                    
                    const contextualPrompt = `Based on the following Google Drive files and the user's question, provide a helpful response:

${googleDriveContext}

User question: ${request.message}

Please analyze the content from the Google Drive files above and provide a relevant answer to the user's question. If the files contain relevant information, use that in your response. If not, let the user know what the files contain instead.`;

                    try {
                        const contextualResponse = await BedrockService.invokeModel(
                            contextualPrompt,
                            request.modelId || 'anthropic.claude-3-5-sonnet-20240620-v1:0',
                            {
                                useSystemPrompt: false
                            }
                        );
                        
                        if (contextualResponse && typeof contextualResponse === 'string') {
                            enhancedResponse = contextualResponse;
                        }
                    } catch (error) {
                        loggingService.warn('Failed to generate contextual response with Google Drive files', {
                            error: error instanceof Error ? error.message : String(error)
                        });
                    }
                }

                const optimizations = [
                    'modular_rag',
                    `pattern_${ragResult.metadata.pattern}`,
                    ...ragResult.metadata.modulesUsed.map((m: string) => `module_${m}`),
                    `retrieved_${ragResult.documents.length}_docs`,
                ];

                if (accessibleFiles.length > 0) {
                    optimizations.push(`google_drive_files_${accessibleFiles.length}`);
                }

                return {
                    response: enhancedResponse,
                    agentPath: ['knowledge_base', 'modular_rag', ragResult.metadata.pattern],
                    optimizationsApplied: optimizations,
                    cacheHit: ragResult.metadata.cacheHit || false,
                    riskLevel: 'low',
                };
            }
        } catch (error) {
            loggingService.warn('Modular RAG failed, falling back to conversational flow', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
        
        // Fallback to conversational flow
        return await this.handleConversationalFlowRoute(request, context, contextPreamble, recentMessages);
    }

    private static async handleWebScraperRoute(
        request: ChatSendMessageRequest,
        context: ConversationContext,
        contextPreamble: string,
        recentMessages: any[]
    ): Promise<{ response: string; agentThinking?: any; agentPath: string[]; optimizationsApplied: string[]; cacheHit: boolean; riskLevel: string; webSearchUsed?: boolean; quotaUsed?: number }> {
        
        loggingService.info('🌐 Routing to web scraper', {
            subject: context.currentSubject,
            domain: context.lastDomain,
            useWebSearch: request.useWebSearch
        });
        
        try {
            const { WebSearchTool } = await import('../tools/webSearch.tool');
            const { googleSearchService } = await import('./googleSearch.service');
            const { ChatBedrockConverse } = await import('@langchain/aws');
            
            // Directly call web search tool to ensure web search is performed
            const webSearchTool = new WebSearchTool();
            const searchRequest = {
                operation: 'search' as const,
                query: request.message || '',
                options: {
                    deepContent: true,
                    costDomains: true // Restrict to trusted cost/pricing domains
                },
                cache: {
                    enabled: true,
                    ttl: 3600 // 1 hour cache
                }
            };
            
            loggingService.info('🔍 Performing direct web search', {
                query: request.message,
                operation: 'search'
            });
            
            const webSearchResultString = await webSearchTool._call(JSON.stringify(searchRequest));
            const webSearchResult = JSON.parse(webSearchResultString);
            
            // Get quota status
            let quotaUsed: number | undefined;
            if (googleSearchService.isConfigured()) {
                try {
                    const quotaStatus = await googleSearchService.getQuotaStatus();
                    quotaUsed = quotaStatus.count;
                } catch (error) {
                    loggingService.warn('Failed to get quota status', {
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }
            
            if (!webSearchResult.success || !webSearchResult.data.searchResults || webSearchResult.data.searchResults.length === 0) {
                loggingService.warn('Web search returned no results, falling back to conversational flow', {
                    error: webSearchResult.error
                });
                return await this.handleConversationalFlowRoute(request, context, contextPreamble, recentMessages);
            }
            
            // Assess query complexity to determine if we should use AI or return direct results
            const queryComplexity = this.assessQueryComplexity(request.message || '');
            const hasGoodSnippets = webSearchResult.data.searchResults.some((r: any) => 
                r.snippet && r.snippet.length > 30
            );
            
            // For simple factual queries with good snippets, return Google results directly (zero hallucination risk)
            if (queryComplexity === 'simple' && hasGoodSnippets) {
                loggingService.info('📊 Returning direct Google Search results (no AI interpretation)', {
                    query: request.message,
                    resultsCount: webSearchResult.data.searchResults.length,
                    reason: 'Simple factual query with quality snippets'
                });
                
                // Format Google results directly without AI processing
                const directResponse = webSearchResult.data.searchResults
                    .slice(0, 5)
                    .map((result: any, index: number) => {
                        let formatted = `**${index + 1}. ${result.title}**\n\n${result.snippet || 'No description available'}`;
                        formatted += `\n\n🔗 Source: ${result.url}`;
                        return formatted;
                    })
                    .join('\n\n---\n\n');
                
                const response = directResponse;
                
                return {
                    response: response,
                    agentThinking: {
                        title: 'Web Search',
                        summary: `Retrieved ${webSearchResult.data.searchResults.length} results from the web`,
                        steps: [
                            {
                                step: 1,
                                description: 'Web Search',
                                reasoning: `Searched for: "${request.message}"`,
                                outcome: `Found ${webSearchResult.data.searchResults.length} relevant results`
                            },
                            {
                                step: 2,
                                description: 'Results Compilation',
                                reasoning: 'Compiled search results with source attribution',
                                outcome: 'Direct search results with verified sources'
                            }
                        ]
                    },
                    agentPath: ['web_scraper', 'direct_results'],
                    optimizationsApplied: ['web_search', 'direct_results'],
                    cacheHit: false,
                    riskLevel: 'low',
                    webSearchUsed: true,
                    quotaUsed
                };
            }
            
            // For complex queries, use AI with strong factual grounding
            loggingService.info('🤖 Using AI to synthesize web search results', {
                query: request.message,
                queryComplexity,
                reason: 'Complex query requires synthesis'
            });
            
            const llm = new ChatBedrockConverse({
                model: 'us.anthropic.claude-opus-4-1-20250805-v1:0',
                region: process.env.AWS_REGION || 'us-east-1',
                temperature: 0, 
                maxTokens: 2000,
            });
            
            // Build prompt with web search results
            const searchResultsText = webSearchResult.data.searchResults
                .map((result: any, index: number) => 
                    `[${index + 1}] ${result.title}\nURL: ${result.url}\nContent: ${result.snippet || result.content || ''}`
                )
                .join('\n\n');
            
            const responsePrompt = `You are a factual AI assistant. The user asked: "${request.message}"

Web search results from Google Custom Search API:

${searchResultsText}

CRITICAL ACCURACY RULES - FOLLOW EXACTLY:
1. ONLY use information explicitly stated in the search results above
2. If information is NOT in the results, clearly state "The searched sources do not contain information about [specific topic]"
3. NEVER add information from your training data or make assumptions
4. Always cite specific sources with URLs when stating facts
5. If sources contradict each other, present both perspectives with their sources
6. For pricing queries: Quote exact numbers if found, or explicitly state "Pricing information not available in sources"
7. If you're uncertain, say so rather than guessing

Based ONLY on the search results above, provide a factual answer:`;
            
            const llmResponse = await llm.invoke(responsePrompt);
            const response = llmResponse.content.toString();
            
            loggingService.info('✅ Web search response generated', {
                query: request.message,
                resultsCount: webSearchResult.data.searchResults.length,
                responseLength: response.length
            });
            
            return {
                response: response,
                agentThinking: {
                    title: 'Web Search Analysis',
                    summary: `Searched the web for "${request.message}" and analyzed ${webSearchResult.data.searchResults.length} results.`,
                    steps: [
                        {
                            step: 1,
                            description: 'Web Search',
                            reasoning: `Performed web search for: "${request.message}"`,
                            outcome: `Found ${webSearchResult.data.searchResults.length} relevant results`
                        },
                        {
                            step: 2,
                            description: 'Content Analysis',
                            reasoning: 'Analyzed search results and synthesized key information',
                            outcome: 'Generated comprehensive response with source citations'
                        }
                    ]
                },
                agentPath: ['web_scraper', 'web_search_completed'],
                optimizationsApplied: ['web_search', 'content_synthesis'],
                cacheHit: false,
                riskLevel: 'low',
                webSearchUsed: true,
                quotaUsed
            };
        } catch (error) {
            loggingService.error('Web scraper routing failed', {
                error: error instanceof Error ? error.message : String(error),
                errorStack: error instanceof Error ? error.stack : undefined
            });
        }
        
        // Fallback to conversational flow
        return await this.handleConversationalFlowRoute(request, context, contextPreamble, recentMessages);
    }


    private static async handleMultiAgentRoute(
        request: ChatSendMessageRequest,
        context: ConversationContext,
        contextPreamble: string,
        recentMessages: any[]
    ): Promise<{ response: string; agentThinking?: any; agentPath: string[]; optimizationsApplied: string[]; cacheHit: boolean; riskLevel: string }> {
        
        loggingService.info('🤖 Routing to multi-agent', {
            subject: context.currentSubject,
            domain: context.lastDomain
        });
        
        try {
            const { multiAgentFlowService } = await import('./multiAgentFlow.service');
            
            const enhancedQuery = `${contextPreamble}\n\nUser query: ${request.message}`;
            
            const result = await multiAgentFlowService.processMessage(
                context.conversationId,
                request.userId,
                enhancedQuery,
                {
                    chatMode: 'balanced',
                    costBudget: 0.10
                }
            );

            if (result.response) {
                return {
                    response: result.response,
                    agentThinking: result.thinking,
                    agentPath: ['multi_agent'],
                    optimizationsApplied: ['context_enhancement', 'multi_agent_routing'],
                    cacheHit: false,
                    riskLevel: result.riskLevel || 'medium'
                };
            }
        } catch (error) {
            loggingService.warn('Multi-agent routing failed, falling back to conversational flow', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
        
        // Fallback to conversational flow
        return await this.handleConversationalFlowRoute(request, context, contextPreamble, recentMessages);
    }

    private static async handleConversationalFlowRoute(
        request: ChatSendMessageRequest,
        context: ConversationContext,
        contextPreamble: string,
        recentMessages: any[]
    ): Promise<{ response: string; agentThinking?: any; agentPath: string[]; optimizationsApplied: string[]; cacheHit: boolean; riskLevel: string }> {
        
        loggingService.info('💬 Routing to conversational flow', {
            subject: context.currentSubject,
            domain: context.lastDomain
        });
        
        try {
            const { conversationalFlowService } = await import('./conversationFlow.service');
            
            const enhancedQuery = `${contextPreamble}\n\nUser query: ${request.message || ''}`;
            
            const result = await conversationalFlowService.processMessage(
                context.conversationId,
                request.userId,
                enhancedQuery,
                {
                    previousMessages: [],
                    selectedModel: request.modelId
                }
            );

            if (result.response) {
                return {
                    response: result.response,
                    agentThinking: result.thinking,
                    agentPath: ['conversational_flow'],
                    optimizationsApplied: ['context_enhancement', 'conversational_routing'],
                    cacheHit: false,
                    riskLevel: 'low'
                };
            }
        } catch (error) {
            loggingService.warn('Conversational flow failed, using direct Bedrock fallback', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
        
        // Final fallback to direct Bedrock
        return this.directBedrockFallback(request, recentMessages);
    }

    /**
     * Direct Bedrock fallback with ChatGPT-style context
     */
    private static async directBedrockFallback(
        request: ChatSendMessageRequest,
        recentMessages: any[]
    ): Promise<{ response: string; agentThinking?: any; agentPath: string[]; optimizationsApplied: string[]; cacheHit: boolean; riskLevel: string }> {
        
        // Build contextual prompt, but pass messages for intelligent handling
        const contextualPrompt = this.buildContextualPrompt(recentMessages, request.message || '');
        
        // Enhanced: Pass context to BedrockService for ChatGPT-style conversation
        const response = await BedrockService.invokeModel(
            contextualPrompt,
            request.modelId,
            {
                recentMessages: recentMessages,
                useSystemPrompt: true
            }
        );
        
        // Track optimizations based on context usage
        const optimizations = ['circuit_breaker'];
        if (recentMessages && recentMessages.length > 0) {
            optimizations.push('multi_turn_context');
            optimizations.push('system_prompt');
        }
        
        return {
            response,
            agentThinking: undefined,
            agentPath: ['bedrock_direct'],
            optimizationsApplied: optimizations,
            cacheHit: false,
            riskLevel: 'low'
        };
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
            const integrationIntent = await this.detectIntegrationIntent(
                request.message || '',
                request.userId
            );

            if (!integrationIntent.needsIntegration) {
                loggingService.info('No integration needed, falling back to direct response');
                return this.directBedrockFallback(request, recentMessages);
            }

            // 2. Check if all required integrations are connected
            for (const integration of integrationIntent.integrations) {
                const connectionStatus = await this.checkIntegrationConnection(
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
                    integrationData.formattedResult = await this.formatMongoDBResult({ 
                        metadata: mcpResult.metadata, 
                        data: actualData 
                    });
                    break;
                case 'github':
                    // For GitHub, extract repositories array if it exists
                    const githubData = actualData?.repositories || actualData;
                    integrationData.githubIntegrationData = githubData;
                    integrationData.formattedResult = await this.formatGitHubResult({ 
                        metadata: mcpResult.metadata, 
                        data: githubData 
                    });
                    break;
                case 'vercel':
                    integrationData.vercelIntegrationData = actualData;
                    integrationData.formattedResult = await this.formatVercelResult({ 
                        metadata: mcpResult.metadata, 
                        data: actualData 
                    });
                    break;
                case 'google':
                    integrationData.googleIntegrationData = actualData;
                    integrationData.formattedResult = await this.formatGoogleResult({ 
                        metadata: mcpResult.metadata, 
                        data: actualData 
                    });
                    break;
                case 'slack':
                    integrationData.slackIntegrationData = actualData;
                    integrationData.formattedResult = await this.formatSlackResult({ 
                        metadata: mcpResult.metadata, 
                        data: actualData 
                    });
                    break;
                case 'discord':
                    integrationData.discordIntegrationData = actualData;
                    integrationData.formattedResult = await this.formatDiscordResult({ 
                        metadata: mcpResult.metadata, 
                        data: actualData 
                    });
                    break;
                case 'jira':
                    integrationData.jiraIntegrationData = actualData;
                    integrationData.formattedResult = await this.formatJiraResult({ 
                        metadata: mcpResult.metadata, 
                        data: actualData 
                    });
                    break;
                case 'linear':
                    integrationData.linearIntegrationData = actualData;
                    integrationData.formattedResult = await this.formatLinearResult({ 
                        metadata: mcpResult.metadata, 
                        data: actualData 
                    });
                    break;
                case 'aws':
                    integrationData.awsIntegrationData = actualData;
                    integrationData.formattedResult = await this.formatAWSResult({ 
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
     * Format MongoDB MCP result
     */
    private static async formatMongoDBResult(mcpResult: { metadata?: { operation?: string }; data?: unknown }): Promise<{ type: string; data: unknown }> {
        try {
            // Determine format type based on the operation
            let formatType: 'table' | 'json' | 'schema' | 'stats' | 'text' = 'json';
            
            if (mcpResult.metadata?.operation === 'mongodb_find') {
                formatType = 'table';
            } else if (mcpResult.metadata?.operation === 'mongodb_analyze_schema') {
                formatType = 'schema';
            } else if (mcpResult.metadata?.operation === 'mongodb_get_stats') {
                formatType = 'stats';
            }

            return {
                type: formatType,
                data: mcpResult.data,
            };
        } catch (error) {
            loggingService.error('Failed to format MongoDB result', {
                error: error instanceof Error ? error.message : String(error),
            });
            return { type: 'json', data: mcpResult.data };
        }
    }

    /**
     * Format GitHub MCP results for display
     */
    private static async formatGitHubResult(mcpResult: { metadata?: { operation?: string }; data?: unknown }): Promise<{ type: string; data: unknown }> {
        try {
            const operation = mcpResult.metadata?.operation;
            const data = mcpResult.data as any;

            // Handle github_list_repos - GitHub API returns array directly
            if (operation === 'github_list_repos') {
                const repos = Array.isArray(data) ? data : (data?.repositories || []);
                if (repos.length > 0) {
                    return {
                        type: 'list',
                        data: {
                            items: repos.map((repo: any) => {
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
                                
                                return {
                                    id: repo.id,
                                    title: repo.full_name || repo.name,
                                    description: repo.description || 'No description',
                                    url: githubUrl, // Use the corrected web URL
                                    html_url: githubUrl, // Also provide as html_url for consistency
                                    metadata: {
                                        language: repo.language,
                                        stars: repo.stargazers_count,
                                        private: repo.private,
                                        updated: repo.updated_at,
                                    },
                                };
                            }),
                            count: repos.length,
                            title: 'GitHub Repositories',
                        },
                    };
                }
            }

            // Handle github_list_issues
            if (operation === 'github_list_issues') {
                const issues = Array.isArray(data) ? data : (data?.issues || []);
                if (issues.length > 0) {
                    return {
                        type: 'list',
                        data: {
                            items: issues.map((issue: any) => ({
                                id: issue.number,
                                title: `#${issue.number}: ${issue.title}`,
                                description: issue.body,
                                url: issue.html_url,
                                metadata: {
                                    state: issue.state,
                                    assignee: issue.assignee?.login,
                                    labels: issue.labels?.map((l: any) => l.name).join(', '),
                                },
                            })),
                            count: issues.length,
                            title: 'GitHub Issues',
                        },
                    };
                }
            }

            // Handle github_list_prs
            if (operation === 'github_list_prs') {
                const prs = Array.isArray(data) ? data : (data?.pullRequests || []);
                if (prs.length > 0) {
                    return {
                        type: 'list',
                        data: {
                            items: prs.map((pr: any) => ({
                                id: pr.number,
                                title: `#${pr.number}: ${pr.title}`,
                                description: pr.body,
                                url: pr.html_url,
                                metadata: {
                                    state: pr.state,
                                    mergeable: pr.mergeable_state,
                                    head: pr.head?.ref,
                                    base: pr.base?.ref,
                                },
                            })),
                            count: prs.length,
                            title: 'Pull Requests',
                        },
                    };
                }
            }

            // Default format for other operations
            return {
                type: 'json',
                data: mcpResult.data,
            };
        } catch (error) {
            loggingService.error('Failed to format GitHub result', {
                error: error instanceof Error ? error.message : String(error),
            });
            return { type: 'json', data: mcpResult.data };
        }
    }

    /**
     * Format Vercel MCP results for display
     */
    private static async formatVercelResult(mcpResult: { metadata?: { operation?: string }; data?: unknown }): Promise<{ type: string; data: unknown }> {
        try {
            const operation = mcpResult.metadata?.operation;
            const data = mcpResult.data as any;

            if (operation === 'vercel_list_deployments' && data?.deployments) {
                return {
                    type: 'list',
                    data: {
                        items: data.deployments.map((deployment: any) => ({
                            id: deployment.uid,
                            title: deployment.name,
                            description: `${deployment.state} - ${deployment.target || 'production'}`,
                            url: deployment.url,
                            metadata: {
                                state: deployment.state,
                                created: deployment.created,
                                creator: deployment.creator?.username,
                            },
                        })),
                        count: data.count || data.deployments.length,
                        title: 'Vercel Deployments',
                    },
                };
            }

            if (operation === 'vercel_list_projects' && data?.projects) {
                return {
                    type: 'list',
                    data: {
                        items: data.projects.map((project: any) => ({
                            id: project.id,
                            title: project.name,
                            description: project.framework || 'No framework',
                            url: `https://vercel.com/${project.accountId}/${project.name}`,
                            metadata: {
                                framework: project.framework,
                                updated: project.updatedAt,
                            },
                        })),
                        count: data.count || data.projects.length,
                        title: 'Vercel Projects',
                    },
                };
            }

            return { type: 'json', data: mcpResult.data };
        } catch (error) {
            loggingService.error('Failed to format Vercel result', {
                error: error instanceof Error ? error.message : String(error),
            });
            return { type: 'json', data: mcpResult.data };
        }
    }

    /**
     * Format Google MCP results for display
     */
    private static async formatGoogleResult(mcpResult: { metadata?: { operation?: string }; data?: unknown }): Promise<{ type: string; data: unknown }> {
        try {
            const operation = mcpResult.metadata?.operation;
            const data = mcpResult.data as any;

            if (operation === 'drive_list_files' && data?.files) {
                return {
                    type: 'list',
                    data: {
                        items: data.files.map((file: any) => ({
                            id: file.id,
                            title: file.name,
                            description: file.mimeType,
                            url: file.webViewLink,
                            metadata: {
                                size: file.size,
                                modified: file.modifiedTime,
                                mimeType: file.mimeType,
                            },
                        })),
                        count: data.count || data.files.length,
                        title: 'Google Drive Files',
                    },
                };
            }

            if (operation === 'sheets_list_spreadsheets' && data?.spreadsheets) {
                return {
                    type: 'list',
                    data: {
                        items: data.spreadsheets.map((sheet: any) => ({
                            id: sheet.id,
                            title: sheet.name,
                            description: 'Google Spreadsheet',
                            url: sheet.webViewLink,
                            metadata: {
                                modified: sheet.modifiedTime,
                            },
                        })),
                        count: data.count || data.spreadsheets.length,
                        title: 'Google Sheets',
                    },
                };
            }

            return { type: 'json', data: mcpResult.data };
        } catch (error) {
            loggingService.error('Failed to format Google result', {
                error: error instanceof Error ? error.message : String(error),
            });
            return { type: 'json', data: mcpResult.data };
        }
    }

    /**
     * Format Slack MCP results for display
     */
    private static async formatSlackResult(mcpResult: { metadata?: { operation?: string }; data?: unknown }): Promise<{ type: string; data: unknown }> {
        try {
            const operation = mcpResult.metadata?.operation;
            const data = mcpResult.data as any;

            if (operation === 'slack_list_channels' && data?.channels) {
                return {
                    type: 'list',
                    data: {
                        items: data.channels.map((channel: any) => ({
                            id: channel.id,
                            title: `#${channel.name}`,
                            description: channel.purpose?.value || 'No description',
                            metadata: {
                                members: channel.num_members,
                                private: channel.is_private,
                            },
                        })),
                        count: data.count || data.channels.length,
                        title: 'Slack Channels',
                    },
                };
            }

            if (operation === 'slack_list_users' && data?.members) {
                return {
                    type: 'list',
                    data: {
                        items: data.members.map((user: any) => ({
                            id: user.id,
                            title: user.real_name || user.name,
                            description: user.profile?.title || 'Team member',
                            metadata: {
                                username: user.name,
                                status: user.profile?.status_text,
                            },
                        })),
                        count: data.count || data.members.length,
                        title: 'Slack Users',
                    },
                };
            }

            return { type: 'json', data: mcpResult.data };
        } catch (error) {
            loggingService.error('Failed to format Slack result', {
                error: error instanceof Error ? error.message : String(error),
            });
            return { type: 'json', data: mcpResult.data };
        }
    }

    /**
     * Format Discord MCP results for display
     */
    private static async formatDiscordResult(mcpResult: { metadata?: { operation?: string }; data?: unknown }): Promise<{ type: string; data: unknown }> {
        try {
            const operation = mcpResult.metadata?.operation;
            const data = mcpResult.data as any;

            if (operation === 'discord_list_channels' && data?.channels) {
                return {
                    type: 'list',
                    data: {
                        items: data.channels.map((channel: any) => ({
                            id: channel.id,
                            title: channel.name,
                            description: channel.topic || 'No topic',
                            metadata: {
                                type: channel.type === 0 ? 'Text' : 'Voice',
                                position: channel.position,
                            },
                        })),
                        count: data.count || data.channels.length,
                        title: 'Discord Channels',
                    },
                };
            }

            if (operation === 'discord_list_users' && data?.members) {
                return {
                    type: 'list',
                    data: {
                        items: data.members.map((member: any) => ({
                            id: member.user?.id,
                            title: member.nick || member.user?.username,
                            description: member.user?.discriminator ? `#${member.user.discriminator}` : 'Member',
                            metadata: {
                                roles: member.roles?.length || 0,
                                joined: member.joined_at,
                            },
                        })),
                        count: data.count || data.members.length,
                        title: 'Discord Members',
                    },
                };
            }

            return { type: 'json', data: mcpResult.data };
        } catch (error) {
            loggingService.error('Failed to format Discord result', {
                error: error instanceof Error ? error.message : String(error),
            });
            return { type: 'json', data: mcpResult.data };
        }
    }

    /**
     * Format Jira MCP results for display
     */
    private static async formatJiraResult(mcpResult: { metadata?: { operation?: string }; data?: unknown }): Promise<{ type: string; data: unknown }> {
        try {
            const operation = mcpResult.metadata?.operation;
            const data = mcpResult.data as any;

            if (operation === 'jira_list_issues' && data?.issues) {
                return {
                    type: 'list',
                    data: {
                        items: data.issues.map((issue: any) => ({
                            id: issue.key,
                            title: `${issue.key}: ${issue.fields?.summary}`,
                            description: issue.fields?.description?.content?.[0]?.content?.[0]?.text || 'No description',
                            url: issue.self,
                            metadata: {
                                status: issue.fields?.status?.name,
                                priority: issue.fields?.priority?.name,
                                assignee: issue.fields?.assignee?.displayName,
                                type: issue.fields?.issuetype?.name,
                            },
                        })),
                        count: data.total || data.issues.length,
                        title: 'Jira Issues',
                    },
                };
            }

            if (operation === 'jira_list_projects' && data?.projects) {
                return {
                    type: 'list',
                    data: {
                        items: data.projects.map((project: any) => ({
                            id: project.id,
                            title: `${project.key}: ${project.name}`,
                            description: project.description || 'No description',
                            metadata: {
                                projectType: project.projectTypeKey,
                                lead: project.lead?.displayName,
                            },
                        })),
                        count: data.count || data.projects.length,
                        title: 'Jira Projects',
                    },
                };
            }

            return { type: 'json', data: mcpResult.data };
        } catch (error) {
            loggingService.error('Failed to format Jira result', {
                error: error instanceof Error ? error.message : String(error),
            });
            return { type: 'json', data: mcpResult.data };
        }
    }

    /**
     * Format Linear MCP results for display
     */
    private static async formatLinearResult(mcpResult: { metadata?: { operation?: string }; data?: unknown }): Promise<{ type: string; data: unknown }> {
        try {
            const operation = mcpResult.metadata?.operation;
            const data = mcpResult.data as any;

            if (operation === 'linear_list_issues' && data?.issues) {
                return {
                    type: 'list',
                    data: {
                        items: data.issues.map((issue: any) => ({
                            id: issue.id,
                            title: issue.title,
                            description: issue.description || 'No description',
                            url: issue.url,
                            metadata: {
                                state: issue.state?.name,
                                priority: issue.priority,
                                assignee: issue.assignee?.name,
                                team: issue.team?.name,
                            },
                        })),
                        count: data.count || data.issues.length,
                        title: 'Linear Issues',
                    },
                };
            }

            if (operation === 'linear_list_projects' && data?.projects) {
                return {
                    type: 'list',
                    data: {
                        items: data.projects.map((project: any) => ({
                            id: project.id,
                            title: project.name,
                            description: project.description || 'No description',
                            metadata: {
                                state: project.state,
                                progress: project.progress,
                            },
                        })),
                        count: data.count || data.projects.length,
                        title: 'Linear Projects',
                    },
                };
            }

            if (operation === 'linear_list_teams' && data?.teams) {
                return {
                    type: 'list',
                    data: {
                        items: data.teams.map((team: any) => ({
                            id: team.id,
                            title: `${team.key}: ${team.name}`,
                            description: team.description || 'No description',
                            metadata: {
                                key: team.key,
                            },
                        })),
                        count: data.count || data.teams.length,
                        title: 'Linear Teams',
                    },
                };
            }

            return { type: 'json', data: mcpResult.data };
        } catch (error) {
            loggingService.error('Failed to format Linear result', {
                error: error instanceof Error ? error.message : String(error),
            });
            return { type: 'json', data: mcpResult.data };
        }
    }

    /**
     * Format AWS MCP results for display
     */
    private static async formatAWSResult(mcpResult: { metadata?: { operation?: string }; data?: unknown }): Promise<{ type: string; data: unknown }> {
        try {
            const operation = mcpResult.metadata?.operation;
            const data = mcpResult.data as any;

            if (operation === 'aws_list_ec2' && data?.instances) {
                return {
                    type: 'list',
                    data: {
                        items: data.instances.map((instance: any) => ({
                            id: instance.instanceId,
                            title: instance.name || instance.instanceId,
                            description: instance.instanceType,
                            metadata: {
                                state: instance.state,
                                region: instance.region,
                                publicIp: instance.publicIp,
                            },
                        })),
                        count: data.count || data.instances.length,
                        title: 'EC2 Instances',
                    },
                };
            }

            if (operation === 'aws_list_s3' && data?.buckets) {
                return {
                    type: 'list',
                    data: {
                        items: data.buckets.map((bucket: any) => ({
                            id: bucket.name,
                            title: bucket.name,
                            description: `Created: ${bucket.creationDate}`,
                            metadata: {
                                region: bucket.region,
                            },
                        })),
                        count: data.count || data.buckets.length,
                        title: 'S3 Buckets',
                    },
                };
            }

            if (operation === 'aws_get_costs' && data?.costData) {
                return {
                    type: 'table',
                    data: data.costData,
                };
            }

            return { type: 'json', data: mcpResult.data };
        } catch (error) {
            loggingService.error('Failed to format AWS result', {
                error: error instanceof Error ? error.message : String(error),
            });
            return { type: 'json', data: mcpResult.data };
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
                    recentMessages = await this.getOptimalContext(
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
                        const { processedAttachments: processed, contextString } = await this.processAttachments(
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
                const integrationIntent = await this.detectIntegrationIntent(
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
                    const context = this.buildConversationContext(
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
                    const cost = this.estimateCost(request.modelId, inputTokens, outputTokens);

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
                    const cost = this.estimateCost(request.modelId, inputTokens, outputTokens);

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
                    const cost = this.estimateCost(request.modelId, inputTokens, outputTokens);

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
            const isAutonomousRequest = !request.useMultiAgent && await this.detectAutonomousRequest(finalMessage);
            
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
                    const planMessage = await this.createGovernedPlanMessage(
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
            const cost = this.estimateCost(request.modelId, inputTokens, outputTokens);

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
     * Assess query complexity to determine if direct results or AI synthesis is needed
     */
    private static assessQueryComplexity(query: string): 'simple' | 'complex' {
        // Simple factual queries that can be answered with direct search snippets
        const simplePatterns = [
            /^what is the (price|pricing|cost)/i,
            /^how much (does|is|costs?)/i,
            /^what (is|are) the (price|cost|fee)/i,
            /pricing for/i,
            /cost of/i,
            /^when (was|is|did|does)/i,
            /^who (is|was|are)/i,
            /^where (is|was|are|can)/i,
            /^what does .+ mean/i,
            /^define /i,
            /^what happened on/i,
            /^when did/i
        ];
        
        // Check if query matches simple patterns
        const isSimple = simplePatterns.some(pattern => pattern.test(query));
        
        // Additional heuristics: short queries are often factual lookups
        const wordCount = query.trim().split(/\s+/).length;
        const isShortFactual = wordCount <= 8 && (
            query.includes('?') || 
            query.match(/^(what|when|where|who|how much|price|cost)/i)
        );
        
        return (isSimple || isShortFactual) ? 'simple' : 'complex';
    }

    /**
     * Get available models for chat
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
        try {
            // Use AWS Bedrock pricing data directly to avoid circular dependencies
            const models = AWS_BEDROCK_PRICING.map(pricing => ({
                id: pricing.modelId,
                name: this.getModelDisplayName(pricing.modelId),
                provider: this.getModelProvider(pricing.modelId),
                description: this.getModelDescription(pricing.modelId),
                capabilities: pricing.capabilities || ['text', 'chat'],
                pricing: {
                    input: pricing.inputPrice,
                    output: pricing.outputPrice,
                    unit: pricing.unit
                }
            }));
            
            // Filter out models with invalid model IDs
            return models.filter(model => model && model.id && typeof model.id === 'string' && model.id.trim() !== '');

        } catch (error) {
            loggingService.error('Error getting available models:', { error: error instanceof Error ? error.message : String(error) });
            
            // Optimized: Return static fallback models instead of creating new objects
            return [...this.FALLBACK_MODELS]; // Shallow copy to prevent mutations
        }
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
            return `Chat with ${this.getModelDisplayName(modelId)}`;
        }
    }

    /**
     * Build contextual prompt from conversation history (LEGACY - kept for backward compatibility)
     * @deprecated Use convertToMessagesArray instead for better multi-turn support
     */
    private static buildContextualPrompt(messages: any[], newMessage: string): string {
        // Optimized: Use the messages as-is since they're already optimally sized
        const recentMessages = messages.reverse(); // Reverse since we got them in desc order
        
        let prompt = '';
        
        if (recentMessages.length > 1) { // More than just the current user message
            prompt += 'Previous conversation:\n\n';
            recentMessages.forEach(msg => {
                if (msg.role === 'user') {
                    prompt += `Human: ${msg.content}\n\n`;
                } else if (msg.role === 'assistant') {
                    prompt += `Assistant: ${msg.content}\n\n`;
                }
            });
        }
        
        prompt += `Human: ${newMessage}\n\nAssistant:`;
        
        return prompt;
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

    /**
     * Estimate cost for model usage
     */
    private static estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
        const pricingMap: Record<string, { input: number; output: number }> = {
            'amazon.nova-micro-v1:0': { input: 0.035, output: 0.14 },
            'amazon.nova-lite-v1:0': { input: 0.06, output: 0.24 },
            'amazon.nova-pro-v1:0': { input: 0.80, output: 3.20 },
            'global.anthropic.claude-haiku-4-5-20251001-v1:0': { input: 1.0, output: 5.0 },
            'anthropic.claude-sonnet-4-20250514-v1:0': { input: 3.0, output: 15.0 },
        };

        const pricing = pricingMap[modelId] || { input: 1.0, output: 5.0 }; // Default pricing
        
        const inputCost = (inputTokens / 1000000) * pricing.input;
        const outputCost = (outputTokens / 1000000) * pricing.output;
        
        return inputCost + outputCost;
    }

    /**
     * Get display name for model
     */
    private static getModelDisplayName(modelId: string): string {
        // Handle null/undefined modelId
        if (!modelId || typeof modelId !== 'string') {
            return 'Unknown Model';
        }

        const nameMap: Record<string, string> = {
            // === OpenAI GPT-5 Models (Latest) ===
            'gpt-5': 'GPT-5',
            'gpt-5-mini': 'GPT-5 Mini',
            'gpt-5-nano': 'GPT-5 Nano',
            'gpt-5-chat-latest': 'GPT-5 Chat Latest',
            'gpt-5-chat': 'GPT-5 Chat Latest',
            
            // === AWS Models ===
            'amazon.nova-micro-v1:0': 'Nova Micro',
            'amazon.nova-lite-v1:0': 'Nova Lite', 
            'amazon.nova-pro-v1:0': 'Nova Pro',
            'amazon.titan-text-lite-v1': 'Titan Text Lite',
            'global.anthropic.claude-haiku-4-5-20251001-v1:0': 'Claude 3.5 Haiku',
            'anthropic.claude-sonnet-4-20250514-v1:0': 'Claude Sonnet 4',
            'anthropic.claude-3-5-sonnet-20240620-v1:0': 'Claude 3.5 Sonnet',
            'anthropic.claude-opus-4-1-20250805-v1:0': 'Claude 4 Opus',
            'meta.llama3-1-8b-instruct-v1:0': 'Llama 3.1 8B',
            'meta.llama3-1-70b-instruct-v1:0': 'Llama 3.1 70B',
            'meta.llama3-1-405b-instruct-v1:0': 'Llama 3.1 405B',
            'meta.llama3-2-1b-instruct-v1:0': 'Llama 3.2 1B',
            'meta.llama3-2-3b-instruct-v1:0': 'Llama 3.2 3B',
            'mistral.mistral-7b-instruct-v0:2': 'Mistral 7B',
            'mistral.mixtral-8x7b-instruct-v0:1': 'Mixtral 8x7B',
            'mistral.mistral-large-2402-v1:0': 'Mistral Large',
            'command-a-03-2025': 'Command A',
            'command-r7b-12-2024': 'Command R7B',
            'command-a-reasoning-08-2025': 'Command A Reasoning',
            'command-a-vision-07-2025': 'Command A Vision',
            'command-r-plus-04-2024': 'Command R+',
            'command-r-08-2024': 'Command R',
            'command-r-03-2024': 'Command R (03-2024)',
            'command': 'Command',
            'command-nightly': 'Command Nightly',
            'command-light': 'Command Light',
            'command-light-nightly': 'Command Light Nightly',
            'ai21.jamba-instruct-v1:0': 'Jamba Instruct',
            'ai21.j2-ultra-v1': 'Jurassic-2 Ultra',
            'ai21.j2-mid-v1': 'Jurassic-2 Mid',
            
            // Google Gemini Models
            'gemini-2.5-pro': 'Gemini 2.5 Pro',
            'gemini-2.5-flash': 'Gemini 2.5 Flash',
            'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite',
            'gemini-2.5-flash-audio': 'Gemini 2.5 Flash Audio',
            'gemini-2.5-flash-lite-audio-preview': 'Gemini 2.5 Flash Lite Audio Preview',
            'gemini-2.5-flash-native-audio-output': 'Gemini 2.5 Flash Native Audio Output',
            'gemini-2.0-flash': 'Gemini 2.0 Flash',
            'gemini-2.0-flash-lite': 'Gemini 2.0 Flash Lite',
            'gemini-2.0-flash-audio': 'Gemini 2.0 Flash Audio',
            'gemini-1.5-pro': 'Gemini 1.5 Pro',
            'gemini-1.5-flash': 'Gemini 1.5 Flash',
            'gemini-1.5-flash-large-context': 'Gemini 1.5 Flash Large Context',
            'gemini-1.5-flash-8b-large-context': 'Gemini 1.5 Flash 8B Large Context',
            'gemini-1.5-pro-large-context': 'Gemini 1.5 Pro Large Context',
            'gemini-1.0-pro': 'Gemini 1.0 Pro',
            'gemini-1.0-pro-vision': 'Gemini 1.0 Pro Vision',
            
            // Google Gemma Models
            'gemma-2': 'Gemma 2',
            'gemma': 'Gemma',
            'shieldgemma-2': 'ShieldGemma 2',
            'paligemma': 'PaliGemma',
            'codegemma': 'CodeGemma',
            'txgemma': 'TxGemma',
            'medgemma': 'MedGemma',
            'medsiglip': 'MedSigLIP',
            't5gemma': 'T5Gemma',
            
            // Google Specialized Models
            'multimodal-embeddings': 'Multimodal Embeddings',
            'imagen-4-generation': 'Imagen 4 Generation',
            'imagen-4-fast-generation': 'Imagen 4 Fast Generation',
            'imagen-4-ultra-generation': 'Imagen 4 Ultra Generation',
            'imagen-3-generation': 'Imagen 3 Generation',
            'imagen-3-editing-customization': 'Imagen 3 Editing & Customization',
            'imagen-3-fast-generation': 'Imagen 3 Fast Generation',
            'imagen-captioning-vqa': 'Imagen Captioning & VQA',
            'veo-3': 'Veo 3',
            'veo-3-fast': 'Veo 3 Fast',
            'virtual-try-on': 'Virtual Try-On',
            'veo-3-preview': 'Veo 3 Preview',
            'veo-3-fast-preview': 'Veo 3 Fast Preview',
            
            // Mistral AI Models
            // Premier Models
            'mistral-medium-2508': 'Mistral Medium 3.1',
            'mistral-medium-latest': 'Mistral Medium 3.1',
            'magistral-medium-2507': 'Magistral Medium 1.1',
            'magistral-medium-latest': 'Magistral Medium 1.1',
            'codestral-2508': 'Codestral 2508',
            'codestral-latest': 'Codestral 2508',
            'voxtral-mini-2507': 'Voxtral Mini Transcribe',
            'voxtral-mini-latest': 'Voxtral Mini Transcribe',
            'devstral-medium-2507': 'Devstral Medium',
            'devstral-medium-latest': 'Devstral Medium',
            'mistral-ocr-2505': 'Mistral OCR 2505',
            'mistral-ocr-latest': 'Mistral OCR 2505',
            'mistral-large-2411': 'Mistral Large 2.1',
            'mistral-large-latest': 'Mistral Large 2.1',
            'pixtral-large-2411': 'Pixtral Large',
            'pixtral-large-latest': 'Pixtral Large',
            'mistral-small-2407': 'Mistral Small 2',
            'mistral-embed': 'Mistral Embed',
            'codestral-embed-2505': 'Codestral Embed',
            'mistral-moderation-2411': 'Mistral Moderation 24.11',
            'mistral-moderation-latest': 'Mistral Moderation 24.11',
            
            // Open Models
            'magistral-small-2507': 'Magistral Small 1.1',
            'magistral-small-latest': 'Magistral Small 1.1',
            'voxtral-small-2507': 'Voxtral Small',
            'voxtral-small-latest': 'Voxtral Small',
            'mistral-small-2506': 'Mistral Small 3.2',
            'devstral-small-2507': 'Devstral Small 1.1',
            'devstral-small-latest': 'Devstral Small 1.1',
            'mistral-small-2503': 'Mistral Small 3.1',
            'mistral-small-2501': 'Mistral Small 3',
            'devstral-small-2505': 'Devstral Small 1',
            'pixtral-12b-2409': 'Pixtral 12B',
            'pixtral-12b': 'Pixtral 12B',
            'open-mistral-nemo-2407': 'Mistral NeMo 12B',
            'open-mistral-nemo': 'Mistral NeMo 12B',
            'mistral-nemo': 'Mistral NeMo',
            'open-mistral-7b': 'Mistral 7B',
            'open-mixtral-8x7b': 'Mixtral 8x7B',
            'open-mixtral-8x22b': 'Mixtral 8x22B',
            
            // Grok AI Models
            'grok-4-0709': 'Grok 4',
            'grok-3': 'Grok 3',
            'grok-3-mini': 'Grok 3 Mini',
            'grok-2-image-1212': 'Grok 2 Image',
            
            // Meta Llama 4 Models
            'llama-4-scout': 'Llama 4 Scout',
            'llama-4-maverick': 'Llama 4 Maverick',
            'llama-4-behemoth-preview': 'Llama 4 Behemoth Preview',
        };

        return nameMap[modelId] || modelId.split('.').pop()?.split('-')[0] || modelId;
    }

    /**
     * Get provider for model
     */
    private static getModelProvider(modelId: string): string {
        // Handle null/undefined modelId
        if (!modelId || typeof modelId !== 'string') {
            return 'Unknown';
        }

        if (modelId.startsWith('amazon.')) return 'Amazon';
        if (modelId.startsWith('anthropic.')) return 'Anthropic';
        if (modelId.startsWith('meta.')) return 'Meta';
        if (modelId.startsWith('cohere.')) return 'Cohere';
        if (modelId.startsWith('mistral.')) return 'Mistral AI';
        if (modelId.startsWith('ai21.')) return 'AI21 Labs';
        return 'Unknown';
    }

    /**
     * Get description for model
     */
    private static getModelDescription(modelId: string): string {
        // Handle null/undefined modelId
        if (!modelId || typeof modelId !== 'string') {
            return 'Unknown AI model';
        }

        const descriptionMap: Record<string, string> = {
            // === OpenAI GPT-5 Models (Latest) ===
            'gpt-5': 'OpenAI GPT-5 - Latest flagship model with advanced intelligence and reasoning capabilities',
            'gpt-5-mini': 'OpenAI GPT-5 Mini - Efficient variant with balanced performance and cost',
            'gpt-5-nano': 'OpenAI GPT-5 Nano - Fastest and most cost-effective GPT-5 variant',
            'gpt-5-chat-latest': 'OpenAI GPT-5 Chat Latest - Latest chat model with advanced conversational capabilities',
            'gpt-5-chat': 'OpenAI GPT-5 Chat Latest - Latest chat model with advanced conversational capabilities',
            
            // === AWS Models ===
            'amazon.nova-micro-v1:0': 'Fast and cost-effective model for simple tasks',
            'amazon.nova-lite-v1:0': 'Balanced performance and cost for general use',
            'amazon.nova-pro-v1:0': 'High-performance model for complex tasks',
            'amazon.titan-text-lite-v1': 'Lightweight text generation model',
            'global.anthropic.claude-haiku-4-5-20251001-v1:0': 'Fast and intelligent for quick responses',
            'anthropic.claude-3-5-sonnet-20240620-v1:0': 'Advanced reasoning and analysis capabilities',
            'anthropic.claude-sonnet-4-20250514-v1:0': 'High-performance model with exceptional reasoning',
            'anthropic.claude-opus-4-1-20250805-v1:0': 'Most powerful model for complex reasoning',
            'meta.llama3-1-8b-instruct-v1:0': 'Good balance of performance and efficiency',
            'meta.llama3-1-70b-instruct-v1:0': 'Large model for complex reasoning tasks',
            'meta.llama3-1-405b-instruct-v1:0': 'Most capable Llama model for advanced tasks',
            'meta.llama3-2-1b-instruct-v1:0': 'Compact, efficient model for basic tasks',
            'meta.llama3-2-3b-instruct-v1:0': 'Efficient model for general tasks',
            'mistral.mistral-7b-instruct-v0:2': 'Efficient open-source model',
            'mistral.mixtral-8x7b-instruct-v0:1': 'High-quality mixture of experts model',
            'mistral.mistral-large-2402-v1:0': 'Advanced reasoning and multilingual capabilities',
            'command-a-03-2025': 'Most performant model to date, excelling at tool use, agents, RAG, and multilingual use cases',
            'command-r7b-12-2024': 'Small, fast update delivered in December 2024, excels at RAG, tool use, and complex reasoning',
            'command-a-reasoning-08-2025': 'First reasoning model, able to think before generating output for nuanced problem-solving and agent-based tasks in 23 languages',
            'command-a-vision-07-2025': 'First model capable of processing images, excelling in enterprise use cases like charts, graphs, diagrams, table understanding, OCR, and object detection',
            'command-r-plus-04-2024': 'Instruction-following conversational model for complex RAG workflows and multi-step tool use',
            'command-r-08-2024': 'Update of Command R model delivered in August 2024',
            'command-r-03-2024': 'Instruction-following conversational model for complex workflows like code generation, RAG, tool use, and agents',
            
            // Google Gemini Models
            'gemini-2.5-pro': 'Our most advanced reasoning Gemini model, made to solve complex problems. Best for multimodal understanding, coding, and complex prompts',
            'gemini-2.5-flash': 'Best model in terms of price-performance, offering well-rounded capabilities with Live API support and thinking process visibility',
            'gemini-2.5-flash-lite': 'Most cost effective model that supports high throughput tasks with 1M token context window and multimodal input',
            'gemini-2.5-flash-audio': 'Gemini 2.5 Flash model with audio input and output capabilities for multimodal interactions',
            'gemini-2.5-flash-lite-audio-preview': 'Preview version of Gemini 2.5 Flash Lite with audio capabilities for testing and evaluation',
            'gemini-2.5-flash-native-audio-output': 'Gemini 2.5 Flash model with native audio output generation capabilities',
            'gemini-2.0-flash': 'Newest multimodal model with next generation features and improved capabilities',
            'gemini-2.0-flash-lite': 'Gemini 2.0 Flash model optimized for cost efficiency and low latency',
            'gemini-2.0-flash-audio': 'Gemini 2.0 Flash model with audio input and output capabilities',
            'gemini-1.5-pro': 'Advanced model with long context window for complex reasoning and vision tasks',
            'gemini-1.5-flash': 'Fast and efficient model with multimodal capabilities and 1M token context',
            'gemini-1.5-flash-large-context': 'Gemini 1.5 Flash with extended context window for long-form content processing',
            'gemini-1.5-flash-8b-large-context': '8B parameter version of Gemini 1.5 Flash with large context window',
            'gemini-1.5-pro-large-context': 'Gemini 1.5 Pro with extended context window for complex long-form tasks',
            'gemini-1.0-pro': 'Balanced model for general text generation and analysis tasks',
            'gemini-1.0-pro-vision': 'Gemini 1.0 Pro with vision capabilities for multimodal understanding',
            
            // Google Gemma Models
            'gemma-2': 'Latest open models designed for efficient execution on low-resource devices with multimodal input support',
            'gemma': 'Third generation of open models featuring wide variety of tasks with text and image input',
            'shieldgemma-2': 'Instruction tuned models for evaluating the safety of text and images against defined safety policies',
            'paligemma': 'Open vision-language model that combines SigLIP and Gemma for multimodal tasks',
            'codegemma': 'Powerful, lightweight open model for coding tasks like fill-in-the-middle completion and code generation',
            'txgemma': 'Generates predictions and classifications based on therapeutic related data for medical AI applications',
            'medgemma': 'Collection of Gemma 3 variants trained for performance on medical text and image comprehension',
            'medsiglip': 'SigLIP variant trained to encode medical images and text into a common embedding space',
            't5gemma': 'Family of lightweight yet powerful encoder-decoder research models from Google',
            
            // Google Specialized Models
            'multimodal-embeddings': 'Generates vectors based on images and text for semantic search, classification, and clustering',
            'imagen-4-generation': 'Use text prompts to generate novel images with higher quality than previous image generation models',
            'imagen-4-fast-generation': 'Use text prompts to generate novel images with higher quality and lower latency',
            'imagen-4-ultra-generation': 'Use text prompts to generate novel images with ultra quality and best prompt adherence',
            'imagen-3-generation': 'Use text prompts to generate novel images with good quality and performance',
            'imagen-3-editing-customization': 'Edit existing input images or parts of images with masks and generate new images based on reference context',
            'imagen-3-fast-generation': 'Generate novel images with lower latency than other image generation models',
            'imagen-captioning-vqa': 'Generate captions for images and answer visual questions for image understanding tasks',
            'veo-3': 'Use text prompts and images to generate novel videos with higher quality than previous video generation models',
            'veo-3-fast': 'Generate novel videos with higher quality and lower latency than previous video generation models',
            'virtual-try-on': 'Generate images of people wearing clothing products for fashion and retail applications',
            'veo-3-preview': 'Preview version of Veo 3 for testing and evaluation of video generation capabilities',
            'veo-3-fast-preview': 'Preview version of Veo 3 Fast for testing fast video generation capabilities',
            'command': 'Instruction-following conversational model for language tasks with high quality and reliability',
            'command-nightly': 'Latest experimental version, not recommended for production use',
            'command-light': 'Smaller, faster version of command, almost as capable but much faster',
            'command-light-nightly': 'Latest experimental version of command-light, not recommended for production use',
            'ai21.jamba-instruct-v1:0': 'Hybrid architecture for long context tasks',
            'ai21.j2-ultra-v1': 'Large language model for complex tasks',
            'ai21.j2-mid-v1': 'Mid-size model for balanced performance',
            
            // Mistral AI Models
            // Premier Models
            'mistral-medium-2508': 'Our frontier-class multimodal model released August 2025. Improving tone and performance.',
            'mistral-medium-latest': 'Our frontier-class multimodal model released August 2025. Improving tone and performance.',
            'magistral-medium-2507': 'Our frontier-class reasoning model released July 2025.',
            'magistral-medium-latest': 'Our frontier-class reasoning model released July 2025.',
            'codestral-2508': 'Our cutting-edge language model for coding released end of July 2025, specializes in low-latency, high-frequency tasks.',
            'codestral-latest': 'Our cutting-edge language model for coding released end of July 2025, specializes in low-latency, high-frequency tasks.',
            'voxtral-mini-2507': 'An efficient audio input model, fine-tuned and optimized for transcription purposes only.',
            'voxtral-mini-latest': 'An efficient audio input model, fine-tuned and optimized for transcription purposes only.',
            'devstral-medium-2507': 'An enterprise grade text model that excels at using tools to explore codebases, editing multiple files and power software engineering agents.',
            'devstral-medium-latest': 'An enterprise grade text model that excels at using tools to explore codebases, editing multiple files and power software engineering agents.',
            'mistral-ocr-2505': 'Our OCR service powering our Document AI stack that enables our users to extract interleaved text and images.',
            'mistral-ocr-latest': 'Our OCR service powering our Document AI stack that enables our users to extract interleaved text and images.',
            'mistral-large-2411': 'Our top-tier large model for high-complexity tasks with the latest version released November 2024.',
            'mistral-large-latest': 'Our top-tier large model for high-complexity tasks with the latest version released November 2024.',
            'pixtral-large-2411': 'Our first frontier-class multimodal model released November 2024.',
            'pixtral-large-latest': 'Our first frontier-class multimodal model released November 2024.',
            'mistral-small-2407': 'Our updated small version, released September 2024.',
            'mistral-embed': 'Our state-of-the-art semantic for extracting representation of text extracts.',
            'codestral-embed-2505': 'Our state-of-the-art semantic for extracting representation of code extracts.',
            'mistral-moderation-2411': 'Our moderation service that enables our users to detect harmful text content.',
            'mistral-moderation-latest': 'Our moderation service that enables our users to detect harmful text content.',
            
            // Open Models
            'magistral-small-2507': 'Our small reasoning model released July 2025.',
            'magistral-small-latest': 'Our small reasoning model released July 2025.',
            'voxtral-small-2507': 'Our first model with audio input capabilities for instruct use cases.',
            'voxtral-small-latest': 'Our first model with audio input capabilities for instruct use cases.',
            'mistral-small-2506': 'An update to our previous small model, released June 2025.',
            'devstral-small-2507': 'An update to our open source model that excels at using tools to explore codebases, editing multiple files and power software engineering agents.',
            'devstral-small-latest': 'An update to our open source model that excels at using tools to explore codebases, editing multiple files and power software engineering agents.',
            'mistral-small-2503': 'A new leader in the small models category with image understanding capabilities, released March 2025.',
            'mistral-small-2501': 'A new leader in the small models category, released January 2025.',
            'devstral-small-2505': 'A 24B text model, open source model that excels at using tools to explore codebases, editing multiple files and power software engineering agents.',
            'pixtral-12b-2409': 'A 12B model with image understanding capabilities in addition to text.',
            'pixtral-12b': 'A 12B model with image understanding capabilities in addition to text.',
            'open-mistral-nemo-2407': 'Our best multilingual open source model released July 2024.',
            'open-mistral-nemo': 'Our best multilingual open source model released July 2024.',
            'mistral-nemo': 'State-of-the-art Mistral model trained specifically for code tasks.',
            'open-mistral-7b': 'A 7B transformer model, fast-deployed and easily customisable.',
            'open-mixtral-8x7b': 'A 7B sparse Mixture-of-Experts (SMoE). Uses 12.9B active parameters out of 45B total.',
            'open-mixtral-8x22b': 'Most performant open model. A 22B sparse Mixture-of-Experts (SMoE). Uses only 39B active parameters out of 141B.',
            
            // Grok AI Models
            'grok-4-0709': 'Latest Grok 4 with reasoning, vision support coming soon. 2M TPM, 480 RPM rate limits',
            'grok-3': 'Standard Grok 3 model. 600 RPM rate limits',
            'grok-3-mini': 'Cost-effective Grok 3 Mini. 480 RPM rate limits',
            'grok-2-image-1212': 'Grok 2 image generation model. $0.07 per image, 300 RPM rate limits',
            
            // Meta Llama 4 Models
            'llama-4-scout': 'Class-leading natively multimodal model with superior text and visual intelligence, single H100 GPU efficiency, and 10M context window for seamless long document analysis',
            'llama-4-maverick': 'Industry-leading natively multimodal model for image and text understanding with groundbreaking intelligence and fast responses at a low cost',
            'llama-4-behemoth-preview': 'Early preview of the Llama 4 teacher model used to distill Llama 4 Scout and Llama 4 Maverick. Still in training phase',
        };

        return descriptionMap[modelId] || 'Advanced AI model for text generation and chat';
    }

    /**
     * Process attachments - format file metadata for AI and fetch Google file content
     * Frontend already provides instruction context about analyzing files
     */
    static async processAttachments(
        attachments: Array<{
            type: 'uploaded' | 'google';
            fileId: string;
            fileName: string;
            fileSize: number;
            mimeType: string;
            fileType: string;
            url: string;
            googleFileId?: string;
            connectionId?: string;
            webViewLink?: string;
            modifiedTime?: string;
            createdTime?: string;
        }>,
        userId: string
    ): Promise<{
        processedAttachments: Array<{
            type: 'uploaded' | 'google';
            fileId: string;
            fileName: string;
            fileSize: number;
            mimeType: string;
            fileType: string;
            url: string;
            googleFileId?: string;
            connectionId?: string;
            webViewLink?: string;
            modifiedTime?: string;
            createdTime?: string;
            extractedContent?: string;
        }>;
        contextString: string;
    }> {
        const processedAttachments = [];
        const contentParts: string[] = [];

        for (const attachment of attachments) {
            try {
                // Determine display file type
                let displayFileType = attachment.fileType;
                if (attachment.mimeType.includes('document')) {
                    displayFileType = 'Google Docs';
                } else if (attachment.mimeType.includes('spreadsheet')) {
                    displayFileType = 'Google Sheets';
                } else if (attachment.mimeType.includes('presentation')) {
                    displayFileType = 'Google Slides';
                } else if (attachment.mimeType === 'application/pdf') {
                    displayFileType = 'PDF';
                } else if (attachment.mimeType.includes('word')) {
                    displayFileType = 'Word';
                } else if (attachment.mimeType.includes('excel')) {
                    displayFileType = 'Excel';
                }

                // Format file size
                const formatFileSize = (bytes: number): string => {
                    if (bytes < 1024) return `${bytes} B`;
                    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
                    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
                };

                // Extract file content based on type
                let extractedContent = '';
                
                // Handle uploaded files (from chat or ingestion)
                if (attachment.type === 'uploaded' && attachment.fileId) {
                    try {
                        const { UploadedFile } = await import('../models/UploadedFile');
                        const uploadedFile = await UploadedFile.findById(attachment.fileId);
                        
                        if (uploadedFile) {
                            // Check if we already have extracted text
                            if (uploadedFile.extractedText && uploadedFile.extractedText.trim()) {
                                extractedContent = uploadedFile.extractedText;
                                
                                loggingService.info('Retrieved uploaded file content from database', {
                                    fileName: attachment.fileName,
                                    fileId: attachment.fileId,
                                    contentLength: extractedContent.length,
                                    userId
                                });
                            } else {
                                // Extract text from S3 file if not already extracted
                                try {
                                    const textExtractor = new TextExtractionService();
                                    const extractionResult = await textExtractor.extractTextFromS3(
                                        uploadedFile.s3Key,
                                        uploadedFile.fileType,
                                        uploadedFile.fileName
                                    );
                                    
                                    if (extractionResult.success && extractionResult.text) {
                                        extractedContent = extractionResult.text;
                                        
                                        // Save extracted text for future use
                                        uploadedFile.extractedText = extractedContent;
                                        await uploadedFile.save();
                                        
                                        loggingService.info('Extracted and saved uploaded file content', {
                                            fileName: attachment.fileName,
                                            fileId: attachment.fileId,
                                            s3Key: uploadedFile.s3Key,
                                            contentLength: extractedContent.length,
                                            userId
                                        });
                                    } else {
                                        loggingService.warn('Failed to extract text from uploaded file', {
                                            fileName: attachment.fileName,
                                            fileId: attachment.fileId,
                                            error: extractionResult.error,
                                            userId
                                        });
                                    }
                                } catch (extractError) {
                                    loggingService.error('Error extracting text from uploaded file', {
                                        fileName: attachment.fileName,
                                        fileId: attachment.fileId,
                                        error: extractError instanceof Error ? extractError.message : String(extractError),
                                        userId
                                    });
                                }
                            }
                        } else {
                            loggingService.warn('Uploaded file not found in database', {
                                fileId: attachment.fileId,
                                fileName: attachment.fileName,
                                userId
                            });
                        }
                    } catch (error) {
                        loggingService.error('Failed to fetch uploaded file', {
                            fileName: attachment.fileName,
                            fileId: attachment.fileId,
                            error: error instanceof Error ? error.message : String(error),
                            userId
                        });
                    }
                }
                // Handle Google Drive files
                else if (attachment.type === 'google' && attachment.googleFileId && attachment.connectionId) {
                    try {
                        const { GoogleConnection } = await import('../models/GoogleConnection');
                        const connection = await GoogleConnection.findById(attachment.connectionId);
                        
                        if (connection && connection.isActive) {
                            if (attachment.mimeType === 'application/vnd.google-apps.document') {
                                extractedContent = await GoogleService.readDocument(connection, attachment.googleFileId);
                            } else if (attachment.mimeType === 'application/vnd.google-apps.spreadsheet') {
                                const sheetData = await GoogleService.readSpreadsheet(connection, attachment.googleFileId, 'Sheet1!A1:Z100');
                                if (Array.isArray(sheetData)) {
                                    extractedContent = sheetData.map((row: any[]) => Array.isArray(row) ? row.join('\t') : '').join('\n') || '';
                                }
                            }
                            
                            loggingService.info('Retrieved Google file content for chat', {
                                fileName: attachment.fileName,
                                fileId: attachment.googleFileId,
                                mimeType: attachment.mimeType,
                                contentLength: extractedContent.length,
                                userId
                            });
                        }
                    } catch (error) {
                        loggingService.warn('Failed to fetch Google file content', {
                            fileName: attachment.fileName,
                            fileId: attachment.googleFileId,
                            error: error instanceof Error ? error.message : String(error),
                            userId
                        });
                    }
                }

                // Create file metadata with optional content
                const fileInfoLines = [
                    `📎 **${attachment.fileName}**`,
                    `   ${displayFileType} | ${formatFileSize(attachment.fileSize)}`,
                    `   URL: ${attachment.url}`
                ];

                if (attachment.modifiedTime) {
                    fileInfoLines.push(`   Modified: ${new Date(attachment.modifiedTime).toLocaleDateString()}`);
                }

                if (extractedContent && extractedContent.trim()) {
                    // Truncate content if too long
                    const maxContentLength = 3000;
                    const truncatedContent = extractedContent.length > maxContentLength 
                        ? extractedContent.substring(0, maxContentLength) + '...'
                        : extractedContent;
                    
                    fileInfoLines.push('');
                    fileInfoLines.push('📄 **File Content:**');
                    fileInfoLines.push(truncatedContent);
                }

                const fileInfo = fileInfoLines.join('\n');
                contentParts.push(fileInfo);

                // Add extracted content to processed attachment
                const processedAttachment = {
                    ...attachment,
                    ...(extractedContent && { extractedContent })
                };
                processedAttachments.push(processedAttachment);

            } catch (error) {
                loggingService.error('Failed to process attachment metadata', {
                    attachment,
                    error,
                    userId
                });
                processedAttachments.push(attachment);
            }
        }

        // Create enhanced context with file content
        const contextString = contentParts.length > 0
            ? `\n\n📁 **Attached Files:**\n\n${contentParts.join('\n\n')}\n`
            : '';

        return {
            processedAttachments,
            contextString,
        };
    }

    /**
     * Detect if a message requires autonomous agent workflow
     */
    static async detectAutonomousRequest(message: string): Promise<boolean> {
        try {
            // Keywords that indicate autonomous request
            const autonomousKeywords = [
                'create', 'build', 'deploy', 'develop', 'make', 'setup', 'implement',
                'generate', 'scaffold', 'initialize', 'configure', 'establish',
                'design', 'architect', 'construct', 'launch', 'ship', 'release',
                'write', 'code', 'program'
            ];
            
            const projectKeywords = [
                'app', 'application', 'website', 'api', 'service', 'project',
                'system', 'platform', 'solution', 'software', 'tool', 'product',
                'todo', 'list', 'mern', 'react', 'node', 'fullstack', 'backend', 'frontend'
            ];
            
            const messageLower = message.toLowerCase();
            
            // Check for autonomous keywords
            const hasAutonomousKeyword = autonomousKeywords.some(keyword => 
                messageLower.includes(keyword)
            );
            
            // Check for project keywords
            const hasProjectKeyword = projectKeywords.some(keyword => 
                messageLower.includes(keyword)
            );
            
            // More lenient heuristic: if we have an autonomous keyword, that's enough
            // Or if we have specific patterns
            if (hasAutonomousKeyword) {
                loggingService.info('🤖 Autonomous request detected via keywords', {
                    message: message.substring(0, 100),
                    hasAutonomousKeyword,
                    hasProjectKeyword
                });
                return true;
            }
            
            // Check for specific patterns that indicate building something
            const buildPatterns = [
                /build\s+(?:a|an|the)?\s*\w+/i,
                /create\s+(?:a|an|the)?\s*\w+/i,
                /make\s+(?:a|an|me|the)?\s*\w+/i,
                /develop\s+(?:a|an|the)?\s*\w+/i,
                /deploy\s+(?:a|an|the|my)?\s*\w+/i,
                /i\s+(?:want|need)\s+(?:to\s+)?(?:build|create|make)/i,
                /(?:can|could)\s+you\s+(?:build|create|make)/i
            ];
            
            const matchesPattern = buildPatterns.some(pattern => pattern.test(message));
            if (matchesPattern) {
                loggingService.info('🤖 Autonomous request detected via pattern', {
                    message: message.substring(0, 100)
                });
                return true;
            }
            
            // For edge cases, use AI for more sophisticated detection
            const prompt = `Analyze if this message requires an autonomous agent workflow (creating projects, deploying code, building applications, etc.):
            
Message: "${message}"

Respond with ONLY "true" or "false".`;
            
            const response = await BedrockService.invokeModel(
                prompt,
                'global.anthropic.claude-haiku-4-5-20251001-v1:0',
                { recentMessages: [{ role: 'user', content: prompt }] }
            );
            
            const result = response.trim().toLowerCase() === 'true';
            
            loggingService.info('🤖 Autonomous request detection result', {
                message: message.substring(0, 100),
                detected: result,
                method: 'AI'
            });
            
            return result;
            
        } catch (error) {
            loggingService.error('Failed to detect autonomous request', {
                error: error instanceof Error ? error.message : String(error),
                message
            });
            return false;
        }
    }

    /**
     * Create a governed plan message in the chat
     */
    static async createGovernedPlanMessage(
        conversationId: string,
        taskId: string,
        userId: string
    ): Promise<any> {
        try {
            // Import GovernedTask model
            const { GovernedTaskModel } = await import('./governedAgent.service');
            
            // Get task details
            const task = await GovernedTaskModel.findById(taskId);
            if (!task) {
                throw new Error('Governed task not found');
            }
            
            // Create the plan message
            const planMessage = await ChatMessage.create({
                conversationId: new Types.ObjectId(conversationId),
                userId,
                role: 'assistant',
                content: `🤖 **Autonomous Agent Initiated**\n\nI'm creating a plan to: ${task.userRequest}\n\nYou can track the progress and interact with the plan here.`,
                messageType: 'governed_plan',
                governedTaskId: new Types.ObjectId(taskId),
                planState: task.mode,
                metadata: {
                    tokenCount: 0,
                    cost: 0,
                    latency: 0
                }
            });
            
            // Update the task with chat context
            task.chatId = new Types.ObjectId(conversationId);
            task.parentMessageId = planMessage._id;
            await task.save();
            
            // Update or create ChatTaskLink
            const { ChatTaskLink } = await import('../models/ChatTaskLink');
            const link = await (ChatTaskLink as any).findOrCreateByChatId(new Types.ObjectId(conversationId));
            await link.addTask(new Types.ObjectId(taskId));
            
            return planMessage;
            
        } catch (error) {
            loggingService.error('Failed to create governed plan message', {
                error: error instanceof Error ? error.message : String(error),
                conversationId,
                taskId,
                userId
            });
            throw error;
        }
    }
}