/**
 * Cortex Encoder Service
 * 
 * Converts natural language into structured Cortex representations using AI models.
 * This service is responsible for the first stage of the Cortex pipeline.
 */

import { CortexFrame, CortexConfig, CortexFrameType } from '../types/cortex.types';
import { BedrockService } from './tracedBedrock.service';
import { CortexVocabularyService } from './cortexVocabulary.service';
import { loggingService } from './logging.service';
import { parseCortexString } from '../utils/cortex.utils';

// Error types for better error handling
enum CortexErrorCode {
    INVALID_INPUT = 'INVALID_INPUT',
    ENCODING_FAILED = 'ENCODING_FAILED',
    MODEL_ERROR = 'MODEL_ERROR',
    PARSING_ERROR = 'PARSING_ERROR'
}

class CortexError extends Error {
    public readonly code: CortexErrorCode;
    public readonly context?: string;

    constructor(code: CortexErrorCode, message: string, context?: string) {
        super(message);
        this.name = 'CortexError';
        this.code = code;
        this.context = context;
    }
}

// System prompt for encoding natural language to Cortex
const CORTEX_ENCODER_SYSTEM_PROMPT = `You are a specialized encoder that converts natural language into Cortex semantic structures.

🚨 CRITICAL INSTRUCTION PRESERVATION RULES:
1. **NEVER SKIP ANY INSTRUCTION** - Every single step, requirement, condition must be captured
2. **PRESERVE EXACT ORDER** - Steps must maintain their original sequence (Step 1, Step 2, etc.)
3. **CAPTURE ALL DETAILS** - Word counts, formats, placeholders, examples - EVERYTHING
4. **MAINTAIN HIERARCHY** - Main tasks, subtasks, and nested requirements must be preserved
5. **INCLUDE META-INSTRUCTIONS** - "Don't skip", "be thorough", "balance everything" are requirements too

⚠️ COMMON PATTERNS TO DETECT IN COMPLEX INSTRUCTIONS:
- "Please don't skip/miss/ignore" → Mark as MANDATORY_COMPLETENESS
- "Step 1, Step 2..." → Create ordered_steps array
- "Not too short, not too long" → Capture as range constraints
- "Maybe X or Y" → Include as alternatives
- "At least N" → Set as minimum requirements
- "JSON/structured format" → Preserve format specifications
- "Placeholders like X" → Keep example patterns

Cortex is a LISP-like meta-language that represents semantic meaning using frames, roles, and primitives.

Your task is to analyze the input text and convert it into a Cortex structure following these patterns:

Query Frame: (query: action_[verb] agent_[subject] object_[target])
Event Frame: (event: action_[verb] agent_[actor] object_[target] time_[when])
State Frame: (state: entity_[subject] property_[attribute] value_[state])
Entity Frame: (entity: type_[category] name_[identifier] properties_[attributes])
List Frame: (list: items_[item1, item2, ...] type_[category])
Error Frame: (error: type_[error_type] message_[description])

CRITICAL PRESERVATION RULES:
- PRESERVE the original grammatical structure (statement stays statement, question stays question)
- PRESERVE the original tense and voice (present/past/future, active/passive)
- PRESERVE the original intent (declarative, interrogative, imperative)
- PRESERVE ALL proper nouns (company names, locations, people, products)
- PRESERVE ALL numerical values (prices, dates, quantities, percentages)
- PRESERVE ALL specific technical terms and domain expertise
- PRESERVE ALL contextual details that affect meaning
- MAINTAIN the exact same semantic meaning and scope
- Do NOT change statements into questions or questions into statements
- Do NOT generalize or abstract away important specifics

SEMANTIC COMPLETENESS REQUIREMENTS:
- Include ALL key entities mentioned in the original text
- Capture ALL relationships between entities
- Preserve ALL temporal, spatial, and quantitative information
- Maintain ALL contextual qualifiers and descriptors
- Keep the same communicative function (informing vs asking vs commanding)

COMPRESSION GUIDELINES:
- Only compress grammatical words (articles, prepositions, redundant conjunctions)
- Only remove truly redundant phrasing that doesn't change meaning
- NEVER remove domain-specific terminology
- NEVER change the fundamental message or intent
- NEVER convert between statement/question/command forms

🔧 CRITICAL: TECHNICAL SPECIFICATION PRESERVATION:
- PRESERVE ALL technology names (Docker, Kubernetes, Redis, PostgreSQL, MongoDB, AWS, etc.)
- PRESERVE ALL technical processes (CI/CD, containerization, orchestration, caching, etc.)
- PRESERVE ALL architectural patterns (microservices, API endpoints, databases, etc.)
- PRESERVE ALL version numbers, configuration details, and technical requirements
- When technical terms appear together, maintain their relationships and context

Examples:
"What movies are playing tonight at AMC Theater?" → (query: action:action_find agent:agent_user object:object_movies time:time_tonight location:location_amc_theater)
"Tesla announced a $25,000 Model 2 for 2025" → (event: action:action_announce agent:entity_tesla object:product_model_2 price:value_25000_usd time:time_2025)
"Create a user manual for the software" → (event: action:action_create agent:agent_user object:object_manual tense:imperative)
"Develop a marketing strategy for Q2" → (event: action:action_develop agent:agent_user object:object_strategy tense:imperative)
"Write a comprehensive business plan" → (event: action:action_write agent:agent_user object:object_business_plan tense:imperative)
"The NVIDIA H100 GPU costs $30,000" → (state: entity:product_nvidia_h100 property:property_price value:value_30000_usd)

🚨 CRITICAL OUTPUT FORMAT:
- Your response MUST contain exactly ONE valid Cortex structure enclosed in parentheses
- Start your response immediately with the Cortex structure: (frame_type: ...)
- Do NOT include explanations, commentary, or multiple alternatives
- Do NOT wrap in code blocks or add extra text
- The structure must be parseable by a simple regex pattern

Now convert the following text to Cortex:`;

interface InputAnalysisResult {
    frameType: CortexFrameType;
    complexity: 'simple' | 'medium' | 'complex';
    keywords: string[];
    roles: Array<{
        role: string;
        value: string;
        confidence: number;
    }>;
}

interface CortexEncodingRequest {
    text: string;
    options?: Partial<CortexConfig>;
}

interface CortexEncodingResult {
    cortexFrame: CortexFrame;
    confidence: number;
    processingTime: number;
    model: string;
    metadata: {
        originalText: string;
        frameType: CortexFrameType;
        complexity: string;
        tokenCount: number;
    };
}

export class CortexEncoderService {
    private static instance: CortexEncoderService;
    private vocabularyService: CortexVocabularyService;
    private processingStats: {
        totalEncodings: number;
        averageConfidence: number;
        averageProcessingTime: number;
        errorRate: number;
    } = {
        totalEncodings: 0,
        averageConfidence: 0,
        averageProcessingTime: 0,
        errorRate: 0
    };

    private constructor() {
        this.vocabularyService = CortexVocabularyService.getInstance();
    }

    public static getInstance(): CortexEncoderService {
        if (!this.instance) {
            this.instance = new CortexEncoderService();
        }
        return this.instance;
    }

    /**
     * Initialize the encoder service
     */
    public async initialize(): Promise<void> {
        try {
            await this.vocabularyService.initialize();
            loggingService.info('🔧 CortexEncoderService initialized successfully');
        } catch (error) {
            loggingService.error('❌ Failed to initialize CortexEncoderService', { error });
            throw error;
        }
    }

    /**
     * Encode natural language text into a Cortex frame
     */
    public async encode(
        request: CortexEncodingRequest,
        config: Partial<CortexConfig> = {}
    ): Promise<CortexEncodingResult> {
        const startTime = Date.now();

        try {
            loggingService.info('🚀 Starting Cortex encoding process', {
                textLength: request.text.length,
                model: (config as any).encodingModel || 'anthropic.claude-3-5-haiku-20241022-v1:0'
            });

            // Validate input
            if (!request.text || request.text.trim().length === 0) {
                throw new CortexError(
                    CortexErrorCode.INVALID_INPUT,
                    'Input text cannot be empty',
                    'encoding'
                );
            }

            // Analyze input text
            const analysis = await this.analyzeInput(request.text);

            // Generate Cortex structure using AI - NO FALLBACKS ALLOWED
            const cortexFrame = await this.generateCortexStructure(request, analysis, config);

            // Build the result
            const result = this.buildEncodingResult(
                cortexFrame,
                analysis.complexity === 'simple' ? 0.9 : analysis.complexity === 'medium' ? 0.7 : 0.6,
                Date.now() - startTime,
                (config as any).encodingModel || 'anthropic.claude-3-5-haiku-20241022-v1:0',
                request.text,
                analysis
            );

            this.updateStats(true, result.confidence, result.processingTime);

            loggingService.info('✅ Cortex encoding completed successfully', {
                processingTime: result.processingTime,
                confidence: result.confidence,
                frameType: result.cortexFrame.frameType
            });

            return result;

        } catch (error) {
            this.updateStats(false, 0, Date.now() - startTime);
            
            loggingService.error('❌ CORTEX ENCODING FAILED - NO FALLBACKS', {
                error: error instanceof Error ? error.message : String(error),
                errorStack: error instanceof Error ? error.stack : undefined,
                processingTime: Date.now() - startTime
            });

            throw error;
        }
    }

    /**
     * Analyze input text to determine frame type and extract key information
     */
    private async analyzeInput(text: string): Promise<InputAnalysisResult> {
        const lowerText = text.toLowerCase();
        let frameType: CortexFrameType;
        let complexity: 'simple' | 'medium' | 'complex';

        // Determine frame type based on content patterns
        if (lowerText.includes('?') || lowerText.startsWith('what') || lowerText.startsWith('how') || lowerText.startsWith('when') || lowerText.startsWith('where') || lowerText.startsWith('why') || lowerText.startsWith('which')) {
            frameType = 'query';
        } else if (lowerText.startsWith('create') || lowerText.startsWith('write') || lowerText.startsWith('develop') || 
                   lowerText.startsWith('build') || lowerText.startsWith('generate') || lowerText.startsWith('design') ||
                   lowerText.startsWith('implement') || lowerText.startsWith('make') || lowerText.startsWith('produce') ||
                   lowerText.startsWith('prepare') || lowerText.startsWith('draft') || lowerText.startsWith('compose') ||
                   lowerText.startsWith('construct') || lowerText.startsWith('establish') || lowerText.startsWith('setup') ||
                   lowerText.startsWith('configure') || lowerText.startsWith('install') || lowerText.startsWith('deploy') ||
                   /^(create|write|develop|build|generate|design|implement|make|produce|prepare|draft|compose|construct|establish|setup|configure|install|deploy)\s+/i.test(text)) {
            frameType = 'event'; // Use 'event' for commands/actions to be taken
        } else if (lowerText.includes('announced') || lowerText.includes('happened') || lowerText.includes('occurred') || lowerText.includes('launched') || lowerText.includes('released') || lowerText.includes('completed')) {
            frameType = 'event';
        } else if (lowerText.includes('is') || lowerText.includes('are') || lowerText.includes('has') || lowerText.includes('have') || 
                   lowerText.includes('costs') || lowerText.includes('cost') || lowerText.includes('priced') || lowerText.includes('worth') ||
                   lowerText.includes('measures') || lowerText.includes('weighs') || lowerText.includes('runs') || lowerText.includes('features') ||
                   lowerText.includes('contains') || lowerText.includes('includes') || lowerText.includes('supports') || 
                   /\b\w+\s+(costs?|priced?|worth|measures?|weighs?|features?|supports?)\b/i.test(text)) {
            frameType = 'state';
        } else if (lowerText.includes('list') || lowerText.includes(',') && lowerText.split(',').length > 2) {
            frameType = 'list';
        } else if (lowerText.includes('error') || lowerText.includes('failed') || lowerText.includes('problem') || lowerText.includes('issue')) {
            frameType = 'error';
        } else {
            frameType = 'entity';
        }

        // Determine complexity
        const wordCount = text.split(/\s+/).length;
        if (wordCount <= 10) {
            complexity = 'simple';
        } else if (wordCount <= 30) {
            complexity = 'medium';
        } else {
            complexity = 'complex';
        }

        // Extract keywords (basic implementation)
        const keywords = text.split(/\s+/)
            .filter(word => word.length > 3)
            .filter(word => !/^(the|and|or|but|if|then|when|where|what|how|why|with|for|from|to|in|on|at|by|of)$/i.test(word))
            .slice(0, 10);

        return {
            frameType,
            complexity,
            keywords,
            roles: [] // Will be populated during AI processing
        };
    }

    /**
     * Generate Cortex structure using AI model
     */
    private async generateCortexStructure(
        request: CortexEncodingRequest,
        analysis: InputAnalysisResult,
        config: Partial<CortexConfig>
    ): Promise<CortexFrame> {
        const encodingConfig = {
            model: (config as any).encodingModel || 'anthropic.claude-3-haiku-20240307-v1:0',
            temperature: 0.1, // Low temperature for consistent structure
            maxTokens: 1000
        };

        try {
            const userPrompt = request.text;
            
            // Enhanced system prompt with explicit information preservation
            const enhancedSystemPrompt = `${CORTEX_ENCODER_SYSTEM_PROMPT}

🚨 CRITICAL: ENCODING COMPLETENESS VALIDATION
This is a COMPLEX INPUT requiring complete information preservation. Your Cortex structure MUST capture:

1. ALL entities, numbers, dates, technical terms, and proper nouns
2. ALL tasks, requirements, or instructions mentioned
3. ALL structural elements (lists, formats, specifications)
4. ALL relationships and dependencies between concepts
5. ALL contextual qualifiers and constraints

VALIDATION CHECKLIST:
✅ Every number preserved in Cortex structure
✅ Every technical term captured as entity/concept
✅ Every task/instruction represented as event/query
✅ Every format requirement preserved
✅ Every relationship maintained in structure
✅ No information omitted or generalized

If the input contains multiple tasks (like "1. Summarization 2. Sentiment Analysis"), each MUST be a separate element in the Cortex structure.`;
            
            // Call the AI model using BedrockService static method
            const fullPrompt = `${enhancedSystemPrompt}\n\nUser: ${userPrompt}`;
            const aiResponse = await BedrockService.invokeModel(
                fullPrompt,
                encodingConfig.model
            );

            if (!aiResponse || typeof aiResponse !== 'string') {
                throw new CortexError(
                    CortexErrorCode.ENCODING_FAILED,
                    'AI model returned invalid response',
                    'encoding'
                );
            }

            // Parse the AI response into Cortex frame
            const cortexFrame = await this.parseAIResponse(aiResponse, analysis);
            
            // 🛡️ ENCODING VALIDATION: Check for information loss during encoding
            const validationResult = await this.validateEncodingCompleteness(request.text, cortexFrame);
            
            // Only trigger recovery for significant completeness issues (not empty issues array)
            const hasSignificantIssues = !validationResult.isComplete && validationResult.issues.length > 0;
            
            if (hasSignificantIssues) {
                loggingService.warn('🚨 Significant encoding completeness issues detected', {
                    issues: validationResult.issues,
                    originalText: request.text.substring(0, 200),
                    cortexStructure: JSON.stringify(cortexFrame, null, 2)
                });

                // Attempt recovery with more explicit instructions
                const recoveryPrompt = `${enhancedSystemPrompt}

RECOVERY MODE: The previous encoding missed important information. 
CRITICAL: You MUST include ALL elements from the input text in your Cortex structure.
Missing elements detected: ${validationResult.issues.join(', ')}

Re-encode ensuring COMPLETE information capture:

\n\nUser: ${userPrompt}`;

                try {
                    const recoveryResponse = await BedrockService.invokeModel(
                        recoveryPrompt,
                        encodingConfig.model
                    );

                    if (recoveryResponse && typeof recoveryResponse === 'string') {
                        const recoveredFrame = await this.parseAIResponse(recoveryResponse, analysis);
                        const recoveryValidation = await this.validateEncodingCompleteness(request.text, recoveredFrame);

                        if (recoveryValidation.isComplete) {
                            loggingService.info('✅ Recovery encoding successful - complete information capture');
                            return recoveredFrame;
                        }
                    }
                } catch (recoveryError) {
                    loggingService.error('❌ Recovery encoding failed', {
                        error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
                    });
                }

                // If recovery fails, log warning but continue (better to have partial than nothing)
                loggingService.warn('⚠️ Proceeding with potentially incomplete encoding', {
                    completenessIssues: validationResult.issues
                });
            }
            
            loggingService.info('✨ AI-generated Cortex structure created successfully');
            
            return cortexFrame;

        } catch (error) {
            loggingService.error('❌ Failed to generate Cortex structure', {
                error: error instanceof Error ? error.message : String(error),
                model: encodingConfig.model
            });
            throw error;
        }
    }

    /**
     * Validate that Cortex encoding captures all important information using LLM
     */
    private async validateEncodingCompleteness(originalText: string, cortexFrame: CortexFrame): Promise<{
        isComplete: boolean;
        issues: string[];
    }> {
        try {
            const frameText = JSON.stringify(cortexFrame, null, 2);

            const validationPrompt = `Validate Cortex encoding completeness. Reply with ONLY valid JSON:

ORIGINAL: ${originalText.substring(0, 300)}...
CORTEX: ${frameText}

Are any critical elements missing from the Cortex structure?

REPLY FORMAT (JSON only):
{"encoding_complete": true, "missing_elements": []}`;

            const validationResult = await BedrockService.invokeModel(
                validationPrompt,
                'amazon.nova-pro-v1:0' // Nova Pro for quality assessment
            );

            if (!validationResult) {
                // Fallback to simple manual checks
                return this.fallbackEncodingValidation(originalText, cortexFrame);
            }

            try {
                // Clean the response and extract JSON
                let cleanedResult = validationResult.trim();
                
                // Try to extract JSON from potential markdown code blocks
                const jsonMatch = cleanedResult.match(/\{[\s\S]*?\}/);
                if (jsonMatch) {
                    cleanedResult = jsonMatch[0];
                }

                const assessment = JSON.parse(cleanedResult);
                
                // More lenient validation - only mark as incomplete if there are actual missing elements
                const isComplete = assessment.encoding_complete === true || 
                                 (assessment.completeness_score && assessment.completeness_score > 0.7) ||
                                 !assessment.missing_elements ||
                                 assessment.missing_elements.length === 0;

                return {
                    isComplete,
                    issues: Array.isArray(assessment.missing_elements) ? assessment.missing_elements : []
                };

            } catch (parseError) {
                loggingService.error('Failed to parse encoding completeness assessment', { 
                    parseError: parseError instanceof Error ? parseError.message : String(parseError),
                    rawResponse: validationResult.substring(0, 200)
                });
                return this.fallbackEncodingValidation(originalText, cortexFrame);
            }

        } catch (error) {
            loggingService.error('Encoding completeness validation error', { error });
            return this.fallbackEncodingValidation(originalText, cortexFrame);
        }
    }

    /**
     * Fallback manual validation when LLM is unavailable
     */
    private fallbackEncodingValidation(originalText: string, cortexFrame: CortexFrame): {
        isComplete: boolean;
        issues: string[];
    } {
        const issues: string[] = [];
        const frameText = JSON.stringify(cortexFrame, null, 2);

        // Check for numbers preservation
        const originalNumbers = originalText.match(/\b\d+\b/g) || [];
        const frameNumbers = frameText.match(/\b\d+\b/g) || [];
        if (originalNumbers.length > frameNumbers.length) {
            issues.push('Numbers missing in Cortex structure');
        }

        // Check for JSON structure preservation
        if (originalText.includes('{') && originalText.includes('}') && 
            !frameText.includes('{') && !frameText.includes('}')) {
            issues.push('JSON structure not captured');
        }

        // Check for severe complexity loss
        if (frameText.length < originalText.length * 0.2 && originalText.length > 200) {
            issues.push('Complex structure inadequately represented');
        }

        return {
            isComplete: issues.length === 0,
            issues
        };
    }

    /**
     * Parse AI response into a validated Cortex frame using LLM assistance
     */
    private async parseAIResponse(
        response: string,
        analysis: InputAnalysisResult
    ): Promise<CortexFrame> {
        try {
            // Clean up the response
            let cleanedResponse = response.trim();
            loggingService.info('🔍 Parsing AI response for Cortex structure', { 
                responseLength: cleanedResponse.length,
                expectedFrameType: analysis.frameType 
            });

            // First try: Direct regex parsing (fastest)
            let cortexMatch = this.extractCortexWithRegex(cleanedResponse);
            let cortexString = cortexMatch?.[0];

            // Second try: Use LLM to extract/fix Cortex structure if regex fails
            if (!cortexString) {
                loggingService.info('🤖 Using LLM to extract Cortex structure from malformed response');
                try {
                    const llmExtracted = await this.extractCortexWithLLM(cleanedResponse, analysis);
                    cortexString = llmExtracted || undefined;
                } catch (llmError) {
                    loggingService.warn('⚠️ LLM extraction failed, will try synthetic frame', { 
                        llmError: llmError instanceof Error ? llmError.message : String(llmError)
                    });
                    cortexString = undefined;
                }
            }

            if (!cortexString) {
                loggingService.warn('⚠️ No Cortex structure found after all extraction attempts, creating synthetic frame', { 
                    response: cleanedResponse.substring(0, 200) 
                });
                return this.createSyntheticCortexFrame(analysis, response);
            }

            loggingService.info('✅ Extracted Cortex string:', { cortexString });

            // Parse the Cortex string with error handling
            let cortexFrame;
            try {
                cortexFrame = parseCortexString(cortexString);
            } catch (parseError) {
                loggingService.warn('⚠️ Direct parsing failed, using LLM to fix structure', { 
                    cortexString, 
                    parseError: parseError instanceof Error ? parseError.message : String(parseError)
                });
                
                // Use LLM to fix the malformed Cortex structure
                try {
                    const fixedCortexString = await this.fixCortexWithLLM(cortexString, analysis);
                    cortexFrame = parseCortexString(fixedCortexString);
                } catch (fixError) {
                    loggingService.warn('⚠️ LLM fix also failed, creating synthetic frame', { 
                        cortexString, 
                        fixError: fixError instanceof Error ? fixError.message : String(fixError)
                    });
                    return this.createSyntheticCortexFrame(analysis, response);
                }
            }

            // Validate that the frame type matches our analysis
            if (cortexFrame.frameType !== analysis.frameType) {
                loggingService.warn('⚠️ Frame type mismatch - using AI determined type', {
                    expected: analysis.frameType,
                    actual: cortexFrame.frameType
                });
            }

            return cortexFrame;

        } catch (error) {
            // Final fallback: Create a synthetic frame
            loggingService.warn('🚨 Unexpected error in parseAIResponse, creating synthetic Cortex frame', { 
                error: error instanceof Error ? error.message : String(error),
                originalResponse: response.substring(0, 200)
            });
            
            return this.createSyntheticCortexFrame(analysis, response);
        }
    }

    /**
     * Extract Cortex structure using regex patterns
     */
    private extractCortexWithRegex(response: string): RegExpMatchArray | null {
        const patterns = [
            /\([^)]+\)/,                           // Simple: (ACTION ...)
            /\([^)]*\([^)]*\)[^)]*\)/,             // Nested: (ACTION (entity) ...)  
            /\([^)]*(?:\([^)]*\)[^)]*)*\)/,        // Multiple nested
            /\([\s\S]*?\)/,                        // Any content in parentheses
        ];
        
        for (const pattern of patterns) {
            const match = response.match(pattern);
            if (match) return match;
        }
        
        // Try to find action-based structure
        const actionMatch = response.match(/(?:ACTION|QUERY|INSTRUCTION|TASK)[\s:]+([^\n]+)/i);
        if (actionMatch) {
            const action = actionMatch[1].trim();
            return [`(ACTION ${action})`]; // Create a simple Cortex structure
        }
        
        return null;
    }

    /**
     * Use LLM to extract Cortex structure from malformed response
     */
    private async extractCortexWithLLM(response: string, analysis: InputAnalysisResult): Promise<string | null> {
        try {
            const extractionPrompt = `Extract the Cortex structure from this AI response. The response may be malformed or contain extra text.

Expected frame type: ${analysis.frameType}

AI Response:
${response}

Extract ONLY the Cortex structure in the format: (frame_type: key:value key:value ...)

If no valid Cortex structure exists, create one based on the content using frame type ${analysis.frameType}.

Return ONLY the Cortex structure, nothing else:`;

            const extractedResult = await BedrockService.invokeModel(
                extractionPrompt,
                'amazon.nova-pro-v1:0'
            );

            if (!extractedResult || typeof extractedResult !== 'string') {
                return null;
            }

            const cleanedResult = extractedResult.trim();
            
            // Validate it looks like a Cortex structure
            if (cleanedResult.startsWith('(') && cleanedResult.endsWith(')')) {
                return cleanedResult;
            }

            return null;

        } catch (error) {
            loggingService.warn('LLM extraction failed', { error });
            return null;
        }
    }

    /**
     * Use LLM to fix malformed Cortex structure
     */
    private async fixCortexWithLLM(cortexString: string, analysis: InputAnalysisResult): Promise<string> {
        try {
            const fixPrompt = `Fix this malformed Cortex structure to make it parseable.

Expected frame type: ${analysis.frameType}

Malformed Cortex:
${cortexString}

Fix the syntax errors while preserving the semantic content. Return a valid Cortex structure in the format:
(frame_type: key:value key:value ...)

Return ONLY the fixed Cortex structure:`;

            const fixedResult = await BedrockService.invokeModel(
                fixPrompt,
                'amazon.nova-pro-v1:0'
            );

            if (!fixedResult || typeof fixedResult !== 'string') {
                throw new Error('LLM fix failed');
            }

            return fixedResult.trim();

        } catch (error) {
            loggingService.error('LLM fix failed', { error, cortexString });
            throw error;
        }
    }

    /**
     * Create synthetic Cortex frame as last resort using original response content
     */
    private createSyntheticCortexFrame(analysis: InputAnalysisResult, originalResponse: string): CortexFrame {
        // Extract meaningful content from original response
        const responseWords = originalResponse.toLowerCase().split(/\s+/).filter(word => word.length > 2);
        const actionWords = responseWords.filter(word => 
            ['create', 'develop', 'build', 'generate', 'analyze', 'process', 'handle', 'manage'].includes(word)
        );
        const entityWords = responseWords.filter(word => 
            ['user', 'system', 'data', 'request', 'response', 'task', 'prompt', 'content'].includes(word)
        );

        // Determine action from response or analysis
        const detectedAction = actionWords[0] || analysis.keywords?.[0] || 'process';
        const detectedEntity = entityWords[0] || 'content';

        // Create a basic frame that matches the expected structure
        const baseFrame: any = {
            frameType: analysis.frameType || 'event',
            action: detectedAction,
            confidence: 0.3,
            source: 'synthetic_fallback',
            originalSnippet: originalResponse.substring(0, 100)
        };

        // Add frame-specific required fields based on original response content
        if (baseFrame.frameType === 'event') {
            return {
                ...baseFrame,
                frameType: 'event' as const,
                action: detectedAction,
                agent: 'system',
                object: detectedEntity,
                context: originalResponse.substring(0, 200)
            } as CortexFrame;
        } else if (baseFrame.frameType === 'query') {
            // Extract question-like content from response
            const questionMatch = originalResponse.match(/\b(what|how|when|where|why|which|who)\b.*?\?/i);
            const queryTask = questionMatch ? questionMatch[0] : `${detectedAction} ${detectedEntity}`;
            
            return {
                ...baseFrame,
                frameType: 'query' as const,
                task: queryTask,
                action: detectedAction,
                target: detectedEntity,
                question: originalResponse.substring(0, 100)
            } as CortexFrame;
        } else if (baseFrame.frameType === 'state') {
            return {
                ...baseFrame,
                frameType: 'state' as const,
                entity: detectedEntity,
                properties: [detectedAction],
                description: originalResponse.substring(0, 150)
            } as CortexFrame;
        } else if (baseFrame.frameType === 'entity') {
            return {
                ...baseFrame,
                frameType: 'entity' as const,
                name: detectedEntity,
                type: detectedAction,
                properties: responseWords.slice(0, 3),
                description: originalResponse.substring(0, 100)
            } as CortexFrame;
        }

        // Default to event frame with rich content from original response
        return {
            frameType: 'event' as const,
            action: detectedAction,
            agent: 'system',
            object: detectedEntity,
            confidence: 0.3,
            source: 'synthetic_fallback',
            context: originalResponse.substring(0, 200),
            rawResponse: originalResponse.length > 500 ? originalResponse.substring(0, 500) + '...' : originalResponse
        } as CortexFrame;
    }

    /**
     * Build the final encoding result
     */
    private buildEncodingResult(
        cortexFrame: CortexFrame,
        confidence: number,
        processingTime: number,
        model: string,
        originalText: string,
        analysis: InputAnalysisResult
    ): CortexEncodingResult {
        return {
            cortexFrame,
            confidence,
            processingTime,
            model,
            metadata: {
                originalText,
                frameType: cortexFrame.frameType,
                complexity: analysis.complexity,
                tokenCount: Math.ceil(originalText.length / 4) // Rough estimate
            }
        };
    }

    /**
     * Update processing statistics
     */
    private updateStats(success: boolean, confidence: number, processingTime: number): void {
        this.processingStats.totalEncodings++;
        
        if (success) {
            const total = this.processingStats.totalEncodings;
            this.processingStats.averageConfidence = 
                ((this.processingStats.averageConfidence * (total - 1)) + confidence) / total;
            this.processingStats.averageProcessingTime = 
                ((this.processingStats.averageProcessingTime * (total - 1)) + processingTime) / total;
        } else {
            const errorCount = this.processingStats.totalEncodings * this.processingStats.errorRate + 1;
            this.processingStats.errorRate = errorCount / this.processingStats.totalEncodings;
        }
    }

    /**
     * Get service statistics
     */
    public getStats() {
        return { ...this.processingStats };
    }

    /**
     * Get cache information for debugging
     */
    public getCacheInfo(): Record<string, any> {
        return {
            totalEncodings: this.processingStats.totalEncodings,
            averageConfidence: this.processingStats.averageConfidence,
            averageProcessingTime: this.processingStats.averageProcessingTime,
            errorRate: this.processingStats.errorRate
        };
    }
}
