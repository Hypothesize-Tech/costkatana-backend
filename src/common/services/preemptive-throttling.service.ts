/**
 * Pre-emptive Throttling Service for NestJS
 * Implements early warning systems and gradual throttling before hitting hard limits
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as os from 'os';

export type ThrottlingPhase =
  | 'normal'
  | 'warning'
  | 'caution'
  | 'critical'
  | 'emergency';
export type ThrottlingAction =
  | 'monitor'
  | 'warn'
  | 'limit'
  | 'throttle'
  | 'block';

export interface ThrottlingMetrics {
  cpu_usage: number;
  memory_usage: number;
  response_time: number;
  error_rate: number;
  request_rate: number;
  queue_depth: number;
  active_connections: number;
  database_connections: number;
  cache_hit_rate: number;
  timestamp: number;
}

export interface ThrottlingThreshold {
  phase: ThrottlingPhase;
  action: ThrottlingAction;
  conditions: {
    cpu_usage?: number;
    memory_usage?: number;
    response_time?: number;
    error_rate?: number;
    request_rate?: number;
    queue_depth?: number;
    active_connections?: number;
    database_connections?: number;
    cache_hit_rate?: number;
  };
  throttling_factor: number; // 0.0 to 1.0 (1.0 = no throttling, 0.0 = full block)
  warning_message?: string;
  duration: number; // minimum duration in milliseconds
  escalation_delay: number; // time before escalating to next phase
}

export interface ThrottlingDecision {
  allowed: boolean;
  phase: ThrottlingPhase;
  action: ThrottlingAction;
  throttling_factor: number;
  delay_ms: number;
  retry_after?: number;
  warning_message?: string;
  metrics: ThrottlingMetrics;
  reasons: string[];
}

export interface PreemptiveConfig {
  enable_preemptive_throttling: boolean;
  prediction_window: number; // seconds
  smoothing_factor: number; // for exponential smoothing
  min_samples: number; // minimum samples for prediction
  escalation_cooldown: number; // cooldown between escalations
  recovery_factor: number; // factor for recovery thresholds
  max_throttling_duration: number; // maximum time to stay in throttled state
}

@Injectable()
export class PreemptiveThrottlingService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PreemptiveThrottlingService.name);

  private currentPhase: ThrottlingPhase = 'normal';
  private currentAction: ThrottlingAction = 'monitor';
  private currentThrottlingFactor = 1.0;
  private phaseStartTime = Date.now();
  private lastEscalation = 0;

  // Metrics tracking
  private metricsHistory: ThrottlingMetrics[] = [];
  private readonly MAX_HISTORY_SIZE = 1000;

  // Configuration
  private config: PreemptiveConfig;

  // Throttling thresholds (ordered by severity)
  private thresholds: ThrottlingThreshold[] = [
    {
      phase: 'warning',
      action: 'warn',
      conditions: {
        cpu_usage: 60,
        memory_usage: 70,
        response_time: 1000,
        error_rate: 2,
        request_rate: 100,
        queue_depth: 50,
        active_connections: 200,
        database_connections: 80,
        cache_hit_rate: 85,
      },
      throttling_factor: 1.0,
      warning_message: 'System approaching capacity limits',
      duration: 60000, // 1 minute
      escalation_delay: 300000, // 5 minutes
    },
    {
      phase: 'caution',
      action: 'limit',
      conditions: {
        cpu_usage: 75,
        memory_usage: 80,
        response_time: 2000,
        error_rate: 5,
        request_rate: 150,
        queue_depth: 100,
        active_connections: 300,
        database_connections: 90,
        cache_hit_rate: 75,
      },
      throttling_factor: 0.8,
      warning_message: 'System under increased load',
      duration: 120000, // 2 minutes
      escalation_delay: 180000, // 3 minutes
    },
    {
      phase: 'critical',
      action: 'throttle',
      conditions: {
        cpu_usage: 85,
        memory_usage: 90,
        response_time: 5000,
        error_rate: 10,
        request_rate: 200,
        queue_depth: 200,
        active_connections: 400,
        database_connections: 95,
        cache_hit_rate: 60,
      },
      throttling_factor: 0.5,
      warning_message: 'Critical system load - throttling requests',
      duration: 300000, // 5 minutes
      escalation_delay: 120000, // 2 minutes
    },
    {
      phase: 'emergency',
      action: 'block',
      conditions: {
        cpu_usage: 95,
        memory_usage: 95,
        response_time: 10000,
        error_rate: 20,
        request_rate: 300,
        queue_depth: 500,
        active_connections: 500,
        database_connections: 98,
        cache_hit_rate: 40,
      },
      throttling_factor: 0.1,
      warning_message: 'Emergency throttling active - minimal requests allowed',
      duration: 600000, // 10 minutes
      escalation_delay: 60000, // 1 minute
    },
  ];

  private metricsInterval?: NodeJS.Timeout;
  private thresholdCheckInterval?: NodeJS.Timeout;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.initializeConfig();
  }

  onModuleInit(): void {
    this.startMonitoring();
  }

  onModuleDestroy(): void {
    this.stopMonitoring();
  }

  private initializeConfig(): void {
    this.config = {
      enable_preemptive_throttling: this.configService.get<boolean>(
        'ENABLE_PREEMPTIVE_THROTTLING',
        true,
      ),
      prediction_window: this.configService.get<number>(
        'THROTTLING_PREDICTION_WINDOW',
        300,
      ), // 5 minutes
      smoothing_factor: this.configService.get<number>(
        'THROTTLING_SMOOTHING_FACTOR',
        0.3,
      ),
      min_samples: this.configService.get<number>('THROTTLING_MIN_SAMPLES', 10),
      escalation_cooldown: this.configService.get<number>(
        'THROTTLING_ESCALATION_COOLDOWN',
        30000,
      ), // 30 seconds
      recovery_factor: this.configService.get<number>(
        'THROTTLING_RECOVERY_FACTOR',
        0.8,
      ), // 20% buffer for recovery
      max_throttling_duration: this.configService.get<number>(
        'THROTTLING_MAX_DURATION',
        1800000,
      ), // 30 minutes
    };
  }

  /**
   * Check if a request should be allowed based on current system state
   */
  async checkRequest(requestContext?: {
    userId?: string;
    priority?: 'low' | 'normal' | 'high' | 'critical';
    endpoint?: string;
    method?: string;
  }): Promise<ThrottlingDecision> {
    try {
      const currentMetrics = await this.getCurrentMetrics();

      // Check current phase and thresholds
      const decision = this.evaluateThrottlingDecision(
        currentMetrics,
        requestContext,
      );

      // Emit decision event
      this.eventEmitter.emit('throttling.decision', {
        ...decision,
        requestContext,
        timestamp: Date.now(),
      });

      // Update metrics with decision
      this.recordDecision(decision);

      return decision;
    } catch (error) {
      this.logger.error('Error checking request throttling', {
        error: error instanceof Error ? error.message : String(error),
        requestContext,
      });

      // Default to allow on error
      return {
        allowed: true,
        phase: 'normal',
        action: 'monitor',
        throttling_factor: 1.0,
        delay_ms: 0,
        metrics: await this.getCurrentMetrics(),
        reasons: ['Error in throttling check'],
      };
    }
  }

  /**
   * Get current system metrics (real where available, deterministic fallbacks)
   */
  private async getCurrentMetrics(): Promise<ThrottlingMetrics> {
    const now = Date.now();

    // Real process memory (bytes -> percentage of a reasonable heap limit, e.g. 1.5GB)
    const mem = process.memoryUsage();
    const heapUsedMB = mem.heapUsed / (1024 * 1024);
    const rssMB = mem.rss / (1024 * 1024);
    const memory_usage = Math.min(100, Math.round((rssMB / 1536) * 100)); // 1.5GB baseline

    // CPU: use os.loadavg() (1-min) normalized to 0-100 (assume 4 cores)
    const loadAvg = os.loadavg()[0] ?? 0;
    const cpu_usage = Math.min(
      100,
      Math.round((loadAvg / Math.max(1, os.cpus().length)) * 100),
    );

    // Rolling window from history for response_time and error_rate when available
    const recent = this.metricsHistory.slice(-5);
    const response_time = recent.length
      ? recent.reduce((s, m) => s + m.response_time, 0) / recent.length
      : 200;
    const error_rate = recent.length
      ? recent.reduce((s, m) => s + m.error_rate, 0) / recent.length
      : 0;
    const request_rate = recent.length
      ? recent.reduce((s, m) => s + m.request_rate, 0) / recent.length
      : 50;
    const queue_depth = recent.length
      ? recent[recent.length - 1].queue_depth
      : 0;

    return {
      cpu_usage,
      memory_usage,
      response_time,
      error_rate,
      request_rate,
      queue_depth,
      active_connections: 0, // Would come from connection pool / server stats
      database_connections: 0,
      cache_hit_rate: 85,
      timestamp: now,
    };
  }

  /**
   * Evaluate throttling decision based on metrics and thresholds
   */
  private evaluateThrottlingDecision(
    metrics: ThrottlingMetrics,
    requestContext?: any,
  ): ThrottlingDecision {
    const reasons: string[] = [];

    // Check if we're in a cooldown period after escalation
    const timeSinceEscalation = Date.now() - this.lastEscalation;
    if (timeSinceEscalation < this.config.escalation_cooldown) {
      const allowed = this.shouldAllowRequestDeterministic(
        this.currentThrottlingFactor,
        requestContext,
      );
      return {
        allowed,
        phase: this.currentPhase,
        action: this.currentAction,
        throttling_factor: this.currentThrottlingFactor,
        delay_ms: 0,
        warning_message: this.getThresholdMessage(this.currentPhase),
        metrics,
        reasons: ['In escalation cooldown'],
      };
    }

    // Check each threshold in order of severity
    for (const threshold of this.thresholds) {
      if (this.meetsThresholdConditions(metrics, threshold)) {
        // Check if we should escalate to this phase
        if (this.shouldEscalateToPhase(threshold.phase)) {
          this.escalateToPhase(threshold);
          reasons.push(`Escalated to ${threshold.phase} phase`);
        }

        const allowed = this.shouldAllowRequestDeterministic(
          threshold.throttling_factor,
          requestContext,
        );
        const delay = this.calculateDelay(threshold);

        return {
          allowed,
          phase: threshold.phase,
          action: threshold.action,
          throttling_factor: threshold.throttling_factor,
          delay_ms: delay,
          retry_after: allowed
            ? undefined
            : this.calculateRetryAfter(threshold),
          warning_message: threshold.warning_message,
          metrics,
          reasons,
        };
      }
    }

    // Check for recovery to normal state
    if (this.currentPhase !== 'normal' && this.shouldRecoverToNormal(metrics)) {
      this.recoverToNormal();
      reasons.push('Recovered to normal operation');
    }

    // Normal operation
    return {
      allowed: true,
      phase: 'normal',
      action: 'monitor',
      throttling_factor: 1.0,
      delay_ms: 0,
      metrics,
      reasons: ['Normal operation'],
    };
  }

  /**
   * Check if metrics meet threshold conditions
   */
  private meetsThresholdConditions(
    metrics: ThrottlingMetrics,
    threshold: ThrottlingThreshold,
  ): boolean {
    const conditions = threshold.conditions;

    // Check each condition
    if (conditions.cpu_usage && metrics.cpu_usage >= conditions.cpu_usage)
      return true;
    if (
      conditions.memory_usage &&
      metrics.memory_usage >= conditions.memory_usage
    )
      return true;
    if (
      conditions.response_time &&
      metrics.response_time >= conditions.response_time
    )
      return true;
    if (conditions.error_rate && metrics.error_rate >= conditions.error_rate)
      return true;
    if (
      conditions.request_rate &&
      metrics.request_rate >= conditions.request_rate
    )
      return true;
    if (conditions.queue_depth && metrics.queue_depth >= conditions.queue_depth)
      return true;
    if (
      conditions.active_connections &&
      metrics.active_connections >= conditions.active_connections
    )
      return true;
    if (
      conditions.database_connections &&
      metrics.database_connections >= conditions.database_connections
    )
      return true;
    if (
      conditions.cache_hit_rate &&
      metrics.cache_hit_rate <= conditions.cache_hit_rate
    )
      return true;

    return false;
  }

  /**
   * Determine if we should escalate to a given phase
   */
  private shouldEscalateToPhase(phase: ThrottlingPhase): boolean {
    const phaseOrder: Record<ThrottlingPhase, number> = {
      normal: 0,
      warning: 1,
      caution: 2,
      critical: 3,
      emergency: 4,
    };

    const currentOrder = phaseOrder[this.currentPhase];
    const targetOrder = phaseOrder[phase];

    return targetOrder > currentOrder;
  }

  /**
   * Escalate to a new throttling phase
   */
  private escalateToPhase(threshold: ThrottlingThreshold): void {
    const previousPhase = this.currentPhase;

    this.currentPhase = threshold.phase;
    this.currentAction = threshold.action;
    this.currentThrottlingFactor = threshold.throttling_factor;
    this.phaseStartTime = Date.now();
    this.lastEscalation = Date.now();

    this.eventEmitter.emit('throttling.escalation', {
      from: previousPhase,
      to: threshold.phase,
      action: threshold.action,
      throttling_factor: threshold.throttling_factor,
      timestamp: Date.now(),
    });

    this.logger.warn(`Throttling escalated to ${threshold.phase} phase`, {
      previousPhase,
      newPhase: threshold.phase,
      action: threshold.action,
      throttlingFactor: threshold.throttling_factor,
    });
  }

  /**
   * Check if we should recover to normal operation
   */
  private shouldRecoverToNormal(metrics: ThrottlingMetrics): boolean {
    if (this.currentPhase === 'normal') return false;

    // Check if all metrics are below recovery thresholds
    const normalThreshold = this.thresholds.find((t) => t.phase === 'warning');
    if (!normalThreshold) return true;

    // Apply recovery factor (make thresholds easier to meet)
    const recoveryConditions = { ...normalThreshold.conditions };
    Object.keys(recoveryConditions).forEach((key) => {
      const value = recoveryConditions[key as keyof typeof recoveryConditions];
      if (typeof value === 'number') {
        recoveryConditions[key as keyof typeof recoveryConditions] =
          value * this.config.recovery_factor;
      }
    });

    return !this.meetsThresholdConditions(metrics, {
      ...normalThreshold,
      conditions: recoveryConditions,
    });
  }

  /**
   * Recover to normal operation
   */
  private recoverToNormal(): void {
    const previousPhase = this.currentPhase;

    this.currentPhase = 'normal';
    this.currentAction = 'monitor';
    this.currentThrottlingFactor = 1.0;
    this.phaseStartTime = Date.now();

    this.eventEmitter.emit('throttling.recovery', {
      from: previousPhase,
      to: 'normal',
      timestamp: Date.now(),
    });

    this.logger.log(
      `Throttling recovered to normal operation from ${previousPhase}`,
    );
  }

  /**
   * Determine if request should be allowed (deterministic: no Math.random)
   */
  private shouldAllowRequestDeterministic(
    throttlingFactor: number,
    requestContext?: { userId?: string; priority?: string; endpoint?: string },
  ): boolean {
    if (requestContext?.priority === 'critical') return true;
    if (requestContext?.priority === 'high' && throttlingFactor > 0.3)
      return true;

    // Deterministic: allow if factor is 1, else use a stable hash of request identity
    if (throttlingFactor >= 1.0) return true;
    if (throttlingFactor <= 0) return false;

    const seed =
      (requestContext?.userId ?? '') +
      (requestContext?.endpoint ?? '') +
      String(Math.floor(Date.now() / 1000)); // per-second bucket
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash = hash & hash;
    }
    const slot = Math.abs(hash % 100) / 100;
    return slot < throttlingFactor;
  }

  /**
   * Determine if request should be allowed based on threshold and context (legacy name, delegates to deterministic)
   */
  private shouldAllowRequest(
    threshold: ThrottlingThreshold,
    requestContext?: any,
  ): boolean {
    return this.shouldAllowRequestDeterministic(
      threshold.throttling_factor,
      requestContext,
    );
  }

  /**
   * Calculate delay for throttled requests
   */
  private calculateDelay(threshold: ThrottlingThreshold): number {
    if (threshold.throttling_factor >= 1.0) return 0;

    // Exponential backoff based on how restrictive the throttling is
    const baseDelay = 1000; // 1 second base
    const throttlingSeverity = 1.0 - threshold.throttling_factor;
    const delay = baseDelay * Math.pow(2, throttlingSeverity * 3);

    return Math.min(delay, 30000); // Max 30 seconds
  }

  /**
   * Calculate retry-after time
   */
  private calculateRetryAfter(threshold: ThrottlingThreshold): number {
    const now = Date.now();
    const phaseEndTime = this.phaseStartTime + threshold.duration;
    return Math.ceil((phaseEndTime - now) / 1000); // seconds
  }

  /**
   * Get warning message for current phase
   */
  private getThresholdMessage(phase: ThrottlingPhase): string | undefined {
    const threshold = this.thresholds.find((t) => t.phase === phase);
    return threshold?.warning_message;
  }

  /**
   * Record throttling decision for analytics
   */
  private recordDecision(decision: ThrottlingDecision): void {
    // Add metrics to history
    this.metricsHistory.push(decision.metrics);

    // Maintain history size limit
    if (this.metricsHistory.length > this.MAX_HISTORY_SIZE) {
      this.metricsHistory.shift();
    }
  }

  /**
   * Start monitoring and threshold checking
   */
  private startMonitoring(): void {
    if (!this.config.enable_preemptive_throttling) return;

    // Collect metrics every 10 seconds
    this.metricsInterval = setInterval(async () => {
      try {
        const metrics = await this.getCurrentMetrics();
        this.metricsHistory.push(metrics);

        if (this.metricsHistory.length > this.MAX_HISTORY_SIZE) {
          this.metricsHistory.shift();
        }
      } catch (error) {
        this.logger.error('Failed to collect metrics', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, 10000);

    // Check thresholds every 30 seconds
    this.thresholdCheckInterval = setInterval(async () => {
      try {
        await this.checkThresholds();
      } catch (error) {
        this.logger.error('Failed to check thresholds', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, 30000);

    this.logger.log('Preemptive throttling monitoring started');
  }

  /**
   * Stop monitoring
   */
  private stopMonitoring(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    if (this.thresholdCheckInterval) {
      clearInterval(this.thresholdCheckInterval);
    }

    this.logger.log('Preemptive throttling monitoring stopped');
  }

  /**
   * Check thresholds and potentially escalate
   */
  private async checkThresholds(): Promise<void> {
    const currentMetrics = await this.getCurrentMetrics();

    // Check if we need to escalate
    for (const threshold of this.thresholds) {
      if (this.meetsThresholdConditions(currentMetrics, threshold)) {
        if (this.shouldEscalateToPhase(threshold.phase)) {
          this.escalateToPhase(threshold);
          break; // Only escalate to the most severe threshold met
        }
      }
    }

    // Check for recovery
    if (
      this.currentPhase !== 'normal' &&
      this.shouldRecoverToNormal(currentMetrics)
    ) {
      this.recoverToNormal();
    }

    // Check for maximum throttling duration
    if (this.currentPhase !== 'normal') {
      const timeInPhase = Date.now() - this.phaseStartTime;
      if (timeInPhase > this.config.max_throttling_duration) {
        this.logger.warn(
          `Maximum throttling duration exceeded for phase ${this.currentPhase}, recovering to normal`,
        );
        this.recoverToNormal();
      }
    }
  }

  /**
   * Get current throttling status
   */
  getStatus(): {
    current_phase: ThrottlingPhase;
    current_action: ThrottlingAction;
    throttling_factor: number;
    phase_start_time: number;
    last_escalation: number;
    config: PreemptiveConfig;
    recent_metrics: ThrottlingMetrics[];
  } {
    return {
      current_phase: this.currentPhase,
      current_action: this.currentAction,
      throttling_factor: this.currentThrottlingFactor,
      phase_start_time: this.phaseStartTime,
      last_escalation: this.lastEscalation,
      config: this.config,
      recent_metrics: this.metricsHistory.slice(-10), // Last 10 metrics
    };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<PreemptiveConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.log('Preemptive throttling configuration updated');
  }

  /**
   * Manually reset to normal operation
   */
  reset(): void {
    this.currentPhase = 'normal';
    this.currentAction = 'monitor';
    this.currentThrottlingFactor = 1.0;
    this.phaseStartTime = Date.now();
    this.lastEscalation = 0;

    this.eventEmitter.emit('throttling.reset', { timestamp: Date.now() });
    this.logger.log('Throttling manually reset to normal operation');
  }

  /**
   * Get throttling statistics
   */
  getStatistics(): {
    total_escalations: number;
    current_phase_duration: number;
    phase_transition_history: Array<{
      from: ThrottlingPhase;
      to: ThrottlingPhase;
      timestamp: number;
    }>;
    average_throttling_factor: number;
    peak_request_rate: number;
  } {
    // This would track more detailed statistics
    const currentPhaseDuration = Date.now() - this.phaseStartTime;
    const averageThrottlingFactor =
      this.metricsHistory.length > 0
        ? this.metricsHistory.reduce((sum, m) => sum + 1, 0) /
          this.metricsHistory.length // Simplified
        : 1.0;

    const peakRequestRate = Math.max(
      ...this.metricsHistory.map((m) => m.request_rate),
      0,
    );

    return {
      total_escalations: 0, // Would track this
      current_phase_duration: currentPhaseDuration,
      phase_transition_history: [], // Would track this
      average_throttling_factor: averageThrottlingFactor,
      peak_request_rate: peakRequestRate,
    };
  }
}
