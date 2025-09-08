import { Optimization, IOptimization } from '../models/Optimization';
import { Usage } from '../models/Usage';
import { User } from '../models/User';
import { Alert } from '../models/Alert';
import { loggingService } from './logging.service';
import { PaginationOptions, paginate } from '../utils/helpers';
import { AIProvider, CostEstimate, OptimizationResult } from '../types/aiCostTracker.types';
import { estimateCost, getModelPricing } from '../utils/pricing';
import { estimateTokens, estimateTokensAsync } from '../utils/tokenCounter';
import { generateOptimizationSuggestions } from '../utils/optimizationUtils';
import mongoose from 'mongoose';
import { ActivityService } from './activity.service';

// 🚀 NEW CORTEX IMPORTS
import { CortexCoreService } from './cortexCore.service';
import { CortexCacheService } from './cortexCache.service';
import { CortexDecoderService } from './cortexDecoder.service';
import { 
    CortexEncodingRequest, 
    CortexProcessingRequest, 
    CortexDecodingRequest,
    DEFAULT_CORTEX_CONFIG 
} from '../types/cortex.types';
import { CortexEncoderService } from './cortexEncoder.service';
import { BedrockService } from './tracedBedrock.service';

/**
 * Convert AIProvider enum to string for pricing functions
 */
function providerEnumToString(provider: AIProvider): string {
    const providerMap: Record<AIProvider, string> = {
        [AIProvider.OpenAI]: 'OpenAI',
        [AIProvider.Anthropic]: 'Anthropic',
        [AIProvider.Google]: 'Google AI',
        [AIProvider.Gemini]: 'Google AI',
        [AIProvider.AWSBedrock]: 'AWS Bedrock',
        [AIProvider.Cohere]: 'Cohere',
        [AIProvider.DeepSeek]: 'DeepSeek',
        [AIProvider.Groq]: 'Groq',
        [AIProvider.HuggingFace]: 'Hugging Face',
        [AIProvider.Ollama]: 'Ollama',
        [AIProvider.Replicate]: 'Replicate',
        [AIProvider.Azure]: 'Azure OpenAI'
    };
    return providerMap[provider] || 'OpenAI';
}

/**
 * Convert simple cost estimate to CostEstimate interface
 */
function convertToCostEstimate(
    simpleEstimate: { inputCost: number; outputCost: number; totalCost: number },
    promptTokens: number,
    completionTokens: number,
    provider: AIProvider,
    model: string
): CostEstimate {
    const modelPricing = getModelPricing(providerEnumToString(provider), model);
    const inputPricePerToken = modelPricing ? modelPricing.inputPrice / 1000000 : 0;
    const outputPricePerToken = modelPricing ? modelPricing.outputPrice / 1000000 : 0;

    return {
        promptCost: simpleEstimate.inputCost,
        completionCost: simpleEstimate.outputCost,
        totalCost: simpleEstimate.totalCost,
        currency: 'USD',
        breakdown: {
            promptTokens,
            completionTokens,
            pricePerPromptToken: inputPricePerToken,
            pricePerCompletionToken: outputPricePerToken
        }
    };
}

interface OptimizationRequest {
    userId: string;
    prompt: string;
    service: string;
    model: string;
    context?: string;
    conversationHistory?: Array<{
        role: 'user' | 'assistant' | 'system';
        content: string;
        timestamp?: Date;
    }>;
    options?: {
        targetReduction?: number;
        preserveIntent?: boolean;
        suggestAlternatives?: boolean;
        enableCompression?: boolean;
        enableContextTrimming?: boolean;
        enableRequestFusion?: boolean;
        
        // 🚀 NEW CORTEX OPTIONS
        enableCortex?: boolean;
        cortexConfig?: {
            encodingModel?: string;
            coreProcessingModel?: string;
            decodingModel?: string;
            processingOperation?: 'optimize' | 'compress' | 'analyze' | 'transform';
            outputStyle?: 'formal' | 'casual' | 'technical' | 'conversational';
            outputFormat?: 'plain' | 'markdown' | 'structured';
            enableSemanticCache?: boolean;
            enableStructuredContext?: boolean;
            preserveSemantics?: boolean;
            enableIntelligentRouting?: boolean;
        };
    };
}

interface BatchOptimizationRequest {
    userId: string;
    requests: Array<{
        id: string;
        prompt: string;
        timestamp: number;
        model: string;
        provider: string;
    }>;
    enableFusion?: boolean;
}

interface OptimizationFilters {
    userId?: string;
    applied?: boolean;
    category?: string;
    minSavings?: number;
    startDate?: Date;
    endDate?: Date;
}

export class OptimizationService {
    // 🚀 NEW CORTEX SERVICES FOR META-LANGUAGE PROCESSING
    private static cortexEncoderService: CortexEncoderService;
    private static cortexCoreService: CortexCoreService;
    private static cortexDecoderService: CortexDecoderService;
    private static cortexInitialized = false;

    // Helper to map string to AIProvider enum
    private static getAIProviderFromString(provider: string): AIProvider {
        switch (provider.toLowerCase()) {
            case 'openai':
                return AIProvider.OpenAI;
            case 'aws-bedrock':
            case 'awsbedrock':
                return AIProvider.AWSBedrock;
            case 'anthropic':
                return AIProvider.Anthropic;
            case 'google':
                return AIProvider.Google;
            case 'cohere':
                return AIProvider.Cohere;
            case 'azure':
            case 'azure-openai':
                return AIProvider.Azure;
            case 'deepseek':
                return AIProvider.DeepSeek;
            case 'groq':
                return AIProvider.Groq;
            case 'huggingface':
                return AIProvider.HuggingFace;
            case 'ollama':
                return AIProvider.Ollama;
            case 'replicate':
                return AIProvider.Replicate;
            default:
                throw new Error(`Unknown AI provider: ${provider}`);
        }
    }

    /**
     * 🚀 Initialize Cortex services for meta-language processing
     */
    private static async initializeCortexServices(): Promise<void> {
        if (this.cortexInitialized) return;
        
        try {
            loggingService.info('🚀 Initializing Cortex meta-language services...');
            
            this.cortexEncoderService = CortexEncoderService.getInstance();
            this.cortexCoreService = CortexCoreService.getInstance();
            this.cortexDecoderService = CortexDecoderService.getInstance();
            
            await Promise.all([
                this.cortexEncoderService.initialize(),
                this.cortexCoreService.initialize(),
                this.cortexDecoderService.initialize()
            ]);
            
            this.cortexInitialized = true;
            loggingService.info('✅ Cortex services initialized successfully');
            
        } catch (error) {
            loggingService.error('❌ Failed to initialize Cortex services', {
                error: error instanceof Error ? error.message : String(error)
            });
            // Continue without Cortex - graceful degradation
        }
    }

    /**
     * 🚀 Process prompt using Cortex meta-language pipeline
     */
    private static async processCortexOptimization(
        originalPrompt: string, 
        cortexConfig: any, 
        userId: string
    ): Promise<{
        optimizedPrompt: string;
        cortexMetadata: any;
        tokenReduction?: { originalTokens: number; cortexTokens: number; reductionPercentage: number };
    }> {
        const startTime = Date.now();
        
        try {
            // 🎯 Step 0: Check semantic cache first
            loggingService.info('🔍 Checking Cortex semantic cache...', { userId });
            const cachedResult = await CortexCacheService.getCachedResult(originalPrompt);
            
            if (cachedResult) {
                loggingService.info('🎯 Using cached Cortex result', {
                    userId,
                    cacheAge: Math.round((Date.now() - cachedResult.createdAt.getTime()) / 60000),
                    accessCount: cachedResult.accessCount,
                    processingTime: Date.now() - startTime
                });

                return {
                    optimizedPrompt: cachedResult.optimizedPrompt,
                    cortexMetadata: {
                        ...cachedResult.cortexMetadata,
                        processingTime: Date.now() - startTime,
                        cacheHit: true,
                        originalCacheTime: cachedResult.cortexMetadata.processingTime
                    },
                    tokenReduction: cachedResult.tokenReduction
                };
            }

            loggingService.info('🔄 Starting Cortex processing pipeline...', { userId });

            // Step 1: Encode natural language to Cortex
            loggingService.info('🔄 Step 1: Starting Cortex encoding...', { userId });
            const encodingRequest: CortexEncodingRequest = {
                text: originalPrompt,
                context: 'optimization processing',
                metadata: {
                    domain: 'general',
                    language: 'en',
                    complexity: 'medium'
                }
            };

            const encodingResult = await this.cortexEncoderService.encode(encodingRequest);
            loggingService.info('✅ Step 1: Cortex encoding completed', { 
                userId,
                frameType: (encodingResult.cortexFrame as any).frameType,
                confidence: encodingResult.confidence,
                originalText: originalPrompt,
                encodedCortex: JSON.stringify(encodingResult.cortexFrame, null, 2)
            });
            
            // Step 2: Process and optimize Cortex structure with enhanced information preservation
            const processingRequest: CortexProcessingRequest = {
                input: encodingResult.cortexFrame,
                operation: cortexConfig.processingOperation || 'optimize',
                options: {
                    preserveSemantics: cortexConfig.preserveSemantics !== false,
                    targetReduction: 20, // Reduced from 30% to 20% to preserve more information
                    maxProcessingTime: 15000 // 15 second timeout
                },
                metadata: {
                    userId,
                    provider: 'optimization-service'
                }
            };

            const processingResult = await this.cortexCoreService.process(processingRequest);
            
            // 🔍 Enhanced Integrity Check After Core Processing
            const semanticIntegrity = processingResult.metadata?.semanticIntegrity || 0;
            const minIntegrityThreshold = 0.85; // Raised threshold for better information preservation
            
            loggingService.info('🔍 DEBUG Step 2: Core processing completed', {
                userId,
                originalCortex: JSON.stringify(encodingResult.cortexFrame, null, 2),
                processedCortex: JSON.stringify(processingResult.output, null, 2),
                semanticIntegrity,
                preserveSemantics: processingRequest.options?.preserveSemantics,
                integrityThreshold: minIntegrityThreshold,
                passesThreshold: semanticIntegrity >= minIntegrityThreshold
            });

            // Information preservation validation
            if (semanticIntegrity < minIntegrityThreshold) {
                loggingService.warn('⚠️ Low semantic integrity detected after core processing', {
                    userId,
                    semanticIntegrity,
                    threshold: minIntegrityThreshold,
                    attemptingRecovery: true
                });
                
                // Attempt recovery with conservative processing
                const conservativeRequest: CortexProcessingRequest = {
                    ...processingRequest,
                    operation: 'analyze', // More conservative operation
                    options: {
                        ...processingRequest.options,
                        preserveSemantics: true,
                        targetReduction: 10 // Much lower reduction target
                    }
                };
                
                try {
                    const recoveryResult = await this.cortexCoreService.process(conservativeRequest);
                    const recoveredIntegrity = recoveryResult.metadata?.semanticIntegrity || 0;
                    
                    if (recoveredIntegrity >= minIntegrityThreshold) {
                        loggingService.info('✅ Recovery processing successful', {
                            userId,
                            recoveredIntegrity,
                            originalIntegrity: semanticIntegrity
                        });
                        // Use recovery result instead
                        processingResult.output = recoveryResult.output;
                        processingResult.metadata = {
                            ...processingResult.metadata,
                            ...recoveryResult.metadata,
                            semanticIntegrity: recoveredIntegrity
                        };
                        
                        // Log recovery success with additional context
                        loggingService.info('📊 Recovery metadata preserved', {
                            userId,
                            recoveryUsed: true,
                            originalIntegrity: semanticIntegrity
                        });
                    } else {
                        throw new Error(`Recovery processing also failed integrity check: ${recoveredIntegrity}`);
                    }
                } catch (recoveryError) {
                    loggingService.error('❌ Recovery processing failed, using original frame', {
                        userId,
                        error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
                    });
                    
                    // Use original frame to prevent information loss
                    processingResult.output = encodingResult.cortexFrame;
                    processingResult.metadata = {
                        ...processingResult.metadata,
                        semanticIntegrity: 1.0
                    };
                    
                    // Log preservation mode with additional context
                    loggingService.warn('🛡️ Information preservation mode activated', {
                        userId,
                        fallbackUsed: true,
                        preservationMode: true,
                        reason: 'Used original frame to prevent information loss'
                    });
                }
            }
            
            // Step 3: Decode back to natural language
            const decodingRequest: CortexDecodingRequest = {
                cortexStructure: processingResult.output,
                style: cortexConfig.outputStyle || 'conversational',
                format: cortexConfig.outputFormat || 'plain',
                options: {
                    enhanceReadability: true
                }
            };

            const decodingResult = await this.cortexDecoderService.decode(decodingRequest);
            
            loggingService.info('🔍 DEBUG Step 3: Decoding completed', {
                userId,
                inputCortexForDecoding: JSON.stringify(decodingRequest.cortexStructure, null, 2),
                finalOptimizedPrompt: decodingResult.text,
                originalPrompt: originalPrompt,
                statementToQuestionConversion: originalPrompt.includes('costs') && decodingResult.text.includes('How much')
            });
            
            // 🚨 QUALITY CHECK: Detect terrible AI responses and use intelligent fallback
            if (await this.isTerribleResponse(decodingResult.text, originalPrompt)) {
                loggingService.warn('🚨 DETECTED TERRIBLE AI RESPONSE - Using intelligent fallback', {
                    userId,
                    originalPrompt: originalPrompt.substring(0, 100),
                    terribleResponse: decodingResult.text,
                    reason: 'AI response is clearly inferior to original'
                });
                
                const intelligentResult = await this.createIntelligentOptimization(originalPrompt);
                decodingResult.text = intelligentResult;
            }

            // Calculate token reduction
            const originalTokens = originalPrompt.length / 4; // Rough estimate
            const optimizedTokens = decodingResult.text.length / 4;
            const reductionPercentage = ((originalTokens - optimizedTokens) / originalTokens) * 100;

            const cortexMetadata = {
                processingTime: Date.now() - startTime,
                encodingConfidence: encodingResult.confidence,
                optimizationsApplied: processingResult.optimizations.length,
                decodingConfidence: decodingResult.confidence,
                semanticIntegrity: processingResult.metadata.semanticIntegrity,
                cortexModel: {
                    encoder: DEFAULT_CORTEX_CONFIG.encoding.model,
                    core: DEFAULT_CORTEX_CONFIG.coreProcessing.model,
                    decoder: DEFAULT_CORTEX_CONFIG.decoding.model
                },
                tokensSaved: Math.max(0, originalTokens - optimizedTokens),
                reductionPercentage: Math.max(0, reductionPercentage)
            };

            loggingService.info('✅ Cortex processing completed successfully', {
                userId,
                processingTime: cortexMetadata.processingTime,
                tokensSaved: cortexMetadata.tokensSaved,
                reductionPercentage: `${cortexMetadata.reductionPercentage.toFixed(1)}%`
            });

            // 💾 Cache the successful result for future use
            const tokenReductionData = {
                originalTokens,
                cortexTokens: optimizedTokens,
                reductionPercentage
            };

            await CortexCacheService.setCachedResult(
                originalPrompt,
                decodingResult.text,
                cortexMetadata,
                tokenReductionData
            );

            return {
                optimizedPrompt: decodingResult.text,
                cortexMetadata,
                tokenReduction: tokenReductionData
            };

        } catch (error) {
            loggingService.error('❌ CORTEX FAILED - USING INTELLIGENT FALLBACK:', {
                userId,
                error: error instanceof Error ? error.message : String(error),
                errorStack: error instanceof Error ? error.stack : undefined,
                processingTime: Date.now() - startTime
            });
            
            // AGGRESSIVE FALLBACK - bypass the broken system entirely
            const fallbackOptimizedPrompt = await this.createIntelligentOptimization(originalPrompt);
            return {
                optimizedPrompt: fallbackOptimizedPrompt,
                cortexMetadata: {
                    processingTime: Date.now() - startTime,
                    fallbackUsed: true,
                    fallbackReason: 'AWS Bedrock credentials invalid - using intelligent text processing',
                    originalLength: originalPrompt.length,
                    error: error instanceof Error ? error.message : String(error),
                    cortexModel: {
                        encoder: DEFAULT_CORTEX_CONFIG.encoding.model,
                        core: DEFAULT_CORTEX_CONFIG.coreProcessing.model,
                        decoder: DEFAULT_CORTEX_CONFIG.decoding.model
                    }
                },
                tokenReduction: this.calculateTokenReduction(originalPrompt, fallbackOptimizedPrompt)
            };

        }
    }
    
    /**
     * Create intelligent optimization that preserves semantic meaning
     * when AI systems fail
     */
    private static async createIntelligentOptimization(originalPrompt: string): Promise<string> {
        loggingService.info('🛡️ LLM-BASED INTELLIGENT OPTIMIZATION: Starting', {
            originalLength: originalPrompt.length,
            optimizationMode: 'llm_based_preservation'
        });

        try {
            const optimizationPrompt = `CRITICAL: Remove ONLY unnecessary filler words. DO NOT:
- Change any facts, details, or meaning
- Remove specific information (error messages, numbers, names)
- Summarize or paraphrase
- Change the tone or urgency
- Remove context or background

KEEP EXACTLY:
- All technical details and error messages
- All specific requirements or tasks
- All important context and background
- The original meaning and intent
- All formatting instructions

Original prompt:
${originalPrompt}

Return the same prompt with only obvious filler words removed (like extra "just", "really", "actually", "basically", etc.).`;

            const optimizedResult = await BedrockService.invokeModel(
                optimizationPrompt,
                'amazon.nova-pro-v1:0' // Nova Pro for quality assessment
            );

            if (!optimizedResult || typeof optimizedResult !== 'string') {
                loggingService.warn('🔄 LLM optimization failed, preserving original');
                return originalPrompt;
            }

            const optimizedPrompt = optimizedResult.trim();

            // Validate the LLM optimization result
            // Check if optimization actually changed the prompt
            if (originalPrompt.trim() === optimizedPrompt.trim()) {
                loggingService.warn('⚠️ LLM optimization produced identical prompt, preserving original', {
                    originalLength: originalPrompt.length,
                    reason: 'no_changes_detected'
                });
                return originalPrompt;
            }

            // Safety check: If optimization reduced length by more than 70%, it's likely summarizing not optimizing
            const reductionRatio = (originalPrompt.length - optimizedPrompt.length) / originalPrompt.length;
            if (reductionRatio > 0.7) {
                loggingService.warn('⚠️ LLM optimization reduced length too drastically, likely summarizing instead of optimizing', {
                    originalLength: originalPrompt.length,
                    optimizedLength: optimizedPrompt.length,
                    reductionRatio: reductionRatio.toFixed(2),
                    reason: 'excessive_reduction'
                });
                return originalPrompt;
            }

            const validation = await this.validateLLMOptimization(originalPrompt, optimizedPrompt);
            
            if (!validation.isValid) {
                loggingService.warn('⚠️ LLM optimization validation failed, preserving original', {
                    validationIssues: validation.issues,
                    optimizedLength: optimizedPrompt.length,
                    originalLength: originalPrompt.length
                });
                return originalPrompt;
            }

            const reductionPercentage = ((originalPrompt.length - optimizedPrompt.length) / originalPrompt.length) * 100;
            
            loggingService.info('✅ LLM-based intelligent optimization successful', {
                originalLength: originalPrompt.length,
                optimizedLength: optimizedPrompt.length,
                reductionPercentage: reductionPercentage.toFixed(1),
                validationPassed: true,
                informationLoss: 'none'
            });

            return optimizedPrompt;

        } catch (error) {
            loggingService.error('❌ LLM-based optimization failed, preserving original', {
                error: error instanceof Error ? error.message : String(error),
                originalLength: originalPrompt.length
            });
            return originalPrompt; // Always preserve original on failure
        }
    }

    /**
     * Validate LLM optimization result using another LLM call
     */
    private static async validateLLMOptimization(original: string, optimized: string): Promise<{
        isValid: boolean;
        issues: string[];
    }> {
        try {
            const validationPrompt = `CRITICAL VALIDATION: Compare these prompts and identify if ANY important information was lost.

ORIGINAL: ${original}
OPTIMIZED: ${optimized}

Check for:
1. Same facts and details? 
2. Same meaning and intent?
3. Same technical information?
4. Same urgency/tone?
5. No semantic inversion (success vs failure)?

Reply ONLY: {"valid": true/false, "issues": ["specific issue 1", "specific issue 2"]}`;

            const validationResult = await BedrockService.invokeModel(
                validationPrompt,
                'amazon.nova-pro-v1:0' // Nova Pro for quality assessment
            );

            if (!validationResult) {
                return { isValid: false, issues: ['Validation service unavailable'] };
            }

            try {
                const parsed = JSON.parse(validationResult.trim());
                const isValid = parsed.valid === true;
                const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
                
                // If only minimal changes (less than 20 chars difference), be more lenient
                const lengthDiff = Math.abs(original.length - optimized.length);
                if (lengthDiff < 20 && issues.length === 0) {
                    loggingService.info('✅ Accepting minimal optimization with no validation issues', {
                        lengthDiff,
                        originalLength: original.length,
                        optimizedLength: optimized.length
                    });
                    return { isValid: true, issues: [] };
                }
                
                return { isValid, issues };
            } catch (parseError) {
                loggingService.error('Failed to parse validation result', { parseError, validationResult });
                // For minimal changes, default to valid if parsing fails
                const lengthDiff = Math.abs(original.length - optimized.length);
                if (lengthDiff < 20) {
                    return { isValid: true, issues: ['Validation parsing failed but minimal changes detected'] };
                }
                return { isValid: false, issues: ['Validation result parsing failed'] };
            }

        } catch (error) {
            loggingService.error('Validation service error', { error });
            return { isValid: false, issues: ['Validation service error'] };
        }
    }
    
    /**
     * Detect terrible AI responses that should trigger intelligent fallback
     */
    private static async isTerribleResponse(response: string, original: string): Promise<boolean> {
        loggingService.info('🔍 LLM-based quality check: Analyzing response quality', {
            originalLength: original.length,
            responseLength: response.length,
            reductionPercentage: ((original.length - response.length) / original.length * 100).toFixed(1)
        });

        // Quick manual checks for obvious failures first (faster than LLM call)
        const quickChecks = this.quickQualityChecks(response, original);
        if (quickChecks.isObviouslyTerrible) {
            loggingService.warn('🚨 Quick check detected terrible response', { 
                reason: quickChecks.reason 
            });
            return true;
        }

        try {
            const qualityPrompt = `Analyze this optimization quality. Reply with ONLY valid JSON:

ORIGINAL: ${original.substring(0, 400)}...
OPTIMIZED: ${response.substring(0, 400)}...

Is the optimized version terrible compared to original?

REPLY FORMAT (JSON only):
{"is_terrible": false, "quality_score": 8.5}`;

            const qualityResult = await BedrockService.invokeModel(
                qualityPrompt,
                'amazon.nova-pro-v1:0' // Nova Pro for quality assessment // Fast, cheap model for validation
            );

            if (!qualityResult) {
                loggingService.warn('Quality assessment service unavailable, using conservative approach');
                return response.length < original.length * 0.3; // Conservative fallback
            }

            try {
                // Clean the response and extract JSON
                let cleanedResult = qualityResult.trim();
                
                // Try to extract JSON from potential markdown code blocks or explanatory text
                const jsonMatch = cleanedResult.match(/\{[\s\S]*?\}/);
                if (jsonMatch) {
                    cleanedResult = jsonMatch[0];
                }

                const assessment = JSON.parse(cleanedResult);
                
                const isTerrible = assessment.is_terrible === true || 
                                 assessment.quality_score < 6.0 ||
                                 assessment.recommendation === 'keep_original';

                if (isTerrible) {
                    loggingService.warn('🚨 LLM quality assessment: Terrible response detected', {
                        qualityScore: assessment.quality_score,
                        issues: assessment.issues,
                        recommendation: assessment.recommendation
                    });
                } else {
                    loggingService.info('✅ LLM quality assessment: Response quality acceptable', {
                        qualityScore: assessment.quality_score,
                        recommendation: assessment.recommendation
                    });
                }

                return isTerrible;

            } catch (parseError) {
                loggingService.error('Failed to parse quality assessment', { 
                    parseError: parseError instanceof Error ? parseError.message : String(parseError),
                    rawResponse: qualityResult.substring(0, 200)
                });
                
                // Intelligent fallback - analyze the response content for obvious quality issues
                const lowerResponse = response.toLowerCase();
                
                // Check for obvious quality issues
                const hasMeaninglessContent = lowerResponse.includes('summary has been generated') ||
                                            lowerResponse.includes('please let me know') ||
                                            lowerResponse.includes('i have analyzed') ||
                                            lowerResponse.includes('here is a summary') ||
                                            lowerResponse.includes('key points') ||
                                            lowerResponse.includes('aims to capture');
                                            
                const isExcessivelyShort = response.length < original.length * 0.3;
                const isExcessivelyGeneric = response.split(' ').length < 20;
                
                const shouldFallback = hasMeaninglessContent || isExcessivelyShort || isExcessivelyGeneric;
                
                loggingService.warn('🚨 DETECTED TERRIBLE AI RESPONSE - Using intelligent fallback', {
                    userId: 'system', // We don't have userId here, but logging for debugging
                    originalPrompt: original.substring(0, 100),
                    terribleResponse: response,
                    reason: shouldFallback ? 'AI response is clearly inferior to original' : 'Parsing failed but response seems acceptable'
                });
                
                return shouldFallback;
            }

        } catch (error) {
            loggingService.error('Quality assessment service error, using fallback', { error });
            // Conservative fallback on service error
            return response.length < original.length * 0.3;
        }
    }

    /**
     * Quick manual checks for obviously terrible responses (faster than LLM call)
     */
    private static quickQualityChecks(response: string, original: string): {
        isObviouslyTerrible: boolean;
        reason?: string;
    } {
        const cleanResponse = response.trim().toLowerCase();
        
        // 1. Exact terrible responses
        const terribleResponses = ['describe?', 'describe', 'what?', 'how?', 'why?', 'when?', 'where?'];
        if (terribleResponses.includes(cleanResponse)) {
            return { isObviouslyTerrible: true, reason: 'Exact match with terrible response' };
        }
        
        // 2. Extreme reduction (>95% - almost certainly wrong)
        if (response.length < original.length * 0.05 && original.length > 50) {
            return { isObviouslyTerrible: true, reason: 'Extreme content reduction >95%' };
        }
        
        // 3. Single word for complex input
        if (response.split(' ').length === 1 && original.split(' ').length > 10) {
            return { isObviouslyTerrible: true, reason: 'Single word response for complex input' };
        }
        
        // 4. Incomplete/cut off responses
        if (response.endsWith('...') || response.endsWith(',') || response.endsWith('and')) {
            return { isObviouslyTerrible: true, reason: 'Response appears incomplete or cut off' };
        }

        // 5. Empty or whitespace only
        if (response.trim().length === 0) {
            return { isObviouslyTerrible: true, reason: 'Empty response' };
        }

        return { isObviouslyTerrible: false };
    }
    
    /**
     * Calculate token reduction metrics
     */
    private static calculateTokenReduction(original: string, optimized: string): { originalTokens: number; cortexTokens: number; reductionPercentage: number } {
        const originalTokens = original.length / 4; // Rough estimate
        const cortexTokens = optimized.length / 4;
        const reductionPercentage = ((originalTokens - cortexTokens) / originalTokens) * 100;
        
        return {
            originalTokens,
            cortexTokens,
            reductionPercentage: Math.max(0, reductionPercentage)
        };
    }

    static async createOptimization(request: OptimizationRequest): Promise<IOptimization> {
        try {
            const provider = this.getAIProviderFromString(request.service);

            // 🚀 CORTEX PROCESSING: Check if Cortex is enabled and process accordingly
            let cortexResult: any = null;
            
            // DEBUG: Log the request options
                            console.log('🔍 CORTEX DEBUG - Options check:', {
                    userId: request.userId,
                    hasOptions: !!request.options,
                    enableCortex: request.options?.enableCortex,
                    hasCortexConfig: !!request.options?.cortexConfig,
                    willTriggerCortex: !!request.options?.enableCortex
                });
                
                loggingService.info('🔍 DEBUG: Cortex options check', {
                    userId: request.userId,
                    hasOptions: !!request.options,
                    enableCortex: request.options?.enableCortex,
                    hasCortexConfig: !!request.options?.cortexConfig,
                    cortexConfig: request.options?.cortexConfig
                });
            
                            if (request.options?.enableCortex) {
                    console.log('🚀 CORTEX TRIGGERED - Processing requested for userId:', request.userId);
                    loggingService.info('🚀 Cortex processing requested', { userId: request.userId });
                
                try {
                    // Initialize Cortex services if not already done
                    await this.initializeCortexServices();
                    
                    loggingService.info('🔍 Cortex initialization status', { 
                        userId: request.userId, 
                        cortexInitialized: this.cortexInitialized 
                    });
                    
                    if (this.cortexInitialized) {
                        loggingService.info('⚡ Starting Cortex processing pipeline', { userId: request.userId });
                        
                        cortexResult = await this.processCortexOptimization(
                            request.prompt,
                            request.options.cortexConfig || {},
                            request.userId
                        );
                        
                        loggingService.info('✅ Cortex processing completed', { 
                            userId: request.userId,
                            hasResult: !!cortexResult,
                            hasError: cortexResult?.cortexMetadata?.error
                        });
                    } else {
                        loggingService.warn('⚠️ Cortex requested but services not available - falling back to traditional optimization', {
                            userId: request.userId
                        });
                    }
                } catch (error) {
                    loggingService.error('❌ Cortex processing failed with error', {
                        userId: request.userId,
                        error: error instanceof Error ? error.message : String(error),
                        stack: error instanceof Error ? error.stack : undefined
                    });

                    // Return a detailed error result instead of null
                    cortexResult = {
                        optimizedPrompt: request.prompt,
                        cortexMetadata: {
                            error: `Cortex processing failed: ${error instanceof Error ? error.message : String(error)}`,
                            fallbackUsed: true,
                            processingTime: Date.now() - Date.now(),
                            cortexModel: {
                                encoder: DEFAULT_CORTEX_CONFIG.encoding.model,
                                core: DEFAULT_CORTEX_CONFIG.coreProcessing.model,
                                decoder: DEFAULT_CORTEX_CONFIG.decoding.model
                            },
                            detailsForDebugging: {
                                errorType: error instanceof Error ? error.constructor.name : 'Unknown',
                                errorMessage: error instanceof Error ? error.message : String(error),
                                initStatus: this.cortexInitialized
                            }
                        }
                    };
                }
            } else {
                loggingService.info('📝 Traditional optimization (Cortex not enabled)', { userId: request.userId });
            }


            // Get token count and cost for ORIGINAL prompt (not the processed one!)
            let originalTokens;
            try {
                originalTokens = await estimateTokensAsync(request.prompt, provider, request.model); // Use async for high accuracy
            } catch (error) {
                loggingService.warn(`Failed to estimate tokens for original prompt, using fallback: ${error}`);
                originalTokens = estimateTokens(request.prompt, provider, request.model); // Sync fallback with model info
            }
            
            let originalSimpleEstimate;
            try {
                originalSimpleEstimate = estimateCost(
                    originalTokens,
                    150, // Expected completion tokens
                    providerEnumToString(provider),
                    request.model
                );
            } catch (error) {
                loggingService.warn(`No pricing data found for ${providerEnumToString(provider)}/${request.model}, using fallback pricing`);
                // Use fallback pricing (GPT-4o-mini rates as default)
                originalSimpleEstimate = {
                    inputCost: (originalTokens / 1_000_000) * 0.15,
                    outputCost: (150 / 1_000_000) * 0.60,
                    totalCost: (originalTokens / 1_000_000) * 0.15 + (150 / 1_000_000) * 0.60
                };
            }
            
            const originalEstimate: CostEstimate = convertToCostEstimate(
                originalSimpleEstimate,
                originalTokens,
                150,
                provider,
                request.model
            );

            // Run the enhanced optimization using internal utilities
            let optimizationResult: OptimizationResult;
            try {
                optimizationResult = generateOptimizationSuggestions(
                    request.prompt,
                    provider,
                    request.model,
                    request.conversationHistory
                );
            } catch (error) {
                loggingService.error('Failed to generate optimization suggestions:', { error: error instanceof Error ? error.message : String(error) });
                // Create a fallback optimization result
                optimizationResult = {
                    id: 'fallback-optimization',
                    totalSavings: 10,
                    suggestions: [{
                        id: 'fallback-compression',
                        type: 'compression',
                        explanation: 'Basic prompt compression applied',
                        estimatedSavings: 10,
                        confidence: 0.7,
                        optimizedPrompt: request.prompt.replace(/\s+/g, ' ').trim(),
                        compressionDetails: {
                            technique: 'pattern_replacement',
                            originalSize: request.prompt.length,
                            compressedSize: request.prompt.replace(/\s+/g, ' ').trim().length,
                            compressionRatio: 0.9,
                            reversible: false
                        }
                    }],
                    appliedOptimizations: ['compression'],
                    metadata: {
                        processingTime: 1,
                        originalTokens: request.prompt.length / 4,
                        optimizedTokens: request.prompt.replace(/\s+/g, ' ').trim().length / 4,
                        techniques: ['compression']
                    }
                };
            }

            // Apply the optimizations to get the actual optimized prompt
            let optimizedPrompt = request.prompt;
            let appliedOptimizations: string[] = [];
            
            // 🚀 USE CORTEX RESULT if available and successful
            if (cortexResult && !cortexResult.cortexMetadata.error) {
                optimizedPrompt = cortexResult.optimizedPrompt;
                
                // 🚨 FINAL QUALITY CHECK - Replace terrible responses with intelligent optimization
                if (await this.isTerribleResponse(optimizedPrompt, request.prompt)) {
                    loggingService.warn('🚨 FINAL QUALITY CHECK: Cortex returned terrible response, using intelligent fallback', {
                        userId: request.userId,
                        originalPrompt: request.prompt.substring(0, 100),
                        terribleCortexResponse: optimizedPrompt,
                        reason: 'Final quality check detected unusable response'
                    });
                    
                    optimizedPrompt = await this.createIntelligentOptimization(request.prompt);
                    appliedOptimizations.push('intelligent_fallback');
                } else {
                    appliedOptimizations.push('cortex_optimization');
                }
                
                loggingService.info('✅ Using final optimized prompt', {
                    userId: request.userId,
                    originalLength: request.prompt.length,
                    optimizedLength: optimizedPrompt.length,
                    reduction: `${cortexResult.cortexMetadata.reductionPercentage.toFixed(1)}%`,
                    wasIntelligentFallback: appliedOptimizations.includes('intelligent_fallback')
                });
            } else if (optimizationResult.suggestions.length > 0) {
                // Fall back to traditional optimization
                const bestSuggestion = optimizationResult.suggestions[0];
                if (bestSuggestion.optimizedPrompt) {
                    optimizedPrompt = bestSuggestion.optimizedPrompt;
                    appliedOptimizations.push(bestSuggestion.id);
                } else if (bestSuggestion.type === 'compression') {
                    // Apply basic compression if no optimized prompt is provided
                    optimizedPrompt = request.prompt.replace(/\s+/g, ' ').trim();
                    appliedOptimizations.push('compression');
                }
            }

            // Get token count and cost for optimized prompt
            let optimizedTokens;
            try {
                optimizedTokens = await estimateTokensAsync(optimizedPrompt, provider, request.model);
            } catch (error) {
                loggingService.warn(`Failed to estimate tokens for optimized prompt, using fallback: ${error}`);
                optimizedTokens = estimateTokens(optimizedPrompt, provider, request.model); // Sync fallback with model info
            }
            
            let optimizedSimpleEstimate;
            try {
                optimizedSimpleEstimate = estimateCost(
                    optimizedTokens,
                    150, // Expected completion tokens
                    providerEnumToString(provider),
                    request.model
                );
            } catch (error) {
                loggingService.warn(`No pricing data found for ${providerEnumToString(provider)}/${request.model}, using fallback pricing for optimized prompt`);
                // Use fallback pricing (GPT-4o-mini rates as default)
                optimizedSimpleEstimate = {
                    inputCost: (optimizedTokens / 1_000_000) * 0.15,
                    outputCost: (150 / 1_000_000) * 0.60,
                    totalCost: (optimizedTokens / 1_000_000) * 0.15 + (150 / 1_000_000) * 0.60
                };
            }
            
            const optimizedEstimate: CostEstimate = convertToCostEstimate(
                optimizedSimpleEstimate,
                optimizedTokens,
                150,
                provider,
                request.model
            );

            // Calculate baseline savings using traditional method
            const totalOriginalTokens = (originalEstimate.breakdown?.promptTokens || originalTokens) + (originalEstimate.breakdown?.completionTokens || 150);
            const totalOptimizedTokens = (optimizedEstimate.breakdown?.promptTokens || optimizedTokens) + (optimizedEstimate.breakdown?.completionTokens || 150);
            
            // DEBUG: Log the actual token calculations to identify the issue
            console.log('🔍 TOKEN CALCULATION DEBUG:', {
                originalPromptTokens: originalTokens,
                optimizedPromptTokens: optimizedTokens,
                originalBreakdownPromptTokens: originalEstimate.breakdown?.promptTokens,
                optimizedBreakdownPromptTokens: optimizedEstimate.breakdown?.promptTokens,
                originalBreakdownCompletionTokens: originalEstimate.breakdown?.completionTokens,
                optimizedBreakdownCompletionTokens: optimizedEstimate.breakdown?.completionTokens,
                totalOriginalTokens,
                totalOptimizedTokens,
                originalPromptLength: request.prompt.length,
                optimizedPromptLength: optimizedPrompt.length
            });
            
            let rawTokensSaved = totalOriginalTokens - totalOptimizedTokens;
            let rawCostSaved = originalEstimate.totalCost - optimizedEstimate.totalCost;
            let rawImprovementPercentage = totalOriginalTokens > 0 ? (rawTokensSaved / totalOriginalTokens) * 100 : 0;

            // 🚀 OVERRIDE with Cortex results if available and successful
            if (cortexResult && !cortexResult.cortexMetadata.error) {
                loggingService.info('🔄 Using Cortex token calculations instead of traditional estimates', {
                    userId: request.userId,
                    traditionalTokensSaved: rawTokensSaved,
                    cortexTokensSaved: cortexResult.cortexMetadata.tokensSaved,
                    cortexReductionPercentage: cortexResult.cortexMetadata.reductionPercentage
                });

                // Use Cortex token savings
                rawTokensSaved = cortexResult.cortexMetadata.tokensSaved;
                rawImprovementPercentage = cortexResult.cortexMetadata.reductionPercentage;
                
                // Recalculate cost savings based on Cortex token savings
                const originalTokenCost = totalOriginalTokens * (originalEstimate.totalCost / totalOriginalTokens);
                const optimizedTokenCost = (totalOriginalTokens - rawTokensSaved) * (originalEstimate.totalCost / totalOriginalTokens);
                rawCostSaved = originalTokenCost - optimizedTokenCost;
            }
            
            // Ensure non-negative values for database validation
            const tokensSaved = Math.max(0, rawTokensSaved);
            const costSaved = Math.max(0, rawCostSaved);
            const improvementPercentage = Math.max(0, rawImprovementPercentage);

            // Log if optimization increased token count
            if (rawTokensSaved < 0) {
                loggingService.warn('⚠️ Optimization increased token count', {
                    userId: request.userId,
                    originalTokens: totalOriginalTokens,
                    optimizedTokens: totalOptimizedTokens,
                    increase: Math.abs(rawTokensSaved),
                    source: cortexResult && !cortexResult.cortexMetadata.error ? 'cortex' : 'traditional'
                });
            }

            // Determine category based on optimization type
            const optimizationType = optimizationResult.suggestions.length > 0 ? optimizationResult.suggestions[0].type : 'compression';
            const category = this.determineCategoryFromType(optimizationType);

            // Build metadata based on optimization type
            const metadata: any = {
                analysisTime: optimizationResult.metadata.processingTime,
                confidence: optimizationResult.suggestions.length > 0 ? optimizationResult.suggestions[0].confidence : 0.5,
                optimizationType: optimizationType,
                appliedTechniques: appliedOptimizations,
            };

            // 🚀 ADD CORTEX METADATA if Cortex was used
            if (cortexResult) {
                metadata.cortex = cortexResult.cortexMetadata;
                metadata.cortexEnabled = true;
                
                // Override traditional optimization values if Cortex was successful
                if (!cortexResult.cortexMetadata.error) {
                    metadata.cortexProcessingTime = cortexResult.cortexMetadata.processingTime;
                    metadata.cortexSemanticIntegrity = cortexResult.cortexMetadata.semanticIntegrity;
                    metadata.cortexTokenReduction = cortexResult.tokenReduction;
                    
                    // Add Cortex-specific optimization techniques
                    if (!appliedOptimizations.includes('cortex_optimization')) {
                        appliedOptimizations.push('cortex_optimization');
                    }
                }
            } else {
                metadata.cortexEnabled = false;
            }

            // Add type-specific metadata
            if (optimizationResult.suggestions.length > 0) {
                const bestSuggestion = optimizationResult.suggestions[0];
                if (bestSuggestion.compressionDetails) {
                    metadata.compressionDetails = bestSuggestion.compressionDetails;
                }
                if (bestSuggestion.contextTrimDetails) {
                    metadata.contextTrimDetails = bestSuggestion.contextTrimDetails;
                }
                if (bestSuggestion.fusionDetails) {
                    metadata.fusionDetails = bestSuggestion.fusionDetails;
                }
            }

            // Create optimization record
            const optimization = await Optimization.create({
                userId: request.userId,
                originalPrompt: request.prompt,
                optimizedPrompt: optimizedPrompt,
                optimizationTechniques: appliedOptimizations,
                originalTokens: totalOriginalTokens,
                optimizedTokens: totalOptimizedTokens,
                tokensSaved,
                originalCost: originalEstimate.totalCost,
                optimizedCost: optimizedEstimate.totalCost,
                costSaved,
                improvementPercentage,
                service: request.service,
                model: request.model,
                category,
                suggestions: optimizationResult.suggestions.map((suggestion, index) => ({
                    type: suggestion.type,
                    description: suggestion.explanation,
                    impact: suggestion.estimatedSavings > 30 ? 'high' : suggestion.estimatedSavings > 15 ? 'medium' : 'low',
                    implemented: index === 0,
                })),
                metadata,
            });

            // Update user's optimization count
            await User.findByIdAndUpdate(request.userId, {
                $inc: {
                    'usage.currentMonth.optimizationsSaved': costSaved,
                },
            });

            // Track activity
            await ActivityService.trackActivity(request.userId, {
                type: 'optimization_created',
                title: 'Created Optimization',
                description: `Saved $${costSaved.toFixed(4)} (${improvementPercentage.toFixed(1)}% improvement)`,
                metadata: {
                    optimizationId: optimization._id,
                    service: request.service,
                    model: request.model,
                    cost: originalEstimate.totalCost,
                    saved: costSaved,
                    techniques: optimizationResult.appliedOptimizations
                }
            });

            // Create alert if significant savings
            if (improvementPercentage > 30) {
                await Alert.create({
                    userId: request.userId,
                    type: 'optimization_available',
                    title: 'Significant Optimization Available',
                    message: `You can save ${improvementPercentage.toFixed(1)}% on tokens using ${optimizationType} optimization.`,
                    severity: 'medium',
                    data: {
                        optimizationId: optimization._id,
                        savings: costSaved,
                        percentage: improvementPercentage,
                        optimizationType: optimizationType,
                    },
                });
            }

            loggingService.info('Optimization created', { value:  { 
                userId: request.userId,
                originalTokens: totalOriginalTokens,
                optimizedTokens: totalOptimizedTokens,
                savings: improvementPercentage,
                type: optimizationType,
             } });

            return optimization;
        } catch (error) {
            loggingService.error('Error creating optimization:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    static async createBatchOptimization(request: BatchOptimizationRequest): Promise<IOptimization[]> {
        try {
            // Use internal optimization utilities instead of external tracker
            const { generateOptimizationSuggestions } = require('../utils/optimizationUtils');

            // Convert requests to FusionRequest format
            const fusionRequests = request.requests.map(r => ({
                id: r.id,
                prompt: r.prompt,
                timestamp: r.timestamp,
                model: r.model,
                provider: this.getAIProviderFromString(r.provider),
                metadata: {}
            }));

            // Run request fusion optimization
            const optimizationResult: OptimizationResult = generateOptimizationSuggestions(fusionRequests);

            const optimizations: IOptimization[] = [];

            // Create optimization records for each suggestion
            for (const suggestion of optimizationResult.suggestions) {
                if (suggestion.type === 'request_fusion' && suggestion.fusionDetails) {
                    // Calculate costs for all fused requests
                    let originalTotalCost = 0;
                    let originalTotalTokens = 0;

                    for (const req of request.requests) {
                        const provider = this.getAIProviderFromString(req.provider);
                        const promptTokens = estimateTokens(req.prompt, provider);
                        
                        let estimate;
                        try {
                            estimate = estimateCost(
                                promptTokens,
                                150,
                                providerEnumToString(provider),
                                req.model
                            );
                        } catch (error) {
                            loggingService.warn(`No pricing data found for ${providerEnumToString(provider)}/${req.model}, using fallback pricing`);
                            // Use fallback pricing (GPT-4o-mini rates as default)
                            estimate = {
                                inputCost: (promptTokens / 1_000_000) * 0.15,
                                outputCost: (150 / 1_000_000) * 0.60,
                                totalCost: (promptTokens / 1_000_000) * 0.15 + (150 / 1_000_000) * 0.60
                            };
                        }
                        
                        originalTotalCost += estimate.totalCost;
                        originalTotalTokens += promptTokens + 150;
                    }

                    // Calculate optimized cost
                    const firstProvider = this.getAIProviderFromString(request.requests[0].provider);
                    const optimizedPromptTokens = estimateTokens(suggestion.optimizedPrompt!, firstProvider);
                    
                    let optimizedEstimate;
                    try {
                        optimizedEstimate = estimateCost(
                            optimizedPromptTokens,
                            150,
                            providerEnumToString(firstProvider),
                            request.requests[0].model
                        );
                    } catch (error) {
                        loggingService.warn(`No pricing data found for ${providerEnumToString(firstProvider)}/${request.requests[0].model}, using fallback pricing`);
                        // Use fallback pricing (GPT-4o-mini rates as default)
                        optimizedEstimate = {
                            inputCost: (optimizedPromptTokens / 1_000_000) * 0.15,
                            outputCost: (150 / 1_000_000) * 0.60,
                            totalCost: (optimizedPromptTokens / 1_000_000) * 0.15 + (150 / 1_000_000) * 0.60
                        };
                    }

                    const optimizedTokens = optimizedPromptTokens + 150;
                    const rawTokensSaved = originalTotalTokens - optimizedTokens;
                    const rawCostSaved = originalTotalCost - optimizedEstimate.totalCost;
                    const rawImprovementPercentage = originalTotalTokens > 0 ? (rawTokensSaved / originalTotalTokens) * 100 : 0;
                    
                    // Ensure non-negative values for database validation
                    const tokensSaved = Math.max(0, rawTokensSaved);
                    const costSaved = Math.max(0, rawCostSaved);
                    const improvementPercentage = Math.max(0, rawImprovementPercentage);

                    // Log if fusion increased length
                    if (rawTokensSaved < 0) {
                        loggingService.warn('⚠️ Request fusion increased token count', {
                            userId: request.userId,
                            originalTokens: originalTotalTokens,
                            fusedTokens: optimizedTokens,
                            increase: Math.abs(rawTokensSaved)
                        });
                    }

                    const optimization = await Optimization.create({
                        userId: request.userId,
                        originalPrompt: request.requests.map(r => r.prompt).join('\n\n---\n\n'),
                        optimizedPrompt: suggestion.optimizedPrompt!,
                        optimizationTechniques: ['request_fusion', suggestion.fusionDetails.fusionStrategy],
                        originalTokens: originalTotalTokens,
                        optimizedTokens,
                        tokensSaved,
                        originalCost: originalTotalCost,
                        optimizedCost: optimizedEstimate.totalCost,
                        costSaved,
                        improvementPercentage,
                        service: request.requests[0].provider,
                        model: request.requests[0].model,
                        category: 'batch_processing',
                        suggestions: [{
                            type: 'request_fusion',
                            description: suggestion.explanation,
                            impact: improvementPercentage > 30 ? 'high' : improvementPercentage > 15 ? 'medium' : 'low',
                            implemented: true,
                        }],
                        metadata: {
                            fusionDetails: suggestion.fusionDetails,
                            originalRequestCount: request.requests.length,
                            fusionStrategy: suggestion.fusionDetails.fusionStrategy,
                        },
                    });

                    optimizations.push(optimization);
                }
            }

            return optimizations;
        } catch (error) {
            loggingService.error('Error creating batch optimization:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    private static determineCategoryFromType(type: string): string {
        const typeMap: Record<string, string> = {
            'prompt': 'prompt_reduction',
            'compression': 'prompt_reduction',
            'context_trimming': 'context_optimization',
            'request_fusion': 'batch_processing',
            'model': 'model_selection',
            'caching': 'response_formatting',
            'batching': 'batch_processing',
        };

        return typeMap[type] || 'prompt_reduction';
    }

    static async getOptimizations(
        filters: OptimizationFilters,
        options: PaginationOptions
    ) {
        try {
            const query: any = {};

            if (filters.userId) query.userId = filters.userId;
            if (filters.applied !== undefined) query.applied = filters.applied;
            if (filters.category) query.category = filters.category;
            if (filters.minSavings !== undefined) query.costSaved = { $gte: filters.minSavings };
            if (filters.startDate || filters.endDate) {
                query.createdAt = {};
                if (filters.startDate) query.createdAt.$gte = filters.startDate;
                if (filters.endDate) query.createdAt.$lte = filters.endDate;
            }

            const page = options.page || 1;
            const limit = options.limit || 10;
            const skip = (page - 1) * limit;
            const sort: any = {};

            if (options.sort) {
                sort[options.sort] = options.order === 'asc' ? 1 : -1;
            } else {
                sort.createdAt = -1; // Default to most recent first
            }

            const [data, total] = await Promise.all([
                Optimization.find(query)
                    .sort(sort)
                    .skip(skip)
                    .limit(limit)
                    .populate('userId', 'name email')
                    .lean(),
                Optimization.countDocuments(query),
            ]);

            return paginate(data, total, options);
        } catch (error) {
            loggingService.error('Error fetching optimizations:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    static async applyOptimization(optimizationId: string, userId: string): Promise<void> {
        try {
            const optimization = await Optimization.findOne({
                _id: optimizationId,
                userId,
            });

            if (!optimization) {
                throw new Error('Optimization not found');
            }

            optimization.applied = true;
            optimization.appliedAt = new Date();
            optimization.appliedCount = (optimization.appliedCount || 0) + 1;
            await optimization.save();

            // Track activity
            await ActivityService.trackActivity(userId, {
                type: 'optimization_applied',
                title: 'Applied Optimization',
                description: `Applied optimization saving $${optimization.costSaved.toFixed(4)}`,
                metadata: {
                    optimizationId: optimization._id,
                    service: optimization.service,
                    model: optimization.model,
                    saved: optimization.costSaved
                }
            });

            loggingService.info('Optimization applied', { value:  { 
                optimizationId,
                userId,
             } });
        } catch (error) {
            loggingService.error('Error applying optimization:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    static async provideFeedback(
        optimizationId: string,
        userId: string,
        feedback: {
            helpful: boolean;
            rating?: number;
            comment?: string;
        }
    ): Promise<void> {
        try {
            const optimization = await Optimization.findOne({
                _id: optimizationId,
                userId,
            });

            if (!optimization) {
                throw new Error('Optimization not found');
            }

            optimization.feedback = {
                ...feedback,
                submittedAt: new Date(),
            };
            await optimization.save();

            loggingService.info('Optimization feedback provided', { value:  { 
                optimizationId,
                helpful: feedback.helpful,
                rating: feedback.rating,
             } });
        } catch (error) {
            loggingService.error('Error providing optimization feedback:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    static async analyzeOptimizationOpportunities(userId: string) {
        try {
            // Get recent high-cost usage patterns for the user
            const recentUsage = await Usage.find({ userId })
                .sort({ createdAt: -1 })
                .limit(50);

            const suggestions = recentUsage
                .filter(usage => usage.cost > 0.01) // High cost threshold
                .map(usage => ({
                    id: usage._id.toString(),
                    type: 'prompt_optimization',
                    originalPrompt: usage.prompt,
                    estimatedSavings: usage.cost * 0.2, // Estimate 20% savings
                    confidence: 0.8,
                    explanation: `This prompt could be optimized to reduce token usage and costs.`,
                    implementation: 'Consider simplifying the prompt or using a more efficient model.'
                }))
                .slice(0, 10); // Top 10 opportunities

            // Create alerts for top opportunities
            if (suggestions.length > 0) {
                const topOpportunity = suggestions[0];
                await Alert.create({
                    userId,
                    type: 'optimization_available',
                    title: 'Optimization Opportunities Found',
                    message: `You have ${suggestions.length} prompts that could be optimized. The top opportunity could save approximately ${topOpportunity.estimatedSavings.toFixed(2)}%.`,
                    severity: 'low',
                    data: {
                        opportunitiesCount: suggestions.length,
                        topOpportunity,
                    },
                });
            }

            return {
                opportunities: suggestions,
                totalPotentialSavings: suggestions.reduce((sum: number, s: any) => sum + s.estimatedSavings, 0),
            };
        } catch (error) {
            loggingService.error('Error analyzing optimization opportunities:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    static async generateBulkOptimizations(userId: string, promptIds: string[]) {
        try {
            const prompts = await Usage.find({
                userId,
                _id: { $in: promptIds },
            }).select('prompt service model');

            const optimizations: IOptimization[] = [];

            for (const promptData of prompts) {
                try {
                    const optimization = await this.createOptimization({
                        userId,
                        prompt: promptData.prompt,
                        service: promptData.service,
                        model: promptData.model,
                    });
                    optimizations.push(optimization);
                } catch (error) {
                    loggingService.error(`Error optimizing prompt ${promptData._id}:`, { error: error instanceof Error ? error.message : String(error) });
                }
            }

            return {
                total: promptIds.length,
                successful: optimizations.length,
                failed: promptIds.length - optimizations.length,
                optimizations,
            };
        } catch (error) {
            loggingService.error('Error generating bulk optimizations:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    static async getPromptsForBulkOptimization(
        userId: string,
        filters: {
            service?: string;
            minCalls?: number;
            timeframe?: string;
        }
    ) {
        try {
            const { service, minCalls = 5, timeframe = '30d' } = filters;

            // Calculate date range
            const startDate = new Date();
            const days = timeframe === '7d' ? 7 : timeframe === '30d' ? 30 : 90;
            startDate.setDate(startDate.getDate() - days);

            // Build aggregation pipeline
            const matchStage: any = {
                userId: new mongoose.Types.ObjectId(userId),
                createdAt: { $gte: startDate }
            };

            if (service) {
                matchStage.service = service;
            }

            const prompts = await Usage.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: '$prompt',
                        count: { $sum: 1 },
                        totalCost: { $sum: '$cost' },
                        avgTokens: { $avg: '$totalTokens' },
                        models: { $addToSet: '$model' },
                        services: { $addToSet: '$service' }
                    }
                },
                { $match: { count: { $gte: minCalls } } },
                { $sort: { count: -1 } },
                { $limit: 50 },
                {
                    $project: {
                        prompt: '$_id',
                        count: 1,
                        promptId: { $toString: '$_id' },
                        totalCost: 1,
                        avgTokens: 1,
                        models: 1,
                        services: 1
                    }
                }
            ]);

            return prompts;
        } catch (error: any) {
            loggingService.error('Get prompts for bulk optimization error:', { error: error instanceof Error ? error.message : String(error) });
            throw new Error('Failed to get prompts for bulk optimization');
        }
    }

    static async getOptimizationTemplates(category?: string) {
        try {
            // Get real optimization templates from database
            const matchStage: any = {};
            if (category) {
                matchStage.category = category;
            }

            const templates = await Optimization.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: '$category',
                        count: { $sum: 1 },
                        avgImprovement: { $avg: '$improvementPercentage' },
                        totalSaved: { $sum: '$costSaved' },
                        examples: {
                            $push: {
                                before: '$originalPrompt',
                                after: '$optimizedPrompt',
                                savings: '$improvementPercentage'
                            }
                        }
                    }
                },
                {
                    $project: {
                        id: '$_id',
                        name: {
                            $switch: {
                                branches: [
                                    { case: { $eq: ['$_id', 'prompt_optimization'] }, then: 'Prompt Optimization' },
                                    { case: { $eq: ['$_id', 'context_trimming'] }, then: 'Context Trimming' },
                                    { case: { $eq: ['$_id', 'compression'] }, then: 'Compression' },
                                    { case: { $eq: ['$_id', 'model_switching'] }, then: 'Model Switching' }
                                ],
                                default: 'General Optimization'
                            }
                        },
                        category: '$_id',
                        description: {
                            $switch: {
                                branches: [
                                    { case: { $eq: ['$_id', 'prompt_optimization'] }, then: 'Optimize prompts for better efficiency and cost reduction' },
                                    { case: { $eq: ['$_id', 'context_trimming'] }, then: 'Reduce context length while maintaining quality' },
                                    { case: { $eq: ['$_id', 'compression'] }, then: 'Compress prompts using various techniques' },
                                    { case: { $eq: ['$_id', 'model_switching'] }, then: 'Switch to more cost-effective models' }
                                ],
                                default: 'General optimization techniques'
                            }
                        },
                        examples: { $slice: ['$examples', 3] },
                        techniques: {
                            $switch: {
                                branches: [
                                    { case: { $eq: ['$_id', 'prompt_optimization'] }, then: ['rewriting', 'simplification', 'structure_optimization'] },
                                    { case: { $eq: ['$_id', 'context_trimming'] }, then: ['sliding_window', 'relevance_filtering', 'summarization'] },
                                    { case: { $eq: ['$_id', 'compression'] }, then: ['json_compression', 'pattern_replacement', 'abbreviation'] },
                                    { case: { $eq: ['$_id', 'model_switching'] }, then: ['cost_analysis', 'performance_comparison', 'capability_matching'] }
                                ],
                                default: ['general_optimization']
                            }
                        },
                        avgImprovement: { $round: ['$avgImprovement', 2] }
                    }
                }
            ]);

            return templates;
        } catch (error: any) {
            loggingService.error('Get optimization templates error:', { error: error instanceof Error ? error.message : String(error) });
            throw new Error('Failed to get optimization templates');
        }
    }

    static async getOptimizationHistory(promptHash: string, userId: string) {
        try {
            // Get optimization history for a specific prompt
            const history = await Optimization.find({
                userId: new mongoose.Types.ObjectId(userId),
                $or: [
                    { originalPrompt: { $regex: promptHash, $options: 'i' } },
                    { optimizedPrompt: { $regex: promptHash, $options: 'i' } }
                ]
            })
                .sort({ createdAt: -1 })
                .limit(10)
                .select('originalPrompt optimizedPrompt tokensSaved costSaved improvementPercentage applied appliedAt createdAt')
                .lean();

            const formattedHistory = history.map((opt, index) => ({
                id: opt._id,
                version: history.length - index, // Calculate version based on order
                prompt: opt.optimizedPrompt || opt.originalPrompt,
                tokens: opt.tokensSaved || 0,
                cost: opt.costSaved || 0,
                createdAt: opt.createdAt,
                appliedAt: opt.appliedAt
            }));

            return {
                history: formattedHistory,
                currentVersion: formattedHistory.length > 0 ? formattedHistory[0].version : 1
            };
        } catch (error: any) {
            loggingService.error('Get optimization history error:', { error: error instanceof Error ? error.message : String(error) });
            throw new Error('Failed to get optimization history');
        }
    }

    static async revertOptimization(optimizationId: string, userId: string, version?: number) {
        try {
            // Find the optimization to revert
            const optimization = await Optimization.findOne({
                _id: new mongoose.Types.ObjectId(optimizationId),
                userId: new mongoose.Types.ObjectId(userId)
            });

            if (!optimization) {
                throw new Error('Optimization not found');
            }

            // Mark as not applied (revert)
            optimization.applied = false;
            optimization.appliedAt = undefined;

            // Add metadata about the reversion
            if (!optimization.metadata) {
                optimization.metadata = {};
            }
            optimization.metadata.revertedAt = new Date();
            optimization.metadata.revertedVersion = version || 1;

            await optimization.save();

            // Log the reversion
            loggingService.info('Optimization reverted:', { value:  { 
                optimizationId,
                userId,
                revertedAt: optimization.metadata.revertedAt
             } });

            return {
                message: 'Optimization reverted successfully',
                revertedAt: optimization.metadata.revertedAt
            };
        } catch (error: any) {
            loggingService.error('Revert optimization error:', { error: error instanceof Error ? error.message : String(error) });
            throw new Error('Failed to revert optimization');
        }
    }
}