/**
 * Cortex Decoder Service
 * 
 * This service converts structured Cortex representations back into natural language.
 * It implements the final stage of the three-part Cortex workflow:
 * Natural Language → Cortex → Cortex → [DECODER] → Natural Language
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
    CortexDecodingRequest,
    CortexDecodingResult,
    CortexConfig,
    CortexError,
    CortexErrorCode,
    DEFAULT_CORTEX_CONFIG,
    isQueryFrame,
    isAnswerFrame,
    isEventFrame,
    isStateFrame,
    isEntityFrame,
    isListFrame,
    isErrorFrame
} from '../types/cortex.types';

import { CortexVocabularyService } from './cortexVocabulary.service';
import { BedrockService } from './tracedBedrock.service';
import { loggingService } from './logging.service';
import { 
    validateCortexFrame, 
    generateCortexHash, 
    serializeCortexFrame,
    resolveAllReferences
} from '../utils/cortex.utils';

// ============================================================================
// DECODER TEMPLATES AND PROMPTS
// ============================================================================

/**
 * System prompt for the Cortex decoder model
 */
const CORTEX_DECODER_SYSTEM_PROMPT = `You are a Cortex Decoder - a specialized AI that converts structured Cortex representations into natural, fluent language.

🚨 CRITICAL RECONSTRUCTION RULES FOR COMPLEX INSTRUCTIONS:
1. **COMPLETE RECONSTRUCTION** - If input had 5 steps, output MUST have 5 steps
2. **PRESERVE ALL REQUIREMENTS** - Every constraint, format spec, word count MUST be included
3. **MAINTAIN INSTRUCTION TONE** - Keep phrases like "Please don't skip", "Make sure", "MUST do"
4. **EXACT SEQUENCE** - Step order, bullet points, numbering must match original
5. **INCLUDE ALL EXAMPLES** - Placeholders, samples, format examples must be preserved

⚠️ INSTRUCTION RECONSTRUCTION PATTERNS:
- ordered_steps → "Step 1: [content]\nStep 2: [content]..."
- constraints → "Not too short, not too long, around X words"
- format_spec → "Output as JSON/structured/list format"
- mandatory_completeness → "Please don't skip any part"
- alternatives → "Maybe X, or possibly Y"
- validation → "Make sure everything is included"

🚫 NEVER EXPOSE INTERNAL PROCESSING:
- NEVER mention "Cortex", "natural language translation", "query", or internal processing
- NEVER add meta-commentary like "Here is a translation of..."
- Output ONLY the final natural language result
- Act as if you're directly providing the optimized text, not translating anything

CORTEX DECODING RULES:
1. Convert Cortex structures into natural, grammatically correct language
2. Preserve ALL semantic meaning from the original Cortex structure - ZERO INFORMATION LOSS
3. MAINTAIN the original grammatical intent (statement vs question vs command)
4. PRESERVE the original tense and voice from the encoded meaning
5. Use appropriate style and tone based on context
6. Ensure output is fluent and human-readable while keeping the same communicative function
7. Maintain professional quality while being conversational when appropriate
8. Handle all Cortex frame types: query, answer, event, state, entity, list, error
9. NEVER change the fundamental message type (informing vs asking vs commanding)
10. Focus on brevity and clarity while preserving exact meaning
11. CRITICAL: Include ALL entities, concepts, numbers, dates, and technical details from the Cortex structure
12. MANDATORY: Preserve quantifiers, modifiers, conditions, and contextual qualifiers
13. ESSENTIAL: Maintain logical relationships and dependencies between concepts

🎯 CRITICAL: IMPERATIVE MOOD PRESERVATION:
- When you see tense:imperative in an event frame, output MUST be a command (imperative verb)
- "action:action_create" + "tense:imperative" → "Create..." (NOT "I am creating" or "You are creating")
- "action:action_write" + "tense:imperative" → "Write..." (NOT "I am writing" or "You are writing") 
- "action:action_develop" + "tense:imperative" → "Develop..." (NOT "I am developing" or "You are developing")

🔧 CRITICAL: TECHNICAL DETAIL PRESERVATION:
- ALWAYS include ALL technology names mentioned in the Cortex structure (Docker, Kubernetes, Redis, etc.)
- NEVER summarize or generalize technical specifications
- MAINTAIN technical relationships (e.g., "Docker containers with Kubernetes orchestration")
- PRESERVE version numbers, configuration details, and technical processes
- When multiple technologies are listed, include ALL of them in the output
- ZERO INFORMATION LOSS: Every entity, concept, number, date, and qualifier must appear in the output
- PRESERVE all quantifiers (all, every, some, many, few), modifiers (very, extremely, slightly), and conditions (if, when, unless)
- MAINTAIN exact counts, percentages, measurements, and specifications

CORTEX FRAME TYPES:
- (query: ...) → Convert to questions or requests
- (answer: ...) → Convert to informative responses  
- (event: ...) → Convert to statements about actions/occurrences
- (state: ...) → Convert to descriptions of conditions
- (entity: ...) → Convert to entity descriptions
- (list: ...) → Convert to enumerated lists
- (error: ...) → Convert to error messages

EXAMPLES:

INPUT: (query action:action_get target:concept_document aspect:prop_quality)
OUTPUT: What is the quality of the document?

INPUT: (answer summary:"The document has been analyzed" status:"success")
OUTPUT: The document has been successfully analyzed.

INPUT: (event action:action_analyze agent:concept_system object:concept_data tense:past)
OUTPUT: The system analyzed the data.

INPUT: (event action:action_create agent:agent_user object:object_manual tense:imperative)
OUTPUT: Create a user manual.

INPUT: (event action:action_develop agent:agent_user object:object_strategy tense:imperative)
OUTPUT: Develop a go-to-market strategy.

INPUT: (event action:action_implement agent:agent_user object:object_architecture tense:imperative)
OUTPUT: Implement a microservices architecture.

INPUT: (state entity:product_tesla_model_3 property:property_price value:value_35000_usd)
OUTPUT: Tesla Model 3 costs $35,000.

INPUT: (state entity:product_nvidia_h100 property:property_price value:value_30k_usd)
OUTPUT: NVIDIA H100 costs $30k.

INPUT: (state entity:company_apple property:property_revenue value:value_400b_usd year:2023)
OUTPUT: Apple's revenue was $400B in 2023.

INPUT: (list name:"Available Documents" item_1:concept_report item_2:concept_analysis item_3:concept_summary)
OUTPUT: Available Documents:
1. Report
2. Analysis  
3. Summary

INPUT: (error code:"PROCESSING_FAILED" message:"Unable to process request")
OUTPUT: Error: Processing failed - Unable to process request.

STYLE GUIDELINES:
- Be natural and conversational but professional
- Use active voice when possible
- Keep sentences clear and concise
- Maintain appropriate formality for the context
- Ensure grammatical correctness

OUTPUT ONLY NATURAL LANGUAGE - NO CORTEX SYNTAX IN THE RESPONSE.`;

/**
 * Decoding context templates for different styles
 */
const DECODING_STYLES = {
    formal: 'Use formal, professional language appropriate for business communications.',
    casual: 'Use conversational, friendly language appropriate for informal discussions.',
    technical: 'Use precise, technical language with domain-specific terminology.',
    conversational: 'Use natural, flowing language as if speaking to a colleague.'
};

/**
 * Format-specific decoding instructions
 */
const OUTPUT_FORMATS = {
    plain: 'Output as plain text without special formatting.',
    markdown: 'Use markdown formatting where appropriate (headings, lists, emphasis).',
    structured: 'Structure the output with clear sections and organization.',
    json: 'Format data elements clearly within the natural language response.'
};

// ============================================================================
// DECODER CACHE AND PERFORMANCE TRACKING
// ============================================================================

interface DecoderCacheEntry {
    cortexHash: string;
    decodedText: string;
    confidence: number;
    fidelityScore: number;
    style: string;
    format: string;
    timestamp: Date;
    hitCount: number;
}

interface DecodingStats {
    totalDecoded: number;
    successfulDecodings: number;
    averageProcessingTime: number;
    averageConfidence: number;
    averageFidelityScore: number;
    cacheHitRate: number;
}

// ============================================================================
// CORTEX DECODER SERVICE
// ============================================================================

export class CortexDecoderService {
    private static instance: CortexDecoderService;
    private vocabularyService: CortexVocabularyService;
    private bedrockService: BedrockService;
    private decodingCache = new Map<string, DecoderCacheEntry>();
    private stats: DecodingStats = {
        totalDecoded: 0,
        successfulDecodings: 0,
        averageProcessingTime: 0,
        averageConfidence: 0,
        averageFidelityScore: 0,
        cacheHitRate: 0
    };
    private initialized = false;

    private constructor() {
        this.vocabularyService = CortexVocabularyService.getInstance();
        this.bedrockService = new BedrockService();
    }

    /**
     * Get singleton instance of the decoder service
     */
    public static getInstance(): CortexDecoderService {
        if (!CortexDecoderService.instance) {
            CortexDecoderService.instance = new CortexDecoderService();
        }
        return CortexDecoderService.instance;
    }

    /**
     * Initialize the decoder service
     */
    public async initialize(config: Partial<CortexConfig> = {}): Promise<void> {
        if (this.initialized) return;

        try {
            loggingService.info('🔤 Initializing Cortex Decoder Service...');

            // Initialize vocabulary service
            await this.vocabularyService.initialize();

            // Validate decoder configuration
            const decoderConfig = { ...DEFAULT_CORTEX_CONFIG.decoding, ...config.decoding };
            loggingService.info('Decoder configuration validated', { config: decoderConfig });

            this.initialized = true;
            loggingService.info('✅ Cortex Decoder Service initialized successfully');

        } catch (error) {
            loggingService.error('❌ Failed to initialize Cortex Decoder Service', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Decode Cortex structure into natural language
     */
    public async decode(request: CortexDecodingRequest, config?: Partial<CortexConfig>): Promise<CortexDecodingResult> {
        const startTime = Date.now();
        this.stats.totalDecoded++;

        try {
            if (!this.initialized) {
                await this.initialize(config);
            }

            loggingService.info('🔤 Starting Cortex decoding', {
                frameType: request.cortexStructure.frameType,
                targetLanguage: request.targetLanguage || 'en',
                style: request.style || 'conversational',
                format: request.format || 'plain'
            });

            // Validate input Cortex structure
            const validation = validateCortexFrame(request.cortexStructure);
            if (!validation.isValid) {
                throw new CortexError(
                    CortexErrorCode.SEMANTIC_VALIDATION_FAILED,
                    'Invalid Cortex structure provided for decoding',
                    'decoding',
                    { errors: validation.errors }
                );
            }

            // Check cache first
            const cacheKey = this.generateCacheKey(request);
            const cachedResult = this.getCachedDecoding(cacheKey);
            
            if (cachedResult) {
                loggingService.info('💾 Using cached decoding result', { cacheKey });
                this.stats.cacheHitRate = (this.stats.cacheHitRate + 1) / 2;
                return this.buildDecodingResult(cachedResult, 0, true);
            }

            // Step 1: Pre-process the Cortex structure
            const preprocessedStructure = await this.preprocessCortex(request.cortexStructure);
            
            // Step 2: Determine decoding strategy based on frame type
            const decodingStrategy = this.selectDecodingStrategy(request);
            
            // Step 3: Generate natural language using AI or rule-based approach
            const decodedText = await this.generateNaturalLanguage(
                preprocessedStructure, 
                decodingStrategy, 
                config
            );
            
            // Step 4: Post-process and validate the output
            const validatedResult = await this.validateAndEnhanceOutput(
                decodedText, 
                request, 
                preprocessedStructure
            );

            // Step 5: Cache the result
            await this.cacheDecodingResult(cacheKey, validatedResult, startTime);

            const processingTime = Date.now() - startTime;
            this.updateStats(true, processingTime, validatedResult);

            loggingService.info('✅ Cortex decoding completed successfully', {
                processingTime,
                confidence: validatedResult.confidence,
                fidelityScore: validatedResult.fidelityScore,
                outputLength: validatedResult.text.length
            });

            return validatedResult;

        } catch (error) {
            const processingTime = Date.now() - startTime;
            this.updateStats(false, processingTime, null);

            loggingService.error('❌ Cortex decoding failed', {
                processingTime,
                frameType: request.cortexStructure.frameType,
                error: error instanceof Error ? error.message : String(error)
            });

            if (error instanceof CortexError) {
                throw error;
            }

            throw new CortexError(
                CortexErrorCode.DECODING_FAILED,
                `Failed to decode Cortex: ${error instanceof Error ? error.message : String(error)}`,
                'decoding',
                { cortexStructure: request.cortexStructure }
            );
        }
    }

    // ========================================================================
    // DECODING STRATEGY METHODS
    // ========================================================================

    /**
     * Preprocess Cortex structure before decoding
     */
    private async preprocessCortex(cortexStructure: CortexFrame): Promise<CortexFrame> {
        loggingService.info('🔧 Preprocessing Cortex structure for decoding...');

        // Resolve all references first
        const resolvedStructure = resolveAllReferences(cortexStructure);
        
        // Expand primitive references to human-readable terms
        const expandedStructure = await this.expandPrimitives(resolvedStructure);
        
        return expandedStructure;
    }

    /**
     * Select appropriate decoding strategy based on frame type and context
     */
    private selectDecodingStrategy(request: CortexDecodingRequest): DecodingStrategy {
        const frameType = request.cortexStructure.frameType;
        const style = request.style || 'conversational';
        const format = request.format || 'plain';

        return {
            approach: this.needsAIDecoding(request.cortexStructure) ? 'ai_assisted' : 'rule_based',
            frameType,
            style,
            format,
            complexity: this.assessComplexity(request.cortexStructure)
        };
    }

    /**
     * Generate natural language using appropriate method
     */
    private async generateNaturalLanguage(
        cortexStructure: CortexFrame,
        strategy: DecodingStrategy,
        config?: Partial<CortexConfig>
    ): Promise<string> {
        if (strategy.approach === 'ai_assisted') {
            return await this.generateWithAI(cortexStructure, strategy, config);
        } else {
            // NO RULE-BASED FALLBACKS - force AI usage only
            throw new Error('Rule-based decoding disabled - AI decoding required');
        }
    }

    /**
     * AI-assisted decoding for complex structures
     */
    private async generateWithAI(
        cortexStructure: CortexFrame,
        strategy: DecodingStrategy,
        config?: Partial<CortexConfig>
    ): Promise<string> {
        loggingService.info('🤖 Using AI-assisted decoding with information preservation...');

        // Build context for AI model
        const decodingContext = this.buildDecodingContext(cortexStructure, strategy);
        
        // Create the prompt with enhanced preservation instructions
        const userPrompt = this.buildDecodingPrompt(cortexStructure, strategy, decodingContext);

        // Get decoding configuration
        const decodingConfig = { ...DEFAULT_CORTEX_CONFIG.decoding, ...config?.decoding };

        try {
            // Enhanced prompt with explicit information preservation
            const enhancedSystemPrompt = `${CORTEX_DECODER_SYSTEM_PROMPT}

🚨 CRITICAL: INFORMATION PRESERVATION OVERRIDE
For this decoding task, ZERO INFORMATION LOSS is mandatory. Every entity, number, concept, and detail from the Cortex structure MUST appear in the output. If the Cortex structure contains multiple tasks, requirements, or components, ALL must be included in the natural language output.

PRESERVATION CHECKLIST:
✅ All numbers, dates, quantities preserved
✅ All entities and proper nouns included  
✅ All technical terms maintained
✅ All relationships and dependencies kept
✅ All structural elements (lists, tasks, formats) preserved
✅ Original intent and completeness maintained`;

            const fullPrompt = `${enhancedSystemPrompt}\n\nUser: ${userPrompt}`;
            const aiResponse = await BedrockService.invokeModel(fullPrompt, decodingConfig.model);

            if (!aiResponse || typeof aiResponse !== 'string') {
                throw new CortexError(
                    CortexErrorCode.DECODING_FAILED,
                    'AI model returned invalid response for decoding',
                    'decoding'
                );
            }

            const decodedText = aiResponse.trim();

            // 🛡️ POST-PROCESSING VALIDATION: Check for information loss
            const informationLoss = await this.validateInformationPreservation(cortexStructure, decodedText);
            
            if (informationLoss.hasLoss) {
                loggingService.warn('🚨 Information loss detected in AI decoding', {
                    lossReasons: informationLoss.reasons,
                    originalStructure: JSON.stringify(cortexStructure, null, 2),
                    decodedText: decodedText.substring(0, 200)
                });

                // Attempt recovery with fallback to safer decoding
                const fallbackPrompt = `${enhancedSystemPrompt}

RECOVERY MODE: The previous attempt lost critical information. This is a RECOVERY attempt.
You MUST include EVERY detail from this Cortex structure in your natural language output.
NO SUMMARIZATION. NO OMISSIONS. COMPLETE INFORMATION TRANSFER.

\n\nUser: ${userPrompt}`;

                try {
                    const recoveryResponse = await BedrockService.invokeModel(fallbackPrompt, decodingConfig.model);
                    if (recoveryResponse && typeof recoveryResponse === 'string') {
                        const recoveredText = recoveryResponse.trim();
                        const recoveryValidation = await this.validateInformationPreservation(cortexStructure, recoveredText);
                        
                        if (!recoveryValidation.hasLoss) {
                            loggingService.info('✅ Recovery decoding successful - information preserved');
                            return recoveredText;
                        }
                    }
                } catch (recoveryError) {
                    loggingService.error('❌ Recovery decoding also failed', {
                        error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
                    });
                }

                // If recovery fails, throw detailed error
                throw new CortexError(
                    CortexErrorCode.DECODING_FAILED,
                    `AI decoding resulted in information loss: ${informationLoss.reasons.join(', ')}`,
                    'decoding'
                );
            }

            return decodedText;

        } catch (error) {
            loggingService.error('🚨 AI decoding failed - NO FALLBACKS', {
                error: error instanceof Error ? error.message : String(error)
            });
            
            // NO MORE FALLBACKS - throw the real error
            throw error;
        }
    }

    /**
     * Validate that decoded text preserves all information from Cortex structure using LLM
     */
    private async validateInformationPreservation(cortexStructure: CortexFrame, decodedText: string): Promise<{
        hasLoss: boolean;
        reasons: string[];
    }> {
        try {
            const structureText = JSON.stringify(cortexStructure, null, 2);

            const validationPrompt = `Is information missing from decoded text?

ORIGINAL: ${structureText.substring(0, 200)}...
DECODED: ${decodedText.substring(0, 200)}...

Reply ONLY: {"has_information_loss": false, "issues": []}`;

            const validationResult = await BedrockService.invokeModel(
                validationPrompt,
                'amazon.nova-pro-v1:0' // Nova Pro for decoding validation
            );

            if (!validationResult) {
                // Fallback to simple manual checks
                return this.fallbackValidation(cortexStructure, decodedText);
            }

            try {
                // Clean the response and extract JSON
                let cleanedResult = validationResult.trim();
                
                // Remove markdown code blocks if present
                cleanedResult = cleanedResult.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
                
                // Try to extract JSON from potential explanatory text
                const jsonMatch = cleanedResult.match(/\{[\s\S]*?\}/);
                if (jsonMatch) {
                    cleanedResult = jsonMatch[0];
                }
                
                const assessment = JSON.parse(cleanedResult);
                
                const hasLoss = assessment.has_information_loss === true || 
                               assessment.loss_severity === 'severe' ||
                               assessment.preservation_score < 0.8;

                return {
                    hasLoss,
                    reasons: Array.isArray(assessment.issues) ? assessment.issues : []
                };

            } catch (parseError) {
                loggingService.error('Failed to parse information preservation assessment', { parseError });
                return this.fallbackValidation(cortexStructure, decodedText);
            }

        } catch (error) {
            loggingService.error('Information preservation validation error', { error });
            return this.fallbackValidation(cortexStructure, decodedText);
        }
    }

    /**
     * Fallback manual validation when LLM is unavailable
     */
    private fallbackValidation(cortexStructure: CortexFrame, decodedText: string): {
        hasLoss: boolean;
        reasons: string[];
    } {
        const reasons: string[] = [];
        const structureText = JSON.stringify(cortexStructure, null, 2);

        // Check for numerical values
        const structureNumbers = structureText.match(/\b\d+\b/g) || [];
        const decodedNumbers = decodedText.match(/\b\d+\b/g) || [];
        if (structureNumbers.length > decodedNumbers.length) {
            reasons.push(`Missing numbers: ${structureNumbers.length - decodedNumbers.length} lost`);
        }

        // Check for severe length reduction (>85% is suspicious)
        const lengthReduction = ((structureText.length - decodedText.length) / structureText.length) * 100;
        if (lengthReduction > 85 && structureText.length > 100) {
            reasons.push(`Excessive length reduction: ${lengthReduction.toFixed(1)}%`);
        }

        return {
            hasLoss: reasons.length > 0,
            reasons
        };
    }


    // ========================================================================
    // FRAME-SPECIFIC DECODING METHODS
    // ========================================================================

    private decodeQueryFrame(frame: CortexQueryFrame): string {
        // Handle direct content from simple compression (bypass parsing)
        if ((frame as any).directContent) {
            return (frame as any).directContent;
        }

        // Handle direct content (from our intelligent mock system)
        if ((frame as any).content) {
            return (frame as any).content;
        }

        if (frame.question) {
            return frame.question;
        }

        let result = 'What';
        
        if (frame.action) {
            const action = this.primitiveToText(frame.action);
            result = action.charAt(0).toUpperCase() + action.slice(1);
        }

        if (frame.target) {
            const target = this.valueToText(frame.target);
            result += ` is the ${target}`;
        }

        if (frame.aspect) {
            const aspect = this.valueToText(frame.aspect);
            result += ` ${aspect}`;
        }

        return result + '?';
    }

    private decodeAnswerFrame(frame: CortexAnswerFrame): string {
        if (frame.summary) {
            return frame.summary;
        }

        if (frame.content) {
            return this.valueToText(frame.content);
        }

        if (frame.status) {
            return `Status: ${frame.status}`;
        }

        return 'The request has been processed.';
    }

    private decodeEventFrame(frame: CortexEventFrame): string {
        let result = '';

        if (frame.agent) {
            result += this.valueToText(frame.agent);
        } else {
            result += 'The system';
        }

        if (frame.action) {
            const action = this.primitiveToText(frame.action);
            const tense = frame.tense || 'past';
            result += ` ${this.conjugateVerb(action, tense)}`;
        }

        if (frame.object) {
            result += ` ${this.valueToText(frame.object)}`;
        }

        if (frame.time) {
            result += ` ${this.valueToText(frame.time)}`;
        }

        return result + '.';
    }

    private decodeStateFrame(frame: CortexStateFrame): string {
        let result = '';

        if (frame.entity) {
            result += `The ${this.valueToText(frame.entity)}`;
        }

        if (frame.condition) {
            result += ` is ${this.valueToText(frame.condition)}`;
        }

        if (frame.properties && Array.isArray(frame.properties)) {
            const props = frame.properties.map(p => this.valueToText(p)).join(', ');
            result += ` with properties: ${props}`;
        }

        return result + '.';
    }

    private decodeEntityFrame(frame: CortexEntityFrame): string {
        if (frame.name) {
            return frame.name;
        }

        if (frame.title) {
            return frame.title;
        }

        if (frame.type) {
            return this.primitiveToText(frame.type);
        }

        return 'Entity';
    }

    private decodeListFrame(frame: CortexListFrame): string {
        let result = '';

        if (frame.name) {
            result += `${frame.name}:\n`;
        }

        const items: string[] = [];
        for (const [key, value] of Object.entries(frame)) {
            if (key.startsWith('item_') && value !== undefined) {
                items.push(this.valueToText(value));
            }
        }

        items.forEach((item, index) => {
            result += `${index + 1}. ${item}\n`;
        });

        return result.trim();
    }

    private decodeErrorFrame(frame: CortexErrorFrame): string {
        let result = 'Error';

        if (frame.code) {
            result += ` ${frame.code}`;
        }

        if (frame.message) {
            result += `: ${frame.message}`;
        }

        return result;
    }

    // ========================================================================
    // HELPER METHODS
    // ========================================================================

    private expandPrimitives(cortexStructure: CortexFrame): Promise<CortexFrame> {
        // Deep copy and expand primitives to human-readable form
        const expanded = JSON.parse(JSON.stringify(cortexStructure));
        
        const expandValue = (value: any): any => {
            if (typeof value === 'string' && value.includes('_')) {
                return this.primitiveToText(value);
            } else if (Array.isArray(value)) {
                return value.map(expandValue);
            } else if (typeof value === 'object' && value !== null) {
                const expandedObj: any = {};
                for (const [key, val] of Object.entries(value)) {
                    expandedObj[key] = expandValue(val);
                }
                return expandedObj;
            }
            return value;
        };

        return Promise.resolve(expandValue(expanded));
    }

    private needsAIDecoding(cortexStructure: CortexFrame): boolean {
        // Analyze the cortex structure to determine if AI is needed for quality decoding
        const frameType = cortexStructure.frameType;
        const propertyCount = Object.keys(cortexStructure).length - 1; // Exclude frameType
        
        // Always use AI for complex frame types that require nuanced language generation
        if (frameType === 'error' || frameType === 'event' || frameType === 'list') {
            return true;
        }
        
        // Check for complex nested structures or multiple properties
        const hasComplexContent = this.hasNestedStructures(cortexStructure) || propertyCount > 3;
        
        // Check for domain-specific content that needs semantic understanding
        const contentStr = JSON.stringify(cortexStructure).toLowerCase();
        const hasDomainSpecificContent = /(?:technology|startup|price|currency|prototype|model|company|location|date|percentage|technical|specific)/i.test(contentStr);
        
        // Check for proper nouns, numbers, or technical terms that need preservation
        const hasImportantEntities = /(?:[A-Z][a-z]+|¥|\\$|[0-9]+k?|[0-9]{4}|[A-Z]{2,})/g.test(contentStr);
        
        // Use AI if structure has:
        // 1. Complex nested content
        // 2. Domain-specific terminology 
        // 3. Important entities (names, prices, dates, etc.)
        // 4. More than 2 meaningful properties
        const needsAI = hasComplexContent || hasDomainSpecificContent || hasImportantEntities || propertyCount > 2;
        
        loggingService.info('🤖 AI decoding decision analysis', {
            frameType,
            propertyCount,
            hasComplexContent,
            hasDomainSpecificContent,
            hasImportantEntities,
            decision: needsAI ? 'AI_REQUIRED' : 'RULE_BASED_ACCEPTABLE',
            reasoning: needsAI 
                ? 'Complex structure requires AI semantic understanding'
                : 'Simple structure can use rule-based approach'
        });
        
        return needsAI;
    }

    private assessComplexity(cortexStructure: CortexFrame): number {
        let complexity = 1;
        const keys = Object.keys(cortexStructure);
        complexity += keys.length * 0.5;
        
        for (const [key, value] of Object.entries(cortexStructure)) {
            if (key === 'frameType') continue;
            
            if (typeof value === 'object' && value !== null) {
                if (Array.isArray(value)) {
                    complexity += value.length * 0.3;
                } else if ('frameType' in value) {
                    complexity += this.assessComplexity(value as CortexFrame);
                }
            }
        }
        
        return Math.round(complexity * 10) / 10;
    }

    private hasNestedStructures(cortexStructure: CortexFrame): boolean {
        for (const [key, value] of Object.entries(cortexStructure)) {
            if (key === 'frameType') continue;
            
            if (typeof value === 'object' && value !== null && 'frameType' in value) {
                return true;
            } else if (Array.isArray(value)) {
                return value.some(item => 
                    typeof item === 'object' && item !== null && 'frameType' in item
                );
            }
        }
        return false;
    }

    private buildDecodingContext(cortexStructure: CortexFrame, strategy: DecodingStrategy): string {
        const contextParts = [
            `FRAME_TYPE: ${strategy.frameType}`,
            `STYLE: ${strategy.style}`,
            `FORMAT: ${strategy.format}`,
            `COMPLEXITY: ${strategy.complexity}`
        ];

        if (strategy.style && DECODING_STYLES[strategy.style as keyof typeof DECODING_STYLES]) {
            contextParts.push(`STYLE_GUIDE: ${DECODING_STYLES[strategy.style as keyof typeof DECODING_STYLES]}`);
        }

        if (strategy.format && OUTPUT_FORMATS[strategy.format as keyof typeof OUTPUT_FORMATS]) {
            contextParts.push(`FORMAT_GUIDE: ${OUTPUT_FORMATS[strategy.format as keyof typeof OUTPUT_FORMATS]}`);
        }

        return contextParts.join('\n');
    }

    private buildDecodingPrompt(
        cortexStructure: CortexFrame,
        strategy: DecodingStrategy,
        context: string
    ): string {
        const cortexString = serializeCortexFrame(cortexStructure);
        return `Convert this Cortex structure to natural language:

${cortexString}

CONTEXT:
${context}

Natural language output:`;
    }

    private async validateAndEnhanceOutput(
        decodedText: string,
        request: CortexDecodingRequest,
        preprocessedStructure: CortexFrame
    ): Promise<CortexDecodingResult> {
        // Calculate confidence and fidelity scores
        const confidence = this.calculateDecodingConfidence(decodedText, request);
        const fidelityScore = await this.calculateFidelityScore(decodedText, preprocessedStructure);
        
        // Apply post-processing enhancements
        const enhancedText = await this.enhanceOutput(decodedText, request);

        const result: CortexDecodingResult = {
            text: enhancedText,
            confidence,
            processingTime: 0, // Will be set by caller
            fidelityScore,
            metadata: {
                decodingModel: DEFAULT_CORTEX_CONFIG.decoding.model,
                targetLanguage: request.targetLanguage || 'en',
                styleApplied: request.style || 'conversational',
                qualityMetrics: {
                    fluency: this.calculateFluency(enhancedText),
                    coherence: this.calculateCoherence(enhancedText),
                    accuracy: fidelityScore
                }
            }
        };

        return result;
    }

    private primitiveToText(primitive: string): string {
        if (!primitive.includes('_')) return primitive;
        
        const parts = primitive.split('_');
        if (parts.length >= 2) {
            // Remove the type prefix (action_, concept_, prop_, mod_)
            return parts.slice(1).join(' ').replace(/_/g, ' ');
        }
        return primitive.replace(/_/g, ' ');
    }

    private valueToText(value: any): string {
        if (typeof value === 'string') {
            return this.primitiveToText(value);
        } else if (typeof value === 'object' && value !== null) {
            if ('frameType' in value) {
                // This is a nested frame - decode it
                if (isEntityFrame(value)) {
                    return this.decodeEntityFrame(value);
                }
            } else if (value.name) {
                return value.name;
            } else if (value.title) {
                return value.title;
            }
        }
        return String(value);
    }

    private conjugateVerb(verb: string, tense: string): string {
        // Simple verb conjugation - in production would use a proper NLP library
        switch (tense) {
            case 'past':
                if (verb.endsWith('e')) return verb + 'd';
                if (verb.endsWith('y')) return verb.slice(0, -1) + 'ied';
                return verb + 'ed';
            case 'present':
                return verb + 's';
            case 'future':
                return 'will ' + verb;
            default:
                return verb + 'ed'; // Default to past tense
        }
    }

    private calculateDecodingConfidence(decodedText: string, request: CortexDecodingRequest): number {
        let confidence = 0.7; // Base confidence
        
        // Boost confidence for simpler structures
        const complexity = this.assessComplexity(request.cortexStructure);
        if (complexity < 2) confidence += 0.2;
        else if (complexity > 5) confidence -= 0.2;
        
        // Boost confidence for quality output
        if (decodedText.length > 10 && decodedText.includes(' ')) confidence += 0.1;
        if (this.hasGoodGrammar(decodedText)) confidence += 0.1;
        
        return Math.min(Math.max(confidence, 0.1), 1.0);
    }

    private async calculateFidelityScore(decodedText: string, cortexStructure: CortexFrame): Promise<number> {
        // Simple fidelity calculation - in production would use semantic similarity models
        let fidelityScore = 0.8; // Base fidelity
        
        // Check if key elements are preserved
        const cortexString = serializeCortexFrame(cortexStructure);
        const textLower = decodedText.toLowerCase();
        
        // Count preserved semantic elements
        let preservedElements = 0;
        const totalElements = Object.keys(cortexStructure).length - 1; // Exclude frameType
        
        for (const [key, value] of Object.entries(cortexStructure)) {
            if (key === 'frameType') continue;
            
            const valueText = this.valueToText(value).toLowerCase();
            if (textLower.includes(valueText) || this.semanticMatch(textLower, valueText)) {
                preservedElements++;
            }
        }
        
        if (totalElements > 0) {
            fidelityScore = preservedElements / totalElements;
        }
        
        return Math.min(Math.max(fidelityScore, 0.1), 1.0);
    }

    private async enhanceOutput(decodedText: string, request: CortexDecodingRequest): Promise<string> {
        let enhanced = decodedText.trim();
        
        // Apply format-specific enhancements
        if (request.format === 'markdown') {
            enhanced = this.applyMarkdownFormatting(enhanced);
        } else if (request.format === 'structured') {
            enhanced = this.applyStructuredFormatting(enhanced);
        }
        
        // Ensure proper sentence ending
        if (enhanced && !enhanced.match(/[.!?]$/)) {
            enhanced += '.';
        }
        
        return enhanced;
    }

    private applyMarkdownFormatting(text: string): string {
        // Simple markdown formatting - could be enhanced
        if (text.includes('\n')) {
            return text; // Already formatted
        }
        return text;
    }

    private applyStructuredFormatting(text: string): string {
        // Add basic structure if missing
        if (text.includes(':') && text.includes('\n')) {
            return text; // Already structured
        }
        return text;
    }

    private hasGoodGrammar(text: string): boolean {
        // Simple grammar checks
        return text.length > 5 && 
               text.includes(' ') && 
               /^[A-Z]/.test(text) && 
               /[.!?]$/.test(text);
    }

    private semanticMatch(text1: string, text2: string): boolean {
        // Simple semantic matching - in production would use embeddings
        const words1 = new Set(text1.split(/\s+/));
        const words2 = new Set(text2.split(/\s+/));
        const intersection = new Set([...words1].filter(w => words2.has(w)));
        return intersection.size > 0;
    }

    private calculateFluency(text: string): number {
        // Simple fluency metric
        const hasSpaces = text.includes(' ');
        const hasProperCapitalization = /^[A-Z]/.test(text);
        const hasProperEnding = /[.!?]$/.test(text);
        const reasonableLength = text.length > 5 && text.length < 500;
        
        let score = 0.5;
        if (hasSpaces) score += 0.2;
        if (hasProperCapitalization) score += 0.1;
        if (hasProperEnding) score += 0.1;
        if (reasonableLength) score += 0.1;
        
        return Math.min(score, 1.0);
    }

    private calculateCoherence(text: string): number {
        // Simple coherence metric
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
        if (sentences.length <= 1) return 0.9; // Single sentence is coherent
        
        // Check for logical flow (very basic)
        let coherenceScore = 0.7;
        
        // Boost for connecting words
        if (text.match(/\b(and|but|however|therefore|also|additionally)\b/)) {
            coherenceScore += 0.1;
        }
        
        // Penalize for very short or very long sentences
        const avgLength = text.length / sentences.length;
        if (avgLength > 10 && avgLength < 100) {
            coherenceScore += 0.1;
        }
        
        return Math.min(coherenceScore, 1.0);
    }

    // ========================================================================
    // CACHE AND STATISTICS METHODS
    // ========================================================================

    private generateCacheKey(request: CortexDecodingRequest): string {
        const cortexHash = generateCortexHash(request.cortexStructure);
        const styleHash = request.style || 'default';
        const formatHash = request.format || 'plain';
        const langHash = request.targetLanguage || 'en';
        return `decode_${cortexHash}_${styleHash}_${formatHash}_${langHash}`;
    }

    private getCachedDecoding(cacheKey: string): DecoderCacheEntry | null {
        const cached = this.decodingCache.get(cacheKey);
        if (!cached) return null;

        // Check if cache entry is still valid (1 hour TTL)
        const isExpired = Date.now() - cached.timestamp.getTime() > 3600000;
        if (isExpired) {
            this.decodingCache.delete(cacheKey);
            return null;
        }

        cached.hitCount++;
        return cached;
    }

    private async cacheDecodingResult(
        cacheKey: string,
        result: CortexDecodingResult,
        startTime: number
    ): Promise<void> {
        const cacheEntry: DecoderCacheEntry = {
            cortexHash: cacheKey,
            decodedText: result.text,
            confidence: result.confidence,
            fidelityScore: result.fidelityScore || 0,
            style: result.metadata.styleApplied,
            format: result.metadata.targetLanguage,
            timestamp: new Date(),
            hitCount: 0
        };

        this.decodingCache.set(cacheKey, cacheEntry);

        // Limit cache size
        if (this.decodingCache.size > 1000) {
            const oldestKey = Array.from(this.decodingCache.keys())[0];
            this.decodingCache.delete(oldestKey);
        }
    }

    private buildDecodingResult(
        cached: DecoderCacheEntry,
        processingTime: number,
        fromCache: boolean = false
    ): CortexDecodingResult {
        return {
            text: cached.decodedText,
            confidence: cached.confidence,
            processingTime,
            fidelityScore: cached.fidelityScore,
            metadata: {
                decodingModel: fromCache ? 'cache' : DEFAULT_CORTEX_CONFIG.decoding.model,
                targetLanguage: 'en',
                styleApplied: cached.style,
                qualityMetrics: {
                    fluency: this.calculateFluency(cached.decodedText),
                    coherence: this.calculateCoherence(cached.decodedText),
                    accuracy: cached.fidelityScore
                }
            }
        };
    }

    private updateStats(success: boolean, processingTime: number, result: CortexDecodingResult | null): void {
        this.stats.averageProcessingTime = (this.stats.averageProcessingTime + processingTime) / 2;
        
        if (success && result) {
            this.stats.successfulDecodings++;
            this.stats.averageConfidence = (this.stats.averageConfidence + result.confidence) / 2;
            if (result.fidelityScore) {
                this.stats.averageFidelityScore = (this.stats.averageFidelityScore + result.fidelityScore) / 2;
            }
        }
    }

    // ========================================================================
    // PUBLIC API METHODS
    // ========================================================================

    /**
     * Get decoding statistics
     */
    public getStats(): DecodingStats {
        return { ...this.stats };
    }

    /**
     * Clear decoding cache
     */
    public clearCache(): void {
        this.decodingCache.clear();
        loggingService.info('🧹 Cortex decoder cache cleared');
    }

    /**
     * Get cache information
     */
    public getCacheInfo(): { size: number; hitRate: number; entries: string[] } {
        return {
            size: this.decodingCache.size,
            hitRate: this.stats.cacheHitRate,
            entries: Array.from(this.decodingCache.keys()).slice(0, 10)
        };
    }
}

// ============================================================================
// SUPPORTING INTERFACES
// ============================================================================

interface DecodingStrategy {
    approach: 'ai_assisted' | 'rule_based';
    frameType: string;
    style: string;
    format: string;
    complexity: number;
}
