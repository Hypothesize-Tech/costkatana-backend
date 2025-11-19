/**
 * AI Provider Types
 * Common types and interfaces for multi-provider AI integration
 */

export enum AIProviderType {
    OpenAI = 'openai',
    Google = 'google',
    Bedrock = 'bedrock',
    Anthropic = 'anthropic'
}

export interface AIMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface AIInvokeOptions {
    recentMessages?: AIMessage[];
    useSystemPrompt?: boolean;
    systemMessage?: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    stopSequences?: string[];
}

export interface AIUsageMetadata {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
}

export interface AIInvokeResponse {
    text: string;
    usage: AIUsageMetadata;
    model: string;
    provider: AIProviderType;
    finishReason?: string;
    cached?: boolean;
}

export interface AIProviderConfig {
    apiKey?: string;
    region?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
}

export class AIProviderError extends Error {
    constructor(
        message: string,
        public provider: AIProviderType,
        public originalError?: any,
        public statusCode?: number
    ) {
        super(message);
        this.name = 'AIProviderError';
    }
}

export interface AIProviderInterface {
    invokeModel(
        prompt: string,
        model: string,
        options?: AIInvokeOptions
    ): Promise<AIInvokeResponse>;
    
    estimateTokens(text: string): number;
    
    isModelSupported(model: string): boolean;
}

