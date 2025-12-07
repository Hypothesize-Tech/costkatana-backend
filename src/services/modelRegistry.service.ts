/**
 * Model Registry Service
 * 
 * Centralized registry for all model metadata, capabilities, and availability.
 * Single source of truth for model information across the platform.
 */

import {
    ModelDefinition,
    ModelRequirements,
    ModelMatchResult,
    ModelFilterOptions,
    ModelRegistryStats,
    ModelStatus,
    ModelCapability,
    ModelTier,
    ModelQualityScores
} from '../types/modelRegistry.types';
import { AIProviderType } from '../types/aiProvider.types';
import { loggingService } from './logging.service';
import { OPENAI_PRICING } from '../utils/pricing/openai';
import { ANTHROPIC_PRICING } from '../utils/pricing/anthropic';
import { AWS_BEDROCK_PRICING } from '../utils/pricing/aws-bedrock';
import { GOOGLE_PRICING } from '../utils/pricing/google';
import { COHERE_PRICING } from '../utils/pricing/cohere';
import { MISTRAL_PRICING } from '../utils/pricing/mistral';
import type { ModelPricing as UtilModelPricing } from '../utils/pricing/types';

export class ModelRegistryService {
    private static instance: ModelRegistryService;
    private models: Map<string, ModelDefinition> = new Map();
    private modelsByProvider: Map<AIProviderType, ModelDefinition[]> = new Map();
    private lastUpdated: Date = new Date();

    private constructor() {
        this.initializeModels();
        this.buildIndices();
    }

    static getInstance(): ModelRegistryService {
        if (!ModelRegistryService.instance) {
            ModelRegistryService.instance = new ModelRegistryService();
        }
        return ModelRegistryService.instance;
    }

    /**
     * Initialize model registry with all supported models
     * Combines hand-curated models with data from pricing utilities
     */
    private initializeModels(): void {
        loggingService.info('Initializing model registry with pricing utility data');

        // Hand-curated models with complete metadata
        const curatedModels: ModelDefinition[] = [
            // === OpenAI Models ===
            {
                id: 'openai:gpt-4o',
                name: 'gpt-4o',
                displayName: 'GPT-4o',
                provider: AIProviderType.OpenAI,
                status: 'active',
                tier: 'premium',
                capabilities: ['chat', 'vision', 'json', 'tools', 'streaming', 'multimodal', 'code'],
                contextWindow: 128000,
                maxOutputTokens: 16384,
                defaultOutputTokens: 4096,
                quality: {
                    reasoning: 95,
                    speed: 85,
                    reliability: 95,
                    codeQuality: 95,
                    creativity: 90,
                    instructionFollowing: 95
                },
                averageLatencyMs: 2000,
                family: 'gpt-4',
                aliases: ['gpt-4o-2024-08-06']
            },
            {
                id: 'openai:gpt-4o-mini',
                name: 'gpt-4o-mini',
                displayName: 'GPT-4o Mini',
                provider: AIProviderType.OpenAI,
                status: 'active',
                tier: 'balanced',
                capabilities: ['chat', 'vision', 'json', 'tools', 'streaming', 'multimodal', 'code'],
                contextWindow: 128000,
                maxOutputTokens: 16384,
                defaultOutputTokens: 4096,
                quality: {
                    reasoning: 85,
                    speed: 95,
                    reliability: 90,
                    codeQuality: 85,
                    creativity: 80,
                    instructionFollowing: 90
                },
                averageLatencyMs: 1200,
                family: 'gpt-4',
                aliases: ['gpt-4o-mini-2024-07-18']
            },
            {
                id: 'openai:o1',
                name: 'o1',
                displayName: 'o1',
                provider: AIProviderType.OpenAI,
                status: 'active',
                tier: 'flagship',
                capabilities: ['chat', 'reasoning', 'streaming', 'code'],
                contextWindow: 200000,
                maxOutputTokens: 100000,
                defaultOutputTokens: 8192,
                quality: {
                    reasoning: 98,
                    speed: 60,
                    reliability: 95,
                    codeQuality: 98,
                    creativity: 85,
                    instructionFollowing: 97
                },
                averageLatencyMs: 15000,
                family: 'o1',
                notes: 'Extended reasoning, slower but highest quality'
            },
            {
                id: 'openai:o1-mini',
                name: 'o1-mini',
                displayName: 'o1 Mini',
                provider: AIProviderType.OpenAI,
                status: 'active',
                tier: 'premium',
                capabilities: ['chat', 'reasoning', 'streaming', 'code'],
                contextWindow: 128000,
                maxOutputTokens: 65536,
                defaultOutputTokens: 8192,
                quality: {
                    reasoning: 92,
                    speed: 75,
                    reliability: 92,
                    codeQuality: 92,
                    creativity: 80,
                    instructionFollowing: 92
                },
                averageLatencyMs: 8000,
                family: 'o1',
                notes: 'Fast reasoning model'
            },
            {
                id: 'openai:gpt-3.5-turbo',
                name: 'gpt-3.5-turbo',
                displayName: 'GPT-3.5 Turbo',
                provider: AIProviderType.OpenAI,
                status: 'active',
                tier: 'economy',
                capabilities: ['chat', 'json', 'tools', 'streaming', 'code'],
                contextWindow: 16385,
                maxOutputTokens: 4096,
                defaultOutputTokens: 2048,
                quality: {
                    reasoning: 70,
                    speed: 98,
                    reliability: 90,
                    codeQuality: 75,
                    creativity: 70,
                    instructionFollowing: 80
                },
                averageLatencyMs: 800,
                family: 'gpt-3.5'
            },

            // === Google Models ===
            {
                id: 'google:gemini-2.0-flash',
                name: 'gemini-2.0-flash',
                displayName: 'Gemini 2.0 Flash',
                provider: AIProviderType.Google,
                status: 'active',
                tier: 'balanced',
                capabilities: ['chat', 'vision', 'json', 'tools', 'streaming', 'multimodal', 'code', 'long_context'],
                contextWindow: 1000000,
                maxOutputTokens: 8192,
                defaultOutputTokens: 4096,
                quality: {
                    reasoning: 88,
                    speed: 95,
                    reliability: 90,
                    codeQuality: 87,
                    creativity: 85,
                    instructionFollowing: 90
                },
                averageLatencyMs: 1500,
                family: 'gemini-2',
                aliases: ['gemini-2-flash']
            },
            {
                id: 'google:gemini-1.5-pro',
                name: 'gemini-1.5-pro',
                displayName: 'Gemini 1.5 Pro',
                provider: AIProviderType.Google,
                status: 'active',
                tier: 'premium',
                capabilities: ['chat', 'vision', 'json', 'tools', 'streaming', 'multimodal', 'code', 'ultra_context'],
                contextWindow: 2000000,
                maxOutputTokens: 8192,
                defaultOutputTokens: 4096,
                quality: {
                    reasoning: 92,
                    speed: 80,
                    reliability: 92,
                    codeQuality: 90,
                    creativity: 88,
                    instructionFollowing: 92
                },
                averageLatencyMs: 2500,
                family: 'gemini-1.5',
                aliases: ['gemini-pro']
            },
            {
                id: 'google:gemini-1.5-flash',
                name: 'gemini-1.5-flash',
                displayName: 'Gemini 1.5 Flash',
                provider: AIProviderType.Google,
                status: 'active',
                tier: 'balanced',
                capabilities: ['chat', 'vision', 'json', 'tools', 'streaming', 'multimodal', 'code', 'ultra_context'],
                contextWindow: 1000000,
                maxOutputTokens: 8192,
                defaultOutputTokens: 4096,
                quality: {
                    reasoning: 85,
                    speed: 95,
                    reliability: 90,
                    codeQuality: 85,
                    creativity: 82,
                    instructionFollowing: 88
                },
                averageLatencyMs: 1200,
                family: 'gemini-1.5',
                aliases: ['gemini-flash']
            },

            // === AWS Bedrock - Claude Models ===
            {
                id: 'bedrock:claude-3-5-sonnet-v2',
                name: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
                displayName: 'Claude 3.5 Sonnet v2',
                provider: AIProviderType.Bedrock,
                status: 'active',
                tier: 'premium',
                capabilities: ['chat', 'vision', 'json', 'tools', 'streaming', 'multimodal', 'code', 'long_context'],
                contextWindow: 200000,
                maxOutputTokens: 8192,
                defaultOutputTokens: 4096,
                quality: {
                    reasoning: 94,
                    speed: 85,
                    reliability: 95,
                    codeQuality: 95,
                    creativity: 92,
                    instructionFollowing: 95
                },
                averageLatencyMs: 2200,
                family: 'claude-3.5',
                aliases: ['claude-3-5-sonnet', 'claude-3.5-sonnet']
            },
            {
                id: 'bedrock:claude-3-5-haiku',
                name: 'anthropic.claude-3-5-haiku-20241022-v1:0',
                displayName: 'Claude 3.5 Haiku',
                provider: AIProviderType.Bedrock,
                status: 'active',
                tier: 'balanced',
                capabilities: ['chat', 'vision', 'json', 'tools', 'streaming', 'multimodal', 'code'],
                contextWindow: 200000,
                maxOutputTokens: 8192,
                defaultOutputTokens: 4096,
                quality: {
                    reasoning: 85,
                    speed: 98,
                    reliability: 92,
                    codeQuality: 87,
                    creativity: 82,
                    instructionFollowing: 90
                },
                averageLatencyMs: 900,
                family: 'claude-3.5',
                aliases: ['claude-3-5-haiku', 'claude-3.5-haiku']
            },
            {
                id: 'bedrock:claude-opus-4',
                name: 'us.anthropic.claude-opus-4-20250514-v1:0',
                displayName: 'Claude Opus 4',
                provider: AIProviderType.Bedrock,
                status: 'active',
                tier: 'flagship',
                capabilities: ['chat', 'vision', 'json', 'tools', 'streaming', 'reasoning', 'multimodal', 'code', 'long_context'],
                contextWindow: 200000,
                maxOutputTokens: 16384,
                defaultOutputTokens: 8192,
                quality: {
                    reasoning: 98,
                    speed: 70,
                    reliability: 97,
                    codeQuality: 97,
                    creativity: 95,
                    instructionFollowing: 98
                },
                averageLatencyMs: 3500,
                family: 'claude-4',
                aliases: ['claude-4-opus', 'claude-opus-4']
            },

            // === AWS Bedrock - Nova Models ===
            {
                id: 'bedrock:nova-pro',
                name: 'us.amazon.nova-pro-v1:0',
                displayName: 'Amazon Nova Pro',
                provider: AIProviderType.Bedrock,
                status: 'active',
                tier: 'premium',
                capabilities: ['chat', 'vision', 'json', 'tools', 'streaming', 'multimodal', 'code'],
                contextWindow: 300000,
                maxOutputTokens: 5000,
                defaultOutputTokens: 4096,
                quality: {
                    reasoning: 90,
                    speed: 85,
                    reliability: 90,
                    codeQuality: 88,
                    creativity: 85,
                    instructionFollowing: 90
                },
                averageLatencyMs: 2000,
                family: 'nova'
            },
            {
                id: 'bedrock:nova-lite',
                name: 'us.amazon.nova-lite-v1:0',
                displayName: 'Amazon Nova Lite',
                provider: AIProviderType.Bedrock,
                status: 'active',
                tier: 'economy',
                capabilities: ['chat', 'vision', 'json', 'tools', 'streaming', 'multimodal'],
                contextWindow: 300000,
                maxOutputTokens: 5000,
                defaultOutputTokens: 2048,
                quality: {
                    reasoning: 75,
                    speed: 95,
                    reliability: 88,
                    codeQuality: 72,
                    creativity: 70,
                    instructionFollowing: 80
                },
                averageLatencyMs: 1000,
                family: 'nova'
            },
            {
                id: 'bedrock:nova-micro',
                name: 'us.amazon.nova-micro-v1:0',
                displayName: 'Amazon Nova Micro',
                provider: AIProviderType.Bedrock,
                status: 'active',
                tier: 'economy',
                capabilities: ['chat', 'json', 'streaming'],
                contextWindow: 128000,
                maxOutputTokens: 5000,
                defaultOutputTokens: 2048,
                quality: {
                    reasoning: 65,
                    speed: 98,
                    reliability: 85,
                    codeQuality: 65,
                    creativity: 60,
                    instructionFollowing: 75
                },
                averageLatencyMs: 600,
                family: 'nova'
            }
        ];

        // Auto-generate models from pricing utilities
        const autoGeneratedModels = this.generateModelsFromPricing([
            ...OPENAI_PRICING,
            ...ANTHROPIC_PRICING,
            ...AWS_BEDROCK_PRICING,
            ...GOOGLE_PRICING,
            ...COHERE_PRICING,
            ...MISTRAL_PRICING
        ]);

        // Merge curated and auto-generated (curated takes precedence)
        const curatedIds = new Set(curatedModels.map(m => m.id));
        const allModels = [
            ...curatedModels,
            ...autoGeneratedModels.filter(m => !curatedIds.has(m.id))
        ];

        // Add models to registry
        allModels.forEach(model => {
            this.models.set(model.id, model);
            
            // Also register by name and aliases
            this.models.set(`${model.provider}:${model.name}`, model);
            if (model.aliases) {
                model.aliases.forEach(alias => {
                    this.models.set(`${model.provider}:${alias}`, model);
                });
            }
        });

        loggingService.info('Model registry initialized', {
            totalModels: allModels.length,
            curatedModels: curatedModels.length,
            autoGenerated: autoGeneratedModels.length,
            providers: [...new Set(allModels.map(m => m.provider))]
        });
    }

    /**
     * Generate model definitions from pricing data
     */
    private generateModelsFromPricing(pricingData: UtilModelPricing[]): ModelDefinition[] {
        return pricingData.map((pricing: UtilModelPricing) => {
            const provider = this.normalizeProviderForModel(pricing.provider);
            const modelId = `${provider}:${pricing.modelId}`;
            
            return {
                id: modelId,
                name: pricing.modelId,
                displayName: pricing.modelName || pricing.modelId,
                provider: this.mapToProviderType(provider),
                status: pricing.isLatest ? 'active' as ModelStatus : 'beta' as ModelStatus,
                tier: this.inferTier(pricing),
                capabilities: this.inferCapabilities(pricing.capabilities || []),
                contextWindow: pricing.contextWindow || 8192,
                maxOutputTokens: Math.floor((pricing.contextWindow || 8192) * 0.5),
                defaultOutputTokens: 2048,
                quality: this.inferQuality(pricing),
                averageLatencyMs: this.estimateLatency(pricing),
                family: this.inferFamily(pricing.modelId),
                notes: pricing.notes
            };
        });
    }

    /**
     * Normalize provider name
     */
    private normalizeProviderForModel(provider: string): string {
        const normalized = provider.toLowerCase().trim();
        
        if (normalized.includes('openai')) return 'openai';
        if (normalized.includes('anthropic')) return 'anthropic';
        if (normalized.includes('google')) return 'google';
        if (normalized.includes('bedrock') || normalized.includes('aws')) return 'bedrock';
        if (normalized.includes('cohere')) return 'cohere';
        if (normalized.includes('mistral')) return 'mistral';
        
        return 'bedrock'; // Default to bedrock for AWS models
    }

    /**
     * Map provider string to AIProviderType
     */
    private mapToProviderType(provider: string): AIProviderType {
        switch (provider) {
            case 'openai':
                return AIProviderType.OpenAI;
            case 'google':
                return AIProviderType.Google;
            case 'anthropic':
            case 'bedrock':
            default:
                return AIProviderType.Bedrock;
        }
    }

    /**
     * Infer tier from pricing
     */
    private inferTier(pricing: UtilModelPricing): ModelTier {
        const modelName = (pricing.modelName ?? pricing.modelId).toLowerCase();
        
        if (modelName.includes('nano') || modelName.includes('micro')) return 'economy';
        if (modelName.includes('mini') || modelName.includes('lite') || modelName.includes('flash-lite')) return 'economy';
        if (modelName.includes('flash') || modelName.includes('haiku')) return 'balanced';
        if (modelName.includes('pro') || modelName.includes('sonnet')) return 'premium';
        if (modelName.includes('opus') || modelName.includes('o1') || modelName.includes('gpt-5')) return 'flagship';
        
        return 'balanced';
    }

    /**
     * Infer capabilities from pricing metadata
     */
    private inferCapabilities(capabilityStrings: string[]): ModelCapability[] {
        const capabilities: ModelCapability[] = ['chat']; // All models support chat
        
        capabilityStrings.forEach(cap => {
            const capLower = cap.toLowerCase();
            
            if (capLower.includes('vision') || capLower.includes('image')) capabilities.push('vision');
            if (capLower.includes('multimodal')) capabilities.push('multimodal');
            if (capLower.includes('reasoning') || capLower.includes('thinking')) capabilities.push('reasoning');
            if (capLower.includes('code') || capLower.includes('coding')) capabilities.push('code');
            if (capLower.includes('long-context')) capabilities.push('long_context');
        });
        
        // Common capabilities for modern models
        capabilities.push('json', 'streaming');
        
        return [...new Set(capabilities)];
    }

    /**
     * Infer quality scores
     */
    private inferQuality(pricing: UtilModelPricing): ModelQualityScores {
        const modelName = (pricing.modelName ?? pricing.modelId).toLowerCase();
        
        // Base scores
        let reasoning = 75;
        let speed = 75;
        let reliability = 85;
        
        // Adjust based on model tier
        if (modelName.includes('opus') || modelName.includes('o1')) {
            reasoning = 98;
            speed = 60;
            reliability = 97;
        } else if (modelName.includes('pro') || modelName.includes('sonnet')) {
            reasoning = 92;
            speed = 80;
            reliability = 92;
        } else if (modelName.includes('flash') || modelName.includes('haiku')) {
            reasoning = 85;
            speed = 95;
            reliability = 90;
        } else if (modelName.includes('mini') || modelName.includes('lite')) {
            reasoning = 80;
            speed = 95;
            reliability = 88;
        } else if (modelName.includes('nano') || modelName.includes('micro')) {
            reasoning = 65;
            speed = 98;
            reliability = 85;
        }
        
        return {
            reasoning,
            speed,
            reliability,
            codeQuality: reasoning - 3,
            creativity: reasoning - 5,
            instructionFollowing: reliability
        };
    }

    /**
     * Estimate latency based on model characteristics
     */
    private estimateLatency(pricing: UtilModelPricing): number {
        const modelName = (pricing.modelName ?? pricing.modelId).toLowerCase();
        
        if (modelName.includes('nano') || modelName.includes('micro')) return 600;
        if (modelName.includes('mini') || modelName.includes('lite') || modelName.includes('flash-lite')) return 800;
        if (modelName.includes('3.5-turbo') || modelName.includes('haiku')) return 900;
        if (modelName.includes('flash')) return 1200;
        if (modelName.includes('4o-mini')) return 1200;
        if (modelName.includes('4o') || modelName.includes('sonnet')) return 2000;
        if (modelName.includes('pro')) return 2500;
        if (modelName.includes('o1-mini')) return 8000;
        if (modelName.includes('o1') || modelName.includes('opus')) return 15000;
        
        return 2000; // Default
    }

    /**
     * Infer model family
     */
    private inferFamily(modelId: string): string | undefined {
        const idLower = modelId.toLowerCase();
        
        if (idLower.includes('gpt-5')) return 'gpt-5';
        if (idLower.includes('gpt-4')) return 'gpt-4';
        if (idLower.includes('gpt-3')) return 'gpt-3.5';
        if (idLower.includes('o1')) return 'o1';
        if (idLower.includes('gemini-2')) return 'gemini-2';
        if (idLower.includes('gemini-1.5')) return 'gemini-1.5';
        if (idLower.includes('claude-4')) return 'claude-4';
        if (idLower.includes('claude-3.5')) return 'claude-3.5';
        if (idLower.includes('claude-3')) return 'claude-3';
        if (idLower.includes('nova')) return 'nova';
        
        return undefined;
    }

    /**
     * Build lookup indices for fast queries
     */
    private buildIndices(): void {
        this.modelsByProvider.clear();

        this.models.forEach(model => {
            if (!this.modelsByProvider.has(model.provider)) {
                this.modelsByProvider.set(model.provider, []);
            }
            // Only add if it's the primary ID (not alias)
            if (model.id.includes(':') && this.models.get(model.id) === model) {
                this.modelsByProvider.get(model.provider)!.push(model);
            }
        });
    }

    /**
     * Get model by ID, name, or alias
     */
    getModel(identifier: string): ModelDefinition | null {
        // Try direct lookup
        let model = this.models.get(identifier);
        if (model) return model;

        // Try with provider prefix detection
        const detectedProvider = this.detectProviderFromModel(identifier);
        if (detectedProvider) {
            model = this.models.get(`${detectedProvider}:${identifier}`);
            if (model) return model;
        }

        // Search through all models for partial matches
        for (const [, modelDef] of this.models) {
            if (
                modelDef.name === identifier ||
                modelDef.name.toLowerCase() === identifier.toLowerCase() ||
                modelDef.aliases?.includes(identifier)
            ) {
                return modelDef;
            }
        }

        loggingService.warn('Model not found in registry', { identifier });
        return null;
    }

    /**
     * Detect provider from model name
     */
    private detectProviderFromModel(model: string): AIProviderType | null {
        const modelLower = model.toLowerCase();

        if (modelLower.includes('gpt') || modelLower.includes('o1-')) {
            return AIProviderType.OpenAI;
        }
        if (modelLower.includes('gemini')) {
            return AIProviderType.Google;
        }
        if (
            modelLower.includes('claude') ||
            modelLower.includes('nova') ||
            modelLower.includes('anthropic.')
        ) {
            return AIProviderType.Bedrock;
        }

        return null;
    }

    /**
     * Get all models matching filter criteria
     */
    getModels(filter?: ModelFilterOptions): ModelDefinition[] {
        let results: ModelDefinition[] = [];

        // Get base set
        if (filter?.provider) {
            results = this.modelsByProvider.get(filter.provider) || [];
        } else {
            // Get all unique models (primary IDs only)
            results = Array.from(this.models.values())
                .filter(model => model.id.includes(':'));
        }

        // Apply filters
        if (filter?.status) {
            const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
            results = results.filter(m => statuses.includes(m.status));
        }

        if (filter?.tier) {
            const tiers = Array.isArray(filter.tier) ? filter.tier : [filter.tier];
            results = results.filter(m => tiers.includes(m.tier));
        }

        if (filter?.hasCapabilities) {
            results = results.filter(m =>
                filter.hasCapabilities!.every(cap => m.capabilities.includes(cap))
            );
        }

        if (filter?.hasAnyCapability) {
            results = results.filter(m =>
                filter.hasAnyCapability!.some(cap => m.capabilities.includes(cap))
            );
        }

        if (filter?.minContextWindow) {
            results = results.filter(m => m.contextWindow >= filter.minContextWindow!);
        }

        if (filter?.family) {
            results = results.filter(m => m.family === filter.family);
        }

        if (filter?.nameSearch) {
            const search = filter.nameSearch.toLowerCase();
            results = results.filter(m =>
                m.name.toLowerCase().includes(search) ||
                m.displayName.toLowerCase().includes(search)
            );
        }

        return results;
    }

    /**
     * Find best models matching requirements
     */
    async findMatchingModels(
        requirements: ModelRequirements,
        limit: number = 10
    ): Promise<ModelMatchResult[]> {
        // Get candidate models
        const candidates = this.getModels({
            provider: requirements.requiredProvider,
            status: requirements.requiredStatus || ['active', 'beta'],
            hasCapabilities: requirements.requiredCapabilities,
            minContextWindow: requirements.minContextWindow
        });

        // Score each candidate
        const results: ModelMatchResult[] = [];
        
        for (const model of candidates) {
            // Skip excluded models
            if (requirements.excludeModels?.includes(model.id)) {
                continue;
            }

            const matchResult = this.scoreModel(model, requirements);
            if (matchResult.meetsRequirements) {
                results.push(matchResult);
            }
        }

        // Sort by score (descending)
        results.sort((a, b) => b.score - a.score);

        return results.slice(0, limit);
    }

    /**
     * Score a model against requirements
     */
    private scoreModel(
        model: ModelDefinition,
        requirements: ModelRequirements
    ): ModelMatchResult {
        let score = 100;
        const reasoning: string[] = [];
        const warnings: string[] = [];
        let meetsRequirements = true;

        // Get estimated cost (will be provided by pricing registry in integration)
        const estimatedCostPer1K = 0.001; // Placeholder

        // Check required capabilities
        if (requirements.requiredCapabilities) {
            const hasAll = requirements.requiredCapabilities.every(cap =>
                model.capabilities.includes(cap)
            );
            if (!hasAll) {
                meetsRequirements = false;
                reasoning.push('Missing required capabilities');
            } else {
                reasoning.push('Has all required capabilities');
            }
        }

        // Check preferred capabilities
        if (requirements.preferredCapabilities) {
            const preferredCount = requirements.preferredCapabilities.filter(cap =>
                model.capabilities.includes(cap)
            ).length;
            const preferredBonus = (preferredCount / requirements.preferredCapabilities.length) * 10;
            score += preferredBonus;
            reasoning.push(`Has ${preferredCount}/${requirements.preferredCapabilities.length} preferred capabilities (+${preferredBonus.toFixed(1)})`);
        }

        // Check context window
        if (requirements.minContextWindow && model.contextWindow < requirements.minContextWindow) {
            meetsRequirements = false;
            reasoning.push(`Context window too small: ${model.contextWindow} < ${requirements.minContextWindow}`);
        }

        // Check cost constraint
        if (requirements.maxCostPer1K && estimatedCostPer1K > requirements.maxCostPer1K) {
            score -= 20;
            warnings.push(`Cost exceeds limit: $${estimatedCostPer1K} > $${requirements.maxCostPer1K}`);
        }

        // Check latency requirement
        if (requirements.latencyRequirement && model.averageLatencyMs) {
            const latencyScore = this.scoreLatency(model.averageLatencyMs, requirements.latencyRequirement);
            score += latencyScore - 50; // Normalize around 0
            reasoning.push(`Latency score: ${latencyScore.toFixed(1)}`);
        }

        // Check reasoning score
        if (requirements.minReasoningScore && model.quality.reasoning < requirements.minReasoningScore) {
            meetsRequirements = false;
            reasoning.push(`Reasoning score too low: ${model.quality.reasoning} < ${requirements.minReasoningScore}`);
        }

        // Check tier preference
        if (requirements.preferredTier) {
            if (model.tier === requirements.preferredTier) {
                score += 10;
                reasoning.push(`Matches preferred tier: ${model.tier}`);
            }
        }

        // Bonus for active status
        if (model.status === 'active') {
            score += 5;
        } else if (model.status === 'deprecated') {
            score -= 10;
            warnings.push('Model is deprecated');
        }

        // Cap score at 100
        score = Math.min(100, Math.max(0, score));

        return {
            model,
            score,
            meetsRequirements,
            estimatedCostPer1K,
            reasoning,
            warnings: warnings.length > 0 ? warnings : undefined
        };
    }

    /**
     * Score latency against requirement
     */
    private scoreLatency(latencyMs: number, requirement: 'low' | 'balanced' | 'flexible'): number {
        const thresholds = {
            low: { ideal: 1000, acceptable: 2000 },
            balanced: { ideal: 2000, acceptable: 5000 },
            flexible: { ideal: 5000, acceptable: 15000 }
        };

        const { ideal, acceptable } = thresholds[requirement];

        if (latencyMs <= ideal) {
            return 100;
        } else if (latencyMs <= acceptable) {
            return 100 - ((latencyMs - ideal) / (acceptable - ideal)) * 50;
        } else {
            return Math.max(0, 50 - ((latencyMs - acceptable) / acceptable) * 50);
        }
    }

    /**
     * Get registry statistics
     */
    getStats(): ModelRegistryStats {
        const allModels = Array.from(this.models.values())
            .filter(m => m.id.includes(':')); // Primary IDs only

        const byProvider: Record<AIProviderType, number> = {
            [AIProviderType.OpenAI]: 0,
            [AIProviderType.Google]: 0,
            [AIProviderType.Bedrock]: 0,
            [AIProviderType.Anthropic]: 0
        };

        const byTier: Record<ModelTier, number> = {
            economy: 0,
            balanced: 0,
            premium: 0,
            flagship: 0
        };

        const byStatus: Record<ModelStatus, number> = {
            active: 0,
            beta: 0,
            deprecated: 0,
            inactive: 0,
            eol: 0
        };

        allModels.forEach(model => {
            byProvider[model.provider]++;
            byTier[model.tier]++;
            byStatus[model.status]++;
        });

        return {
            totalModels: allModels.length,
            activeModels: byStatus.active,
            byProvider,
            byTier,
            byStatus,
            lastUpdated: this.lastUpdated
        };
    }

    /**
     * Update model latency from telemetry
     */
    updateModelLatency(modelId: string, latencyMs: number): void {
        const model = this.getModel(modelId);
        if (model) {
            // Exponential moving average
            const alpha = 0.2;
            model.averageLatencyMs = model.averageLatencyMs
                ? model.averageLatencyMs * (1 - alpha) + latencyMs * alpha
                : latencyMs;
        }
    }

    /**
     * Check if model supports capability
     */
    hasCapability(modelId: string, capability: ModelCapability): boolean {
        const model = this.getModel(modelId);
        return model ? model.capabilities.includes(capability) : false;
    }

    /**
     * Get models by provider
     */
    getModelsByProvider(provider: AIProviderType): ModelDefinition[] {
        return this.modelsByProvider.get(provider) || [];
    }
}

