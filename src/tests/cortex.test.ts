/**
 * Cortex Core Infrastructure Tests
 * 
 * Test suite for Phase 1: Core types, vocabulary service, and utilities
 */

import {
    CortexFrame,
    CortexQueryFrame,
    CortexAnswerFrame,
    CortexEventFrame,
    CortexStateFrame,
    CortexEntityFrame,
    CortexListFrame,
    CortexErrorFrame,
    CortexError,
    CortexErrorCode,
    isCortexFrame,
    isQueryFrame,
    isAnswerFrame,
    isEventFrame,
    isStateFrame,
    isEntityFrame,
    isListFrame,
    isErrorFrame,
    DEFAULT_CORTEX_CONFIG
} from '../types/cortex.types';

import { CortexVocabularyService } from '../services/cortexVocabulary.service';

import {
    parseCortexString,
    serializeCortexFrame,
    validateCortexFrame,
    extractReferences,
    resolveReference,
    resolveAllReferences,
    compressCortexFrame,
    calculateSemanticSimilarity,
    generateCortexHash,
    describeCortexFrame,
    prettifysCortexFrame,
    analyzeCortexFrame,
    ValidationResult
} from '../utils/cortex.utils';

describe('Cortex Core Infrastructure', () => {

    // ========================================================================
    // PHASE 1.1: TYPES AND INTERFACES TESTS
    // ========================================================================

    describe('Phase 1.1: Core Types and Interfaces', () => {
        
        it('should create valid CortexQueryFrame', () => {
            const queryFrame: CortexQueryFrame = {
                frameType: 'query',
                action: 'action_get',
                target: 'concept_document',
                question: 'What are the main points?'
            };

            expect(queryFrame.frameType).toBe('query');
            expect(queryFrame.action).toBe('action_get');
            expect(queryFrame.target).toBe('concept_document');
            expect(queryFrame.question).toBe('What are the main points?');
            expect(isCortexFrame(queryFrame)).toBe(true);
            expect(isQueryFrame(queryFrame)).toBe(true);
        });

        it('should create valid CortexAnswerFrame', () => {
            const answerFrame: CortexAnswerFrame = {
                frameType: 'answer',
                for_task: 'task_1',
                status: 'success',
                summary: 'Document analysis complete',
                content: 'The document contains three main sections...'
            };

            expect(answerFrame.frameType).toBe('answer');
            expect(answerFrame.for_task).toBe('task_1');
            expect(answerFrame.status).toBe('success');
            expect(isCortexFrame(answerFrame)).toBe(true);
            expect(isAnswerFrame(answerFrame)).toBe(true);
        });

        it('should create valid CortexEventFrame', () => {
            const eventFrame: CortexEventFrame = {
                frameType: 'event',
                action: 'action_analyze',
                agent: 'concept_person',
                object: 'concept_document',
                tense: 'past',
                time: '2024-01-09',
                reason: 'prop_quality'
            };

            expect(eventFrame.frameType).toBe('event');
            expect(eventFrame.action).toBe('action_analyze');
            expect(eventFrame.tense).toBe('past');
            expect(isCortexFrame(eventFrame)).toBe(true);
            expect(isEventFrame(eventFrame)).toBe(true);
        });

        it('should create valid CortexStateFrame', () => {
            const stateFrame: CortexStateFrame = {
                frameType: 'state',
                entity: 'concept_document',
                properties: ['prop_status', 'prop_quality'],
                condition: 'analyzed'
            };

            expect(stateFrame.frameType).toBe('state');
            expect(stateFrame.entity).toBe('concept_document');
            expect(Array.isArray(stateFrame.properties)).toBe(true);
            expect(isCortexFrame(stateFrame)).toBe(true);
            expect(isStateFrame(stateFrame)).toBe(true);
        });

        it('should create valid CortexEntityFrame', () => {
            const entityFrame: CortexEntityFrame = {
                frameType: 'entity',
                name: 'John Doe',
                title: 'Senior Analyst',
                type: 'concept_person',
                properties: ['prop_name', 'prop_title']
            };

            expect(entityFrame.frameType).toBe('entity');
            expect(entityFrame.name).toBe('John Doe');
            expect(entityFrame.type).toBe('concept_person');
            expect(isCortexFrame(entityFrame)).toBe(true);
            expect(isEntityFrame(entityFrame)).toBe(true);
        });

        it('should create valid CortexListFrame', () => {
            const listFrame: CortexListFrame = {
                frameType: 'list',
                name: 'Documents',
                item_1: 'concept_document',
                item_2: 'concept_report',
                item_3: 'concept_data'
            };

            expect(listFrame.frameType).toBe('list');
            expect(listFrame.name).toBe('Documents');
            expect(listFrame.item_1).toBe('concept_document');
            expect(isCortexFrame(listFrame)).toBe(true);
            expect(isListFrame(listFrame)).toBe(true);
        });

        it('should create valid CortexErrorFrame', () => {
            const errorFrame: CortexErrorFrame = {
                frameType: 'error',
                code: 'PROCESSING_FAILED',
                message: 'Unable to process the request',
                details: 'Insufficient data provided'
            };

            expect(errorFrame.frameType).toBe('error');
            expect(errorFrame.code).toBe('PROCESSING_FAILED');
            expect(errorFrame.message).toBe('Unable to process the request');
            expect(isCortexFrame(errorFrame)).toBe(true);
            expect(isErrorFrame(errorFrame)).toBe(true);
        });

        it('should validate CortexError class', () => {
            const error = new CortexError(
                CortexErrorCode.ENCODING_FAILED,
                'Failed to encode input',
                'encoding',
                { input: 'test data' }
            );

            expect(error.code).toBe(CortexErrorCode.ENCODING_FAILED);
            expect(error.message).toBe('Failed to encode input');
            expect(error.stage).toBe('encoding');
            expect(error.context).toEqual({ input: 'test data' });
            expect(error.name).toBe('CortexError');
            expect(error instanceof Error).toBe(true);
        });

        it('should validate default Cortex configuration', () => {
            expect(DEFAULT_CORTEX_CONFIG.encoding.model).toBe('anthropic.claude-3-haiku-20240307-v1:0');
            expect(DEFAULT_CORTEX_CONFIG.coreProcessing.optimizationLevel).toBe('balanced');
            expect(DEFAULT_CORTEX_CONFIG.decoding.qualityThreshold).toBe(0.85);
            expect(DEFAULT_CORTEX_CONFIG.caching.enabled).toBe(true);
            expect(DEFAULT_CORTEX_CONFIG.monitoring.enableMetrics).toBe(true);
        });
    });

    // ========================================================================
    // PHASE 1.2: VOCABULARY SERVICE TESTS
    // ========================================================================

    describe('Phase 1.2: Cortex Vocabulary Service', () => {
        let vocabularyService: CortexVocabularyService;

        beforeEach(async () => {
            vocabularyService = CortexVocabularyService.getInstance();
            await vocabularyService.initialize();
        });

        it('should initialize vocabulary service successfully', () => {
            const stats = vocabularyService.getVocabularyStats();
            expect(stats.actions).toBeGreaterThan(0);
            expect(stats.concepts).toBeGreaterThan(0);
            expect(stats.properties).toBeGreaterThan(0);
            expect(stats.modifiers).toBeGreaterThan(0);
            expect(stats.total).toBe(stats.actions + stats.concepts + stats.properties + stats.modifiers);
            expect(stats.cacheSize).toBeGreaterThan(stats.total);
        });

        it('should find primitives for known words', () => {
            const getPrimitive = vocabularyService.findPrimitive('get');
            const summarizePrimitive = vocabularyService.findPrimitive('summarize');
            const documentPrimitive = vocabularyService.findPrimitive('document');
            const latestPrimitive = vocabularyService.findPrimitive('latest');

            expect(getPrimitive).toBe('action_get');
            expect(summarizePrimitive).toBe('action_summarize');
            expect(documentPrimitive).toBe('concept_document');
            expect(latestPrimitive).toBe('mod_latest');
        });

        it('should find primitives by aliases', () => {
            const fetchPrimitive = vocabularyService.findPrimitive('fetch');
            const obtainPrimitive = vocabularyService.findPrimitive('obtain');
            const filePrimitive = vocabularyService.findPrimitive('file');
            const newestPrimitive = vocabularyService.findPrimitive('newest');

            expect(fetchPrimitive).toBe('action_get');
            expect(obtainPrimitive).toBe('action_get');
            expect(filePrimitive).toBe('concept_document');
            expect(newestPrimitive).toBe('mod_latest');
        });

        it('should return null for unknown words', () => {
            const unknownPrimitive = vocabularyService.findPrimitive('xyzabc123');
            expect(unknownPrimitive).toBeNull();
        });

        it('should find multiple primitives at once', () => {
            const words = ['get', 'document', 'latest', 'unknown'];
            const results = vocabularyService.findPrimitives(words);

            expect(results).toHaveLength(4);
            expect(results[0]).toEqual({ word: 'get', primitive: 'action_get' });
            expect(results[1]).toEqual({ word: 'document', primitive: 'concept_document' });
            expect(results[2]).toEqual({ word: 'latest', primitive: 'mod_latest' });
            expect(results[3]).toEqual({ word: 'unknown', primitive: null });
        });

        it('should detect frame types correctly', () => {
            expect(vocabularyService.detectFrameType('What is the status?')).toBe('query');
            expect(vocabularyService.detectFrameType('Who created this document?')).toBe('query');
            expect(vocabularyService.detectFrameType('The system processed the data')).toBe('event');
            expect(vocabularyService.detectFrameType('The document is ready')).toBe('state');
            expect(vocabularyService.detectFrameType('List all documents')).toBe('list');
            expect(vocabularyService.detectFrameType('Error: processing failed')).toBe('error');
        });

        it('should extract semantic roles from text', () => {
            const roles = vocabularyService.extractRoles('What documents did John create yesterday?');
            
            const targetRole = roles.find(r => r.role === 'target');
            const agentRole = roles.find(r => r.role === 'agent');
            
            expect(targetRole).toBeDefined();
            expect(targetRole?.value).toBe('what');
            expect(targetRole?.confidence).toBe(0.8);
            
            expect(agentRole).toBeDefined();
            expect(agentRole?.value).toBe('John');
        });

        it('should get frame templates', () => {
            const queryTemplate = vocabularyService.getFrameTemplate('information_request');
            const answerTemplate = vocabularyService.getFrameTemplate('simple_answer');
            
            expect(queryTemplate?.frameType).toBe('query');
            expect(queryTemplate?.action).toBe('action_get');
            
            expect(answerTemplate?.frameType).toBe('answer');
            expect(answerTemplate?.status).toBe('success');
        });

        it('should search primitives by category', () => {
            const actionResults = vocabularyService.searchPrimitives('action', 'get');
            const conceptResults = vocabularyService.searchPrimitives('concept', 'document');
            
            expect(actionResults).toContain('action_get');
            expect(conceptResults).toContain('concept_document');
        });

        it('should suggest similar primitives', () => {
            const suggestions = vocabularyService.suggestPrimitives('analyz', 3);
            const analyzeSuggestion = suggestions.find(s => s.primitive === 'action_analyze');
            
            expect(suggestions.length).toBeGreaterThan(0);
            expect(analyzeSuggestion).toBeDefined();
            expect(analyzeSuggestion!.score).toBeGreaterThan(0);
        });

        it('should validate known primitives', () => {
            expect(vocabularyService.isValidPrimitive('action_get')).toBe(true);
            expect(vocabularyService.isValidPrimitive('concept_document')).toBe(true);
            expect(vocabularyService.isValidPrimitive('invalid_primitive')).toBe(false);
        });
    });

    // ========================================================================
    // PHASE 1.3: UTILITIES TESTS
    // ========================================================================

    describe('Phase 1.3: Cortex Utilities', () => {

        describe('Parsing and Serialization', () => {
            it('should parse simple Cortex string', () => {
                const cortexString = '(query action:action_get target:concept_document)';
                const frame = parseCortexString(cortexString);

                expect(frame.frameType).toBe('query');
                expect((frame as any).action).toBe('action_get');
                expect((frame as any).target).toBe('concept_document');
            });

            it('should parse Cortex string with nested frames', () => {
                const cortexString = '(query target:(entity name:"John Doe" type:concept_person))';
                const frame = parseCortexString(cortexString);

                expect(frame.frameType).toBe('query');
                expect((frame as any).target).toBeDefined();
                expect(isCortexFrame((frame as any).target)).toBe(true);
                expect(((frame as any).target as any).name).toBe('John Doe');
            });

            it('should parse Cortex string with arrays', () => {
                const cortexString = '(state entity:concept_document properties:[prop_name, prop_status, prop_quality])';
                const frame = parseCortexString(cortexString);

                expect(frame.frameType).toBe('state');
                expect(Array.isArray((frame as any).properties)).toBe(true);
                expect((frame as any).properties).toContain('prop_name');
                expect((frame as any).properties).toContain('prop_status');
                expect((frame as any).properties).toContain('prop_quality');
            });

            it('should serialize frame back to Cortex string', () => {
                const frame: CortexQueryFrame = {
                    frameType: 'query',
                    action: 'action_get',
                    target: 'concept_document',
                    question: 'What is the status?'
                };

                const serialized = serializeCortexFrame(frame);
                expect(serialized).toContain('(query');
                expect(serialized).toContain('action:action_get');
                expect(serialized).toContain('target:concept_document');
                expect(serialized).toContain('question:"What is the status?"');
            });

            it('should handle parsing errors gracefully', () => {
                expect(() => parseCortexString('invalid cortex string')).toThrow(CortexError);
                expect(() => parseCortexString('(incomplete')).toThrow(CortexError);
                expect(() => parseCortexString('')).toThrow(CortexError);
            });
        });

        describe('Validation', () => {
            it('should validate correct frames as valid', () => {
                const validQuery: CortexQueryFrame = {
                    frameType: 'query',
                    action: 'action_get',
                    target: 'concept_document'
                };

                const result = validateCortexFrame(validQuery);
                expect(result.isValid).toBe(true);
                expect(result.errors).toHaveLength(0);
                expect(result.frameType).toBe('query');
                expect(result.complexity).toBeGreaterThan(0);
            });

            it('should identify validation errors', () => {
                const invalidEvent: any = {
                    frameType: 'event',
                    // Missing required 'action' property
                    agent: 'concept_person'
                };

                const result = validateCortexFrame(invalidEvent);
                expect(result.isValid).toBe(false);
                expect(result.errors.length).toBeGreaterThan(0);
                expect(result.errors[0].code).toBe('MISSING_ACTION');
            });

            it('should provide warnings for incomplete structures', () => {
                const incompleteQuery: CortexQueryFrame = {
                    frameType: 'query'
                    // Missing target, question, or task
                };

                const result = validateCortexFrame(incompleteQuery);
                expect(result.warnings.length).toBeGreaterThan(0);
                expect(result.warnings[0].code).toBe('INCOMPLETE_QUERY');
            });
        });

        describe('Reference Resolution', () => {
            it('should extract references from frames', () => {
                const frame: CortexQueryFrame = {
                    frameType: 'query',
                    action: 'action_get',
                    target: '$task_1.result',
                    source: '$previous.output'
                };

                const references = extractReferences(frame);
                expect(references).toContain('$task_1.result');
                expect(references).toContain('$previous.output');
                expect(references).toHaveLength(2);
            });

            it('should resolve valid references', () => {
                const contextFrame: any = {
                    frameType: 'answer',
                    task_1: {
                        result: 'Success'
                    }
                };

                const resolvedValue = resolveReference('$task_1.result', contextFrame as CortexFrame);
                expect(resolvedValue).toBe('Success');
            });

            it('should return null for invalid references', () => {
                const contextFrame: any = {
                    frameType: 'answer',
                    task_1: {
                        result: 'Success'
                    }
                };

                const resolvedValue = resolveReference('$invalid.reference', contextFrame as CortexFrame);
                expect(resolvedValue).toBeNull();
            });

            it('should resolve all references in a frame', () => {
                const contextFrame = {
                    frameType: 'answer',
                    task_1: { result: 'Document found' },
                    previous: { status: 'completed' }
                } as unknown as CortexFrame;

                const frameWithRefs = {
                    frameType: 'query',
                    target: '$task_1.result',
                    status: '$previous.status'
                } as unknown as CortexQueryFrame;

                const resolved = resolveAllReferences(frameWithRefs);
                expect((resolved as any).target).toBe('Document found');
                expect((resolved as any).status).toBe('completed');
            });
        });

        describe('Optimization and Analysis', () => {
            it('should compress frames by removing empty arrays', () => {
                const frame: any = {
                    frameType: 'state',
                    entity: 'concept_document',
                    properties: [],
                    emptyArray: [],
                    validProperty: 'test'
                };

                const compressed = compressCortexFrame(frame);
                expect(compressed.properties).toBeUndefined();
                expect(compressed.emptyArray).toBeUndefined();
                expect((compressed as any).validProperty).toBe('test');
            });

            it('should calculate semantic similarity', () => {
                const frame1: CortexQueryFrame = {
                    frameType: 'query',
                    action: 'action_get',
                    target: 'concept_document'
                };

                const frame2: CortexQueryFrame = {
                    frameType: 'query',
                    action: 'action_get',
                    target: 'concept_document'
                };

                const frame3: CortexAnswerFrame = {
                    frameType: 'answer',
                    content: 'Some content'
                };

                const similarity1 = calculateSemanticSimilarity(frame1, frame2);
                const similarity2 = calculateSemanticSimilarity(frame1, frame3);

                expect(similarity1).toBe(1.3); // Exact match with bonus
                expect(similarity2).toBe(0.0); // Different frame types
            });

            it('should generate consistent hashes', () => {
                const frame: CortexQueryFrame = {
                    frameType: 'query',
                    action: 'action_get',
                    target: 'concept_document'
                };

                const hash1 = generateCortexHash(frame);
                const hash2 = generateCortexHash(frame);
                
                expect(hash1).toBe(hash2);
                expect(hash1).toMatch(/^[a-f0-9]+$/); // Hexadecimal string
            });

            it('should describe frames in human-readable format', () => {
                const queryFrame: CortexQueryFrame = {
                    frameType: 'query',
                    action: 'action_get',
                    target: 'concept_document'
                };

                const description = describeCortexFrame(queryFrame);
                expect(description).toContain('Query requesting');
                expect(description).toContain('action_get');
                expect(description).toContain('concept_document');
            });

            it('should prettify frames for debugging', () => {
                const frame: CortexQueryFrame = {
                    frameType: 'query',
                    action: 'action_get',
                    target: 'concept_document'
                };

                const pretty = prettifysCortexFrame(frame);
                expect(pretty).toContain('(query:');
                expect(pretty).toContain('action: action_get');
                expect(pretty).toContain('target: concept_document');
                expect(pretty).toContain(')');
            });

            it('should analyze frame comprehensively', () => {
                const frame: CortexQueryFrame = {
                    frameType: 'query',
                    action: 'action_get',
                    target: 'concept_document'
                };

                const analysis = analyzeCortexFrame(frame);
                
                expect(analysis.frameType).toBe('query');
                expect(analysis.isValid).toBe(true);
                expect(analysis.complexity).toBeGreaterThan(0);
                expect(analysis.hash).toBeDefined();
                expect(analysis.description).toContain('Query requesting');
                expect(analysis.serializedSize).toBeGreaterThan(0);
                expect(analysis.validation.isValid).toBe(true);
                expect(Array.isArray(analysis.references)).toBe(true);
            });
        });
    });
});

// ========================================================================
// PHASE 1 INTEGRATION TEST
// ========================================================================

describe('Phase 1 Integration: Core Infrastructure Working Together', () => {
    let vocabularyService: CortexVocabularyService;

    beforeAll(async () => {
        vocabularyService = CortexVocabularyService.getInstance();
        await vocabularyService.initialize();
    });

    it('should process complete Cortex workflow with all components', async () => {
        // 1. Use vocabulary service to build a frame
        const actionPrimitive = vocabularyService.findPrimitive('analyze');
        const conceptPrimitive = vocabularyService.findPrimitive('document');
        const propertyPrimitive = vocabularyService.findPrimitive('quality');
        
        expect(actionPrimitive).toBe('action_analyze');
        expect(conceptPrimitive).toBe('concept_document');
        expect(propertyPrimitive).toBe('prop_quality');

        // 2. Create a complex frame structure
        const complexFrame: CortexQueryFrame = {
            frameType: 'query',
            action: actionPrimitive!,
            target: {
                frameType: 'entity',
                type: conceptPrimitive!,
                properties: [propertyPrimitive!, 'prop_status']
            },
            question: 'What is the quality assessment?',
            format: 'summary'
        };

        // 3. Validate the frame
        const validation = validateCortexFrame(complexFrame);
        expect(validation.isValid).toBe(true);
        expect(validation.errors).toHaveLength(0);
        expect(validation.complexity).toBeGreaterThan(2);

        // 4. Serialize and parse round-trip
        const serialized = serializeCortexFrame(complexFrame);
        expect(serialized).toContain('(query');
        expect(serialized).toContain('action:action_analyze');
        
        const parsed = parseCortexString(serialized);
        expect(parsed.frameType).toBe('query');
        expect((parsed as any).action).toBe('action_analyze');

        // 5. Analyze the frame
        const analysis = analyzeCortexFrame(complexFrame);
        expect(analysis.frameType).toBe('query');
        expect(analysis.isValid).toBe(true);
        expect(analysis.complexity).toBeGreaterThan(2);
        expect(analysis.referenceCount).toBe(0);

        // 6. Test compression
        const compressed = compressCortexFrame(complexFrame);
        expect(compressed.frameType).toBe('query');

        // 7. Generate hash for caching
        const hash = generateCortexHash(complexFrame);
        expect(hash).toMatch(/^[a-f0-9]+$/);

        // Test passed - all Phase 1 components work together
        console.log('✅ Phase 1 Integration Test Passed');
        console.log(`   - Vocabulary loaded: ${vocabularyService.getVocabularyStats().total} primitives`);
        console.log(`   - Frame complexity: ${analysis.complexity}`);
        console.log(`   - Serialized size: ${analysis.serializedSize} characters`);
        console.log(`   - Frame hash: ${hash}`);
    });

    it('should handle error scenarios gracefully', () => {
        // Test error handling across all components
        expect(() => parseCortexString('invalid')).toThrow(CortexError);
        
        const invalidFrame: any = { frameType: 'invalid_type' };
        const validation = validateCortexFrame(invalidFrame);
        expect(validation.isValid).toBe(false);
        expect(validation.errors.length).toBeGreaterThan(0);

        // Test unknown primitive suggestions
        const suggestions = vocabularyService.suggestPrimitives('unknownword');
        expect(Array.isArray(suggestions)).toBe(true);
    });

    it('should demonstrate performance characteristics', async () => {
        const startTime = Date.now();
        
        // Perform multiple operations to test performance
        for (let i = 0; i < 100; i++) {
            const primitive = vocabularyService.findPrimitive('get');
            expect(primitive).toBe('action_get');
        }
        
        const vocabularyLookupTime = Date.now() - startTime;
        
        // Test parsing performance
        const parseStartTime = Date.now();
        const cortexString = '(query action:action_get target:concept_document format:"json")';
        
        for (let i = 0; i < 100; i++) {
            const frame = parseCortexString(cortexString);
            expect(frame.frameType).toBe('query');
        }
        
        const parsingTime = Date.now() - parseStartTime;
        
        // Test validation performance
        const validationStartTime = Date.now();
        const testFrame: CortexQueryFrame = {
            frameType: 'query',
            action: 'action_get',
            target: 'concept_document'
        };
        
        for (let i = 0; i < 100; i++) {
            const validation = validateCortexFrame(testFrame);
            expect(validation.isValid).toBe(true);
        }
        
        const validationTime = Date.now() - validationStartTime;
        
        // Performance should be reasonable (these are loose bounds)
        expect(vocabularyLookupTime).toBeLessThan(100);
        expect(parsingTime).toBeLessThan(500);
        expect(validationTime).toBeLessThan(200);
        
        console.log('📊 Phase 1 Performance Metrics:');
        console.log(`   - 100 vocabulary lookups: ${vocabularyLookupTime}ms`);
        console.log(`   - 100 frame parsing operations: ${parsingTime}ms`);
        console.log(`   - 100 frame validations: ${validationTime}ms`);
    });
});
