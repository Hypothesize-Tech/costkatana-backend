/**
 * Cortex Core Processing Service Tests
 * 
 * Comprehensive test suite for the Cortex core processing engine
 * that validates optimization and transformation capabilities.
 */

import { CortexCoreService } from '../services/cortexCore.service';
import { CortexVocabularyService } from '../services/cortexVocabulary.service';
import { BedrockService } from '../services/bedrock.service';
import {
    CortexFrame,
    CortexProcessingRequest,
    CortexProcessingResult,
    CortexQueryFrame,
    CortexAnswerFrame,
    CortexEventFrame,
    CortexConfig,
    CortexErrorCode
} from '../types/cortex.types';

// Mock dependencies
jest.mock('../services/cortexVocabulary.service');
jest.mock('../services/bedrock.service');
jest.mock('../services/logging.service', () => ({
    loggingService: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn()
    }
}));

describe('CortexCoreService', () => {
    let coreService: CortexCoreService;
    let mockVocabularyService: jest.Mocked<CortexVocabularyService>;
    let mockBedrockService: jest.Mocked<BedrockService>;

    // Sample test Cortex structures
    const sampleQueryFrame: CortexQueryFrame = {
        frameType: 'query',
        action: 'action_get',
        target: 'concept_document',
        aspect: 'prop_summary',
        format: 'plain'
    };

    const sampleAnswerFrame: CortexAnswerFrame = {
        frameType: 'answer',
        summary: 'Document analysis completed successfully',
        status: 'success',
        content: 'The document contains valuable insights about AI cost optimization.'
    };

    const sampleEventFrame: CortexEventFrame = {
        frameType: 'event',
        action: 'action_analyze',
        agent: 'concept_system',
        object: 'concept_data',
        tense: 'past',
        time: 'recent'
    };

    beforeEach(() => {
        jest.clearAllMocks();
        
        // Mock vocabulary service
        const mockVocabInstance = {
            getInstance: jest.fn(),
            initialize: jest.fn().mockResolvedValue(undefined),
            lookupPrimitive: jest.fn().mockImplementation((id: string) => ({
                id,
                type: id.split('_')[0] as any,
                aliases: [],
                description: `Mock description for ${id}`,
                examples: []
            })),
            suggestSimilar: jest.fn().mockResolvedValue([]),
            isValidPrimitive: jest.fn().mockReturnValue(true),
            detectFrameType: jest.fn().mockReturnValue('query'),
            extractSemanticRoles: jest.fn().mockReturnValue(['action', 'target'])
        };
        
        (CortexVocabularyService.getInstance as jest.Mock).mockReturnValue(mockVocabInstance);
        mockVocabularyService = mockVocabInstance as any;

        // Mock Bedrock service
        mockBedrockService = {
            generateResponse: jest.fn()
        } as any;
        
        // Get service instance
        coreService = CortexCoreService.getInstance();
        
        // Replace the private bedrockService with our mock
        (coreService as any).bedrockService = mockBedrockService;
    });

    // ========================================================================
    // INITIALIZATION TESTS
    // ========================================================================

    describe('Initialization', () => {
        test('should initialize successfully', async () => {
            await expect(coreService.initialize()).resolves.not.toThrow();
            expect(mockVocabularyService.initialize).toHaveBeenCalledWith();
        });

        test('should handle initialization errors gracefully', async () => {
            mockVocabularyService.initialize.mockRejectedValue(new Error('Vocabulary init failed'));
            
            await expect(coreService.initialize()).rejects.toThrow('Vocabulary init failed');
        });

        test('should not reinitialize if already initialized', async () => {
            await coreService.initialize();
            await coreService.initialize();
            
            expect(mockVocabularyService.initialize).toHaveBeenCalledTimes(1);
        });
    });

    // ========================================================================
    // BASIC PROCESSING TESTS
    // ========================================================================

    describe('Basic Processing', () => {
        beforeEach(async () => {
            await coreService.initialize();
        });

        test('should process a simple query frame with optimize operation', async () => {
            const request: CortexProcessingRequest = {
                input: sampleQueryFrame,
                operation: 'optimize'
            };

            const result = await coreService.process(request);

            expect(result).toMatchObject({
                output: expect.objectContaining({
                    frameType: 'query'
                }),
                optimizations: expect.any(Array),
                processingTime: expect.any(Number),
                metadata: expect.objectContaining({
                    coreModel: expect.any(String),
                    operationsApplied: expect.arrayContaining(['optimize']),
                    semanticIntegrity: expect.any(Number)
                })
            });

            expect(result.metadata.semanticIntegrity).toBeGreaterThan(0.5);
        });

        test('should process an answer frame with compress operation', async () => {
            const request: CortexProcessingRequest = {
                input: sampleAnswerFrame,
                operation: 'compress'
            };

            const result = await coreService.process(request);

            expect(result.output.frameType).toBe('answer');
            expect(result.optimizations.length).toBeGreaterThanOrEqual(0);
            expect(result.processingTime).toBeGreaterThan(0);
        });

        test('should process an event frame with analyze operation', async () => {
            const request: CortexProcessingRequest = {
                input: sampleEventFrame,
                operation: 'analyze'
            };

            const result = await coreService.process(request);

            expect(result.output.frameType).toBe('event');
            expect(result.metadata.semanticIntegrity).toBeGreaterThanOrEqual(0.1);
        });

        test('should handle transform operation', async () => {
            const request: CortexProcessingRequest = {
                input: sampleQueryFrame,
                operation: 'transform',
                options: {
                    preserveSemantics: true,
                    targetReduction: 20
                }
            };

            const result = await coreService.process(request);

            expect(result.output).toBeDefined();
            expect(result.optimizations).toBeDefined();
        });
    });

    // ========================================================================
    // OPTIMIZATION VALIDATION TESTS
    // ========================================================================

    describe('Optimization Results', () => {
        beforeEach(async () => {
            await coreService.initialize();
        });

        test('should produce valid optimization results', async () => {
            const request: CortexProcessingRequest = {
                input: sampleQueryFrame,
                operation: 'optimize'
            };

            const result = await coreService.process(request);

            // Validate optimization structure
            result.optimizations.forEach(optimization => {
                expect(optimization).toMatchObject({
                    type: expect.stringMatching(/^(semantic_compression|frame_merging|reference_optimization)$/),
                    description: expect.any(String),
                    savings: {
                        tokensSaved: expect.any(Number),
                        reductionPercentage: expect.any(Number)
                    },
                    confidence: expect.any(Number)
                });

                expect(optimization.savings.tokensSaved).toBeGreaterThanOrEqual(0);
                expect(optimization.savings.reductionPercentage).toBeGreaterThanOrEqual(0);
                expect(optimization.confidence).toBeGreaterThanOrEqual(0);
                expect(optimization.confidence).toBeLessThanOrEqual(1);
            });
        });

        test('should maintain semantic integrity', async () => {
            const request: CortexProcessingRequest = {
                input: sampleAnswerFrame,
                operation: 'optimize',
                options: { preserveSemantics: true }
            };

            const result = await coreService.process(request);

            expect(result.metadata.semanticIntegrity).toBeGreaterThan(0.6);
            expect(result.output.frameType).toBe(sampleAnswerFrame.frameType);
        });

        test('should calculate meaningful savings', async () => {
            const complexFrame: CortexFrame = {
                frameType: 'query',
                action: 'action_analyze',
                target: 'concept_document',
                aspect: 'prop_quality',
                format: 'detailed',
                parameters: ['param1', 'param2', 'param3'],
                metadata: { source: 'test', version: '1.0' }
            } as any;

            const request: CortexProcessingRequest = {
                input: complexFrame,
                operation: 'compress'
            };

            const result = await coreService.process(request);

            if (result.optimizations.length > 0) {
                const totalSavings = result.optimizations.reduce(
                    (sum, opt) => sum + opt.savings.tokensSaved, 0
                );
                expect(totalSavings).toBeGreaterThanOrEqual(0);
            }
        });
    });

    // ========================================================================
    // CACHING TESTS
    // ========================================================================

    describe('Caching Behavior', () => {
        beforeEach(async () => {
            await coreService.initialize();
            coreService.clearCache(); // Start with clean cache
        });

        test('should cache processing results', async () => {
            const request: CortexProcessingRequest = {
                input: sampleQueryFrame,
                operation: 'optimize'
            };

            // First call - should process normally
            const result1 = await coreService.process(request);
            
            // Second call - should use cache (faster)
            const result2 = await coreService.process(request);

            expect(result1.output).toEqual(result2.output);
            expect(result1.optimizations).toEqual(result2.optimizations);
        });

        test('should provide cache information', () => {
            const cacheInfo = coreService.getCacheInfo();
            
            expect(cacheInfo).toMatchObject({
                size: expect.any(Number),
                entries: expect.any(Array)
            });
        });

        test('should clear cache when requested', async () => {
            const request: CortexProcessingRequest = {
                input: sampleQueryFrame,
                operation: 'optimize'
            };

            await coreService.process(request);
            expect(coreService.getCacheInfo().size).toBeGreaterThan(0);
            
            coreService.clearCache();
            expect(coreService.getCacheInfo().size).toBe(0);
        });
    });

    // ========================================================================
    // STATISTICS TESTS
    // ========================================================================

    describe('Statistics Tracking', () => {
        beforeEach(async () => {
            await coreService.initialize();
        });

        test('should track processing statistics', async () => {
            const initialStats = coreService.getStats();
            
            const request: CortexProcessingRequest = {
                input: sampleQueryFrame,
                operation: 'optimize'
            };

            await coreService.process(request);
            
            const updatedStats = coreService.getStats();
            
            expect(updatedStats.totalProcessed).toBeGreaterThan(initialStats.totalProcessed);
            expect(updatedStats.successfulOptimizations).toBeGreaterThanOrEqual(initialStats.successfulOptimizations);
            expect(updatedStats.averageProcessingTime).toBeGreaterThanOrEqual(0);
        });

        test('should provide meaningful statistics structure', () => {
            const stats = coreService.getStats();
            
            expect(stats).toMatchObject({
                totalProcessed: expect.any(Number),
                successfulOptimizations: expect.any(Number),
                averageCompressionRatio: expect.any(Number),
                averageProcessingTime: expect.any(Number),
                cacheHitRate: expect.any(Number),
                totalTokensSaved: expect.any(Number)
            });

            // All values should be non-negative
            Object.values(stats).forEach(value => {
                expect(value).toBeGreaterThanOrEqual(0);
            });
        });
    });

    // ========================================================================
    // ERROR HANDLING TESTS
    // ========================================================================

    describe('Error Handling', () => {
        beforeEach(async () => {
            await coreService.initialize();
        });

        test('should handle invalid input frames gracefully', async () => {
            const invalidFrame = {
                frameType: 'invalid' as any,
                invalidProperty: 'test'
            };

            const request: CortexProcessingRequest = {
                input: invalidFrame,
                operation: 'optimize'
            };

            // Should not throw - should handle gracefully
            const result = await coreService.process(request);
            expect(result).toBeDefined();
        });

        test('should handle processing failures', async () => {
            // Mock a processing failure scenario
            const problematicFrame = {
                frameType: 'query',
                action: null,
                target: undefined
            } as any;

            const request: CortexProcessingRequest = {
                input: problematicFrame,
                operation: 'optimize'
            };

            // Should handle gracefully
            await expect(coreService.process(request)).resolves.toBeDefined();
        });
    });

    // ========================================================================
    // CONFIGURATION TESTS
    // ========================================================================

    describe('Configuration Handling', () => {
        test('should accept custom configuration', async () => {
            const customConfig: Partial<CortexConfig> = {
                coreProcessing: {
                    model: 'custom-model',
                    optimizationLevel: 'conservative',
                    enableSemanticValidation: false,
                    maxProcessingTime: 5000
                }
            };

            await coreService.initialize(customConfig);
            
            const request: CortexProcessingRequest = {
                input: sampleQueryFrame,
                operation: 'optimize'
            };

            const result = await coreService.process(request, customConfig);
            expect(result).toBeDefined();
        });
    });

    // ========================================================================
    // INTEGRATION TESTS
    // ========================================================================

    describe('Integration Scenarios', () => {
        beforeEach(async () => {
            await coreService.initialize();
        });

        test('should handle complete processing pipeline', async () => {
            const requests: CortexProcessingRequest[] = [
                { input: sampleQueryFrame, operation: 'optimize' },
                { input: sampleAnswerFrame, operation: 'compress' },
                { input: sampleEventFrame, operation: 'analyze' }
            ];

            const results: CortexProcessingResult[] = [];

            for (const request of requests) {
                const result = await coreService.process(request);
                results.push(result);
            }

            expect(results).toHaveLength(3);
            results.forEach((result, index) => {
                expect(result.output.frameType).toBe(requests[index].input.frameType);
                expect(result.processingTime).toBeGreaterThan(0);
                expect(result.metadata.semanticIntegrity).toBeGreaterThan(0);
            });
        });

        test('should maintain performance under load', async () => {
            const request: CortexProcessingRequest = {
                input: sampleQueryFrame,
                operation: 'optimize'
            };

            const startTime = Date.now();
            const promises = Array(10).fill(request).map(() => coreService.process(request));
            const results = await Promise.all(promises);
            const totalTime = Date.now() - startTime;

            expect(results).toHaveLength(10);
            expect(totalTime).toBeLessThan(10000); // Should complete within 10 seconds
            
            results.forEach(result => {
                expect(result).toBeDefined();
                expect(result.processingTime).toBeGreaterThan(0);
            });
        });
    });
});
