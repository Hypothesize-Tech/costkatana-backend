/**
 * Model Capability Types
 * 
 * Type definitions for the capability-based model routing system.
 * Enables provider-agnostic model selection and execution.
 */

import { AIProviderType } from './aiProvider.types';

/**
 * Model Capabilities
 */
export enum ModelCapability {
    TEXT = 'text',
    VISION = 'vision',
    STREAMING = 'streaming',
    JSON_MODE = 'json_mode',
    FUNCTION_CALLING = 'function_calling',
    EMBEDDINGS = 'embeddings',
    AUDIO = 'audio',
    VIDEO = 'video',
    IMAGE_GENERATION = 'image_generation',
    CODE_EXECUTION = 'code_execution',
    WEB_SEARCH = 'web_search',
    MULTIMODAL = 'multimodal'
}

/**
 * Model Performance Metrics
 */
export interface ModelPerformance {
    avgLatencyMs: number;
    p95LatencyMs?: number;
    p99LatencyMs?: number;
    reliabilityScore: number; // 0-1, based on historical success rate
    throughputTokensPerSec?: number;
}

/**
 * Model Pricing Information
 */
export interface ModelPricing {
    inputPricePerMillion: number;
    outputPricePerMillion: number;
    cachePricePerMillion?: number;
    currency: string;
    lastUpdated: Date;
}

/**
 * Model Capability Definition
 */
export interface ModelCapabilityDefinition {
    modelId: string; // Canonical model ID (e.g., "gpt-4o", "claude-3-5-sonnet")
    provider: string; // Internal provider identifier (not exposed to business logic)
    providerType: AIProviderType; // Enum for compatibility
    displayName: string;
    description?: string;
    
    // Capabilities
    capabilities: Set<ModelCapability>;
    
    // Context and limits
    contextWindow: number;
    maxOutputTokens: number;
    
    // Pricing
    pricing: ModelPricing;
    
    // Performance
    performance: ModelPerformance;
    
    // Metadata
    metadata: {
        version?: string;
        releaseDate?: Date;
        deprecated?: boolean;
        replacementModel?: string;
        region?: string;
        [key: string]: any;
    };
    
    // Status
    isAvailable: boolean;
    isExperimental?: boolean;
}

/**
 * Model Selection Strategy
 */
export enum ModelSelectionStrategy {
    COST_OPTIMIZED = 'cost_optimized',
    SPEED_OPTIMIZED = 'speed_optimized',
    QUALITY_OPTIMIZED = 'quality_optimized',
    BALANCED = 'balanced',
    CUSTOM = 'custom'
}

/**
 * Model Selection Constraints
 */
export interface ModelSelectionConstraints {
    maxCostPerRequest?: number;
    maxLatencyMs?: number;
    minReliability?: number;
    minContextWindow?: number;
    excludeProviders?: string[];
    preferredProviders?: string[];
    excludeExperimental?: boolean;
}

/**
 * Model Selection Weights (for CUSTOM strategy)
 */
export interface ModelSelectionWeights {
    costWeight: number; // 0-1
    latencyWeight: number; // 0-1
    qualityWeight: number; // 0-1
    reliabilityWeight: number; // 0-1
}

/**
 * Model Selection Request
 */
export interface ModelSelectionRequest {
    requiredCapabilities: ModelCapability[];
    optionalCapabilities?: ModelCapability[];
    constraints?: ModelSelectionConstraints;
    strategy: ModelSelectionStrategy;
    customWeights?: ModelSelectionWeights;
    contextHints?: {
        estimatedInputTokens?: number;
        estimatedOutputTokens?: number;
        requiresStreaming?: boolean;
        priority?: 'high' | 'medium' | 'low';
    };
}

/**
 * Model Selection Result
 */
export interface ModelSelectionResult {
    selectedModel: ModelCapabilityDefinition;
    alternativeModels: ModelCapabilityDefinition[];
    selectionReasoning: {
        strategy: ModelSelectionStrategy;
        score: number;
        scoreBreakdown?: {
            costScore: number;
            latencyScore: number;
            qualityScore: number;
            reliabilityScore: number;
        };
        matchedCapabilities: ModelCapability[];
        missingCapabilities: ModelCapability[];
        tradeoffs?: string;
    };
    estimatedCost?: number;
    estimatedLatency?: number;
}

/**
 * Provider Adapter Registration
 */
export interface ProviderAdapterRegistration {
    providerType: AIProviderType;
    adapterFactory: () => IProviderAdapter;
    supportedModels: string[];
    priority?: number; // For provider selection when multiple support the same model
}

/**
 * Unified AI Request
 */
export interface UnifiedAIRequest {
    prompt: string;
    modelId: string;
    
    // Context
    systemMessage?: string;
    conversationHistory?: Array<{ role: string; content: string }>;
    
    // Parameters
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    topK?: number;
    stopSequences?: string[];
    
    // Capabilities
    streaming?: boolean;
    jsonMode?: boolean;
    functionCalling?: {
        functions: any[];
        functionCall?: 'auto' | 'none' | { name: string };
    };
    
    // Vision (if applicable)
    images?: Array<{
        url?: string;
        base64?: string;
        mimeType?: string;
    }>;
    
    // Metadata
    metadata?: Record<string, any>;
    traceId?: string;
    userId?: string;
}

/**
 * Unified AI Response
 */
export interface UnifiedAIResponse {
    text: string;
    
    // Usage
    usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
    };
    
    // Metadata
    modelId: string;
    provider: string;
    latencyMs: number;
    finishReason?: string;
    
    // Function calling
    functionCall?: {
        name: string;
        arguments: any;
    };
    
    // Additional data
    metadata?: Record<string, any>;
}

/**
 * Unified AI Stream Chunk
 */
export interface UnifiedAIStreamChunk {
    delta: string;
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
    };
    finishReason?: string;
    metadata?: Record<string, any>;
}

/**
 * Provider Adapter Interface
 */
export interface IProviderAdapter {
    readonly name: string;
    readonly providerType: AIProviderType;
    
    /**
     * Invoke model with unified request
     */
    invoke(request: UnifiedAIRequest): Promise<UnifiedAIResponse>;
    
    /**
     * Stream invoke model
     */
    streamInvoke(request: UnifiedAIRequest): AsyncIterable<UnifiedAIStreamChunk>;
    
    /**
     * Estimate tokens for text
     */
    estimateTokens(text: string): number;
    
    /**
     * Get supported models with their capabilities
     */
    getSupportedModels(): ModelCapabilityDefinition[];
    
    /**
     * Check if a specific model is supported
     */
    supportsModel(modelId: string): boolean;
    
    /**
     * Health check
     */
    healthCheck(): Promise<boolean>;
}

/**
 * Model Registry Statistics
 */
export interface ModelRegistryStats {
    totalModels: number;
    modelsByProvider: Record<string, number>;
    modelsByCapability: Record<ModelCapability, number>;
    averageCostPerMillion: number;
    averageLatencyMs: number;
}

