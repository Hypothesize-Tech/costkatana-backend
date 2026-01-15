import { loggingService } from './logging.service';
import { cacheService } from './cache.service';
import { adaptiveRateLimitService } from './adaptiveRateLimit.service';
import { requestPrioritizationService } from './requestPrioritization.service';
import { gracefulDegradationService } from './gracefulDegradation.service';
import { preemptiveThrottlingService } from './preemptiveThrottling.service';
import { trafficPredictionService } from './trafficPrediction.service';
import { servicePrioritizationService } from './servicePrioritization.service';
import { EventEmitter } from 'events';

/**
 * Traffic Management Integration Service
 * Coordinates all traffic management systems for enterprise-scale resilience
 */

export interface TrafficManagementStatus {
    overall_health: 'healthy' | 'warning' | 'degraded' | 'critical' | 'emergency';
    system_load: number; // 0-1
    active_protections: string[];
    current_state: {
        adaptive_rate_limiting: any;
        request_prioritization: any;
        graceful_degradation: any;
        preemptive_throttling: any;
        traffic_prediction: any;
        service_prioritization: any;
    };
    performance_metrics: {
        requests_per_second: number;
        average_response_time: number;
        error_rate: number;
        queue_depth: number;
        cache_hit_rate: number;
        cpu_usage: number;
        memory_usage: number;
    };
    recommendations: string[];
    alerts: Array<{
        level: 'info' | 'warning' | 'error' | 'critical';
        message: string;
        timestamp: number;
        component: string;
    }>;
}

export interface TrafficManagementConfig {
    enable_integration: boolean;
    coordination_interval: number; // seconds
    health_check_interval: number; // seconds
    auto_coordination: boolean;
    alert_thresholds: {
        response_time_warning: number;
        response_time_critical: number;
        error_rate_warning: number;
        error_rate_critical: number;
        system_load_warning: number;
        system_load_critical: number;
    };
    escalation_rules: {
        auto_escalate: boolean;
        escalation_delay: number; // seconds
        max_escalation_level: 'moderate' | 'heavy' | 'severe';
    };
}

export class TrafficManagementService extends EventEmitter {
    private static instance: TrafficManagementService;
    
    private currentStatus: TrafficManagementStatus;
    private coordinationInterval?: NodeJS.Timeout;
    private healthCheckInterval?: NodeJS.Timeout;
    private alertHistory: Array<any> = [];
    private readonly MAX_ALERT_HISTORY = 1000;
    
    // Configuration
    private config: TrafficManagementConfig = {
        enable_integration: true,
        coordination_interval: 15, // 15 seconds
        health_check_interval: 5, // 5 seconds
        auto_coordination: true,
        alert_thresholds: {
            response_time_warning: 2000, // 2 seconds
            response_time_critical: 5000, // 5 seconds
            error_rate_warning: 2, // 2%
            error_rate_critical: 5, // 5%
            system_load_warning: 0.7, // 70%
            system_load_critical: 0.9 // 90%
        },
        escalation_rules: {
            auto_escalate: true,
            escalation_delay: 60, // 1 minute
            max_escalation_level: 'heavy'
        }
    };
    
    // Statistics
    private stats = {
        coordination_cycles: 0,
        auto_escalations: 0,
        manual_interventions: 0,
        total_alerts: 0,
        system_recoveries: 0,
        uptime_start: Date.now()
    };

    private constructor() {
        super();
        this.currentStatus = this.initializeStatus();
        this.startMonitoring();
        this.setupEventListeners();
    }

    public static getInstance(): TrafficManagementService {
        if (!TrafficManagementService.instance) {
            TrafficManagementService.instance = new TrafficManagementService();
        }
        return TrafficManagementService.instance;
    }

    /**
     * Get current traffic management status
     */
    public getStatus(): TrafficManagementStatus {
        return { ...this.currentStatus };
    }

    /**
     * Get comprehensive system statistics
     */
    public getStatistics(): any {
        return {
            ...this.stats,
            uptime: Date.now() - this.stats.uptime_start,
            alert_history_size: this.alertHistory.length,
            current_protections: this.currentStatus.active_protections.length,
            overall_health: this.currentStatus.overall_health,
            system_load: this.currentStatus.system_load
        };
    }

    /**
     * Manually trigger system coordination
     */
    public async triggerCoordination(reason: string = 'Manual trigger'): Promise<void> {
        loggingService.info('Manual traffic management coordination triggered', {
            component: 'TrafficManagementService',
            reason
        });

        this.stats.manual_interventions++;
        await this.performCoordination();
    }

    /**
     * Force system into emergency mode
     */
    public async emergencyMode(reason: string): Promise<void> {
        loggingService.error('Emergency mode activated', {
            component: 'TrafficManagementService',
            reason
        });

        // Immediately apply most aggressive protections
        await Promise.all([
            gracefulDegradationService.setDegradationLevel('emergency', `Emergency mode: ${reason}`),
            preemptiveThrottlingService.forcePhaseChange('emergency', `Emergency mode: ${reason}`),
            servicePrioritizationService.handleOverload('severe', ['Emergency mode activation'])
        ]);

        // Update status
        await this.updateSystemStatus();
        
        // Emit emergency event
        this.emit('emergency_mode_activated', {
            reason,
            timestamp: Date.now(),
            status: this.currentStatus
        });

        this.addAlert('critical', `Emergency mode activated: ${reason}`, 'TrafficManagementService');
    }

    /**
     * Attempt system recovery
     */
    public async attemptRecovery(): Promise<boolean> {
        loggingService.info('Attempting system recovery', {
            component: 'TrafficManagementService',
            current_health: this.currentStatus.overall_health
        });

        try {
            // Attempt recovery in all subsystems
            const recoveryResults = await Promise.allSettled([
                gracefulDegradationService.setDegradationLevel('none', 'Manual recovery attempt'),
                preemptiveThrottlingService.forcePhaseChange('normal', 'Manual recovery attempt'),
                servicePrioritizationService.attemptRecovery()
            ]);

            // Check if any recoveries succeeded
            const successfulRecoveries = recoveryResults.filter(result => result.status === 'fulfilled').length;
            
            if (successfulRecoveries > 0) {
                this.stats.system_recoveries++;
                await this.updateSystemStatus();
                
                loggingService.info('System recovery partially successful', {
                    component: 'TrafficManagementService',
                    successful_recoveries: successfulRecoveries,
                    total_attempts: recoveryResults.length
                });

                this.emit('recovery_attempted', {
                    success: true,
                    successful_recoveries: successfulRecoveries,
                    timestamp: Date.now()
                });

                return true;
            }

            return false;

        } catch (error) {
            loggingService.error('System recovery failed', {
                component: 'TrafficManagementService',
                error: error instanceof Error ? error.message : String(error)
            });

            this.emit('recovery_attempted', {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                timestamp: Date.now()
            });

            return false;
        }
    }

    /**
     * Initialize system status
     */
    private initializeStatus(): TrafficManagementStatus {
        return {
            overall_health: 'healthy',
            system_load: 0,
            active_protections: [],
            current_state: {
                adaptive_rate_limiting: null,
                request_prioritization: null,
                graceful_degradation: null,
                preemptive_throttling: null,
                traffic_prediction: null,
                service_prioritization: null
            },
            performance_metrics: {
                requests_per_second: 0,
                average_response_time: 0,
                error_rate: 0,
                queue_depth: 0,
                cache_hit_rate: 100,
                cpu_usage: 0,
                memory_usage: 0
            },
            recommendations: [],
            alerts: []
        };
    }

    /**
     * Start monitoring and coordination
     */
    private startMonitoring(): void {
        // Health check loop
        this.healthCheckInterval = setInterval(async () => {
            try {
                await this.updateSystemStatus();
                await this.checkAlertConditions();
            } catch (error) {
                loggingService.error('Error in health check', {
                    component: 'TrafficManagementService',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }, this.config.health_check_interval * 1000);

        // Coordination loop
        this.coordinationInterval = setInterval(async () => {
            try {
                if (this.config.auto_coordination) {
                    await this.performCoordination();
                }
            } catch (error) {
                loggingService.error('Error in coordination cycle', {
                    component: 'TrafficManagementService',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }, this.config.coordination_interval * 1000);

        loggingService.info('Traffic management monitoring started', {
            component: 'TrafficManagementService',
            health_check_interval: this.config.health_check_interval,
            coordination_interval: this.config.coordination_interval
        });
    }

    /**
     * Setup event listeners for subsystems
     */
    private setupEventListeners(): void {
        // Listen to degradation service events
        gracefulDegradationService.on('degradation_changed', (event) => {
            this.addAlert('warning', `Degradation level changed to ${event.newLevel}`, 'GracefulDegradation');
        });

        // Listen to throttling service events
        preemptiveThrottlingService.on('phase_changed', (event) => {
            this.addAlert('warning', `Throttling phase changed to ${event.current}`, 'PreemptiveThrottling');
        });

        // Listen to prediction service events
        trafficPredictionService.on('spike_predicted', (prediction) => {
            this.addAlert('warning', `Traffic spike predicted: ${prediction.spike_magnitude}x increase`, 'TrafficPrediction');
        });

        // Listen to prioritization service events
        requestPrioritizationService.on('request_failed', (event) => {
            if (event.error.includes('Queue is full')) {
                this.addAlert('error', 'Request queue is full', 'RequestPrioritization');
            }
        });
    }

    /**
     * Update system status by collecting data from all subsystems
     */
    private async updateSystemStatus(): Promise<void> {
        try {
            // Collect status from all subsystems
            const [
                adaptiveStats,
                prioritizationStats,
                degradationStatus,
                throttlingStatus,
                predictionStats,
                servicePriorizationStatus
            ] = await Promise.all([
                adaptiveRateLimitService.getStatistics(),
                requestPrioritizationService.getDetailedStats(),
                gracefulDegradationService.getStatus(),
                preemptiveThrottlingService.getStatus(),
                trafficPredictionService.getStatistics(),
                servicePrioritizationService.getStatus()
            ]);

            // Update current state
            this.currentStatus.current_state = {
                adaptive_rate_limiting: adaptiveStats,
                request_prioritization: prioritizationStats,
                graceful_degradation: degradationStatus,
                preemptive_throttling: throttlingStatus,
                traffic_prediction: predictionStats,
                service_prioritization: servicePriorizationStatus
            };

            // Update performance metrics
            this.currentStatus.performance_metrics = {
                requests_per_second: adaptiveStats.systemLoad.responseTime || 0,
                average_response_time: adaptiveStats.systemLoad.responseTime || 0,
                error_rate: adaptiveStats.systemLoad.errorRate || 0,
                queue_depth: prioritizationStats.queues?.total || 0,
                cache_hit_rate: 100, // Would come from cache service
                cpu_usage: adaptiveStats.systemLoad.cpuUsage || 0,
                memory_usage: adaptiveStats.systemLoad.memoryUsage || 0
            };

            // Calculate system load
            this.currentStatus.system_load = this.calculateSystemLoad();

            // Determine overall health
            this.currentStatus.overall_health = this.determineOverallHealth();

            // Identify active protections
            this.currentStatus.active_protections = this.identifyActiveProtections();

            // Generate recommendations
            this.currentStatus.recommendations = this.generateRecommendations();

            // Keep recent alerts in status
            this.currentStatus.alerts = this.alertHistory.slice(-10);

            // Cache the status
            await cacheService.set('traffic_management_status', this.currentStatus, 60);

        } catch (error) {
            loggingService.error('Failed to update system status', {
                component: 'TrafficManagementService',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Perform coordination between subsystems
     */
    private async performCoordination(): Promise<void> {
        this.stats.coordination_cycles++;

        try {
            // Check if escalation is needed
            if (this.shouldEscalate()) {
                await this.performEscalation();
            }

            // Check if recovery is possible
            if (this.shouldAttemptRecovery()) {
                await this.attemptRecovery();
            }

            // Coordinate traffic prediction with other systems
            await this.coordinateTrafficPrediction();

            // Ensure service priorities are aligned
            await this.coordinateServicePriorities();

            // Update status after coordination
            await this.updateSystemStatus();

        } catch (error) {
            loggingService.error('Coordination cycle failed', {
                component: 'TrafficManagementService',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Calculate overall system load
     */
    private calculateSystemLoad(): number {
        const metrics = this.currentStatus.performance_metrics;
        
        // Weighted combination of key metrics
        const cpuWeight = 0.3;
        const memoryWeight = 0.3;
        const responseTimeWeight = 0.2;
        const errorRateWeight = 0.2;

        const normalizedResponseTime = Math.min(metrics.average_response_time / 5000, 1); // Normalize to 5s max
        const normalizedErrorRate = Math.min(metrics.error_rate / 10, 1); // Normalize to 10% max

        return (
            (metrics.cpu_usage / 100) * cpuWeight +
            (metrics.memory_usage / 100) * memoryWeight +
            normalizedResponseTime * responseTimeWeight +
            normalizedErrorRate * errorRateWeight
        );
    }

    /**
     * Determine overall system health
     */
    private determineOverallHealth(): 'healthy' | 'warning' | 'degraded' | 'critical' | 'emergency' {
        const systemLoad = this.currentStatus.system_load;
        const metrics = this.currentStatus.performance_metrics;
        
        // Emergency conditions
        if (systemLoad > 0.95 || 
            metrics.error_rate > 20 || 
            metrics.average_response_time > 20000) {
            return 'emergency';
        }
        
        // Critical conditions
        if (systemLoad > this.config.alert_thresholds.system_load_critical ||
            metrics.error_rate > this.config.alert_thresholds.error_rate_critical ||
            metrics.average_response_time > this.config.alert_thresholds.response_time_critical) {
            return 'critical';
        }
        
        // Degraded conditions
        if (this.currentStatus.current_state.graceful_degradation?.level !== 'none' ||
            this.currentStatus.current_state.preemptive_throttling?.phase !== 'normal') {
            return 'degraded';
        }
        
        // Warning conditions
        if (systemLoad > this.config.alert_thresholds.system_load_warning ||
            metrics.error_rate > this.config.alert_thresholds.error_rate_warning ||
            metrics.average_response_time > this.config.alert_thresholds.response_time_warning) {
            return 'warning';
        }
        
        return 'healthy';
    }

    /**
     * Identify active protections
     */
    private identifyActiveProtections(): string[] {
        const protections: string[] = [];
        
        const degradationLevel = this.currentStatus.current_state.graceful_degradation?.level;
        if (degradationLevel && degradationLevel !== 'none') {
            protections.push(`Graceful Degradation (${degradationLevel})`);
        }
        
        const throttlingPhase = this.currentStatus.current_state.preemptive_throttling?.phase;
        if (throttlingPhase && throttlingPhase !== 'normal') {
            protections.push(`Preemptive Throttling (${throttlingPhase})`);
        }
        
        const overloadLevel = this.currentStatus.current_state.service_prioritization?.overload_level;
        if (overloadLevel && overloadLevel !== 'normal') {
            protections.push(`Service Prioritization (${overloadLevel})`);
        }
        
        if (this.currentStatus.current_state.adaptive_rate_limiting?.adaptiveLimits > 0) {
            protections.push('Adaptive Rate Limiting');
        }
        
        if (this.currentStatus.current_state.request_prioritization?.queues?.total > 0) {
            protections.push('Request Prioritization');
        }
        
        return protections;
    }

    /**
     * Generate system recommendations
     */
    private generateRecommendations(): string[] {
        const recommendations: string[] = [];
        const metrics = this.currentStatus.performance_metrics;
        const systemLoad = this.currentStatus.system_load;
        
        if (systemLoad > 0.8) {
            recommendations.push('Consider scaling up system resources');
        }
        
        if (metrics.error_rate > 5) {
            recommendations.push('Investigate and address high error rates');
        }
        
        if (metrics.average_response_time > 3000) {
            recommendations.push('Optimize slow endpoints and database queries');
        }
        
        if (metrics.queue_depth > 500) {
            recommendations.push('Consider increasing queue processing capacity');
        }
        
        if (metrics.cache_hit_rate < 80) {
            recommendations.push('Optimize caching strategy and TTL settings');
        }
        
        if (this.currentStatus.active_protections.length > 2) {
            recommendations.push('Multiple protections active - consider system optimization');
        }
        
        return recommendations;
    }

    /**
     * Check alert conditions
     */
    private async checkAlertConditions(): Promise<void> {
        const metrics = this.currentStatus.performance_metrics;
        const systemLoad = this.currentStatus.system_load;
        
        // Check for new alert conditions
        if (metrics.average_response_time > this.config.alert_thresholds.response_time_critical) {
            this.addAlert('critical', `Response time critical: ${metrics.average_response_time}ms`, 'System');
        } else if (metrics.average_response_time > this.config.alert_thresholds.response_time_warning) {
            this.addAlert('warning', `Response time elevated: ${metrics.average_response_time}ms`, 'System');
        }
        
        if (metrics.error_rate > this.config.alert_thresholds.error_rate_critical) {
            this.addAlert('critical', `Error rate critical: ${metrics.error_rate}%`, 'System');
        } else if (metrics.error_rate > this.config.alert_thresholds.error_rate_warning) {
            this.addAlert('warning', `Error rate elevated: ${metrics.error_rate}%`, 'System');
        }
        
        if (systemLoad > this.config.alert_thresholds.system_load_critical) {
            this.addAlert('critical', `System load critical: ${(systemLoad * 100).toFixed(1)}%`, 'System');
        } else if (systemLoad > this.config.alert_thresholds.system_load_warning) {
            this.addAlert('warning', `System load elevated: ${(systemLoad * 100).toFixed(1)}%`, 'System');
        }
    }

    /**
     * Add alert to history
     */
    private addAlert(level: 'info' | 'warning' | 'error' | 'critical', message: string, component: string): void {
        const alert = {
            level,
            message,
            timestamp: Date.now(),
            component
        };
        
        this.alertHistory.push(alert);
        this.stats.total_alerts++;
        
        // Keep history size manageable
        if (this.alertHistory.length > this.MAX_ALERT_HISTORY) {
            this.alertHistory = this.alertHistory.slice(-this.MAX_ALERT_HISTORY);
        }
        
        // Emit alert event
        this.emit('alert', alert);
        
        // Log based on severity
        if (level === 'critical') {
            loggingService.error(`ALERT: ${message}`, {
                component: 'TrafficManagementService',
                alert_component: component,
                level
            });
        } else if (level === 'error') {
            loggingService.error(`Alert: ${message}`, {
                component: 'TrafficManagementService',
                alert_component: component,
                level
            });
        } else if (level === 'warning') {
            loggingService.warn(`Alert: ${message}`, {
                component: 'TrafficManagementService',
                alert_component: component,
                level
            });
        } else {
            loggingService.info(`Alert: ${message}`, {
                component: 'TrafficManagementService',
                alert_component: component,
                level
            });
        }
    }

    /**
     * Check if should escalate protections
     */
    private shouldEscalate(): boolean {
        if (!this.config.escalation_rules.auto_escalate) {
            return false;
        }
        
        return this.currentStatus.overall_health === 'critical' && 
               this.currentStatus.active_protections.length < 3;
    }

    /**
     * Check if should attempt recovery
     */
    private shouldAttemptRecovery(): boolean {
        return this.currentStatus.overall_health === 'healthy' && 
               this.currentStatus.active_protections.length > 0;
    }

    /**
     * Perform system escalation
     */
    private async performEscalation(): Promise<void> {
        this.stats.auto_escalations++;
        
        loggingService.warn('Auto-escalating system protections', {
            component: 'TrafficManagementService',
            current_health: this.currentStatus.overall_health,
            system_load: this.currentStatus.system_load
        });

        // Escalate based on current state
        const promises: Promise<any>[] = [];
        
        if (this.currentStatus.current_state.graceful_degradation?.level === 'none') {
            promises.push(gracefulDegradationService.setDegradationLevel('minimal', 'Auto-escalation'));
        }
        
        if (this.currentStatus.current_state.preemptive_throttling?.phase === 'normal') {
            promises.push(preemptiveThrottlingService.forcePhaseChange('warning', 'Auto-escalation'));
        }
        
        if (this.currentStatus.current_state.service_prioritization?.overload_level === 'normal') {
            promises.push(servicePrioritizationService.handleOverload('light', ['Auto-escalation']));
        }
        
        await Promise.allSettled(promises);
        
        this.addAlert('warning', 'System protections auto-escalated', 'TrafficManagementService');
    }

    /**
     * Coordinate traffic prediction with other systems
     */
    private async coordinateTrafficPrediction(): Promise<void> {
        const predictions = trafficPredictionService.getCurrentPredictions();
        
        for (const prediction of predictions) {
            if (prediction.spike_probability > 0.8 && prediction.spike_magnitude > 2.0) {
                // Prepare systems for predicted spike
                await this.prepareForTrafficSpike(prediction);
            }
        }
    }

    /**
     * Prepare for predicted traffic spike
     */
    private async prepareForTrafficSpike(prediction: any): Promise<void> {
        loggingService.info('Preparing for predicted traffic spike', {
            component: 'TrafficManagementService',
            spike_probability: prediction.spike_probability,
            spike_magnitude: prediction.spike_magnitude
        });

        const preparationActions = [];
        
        // Pre-emptively enable throttling
        if (prediction.spike_magnitude > 3.0) {
            preparationActions.push(
                preemptiveThrottlingService.forcePhaseChange('caution', 'Predicted traffic spike')
            );
        }
        
        // Enable minimal degradation
        if (prediction.spike_magnitude > 4.0) {
            preparationActions.push(
                gracefulDegradationService.setDegradationLevel('minimal', 'Predicted traffic spike')
            );
        }
        
        await Promise.allSettled(preparationActions);
    }

    /**
     * Coordinate service priorities
     */
    private async coordinateServicePriorities(): Promise<void> {
        // Ensure service priorities align with current system state
        const servicePriorities = servicePrioritizationService.getStatus();
        
        if (servicePriorities.overload_level !== 'normal') {
            // Adjust request prioritization based on service priorities
            // This would involve more sophisticated coordination logic
        }
    }

    /**
     * Update configuration
     */
    public updateConfig(newConfig: Partial<TrafficManagementConfig>): void {
        this.config = { ...this.config, ...newConfig };
        
        loggingService.info('Traffic management configuration updated', {
            component: 'TrafficManagementService',
            config: this.config
        });
    }

    /**
     * Get alert history
     */
    public getAlertHistory(limit: number = 100): any[] {
        return this.alertHistory.slice(-limit);
    }

    /**
     * Clear alert history
     */
    public clearAlertHistory(): void {
        this.alertHistory = [];
        loggingService.info('Alert history cleared', {
            component: 'TrafficManagementService'
        });
    }

    /**
     * Cleanup resources
     */
    public cleanup(): void {
        if (this.coordinationInterval) {
            clearInterval(this.coordinationInterval);
            this.coordinationInterval = undefined;
        }
        
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = undefined;
        }
        
        this.removeAllListeners();
        
        loggingService.info('Traffic management service cleaned up', {
            component: 'TrafficManagementService'
        });
    }
}

// Export singleton instance
export const trafficManagementService = TrafficManagementService.getInstance();
