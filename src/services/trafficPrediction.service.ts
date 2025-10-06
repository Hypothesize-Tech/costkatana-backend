import { loggingService } from './logging.service';
import { cacheService } from './cache.service';
import { preemptiveThrottlingService } from './preemptiveThrottling.service';
import { gracefulDegradationService } from './gracefulDegradation.service';
import { requestPrioritizationService } from './requestPrioritization.service';
import { EventEmitter } from 'events';

/**
 * Traffic Spike Prediction and Preparation Service
 * Predicts traffic spikes and prepares the system proactively
 */

export interface TrafficDataPoint {
    timestamp: number;
    requests_per_second: number;
    unique_users: number;
    response_time: number;
    error_rate: number;
    cpu_usage: number;
    memory_usage: number;
    endpoint_distribution: Record<string, number>;
    user_tier_distribution: Record<string, number>;
    geographic_distribution: Record<string, number>;
}

export interface TrafficPrediction {
    predicted_rps: number;
    confidence: number;
    prediction_window: number; // seconds into the future
    spike_probability: number;
    spike_magnitude: number; // multiplier of normal traffic
    contributing_factors: string[];
    recommended_actions: PrepActionType[];
    timestamp: number;
}

export interface TrafficPattern {
    pattern_type: 'hourly' | 'daily' | 'weekly' | 'seasonal' | 'event_driven';
    pattern_name: string;
    typical_multiplier: number;
    duration_minutes: number;
    confidence: number;
    historical_occurrences: number;
    next_occurrence?: number; // timestamp
}

export type PrepActionType = 
    | 'increase_cache_ttl' 
    | 'pre_warm_cache' 
    | 'scale_rate_limits' 
    | 'enable_degradation' 
    | 'alert_team' 
    | 'prepare_cdn' 
    | 'optimize_queries'
    | 'increase_queue_capacity'
    | 'enable_aggressive_throttling'
    | 'notify_users';

export interface PreparationAction {
    type: PrepActionType;
    description: string;
    priority: number; // 1-10, 10 being highest
    estimated_impact: number; // 0-1, how much it helps
    implementation_time: number; // seconds to implement
    cost: number; // relative cost 0-1
    prerequisites: PrepActionType[];
    execute: () => Promise<boolean>;
    rollback: () => Promise<boolean>;
}

export interface SpikePredictionConfig {
    enable_prediction: boolean;
    prediction_interval: number; // seconds between predictions
    historical_window: number; // days of historical data to use
    min_confidence_threshold: number; // minimum confidence to act
    spike_threshold_multiplier: number; // multiplier to consider as spike
    pattern_detection_sensitivity: number; // 0-1, higher = more sensitive
    max_preparation_time: number; // seconds before predicted spike to start prep
    enable_automatic_preparation: boolean;
    enable_proactive_notifications: boolean;
}

export class TrafficPredictionService extends EventEmitter {
    private static instance: TrafficPredictionService;
    
    private trafficHistory: TrafficDataPoint[] = [];
    private detectedPatterns: TrafficPattern[] = [];
    private activePredictions: TrafficPrediction[] = [];
    private executedActions: Map<PrepActionType, { timestamp: number; success: boolean }> = new Map();
    
    private readonly MAX_HISTORY_SIZE = 10000; // ~1 week at 1 minute intervals
    private readonly MAX_PREDICTIONS = 100;
    
    // Configuration
    private config: SpikePredictionConfig = {
        enable_prediction: true,
        prediction_interval: 60, // 1 minute
        historical_window: 7, // 7 days
        min_confidence_threshold: 0.7,
        spike_threshold_multiplier: 2.0,
        pattern_detection_sensitivity: 0.8,
        max_preparation_time: 300, // 5 minutes
        enable_automatic_preparation: true,
        enable_proactive_notifications: true
    };
    
    // Monitoring
    private predictionInterval?: NodeJS.Timeout;
    private patternDetectionInterval?: NodeJS.Timeout;
    
    // Machine learning models (simplified)
    private models = {
        linear_regression: new LinearRegressionModel(),
        exponential_smoothing: new ExponentialSmoothingModel(),
        pattern_matching: new PatternMatchingModel()
    };
    
    // Statistics
    private stats = {
        predictions_made: 0,
        accurate_predictions: 0,
        false_positives: 0,
        missed_spikes: 0,
        actions_executed: 0,
        actions_successful: 0,
        average_prediction_accuracy: 0,
        last_spike_detected: 0,
        preparation_success_rate: 0
    };

    private constructor() {
        super();
        this.initializePredictionSystem();
    }

    public static getInstance(): TrafficPredictionService {
        if (!TrafficPredictionService.instance) {
            TrafficPredictionService.instance = new TrafficPredictionService();
        }
        return TrafficPredictionService.instance;
    }

    /**
     * Record traffic data point
     */
    public async recordTrafficData(dataPoint: Partial<TrafficDataPoint>): Promise<void> {
        try {
            const completeDataPoint: TrafficDataPoint = {
                timestamp: Date.now(),
                requests_per_second: 0,
                unique_users: 0,
                response_time: 0,
                error_rate: 0,
                cpu_usage: 0,
                memory_usage: 0,
                endpoint_distribution: {},
                user_tier_distribution: {},
                geographic_distribution: {},
                ...dataPoint
            };

            // Add to history
            this.trafficHistory.push(completeDataPoint);
            
            // Keep history size manageable
            if (this.trafficHistory.length > this.MAX_HISTORY_SIZE) {
                this.trafficHistory = this.trafficHistory.slice(-this.MAX_HISTORY_SIZE);
            }

            // Cache recent data for other services
            await cacheService.set('traffic_data_latest', completeDataPoint, 300);

            // Emit data event
            this.emit('traffic_data_recorded', completeDataPoint);

        } catch (error) {
            loggingService.error('Failed to record traffic data', {
                component: 'TrafficPredictionService',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Get current traffic predictions
     */
    public getCurrentPredictions(): TrafficPrediction[] {
        const now = Date.now();
        
        // Filter out expired predictions
        this.activePredictions = this.activePredictions.filter(
            prediction => (now - prediction.timestamp) < (prediction.prediction_window * 1000)
        );
        
        return [...this.activePredictions];
    }

    /**
     * Get detected traffic patterns
     */
    public getDetectedPatterns(): TrafficPattern[] {
        return [...this.detectedPatterns];
    }

    /**
     * Force traffic spike prediction (for testing)
     */
    public async forcePrediction(): Promise<TrafficPrediction | null> {
        if (this.trafficHistory.length < 10) {
            loggingService.warn('Insufficient data for traffic prediction', {
                component: 'TrafficPredictionService',
                data_points: this.trafficHistory.length
            });
            return null;
        }

        return this.generatePrediction();
    }

    /**
     * Initialize prediction system
     */
    private initializePredictionSystem(): void {
        // Start prediction loop
        this.predictionInterval = setInterval(async () => {
            try {
                if (this.config.enable_prediction) {
                    await this.runPredictionCycle();
                }
            } catch (error) {
                loggingService.error('Error in prediction cycle', {
                    component: 'TrafficPredictionService',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }, this.config.prediction_interval * 1000);

        // Start pattern detection
        this.patternDetectionInterval = setInterval(async () => {
            try {
                await this.detectTrafficPatterns();
            } catch (error) {
                loggingService.error('Error in pattern detection', {
                    component: 'TrafficPredictionService',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }, 300000); // Every 5 minutes

        loggingService.info('Traffic prediction system initialized', {
            component: 'TrafficPredictionService',
            config: this.config
        });
    }

    /**
     * Run prediction cycle
     */
    private async runPredictionCycle(): Promise<void> {
        if (this.trafficHistory.length < 10) {
            return; // Need minimum data points
        }

        // Generate prediction
        const prediction = await this.generatePrediction();
        
        if (prediction && prediction.confidence >= this.config.min_confidence_threshold) {
            // Add to active predictions
            this.activePredictions.push(prediction);
            
            // Keep predictions list manageable
            if (this.activePredictions.length > this.MAX_PREDICTIONS) {
                this.activePredictions = this.activePredictions.slice(-this.MAX_PREDICTIONS);
            }

            // Check if we need to prepare for spike
            if (prediction.spike_probability > 0.7 && prediction.spike_magnitude > this.config.spike_threshold_multiplier) {
                await this.prepareForPredictedSpike(prediction);
            }

            // Cache prediction
            await cacheService.set('traffic_prediction_latest', prediction, 300);

            // Emit prediction event
            this.emit('prediction_generated', prediction);

            loggingService.info('Traffic prediction generated', {
                component: 'TrafficPredictionService',
                predicted_rps: prediction.predicted_rps,
                spike_probability: prediction.spike_probability,
                spike_magnitude: prediction.spike_magnitude,
                confidence: prediction.confidence
            });
        }

        this.stats.predictions_made++;
    }

    /**
     * Generate traffic prediction using multiple models
     */
    private async generatePrediction(): Promise<TrafficPrediction | null> {
        try {
            const now = Date.now();
            const recentData = this.trafficHistory.slice(-60); // Last hour
            
            if (recentData.length < 10) return null;

            // Get predictions from different models
            const linearPrediction = this.models.linear_regression.predict(recentData);
            const smoothingPrediction = this.models.exponential_smoothing.predict(recentData);
            const patternPrediction = this.models.pattern_matching.predict(recentData, this.detectedPatterns);

            // Ensemble prediction (weighted average)
            const predictions = [
                { value: linearPrediction, weight: 0.3 },
                { value: smoothingPrediction, weight: 0.4 },
                { value: patternPrediction, weight: 0.3 }
            ];

            const weightedPrediction = predictions.reduce((sum, pred) => sum + pred.value * pred.weight, 0);
            const currentRps = recentData[recentData.length - 1].requests_per_second;
            
            // Calculate spike metrics
            const spike_magnitude = weightedPrediction / Math.max(currentRps, 1);
            const spike_probability = this.calculateSpikeProbability(recentData, weightedPrediction);
            
            // Calculate confidence based on model agreement
            const variance = predictions.reduce((sum, pred) => sum + Math.pow(pred.value - weightedPrediction, 2), 0) / predictions.length;
            const confidence = Math.max(0, 1 - (variance / Math.pow(weightedPrediction, 2)));

            // Identify contributing factors
            const contributing_factors = this.identifyContributingFactors(recentData);
            
            // Recommend actions
            const recommended_actions = this.recommendPreparationActions(spike_magnitude, spike_probability);

            return {
                predicted_rps: Math.round(weightedPrediction),
                confidence: Math.min(1, confidence),
                prediction_window: 300, // 5 minutes ahead
                spike_probability,
                spike_magnitude,
                contributing_factors,
                recommended_actions,
                timestamp: now
            };

        } catch (error) {
            loggingService.error('Failed to generate prediction', {
                component: 'TrafficPredictionService',
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }

    /**
     * Calculate spike probability
     */
    private calculateSpikeProbability(recentData: TrafficDataPoint[], predictedRps: number): number {
        const currentRps = recentData[recentData.length - 1].requests_per_second;
        const avgRps = recentData.reduce((sum, point) => sum + point.requests_per_second, 0) / recentData.length;
        
        // Factors that increase spike probability
        let probability = 0;
        
        // 1. Predicted increase vs current
        const increaseRatio = predictedRps / Math.max(currentRps, 1);
        if (increaseRatio > 1.5) {
            probability += 0.3 * Math.min((increaseRatio - 1) / 2, 1);
        }
        
        // 2. Recent trend analysis
        const trend = this.calculateTrend(recentData.map(d => d.requests_per_second));
        if (trend > 0) {
            probability += 0.2 * Math.min(trend / 10, 1);
        }
        
        // 3. Historical pattern matching
        const patternMatch = this.findMatchingPatterns(recentData);
        if (patternMatch.length > 0) {
            probability += 0.3 * patternMatch.reduce((sum, p) => sum + p.confidence, 0) / patternMatch.length;
        }
        
        // 4. System stress indicators
        const latestData = recentData[recentData.length - 1];
        if (latestData.error_rate > 2) {
            probability += 0.1;
        }
        if (latestData.response_time > 2000) {
            probability += 0.1;
        }
        
        return Math.min(1, probability);
    }

    /**
     * Identify contributing factors to traffic changes
     */
    private identifyContributingFactors(recentData: TrafficDataPoint[]): string[] {
        const factors: string[] = [];
        const latest = recentData[recentData.length - 1];
        const previous = recentData[recentData.length - 2];
        
        if (!previous) return factors;
        
        // Analyze changes
        if (latest.unique_users > previous.unique_users * 1.2) {
            factors.push('Increased unique user activity');
        }
        
        if (latest.error_rate > previous.error_rate * 1.5) {
            factors.push('Rising error rates');
        }
        
        if (latest.response_time > previous.response_time * 1.3) {
            factors.push('Degrading response times');
        }
        
        // Check endpoint distribution changes
        const endpointChanges = this.analyzeEndpointChanges(latest.endpoint_distribution, previous.endpoint_distribution);
        if (endpointChanges.length > 0) {
            factors.push(...endpointChanges);
        }
        
        // Time-based factors
        const hour = new Date(latest.timestamp).getHours();
        if (hour >= 9 && hour <= 17) {
            factors.push('Business hours traffic');
        }
        
        return factors;
    }

    /**
     * Analyze endpoint distribution changes
     */
    private analyzeEndpointChanges(current: Record<string, number>, previous: Record<string, number>): string[] {
        const changes: string[] = [];
        
        for (const [endpoint, currentCount] of Object.entries(current)) {
            const previousCount = previous[endpoint] || 0;
            if (currentCount > previousCount * 2) {
                changes.push(`Spike in ${endpoint} requests`);
            }
        }
        
        return changes;
    }

    /**
     * Recommend preparation actions
     */
    private recommendPreparationActions(spike_magnitude: number, spike_probability: number): PrepActionType[] {
        const actions: PrepActionType[] = [];
        
        if (spike_probability > 0.5) {
            actions.push('pre_warm_cache');
            actions.push('increase_cache_ttl');
        }
        
        if (spike_magnitude > 2.0) {
            actions.push('scale_rate_limits');
            actions.push('increase_queue_capacity');
        }
        
        if (spike_magnitude > 3.0) {
            actions.push('enable_degradation');
            actions.push('enable_aggressive_throttling');
        }
        
        if (spike_probability > 0.8 && spike_magnitude > 2.5) {
            actions.push('alert_team');
            actions.push('notify_users');
        }
        
        return actions;
    }

    /**
     * Prepare for predicted traffic spike
     */
    private async prepareForPredictedSpike(prediction: TrafficPrediction): Promise<void> {
        loggingService.warn('Preparing for predicted traffic spike', {
            component: 'TrafficPredictionService',
            predicted_rps: prediction.predicted_rps,
            spike_magnitude: prediction.spike_magnitude,
            spike_probability: prediction.spike_probability,
            confidence: prediction.confidence
        });

        if (!this.config.enable_automatic_preparation) {
            // Just emit event for manual handling
            this.emit('spike_predicted', prediction);
            return;
        }

        // Execute recommended actions
        const actions = this.getPreparationActions();
        const relevantActions = actions.filter(action => 
            prediction.recommended_actions.includes(action.type)
        );

        // Sort by priority and execute
        relevantActions.sort((a, b) => b.priority - a.priority);

        for (const action of relevantActions) {
            try {
                const success = await this.executePreparationAction(action);
                this.stats.actions_executed++;
                
                if (success) {
                    this.stats.actions_successful++;
                    loggingService.info('Preparation action executed successfully', {
                        component: 'TrafficPredictionService',
                        action: action.type,
                        description: action.description
                    });
                } else {
                    loggingService.warn('Preparation action failed', {
                        component: 'TrafficPredictionService',
                        action: action.type,
                        description: action.description
                    });
                }
            } catch (error) {
                loggingService.error('Error executing preparation action', {
                    component: 'TrafficPredictionService',
                    action: action.type,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }

        // Cache preparation status
        await cacheService.set('spike_preparation_status', {
            prediction,
            actions_executed: relevantActions.length,
            timestamp: Date.now()
        }, 3600);

        // Emit preparation complete event
        this.emit('spike_preparation_complete', {
            prediction,
            actions_executed: relevantActions.length,
            success_rate: this.stats.actions_successful / this.stats.actions_executed
        });
    }

    /**
     * Execute preparation action
     */
    private async executePreparationAction(action: PreparationAction): Promise<boolean> {
        const startTime = Date.now();
        
        try {
            // Check prerequisites
            for (const prerequisite of action.prerequisites) {
                const prereqExecuted = this.executedActions.get(prerequisite);
                if (!prereqExecuted || !prereqExecuted.success) {
                    loggingService.warn('Prerequisite not met for action', {
                        component: 'TrafficPredictionService',
                        action: action.type,
                        prerequisite
                    });
                    return false;
                }
            }

            // Execute the action
            const success = await action.execute();
            
            // Record execution
            this.executedActions.set(action.type, {
                timestamp: startTime,
                success
            });

            return success;

        } catch (error) {
            loggingService.error('Action execution failed', {
                component: 'TrafficPredictionService',
                action: action.type,
                error: error instanceof Error ? error.message : String(error),
                duration: Date.now() - startTime
            });
            
            this.executedActions.set(action.type, {
                timestamp: startTime,
                success: false
            });
            
            return false;
        }
    }

    /**
     * Get available preparation actions
     */
    private getPreparationActions(): PreparationAction[] {
        return [
            {
                type: 'increase_cache_ttl',
                description: 'Increase cache TTL to reduce database load',
                priority: 7,
                estimated_impact: 0.6,
                implementation_time: 5,
                cost: 0.1,
                prerequisites: [],
                execute: async () => {
                    // Increase cache TTL across the system
                    await cacheService.set('cache_ttl_multiplier', 2.0, 3600);
                    return true;
                },
                rollback: async () => {
                    await cacheService.delete('cache_ttl_multiplier');
                    return true;
                }
            },
            {
                type: 'pre_warm_cache',
                description: 'Pre-warm frequently accessed cache entries',
                priority: 8,
                estimated_impact: 0.7,
                implementation_time: 30,
                cost: 0.2,
                prerequisites: [],
                execute: async () => {
                    // Trigger cache warming for common endpoints
                    await cacheService.set('cache_warming_active', true, 3600);
                    return true;
                },
                rollback: async () => {
                    await cacheService.delete('cache_warming_active');
                    return true;
                }
            },
            {
                type: 'scale_rate_limits',
                description: 'Temporarily increase rate limits for normal users',
                priority: 6,
                estimated_impact: 0.5,
                implementation_time: 10,
                cost: 0.3,
                prerequisites: [],
                execute: async () => {
                    // Increase rate limits temporarily
                    await cacheService.set('rate_limit_scale_factor', 1.5, 3600);
                    return true;
                },
                rollback: async () => {
                    await cacheService.delete('rate_limit_scale_factor');
                    return true;
                }
            },
            {
                type: 'enable_degradation',
                description: 'Enable graceful degradation to minimal mode',
                priority: 9,
                estimated_impact: 0.8,
                implementation_time: 5,
                cost: 0.5,
                prerequisites: [],
                execute: async () => {
                    await gracefulDegradationService.setDegradationLevel('minimal', 'Predicted traffic spike');
                    return true;
                },
                rollback: async () => {
                    await gracefulDegradationService.setDegradationLevel('none', 'Spike preparation rollback');
                    return true;
                }
            },
            {
                type: 'enable_aggressive_throttling',
                description: 'Enable aggressive throttling for background requests',
                priority: 8,
                estimated_impact: 0.7,
                implementation_time: 5,
                cost: 0.4,
                prerequisites: [],
                execute: async () => {
                    await preemptiveThrottlingService.forcePhaseChange('caution', 'Predicted traffic spike');
                    return true;
                },
                rollback: async () => {
                    await preemptiveThrottlingService.forcePhaseChange('normal', 'Spike preparation rollback');
                    return true;
                }
            },
            {
                type: 'increase_queue_capacity',
                description: 'Increase request queue capacity',
                priority: 6,
                estimated_impact: 0.6,
                implementation_time: 10,
                cost: 0.2,
                prerequisites: [],
                execute: async () => {
                    // Increase queue capacity (this would need integration with queue service)
                    await cacheService.set('queue_capacity_multiplier', 2.0, 3600);
                    return true;
                },
                rollback: async () => {
                    await cacheService.delete('queue_capacity_multiplier');
                    return true;
                }
            },
            {
                type: 'alert_team',
                description: 'Alert operations team about predicted spike',
                priority: 10,
                estimated_impact: 0.9,
                implementation_time: 1,
                cost: 0.0,
                prerequisites: [],
                execute: async () => {
                    // Send alert (would integrate with notification system)
                    loggingService.warn('ALERT: Traffic spike predicted - manual intervention may be needed', {
                        component: 'TrafficPredictionService',
                        alert_type: 'traffic_spike_prediction'
                    });
                    return true;
                },
                rollback: async () => {
                    return true; // Can't rollback an alert
                }
            },
            {
                type: 'notify_users',
                description: 'Notify users about potential service impact',
                priority: 5,
                estimated_impact: 0.3,
                implementation_time: 30,
                cost: 0.1,
                prerequisites: ['alert_team'],
                execute: async () => {
                    // Set user notification flag
                    await cacheService.set('user_notification_spike_warning', true, 3600);
                    return true;
                },
                rollback: async () => {
                    await cacheService.delete('user_notification_spike_warning');
                    return true;
                }
            }
        ];
    }

    /**
     * Detect traffic patterns in historical data
     */
    private async detectTrafficPatterns(): Promise<void> {
        if (this.trafficHistory.length < 100) return; // Need sufficient data

        try {
            const patterns: TrafficPattern[] = [];
            
            // Detect hourly patterns
            const hourlyPatterns = this.detectHourlyPatterns();
            patterns.push(...hourlyPatterns);
            
            // Detect daily patterns
            const dailyPatterns = this.detectDailyPatterns();
            patterns.push(...dailyPatterns);
            
            // Detect weekly patterns
            const weeklyPatterns = this.detectWeeklyPatterns();
            patterns.push(...weeklyPatterns);
            
            // Update detected patterns
            this.detectedPatterns = patterns;
            
            // Cache patterns
            await cacheService.set('detected_traffic_patterns', patterns, 3600);
            
            loggingService.info('Traffic patterns detected', {
                component: 'TrafficPredictionService',
                patterns_count: patterns.length,
                pattern_types: [...new Set(patterns.map(p => p.pattern_type))]
            });

        } catch (error) {
            loggingService.error('Error detecting traffic patterns', {
                component: 'TrafficPredictionService',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Detect hourly traffic patterns
     */
    private detectHourlyPatterns(): TrafficPattern[] {
        const patterns: TrafficPattern[] = [];
        const hourlyData: Record<number, number[]> = {};
        
        // Group data by hour
        for (const dataPoint of this.trafficHistory) {
            const hour = new Date(dataPoint.timestamp).getHours();
            if (!hourlyData[hour]) hourlyData[hour] = [];
            hourlyData[hour].push(dataPoint.requests_per_second);
        }
        
        // Analyze each hour
        const overallAvg = this.trafficHistory.reduce((sum, d) => sum + d.requests_per_second, 0) / this.trafficHistory.length;
        
        for (const [hour, values] of Object.entries(hourlyData)) {
            if (values.length < 10) continue; // Need sufficient samples
            
            const hourAvg = values.reduce((sum, v) => sum + v, 0) / values.length;
            const multiplier = hourAvg / overallAvg;
            
            if (multiplier > 1.5 || multiplier < 0.5) { // Significant deviation
                patterns.push({
                    pattern_type: 'hourly',
                    pattern_name: `Hour ${hour} pattern`,
                    typical_multiplier: multiplier,
                    duration_minutes: 60,
                    confidence: Math.min(values.length / 50, 1), // More samples = higher confidence
                    historical_occurrences: values.length
                });
            }
        }
        
        return patterns;
    }

    /**
     * Detect daily traffic patterns
     */
    private detectDailyPatterns(): TrafficPattern[] {
        const patterns: TrafficPattern[] = [];
        const dailyData: Record<number, number[]> = {}; // 0 = Sunday, 1 = Monday, etc.
        
        // Group data by day of week
        for (const dataPoint of this.trafficHistory) {
            const day = new Date(dataPoint.timestamp).getDay();
            if (!dailyData[day]) dailyData[day] = [];
            dailyData[day].push(dataPoint.requests_per_second);
        }
        
        const overallAvg = this.trafficHistory.reduce((sum, d) => sum + d.requests_per_second, 0) / this.trafficHistory.length;
        
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        
        for (const [day, values] of Object.entries(dailyData)) {
            if (values.length < 5) continue; // Need sufficient samples
            
            const dayAvg = values.reduce((sum, v) => sum + v, 0) / values.length;
            const multiplier = dayAvg / overallAvg;
            
            if (multiplier > 1.3 || multiplier < 0.7) { // Significant deviation
                patterns.push({
                    pattern_type: 'daily',
                    pattern_name: `${dayNames[parseInt(day)]} pattern`,
                    typical_multiplier: multiplier,
                    duration_minutes: 24 * 60, // Full day
                    confidence: Math.min(values.length / 20, 1),
                    historical_occurrences: values.length
                });
            }
        }
        
        return patterns;
    }

    /**
     * Detect weekly traffic patterns
     */
    private detectWeeklyPatterns(): TrafficPattern[] {
        // Simplified weekly pattern detection
        // In a real implementation, this would be more sophisticated
        const patterns: TrafficPattern[] = [];
        
        // Check for weekend vs weekday patterns
        const weekdayData: number[] = [];
        const weekendData: number[] = [];
        
        for (const dataPoint of this.trafficHistory) {
            const day = new Date(dataPoint.timestamp).getDay();
            if (day === 0 || day === 6) { // Weekend
                weekendData.push(dataPoint.requests_per_second);
            } else { // Weekday
                weekdayData.push(dataPoint.requests_per_second);
            }
        }
        
        if (weekdayData.length > 50 && weekendData.length > 20) {
            const weekdayAvg = weekdayData.reduce((sum, v) => sum + v, 0) / weekdayData.length;
            const weekendAvg = weekendData.reduce((sum, v) => sum + v, 0) / weekendData.length;
            const overallAvg = (weekdayAvg + weekendAvg) / 2;
            
            if (weekdayAvg / overallAvg > 1.2) {
                patterns.push({
                    pattern_type: 'weekly',
                    pattern_name: 'Weekday high traffic',
                    typical_multiplier: weekdayAvg / overallAvg,
                    duration_minutes: 5 * 24 * 60, // 5 days
                    confidence: 0.8,
                    historical_occurrences: Math.floor(weekdayData.length / 5)
                });
            }
            
            if (weekendAvg / overallAvg < 0.8) {
                patterns.push({
                    pattern_type: 'weekly',
                    pattern_name: 'Weekend low traffic',
                    typical_multiplier: weekendAvg / overallAvg,
                    duration_minutes: 2 * 24 * 60, // 2 days
                    confidence: 0.8,
                    historical_occurrences: Math.floor(weekendData.length / 2)
                });
            }
        }
        
        return patterns;
    }

    /**
     * Find patterns that match current traffic
     */
    private findMatchingPatterns(recentData: TrafficDataPoint[]): TrafficPattern[] {
        const matches: TrafficPattern[] = [];
        const now = new Date();
        
        for (const pattern of this.detectedPatterns) {
            let isMatch = false;
            
            switch (pattern.pattern_type) {
                case 'hourly':
                    const currentHour = now.getHours();
                    isMatch = pattern.pattern_name.includes(`Hour ${currentHour}`);
                    break;
                    
                case 'daily':
                    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                    const currentDay = dayNames[now.getDay()];
                    isMatch = pattern.pattern_name.includes(currentDay);
                    break;
                    
                case 'weekly':
                    const isWeekend = now.getDay() === 0 || now.getDay() === 6;
                    isMatch = (isWeekend && pattern.pattern_name.includes('Weekend')) ||
                             (!isWeekend && pattern.pattern_name.includes('Weekday'));
                    break;
            }
            
            if (isMatch) {
                matches.push(pattern);
            }
        }
        
        return matches;
    }

    /**
     * Calculate trend from data series
     */
    private calculateTrend(values: number[]): number {
        if (values.length < 2) return 0;
        
        const n = values.length;
        const sumX = n * (n - 1) / 2;
        const sumY = values.reduce((sum, val) => sum + val, 0);
        const sumXY = values.reduce((sum, val, index) => sum + index * val, 0);
        const sumX2 = n * (n - 1) * (2 * n - 1) / 6;
        
        return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) || 0;
    }

    /**
     * Get service statistics
     */
    public getStatistics(): any {
        return {
            ...this.stats,
            data_points: this.trafficHistory.length,
            patterns_detected: this.detectedPatterns.length,
            active_predictions: this.activePredictions.length,
            actions_executed: this.executedActions.size,
            preparation_success_rate: this.stats.actions_executed > 0 
                ? this.stats.actions_successful / this.stats.actions_executed 
                : 0,
            prediction_accuracy: this.stats.predictions_made > 0 
                ? this.stats.accurate_predictions / this.stats.predictions_made 
                : 0
        };
    }

    /**
     * Update configuration
     */
    public updateConfig(newConfig: Partial<SpikePredictionConfig>): void {
        this.config = { ...this.config, ...newConfig };
        
        loggingService.info('Traffic prediction configuration updated', {
            component: 'TrafficPredictionService',
            config: this.config
        });
    }

    /**
     * Cleanup resources
     */
    public cleanup(): void {
        if (this.predictionInterval) {
            clearInterval(this.predictionInterval);
            this.predictionInterval = undefined;
        }
        
        if (this.patternDetectionInterval) {
            clearInterval(this.patternDetectionInterval);
            this.patternDetectionInterval = undefined;
        }
        
        this.removeAllListeners();
        this.trafficHistory = [];
        this.detectedPatterns = [];
        this.activePredictions = [];
    }
}

/**
 * Simplified ML Models for Traffic Prediction
 */

class LinearRegressionModel {
    predict(data: TrafficDataPoint[]): number {
        if (data.length < 2) return data[data.length - 1]?.requests_per_second || 0;
        
        const values = data.map(d => d.requests_per_second);
        const trend = this.calculateTrend(values);
        const current = values[values.length - 1];
        
        return Math.max(0, current + trend * 5); // 5 time units ahead
    }
    
    private calculateTrend(values: number[]): number {
        const n = values.length;
        const sumX = n * (n - 1) / 2;
        const sumY = values.reduce((sum, val) => sum + val, 0);
        const sumXY = values.reduce((sum, val, index) => sum + index * val, 0);
        const sumX2 = n * (n - 1) * (2 * n - 1) / 6;
        
        return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) || 0;
    }
}

class ExponentialSmoothingModel {
    private alpha = 0.3; // Smoothing parameter
    
    predict(data: TrafficDataPoint[]): number {
        if (data.length === 0) return 0;
        if (data.length === 1) return data[0].requests_per_second;
        
        let smoothed = data[0].requests_per_second;
        
        for (let i = 1; i < data.length; i++) {
            smoothed = this.alpha * data[i].requests_per_second + (1 - this.alpha) * smoothed;
        }
        
        return smoothed;
    }
}

class PatternMatchingModel {
    predict(data: TrafficDataPoint[], patterns: TrafficPattern[]): number {
        if (data.length === 0) return 0;
        
        const current = data[data.length - 1].requests_per_second;
        const matchingPatterns = this.findMatchingPatterns(patterns);
        
        if (matchingPatterns.length === 0) return current;
        
        // Apply pattern multipliers
        const weightedMultiplier = matchingPatterns.reduce((sum, pattern) => 
            sum + pattern.typical_multiplier * pattern.confidence, 0
        ) / matchingPatterns.reduce((sum, pattern) => sum + pattern.confidence, 0);
        
        return current * weightedMultiplier;
    }
    
    private findMatchingPatterns(patterns: TrafficPattern[]): TrafficPattern[] {
        // Simplified pattern matching - would be more sophisticated in real implementation
        const now = new Date();
        const hour = now.getHours();
        const day = now.getDay();
        
        return patterns.filter(pattern => {
            if (pattern.pattern_type === 'hourly') {
                return pattern.pattern_name.includes(`Hour ${hour}`);
            }
            if (pattern.pattern_type === 'daily') {
                const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                return pattern.pattern_name.includes(dayNames[day]);
            }
            return false;
        });
    }
}

// Export singleton instance
export const trafficPredictionService = TrafficPredictionService.getInstance();
