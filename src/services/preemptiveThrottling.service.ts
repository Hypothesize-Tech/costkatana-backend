import { loggingService } from './logging.service';
import { cacheService } from './cache.service';
import { adaptiveRateLimitService } from './adaptiveRateLimit.service';
// import { gracefulDegradationService } from './gracefulDegradation.service'; // Removed unused import
import { EventEmitter } from 'events';

/**
 * Pre-emptive Throttling Service
 * Implements early warning systems and gradual throttling before hitting hard limits
 */

export type ThrottlingPhase = 'normal' | 'warning' | 'caution' | 'critical' | 'emergency';
export type ThrottlingAction = 'monitor' | 'warn' | 'limit' | 'throttle' | 'block';

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

export class PreemptiveThrottlingService extends EventEmitter {
    private static instance: PreemptiveThrottlingService;
    
    private currentPhase: ThrottlingPhase = 'normal';
    private currentAction: ThrottlingAction = 'monitor';
    private currentThrottlingFactor = 1.0;
    private phaseStartTime = Date.now();
    private lastEscalation = 0;
    
    // Metrics tracking
    private metricsHistory: ThrottlingMetrics[] = [];
    private readonly MAX_HISTORY_SIZE = 1000;
    
    // Configuration
    private config: PreemptiveConfig = {
        enable_preemptive_throttling: true,
        prediction_window: 300, // 5 minutes
        smoothing_factor: 0.3,
        min_samples: 10,
        escalation_cooldown: 30000, // 30 seconds
        recovery_factor: 0.8, // 20% buffer for recovery
        max_throttling_duration: 1800000 // 30 minutes
    };
    
    // Throttling thresholds (ordered by severity)
    private thresholds: ThrottlingThreshold[] = [
        {
            phase: 'warning',
            action: 'warn',
            conditions: {
                cpu_usage: 60,
                memory_usage: 70,
                response_time: 3000,
                error_rate: 2,
                request_rate: 500,
                queue_depth: 100
            },
            throttling_factor: 0.95, // 5% reduction
            warning_message: 'System approaching capacity limits',
            duration: 60000, // 1 minute
            escalation_delay: 120000 // 2 minutes
        },
        {
            phase: 'caution',
            action: 'limit',
            conditions: {
                cpu_usage: 70,
                memory_usage: 80,
                response_time: 5000,
                error_rate: 5,
                request_rate: 750,
                queue_depth: 200
            },
            throttling_factor: 0.85, // 15% reduction
            warning_message: 'System under moderate load - implementing gradual throttling',
            duration: 120000, // 2 minutes
            escalation_delay: 180000 // 3 minutes
        },
        {
            phase: 'critical',
            action: 'throttle',
            conditions: {
                cpu_usage: 80,
                memory_usage: 90,
                response_time: 10000,
                error_rate: 10,
                request_rate: 1000,
                queue_depth: 500
            },
            throttling_factor: 0.6, // 40% reduction
            warning_message: 'System under high load - significant throttling in effect',
            duration: 300000, // 5 minutes
            escalation_delay: 300000 // 5 minutes
        },
        {
            phase: 'emergency',
            action: 'block',
            conditions: {
                cpu_usage: 95,
                memory_usage: 98,
                response_time: 20000,
                error_rate: 25,
                request_rate: 1500,
                queue_depth: 1000
            },
            throttling_factor: 0.1, // 90% reduction
            warning_message: 'System in emergency state - severe throttling active',
            duration: 600000, // 10 minutes
            escalation_delay: 600000 // 10 minutes
        }
    ];
    
    // Monitoring
    private monitoringInterval?: NodeJS.Timeout;
    private readonly MONITORING_INTERVAL = 5000; // 5 seconds
    
    // Statistics
    private stats = {
        total_requests: 0,
        throttled_requests: 0,
        blocked_requests: 0,
        warnings_issued: 0,
        phase_changes: 0,
        average_throttling_factor: 1.0,
        uptime: Date.now()
    };

    private constructor() {
        super();
        this.startMonitoring();
    }

    public static getInstance(): PreemptiveThrottlingService {
        if (!PreemptiveThrottlingService.instance) {
            PreemptiveThrottlingService.instance = new PreemptiveThrottlingService();
        }
        return PreemptiveThrottlingService.instance;
    }

    /**
     * Check if request should be throttled
     */
    public async checkThrottling(
        requestMetadata: {
            endpoint?: string;
            priority?: 'high' | 'medium' | 'low';
            user_tier?: 'premium' | 'standard' | 'free';
            estimated_cost?: number;
        } = {}
    ): Promise<ThrottlingDecision> {
        const startTime = Date.now();
        
        try {
            // Update current metrics
            const metrics = await this.getCurrentMetrics();
            
            // Update phase based on current conditions
            await this.updateThrottlingPhase(metrics);
            
            // Make throttling decision
            const decision = this.makeThrottlingDecision(metrics, requestMetadata);
            
            // Update statistics
            this.updateStats(decision);
            
            // Log significant decisions
            if (decision.action !== 'monitor') {
                loggingService.info('Pre-emptive throttling decision', {
                    component: 'PreemptiveThrottlingService',
                    phase: decision.phase,
                    action: decision.action,
                    allowed: decision.allowed,
                    throttling_factor: decision.throttling_factor,
                    delay_ms: decision.delay_ms,
                    reasons: decision.reasons,
                    endpoint: requestMetadata.endpoint,
                    priority: requestMetadata.priority
                });
            }
            
            return decision;
            
        } catch (error) {
            loggingService.error('Pre-emptive throttling check failed', {
                component: 'PreemptiveThrottlingService',
                error: error instanceof Error ? error.message : String(error),
                duration: Date.now() - startTime
            });
            
            // Return safe fallback decision
            return {
                allowed: true,
                phase: this.currentPhase,
                action: 'monitor',
                throttling_factor: 1.0,
                delay_ms: 0,
                metrics: await this.getCurrentMetrics(),
                reasons: ['Error in throttling check - allowing request']
            };
        }
    }

    /**
     * Make throttling decision based on current state and request metadata
     */
    private makeThrottlingDecision(
        metrics: ThrottlingMetrics,
        requestMetadata: any
    ): ThrottlingDecision {
        const reasons: string[] = [];
        let allowed = true;
        let delay_ms = 0;
        let retry_after: number | undefined;

        // Base decision on current phase
        const currentThreshold = this.thresholds.find(t => t.phase === this.currentPhase);
        let throttling_factor = this.currentThrottlingFactor;
        const action = this.currentAction;

        if (currentThreshold) {
            // Apply throttling based on current phase
            if (this.currentAction === 'block') {
                // Emergency blocking - only allow high priority requests
                if (requestMetadata.priority !== 'high' && requestMetadata.user_tier !== 'premium') {
                    allowed = false;
                    retry_after = Math.ceil(currentThreshold.duration / 1000);
                    reasons.push(`Emergency blocking active - phase: ${this.currentPhase}`);
                } else {
                    // Allow high priority but with significant delay
                    delay_ms = 2000; // 2 second delay
                    reasons.push('High priority request allowed during emergency blocking');
                }
            } else if (this.currentAction === 'throttle') {
                // Apply throttling delay
                const baseDelay = this.calculateThrottlingDelay(throttling_factor, requestMetadata);
                delay_ms = baseDelay;
                
                if (baseDelay > 10000) { // If delay > 10s, consider blocking low priority
                    if (requestMetadata.priority === 'low' || requestMetadata.user_tier === 'free') {
                        allowed = false;
                        retry_after = Math.ceil(baseDelay / 1000);
                        reasons.push('Low priority request blocked due to high throttling delay');
                    }
                }
                
                reasons.push(`Throttling active - delay: ${delay_ms}ms`);
            } else if (this.currentAction === 'limit') {
                // Apply rate limiting with gradual delays
                delay_ms = this.calculateGradualDelay(metrics, requestMetadata);
                reasons.push(`Rate limiting active - gradual delay: ${delay_ms}ms`);
            } else if (this.currentAction === 'warn') {
                // Just add warning headers, minimal delay
                delay_ms = Math.floor(Math.random() * 100); // 0-100ms jitter
                reasons.push('Warning phase active - minimal throttling');
            }
        }

        // Adjust based on request priority and user tier
        if (allowed) {
            const priorityAdjustment = this.calculatePriorityAdjustment(requestMetadata);
            delay_ms = Math.floor(delay_ms * priorityAdjustment);
            throttling_factor = Math.min(1.0, throttling_factor + (1 - priorityAdjustment) * 0.1);
        }

        // Predict if we should be more aggressive
        const prediction = this.predictNearTermLoad(metrics);
        if (prediction.should_escalate && !retry_after) {
            delay_ms = Math.floor(delay_ms * 1.5); // 50% more delay
            reasons.push('Predictive throttling applied');
        }

        return {
            allowed,
            phase: this.currentPhase,
            action,
            throttling_factor,
            delay_ms,
            retry_after,
            warning_message: currentThreshold?.warning_message,
            metrics,
            reasons
        };
    }

    /**
     * Update throttling phase based on current metrics
     */
    private async updateThrottlingPhase(metrics: ThrottlingMetrics): Promise<void> {
        const now = Date.now();
        const previousPhase = this.currentPhase;
        
        // Check if we should escalate
        const escalationThreshold = this.findEscalationThreshold(metrics);
        
        if (escalationThreshold) {
            const canEscalate = (now - this.lastEscalation) > this.config.escalation_cooldown;
            
            if (canEscalate && this.getPhaseIndex(escalationThreshold.phase) > this.getPhaseIndex(this.currentPhase)) {
                await this.escalatePhase(escalationThreshold, metrics);
            }
        } else {
            // Check if we can recover to a better phase
            await this.checkPhaseRecovery(metrics);
        }
        
        // Update phase timing
        if (previousPhase !== this.currentPhase) {
            this.phaseStartTime = now;
            this.stats.phase_changes++;
            
            // Emit phase change event
            this.emit('phase_changed', {
                previous: previousPhase,
                current: this.currentPhase,
                metrics,
                timestamp: now
            });
        }
    }

    /**
     * Find threshold that should trigger escalation
     */
    private findEscalationThreshold(metrics: ThrottlingMetrics): ThrottlingThreshold | null {
        // Check thresholds in order of severity
        for (const threshold of this.thresholds) {
            if (this.meetsThresholdConditions(metrics, threshold.conditions)) {
                return threshold;
            }
        }
        return null;
    }

    /**
     * Check if metrics meet threshold conditions
     */
    private meetsThresholdConditions(
        metrics: ThrottlingMetrics,
        conditions: ThrottlingThreshold['conditions']
    ): boolean {
        const checks = [
            { metric: metrics.cpu_usage, threshold: conditions.cpu_usage },
            { metric: metrics.memory_usage, threshold: conditions.memory_usage },
            { metric: metrics.response_time, threshold: conditions.response_time },
            { metric: metrics.error_rate, threshold: conditions.error_rate },
            { metric: metrics.request_rate, threshold: conditions.request_rate },
            { metric: metrics.queue_depth, threshold: conditions.queue_depth },
            { metric: metrics.active_connections, threshold: conditions.active_connections },
            { metric: metrics.database_connections, threshold: conditions.database_connections }
        ];
        
        // Special case for cache hit rate (lower is worse)
        if (conditions.cache_hit_rate !== undefined) {
            checks.push({ 
                metric: 100 - metrics.cache_hit_rate, 
                threshold: 100 - conditions.cache_hit_rate 
            });
        }
        
        // Count how many conditions are met
        const metConditions = checks.filter(check => 
            check.threshold !== undefined && check.metric >= check.threshold
        ).length;
        
        const totalConditions = Object.keys(conditions).length;
        
        // Need at least 50% of conditions to be met
        return metConditions >= Math.ceil(totalConditions * 0.5);
    }

    /**
     * Escalate to higher throttling phase
     */
    private async escalatePhase(threshold: ThrottlingThreshold, metrics: ThrottlingMetrics): Promise<void> {
        const previousPhase = this.currentPhase;
        
        this.currentPhase = threshold.phase;
        this.currentAction = threshold.action;
        this.currentThrottlingFactor = threshold.throttling_factor;
        this.lastEscalation = Date.now();
        
        // Cache the current state
        await this.cacheThrottlingState();
        
        loggingService.warn('Pre-emptive throttling phase escalated', {
            component: 'PreemptiveThrottlingService',
            previous_phase: previousPhase,
            new_phase: this.currentPhase,
            action: this.currentAction,
            throttling_factor: this.currentThrottlingFactor,
            metrics: {
                cpu: metrics.cpu_usage,
                memory: metrics.memory_usage,
                response_time: metrics.response_time,
                error_rate: metrics.error_rate
            }
        });
    }

    /**
     * Check if we can recover to a better phase
     */
    private async checkPhaseRecovery(metrics: ThrottlingMetrics): Promise<void> {
        if (this.currentPhase === 'normal') return;
        
        const now = Date.now();
        const currentThreshold = this.thresholds.find(t => t.phase === this.currentPhase);
        
        if (!currentThreshold) return;
        
        // Check if we've been in this phase long enough
        const phaseMinDuration = currentThreshold.duration;
        const timeInPhase = now - this.phaseStartTime;
        
        if (timeInPhase < phaseMinDuration) return;
        
        // Check if conditions have improved enough for recovery
        const recoveryConditions = this.calculateRecoveryConditions(currentThreshold.conditions);
        
        if (!this.meetsThresholdConditions(metrics, recoveryConditions)) {
            // Can recover - find appropriate phase
            const targetPhase = this.findRecoveryPhase(metrics);
            
            if (this.getPhaseIndex(targetPhase) < this.getPhaseIndex(this.currentPhase)) {
                await this.recoverToPhase(targetPhase, metrics);
            }
        }
    }

    /**
     * Calculate recovery conditions (more lenient than escalation conditions)
     */
    private calculateRecoveryConditions(conditions: ThrottlingThreshold['conditions']): ThrottlingThreshold['conditions'] {
        const recovery: ThrottlingThreshold['conditions'] = {};
        
        Object.entries(conditions).forEach(([key, value]) => {
            if (value !== undefined) {
                if (key === 'cache_hit_rate') {
                    // For cache hit rate, recovery means higher hit rate
                    recovery[key as keyof ThrottlingThreshold['conditions']] = value + (100 - value) * (1 - this.config.recovery_factor);
                } else {
                    // For other metrics, recovery means lower values
                    recovery[key as keyof ThrottlingThreshold['conditions']] = value * this.config.recovery_factor;
                }
            }
        });
        
        return recovery;
    }

    /**
     * Find appropriate recovery phase
     */
    private findRecoveryPhase(metrics: ThrottlingMetrics): ThrottlingPhase {
        // Check phases in reverse order (from least severe to most severe)
        const phases: ThrottlingPhase[] = ['normal', 'warning', 'caution', 'critical', 'emergency'];
        
        for (const phase of phases) {
            if (phase === 'normal') {
                // Check if we can go back to normal
                const hasAnyEscalationConditions = this.thresholds.some(threshold =>
                    this.meetsThresholdConditions(metrics, threshold.conditions)
                );
                
                if (!hasAnyEscalationConditions) {
                    return 'normal';
                }
            } else {
                const threshold = this.thresholds.find(t => t.phase === phase);
                if (threshold && !this.meetsThresholdConditions(metrics, threshold.conditions)) {
                    return phase;
                }
            }
        }
        
        return this.currentPhase; // Stay in current phase if no recovery possible
    }

    /**
     * Recover to better phase
     */
    private async recoverToPhase(targetPhase: ThrottlingPhase, metrics: ThrottlingMetrics): Promise<void> {
        const previousPhase = this.currentPhase;
        
        this.currentPhase = targetPhase;
        
        if (targetPhase === 'normal') {
            this.currentAction = 'monitor';
            this.currentThrottlingFactor = 1.0;
        } else {
            const threshold = this.thresholds.find(t => t.phase === targetPhase);
            if (threshold) {
                this.currentAction = threshold.action;
                this.currentThrottlingFactor = threshold.throttling_factor;
            }
        }
        
        // Cache the current state
        await this.cacheThrottlingState();
        
        loggingService.info('Pre-emptive throttling phase recovered', {
            component: 'PreemptiveThrottlingService',
            previous_phase: previousPhase,
            new_phase: this.currentPhase,
            action: this.currentAction,
            throttling_factor: this.currentThrottlingFactor,
            metrics: {
                cpu: metrics.cpu_usage,
                memory: metrics.memory_usage,
                response_time: metrics.response_time,
                error_rate: metrics.error_rate
            }
        });
    }

    /**
     * Calculate throttling delay based on current factor and request metadata
     */
    private calculateThrottlingDelay(throttlingFactor: number, requestMetadata: any): number {
        // Base delay calculation
        const baseDelay = (1 - throttlingFactor) * 5000; // Up to 5 seconds base delay
        
        // Add jitter to prevent thundering herd
        const jitter = Math.random() * 1000; // 0-1 second jitter
        
        // Adjust for request priority
        const priorityMultiplier = this.calculatePriorityAdjustment(requestMetadata);
        
        return Math.floor((baseDelay + jitter) * priorityMultiplier);
    }

    /**
     * Calculate gradual delay for rate limiting
     */
    private calculateGradualDelay(metrics: ThrottlingMetrics, requestMetadata: any): number {
        // Gradual delay based on current load
        const loadFactor = (metrics.cpu_usage + metrics.memory_usage) / 200; // 0-1 scale
        const responseTimeFactor = Math.min(metrics.response_time / 10000, 1); // 0-1 scale
        
        const baseDelay = (loadFactor * 0.7 + responseTimeFactor * 0.3) * 2000; // Up to 2 seconds
        
        // Add small random component
        const jitter = Math.random() * 200; // 0-200ms jitter
        
        const priorityMultiplier = this.calculatePriorityAdjustment(requestMetadata);
        
        return Math.floor((baseDelay + jitter) * priorityMultiplier);
    }

    /**
     * Calculate priority adjustment factor
     */
    private calculatePriorityAdjustment(requestMetadata: any): number {
        let factor = 1.0;
        
        // Priority adjustment
        if (requestMetadata.priority === 'high') {
            factor *= 0.5; // 50% less delay
        } else if (requestMetadata.priority === 'low') {
            factor *= 1.5; // 50% more delay
        }
        
        // User tier adjustment
        if (requestMetadata.user_tier === 'premium') {
            factor *= 0.7; // 30% less delay
        } else if (requestMetadata.user_tier === 'free') {
            factor *= 1.3; // 30% more delay
        }
        
        // Cost-based adjustment
        if (requestMetadata.estimated_cost) {
            if (requestMetadata.estimated_cost > 1.0) {
                factor *= 1.2; // 20% more delay for expensive requests
            } else if (requestMetadata.estimated_cost < 0.1) {
                factor *= 0.9; // 10% less delay for cheap requests
            }
        }
        
        return Math.max(0.1, Math.min(2.0, factor)); // Clamp between 0.1 and 2.0
    }

    /**
     * Predict near-term load and determine if escalation is needed
     */
    private predictNearTermLoad(currentMetrics: ThrottlingMetrics): { should_escalate: boolean; confidence: number } {
        if (this.metricsHistory.length < this.config.min_samples) {
            return { should_escalate: false, confidence: 0 };
        }
        
        // Simple trend analysis
        const recentHistory = this.metricsHistory.slice(-this.config.min_samples);
        const trends = this.calculateTrends(recentHistory);
        
        // Predict metrics for next period
        const prediction = this.predictNextMetrics(currentMetrics, trends);
        
        // Check if predicted metrics would trigger escalation
        const wouldEscalate = this.thresholds.some(threshold => 
            this.getPhaseIndex(threshold.phase) > this.getPhaseIndex(this.currentPhase) &&
            this.meetsThresholdConditions(prediction, threshold.conditions)
        );
        
        // Calculate confidence based on trend stability
        const confidence = this.calculatePredictionConfidence(trends);
        
        return { 
            should_escalate: wouldEscalate && confidence > 0.7, 
            confidence 
        };
    }

    /**
     * Calculate trends for key metrics
     */
    private calculateTrends(history: ThrottlingMetrics[]): Record<string, number> {
        const trends: Record<string, number> = {};
        const metrics = ['cpu_usage', 'memory_usage', 'response_time', 'error_rate', 'request_rate'];
        
        for (const metric of metrics) {
            const values = history.map(h => (h as any)[metric]);
            const trend = this.calculateLinearTrend(values);
            trends[metric] = trend;
        }
        
        return trends;
    }

    /**
     * Calculate linear trend for a series of values
     */
    private calculateLinearTrend(values: number[]): number {
        if (values.length < 2) return 0;
        
        const n = values.length;
        const sumX = n * (n - 1) / 2; // 0 + 1 + 2 + ... + (n-1)
        const sumY = values.reduce((sum, val) => sum + val, 0);
        const sumXY = values.reduce((sum, val, index) => sum + index * val, 0);
        const sumX2 = n * (n - 1) * (2 * n - 1) / 6; // 0² + 1² + 2² + ... + (n-1)²
        
        // Linear regression slope
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        
        return slope || 0;
    }

    /**
     * Predict next metrics based on current values and trends
     */
    private predictNextMetrics(current: ThrottlingMetrics, trends: Record<string, number>): ThrottlingMetrics {
        const prediction: ThrottlingMetrics = { ...current };
        
        // Apply trends to predict next values
        Object.entries(trends).forEach(([metric, trend]) => {
            const currentValue = (current as any)[metric];
            const predictedValue = currentValue + trend * this.config.prediction_window;
            (prediction as any)[metric] = Math.max(0, predictedValue);
        });
        
        return prediction;
    }

    /**
     * Calculate prediction confidence based on trend stability
     */
    private calculatePredictionConfidence(trends: Record<string, number>): number {
        const trendMagnitudes = Object.values(trends).map(Math.abs);
        const avgMagnitude = trendMagnitudes.reduce((sum, mag) => sum + mag, 0) / trendMagnitudes.length;
        
        // Lower magnitude trends are more reliable for prediction
        const confidence = Math.max(0, 1 - avgMagnitude / 10);
        
        return confidence;
    }

    /**
     * Get current system metrics
     */
    private async getCurrentMetrics(): Promise<ThrottlingMetrics> {
        try {
            // Get metrics from adaptive rate limiting service
            const adaptiveStats = await adaptiveRateLimitService.getStatistics();
            
            // Get additional metrics from cache
            const queueStats = await cacheService.get('request_prioritization_stats') || {};
            const dbStats = await cacheService.get('database_stats') || {};
            const cacheStats = await cacheService.get('cache_stats') || {};
            
            const metrics: ThrottlingMetrics = {
                cpu_usage: adaptiveStats.systemLoad.cpuUsage,
                memory_usage: adaptiveStats.systemLoad.memoryUsage,
                response_time: adaptiveStats.systemLoad.responseTime,
                error_rate: adaptiveStats.systemLoad.errorRate,
                request_rate: this.calculateCurrentRequestRate(),
                queue_depth: (queueStats as any).total || 0,
                active_connections: adaptiveStats.systemLoad.activeConnections,
                database_connections: (dbStats as any).active_connections || 0,
                cache_hit_rate: (cacheStats as any).hit_rate || 100,
                timestamp: Date.now()
            };
            
            // Add to history
            this.metricsHistory.push(metrics);
            if (this.metricsHistory.length > this.MAX_HISTORY_SIZE) {
                this.metricsHistory = this.metricsHistory.slice(-this.MAX_HISTORY_SIZE);
            }
            
            return metrics;
            
        } catch (error) {
            loggingService.debug('Failed to get current metrics', {
                component: 'PreemptiveThrottlingService',
                error: error instanceof Error ? error.message : String(error)
            });
            
            // Return default metrics
            return {
                cpu_usage: 0,
                memory_usage: 0,
                response_time: 0,
                error_rate: 0,
                request_rate: 0,
                queue_depth: 0,
                active_connections: 0,
                database_connections: 0,
                cache_hit_rate: 100,
                timestamp: Date.now()
            };
        }
    }

    /**
     * Calculate current request rate
     */
    private calculateCurrentRequestRate(): number {
        if (this.metricsHistory.length < 2) return 0;
        
        const recent = this.metricsHistory.slice(-5); // Last 5 samples
        const timeSpan = recent[recent.length - 1].timestamp - recent[0].timestamp;
        
        if (timeSpan === 0) return 0;
        
        // Estimate requests per second based on recent activity
        return (this.stats.total_requests / (timeSpan / 1000)) || 0;
    }

    /**
     * Update statistics
     */
    private updateStats(decision: ThrottlingDecision): void {
        this.stats.total_requests++;
        
        if (!decision.allowed) {
            this.stats.blocked_requests++;
        } else if (decision.delay_ms > 0) {
            this.stats.throttled_requests++;
        }
        
        if (decision.warning_message) {
            this.stats.warnings_issued++;
        }
        
        // Update average throttling factor
        const total = this.stats.total_requests;
        this.stats.average_throttling_factor = 
            ((this.stats.average_throttling_factor * (total - 1)) + decision.throttling_factor) / total;
    }

    /**
     * Cache current throttling state
     */
    private async cacheThrottlingState(): Promise<void> {
        try {
            const state = {
                phase: this.currentPhase,
                action: this.currentAction,
                throttling_factor: this.currentThrottlingFactor,
                phase_start_time: this.phaseStartTime,
                last_escalation: this.lastEscalation,
                timestamp: Date.now()
            };
            
            await cacheService.set('preemptive_throttling_state', state, 300); // 5 minutes TTL
        } catch (error) {
            loggingService.debug('Failed to cache throttling state', {
                component: 'PreemptiveThrottlingService',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Start monitoring loop
     */
    private startMonitoring(): void {
        this.monitoringInterval = setInterval(async () => {
            try {
                const metrics = await this.getCurrentMetrics();
                await this.updateThrottlingPhase(metrics);
                
                // Emit metrics event
                this.emit('metrics_updated', {
                    metrics,
                    phase: this.currentPhase,
                    action: this.currentAction,
                    throttling_factor: this.currentThrottlingFactor
                });
                
            } catch (error) {
                loggingService.error('Error in preemptive throttling monitoring', {
                    component: 'PreemptiveThrottlingService',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }, this.MONITORING_INTERVAL);
    }

    /**
     * Get phase index for comparison
     */
    private getPhaseIndex(phase: ThrottlingPhase): number {
        const phases: ThrottlingPhase[] = ['normal', 'warning', 'caution', 'critical', 'emergency'];
        return phases.indexOf(phase);
    }

    /**
     * Get current status
     */
    public getStatus(): {
        phase: ThrottlingPhase;
        action: ThrottlingAction;
        throttling_factor: number;
        phase_duration: number;
        stats: {
            total_requests: number;
            throttled_requests: number;
            blocked_requests: number;
            warnings_issued: number;
            phase_changes: number;
            average_throttling_factor: number;
            uptime: number;
        };
        recent_metrics: ThrottlingMetrics[];
    } {
        const now = Date.now();
        
        return {
            phase: this.currentPhase,
            action: this.currentAction,
            throttling_factor: this.currentThrottlingFactor,
            phase_duration: now - this.phaseStartTime,
            stats: { ...this.stats, uptime: now - this.stats.uptime },
            recent_metrics: this.metricsHistory.slice(-10)
        };
    }

    /**
     * Update configuration
     */
    public updateConfig(newConfig: Partial<PreemptiveConfig>): void {
        this.config = { ...this.config, ...newConfig };
        
        loggingService.info('Preemptive throttling configuration updated', {
            component: 'PreemptiveThrottlingService',
            config: this.config
        });
    }

    /**
     * Force phase change (for testing/emergency)
     */
    public async forcePhaseChange(phase: ThrottlingPhase, reason: string = 'Manual override'): Promise<void> {
        const previousPhase = this.currentPhase;
        
        this.currentPhase = phase;
        this.phaseStartTime = Date.now();
        
        if (phase === 'normal') {
            this.currentAction = 'monitor';
            this.currentThrottlingFactor = 1.0;
        } else {
            const threshold = this.thresholds.find(t => t.phase === phase);
            if (threshold) {
                this.currentAction = threshold.action;
                this.currentThrottlingFactor = threshold.throttling_factor;
            }
        }
        
        await this.cacheThrottlingState();
        
        loggingService.warn('Preemptive throttling phase manually changed', {
            component: 'PreemptiveThrottlingService',
            previous_phase: previousPhase,
            new_phase: phase,
            reason
        });
        
        this.emit('phase_forced', {
            previous: previousPhase,
            current: phase,
            reason,
            timestamp: Date.now()
        });
    }

    /**
     * Cleanup resources
     */
    public cleanup(): void {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = undefined;
        }
        
        this.removeAllListeners();
        this.metricsHistory = [];
    }
}

// Export singleton instance
export const preemptiveThrottlingService = PreemptiveThrottlingService.getInstance();
