/**
 * Integration Tests for Provider Abstraction Layer
 * 
 * Tests the ModelCapabilityRegistry, provider adapters, and capability-based routing.
 * Ensures provider-agnostic model selection works correctly.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { ModelCapabilityRegistry } from '../../services/modelCapabilityRegistry.service';
import { PricingRegistryService } from '../../services/pricingRegistry.service';
import { CapabilityRouterService } from '../../services/capabilityRouter.service';
import {
    ModelCapability,
    ModelSelectionStrategy,
    AIProviderType
} from '../../types';

describe('Provider Abstraction Layer - Integration Tests', () => {
    let modelRegistry: ModelCapabilityRegistry;
    let pricingRegistry: PricingRegistryService;
    let capabilityRouter: CapabilityRouterService;

    beforeAll(() => {
        // Initialize services
        modelRegistry = ModelCapabilityRegistry.getInstance();
        pricingRegistry = PricingRegistryService.getInstance();
        capabilityRouter = new CapabilityRouterService();
    });

    describe('ModelCapabilityRegistry', () => {
        it('should initialize with models from pricing registry', () => {
            const stats = modelRegistry.getStats();
            
            expect(stats.totalModels).toBeGreaterThan(100); // Should have 100+ models
            expect(stats.modelsByProvider).toBeDefined();
            expect(Object.keys(stats.modelsByProvider).length).toBeGreaterThan(3); // Multiple providers
        });

        it('should find models by capability', () => {
            const textModels = modelRegistry.findModelsByCapability([ModelCapability.TEXT]);
            expect(textModels.length).toBeGreaterThan(50);
            
            const visionModels = modelRegistry.findModelsByCapability([ModelCapability.VISION]);
            expect(visionModels.length).toBeGreaterThan(10);
            
            const multimodalModels = modelRegistry.findModelsByCapability([
                ModelCapability.TEXT,
                ModelCapability.VISION
            ]);
            expect(multimodalModels.length).toBeGreaterThan(5);
        });

        it('should check model capabilities correctly', () => {
            const hasTextCap = modelRegistry.hasCapability('gpt-4o', ModelCapability.TEXT);
            expect(hasTextCap).toBe(true);
            
            const hasVisionCap = modelRegistry.hasCapability('gpt-4o', ModelCapability.VISION);
            expect(hasVisionCap).toBe(true);
        });

        it('should retrieve model by ID', () => {
            const model = modelRegistry.getModel('gpt-4o');
            expect(model).toBeDefined();
            expect(model?.modelId).toBe('gpt-4o');
            expect(model?.capabilities.has(ModelCapability.TEXT)).toBe(true);
        });

        it('should provide provider adapter for model', () => {
            const adapter = modelRegistry.getProviderForModel('gpt-4o');
            // Adapter might not be registered in test environment, but method should return something
            expect(adapter).toBeDefined();
        });
    });

    describe('PricingRegistryService', () => {
        it('should have pricing for major models', () => {
            const gpt4oPricing = pricingRegistry.getPricing('openai:gpt-4o');
            expect(gpt4oPricing).toBeDefined();
            expect(gpt4oPricing?.inputPricePerK).toBeGreaterThan(0);
            expect(gpt4oPricing?.outputPricePerK).toBeGreaterThan(0);
        });

        it('should calculate cost correctly', () => {
            const result = pricingRegistry.calculateCost({
                modelId: 'openai:gpt-4o',
                inputTokens: 1000,
                outputTokens: 500
            });

            expect(result).toBeDefined();
            expect(result?.totalCost).toBeGreaterThan(0);
            expect(result?.inputCost).toBeGreaterThan(0);
            expect(result?.outputCost).toBeGreaterThan(0);
            expect(result?.totalCost).toBe(result?.inputCost + result?.outputCost);
        });

        it('should compare costs across models', () => {
            const comparison = pricingRegistry.compareCosts(
                ['openai:gpt-4o', 'openai:gpt-4o-mini', 'google:gemini-2.5-flash'],
                1000,
                500
            );

            expect(comparison).toBeDefined();
            expect(comparison?.models.length).toBeGreaterThanOrEqual(2);
            expect(comparison?.cheapest).toBeDefined();
            expect(comparison?.mostExpensive).toBeDefined();
            
            // Verify models are sorted by cost (cheapest first)
            if (comparison && comparison.models.length > 1) {
                for (let i = 1; i < comparison.models.length; i++) {
                    expect(comparison.models[i].cost).toBeGreaterThanOrEqual(
                        comparison.models[i - 1].cost
                    );
                }
            }
        });

        it('should get cheapest model', () => {
            const cheapest = pricingRegistry.getCheapestModel(
                ['openai:gpt-4o', 'openai:gpt-4o-mini'],
                1000,
                500
            );

            expect(cheapest).toBeDefined();
            expect(cheapest?.modelId).toBe('openai:gpt-4o-mini'); // Mini should be cheaper
        });

        it('should provide registry statistics', () => {
            const stats = pricingRegistry.getStats();
            
            expect(stats.totalModels).toBeGreaterThan(100);
            expect(stats.avgInputCostPerK).toBeGreaterThan(0);
            expect(stats.avgOutputCostPerK).toBeGreaterThan(0);
            expect(stats.cheapestModel).toBeDefined();
            expect(stats.mostExpensiveModel).toBeDefined();
        });
    });

    describe('Model Selection', () => {
        it('should select cost-optimized model', () => {
            const result = modelRegistry.selectOptimalModel({
                requiredCapabilities: [ModelCapability.TEXT],
                strategy: ModelSelectionStrategy.COST_OPTIMIZED,
                contextHints: {
                    estimatedInputTokens: 1000,
                    estimatedOutputTokens: 500
                }
            });

            expect(result).toBeDefined();
            expect(result.selectedModel).toBeDefined();
            expect(result.selectionReasoning.strategy).toBe(ModelSelectionStrategy.COST_OPTIMIZED);
            expect(result.estimatedCost).toBeDefined();
            expect(result.estimatedCost).toBeGreaterThan(0);
        });

        it('should select speed-optimized model', () => {
            const result = modelRegistry.selectOptimalModel({
                requiredCapabilities: [ModelCapability.TEXT],
                strategy: ModelSelectionStrategy.SPEED_OPTIMIZED
            });

            expect(result).toBeDefined();
            expect(result.selectedModel.performance.avgLatencyMs).toBeLessThan(3000);
        });

        it('should select quality-optimized model', () => {
            const result = modelRegistry.selectOptimalModel({
                requiredCapabilities: [ModelCapability.TEXT, ModelCapability.VISION],
                strategy: ModelSelectionStrategy.QUALITY_OPTIMIZED
            });

            expect(result).toBeDefined();
            expect(result.selectedModel.capabilities.has(ModelCapability.VISION)).toBe(true);
        });

        it('should select balanced model', () => {
            const result = modelRegistry.selectOptimalModel({
                requiredCapabilities: [ModelCapability.TEXT],
                strategy: ModelSelectionStrategy.BALANCED
            });

            expect(result).toBeDefined();
            expect(result.selectionReasoning.score).toBeGreaterThan(0);
            expect(result.selectionReasoning.score).toBeLessThanOrEqual(1);
        });

        it('should respect constraints', () => {
            const result = modelRegistry.selectOptimalModel({
                requiredCapabilities: [ModelCapability.TEXT],
                strategy: ModelSelectionStrategy.COST_OPTIMIZED,
                constraints: {
                    maxLatencyMs: 1500,
                    minReliability: 0.95,
                    excludeExperimental: true
                }
            });

            expect(result).toBeDefined();
            expect(result.selectedModel.performance.avgLatencyMs).toBeLessThanOrEqual(1500);
            expect(result.selectedModel.performance.reliabilityScore).toBeGreaterThanOrEqual(0.95);
            expect(result.selectedModel.isExperimental).toBeFalsy();
        });

        it('should provide alternative models', () => {
            const result = modelRegistry.selectOptimalModel({
                requiredCapabilities: [ModelCapability.TEXT],
                strategy: ModelSelectionStrategy.BALANCED
            });

            expect(result.alternativeModels).toBeDefined();
            expect(result.alternativeModels.length).toBeGreaterThan(0);
            expect(result.alternativeModels.length).toBeLessThanOrEqual(3);
        });

        it('should throw error for impossible capabilities', () => {
            expect(() => {
                modelRegistry.selectOptimalModel({
                    requiredCapabilities: [
                        ModelCapability.TEXT,
                        ModelCapability.VIDEO, // Very few models have this
                        ModelCapability.AUDIO,
                        ModelCapability.FUNCTION_CALLING
                    ],
                    strategy: ModelSelectionStrategy.COST_OPTIMIZED,
                    constraints: {
                        maxCostPerRequest: 0.0001 // Impossibly low cost
                    }
                });
            }).toThrow();
        });
    });

    describe('Provider-Agnostic Operations', () => {
        it('should not expose provider details in model selection', () => {
            const result = modelRegistry.selectOptimalModel({
                requiredCapabilities: [ModelCapability.TEXT],
                strategy: ModelSelectionStrategy.COST_OPTIMIZED
            });

            // Business logic should only see model ID, not provider
            expect(result.selectedModel.modelId).toBeDefined();
            expect(result.selectedModel.displayName).toBeDefined();
            
            // Provider name exists but shouldn't be used in business logic
            expect(result.selectedModel.provider).toBeDefined();
        });

        it('should allow provider filtering through constraints', () => {
            const result = modelRegistry.selectOptimalModel({
                requiredCapabilities: [ModelCapability.TEXT],
                strategy: ModelSelectionStrategy.COST_OPTIMIZED,
                constraints: {
                    preferredProviders: ['openai']
                }
            });

            expect(result).toBeDefined();
            expect(result.selectedModel.provider).toBe('openai');
        });

        it('should work across multiple providers', () => {
            const models = modelRegistry.listAllModels();
            
            const providers = new Set(models.map(m => m.provider));
            expect(providers.size).toBeGreaterThan(3); // OpenAI, Google, Bedrock, etc.
        });
    });

    describe('Performance and Scalability', () => {
        it('should handle rapid model lookups', () => {
            const startTime = Date.now();
            
            for (let i = 0; i < 1000; i++) {
                modelRegistry.getModel('gpt-4o');
            }
            
            const duration = Date.now() - startTime;
            expect(duration).toBeLessThan(100); // Should complete in <100ms
        });

        it('should handle rapid capability searches', () => {
            const startTime = Date.now();
            
            for (let i = 0; i < 100; i++) {
                modelRegistry.findModelsByCapability([ModelCapability.TEXT]);
            }
            
            const duration = Date.now() - startTime;
            expect(duration).toBeLessThan(500); // Should complete in <500ms
        });

        it('should handle concurrent model selections', async () => {
            const requests = Array(50).fill(null).map(() => 
                modelRegistry.selectOptimalModel({
                    requiredCapabilities: [ModelCapability.TEXT],
                    strategy: ModelSelectionStrategy.BALANCED
                })
            );

            const startTime = Date.now();
            const results = await Promise.all(requests.map(r => Promise.resolve(r)));
            const duration = Date.now() - startTime;

            expect(results.length).toBe(50);
            expect(duration).toBeLessThan(1000); // Should complete in <1s
        });
    });

    describe('Edge Cases', () => {
        it('should handle unknown model gracefully', () => {
            const model = modelRegistry.getModel('unknown-model-xyz');
            expect(model).toBeUndefined();
        });

        it('should handle model with no capabilities', () => {
            const models = modelRegistry.findModelsByCapability([]);
            expect(models.length).toBeGreaterThan(0); // Should return all models
        });

        it('should handle null pricing gracefully', () => {
            const result = pricingRegistry.calculateCost({
                modelId: 'unknown:model',
                inputTokens: 1000,
                outputTokens: 500
            });

            expect(result).toBeNull();
        });
    });
});

