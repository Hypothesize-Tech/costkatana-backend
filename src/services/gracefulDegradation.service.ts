import { loggingService } from './logging.service';
import { cacheService } from './cache.service';
import { adaptiveRateLimitService } from './adaptiveRateLimit.service';
import { EventEmitter } from 'events';

/**
 * Graceful Degradation Service
 * Implements sophisticated fallback mechanisms and service degradation strategies
 */

export type DegradationLevel = 'none' | 'minimal' | 'moderate' | 'aggressive' | 'emergency';
export type ServiceMode = 'full' | 'reduced' | 'cache_only' | 'essential_only' | 'read_only' | 'maintenance';

export interface DegradationStrategy {
    level: DegradationLevel;
    mode: ServiceMode;
    features: {
        ai_processing: boolean;
        real_time_updates: boolean;
        complex_queries: boolean;
        background_jobs: boolean;
        file_uploads: boolean;
        notifications: boolean;
        analytics: boolean;
        reporting: boolean;
        webhooks: boolean;
        third_party_integrations: boolean;
    };
    limits: {
        max_request_size: number;
        max_response_time: number;
        max_concurrent_users: number;
        cache_ttl_multiplier: number;
    };
    fallbacks: {
        use_cache: boolean;
        simplified_responses: boolean;
        static_data: boolean;
        offline_mode: boolean;
    };
}

export interface SystemHealth {
    cpu_usage: number;
    memory_usage: number;
    response_time: number;
    error_rate: number;
    active_connections: number;
    queue_depth: number;
    database_lag: number;
    cache_hit_rate: number;
    timestamp: number;
}

export interface DegradationTrigger {
    name: string;
    condition: (health: SystemHealth) => boolean;
    level: DegradationLevel;
    priority: number;
    cooldown: number; // milliseconds
    lastTriggered?: number;
}

export class GracefulDegradationService extends EventEmitter {
    private static instance: GracefulDegradationService;
    
    private currentLevel: DegradationLevel = 'none';
    private currentMode: ServiceMode = 'full';
    private currentStrategy: DegradationStrategy;
    private systemHealth: SystemHealth;
    private degradationHistory: Array<{ level: DegradationLevel; timestamp: number; reason: string }> = [];
    
    // Monitoring and triggers
    private monitoringInterval?: NodeJS.Timeout;
    private readonly MONITORING_INTERVAL = 10000; // 10 seconds
    private readonly MAX_HISTORY_SIZE = 100;
    
    // Predefined strategies
    private strategies: Record<DegradationLevel, DegradationStrategy> = {
        none: {
            level: 'none',
            mode: 'full',
            features: {
                ai_processing: true,
                real_time_updates: true,
                complex_queries: true,
                background_jobs: true,
                file_uploads: true,
                notifications: true,
                analytics: true,
                reporting: true,
                webhooks: true,
                third_party_integrations: true
            },
            limits: {
                max_request_size: 100 * 1024 * 1024, // 100MB
                max_response_time: 30000, // 30s
                max_concurrent_users: 10000,
                cache_ttl_multiplier: 1.0
            },
            fallbacks: {
                use_cache: false,
                simplified_responses: false,
                static_data: false,
                offline_mode: false
            }
        },
        
        minimal: {
            level: 'minimal',
            mode: 'reduced',
            features: {
                ai_processing: true,
                real_time_updates: true,
                complex_queries: true,
                background_jobs: false, // Disable background jobs
                file_uploads: true,
                notifications: false, // Disable notifications
                analytics: false, // Disable analytics
                reporting: true,
                webhooks: true,
                third_party_integrations: true
            },
            limits: {
                max_request_size: 50 * 1024 * 1024, // 50MB
                max_response_time: 25000, // 25s
                max_concurrent_users: 8000,
                cache_ttl_multiplier: 1.5
            },
            fallbacks: {
                use_cache: true,
                simplified_responses: false,
                static_data: false,
                offline_mode: false
            }
        },
        
        moderate: {
            level: 'moderate',
            mode: 'cache_only',
            features: {
                ai_processing: true,
                real_time_updates: false, // Disable real-time
                complex_queries: false, // Disable complex queries
                background_jobs: false,
                file_uploads: false, // Disable uploads
                notifications: false,
                analytics: false,
                reporting: false, // Disable reporting
                webhooks: false, // Disable webhooks
                third_party_integrations: false // Disable integrations
            },
            limits: {
                max_request_size: 10 * 1024 * 1024, // 10MB
                max_response_time: 15000, // 15s
                max_concurrent_users: 5000,
                cache_ttl_multiplier: 2.0
            },
            fallbacks: {
                use_cache: true,
                simplified_responses: true,
                static_data: true,
                offline_mode: false
            }
        },
        
        aggressive: {
            level: 'aggressive',
            mode: 'essential_only',
            features: {
                ai_processing: false, // Disable AI processing
                real_time_updates: false,
                complex_queries: false,
                background_jobs: false,
                file_uploads: false,
                notifications: false,
                analytics: false,
                reporting: false,
                webhooks: false,
                third_party_integrations: false
            },
            limits: {
                max_request_size: 1 * 1024 * 1024, // 1MB
                max_response_time: 5000, // 5s
                max_concurrent_users: 2000,
                cache_ttl_multiplier: 5.0
            },
            fallbacks: {
                use_cache: true,
                simplified_responses: true,
                static_data: true,
                offline_mode: true
            }
        },
        
        emergency: {
            level: 'emergency',
            mode: 'read_only',
            features: {
                ai_processing: false,
                real_time_updates: false,
                complex_queries: false,
                background_jobs: false,
                file_uploads: false,
                notifications: false,
                analytics: false,
                reporting: false,
                webhooks: false,
                third_party_integrations: false
            },
            limits: {
                max_request_size: 100 * 1024, // 100KB
                max_response_time: 2000, // 2s
                max_concurrent_users: 500,
                cache_ttl_multiplier: 10.0
            },
            fallbacks: {
                use_cache: true,
                simplified_responses: true,
                static_data: true,
                offline_mode: true
            }
        }
    };
    
    // Degradation triggers
    private triggers: DegradationTrigger[] = [
        {
            name: 'high_cpu_usage',
            condition: (health) => health.cpu_usage > 85,
            level: 'minimal',
            priority: 1,
            cooldown: 60000 // 1 minute
        },
        {
            name: 'critical_cpu_usage',
            condition: (health) => health.cpu_usage > 95,
            level: 'aggressive',
            priority: 3,
            cooldown: 30000 // 30 seconds
        },
        {
            name: 'high_memory_usage',
            condition: (health) => health.memory_usage > 90,
            level: 'minimal',
            priority: 1,
            cooldown: 60000
        },
        {
            name: 'critical_memory_usage',
            condition: (health) => health.memory_usage > 98,
            level: 'emergency',
            priority: 5,
            cooldown: 10000 // 10 seconds
        },
        {
            name: 'high_response_time',
            condition: (health) => health.response_time > 10000, // 10s
            level: 'minimal',
            priority: 1,
            cooldown: 120000 // 2 minutes
        },
        {
            name: 'critical_response_time',
            condition: (health) => health.response_time > 30000, // 30s
            level: 'moderate',
            priority: 2,
            cooldown: 60000
        },
        {
            name: 'high_error_rate',
            condition: (health) => health.error_rate > 10, // 10%
            level: 'minimal',
            priority: 1,
            cooldown: 180000 // 3 minutes
        },
        {
            name: 'critical_error_rate',
            condition: (health) => health.error_rate > 25, // 25%
            level: 'moderate',
            priority: 2,
            cooldown: 60000
        },
        {
            name: 'database_lag',
            condition: (health) => health.database_lag > 5000, // 5s
            level: 'moderate',
            priority: 2,
            cooldown: 120000
        },
        {
            name: 'queue_overload',
            condition: (health) => health.queue_depth > 1000,
            level: 'minimal',
            priority: 1,
            cooldown: 60000
        },
        {
            name: 'cache_miss_rate',
            condition: (health) => health.cache_hit_rate < 50, // Less than 50% hit rate
            level: 'minimal',
            priority: 1,
            cooldown: 300000 // 5 minutes
        }
    ];

    private constructor() {
        super();
        this.currentStrategy = this.strategies.none;
        this.systemHealth = this.getInitialSystemHealth();
        this.startMonitoring();
    }

    public static getInstance(): GracefulDegradationService {
        if (!GracefulDegradationService.instance) {
            GracefulDegradationService.instance = new GracefulDegradationService();
        }
        return GracefulDegradationService.instance;
    }

    /**
     * Check if a feature is enabled in current degradation mode
     */
    public isFeatureEnabled(feature: keyof DegradationStrategy['features']): boolean {
        return this.currentStrategy.features[feature];
    }

    /**
     * Check if request should be processed based on current limits
     */
    public shouldProcessRequest(requestSize: number, estimatedTime: number): {
        allowed: boolean;
        reason?: string;
        fallback?: string;
    } {
        const limits = this.currentStrategy.limits;
        
        if (requestSize > limits.max_request_size) {
            return {
                allowed: false,
                reason: 'Request size exceeds current limit',
                fallback: 'try_cache'
            };
        }
        
        if (estimatedTime > limits.max_response_time) {
            return {
                allowed: false,
                reason: 'Estimated processing time exceeds limit',
                fallback: 'simplified_response'
            };
        }
        
        return { allowed: true };
    }

    /**
     * Get fallback response for a request
     */
    public async getFallbackResponse(
        endpoint: string,
        method: string,
        params: any = {}
    ): Promise<{ success: boolean; data?: any; source: string }> {
        const fallbacks = this.currentStrategy.fallbacks;
        
        // Try cache first if enabled
        if (fallbacks.use_cache) {
            const cacheResult = await this.tryCache(endpoint, method, params);
            if (cacheResult.success) {
                return { ...cacheResult, source: 'cache' };
            }
        }
        
        // Try simplified response
        if (fallbacks.simplified_responses) {
            const simplifiedResult = await this.getSimplifiedResponse(endpoint, method, params);
            if (simplifiedResult.success) {
                return { ...simplifiedResult, source: 'simplified' };
            }
        }
        
        // Try static data
        if (fallbacks.static_data) {
            const staticResult = await this.getStaticData(endpoint, method, params);
            if (staticResult.success) {
                return { ...staticResult, source: 'static' };
            }
        }
        
        // Offline mode response
        if (fallbacks.offline_mode) {
            return {
                success: true,
                data: {
                    message: 'Service is temporarily in offline mode',
                    mode: this.currentMode,
                    level: this.currentLevel,
                    retry_after: 300 // 5 minutes
                },
                source: 'offline'
            };
        }
        
        return { success: false, source: 'none' };
    }

    /**
     * Force degradation to specific level
     */
    public async setDegradationLevel(
        level: DegradationLevel,
        reason: string = 'Manual override'
    ): Promise<void> {
        const previousLevel = this.currentLevel;
        
        this.currentLevel = level;
        this.currentStrategy = this.strategies[level];
        this.currentMode = this.currentStrategy.mode;
        
        // Record in history
        this.degradationHistory.push({
            level,
            timestamp: Date.now(),
            reason
        });
        
        // Keep history size manageable
        if (this.degradationHistory.length > this.MAX_HISTORY_SIZE) {
            this.degradationHistory = this.degradationHistory.slice(-this.MAX_HISTORY_SIZE);
        }
        
        // Cache the current state
        await this.cacheCurrentState();
        
        loggingService.warn('Degradation level changed', {
            component: 'GracefulDegradationService',
            previousLevel,
            newLevel: level,
            reason,
            mode: this.currentMode
        });
        
        // Emit event
        this.emit('degradation_changed', {
            previousLevel,
            newLevel: level,
            reason,
            mode: this.currentMode,
            strategy: this.currentStrategy
        });
    }

    /**
     * Check and apply automatic degradation based on system health
     */
    public async checkAndApplyDegradation(): Promise<void> {
        const health = await this.updateSystemHealth();
        const now = Date.now();
        
        // Find applicable triggers
        const applicableTriggers = this.triggers
            .filter(trigger => {
                // Check cooldown
                if (trigger.lastTriggered && (now - trigger.lastTriggered) < trigger.cooldown) {
                    return false;
                }
                
                // Check condition
                return trigger.condition(health);
            })
            .sort((a, b) => b.priority - a.priority); // Sort by priority descending
        
        if (applicableTriggers.length > 0) {
            const trigger = applicableTriggers[0];
            trigger.lastTriggered = now;
            
            // Only degrade if new level is more severe
            const currentLevelIndex = this.getLevelIndex(this.currentLevel);
            const triggerLevelIndex = this.getLevelIndex(trigger.level);
            
            if (triggerLevelIndex > currentLevelIndex) {
                await this.setDegradationLevel(
                    trigger.level,
                    `Automatic degradation: ${trigger.name}`
                );
            }
        } else {
            // Check if we can recover to a better level
            await this.checkRecovery(health);
        }
    }

    /**
     * Check if system can recover to better degradation level
     */
    private async checkRecovery(health: SystemHealth): Promise<void> {
        if (this.currentLevel === 'none') {
            return; // Already at best level
        }
        
        const now = Date.now();
        const currentLevelIndex = this.getLevelIndex(this.currentLevel);
        
        // Check if we can move to a better level
        const levels: DegradationLevel[] = ['none', 'minimal', 'moderate', 'aggressive', 'emergency'];
        
        for (let i = 0; i < currentLevelIndex; i++) {
            const testLevel = levels[i];
            const canRecover = this.canRecoverToLevel(testLevel, health);
            
            if (canRecover) {
                // Wait a bit before recovering to avoid oscillation
                const lastChange = this.degradationHistory[this.degradationHistory.length - 1];
                if (lastChange && (now - lastChange.timestamp) > 120000) { // 2 minutes
                    await this.setDegradationLevel(testLevel, 'Automatic recovery');
                    break;
                }
            }
        }
    }

    /**
     * Check if system can recover to specific level
     */
    private canRecoverToLevel(level: DegradationLevel, health: SystemHealth): boolean {
        // Define recovery thresholds (more conservative than degradation thresholds)
        const recoveryThresholds = {
            none: {
                cpu_usage: 60,
                memory_usage: 70,
                response_time: 2000,
                error_rate: 2,
                database_lag: 1000
            },
            minimal: {
                cpu_usage: 70,
                memory_usage: 80,
                response_time: 5000,
                error_rate: 5,
                database_lag: 2000
            },
            moderate: {
                cpu_usage: 80,
                memory_usage: 85,
                response_time: 8000,
                error_rate: 8,
                database_lag: 3000
            },
            aggressive: {
                cpu_usage: 90,
                memory_usage: 95,
                response_time: 15000,
                error_rate: 15,
                database_lag: 4000
            }
        };
        
        const thresholds = recoveryThresholds[level as keyof typeof recoveryThresholds];
        if (!thresholds) return false;
        
        return health.cpu_usage < thresholds.cpu_usage &&
               health.memory_usage < thresholds.memory_usage &&
               health.response_time < thresholds.response_time &&
               health.error_rate < thresholds.error_rate &&
               health.database_lag < thresholds.database_lag;
    }

    /**
     * Get current degradation status
     */
    public getStatus(): {
        level: DegradationLevel;
        mode: ServiceMode;
        strategy: DegradationStrategy;
        health: SystemHealth;
        history: Array<{ level: DegradationLevel; timestamp: number; reason: string }>;
    } {
        return {
            level: this.currentLevel,
            mode: this.currentMode,
            strategy: this.currentStrategy,
            health: this.systemHealth,
            history: this.degradationHistory.slice(-10) // Last 10 entries
        };
    }

    /**
     * Start system health monitoring
     */
    private startMonitoring(): void {
        this.monitoringInterval = setInterval(async () => {
            try {
                await this.checkAndApplyDegradation();
            } catch (error) {
                loggingService.error('Error in degradation monitoring', {
                    component: 'GracefulDegradationService',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }, this.MONITORING_INTERVAL);
    }

    /**
     * Update system health metrics
     */
    private async updateSystemHealth(): Promise<SystemHealth> {
        try {
            // Get system metrics
            const adaptiveStats = await adaptiveRateLimitService.getStatistics();
            
            // Get additional metrics from cache
            const queueStats = await cacheService.get('request_prioritization_stats') || {};
            const dbMetrics = await cacheService.get('database_metrics') || {};
            const cacheMetrics = await cacheService.get('cache_metrics') || {};
            
            this.systemHealth = {
                cpu_usage: adaptiveStats.systemLoad.cpuUsage,
                memory_usage: adaptiveStats.systemLoad.memoryUsage,
                response_time: adaptiveStats.systemLoad.responseTime,
                error_rate: adaptiveStats.systemLoad.errorRate,
                active_connections: adaptiveStats.systemLoad.activeConnections,
                queue_depth: (queueStats as any).total || 0,
                database_lag: (dbMetrics as any).lag || 0,
                cache_hit_rate: (cacheMetrics as any).hitRate || 100,
                timestamp: Date.now()
            };
            
            return this.systemHealth;
        } catch (error) {
            loggingService.debug('Failed to update system health', {
                component: 'GracefulDegradationService',
                error: error instanceof Error ? error.message : String(error)
            });
            return this.systemHealth;
        }
    }

    /**
     * Cache current degradation state
     */
    private async cacheCurrentState(): Promise<void> {
        try {
            const state = {
                level: this.currentLevel,
                mode: this.currentMode,
                strategy: this.currentStrategy,
                timestamp: Date.now()
            };
            
            await cacheService.set('degradation_state', state, 300); // 5 minutes TTL
        } catch (error) {
            loggingService.debug('Failed to cache degradation state', {
                component: 'GracefulDegradationService',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    // Helper methods for fallback responses
    private async tryCache(endpoint: string, method: string, params: any): Promise<{ success: boolean; data?: any }> {
        try {
            const cacheKey = `fallback:${method}:${endpoint}:${JSON.stringify(params)}`;
            const cached = await cacheService.get(cacheKey);
            
            if (cached) {
                return { success: true, data: cached };
            }
        } catch (error) {
            // Cache miss or error
        }
        
        return { success: false };
    }

    private getSimplifiedResponse(endpoint: string, _method: string, _params: any): Promise<{ success: boolean; data?: any }> {
        // Return simplified versions of common endpoints
        const simplifiedResponses: Record<string, any> = {
            '/api/dashboard': {
                message: 'Dashboard data temporarily simplified',
                basic_stats: { users: 'N/A', requests: 'N/A', cost: 'N/A' },
                mode: 'simplified'
            },
            '/api/analytics': {
                message: 'Analytics temporarily unavailable',
                basic_data: { trend: 'stable' },
                mode: 'simplified'
            },
            '/api/reports': {
                message: 'Detailed reports temporarily unavailable',
                summary: 'System is under high load',
                mode: 'simplified'
            }
        };
        
        for (const path in simplifiedResponses) {
            if (endpoint.startsWith(path)) {
                return Promise.resolve({ success: true, data: simplifiedResponses[path] });
            }
        }
        
        return Promise.resolve({ success: false });
    }

    private getStaticData(endpoint: string, _method: string, _params: any): Promise<{ success: boolean; data?: any }> {
        // Return static data for common endpoints
        const staticData: Record<string, any> = {
            '/api/health': {
                status: 'degraded',
                mode: this.currentMode,
                level: this.currentLevel
            },
            '/api/status': {
                operational: true,
                mode: 'degraded',
                message: 'Service is operating in degraded mode'
            }
        };
        
        if (staticData[endpoint]) {
            return Promise.resolve({ success: true, data: staticData[endpoint] });
        }
        
        return Promise.resolve({ success: false });
    }

    private getLevelIndex(level: DegradationLevel): number {
        const levels: DegradationLevel[] = ['none', 'minimal', 'moderate', 'aggressive', 'emergency'];
        return levels.indexOf(level);
    }

    private getInitialSystemHealth(): SystemHealth {
        return {
            cpu_usage: 0,
            memory_usage: 0,
            response_time: 0,
            error_rate: 0,
            active_connections: 0,
            queue_depth: 0,
            database_lag: 0,
            cache_hit_rate: 100,
            timestamp: Date.now()
        };
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
    }

    /**
     * Get degradation statistics
     */
    public getStatistics(): any {
        const now = Date.now();
        const recentHistory = this.degradationHistory.filter(
            entry => now - entry.timestamp < 3600000 // Last hour
        );
        
        return {
            current: {
                level: this.currentLevel,
                mode: this.currentMode,
                uptime: now - (this.degradationHistory[0]?.timestamp || now)
            },
            health: this.systemHealth,
            history: {
                total_changes: this.degradationHistory.length,
                recent_changes: recentHistory.length,
                levels_used: [...new Set(this.degradationHistory.map(h => h.level))]
            },
            features: this.currentStrategy.features,
            limits: this.currentStrategy.limits
        };
    }
}

// Export singleton instance
export const gracefulDegradationService = GracefulDegradationService.getInstance();
