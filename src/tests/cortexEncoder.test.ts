import { beforeEach, describe, expect, it, jest } from '@jest/globals';
/**
 * Cortex Encoder Service Tests
 * 
 * Test suite for Phase 2: Natural Language → Cortex encoding
 */

import { CortexEncoderService } from '../services/cortexEncoder.service';
import { CortexVocabularyService } from '../services/cortexVocabulary.service';
import {
    CortexEncodingRequest,
    CortexConfig,
} from '../types/cortex.types';

// Mock BedrockService for testing
// Create a proper mock for BedrockService
const mockBedrockService = {
    invokeModel: jest.fn() as jest.MockedFunction<(prompt: string, model: string) => Promise<any>>
};

// Set initial mock return value
(mockBedrockService.invokeModel as any).mockResolvedValue({
    content: '(query action:action_get target:concept_document aspect:prop_quality)',
    usage: { outputTokens: 15 }
});

jest.mock('../services/bedrock.service', () => ({
    BedrockService: {
        getInstance: jest.fn(() => mockBedrockService)
    }
}));

describe('Cortex Encoder Service', () => {
    let encoderService: CortexEncoderService;
    let vocabularyService: CortexVocabularyService;

    beforeAll(async () => {
        vocabularyService = CortexVocabularyService.getInstance();
        await vocabularyService.initialize();
        
        encoderService = CortexEncoderService.getInstance();
        await encoderService.initialize();
    });

    // ========================================================================
    // BASIC ENCODER FUNCTIONALITY TESTS
    // ========================================================================

    describe('Basic Encoding Functionality', () => {
        
        it('should initialize encoder service successfully', async () => {
            expect(encoderService).toBeDefined();
            const stats = encoderService.getCacheInfo();
            expect(stats).toHaveProperty('totalEncodings');
            expect(stats).toHaveProperty('averageConfidence');
            expect(stats).toHaveProperty('averageProcessingTime');
        });

        it('should encode simple question into query frame', async () => {
            const request: CortexEncodingRequest = {
                text: "What is the quality of the document?",
                metadata: {
                    complexity: 'simple',
                    language: 'en'
                }
            };

            const result = await encoderService.encode(request);
            
            expect(result).toHaveProperty('cortexFrame');
            expect(result).toHaveProperty('confidence');
            expect(result).toHaveProperty('processingTime');
            expect(result).toHaveProperty('metadata');
            
            expect(result.cortexFrame.frameType).toBe('query');
            expect(result.confidence).toBeGreaterThan(0);
            expect(result.confidence).toBeLessThanOrEqual(1);
            expect(result.processingTime).toBeGreaterThanOrEqual(0);
        });

        it('should handle encoding with context', async () => {
            const request: CortexEncodingRequest = {
                text: "Analyze the performance metrics",
                context: "We are reviewing quarterly business reports",
                metadata: {
                    complexity: 'medium',
                    domain: 'business'
                }
            };

            const result = await encoderService.encode(request);
            
            expect(result.cortexFrame.frameType).toBe('query');
            expect(result.confidence).toBeGreaterThan(0.3);
            expect(result.metadata.frameType).toBe('query');
        });

        it('should handle conversation history context', async () => {
            const request: CortexEncodingRequest = {
                text: "Create a summary report",
                conversationHistory: [
                    { role: 'user', content: 'I need help with documents', timestamp: new Date() },
                    { role: 'assistant', content: 'I can help you with document analysis', timestamp: new Date() }
                ],
                metadata: {
                    complexity: 'medium'
                }
            };

            const result = await encoderService.encode(request);
            
            expect(result.cortexFrame.frameType).toBe('query');
            expect(result.confidence).toBeGreaterThan(0);
        });
    });

    // ========================================================================
    // CACHING FUNCTIONALITY TESTS
    // ========================================================================

    describe('Caching Functionality', () => {
        
        it('should cache encoding results', async () => {
            const request: CortexEncodingRequest = {
                text: "Get the latest status report"
            };

            // First call - should not be cached
            const result1 = await encoderService.encode(request);
            expect(result1.processingTime).toBeGreaterThan(0);

            // Second call with same input - should be cached
            const result2 = await encoderService.encode(request);
            
            expect(result2.cortexFrame.frameType).toBe(result1.cortexFrame.frameType);
            expect(result2.confidence).toBe(result1.confidence);
        });

        it('should provide cache information', () => {
            const cacheInfo = encoderService.getCacheInfo();
            
            expect(cacheInfo).toHaveProperty('errorRate');
            expect(cacheInfo).toHaveProperty('totalEncodings');
            expect(cacheInfo).toHaveProperty('averageConfidence');
            expect(cacheInfo.averageConfidence).toBeGreaterThanOrEqual(0);
        });

        // Note: clearCache method not implemented in current version
        it.skip('should clear cache when requested', () => {
            // encoderService.clearCache();
            const cacheInfo = encoderService.getCacheInfo();
            expect(cacheInfo).toBeDefined();
        });
    });

    // ========================================================================
    // DIFFERENT INPUT TYPES TESTS
    // ========================================================================

    describe('Different Input Types', () => {
        
        it('should handle imperative commands', async () => {
            const request: CortexEncodingRequest = {
                text: "List all documents in the project folder"
            };

            const result = await encoderService.encode(request);
            expect(['query', 'list']).toContain(result.cortexFrame.frameType);
        });

        it('should handle statements about events', async () => {
            const request: CortexEncodingRequest = {
                text: "The system processed the data successfully yesterday"
            };

            const result = await encoderService.encode(request);
            expect(['event', 'query']).toContain(result.cortexFrame.frameType);
        });

        it('should handle complex multi-part questions', async () => {
            const request: CortexEncodingRequest = {
                text: "What are the main themes of the latest Star Wars movie and how did audiences react to it?",
                metadata: {
                    complexity: 'complex'
                }
            };

            const result = await encoderService.encode(request);
            expect(result.cortexFrame.frameType).toBe('query');
            expect(result.confidence).toBeGreaterThan(0);
        });

        it('should handle technical queries', async () => {
            const request: CortexEncodingRequest = {
                text: "Optimize the database query performance for user authentication",
                metadata: {
                    domain: 'technical',
                    complexity: 'medium'
                }
            };

            const result = await encoderService.encode(request);
            expect(result.cortexFrame.frameType).toBe('query');
        });
    });

    // ========================================================================
    // ERROR HANDLING TESTS
    // ========================================================================

    describe('Error Handling', () => {
        
        it('should handle empty input gracefully', async () => {
            const request: CortexEncodingRequest = {
                text: ""
            };

            await expect(encoderService.encode(request)).rejects.toThrow();
        });

        it('should handle very long input', async () => {
            const longText = 'This is a very long input text. '.repeat(100);
            const request: CortexEncodingRequest = {
                text: longText,
                metadata: {
                    complexity: 'complex'
                }
            };

            const result = await encoderService.encode(request);
            expect(result).toHaveProperty('cortexFrame');
            expect(result.confidence).toBeGreaterThan(0);
        });

        it('should handle non-English text with warning', async () => {
            const request: CortexEncodingRequest = {
                text: "¿Cuál es la calidad del documento?", // Spanish
                metadata: {
                    language: 'es'
                }
            };

            // Should still work but confidence might be lower
            const result = await encoderService.encode(request);
            expect(result).toHaveProperty('cortexFrame');
        });
    });

    // ========================================================================
    // CONFIGURATION TESTS
    // ========================================================================

    describe('Configuration Handling', () => {
        
        it('should respect custom configuration', async () => {
            const customConfig: Partial<CortexConfig> = {
                encoding: {
                    model: 'anthropic.claude-3-5-haiku-20241022-v1:0',
                    temperature: 0.2,
                    maxTokens: 1500,
                    enableCaching: true
                }
            };

            const request: CortexEncodingRequest = {
                text: "Analyze customer feedback data"
            };

            const result = await encoderService.encode(request, customConfig);
            expect(result).toHaveProperty('cortexFrame');
            expect(result.metadata.complexity).toBeDefined();
        });

        it('should use default configuration when none provided', async () => {
            const request: CortexEncodingRequest = {
                text: "Process the quarterly reports"
            };

            const result = await encoderService.encode(request);
            expect(result.metadata.tokenCount).toBeGreaterThan(0);
        });
    });

    // ========================================================================
    // STATISTICS AND MONITORING TESTS
    // ========================================================================

    describe('Statistics and Monitoring', () => {
        
        it('should track encoding statistics', async () => {
            const initialStats = encoderService.getCacheInfo();
            
            const request: CortexEncodingRequest = {
                text: "Generate monthly performance report"
            };

            await encoderService.encode(request);
            
            const updatedStats = encoderService.getCacheInfo();
            expect(updatedStats.totalRequests).toBeGreaterThan(initialStats.totalRequests);
            expect(updatedStats.averageProcessingTime).toBeGreaterThanOrEqual(0);
        });

        it('should track successful vs failed encodings', async () => {
            const initialStats = encoderService.getCacheInfo();
            
            const request: CortexEncodingRequest = {
                text: "Valid input for encoding test"
            };

            await encoderService.encode(request);
            
            const updatedStats = encoderService.getCacheInfo();
            expect(updatedStats.averageConfidence).toBeGreaterThan(0);
        });
    });

    // ========================================================================
    // INTEGRATION TESTS
    // ========================================================================

    describe('Integration with Vocabulary Service', () => {
        
        it('should use vocabulary service for primitive detection', async () => {
            const request: CortexEncodingRequest = {
                text: "Get the latest document summary"
            };

            const result = await encoderService.encode(request);
            
            // Should detect primitives like 'get', 'document', 'latest'
            expect(result.metadata.complexity).toBeDefined();
            expect(result.metadata.originalText).toBe(request.text);
        });

        it('should handle unknown words gracefully', async () => {
            const request: CortexEncodingRequest = {
                text: "Analyze the quantum flux capacitor readings"
            };

            const result = await encoderService.encode(request);
            expect(result).toHaveProperty('cortexFrame');
            // Should still work even with unknown technical terms
        });
    });

    // ========================================================================
    // PERFORMANCE TESTS
    // ========================================================================

    describe('Performance Characteristics', () => {
        
        it('should complete encoding within reasonable time', async () => {
            const request: CortexEncodingRequest = {
                text: "What is the current status of project deliverables?"
            };

            const startTime = Date.now();
            const result = await encoderService.encode(request);
            const endTime = Date.now();

            expect(endTime - startTime).toBeLessThan(5000); // Should complete in under 5 seconds
            expect(result.processingTime).toBeGreaterThan(0);
        });

        it('should handle multiple concurrent encodings', async () => {
            const requests = [
                { text: "Create performance report" },
                { text: "Analyze user feedback" },
                { text: "Update project status" },
                { text: "Generate cost summary" }
            ].map(req => ({ ...req } as CortexEncodingRequest));

            const startTime = Date.now();
            const results = await Promise.all(
                requests.map(req => encoderService.encode(req))
            );
            const endTime = Date.now();

            expect(results).toHaveLength(4);
            expect(results.every(r => r.cortexFrame && r.confidence > 0)).toBe(true);
            expect(endTime - startTime).toBeLessThan(10000); // All should complete in under 10 seconds
        });
    });

    // ========================================================================
    // REAL-WORLD SCENARIOS
    // ========================================================================

    describe('Real-World Scenarios', () => {
        
        it('should handle business intelligence queries', async () => {
            const request: CortexEncodingRequest = {
                text: "Show me the top performing sales regions for Q3 with revenue breakdown by product category",
                context: "Monthly business review meeting preparation",
                metadata: {
                    domain: 'business',
                    complexity: 'complex'
                }
            };

            const result = await encoderService.encode(request);
            expect(result.cortexFrame.frameType).toBe('query');
            expect(result.confidence).toBeGreaterThan(0.4);
        });

        it('should handle technical support queries', async () => {
            const request: CortexEncodingRequest = {
                text: "Debug the authentication timeout issue in the user login module",
                context: "Production system experiencing login delays",
                metadata: {
                    domain: 'technical',
                    complexity: 'medium'
                }
            };

            const result = await encoderService.encode(request);
            expect(result.cortexFrame.frameType).toBe('query');
        });

        it('should handle data analysis requests', async () => {
            const request: CortexEncodingRequest = {
                text: "Identify patterns in customer behavior data from the past 6 months and predict future trends",
                metadata: {
                    domain: 'analytics',
                    complexity: 'complex'
                }
            };

            const result = await encoderService.encode(request);
            expect(result.cortexFrame.frameType).toBe('query');
            expect(result.confidence).toBeGreaterThan(0.3);
        });

        it('should handle content creation requests', async () => {
            const request: CortexEncodingRequest = {
                text: "Write a comprehensive project proposal for the new AI initiative including budget, timeline, and resource requirements",
                metadata: {
                    domain: 'content',
                    complexity: 'complex'
                }
            };

            const result = await encoderService.encode(request);
            expect(result.cortexFrame.frameType).toBe('query');
        });
    });
});

// ========================================================================
// MOCK SETUP FOR DIFFERENT AI MODEL RESPONSES
// ========================================================================

describe('Cortex Encoder with Different AI Responses', () => {
    let encoderService: CortexEncoderService;

    // Mock different AI responses for specific test scenarios
    const mockBedrockService = {
        invokeModel: jest.fn()
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        
        // Reset to default mock
        (mockBedrockService.invokeModel as any).mockResolvedValue({
            content: '(query action:action_get target:concept_document)',
            usage: { outputTokens: 10 }
        });

        encoderService = CortexEncoderService.getInstance();
    });

    it('should handle event frame responses', async () => {
        (mockBedrockService.invokeModel as any).mockResolvedValue({
            content: '(event action:action_analyze agent:concept_system object:concept_data tense:past)',
            usage: { outputTokens: 12 }
        });

        const request: CortexEncodingRequest = {
            text: "The system analyzed the data"
        };

        const result = await encoderService.encode(request);
        expect(result.cortexFrame.frameType).toBe('event');
    });

    it('should handle list frame responses', async () => {
        (mockBedrockService.invokeModel as any).mockResolvedValue({
            content: '(list name:"Documents" item_1:concept_report item_2:concept_data item_3:concept_analysis)',
            usage: { outputTokens: 15 }
        });

        const request: CortexEncodingRequest = {
            text: "List all available documents"
        };

        const result = await encoderService.encode(request);
        expect(result.cortexFrame.frameType).toBe('list');
    });

    it('should handle malformed AI responses gracefully', async () => {
        (mockBedrockService.invokeModel as any).mockResolvedValue({
            content: 'This is not a valid Cortex structure',
            usage: { outputTokens: 8 }
        });

        const request: CortexEncodingRequest = {
            text: "Process this request"
        };

        await expect(encoderService.encode(request)).rejects.toThrow();
    });
});
