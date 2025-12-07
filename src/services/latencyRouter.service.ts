/**
 * Latency Router Service
 * 
 * Tracks real-time latency metrics for AI models and providers to enable
 * intelligent routing based on actual performance rather than static estimates.
 * Uses P95 latency windows for routing decisions.
 */

import { loggingService } from './logging.service';
import { redisService } from './redis.service';

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

export interface LatencyMetric {
    provider: string;
    model: string;
    latency: number;
    timestamp: number;
    success: boolean;
}

export interface LatencyStats {
    p50: number;
    p95: number;
    p99: number;
    avg: number;
    min: number;
    max: number;
    count: number;
    windowStart: number;
    windowEnd: number;
}

export interface ModelOption {
    provider: string;
    model: string;
    estimatedCost: number;
    capabilities: string[];
}

export interface RoutingDecision {
    selectedProvider: string;
    selectedModel: string;
    reasoning: string;
    latencyP95: number;
    confidence: number;
}

// ============================================================================
// LATENCY ROUTER SERVICE
// ============================================================================

export class LatencyRouterService {
    private static instance: LatencyRouterService;
    
    // Configuration
    private readonly LATENCY_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
    private readonly MAX_LATENCY_ENTRIES = 1000; // Per model
    private readonly CIRCUIT_BREAKER_THRESHOLD_MS = 30000; // 30 seconds
    private readonly CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5; // 5 consecutive failures
    
    // Circuit breaker state
    private circuitBreakers = new Map<string, {
        state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
        failureCount: number;
        lastFailure: number;
        openedAt?: number;
    }>();
    
    private constructor() {
        loggingService.info('🚀 Latency Router Service initialized', {
            windowMs: this.LATENCY_WINDOW_MS,
            maxEntries: this.MAX_LATENCY_ENTRIES,
            circuitBreakerThreshold: this.CIRCUIT_BREAKER_THRESHOLD_MS
        });
    }
    
    public static getInstance(): LatencyRouterService {
        if (!LatencyRouterService.instance) {
            LatencyRouterService.instance = new LatencyRouterService();
        }
        return LatencyRouterService.instance;
    }
    
    /**
     * Track latency for a model request
     */
    public async trackModelLatency(
        provider: string,
        model: string,
        latency: number,
        success: boolean = true
    ): Promise<void> {
        try {
            const timestamp = Date.now();
            const key = this.getLatencyKey(provider, model);
            
            // Store in Redis sorted set with timestamp as score
            await redisService.client.zAdd(key, {
                score: timestamp,
                value: JSON.stringify({ latency, success, timestamp })
            });
            
            // Trim old entries outside the window
            const windowStart = timestamp - this.LATENCY_WINDOW_MS;
            await redisService.client.zRemRangeByScore(key, windowStart, '+inf');
            
            // Limit total entries
            const count = await redisService.client.zCard(key);
            if (count > this.MAX_LATENCY_ENTRIES) {
                const toRemove = count - this.MAX_LATENCY_ENTRIES;
                // Remove oldest entries (lowest scores)
                await redisService.client.zRemRangeByRank(key, 0, toRemove - 1);
            }
            
            // Set expiry to 1 hour
            await redisService.client.expire(key, 3600);
            
            // Update circuit breaker
            this.updateCircuitBreaker(provider, model, latency, success);
            
            loggingService.debug('Latency tracked', {
                provider,
                model,
                latency,
                success
            });
        } catch (error) {
            loggingService.error('Failed to track latency', {
                provider,
                model,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
    
    /**
     * Get P95 latency for a specific model
     */
    public async getModelLatencyP95(provider: string, model: string): Promise<number> {
        try {
            const stats = await this.getModelLatencyStats(provider, model);
            return stats.p95;
        } catch (error) {
            loggingService.warn('Failed to get model P95 latency', {
                provider,
                model,
                error: error instanceof Error ? error.message : String(error)
            });
            return 0; // Return 0 if no data
        }
    }
    
    /**
     * Get P95 latency for a provider (aggregated across all models)
     */
    public async getProviderLatencyP95(provider: string): Promise<number> {
        try {
            // Get all latency keys for this provider
            const pattern = `latency:${provider}:*`;
            const keys = await redisService.scanKeys(pattern);
            
            if (keys.length === 0) {
                return 0;
            }
            
            // Collect all latencies from all models
            const allLatencies: number[] = [];
            
            for (const key of keys) {
                const entries = await redisService.client.zRange(key, 0, -1);
                for (const entry of entries) {
                    try {
                        const data = JSON.parse(entry);
                        if (data.success) {
                            allLatencies.push(data.latency);
                        }
                    } catch (parseError) {
                        // Skip invalid entries
                        continue;
                    }
                }
            }
            
            if (allLatencies.length === 0) {
                return 0;
            }
            
            // Calculate P95
            return this.calculatePercentile(allLatencies, 0.95);
        } catch (error) {
            loggingService.warn('Failed to get provider P95 latency', {
                provider,
                error: error instanceof Error ? error.message : String(error)
            });
            return 0;
        }
    }
    
    /**
     * Get comprehensive latency statistics for a model
     */
    public async getModelLatencyStats(provider: string, model: string): Promise<LatencyStats> {
        try {
            const key = this.getLatencyKey(provider, model);
            const timestamp = Date.now();
            const windowStart = timestamp - this.LATENCY_WINDOW_MS;
            
            // Get all entries within the window
            const entries = await redisService.client.zRangeByScore(key, windowStart, timestamp);
            
            if (entries.length === 0) {
                return {
                    p50: 0,
                    p95: 0,
                    p99: 0,
                    avg: 0,
                    min: 0,
                    max: 0,
                    count: 0,
                    windowStart,
                    windowEnd: timestamp
                };
            }
            
            // Parse and collect successful latencies
            const latencies: number[] = [];
            for (const entry of entries) {
                try {
                    const data = JSON.parse(entry);
                    if (data.success) {
                        latencies.push(data.latency);
                    }
                } catch (parseError) {
                    continue;
                }
            }
            
            if (latencies.length === 0) {
                return {
                    p50: 0,
                    p95: 0,
                    p99: 0,
                    avg: 0,
                    min: 0,
                    max: 0,
                    count: 0,
                    windowStart,
                    windowEnd: timestamp
                };
            }
            
            // Sort for percentile calculations
            latencies.sort((a, b) => a - b);
            
            return {
                p50: this.calculatePercentile(latencies, 0.50),
                p95: this.calculatePercentile(latencies, 0.95),
                p99: this.calculatePercentile(latencies, 0.99),
                avg: latencies.reduce((sum, val) => sum + val, 0) / latencies.length,
                min: latencies[0],
                max: latencies[latencies.length - 1],
                count: latencies.length,
                windowStart,
                windowEnd: timestamp
            };
        } catch (error) {
            loggingService.error('Failed to get model latency stats', {
                provider,
                model,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    
    /**
     * Select best model based on latency requirements
     */
    public async selectModelByLatency(
        maxLatencyMs: number,
        options: ModelOption[]
    ): Promise<RoutingDecision | null> {
        try {
            const candidates: Array<{
                option: ModelOption;
                latencyP95: number;
                circuitState: string;
            }> = [];
            
            // Evaluate each option
            for (const option of options) {
                // Check circuit breaker
                const circuitState = this.getCircuitBreakerState(option.provider, option.model);
                if (circuitState === 'OPEN') {
                    loggingService.debug('Skipping model due to open circuit breaker', {
                        provider: option.provider,
                        model: option.model
                    });
                    continue;
                }
                
                // Get P95 latency
                const latencyP95 = await this.getModelLatencyP95(option.provider, option.model);
                
                // If no latency data, allow the model with low confidence
                if (latencyP95 === 0) {
                    candidates.push({
                        option,
                        latencyP95: maxLatencyMs * 0.5, // Estimate at 50% of max
                        circuitState
                    });
                } else if (latencyP95 <= maxLatencyMs) {
                    candidates.push({
                        option,
                        latencyP95,
                        circuitState
                    });
                }
            }
            
            if (candidates.length === 0) {
                loggingService.warn('No models meet latency requirements', {
                    maxLatencyMs,
                    optionsCount: options.length
                });
                return null;
            }
            
            // Sort by latency (lower is better), then by cost (lower is better)
            candidates.sort((a, b) => {
                const latencyDiff = a.latencyP95 - b.latencyP95;
                if (Math.abs(latencyDiff) < 100) { // Within 100ms
                    return a.option.estimatedCost - b.option.estimatedCost;
                }
                return latencyDiff;
            });
            
            const selected = candidates[0];
            const confidence = selected.latencyP95 > 0 ? 
                Math.min(1.0, 1.0 - (selected.latencyP95 / maxLatencyMs)) : 
                0.5;
            
            return {
                selectedProvider: selected.option.provider,
                selectedModel: selected.option.model,
                reasoning: `Selected based on P95 latency: ${selected.latencyP95.toFixed(0)}ms (max: ${maxLatencyMs}ms), cost: $${selected.option.estimatedCost.toFixed(4)}`,
                latencyP95: selected.latencyP95,
                confidence
            };
        } catch (error) {
            loggingService.error('Failed to select model by latency', {
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }
    
    /**
     * Check if a model is available (circuit breaker check)
     */
    public isModelAvailable(provider: string, model: string): boolean {
        const state = this.getCircuitBreakerState(provider, model);
        return state !== 'OPEN';
    }
    
    /**
     * Get circuit breaker state for a model
     */
    public getCircuitBreakerState(provider: string, model: string): 'CLOSED' | 'OPEN' | 'HALF_OPEN' {
        const key = `${provider}:${model}`;
        const breaker = this.circuitBreakers.get(key);
        
        if (!breaker) {
            return 'CLOSED';
        }
        
        const now = Date.now();
        
        // Check if circuit should be half-opened
        if (breaker.state === 'OPEN' && breaker.openedAt) {
            const timeSinceOpen = now - breaker.openedAt;
            if (timeSinceOpen > 60000) { // 1 minute timeout
                breaker.state = 'HALF_OPEN';
                breaker.failureCount = 0;
                this.circuitBreakers.set(key, breaker);
                
                loggingService.info('Circuit breaker half-opened', {
                    provider,
                    model
                });
            }
        }
        
        return breaker.state;
    }
    
    // ========================================================================
    // PRIVATE HELPER METHODS
    // ========================================================================
    
    private getLatencyKey(provider: string, model: string): string {
        return `latency:${provider}:${model}:window`;
    }
    
    private calculatePercentile(sortedValues: number[], percentile: number): number {
        if (sortedValues.length === 0) {
            return 0;
        }
        
        const index = Math.ceil(sortedValues.length * percentile) - 1;
        return sortedValues[Math.max(0, index)];
    }
    
    private updateCircuitBreaker(
        provider: string,
        model: string,
        latency: number,
        success: boolean
    ): void {
        const key = `${provider}:${model}`;
        let breaker = this.circuitBreakers.get(key);
        
        if (!breaker) {
            breaker = {
                state: 'CLOSED',
                failureCount: 0,
                lastFailure: 0
            };
        }
        
        const now = Date.now();
        
        // Check if latency exceeds threshold or request failed
        const isFailure = !success || latency > this.CIRCUIT_BREAKER_THRESHOLD_MS;
        
        if (isFailure) {
            breaker.failureCount++;
            breaker.lastFailure = now;
            
            // Open circuit if threshold exceeded
            if (breaker.failureCount >= this.CIRCUIT_BREAKER_FAILURE_THRESHOLD && 
                breaker.state !== 'OPEN') {
                breaker.state = 'OPEN';
                breaker.openedAt = now;
                
                loggingService.warn('Circuit breaker opened', {
                    provider,
                    model,
                    failureCount: breaker.failureCount,
                    lastLatency: latency
                });
            }
        } else {
            // Success - reset if not in OPEN state
            if (breaker.state === 'HALF_OPEN') {
                breaker.state = 'CLOSED';
                breaker.failureCount = 0;
                
                loggingService.info('Circuit breaker closed', {
                    provider,
                    model
                });
            } else if (breaker.state === 'CLOSED') {
                // Decay failure count on success
                breaker.failureCount = Math.max(0, breaker.failureCount - 1);
            }
        }
        
        this.circuitBreakers.set(key, breaker);
    }
    
    /**
     * Get all latency metrics for monitoring/debugging
     */
    public async getAllLatencyMetrics(): Promise<Map<string, LatencyStats>> {
        try {
            const pattern = 'latency:*:*:window';
            const keys = await redisService.scanKeys(pattern);
            const metrics = new Map<string, LatencyStats>();
            
            for (const key of keys) {
                // Extract provider and model from key
                const parts = key.split(':');
                if (parts.length >= 4) {
                    const provider = parts[1];
                    const model = parts[2];
                    const stats = await this.getModelLatencyStats(provider, model);
                    metrics.set(`${provider}:${model}`, stats);
                }
            }
            
            return metrics;
        } catch (error) {
            loggingService.error('Failed to get all latency metrics', {
                error: error instanceof Error ? error.message : String(error)
            });
            return new Map();
        }
    }
    
    /**
     * Clear latency data for a specific model
     */
    public async clearModelLatency(provider: string, model: string): Promise<void> {
        try {
            const key = this.getLatencyKey(provider, model);
            await redisService.client.del(key);
            
            // Reset circuit breaker
            const breakerKey = `${provider}:${model}`;
            this.circuitBreakers.delete(breakerKey);
            
            loggingService.info('Cleared latency data', {
                provider,
                model
            });
        } catch (error) {
            loggingService.error('Failed to clear latency data', {
                provider,
                model,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
}

// Export singleton instance
export const latencyRouterService = LatencyRouterService.getInstance();

