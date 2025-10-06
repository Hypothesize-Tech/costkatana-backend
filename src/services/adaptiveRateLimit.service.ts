import { cacheService } from './cache.service';
import { loggingService } from './logging.service';
import { redisService } from './redis.service';
import * as os from 'os';

/**
 * Adaptive Rate Limiting Service
 * Dynamically adjusts rate limits based on system load, traffic patterns, and performance metrics
 */

export interface SystemLoad {
    cpuUsage: number;
    memoryUsage: number;
    loadAverage: number;
    activeConnections: number;
    responseTime: number;
    errorRate: number;
    timestamp: number;
}

export interface TrafficPattern {
    requestsPerSecond: number;
    peakRequestsPerSecond: number;
    averageResponseTime: number;
    errorRate: number;
    uniqueUsers: number;
    timestamp: number;
    windowSize: number;
}

export interface AdaptiveRateLimitConfig {
    baseLimit: number;
    minLimit: number;
    maxLimit: number;
    scalingFactor: number;
    loadThreshold: {
        cpu: number;
        memory: number;
        responseTime: number;
        errorRate: number;
    };
    adaptationWindow: number; // seconds
    predictionWindow: number; // seconds
}

export interface RateLimitDecision {
    allowed: boolean;
    currentLimit: number;
    adjustedLimit: number;
    systemLoad: number;
    trafficPressure: number;
    retryAfter?: number;
    reason: string;
}

export class AdaptiveRateLimitService {
    private static instance: AdaptiveRateLimitService;
    private systemLoadHistory: SystemLoad[] = [];
    private trafficPatternHistory: TrafficPattern[] = [];
    private rateLimitCache = new Map<string, { limit: number; lastUpdated: number }>();
    private readonly MAX_HISTORY_SIZE = 1000;
    private readonly LOAD_COLLECTION_INTERVAL = 5000; // 5 seconds
    private readonly ADAPTATION_INTERVAL = 30000; // 30 seconds
    private loadCollectionTimer?: NodeJS.Timeout;
    private adaptationTimer?: NodeJS.Timeout;

    // Default configuration
    private defaultConfig: AdaptiveRateLimitConfig = {
        baseLimit: 100,
        minLimit: 10,
        maxLimit: 1000,
        scalingFactor: 0.8,
        loadThreshold: {
            cpu: 70, // 70%
            memory: 80, // 80%
            responseTime: 2000, // 2 seconds
            errorRate: 5 // 5%
        },
        adaptationWindow: 300, // 5 minutes
        predictionWindow: 600 // 10 minutes
    };

    private constructor() {
        this.startSystemMonitoring();
        this.startAdaptationEngine();
    }

    public static getInstance(): AdaptiveRateLimitService {
        if (!AdaptiveRateLimitService.instance) {
            AdaptiveRateLimitService.instance = new AdaptiveRateLimitService();
        }
        return AdaptiveRateLimitService.instance;
    }

    /**
     * Check rate limit with adaptive scaling
     */
    public async checkRateLimit(
        key: string,
        config: Partial<AdaptiveRateLimitConfig> = {},
        metadata: { userId?: string; endpoint?: string; priority?: 'high' | 'medium' | 'low' } = {}
    ): Promise<RateLimitDecision> {
        const startTime = Date.now();
        const finalConfig = { ...this.defaultConfig, ...config };
        
        try {
            // Get current system state
            const currentLoad = await this.getCurrentSystemLoad();
            const trafficPressure = await this.calculateTrafficPressure(key);
            
            // Calculate adaptive limit
            const adaptedLimit = await this.calculateAdaptiveLimit(key, finalConfig, currentLoad, trafficPressure);
            
            // Check current usage
            const currentUsage = await this.getCurrentUsage(key);
            const allowed = currentUsage < adaptedLimit;
            
            // Record the decision
            await this.recordRateLimitDecision(key, {
                allowed,
                currentLimit: finalConfig.baseLimit,
                adjustedLimit: adaptedLimit,
                systemLoad: this.calculateSystemLoadScore(currentLoad),
                trafficPressure,
                timestamp: Date.now(),
                metadata
            });

            const decision: RateLimitDecision = {
                allowed,
                currentLimit: finalConfig.baseLimit,
                adjustedLimit: adaptedLimit,
                systemLoad: this.calculateSystemLoadScore(currentLoad),
                trafficPressure,
                reason: this.generateDecisionReason(allowed, currentLoad, trafficPressure, adaptedLimit)
            };

            if (!allowed) {
                // Calculate retry after based on current load and traffic
                decision.retryAfter = this.calculateRetryAfter(currentLoad, trafficPressure);
            }

            loggingService.info('Adaptive rate limit check completed', {
                component: 'AdaptiveRateLimitService',
                key,
                decision,
                duration: Date.now() - startTime
            });

            return decision;

        } catch (error) {
            loggingService.error('Adaptive rate limit check failed', {
                component: 'AdaptiveRateLimitService',
                key,
                error: error instanceof Error ? error.message : String(error),
                duration: Date.now() - startTime
            });

            // Fallback to base limit on error
            const currentUsage = await this.getCurrentUsage(key);
            return {
                allowed: currentUsage < finalConfig.baseLimit,
                currentLimit: finalConfig.baseLimit,
                adjustedLimit: finalConfig.baseLimit,
                systemLoad: 0,
                trafficPressure: 0,
                reason: 'Fallback due to system error'
            };
        }
    }

    /**
     * Calculate adaptive limit based on system state
     */
    private async calculateAdaptiveLimit(
        key: string,
        config: AdaptiveRateLimitConfig,
        systemLoad: SystemLoad,
        trafficPressure: number
    ): Promise<number> {
        // Base calculation using system load
        let adaptiveFactor = 1.0;

        // CPU-based adjustment
        if (systemLoad.cpuUsage > config.loadThreshold.cpu) {
            const cpuPressure = (systemLoad.cpuUsage - config.loadThreshold.cpu) / (100 - config.loadThreshold.cpu);
            adaptiveFactor *= (1 - cpuPressure * config.scalingFactor);
        }

        // Memory-based adjustment
        if (systemLoad.memoryUsage > config.loadThreshold.memory) {
            const memoryPressure = (systemLoad.memoryUsage - config.loadThreshold.memory) / (100 - config.loadThreshold.memory);
            adaptiveFactor *= (1 - memoryPressure * config.scalingFactor);
        }

        // Response time-based adjustment
        if (systemLoad.responseTime > config.loadThreshold.responseTime) {
            const responsePressure = Math.min(systemLoad.responseTime / config.loadThreshold.responseTime - 1, 2);
            adaptiveFactor *= (1 - responsePressure * config.scalingFactor * 0.5);
        }

        // Error rate-based adjustment
        if (systemLoad.errorRate > config.loadThreshold.errorRate) {
            const errorPressure = (systemLoad.errorRate - config.loadThreshold.errorRate) / 50; // Max 50% error rate
            adaptiveFactor *= (1 - errorPressure * config.scalingFactor);
        }

        // Traffic pressure adjustment
        adaptiveFactor *= (1 - trafficPressure * 0.3); // Max 30% reduction for traffic pressure

        // Apply the factor to base limit
        let adaptedLimit = Math.floor(config.baseLimit * Math.max(adaptiveFactor, 0.1));

        // Enforce min/max bounds
        adaptedLimit = Math.max(config.minLimit, Math.min(config.maxLimit, adaptedLimit));

        // Smooth the adaptation to prevent rapid oscillations
        const cachedLimit = this.rateLimitCache.get(key);
        if (cachedLimit && Date.now() - cachedLimit.lastUpdated < 60000) { // 1 minute smoothing
            const smoothingFactor = 0.7; // 70% of new limit, 30% of old
            adaptedLimit = Math.floor(adaptedLimit * smoothingFactor + cachedLimit.limit * (1 - smoothingFactor));
        }

        // Cache the new limit
        this.rateLimitCache.set(key, { limit: adaptedLimit, lastUpdated: Date.now() });

        return adaptedLimit;
    }

    /**
     * Get current system load metrics
     */
    private async getCurrentSystemLoad(): Promise<SystemLoad> {
        const cpus = os.cpus();
        const loadAvg = os.loadavg();
        const memUsage = process.memoryUsage();
        const totalMem = os.totalmem();

        // Calculate CPU usage (approximation based on load average)
        const cpuUsage = Math.min((loadAvg[0] / cpus.length) * 100, 100);
        
        // Calculate memory usage percentage
        const memoryUsage = (memUsage.rss / totalMem) * 100;

        // Get response time from recent metrics (if available)
        const responseTime = await this.getAverageResponseTime();

        // Get error rate from recent metrics
        const errorRate = await this.getRecentErrorRate();

        // Get active connections (approximation)
        const activeConnections = await this.getActiveConnectionCount();

        return {
            cpuUsage,
            memoryUsage,
            loadAverage: loadAvg[0],
            activeConnections,
            responseTime,
            errorRate,
            timestamp: Date.now()
        };
    }

    /**
     * Calculate traffic pressure for a given key
     */
    private async calculateTrafficPressure(key: string): Promise<number> {
        try {
            // Get recent request patterns
            const recentPattern = await this.getRecentTrafficPattern(key);
            if (!recentPattern) return 0;

            // Calculate pressure based on:
            // 1. Current RPS vs historical average
            // 2. Response time degradation
            // 3. Error rate increase

            let pressure = 0;

            // RPS pressure (if current is 2x average, pressure = 0.5)
            const historicalAvg = await this.getHistoricalAverageRPS(key);
            if (historicalAvg > 0) {
                const rpsRatio = recentPattern.requestsPerSecond / historicalAvg;
                pressure += Math.min((rpsRatio - 1) * 0.5, 1);
            }

            // Response time pressure
            const historicalResponseTime = await this.getHistoricalAverageResponseTime(key);
            if (historicalResponseTime > 0) {
                const responseRatio = recentPattern.averageResponseTime / historicalResponseTime;
                pressure += Math.min((responseRatio - 1) * 0.3, 0.5);
            }

            // Error rate pressure
            const historicalErrorRate = await this.getHistoricalAverageErrorRate(key);
            if (recentPattern.errorRate > historicalErrorRate + 1) {
                pressure += Math.min((recentPattern.errorRate - historicalErrorRate) / 10, 0.3);
            }

            return Math.min(pressure, 1); // Cap at 1.0

        } catch (error) {
            loggingService.warn('Failed to calculate traffic pressure', {
                component: 'AdaptiveRateLimitService',
                key,
                error: error instanceof Error ? error.message : String(error)
            });
            return 0;
        }
    }

    /**
     * Get current usage for a key
     */
    private async getCurrentUsage(key: string): Promise<number> {
        try {
            const cacheKey = `adaptive_rate_limit:${key}`;
            const usage = await cacheService.get(cacheKey);
            return usage ? (usage as any).count || 0 : 0;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Record rate limit decision for analytics
     */
    private async recordRateLimitDecision(key: string, decision: any): Promise<void> {
        try {
            const analyticsKey = `rate_limit_analytics:${key}`;
            const analytics = await cacheService.get(analyticsKey) || { decisions: [] };
            
            (analytics as any).decisions.push(decision);
            
            // Keep only last 100 decisions
            if ((analytics as any).decisions.length > 100) {
                (analytics as any).decisions = (analytics as any).decisions.slice(-100);
            }
            
            await cacheService.set(analyticsKey, analytics, 3600); // 1 hour TTL
        } catch (error) {
            // Non-critical, just log
            loggingService.debug('Failed to record rate limit analytics', {
                component: 'AdaptiveRateLimitService',
                key,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Start system monitoring
     */
    private startSystemMonitoring(): void {
        this.loadCollectionTimer = setInterval(async () => {
            try {
                const systemLoad = await this.getCurrentSystemLoad();
                this.systemLoadHistory.push(systemLoad);
                
                // Keep history size manageable
                if (this.systemLoadHistory.length > this.MAX_HISTORY_SIZE) {
                    this.systemLoadHistory = this.systemLoadHistory.slice(-this.MAX_HISTORY_SIZE);
                }

                // Store in Redis for distributed access
                await cacheService.set('system_load_current', systemLoad, 30);
                
            } catch (error) {
                loggingService.warn('System load collection failed', {
                    component: 'AdaptiveRateLimitService',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }, this.LOAD_COLLECTION_INTERVAL);
    }

    /**
     * Start adaptation engine
     */
    private startAdaptationEngine(): void {
        this.adaptationTimer = setInterval(async () => {
            try {
                await this.performAdaptation();
            } catch (error) {
                loggingService.error('Adaptation engine failed', {
                    component: 'AdaptiveRateLimitService',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }, this.ADAPTATION_INTERVAL);
    }

    /**
     * Perform system-wide rate limit adaptation
     */
    private async performAdaptation(): Promise<void> {
        // Analyze system trends
        const systemTrend = this.analyzeSystemTrend();
        const trafficTrend = await this.analyzeTrafficTrend();
        
        // Predict future load
        const predictedLoad = this.predictFutureLoad();
        
        // Adjust global parameters if needed
        if (predictedLoad > 0.8) {
            loggingService.info('High load predicted, preparing adaptive measures', {
                component: 'AdaptiveRateLimitService',
                predictedLoad,
                systemTrend,
                trafficTrend
            });
            
            // Could trigger pre-emptive measures here
            await this.prepareForHighLoad();
        }
    }

    // Helper methods
    private calculateSystemLoadScore(load: SystemLoad): number {
        return (load.cpuUsage + load.memoryUsage + Math.min(load.responseTime / 100, 100)) / 3;
    }

    private generateDecisionReason(allowed: boolean, load: SystemLoad, pressure: number, limit: number): string {
        if (allowed) {
            return `Request allowed. Adaptive limit: ${limit}`;
        }
        
        const reasons = [];
        if (load.cpuUsage > 70) reasons.push(`high CPU (${load.cpuUsage.toFixed(1)}%)`);
        if (load.memoryUsage > 80) reasons.push(`high memory (${load.memoryUsage.toFixed(1)}%)`);
        if (pressure > 0.5) reasons.push(`high traffic pressure (${(pressure * 100).toFixed(1)}%)`);
        
        return `Request denied due to ${reasons.length ? reasons.join(', ') : 'rate limit exceeded'}. Adaptive limit: ${limit}`;
    }

    private calculateRetryAfter(load: SystemLoad, pressure: number): number {
        // Base retry time of 60 seconds, adjusted by load
        let retryAfter = 60;
        
        // Increase based on system load
        const loadFactor = this.calculateSystemLoadScore(load) / 100;
        retryAfter += Math.floor(loadFactor * 120); // Up to 2 minutes additional
        
        // Increase based on traffic pressure
        retryAfter += Math.floor(pressure * 60); // Up to 1 minute additional
        
        return Math.min(retryAfter, 300); // Cap at 5 minutes
    }

    // Dynamic methods integrated with actual system telemetry
    private async getAverageResponseTime(): Promise<number> {
        try {
            // Get from telemetry service or calculate from recent requests
            const telemetryData = await cacheService.get('telemetry_performance_metrics');
            if (telemetryData) {
                const metrics = telemetryData as any;
                return metrics.averageResponseTime || 500;
            }
            
            // Fallback: calculate from request history
            const recentRequests = await cacheService.get('recent_request_metrics');
            if (recentRequests) {
                const requests = recentRequests as any[];
                const responseTimes = requests
                    .filter(req => req.responseTime && Date.now() - req.timestamp < 300000) // Last 5 minutes
                    .map(req => req.responseTime);
                
                if (responseTimes.length > 0) {
                    return responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
                }
            }
            
            return 500; // Default 500ms
        } catch {
            return 500;
        }
    }

    private async getRecentErrorRate(): Promise<number> {
        try {
            // Get from telemetry or calculate from recent events
            const errorMetrics = await cacheService.get('error_rate_metrics');
            if (errorMetrics) {
                return (errorMetrics as any).rate || 0;
            }
            
            // Calculate from recent requests
            const recentRequests = await cacheService.get('recent_request_metrics');
            if (recentRequests) {
                const requests = recentRequests as any[];
                const recentReqs = requests.filter(req => Date.now() - req.timestamp < 300000); // Last 5 minutes
                const errorReqs = recentReqs.filter(req => req.statusCode >= 400);
                
                return recentReqs.length > 0 ? (errorReqs.length / recentReqs.length) * 100 : 0;
            }
            
            return 0;
        } catch {
            return 0;
        }
    }

    private async getActiveConnectionCount(): Promise<number> {
        try {
            // Get from connection pool or estimate from active requests
            const connectionMetrics = await cacheService.get('connection_pool_metrics');
            if (connectionMetrics) {
                return (connectionMetrics as any).active || 0;
            }
            
            // Estimate from rate limit records
            const rateLimitKeys = await this.getActiveRateLimitKeys();
            return rateLimitKeys.length;
        } catch {
            return 0;
        }
    }

    private async getActiveRateLimitKeys(): Promise<string[]> {
        try {
            // Get all active rate limit keys from cache
            const activeKeys = await cacheService.get('active_rate_limit_keys') || [];
            return activeKeys as string[];
        } catch {
            return [];
        }
    }

    private async getRecentTrafficPattern(key: string): Promise<TrafficPattern | null> {
        try {
            // Get recent traffic pattern or calculate from rate limit history
            const pattern = await cacheService.get(`traffic_pattern:${key}`);
            if (pattern) return pattern as TrafficPattern;
            
            // Calculate pattern from recent rate limit activity
            const rateLimitRecord = await cacheService.get(`adaptive_rate_limit:${key}`);
            if (rateLimitRecord) {
                const record = rateLimitRecord as any;
                return {
                    requestsPerSecond: record.count || 0,
                    peakRequestsPerSecond: record.peakCount || 0,
                    averageResponseTime: 500,
                    errorRate: 0,
                    uniqueUsers: 1,
                    timestamp: Date.now(),
                    windowSize: 60
                };
            }
            
            return null;
        } catch {
            return null;
        }
    }

    private async getHistoricalAverageRPS(key: string): Promise<number> {
        try {
            // Get historical RPS data or calculate from usage patterns
            const historical = await cacheService.get(`historical_rps:${key}`);
            if (historical) return (historical as any).average || 1;
            
            // Calculate from recent rate limit usage
            const usageHistory = await cacheService.get(`rate_limit_usage_history:${key}`);
            if (usageHistory) {
                const history = usageHistory as any[];
                const avgUsage = history.reduce((sum, usage) => sum + (usage.count || 0), 0) / history.length;
                return Math.max(1, avgUsage / 60); // Convert per minute to per second
            }
            
            return 1;
        } catch {
            return 1;
        }
    }

    private async getHistoricalAverageResponseTime(key: string): Promise<number> {
        try {
            // Get historical response time data
            const historical = await cacheService.get(`historical_response_time:${key}`);
            if (historical) return (historical as any).average || 500;
            
            // Calculate from telemetry data
            const telemetryData = await cacheService.get('telemetry_performance_metrics');
            if (telemetryData) {
                return (telemetryData as any).averageResponseTime || 500;
            }
            
            return 500;
        } catch {
            return 500;
        }
    }

    private async getHistoricalAverageErrorRate(key: string): Promise<number> {
        try {
            // Get historical error rate data
            const historical = await cacheService.get(`historical_error_rate:${key}`);
            if (historical) return (historical as any).average || 0;
            
            // Calculate from recent request history
            const requestHistory = await cacheService.get(`request_history:${key}`);
            if (requestHistory) {
                const history = requestHistory as any[];
                const errorRequests = history.filter(req => req.statusCode >= 400);
                return history.length > 0 ? (errorRequests.length / history.length) * 100 : 0;
            }
            
            return 0;
        } catch {
            return 0;
        }
    }

    private analyzeSystemTrend(): 'improving' | 'stable' | 'degrading' {
        if (this.systemLoadHistory.length < 10) return 'stable';
        
        const recent = this.systemLoadHistory.slice(-10);
        const older = this.systemLoadHistory.slice(-20, -10);
        
        const recentAvg = recent.reduce((sum, load) => sum + this.calculateSystemLoadScore(load), 0) / recent.length;
        const olderAvg = older.reduce((sum, load) => sum + this.calculateSystemLoadScore(load), 0) / older.length;
        
        const difference = recentAvg - olderAvg;
        
        if (difference > 5) return 'degrading';
        if (difference < -5) return 'improving';
        return 'stable';
    }

    private async analyzeTrafficTrend(): Promise<'increasing' | 'stable' | 'decreasing'> {
        // Placeholder - would analyze traffic patterns from cache
        return 'stable';
    }

    private predictFutureLoad(): number {
        if (this.systemLoadHistory.length < 5) return 0.5;
        
        // Simple linear regression on recent load data
        const recent = this.systemLoadHistory.slice(-5);
        const loads = recent.map(load => this.calculateSystemLoadScore(load) / 100);
        
        // Calculate trend
        const n = loads.length;
        const sumX = n * (n - 1) / 2; // 0 + 1 + 2 + ... + (n-1)
        const sumY = loads.reduce((sum, load) => sum + load, 0);
        const sumXY = loads.reduce((sum, load, index) => sum + index * load, 0);
        const sumX2 = n * (n - 1) * (2 * n - 1) / 6; // 0² + 1² + 2² + ... + (n-1)²
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;
        
        // Predict load for next time period
        const predictedLoad = intercept + slope * n;
        
        return Math.max(0, Math.min(1, predictedLoad));
    }

    private async prepareForHighLoad(): Promise<void> {
        // Store high load state for other components
        await cacheService.set('system_high_load_predicted', true, 300); // 5 minutes
        
        loggingService.warn('System preparing for predicted high load', {
            component: 'AdaptiveRateLimitService',
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Get adaptive rate limiting statistics
     */
    public async getStatistics(): Promise<{
        systemLoad: SystemLoad;
        activeLimits: number;
        adaptationRate: number;
        averageAdjustment: number;
    }> {
        const systemLoad = await this.getCurrentSystemLoad();
        const activeLimits = this.rateLimitCache.size;
        
        // Calculate adaptation rate (how often limits are being adjusted)
        const recentAdjustments = Array.from(this.rateLimitCache.values())
            .filter(entry => Date.now() - entry.lastUpdated < 300000).length; // Last 5 minutes
        const adaptationRate = activeLimits > 0 ? recentAdjustments / activeLimits : 0;
        
        // Calculate average adjustment
        const adjustments = Array.from(this.rateLimitCache.values())
            .map(entry => entry.limit);
        const averageAdjustment = adjustments.length > 0 
            ? adjustments.reduce((sum, limit) => sum + limit, 0) / adjustments.length 
            : this.defaultConfig.baseLimit;
        
        return {
            systemLoad,
            activeLimits,
            adaptationRate,
            averageAdjustment
        };
    }

    /**
     * Cleanup resources
     */
    public cleanup(): void {
        if (this.loadCollectionTimer) {
            clearInterval(this.loadCollectionTimer);
            this.loadCollectionTimer = undefined;
        }
        
        if (this.adaptationTimer) {
            clearInterval(this.adaptationTimer);
            this.adaptationTimer = undefined;
        }
        
        this.systemLoadHistory = [];
        this.trafficPatternHistory = [];
        this.rateLimitCache.clear();
    }
}

// Export singleton instance
export const adaptiveRateLimitService = AdaptiveRateLimitService.getInstance();
