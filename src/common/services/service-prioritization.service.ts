import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import * as fs from 'fs';
import * as os from 'os';
import * as process from 'process';

export type ServiceTier =
  | 'critical'
  | 'essential'
  | 'important'
  | 'standard'
  | 'optional';
export type OverloadLevel =
  | 'normal'
  | 'light'
  | 'moderate'
  | 'heavy'
  | 'severe';
export type ResourceType =
  | 'cpu'
  | 'memory'
  | 'network'
  | 'database'
  | 'cache'
  | 'queue';

export interface ServiceDefinition {
  name: string;
  tier: ServiceTier;
  description: string;
  endpoints: string[];
  dependencies: string[];
  resourceRequirements: {
    cpuWeight: number; // 0-1, relative CPU requirement
    memoryWeight: number; // 0-1, relative memory requirement
    ioWeight: number; // 0-1, relative I/O requirement
  };
  slaRequirements: {
    maxResponseTime: number; // milliseconds
    minAvailability: number; // 0-1, minimum uptime required
    maxErrorRate: number; // 0-1, maximum acceptable error rate
  };
  businessImpact: {
    revenueImpact: number; // 0-1, impact on revenue
    userExperienceImpact: number; // 0-1, impact on UX
    operationalImpact: number; // 0-1, impact on operations
  };
  overloadBehavior: {
    canBeThrottled: boolean;
    canBeDegraded: boolean;
    canBeDisabled: boolean;
    fallbackMode?: 'cache_only' | 'read_only' | 'essential_only';
  };
}

export interface ResourceAllocation {
  service: string;
  tier: ServiceTier;
  allocatedPercentage: number; // 0-100, percentage of total resources
  currentUsage: number; // 0-100, current usage percentage
  priorityScore: number; // calculated priority score
  status: 'active' | 'throttled' | 'degraded' | 'disabled';
}

export interface SystemLoad {
  cpuUsage: number; // 0-100
  memoryUsage: number; // 0-100
  networkUsage: number; // 0-100
  databaseConnections: number;
  queueDepth: number;
  activeRequests: number;
  errorRate: number; // 0-1
  responseTime: number; // milliseconds
}

@Injectable()
export class ServicePrioritizationService implements OnModuleDestroy {
  private readonly logger = new Logger(ServicePrioritizationService.name);
  private services = new Map<string, ServiceDefinition>();
  private resourceAllocations = new Map<string, ResourceAllocation>();
  private currentOverloadLevel: OverloadLevel = 'normal';
  private systemLoad: SystemLoad = {
    cpuUsage: 0,
    memoryUsage: 0,
    networkUsage: 0,
    databaseConnections: 0,
    queueDepth: 0,
    activeRequests: 0,
    errorRate: 0,
    responseTime: 0,
  };

  // Production monitoring state
  private monitoringIntervals: NodeJS.Timeout[] = [];
  private cpuHistory: number[] = [];
  private memoryHistory: number[] = [];
  private responseTimeHistory: number[] = [];
  private errorRateHistory: number[] = [];
  private requestCounter = 0;
  private errorCounter = 0;
  private lastHealthCheck = Date.now();
  private lastNetworkSample: { bytes: number; time: number } | null = null;
  private circuitBreakers = new Map<
    string,
    {
      failures: number;
      lastFailure: number;
      state: 'closed' | 'open' | 'half-open';
    }
  >();

  constructor(
    private eventEmitter: EventEmitter2,
    @InjectConnection() private mongooseConnection: Connection,
  ) {
    this.initializeDefaultServices();
    this.startProductionMonitoring();
    this.setupCircuitBreakers();
  }

  /**
   * Track incoming request for monitoring
   */
  trackRequest(serviceName: string, startTime: number): void {
    this.requestCounter++;
    const allocation = this.resourceAllocations.get(serviceName);
    if (allocation) {
      allocation.currentUsage = Math.min(100, allocation.currentUsage + 1);
    }
  }

  /**
   * Track completed request with response time
   */
  trackRequestCompletion(
    serviceName: string,
    responseTime: number,
    success: boolean,
  ): void {
    this.responseTimeHistory.push(responseTime);
    if (this.responseTimeHistory.length > 100) {
      this.responseTimeHistory.shift(); // Keep last 100 measurements
    }

    if (!success) {
      this.errorCounter++;
      this.errorRateHistory.push(1);
    } else {
      this.errorRateHistory.push(0);
    }

    if (this.errorRateHistory.length > 100) {
      this.errorRateHistory.shift();
    }

    const allocation = this.resourceAllocations.get(serviceName);
    if (allocation) {
      allocation.currentUsage = Math.max(0, allocation.currentUsage - 1);
    }
  }

  /**
   * Check if service is available (circuit breaker)
   */
  isServiceAvailable(serviceName: string): boolean {
    const breaker = this.circuitBreakers.get(serviceName);
    if (!breaker) return true;

    const now = Date.now();

    switch (breaker.state) {
      case 'open':
        // Allow half-open after timeout
        if (now - breaker.lastFailure > 60000) {
          // 1 minute timeout
          breaker.state = 'half-open';
          this.logger.log(
            `Circuit breaker half-open for service: ${serviceName}`,
          );
          return true;
        }
        return false;

      case 'half-open':
        return true;

      case 'closed':
      default:
        return true;
    }
  }

  /**
   * Record service failure for circuit breaker
   */
  recordServiceFailure(serviceName: string): void {
    const breaker = this.circuitBreakers.get(serviceName);
    if (!breaker) return;

    breaker.failures++;
    breaker.lastFailure = Date.now();

    if (breaker.failures >= 5) {
      // Open circuit after 5 failures
      breaker.state = 'open';
      this.logger.warn(`Circuit breaker opened for service: ${serviceName}`, {
        failures: breaker.failures,
        component: 'ServicePrioritizationService',
        operation: 'circuit_breaker',
        type: 'service_failure',
      });
    }
  }

  /**
   * Record service success for circuit breaker recovery
   */
  recordServiceSuccess(serviceName: string): void {
    const breaker = this.circuitBreakers.get(serviceName);
    if (!breaker) return;

    if (breaker.state === 'half-open') {
      breaker.failures = 0;
      breaker.state = 'closed';
      this.logger.log(`Circuit breaker closed for service: ${serviceName}`);
    }
  }

  /**
   * Register a service definition
   */
  registerService(serviceDef: ServiceDefinition): void {
    this.services.set(serviceDef.name, serviceDef);

    // Initialize resource allocation
    const allocation: ResourceAllocation = {
      service: serviceDef.name,
      tier: serviceDef.tier,
      allocatedPercentage: this.getDefaultAllocationForTier(serviceDef.tier),
      currentUsage: 0,
      priorityScore: this.calculatePriorityScore(serviceDef),
      status: 'active',
    };

    this.resourceAllocations.set(serviceDef.name, allocation);

    this.logger.log(`Service registered: ${serviceDef.name}`, {
      component: 'ServicePrioritizationService',
      operation: 'registerService',
      type: 'service_registration',
      service: serviceDef.name,
      tier: serviceDef.tier,
    });
  }

  /**
   * Update system load metrics
   */
  updateSystemLoad(load: Partial<SystemLoad>): void {
    this.systemLoad = { ...this.systemLoad, ...load };

    // Recalculate overload level
    const newOverloadLevel = this.calculateOverloadLevel();
    if (newOverloadLevel !== this.currentOverloadLevel) {
      this.handleOverloadLevelChange(newOverloadLevel);
    }
  }

  /**
   * Get current service priorities
   */
  getServicePriorities(): ResourceAllocation[] {
    return Array.from(this.resourceAllocations.values()).sort(
      (a, b) => b.priorityScore - a.priorityScore,
    );
  }

  /**
   * Check if a service should be throttled based on current load
   */
  shouldThrottleService(serviceName: string): boolean {
    const allocation = this.resourceAllocations.get(serviceName);
    if (!allocation) return false;

    const serviceDef = this.services.get(serviceName);
    if (!serviceDef) return false;

    // Don't throttle critical services
    if (allocation.tier === 'critical') return false;

    // Apply throttling based on overload level
    switch (this.currentOverloadLevel) {
      case 'severe':
        return true; // Already excluded critical above; throttle all others
      case 'heavy':
        return allocation.tier === 'optional' || allocation.tier === 'standard';
      case 'moderate':
        return allocation.tier === 'optional';
      default:
        return false;
    }
  }

  /**
   * Get service degradation recommendations
   */
  getDegradationRecommendations(): Array<{
    service: string;
    recommendedAction: 'throttle' | 'degrade' | 'disable';
    impact: number;
    reason: string;
  }> {
    const recommendations: Array<{
      service: string;
      recommendedAction: 'throttle' | 'degrade' | 'disable';
      impact: number;
      reason: string;
    }> = [];

    for (const [
      serviceName,
      allocation,
    ] of this.resourceAllocations.entries()) {
      const serviceDef = this.services.get(serviceName);
      if (!serviceDef) continue;

      let action: 'throttle' | 'degrade' | 'disable' | null = null;
      let reason = '';

      switch (this.currentOverloadLevel) {
        case 'severe':
          if (
            serviceDef.overloadBehavior.canBeDisabled &&
            allocation.tier !== 'critical'
          ) {
            action = 'disable';
            reason =
              'System under severe load - disabling non-critical services';
          } else if (serviceDef.overloadBehavior.canBeDegraded) {
            action = 'degrade';
            reason =
              'System under severe load - degrading service capabilities';
          }
          break;
        case 'heavy':
          if (
            serviceDef.overloadBehavior.canBeThrottled &&
            allocation.tier === 'optional'
          ) {
            action = 'throttle';
            reason = 'System under heavy load - throttling optional services';
          }
          break;
        case 'moderate':
          if (
            serviceDef.overloadBehavior.canBeThrottled &&
            allocation.tier === 'standard'
          ) {
            action = 'throttle';
            reason =
              'System under moderate load - throttling standard services';
          }
          break;
      }

      if (action) {
        recommendations.push({
          service: serviceName,
          recommendedAction: action,
          impact: serviceDef.businessImpact.operationalImpact,
          reason,
        });
      }
    }

    return recommendations.sort((a, b) => b.impact - a.impact);
  }

  /**
   * Get current system status
   */
  getSystemStatus(): {
    overloadLevel: OverloadLevel;
    systemLoad: SystemLoad;
    activeServices: number;
    throttledServices: number;
    degradedServices: number;
    disabledServices: number;
  } {
    const allocations = Array.from(this.resourceAllocations.values());

    return {
      overloadLevel: this.currentOverloadLevel,
      systemLoad: this.systemLoad,
      activeServices: allocations.filter((a) => a.status === 'active').length,
      throttledServices: allocations.filter((a) => a.status === 'throttled')
        .length,
      degradedServices: allocations.filter((a) => a.status === 'degraded')
        .length,
      disabledServices: allocations.filter((a) => a.status === 'disabled')
        .length,
    };
  }

  private initializeDefaultServices(): void {
    // Register core services with their priorities
    const defaultServices: ServiceDefinition[] = [
      {
        name: 'auth',
        tier: 'critical',
        description: 'Authentication and authorization',
        endpoints: ['/auth/*'],
        dependencies: [],
        resourceRequirements: {
          cpuWeight: 0.3,
          memoryWeight: 0.2,
          ioWeight: 0.1,
        },
        slaRequirements: {
          maxResponseTime: 1000,
          minAvailability: 0.999,
          maxErrorRate: 0.001,
        },
        businessImpact: {
          revenueImpact: 1.0,
          userExperienceImpact: 1.0,
          operationalImpact: 1.0,
        },
        overloadBehavior: {
          canBeThrottled: false,
          canBeDegraded: false,
          canBeDisabled: false,
        },
      },
      {
        name: 'usage-tracking',
        tier: 'essential',
        description: 'Usage tracking and analytics',
        endpoints: ['/usage/*'],
        dependencies: ['database'],
        resourceRequirements: {
          cpuWeight: 0.4,
          memoryWeight: 0.3,
          ioWeight: 0.4,
        },
        slaRequirements: {
          maxResponseTime: 2000,
          minAvailability: 0.99,
          maxErrorRate: 0.01,
        },
        businessImpact: {
          revenueImpact: 0.9,
          userExperienceImpact: 0.7,
          operationalImpact: 0.8,
        },
        overloadBehavior: {
          canBeThrottled: true,
          canBeDegraded: true,
          canBeDisabled: false,
        },
      },
      {
        name: 'gateway',
        tier: 'critical',
        description: 'AI gateway and routing',
        endpoints: ['/gateway/*'],
        dependencies: ['cache', 'database'],
        resourceRequirements: {
          cpuWeight: 0.5,
          memoryWeight: 0.4,
          ioWeight: 0.3,
        },
        slaRequirements: {
          maxResponseTime: 1500,
          minAvailability: 0.999,
          maxErrorRate: 0.005,
        },
        businessImpact: {
          revenueImpact: 1.0,
          userExperienceImpact: 0.9,
          operationalImpact: 0.9,
        },
        overloadBehavior: {
          canBeThrottled: false,
          canBeDegraded: true,
          canBeDisabled: false,
        },
      },
      {
        name: 'optimization',
        tier: 'important',
        description: 'Prompt optimization services',
        endpoints: ['/optimizations/*'],
        dependencies: ['cache', 'database'],
        resourceRequirements: {
          cpuWeight: 0.6,
          memoryWeight: 0.5,
          ioWeight: 0.2,
        },
        slaRequirements: {
          maxResponseTime: 3000,
          minAvailability: 0.95,
          maxErrorRate: 0.05,
        },
        businessImpact: {
          revenueImpact: 0.7,
          userExperienceImpact: 0.8,
          operationalImpact: 0.6,
        },
        overloadBehavior: {
          canBeThrottled: true,
          canBeDegraded: true,
          canBeDisabled: true,
        },
      },
      {
        name: 'analytics',
        tier: 'standard',
        description: 'Analytics and reporting',
        endpoints: ['/analytics/*'],
        dependencies: ['database'],
        resourceRequirements: {
          cpuWeight: 0.3,
          memoryWeight: 0.4,
          ioWeight: 0.5,
        },
        slaRequirements: {
          maxResponseTime: 5000,
          minAvailability: 0.9,
          maxErrorRate: 0.1,
        },
        businessImpact: {
          revenueImpact: 0.3,
          userExperienceImpact: 0.4,
          operationalImpact: 0.2,
        },
        overloadBehavior: {
          canBeThrottled: true,
          canBeDegraded: true,
          canBeDisabled: true,
          fallbackMode: 'cache_only',
        },
      },
    ];

    for (const service of defaultServices) {
      this.registerService(service);
    }
  }

  private getDefaultAllocationForTier(tier: ServiceTier): number {
    switch (tier) {
      case 'critical':
        return 100;
      case 'essential':
        return 80;
      case 'important':
        return 60;
      case 'standard':
        return 40;
      case 'optional':
        return 20;
      default:
        return 50;
    }
  }

  private calculatePriorityScore(service: ServiceDefinition): number {
    const weights = {
      tier: 0.3,
      businessImpact: 0.4,
      slaRequirements: 0.3,
    };

    const tierScore = this.getTierScore(service.tier);
    const businessScore =
      (service.businessImpact.revenueImpact +
        service.businessImpact.userExperienceImpact +
        service.businessImpact.operationalImpact) /
      3;
    const slaScore =
      (service.slaRequirements.minAvailability +
        (1 - service.slaRequirements.maxErrorRate)) /
      2;

    return (
      tierScore * weights.tier +
      businessScore * weights.businessImpact +
      slaScore * weights.slaRequirements
    );
  }

  private getTierScore(tier: ServiceTier): number {
    switch (tier) {
      case 'critical':
        return 1.0;
      case 'essential':
        return 0.8;
      case 'important':
        return 0.6;
      case 'standard':
        return 0.4;
      case 'optional':
        return 0.2;
      default:
        return 0.5;
    }
  }

  private calculateOverloadLevel(): OverloadLevel {
    const {
      cpuUsage,
      memoryUsage,
      networkUsage,
      databaseConnections,
      queueDepth,
      activeRequests,
      errorRate,
      responseTime,
    } = this.systemLoad;

    // Weighted scoring system for production-grade assessment
    const weights = {
      cpu: 0.25,
      memory: 0.25,
      network: 0.15,
      database: 0.1,
      queue: 0.1,
      requests: 0.05,
      errorRate: 0.05,
      responseTime: 0.05,
    };

    // Normalize each metric to 0-1 scale and apply weights
    const cpuScore = this.normalizeMetric(cpuUsage, 0, 100) * weights.cpu;
    const memoryScore =
      this.normalizeMetric(memoryUsage, 0, 100) * weights.memory;
    const networkScore =
      this.normalizeMetric(networkUsage, 0, 100) * weights.network;
    const dbScore =
      this.normalizeMetric(databaseConnections, 0, 100) * weights.database;
    const queueScore = this.normalizeMetric(queueDepth, 0, 500) * weights.queue;
    const requestScore =
      this.normalizeMetric(activeRequests, 0, 200) * weights.requests;
    const errorScore = errorRate * weights.errorRate;
    const responseScore =
      this.normalizeMetric(responseTime, 200, 10000) * weights.responseTime;

    const totalScore =
      cpuScore +
      memoryScore +
      networkScore +
      dbScore +
      queueScore +
      requestScore +
      errorScore +
      responseScore;

    // Trend analysis - consider recent history
    const cpuTrend = this.calculateTrend(this.cpuHistory);
    const memoryTrend = this.calculateTrend(this.memoryHistory);
    const avgTrend = (cpuTrend + memoryTrend) / 2;

    // Adjust score based on trends (increasing load is worse)
    const adjustedScore = totalScore + (avgTrend > 0 ? avgTrend * 0.1 : 0);

    // Circuit breaker impact
    const openBreakers = Array.from(this.circuitBreakers.values()).filter(
      (cb) => cb.state === 'open',
    ).length;
    const breakerPenalty = openBreakers * 0.05; // 5% penalty per open breaker

    const finalScore = Math.min(1, adjustedScore + breakerPenalty);

    // Determine overload level based on final score
    if (finalScore >= 0.8 || errorRate > 0.15 || responseTime > 15000) {
      return 'severe';
    } else if (finalScore >= 0.6 || errorRate > 0.08 || responseTime > 8000) {
      return 'heavy';
    } else if (finalScore >= 0.4 || errorRate > 0.04 || responseTime > 4000) {
      return 'moderate';
    } else if (finalScore >= 0.2 || errorRate > 0.02 || responseTime > 2000) {
      return 'light';
    }

    return 'normal';
  }

  private normalizeMetric(value: number, min: number, max: number): number {
    if (max === min) return 0;
    return Math.max(0, Math.min(1, (value - min) / (max - min)));
  }

  private calculateTrend(values: number[]): number {
    if (values.length < 3) return 0;

    const recent = values.slice(-3);
    const older = values.slice(-6, -3);

    if (older.length === 0) return 0;

    const recentAvg = recent.reduce((sum, val) => sum + val, 0) / recent.length;
    const olderAvg = older.reduce((sum, val) => sum + val, 0) / older.length;

    return (recentAvg - olderAvg) / olderAvg; // Percentage change
  }

  private handleOverloadLevelChange(newLevel: OverloadLevel): void {
    const oldLevel = this.currentOverloadLevel;
    this.currentOverloadLevel = newLevel;

    this.logger.warn(
      `System overload level changed: ${oldLevel} -> ${newLevel}`,
      {
        component: 'ServicePrioritizationService',
        operation: 'overload_level_change',
        type: 'system_overload',
        oldLevel,
        newLevel,
        systemLoad: this.systemLoad,
      },
    );

    // Emit event for other services to react
    this.eventEmitter.emit('system.overload.level.changed', {
      oldLevel,
      newLevel,
      systemLoad: this.systemLoad,
      recommendations: this.getDegradationRecommendations(),
    });

    // Apply automatic degradation if needed
    if (newLevel === 'severe' || newLevel === 'heavy') {
      this.applyAutomaticDegradation();
    }
  }

  private applyAutomaticDegradation(): void {
    const recommendations = this.getDegradationRecommendations();

    for (const recommendation of recommendations) {
      const allocation = this.resourceAllocations.get(recommendation.service);
      if (!allocation) continue;

      switch (recommendation.recommendedAction) {
        case 'disable':
          allocation.status = 'disabled';
          allocation.allocatedPercentage = 0;
          break;
        case 'degrade':
          allocation.status = 'degraded';
          allocation.allocatedPercentage = Math.max(
            20,
            allocation.allocatedPercentage / 2,
          );
          break;
        case 'throttle':
          allocation.status = 'throttled';
          allocation.allocatedPercentage = Math.max(
            30,
            allocation.allocatedPercentage * 0.7,
          );
          break;
      }

      this.logger.warn(
        `Applied automatic degradation to service: ${recommendation.service}`,
        {
          component: 'ServicePrioritizationService',
          operation: 'automatic_degradation',
          type: 'service_degradation',
          service: recommendation.service,
          action: recommendation.recommendedAction,
          newStatus: allocation.status,
          newAllocation: allocation.allocatedPercentage,
        },
      );
    }
  }

  private startProductionMonitoring(): void {
    // System metrics collection - every 15 seconds
    const systemMetricsInterval = setInterval(() => {
      this.collectSystemMetrics();
    }, 15000);
    this.monitoringIntervals.push(systemMetricsInterval);

    // Application metrics collection - every 30 seconds
    const appMetricsInterval = setInterval(() => {
      this.collectApplicationMetrics();
    }, 30000);
    this.monitoringIntervals.push(appMetricsInterval);

    // Health check - every 60 seconds
    const healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, 60000);
    this.monitoringIntervals.push(healthCheckInterval);

    // Initial collection
    this.collectSystemMetrics();
    this.collectApplicationMetrics();
  }

  private collectSystemMetrics(): void {
    try {
      const metrics = this.getSystemMetrics();
      this.updateSystemLoad(metrics);

      // Store historical data for trend analysis
      const cpu = metrics.cpuUsage ?? 0;
      const memory = metrics.memoryUsage ?? 0;
      this.cpuHistory.push(cpu);
      this.memoryHistory.push(memory);

      // Keep only last 10 measurements (2.5 minutes of data)
      if (this.cpuHistory.length > 10) this.cpuHistory.shift();
      if (this.memoryHistory.length > 10) this.memoryHistory.shift();
    } catch (error) {
      this.logger.error('Failed to collect system metrics', {
        error: error instanceof Error ? error.message : String(error),
        component: 'ServicePrioritizationService',
        operation: 'collectSystemMetrics',
        type: 'monitoring_error',
      });
    }
  }

  private collectApplicationMetrics(): void {
    try {
      const metrics = this.getApplicationMetrics();
      this.updateSystemLoad(metrics);
    } catch (error) {
      this.logger.error('Failed to collect application metrics', {
        error: error instanceof Error ? error.message : String(error),
        component: 'ServicePrioritizationService',
        operation: 'collectApplicationMetrics',
        type: 'monitoring_error',
      });
    }
  }

  private getSystemMetrics(): Partial<SystemLoad> {
    // CPU usage calculation using process.hrtime for more accuracy
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach((cpu) => {
      for (const type in cpu.times) {
        totalTick += (cpu.times as any)[type];
      }
      totalIdle += cpu.times.idle;
    });

    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    const cpuUsage = total > 0 ? 100 - ~~((100 * idle) / total) : 0;

    // Memory usage with detailed breakdown
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryUsage = (usedMemory / totalMemory) * 100;

    // Network usage: on Linux use /proc/net/dev delta for bytes/sec; else load as proxy
    let networkUsage: number;
    const now = Date.now();
    const totalBytes = this.readNetworkTotalBytes();
    if (
      totalBytes !== null &&
      this.lastNetworkSample &&
      now > this.lastNetworkSample.time
    ) {
      const deltaBytes = totalBytes - this.lastNetworkSample.bytes;
      const deltaSec = (now - this.lastNetworkSample.time) / 1000;
      const bytesPerSec = deltaSec > 0 ? deltaBytes / deltaSec : 0;
      // 50 MB/s ≈ 100% (typical saturated link)
      networkUsage = Math.min(
        100,
        Math.round((bytesPerSec / (50 * 1024 * 1024)) * 100),
      );
      this.lastNetworkSample = { bytes: totalBytes, time: now };
    } else {
      if (totalBytes !== null) {
        this.lastNetworkSample = { bytes: totalBytes, time: now };
      }
      const loadAverage = os.loadavg()[0];
      networkUsage = Math.min(loadAverage * 15, 100);
    }

    return {
      cpuUsage: Math.max(0, Math.min(100, cpuUsage)),
      memoryUsage: Math.max(0, Math.min(100, memoryUsage)),
      networkUsage: Math.max(0, Math.min(100, networkUsage)),
    };
  }

  private getApplicationMetrics(): Partial<SystemLoad> {
    // Database connections - real MongoDB connection count
    const dbConnections =
      this.mongooseConnection.readyState === 1
        ? (this.mongooseConnection as any).connections?.length || 1
        : 0;

    // Queue depth estimation based on active operations
    const queueDepth = Math.max(
      0,
      this.requestCounter - this.getCompletedRequests(),
    );

    // Error rate calculation from history
    const recentErrors = this.errorRateHistory
      .slice(-100)
      .reduce((sum, val) => sum + val, 0);
    const errorRate =
      this.errorRateHistory.length > 0
        ? recentErrors / this.errorRateHistory.length
        : 0;

    // Response time calculation from history
    const avgResponseTime =
      this.responseTimeHistory.length > 0
        ? this.responseTimeHistory.reduce((sum, time) => sum + time, 0) /
          this.responseTimeHistory.length
        : 500; // Default 500ms

    return {
      databaseConnections: dbConnections,
      queueDepth: Math.min(queueDepth, 1000), // Cap at 1000
      activeRequests: Math.max(
        0,
        this.requestCounter - this.getCompletedRequests(),
      ),
      errorRate: Math.max(0, Math.min(1, errorRate)),
      responseTime: Math.max(0, avgResponseTime),
    };
  }

  private getCompletedRequests(): number {
    return Math.max(0, this.requestCounter - this.systemLoad.activeRequests);
  }

  /** Read total rx+tx bytes from /proc/net/dev on Linux; returns null on other platforms */
  private readNetworkTotalBytes(): number | null {
    try {
      if (process.platform !== 'linux') return null;
      const data = fs.readFileSync('/proc/net/dev', 'utf8');
      let total = 0;
      const lines = data.split('\n').slice(2);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        // Format: "iface: rx_bytes rx_packets ... tx_bytes tx_packets ..."
        if (parts.length >= 10 && parts[0].endsWith(':')) {
          const rx = parseInt(parts[1] as string, 10) || 0;
          const tx = parseInt(parts[9] as string, 10) || 0;
          total += rx + tx;
        }
      }
      return total;
    } catch {
      return null;
    }
  }

  private performHealthChecks(): void {
    const now = Date.now();
    const timeSinceLastCheck = now - this.lastHealthCheck;

    if (timeSinceLastCheck < 55000) return; // Already checked recently

    this.lastHealthCheck = now;

    try {
      const healthStatus = {
        system: this.checkSystemHealth(),
        database: this.checkDatabaseHealth(),
        services: this.checkServicesHealth(),
        timestamp: now,
      };

      // Emit health status
      this.eventEmitter.emit('system.health.status', healthStatus);

      // Log critical health issues
      if (!healthStatus.system.healthy || !healthStatus.database.healthy) {
        this.logger.warn('Health check detected issues', {
          component: 'ServicePrioritizationService',
          operation: 'health_check',
          type: 'health_warning',
          healthStatus,
        });
      }
    } catch (error) {
      this.logger.error('Health check failed', {
        error: error instanceof Error ? error.message : String(error),
        component: 'ServicePrioritizationService',
        operation: 'health_check',
        type: 'health_error',
      });
    }
  }

  private checkSystemHealth(): { healthy: boolean; details: any } {
    const { cpuUsage, memoryUsage } = this.systemLoad;
    const healthy = cpuUsage < 90 && memoryUsage < 90;

    return {
      healthy,
      details: {
        cpuUsage,
        memoryUsage,
        loadAverage: os.loadavg(),
        uptime: os.uptime(),
      },
    };
  }

  private checkDatabaseHealth(): { healthy: boolean; details: any } {
    const connectionState = this.mongooseConnection.readyState;
    const healthy = connectionState === 1; // Connected

    return {
      healthy,
      details: {
        connectionState,
        connectionName: this.mongooseConnection.name,
        host: this.mongooseConnection.host,
        port: this.mongooseConnection.port,
      },
    };
  }

  private checkServicesHealth(): { healthy: boolean; details: any } {
    const serviceHealth = Array.from(this.resourceAllocations.entries()).map(
      ([name, allocation]) => ({
        name,
        healthy: allocation.status === 'active',
        status: allocation.status,
        usage: allocation.currentUsage,
      }),
    );

    const healthy = serviceHealth.every((s) => s.healthy);

    return {
      healthy,
      details: serviceHealth,
    };
  }

  private setupCircuitBreakers(): void {
    // Initialize circuit breakers for critical services
    const criticalServices = ['auth', 'gateway', 'database'];

    criticalServices.forEach((service) => {
      this.circuitBreakers.set(service, {
        failures: 0,
        lastFailure: 0,
        state: 'closed',
      });
    });
  }

  /**
   * Get comprehensive system status for monitoring
   */
  getDetailedSystemStatus(): {
    overloadLevel: OverloadLevel;
    systemLoad: SystemLoad;
    services: ResourceAllocation[];
    healthStatus: any;
    trends: {
      cpuTrend: number[];
      memoryTrend: number[];
      errorRateTrend: number[];
    };
    circuitBreakers: Record<string, any>;
  } {
    return {
      overloadLevel: this.currentOverloadLevel,
      systemLoad: this.systemLoad,
      services: Array.from(this.resourceAllocations.values()),
      healthStatus: {
        lastCheck: this.lastHealthCheck,
        system: this.checkSystemHealth(),
        database: this.checkDatabaseHealth(),
        services: this.checkServicesHealth(),
      },
      trends: {
        cpuTrend: [...this.cpuHistory],
        memoryTrend: [...this.memoryHistory],
        errorRateTrend: [...this.errorRateHistory],
      },
      circuitBreakers: Object.fromEntries(this.circuitBreakers.entries()),
    };
  }

  /**
   * Graceful shutdown
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.log('Shutting down service prioritization service');

    // Clear all monitoring intervals
    this.monitoringIntervals.forEach((interval) => clearInterval(interval));
    this.monitoringIntervals = [];

    // Reset circuit breakers
    this.circuitBreakers.clear();
  }
}
