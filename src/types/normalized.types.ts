/**
 * Normalized Types for Provider-Independent Core
 * 
 * These types provide a unified interface for all AI providers,
 * ensuring provider-specific details stay within adapters.
 */

import { AIProviderType } from './aiProvider.types';

/**
 * Normalized Request - Provider-agnostic input format
 */
export interface NormalizedRequest {
    /** The main prompt or user message */
    prompt: string;
    
    /** Target model identifier (can be generic or provider-specific) */
    model: string;
    
    /** Optional provider override (if not auto-detected) */
    provider?: AIProviderType;
    
    /** Conversation history */
    messages?: NormalizedMessage[];
    
    /** System message/instructions */
    systemMessage?: string;
    
    /** Generation parameters */
    parameters?: NormalizedParameters;
    
    /** Request metadata */
    metadata?: NormalizedRequestMetadata;
}

/**
 * Normalized Message - Standard message format
 */
export interface NormalizedMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    /** Optional message metadata (e.g., timestamps, IDs) */
    metadata?: Record<string, any>;
}

/**
 * Normalized Parameters - Standard generation parameters
 */
export interface NormalizedParameters {
    /** Temperature (0.0 - 2.0), controls randomness */
    temperature?: number;
    
    /** Maximum tokens to generate */
    maxTokens?: number;
    
    /** Top-p sampling (0.0 - 1.0) */
    topP?: number;
    
    /** Top-k sampling */
    topK?: number;
    
    /** Stop sequences */
    stopSequences?: string[];
    
    /** Frequency penalty (-2.0 - 2.0) */
    frequencyPenalty?: number;
    
    /** Presence penalty (-2.0 - 2.0) */
    presencePenalty?: number;
    
    /** JSON mode flag */
    responseFormat?: 'text' | 'json' | 'json_object';
    
    /** Tool/function calling configuration */
    tools?: NormalizedTool[];
    
    /** Tool choice setting */
    toolChoice?: 'auto' | 'required' | 'none' | { type: 'function'; function: { name: string } };
}

/**
 * Normalized Tool - Function/tool definition
 */
export interface NormalizedTool {
    type: 'function';
    function: {
        name: string;
        description?: string;
        parameters?: Record<string, any>;
    };
}

/**
 * Normalized Request Metadata
 */
export interface NormalizedRequestMetadata {
    /** Request ID for tracking */
    requestId?: string;
    
    /** User ID */
    userId?: string;
    
    /** Organization/workspace ID */
    organizationId?: string;
    
    /** Request timestamp */
    timestamp?: Date;
    
    /** Request source (e.g., 'api', 'sdk', 'cli') */
    source?: string;
    
    /** Custom metadata */
    custom?: Record<string, any>;
}

/**
 * Normalized Response - Provider-agnostic output format
 */
export interface NormalizedResponse {
    /** Generated text content */
    content: string;
    
    /** Model that generated the response */
    model: string;
    
    /** Provider that served the request */
    provider: AIProviderType;
    
    /** Token usage information */
    usage: NormalizedUsage;
    
    /** Generation finish reason */
    finishReason: NormalizedFinishReason;
    
    /** Latency metrics */
    latency: NormalizedLatency;
    
    /** Cache information */
    cache?: NormalizedCacheInfo;
    
    /** Tool/function calls if any */
    toolCalls?: NormalizedToolCall[];
    
    /** Response metadata */
    metadata?: NormalizedResponseMetadata;
}

/**
 * Normalized Usage - Token and cost information
 */
export interface NormalizedUsage {
    /** Input tokens consumed */
    inputTokens: number;
    
    /** Output tokens generated */
    outputTokens: number;
    
    /** Total tokens */
    totalTokens: number;
    
    /** Cached input tokens (if applicable) */
    cachedInputTokens?: number;
    
    /** Cost breakdown */
    cost?: NormalizedCost;
}

/**
 * Normalized Cost - Cost calculation details
 */
export interface NormalizedCost {
    /** Input cost */
    inputCost: number;
    
    /** Output cost */
    outputCost: number;
    
    /** Total cost */
    totalCost: number;
    
    /** Currency (default: USD) */
    currency: string;
    
    /** Cache savings if any */
    cacheSavings?: number;
}

/**
 * Normalized Finish Reason
 */
export type NormalizedFinishReason = 
    | 'stop'           // Natural completion
    | 'length'         // Max tokens reached
    | 'tool_calls'     // Tool/function call
    | 'content_filter' // Content filtered
    | 'error'          // Error occurred
    | 'timeout'        // Request timeout
    | 'unknown';       // Unknown reason

/**
 * Normalized Latency - Timing information
 */
export interface NormalizedLatency {
    /** Total request duration (ms) */
    totalMs: number;
    
    /** Time to first token (ms) */
    firstTokenMs?: number;
    
    /** Provider processing time (ms) */
    providerMs?: number;
    
    /** Time spent in queue (ms) */
    queueMs?: number;
}

/**
 * Normalized Cache Info
 */
export interface NormalizedCacheInfo {
    /** Whether response was served from cache */
    hit: boolean;
    
    /** Cache key if applicable */
    key?: string;
    
    /** Cache type (e.g., 'semantic', 'exact', 'provider') */
    type?: string;
    
    /** Cache age (ms) */
    ageMs?: number;
}

/**
 * Normalized Tool Call
 */
export interface NormalizedToolCall {
    /** Tool call ID */
    id: string;
    
    /** Tool type */
    type: 'function';
    
    /** Function details */
    function: {
        name: string;
        arguments: string; // JSON string
    };
}

/**
 * Normalized Response Metadata
 */
export interface NormalizedResponseMetadata {
    /** Response timestamp */
    timestamp?: Date;
    
    /** Model version/snapshot used */
    modelVersion?: string;
    
    /** Provider region */
    region?: string;
    
    /** Request ID for correlation */
    requestId?: string;
    
    /** Custom metadata */
    custom?: Record<string, any>;
}

/**
 * Normalized Error - Standardized error format
 */
export interface NormalizedError {
    /** Error type/code */
    type: NormalizedErrorType;
    
    /** Human-readable message */
    message: string;
    
    /** HTTP status code */
    statusCode: number;
    
    /** Provider that encountered the error */
    provider: AIProviderType;
    
    /** Model that was attempted */
    model?: string;
    
    /** Whether error is retryable */
    retryable: boolean;
    
    /** Suggested retry delay (ms) */
    retryAfterMs?: number;
    
    /** Original provider error */
    originalError?: any;
    
    /** Error metadata */
    metadata?: Record<string, any>;
}

/**
 * Normalized Error Types
 */
export type NormalizedErrorType =
    | 'authentication'      // Invalid API key, auth failure
    | 'authorization'       // Insufficient permissions
    | 'rate_limit'         // Rate limit exceeded
    | 'invalid_request'    // Bad request parameters
    | 'model_not_found'    // Model doesn't exist
    | 'model_unavailable'  // Model temporarily unavailable
    | 'context_length'     // Context window exceeded
    | 'content_filter'     // Content policy violation
    | 'timeout'            // Request timeout
    | 'server_error'       // Provider server error
    | 'network_error'      // Network/connectivity issue
    | 'quota_exceeded'     // Quota/budget exceeded
    | 'unknown';           // Unknown error

/**
 * Error factory for creating normalized errors
 */
export class NormalizedErrorFactory {
    static create(
        type: NormalizedErrorType,
        message: string,
        provider: AIProviderType,
        options?: {
            statusCode?: number;
            model?: string;
            retryable?: boolean;
            retryAfterMs?: number;
            originalError?: any;
            metadata?: Record<string, any>;
        }
    ): NormalizedError {
        return {
            type,
            message,
            provider,
            statusCode: options?.statusCode || this.getDefaultStatusCode(type),
            model: options?.model,
            retryable: options?.retryable ?? this.isRetryable(type),
            retryAfterMs: options?.retryAfterMs,
            originalError: options?.originalError,
            metadata: options?.metadata
        };
    }

    private static getDefaultStatusCode(type: NormalizedErrorType): number {
        const statusMap: Record<NormalizedErrorType, number> = {
            authentication: 401,
            authorization: 403,
            rate_limit: 429,
            invalid_request: 400,
            model_not_found: 404,
            model_unavailable: 503,
            context_length: 400,
            content_filter: 400,
            timeout: 408,
            server_error: 500,
            network_error: 503,
            quota_exceeded: 429,
            unknown: 500
        };
        return statusMap[type] || 500;
    }

    private static isRetryable(type: NormalizedErrorType): boolean {
        const retryableTypes: NormalizedErrorType[] = [
            'rate_limit',
            'timeout',
            'server_error',
            'network_error',
            'model_unavailable'
        ];
        return retryableTypes.includes(type);
    }
}

/**
 * Normalized streaming response chunk
 */
export interface NormalizedStreamChunk {
    /** Chunk content */
    content: string;
    
    /** Whether this is the final chunk */
    done: boolean;
    
    /** Partial usage (may be updated) */
    usage?: Partial<NormalizedUsage>;
    
    /** Finish reason (only on final chunk) */
    finishReason?: NormalizedFinishReason;
    
    /** Tool calls (only on final chunk) */
    toolCalls?: NormalizedToolCall[];
}

