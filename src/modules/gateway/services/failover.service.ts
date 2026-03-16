import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosResponse } from 'axios';
import {
  FailoverPolicy,
  FailoverResult,
  FailoverMetrics,
  ProxyRequestConfig,
} from '../interfaces/gateway.interfaces';

/**
 * Failover Service - Handles multi-provider failover for gateway requests
 * Provides intelligent provider switching based on health, performance, and cost
 */
@Injectable()
export class FailoverService {
  private readonly logger = new Logger(FailoverService.name);

  // Provider health tracking
  private providerHealth = new Map<
    string,
    {
      successRate: number;
      averageLatency: number;
      lastFailure?: Date;
      consecutiveFailures: number;
      totalRequests: number;
      totalFailures: number;
    }
  >();

  // Circuit breaker state
  private circuitBreakers = new Map<
    string,
    {
      state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
      failures: number;
      lastFailure: number;
      nextAttempt: number;
    }
  >();

  private readonly CIRCUIT_BREAKER_THRESHOLD = 5;
  private readonly CIRCUIT_BREAKER_TIMEOUT = 30000; // 30 seconds

  /**
   * Parse failover policy from header string
   */
  parseFailoverPolicy(policyString: string): FailoverPolicy {
    try {
      // Parse JSON policy
      const policy = JSON.parse(policyString);

      // Validate required fields
      if (!policy.providers || !Array.isArray(policy.providers)) {
        throw new Error('Failover policy must include providers array');
      }

      if (policy.providers.length === 0) {
        throw new Error('Failover policy must include at least one provider');
      }

      // Validate each provider
      policy.providers.forEach((provider: any, index: number) => {
        if (!provider.url) {
          throw new Error(`Provider ${index} must have url`);
        }
        if (typeof provider.priority !== 'number') {
          throw new Error(`Provider ${index} must have numeric priority`);
        }
        if (typeof provider.weight !== 'number') {
          throw new Error(`Provider ${index} must have numeric weight`);
        }
        if (typeof provider.timeout !== 'number') {
          throw new Error(`Provider ${index} must have numeric timeout`);
        }
      });

      return {
        providers: policy.providers,
        strategy: policy.strategy || 'priority',
        maxRetries: policy.maxRetries || 3,
        timeoutMs: policy.timeoutMs || 30000,
      };
    } catch (error) {
      this.logger.error('Failed to parse failover policy', {
        policyString,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error(
        `Invalid failover policy: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Execute failover across multiple providers
   */
  async executeFailover(
    proxyRequest: ProxyRequestConfig,
    policy: FailoverPolicy,
    requestId: string,
  ): Promise<FailoverResult> {
    const startTime = Date.now();
    const attemptedProviders: string[] = [];
    let lastError: Error | null = null;

    this.logger.log('Starting failover execution', {
      requestId,
      providerCount: policy.providers.length,
      strategy: policy.strategy,
      maxRetries: policy.maxRetries,
      timeoutMs: policy.timeoutMs,
    });

    // Sort providers based on strategy
    const sortedProviders = this.sortProvidersByStrategy(policy);

    for (let i = 0; i < sortedProviders.length && i < policy.maxRetries; i++) {
      const provider = sortedProviders[i];
      attemptedProviders.push(provider.url);

      // Check circuit breaker
      if (this.isCircuitBreakerOpen(provider.url)) {
        this.logger.warn('Circuit breaker open, skipping provider', {
          requestId,
          providerUrl: provider.url,
          attempt: i + 1,
        });
        continue;
      }

      try {
        this.logger.debug('Attempting request with provider', {
          requestId,
          providerUrl: provider.url,
          attempt: i + 1,
          timeout: provider.timeout,
        });

        // Create provider-specific request
        const providerRequest = this.createProviderRequest(
          proxyRequest,
          provider,
        );

        // Execute request with provider timeout
        const response = await this.executeProviderRequest(
          providerRequest,
          provider.timeout,
        );

        // Success - update provider health
        this.updateProviderHealth(provider.url, Date.now() - startTime, true);
        this.resetCircuitBreaker(provider.url);

        this.logger.log('Failover successful', {
          requestId,
          successfulProvider: i,
          providerUrl: provider.url,
          attempt: i + 1,
          totalLatency: Date.now() - startTime,
          providersAttempted: attemptedProviders.length,
        });

        return {
          success: true,
          response: response.data,
          statusCode: response.status,
          responseHeaders: response.headers as Record<string, string>,
          successfulProviderIndex: i,
          providersAttempted: attemptedProviders.length,
          totalLatency: Date.now() - startTime,
        };
      } catch (error) {
        const axiosError = error;
        lastError = axiosError;

        // Update provider health
        this.updateProviderHealth(provider.url, Date.now() - startTime, false);

        // Update circuit breaker
        this.recordCircuitBreakerFailure(provider.url);

        this.logger.warn('Provider attempt failed', {
          requestId,
          providerUrl: provider.url,
          attempt: i + 1,
          error: axiosError.message,
          status: axiosError.response?.status,
          latency: Date.now() - startTime,
        });

        // Continue to next provider
        continue;
      }
    }

    // All providers failed
    this.logger.error('All failover providers failed', {
      requestId,
      providersAttempted: attemptedProviders.length,
      totalLatency: Date.now() - startTime,
      finalError: lastError?.message,
    });

    return {
      success: false,
      providersAttempted: attemptedProviders.length,
      totalLatency: Date.now() - startTime,
      finalError: lastError || new Error('All providers failed'),
    };
  }

  /**
   * Get failover metrics and provider health status
   */
  getMetrics(): FailoverMetrics {
    const providerHealth: Record<
      string,
      {
        successRate: number;
        averageLatency: number;
        lastFailure?: Date;
      }
    > = {};

    for (const [url, health] of this.providerHealth.entries()) {
      providerHealth[url] = {
        successRate:
          health.totalRequests > 0
            ? (health.totalRequests - health.totalFailures) /
              health.totalRequests
            : 0,
        averageLatency: health.averageLatency,
        lastFailure: health.lastFailure,
      };
    }

    return {
      totalRequests: Array.from(this.providerHealth.values()).reduce(
        (sum, h) => sum + h.totalRequests,
        0,
      ),
      successfulRequests: Array.from(this.providerHealth.values()).reduce(
        (sum, h) => sum + (h.totalRequests - h.totalFailures),
        0,
      ),
      failedRequests: Array.from(this.providerHealth.values()).reduce(
        (sum, h) => sum + h.totalFailures,
        0,
      ),
      averageLatency:
        Array.from(this.providerHealth.values()).reduce(
          (sum, h) => sum + h.averageLatency,
          0,
        ) / this.providerHealth.size || 0,
      providerHealth,
    };
  }

  /**
   * Get provider health status
   */
  getProviderHealthStatus(): Record<
    string,
    {
      status: 'healthy' | 'degraded' | 'unhealthy';
      successRate: number;
      averageLatency: number;
      lastFailure?: Date;
      circuitBreakerState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
    }
  > {
    const status: Record<string, any> = {};

    for (const [url, health] of this.providerHealth.entries()) {
      const successRate =
        health.totalRequests > 0
          ? (health.totalRequests - health.totalFailures) / health.totalRequests
          : 1;
      const circuitBreaker = this.circuitBreakers.get(url);

      let healthStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      if (successRate < 0.5 || health.consecutiveFailures > 2) {
        healthStatus = 'unhealthy';
      } else if (successRate < 0.8 || health.averageLatency > 10000) {
        healthStatus = 'degraded';
      }

      status[url] = {
        status: healthStatus,
        successRate,
        averageLatency: health.averageLatency,
        lastFailure: health.lastFailure,
        circuitBreakerState: circuitBreaker?.state || 'CLOSED',
      };
    }

    return status;
  }

  /**
   * Sort providers based on failover strategy
   */
  private sortProvidersByStrategy(policy: FailoverPolicy): any[] {
    switch (policy.strategy) {
      case 'priority':
        return [...policy.providers].sort((a, b) => a.priority - b.priority);

      case 'weighted':
        // Implement weighted random selection
        return this.selectWeightedProviders(policy.providers);

      case 'round-robin':
        // Simple round-robin (could be enhanced with state)
        return [...policy.providers];

      default:
        return [...policy.providers].sort((a, b) => a.priority - b.priority);
    }
  }

  /**
   * Select providers using weighted random selection
   */
  private selectWeightedProviders(providers: any[]): any[] {
    // For simplicity, sort by weight descending
    return [...providers].sort((a, b) => b.weight - a.weight);
  }

  /**
   * Create provider-specific request configuration
   */
  private createProviderRequest(
    baseRequest: ProxyRequestConfig,
    provider: any,
  ): ProxyRequestConfig {
    return {
      ...baseRequest,
      url: provider.url,
      timeout: provider.timeout,
    };
  }

  /**
   * Execute request with timeout
   */
  private async executeProviderRequest(
    request: ProxyRequestConfig,
    timeout: number,
  ): Promise<AxiosResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await axios({
        ...request,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Update provider health metrics
   */
  private updateProviderHealth(
    url: string,
    latency: number,
    success: boolean,
  ): void {
    const health = this.providerHealth.get(url) || {
      successRate: 1,
      averageLatency: 0,
      consecutiveFailures: 0,
      totalRequests: 0,
      totalFailures: 0,
    };

    health.totalRequests++;

    if (success) {
      // Update moving average latency
      health.averageLatency =
        (health.averageLatency * (health.totalRequests - 1) + latency) /
        health.totalRequests;
      health.consecutiveFailures = 0;
    } else {
      health.totalFailures++;
      health.consecutiveFailures++;
      health.lastFailure = new Date();
    }

    this.providerHealth.set(url, health);
  }

  /**
   * Check if circuit breaker is open for provider
   */
  private isCircuitBreakerOpen(url: string): boolean {
    const breaker = this.circuitBreakers.get(url);
    if (!breaker) return false;

    const now = Date.now();

    if (breaker.state === 'OPEN') {
      if (now >= breaker.nextAttempt) {
        // Transition to half-open
        breaker.state = 'HALF_OPEN';
        this.circuitBreakers.set(url, breaker);
        return false;
      }
      return true;
    }

    return false;
  }

  /**
   * Record circuit breaker failure
   */
  private recordCircuitBreakerFailure(url: string): void {
    const breaker = this.circuitBreakers.get(url) || {
      state: 'CLOSED' as const,
      failures: 0,
      lastFailure: 0,
      nextAttempt: 0,
    };

    breaker.failures++;
    breaker.lastFailure = Date.now();

    if (breaker.failures >= this.CIRCUIT_BREAKER_THRESHOLD) {
      breaker.state = 'OPEN';
      breaker.nextAttempt = Date.now() + this.CIRCUIT_BREAKER_TIMEOUT;

      this.logger.warn('Circuit breaker opened for provider', {
        providerUrl: url,
        failures: breaker.failures,
        timeout: this.CIRCUIT_BREAKER_TIMEOUT,
      });
    }

    this.circuitBreakers.set(url, breaker);
  }

  /**
   * Reset circuit breaker after successful request
   */
  private resetCircuitBreaker(url: string): void {
    const breaker = this.circuitBreakers.get(url);
    if (breaker) {
      breaker.failures = 0;
      breaker.state = 'CLOSED';
      this.circuitBreakers.set(url, breaker);
    }
  }
}
