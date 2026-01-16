import { loggingService } from './logging.service';
import { cacheService } from './cache.service';
import { gracefulDegradationService} from './gracefulDegradation.service';
import { preemptiveThrottlingService} from './preemptiveThrottling.service';
import { EventEmitter } from 'events';

/**
 * Service-Level Prioritization Service
 * Manages service priorities and resource allocation during system overload
 */

export type ServiceTier = 'critical' | 'essential' | 'important' | 'standard' | 'optional';
export type OverloadLevel = 'normal' | 'light' | 'moderate' | 'heavy' | 'severe';
export type ResourceType = 'cpu' | 'memory' | 'network' | 'database' | 'cache' | 'queue';

export interface ServiceDefinition {
    name: string;
    tier: ServiceTier;
    description: string;
    endpoints: string[];
    dependencies: string[];
    resource_requirements: {
        cpu_weight: number; // 0-1, relative CPU requirement
        memory_weight: number; // 0-1, relative memory requirement
        io_weight: number; // 0-1, relative I/O requirement
    };
    sla_requirements: {
        max_response_time: number; // milliseconds
        min_availability: number; // 0-1, minimum uptime required
        max_error_rate: number; // 0-1, maximum acceptable error rate
    };
    business_impact: {
        revenue_impact: number; // 0-1, impact on revenue
        user_experience_impact: number; // 0-1, impact on UX
        operational_impact: number; // 0-1, impact on operations
    };
    overload_behavior: {
        can_be_throttled: boolean;
        can_be_degraded: boolean;
        can_be_disabled: boolean;
        fallback_mode?: 'cache_only' | 'read_only' | 'essential_only';
    };
}

export interface ResourceAllocation {
    service: string;
    tier: ServiceTier;
    allocated_percentage: number; // 0-100, percentage of total resources
    current_usage: number; // 0-100, current usage percentage
    priority_score: number; // calculated priority score
    actions_applied: ServiceAction[];
}

export interface ServiceAction {
    type: 'throttle' | 'degrade' | 'disable' | 'prioritize' | 'cache_extend' | 'queue_priority';
    service: string;
    severity: number; // 0-1, how severe the action is
    description: string;
    applied_at: number;
    expected_resource_savings: number; // 0-1, expected resource reduction
}

export interface OverloadResponse {
    level: OverloadLevel;
    triggered_by: string[];
    actions_taken: ServiceAction[];
    services_affected: string[];
    resource_savings_achieved: number; // 0-1, actual resource reduction
    estimated_recovery_time: number; // seconds
    success: boolean;
}

export interface ServicePrioritizationConfig {
    enable_service_prioritization: boolean;
    monitoring_interval: number; // seconds
    overload_thresholds: Record<OverloadLevel, {
        cpu_threshold: number;
        memory_threshold: number;
        response_time_threshold: number;
        error_rate_threshold: number;
        queue_depth_threshold: number;
    }>;
    tier_weights: Record<ServiceTier, number>; // Higher weight = higher priority
    resource_reallocation_aggressiveness: number; // 0-1, how aggressive to be
    recovery_delay: number; // seconds to wait before attempting recovery
    max_actions_per_cycle: number; // maximum actions to take in one cycle
}

export class ServicePrioritizationService extends EventEmitter {
    private static instance: ServicePrioritizationService;
    
    private registeredServices: Map<string, ServiceDefinition> = new Map();
    private currentAllocations: Map<string, ResourceAllocation> = new Map();
    private activeActions: Map<string, ServiceAction[]> = new Map();
    private currentOverloadLevel: OverloadLevel = 'normal';
    private lastOverloadResponse?: OverloadResponse;
    
    // Monitoring
    private monitoringInterval?: NodeJS.Timeout;
    private overloadHistory: Array<{ level: OverloadLevel; timestamp: number; duration: number }> = [];
    
    // Configuration
    private config: ServicePrioritizationConfig = {
        enable_service_prioritization: true,
        monitoring_interval: 30, // 30 seconds
        overload_thresholds: {
            normal: { cpu_threshold: 60, memory_threshold: 70, response_time_threshold: 2000, error_rate_threshold: 2, queue_depth_threshold: 50 },
            light: { cpu_threshold: 70, memory_threshold: 80, response_time_threshold: 3000, error_rate_threshold: 5, queue_depth_threshold: 100 },
            moderate: { cpu_threshold: 80, memory_threshold: 85, response_time_threshold: 5000, error_rate_threshold: 8, queue_depth_threshold: 200 },
            heavy: { cpu_threshold: 90, memory_threshold: 90, response_time_threshold: 8000, error_rate_threshold: 12, queue_depth_threshold: 500 },
            severe: { cpu_threshold: 95, memory_threshold: 95, response_time_threshold: 15000, error_rate_threshold: 20, queue_depth_threshold: 1000 }
        },
        tier_weights: {
            critical: 1.0,
            essential: 0.8,
            important: 0.6,
            standard: 0.4,
            optional: 0.2
        },
        resource_reallocation_aggressiveness: 0.7,
        recovery_delay: 120, // 2 minutes
        max_actions_per_cycle: 5
    };
    
    // Default service definitions
    private defaultServices: ServiceDefinition[] = [
        {
            name: 'authentication',
            tier: 'critical',
            description: 'User authentication and authorization',
            endpoints: ['/api/auth/*', '/api/user/login', '/api/user/logout'],
            dependencies: ['database', 'cache'],
            resource_requirements: { cpu_weight: 0.3, memory_weight: 0.2, io_weight: 0.4 },
            sla_requirements: { max_response_time: 1000, min_availability: 0.999, max_error_rate: 0.001 },
            business_impact: { revenue_impact: 0.9, user_experience_impact: 1.0, operational_impact: 0.8 },
            overload_behavior: { can_be_throttled: false, can_be_degraded: false, can_be_disabled: false }
        },
        {
            name: 'ai_processing',
            tier: 'important',
            description: 'AI model processing and optimization',
            endpoints: ['/api/ai/*', '/api/optimize/*', '/api/cortex/*'],
            dependencies: ['bedrock', 'database', 'cache'],
            resource_requirements: { cpu_weight: 0.8, memory_weight: 0.7, io_weight: 0.6 },
            sla_requirements: { max_response_time: 10000, min_availability: 0.95, max_error_rate: 0.05 },
            business_impact: { revenue_impact: 0.8, user_experience_impact: 0.7, operational_impact: 0.6 },
            overload_behavior: { can_be_throttled: true, can_be_degraded: true, can_be_disabled: false, fallback_mode: 'cache_only' }
        },
        {
            name: 'dashboard',
            tier: 'essential',
            description: 'User dashboard and analytics',
            endpoints: ['/api/dashboard/*', '/api/analytics/*', '/api/metrics/*'],
            dependencies: ['database', 'cache'],
            resource_requirements: { cpu_weight: 0.4, memory_weight: 0.3, io_weight: 0.5 },
            sla_requirements: { max_response_time: 3000, min_availability: 0.98, max_error_rate: 0.02 },
            business_impact: { revenue_impact: 0.6, user_experience_impact: 0.8, operational_impact: 0.5 },
            overload_behavior: { can_be_throttled: true, can_be_degraded: true, can_be_disabled: false, fallback_mode: 'cache_only' }
        },
        {
            name: 'reporting',
            tier: 'standard',
            description: 'Report generation and export',
            endpoints: ['/api/reports/*', '/api/export/*'],
            dependencies: ['database', 'file_storage'],
            resource_requirements: { cpu_weight: 0.6, memory_weight: 0.5, io_weight: 0.8 },
            sla_requirements: { max_response_time: 15000, min_availability: 0.95, max_error_rate: 0.05 },
            business_impact: { revenue_impact: 0.4, user_experience_impact: 0.5, operational_impact: 0.7 },
            overload_behavior: { can_be_throttled: true, can_be_degraded: true, can_be_disabled: true, fallback_mode: 'cache_only' }
        },
        {
            name: 'webhooks',
            tier: 'standard',
            description: 'Webhook delivery and management',
            endpoints: ['/api/webhooks/*'],
            dependencies: ['queue', 'database'],
            resource_requirements: { cpu_weight: 0.3, memory_weight: 0.2, io_weight: 0.7 },
            sla_requirements: { max_response_time: 5000, min_availability: 0.95, max_error_rate: 0.05 },
            business_impact: { revenue_impact: 0.3, user_experience_impact: 0.4, operational_impact: 0.6 },
            overload_behavior: { can_be_throttled: true, can_be_degraded: true, can_be_disabled: true }
        },
        {
            name: 'background_jobs',
            tier: 'optional',
            description: 'Background processing and batch jobs',
            endpoints: ['/api/background/*', '/api/batch/*'],
            dependencies: ['queue', 'database'],
            resource_requirements: { cpu_weight: 0.5, memory_weight: 0.4, io_weight: 0.6 },
            sla_requirements: { max_response_time: 30000, min_availability: 0.90, max_error_rate: 0.10 },
            business_impact: { revenue_impact: 0.2, user_experience_impact: 0.1, operational_impact: 0.8 },
            overload_behavior: { can_be_throttled: true, can_be_degraded: true, can_be_disabled: true }
        },
        {
            name: 'file_uploads',
            tier: 'standard',
            description: 'File upload and processing',
            endpoints: ['/api/upload/*', '/api/files/*'],
            dependencies: ['file_storage', 'database'],
            resource_requirements: { cpu_weight: 0.4, memory_weight: 0.6, io_weight: 0.9 },
            sla_requirements: { max_response_time: 20000, min_availability: 0.95, max_error_rate: 0.05 },
            business_impact: { revenue_impact: 0.5, user_experience_impact: 0.6, operational_impact: 0.4 },
            overload_behavior: { can_be_throttled: true, can_be_degraded: true, can_be_disabled: true }
        },
        {
            name: 'notifications',
            tier: 'optional',
            description: 'Email and push notifications',
            endpoints: ['/api/notifications/*'],
            dependencies: ['email_service', 'database'],
            resource_requirements: { cpu_weight: 0.2, memory_weight: 0.1, io_weight: 0.5 },
            sla_requirements: { max_response_time: 10000, min_availability: 0.90, max_error_rate: 0.10 },
            business_impact: { revenue_impact: 0.1, user_experience_impact: 0.3, operational_impact: 0.2 },
            overload_behavior: { can_be_throttled: true, can_be_degraded: true, can_be_disabled: true }
        }
    ];

    private constructor() {
        super();
        this.initializeDefaultServices();
        this.startMonitoring();
    }

    public static getInstance(): ServicePrioritizationService {
        if (!ServicePrioritizationService.instance) {
            ServicePrioritizationService.instance = new ServicePrioritizationService();
        }
        return ServicePrioritizationService.instance;
    }

    /**
     * Register a service for prioritization
     */
    public registerService(service: ServiceDefinition): void {
        this.registeredServices.set(service.name, service);
        
        // Initialize resource allocation
        this.currentAllocations.set(service.name, {
            service: service.name,
            tier: service.tier,
            allocated_percentage: this.calculateInitialAllocation(service),
            current_usage: 0,
            priority_score: this.calculatePriorityScore(service),
            actions_applied: []
        });

        loggingService.info('Service registered for prioritization', {
            component: 'ServicePrioritizationService',
            service: service.name,
            tier: service.tier,
            priority_score: this.currentAllocations.get(service.name)?.priority_score
        });
    }

    /**
     * Get service priority for a request
     */
    public getServicePriority(endpoint: string): {
        service?: ServiceDefinition;
        priority_score: number;
        tier: ServiceTier;
        should_throttle: boolean;
        should_degrade: boolean;
    } {
        // Find matching service
        const service = this.findServiceByEndpoint(endpoint);
        
        if (!service) {
            return {
                priority_score: 0.5,
                tier: 'standard',
                should_throttle: this.currentOverloadLevel !== 'normal',
                should_degrade: ['heavy', 'severe'].includes(this.currentOverloadLevel)
            };
        }

        const allocation = this.currentAllocations.get(service.name);
        const actions = this.activeActions.get(service.name) || [];
        
        return {
            service,
            priority_score: allocation?.priority_score || 0.5,
            tier: service.tier,
            should_throttle: actions.some(a => a.type === 'throttle') || 
                            (service.overload_behavior.can_be_throttled && this.currentOverloadLevel !== 'normal'),
            should_degrade: actions.some(a => a.type === 'degrade') ||
                           (service.overload_behavior.can_be_degraded && ['moderate', 'heavy', 'severe'].includes(this.currentOverloadLevel))
        };
    }

    /**
     * Handle system overload by prioritizing services
     */
    public async handleOverload(overloadLevel: OverloadLevel, triggers: string[]): Promise<OverloadResponse> {
        const startTime = Date.now();
        
        loggingService.warn('System overload detected - applying service prioritization', {
            component: 'ServicePrioritizationService',
            level: overloadLevel,
            triggers,
            previous_level: this.currentOverloadLevel
        });

        const previousLevel = this.currentOverloadLevel;
        this.currentOverloadLevel = overloadLevel;
        
        try {
            // Calculate new resource allocations
            const newAllocations = await this.calculateResourceAllocations(overloadLevel);
            
            // Determine actions needed
            const actions = this.determineRequiredActions(newAllocations);
            
            // Execute actions (limited by max_actions_per_cycle)
            const limitedActions = actions.slice(0, this.config.max_actions_per_cycle);
            const executedActions: ServiceAction[] = [];
            
            for (const action of limitedActions) {
                try {
                    const success = await this.executeServiceAction(action);
                    if (success) {
                        executedActions.push(action);
                    }
                } catch (error) {
                    loggingService.error('Failed to execute service action', {
                        component: 'ServicePrioritizationService',
                        action: action.type,
                        service: action.service,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }
            
            // Update allocations
            this.updateResourceAllocations(newAllocations);
            
            // Calculate resource savings
            const resourceSavings = this.calculateResourceSavings(executedActions);
            
            // Record in history
            this.overloadHistory.push({
                level: overloadLevel,
                timestamp: startTime,
                duration: Date.now() - startTime
            });
            
            const response: OverloadResponse = {
                level: overloadLevel,
                triggered_by: triggers,
                actions_taken: executedActions,
                services_affected: [...new Set(executedActions.map(a => a.service))],
                resource_savings_achieved: resourceSavings,
                estimated_recovery_time: this.estimateRecoveryTime(overloadLevel, executedActions),
                success: executedActions.length > 0
            };
            
            this.lastOverloadResponse = response;
            
            // Cache response for monitoring
            await cacheService.set('service_prioritization_response', response, 3600);
            
            // Emit event
            this.emit('overload_handled', response);
            
            loggingService.info('Service prioritization completed', {
                component: 'ServicePrioritizationService',
                level: overloadLevel,
                actions_executed: executedActions.length,
                services_affected: response.services_affected.length,
                resource_savings: resourceSavings,
                duration: Date.now() - startTime
            });
            
            return response;
            
        } catch (error) {
            loggingService.error('Failed to handle system overload', {
                component: 'ServicePrioritizationService',
                level: overloadLevel,
                error: error instanceof Error ? error.message : String(error),
                duration: Date.now() - startTime
            });
            
            // Revert overload level on failure
            this.currentOverloadLevel = previousLevel;
            
            return {
                level: overloadLevel,
                triggered_by: triggers,
                actions_taken: [],
                services_affected: [],
                resource_savings_achieved: 0,
                estimated_recovery_time: 0,
                success: false
            };
        }
    }

    /**
     * Attempt recovery from overload state
     */
    public async attemptRecovery(): Promise<boolean> {
        if (this.currentOverloadLevel === 'normal') {
            return true; // Already recovered
        }

        loggingService.info('Attempting recovery from overload state', {
            component: 'ServicePrioritizationService',
            current_level: this.currentOverloadLevel
        });

        try {
            // Check if system conditions have improved
            const currentMetrics = await this.getCurrentSystemMetrics();
            const canRecover = this.canRecoverFromLevel(this.currentOverloadLevel, currentMetrics);
            
            if (!canRecover) {
                loggingService.debug('System conditions not yet suitable for recovery', {
                    component: 'ServicePrioritizationService',
                    current_level: this.currentOverloadLevel,
                    metrics: currentMetrics
                });
                return false;
            }

            // Determine target recovery level
            const targetLevel = this.determineRecoveryLevel(currentMetrics);
            
            // Rollback some actions if recovering
            const rollbackActions = await this.planRecoveryActions(targetLevel);
            
            // Execute rollback actions
            for (const action of rollbackActions) {
                try {
                    await this.rollbackServiceAction(action);
                } catch (error) {
                    loggingService.warn('Failed to rollback service action during recovery', {
                        component: 'ServicePrioritizationService',
                        action: action.type,
                        service: action.service,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }

            // Update overload level
            const previousLevel = this.currentOverloadLevel;
            this.currentOverloadLevel = targetLevel;
            
            // Recalculate resource allocations for new level
            const newAllocations = await this.calculateResourceAllocations(targetLevel);
            this.updateResourceAllocations(newAllocations);
            
            loggingService.info('Successfully recovered from overload', {
                component: 'ServicePrioritizationService',
                previous_level: previousLevel,
                new_level: targetLevel,
                actions_rolled_back: rollbackActions.length
            });
            
            // Emit recovery event
            this.emit('recovery_completed', {
                previous_level: previousLevel,
                new_level: targetLevel,
                actions_rolled_back: rollbackActions.length
            });
            
            return true;
            
        } catch (error) {
            loggingService.error('Failed to recover from overload', {
                component: 'ServicePrioritizationService',
                current_level: this.currentOverloadLevel,
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }

    /**
     * Initialize default services
     */
    private initializeDefaultServices(): void {
        for (const service of this.defaultServices) {
            this.registerService(service);
        }
    }

    /**
     * Start monitoring loop
     */
    private startMonitoring(): void {
        this.monitoringInterval = setInterval(async () => {
            try {
                if (!this.config.enable_service_prioritization) return;
                
                // Check system metrics and determine overload level
                const metrics = await this.getCurrentSystemMetrics();
                const detectedLevel = this.detectOverloadLevel(metrics);
                
                if (detectedLevel !== this.currentOverloadLevel) {
                    if (this.shouldEscalate(detectedLevel)) {
                        await this.handleOverload(detectedLevel, this.identifyOverloadTriggers(metrics));
                    } else if (this.shouldRecover(detectedLevel)) {
                        await this.attemptRecovery();
                    }
                }
                
                // Update service usage metrics
                await this.updateServiceUsageMetrics();
                
            } catch (error) {
                loggingService.error('Error in service prioritization monitoring', {
                    component: 'ServicePrioritizationService',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }, this.config.monitoring_interval * 1000);
    }

    /**
     * Calculate initial resource allocation for a service
     */
    private calculateInitialAllocation(service: ServiceDefinition): number {
        const tierWeight = this.config.tier_weights[service.tier];
        const resourceWeight = (service.resource_requirements.cpu_weight + 
                              service.resource_requirements.memory_weight + 
                              service.resource_requirements.io_weight) / 3;
        
        // Base allocation percentage (this would be more sophisticated in practice)
        return Math.min(100, tierWeight * resourceWeight * 100);
    }

    /**
     * Calculate priority score for a service
     */
    private calculatePriorityScore(service: ServiceDefinition): number {
        const tierWeight = this.config.tier_weights[service.tier];
        const businessImpact = (service.business_impact.revenue_impact + 
                               service.business_impact.user_experience_impact + 
                               service.business_impact.operational_impact) / 3;
        
        // SLA requirements factor (higher requirements = higher priority)
        const slaFactor = (1 - service.sla_requirements.max_error_rate) * 
                         service.sla_requirements.min_availability * 
                         (1 / (service.sla_requirements.max_response_time / 1000));
        
        return tierWeight * 0.4 + businessImpact * 0.4 + Math.min(slaFactor, 1) * 0.2;
    }

    /**
     * Find service by endpoint
     */
    private findServiceByEndpoint(endpoint: string): ServiceDefinition | undefined {
        for (const [_, service] of this.registeredServices) {
            for (const serviceEndpoint of service.endpoints) {
                if (this.matchesEndpoint(endpoint, serviceEndpoint)) {
                    return service;
                }
            }
        }
        return undefined;
    }

    /**
     * Check if endpoint matches service endpoint pattern
     */
    private matchesEndpoint(endpoint: string, pattern: string): boolean {
        if (pattern.endsWith('/*')) {
            const prefix = pattern.slice(0, -2);
            return endpoint.startsWith(prefix);
        }
        return endpoint === pattern;
    }

    /**
     * Get current system metrics
     */
    private async getCurrentSystemMetrics(): Promise<any> {
        try {
            // Get metrics from various services
            const preemptiveStats = preemptiveThrottlingService.getStatus();
            const degradationStats = gracefulDegradationService.getStatus();
            const queueStats = await cacheService.get('request_prioritization_stats') || {};
            
            return {
                cpu_usage: preemptiveStats.recent_metrics[preemptiveStats.recent_metrics.length - 1]?.cpu_usage || 0,
                memory_usage: preemptiveStats.recent_metrics[preemptiveStats.recent_metrics.length - 1]?.memory_usage || 0,
                response_time: preemptiveStats.recent_metrics[preemptiveStats.recent_metrics.length - 1]?.response_time || 0,
                error_rate: preemptiveStats.recent_metrics[preemptiveStats.recent_metrics.length - 1]?.error_rate || 0,
                queue_depth: (queueStats as any).total || 0,
                degradation_level: degradationStats.level,
                throttling_phase: preemptiveStats.phase
            };
        } catch (error) {
            return {
                cpu_usage: 0,
                memory_usage: 0,
                response_time: 0,
                error_rate: 0,
                queue_depth: 0,
                degradation_level: 'none',
                throttling_phase: 'normal'
            };
        }
    }

    /**
     * Detect current overload level based on metrics
     */
    private detectOverloadLevel(metrics: any): OverloadLevel {
        const levels: OverloadLevel[] = ['severe', 'heavy', 'moderate', 'light', 'normal'];
        
        for (const level of levels) {
            const thresholds = this.config.overload_thresholds[level];
            
            if (metrics.cpu_usage >= thresholds.cpu_threshold ||
                metrics.memory_usage >= thresholds.memory_threshold ||
                metrics.response_time >= thresholds.response_time_threshold ||
                metrics.error_rate >= thresholds.error_rate_threshold ||
                metrics.queue_depth >= thresholds.queue_depth_threshold) {
                return level;
            }
        }
        
        return 'normal';
    }

    /**
     * Check if should escalate to higher overload level
     */
    private shouldEscalate(detectedLevel: OverloadLevel): boolean {
        const levelOrder = ['normal', 'light', 'moderate', 'heavy', 'severe'];
        const currentIndex = levelOrder.indexOf(this.currentOverloadLevel);
        const detectedIndex = levelOrder.indexOf(detectedLevel);
        
        return detectedIndex > currentIndex;
    }

    /**
     * Check if should attempt recovery
     */
    private shouldRecover(detectedLevel: OverloadLevel): boolean {
        const levelOrder = ['normal', 'light', 'moderate', 'heavy', 'severe'];
        const currentIndex = levelOrder.indexOf(this.currentOverloadLevel);
        const detectedIndex = levelOrder.indexOf(detectedLevel);
        
        return detectedIndex < currentIndex;
    }

    /**
     * Identify what triggered the overload
     */
    private identifyOverloadTriggers(metrics: any): string[] {
        const triggers: string[] = [];
        
        if (metrics.cpu_usage > 80) triggers.push('High CPU usage');
        if (metrics.memory_usage > 85) triggers.push('High memory usage');
        if (metrics.response_time > 5000) triggers.push('High response times');
        if (metrics.error_rate > 5) triggers.push('High error rate');
        if (metrics.queue_depth > 200) triggers.push('Queue overload');
        
        return triggers;
    }

    /**
     * Calculate new resource allocations based on overload level
     */
    private async calculateResourceAllocations(overloadLevel: OverloadLevel): Promise<Map<string, ResourceAllocation>> {
        const newAllocations = new Map<string, ResourceAllocation>();
        
        // Get total available resources (simplified)
        const totalResources = 100;
        let allocatedResources = 0;
        
        // Sort services by priority
        const sortedServices = Array.from(this.registeredServices.values())
            .sort((a, b) => this.calculatePriorityScore(b) - this.calculatePriorityScore(a));
        
        // Allocate resources based on priority and overload level
        for (const service of sortedServices) {
            const currentAllocation = this.currentAllocations.get(service.name);
            if (!currentAllocation) continue;
            
            let newPercentage = currentAllocation.allocated_percentage;
            
            // Adjust based on overload level
            switch (overloadLevel) {
                case 'light':
                    if (service.tier === 'optional') newPercentage *= 0.8;
                    break;
                case 'moderate':
                    if (service.tier === 'optional') newPercentage *= 0.5;
                    if (service.tier === 'standard') newPercentage *= 0.8;
                    break;
                case 'heavy':
                    if (service.tier === 'optional') newPercentage *= 0.2;
                    if (service.tier === 'standard') newPercentage *= 0.6;
                    if (service.tier === 'important') newPercentage *= 0.8;
                    break;
                case 'severe':
                    if (service.tier === 'optional') newPercentage = 0;
                    if (service.tier === 'standard') newPercentage *= 0.3;
                    if (service.tier === 'important') newPercentage *= 0.6;
                    if (service.tier === 'essential') newPercentage *= 0.8;
                    break;
            }
            
            // Ensure we don't over-allocate
            const remainingResources = totalResources - allocatedResources;
            newPercentage = Math.min(newPercentage, remainingResources);
            allocatedResources += newPercentage;
            
            newAllocations.set(service.name, {
                ...currentAllocation,
                allocated_percentage: newPercentage
            });
        }
        
        return newAllocations;
    }

    /**
     * Determine required actions based on allocation changes
     */
    private determineRequiredActions(
        newAllocations: Map<string, ResourceAllocation>, 
    ): ServiceAction[] {
        const actions: ServiceAction[] = [];
        
        for (const [serviceName, newAllocation] of newAllocations) {
            const service = this.registeredServices.get(serviceName);
            const currentAllocation = this.currentAllocations.get(serviceName);
            
            if (!service || !currentAllocation) continue;
            
            const reductionRatio = newAllocation.allocated_percentage / currentAllocation.allocated_percentage;
            
            // Determine actions based on reduction and service capabilities
            if (reductionRatio < 0.9 && service.overload_behavior.can_be_throttled) {
                actions.push({
                    type: 'throttle',
                    service: serviceName,
                    severity: 1 - reductionRatio,
                    description: `Throttle ${serviceName} by ${Math.round((1 - reductionRatio) * 100)}%`,
                    applied_at: Date.now(),
                    expected_resource_savings: (1 - reductionRatio) * 0.7
                });
            }
            
            if (reductionRatio < 0.7 && service.overload_behavior.can_be_degraded) {
                actions.push({
                    type: 'degrade',
                    service: serviceName,
                    severity: 1 - reductionRatio,
                    description: `Enable degraded mode for ${serviceName}`,
                    applied_at: Date.now(),
                    expected_resource_savings: (1 - reductionRatio) * 0.8
                });
            }
            
            if (reductionRatio < 0.3 && service.overload_behavior.can_be_disabled) {
                actions.push({
                    type: 'disable',
                    service: serviceName,
                    severity: 1,
                    description: `Temporarily disable ${serviceName}`,
                    applied_at: Date.now(),
                    expected_resource_savings: 0.95
                });
            }
            
            // Priority actions for critical services
            if (service.tier === 'critical' || service.tier === 'essential') {
                actions.push({
                    type: 'prioritize',
                    service: serviceName,
                    severity: 0,
                    description: `Ensure priority processing for ${serviceName}`,
                    applied_at: Date.now(),
                    expected_resource_savings: -0.1 // Actually uses more resources
                });
            }
        }
        
        // Sort by expected resource savings (highest first)
        return actions.sort((a, b) => b.expected_resource_savings - a.expected_resource_savings);
    }

    /**
     * Execute a service action
     */
    private async executeServiceAction(action: ServiceAction): Promise<boolean> {
        try {
            const service = this.registeredServices.get(action.service);
            if (!service) return false;

            switch (action.type) {
                case 'throttle':
                    return await this.applyServiceThrottling(service, action.severity);
                
                case 'degrade':
                    return await this.applyServiceDegradation(service, action.severity);
                
                case 'disable':
                    return await this.disableService(service);
                
                case 'prioritize':
                    return await this.prioritizeService(service);
                
                case 'cache_extend':
                    return await this.extendServiceCaching(service);
                
                case 'queue_priority':
                    return await this.adjustServiceQueuePriority(service); 
                
                default:
                    return false;
            }
        } catch (error) {
            loggingService.error('Failed to execute service action', {
                component: 'ServicePrioritizationService',
                action: action.type,
                service: action.service,
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }

    /**
     * Apply throttling to a service
     */
    private async applyServiceThrottling(service: ServiceDefinition, severity: number): Promise<boolean> {
        const throttleFactor = 1 - severity; // Convert severity to throttle factor
        
        // Set service-specific throttling
        await cacheService.set(`service_throttle:${service.name}`, {
            enabled: true,
            factor: throttleFactor,
            applied_at: Date.now()
        }, 3600);
        
        // Add to active actions
        const actions = this.activeActions.get(service.name) || [];
        actions.push({
            type: 'throttle',
            service: service.name,
            severity,
            description: `Throttling applied with factor ${throttleFactor.toFixed(2)}`,
            applied_at: Date.now(),
            expected_resource_savings: severity * 0.7
        });
        this.activeActions.set(service.name, actions);
        
        loggingService.info('Service throttling applied', {
            component: 'ServicePrioritizationService',
            service: service.name,
            throttle_factor: throttleFactor,
            severity
        });
        
        return true;
    }

    /**
     * Apply degradation to a service
     */
    private async applyServiceDegradation(service: ServiceDefinition, severity: number): Promise<boolean> {
        let degradationMode = 'reduced';
        
        if (severity > 0.7) degradationMode = 'essential_only';
        else if (severity > 0.5) degradationMode = 'cache_only';
        
        // Set service-specific degradation
        await cacheService.set(`service_degradation:${service.name}`, {
            enabled: true,
            mode: degradationMode,
            fallback_mode: service.overload_behavior.fallback_mode,
            applied_at: Date.now()
        }, 3600);
        
        // Add to active actions
        const actions = this.activeActions.get(service.name) || [];
        actions.push({
            type: 'degrade',
            service: service.name,
            severity,
            description: `Degradation applied: ${degradationMode}`,
            applied_at: Date.now(),
            expected_resource_savings: severity * 0.8
        });
        this.activeActions.set(service.name, actions);
        
        loggingService.info('Service degradation applied', {
            component: 'ServicePrioritizationService',
            service: service.name,
            mode: degradationMode,
            severity
        });
        
        return true;
    }

    /**
     * Temporarily disable a service
     */
    private async disableService(service: ServiceDefinition): Promise<boolean> {
        // Set service as disabled
        await cacheService.set(`service_disabled:${service.name}`, {
            disabled: true,
            disabled_at: Date.now(),
            reason: 'System overload prioritization'
        }, 3600);
        
        // Add to active actions
        const actions = this.activeActions.get(service.name) || [];
        actions.push({
            type: 'disable',
            service: service.name,
            severity: 1,
            description: 'Service temporarily disabled',
            applied_at: Date.now(),
            expected_resource_savings: 0.95
        });
        this.activeActions.set(service.name, actions);
        
        loggingService.warn('Service temporarily disabled', {
            component: 'ServicePrioritizationService',
            service: service.name,
            reason: 'System overload prioritization'
        });
        
        return true;
    }

    /**
     * Prioritize a service
     */
    private async prioritizeService(service: ServiceDefinition): Promise<boolean> {
        // Set high priority for this service
        await cacheService.set(`service_priority:${service.name}`, {
            priority: 'high',
            boost_factor: 1.5,
            applied_at: Date.now()
        }, 3600);
        
        // Add to active actions
        const actions = this.activeActions.get(service.name) || [];
        actions.push({
            type: 'prioritize',
            service: service.name,
            severity: 0,
            description: 'Service prioritized for critical processing',
            applied_at: Date.now(),
            expected_resource_savings: -0.1
        });
        this.activeActions.set(service.name, actions);
        
        loggingService.info('Service prioritized', {
            component: 'ServicePrioritizationService',
            service: service.name
        });
        
        return true;
    }

    /**
     * Extend caching for a service
     */
    private async extendServiceCaching(service: ServiceDefinition): Promise<boolean> {
        // Extend cache TTL for this service
        await cacheService.set(`service_cache_extension:${service.name}`, {
            ttl_multiplier: 3.0,
            applied_at: Date.now()
        }, 3600);
        
        return true;
    }

    /**
     * Adjust service queue priority
     */
    private async adjustServiceQueuePriority(service: ServiceDefinition): Promise<boolean> {
        const priorityAdjustment = service.tier === 'critical' ? 'high' : 
                                 service.tier === 'essential' ? 'medium' : 'low';
        
        await cacheService.set(`service_queue_priority:${service.name}`, {
            priority: priorityAdjustment,
            applied_at: Date.now()
        }, 3600);
        
        return true;
    }

    /**
     * Rollback a service action
     */
    private async rollbackServiceAction(action: ServiceAction): Promise<boolean> {
        try {
            switch (action.type) {
                case 'throttle':
                    await cacheService.delete(`service_throttle:${action.service}`);
                    break;
                case 'degrade':
                    await cacheService.delete(`service_degradation:${action.service}`);
                    break;
                case 'disable':
                    await cacheService.delete(`service_disabled:${action.service}`);
                    break;
                case 'prioritize':
                    await cacheService.delete(`service_priority:${action.service}`);
                    break;
                case 'cache_extend':
                    await cacheService.delete(`service_cache_extension:${action.service}`);
                    break;
                case 'queue_priority':
                    await cacheService.delete(`service_queue_priority:${action.service}`);
                    break;
            }
            
            // Remove from active actions
            const actions = this.activeActions.get(action.service) || [];
            const filteredActions = actions.filter(a => a.type !== action.type || a.applied_at !== action.applied_at);
            this.activeActions.set(action.service, filteredActions);
            
            return true;
        } catch (error) {
            loggingService.error('Failed to rollback service action', {
                component: 'ServicePrioritizationService',
                action: action.type,
                service: action.service,
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }

    /**
     * Update resource allocations
     */
    private updateResourceAllocations(newAllocations: Map<string, ResourceAllocation>): void {
        for (const [serviceName, allocation] of newAllocations) {
            this.currentAllocations.set(serviceName, allocation);
        }
    }

    /**
     * Calculate resource savings from executed actions
     */
    private calculateResourceSavings(actions: ServiceAction[]): number {
        return actions.reduce((total, action) => total + action.expected_resource_savings, 0) / actions.length;
    }

    /**
     * Estimate recovery time
     */
    private estimateRecoveryTime(level: OverloadLevel, actions: ServiceAction[]): number {
        const baseTimes: Record<OverloadLevel, number> = {
            normal: 0,
            light: 120,    // 2 minutes
            moderate: 300, // 5 minutes
            heavy: 600,    // 10 minutes
            severe: 1200   // 20 minutes
        };
        
        const baseTime = baseTimes[level];
        const actionPenalty = actions.length * 30; // 30 seconds per action
        
        return baseTime + actionPenalty;
    }

    /**
     * Check if can recover from current level
     */
    private canRecoverFromLevel(level: OverloadLevel, metrics: any): boolean {
        const thresholds = this.config.overload_thresholds[level];
        
        // Use recovery factor for more conservative recovery
        const recoveryFactor = 0.8;
        
        return metrics.cpu_usage < thresholds.cpu_threshold * recoveryFactor &&
               metrics.memory_usage < thresholds.memory_threshold * recoveryFactor &&
               metrics.response_time < thresholds.response_time_threshold * recoveryFactor &&
               metrics.error_rate < thresholds.error_rate_threshold * recoveryFactor &&
               metrics.queue_depth < thresholds.queue_depth_threshold * recoveryFactor;
    }

    /**
     * Determine target recovery level
     */
    private determineRecoveryLevel(metrics: any): OverloadLevel {
        const levels: OverloadLevel[] = ['normal', 'light', 'moderate', 'heavy', 'severe'];
        
        for (const level of levels) {
            if (this.canRecoverFromLevel(level, metrics)) {
                return level;
            }
        }
        
        return this.currentOverloadLevel; // Stay at current level if can't recover
    }

    /**
     * Plan recovery actions
     */
    private async planRecoveryActions(targetLevel: OverloadLevel): Promise<ServiceAction[]> {
        const rollbackActions: ServiceAction[] = [];
        
        // Get all active actions
        for (const [serviceName, actions] of this.activeActions) {
            const service = this.registeredServices.get(serviceName);
            if (!service) continue;
            
            // Determine which actions to rollback based on target level
            for (const action of actions) {
                if (this.shouldRollbackAction(action, targetLevel)) {
                    rollbackActions.push(action);
                }
            }
        }
        
        return rollbackActions;
    }

    /**
     * Check if should rollback an action for target level
     */
    private shouldRollbackAction(action: ServiceAction, targetLevel: OverloadLevel): boolean {
        // More aggressive actions should be rolled back first
        if (targetLevel === 'normal') {
            return true; // Rollback all actions when returning to normal
        }
        
        if (targetLevel === 'light') {
            return action.type === 'disable' || action.severity > 0.7;
        }
        
        if (targetLevel === 'moderate') {
            return action.type === 'disable';
        }
        
        return false; // Don't rollback for heavy overload recovery
    }

    /**
     * Update service usage metrics
     */
    private async updateServiceUsageMetrics(): Promise<void> {
        // This would integrate with actual metrics collection
        // For now, we'll simulate usage updates
        for (const [_, allocation] of this.currentAllocations) {
            // Simulate current usage (would come from real metrics)
            const simulatedUsage = Math.random() * allocation.allocated_percentage;
            allocation.current_usage = simulatedUsage;
        }
    }

    /**
     * Get current service prioritization status
     */
    public getStatus(): {
        overload_level: OverloadLevel;
        registered_services: number;
        active_actions: number;
        last_response?: OverloadResponse;
        allocations: ResourceAllocation[];
    } {
        return {
            overload_level: this.currentOverloadLevel,
            registered_services: this.registeredServices.size,
            active_actions: Array.from(this.activeActions.values()).reduce((total, actions) => total + actions.length, 0),
            last_response: this.lastOverloadResponse,
            allocations: Array.from(this.currentAllocations.values())
        };
    }

    /**
     * Update configuration
     */
    public updateConfig(newConfig: Partial<ServicePrioritizationConfig>): void {
        this.config = { ...this.config, ...newConfig };
        
        loggingService.info('Service prioritization configuration updated', {
            component: 'ServicePrioritizationService',
            config: this.config
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
        this.registeredServices.clear();
        this.currentAllocations.clear();
        this.activeActions.clear();
    }
}

// Export singleton instance
export const servicePrioritizationService = ServicePrioritizationService.getInstance();
