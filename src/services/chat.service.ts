import { BedrockService } from './bedrock.service';
import { logger } from '../utils/logger';
import { ExperimentationService } from './experimentation.service';
import { Conversation, IConversation, ChatMessage } from '../models';
import { Types } from 'mongoose';

export interface ChatMessageResponse {
    id: string;
    conversationId: string;
    role: 'user' | 'assistant';
    content: string;
    modelId?: string;
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
}

export interface ChatSendMessageResponse {
    messageId: string;
    conversationId: string;
    response: string;
    cost: number;
    latency: number;
    tokenCount: number;
    model: string;
}

export class ChatService {
    /**
     * Send a message to AWS Bedrock model
     */
    static async sendMessage(request: ChatSendMessageRequest): Promise<ChatSendMessageResponse> {
        try {
            const startTime = Date.now();
            
            let conversation: IConversation;
            
            // Get or create conversation
            if (request.conversationId) {
                const foundConversation = await Conversation.findById(request.conversationId);
                if (!foundConversation || foundConversation.userId !== request.userId) {
                    throw new Error('Conversation not found or access denied');
                }
                conversation = foundConversation;
            } else {
                // Create new conversation
                conversation = new Conversation({
                    userId: request.userId,
                    title: `Chat with ${this.getModelDisplayName(request.modelId)}`,
                    modelId: request.modelId,
                    messageCount: 0,
                    totalCost: 0
                });
                await conversation.save();
            }

            // Save user message
            const userMessage = new ChatMessage({
                conversationId: conversation._id,
                userId: request.userId,
                role: 'user',
                content: request.message
            });
            await userMessage.save();

            // Get recent conversation history for context
            const recentMessages = await ChatMessage.find({
                conversationId: conversation._id
            })
            .sort({ createdAt: 1 })
            .limit(20) // Last 20 messages for context
            .lean();

            // Build context from conversation history
            const contextualPrompt = this.buildContextualPrompt(recentMessages, request.message);

            // Send to Bedrock
            const response = await BedrockService.invokeModel(
                contextualPrompt, 
                request.modelId
            );

            const latency = Date.now() - startTime;
            
            // Calculate cost (rough estimation)
            const inputTokens = Math.ceil(contextualPrompt.length / 4);
            const outputTokens = Math.ceil(response.length / 4);
            const cost = this.estimateCost(request.modelId, inputTokens, outputTokens);

            // Save assistant response
            const assistantMessage = new ChatMessage({
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
            });
            await assistantMessage.save();

            // Update conversation stats
            const messageCount = await ChatMessage.countDocuments({ conversationId: conversation._id });
            conversation.messageCount = messageCount;
            conversation.totalCost = (conversation.totalCost || 0) + cost;
            conversation.lastMessage = response.substring(0, 100) + (response.length > 100 ? '...' : '');
            conversation.lastMessageAt = new Date();
            await conversation.save();

            logger.info(`Chat message sent successfully for user ${request.userId} with model ${request.modelId}`);

            return {
                messageId: assistantMessage._id.toString(),
                conversationId: conversation._id.toString(),
                response,
                cost,
                latency,
                tokenCount: outputTokens,
                model: request.modelId
            };

        } catch (error) {
            logger.error('Error sending chat message:', error);
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
            logger.error('Error getting conversation history:', error);
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
            logger.error('Error getting user conversations:', error);
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

            logger.info(`New conversation created: ${conversation._id} for user ${request.userId}`);

            return this.convertConversationToResponse(conversation);

        } catch (error) {
            logger.error('Error creating conversation:', error);
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

            logger.info(`Conversation soft deleted: ${conversationId} for user ${userId}`);

        } catch (error) {
            logger.error('Error deleting conversation:', error);
            throw new Error('Failed to delete conversation');
        }
    }

    /**
     * Get available models for chat
     */
    static async getAvailableModels(): Promise<Array<{
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
    }>> {
        try {
            // Use the experimentation service to get available models
            const models = await ExperimentationService.getAccessibleBedrockModels();
            
            return models.map(model => ({
                id: model.modelId,
                name: this.getModelDisplayName(model.modelId),
                provider: this.getModelProvider(model.modelId),
                description: this.getModelDescription(model.modelId),
                capabilities: ['text', 'chat'],
                pricing: model.pricing || undefined
            }));

        } catch (error) {
            logger.error('Error getting available models:', error);
            
            // Comprehensive fallback list of AWS Bedrock models
            return [
                // Amazon Nova Models
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
                    id: 'amazon.nova-pro-v1:0',
                    name: 'Nova Pro',
                    provider: 'Amazon',
                    description: 'High-performance model for complex tasks',
                    capabilities: ['text', 'chat'],
                    pricing: { input: 0.8, output: 3.2, unit: 'Per 1M tokens' }
                },
                
                // Anthropic Claude Models
                {
                    id: 'anthropic.claude-3-5-haiku-20241022-v1:0',
                    name: 'Claude 3.5 Haiku',
                    provider: 'Anthropic',
                    description: 'Fast and intelligent for quick responses',
                    capabilities: ['text', 'chat'],
                    pricing: { input: 1.0, output: 5.0, unit: 'Per 1M tokens' }
                },
                {
                    id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
                    name: 'Claude 3.5 Sonnet',
                    provider: 'Anthropic',
                    description: 'Advanced reasoning and analysis capabilities',
                    capabilities: ['text', 'chat'],
                    pricing: { input: 3.0, output: 15.0, unit: 'Per 1M tokens' }
                },
                {
                    id: 'anthropic.claude-3-haiku-20240307-v1:0',
                    name: 'Claude 3 Haiku',
                    provider: 'Anthropic',
                    description: 'Fast responses with good reasoning',
                    capabilities: ['text', 'chat'],
                    pricing: { input: 0.25, output: 1.25, unit: 'Per 1M tokens' }
                },
                {
                    id: 'anthropic.claude-3-sonnet-20240229-v1:0',
                    name: 'Claude 3 Sonnet',
                    provider: 'Anthropic',
                    description: 'Balanced performance for complex tasks',
                    capabilities: ['text', 'chat'],
                    pricing: { input: 3.0, output: 15.0, unit: 'Per 1M tokens' }
                },
                {
                    id: 'anthropic.claude-3-opus-20240229-v1:0',
                    name: 'Claude 3 Opus',
                    provider: 'Anthropic',
                    description: 'Most capable model for complex reasoning',
                    capabilities: ['text', 'chat'],
                    pricing: { input: 15.0, output: 75.0, unit: 'Per 1M tokens' }
                },
                
                // Meta Llama Models
                {
                    id: 'meta.llama3-2-1b-instruct-v1:0',
                    name: 'Llama 3.2 1B Instruct',
                    provider: 'Meta',
                    description: 'Compact, efficient model for basic tasks',
                    capabilities: ['text', 'chat'],
                    pricing: { input: 0.1, output: 0.1, unit: 'Per 1M tokens' }
                },
                {
                    id: 'meta.llama3-2-3b-instruct-v1:0',
                    name: 'Llama 3.2 3B Instruct',
                    provider: 'Meta',
                    description: 'Efficient model for general tasks',
                    capabilities: ['text', 'chat'],
                    pricing: { input: 0.15, output: 0.15, unit: 'Per 1M tokens' }
                },
                {
                    id: 'meta.llama3-1-8b-instruct-v1:0',
                    name: 'Llama 3.1 8B Instruct',
                    provider: 'Meta',
                    description: 'Good balance of performance and efficiency',
                    capabilities: ['text', 'chat'],
                    pricing: { input: 0.3, output: 0.6, unit: 'Per 1M tokens' }
                },
                {
                    id: 'meta.llama3-1-70b-instruct-v1:0',
                    name: 'Llama 3.1 70B Instruct',
                    provider: 'Meta',
                    description: 'Large model for complex reasoning tasks',
                    capabilities: ['text', 'chat'],
                    pricing: { input: 2.65, output: 3.5, unit: 'Per 1M tokens' }
                },
                {
                    id: 'meta.llama3-1-405b-instruct-v1:0',
                    name: 'Llama 3.1 405B Instruct',
                    provider: 'Meta',
                    description: 'Most capable Llama model for advanced tasks',
                    capabilities: ['text', 'chat'],
                    pricing: { input: 5.32, output: 16.0, unit: 'Per 1M tokens' }
                },
                
                // Mistral AI Models
                {
                    id: 'mistral.mistral-7b-instruct-v0:2',
                    name: 'Mistral 7B Instruct',
                    provider: 'Mistral AI',
                    description: 'Efficient open-source model',
                    capabilities: ['text', 'chat'],
                    pricing: { input: 0.15, output: 0.2, unit: 'Per 1M tokens' }
                },
                {
                    id: 'mistral.mixtral-8x7b-instruct-v0:1',
                    name: 'Mixtral 8x7B Instruct',
                    provider: 'Mistral AI',
                    description: 'High-quality mixture of experts model',
                    capabilities: ['text', 'chat'],
                    pricing: { input: 0.45, output: 0.7, unit: 'Per 1M tokens' }
                },
                {
                    id: 'mistral.mistral-large-2402-v1:0',
                    name: 'Mistral Large',
                    provider: 'Mistral AI',
                    description: 'Advanced reasoning and multilingual capabilities',
                    capabilities: ['text', 'chat'],
                    pricing: { input: 4.0, output: 12.0, unit: 'Per 1M tokens' }
                },
                
                // Cohere Command Models
                {
                    id: 'cohere.command-text-v14',
                    name: 'Command',
                    provider: 'Cohere',
                    description: 'General purpose text generation model',
                    capabilities: ['text', 'chat'],
                    pricing: { input: 1.5, output: 2.0, unit: 'Per 1M tokens' }
                },
                {
                    id: 'cohere.command-light-text-v14',
                    name: 'Command Light',
                    provider: 'Cohere',
                    description: 'Lighter, faster version of Command',
                    capabilities: ['text', 'chat'],
                    pricing: { input: 0.3, output: 0.6, unit: 'Per 1M tokens' }
                },
                {
                    id: 'cohere.command-r-v1:0',
                    name: 'Command R',
                    provider: 'Cohere',
                    description: 'Retrieval-augmented generation model',
                    capabilities: ['text', 'chat'],
                    pricing: { input: 0.5, output: 1.5, unit: 'Per 1M tokens' }
                },
                {
                    id: 'cohere.command-r-plus-v1:0',
                    name: 'Command R+',
                    provider: 'Cohere',
                    description: 'Enhanced RAG model with better reasoning',
                    capabilities: ['text', 'chat'],
                    pricing: { input: 3.0, output: 15.0, unit: 'Per 1M tokens' }
                },
                
                // AI21 Labs Models
                {
                    id: 'ai21.jamba-instruct-v1:0',
                    name: 'Jamba Instruct',
                    provider: 'AI21 Labs',
                    description: 'Hybrid architecture for long context tasks',
                    capabilities: ['text', 'chat'],
                    pricing: { input: 0.5, output: 0.7, unit: 'Per 1M tokens' }
                },
                {
                    id: 'ai21.j2-ultra-v1',
                    name: 'Jurassic-2 Ultra',
                    provider: 'AI21 Labs',
                    description: 'Large language model for complex tasks',
                    capabilities: ['text', 'chat'],
                    pricing: { input: 15.0, output: 15.0, unit: 'Per 1M tokens' }
                },
                {
                    id: 'ai21.j2-mid-v1',
                    name: 'Jurassic-2 Mid',
                    provider: 'AI21 Labs',
                    description: 'Mid-size model for balanced performance',
                    capabilities: ['text', 'chat'],
                    pricing: { input: 12.5, output: 12.5, unit: 'Per 1M tokens' }
                }
            ];
        }
    }

    /**
     * Build contextual prompt from conversation history
     */
    private static buildContextualPrompt(messages: any[], newMessage: string): string {
        const maxHistoryLength = 10; // Keep last 10 messages for context
        const recentMessages = messages.slice(-maxHistoryLength);
        
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
            'anthropic.claude-3-5-sonnet-20240620-v1:0': { input: 3.0, output: 15.0 },
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
        const nameMap: Record<string, string> = {
            'amazon.nova-micro-v1:0': 'Nova Micro',
            'amazon.nova-lite-v1:0': 'Nova Lite', 
            'amazon.nova-pro-v1:0': 'Nova Pro',
            'amazon.titan-text-lite-v1': 'Titan Text Lite',
            'anthropic.claude-3-5-haiku-20241022-v1:0': 'Claude 3.5 Haiku',
            'anthropic.claude-3-5-sonnet-20240620-v1:0': 'Claude 3.5 Sonnet',
            'meta.llama3-1-8b-instruct-v1:0': 'Llama 3.1 8B',
        };

        return nameMap[modelId] || modelId.split('.').pop()?.split('-')[0] || modelId;
    }

    /**
     * Get provider for model
     */
    private static getModelProvider(modelId: string): string {
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
        const descriptionMap: Record<string, string> = {
            'amazon.nova-micro-v1:0': 'Fast and cost-effective model for simple tasks',
            'amazon.nova-lite-v1:0': 'Balanced performance and cost for general use',
            'amazon.nova-pro-v1:0': 'High-performance model for complex tasks',
            'amazon.titan-text-lite-v1': 'Lightweight text generation model',
            'anthropic.claude-3-5-haiku-20241022-v1:0': 'Fast and intelligent for quick responses',
            'anthropic.claude-3-5-sonnet-20240620-v1:0': 'Powerful model for complex reasoning',
            'meta.llama3-1-8b-instruct-v1:0': 'Open-source instruction-following model',
        };

        return descriptionMap[modelId] || 'Advanced AI model for text generation and chat';
    }
} 