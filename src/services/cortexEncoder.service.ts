/**
 * Cortex Encoder Service
 * 
 * Converts natural language into structured Cortex representations using AI models.
 * This service is responsible for the first stage of the Cortex pipeline.
 */

import {
    CortexFrame,
    CortexConfig,
    CortexError,
    CortexErrorCode,
    CortexEncodingResult,
    DEFAULT_CORTEX_CONFIG,
    CortexEncodingRequest
} from '../types/cortex.types';
import { BedrockService } from './bedrock.service';
import { loggingService } from './logging.service';
import { validateCortexFrame } from '../utils/cortex.utils';
import { TextAnalysis, analyzeText } from '../utils/textAnalysis';

// ============================================================================
// CORTEX ENCODER SERVICE
// ============================================================================

export class CortexEncoderService {
    private static instance: CortexEncoderService;

    private constructor() {}

    public static getInstance(): CortexEncoderService {
        if (!CortexEncoderService.instance) {
            CortexEncoderService.instance = new CortexEncoderService();
        }
        return CortexEncoderService.instance;
    }

    /**
     * Encode natural language text into a Cortex frame
     */
    public async encode(request: CortexEncodingRequest): Promise<CortexEncodingResult> {
        const startTime = Date.now();

        try {
            loggingService.info('🚀 Starting Cortex encoding process', {
                textLength: request.text.length,
                model: request.config?.encoding?.model || DEFAULT_CORTEX_CONFIG.encoding.model
            });

            // Analyze text for context
            const analysis = await analyzeText(request.text);
            
            const jsonResponse = await this.generateCortexStructure(request);
            const cortexFrame: CortexFrame = JSON.parse(jsonResponse);

            const validation = validateCortexFrame(cortexFrame);
            if (!validation.isValid) {
                throw new Error(`Invalid Cortex frame generated: ${validation.errors.join(', ')}`);
            }

            const endTime = Date.now();
            const processingTime = endTime - startTime;

            return {
                cortexFrame,
                confidence: 0.9, // This should be dynamic based on validation
                processingTime,
                modelUsed: request.config?.encoding?.model || DEFAULT_CORTEX_CONFIG.encoding.model,
                originalText: request.text,
                analysis: {
                    language: analysis.language,
                    sentiment: analysis.sentiment,
                    complexity: analysis.complexity,
                },
            };

        } catch (error) {
            loggingService.error('❌ Cortex encoding failed', {
                processingTime: Date.now() - startTime,
                error: error instanceof Error ? error.message : String(error)
            });
            
                throw new CortexError(
                    CortexErrorCode.ENCODING_FAILED,
                `Failed to encode text: ${error instanceof Error ? error.message : String(error)}`,
                'encoding',
                { text: request.text }
            );
        }
    }

    /**
     * Generate the Cortex structure using an AI model.
     * This is the core of the encoding process.
     */
    private async generateCortexStructure(request: CortexEncodingRequest): Promise<string> {
        const { text, config } = request;
        const systemPrompt = request.prompt || CORTEX_ENCODER_SYSTEM_PROMPT;
        const fullPrompt = `${systemPrompt}\n\n${text}`;
        const model = config?.encoding?.model || DEFAULT_CORTEX_CONFIG.encoding.model;

        const rawResponse = await BedrockService.invokeModel(fullPrompt, model);
        
        // First, try to extract JSON from the response
        const jsonResponse = BedrockService.extractJson(rawResponse);

        // Check if we got valid JSON
        if (jsonResponse.startsWith('{') || jsonResponse.startsWith('[')) {
            return jsonResponse;
        }
        
        // If not JSON, check if we got LISP format and convert it to JSON
        const lispMatch = rawResponse.match(/\(query:.*?\)/s);
        if (lispMatch) {
            const lispCode = lispMatch[0];
            loggingService.info('Converting LISP format to JSON', { lispCode });
            
            // Extract key components from the LISP format
            const actionMatch = lispCode.match(/action_(\w+)/);
            const algorithmMatch = lispCode.match(/algorithm_(\w+)/);
            const languageMatch = lispCode.match(/language_(\w+)/);
            
            // Create a JSON object from the LISP structure
            const jsonObject = {
                frameType: "query",
                action: actionMatch ? `action_${actionMatch[1]}` : undefined,
                algorithm: algorithmMatch ? algorithmMatch[1] : undefined,
                language: languageMatch ? languageMatch[1] : undefined,
                // Add other extracted properties as needed
            };
            
            return JSON.stringify(jsonObject);
        }
        
        // If we can't extract either format, log a warning and return the best we have
        loggingService.warn('Cortex encoder response is not valid JSON or LISP format', {
            originalResponse: rawResponse,
            extracted: jsonResponse
        });
        
        // Create a minimal valid JSON as fallback
        const fallbackJson = {
            frameType: "query",
            content: text,
            error: "Failed to parse model response"
        };
        
        return JSON.stringify(fallbackJson);
    }
}

const CORTEX_ENCODER_SYSTEM_PROMPT = `You are a Cortex Encoder AI. Your task is to convert natural language text into a structured JSON format.

**IMPORTANT: YOU MUST RESPOND WITH VALID JSON ONLY**

**ENHANCED FOR LARGE INPUTS:** You can handle complex, multi-part requests including:
- Long technical specifications with multiple requirements
- Complex code generation requests with detailed constraints
- Multi-step instructions with dependencies
- Comprehensive analysis requests with multiple aspects
- Large-scale system design queries

**Cortex Structure Rules:**
- The top-level object MUST be a valid JSON object representing a Cortex Frame.
- A Cortex Frame has a 'frameType' key (e.g., 'query', 'event', 'state').
- Other properties are 'roles' which describe the frame.
- Values should be atomic (strings, numbers, booleans) or arrays of atomics.
- For complex requests, use arrays to capture multiple requirements or constraints.

**Example 1: Simple Query**
- **Input:** "What is the capital of France?"
- **Output:** { "frameType": "query", "topic": "capital", "entity": "France" }

**Example 2: Command with details**
- **Input:** "Create a meeting summary for the Q3 planning session and send it to the project-leads mailing list."
- **Output:** { "frameType": "event", "action": "create_summary", "topic": "Q3 planning session", "recipients": ["project-leads@example.com"] }

**Example 3: Code Generation**
- **Input:** "Implement a binary sort algorithm in C++"
- **Output:** { "frameType": "query", "action": "implement", "algorithm": "binary_sort", "language": "cpp" }

**CRITICAL REQUIREMENTS:**
- Your ENTIRE response must be ONLY a valid JSON object.
- DO NOT include any explanatory text before or after the JSON.
- DO NOT use LISP-style parentheses like (query:). Use ONLY JSON format with curly braces {}.
- DO NOT include code blocks, markdown formatting, or any other text.
- If you include any text that is not part of the JSON object, the system will fail.

Now, process the following text and respond with ONLY a valid JSON object:`;
