/**
 * Normalization Service
 * 
 * Converts between provider-specific formats and normalized formats,
 * ensuring consistent handling across all providers.
 */

import {
    NormalizedRequest,
    NormalizedResponse,
    NormalizedError,
    NormalizedErrorFactory,
    NormalizedErrorType,
    NormalizedFinishReason,
    NormalizedMessage,
    NormalizedParameters
} from '../types/normalized.types';
import { AIProviderType, AIInvokeOptions, AIInvokeResponse } from '../types/aiProvider.types';
import { loggingService } from './logging.service';

export class NormalizationService {
    /**
     * Normalize a request from various input formats
     */
    static normalizeRequest(
        prompt: string,
        model: string,
        options?: AIInvokeOptions,
        metadata?: {
            userId?: string;
            requestId?: string;
            organizationId?: string;
            source?: string;
        }
    ): NormalizedRequest {
        const messages: NormalizedMessage[] = [];

        // Add system message if provided
        if (options?.systemMessage) {
            messages.push({
                role: 'system',
                content: options.systemMessage
            });
        }

        // Add recent messages if provided
        if (options?.recentMessages && options.recentMessages.length > 0) {
            messages.push(...options.recentMessages.map(msg => ({
                role: msg.role,
                content: msg.content
            })));
        }

        // Add current prompt
        messages.push({
            role: 'user' as const,
            content: prompt
        });

        return {
            prompt,
            model,
            messages,
            systemMessage: options?.systemMessage,
            parameters: this.normalizeParameters(options),
            metadata: {
                requestId: metadata?.requestId,
                userId: metadata?.userId,
                organizationId: metadata?.organizationId,
                timestamp: new Date(),
                source: metadata?.source || 'api'
            }
        };
    }

    /**
     * Normalize generation parameters
     */
    private static normalizeParameters(options?: AIInvokeOptions): NormalizedParameters {
        if (!options) return {};

        return {
            temperature: options.temperature,
            maxTokens: options.maxTokens,
            topP: options.topP,
            stopSequences: options.stopSequences
        };
    }

    /**
     * Normalize a provider response to standard format
     */
    static normalizeResponse(
        providerResponse: AIInvokeResponse,
        latencyMs: number,
        options?: {
            requestId?: string;
            cost?: {
                inputCost: number;
                outputCost: number;
                totalCost: number;
            };
        }
    ): NormalizedResponse {
        return {
            content: providerResponse.text,
            model: providerResponse.model,
            provider: providerResponse.provider,
            usage: {
                inputTokens: providerResponse.usage.inputTokens,
                outputTokens: providerResponse.usage.outputTokens,
                totalTokens: providerResponse.usage.totalTokens,
                cost: options?.cost ? {
                    inputCost: options.cost.inputCost,
                    outputCost: options.cost.outputCost,
                    totalCost: options.cost.totalCost,
                    currency: 'USD'
                } : undefined
            },
            finishReason: this.normalizeFinishReason(providerResponse.finishReason),
            latency: {
                totalMs: latencyMs
            },
            cache: providerResponse.cached ? {
                hit: true,
                type: 'provider'
            } : undefined,
            metadata: {
                timestamp: new Date(),
                requestId: options?.requestId
            }
        };
    }

    /**
     * Normalize finish reason from provider-specific format
     */
    private static normalizeFinishReason(reason?: string): NormalizedFinishReason {
        if (!reason) return 'unknown';

        const reasonLower = reason.toLowerCase();

        if (reasonLower.includes('stop') || reasonLower.includes('end_turn')) {
            return 'stop';
        }
        if (reasonLower.includes('length') || reasonLower.includes('max_tokens')) {
            return 'length';
        }
        if (reasonLower.includes('tool') || reasonLower.includes('function')) {
            return 'tool_calls';
        }
        if (reasonLower.includes('content_filter') || reasonLower.includes('safety')) {
            return 'content_filter';
        }
        if (reasonLower.includes('error')) {
            return 'error';
        }

        return 'unknown';
    }

    /**
     * Normalize provider error to standard format
     */
    static normalizeError(
        error: any,
        provider: AIProviderType,
        model?: string
    ): NormalizedError {
        // Detect error type from error object
        const errorType = this.detectErrorType(error);
        const message = this.extractErrorMessage(error);
        const statusCode = this.extractStatusCode(error);
        const retryAfterMs = this.extractRetryAfter(error);

        loggingService.debug('Normalizing provider error', {
            provider,
            model,
            errorType,
            statusCode,
            originalMessage: message
        });

        return NormalizedErrorFactory.create(
            errorType,
            message,
            provider,
            {
                statusCode,
                model,
                retryAfterMs,
                originalError: error,
                metadata: {
                    timestamp: new Date().toISOString()
                }
            }
        );
    }

    /**
     * Detect error type from provider error
     */
    private static detectErrorType(error: any): NormalizedErrorType {
        const statusCode = this.extractStatusCode(error);
        const message = this.extractErrorMessage(error).toLowerCase();
        const errorCode = error?.code?.toLowerCase() || error?.type?.toLowerCase() || '';

        // Authentication errors
        if (
            statusCode === 401 ||
            message.includes('unauthorized') ||
            message.includes('invalid api key') ||
            message.includes('authentication') ||
            errorCode.includes('auth')
        ) {
            return 'authentication';
        }

        // Authorization errors
        if (
            statusCode === 403 ||
            message.includes('forbidden') ||
            message.includes('permission') ||
            message.includes('not allowed')
        ) {
            return 'authorization';
        }

        // Rate limit errors
        if (
            statusCode === 429 ||
            message.includes('rate limit') ||
            message.includes('too many requests') ||
            message.includes('throttl') ||
            errorCode.includes('rate')
        ) {
            return 'rate_limit';
        }

        // Invalid request
        if (
            statusCode === 400 ||
            message.includes('invalid request') ||
            message.includes('bad request') ||
            message.includes('validation')
        ) {
            // Check for specific subtypes
            if (message.includes('context length') || message.includes('token limit')) {
                return 'context_length';
            }
            if (message.includes('content filter') || message.includes('safety')) {
                return 'content_filter';
            }
            return 'invalid_request';
        }

        // Model not found
        if (
            statusCode === 404 ||
            message.includes('model not found') ||
            message.includes('does not exist')
        ) {
            return 'model_not_found';
        }

        // Timeout
        if (
            statusCode === 408 ||
            statusCode === 504 ||
            message.includes('timeout') ||
            message.includes('timed out') ||
            errorCode.includes('timeout')
        ) {
            return 'timeout';
        }

        // Model unavailable
        if (
            statusCode === 503 ||
            message.includes('unavailable') ||
            message.includes('overloaded') ||
            message.includes('capacity')
        ) {
            return 'model_unavailable';
        }

        // Quota exceeded
        if (
            message.includes('quota') ||
            message.includes('budget') ||
            message.includes('insufficient')
        ) {
            return 'quota_exceeded';
        }

        // Server errors
        if (statusCode >= 500 && statusCode < 600) {
            return 'server_error';
        }

        // Network errors
        if (
            message.includes('network') ||
            message.includes('connection') ||
            message.includes('econnrefused') ||
            errorCode.includes('network')
        ) {
            return 'network_error';
        }

        return 'unknown';
    }

    /**
     * Extract error message from various error formats
     */
    private static extractErrorMessage(error: any): string {
        if (typeof error === 'string') {
            return error;
        }

        if (error instanceof Error) {
            return error.message;
        }

        // Check common error message fields
        return (
            error?.message ||
            error?.error?.message ||
            error?.data?.message ||
            error?.response?.data?.message ||
            error?.response?.data?.error?.message ||
            String(error)
        );
    }

    /**
     * Extract HTTP status code from error
     */
    private static extractStatusCode(error: any): number {
        return (
            error?.statusCode ||
            error?.status ||
            error?.response?.status ||
            error?.response?.statusCode ||
            500
        );
    }

    /**
     * Extract retry-after delay from error
     */
    private static extractRetryAfter(error: any): number | undefined {
        // Check Retry-After header (can be in seconds or a date)
        const retryAfter = 
            error?.headers?.['retry-after'] ||
            error?.response?.headers?.['retry-after'];

        if (retryAfter) {
            const parsed = parseInt(retryAfter, 10);
            if (!isNaN(parsed)) {
                return parsed * 1000; // Convert to milliseconds
            }
        }

        // Check for provider-specific retry hints
        if (error?.retryAfter) {
            return typeof error.retryAfter === 'number' 
                ? error.retryAfter 
                : undefined;
        }

        return undefined;
    }

    /**
     * Convert normalized request back to provider-specific format
     * (useful for provider adapters)
     */
    static denormalizeRequest(
        normalizedRequest: NormalizedRequest
    ): {
        prompt: string;
        model: string;
        options: AIInvokeOptions;
    } {
        return {
            prompt: normalizedRequest.prompt,
            model: normalizedRequest.model,
            options: {
                systemMessage: normalizedRequest.systemMessage,
                recentMessages: normalizedRequest.messages
                    ?.filter(m => m.role !== 'system')
                    .map(m => ({
                        role: m.role,
                        content: m.content
                    })),
                temperature: normalizedRequest.parameters?.temperature,
                maxTokens: normalizedRequest.parameters?.maxTokens,
                topP: normalizedRequest.parameters?.topP,
                stopSequences: normalizedRequest.parameters?.stopSequences
            }
        };
    }

    /**
     * Check if an error is retryable
     */
    static isRetryable(error: NormalizedError): boolean {
        return error.retryable;
    }

    /**
     * Get recommended retry delay for an error
     */
    static getRetryDelay(error: NormalizedError, attemptNumber: number): number {
        // Use explicit retry-after if provided
        if (error.retryAfterMs) {
            return error.retryAfterMs;
        }

        // Exponential backoff based on error type and attempt
        const baseDelay = this.getBaseRetryDelay(error.type);
        return Math.min(baseDelay * Math.pow(2, attemptNumber - 1), 60000); // Cap at 60s
    }

    /**
     * Get base retry delay for error type
     */
    private static getBaseRetryDelay(errorType: NormalizedErrorType): number {
        const delayMap: Record<NormalizedErrorType, number> = {
            rate_limit: 5000,        // 5s for rate limits
            timeout: 2000,           // 2s for timeouts
            server_error: 3000,      // 3s for server errors
            network_error: 2000,     // 2s for network issues
            model_unavailable: 5000, // 5s for unavailable models
            authentication: 0,       // No retry for auth errors
            authorization: 0,        // No retry for authz errors
            invalid_request: 0,      // No retry for invalid requests
            model_not_found: 0,      // No retry for missing models
            context_length: 0,       // No retry for context issues
            content_filter: 0,       // No retry for content filter
            quota_exceeded: 10000,   // 10s for quota
            unknown: 3000            // 3s for unknown
        };
        return delayMap[errorType] || 3000;
    }
}

