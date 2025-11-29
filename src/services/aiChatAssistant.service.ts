import { ChatBedrockConverse } from '@langchain/aws';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { loggingService } from './logging.service';

export interface ChatMessage {
    senderType: 'user' | 'support' | 'system' | 'ai';
    senderName: string;
    content: string;
    createdAt: Date;
}

export class AIChatAssistantService {
    private static instance: AIChatAssistantService;
    private model: ChatBedrockConverse | null = null;
    private isInitialized: boolean = false;

    private constructor() {
        // Use cost-effective model for chat - Nova Micro is 85% cheaper than Claude
        const chatModel = process.env.AWS_BEDROCK_CHAT_MODEL_ID ?? 'amazon.nova-micro-v1:0';
        const region = process.env.AWS_BEDROCK_REGION ?? 'us-east-1';
        const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
        const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
        
        if (!accessKeyId || !secretAccessKey) {
            loggingService.warn('AWS credentials not configured for AI Chat Assistant - AI responses will be disabled', {
                hasAccessKey: !!accessKeyId,
                hasSecretKey: !!secretAccessKey,
            });
            this.isInitialized = false;
            return;
        }
        
        try {
            this.model = new ChatBedrockConverse({
                region,
                model: chatModel,
                credentials: {
                    accessKeyId,
                    secretAccessKey,
                },
                temperature: 0.7,
                maxTokens: 2000, // Shorter responses for chat
            });

            this.isInitialized = true;
            loggingService.info('🤖 AI Chat Assistant Service initialized', {
                model: chatModel,
                region,
            });
        } catch (error) {
            loggingService.error('Failed to initialize AI Chat Assistant Service', {
                error: error instanceof Error ? error.message : String(error),
            });
            this.isInitialized = false;
        }
    }

    static getInstance(): AIChatAssistantService {
        if (!AIChatAssistantService.instance) {
            AIChatAssistantService.instance = new AIChatAssistantService();
        }
        return AIChatAssistantService.instance;
    }

    /**
     * Generate AI response based on chat history
     */
    async generateResponse(
        chatHistory: ChatMessage[],
        sessionSubject: string,
        userName?: string
    ): Promise<string> {
        if (!this.isInitialized || !this.model) {
            loggingService.warn('AI Chat Assistant not initialized, returning fallback response', {
                isInitialized: this.isInitialized,
                hasModel: !!this.model,
            });
            return "I apologize, but the AI assistant is currently unavailable. Please contact our support team for assistance.";
        }

        try {
            const userGreeting = userName ? `The user you are helping is ${userName}.` : '';
            const systemPrompt = `You are a helpful support assistant for Cost Katana, a cost optimization platform. 

Your role:
- Provide friendly, accurate, and concise responses
- Help users with questions about Cost Katana features, API usage, integrations, and troubleshooting
- If you cannot answer a question definitively, suggest contacting support or provide relevant documentation links
- Keep responses conversational and helpful
- Be concise but thorough
- Format your responses using markdown for better readability (use **bold** for emphasis, bullet points for lists, etc.)

Current chat subject: ${sessionSubject}
${userGreeting}

Important: Always address the user directly by their name (${userName || 'the user'}) when greeting them. Do NOT mention or reference admins or support agents - you are speaking directly to the user who requested help.

Remember: You're here to help users get the most out of Cost Katana. Be professional, friendly, and solution-oriented.`;

            // Build conversation history (last 10 messages for context)
            const recentMessages = chatHistory.slice(-10);
            const messages = [
                new SystemMessage(systemPrompt),
                ...recentMessages.map(msg => {
                    if (msg.senderType === 'user') {
                        return new HumanMessage(msg.content);
                    } else {
                        // For AI/support/system messages, format as assistant messages
                        return new SystemMessage(`${msg.senderName}: ${msg.content}`);
                    }
                }),
            ];

            loggingService.info('Invoking AI model', {
                sessionSubject,
                messageCount: recentMessages.length,
                totalHistory: chatHistory.length,
            });

            const response = await this.model.invoke(messages);
            const aiResponse = response.content as string;

            if (!aiResponse || aiResponse.trim().length === 0) {
                loggingService.warn('Empty response from AI model', { sessionSubject });
                return "I apologize, but I'm having trouble processing your request right now. Please try rephrasing your question, or our support team will be with you shortly.";
            }

            loggingService.info('AI response generated successfully', {
                sessionSubject,
                messageCount: chatHistory.length,
                responseLength: aiResponse.length,
            });

            return aiResponse.trim();
        } catch (error) {
            loggingService.error('Error generating AI response', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                sessionSubject,
            });

            // Fallback response
            return "I apologize, but I'm having trouble processing your request right now. Please try rephrasing your question, or our support team will be with you shortly.";
        }
    }

    /**
     * Check if AI should respond (rate limiting)
     */
    shouldRespond(lastAiResponseAt?: Date): boolean {
        if (!lastAiResponseAt) {
            return true;
        }

        const now = new Date();
        const timeSinceLastResponse = now.getTime() - lastAiResponseAt.getTime();
        const minInterval = 30 * 1000; // 30 seconds

        return timeSinceLastResponse >= minInterval;
    }
}

export const aiChatAssistantService = AIChatAssistantService.getInstance();

