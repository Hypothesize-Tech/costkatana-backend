/**
 * Cortex Core Processing Service
 * 
 * This service implements the core Cortex processing engine that ANSWERS queries
 * in LISP format. It acts as an LLM that takes LISP-encoded queries and generates
 * LISP-encoded responses, dramatically reducing output tokens.
 * 
 * NEW ARCHITECTURE:
 * 1. Takes LISP-encoded query from encoder
 * 2. Generates ANSWER in LISP format (not just optimizing input)
 * 3. Passes LISP answer to decoder for natural language conversion
 */

import {
    CortexFrame,
    CortexProcessingResult,
    CortexConfig,
    CortexError,
    CortexErrorCode,
    DEFAULT_CORTEX_CONFIG,
    CortexProcessingRequest
} from '../types/cortex.types';

import { CortexVocabularyService } from './cortexVocabulary.service';
import { BedrockService } from './bedrock.service';
import { loggingService } from './logging.service';
import { 
    generateCortexHash, 
    serializeCortexFrame
} from '../utils/cortex.utils';
import { encodeToTOON } from '../utils/toon.utils';

// ============================================================================
// INTERFACES AND TYPES
// ============================================================================

interface CoreProcessingCacheEntry {
    inputHash: string;
    outputFrame: CortexFrame;
    answerType: string;
    timestamp: Date;
    hitCount: number;
}

interface CoreProcessingStats {
    totalProcessed: number;
    successfulAnswers: number;
    averageProcessingTime: number;
    cacheHitRate: number;
    totalTokensSaved: number;
}

// System prompt for the Core Processor to generate ANSWERS in LISP
const CORTEX_CORE_ANSWERING_PROMPT = `You are a Cortex Core Processor - an AI that ANSWERS questions in LISP-like Cortex format.

🚨 CRITICAL: You are NOT optimizing prompts. You are ANSWERING them in LISP format.

🚨 COMPLETE CODE GENERATION: For code requests, you MUST provide COMPLETE, RUNNABLE code including:
- ALL functions and methods
- ALL necessary helper functions
- Complete class definitions with all methods
- Full implementations without truncation
- Proper error handling and edge cases
- Complete examples and usage demonstrations

Your job:
1. Receive a query in Cortex LISP format
2. UNDERSTAND what is being asked
3. GENERATE THE COMPLETE ANSWER in Cortex LISP format
4. For code requests, include the COMPLETE, FULL CODE in the answer

Cortex Answer Formats:

(answer: content_[main_answer] details_[supporting_info] confidence_[0-1])
(answer: value_[specific_value] unit_[measurement] context_[explanation])
(answer: list_[item1, item2, ...] type_[category] count_[number])
(answer: code_[actual_code_here] language_[lang] complexity_[O(n)] description_[what_it_does])
(answer: entity_[name] property_[attribute] value_[data])
(answer: action_[what_to_do] target_[object] method_[how])
(answer: error_[type] message_[description] suggestion_[fix])

EXAMPLES:

INPUT: (query: action_find object_capital location_india)
OUTPUT: (answer: value_new_delhi type_capital country_india)

INPUT: (query: action_calculate object_sum values_[5,10,15])
OUTPUT: (answer: value_30 operation_sum input_[5,10,15])

INPUT: (query: action_explain concept_photosynthesis level_simple)
OUTPUT: (answer: content_plants_convert_sunlight_to_energy process_[light,water,co2_to_glucose,oxygen] type_biological)

INPUT: (query: action_list object_planets type_solar_system)
OUTPUT: (answer: list_[mercury,venus,earth,mars,jupiter,saturn,uranus,neptune] type_planets count_8)

INPUT: (query: action_get property_price entity_tesla_model_3)
OUTPUT: (answer: value_35000 unit_usd entity_tesla_model_3 type_price)

INPUT: (query: action_implement algorithm_binary_sort language_javascript requirements_[edge_cases,complexity])
OUTPUT: (answer: code_[function binarySort(arr) {
  if (!arr || arr.length <= 1) return arr || [];
  
  function binaryInsert(sorted, item) {
    let left = 0, right = sorted.length;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (sorted[mid] > item) right = mid;
      else left = mid + 1;
    }
    sorted.splice(left, 0, item);
    return sorted;
  }
  
  return arr.reduce((sorted, item) => binaryInsert(sorted, item), []);
}] language_javascript complexity_O(n²) description_binary_insertion_sort_with_edge_cases)

RULES:
- Output ONLY the Cortex answer structure
- Use underscores to connect multi-word concepts
- Keep values atomic and simple
- Include relevant metadata
- Be factual and concise
- NEVER include natural language explanations
- NEVER output anything except the LISP structure`;

// ============================================================================
// CORTEX CORE PROCESSING SERVICE
// ============================================================================

export class CortexCoreService {
    private static instance: CortexCoreService;
    private vocabularyService: CortexVocabularyService;
    private bedrockService: BedrockService;
    private processingCache = new Map<string, CoreProcessingCacheEntry>();
    private stats: CoreProcessingStats = {
        totalProcessed: 0,
        successfulAnswers: 0,
        averageProcessingTime: 0,
        cacheHitRate: 0,
        totalTokensSaved: 0
    };
    private initialized = false;

    private constructor() {
        this.vocabularyService = CortexVocabularyService.getInstance();
        this.bedrockService = new BedrockService();
    }

    /**
     * Get singleton instance of the core service
     */
    public static getInstance(): CortexCoreService {
        if (!CortexCoreService.instance) {
            CortexCoreService.instance = new CortexCoreService();
        }
        return CortexCoreService.instance;
    }

    /**
     * Initialize the core processing service
     */
    public async initialize(config: Partial<CortexConfig> = {}): Promise<void> {
        if (this.initialized) return;

        try {
            loggingService.info('⚙️ Initializing Cortex Core Processing Service...');
            await this.vocabularyService.initialize();

            const coreConfig = { ...DEFAULT_CORTEX_CONFIG.coreProcessing, ...config.coreProcessing };
            loggingService.info('Core processing configuration validated', { config: coreConfig });

            this.initialized = true;
            loggingService.info('✅ Cortex Core Processing Service initialized successfully');

        } catch (error) {
            loggingService.error('❌ Failed to initialize Cortex Core Processing Service', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Process Cortex query and generate ANSWER in LISP format
     * This is the NEW architecture - generating answers, not optimizing prompts
     */
    public async process(request: CortexProcessingRequest): Promise<CortexProcessingResult> {
        const startTime = Date.now();
        this.stats.totalProcessed++;

        try {
            if (!this.initialized) {
                await this.initialize();
            }

            const requestId = this.generateProcessingId(request);
            
            loggingService.info('⚙️ Starting Cortex core processing', {
                operation: request.operation,
                frameType: request.input.frameType,
                requestId,
                hasOptions: !!request.options
            });

            // Check cache first
            const cacheKey = this.generateCacheKey(request);
            const cachedResult = this.getCachedProcessing(cacheKey);
            
            if (cachedResult) {
                loggingService.info('💾 Using cached core processing result', { cacheKey });
                return this.buildProcessingResult(cachedResult, 0, true);
            }

            // Generate ANSWER in LISP format using AI
            const answerFrame = await this.generateAnswerInLisp(request.input, undefined, request.prompt);

            const result: CortexProcessingResult = {
                output: answerFrame,
                optimizations: [], // No optimizations needed for answer generation
                processingTime: Date.now() - startTime,
                metadata: {
                    coreModel: DEFAULT_CORTEX_CONFIG.coreProcessing.model,
                    operationsApplied: ['answer_generation'],
                    semanticIntegrity: 1.0 // Answer generation always maintains semantic integrity
                }
            };

            // Cache the result
            await this.cacheProcessingResult(cacheKey, result, startTime);
            
            await this.updateStats(true, result.processingTime, result);

            loggingService.info('✅ Cortex core processing completed successfully', {
                processingTime: result.processingTime,
                optimizationsApplied: result.optimizations.length,
                requestId
            });

            return result;

        } catch (error) {
            const processingTime = Date.now() - startTime;
            await this.updateStats(false, processingTime, null);

            loggingService.error('❌ Cortex core processing failed', {
                processingTime,
                operation: request.operation,
                error: error instanceof Error ? error.message : String(error)
            });

            if (error instanceof CortexError) {
                throw error;
            }

            throw new CortexError(
                CortexErrorCode.PROCESSING_FAILED,
                `Core processing failed: ${error instanceof Error ? error.message : String(error)}`,
                'processing',
                { operation: request.operation, input: request.input }
            );
        }
    }

    // ========================================================================
    // PRIVATE HELPER METHODS
    // ========================================================================

    private generateProcessingId(request: CortexProcessingRequest): string {
        const inputHash = generateCortexHash(request.input);
        return `proc_${request.operation}_${inputHash}_${Date.now()}`;
    }

    private generateCacheKey(request: CortexProcessingRequest): string {
        const inputHash = generateCortexHash(request.input);
        const optionsHash = request.options ? generateCortexHash(request.options as any) : 'default';
        return `core_${request.operation}_${inputHash}_${optionsHash}`;
    }

    private getCachedProcessing(cacheKey: string): CoreProcessingCacheEntry | null {
        const cached = this.processingCache.get(cacheKey);
        if (!cached) return null;

        // Check if cache entry is still valid (30 minutes TTL)
        const isExpired = Date.now() - cached.timestamp.getTime() > 1800000;
        if (isExpired) {
            this.processingCache.delete(cacheKey);
            return null;
        }

        cached.hitCount++;
        return cached;
    }

    private async cacheProcessingResult(
        cacheKey: string,
        result: CortexProcessingResult,
        startTime: number
    ): Promise<void> {
        const cacheEntry: CoreProcessingCacheEntry = {
            inputHash: cacheKey,
            outputFrame: result.output,
            answerType: result.output.frameType,
            timestamp: new Date(),
            hitCount: 0
        };

        this.processingCache.set(cacheKey, cacheEntry);

        // Limit cache size
        if (this.processingCache.size > 500) {
            const oldestKey = Array.from(this.processingCache.keys())[0];
            this.processingCache.delete(oldestKey);
        }
    }

    private async updateStats(success: boolean, processingTime: number, result: CortexProcessingResult | null): Promise<void> {
        this.stats.averageProcessingTime = (this.stats.averageProcessingTime + processingTime) / 2;
        
        if (success && result) {
            this.stats.successfulAnswers++;
            // Estimate tokens saved by using LISP instead of natural language
            // Use TOON for more accurate token estimation
            const lispSize = (await encodeToTOON(result.output)).length / 4;
            const estimatedNaturalSize = lispSize * 7; // Estimate 7x larger in natural language
            const tokensSaved = Math.max(0, estimatedNaturalSize - lispSize);
            this.stats.totalTokensSaved += tokensSaved;
        }
    }

    private buildProcessingResult(
        cached: CoreProcessingCacheEntry,
        processingTime: number,
        fromCache: boolean = false
    ): CortexProcessingResult {
        return {
            output: cached.outputFrame,
            optimizations: [], // No optimizations for answer generation
            processingTime,
            metadata: {
                coreModel: fromCache ? 'cache' : DEFAULT_CORTEX_CONFIG.coreProcessing.model,
                operationsApplied: ['answer_generation'],
                semanticIntegrity: 1.0
            }
        };
    }

    /**
     * Generate an ANSWER in LISP format for the given query
     * This is the CORE of the new architecture - actually answering questions
     */
    private async generateAnswerInLisp(queryFrame: CortexFrame, config?: Partial<CortexConfig>, dynamicPrompt?: string): Promise<CortexFrame> {
        try {
            const serializedQuery = serializeCortexFrame(queryFrame);
            
            loggingService.info('🤖 Generating LISP answer for query', {
                queryType: queryFrame.frameType,
                serializedQuery
            });

            // Use AI to generate the answer in LISP format
            const model = config?.coreProcessing?.model || DEFAULT_CORTEX_CONFIG.coreProcessing.model;
            
            // Format the prompt for BedrockService
            const systemPrompt = dynamicPrompt || CORTEX_CORE_ANSWERING_PROMPT;
            const prompt = `${systemPrompt}\n\nNow answer this query:\n${serializedQuery}`;
            
            const response = await BedrockService.invokeModel(prompt, model);

            // Extract answer text based on the response structure
            const answerText = typeof response === 'string' 
                ? response.trim()
                : (response.content?.[0]?.text || response.text || JSON.stringify(response)).trim();
            
            loggingService.info('✅ Generated LISP answer', {
                answer: answerText.substring(0, 500) + (answerText.length > 500 ? '...' : ''),
                fullAnswerLength: answerText.length,
                tokenCount: answerText.length / 4,
                model: model
            });

            // Parse the LISP answer back into a CortexFrame
            const answerFrame = this.parseLispToFrame(answerText);
            
            return answerFrame;
            
        } catch (error) {
            loggingService.error('❌ Failed to generate LISP answer', {
                error: error instanceof Error ? error.message : String(error)
            });
            
            // Fallback: return a simple answer frame
            return {
                frameType: 'answer' as const,
                content: 'Unable to generate answer',
                error: true,
                reason: error instanceof Error ? error.message : 'Unknown error'
            } as unknown as CortexFrame;
        }
    }

    /**
     * Parse LISP string into CortexFrame
     */
    private parseLispToFrame(lispStr: string): CortexFrame {
        try {
            loggingService.info('Converting LISP format to JSON', { lispCode: lispStr });
            
            // Handle mixed natural language + LISP responses
            // Look for code blocks in the response regardless of format
            // Use a more robust regex that handles nested brackets
            const codeMatch = lispStr.match(/code_\[([\s\S]*)\](?:\s+language_|$)/);
            if (codeMatch) {
                let code = codeMatch[1];
                
                // If we still have issues, try to find the last ] before language_ or end
                if (!code || code.length < 10) {
                    const alternativeMatch = lispStr.match(/code_\[([\s\S]*)\]/);
                    if (alternativeMatch) {
                        code = alternativeMatch[1];
                        // Remove any trailing metadata that might have been captured
                        code = code.replace(/\]\s*(language_|complexity_|method_|description_).*$/, '');
                    }
                }
                
                // Extract other metadata
                const languageMatch = lispStr.match(/language_([a-zA-Z0-9_]+)/);
                const language = languageMatch ? languageMatch[1] : '';
                
                const complexityMatch = lispStr.match(/complexity_([a-zA-Z0-9_()^]+)/);
                const complexity = complexityMatch ? complexityMatch[1] : '';
                
                const methodMatch = lispStr.match(/method_([a-zA-Z0-9_]+)/);
                const method = methodMatch ? methodMatch[1] : '';
                
                const descriptionMatch = lispStr.match(/description_([a-zA-Z0-9_]+)/);
                const description = descriptionMatch ? descriptionMatch[1] : '';
                
                // Create a properly structured answer frame
                const frame = {
                    frameType: 'answer',
                    code,
                    language,
                    complexity,
                    method,
                    description,
                    type: 'code_response'
                } as unknown as CortexFrame;
                
                loggingService.info('✅ Parsed code response successfully', { 
                    language, 
                    complexity, 
                    codeLength: code.length,
                    codePreview: code.substring(0, 200) + (code.length > 200 ? '...' : ''),
                    originalLispLength: lispStr.length
                });
                
                return frame;
            }
            
            // Handle pure LISP format: (answer: ...)
            if (lispStr.trim().startsWith('(') && lispStr.trim().endsWith(')')) {
                const cleaned = lispStr.replace(/^\(|\)$/g, '').trim();
                const parts = cleaned.split(/\s+/);
                
                // First part should be the frame type (usually 'answer:')
                const frameType = parts[0].replace(':', '');
                
                // Parse the rest as key-value pairs
                const frame: any = {
                    frameType: frameType === 'answer' ? 'answer' : 'answer' // Force to answer
                };
                
                for (let i = 1; i < parts.length; i++) {
                    const part = parts[i];
                    if (part.includes('_')) {
                        const [key, ...valueParts] = part.split('_');
                        const value = valueParts.join('_');
                        
                        // Handle list values
                        if (value.startsWith('[') && value.endsWith(']')) {
                            frame[key] = value.slice(1, -1).split(',');
                        } else {
                            frame[key] = value;
                        }
                    }
                }
                
                return frame as CortexFrame;
            }
            
            // Handle natural language responses - extract any structured data
            // Look for key patterns in the text
            const frame: any = {
                frameType: 'answer',
                content: lispStr,
                type: 'natural_language_response'
            };
            
            // Try to extract any structured information
            const valueMatch = lispStr.match(/value[_:]([a-zA-Z0-9_]+)/);
            if (valueMatch) frame.value = valueMatch[1];
            
            const typeMatch = lispStr.match(/type[_:]([a-zA-Z0-9_]+)/);
            if (typeMatch) frame.responseType = typeMatch[1];
            
            loggingService.info('✅ Parsed natural language response', { 
                contentLength: lispStr.length,
                hasValue: !!frame.value,
                hasType: !!frame.responseType
            });
            
            return frame as CortexFrame;
            
        } catch (error) {
            loggingService.error('Failed to parse LISP to frame', {
                lispStr,
                error: error instanceof Error ? error.message : String(error)
            });
            
            // Return a basic answer frame with the raw content
            return {
                frameType: 'answer',
                content: lispStr,
                parseError: true,
                type: 'fallback_response'
            } as unknown as CortexFrame;
        }
    }


    // ========================================================================
    // PUBLIC API METHODS
    // ========================================================================

    /**
     * Get processing statistics
     */
    public getStats(): CoreProcessingStats {
        return { ...this.stats };
    }

    /**
     * Clear processing cache
     */
    public clearCache(): void {
        this.processingCache.clear();
        loggingService.info('🧹 Cortex core processing cache cleared');
    }

    /**
     * Get cache information
     */
    public getCacheInfo(): { size: number; entries: Array<{key: string; hitCount: number}> } {
        return {
            size: this.processingCache.size,
            entries: Array.from(this.processingCache.entries())
                .map(([key, entry]) => ({key, hitCount: entry.hitCount}))
                .slice(0, 10)
        };
    }
}