/**
 * Model Capability Registry Service
 * 
 * Single source of truth for model capabilities, provider resolution, and intelligent model selection.
 * Enables provider-agnostic routing by abstracting away provider-specific implementation details.
 * 
 * Key Features:
 * - Capability-based model discovery
 * - Strategic model selection (cost, speed, quality, balanced)
 * - Provider adapter resolution
 * - Dynamic model registration
 * - Performance tracking and optimization recommendations
 */

import {
    ModelCapability,
    ModelCapabilityDefinition,
    ModelSelectionRequest,
    ModelSelectionResult,
    ModelSelectionStrategy,
    ModelSelectionConstraints,
    IProviderAdapter,
    ModelRegistryStats
} from '../types/modelCapability.types';
import { AIProviderType } from '../types/aiProvider.types';
import { loggingService } from './logging.service';
import { PricingRegistryService } from './pricingRegistry.service';
import { EventEmitter } from 'events';

export class ModelCapabilityRegistry extends EventEmitter {
    private static instance: ModelCapabilityRegistry;
    
    // Core registries
    private models: Map<string, ModelCapabilityDefinition> = new Map();
    private providerAdapters: Map<AIProviderType, IProviderAdapter> = new Map();
    private modelToProvider: Map<string, AIProviderType> = new Map();
    
    // Performance tracking
    private modelPerformanceHistory: Map<string, {
        latencies: number[];
        successCount: number;
        failureCount: number;
        lastUpdated: Date;
    }> = new Map();
    
    // Caching for fast lookups
    private capabilityIndex: Map<ModelCapability, Set<string>> = new Map();
    private providerIndex: Map<string, Set<string>> = new Map();
    
    private constructor() {
        super();
        this.initializeDefaultModels();
    }
    
    static getInstance(): ModelCapabilityRegistry {
        if (!ModelCapabilityRegistry.instance) {
            ModelCapabilityRegistry.instance = new ModelCapabilityRegistry();
        }
        return ModelCapabilityRegistry.instance;
    }
    
    /**
     * Initialize default model definitions from pricing registry
     */
    private initializeDefaultModels(): void {
        loggingService.info('Initializing Model Capability Registry from pricing data');
        
        // Get pricing registry instance
        const pricingRegistry = PricingRegistryService.getInstance();
        const allPricing = pricingRegistry.getAllPricing();
        
        loggingService.info(`Loading ${allPricing.length} models from pricing registry`);
        
        // Convert pricing data to model capability definitions
        for (const pricing of allPricing) {
            try {
                // Extract model ID (remove provider prefix if present)
                const modelId = pricing.modelId.includes(':') 
                    ? pricing.modelId.split(':')[1] 
                    : pricing.modelId;
                
                // Map provider type
                const providerType = this.mapProviderType(pricing.provider);
                const providerName = this.getProviderName(providerType);
                
                // Infer capabilities from model name and notes
                const capabilities = this.inferCapabilities(modelId, pricing.notes ?? '');
                
                // Estimate context window from model family
                const contextWindow = this.estimateContextWindow(modelId);
                
                // Estimate performance metrics
                const performance = this.estimatePerformance(modelId);
                
                // Create display name
                const displayName = this.createDisplayName(modelId);
                
                // Register the model
                this.registerModel({
                    modelId,
                    provider: providerName,
                    providerType,
                    displayName,
                    description: pricing.notes ?? `${displayName} model`,
                    capabilities,
                    contextWindow,
                    maxOutputTokens: this.estimateMaxOutputTokens(modelId),
                    pricing: {
                        inputPricePerMillion: pricing.inputPricePerK * 1000,
                        outputPricePerMillion: pricing.outputPricePerK * 1000,
                        currency: pricing.currency,
                        lastUpdated: pricing.lastUpdated
                    },
                    performance,
                    metadata: {
                        source: pricing.source,
                        originalUnit: pricing.originalUnit
                    },
                    isAvailable: true,
                    isExperimental: this.isExperimental(modelId, pricing.notes ?? '')
                });
            } catch (error) {
                loggingService.warn('Failed to register model from pricing', {
                    modelId: pricing.modelId,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
        
        // Build indexes
        this.rebuildIndexes();
        
        loggingService.info(`Initialized ${this.models.size} models across ${this.providerIndex.size} providers`);
    }
    
    /**
     * Map provider type to string name
     */
    private getProviderName(providerType: AIProviderType): string {
        switch (providerType) {
            case AIProviderType.OpenAI:
                return 'openai';
            case AIProviderType.Google:
                return 'google';
            case AIProviderType.Bedrock:
                return 'aws-bedrock';
            case AIProviderType.Anthropic:
                return 'anthropic';
            default:
                return 'unknown';
        }
    }
    
    /**
     * Map provider enum to AIProviderType
     */
    private mapProviderType(provider: AIProviderType): AIProviderType {
        return provider;
    }
    
    /**
     * Infer model capabilities from model name and notes
     */
    private inferCapabilities(modelId: string, notes: string): Set<ModelCapability> {
        const capabilities = new Set<ModelCapability>();
        const lowerModel = modelId.toLowerCase();
        const lowerNotes = notes.toLowerCase();
        
        // Text capability (default for most models)
        if (!lowerModel.includes('embed') && !lowerModel.includes('moderation')) {
            capabilities.add(ModelCapability.TEXT);
        }
        
        // Vision/Multimodal
        if (lowerModel.includes('vision') || lowerModel.includes('pixtral') || 
            lowerModel.includes('4o') || lowerModel.includes('gemini') ||
            lowerNotes.includes('vision') || lowerNotes.includes('multimodal') ||
            lowerNotes.includes('image')) {
            capabilities.add(ModelCapability.VISION);
            capabilities.add(ModelCapability.MULTIMODAL);
        }
        
        // Audio
        if (lowerModel.includes('audio') || lowerModel.includes('whisper') ||
            lowerModel.includes('tts') || lowerModel.includes('voxtral') ||
            lowerNotes.includes('audio') || lowerNotes.includes('speech')) {
            capabilities.add(ModelCapability.AUDIO);
        }
        
        // Streaming (most modern models support streaming)
        if (!lowerModel.includes('embed') && !lowerModel.includes('moderation') &&
            !lowerModel.includes('dall-e') && !lowerModel.includes('sora')) {
            capabilities.add(ModelCapability.STREAMING);
        }
        
        // JSON mode (GPT-4, Claude, Gemini typically support this)
        if (lowerModel.includes('gpt-4') || lowerModel.includes('claude') ||
            lowerModel.includes('gemini') || lowerNotes.includes('json')) {
            capabilities.add(ModelCapability.JSON_MODE);
        }
        
        // Function calling
        if ((lowerModel.includes('gpt') && !lowerModel.includes('gpt-3.5')) ||
            lowerModel.includes('claude') || lowerModel.includes('gemini') ||
            lowerNotes.includes('function') || lowerNotes.includes('tool')) {
            capabilities.add(ModelCapability.FUNCTION_CALLING);
        }
        
        // Code/reasoning models use CODE_EXECUTION capability
        if (lowerModel.includes('code') || lowerModel.includes('devstral') ||
            lowerModel.includes('codex') || lowerNotes.includes('coding')) {
            capabilities.add(ModelCapability.CODE_EXECUTION);
        }
        
        // Default to text if no capabilities detected
        if (capabilities.size === 0) {
            capabilities.add(ModelCapability.TEXT);
        }
        
        return capabilities;
    }
    
    /**
     * Estimate context window from model name
     */
    private estimateContextWindow(modelId: string): number {
        const lower = modelId.toLowerCase();
        
        // Gemini models
        if (lower.includes('gemini-1.5') || lower.includes('gemini-2')) {
            if (lower.includes('pro')) return 2000000;
            return 1000000;
        }
        
        // Claude models
        if (lower.includes('claude')) {
            return 200000;
        }
        
        // GPT-4 models
        if (lower.includes('gpt-4') || lower.includes('gpt-5')) {
            return 128000;
        }
        
        // GPT-3.5
        if (lower.includes('gpt-3.5')) {
            return 16385;
        }
        
        // Llama models
        if (lower.includes('llama')) {
            if (lower.includes('3.1') || lower.includes('3.2') || lower.includes('3.3')) {
                return 128000;
            }
            return 8192;
        }
        
        // Mistral models
        if (lower.includes('mistral') || lower.includes('mixtral')) {
            if (lower.includes('large')) return 128000;
            return 32000;
        }
        
        // Default
        return 8192;
    }
    
    /**
     * Estimate max output tokens
     */
    private estimateMaxOutputTokens(modelId: string): number {
        const lower = modelId.toLowerCase();
        
        if (lower.includes('gemini')) return 8192;
        if (lower.includes('claude')) return 4096;
        if (lower.includes('gpt')) return 4096;
        
        return 4096;
    }
    
    /**
     * Estimate performance metrics
     */
    private estimatePerformance(modelId: string): {
        avgLatencyMs: number;
        p95LatencyMs?: number;
        reliabilityScore: number;
        throughputTokensPerSec: number;
    } {
        const lower = modelId.toLowerCase();
        
        // Fast models
        if (lower.includes('mini') || lower.includes('lite') || lower.includes('flash') ||
            lower.includes('haiku') || lower.includes('nano')) {
            return {
                avgLatencyMs: 800,
                reliabilityScore: 0.97,
                throughputTokensPerSec: 80
            };
        }
        
        // Large/Pro models
        if (lower.includes('opus') || lower.includes('pro') || lower.includes('large')) {
            return {
                avgLatencyMs: 3000,
                reliabilityScore: 0.95,
                throughputTokensPerSec: 40
            };
        }
        
        // Standard models
        return {
            avgLatencyMs: 2000,
            reliabilityScore: 0.96,
            throughputTokensPerSec: 50
        };
    }
    
    /**
     * Create display name from model ID
     */
    private createDisplayName(modelId: string): string {
        // Remove common prefixes
        let name = modelId
            .replace(/^(gpt-|claude-|gemini-|llama-|mistral-|nova-)/i, '')
            .replace(/-/g, ' ')
            .replace(/_/g, ' ');
        
        // Capitalize words
        name = name.split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
        
        return name;
    }
    
    /**
     * Check if model is experimental
     */
    private isExperimental(modelId: string, notes: string): boolean {
        const lower = modelId.toLowerCase() + ' ' + notes.toLowerCase();
        return lower.includes('preview') || lower.includes('experimental') || 
               lower.includes('exp') || lower.includes('beta');
    }
    
    /**
     * Register a model in the registry
     */
    registerModel(model: ModelCapabilityDefinition): void {
        this.models.set(model.modelId, model);
        this.modelToProvider.set(model.modelId, model.providerType);
        
        // Update capability index
        model.capabilities.forEach(cap => {
            if (!this.capabilityIndex.has(cap)) {
                this.capabilityIndex.set(cap, new Set());
            }
            const capIndex = this.capabilityIndex.get(cap);
            if (capIndex) capIndex.add(model.modelId);
        });
        
        // Update provider index
        if (!this.providerIndex.has(model.provider)) {
            this.providerIndex.set(model.provider, new Set());
        }
        const provIndex = this.providerIndex.get(model.provider);
        if (provIndex) provIndex.add(model.modelId);
        
        this.emit('model_registered', { modelId: model.modelId, provider: model.provider });
    }
    
    /**
     * Register a provider adapter
     */
    registerProviderAdapter(providerType: AIProviderType, adapter: IProviderAdapter): void {
        this.providerAdapters.set(providerType, adapter);
        
        // Optionally sync models from adapter
        const adapterModels = adapter.getSupportedModels();
        adapterModels.forEach(model => {
            if (!this.models.has(model.modelId)) {
                this.registerModel(model);
            }
        });
        
        loggingService.info(`Registered provider adapter: ${providerType}`);
        this.emit('provider_registered', { providerType });
    }
    
    /**
     * Get model by ID
     */
    getModel(modelId: string): ModelCapabilityDefinition | undefined {
        return this.models.get(modelId);
    }
    
    /**
     * Check if model has capability
     */
    hasCapability(modelId: string, capability: ModelCapability): boolean {
        const model = this.models.get(modelId);
        return model ? model.capabilities.has(capability) : false;
    }
    
    /**
     * Find models by capabilities
     */
    findModelsByCapability(capabilities: ModelCapability[]): ModelCapabilityDefinition[] {
        if (capabilities.length === 0) {
            return Array.from(this.models.values());
        }
        
        // Find intersection of models that have ALL required capabilities
        let candidateModelIds: Set<string> | null = null;
        
        for (const capability of capabilities) {
            const modelsWithCap = this.capabilityIndex.get(capability);
            if (!modelsWithCap || modelsWithCap.size === 0) {
                return []; // No models have this capability
            }
            
            if (candidateModelIds === null) {
                candidateModelIds = new Set(modelsWithCap);
            } else {
                const filteredIds = new Set<string>();
                for (const id of candidateModelIds) {
                    if (modelsWithCap.has(id)) {
                        filteredIds.add(id);
                    }
                }
                candidateModelIds = filteredIds;
            }
            
            if (candidateModelIds.size === 0) {
                return []; // No models have all capabilities
            }
        }
        
        return Array.from(candidateModelIds ?? [])
            .map(id => this.models.get(id))
            .filter((m): m is ModelCapabilityDefinition => m !== undefined && m.isAvailable);
    }
    
    /**
     * Get provider adapter for model
     */
    getProviderForModel(modelId: string): IProviderAdapter | undefined {
        const providerType = this.modelToProvider.get(modelId);
        return providerType ? this.providerAdapters.get(providerType) : undefined;
    }
    
    /**
     * Select optimal model based on requirements
     */
    selectOptimalModel(request: ModelSelectionRequest): ModelSelectionResult {
        // Find candidate models
        let candidates = this.findModelsByCapability(request.requiredCapabilities);
        
        // Apply constraints
        if (request.constraints) {
            candidates = this.applyConstraints(candidates, request.constraints);
        }
        
        if (candidates.length === 0) {
            throw new Error(`No models found matching required capabilities: ${request.requiredCapabilities.join(', ')}`);
        }
        
        // Score and rank models
        const scoredModels = candidates.map(model => ({
            model,
            score: this.calculateModelScore(model, request)
        }));
        
        // Sort by score (descending)
        scoredModels.sort((a, b) => b.score - a.score);
        
        const selectedModel = scoredModels[0].model;
        const alternativeModels = scoredModels.slice(1, 4).map(sm => sm.model);
        
        // Build selection result
        const result: ModelSelectionResult = {
            selectedModel,
            alternativeModels,
            selectionReasoning: {
                strategy: request.strategy,
                score: scoredModels[0].score,
                matchedCapabilities: request.requiredCapabilities,
                missingCapabilities: request.optionalCapabilities?.filter(
                    cap => !selectedModel.capabilities.has(cap)
                ) ?? [],
                tradeoffs: this.explainTradeoffs(selectedModel, request.strategy)
            }
        };
        
        // Estimate cost if token hints provided
        if (request.contextHints?.estimatedInputTokens && request.contextHints?.estimatedOutputTokens) {
            result.estimatedCost = this.estimateCost(
                selectedModel,
                request.contextHints.estimatedInputTokens,
                request.contextHints.estimatedOutputTokens
            );
        }
        
        result.estimatedLatency = selectedModel.performance.avgLatencyMs;
        
        loggingService.info('Model selected', {
            modelId: selectedModel.modelId,
            strategy: request.strategy,
            score: result.selectionReasoning.score,
            estimatedCost: result.estimatedCost,
            estimatedLatency: result.estimatedLatency
        });
        
        this.emit('model_selected', { selectedModel: selectedModel.modelId, request, result });
        
        return result;
    }
    
    /**
     * Apply constraints to filter candidate models
     */
    private applyConstraints(
        candidates: ModelCapabilityDefinition[],
        constraints: ModelSelectionConstraints
    ): ModelCapabilityDefinition[] {
        return candidates.filter(model => {
            // Exclude providers
            if (constraints.excludeProviders?.includes(model.provider)) {
                return false;
            }
            
            // Preferred providers (if specified, only include these)
            if (constraints.preferredProviders && constraints.preferredProviders.length > 0) {
                if (!constraints.preferredProviders.includes(model.provider)) {
                    return false;
                }
            }
            
            // Exclude experimental
            if (constraints.excludeExperimental && model.isExperimental) {
                return false;
            }
            
            // Min reliability
            if (constraints.minReliability && model.performance.reliabilityScore < constraints.minReliability) {
                return false;
            }
            
            // Max latency
            if (constraints.maxLatencyMs && model.performance.avgLatencyMs > constraints.maxLatencyMs) {
                return false;
            }
            
            // Min context window
            if (constraints.minContextWindow && model.contextWindow < constraints.minContextWindow) {
                return false;
            }
            
            // Max cost per request (rough estimate with 1000 input + 500 output tokens)
            if (constraints.maxCostPerRequest) {
                const estimatedCost = this.estimateCost(model, 1000, 500);
                if (estimatedCost > constraints.maxCostPerRequest) {
                    return false;
                }
            }
            
            return true;
        });
    }
    
    /**
     * Calculate model score based on strategy
     */
    private calculateModelScore(model: ModelCapabilityDefinition, request: ModelSelectionRequest): number {
        const strategy = request.strategy;
        
        // Normalize metrics to 0-1 scale
        const costScore = this.normalizeCostScore(model);
        const latencyScore = this.normalizeLatencyScore(model);
        const qualityScore = this.normalizeQualityScore(model);
        const reliabilityScore = model.performance.reliabilityScore;
        
        let score: number;
        
        switch (strategy) {
            case ModelSelectionStrategy.COST_OPTIMIZED:
                score = costScore * 0.7 + latencyScore * 0.1 + qualityScore * 0.1 + reliabilityScore * 0.1;
                break;
                
            case ModelSelectionStrategy.SPEED_OPTIMIZED:
                score = latencyScore * 0.7 + costScore * 0.1 + qualityScore * 0.1 + reliabilityScore * 0.1;
                break;
                
            case ModelSelectionStrategy.QUALITY_OPTIMIZED:
                score = qualityScore * 0.7 + reliabilityScore * 0.2 + latencyScore * 0.05 + costScore * 0.05;
                break;
                
            case ModelSelectionStrategy.BALANCED:
                score = costScore * 0.25 + latencyScore * 0.25 + qualityScore * 0.25 + reliabilityScore * 0.25;
                break;
                
            case ModelSelectionStrategy.CUSTOM:
                if (request.customWeights) {
                    const weights = request.customWeights;
                    score = costScore * weights.costWeight +
                           latencyScore * weights.latencyWeight +
                           qualityScore * weights.qualityWeight +
                           reliabilityScore * weights.reliabilityWeight;
                } else {
                    score = (costScore + latencyScore + qualityScore + reliabilityScore) / 4;
                }
                break;
                
            default:
                score = (costScore + latencyScore + qualityScore + reliabilityScore) / 4;
        }
        
        return score;
    }
    
    /**
     * Normalize cost score (lower cost = higher score)
     */
    private normalizeCostScore(model: ModelCapabilityDefinition): number {
        // Use typical request: 1000 input + 500 output tokens
        const cost = this.estimateCost(model, 1000, 500);
        
        // Map cost to 0-1 scale (inverse: lower cost = higher score)
        // Assume range: $0.0001 (best) to $0.10 (worst)
        const minCost = 0.0001;
        const maxCost = 0.10;
        
        const normalizedCost = Math.max(0, Math.min(1, (cost - minCost) / (maxCost - minCost)));
        return 1 - normalizedCost; // Invert so lower cost = higher score
    }
    
    /**
     * Normalize latency score (lower latency = higher score)
     */
    private normalizeLatencyScore(model: ModelCapabilityDefinition): number {
        const latency = model.performance.avgLatencyMs;
        
        // Map latency to 0-1 scale (inverse)
        // Assume range: 500ms (best) to 5000ms (worst)
        const minLatency = 500;
        const maxLatency = 5000;
        
        const normalizedLatency = Math.max(0, Math.min(1, (latency - minLatency) / (maxLatency - minLatency)));
        return 1 - normalizedLatency;
    }
    
    /**
     * Normalize quality score (heuristic based on model tier and capabilities)
     */
    private normalizeQualityScore(model: ModelCapabilityDefinition): number {
        let score = 0.5; // Base score
        
        // Tier-based scoring (heuristic)
        if (model.modelId.includes('opus') || model.modelId.includes('gpt-4o')) {
            score += 0.4;
        } else if (model.modelId.includes('sonnet') || model.modelId.includes('pro')) {
            score += 0.3;
        } else if (model.modelId.includes('haiku') || model.modelId.includes('mini') || model.modelId.includes('flash')) {
            score += 0.1;
        }
        
        // Capability bonus
        const capabilityBonus = Math.min(0.2, model.capabilities.size * 0.02);
        score += capabilityBonus;
        
        return Math.min(1, score);
    }
    
    /**
     * Estimate cost for a request
     */
    private estimateCost(model: ModelCapabilityDefinition, inputTokens: number, outputTokens: number): number {
        const inputCost = (inputTokens / 1_000_000) * model.pricing.inputPricePerMillion;
        const outputCost = (outputTokens / 1_000_000) * model.pricing.outputPricePerMillion;
        return inputCost + outputCost;
    }
    
    /**
     * Explain tradeoffs for selected strategy
     */
    private explainTradeoffs(model: ModelCapabilityDefinition, strategy: ModelSelectionStrategy): string {
        switch (strategy) {
            case ModelSelectionStrategy.COST_OPTIMIZED:
                return `Selected ${model.displayName} for lowest cost. May have higher latency or lower quality than premium models.`;
            case ModelSelectionStrategy.SPEED_OPTIMIZED:
                return `Selected ${model.displayName} for fastest response. May cost more than budget models.`;
            case ModelSelectionStrategy.QUALITY_OPTIMIZED:
                return `Selected ${model.displayName} for best quality. Higher cost and latency expected.`;
            case ModelSelectionStrategy.BALANCED:
                return `Selected ${model.displayName} for optimal balance of cost, speed, and quality.`;
            default:
                return `Selected ${model.displayName} based on custom criteria.`;
        }
    }
    
    /**
     * Rebuild capability and provider indexes
     */
    private rebuildIndexes(): void {
        this.capabilityIndex.clear();
        this.providerIndex.clear();
        
        for (const model of this.models.values()) {
            // Capability index
            model.capabilities.forEach(cap => {
                if (!this.capabilityIndex.has(cap)) {
                    this.capabilityIndex.set(cap, new Set());
                }
                const capIndex = this.capabilityIndex.get(cap);
                if (capIndex) capIndex.add(model.modelId);
            });
            
            // Provider index
            if (!this.providerIndex.has(model.provider)) {
                this.providerIndex.set(model.provider, new Set());
            }
            const provIndex = this.providerIndex.get(model.provider);
            if (provIndex) provIndex.add(model.modelId);
        }
    }
    
    /**
     * Get registry statistics
     */
    getStats(): ModelRegistryStats {
        const modelsByProvider: Record<string, number> = {};
        const modelsByCapability: Partial<Record<ModelCapability, number>> = {};
        
        for (const [provider, models] of this.providerIndex.entries()) {
            modelsByProvider[provider] = models.size;
        }
        
        for (const [capability, models] of this.capabilityIndex.entries()) {
            modelsByCapability[capability] = models.size;
        }
        
        const allModels = Array.from(this.models.values());
        const avgCost = allModels.reduce((sum, m) => 
            sum + this.estimateCost(m, 1000, 500), 0
        ) / allModels.length;
        
        const avgLatency = allModels.reduce((sum, m) => 
            sum + m.performance.avgLatencyMs, 0
        ) / allModels.length;
        
        return {
            totalModels: this.models.size,
            modelsByProvider,
            modelsByCapability: modelsByCapability as Record<ModelCapability, number>,
            averageCostPerMillion: avgCost * 1_000_000,
            averageLatencyMs: avgLatency
        };
    }
    
    /**
     * List all models
     */
    listAllModels(): ModelCapabilityDefinition[] {
        return Array.from(this.models.values());
    }
    
    /**
     * List models by provider
     */
    listModelsByProvider(provider: string): ModelCapabilityDefinition[] {
        const modelIds = this.providerIndex.get(provider);
        if (!modelIds) return [];
        
        return Array.from(modelIds)
            .map(id => this.models.get(id))
            .filter((m): m is ModelCapabilityDefinition => m !== undefined);
    }
}

