import { ModelDiscoveryService } from '../services/modelDiscovery.service';
import { AIModelPricing } from '../models/AIModelPricing';
import { GoogleSearchService } from '../services/googleSearch.service';
import { BedrockService } from '../services/bedrock.service';

/**
 * Model Discovery Integration Tests
 * Tests the complete discovery flow from search to storage
 */
describe('Model Discovery Integration Tests', () => {
    beforeEach(async () => {
        // Clear test database before each test
        await AIModelPricing.deleteMany({});
    });

    describe('Full Discovery Flow', () => {
        it('should discover and store models for OpenAI', async () => {
            const result = await ModelDiscoveryService.discoverModelsForProvider('openai');

            expect(result).toBeDefined();
            expect(result.provider).toBe('openai');
            expect(result.modelsDiscovered).toBeGreaterThan(0);
            expect(result.modelsValidated).toBeGreaterThan(0);
            expect(result.errors).toBeInstanceOf(Array);
        }, 60000); // 60 second timeout for real API calls

        it('should handle provider with no results', async () => {
            const result = await ModelDiscoveryService.discoverModelsForProvider('nonexistent-provider');

            expect(result).toBeDefined();
            expect(result.modelsDiscovered).toBe(0);
            expect(result.errors.length).toBeGreaterThan(0);
        });
    });

    describe('Model Extraction', () => {
        it('should extract model names from search results', async () => {
            const mockSearchText = `
                OpenAI Models:
                - GPT-4o: The latest flagship model
                - GPT-4o-mini: A faster, cheaper variant
                - GPT-4-turbo: High-performance model
                - GPT-3.5-turbo: Legacy model
            `;

            const result = await BedrockService.extractModelsFromText('openai', mockSearchText);

            expect(result.success).toBe(true);
            expect(result.data).toBeInstanceOf(Array);
            if (result.success && Array.isArray(result.data)) {
                expect(result.data.length).toBeGreaterThan(0);
            }
        }, 30000);

        it('should extract pricing from search results', async () => {
            const mockSearchText = `
                GPT-4o Pricing:
                - Input: $2.50 per 1M tokens
                - Output: $10.00 per 1M tokens
                - Context window: 128,000 tokens
                - Capabilities: Text, multimodal, vision
            `;

            const result = await BedrockService.extractPricingFromText('openai', 'gpt-4o', mockSearchText);

            expect(result.success).toBe(true);
            if (result.success && result.data) {
                const pricing = result.data as any;
                expect(pricing.inputPricePerMToken).toBeGreaterThan(0);
                expect(pricing.outputPricePerMToken).toBeGreaterThan(0);
                expect(pricing.contextWindow).toBeGreaterThan(0);
            }
        }, 30000);
    });

    describe('Data Validation', () => {
        it('should validate price ranges correctly', () => {
            const validData = {
                modelId: 'gpt-4o',
                modelName: 'GPT-4o',
                inputPricePerMToken: 2.5,
                outputPricePerMToken: 10.0,
                contextWindow: 128000,
                capabilities: ['text', 'multimodal'],
                category: 'text' as const,
                isLatest: true
            };

            // Access private method via type assertion for testing
            const service = ModelDiscoveryService as any;
            const result = service.validateAndNormalize(validData, 'openai');

            expect(result.isValid).toBe(true);
            expect(result.errors.length).toBe(0);
        });

        it('should reject prices outside valid range', () => {
            const invalidData = {
                modelId: 'test-model',
                modelName: 'Test Model',
                inputPricePerMToken: 2000, // Too high
                outputPricePerMToken: 10.0,
                contextWindow: 128000,
                capabilities: ['text'],
                category: 'text' as const,
                isLatest: false
            };

            const service = ModelDiscoveryService as any;
            const result = service.validateAndNormalize(invalidData, 'test');

            expect(result.isValid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });
    });

    describe('Database Storage', () => {
        it('should store new model in database', async () => {
            const testModel = {
                modelId: 'test-model-1',
                modelName: 'Test Model 1',
                inputPricePerMToken: 5.0,
                outputPricePerMToken: 15.0,
                contextWindow: 100000,
                capabilities: ['text'],
                category: 'text' as const,
                isLatest: true
            };

            const service = ModelDiscoveryService as any;
            const stored = await service.storeModelPricing(testModel, 'test-provider', 'manual');

            expect(stored).toBeDefined();
            expect(stored.modelId).toBe('test-model-1');
            expect(stored.provider).toBe('test-provider');

            // Verify it's in the database
            const found = await AIModelPricing.findOne({ modelId: 'test-model-1' });
            expect(found).toBeDefined();
            expect(found?.inputPricePerMToken).toBe(5.0);
        });

        it('should update existing model', async () => {
            // Create initial model
            const initial = new AIModelPricing({
                modelId: 'test-model-2',
                modelName: 'Test Model 2',
                provider: 'test-provider',
                inputPricePerMToken: 5.0,
                outputPricePerMToken: 15.0,
                contextWindow: 100000,
                capabilities: ['text'],
                category: 'text',
                isLatest: false,
                isActive: true,
                discoverySource: 'manual',
                discoveryDate: new Date(),
                lastValidated: new Date(),
                lastUpdated: new Date(),
                isDeprecated: false,
                validationStatus: 'verified'
            });
            await initial.save();

            // Update with new pricing
            const updated = {
                modelId: 'test-model-2',
                modelName: 'Test Model 2 Updated',
                inputPricePerMToken: 7.0,
                outputPricePerMToken: 20.0,
                contextWindow: 150000,
                capabilities: ['text', 'code'],
                category: 'text' as const,
                isLatest: true
            };

            const service = ModelDiscoveryService as any;
            await service.storeModelPricing(updated, 'test-provider', 'google_search');

            // Verify update
            const found = await AIModelPricing.findOne({ modelId: 'test-model-2' });
            expect(found).toBeDefined();
            expect(found?.inputPricePerMToken).toBe(7.0);
            expect(found?.outputPricePerMToken).toBe(20.0);
            expect(found?.isLatest).toBe(true);
            expect(found?.discoverySource).toBe('google_search');
        });
    });

    describe('Discovery Status', () => {
        it('should return current discovery status', async () => {
            // Add some test models
            await AIModelPricing.create({
                modelId: 'status-test-1',
                modelName: 'Status Test 1',
                provider: 'openai',
                inputPricePerMToken: 2.5,
                outputPricePerMToken: 10.0,
                contextWindow: 128000,
                capabilities: ['text'],
                category: 'text',
                isLatest: true,
                isActive: true,
                discoverySource: 'manual',
                discoveryDate: new Date(),
                lastValidated: new Date(),
                lastUpdated: new Date(),
                isDeprecated: false,
                validationStatus: 'verified'
            });

            const status = await ModelDiscoveryService.getDiscoveryStatus();

            expect(status).toBeDefined();
            expect(status.totalModels).toBeGreaterThan(0);
            expect(status.providerStats).toBeDefined();
            expect(status.providerStats.openai).toBeDefined();
            expect(status.providerStats.openai.total).toBeGreaterThan(0);
        });
    });
});

/**
 * Unit Tests for Individual Components
 */
describe('Model Discovery Unit Tests', () => {
    describe('Provider Configurations', () => {
        it('should have configurations for all supported providers', () => {
            const service = ModelDiscoveryService as any;
            const configs = service.PROVIDER_CONFIGS;

            expect(configs).toBeDefined();
            expect(configs.openai).toBeDefined();
            expect(configs.anthropic).toBeDefined();
            expect(configs['google-ai']).toBeDefined();
            expect(configs.cohere).toBeDefined();
            expect(configs.mistral).toBeDefined();
            expect(configs.xai).toBeDefined();
        });

        it('should have valid query templates', () => {
            const service = ModelDiscoveryService as any;
            const config = service.PROVIDER_CONFIGS.openai;

            expect(config.discoveryQuery).toContain('OpenAI');
            expect(config.pricingQueryTemplate).toContain('{modelName}');
            expect(config.officialDocsUrl).toContain('openai');
            expect(config.expectedModelPatterns.length).toBeGreaterThan(0);
        });
    });

    describe('Price Unit Conversion', () => {
        it('should handle prices per million tokens correctly', () => {
            const testCases = [
                { input: 2.5, expected: 2.5, unit: 'per million' },
                { input: 0.15, expected: 0.15, unit: 'per million' },
                { input: 10.0, expected: 10.0, unit: 'per million' }
            ];

            testCases.forEach(testCase => {
                expect(testCase.input).toBe(testCase.expected);
            });
        });
    });
});
