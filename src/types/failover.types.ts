/**
 * High-Availability Gateway & Failover Types
 * These types define the structure for multi-provider failover functionality
 */

export interface FailoverTarget {
    /**
     * The base URL of the AI provider to try
     * @example "https://api.openai.com/v1"
     */
    'target-url': string;
    
    /**
     * Authentication headers needed for this specific provider
     * @example { "Authorization": "Bearer sk-...", "anthropic-version": "2023-06-01" }
     */
    headers: Record<string, string>;
    
    /**
     * HTTP status codes that will trigger a failover to the next provider
     * Can be single codes or ranges
     * @example [429, 500, 502, 503] or [{"from": 400, "to": 599}]
     */
    onCodes: (number | { from: number; to: number })[];
    
    /**
     * Optional object to modify keys in the request body to match the target provider's expected format
     * @example { "model": "model_name" } - changes "model" key to "model_name"
     */
    bodyKeyOverride?: Record<string, string>;
    
    /**
     * Optional timeout for this specific provider (in milliseconds)
     * @default 30000
     */
    timeout?: number;
    
    /**
     * Optional provider-specific retry configuration
     */
    retryConfig?: {
        maxRetries?: number;
        baseDelay?: number;
        maxDelay?: number;
    };
}

export interface FailoverPolicy {
    /**
     * Array of providers in order of priority
     * The gateway will try them in sequence until one succeeds
     */
    targets: FailoverTarget[];
    
    /**
     * Global timeout for the entire failover sequence (in milliseconds)
     * @default 120000 (2 minutes)
     */
    globalTimeout?: number;
    
    /**
     * Whether to continue trying providers after a successful response
     * @default false
     */
    continueOnSuccess?: boolean;
}

export interface FailoverContext {
    /**
     * The parsed failover policy from the request header
     */
    policy: FailoverPolicy;
    
    /**
     * Current attempt number (0-based index)
     */
    currentAttemptIndex: number;
    
    /**
     * Timestamp when failover sequence started
     */
    startTime: number;
    
    /**
     * Array of errors from previous attempts
     */
    previousErrors: Array<{
        targetIndex: number;
        error: any;
        statusCode?: number;
        timestamp: number;
    }>;
    
    /**
     * The original request body before any transformations
     */
    originalRequestBody: any;
}

export interface FailoverResult {
    /**
     * Whether the request was successfully handled
     */
    success: boolean;
    
    /**
     * The index of the provider that successfully handled the request
     * -1 if all providers failed
     */
    successfulProviderIndex: number;
    
    /**
     * The response from the successful provider
     */
    response?: any;
    
    /**
     * Response headers from the successful provider
     */
    responseHeaders?: Record<string, string>;
    
    /**
     * HTTP status code from the successful provider
     */
    statusCode?: number;
    
    /**
     * Total time taken for the entire failover sequence
     */
    totalDuration: number;
    
    /**
     * Number of providers attempted
     */
    providersAttempted: number;
    
    /**
     * Detailed information about each attempt
     */
    attemptDetails: Array<{
        targetIndex: number;
        targetUrl: string;
        success: boolean;
        statusCode?: number;
        error?: string;
        duration: number;
        timestamp: number;
    }>;
    
    /**
     * Final error if all providers failed
     */
    finalError?: any;
}

export interface FailoverMetrics {
    /**
     * Total number of failover requests processed
     */
    totalRequests: number;
    
    /**
     * Number of requests that succeeded on first provider
     */
    firstProviderSuccess: number;
    
    /**
     * Number of requests that required failover
     */
    failoverTriggered: number;
    
    /**
     * Number of requests that ultimately failed
     */
    totalFailures: number;
    
    /**
     * Average number of providers attempted per request
     */
    averageProvidersAttempted: number;
    
    /**
     * Provider success rates
     */
    providerStats: Record<string, {
        attempts: number;
        successes: number;
        failures: number;
        averageResponseTime: number;
    }>;
    
    /**
     * Most common failure reasons
     */
    failureReasons: Record<string, number>;
}

/**
 * Extended gateway context to include failover information
 */
export interface FailoverGatewayContext {
    /**
     * Standard gateway context properties
     */
    targetUrl?: string;
    userId?: string;
    requestId?: string;
    cacheEnabled?: boolean;
    retryEnabled?: boolean;
    
    /**
     * Failover-specific properties
     */
    failoverEnabled: boolean;
    failoverContext?: FailoverContext;
    isFailoverRequest: boolean;
}

/**
 * Error class for failover-specific errors
 */
export class FailoverError extends Error {
    public readonly code: string;
    public readonly statusCode: number;
    public readonly providerIndex: number;
    public readonly providerUrl: string;
    public readonly originalError: any;
    
    constructor(
        message: string,
        code: string,
        statusCode: number,
        providerIndex: number,
        providerUrl: string,
        originalError?: any
    ) {
        super(message);
        this.name = 'FailoverError';
        this.code = code;
        this.statusCode = statusCode;
        this.providerIndex = providerIndex;
        this.providerUrl = providerUrl;
        this.originalError = originalError;
    }
}

/**
 * Utility type for failover configuration validation
 */
export interface FailoverValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}