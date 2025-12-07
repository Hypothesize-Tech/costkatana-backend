/**
 * Intelligent Failover Service
 * 
 * Enhanced failover that uses ModelRegistry and PricingRegistry
 * to find optimal fallback models automatically.
 */

import { ModelRegistryService } from './modelRegistry.service';
import { PricingRegistryService } from './pricingRegistry.service';
import { IntelligentRouterService } from './intelligentRouter.service';
import { ModelDefinition, ModelCapability } from '../types/modelRegistry.types';
import { AIProviderType } from '../types/aiProvider.types';
import { NormalizedError, NormalizedErrorType } from '../types/normalized.types';
import { loggingService } from './logging.service';

/**
 * Failover Strategy
 */
export type FailoverStrategy = 
    | 'same_provider'       // Try other models from same provider
    | 'same_tier'           // Try models in same tier across providers
    | 'cheaper_equivalent'  // Try cheaper models with same capabilities
    | 'any_compatible';     // Try any model with required capabilities

/**
 * Failover Configuration
 */
export interface FailoverConfig {
    /** Failover strategy */
    strategy: FailoverStrategy;
    
    /** Maximum number of attempts */
    maxAttempts: number;
    
    /** Required capabilities for fallback */
    requiredCapabilities?: ModelCapability[];
    
    /** Maximum cost increase allowed (percentage) */
    maxCostIncreasePercent?: number;
    
    /** Maximum latency increase allowed (ms) */
    maxLatencyIncreaseMs?: number;
    
    /** Allowed providers for fallback */
    allowedProviders?: AIProviderType[];
    
    /** Models to exclude from fallback */
    excludeModels?: string[];
    
    /** Whether to retry same model with backoff */
    retryOriginalModel?: boolean;
    
    /** Backoff delays for retries (ms) */
    backoffDelays?: number[];
}

/**
 * Failover Plan
 */
export interface FailoverPlan {
    /** Original model that failed */
    originalModel: ModelDefinition;
    
    /** Fallback models in order of priority */
    fallbackModels: Array<{
        model: ModelDefinition;
        reason: string;
        estimatedCost: number;
        estimatedLatencyMs: number;
    }>;
    
    /** Retry attempts for original model */
    retryAttempts?: Array<{
        attemptNumber: number;
        delayMs: number;
    }>;
    
    /** Total attempts in plan */
    totalAttempts: number;
}

/**
 * Failover Context
 */
export interface FailoverContext {
    /** Original model attempted */
    originalModel: string;
    
    /** Error that triggered failover */
    error: NormalizedError;
    
    /** Request details */
    request: {
        inputTokens: number;
        outputTokens: number;
        capabilities: ModelCapability[];
    };
    
    /** Configuration */
    config: FailoverConfig;
}

export class IntelligentFailoverService {
    private static instance: IntelligentFailoverService;
    private modelRegistry: ModelRegistryService;
    private pricingRegistry: PricingRegistryService;
    private intelligentRouter: IntelligentRouterService;

    private constructor() {
        this.modelRegistry = ModelRegistryService.getInstance();
        this.pricingRegistry = PricingRegistryService.getInstance();
        this.intelligentRouter = IntelligentRouterService.getInstance();
    }

    static getInstance(): IntelligentFailoverService {
        if (!IntelligentFailoverService.instance) {
            IntelligentFailoverService.instance = new IntelligentFailoverService();
        }
        return IntelligentFailoverService.instance;
    }

    /**
     * Generate failover plan for a failed request
     */
    async generateFailoverPlan(context: FailoverContext): Promise<FailoverPlan | null> {
        const originalModel = this.modelRegistry.getModel(context.originalModel);

        if (!originalModel) {
            loggingService.error('Cannot generate failover plan: original model not found', {
                modelId: context.originalModel
            });
            return null;
        }

        loggingService.info('Generating failover plan', {
            originalModel: originalModel.id,
            errorType: context.error.type,
            strategy: context.config.strategy
        });

        // Determine if we should retry the original model
        const retryAttempts = this.shouldRetryOriginalModel(context.error, context.config)
            ? this.generateRetryAttempts(context.config)
            : undefined;

        // Find fallback models
        const fallbackModels = await this.findFallbackModels(originalModel, context);

        if (fallbackModels.length === 0 && !retryAttempts) {
            loggingService.warn('No fallback options available', {
                originalModel: originalModel.id,
                strategy: context.config.strategy
            });
            return null;
        }

        const totalAttempts = (retryAttempts?.length || 0) + fallbackModels.length;

        return {
            originalModel,
            fallbackModels,
            retryAttempts,
            totalAttempts
        };
    }

    /**
     * Determine if original model should be retried
     */
    private shouldRetryOriginalModel(
        error: NormalizedError,
        config: FailoverConfig
    ): boolean {
        if (!config.retryOriginalModel) {
            return false;
        }

        // Retry on transient errors
        const retryableTypes: NormalizedErrorType[] = [
            'rate_limit',
            'timeout',
            'server_error',
            'network_error',
            'model_unavailable'
        ];

        return retryableTypes.includes(error.type) && error.retryable;
    }

    /**
     * Generate retry attempts with backoff
     */
    private generateRetryAttempts(config: FailoverConfig): Array<{
        attemptNumber: number;
        delayMs: number;
    }> {
        const delays = config.backoffDelays || [1000, 3000, 5000]; // Default delays
        const maxAttempts = Math.min(delays.length, config.maxAttempts);

        return Array.from({ length: maxAttempts }, (_, i) => ({
            attemptNumber: i + 1,
            delayMs: delays[i]
        }));
    }

    /**
     * Find fallback models based on strategy
     */
    private async findFallbackModels(
        originalModel: ModelDefinition,
        context: FailoverContext
    ): Promise<Array<{
        model: ModelDefinition;
        reason: string;
        estimatedCost: number;
        estimatedLatencyMs: number;
    }>> {
        let candidates: ModelDefinition[] = [];

        switch (context.config.strategy) {
            case 'same_provider':
                candidates = await this.findSameProviderModels(originalModel, context);
                break;

            case 'same_tier':
                candidates = await this.findSameTierModels(originalModel, context);
                break;

            case 'cheaper_equivalent':
                candidates = await this.findCheaperEquivalents(originalModel, context);
                break;

            case 'any_compatible':
                candidates = await this.findAnyCompatible(originalModel, context);
                break;
        }

        // Apply constraints and calculate costs
        const fallbacks = await this.evaluateCandidates(
            candidates,
            originalModel,
            context
        );

        // Limit to max attempts
        return fallbacks.slice(0, context.config.maxAttempts);
    }

    /**
     * Find models from same provider
     */
    private async findSameProviderModels(
        originalModel: ModelDefinition,
        context: FailoverContext
    ): Promise<ModelDefinition[]> {
        const models = this.modelRegistry.getModelsByProvider(originalModel.provider);

        return models.filter(model => 
            model.id !== originalModel.id &&
            model.status === 'active' &&
            this.hasRequiredCapabilities(model, context.request.capabilities)
        );
    }

    /**
     * Find models in same tier across providers
     */
    private async findSameTierModels(
        originalModel: ModelDefinition,
        context: FailoverContext
    ): Promise<ModelDefinition[]> {
        const models = this.modelRegistry.getModels({
            tier: originalModel.tier,
            status: ['active']
        });

        return models.filter(model => 
            model.id !== originalModel.id &&
            this.hasRequiredCapabilities(model, context.request.capabilities)
        );
    }

    /**
     * Find cheaper equivalent models
     */
    private async findCheaperEquivalents(
        originalModel: ModelDefinition,
        context: FailoverContext
    ): Promise<ModelDefinition[]> {
        // Get original cost
        const originalPricing = this.pricingRegistry.getPricing(originalModel.id);
        if (!originalPricing) {
            return [];
        }

        const originalCostCalc = this.pricingRegistry.calculateCost({
            modelId: originalModel.id,
            inputTokens: context.request.inputTokens,
            outputTokens: context.request.outputTokens
        });

        const originalCost = originalCostCalc?.totalCost || 0;

        // Find all compatible models
        const candidates = this.modelRegistry.getModels({
            status: ['active'],
            hasCapabilities: context.request.capabilities
        });

        // Filter by cost
        const cheaper: ModelDefinition[] = [];
        for (const model of candidates) {
            if (model.id === originalModel.id) continue;

            const costCalc = this.pricingRegistry.calculateCost({
                modelId: model.id,
                inputTokens: context.request.inputTokens,
                outputTokens: context.request.outputTokens
            });

            if (costCalc && costCalc.totalCost < originalCost) {
                cheaper.push(model);
            }
        }

        return cheaper;
    }

    /**
     * Find any compatible model
     */
    private async findAnyCompatible(
        originalModel: ModelDefinition,
        context: FailoverContext
    ): Promise<ModelDefinition[]> {
        return this.modelRegistry.getModels({
            status: ['active', 'beta'],
            hasCapabilities: context.request.capabilities
        }).filter(model => model.id !== originalModel.id);
    }

    /**
     * Check if model has required capabilities
     */
    private hasRequiredCapabilities(
        model: ModelDefinition,
        required: ModelCapability[]
    ): boolean {
        return required.every(cap => model.capabilities.includes(cap));
    }

    /**
     * Evaluate and rank candidates
     */
    private async evaluateCandidates(
        candidates: ModelDefinition[],
        originalModel: ModelDefinition,
        context: FailoverContext
    ): Promise<Array<{
        model: ModelDefinition;
        reason: string;
        estimatedCost: number;
        estimatedLatencyMs: number;
    }>> {
        const evaluated = [];

        for (const candidate of candidates) {
            // Skip excluded models
            if (context.config.excludeModels?.includes(candidate.id)) {
                continue;
            }

            // Skip disallowed providers
            if (
                context.config.allowedProviders &&
                !context.config.allowedProviders.includes(candidate.provider)
            ) {
                continue;
            }

            // Calculate cost
            const costCalc = this.pricingRegistry.calculateCost({
                modelId: candidate.id,
                inputTokens: context.request.inputTokens,
                outputTokens: context.request.outputTokens
            });

            if (!costCalc) continue;

            const estimatedCost = costCalc.totalCost;
            const estimatedLatencyMs = candidate.averageLatencyMs || 2000;

            // Check cost constraint
            if (context.config.maxCostIncreasePercent !== undefined) {
                const originalCostCalc = this.pricingRegistry.calculateCost({
                    modelId: originalModel.id,
                    inputTokens: context.request.inputTokens,
                    outputTokens: context.request.outputTokens
                });

                const originalCost = originalCostCalc?.totalCost || 0;
                const costIncreasePercent = ((estimatedCost - originalCost) / originalCost) * 100;

                if (costIncreasePercent > context.config.maxCostIncreasePercent) {
                    continue;
                }
            }

            // Check latency constraint
            if (context.config.maxLatencyIncreaseMs !== undefined) {
                const originalLatency = originalModel.averageLatencyMs || 2000;
                const latencyIncrease = estimatedLatencyMs - originalLatency;

                if (latencyIncrease > context.config.maxLatencyIncreaseMs) {
                    continue;
                }
            }

            evaluated.push({
                model: candidate,
                reason: this.generateFailoverReason(candidate, originalModel, context),
                estimatedCost,
                estimatedLatencyMs
            });
        }

        // Sort by cost (prefer cheaper options)
        evaluated.sort((a, b) => a.estimatedCost - b.estimatedCost);

        return evaluated;
    }

    /**
     * Generate human-readable failover reason
     */
    private generateFailoverReason(
        candidate: ModelDefinition,
        originalModel: ModelDefinition,
        context: FailoverContext
    ): string {
        const reasons: string[] = [];

        if (candidate.provider === originalModel.provider) {
            reasons.push('Same provider');
        } else {
            reasons.push(`Alternative provider (${candidate.provider})`);
        }

        if (candidate.tier === originalModel.tier) {
            reasons.push(`same tier (${candidate.tier})`);
        } else if (candidate.tier < originalModel.tier) {
            reasons.push('lower tier (cost savings)');
        }

        const costCalc = this.pricingRegistry.calculateCost({
            modelId: candidate.id,
            inputTokens: context.request.inputTokens,
            outputTokens: context.request.outputTokens
        });

        const originalCostCalc = this.pricingRegistry.calculateCost({
            modelId: originalModel.id,
            inputTokens: context.request.inputTokens,
            outputTokens: context.request.outputTokens
        });

        if (costCalc && originalCostCalc) {
            const savings = ((originalCostCalc.totalCost - costCalc.totalCost) / originalCostCalc.totalCost) * 100;
            if (savings > 0) {
                reasons.push(`${savings.toFixed(0)}% cheaper`);
            }
        }

        return reasons.join(', ');
    }

    /**
     * Get default failover configuration
     */
    static getDefaultConfig(): FailoverConfig {
        return {
            strategy: 'same_tier',
            maxAttempts: 3,
            retryOriginalModel: true,
            backoffDelays: [1000, 3000, 5000],
            maxCostIncreasePercent: 50,
            maxLatencyIncreaseMs: 5000
        };
    }

    /**
     * Get failover configuration for error type
     */
    static getConfigForError(errorType: NormalizedErrorType): FailoverConfig {
        const baseConfig = this.getDefaultConfig();

        switch (errorType) {
            case 'rate_limit':
                return {
                    ...baseConfig,
                    strategy: 'same_provider',
                    retryOriginalModel: true,
                    backoffDelays: [5000, 15000, 30000]
                };

            case 'model_unavailable':
                return {
                    ...baseConfig,
                    strategy: 'same_tier',
                    retryOriginalModel: false
                };

            case 'quota_exceeded':
                return {
                    ...baseConfig,
                    strategy: 'cheaper_equivalent',
                    retryOriginalModel: false
                };

            case 'timeout':
                return {
                    ...baseConfig,
                    strategy: 'any_compatible',
                    maxLatencyIncreaseMs: -1000, // Prefer faster models
                    retryOriginalModel: true,
                    backoffDelays: [2000, 5000]
                };

            default:
                return baseConfig;
        }
    }
}

