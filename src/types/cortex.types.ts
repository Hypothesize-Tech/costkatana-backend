/**
 * Cortex Meta-Language Type Definitions
 * 
 * This file contains all TypeScript interfaces and types for the Cortex semantic meta-language.
 * Cortex is designed to optimize LLM interactions by providing a structured, unambiguous
 * intermediate representation that reduces token costs and improves processing efficiency.
 */

import { SemanticCortexFrame } from './semanticPrimitives.types';

// ============================================================================
// CORTEX CORE TYPES
// ============================================================================

/**
 * Primitive types represent universal concepts, actions, and properties
 * in the Cortex vocabulary system
 */
export type CortexPrimitive = 
    | `action_${string}`     // Actions (e.g., action_summarize, action_analyze)
    | `concept_${string}`    // Concepts (e.g., concept_document, concept_person)
    | `prop_${string}`       // Properties (e.g., prop_name, prop_sentiment)
    | `mod_${string}`        // Modifiers (e.g., mod_latest, mod_all)
    | `control_${string}`    // Control flow (e.g., control_if, control_for)
    | `comparison_${string}` // Comparisons (e.g., comparison_equals, comparison_gt)
    | `logical_${string}`;   // Logical operators (e.g., logical_and, logical_or)

/**
 * Special values and references used in Cortex structures
 */
export type CortexSpecialValue = 
    | 'latest' 
    | 'previous' 
    | 'all'
    | 'definite'
    | 'indefinite'
    | 'true'
    | 'false'
    | `$${string}`;          // References (e.g., $task_1.target)

/**
 * Cortex data types for values within frames
 */
export type CortexValue = 
    | CortexPrimitive
    | CortexSpecialValue
    | string
    | number
    | boolean
    | CortexValue[]
    | CortexFrame;

// ============================================================================
// CORTEX FRAMES AND ROLES
// ============================================================================

/**
 * Core frame types that define the primary intent of a Cortex expression
 */
export type CortexFrameType = 
    | 'query'        // Request for information or action
    | 'answer'       // Response to a query
    | 'event'        // Action or occurrence
    | 'state'        // Static condition or properties
    | 'entity'       // Person, place, object, or concept
    | 'list'         // Container for items
    | 'error'        // Processing failure
    | 'control'      // Generic control flow
    | 'conditional'  // If/then/else logic
    | 'loop'         // Iteration logic  
    | 'sequence';    // Sequential execution

/**
 * Standard roles that define the labeled slots within frames
 */
export type CortexRole = 
    // Universal roles
    | 'action'           // The action being performed
    | 'agent'            // Entity performing the action
    | 'object'           // Entity being acted upon
    | 'target'           // Primary subject of query/action
    | 'source'           // Origin of information
    | 'aspect'           // Specific quality to consider
    | 'content'          // Main body of data
    | 'properties'       // List of attributes
    | 'reason'           // Cause or justification
    | 'tense'            // Time of event (past, present, future)
    | 'format'           // Desired output format
    
    // Query-specific roles
    | 'task'             // Specific task within a query
    | 'question'         // The question being asked
    
    // Answer-specific roles
    | 'for_task'         // Which task this answers
    | 'status'           // Status of the response
    | 'summary'          // Summary response
    
    // Event-specific roles
    | 'instrument'       // Tool or method used
    | 'location'         // Where the event occurs
    | 'time'             // When the event occurs
    
    // Entity-specific roles
    | 'name'             // Name of the entity
    | 'title'            // Title or designation
    | 'type'             // Category or classification
    
    // List-specific roles
    | `item_${number}`   // Individual list items (item_1, item_2, etc.)
    
    // Error-specific roles
    | 'code'             // Error code
    | 'message';         // Error message

/**
 * Base structure for all Cortex frames
 */
export interface CortexFrameBase {
    readonly frameType: CortexFrameType;
}

/**
 * Specific frame interfaces for type safety
 */
export interface CortexQueryFrame extends CortexFrameBase {
    frameType: 'query';
    action?: CortexPrimitive;
    task?: CortexValue;
    question?: string;
    target?: CortexValue;
    format?: string;
    [key: string]: CortexValue | undefined;
}

export interface CortexAnswerFrame extends CortexFrameBase {
    frameType: 'answer';
    for_task?: CortexValue;
    status?: string;
    summary?: string;
    content?: CortexValue;
    [key: string]: CortexValue | undefined;
}

export interface CortexEventFrame extends CortexFrameBase {
    frameType: 'event';
    action: CortexPrimitive;
    agent?: CortexValue;
    object?: CortexValue;
    instrument?: CortexValue;
    tense?: 'past' | 'present' | 'future';
    location?: CortexValue;
    time?: CortexValue;
    reason?: CortexValue;
    [key: string]: CortexValue | undefined;
}

export interface CortexStateFrame extends CortexFrameBase {
    frameType: 'state';
    entity: CortexValue;
    properties?: CortexValue[];
    condition?: CortexValue;
    [key: string]: CortexValue | undefined;
}

export interface CortexEntityFrame extends CortexFrameBase {
    frameType: 'entity';
    name?: string;
    title?: string;
    type?: CortexPrimitive;
    properties?: CortexValue[];
    [key: string]: CortexValue | undefined;
}

export interface CortexListFrame extends CortexFrameBase {
    frameType: 'list';
    name?: string;
    [key: string]: CortexValue | undefined;
}

export interface CortexErrorFrame extends CortexFrameBase {
    frameType: 'error';
    code: string;
    message: string;
    details?: CortexValue;
    [key: string]: CortexValue | undefined;
}

// Forward declare control flow interfaces (defined in cortexControlFlow.service.ts)
export interface CortexControlFrame extends CortexFrameBase {
    frameType: 'control';
    controlType: 'if' | 'loop' | 'sequence' | 'parallel' | 'switch' | 'try_catch';
    steps: any[];
    metadata?: any;
}

export interface CortexConditionalFrame extends CortexFrameBase {
    frameType: 'conditional';
    condition: any;
    thenBranch: CortexFrame[];
    elseBranch?: CortexFrame[];
    elseIfBranches?: any[];
}

export interface CortexLoopFrame extends CortexFrameBase {
    frameType: 'loop';
    loopType: 'for' | 'while' | 'foreach' | 'repeat';
    body: CortexFrame[];
    maxIterations: number;
    condition?: any;
    iterationVariable?: string;
    iterationSource?: CortexValue | string;
    counter?: any;
}

export interface CortexSequenceFrame extends CortexFrameBase {
    frameType: 'sequence';
    steps: CortexFrame[];
    stopOnError: boolean;
    collectResults: boolean;
    variables?: Record<string, CortexValue>;
}

/**
 * Union type for all Cortex frames
 */
export type CortexFrame = 
    | CortexQueryFrame
    | CortexAnswerFrame
    | CortexEventFrame
    | CortexStateFrame
    | CortexEntityFrame
    | CortexListFrame
    | CortexErrorFrame
    | CortexControlFrame
    | CortexConditionalFrame
    | CortexLoopFrame
    | CortexSequenceFrame;

// ============================================================================
// CORTEX WORKFLOW TYPES
// ============================================================================

/**
 * Request for Cortex encoding (Natural Language → Cortex)
 */
export interface CortexEncodingRequest {
    text: string;
    language: string;
    userId?: string;
    config?: Partial<CortexConfig>;
    prompt?: string;
}

/**
 * Result of Cortex encoding
 */
export interface CortexEncodingResult {
    cortexFrame: CortexFrame;
    confidence: number;
    processingTime: number;
    modelUsed: string;
    originalText: string;
    analysis: {
        language: string;
        sentiment: string;
        complexity: string;
    };
    error?: string; // Added optional error property
}

/**
 * Request for Cortex core processing (Cortex → Cortex)
 */
export interface CortexProcessingRequest {
    input: CortexFrame;
    operation: 'optimize' | 'compress' | 'analyze' | 'transform' | 'sast' | 'answer';
    options?: {
        targetReduction?: number;
        preserveSemantics?: boolean;
        enableInference?: boolean;
        maxComplexity?: number;
        maxProcessingTime?: number;
        generateAnswer?: boolean; // New flag for answer generation
    };
    prompt?: string;
    metadata?: {
        userId?: string;
        provider?: string;
        model?: string;
    };
}

/**
 * Result of Cortex core processing
 */
export interface CortexProcessingResult {
    output: CortexFrame;
    optimizations: Array<{
        type: 'semantic_compression' | 'frame_merging' | 'reference_optimization';
        description: string;
        savings: {
            tokensSaved: number;
            reductionPercentage: number;
        };
        confidence: number;
    }>;
    processingTime: number;
    metadata: {
        coreModel: string;
        operationsApplied: string[];
        semanticIntegrity: number;
    };
}

/**
 * Request for Cortex decoding (Cortex → Natural Language)
 */
export interface CortexDecodingRequest {
    cortexStructure: CortexFrame;
    targetLanguage?: string;
    style?: 'formal' | 'casual' | 'technical' | 'conversational';
    format?: 'plain' | 'markdown' | 'json' | 'structured';
    options?: {
        preserveFormatting?: boolean;
        enhanceReadability?: boolean;
        [key: string]: any;
    };
    metadata?: {
        originalLanguage?: string;
        domain?: string;
        audienceLevel?: 'beginner' | 'intermediate' | 'expert';
    };
    prompt?: string;
    config?: Partial<CortexConfig>;
}

/**
 * Result of Cortex decoding
 */
export interface CortexDecodingResult {
    text: string;
    confidence: number;
    processingTime: number;
    fidelityScore?: number; // How well the decoded text matches the Cortex structure
    metadata: {
        decodingModel: string;
        targetLanguage: string;
        styleApplied: string;
        qualityMetrics: {
            fluency: number;
            coherence: number;
            accuracy: number;
        };
    };
}

export interface CortexSastEncodingRequest {
    text: string;
    language: string;
    disambiguationStrategy: 'most_likely' | 'hybrid' | 'none';
    preserveAmbiguity: boolean;
}

export interface CortexSastEncodingResult {
    semanticFrame: SemanticCortexFrame;
    confidence: number;
    processingTime: number;
    modelUsed: string;
    originalText: string;
    analysis: {
        language: string;
        sentiment: string;
        complexity: string;
    };
    error?: string;
}

// ============================================================================
// CORTEX CONFIGURATION AND METADATA
// ============================================================================

/**
 * Configuration options for Cortex processing
 */
export interface CortexConfig {
    encoding: {
        model: string;
        strategy: 'balanced' | 'performance' | 'quality';
    };
    coreProcessing: {
        model: string;
        optimizationLevel: 'balanced' | 'aggressive' | 'conservative';
    };
    decoding: {
        model: string;
        style: 'formal' | 'conversational' | 'technical';
    };
    instructionGenerator: {
        model: string;
    };
    cache: {
        enabled: boolean;
        ttl: number; // in seconds
    };
    security: {
        contentFilter: 'strict' | 'moderate' | 'none';
        PIIDetection: boolean;
    };
}

/**
 * Cortex processing metadata and metrics
 */
export interface CortexMetadata {
    requestId: string;
    userId?: string;
    processingStage: 'encoding' | 'core_processing' | 'decoding' | 'complete';
    startTime: Date;
    endTime?: Date;
    totalProcessingTime?: number;
    
    performance: {
        tokenReduction: number;
        costSavings: number;
        processingOverhead: number;
        cacheHitRate?: number;
    };
    
    quality: {
        encodingConfidence: number;
        processingConfidence: number;
        decodingConfidence: number;
        overallFidelity: number;
    };
    
    models: {
        encodingModel: string;
        coreModel: string;
        decodingModel: string;
    };
    
    errors?: Array<{
        stage: string;
        code: string;
        message: string;
        timestamp: Date;
    }>;
}

// ============================================================================
// CORTEX OPTIMIZATION INTEGRATION
// ============================================================================

/**
 * Enhanced optimization request with Cortex support
 */
export interface CortexOptimizationRequest {
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
    
    // Existing optimization options
    options?: {
        targetReduction?: number;
        preserveIntent?: boolean;
        suggestAlternatives?: boolean;
        enableCompression?: boolean;
        enableContextTrimming?: boolean;
        enableRequestFusion?: boolean;
        
        // New Cortex-specific options
        enableCortex?: boolean;
        cortexConfig?: Partial<CortexConfig>;
    };
}

/**
 * Enhanced optimization result with Cortex data
 */
export interface CortexOptimizationResult {
    // Existing optimization result fields
    id: string;
    originalPrompt: string;
    optimizedPrompt: string;
    improvementPercentage: number;
    costSaved: number;
    tokensSaved: number;
    
    // Cortex-specific fields
    cortexEnabled: boolean;
    cortexProcessing?: {
        encodedStructure: CortexFrame;
        processedStructure: CortexFrame;
        decodedText: string;
        cortexMetadata: CortexMetadata;
        semanticIntegrity: number;
    };
    
    suggestions: Array<{
        type: string;
        description: string;
        impact: 'low' | 'medium' | 'high';
        implemented: boolean;
        cortexOptimization?: boolean;
    }>;
}

// ============================================================================
// CORTEX GATEWAY INTEGRATION
// ============================================================================

/**
 * Gateway request headers for Cortex processing
 */
export interface CortexGatewayHeaders {
    'x-costkatana-enable-cortex'?: 'true' | 'false';
    'x-costkatana-cortex-encoding-model'?: string;
    'x-costkatana-cortex-core-model'?: string;
    'x-costkatana-cortex-decoding-model'?: string;
    'x-costkatana-cortex-semantic-cache'?: 'true' | 'false';
    'x-costkatana-cortex-optimization-level'?: 'conservative' | 'balanced' | 'aggressive';
}

/**
 * Gateway response headers for Cortex processing
 */
export interface CortexGatewayResponseHeaders {
    'CostKatana-Cortex-Enabled': 'true' | 'false';
    'CostKatana-Cortex-Token-Reduction': string;      // Percentage as string
    'CostKatana-Cortex-Processing-Time': string;      // Milliseconds as string
    'CostKatana-Cortex-Cache-Hit': 'true' | 'false';
    'CostKatana-Cortex-Semantic-Integrity': string;   // Score 0-1 as string
    'CostKatana-Cortex-Cost-Savings': string;         // Dollar amount as string
}

// ============================================================================
// CORTEX CACHING AND PERFORMANCE
// ============================================================================

/**
 * Cortex cache entry structure
 */
export interface CortexCacheEntry {
    key: string;
    type: 'encoding' | 'processing' | 'decoding' | 'fragment';
    value: CortexValue;
    metadata: {
        createdAt: Date;
        lastAccessed: Date;
        hitCount: number;
        size: number;
        ttl: number;
    };
    semanticHash: string;
    dependencies?: string[];
}

/**
 * Performance metrics for Cortex operations
 */
export interface CortexPerformanceMetrics {
    operation: 'encoding' | 'processing' | 'decoding' | 'end_to_end';
    duration: number;
    inputTokens: number;
    outputTokens: number;
    tokenReduction: number;
    costSavings: number;
    cacheHit: boolean;
    qualityScore: number;
    timestamp: Date;
    metadata: Record<string, any>;
}

// ============================================================================
// PROCESSING AND DECODING REQUEST TYPES (Additional)
// ============================================================================

export interface CortexProcessingResult {
    output: CortexFrame;
    optimizations: Array<{
        type: 'semantic_compression' | 'frame_merging' | 'reference_optimization';
        description: string;
        savings: {
            tokensSaved: number;
            reductionPercentage: number;
        };
        confidence: number;
    }>;
    processingTime: number;
    metadata: {
        coreModel: string;
        operationsApplied: string[];
        semanticIntegrity: number;
    };
}

// Duplicate interface removed - using the first definition

export interface CortexDecodingResult {
    text: string;
    confidence: number;
    processingTime: number;
    fidelityScore?: number;
    metadata: {
        decodingModel: string;
        targetLanguage: string;
        styleApplied: string;
        qualityMetrics: {
            fluency: number;
            coherence: number;
            accuracy: number;
        };
    };
}

// ============================================================================
// CORTEX ERROR HANDLING
// ============================================================================

/**
 * Cortex-specific error types
 */
export enum CortexErrorCode {
    ENCODING_FAILED = 'CORTEX_ENCODING_FAILED',
    PROCESSING_FAILED = 'CORTEX_PROCESSING_FAILED',
    DECODING_FAILED = 'CORTEX_DECODING_FAILED',
    INVALID_STRUCTURE = 'CORTEX_INVALID_STRUCTURE',
    UNSUPPORTED_PRIMITIVE = 'CORTEX_UNSUPPORTED_PRIMITIVE',
    REFERENCE_NOT_FOUND = 'CORTEX_REFERENCE_NOT_FOUND',
    SEMANTIC_VALIDATION_FAILED = 'CORTEX_SEMANTIC_VALIDATION_FAILED',
    CACHE_ERROR = 'CORTEX_CACHE_ERROR',
    CONFIGURATION_ERROR = 'CORTEX_CONFIGURATION_ERROR',
    TIMEOUT_ERROR = 'CORTEX_TIMEOUT_ERROR'
}

/**
 * Cortex error class
 */
export class CortexError extends Error {
    constructor(
        public code: CortexErrorCode,
        public message: string,
        public stage: 'encoding' | 'processing' | 'decoding',
        public context?: Record<string, any>
    ) {
        super(message);
        this.name = 'CortexError';
    }
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Utility type for extracting frame-specific roles
 */
export type FrameRoles<T extends CortexFrameType> = 
    T extends 'query' ? keyof CortexQueryFrame :
    T extends 'answer' ? keyof CortexAnswerFrame :
    T extends 'event' ? keyof CortexEventFrame :
    T extends 'state' ? keyof CortexStateFrame :
    T extends 'entity' ? keyof CortexEntityFrame :
    T extends 'list' ? keyof CortexListFrame :
    T extends 'error' ? keyof CortexErrorFrame :
    never;

/**
 * Type guard for Cortex frames
 */
export const isCortexFrame = (value: any): value is CortexFrame => {
    return typeof value === 'object' && 
           value !== null && 
           'frameType' in value &&
           ['query', 'answer', 'event', 'state', 'entity', 'list', 'error'].includes(value.frameType);
};

/**
 * Type guard for specific frame types
 */
export const isQueryFrame = (frame: CortexFrame): frame is CortexQueryFrame => frame.frameType === 'query';
export const isAnswerFrame = (frame: CortexFrame): frame is CortexAnswerFrame => frame.frameType === 'answer';
export const isEventFrame = (frame: CortexFrame): frame is CortexEventFrame => frame.frameType === 'event';
export const isStateFrame = (frame: CortexFrame): frame is CortexStateFrame => frame.frameType === 'state';
export const isEntityFrame = (frame: CortexFrame): frame is CortexEntityFrame => frame.frameType === 'entity';
export const isListFrame = (frame: CortexFrame): frame is CortexListFrame => frame.frameType === 'list';
export const isErrorFrame = (frame: CortexFrame): frame is CortexErrorFrame => frame.frameType === 'error';

/**
 * Default Cortex configuration
 */
export const DEFAULT_CORTEX_CONFIG: CortexConfig = {
    encoding: {
        model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        strategy: 'balanced'
    },
    coreProcessing: {
        model: 'anthropic.claude-opus-4-1-20250805-v1:0',
        optimizationLevel: 'balanced'
    },
    decoding: {
        model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        style: 'conversational'
    },
    instructionGenerator: {
        model: 'anthropic.claude-3-5-haiku-20241022-v1:0'
    },
    cache: {
        enabled: true,
        ttl: 3600
    },
    security: {
        contentFilter: 'moderate',
        PIIDetection: true
    }
};
