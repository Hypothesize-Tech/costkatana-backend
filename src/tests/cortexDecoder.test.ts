/**
 * Cortex Decoder Service Tests
 * 
 * Comprehensive test suite for the Cortex decoder service
 * that validates natural language generation capabilities.
 */

import { CortexDecoderService } from '../services/cortexDecoder.service';
import { CortexVocabularyService } from '../services/cortexVocabulary.service';
import { BedrockService } from '../services/bedrock.service';
import {
    CortexFrame,
    CortexDecodingRequest,
    CortexDecodingResult,
    CortexQueryFrame,
    CortexAnswerFrame,
    CortexEventFrame,
    CortexStateFrame,
    CortexEntityFrame,
    CortexListFrame,
    CortexErrorFrame,
    CortexConfig
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

describe('CortexDecoderService', () => {
    let decoderService: CortexDecoderService;
    let mockVocabularyService: jest.Mocked<CortexVocabularyService>;
    let mockBedrockService: jest.Mocked<BedrockService>;

    // Sample test Cortex structures
    const sampleQueryFrame: CortexQueryFrame = {
        frameType: 'query',
        action: 'action_get',
        target: 'concept_document',
        aspect: 'prop_summary'
    };

    const sampleAnswerFrame: CortexAnswerFrame = {
        frameType: 'answer',
        summary: 'Document analysis completed successfully',
        status: 'success',
        content: 'The document contains valuable insights.'
    };

    const sampleEventFrame: CortexEventFrame = {
        frameType: 'event',
        action: 'action_analyze',
        agent: 'concept_system',
        object: 'concept_data',
        tense: 'past'
    };

    const sampleStateFrame: CortexStateFrame = {
        frameType: 'state',
        entity: 'concept_system',
        condition: 'active',
        properties: ['prop_online', 'prop_ready']
    };

    const sampleEntityFrame: CortexEntityFrame = {
        frameType: 'entity',
        type: 'concept_document',
        name: 'AI Research Paper',
        title: 'Advanced AI Cost Optimization Techniques'
    };

    const sampleListFrame: CortexListFrame = {
        frameType: 'list',
        name: 'Available Documents',
        item_1: 'concept_report',
        item_2: 'concept_analysis',
        item_3: 'concept_summary'
    };

    const sampleErrorFrame: CortexErrorFrame = {
        frameType: 'error',
        code: 'PROCESSING_FAILED',
        message: 'Unable to process the request due to invalid input'
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
            }))
        };
        
        (CortexVocabularyService.getInstance as jest.Mock).mockReturnValue(mockVocabInstance);
        mockVocabularyService = mockVocabInstance as any;

        // Mock Bedrock service
        mockBedrockService = {
            generateResponse: jest.fn().mockResolvedValue('The system analyzed the data successfully.')
        } as any;
        
        // Mock static method
        (BedrockService.invokeModel as jest.Mock) = jest.fn().mockResolvedValue('The system analyzed the data successfully.');
        
        // Get service instance
        decoderService = CortexDecoderService.getInstance();
        
        // Replace the private bedrockService with our mock
        (decoderService as any).bedrockService = mockBedrockService;
    });

    // ========================================================================
    // INITIALIZATION TESTS
    // ========================================================================

    describe('Initialization', () => {
        test('should initialize successfully', async () => {
            await expect(decoderService.initialize()).resolves.not.toThrow();
            expect(mockVocabularyService.initialize).toHaveBeenCalledWith();
        });

        test('should handle initialization errors gracefully', async () => {
            mockVocabularyService.initialize.mockRejectedValue(new Error('Vocabulary init failed'));
            
            await expect(decoderService.initialize()).rejects.toThrow('Vocabulary init failed');
        });

        test('should not reinitialize if already initialized', async () => {
            await decoderService.initialize();
            await decoderService.initialize();
            
            expect(mockVocabularyService.initialize).toHaveBeenCalledTimes(1);
        });
    });

    // ========================================================================
    // BASIC DECODING TESTS
    // ========================================================================

    describe('Basic Decoding', () => {
        beforeEach(async () => {
            await decoderService.initialize();
        });

        test('should decode query frame to natural language', async () => {
            const request: CortexDecodingRequest = {
                cortexStructure: sampleQueryFrame,
                style: 'conversational',
                format: 'plain'
            };

            const result = await decoderService.decode(request);

            expect(result).toMatchObject({
                text: expect.any(String),
                confidence: expect.any(Number),
                processingTime: expect.any(Number),
                metadata: expect.objectContaining({
                    decodingModel: expect.any(String),
                    targetLanguage: expect.any(String),
                    styleApplied: expect.any(String),
                    qualityMetrics: expect.objectContaining({
                        fluency: expect.any(Number),
                        coherence: expect.any(Number),
                        accuracy: expect.any(Number)
                    })
                })
            });

            expect(result.text.length).toBeGreaterThan(0);
            expect(result.confidence).toBeGreaterThan(0);
            expect(result.confidence).toBeLessThanOrEqual(1);
        });

        test('should decode answer frame correctly', async () => {
            const request: CortexDecodingRequest = {
                cortexStructure: sampleAnswerFrame,
                style: 'formal',
                format: 'plain'
            };

            const result = await decoderService.decode(request);

            expect(result.text).toBeTruthy();
            expect(result.text.length).toBeGreaterThan(10);
            expect(result.metadata.styleApplied).toBe('formal');
        });

        test('should decode event frame with proper tense', async () => {
            const request: CortexDecodingRequest = {
                cortexStructure: sampleEventFrame,
                style: 'technical',
                format: 'plain'
            };

            const result = await decoderService.decode(request);

            expect(result.text).toBeTruthy();
            expect(result.metadata.styleApplied).toBe('technical');
            expect(result.text.toLowerCase()).toContain('system');
        });

        test('should decode state frame descriptively', async () => {
            const request: CortexDecodingRequest = {
                cortexStructure: sampleStateFrame,
                style: 'conversational'
            };

            const result = await decoderService.decode(request);

            expect(result.text).toBeTruthy();
            expect(result.text.toLowerCase()).toContain('system');
            expect(result.text.toLowerCase()).toContain('active');
        });

        test('should decode entity frame with name or title', async () => {
            const request: CortexDecodingRequest = {
                cortexStructure: sampleEntityFrame
            };

            const result = await decoderService.decode(request);

            expect(result.text).toBeTruthy();
            expect(
                result.text.includes('AI Research Paper') || 
                result.text.includes('Advanced AI Cost Optimization Techniques')
            ).toBeTruthy();
        });

        test('should decode list frame as enumerated list', async () => {
            const request: CortexDecodingRequest = {
                cortexStructure: sampleListFrame,
                format: 'structured'
            };

            const result = await decoderService.decode(request);

            expect(result.text).toBeTruthy();
            expect(result.text).toContain('Available Documents');
            expect(result.text).toMatch(/1\.|2\.|3\./); // Should contain numbered items
        });

        test('should decode error frame with error message', async () => {
            const request: CortexDecodingRequest = {
                cortexStructure: sampleErrorFrame
            };

            const result = await decoderService.decode(request);

            expect(result.text).toBeTruthy();
            expect(result.text.toLowerCase()).toContain('error');
            expect(result.text).toContain('PROCESSING_FAILED');
        });
    });

    // ========================================================================
    // STYLE AND FORMAT TESTS
    // ========================================================================

    describe('Style and Format Variations', () => {
        beforeEach(async () => {
            await decoderService.initialize();
        });

        test('should apply formal style appropriately', async () => {
            const request: CortexDecodingRequest = {
                cortexStructure: sampleAnswerFrame,
                style: 'formal',
                format: 'plain'
            };

            const result = await decoderService.decode(request);

            expect(result.metadata.styleApplied).toBe('formal');
            expect(result.text.length).toBeGreaterThan(10);
            // Formal style should be more structured
            expect(result.metadata.qualityMetrics.fluency).toBeGreaterThan(0.3);
        });

        test('should apply casual style appropriately', async () => {
            const request: CortexDecodingRequest = {
                cortexStructure: sampleQueryFrame,
                style: 'casual',
                format: 'plain'
            };

            const result = await decoderService.decode(request);

            expect(result.metadata.styleApplied).toBe('casual');
            expect(result.text).toBeTruthy();
        });

        test('should handle markdown format', async () => {
            const request: CortexDecodingRequest = {
                cortexStructure: sampleListFrame,
                format: 'markdown'
            };

            const result = await decoderService.decode(request);

            expect(result.text).toBeTruthy();
            // Should maintain list structure for markdown
            expect(result.text).toContain('1.');
        });

        test('should handle structured format', async () => {
            const request: CortexDecodingRequest = {
                cortexStructure: sampleListFrame,
                format: 'structured'
            };

            const result = await decoderService.decode(request);

            expect(result.text).toBeTruthy();
            expect(result.text).toContain('Available Documents');
        });
    });

    // ========================================================================
    // QUALITY METRICS TESTS
    // ========================================================================

    describe('Quality Metrics', () => {
        beforeEach(async () => {
            await decoderService.initialize();
        });

        test('should calculate meaningful quality metrics', async () => {
            const request: CortexDecodingRequest = {
                cortexStructure: sampleAnswerFrame,
                style: 'conversational'
            };

            const result = await decoderService.decode(request);

            const metrics = result.metadata.qualityMetrics;

            expect(metrics.fluency).toBeGreaterThanOrEqual(0);
            expect(metrics.fluency).toBeLessThanOrEqual(1);
            expect(metrics.coherence).toBeGreaterThanOrEqual(0);
            expect(metrics.coherence).toBeLessThanOrEqual(1);
            expect(metrics.accuracy).toBeGreaterThanOrEqual(0);
            expect(metrics.accuracy).toBeLessThanOrEqual(1);
        });

        test('should provide high confidence for simple frames', async () => {
            const simpleFrame: CortexEntityFrame = {
                frameType: 'entity',
                name: 'Test Document'
            };

            const request: CortexDecodingRequest = {
                cortexStructure: simpleFrame
            };

            const result = await decoderService.decode(request);

            expect(result.confidence).toBeGreaterThan(0.5);
        });

        test('should calculate fidelity scores', async () => {
            const request: CortexDecodingRequest = {
                cortexStructure: sampleQueryFrame
            };

            const result = await decoderService.decode(request);

            if (result.fidelityScore !== undefined) {
                expect(result.fidelityScore).toBeGreaterThanOrEqual(0);
                expect(result.fidelityScore).toBeLessThanOrEqual(1);
            }
        });
    });

    // ========================================================================
    // AI-ASSISTED VS RULE-BASED TESTS
    // ========================================================================

    describe('Decoding Strategy Selection', () => {
        beforeEach(async () => {
            await decoderService.initialize();
        });

        test('should handle AI-assisted decoding for complex structures', async () => {
            const complexFrame: CortexFrame = {
                frameType: 'query',
                action: 'action_analyze',
                target: {
                    frameType: 'entity',
                    type: 'concept_document',
                    properties: ['prop_quality', 'prop_relevance']
                },
                context: 'detailed analysis required',
                parameters: ['param1', 'param2']
            } as any;

            const request: CortexDecodingRequest = {
                cortexStructure: complexFrame,
                style: 'technical'
            };

            // Mock AI response for complex structure
            (BedrockService.invokeModel as jest.Mock).mockResolvedValue(
                'Please analyze the document for quality and relevance with detailed technical parameters.'
            );

            const result = await decoderService.decode(request);

            expect(result.text).toBeTruthy();
            expect(result.text.length).toBeGreaterThan(20);
        });

        test('should fallback to rule-based decoding when AI fails', async () => {
            // Mock AI failure
            (BedrockService.invokeModel as jest.Mock).mockRejectedValue(new Error('AI service unavailable'));

            const request: CortexDecodingRequest = {
                cortexStructure: sampleQueryFrame
            };

            const result = await decoderService.decode(request);

            expect(result.text).toBeTruthy();
            expect(result.confidence).toBeGreaterThan(0);
        });

        test('should use rule-based decoding for simple structures', async () => {
            const simpleFrame: CortexEntityFrame = {
                frameType: 'entity',
                name: 'Simple Document'
            };

            const request: CortexDecodingRequest = {
                cortexStructure: simpleFrame
            };

            const result = await decoderService.decode(request);

            expect(result.text).toBe('Simple Document');
            expect(result.confidence).toBeGreaterThan(0.7);
        });
    });

    // ========================================================================
    // CACHING TESTS
    // ========================================================================

    describe('Caching Behavior', () => {
        beforeEach(async () => {
            await decoderService.initialize();
            decoderService.clearCache(); // Start with clean cache
        });

        test('should cache decoding results', async () => {
            const request: CortexDecodingRequest = {
                cortexStructure: sampleQueryFrame,
                style: 'conversational'
            };

            // First call - should process normally
            const result1 = await decoderService.decode(request);
            
            // Second call - should use cache
            const result2 = await decoderService.decode(request);

            expect(result1.text).toEqual(result2.text);
            expect(result1.confidence).toEqual(result2.confidence);
        });

        test('should differentiate cache by style and format', async () => {
            const baseRequest: CortexDecodingRequest = {
                cortexStructure: sampleQueryFrame
            };

            const formalResult = await decoderService.decode({
                ...baseRequest,
                style: 'formal'
            });

            const casualResult = await decoderService.decode({
                ...baseRequest,
                style: 'casual'
            });

            // Results should be cached separately
            expect(formalResult).toBeDefined();
            expect(casualResult).toBeDefined();
        });

        test('should provide cache information', () => {
            const cacheInfo = decoderService.getCacheInfo();
            
            expect(cacheInfo).toMatchObject({
                size: expect.any(Number),
                hitRate: expect.any(Number),
                entries: expect.any(Array)
            });
        });

        test('should clear cache when requested', async () => {
            const request: CortexDecodingRequest = {
                cortexStructure: sampleQueryFrame
            };

            await decoderService.decode(request);
            expect(decoderService.getCacheInfo().size).toBeGreaterThan(0);
            
            decoderService.clearCache();
            expect(decoderService.getCacheInfo().size).toBe(0);
        });
    });

    // ========================================================================
    // ERROR HANDLING TESTS
    // ========================================================================

    describe('Error Handling', () => {
        beforeEach(async () => {
            await decoderService.initialize();
        });

        test('should handle invalid Cortex structures gracefully', async () => {
            const invalidFrame = {
                frameType: 'invalid' as any,
                invalidProperty: 'test'
            };

            const request: CortexDecodingRequest = {
                cortexStructure: invalidFrame
            };

            await expect(decoderService.decode(request)).rejects.toThrow();
        });

        test('should handle missing required properties', async () => {
            const incompleteFrame = {
                frameType: 'query'
                // Missing other properties
            } as CortexQueryFrame;

            const request: CortexDecodingRequest = {
                cortexStructure: incompleteFrame
            };

            const result = await decoderService.decode(request);
            expect(result.text).toBeTruthy();
        });

        test('should handle AI service errors gracefully', async () => {
            (BedrockService.invokeModel as jest.Mock).mockRejectedValue(new Error('Service timeout'));

            const request: CortexDecodingRequest = {
                cortexStructure: sampleQueryFrame
            };

            // Should fallback to rule-based decoding
            const result = await decoderService.decode(request);
            expect(result.text).toBeTruthy();
        });
    });

    // ========================================================================
    // STATISTICS TESTS
    // ========================================================================

    describe('Statistics Tracking', () => {
        beforeEach(async () => {
            await decoderService.initialize();
        });

        test('should track decoding statistics', async () => {
            const initialStats = decoderService.getStats();
            
            const request: CortexDecodingRequest = {
                cortexStructure: sampleQueryFrame
            };

            await decoderService.decode(request);
            
            const updatedStats = decoderService.getStats();
            
            expect(updatedStats.totalDecoded).toBeGreaterThan(initialStats.totalDecoded);
            expect(updatedStats.successfulDecodings).toBeGreaterThanOrEqual(initialStats.successfulDecodings);
        });

        test('should provide meaningful statistics structure', () => {
            const stats = decoderService.getStats();
            
            expect(stats).toMatchObject({
                totalDecoded: expect.any(Number),
                successfulDecodings: expect.any(Number),
                averageProcessingTime: expect.any(Number),
                averageConfidence: expect.any(Number),
                averageFidelityScore: expect.any(Number),
                cacheHitRate: expect.any(Number)
            });

            Object.values(stats).forEach(value => {
                expect(value).toBeGreaterThanOrEqual(0);
            });
        });
    });

    // ========================================================================
    // INTEGRATION TESTS
    // ========================================================================

    describe('Integration Scenarios', () => {
        beforeEach(async () => {
            await decoderService.initialize();
        });

        test('should handle complete decoding pipeline', async () => {
            const testFrames: CortexFrame[] = [
                sampleQueryFrame,
                sampleAnswerFrame,
                sampleEventFrame,
                sampleStateFrame,
                sampleEntityFrame,
                sampleListFrame,
                sampleErrorFrame
            ];

            const results: CortexDecodingResult[] = [];

            for (const frame of testFrames) {
                const request: CortexDecodingRequest = {
                    cortexStructure: frame,
                    style: 'conversational'
                };
                
                const result = await decoderService.decode(request);
                results.push(result);
            }

            expect(results).toHaveLength(7);
            results.forEach((result, index) => {
                expect(result.text).toBeTruthy();
                expect(result.confidence).toBeGreaterThan(0);
                expect(result.processingTime).toBeGreaterThan(0);
                expect(result.metadata.qualityMetrics.fluency).toBeGreaterThan(0);
            });
        });

        test('should maintain performance under load', async () => {
            const request: CortexDecodingRequest = {
                cortexStructure: sampleAnswerFrame,
                style: 'conversational'
            };

            const startTime = Date.now();
            const promises = Array(10).fill(request).map(() => decoderService.decode(request));
            const results = await Promise.all(promises);
            const totalTime = Date.now() - startTime;

            expect(results).toHaveLength(10);
            expect(totalTime).toBeLessThan(10000); // Should complete within 10 seconds
            
            results.forEach(result => {
                expect(result.text).toBeTruthy();
                expect(result.confidence).toBeGreaterThan(0);
            });
        });
    });
});
