/**
 * Provider-Independent Core Tests
 * 
 * Comprehensive tests for model registry, pricing registry,
 * intelligent routing, and failover functionality.
 */

import { ModelRegistryService } from '../services/modelRegistry.service';
import { PricingRegistryService } from '../services/pricingRegistry.service';
import { IntelligentRouterService } from '../services/intelligentRouter.service';
import { IntelligentFailoverService } from '../services/intelligentFailover.service';
import { NormalizationService } from '../services/normalization.service';
import { AIProviderType } from '../types/aiProvider.types';
import { NormalizedErrorFactory, NormalizedErrorType } from '../types/normalized.types';

describe('Provider-Independent Core', () => {
    describe('ModelRegistry', () => {
        let modelRegistry: ModelRegistryService;

        beforeAll(() => {
            modelRegistry = ModelRegistryService.getInstance();
        });

        test('should retrieve model by ID', () => {
            const model = modelRegistry.getModel('openai:gpt-4o');
            expect(model).toBeDefined();
            expect(model?.displayName).toBe('GPT-4o');
            expect(model?.provider).toBe(AIProviderType.OpenAI);
        });

        test('should retrieve model by name', () => {
            const model = modelRegistry.getModel('gpt-4o');
            expect(model).toBeDefined();
            expect(model?.id).toBe('openai:gpt-4o');
        });

        test('should retrieve model by alias', () => {
            const model = modelRegistry.getModel('gpt-4o-2024-08-06');
            expect(model).toBeDefined();
            expect(model?.id).toBe('openai:gpt-4o');
        });

        test('should return null for non-existent model', () => {
            const model = modelRegistry.getModel('non-existent-model');
            expect(model).toBeNull();
        });

        test('should filter models by provider', () => {
            const models = modelRegistry.getModels({
                provider: AIProviderType.Google
            });
            expect(models.length).toBeGreaterThan(0);
            expect(models.every(m => m.provider === AIProviderType.Google)).toBe(true);
        });

        test('should filter models by capabilities', () => {
            const models = modelRegistry.getModels({
                hasCapabilities: ['vision', 'chat']
            });
            expect(models.length).toBeGreaterThan(0);
            expect(models.every(m => 
                m.capabilities.includes('vision') && m.capabilities.includes('chat')
            )).toBe(true);
        });

        test('should filter models by tier', () => {
            const models = modelRegistry.getModels({
                tier: 'economy'
            });
            expect(models.length).toBeGreaterThan(0);
            expect(models.every(m => m.tier === 'economy')).toBe(true);
        });

        test('should filter models by status', () => {
            const models = modelRegistry.getModels({
                status: 'active'
            });
            expect(models.length).toBeGreaterThan(0);
            expect(models.every(m => m.status === 'active')).toBe(true);
        });

        test('should filter models by context window', () => {
            const models = modelRegistry.getModels({
                minContextWindow: 128000
            });
            expect(models.length).toBeGreaterThan(0);
            expect(models.every(m => m.contextWindow >= 128000)).toBe(true);
        });

        test('should find matching models by requirements', async () => {
            const matches = await modelRegistry.findMatchingModels({
                requiredCapabilities: ['chat', 'json'],
                minReasoningScore: 80
            });
            expect(matches.length).toBeGreaterThan(0);
            expect(matches[0].meetsRequirements).toBe(true);
        });

        test('should provide registry stats', () => {
            const stats = modelRegistry.getStats();
            expect(stats.totalModels).toBeGreaterThan(0);
            expect(stats.activeModels).toBeGreaterThan(0);
            expect(stats.byProvider[AIProviderType.OpenAI]).toBeGreaterThan(0);
        });

        test('should check model capabilities', () => {
            const hasVision = modelRegistry.hasCapability('openai:gpt-4o', 'vision');
            expect(hasVision).toBe(true);

            const hasEmbeddings = modelRegistry.hasCapability('openai:gpt-4o', 'embeddings');
            expect(hasEmbeddings).toBe(false);
        });
    });

    describe('PricingRegistry', () => {
        let pricingRegistry: PricingRegistryService;

        beforeAll(() => {
            pricingRegistry = PricingRegistryService.getInstance();
        });

        test('should retrieve pricing for model', () => {
            const pricing = pricingRegistry.getPricing('openai:gpt-4o');
            expect(pricing).toBeDefined();
            expect(pricing?.inputPricePerK).toBeGreaterThan(0);
            expect(pricing?.outputPricePerK).toBeGreaterThan(0);
        });

        test('should calculate cost accurately', () => {
            const result = pricingRegistry.calculateCost({
                modelId: 'openai:gpt-4o',
                inputTokens: 1000,
                outputTokens: 500
            });

            expect(result).toBeDefined();
            expect(result?.inputCost).toBeGreaterThan(0);
            expect(result?.outputCost).toBeGreaterThan(0);
            expect(result?.totalCost).toBe(result!.inputCost + result!.outputCost);
        });

        test('should calculate cost with cache savings', () => {
            const result = pricingRegistry.calculateCost({
                modelId: 'google:gemini-1.5-flash',
                inputTokens: 1000,
                outputTokens: 500,
                cachedInput: true
            });

            expect(result).toBeDefined();
            expect(result?.cacheSavings).toBeGreaterThan(0);
        });

        test('should compare costs across models', () => {
            const comparison = pricingRegistry.compareCosts(
                ['openai:gpt-4o', 'openai:gpt-4o-mini', 'google:gemini-1.5-flash'],
                1000,
                500
            );

            expect(comparison).toBeDefined();
            expect(comparison?.models.length).toBe(3);
            expect(comparison?.cheapest).toBeDefined();
            expect(comparison?.mostExpensive).toBeDefined();
            
            // Verify sorted by cost
            for (let i = 1; i < comparison!.models.length; i++) {
                expect(comparison!.models[i].cost).toBeGreaterThanOrEqual(
                    comparison!.models[i - 1].cost
                );
            }
        });

        test('should identify cheapest model', () => {
            const cheapest = pricingRegistry.getCheapestModel(
                ['openai:gpt-4o', 'openai:gpt-4o-mini'],
                1000,
                500
            );

            expect(cheapest).toBeDefined();
            expect(cheapest?.modelId).toBe('openai:gpt-4o-mini');
        });

        test('should get pricing by provider', () => {
            const googlePricing = pricingRegistry.getPricingByProvider(AIProviderType.Google);
            expect(googlePricing.length).toBeGreaterThan(0);
            expect(googlePricing.every(p => p.provider === AIProviderType.Google)).toBe(true);
        });

        test('should provide registry stats', () => {
            const stats = pricingRegistry.getStats();
            expect(stats.totalModels).toBeGreaterThan(0);
            expect(stats.cheapestModel).toBeDefined();
            expect(stats.mostExpensiveModel).toBeDefined();
            expect(stats.avgInputCostPerK).toBeGreaterThan(0);
        });

        test('should update pricing', () => {
            const testModelId = 'test:model';
            pricingRegistry.updatePricing(testModelId, {
                provider: AIProviderType.OpenAI,
                inputPricePerK: 0.001,
                outputPricePerK: 0.002,
                originalUnit: 'per_1m_tokens',
                currency: 'USD',
                source: 'manual'
            });

            const pricing = pricingRegistry.getPricing(testModelId);
            expect(pricing).toBeDefined();
            expect(pricing?.inputPricePerK).toBe(0.001);
        });
    });

    describe('IntelligentRouter', () => {
        let intelligentRouter: IntelligentRouterService;

        beforeAll(() => {
            intelligentRouter = IntelligentRouterService.getInstance();
        });

        test('should route with cost optimization', async () => {
            const result = await intelligentRouter.route({
                strategy: 'cost_optimized',
                requirements: {
                    requiredCapabilities: ['chat', 'json']
                },
                estimatedInputTokens: 1000,
                estimatedOutputTokens: 500
            });

            expect(result).toBeDefined();
            expect(result?.modelId).toBeDefined();
            expect(result?.estimatedCost).toBeGreaterThan(0);
            expect(result?.reasoning.length).toBeGreaterThan(0);
        });

        test('should route with quality optimization', async () => {
            const result = await intelligentRouter.route({
                strategy: 'quality_optimized',
                requirements: {
                    requiredCapabilities: ['chat', 'reasoning']
                },
                estimatedInputTokens: 1000,
                estimatedOutputTokens: 500
            });

            expect(result).toBeDefined();
            expect(result?.score).toBeGreaterThan(0);
            
            const modelRegistry = ModelRegistryService.getInstance();
            const model = modelRegistry.getModel(result!.modelId);
            expect(model?.quality.reasoning).toBeGreaterThanOrEqual(90);
        });

        test('should route with latency optimization', async () => {
            const result = await intelligentRouter.route({
                strategy: 'latency_optimized',
                requirements: {
                    requiredCapabilities: ['chat']
                },
                estimatedInputTokens: 1000,
                estimatedOutputTokens: 500
            });

            expect(result).toBeDefined();
            expect(result?.estimatedLatencyMs).toBeDefined();
        });

        test('should route with balanced strategy', async () => {
            const result = await intelligentRouter.route({
                strategy: 'balanced',
                requirements: {
                    requiredCapabilities: ['chat', 'vision']
                },
                estimatedInputTokens: 1000,
                estimatedOutputTokens: 500
            });

            expect(result).toBeDefined();
            expect(result?.score).toBeGreaterThan(0);
            expect(result?.alternatives).toBeDefined();
        });

        test('should respect cost constraints', async () => {
            const result = await intelligentRouter.route({
                strategy: 'balanced',
                requirements: {
                    requiredCapabilities: ['chat']
                },
                estimatedInputTokens: 1000,
                estimatedOutputTokens: 500,
                constraints: {
                    maxCostPerRequest: 0.001
                }
            });

            if (result) {
                expect(result.estimatedCost).toBeLessThanOrEqual(0.001);
            }
        });

        test('should respect latency constraints', async () => {
            const result = await intelligentRouter.route({
                strategy: 'balanced',
                requirements: {
                    requiredCapabilities: ['chat']
                },
                estimatedInputTokens: 1000,
                estimatedOutputTokens: 500,
                constraints: {
                    maxLatencyMs: 1500
                }
            });

            if (result) {
                expect(result.estimatedLatencyMs).toBeLessThanOrEqual(1500);
            }
        });

        test('should respect provider constraints', async () => {
            const result = await intelligentRouter.route({
                strategy: 'balanced',
                requirements: {
                    requiredCapabilities: ['chat']
                },
                estimatedInputTokens: 1000,
                estimatedOutputTokens: 500,
                constraints: {
                    allowedProviders: [AIProviderType.Google]
                }
            });

            if (result) {
                expect(result.provider).toBe(AIProviderType.Google);
            }
        });

        test('should handle forced model', async () => {
            const result = await intelligentRouter.route({
                strategy: 'balanced',
                forceModel: 'openai:gpt-4o',
                estimatedInputTokens: 1000,
                estimatedOutputTokens: 500
            });

            expect(result).toBeDefined();
            expect(result?.modelId).toBe('openai:gpt-4o');
            expect(result?.score).toBe(100);
        });

        test('should get cheapest model', async () => {
            const result = await intelligentRouter.getCheapestModel(
                ['chat', 'json'],
                1000,
                500
            );

            expect(result).toBeDefined();
            expect(result?.estimatedCost).toBeGreaterThan(0);
        });

        test('should get highest quality model', async () => {
            const result = await intelligentRouter.getHighestQualityModel(
                ['chat', 'reasoning'],
                1000,
                500
            );

            expect(result).toBeDefined();
            
            const modelRegistry = ModelRegistryService.getInstance();
            const model = modelRegistry.getModel(result!.modelId);
            expect(model?.quality.reasoning).toBeGreaterThanOrEqual(90);
        });

        test('should get fastest model', async () => {
            const result = await intelligentRouter.getFastestModel(
                ['chat'],
                1000,
                500
            );

            expect(result).toBeDefined();
            expect(result?.estimatedLatencyMs).toBeDefined();
        });
    });

    describe('IntelligentFailover', () => {
        let intelligentFailover: IntelligentFailoverService;

        beforeAll(() => {
            intelligentFailover = IntelligentFailoverService.getInstance();
        });

        test('should generate failover plan for rate limit', async () => {
            const error = NormalizedErrorFactory.create(
                'rate_limit',
                'Rate limit exceeded',
                AIProviderType.OpenAI,
                { retryAfterMs: 5000 }
            );

            const plan = await intelligentFailover.generateFailoverPlan({
                originalModel: 'openai:gpt-4o',
                error,
                request: {
                    inputTokens: 1000,
                    outputTokens: 500,
                    capabilities: ['chat', 'json']
                },
                config: IntelligentFailoverService.getConfigForError('rate_limit')
            });

            expect(plan).toBeDefined();
            expect(plan?.retryAttempts).toBeDefined();
            expect(plan?.fallbackModels.length).toBeGreaterThan(0);
        });

        test('should generate failover plan for model unavailable', async () => {
            const error = NormalizedErrorFactory.create(
                'model_unavailable',
                'Model temporarily unavailable',
                AIProviderType.OpenAI
            );

            const plan = await intelligentFailover.generateFailoverPlan({
                originalModel: 'openai:gpt-4o',
                error,
                request: {
                    inputTokens: 1000,
                    outputTokens: 500,
                    capabilities: ['chat', 'json']
                },
                config: IntelligentFailoverService.getConfigForError('model_unavailable')
            });

            expect(plan).toBeDefined();
            expect(plan?.fallbackModels.length).toBeGreaterThan(0);
            expect(plan?.retryAttempts).toBeUndefined(); // Should not retry for unavailable
        });

        test('should generate failover plan with same provider strategy', async () => {
            const error = NormalizedErrorFactory.create(
                'timeout',
                'Request timeout',
                AIProviderType.OpenAI
            );

            const plan = await intelligentFailover.generateFailoverPlan({
                originalModel: 'openai:gpt-4o',
                error,
                request: {
                    inputTokens: 1000,
                    outputTokens: 500,
                    capabilities: ['chat']
                },
                config: {
                    strategy: 'same_provider',
                    maxAttempts: 3,
                    retryOriginalModel: false
                }
            });

            expect(plan).toBeDefined();
            if (plan && plan.fallbackModels.length > 0) {
                const modelRegistry = ModelRegistryService.getInstance();
                const originalModel = modelRegistry.getModel('openai:gpt-4o');
                
                plan.fallbackModels.forEach(fb => {
                    expect(fb.model.provider).toBe(originalModel?.provider);
                });
            }
        });

        test('should generate failover plan with cheaper equivalent strategy', async () => {
            const error = NormalizedErrorFactory.create(
                'quota_exceeded',
                'Quota exceeded',
                AIProviderType.OpenAI
            );

            const plan = await intelligentFailover.generateFailoverPlan({
                originalModel: 'openai:gpt-4o',
                error,
                request: {
                    inputTokens: 1000,
                    outputTokens: 500,
                    capabilities: ['chat']
                },
                config: {
                    strategy: 'cheaper_equivalent',
                    maxAttempts: 3,
                    retryOriginalModel: false
                }
            });

            expect(plan).toBeDefined();
            if (plan && plan.fallbackModels.length > 0) {
                const pricingRegistry = PricingRegistryService.getInstance();
                const originalCost = pricingRegistry.calculateCost({
                    modelId: 'openai:gpt-4o',
                    inputTokens: 1000,
                    outputTokens: 500
                });

                plan.fallbackModels.forEach(fb => {
                    expect(fb.estimatedCost).toBeLessThan(originalCost!.totalCost);
                });
            }
        });

        test('should provide default config', () => {
            const config = IntelligentFailoverService.getDefaultConfig();
            expect(config.strategy).toBeDefined();
            expect(config.maxAttempts).toBeGreaterThan(0);
            expect(config.retryOriginalModel).toBeDefined();
        });

        test('should provide error-specific config', () => {
            const rateLimitConfig = IntelligentFailoverService.getConfigForError('rate_limit');
            expect(rateLimitConfig.retryOriginalModel).toBe(true);
            expect(rateLimitConfig.backoffDelays).toBeDefined();

            const unavailableConfig = IntelligentFailoverService.getConfigForError('model_unavailable');
            expect(unavailableConfig.retryOriginalModel).toBe(false);
        });
    });

    describe('NormalizationService', () => {
        test('should normalize request', () => {
            const normalized = NormalizationService.normalizeRequest(
                'Test prompt',
                'gpt-4o',
                {
                    temperature: 0.7,
                    maxTokens: 1000,
                    systemMessage: 'You are a helpful assistant'
                },
                {
                    userId: 'user123',
                    requestId: 'req123'
                }
            );

            expect(normalized.prompt).toBe('Test prompt');
            expect(normalized.model).toBe('gpt-4o');
            expect(normalized.parameters?.temperature).toBe(0.7);
            expect(normalized.messages?.length).toBeGreaterThan(0);
            expect(normalized.metadata?.userId).toBe('user123');
        });

        test('should normalize error', () => {
            const error = {
                message: 'Rate limit exceeded',
                status: 429,
                headers: { 'retry-after': '5' }
            };

            const normalized = NormalizationService.normalizeError(
                error,
                AIProviderType.OpenAI,
                'gpt-4o'
            );

            expect(normalized.type).toBe('rate_limit');
            expect(normalized.statusCode).toBe(429);
            expect(normalized.retryable).toBe(true);
            expect(normalized.retryAfterMs).toBe(5000);
        });

        test('should detect authentication error', () => {
            const error = { message: 'Invalid API key', status: 401 };
            const normalized = NormalizationService.normalizeError(
                error,
                AIProviderType.OpenAI
            );

            expect(normalized.type).toBe('authentication');
            expect(normalized.retryable).toBe(false);
        });

        test('should detect timeout error', () => {
            const error = { message: 'Request timed out', status: 408 };
            const normalized = NormalizationService.normalizeError(
                error,
                AIProviderType.OpenAI
            );

            expect(normalized.type).toBe('timeout');
            expect(normalized.retryable).toBe(true);
        });

        test('should calculate retry delay', () => {
            const error = NormalizedErrorFactory.create(
                'rate_limit',
                'Rate limit',
                AIProviderType.OpenAI
            );

            const delay1 = NormalizationService.getRetryDelay(error, 1);
            const delay2 = NormalizationService.getRetryDelay(error, 2);
            const delay3 = NormalizationService.getRetryDelay(error, 3);

            expect(delay2).toBeGreaterThan(delay1);
            expect(delay3).toBeGreaterThan(delay2);
            expect(delay3).toBeLessThanOrEqual(60000); // Capped at 60s
        });
    });
});

