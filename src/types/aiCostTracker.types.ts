export interface UsageMetadata {
    provider: AIProvider;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCost: number;
    prompt: string;
    completion?: string;
    responseTime?: number;
    tags?: string[];
    sessionId?: string;
    metadata?: Record<string, any>;
    optimizationApplied?: boolean;
    optimizationId?: string;
    errorOccurred?: boolean;
    errorMessage?: string;
    ipAddress?: string;
    userAgent?: string;
}

export interface CostEstimate {
    promptCost: number;
    completionCost: number;
    totalCost: number;
    currency: string;
    breakdown: {
        promptTokens: number;
        completionTokens: number;
        pricePerPromptToken: number;
        pricePerCompletionToken: number;
    };
}

export interface OptimizationSuggestion {
    id: string;
    type: 'prompt' | 'model' | 'batching' | 'caching' | 'compression' | 'context_trimming' | 'request_fusion';
    originalPrompt?: string;
    optimizedPrompt?: string;
    estimatedSavings: number;
    confidence: number;
    explanation: string;
    implementation?: string;
    tradeoffs?: string;
    compressionDetails?: CompressionDetails;
    contextTrimDetails?: ContextTrimDetails;
    fusionDetails?: RequestFusionDetails;
}

export interface CompressionDetails {
    technique: 'json_compression' | 'pattern_replacement' | 'abbreviation' | 'deduplication';
    originalSize: number;
    compressedSize: number;
    compressionRatio: number;
    reversible: boolean;
}

export interface ContextTrimDetails {
    technique: 'summarization' | 'relevance_filtering' | 'sliding_window' | 'importance_scoring';
    originalMessages: number;
    trimmedMessages: number;
    preservedContext: string[];
}

export interface RequestFusionDetails {
    fusedRequests: string[];
    fusionStrategy: 'sequential' | 'parallel' | 'hierarchical';
    estimatedTimeReduction: number;
}

export interface OptimizationResult {
    id: string;
    suggestions: OptimizationSuggestion[];
    totalSavings: number;
    appliedOptimizations: string[];
    metadata: {
        processingTime: number;
        originalTokens: number;
        optimizedTokens: number;
        techniques: string[];
        optimizationType?: string;
        contextTrimDetails?: ContextTrimDetails;
        fusionStrategy?: string;
        cortexOptimized?: boolean;
        cortexMetrics?: {
            encodingReduction: number;
            semanticCompression: number;
            processingTime: number;
            cacheUtilization: number;
            tokenReduction: number;
            costReduction: number;
        };
    };
}

export interface UsageAnalytics {
    totalCost: number;
    totalTokens: number;
    averageTokensPerRequest: number;
    mostUsedModels: ModelUsage[];
    costByProvider: ProviderCost[];
    usageOverTime: TimeSeriesData[];
    topExpensivePrompts: ExpensivePrompt[];
}

export interface ModelUsage {
    model: string;
    provider: AIProvider;
    requestCount: number;
    totalTokens: number;
    totalCost: number;
    averageCostPerRequest: number;
}

export interface ProviderCost {
    provider: AIProvider;
    totalCost: number;
    percentage: number;
}

export interface TimeSeriesData {
    timestamp: Date;
    cost: number;
    tokens: number;
    requests: number;
}

export interface ExpensivePrompt {
    prompt: string;
    cost: number;
    tokens: number;
    model: string;
    timestamp: Date;
}

export enum AIProvider {
    OpenAI = 'openai',
    AWSBedrock = 'aws-bedrock',
    Anthropic = 'anthropic',
    Google = 'google',
    Cohere = 'cohere',
    DeepSeek = 'deepseek',
    Grok = 'groq',
    HuggingFace = 'huggingface',
    Ollama = 'ollama',
    Replicate = 'replicate',
    Azure = 'azure',
    // Gemini is an alias for Google (both use Google AI SDK)
    Gemini = 'gemini'
}

export interface TrackerConfig {
    providers: ProviderConfig[];
    optimization: OptimizationConfig;
    tracking: TrackingConfig;
    alerts?: AlertConfig;
    apiUrl?: string;
}

export interface ProviderConfig {
    provider: AIProvider;
    apiKey?: string;
    region?: string;
    endpoint?: string;
    customPricing?: CustomPricing;
    optimization?: OptimizationConfig;

    // Azure specific
    resourceName?: string;
    deploymentId?: string;
    apiVersion?: string;
}

export interface OptimizationConfig {
    enablePromptOptimization: boolean;
    enableModelSuggestions: boolean;
    enableCachingSuggestions: boolean;
    enableCompression?: boolean;
    enableContextTrimming?: boolean;
    enableRequestFusion?: boolean;
    bedrockConfig?: BedrockConfig;
    compressionSettings?: {
        minCompressionRatio: number;
        jsonCompressionThreshold: number;
    };
    contextTrimmingSettings?: {
        maxContextLength: number;
        preserveRecentMessages: number;
        summarizationModel?: string;
    };
    requestFusionSettings?: {
        maxFusionBatch: number;
        fusionWaitTime: number;
    };
    thresholds: {
        highCostPerRequest: number;
        highTokenUsage: number;
        frequencyThreshold: number;
        batchingThreshold?: number;
        modelDowngradeConfidence?: number;
    };
}

export interface BedrockConfig {
    region: string;
    modelId: string;
    credentials?: {
        accessKeyId: string;
        secretAccessKey: string;
        sessionToken?: string;
    };
}

export interface TrackingConfig {
    /** Tracking is always on; no option to disable (required for usage and cost attribution). */
    enableSessionReplay?: boolean;
    retentionDays?: number;
    storageType?: 'memory' | 'file' | 'custom';
    customStorage?: any;
    sessionReplayTimeout?: number; // Minutes of inactivity before auto-ending session
}

export interface AlertConfig {
    costThreshold?: number;
    tokenThreshold?: number;
    emailNotifications?: boolean;
    webhookUrl?: string;
}

export interface CustomPricing {
    [model: string]: {
        promptPrice: number;
        completionPrice: number;
        unit: 'per-token' | 'per-1k-tokens' | 'per-1m-tokens';
    };
}

export interface AIResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    metadata?: {
        processingTime: number;
        tokensUsed: number;
        cost: number;
    };
}

export interface ConversationMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: Date;
    importance?: number;
}

export interface FusionRequest {
    id: string;
    prompt: string;
    timestamp: number;
    model: string;
    provider: AIProvider;
    metadata?: Record<string, any>;
}

export interface ProviderRequest {
    model: string;
    messages?: Array<{ role: string; content: string }>;
    prompt?: string;
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    stop?: string | string[];
    stream?: boolean;
    user?: string;
}

export interface ProviderResponse {
    id?: string;
    object?: string;
    created?: number;
    model?: string;
    choices: Array<{
        index: number;
        message?: {
            role: string;
            content: string;
        };
        text?: string;
        finish_reason?: string;
    }>;
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
    };
    system_fingerprint?: string;
}

// Pricing data interfaces
export interface ModelPricing {
    prompt: number;
    completion: number;
    unit: PricingUnit;
    notes?: string;
}

export enum PricingUnit {
    PER_TOKEN = 'per-token',
    PER_1K_TOKENS = 'per-1k-tokens',
    PER_1M_TOKENS = 'per-1m-tokens'
}

export interface ProviderModel {
    id: string;
    name: string;
    provider: AIProvider;
    pricing: ModelPricing;
    capabilities: ModelCapabilities;
    contextWindow: number;
    description?: string;
}

export interface ModelCapabilities {
    supportsChat: boolean;
    supportsCompletion: boolean;
    supportsEmbedding: boolean;
    supportsVision: boolean;
    supportsCodeGeneration: boolean;
    maxTokens: number;
}

// Default configurations
export const optimizationThresholds = {
    highCostPerRequest: 0.01,
    highTokenUsage: 2000,
    frequencyThreshold: 5,
    batchingThreshold: 3,
    modelDowngradeConfidence: 0.8
};

export const alertThresholds = {
    dailyCostLimit: 10,
    weeklyCostLimit: 50,
    monthlyCostLimit: 200,
    anomalyPercentage: 50
}; 