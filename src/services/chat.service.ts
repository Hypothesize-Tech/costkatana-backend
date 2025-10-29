import { BedrockService } from './tracedBedrock.service';
import { AWS_BEDROCK_PRICING } from '../utils/pricing/aws-bedrock';
import { Conversation, IConversation, ChatMessage } from '../models';
import { DocumentModel } from '../models/Document';
import { Types } from 'mongoose';
import mongoose from 'mongoose';
// import { agentService } from './agent.service';
// import { conversationalFlowService } from './conversationFlow.service';
// import { multiAgentFlowService } from './multiAgentFlow.service';
import { TrendingDetectorService } from './trendingDetector.service';
import { retrievalService } from './retrieval.service';
import { loggingService } from './logging.service';

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

export interface ChatMessageResponse {
    id: string;
    conversationId: string;
    role: 'user' | 'assistant';
    content: string;
    modelId?: string;
    attachedDocuments?: Array<{
        documentId: string;
        fileName: string;
        chunksCount: number;
        fileType?: string;
    }>;
    timestamp: Date;
    metadata?: {
        temperature?: number;
        maxTokens?: number;
        cost?: number;
        latency?: number;
        tokenCount?: number;
    };
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
}

export interface ChatSendMessageRequest {
    userId: string;
    message: string;
    modelId: string;
    conversationId?: string;
    temperature?: number;
    maxTokens?: number;
    chatMode?: 'fastest' | 'cheapest' | 'balanced';
    useMultiAgent?: boolean;
    documentIds?: string[]; // Document IDs for RAG context
    req?: any; // Express Request object for tracing context
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
}

export class ChatService {
    // Context management
    private static contextCache = new Map<string, ConversationContext>();
    private static readonly CTX_MAX_HISTORY = parseInt(process.env.CTX_MAX_HISTORY || '3');
    
    private static readonly CTX_REDIS_TTL = parseInt(process.env.CTX_REDIS_TTL || '600');
    private static readonly CTX_COREF_LL_ENABLED = process.env.CTX_COREF_LL_ENABLED !== 'false';

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
            id: 'anthropic.claude-3-5-haiku-20241022-v1:0',
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
            /ai-cost-tracker/g, /ai-cost-optimizer-cli/g, /cost-katana/g,
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
                subject = 'cost-katana-python';
            } else if (lowerMessage.includes('npm') || lowerMessage.includes('javascript') || lowerMessage.includes('typescript')) {
                subject = 'ai-cost-tracker';
            } else if (lowerMessage.includes('cli') || lowerMessage.includes('command')) {
                subject = 'ai-cost-optimizer-cli';
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
            if (recentContext.includes('cost-katana') || recentContext.includes('python')) {
                subject = 'cost-katana-python';
            } else if (recentContext.includes('ai-cost-tracker') || recentContext.includes('npm')) {
                subject = 'ai-cost-tracker';
            } else if (recentContext.includes('ai-cost-optimizer-cli') || recentContext.includes('cli')) {
                subject = 'ai-cost-optimizer-cli';
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
        if (this.CTX_COREF_LL_ENABLED && context.subjectConfidence < 0.6) {
            try {
                const llm = new (await import('@langchain/aws')).ChatBedrockConverse({
                    model: "us.anthropic.claude-3-5-haiku-20241022-v1:0",  // Using inference profile
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

    private static decideRoute(context: ConversationContext, message: string): 'knowledge_base' | 'conversational_flow' | 'multi_agent' | 'web_scraper' {
        const lowerMessage = message.toLowerCase();
        
        // High confidence CostKatana queries go to knowledge base
        if (context.lastDomain === 'costkatana' && context.subjectConfidence > 0.7) {
            return 'knowledge_base';
        }
        
        // Cost Katana specific queries - Check for product-specific terms
        const costKatanaTerms = [
            'costkatana', 'cost katana', 'cortex', 'multi-agent', 'workflow',
            'integration guide', 'api documentation', 'how to use', 'getting started',
            'setup', 'configure', 'tutorial', 'documentation', 'guide',
            'features', 'capabilities', 'architecture', 'best practices'
        ];
        
        if (costKatanaTerms.some(term => lowerMessage.includes(term))) {
            return 'knowledge_base';
        }
        
        // Package-related queries
        if (lowerMessage.includes('package') || lowerMessage.includes('npm') || lowerMessage.includes('pypi') || 
            lowerMessage.includes('install') || lowerMessage.includes('integrate') || lowerMessage.includes('python') ||
            lowerMessage.includes('cli') || lowerMessage.includes('sdk')) {
            return 'knowledge_base';
        }
        
        // "How to" and "What is" questions likely need documentation
        if ((lowerMessage.startsWith('how ') || lowerMessage.startsWith('what ') || 
             lowerMessage.startsWith('where ') || lowerMessage.startsWith('why ') ||
             lowerMessage.includes('how do') || lowerMessage.includes('what is') ||
             lowerMessage.includes('tell me about')) && 
            !lowerMessage.includes('latest news') && !lowerMessage.includes('current')) {
            return 'knowledge_base';
        }
        
        // Web scraping for external content (news, trends, latest info)
        if ((lowerMessage.includes('latest') || lowerMessage.includes('news') || 
             lowerMessage.includes('trending') || lowerMessage.includes('current')) &&
            (lowerMessage.includes('search') || lowerMessage.includes('find'))) {
            return 'web_scraper';
        }
        
        // Analytics queries about user's own data
        if ((lowerMessage.includes('my cost') || lowerMessage.includes('my billing') || 
             lowerMessage.includes('my usage') || lowerMessage.includes('my analytics')) &&
            (lowerMessage.includes('show') || lowerMessage.includes('what') || lowerMessage.includes('analyze'))) {
            return 'multi_agent';
        }
        
        // Default to conversational flow for general queries
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
     * Process message with circuit breaker pattern
     */
    private static async processWithFallback(
        request: ChatSendMessageRequest,
        conversation: IConversation,
        recentMessages: any[]
    ): Promise<{ response: string; agentThinking?: any; agentPath: string[]; optimizationsApplied: string[]; cacheHit: boolean; riskLevel: string }> {
        
        const userId = request.userId;
        const errorKey = `${userId}-processing`;
        
        // Check circuit breaker
        if ((this.errorCounts.get(errorKey) || 0) >= this.MAX_ERRORS) {
            loggingService.warn('Circuit breaker open for user, using direct Bedrock', { userId });
            return this.directBedrockFallback(request, recentMessages);
        }
        
        try {
            // Try enhanced processing
            return await this.tryEnhancedProcessing(request, conversation, recentMessages);
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
    ): Promise<{ response: string; agentThinking?: any; agentPath: string[]; optimizationsApplied: string[]; cacheHit: boolean; riskLevel: string }> {
        
        // Build conversation context
        const context = this.buildConversationContext(
            conversation._id.toString(),
            request.message,
            recentMessages
        );
        
        // Resolve coreference if needed
        const corefResult = await this.resolveCoreference(request.message, context, recentMessages);
        let resolvedMessage = request.message;
        
        if (corefResult.resolved && corefResult.subject) {
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
            // Decide routing based on context
            route = this.decideRoute(context, resolvedMessage);
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

    private static async handleKnowledgeBaseRoute(
        request: ChatSendMessageRequest,
        context: ConversationContext,
        contextPreamble: string,
        recentMessages: any[]
    ): Promise<{ response: string; agentThinking?: any; agentPath: string[]; optimizationsApplied: string[]; cacheHit: boolean; riskLevel: string }> {
        
        loggingService.info('📚 Routing to knowledge base', {
            subject: context.currentSubject,
            domain: context.lastDomain
        });
        
        try {
            // Retrieve relevant context from RAG system
            const retrievalOptions: any = {
                limit: 5,
                useCache: true,
                rerank: true
            };
            
            // If specific documents are provided, filter by them
            if (request.documentIds && request.documentIds.length > 0) {
                retrievalOptions.filters = {
                    documentIds: request.documentIds
                };
                retrievalOptions.limit = 10; // Increase limit for document-specific queries
            }
            
            const ragContext = await retrievalService.retrieveWithContext(
                request.message,
                {
                    userId: request.userId,
                    recentMessages: recentMessages.slice(-3).map(msg => msg.content),
                    currentTopic: context.currentSubject
                },
                retrievalOptions
            );

            loggingService.info('📚 Retrieved RAG context', {
                documentsFound: ragContext.documents.length,
                sources: ragContext.sources || [],
                userId: request.userId
            });

            const { agentService } = await import('./agent.service');
            
            // Build enhanced query with RAG context
            let enhancedQuery = `${contextPreamble}\n\n`;
            
            // Add RAG context if available
            if (ragContext.documents.length > 0) {
                enhancedQuery += `**Relevant Knowledge Base Context:**\n`;
                ragContext.documents.slice(0, 3).forEach((doc, idx) => {
                    const content = (doc as any).content || (doc as any).pageContent || '';
                    enhancedQuery += `${idx + 1}. ${content.substring(0, 200)}...\n`;
                });
                enhancedQuery += `\n`;
            }
            
            enhancedQuery += `User query: ${request.message}`;
            
            const agentResponse = await agentService.query({
                userId: request.userId,
                query: enhancedQuery,
                context: {
                    conversationId: context.conversationId,
                    previousMessages: recentMessages.map(msg => ({
                        role: msg.role,
                        content: msg.content
                    }))
                }
            });

            if (agentResponse.success && agentResponse.response) {
                return {
                    response: agentResponse.response,
                    agentThinking: agentResponse.thinking,
                    agentPath: ['knowledge_base', 'rag_enhanced'],
                    optimizationsApplied: [
                        'context_enhancement',
                        'knowledge_base_routing',
                        'rag_retrieval',
                        `retrieved_${ragContext.documents.length}_docs`
                    ],
                    cacheHit: ragContext.cacheHit || false,
                    riskLevel: 'low'
                };
            }
        } catch (error) {
            loggingService.warn('Knowledge base routing failed, falling back to conversational flow', {
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
    ): Promise<{ response: string; agentThinking?: any; agentPath: string[]; optimizationsApplied: string[]; cacheHit: boolean; riskLevel: string }> {
        
        loggingService.info('🌐 Routing to web scraper', {
            subject: context.currentSubject,
            domain: context.lastDomain
        });
        
        try {
            const { agentService } = await import('./agent.service');
            
            // Build enhanced query with context
            const enhancedQuery = `${contextPreamble}\n\nUser query: ${request.message}`;
            
            const agentResponse = await agentService.query({
                userId: request.userId,
                query: enhancedQuery,
                context: {
                    conversationId: context.conversationId,
                    previousMessages: recentMessages.map(msg => ({
                        role: msg.role,
                        content: msg.content
                    })),
                    useWebScraper: true,
                    searchTerms: this.extractSearchTerms(request.message)
                }
            });

            if (agentResponse.success && agentResponse.response) {
                return {
                    response: agentResponse.response,
                    agentThinking: agentResponse.thinking,
                    agentPath: ['web_scraper'],
                    optimizationsApplied: ['context_enhancement', 'web_scraper_routing'],
                    cacheHit: false,
                    riskLevel: 'medium'
                };
            }
        } catch (error) {
            loggingService.warn('Web scraper routing failed, falling back to conversational flow', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
        
        // Fallback to conversational flow
        return await this.handleConversationalFlowRoute(request, context, contextPreamble, recentMessages);
    }

    private static extractSearchTerms(message: string): string[] {
        const lowerMessage = message.toLowerCase();
        const searchTerms: string[] = [];
        
        // Extract potential search terms
        const words = message.split(/\s+/).filter(word => 
            word.length > 3 && 
            !['what', 'how', 'when', 'where', 'why', 'which', 'who', 'the', 'and', 'or', 'but', 'for', 'with', 'from', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once'].includes(word.toLowerCase())
        );
        
        // Add specific terms based on context
        if (lowerMessage.includes('latest') || lowerMessage.includes('recent')) {
            searchTerms.push('latest', 'recent', 'new');
        }
        if (lowerMessage.includes('news') || lowerMessage.includes('update')) {
            searchTerms.push('news', 'update', 'announcement');
        }
        if (lowerMessage.includes('trending') || lowerMessage.includes('popular')) {
            searchTerms.push('trending', 'popular', 'viral');
        }
        
        // Add extracted words
        searchTerms.push(...words.slice(0, 5)); // Limit to 5 terms
        
        return [...new Set(searchTerms)]; // Remove duplicates
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
            
            const enhancedQuery = `${contextPreamble}\n\nUser query: ${request.message}`;
            
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
        const contextualPrompt = this.buildContextualPrompt(recentMessages, request.message);
        
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
     * Send a message to AWS Bedrock model
     */
    static async sendMessage(request: ChatSendMessageRequest): Promise<ChatSendMessageResponse> {
        try {
            const startTime = Date.now();
            
            let conversation: IConversation;
            let recentMessages: any[] = [];
            
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
                        // Create new conversation with smart title from first message
                        const title = this.generateSimpleTitle(request.message, request.modelId);
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
                        request.message.length
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

                    // Save user message with attached documents
                    await ChatMessage.create([{
                        conversationId: conversation!._id,
                        userId: request.userId,
                        role: 'user',
                        content: request.message,
                        attachedDocuments: attachedDocuments
                    }], { session });
                });
            } finally {
                await session.endSession();
            }
            
            // Ensure conversation is assigned
            if (!conversation!) {
                throw new Error('Failed to get or create conversation');
            }

            // Optimized: Enhanced processing with circuit breaker
            const processingResult = await this.processWithFallback(request, conversation!, recentMessages);
            
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
            const inputTokens = Math.ceil(request.message.length / 4);
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
                        }
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

            loggingService.info(`Chat message sent successfully for user ${request.userId} with model ${request.modelId}`);

            return {
                messageId: 'temp-id', // Will be updated after save
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
                riskLevel
            };

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
            // Verify conversation ownership
            const conversation = await Conversation.findOne({
                _id: conversationId,
                userId: userId,
                isActive: true
            });
            
            if (!conversation) {
                throw new Error('Conversation not found or access denied');
            }

            // Get messages with pagination
            const messages = await ChatMessage.find({
                conversationId: new Types.ObjectId(conversationId)
            })
            .sort({ createdAt: 1 })
            .skip(offset)
            .limit(limit)
            .lean();

            const total = await ChatMessage.countDocuments({
                conversationId: new Types.ObjectId(conversationId)
            });

            return {
                messages: messages.map(this.convertMessageToResponse),
                total,
                conversation: this.convertConversationToResponse(conversation)
            };

        } catch (error) {
            loggingService.error('Error getting conversation history:', { error: error instanceof Error ? error.message : String(error) });
            throw new Error('Failed to get conversation history');
        }
    }

    /**
     * Get all conversations for a user
     */
    static async getUserConversations(
        userId: string, 
        limit: number = 20, 
        offset: number = 0
    ): Promise<{ conversations: ConversationResponse[]; total: number }> {
        try {
            const conversations = await Conversation.find({
                userId: userId,
                isActive: true
            })
            .sort({ updatedAt: -1 })
            .skip(offset)
            .limit(limit)
            .lean();

            const total = await Conversation.countDocuments({
                userId: userId,
                isActive: true
            });

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
                    updatedAt: new Date()
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
            totalCost: conversation.totalCost || 0
        };
    }

    /**
     * Convert MongoDB message document to response format
     */
    private static convertMessageToResponse(message: any): ChatMessageResponse {
        return {
            id: message._id.toString(),
            conversationId: message.conversationId.toString(),
            role: message.role,
            content: message.content,
            modelId: message.modelId,
            attachedDocuments: message.attachedDocuments,
            timestamp: message.createdAt,
            metadata: message.metadata
        };
    }

    /**
     * Estimate cost for model usage
     */
    private static estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
        const pricingMap: Record<string, { input: number; output: number }> = {
            'amazon.nova-micro-v1:0': { input: 0.035, output: 0.14 },
            'amazon.nova-lite-v1:0': { input: 0.06, output: 0.24 },
            'amazon.nova-pro-v1:0': { input: 0.80, output: 3.20 },
            'anthropic.claude-3-5-haiku-20241022-v1:0': { input: 1.0, output: 5.0 },
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
            'anthropic.claude-3-5-haiku-20241022-v1:0': 'Claude 3.5 Haiku',
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
            'anthropic.claude-3-5-haiku-20241022-v1:0': 'Fast and intelligent for quick responses',
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
} 