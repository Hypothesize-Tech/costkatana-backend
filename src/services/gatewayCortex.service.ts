import { Request, Response } from 'express';
import { loggingService } from './logging.service';
import { CortexCacheService } from './cortexCache.service';
import { CortexEncoderService } from './cortexEncoder.service';
import { CortexCoreService } from './cortexCore.service';
import { CortexDecoderService } from './cortexDecoder.service';
import { CortexModelRouterService, RoutingPreferences } from './cortexModelRouter.service';
import { CortexBinarySerializerService, BinaryCompressionOptions } from './cortexBinarySerializer.service';
import { CortexSchemaValidatorService, ValidationResult } from './cortexSchemaValidator.service';
import { CortexControlFlowService, ControlFlowExecutionResult } from './cortexControlFlow.service';
import { CortexHybridExecutionEngine, HybridExecutionResult } from './cortexHybridEngine.service';
import { CortexFragmentCacheService, FragmentCacheResult, FragmentComposition } from './cortexFragmentCache.service';
import { CortexContextManagerService, ConversationContext, ContextExtractionResult } from './cortexContextManager.service';
import { SemanticPrimitivesService } from './semanticPrimitives.service';
import { CortexSastEncoderService } from './cortexSastEncoder.service';
import { CortexSastIntegrationService } from './cortexSastIntegration.service';
import { 
    CortexEncodingRequest, 
    CortexProcessingRequest, 
    CortexDecodingRequest 
} from '../types/cortex.types';

/**
 * Gateway Cortex Service
 * Handles Cortex processing for gateway requests with model selection flexibility
 */
export class GatewayCortexService {
    
    /**
     * Process request through Cortex pipeline in gateway context
     */
    static async processGatewayRequest(
        req: Request,
        originalBody: any
    ): Promise<{
        processedBody: any;
        cortexMetadata: any;
        shouldBypass: boolean;
    }> {
        const context = req.gatewayContext!;
        const startTime = Date.now();

        try {
            // Extract prompt from various body structures
            const originalPrompt = this.extractPromptFromBody(originalBody);
            if (!originalPrompt) {
                loggingService.debug('No prompt found in request body, bypassing Cortex', {
                    requestId: context.requestId,
                    bodyKeys: Object.keys(originalBody)
                });
                return {
                    processedBody: originalBody,
                    cortexMetadata: { bypassed: true, reason: 'no_prompt_found' },
                    shouldBypass: true
                };
            }

            // 🎯 ADAPTIVE MODEL ROUTING - Analyze complexity and select optimal models
            const modelRouter = CortexModelRouterService.getInstance();
            const complexityAnalysis = modelRouter.analyzePromptComplexity(originalPrompt);
            
            // Build routing preferences from context
            const routingPreferences: Partial<RoutingPreferences> = {
                priority: this.inferPriorityFromContext(context),
                preferredModels: {
                    encoder: context.cortexEncodingModel,
                    core: context.cortexCoreModel,
                    decoder: context.cortexDecodingModel
                }
            };

            // Get routing decision
            const routingDecision = modelRouter.makeRoutingDecision(
                complexityAnalysis, 
                routingPreferences
            );

            // Use routing decision for optimal model selection
            const finalModels = modelRouter.getModelConfiguration(routingDecision);

            loggingService.info('🚀 Gateway Cortex processing started with adaptive routing', {
                requestId: context.requestId,
                userId: context.userId,
                promptLength: originalPrompt.length,
                complexity: complexityAnalysis.overallComplexity,
                complexityScore: Math.round((complexityAnalysis.confidence - 0.6) * 200),
                routingTier: routingDecision.selectedTier.name,
                selectedModels: {
                    encoder: finalModels.cortexEncodingModel,
                    core: finalModels.cortexCoreModel,
                    decoder: finalModels.cortexDecodingModel
                },
                routing: {
                    reasoning: routingDecision.reasoning,
                    confidence: routingDecision.confidence,
                    estimatedCost: routingDecision.costEstimate.estimatedCost,
                    estimatedTokens: routingDecision.costEstimate.tokens
                },
                operation: context.cortexOperation
            });

            // 🎯 Step 0: Check semantic cache first (if enabled)
            if (context.cortexSemanticCache) {
                const cachedResult = await CortexCacheService.getCachedResult(originalPrompt);
                if (cachedResult) {
                    const processedBody = this.replacePromptInBody(originalBody, cachedResult.optimizedPrompt);
                    
                    loggingService.info('🎯 Gateway Cortex cache HIT', {
                        requestId: context.requestId,
                        cacheAge: Math.round((Date.now() - cachedResult.createdAt.getTime()) / 60000),
                        processingTime: Date.now() - startTime
                    });

                    return {
                        processedBody,
                        cortexMetadata: {
                            ...cachedResult.cortexMetadata,
                            processingTime: Date.now() - startTime,
                            cacheHit: true,
                            gateway: true
                        },
                        shouldBypass: false
                    };
                }
            }

            // 🧠 Step 0: Context Management - Handle conversational state and history  
            loggingService.debug('🧠 Gateway context management...', { requestId: context.requestId });
            let contextState: ConversationContext | null = null;
            let contextUpdateResult: ContextExtractionResult | null = null;
            let optimizedPrompt = originalPrompt;

            // Check if context management is enabled (default: disabled for backward compatibility)
            const isContextManagementEnabled = (context as any).cortexContextManagement === true;

            // Extract context identifiers from headers or request
            const sessionId = (context as any).cortexSessionId ||
                             req.headers['x-session-id'] as string ||
                             `session_${context.requestId}`;
            const userId = context.userId || 'anonymous';

            if (isContextManagementEnabled) {
                loggingService.info('🧠 Context management enabled', {
                    requestId: context.requestId,
                    sessionId,
                    userId,
                    compressionEnabled: (context as any).cortexContextCompression !== false
                });

                try {
                const contextManager = CortexContextManagerService.getInstance();

                // Try to retrieve existing context via reconstruction
                const reconstructResult = await contextManager.reconstructContext({
                    userId,
                    sessionId,
                    query: originalPrompt,
                    maxContextSize: 500,
                    includeHistory: true
                });
                
                if (reconstructResult.relevantContext) {
                    contextState = reconstructResult.relevantContext;
                    loggingService.info('📋 Retrieved existing context state', {
                        requestId: context.requestId,
                        sessionId,
                        entitiesCount: contextState.entities.size,
                        hasPreferences: contextState.preferences.size > 0
                    });

                    // Use context summary as optimized prompt prefix
                    optimizedPrompt = `${reconstructResult.contextSummary}\n\n${originalPrompt}`;
                    
                    loggingService.info('✅ Context applied to prompt', {
                        requestId: context.requestId,
                        contextSummaryLength: reconstructResult.contextSummary.length,
                        keyEntitiesCount: reconstructResult.keyEntities.length
                    });
                }

                // Extract context from current interaction for storage
                contextUpdateResult = await contextManager.extractContext(
                    { frameType: 'query', content: originalPrompt } as any, // Simplified frame
                    userId,
                    sessionId
                );

                if (contextUpdateResult.entities.length > 0 || contextUpdateResult.intentions.length > 0) {
                    loggingService.info('🔄 Context extracted from current turn', {
                        requestId: context.requestId,
                        sessionId,
                        entitiesExtracted: contextUpdateResult.entities.length,
                        intentionsExtracted: contextUpdateResult.intentions.length,
                        preferencesExtracted: contextUpdateResult.preferences.length
                    });

                    // Update the context store with extracted information
                    await contextManager.updateContext(
                        userId,
                        sessionId,
                        contextUpdateResult
                    );
                }

                } catch (contextError) {
                    loggingService.warn('⚠️ Context management failed, proceeding without context optimization', {
                        requestId: context.requestId,
                        error: contextError instanceof Error ? contextError.message : String(contextError)
                    });
                    // Continue with original prompt if context management fails
                    optimizedPrompt = originalPrompt;
                }
            } else {
                loggingService.debug('🧠 Context management disabled, using original prompt', {
                    requestId: context.requestId,
                    sessionId
                });
                // Context management is disabled, use original prompt
                optimizedPrompt = originalPrompt;
            }

            // 🧠 Step 1: Encode natural language to Cortex
            loggingService.debug('🔄 Gateway Cortex encoding...', { requestId: context.requestId });
            const encodingRequest: CortexEncodingRequest = {
                text: optimizedPrompt, // Use context-optimized prompt
                metadata: {
                    domain: 'general',
                    language: 'en',
                    complexity: complexityAnalysis.overallComplexity === 'expert' ? 'complex' : complexityAnalysis.overallComplexity
                }
            };

            // 🧬 DYNAMIC SAST vs TRADITIONAL CORTEX SELECTION
            let encodingResult: any;
            let sastMetadata: any = {};
            
            // Check if SAST mode is enabled via headers
            const useSast = (context.cortexOperation as any) === 'sast' || (context.cortexOperation as any) === 'analyze' || 
                          ((context.cortexOperation as any) === 'optimize' && complexityAnalysis.overallComplexity === 'complex');

            if (useSast) {
                loggingService.info('🧬 Using SAST (Semantic Abstract Syntax Tree) encoding', {
                    requestId: context.requestId,
                    reason: (context.cortexOperation as any) === 'sast' ? 'explicit_sast_request' : 
                           (context.cortexOperation as any) === 'analyze' ? 'analysis_request' : 'high_complexity_optimization'
                });

                // Initialize SAST services dynamically
                const semanticPrimitives = SemanticPrimitivesService.getInstance();
                const sastEncoder = CortexSastEncoderService.getInstance();
                const sastIntegration = CortexSastIntegrationService.getInstance();

                // Get vocabulary stats for metadata
                const vocabStats = semanticPrimitives.getVocabularyStats();
                
                // Perform SAST encoding
                const sastResult = await sastEncoder.encodeSast({
                    text: optimizedPrompt,
                    language: encodingRequest.metadata?.language || 'en',
                    disambiguationStrategy: 'hybrid',
                    preserveAmbiguity: false,
                    outputFormat: 'frame'
                });

                // Compare with traditional approach if requested
                let evolutionComparison;
                if ((context.cortexOperation as any) === 'analyze') {
                    evolutionComparison = await sastIntegration.compareEvolution(
                        optimizedPrompt,
                        encodingRequest.metadata?.language || 'en'
                    );
                }

                // Convert SAST result to traditional encoding format
                encodingResult = {
                    cortexFrame: {
                        frameType: sastResult.semanticFrame.frameType,
                        ...sastResult.semanticFrame.primitives,
                        metadata: sastResult.metadata
                    },
                    confidence: sastResult.metadata.confidence,
                    processingTime: sastResult.metadata.processingTime,
                    model: finalModels.cortexEncodingModel,
                    metadata: sastResult.metadata
                };

                sastMetadata = {
                    usedSast: true,
                    semanticPrimitives: {
                        totalVocabulary: vocabStats.totalPrimitives,
                        categoryCoverage: vocabStats.primitivesByCategory,
                        crossLingualSupport: vocabStats.coverageByLanguage
                    },
                    ambiguitiesResolved: sastResult.ambiguitiesResolved.length,
                    syntacticComplexity: sastResult.metadata.syntacticComplexity,
                    semanticDepth: sastResult.metadata.semanticDepth,
                    universalCompatibility: sastResult.metadata.universalCompatibility,
                    evolutionComparison: evolutionComparison ? {
                        tokenReduction: evolutionComparison.improvements.tokenReduction,
                        ambiguityReduction: evolutionComparison.improvements.ambiguityReduction,
                        semanticClarityGain: evolutionComparison.improvements.semanticClarityGain,
                        recommendedApproach: evolutionComparison.metadata.recommendedApproach
                    } : null
                };

                loggingService.info('✨ SAST encoding completed with semantic enhancement', {
                    requestId: context.requestId,
                    primitiveCount: sastResult.sourceMapping.primitives.length,
                    ambiguitiesResolved: sastResult.ambiguitiesResolved.length,
                    confidence: sastResult.metadata.confidence,
                    semanticExplicitness: sastResult.metadata.crossLingualEquivalent ? 'universal' : 'language_specific'
                });
            } else {
                // Traditional Cortex encoding
                const encoderService = CortexEncoderService.getInstance();
                encodingResult = await encoderService.encode(encodingRequest);
                
                sastMetadata = { usedSast: false, reason: 'traditional_cortex_sufficient' };
            }

            // 🔍 Step 1.5: Schema validation - validate encoded structure before expensive processing
            let schemaValidationResult: ValidationResult | null = null;
            if (context.cortexSchemaValidation !== false) {
                try {
                    const schemaValidator = CortexSchemaValidatorService.getInstance();
                    schemaValidationResult = schemaValidator.validateFrame(
                        encodingResult.cortexFrame, 
                        context.cortexStrictValidation === true
                    );

                    loggingService.info('🔍 Schema validation completed', {
                        requestId: context.requestId,
                        valid: schemaValidationResult.valid,
                        score: schemaValidationResult.score,
                        errorCount: schemaValidationResult.errors.length,
                        warningCount: schemaValidationResult.warnings.length,
                        frameType: encodingResult.cortexFrame.frameType
                    });

                    // Handle validation failures based on severity
                    const criticalErrors = schemaValidationResult.errors.filter(e => e.severity === 'critical');
                    const errors = schemaValidationResult.errors.filter(e => e.severity === 'error');

                    if (criticalErrors.length > 0 && context.cortexStrictValidation === true) {
                        // Fail fast on critical errors in strict mode
                        loggingService.error('❌ Critical schema validation errors in strict mode', {
                            requestId: context.requestId,
                            criticalErrors: criticalErrors.map(e => e.message)
                        });

                        return {
                            processedBody: originalBody,
                            cortexMetadata: {
                                error: `Schema validation failed: ${criticalErrors[0].message}`,
                                schemaValidation: schemaValidationResult,
                                processingTime: Date.now() - startTime,
                                gateway: true
                            },
                            shouldBypass: true
                        };
                    }

                    if (schemaValidationResult.score < 50 && context.cortexStrictValidation === true) {
                        // Quality score too low in strict mode
                        loggingService.warn('⚠️ Schema validation score too low', {
                            requestId: context.requestId,
                            score: schemaValidationResult.score,
                            threshold: 50
                        });

                        return {
                            processedBody: originalBody,
                            cortexMetadata: {
                                error: `Schema quality score too low: ${schemaValidationResult.score}/100`,
                                schemaValidation: schemaValidationResult,
                                processingTime: Date.now() - startTime,
                                gateway: true
                            },
                            shouldBypass: true
                        };
                    }

                } catch (validationError) {
                    loggingService.warn('⚠️ Schema validation failed, continuing without it', {
                        requestId: context.requestId,
                        error: validationError instanceof Error ? validationError.message : String(validationError)
                    });
                    schemaValidationResult = {
                        valid: false,
                        errors: [{
                            code: 'VALIDATION_ERROR' as any,
                            message: String(validationError),
                            path: 'root',
                            severity: 'warning' as const
                        }],
                        warnings: [],
                        score: 0
                    };
                }
            }

            // 🧩 Step 1.7: Fragment cache lookup - Check for cached fragments
            let fragmentCacheResult: FragmentCacheResult | null = null;
            let fragmentComposition: FragmentComposition | null = null;
            
            if (context.cortexFragmentCache !== false) {
                try {
                    const fragmentCacheService = CortexFragmentCacheService.getInstance();
                    
                    loggingService.info('🧩 Querying fragment cache', {
                        requestId: context.requestId,
                        frameType: encodingResult.cortexFrame.frameType
                    });

                    fragmentCacheResult = await fragmentCacheService.queryFragmentCache(encodingResult.cortexFrame);

                    if (fragmentCacheResult.hit) {
                        if (fragmentCacheResult.fragment) {
                            // Complete fragment cache hit - return cached result
                            loggingService.info('✅ Complete fragment cache hit, bypassing processing', {
                                requestId: context.requestId,
                                fragmentId: fragmentCacheResult.fragment.id,
                                category: fragmentCacheResult.fragment.metadata.category,
                                reusability: fragmentCacheResult.fragment.metadata.reusability,
                                compressionSavings: fragmentCacheResult.metadata.compressionSavings
                            });

                            const optimizedPrompt = this.formatFragmentResult(fragmentCacheResult.fragment);
                            const processedBody = this.replacePromptInBody(originalBody, optimizedPrompt);

                            const cortexMetadata = {
                                processingTime: Date.now() - startTime,
                                encodingConfidence: encodingResult.confidence,
                                
                                // 🧩 FRAGMENT CACHE METADATA
                                fragmentCache: {
                                    enabled: true,
                                    hit: true,
                                    hitRate: fragmentCacheResult.metadata.hitRate,
                                    fragmentsFound: fragmentCacheResult.metadata.fragmentsFound,
                                    totalFragments: fragmentCacheResult.metadata.totalFragments,
                                    compressionSavings: fragmentCacheResult.metadata.compressionSavings,
                                    cacheTime: fragmentCacheResult.metadata.cacheTime,
                                    fragmentId: fragmentCacheResult.fragment.id,
                                    category: fragmentCacheResult.fragment.metadata.category,
                                    bypassedLLM: true
                                },
                                
                                complexity: complexityAnalysis,
                                routing: routingDecision,
                                schemaValidation: schemaValidationResult ? {
                                    enabled: true,
                                    valid: schemaValidationResult.valid,
                                    score: schemaValidationResult.score
                                } : { enabled: false },
                                gateway: true,
                                operation: context.cortexOperation,
                                bypassedLLM: true // Fragment cache handled everything
                            };

                            context.cortexMetadata = cortexMetadata;

                            return {
                                processedBody,
                                cortexMetadata,
                                shouldBypass: false
                            };
                        } else if (fragmentCacheResult.partialHits.length > 0) {
                            // Partial fragment cache hits - try composition
                            loggingService.info('🔗 Partial fragment cache hits, attempting composition', {
                                requestId: context.requestId,
                                hitRate: `${(fragmentCacheResult.metadata.hitRate * 100).toFixed(1)}%`,
                                partialHits: fragmentCacheResult.partialHits.length
                            });

                            fragmentComposition = await fragmentCacheService.composeFragments(
                                fragmentCacheResult, 
                                encodingResult.cortexFrame
                            );

                            if (fragmentComposition && fragmentComposition.coverageRatio >= 0.8) {
                                // High coverage composition - use composed result
                                loggingService.info('✅ High-coverage fragment composition successful', {
                                    requestId: context.requestId,
                                    coverageRatio: `${(fragmentComposition.coverageRatio * 100).toFixed(1)}%`,
                                    fragmentCount: fragmentComposition.fragments.length,
                                    strategy: fragmentComposition.compositionStrategy
                                });

                                const optimizedPrompt = this.formatCompositionResult(fragmentComposition);
                                const processedBody = this.replacePromptInBody(originalBody, optimizedPrompt);

                                const cortexMetadata = {
                                    processingTime: Date.now() - startTime,
                                    encodingConfidence: encodingResult.confidence,
                                    
                                    // 🧩 FRAGMENT CACHE METADATA (COMPOSITION)
                                    fragmentCache: {
                                        enabled: true,
                                        hit: true,
                                        hitRate: fragmentCacheResult.metadata.hitRate,
                                        fragmentsFound: fragmentCacheResult.metadata.fragmentsFound,
                                        totalFragments: fragmentCacheResult.metadata.totalFragments,
                                        compressionSavings: fragmentCacheResult.metadata.compressionSavings,
                                        cacheTime: fragmentCacheResult.metadata.cacheTime,
                                        composition: {
                                            enabled: true,
                                            coverageRatio: fragmentComposition.coverageRatio,
                                            fragmentCount: fragmentComposition.fragments.length,
                                            strategy: fragmentComposition.compositionStrategy,
                                            missingParts: fragmentComposition.missingParts.length
                                        },
                                        bypassedLLM: true
                                    },
                                    
                                    complexity: complexityAnalysis,
                                    routing: routingDecision,
                                    schemaValidation: schemaValidationResult ? {
                                        enabled: true,
                                        valid: schemaValidationResult.valid,
                                        score: schemaValidationResult.score
                                    } : { enabled: false },
                                    gateway: true,
                                    operation: context.cortexOperation,
                                    bypassedLLM: true // Fragment composition handled everything
                                };

                                context.cortexMetadata = cortexMetadata;

                                return {
                                    processedBody,
                                    cortexMetadata,
                                    shouldBypass: false
                                };
                            } else if (fragmentComposition && fragmentComposition.coverageRatio > 0.3) {
                                // Moderate coverage - update frame for further processing
                                loggingService.info('⚡ Moderate fragment composition, continuing with enhanced frame', {
                                    requestId: context.requestId,
                                    coverageRatio: `${(fragmentComposition.coverageRatio * 100).toFixed(1)}%`,
                                    missingParts: fragmentComposition.missingParts.length
                                });
                                
                                // Use composed result as enhanced starting point
                                encodingResult.cortexFrame = fragmentComposition.reconstructedQuery;
                            }
                        }
                    }

                } catch (fragmentError) {
                    loggingService.warn('⚠️ Fragment cache query failed, continuing with standard processing', {
                        requestId: context.requestId,
                        error: fragmentError instanceof Error ? fragmentError.message : String(fragmentError)
                    });
                    fragmentCacheResult = {
                        hit: false,
                        partialHits: [],
                        metadata: {
                            hitRate: 0,
                            fragmentsFound: 0,
                            totalFragments: 0,
                            cacheTime: 0,
                            compressionSavings: 0
                        }
                    };
                }
            }

            // ⚡ Step 1.8: Hybrid execution - Execute deterministic operations
            let hybridExecutionResult: HybridExecutionResult | null = null;
            if (context.cortexHybridExecution !== false) {
                try {
                    const hybridEngine = CortexHybridExecutionEngine.getInstance();
                    
                    loggingService.info('⚡ Analyzing frame for hybrid execution', {
                        requestId: context.requestId,
                        frameType: encodingResult.cortexFrame.frameType
                    });

                    hybridExecutionResult = await hybridEngine.executeHybrid(encodingResult.cortexFrame);

                    if (hybridExecutionResult.deterministic && hybridExecutionResult.success) {
                        // Complete deterministic execution - return result directly
                        loggingService.info('✅ Deterministic execution completed, bypassing LLM', {
                            requestId: context.requestId,
                            executedTools: hybridExecutionResult.executedTools.length,
                            costSaved: hybridExecutionResult.metadata.costSaved,
                            executionTime: hybridExecutionResult.metadata.executionTime
                        });

                        const optimizedPrompt = this.formatHybridResult(hybridExecutionResult);
                        const processedBody = this.replacePromptInBody(originalBody, optimizedPrompt);

                        const cortexMetadata = {
                            processingTime: Date.now() - startTime,
                            encodingConfidence: encodingResult.confidence,
                            
                            // ⚡ HYBRID EXECUTION METADATA
                            hybridExecution: {
                                enabled: true,
                                deterministic: true,
                                executedTools: hybridExecutionResult.executedTools,
                                apiCalls: hybridExecutionResult.apiCalls,
                                costSaved: hybridExecutionResult.metadata.costSaved,
                                executionTime: hybridExecutionResult.metadata.executionTime,
                                toolsUsed: hybridExecutionResult.metadata.toolsUsed.length
                            },
                            
                            complexity: complexityAnalysis,
                            routing: routingDecision,
                            schemaValidation: schemaValidationResult ? {
                                enabled: true,
                                valid: schemaValidationResult.valid,
                                score: schemaValidationResult.score
                            } : { enabled: false },
                            gateway: true,
                            operation: context.cortexOperation,
                            bypassedLLM: true // Hybrid execution handled everything
                        };

                        context.cortexMetadata = cortexMetadata;

                        return {
                            processedBody,
                            cortexMetadata,
                            shouldBypass: false
                        };
                    } else if (hybridExecutionResult.executionType === 'hybrid') {
                        loggingService.info('⚡ Hybrid execution completed, continuing with LLM for remaining parts', {
                            requestId: context.requestId,
                            executedTools: hybridExecutionResult.executedTools.length,
                            costSaved: hybridExecutionResult.metadata.costSaved
                        });
                        
                        // Update the frame with hybrid results for further LLM processing
                        encodingResult.cortexFrame = hybridExecutionResult.result as any;
                    }

                } catch (hybridError) {
                    loggingService.warn('⚠️ Hybrid execution failed, continuing with standard processing', {
                        requestId: context.requestId,
                        error: hybridError instanceof Error ? hybridError.message : String(hybridError)
                    });
                    hybridExecutionResult = {
                        success: false,
                        result: encodingResult.cortexFrame,
                        executionType: 'llm',
                        executedTools: [],
                        apiCalls: 0,
                        deterministic: false,
                        metadata: {
                            executionTime: 0,
                            costSaved: 0,
                            toolsUsed: [],
                            errors: [String(hybridError)],
                            warnings: []
                        }
                    };
                }
            }

            // 🔄 Step 1.9: Control flow detection and processing
            let controlFlowResult: ControlFlowExecutionResult | null = null;
            const isControlFlowFrame = this.isControlFlowFrame(encodingResult.cortexFrame);

            if (isControlFlowFrame && context.cortexControlFlowEnabled !== false) {
                try {
                    const controlFlowService = CortexControlFlowService.getInstance();
                    
                    loggingService.info('🔄 Executing control flow logic', {
                        requestId: context.requestId,
                        frameType: encodingResult.cortexFrame.frameType,
                        controlType: (encodingResult.cortexFrame as any).controlType || 'unknown'
                    });

                    controlFlowResult = await controlFlowService.executeControlFlow(
                        encodingResult.cortexFrame as any
                    );

                    if (controlFlowResult.success) {
                        loggingService.info('✅ Control flow execution completed', {
                            requestId: context.requestId,
                            executedSteps: controlFlowResult.executedSteps.length,
                            executionTime: controlFlowResult.metadata.executionTime,
                            variables: Object.keys(controlFlowResult.variables).length
                        });

                        // If control flow completed successfully, return the result directly
                        // without going through expensive LLM processing
                        const optimizedPrompt = this.formatControlFlowResult(controlFlowResult);
                        const processedBody = this.replacePromptInBody(originalBody, optimizedPrompt);

                        const cortexMetadata = {
                            processingTime: Date.now() - startTime,
                            encodingConfidence: encodingResult.confidence,
                            controlFlow: {
                                enabled: true,
                                success: controlFlowResult.success,
                                executedSteps: controlFlowResult.executedSteps.length,
                                executionTime: controlFlowResult.metadata.executionTime,
                                variablesCreated: Object.keys(controlFlowResult.variables).length,
                                errors: controlFlowResult.metadata.errors.length,
                                warnings: controlFlowResult.metadata.warnings.length
                            },
                            complexity: complexityAnalysis,
                            routing: routingDecision,
                            schemaValidation: schemaValidationResult ? {
                                enabled: true,
                                valid: schemaValidationResult.valid,
                                score: schemaValidationResult.score
                            } : { enabled: false },
                            gateway: true,
                            operation: context.cortexOperation,
                            bypassedLLM: true // Control flow handled everything
                        };

                        // Store metadata in context for response headers
                        context.cortexMetadata = cortexMetadata;

                        return {
                            processedBody,
                            cortexMetadata,
                            shouldBypass: false
                        };
                    } else {
                        loggingService.warn('⚠️ Control flow execution had errors, falling back to LLM processing', {
                            requestId: context.requestId,
                            errors: controlFlowResult.metadata.errors.length
                        });
                        // Continue to LLM processing as fallback
                    }

                } catch (controlFlowError) {
                    loggingService.warn('⚠️ Control flow processing failed, continuing with LLM processing', {
                        requestId: context.requestId,
                        error: controlFlowError instanceof Error ? controlFlowError.message : String(controlFlowError)
                    });
                    controlFlowResult = {
                        success: false,
                        result: 'Control flow execution failed',
                        executedSteps: [],
                        variables: {},
                        metadata: {
                            totalSteps: 0,
                            executionTime: 0,
                            errors: [{
                                code: 'CONTROL_FLOW_ERROR',
                                message: String(controlFlowError),
                                recoverable: true
                            }],
                            warnings: []
                        }
                    };
                }
            }

            // ⚡ Step 2: Process Cortex with adaptively selected model
            loggingService.debug('🔄 Gateway Cortex core processing...', { 
                requestId: context.requestId,
                coreModel: finalModels.cortexCoreModel,
                routingTier: routingDecision.selectedTier.name
            });
            const processingRequest: CortexProcessingRequest = {
                input: encodingResult.cortexFrame,
                operation: context.cortexOperation || 'optimize',
                options: {
                    preserveSemantics: context.cortexPreserveSemantics !== false,
                    targetReduction: this.getTargetReduction(complexityAnalysis.overallComplexity),
                    enableInference: true
                },
                metadata: {
                    userId: context.userId,
                    provider: 'gateway',
                    model: finalModels.cortexCoreModel
                }
            };

            const coreService = CortexCoreService.getInstance();
            const processingResult = await coreService.process(processingRequest);

            // 🗜️ Optional: Binary serialize intermediate Cortex for caching/transmission efficiency
            let binarySerializationMetadata: any = {};
            if (context.cortexBinaryEnabled) {
                try {
                    const binarySerializer = CortexBinarySerializerService.getInstance();
                    const binaryOptions: Partial<BinaryCompressionOptions> = {
                        compressionLevel: context.cortexBinaryCompression || 'standard',
                        includeMetadata: true,
                        validateIntegrity: true,
                        optimizeForSpeed: false
                    };

                    const binaryResult = binarySerializer.serialize(processingResult.output, binaryOptions);
                    
                    binarySerializationMetadata = {
                        enabled: true,
                        originalSize: binaryResult.originalSize,
                        compressedSize: binaryResult.compressedSize,
                        compressionRatio: binaryResult.compressionRatio,
                        compressionLevel: binaryResult.metadata.compressionLevel
                    };

                    loggingService.info('🗜️ Binary serialization completed', {
                        requestId: context.requestId,
                        compressionRatio: `${(binaryResult.compressionRatio * 100).toFixed(1)}%`,
                        sizeSavings: `${binaryResult.originalSize - binaryResult.compressedSize} bytes`
                    });

                    // Verify round-trip integrity
                    const deserializedResult = binarySerializer.deserialize(binaryResult.binaryData);
                    if (!deserializedResult.metadata.integrityCheck) {
                        loggingService.warn('Binary serialization integrity check failed', { 
                            requestId: context.requestId 
                        });
                    }

                } catch (binaryError) {
                    loggingService.warn('Binary serialization failed, continuing without it', {
                        requestId: context.requestId,
                        error: binaryError instanceof Error ? binaryError.message : String(binaryError)
                    });
                    binarySerializationMetadata = { enabled: false, error: String(binaryError) };
                }
            }

            // 🔄 Step 3: Decode back to natural language
            loggingService.debug('🔄 Gateway Cortex decoding...', { requestId: context.requestId });
            const decodingRequest: CortexDecodingRequest = {
                cortexStructure: processingResult.output,
                targetLanguage: 'en',
                style: context.cortexOutputStyle || 'conversational',
                format: context.cortexOutputFormat || 'plain',
                options: {
                    preserveFormatting: true,
                    enhanceReadability: false
                },
                metadata: {
                    domain: 'general',
                    audienceLevel: 'intermediate'
                }
            };

            const decoderService = CortexDecoderService.getInstance();
            const decodingResult = await decoderService.decode(decodingRequest);

            // Calculate metrics
            const originalTokens = Math.ceil(originalPrompt.length / 4);
            const optimizedTokens = Math.ceil(decodingResult.text.length / 4);
            const reductionPercentage = ((originalTokens - optimizedTokens) / originalTokens) * 100;

            const cortexMetadata = {
                processingTime: Date.now() - startTime,
                encodingConfidence: encodingResult.confidence,
                optimizationsApplied: processingResult.optimizations.length,
                decodingConfidence: decodingResult.confidence,
                semanticIntegrity: processingResult.metadata.semanticIntegrity,
                
                // 🧬 DYNAMIC SAST METADATA
                sast: sastMetadata,
                
                // 🎯 ADAPTIVE ROUTING METADATA
                complexity: {
                    level: complexityAnalysis.overallComplexity,
                    score: Math.round((complexityAnalysis.confidence - 0.6) * 200),
                    factors: complexityAnalysis.factors,
                    confidence: complexityAnalysis.confidence
                },
                routing: {
                    selectedTier: routingDecision.selectedTier.name,
                    reasoning: routingDecision.reasoning,
                    confidence: routingDecision.confidence,
                    costEstimate: routingDecision.costEstimate
                },
                
                // 🧠 CONTEXT MANAGEMENT METADATA
                contextManagement: contextState ? {
                    enabled: true,
                    sessionId: sessionId,
                    entitiesCount: contextState.entities.size,
                    preferencesCount: contextState.preferences.size,
                    constraintsCount: contextState.constraints.length,
                    compressionApplied: true,
                    contextTokensSaved: 0, // Calculated separately
                    contextCompressionRatio: 1.0, // Calculated separately 
                    entitiesExtracted: contextUpdateResult?.entities.length || 0,
                    intentionsExtracted: contextUpdateResult?.intentions.length || 0,
                    preferencesExtracted: contextUpdateResult?.preferences.length || 0
                } : {
                    enabled: false,
                    sessionId: sessionId,
                    reason: 'context_management_disabled'
                },
                
                cortexModel: {
                    encoder: finalModels.cortexEncodingModel,
                    core: finalModels.cortexCoreModel,
                    decoder: finalModels.cortexDecodingModel
                },
                tokensSaved: Math.max(0, originalTokens - optimizedTokens),
                reductionPercentage: Math.max(0, reductionPercentage),
                
                // 🗜️ BINARY SERIALIZATION METADATA
                binarySerialization: binarySerializationMetadata,
                
                // 🔍 SCHEMA VALIDATION METADATA
                schemaValidation: schemaValidationResult ? {
                    enabled: true,
                    valid: schemaValidationResult.valid,
                    score: schemaValidationResult.score,
                    errorCount: schemaValidationResult.errors.length,
                    warningCount: schemaValidationResult.warnings.length,
                    strictMode: context.cortexStrictValidation === true,
                    errors: schemaValidationResult.errors.slice(0, 5), // Top 5 errors
                    warnings: schemaValidationResult.warnings.slice(0, 3) // Top 3 warnings
                } : { enabled: false },

                // 🔄 CONTROL FLOW METADATA
                controlFlow: controlFlowResult ? {
                    enabled: true,
                    success: controlFlowResult.success,
                    executedSteps: controlFlowResult.executedSteps.length,
                    executionTime: controlFlowResult.metadata.executionTime,
                    variablesCreated: Object.keys(controlFlowResult.variables).length,
                    errors: controlFlowResult.metadata.errors.length,
                    warnings: controlFlowResult.metadata.warnings.length,
                    bypassedLLM: false // Normal processing through LLM
                } : { enabled: false },

                // ⚡ HYBRID EXECUTION METADATA
                hybridExecution: hybridExecutionResult ? {
                    enabled: true,
                    deterministic: hybridExecutionResult.deterministic,
                    executedTools: hybridExecutionResult.executedTools,
                    apiCalls: hybridExecutionResult.apiCalls,
                    costSaved: hybridExecutionResult.metadata.costSaved,
                    executionTime: hybridExecutionResult.metadata.executionTime,
                    toolsUsed: hybridExecutionResult.metadata.toolsUsed.length,
                    executionType: hybridExecutionResult.executionType,
                    bypassedLLM: false // Normal processing through LLM
                } : { enabled: false },

                // 🧩 FRAGMENT CACHE METADATA  
                fragmentCache: fragmentCacheResult ? {
                    enabled: true,
                    hit: fragmentCacheResult.hit,
                    hitRate: fragmentCacheResult.metadata.hitRate,
                    fragmentsFound: fragmentCacheResult.metadata.fragmentsFound,
                    totalFragments: fragmentCacheResult.metadata.totalFragments,
                    compressionSavings: fragmentCacheResult.metadata.compressionSavings,
                    cacheTime: fragmentCacheResult.metadata.cacheTime,
                    composition: fragmentComposition ? {
                        enabled: true,
                        coverageRatio: fragmentComposition.coverageRatio,
                        fragmentCount: fragmentComposition.fragments.length,
                        strategy: fragmentComposition.compositionStrategy,
                        missingParts: fragmentComposition.missingParts.length
                    } : { enabled: false },
                    bypassedLLM: false // Normal processing through LLM
                } : { enabled: false },
                
                gateway: true,
                operation: context.cortexOperation
            };

            // 💾 Cache the result for future use (if enabled)
            if (context.cortexSemanticCache) {
                await CortexCacheService.setCachedResult(
                    originalPrompt,
                    decodingResult.text,
                    cortexMetadata,
                    {
                        originalTokens,
                        cortexTokens: optimizedTokens,
                        reductionPercentage: Math.max(0, reductionPercentage)
                    }
                );
            }

            // 🧩 Cache fragments from this processing (if enabled and successful)
            if (context.cortexFragmentCache !== false && !fragmentCacheResult?.hit) {
                try {
                    const fragmentCacheService = CortexFragmentCacheService.getInstance();
                    const processingTime = Date.now() - startTime;
                    
                    await fragmentCacheService.cacheFragments(
                        encodingResult.cortexFrame,
                        decodingResult as any, // Use the final processed result
                        processingTime
                    );

                    loggingService.info('💾 Fragment caching completed for future queries', {
                        requestId: context.requestId,
                        processingTime,
                        cacheSize: fragmentCacheService.getCacheStats().fragmentCacheSize
                    });

                } catch (cacheError) {
                    loggingService.warn('⚠️ Fragment caching failed', {
                        requestId: context.requestId,
                        error: cacheError instanceof Error ? cacheError.message : String(cacheError)
                    });
                }
            }

            // Replace prompt in original body structure
            const processedBody = this.replacePromptInBody(originalBody, decodingResult.text);

            loggingService.info('✅ Gateway Cortex processing completed', {
                requestId: context.requestId,
                processingTime: cortexMetadata.processingTime,
                tokensSaved: cortexMetadata.tokensSaved,
                reductionPercentage: `${cortexMetadata.reductionPercentage.toFixed(1)}%`
            });

            // Store metadata in context for response headers
            context.cortexMetadata = cortexMetadata;

            return {
                processedBody,
                cortexMetadata,
                shouldBypass: false
            };

        } catch (error) {
            loggingService.error('❌ Gateway Cortex processing failed', {
                requestId: context.requestId,
                error: error instanceof Error ? error.message : String(error),
                processingTime: Date.now() - startTime
            });

            // Return original body on error
            return {
                processedBody: originalBody,
                cortexMetadata: {
                    error: error instanceof Error ? error.message : String(error),
                    processingTime: Date.now() - startTime,
                    gateway: true
                },
                shouldBypass: true
            };
        }
    }

    /**
     * Extract prompt from various request body structures
     */
    private static extractPromptFromBody(body: any): string | null {
        // OpenAI Chat Completions format
        if (body.messages && Array.isArray(body.messages)) {
            const lastMessage = body.messages[body.messages.length - 1];
            if (lastMessage && lastMessage.content) {
                return typeof lastMessage.content === 'string' 
                    ? lastMessage.content 
                    : JSON.stringify(lastMessage.content);
            }
        }

        // Anthropic Messages format
        if (body.messages && Array.isArray(body.messages)) {
            const userMessages = body.messages.filter((msg: any) => msg.role === 'user');
            if (userMessages.length > 0) {
                const lastUserMessage = userMessages[userMessages.length - 1];
                return lastUserMessage.content;
            }
        }

        // Simple prompt format
        if (body.prompt && typeof body.prompt === 'string') {
            return body.prompt;
        }

        // Input field
        if (body.input && typeof body.input === 'string') {
            return body.input;
        }

        // Text field
        if (body.text && typeof body.text === 'string') {
            return body.text;
        }

        return null;
    }

    /**
     * Replace prompt in original body structure while preserving everything else
     */
    private static replacePromptInBody(originalBody: any, newPrompt: string): any {
        const body = JSON.parse(JSON.stringify(originalBody)); // Deep clone

        // OpenAI Chat Completions format
        if (body.messages && Array.isArray(body.messages)) {
            const lastMessage = body.messages[body.messages.length - 1];
            if (lastMessage && lastMessage.content) {
                lastMessage.content = newPrompt;
                return body;
            }
        }

        // Simple prompt format
        if (body.prompt && typeof body.prompt === 'string') {
            body.prompt = newPrompt;
            return body;
        }

        // Input field
        if (body.input && typeof body.input === 'string') {
            body.input = newPrompt;
            return body;
        }

        // Text field
        if (body.text && typeof body.text === 'string') {
            body.text = newPrompt;
            return body;
        }

        return body;
    }

    /**
     * Add Cortex metadata to response headers
     */
    static addCortexResponseHeaders(res: Response, context: any): void {
        if (context.cortexMetadata) {
            const metadata = context.cortexMetadata;
            
            res.setHeader('CostKatana-Cortex-Enabled', 'true');
            res.setHeader('CostKatana-Cortex-Processing-Time', metadata.processingTime.toString());
            res.setHeader('CostKatana-Cortex-Tokens-Saved', metadata.tokensSaved?.toString() || '0');
            res.setHeader('CostKatana-Cortex-Reduction-Percentage', metadata.reductionPercentage?.toFixed(1) || '0.0');
            res.setHeader('CostKatana-Cortex-Semantic-Integrity', metadata.semanticIntegrity?.toFixed(3) || '1.000');
            
            if (metadata.cacheHit) {
                res.setHeader('CostKatana-Cortex-Cache-Hit', 'true');
                res.setHeader('CostKatana-Cortex-Original-Processing-Time', metadata.originalCacheTime?.toString() || '0');
            }

            if (metadata.cortexModel) {
                res.setHeader('CostKatana-Cortex-Models', JSON.stringify(metadata.cortexModel));
            }

            // 🗜️ Binary serialization headers
            if (metadata.binarySerialization && metadata.binarySerialization.enabled) {
                res.setHeader('CostKatana-Cortex-Binary-Enabled', 'true');
                res.setHeader('CostKatana-Cortex-Binary-Compression-Ratio', 
                    (metadata.binarySerialization.compressionRatio * 100).toFixed(1) + '%');
                res.setHeader('CostKatana-Cortex-Binary-Size-Savings', 
                    (metadata.binarySerialization.originalSize - metadata.binarySerialization.compressedSize).toString());
                res.setHeader('CostKatana-Cortex-Binary-Compression-Level', 
                    metadata.binarySerialization.compressionLevel);
            }

            // 🎯 Adaptive routing headers
            if (metadata.routing) {
                res.setHeader('CostKatana-Cortex-Routing-Tier', metadata.routing.selectedTier);
                res.setHeader('CostKatana-Cortex-Complexity-Level', metadata.complexity.level);
                res.setHeader('CostKatana-Cortex-Complexity-Score', metadata.complexity.score.toString());
            }

            // 🔍 Schema validation headers
            if (metadata.schemaValidation && metadata.schemaValidation.enabled) {
                res.setHeader('CostKatana-Cortex-Schema-Valid', metadata.schemaValidation.valid.toString());
                res.setHeader('CostKatana-Cortex-Schema-Score', metadata.schemaValidation.score.toString());
                res.setHeader('CostKatana-Cortex-Schema-Errors', metadata.schemaValidation.errorCount.toString());
                res.setHeader('CostKatana-Cortex-Schema-Warnings', metadata.schemaValidation.warningCount.toString());
                res.setHeader('CostKatana-Cortex-Schema-Strict', metadata.schemaValidation.strictMode.toString());
            }

            // 🔄 Control flow headers
            if (metadata.controlFlow && metadata.controlFlow.enabled) {
                res.setHeader('CostKatana-Cortex-ControlFlow-Enabled', 'true');
                res.setHeader('CostKatana-Cortex-ControlFlow-Success', metadata.controlFlow.success.toString());
                res.setHeader('CostKatana-Cortex-ControlFlow-Steps', metadata.controlFlow.executedSteps.toString());
                res.setHeader('CostKatana-Cortex-ControlFlow-ExecutionTime', metadata.controlFlow.executionTime.toString());
                res.setHeader('CostKatana-Cortex-ControlFlow-Variables', metadata.controlFlow.variablesCreated.toString());
                if (metadata.controlFlow.bypassedLLM) {
                    res.setHeader('CostKatana-Cortex-ControlFlow-BypassedLLM', 'true');
                }
            }

            // ⚡ Hybrid execution headers
            if (metadata.hybridExecution && metadata.hybridExecution.enabled) {
                res.setHeader('CostKatana-Cortex-Hybrid-Enabled', 'true');
                res.setHeader('CostKatana-Cortex-Hybrid-Deterministic', metadata.hybridExecution.deterministic.toString());
                res.setHeader('CostKatana-Cortex-Hybrid-ExecutedTools', metadata.hybridExecution.executedTools.join(','));
                res.setHeader('CostKatana-Cortex-Hybrid-ApiCalls', metadata.hybridExecution.apiCalls.toString());
                res.setHeader('CostKatana-Cortex-Hybrid-CostSaved', metadata.hybridExecution.costSaved.toString());
                res.setHeader('CostKatana-Cortex-Hybrid-ExecutionTime', metadata.hybridExecution.executionTime.toString());
                res.setHeader('CostKatana-Cortex-Hybrid-ToolsUsed', metadata.hybridExecution.toolsUsed.toString());
                res.setHeader('CostKatana-Cortex-Hybrid-ExecutionType', metadata.hybridExecution.executionType);
                if (metadata.hybridExecution.bypassedLLM) {
                    res.setHeader('CostKatana-Cortex-Hybrid-BypassedLLM', 'true');
                }
            }

            // 🧠 Context management headers
            if (metadata.contextManagement && metadata.contextManagement.enabled) {
                res.setHeader('CostKatana-Cortex-Context-Enabled', 'true');
                res.setHeader('CostKatana-Cortex-Context-SessionId', metadata.contextManagement.sessionId);
                res.setHeader('CostKatana-Cortex-Context-EntitiesCount', metadata.contextManagement.entitiesCount.toString());
                res.setHeader('CostKatana-Cortex-Context-PreferencesCount', metadata.contextManagement.preferencesCount.toString());
                res.setHeader('CostKatana-Cortex-Context-TokensSaved', metadata.contextManagement.contextTokensSaved.toString());
                res.setHeader('CostKatana-Cortex-Context-CompressionRatio', (metadata.contextManagement.contextCompressionRatio * 100).toFixed(1));
                res.setHeader('CostKatana-Cortex-Context-EntitiesExtracted', metadata.contextManagement.entitiesExtracted.toString());
                res.setHeader('CostKatana-Cortex-Context-IntentionsExtracted', metadata.contextManagement.intentionsExtracted.toString());
                if (metadata.contextManagement.compressionApplied) {
                    res.setHeader('CostKatana-Cortex-Context-CompressionApplied', 'true');
                }
            }

            // 🧩 Fragment cache headers
            if (metadata.fragmentCache && metadata.fragmentCache.enabled) {
                res.setHeader('CostKatana-Cortex-FragmentCache-Enabled', 'true');
                res.setHeader('CostKatana-Cortex-FragmentCache-Hit', metadata.fragmentCache.hit.toString());
                res.setHeader('CostKatana-Cortex-FragmentCache-HitRate', (metadata.fragmentCache.hitRate * 100).toFixed(1));
                res.setHeader('CostKatana-Cortex-FragmentCache-FragmentsFound', metadata.fragmentCache.fragmentsFound.toString());
                res.setHeader('CostKatana-Cortex-FragmentCache-TotalFragments', metadata.fragmentCache.totalFragments.toString());
                res.setHeader('CostKatana-Cortex-FragmentCache-CompressionSavings', (metadata.fragmentCache.compressionSavings * 100).toFixed(1));
                res.setHeader('CostKatana-Cortex-FragmentCache-CacheTime', metadata.fragmentCache.cacheTime.toString());
                
                if (metadata.fragmentCache.fragmentId) {
                    res.setHeader('CostKatana-Cortex-FragmentCache-FragmentId', metadata.fragmentCache.fragmentId);
                    res.setHeader('CostKatana-Cortex-FragmentCache-Category', metadata.fragmentCache.category || 'unknown');
                }
                
                if (metadata.fragmentCache.composition && metadata.fragmentCache.composition.enabled) {
                    res.setHeader('CostKatana-Cortex-FragmentCache-Composition-Enabled', 'true');
                    res.setHeader('CostKatana-Cortex-FragmentCache-Composition-Coverage', (metadata.fragmentCache.composition.coverageRatio * 100).toFixed(1));
                    res.setHeader('CostKatana-Cortex-FragmentCache-Composition-FragmentCount', metadata.fragmentCache.composition.fragmentCount.toString());
                    res.setHeader('CostKatana-Cortex-FragmentCache-Composition-Strategy', metadata.fragmentCache.composition.strategy);
                    res.setHeader('CostKatana-Cortex-FragmentCache-Composition-MissingParts', metadata.fragmentCache.composition.missingParts.toString());
                }
                
                if (metadata.fragmentCache.bypassedLLM) {
                    res.setHeader('CostKatana-Cortex-FragmentCache-BypassedLLM', 'true');
                }
            }
            
            // 🧬 SAST (Semantic Abstract Syntax Tree) headers
            if (metadata.sast && metadata.sast.usedSast) {
                res.setHeader('CostKatana-Cortex-SAST-Enabled', 'true');
                res.setHeader('CostKatana-Cortex-SAST-TotalVocabulary', metadata.sast.semanticPrimitives.totalVocabulary.toString());
                res.setHeader('CostKatana-Cortex-SAST-AmbiguitiesResolved', metadata.sast.ambiguitiesResolved.toString());
                res.setHeader('CostKatana-Cortex-SAST-SyntacticComplexity', metadata.sast.syntacticComplexity.toString());
                res.setHeader('CostKatana-Cortex-SAST-SemanticDepth', metadata.sast.semanticDepth.toString());
                res.setHeader('CostKatana-Cortex-SAST-UniversalCompatibility', metadata.sast.universalCompatibility.toString());
                res.setHeader('CostKatana-Cortex-SAST-CrossLingualSupport', JSON.stringify(Object.keys(metadata.sast.semanticPrimitives.crossLingualSupport)));
                
                if (metadata.sast.evolutionComparison) {
                    res.setHeader('CostKatana-Cortex-SAST-TokenReduction', metadata.sast.evolutionComparison.tokenReduction.toFixed(1));
                    res.setHeader('CostKatana-Cortex-SAST-AmbiguityReduction', metadata.sast.evolutionComparison.ambiguityReduction.toFixed(1));
                    res.setHeader('CostKatana-Cortex-SAST-SemanticGain', (metadata.sast.evolutionComparison.semanticClarityGain * 100).toFixed(1));
                    res.setHeader('CostKatana-Cortex-SAST-RecommendedApproach', metadata.sast.evolutionComparison.recommendedApproach);
                }
            } else if (metadata.sast) {
                res.setHeader('CostKatana-Cortex-SAST-Enabled', 'false');
                res.setHeader('CostKatana-Cortex-SAST-Reason', metadata.sast.reason);
            }
        }
    }

    /**
     * Check if request is eligible for Cortex processing
     */
    static isEligibleForCortex(body: any, context: any): boolean {
        if (!context.cortexEnabled) {
            return false;
        }

        // Must have extractable prompt
        const prompt = this.extractPromptFromBody(body);
        if (!prompt || prompt.length < 10) {
            return false;
        }

        // Skip very short prompts (not worth optimizing)
        if (prompt.length < 50) {
            return false;
        }

        return true;
    }

    /**
     * Infer priority from gateway context and headers
     */
    private static inferPriorityFromContext(context: any): 'cost' | 'speed' | 'quality' | 'balanced' {
        // Check for explicit priority header
        if (context.cortexPriority) {
            return context.cortexPriority;
        }

        // Infer from operation type
        if (context.cortexOperation === 'compress') {
            return 'cost'; // Focus on token reduction
        }
        
        if (context.cortexOperation === 'analyze') {
            return 'quality'; // Focus on accuracy
        }

        // Default to balanced
        return 'balanced';
    }

    /**
     * Get target reduction percentage based on complexity
     */
    private static getTargetReduction(complexity: 'simple' | 'medium' | 'complex' | 'expert'): number {
        const reductionMap = {
            'simple': 40,   // Aggressive compression for simple prompts
            'medium': 30,   // Balanced compression
            'complex': 20,  // Conservative compression for complex prompts
            'expert': 15    // Minimal compression to preserve nuance
        };

        return reductionMap[complexity] || 25;
    }

    /**
     * Check if a Cortex frame is a control flow frame
     */
    private static isControlFlowFrame(frame: any): boolean {
        const controlFlowTypes = ['control', 'conditional', 'loop', 'sequence'];
        return controlFlowTypes.includes(frame.frameType);
    }

    /**
     * Format control flow execution result into readable text
     */
    private static formatControlFlowResult(result: ControlFlowExecutionResult): string {
        if (!result.success) {
            return `Control flow execution failed: ${result.metadata.errors.map(e => e.message).join(', ')}`;
        }

        // Format the result based on type
        if (typeof result.result === 'string') {
            return result.result;
        }

        if (Array.isArray(result.result)) {
            // Format array results
            const formattedResults = result.result.map((item, index) => {
                if (typeof item === 'object' && item !== null && 'frameType' in item) {
                    return `Step ${index + 1}: ${(item as any).frameType} frame executed`;
                }
                return `Step ${index + 1}: ${JSON.stringify(item)}`;
            }).join('\n');
            
            return formattedResults;
        }

        if (typeof result.result === 'object' && result.result !== null) {
            // Format object results
            if ((result.result as any).frameType) {
                return `Executed ${(result.result as any).frameType} frame with ${result.executedSteps.length} steps`;
            }
            return JSON.stringify(result.result, null, 2);
        }

        // Fallback: format execution summary
        const summary = [
            `Control flow execution completed successfully`,
            `Executed ${result.executedSteps.length} steps`,
            `Variables created: ${Object.keys(result.variables).length}`,
            `Execution time: ${result.metadata.executionTime}ms`
        ];

        if (Object.keys(result.variables).length > 0) {
            summary.push(`Final variables: ${JSON.stringify(result.variables, null, 2)}`);
        }

        return summary.join('\n');
    }

    /**
     * Format hybrid execution result into readable text
     */
    private static formatHybridResult(result: HybridExecutionResult): string {
        if (!result.success) {
            return `Hybrid execution failed: ${result.metadata.errors.join(', ')}`;
        }

        if (result.deterministic) {
            // Format deterministic execution result
            const parts = [];
            
            if (typeof result.result === 'string' || typeof result.result === 'number') {
                parts.push(`Result: ${result.result}`);
            } else if (typeof result.result === 'object' && result.result !== null) {
                if ('frameType' in result.result) {
                    parts.push(`Executed ${(result.result as any).frameType} frame deterministically`);
                } else {
                    parts.push(`Result: ${JSON.stringify(result.result, null, 2)}`);
                }
            }

            if (result.executedTools.length > 0) {
                parts.push(`Tools used: ${result.executedTools.join(', ')}`);
            }

            if (result.metadata.costSaved > 0) {
                parts.push(`Cost saved: ${result.metadata.costSaved} tokens`);
            }

            parts.push(`Execution time: ${result.metadata.executionTime}ms`);

            return parts.join('\n');
        }

        // Hybrid execution (partial deterministic)
        const summary = [
            'Hybrid execution completed',
            `Tools executed: ${result.executedTools.join(', ')}`,
            `API calls made: ${result.apiCalls}`,
            `Cost saved: ${result.metadata.costSaved} tokens`,
            `Execution time: ${result.metadata.executionTime}ms`
        ];

        if (result.metadata.toolsUsed.length > 0) {
            summary.push(`Tool results: ${result.metadata.toolsUsed.map(t => `${t.toolName}: ${t.success ? 'success' : 'failed'}`).join(', ')}`);
        }

        return summary.join('\n');
    }

    /**
     * Format fragment cache result into readable text
     */
    private static formatFragmentResult(fragment: any): string {
        const parts = [];
        
        parts.push(`Fragment cache hit: ${fragment.metadata.category}`);
        
        if (typeof fragment.content === 'string' || typeof fragment.content === 'number') {
            parts.push(`Cached result: ${fragment.content}`);
        } else if (typeof fragment.content === 'object' && fragment.content !== null) {
            if ('frameType' in fragment.content) {
                parts.push(`Cached ${fragment.content.frameType} frame`);
                // Add content details
                Object.entries(fragment.content).forEach(([key, value]) => {
                    if (key !== 'frameType') {
                        parts.push(`${key}: ${value}`);
                    }
                });
            } else {
                parts.push(`Cached content: ${JSON.stringify(fragment.content, null, 2)}`);
            }
        }

        parts.push(`Reusability: ${(fragment.metadata.reusability * 100).toFixed(1)}%`);
        parts.push(`Access count: ${fragment.metadata.accessCount}`);
        parts.push(`Compression savings: ${(fragment.metadata.compressionRatio * 100).toFixed(1)}%`);

        return parts.join('\n');
    }

    /**
     * Format fragment composition result into readable text
     */
    private static formatCompositionResult(composition: FragmentComposition): string {
        const parts = [];
        
        parts.push(`Fragment composition completed`);
        parts.push(`Coverage: ${(composition.coverageRatio * 100).toFixed(1)}%`);
        parts.push(`Fragments used: ${composition.fragments.length}`);
        parts.push(`Strategy: ${composition.compositionStrategy}`);

        if (composition.missingParts.length > 0) {
            parts.push(`Missing parts: ${composition.missingParts.length}`);
        }

        // Add composed result
        if (typeof composition.reconstructedQuery === 'object' && composition.reconstructedQuery !== null) {
            if ('frameType' in composition.reconstructedQuery) {
                parts.push(`Composed ${composition.reconstructedQuery.frameType} frame`);
                // Add key content details
                Object.entries(composition.reconstructedQuery).forEach(([key, value]) => {
                    if (key !== 'frameType') {
                        parts.push(`${key}: ${value}`);
                    }
                });
            }
        }

        // Add fragment details
        if (composition.fragments.length > 0) {
            parts.push('Fragment details:');
            composition.fragments.forEach((fragment, index) => {
                parts.push(`  ${index + 1}. ${fragment.metadata.category} (${(fragment.metadata.reusability * 100).toFixed(1)}% reusable)`);
            });
        }

        return parts.join('\n');
    }
}
