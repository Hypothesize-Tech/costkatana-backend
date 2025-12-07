/**
 * Model Registry Types
 * 
 * Types and interfaces for the centralized model registry system.
 */

import { AIProviderType } from './aiProvider.types';

/**
 * Model Status - Current availability status
 */
export type ModelStatus = 
    | 'active'      // Production-ready, generally available
    | 'beta'        // Beta/preview, may have limitations
    | 'deprecated'  // Deprecated, will be removed
    | 'inactive'    // Temporarily unavailable
    | 'eol';        // End of life, no longer available

/**
 * Model Capability - What the model can do
 */
export type ModelCapability =
    | 'chat'              // Chat/conversational
    | 'completion'        // Text completion
    | 'vision'            // Image understanding
    | 'json'              // JSON mode/structured output
    | 'tools'             // Function/tool calling
    | 'streaming'         // Streaming responses
    | 'reasoning'         // Advanced reasoning
    | 'long_context'      // Extended context window (>32k)
    | 'ultra_context'     // Ultra-long context (>100k)
    | 'code'              // Code generation/understanding
    | 'multimodal'        // Multiple input types
    | 'embeddings'        // Generate embeddings
    | 'fine_tunable';     // Supports fine-tuning

/**
 * Model Tier - Cost/performance tier
 */
export type ModelTier = 
    | 'economy'    // Lowest cost, basic capabilities
    | 'balanced'   // Good balance of cost/quality
    | 'premium'    // High quality, higher cost
    | 'flagship';  // Best available, highest cost

/**
 * Model Quality Scores - Subjective quality ratings
 */
export interface ModelQualityScores {
    /** Reasoning capability (0-100) */
    reasoning: number;
    
    /** Response speed perception (0-100) */
    speed: number;
    
    /** Reliability/consistency (0-100) */
    reliability: number;
    
    /** Code generation quality (0-100) */
    codeQuality?: number;
    
    /** Creative writing quality (0-100) */
    creativity?: number;
    
    /** Instruction following (0-100) */
    instructionFollowing?: number;
}

/**
 * Model Definition - Complete model metadata
 */
export interface ModelDefinition {
    /** Unique internal model identifier */
    id: string;
    
    /** Provider-native model name */
    name: string;
    
    /** Display name for UI */
    displayName: string;
    
    /** Provider */
    provider: AIProviderType;
    
    /** Model status */
    status: ModelStatus;
    
    /** Model tier */
    tier: ModelTier;
    
    /** Capabilities */
    capabilities: ModelCapability[];
    
    /** Context window size (tokens) */
    contextWindow: number;
    
    /** Maximum output tokens */
    maxOutputTokens: number;
    
    /** Default output tokens (recommended) */
    defaultOutputTokens?: number;
    
    /** Quality scores */
    quality: ModelQualityScores;
    
    /** Average latency (ms) - can be updated dynamically */
    averageLatencyMs?: number;
    
    /** Model aliases (alternative names) */
    aliases?: string[];
    
    /** Model family/group */
    family?: string;
    
    /** Model version */
    version?: string;
    
    /** Release date */
    releaseDate?: Date;
    
    /** Deprecation date (if deprecated) */
    deprecationDate?: Date;
    
    /** End of life date (if EOL) */
    eolDate?: Date;
    
    /** Regions where model is available */
    regions?: string[];
    
    /** Special notes or warnings */
    notes?: string;
    
    /** Metadata for extensibility */
    metadata?: Record<string, any>;
}

/**
 * Model Requirements - What a request needs from a model
 */
export interface ModelRequirements {
    /** Required capabilities */
    requiredCapabilities?: ModelCapability[];
    
    /** Optional/preferred capabilities */
    preferredCapabilities?: ModelCapability[];
    
    /** Minimum context window needed */
    minContextWindow?: number;
    
    /** Maximum acceptable cost per 1K tokens */
    maxCostPer1K?: number;
    
    /** Latency requirement */
    latencyRequirement?: 'low' | 'balanced' | 'flexible';
    
    /** Quality minimum (reasoning score) */
    minReasoningScore?: number;
    
    /** Required status (e.g., only 'active' models) */
    requiredStatus?: ModelStatus[];
    
    /** Preferred tier */
    preferredTier?: ModelTier;
    
    /** Specific provider requirement */
    requiredProvider?: AIProviderType;
    
    /** Specific region requirement */
    requiredRegion?: string;
    
    /** Exclude specific models */
    excludeModels?: string[];
}

/**
 * Model Match Result - How well a model matches requirements
 */
export interface ModelMatchResult {
    /** The model definition */
    model: ModelDefinition;
    
    /** Match score (0-100) */
    score: number;
    
    /** Whether model meets minimum requirements */
    meetsRequirements: boolean;
    
    /** Estimated cost per 1K tokens */
    estimatedCostPer1K: number;
    
    /** Reasoning for the score */
    reasoning: string[];
    
    /** Warnings or considerations */
    warnings?: string[];
}

/**
 * Model Filter Options
 */
export interface ModelFilterOptions {
    /** Filter by provider */
    provider?: AIProviderType;
    
    /** Filter by status */
    status?: ModelStatus | ModelStatus[];
    
    /** Filter by tier */
    tier?: ModelTier | ModelTier[];
    
    /** Filter by capabilities (must have all) */
    hasCapabilities?: ModelCapability[];
    
    /** Filter by any capability (must have at least one) */
    hasAnyCapability?: ModelCapability[];
    
    /** Minimum context window */
    minContextWindow?: number;
    
    /** Model family */
    family?: string;
    
    /** Search by name (partial match) */
    nameSearch?: string;
}

/**
 * Model Registry Stats
 */
export interface ModelRegistryStats {
    /** Total models in registry */
    totalModels: number;
    
    /** Active models */
    activeModels: number;
    
    /** Models by provider */
    byProvider: Record<AIProviderType, number>;
    
    /** Models by tier */
    byTier: Record<ModelTier, number>;
    
    /** Models by status */
    byStatus: Record<ModelStatus, number>;
    
    /** Last updated */
    lastUpdated: Date;
}

