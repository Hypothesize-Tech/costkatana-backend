/**
 * Cortex Optimization Service Integration Tests
 * 
 * Tests for the integration of Cortex meta-language processing
 * with the existing optimization service infrastructure.
 */

import { OptimizationService } from '../services/optimization.service';
import { CortexEncoderService } from '../services/cortexEncoder.service';
import { CortexCoreService } from '../services/cortexCore.service';
import { CortexDecoderService } from '../services/cortexDecoder.service';
import { Optimization } from '../models/Optimization';
import { User } from '../models/User';
import { Alert } from '../models/Alert';
import { AIProvider } from '../types/aiCostTracker.types';

// Mock dependencies
jest.mock('../services/cortexEncoder.service');
jest.mock('../services/cortexCore.service'); 
jest.mock('../services/cortexDecoder.service');
jest.mock('../models/Optimization');
jest.mock('../models/User');
jest.mock('../models/Alert');
jest.mock('../services/logging.service', () => ({
    loggingService: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn()
    }
}));
jest.mock('../services/activity.service', () => ({
    ActivityService: {
        trackActivity: jest.fn()
    }
}));

describe('Cortex Optimization Service Integration', () => {
    let mockEncoderService: jest.Mocked<CortexEncoderService>;
    let mockCoreService: jest.Mocked<CortexCoreService>;
    let mockDecoderService: jest.Mocked<CortexDecoderService>;

    // Sample test data
    const sampleOptimizationRequest = {
        userId: 'user123',
        prompt: 'Analyze the quarterly financial performance and provide insights on revenue growth patterns.',
        service: 'openai',
        model: 'gpt-4',
        context: 'financial analysis',
        options: {
            enableCortex: true,
            cortexConfig: {
                processingOperation: 'optimize' as const,
                outputStyle: 'formal' as const,
                outputFormat: 'structured' as const,
                preserveSemantics: true,
                enableSemanticCache: true
            }
        }
    };

    const sampleCortexResults = {
        encoding: {
            cortexStructure: {
                frameType: 'query',
                action: 'action_analyze',
                target: 'concept_financial_performance',
                aspect: 'prop_revenue_growth'
            } as any,
            confidence: 0.92,
            processingTime: 245,
            metadata: {
                encodingModel: 'claude-3-haiku',
                detectedIntent: 'query',
                identifiedRoles: ['action', 'target', 'aspect'],
                primitiveMapping: {}
            }
        },
        processing: {
            output: {
                frameType: 'query',
                action: 'action_analyze',
                target: 'concept_financial_performance',
                aspect: 'prop_revenue_growth',
                format: 'structured'
            } as any,
            optimizations: [{
                type: 'semantic_compression' as const,
                description: 'Applied semantic compression',
                savings: { tokensSaved: 12, reductionPercentage: 25.5 },
                confidence: 0.87
            }],
            processingTime: 180,
            metadata: {
                coreModel: 'claude-3-sonnet',
                operationsApplied: ['optimize'],
                semanticIntegrity: 0.94
            }
        },
        decoding: {
            text: 'Analyze quarterly financial performance focusing on revenue growth patterns with structured insights.',
            confidence: 0.88,
            processingTime: 120,
            fidelityScore: 0.91,
            metadata: {
                decodingModel: 'claude-3-haiku',
                targetLanguage: 'en',
                styleApplied: 'formal',
                qualityMetrics: {
                    fluency: 0.95,
                    coherence: 0.89,
                    accuracy: 0.91
                }
            }
        }
    };

    beforeEach(() => {
        jest.clearAllMocks();
        
        // Mock Cortex services
        mockEncoderService = {
            getInstance: jest.fn(),
            initialize: jest.fn().mockResolvedValue(undefined),
            encode: jest.fn().mockResolvedValue(sampleCortexResults.encoding)
        } as any;

        mockCoreService = {
            getInstance: jest.fn(),
            initialize: jest.fn().mockResolvedValue(undefined),
            process: jest.fn().mockResolvedValue(sampleCortexResults.processing)
        } as any;

        mockDecoderService = {
            getInstance: jest.fn(),
            initialize: jest.fn().mockResolvedValue(undefined),
            decode: jest.fn().mockResolvedValue(sampleCortexResults.decoding)
        } as any;

        // Mock service instances
        (CortexEncoderService.getInstance as jest.Mock).mockReturnValue(mockEncoderService);
        (CortexCoreService.getInstance as jest.Mock).mockReturnValue(mockCoreService);
        (CortexDecoderService.getInstance as jest.Mock).mockReturnValue(mockDecoderService);

        // Mock database operations
        (Optimization.create as jest.Mock).mockResolvedValue({
            _id: 'opt123',
            userId: 'user123',
            originalPrompt: sampleOptimizationRequest.prompt,
            optimizedPrompt: sampleCortexResults.decoding.text,
            improvementPercentage: 25.5,
            costSaved: 0.003,
            tokensSaved: 12,
            metadata: { cortexEnabled: true }
        });

        (User.findByIdAndUpdate as jest.Mock).mockResolvedValue({});
        (Alert.create as jest.Mock).mockResolvedValue({});
    });

    // ========================================================================
    // CORTEX INTEGRATION TESTS
    // ========================================================================

    describe('Cortex Processing Integration', () => {
        test('should successfully process optimization with Cortex enabled', async () => {
            const result = await OptimizationService.createOptimization(sampleOptimizationRequest);

            expect(result).toBeDefined();
            expect(result.optimizedPrompt).toBe(sampleCortexResults.decoding.text);
            expect(result.metadata.cortexEnabled).toBe(true);
            
            // Verify Cortex services were called
            expect(mockEncoderService.encode).toHaveBeenCalledWith(
                expect.objectContaining({
                    text: sampleOptimizationRequest.prompt,
                    context: 'optimization processing'
                })
            );
            
            expect(mockCoreService.process).toHaveBeenCalledWith(
                expect.objectContaining({
                    input: sampleCortexResults.encoding.cortexStructure,
                    operation: 'optimize'
                })
            );
            
            expect(mockDecoderService.decode).toHaveBeenCalledWith(
                expect.objectContaining({
                    cortexStructure: sampleCortexResults.processing.output,
                    style: 'formal',
                    format: 'structured'
                })
            );
        });

        test('should fall back to traditional optimization when Cortex is disabled', async () => {
            const requestWithoutCortex = {
                ...sampleOptimizationRequest,
                options: {
                    enableCortex: false,
                    enableCompression: true
                }
            };

            const result = await OptimizationService.createOptimization(requestWithoutCortex);

            expect(result).toBeDefined();
            expect(result.metadata.cortexEnabled).toBe(false);
            
            // Verify Cortex services were NOT called
            expect(mockEncoderService.encode).not.toHaveBeenCalled();
            expect(mockCoreService.process).not.toHaveBeenCalled();
            expect(mockDecoderService.decode).not.toHaveBeenCalled();
        });

        test('should handle Cortex initialization failure gracefully', async () => {
            mockEncoderService.initialize.mockRejectedValue(new Error('Encoder init failed'));

            const result = await OptimizationService.createOptimization(sampleOptimizationRequest);

            expect(result).toBeDefined();
            expect(result.metadata.cortexEnabled).toBe(false);
            // Should fall back to traditional optimization
        });

        test('should handle Cortex processing errors with fallback', async () => {
            mockEncoderService.encode.mockRejectedValue(new Error('Encoding failed'));

            const result = await OptimizationService.createOptimization(sampleOptimizationRequest);

            expect(result).toBeDefined();
            // Should use original prompt when Cortex fails
            expect(result.optimizedPrompt).toContain('quarterly financial performance');
        });
    });

    // ========================================================================
    // CORTEX CONFIGURATION TESTS
    // ========================================================================

    describe('Cortex Configuration', () => {
        test('should use custom Cortex configuration when provided', async () => {
            const customConfig = {
                ...sampleOptimizationRequest,
                options: {
                    enableCortex: true,
                    cortexConfig: {
                        processingOperation: 'compress' as const,
                        outputStyle: 'technical' as const,
                        outputFormat: 'markdown' as const,
                        preserveSemantics: false
                    }
                }
            };

            await OptimizationService.createOptimization(customConfig);

            expect(mockCoreService.process).toHaveBeenCalledWith(
                expect.objectContaining({
                    operation: 'compress',
                    options: expect.objectContaining({
                        preserveSemantics: false
                    })
                })
            );

            expect(mockDecoderService.decode).toHaveBeenCalledWith(
                expect.objectContaining({
                    style: 'technical',
                    format: 'markdown'
                })
            );
        });

        test('should use default Cortex configuration when not specified', async () => {
            const minimalRequest = {
                ...sampleOptimizationRequest,
                options: {
                    enableCortex: true,
                    cortexConfig: {}
                }
            };

            await OptimizationService.createOptimization(minimalRequest);

            expect(mockCoreService.process).toHaveBeenCalledWith(
                expect.objectContaining({
                    operation: 'optimize'
                })
            );

            expect(mockDecoderService.decode).toHaveBeenCalledWith(
                expect.objectContaining({
                    style: 'conversational',
                    format: 'plain'
                })
            );
        });
    });

    // ========================================================================
    // CORTEX METADATA TESTS
    // ========================================================================

    describe('Cortex Metadata Tracking', () => {
        test('should include comprehensive Cortex metadata in optimization result', async () => {
            const result = await OptimizationService.createOptimization(sampleOptimizationRequest);

            expect(result.metadata).toMatchObject({
                cortexEnabled: true,
                cortexProcessingTime: expect.any(Number),
                cortexSemanticIntegrity: 0.94,
                cortexTokenReduction: expect.objectContaining({
                    originalTokens: expect.any(Number),
                    cortexTokens: expect.any(Number),
                    reductionPercentage: expect.any(Number)
                })
            });

            expect(result.metadata.cortex).toMatchObject({
                encodingConfidence: 0.92,
                optimizationsApplied: 1,
                decodingConfidence: 0.88,
                semanticIntegrity: 0.94
            });
        });

        test('should track Cortex optimization techniques', async () => {
            const result = await OptimizationService.createOptimization(sampleOptimizationRequest);

            expect(result.optimizationTechniques).toContain('cortex_processing');
            expect(result.metadata.appliedTechniques).toContain('cortex_processing');
        });

        test('should calculate accurate token savings with Cortex', async () => {
            const result = await OptimizationService.createOptimization(sampleOptimizationRequest);

            expect(result.tokensSaved).toBeGreaterThan(0);
            expect(result.improvementPercentage).toBeGreaterThan(0);
            expect(result.costSaved).toBeGreaterThan(0);
        });
    });

    // ========================================================================
    // CORTEX PERFORMANCE TESTS
    // ========================================================================

    describe('Cortex Performance', () => {
        test('should complete Cortex processing within reasonable time', async () => {
            const startTime = Date.now();
            await OptimizationService.createOptimization(sampleOptimizationRequest);
            const processingTime = Date.now() - startTime;

            expect(processingTime).toBeLessThan(10000); // Should complete within 10 seconds
        });

        test('should handle concurrent Cortex requests', async () => {
            const requests = Array(3).fill(sampleOptimizationRequest).map((req, i) => ({
                ...req,
                userId: `user${i + 1}`
            }));

            const results = await Promise.all(
                requests.map(req => OptimizationService.createOptimization(req))
            );

            expect(results).toHaveLength(3);
            results.forEach(result => {
                expect(result.metadata.cortexEnabled).toBe(true);
            });
        });
    });

    // ========================================================================
    // ERROR HANDLING TESTS
    // ========================================================================

    describe('Error Handling', () => {
        test('should handle malformed Cortex configuration', async () => {
            const malformedRequest = {
                ...sampleOptimizationRequest,
                options: {
                    enableCortex: true,
                    cortexConfig: {
                        processingOperation: 'invalid_operation' as any,
                        outputStyle: 'invalid_style' as any
                    }
                }
            };

            await expect(OptimizationService.createOptimization(malformedRequest))
                .resolves.toBeDefined();
        });

        test('should handle network failures in Cortex services', async () => {
            mockEncoderService.encode.mockRejectedValue(new Error('Network timeout'));

            const result = await OptimizationService.createOptimization(sampleOptimizationRequest);

            expect(result).toBeDefined();
            expect(result.metadata.cortex?.error).toBe('Cortex processing failed');
            expect(result.metadata.cortex?.fallbackUsed).toBe(true);
        });
    });

    // ========================================================================
    // INTEGRATION VALIDATION TESTS
    // ========================================================================

    describe('Integration Validation', () => {
        test('should maintain backward compatibility with existing optimization API', async () => {
            const traditionalRequest = {
                userId: 'user123',
                prompt: 'Test prompt',
                service: 'openai',
                model: 'gpt-3.5-turbo',
                options: {
                    enableCompression: true,
                    targetReduction: 20
                }
            };

            const result = await OptimizationService.createOptimization(traditionalRequest);

            expect(result).toBeDefined();
            expect(result.metadata.cortexEnabled).toBe(false);
            expect(result.originalPrompt).toBe(traditionalRequest.prompt);
        });

        test('should work with all AI providers when Cortex is enabled', async () => {
            const providers = ['openai', 'anthropic', 'aws-bedrock', 'google'];

            for (const provider of providers) {
                const request = {
                    ...sampleOptimizationRequest,
                    service: provider,
                    model: provider === 'openai' ? 'gpt-4' : 'claude-3-sonnet'
                };

                const result = await OptimizationService.createOptimization(request);
                
                expect(result).toBeDefined();
                expect(result.service).toBe(provider);
                expect(result.metadata.cortexEnabled).toBe(true);
            }
        });
    });
});
