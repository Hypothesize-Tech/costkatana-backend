/**
 * High-Availability Gateway & Failover Service
 * Handles multi-provider failover logic for the CostKATANA Gateway
 */

import axios, { AxiosResponse, AxiosError, AxiosRequestConfig } from 'axios';
import { loggingService } from './logging.service';
import {
    FailoverTarget,
    FailoverPolicy,
    FailoverContext,
    FailoverResult,
    FailoverError,
    FailoverMetrics,
    FailoverValidationResult
} from '../types/failover.types';

export class FailoverService {
    private static metrics: FailoverMetrics = {
        totalRequests: 0,
        firstProviderSuccess: 0,
        failoverTriggered: 0,
        totalFailures: 0,
        averageProvidersAttempted: 0,
        providerStats: {},
        failureReasons: {}
    };

    /**
     * Parse and validate the CostKatana-Failover-Policy header
     */
    static parseFailoverPolicy(policyHeader: string): FailoverPolicy {
        try {
            const parsed = JSON.parse(policyHeader);
            
            // Handle both array format (legacy) and object format
            let policy: FailoverPolicy;
            if (Array.isArray(parsed)) {
                policy = { targets: parsed };
            } else {
                policy = parsed;
            }

            const validation = this.validateFailoverPolicy(policy);
            if (!validation.isValid) {
                throw new Error(`Invalid failover policy: ${validation.errors.join(', ')}`);
            }

            // Set defaults
            policy.globalTimeout = policy.globalTimeout || 120000; // 2 minutes
            policy.continueOnSuccess = policy.continueOnSuccess || false;

            return policy;
        } catch (error) {
            loggingService.error('Failed to parse failover policy:', { error: error instanceof Error ? error.message : String(error) });
            throw new FailoverError(
                'Invalid failover policy format',
                'INVALID_POLICY',
                400,
                -1,
                '',
                error
            );
        }
    }

    /**
     * Validate failover policy structure
     */
    static validateFailoverPolicy(policy: any): FailoverValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!policy || typeof policy !== 'object') {
            errors.push('Policy must be an object');
            return { isValid: false, errors, warnings };
        }

        if (!policy.targets || !Array.isArray(policy.targets)) {
            errors.push('Policy must have a targets array');
            return { isValid: false, errors, warnings };
        }

        if (policy.targets.length === 0) {
            errors.push('Policy must have at least one target');
            return { isValid: false, errors, warnings };
        }

        if (policy.targets.length > 10) {
            warnings.push('More than 10 targets may impact performance');
        }

        // Validate each target
        policy.targets.forEach((target: any, index: number) => {
            if (!target['target-url']) {
                errors.push(`Target ${index}: target-url is required`);
            } else if (typeof target['target-url'] !== 'string') {
                errors.push(`Target ${index}: target-url must be a string`);
            } else {
                try {
                    new URL(target['target-url']);
                } catch {
                    errors.push(`Target ${index}: target-url must be a valid URL`);
                }
            }

            if (!target.headers || typeof target.headers !== 'object') {
                errors.push(`Target ${index}: headers object is required`);
            }

            if (!target.onCodes || !Array.isArray(target.onCodes)) {
                errors.push(`Target ${index}: onCodes array is required`);
            } else {
                target.onCodes.forEach((code: any, codeIndex: number) => {
                    if (typeof code === 'number') {
                        if (code < 100 || code > 599) {
                            errors.push(`Target ${index}, onCode ${codeIndex}: HTTP status code must be between 100-599`);
                        }
                    } else if (typeof code === 'object' && code.from && code.to) {
                        if (typeof code.from !== 'number' || typeof code.to !== 'number') {
                            errors.push(`Target ${index}, onCode ${codeIndex}: from and to must be numbers`);
                        } else if (code.from >= code.to) {
                            errors.push(`Target ${index}, onCode ${codeIndex}: from must be less than to`);
                        } else if (code.from < 100 || code.to > 599) {
                            errors.push(`Target ${index}, onCode ${codeIndex}: HTTP status codes must be between 100-599`);
                        }
                    } else {
                        errors.push(`Target ${index}, onCode ${codeIndex}: must be a number or range object`);
                    }
                });
            }

            if (target.bodyKeyOverride && typeof target.bodyKeyOverride !== 'object') {
                errors.push(`Target ${index}: bodyKeyOverride must be an object`);
            }

            if (target.timeout && (typeof target.timeout !== 'number' || target.timeout < 1000)) {
                warnings.push(`Target ${index}: timeout should be at least 1000ms`);
            }
        });

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Execute failover request sequence
     */
    static async executeFailover(
        originalRequest: AxiosRequestConfig,
        policy: FailoverPolicy,
        requestId?: string
    ): Promise<FailoverResult> {
        const startTime = Date.now();
        this.metrics.totalRequests++;

        const context: FailoverContext = {
            policy,
            currentAttemptIndex: 0,
            startTime,
            previousErrors: [],
            originalRequestBody: originalRequest.data
        };

        const result: FailoverResult = {
            success: false,
            successfulProviderIndex: -1,
            totalDuration: 0,
            providersAttempted: 0,
            attemptDetails: [],
            finalError: null
        };

        loggingService.info('Starting failover sequence', { value:  { 
            requestId,
            totalTargets: policy.targets.length,
            globalTimeout: policy.globalTimeout
         } });

        // Set global timeout
        const globalTimeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new FailoverError(
                    'Global failover timeout exceeded',
                    'GLOBAL_TIMEOUT',
                    408,
                    -1,
                    '',
                    null
                ));
            }, policy.globalTimeout);
        });

        try {
            const failoverPromise = this.attemptProviders(originalRequest, context, result, requestId);
            await Promise.race([failoverPromise, globalTimeoutPromise]);
        } catch (error) {
            result.finalError = error;
            loggingService.error('Failover sequence failed', { requestId, error: error instanceof Error ? error.message : String(error) });
        }

        result.totalDuration = Date.now() - startTime;
        this.updateMetrics(result);

        return result;
    }

    /**
     * Attempt requests to providers in sequence
     */
    private static async attemptProviders(
        originalRequest: AxiosRequestConfig,
        context: FailoverContext,
        result: FailoverResult,
        requestId?: string
    ): Promise<void> {
        for (let i = 0; i < context.policy.targets.length; i++) {
            const target = context.policy.targets[i];
            const attemptStartTime = Date.now();
            
            context.currentAttemptIndex = i;
            result.providersAttempted++;

            loggingService.info(`Attempting provider ${i + 1}/${context.policy.targets.length}`, {
                requestId,
                targetUrl: target['target-url'],
                attempt: i + 1
            });

            try {
                const transformedRequest = this.transformRequestForTarget(originalRequest, target);
                const response = await this.makeProviderRequest(transformedRequest, target);

                // Success!
                result.success = true;
                result.successfulProviderIndex = i;
                result.response = response.data;
                result.responseHeaders = response.headers as Record<string, string>;
                result.statusCode = response.status;

                const attemptDuration = Date.now() - attemptStartTime;
                result.attemptDetails.push({
                    targetIndex: i,
                    targetUrl: target['target-url'],
                    success: true,
                    statusCode: response.status,
                    duration: attemptDuration,
                    timestamp: attemptStartTime
                });

                loggingService.info(`Provider ${i + 1} succeeded`, {
                    requestId,
                    targetUrl: target['target-url'],
                    statusCode: response.status,
                    duration: attemptDuration
                });

                // Update provider stats
                this.updateProviderStats(target['target-url'], true, attemptDuration);

                if (i === 0) {
                    this.metrics.firstProviderSuccess++;
                } else {
                    this.metrics.failoverTriggered++;
                }

                return; // Exit the loop on success
            } catch (error) {
                const attemptDuration = Date.now() - attemptStartTime;
                const axiosError = error as AxiosError;
                const statusCode = axiosError.response?.status;

                const attemptDetail = {
                    targetIndex: i,
                    targetUrl: target['target-url'],
                    success: false,
                    statusCode,
                    error: axiosError.message,
                    duration: attemptDuration,
                    timestamp: attemptStartTime
                };

                result.attemptDetails.push(attemptDetail);
                context.previousErrors.push({
                    targetIndex: i,
                    error: axiosError,
                    statusCode,
                    timestamp: attemptStartTime
                });

                this.updateProviderStats(target['target-url'], false, attemptDuration);

                loggingService.warn(`Provider ${i + 1} failed`, {
                    requestId,
                    targetUrl: target['target-url'],
                    statusCode,
                    error: axiosError.message,
                    duration: attemptDuration
                });

                // Check if we should failover based on onCodes
                const shouldFailover = this.shouldFailover(statusCode, target.onCodes);
                
                if (!shouldFailover || i === context.policy.targets.length - 1) {
                    // Either we shouldn't failover, or this was the last provider
                    result.finalError = error;
                    this.metrics.totalFailures++;
                    
                    // Track failure reason
                    const failureReason = statusCode ? `HTTP_${statusCode}` : 'NETWORK_ERROR';
                    this.metrics.failureReasons[failureReason] = (this.metrics.failureReasons[failureReason] || 0) + 1;
                    
                    if (i === context.policy.targets.length - 1) {
                        loggingService.error('All providers failed', { requestId, totalAttempts: i + 1 });
                    }
                    return;
                }

                // Continue to next provider
                loggingService.info(`Failing over to next provider`, {
                    requestId,
                    currentProvider: i + 1,
                    nextProvider: i + 2,
                    reason: `HTTP ${statusCode}`
                });
            }
        }
    }

    /**
     * Transform request for specific target provider
     */
    private static transformRequestForTarget(
        originalRequest: AxiosRequestConfig,
        target: FailoverTarget
    ): AxiosRequestConfig {
        const transformed: AxiosRequestConfig = {
            ...originalRequest,
            url: target['target-url'] + (originalRequest.url || ''),
            headers: {
                ...originalRequest.headers,
                ...target.headers
            },
            timeout: target.timeout || originalRequest.timeout || 30000
        };

        // Apply body key overrides
        if (target.bodyKeyOverride && originalRequest.data) {
            try {
                const body = typeof originalRequest.data === 'string' 
                    ? JSON.parse(originalRequest.data) 
                    : originalRequest.data;

                const transformedBody = { ...body };
                
                Object.entries(target.bodyKeyOverride).forEach(([oldKey, newKey]) => {
                    if (oldKey in transformedBody) {
                        transformedBody[newKey] = transformedBody[oldKey];
                        delete transformedBody[oldKey];
                    }
                });

                transformed.data = transformedBody;
            } catch (error) {
                loggingService.warn('Failed to apply body key overrides', { error: error instanceof Error ? error.message : String(error) });
                // Continue with original body
            }
        }

        return transformed;
    }

    /**
     * Make request to a specific provider with retry logic
     */
    private static async makeProviderRequest(
        request: AxiosRequestConfig,
        target: FailoverTarget
    ): Promise<AxiosResponse> {
        const retryConfig = target.retryConfig || {
            maxRetries: 2,
            baseDelay: 1000,
            maxDelay: 5000
        };

        let lastError: any;
        
        for (let attempt = 0; attempt <= retryConfig.maxRetries!; attempt++) {
            try {
                return await axios(request);
            } catch (error) {
                lastError = error;
                
                if (attempt === retryConfig.maxRetries) {
                    throw error;
                }

                const delay = Math.min(
                    retryConfig.baseDelay! * Math.pow(2, attempt),
                    retryConfig.maxDelay!
                );

                loggingService.debug(`Retrying provider request in ${delay}ms`, {
                    attempt: attempt + 1,
                    maxRetries: retryConfig.maxRetries,
                    targetUrl: target['target-url']
                });

                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw lastError;
    }

    /**
     * Check if we should failover based on status code and onCodes configuration
     */
    private static shouldFailover(statusCode: number | undefined, onCodes: FailoverTarget['onCodes']): boolean {
        if (!statusCode) {
            // Network error - always failover
            return true;
        }

        return onCodes.some(code => {
            if (typeof code === 'number') {
                return statusCode === code;
            } else if (typeof code === 'object' && code.from && code.to) {
                return statusCode >= code.from && statusCode <= code.to;
            }
            return false;
        });
    }

    /**
     * Update provider statistics
     */
    private static updateProviderStats(providerUrl: string, success: boolean, duration: number): void {
        if (!this.metrics.providerStats[providerUrl]) {
            this.metrics.providerStats[providerUrl] = {
                attempts: 0,
                successes: 0,
                failures: 0,
                averageResponseTime: 0
            };
        }

        const stats = this.metrics.providerStats[providerUrl];
        stats.attempts++;
        
        if (success) {
            stats.successes++;
        } else {
            stats.failures++;
        }

        // Update average response time
        stats.averageResponseTime = (
            (stats.averageResponseTime * (stats.attempts - 1)) + duration
        ) / stats.attempts;
    }

    /**
     * Update global metrics
     */
    private static updateMetrics(result: FailoverResult): void {
        // Update average providers attempted
        this.metrics.averageProvidersAttempted = (
            (this.metrics.averageProvidersAttempted * (this.metrics.totalRequests - 1)) + 
            result.providersAttempted
        ) / this.metrics.totalRequests;
    }

    /**
     * Get failover metrics
     */
    static getMetrics(): FailoverMetrics {
        return { ...this.metrics };
    }

    /**
     * Reset metrics (useful for testing)
     */
    static resetMetrics(): void {
        this.metrics = {
            totalRequests: 0,
            firstProviderSuccess: 0,
            failoverTriggered: 0,
            totalFailures: 0,
            averageProvidersAttempted: 0,
            providerStats: {},
            failureReasons: {}
        };
    }

    /**
     * Get provider health status based on recent metrics
     */
    static getProviderHealthStatus(): Record<string, {
        status: 'healthy' | 'degraded' | 'unhealthy';
        successRate: number;
        averageResponseTime: number;
        recentAttempts: number;
    }> {
        const healthStatus: Record<string, any> = {};

        Object.entries(this.metrics.providerStats).forEach(([url, stats]) => {
            const successRate = stats.attempts > 0 ? stats.successes / stats.attempts : 0;
            
            let status: 'healthy' | 'degraded' | 'unhealthy';
            if (successRate >= 0.95) {
                status = 'healthy';
            } else if (successRate >= 0.8) {
                status = 'degraded';
            } else {
                status = 'unhealthy';
            }

            healthStatus[url] = {
                status,
                successRate,
                averageResponseTime: Math.round(stats.averageResponseTime),
                recentAttempts: stats.attempts
            };
        });

        return healthStatus;
    }
}