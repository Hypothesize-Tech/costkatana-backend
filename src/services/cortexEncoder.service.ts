/**
 * Cortex Encoder Service
 * 
 * Converts natural language into structured Cortex representations using AI models.
 * This service is responsible for the first stage of the Cortex pipeline.
 */

import {
    CortexFrame,
    CortexFrameType,
    CortexError,
    CortexErrorCode,
    CortexEncodingResult,
    DEFAULT_CORTEX_CONFIG,
    CortexEncodingRequest
} from '../types/cortex.types';
import { AIRouterService } from './aiRouter.service';
import { loggingService } from './logging.service';
import { validateCortexFrame } from '../utils/cortex.utils';
import { analyzeText } from '../utils/textAnalysis';
import { decodeFromTOON, extractStructuredData, encodeToTOON } from '../utils/toon.utils';

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
                model: request.config?.encoding?.model ?? DEFAULT_CORTEX_CONFIG.encoding.model
            });

            // Analyze text for context
            const analysis = await analyzeText(request.text);
            
            const responseString = await this.generateCortexStructure(request);
            let parsedData: any;
            
            // Edge case: Empty or invalid response
            if (!responseString || typeof responseString !== 'string' || responseString.trim().length === 0) {
                loggingService.warn('Empty or invalid response from model', {
                    responseType: typeof responseString,
                    responseLength: responseString?.length || 0
                });
                parsedData = {
                    frameType: 'query',
                    content: request.text,
                    error: 'Empty response from model'
                };
            } else {
                // Try TOON decode first, fallback to JSON
                parsedData = await decodeFromTOON(responseString);
                
                // Edge case: Handle decode errors
                if (parsedData && typeof parsedData === 'object' && '_decodeError' in parsedData) {
                    loggingService.warn('TOON decode error detected, attempting recovery', {
                        error: parsedData._error,
                        originalLength: parsedData._length
                    });
                    // Try manual parsing as recovery
                    const { tryManualTOONParse } = await import('../utils/toon.utils');
                    const manualParsed = tryManualTOONParse(responseString);
                    if (manualParsed && typeof manualParsed === 'object') {
                        parsedData = manualParsed;
                    } else {
                        parsedData = {
                            frameType: 'query',
                            content: request.text,
                            error: 'Failed to decode model response'
                        };
                    }
                }
                
                // If parsing returned a string, it means decoding failed - try manual parsing
                if (typeof parsedData === 'string') {
                    // Try to extract and parse TOON format manually
                    const toonPatterns = [
                        /(\w+\[\d+\]\{[^}]+\}:[\s\S]*?)(?=\n\n|\n\w+\[|$)/,
                        /(\w+\s*\[\s*\d+\s*\]\s*\{[^}]+\}\s*:[\s\S]*?)(?=\n\n|\n\w+\s*\[|$)/
                    ];
                    
                    for (const pattern of toonPatterns) {
                        const toonMatch = responseString.match(pattern);
                        if (toonMatch?.[1]) {
                            // Import the manual parser function
                            const { tryManualTOONParse } = await import('../utils/toon.utils');
                            const manualParsed = tryManualTOONParse(toonMatch[1]);
                            if (manualParsed && typeof manualParsed === 'object') {
                                parsedData = manualParsed;
                                break;
                            }
                        }
                    }
                }
                
                // If still a string or invalid, create a basic frame structure
                if (typeof parsedData === 'string' || !parsedData || typeof parsedData !== 'object') {
                    loggingService.warn('Could not parse TOON/JSON, creating fallback frame', {
                        responsePreview: responseString.substring(0, 200),
                        parsedDataType: typeof parsedData
                    });
                    parsedData = {
                        frameType: 'query',
                        content: typeof parsedData === 'string' ? parsedData : request.text,
                        error: 'Failed to parse model response'
                    };
                }
            }
            
            const cortexFrame: CortexFrame = parsedData as CortexFrame;
            
            // Ensure frameType exists - if object doesn't have frameType, add it
            if (cortexFrame && typeof cortexFrame === 'object') {
                // If frameType is missing, undefined, null, or empty, set default
                if (!('frameType' in cortexFrame) || 
                    cortexFrame.frameType === undefined || 
                    cortexFrame.frameType === null || 
                    (typeof cortexFrame.frameType === 'string' && cortexFrame.frameType.trim() === '')) {
                    loggingService.warn('Missing or invalid frameType, defaulting to query', {
                        parsedDataKeys: Object.keys(cortexFrame),
                        hasFrameType: 'frameType' in cortexFrame,
                        frameTypeValue: cortexFrame.frameType
                    });
                    (cortexFrame as any).frameType = 'query';
                }
                
                // Normalize frameType - trim whitespace and newlines, validate against valid types
                const validFrameTypes: CortexFrameType[] = ['query', 'answer', 'event', 'state', 'entity', 'list', 'error', 'control', 'conditional', 'loop', 'sequence'];
                if (typeof cortexFrame.frameType === 'string') {
                    const normalizedFrameType = cortexFrame.frameType.trim().replace(/\n/g, ' ').trim().toLowerCase();
                    // Find matching valid frame type (handle case variations)
                    const matchedType = validFrameTypes.find(type => type.toLowerCase() === normalizedFrameType);
                    if (matchedType) {
                        (cortexFrame as any).frameType = matchedType;
                    } else {
                        // Default to 'query' if not recognized
                        (cortexFrame as any).frameType = 'query';
                        loggingService.warn('Invalid frameType detected, defaulting to query', {
                            original: cortexFrame.frameType,
                            normalized: normalizedFrameType
                        });
                    }
                }
                
                // Also normalize other string properties that might have whitespace issues
                Object.keys(cortexFrame).forEach(key => {
                    const value = (cortexFrame as any)[key];
                    if (typeof value === 'string' && key !== 'frameType') {
                        (cortexFrame as any)[key] = value.trim();
                    }
                });
                
                // Information loss detection and mitigation
                // Check if critical information is missing for code generation queries
                if (cortexFrame.frameType === 'query' && (cortexFrame as any).action === 'implement') {
                    const hasRequirements = (cortexFrame as any).requirements || 
                                            (cortexFrame as any).constraints || 
                                            (cortexFrame as any).steps ||
                                            (cortexFrame as any).target ||
                                            (cortexFrame as any).object;
                    
                    // If original text has detailed requirements but encoded frame doesn't, preserve original
                    const originalTextLower = request.text.toLowerCase();
                    const hasDetailedRequirements = originalTextLower.includes('take') || 
                                                   originalTextLower.includes('filter') || 
                                                   originalTextLower.includes('sort') || 
                                                   originalTextLower.includes('return') || 
                                                   originalTextLower.includes('handle') ||
                                                   originalTextLower.includes('include') ||
                                                   originalTextLower.includes('step') ||
                                                   originalTextLower.includes('requirement');
                    
                    if (hasDetailedRequirements && !hasRequirements) {
                        loggingService.warn('Potential information loss detected - preserving original text in content field', {
                            originalTextLength: request.text.length,
                            frameKeys: Object.keys(cortexFrame),
                            hasDetailedRequirements
                        });
                        // Preserve original text in a content/requirements field to ensure no information is lost
                        if (!(cortexFrame as any).content && !(cortexFrame as any).requirements) {
                            (cortexFrame as any).requirements = request.text.substring(0, 500); // Preserve first 500 chars
                        }
                    }
                }
            }

            const validation = validateCortexFrame(cortexFrame);
            if (!validation.isValid) {
                const errorMessages = validation.errors.map(e => 
                    typeof e === 'object' && e.message ? e.message : String(e)
                ).join(', ');
                throw new Error(`Invalid Cortex frame generated: ${errorMessages}`);
            }

            const endTime = Date.now();
            const processingTime = endTime - startTime;

            return {
                cortexFrame,
                confidence: 0.9, // This should be dynamic based on validation
                processingTime,
                modelUsed: request.config?.encoding?.model ?? DEFAULT_CORTEX_CONFIG.encoding.model,
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
        const systemPrompt = request.prompt ?? CORTEX_ENCODER_SYSTEM_PROMPT;
        const fullPrompt = `${systemPrompt}\n\n${text}`;
        const model = config?.encoding?.model ?? DEFAULT_CORTEX_CONFIG.encoding.model;

        const rawResponse = await AIRouterService.invokeModel(fullPrompt, model) as string;
        
        // Try to extract structured data (TOON format)
        const structuredData = await extractStructuredData(rawResponse);
        if (structuredData) {
            // Return as TOON string (already decoded, re-encode for consistency)
            return await encodeToTOON(structuredData);
        }
        
        // Try to extract TOON format (no JSON fallback)
        // TOON format typically starts with identifier[count]{fields}:
        const toonMatch = rawResponse.match(/(\w+\[\d+\]\{[^}]+\}:[\s\S]*?)(?=\n\n|\n\w+\[|$)/);
        if (toonMatch) {
            return toonMatch[1];
        }
        
        // If not TOON, check if we got LISP format and convert it to TOON
        const lispMatch = rawResponse.match(/\(query:.*?\)/s);
        if (lispMatch) {
            const lispCode = lispMatch[0];
            loggingService.info('Converting LISP format to JSON', { lispCode });
            
            // Extract key components from the LISP format
            const actionMatch = lispCode.match(/action_(\w+)/);
            const algorithmMatch = lispCode.match(/algorithm_(\w+)/);
            const languageMatch = lispCode.match(/language_(\w+)/);
            
            // Create a Cortex frame object from the LISP structure
            const frameObject = {
                frameType: "query",
                action: actionMatch ? `action_${actionMatch[1]}` : undefined,
                algorithm: algorithmMatch ? algorithmMatch[1] : undefined,
                language: languageMatch ? languageMatch[1] : undefined,
                // Add other extracted properties as needed
            };
            
            // Convert to TOON format
            return await encodeToTOON(frameObject);
        }
        
        // If we can't extract any format, log a warning and return the best we have
        loggingService.warn('Cortex encoder response is not valid TOON or LISP format', {
            originalResponse: rawResponse.substring(0, 500)
        });
        
        // Create a minimal valid frame as fallback and convert to TOON
        const fallbackFrame = {
            frameType: "query",
            content: text,
            error: "Failed to parse model response"
        };
        
        return await encodeToTOON(fallbackFrame);
    }
}

const CORTEX_ENCODER_SYSTEM_PROMPT = `You are a Cortex Encoder AI. Your task is to convert natural language text into structured TOON format.

**🚨 CRITICAL: ZERO INFORMATION LOSS - PRESERVE ALL DETAILS**
- You MUST capture ALL requirements, constraints, specifications, and details from the input
- Every step, requirement, constraint, and specification must be included
- Use additional fields to preserve complex requirements (requirements, constraints, steps, etc.)
- If input has multiple parts, capture ALL of them using arrays or additional fields
- NEVER omit important details to save tokens - completeness is more important than compression

**IMPORTANT: YOU MUST RESPOND WITH VALID TOON FORMAT ONLY (NO JSON)**

**TOON (Token-Oriented Object Notation) Format:**
- TOON format: users[2]{id,name,role}:
  1,Alice,admin
  2,Bob,user
- For simple objects: frame[1]{frameType,topic,entity}:
  query,capital,France
- For complex objects with multiple fields: frame[1]{frameType,action,language,requirements,constraints}:
  query,implement,typescript,array_median_filter_sort,error_handling_type_safety

**ENHANCED FOR LARGE INPUTS:** You can handle complex, multi-part requests including:
- Long technical specifications with multiple requirements
- Complex code generation requests with detailed constraints
- Multi-step instructions with dependencies
- Comprehensive analysis requests with multiple aspects
- Large-scale system design queries

**Cortex Structure Rules:**
- Convert to TOON format representing a Cortex Frame.
- A Cortex Frame has a 'frameType' (e.g., 'query', 'event', 'state').
- Other properties are 'roles' which describe the frame.
- Values should be atomic (strings, numbers, booleans) or arrays.
- Use TOON format for all structured data to reduce tokens by 30-60%.
- For complex requests, use arrays or additional fields to capture ALL requirements.
- Common fields: frameType, action, language, requirements, constraints, steps, target, object, etc.

**Example 1: Simple Query (TOON)**
- **Input:** "What is the capital of France?"
- **Output:** frame[1]{frameType,topic,entity}:
  query,capital,France

**Example 2: Command with arrays (TOON)**
- **Input:** "Create a meeting summary for the Q3 planning session and send it to the project-leads mailing list."
- **Output:** frame[1]{frameType,action,topic}:
  event,create_summary,Q3_planning_session
recipients[1]{email}:
  project-leads@example.com

**Example 3: Simple Code Generation (TOON)**
- **Input:** "Implement a binary sort algorithm in C++"
- **Output:** frame[1]{frameType,action,algorithm,language}:
  query,implement,binary_sort,cpp

**Example 4: Complex Code Generation with Requirements (TOON) - PRESERVE ALL DETAILS**
- **Input:** "Write a TypeScript function that: 1. Takes an array of numbers as input 2. Filters out duplicates 3. Sorts the array in ascending order 4. Returns the median value 5. Handles edge cases like empty arrays and single elements. Include error handling and type safety."
- **Output:** frame[1]{frameType,action,language,requirements,constraints}:
  query,implement,typescript,array_median_filter_duplicates_sort_ascending,error_handling_type_safety_edge_cases_empty_single_elements

**Example 5: Multi-Step Request (TOON) - PRESERVE ALL STEPS**
- **Input:** "Create a REST API with authentication, add rate limiting, and implement caching"
- **Output:** frame[1]{frameType,action,steps}:
  query,create_rest_api,authentication_rate_limiting_caching
OR with separate array:
steps[3]{step}:
  authentication
  rate_limiting
  caching

**CRITICAL REQUIREMENTS:**
- Your ENTIRE response must be ONLY valid TOON format (NO JSON).
- Use TOON for all structured data (reduces tokens by 30-60%).
- DO NOT include any explanatory text before or after the format.
- DO NOT use LISP-style parentheses like (query:).
- DO NOT use JSON format or code blocks.
- DO NOT include markdown formatting or any other text.
- If you include any text that is not TOON format, the system will fail.
- **MANDATORY: Preserve ALL requirements, constraints, steps, and specifications from the input**
- **Use additional fields (requirements, constraints, steps, etc.) to capture complex information**

Now, process the following text and respond with ONLY valid TOON format (preserving ALL information):`;
