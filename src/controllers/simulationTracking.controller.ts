import { Request, Response } from 'express';
import { SimulationTrackingService, SimulationTrackingData, OptimizationApplication } from '../services/simulationTracking.service';
import { loggingService } from '../services/logging.service';

export class SimulationTrackingController {
    // Background processing queue
    private static backgroundQueue: Array<() => Promise<void>> = [];
    private static backgroundProcessor?: NodeJS.Timeout;
    
    // Circuit breaker for database operations
    private static dbFailureCount: number = 0;
    private static readonly MAX_DB_FAILURES = 5;
    private static readonly CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minutes
    private static lastDbFailureTime: number = 0;
    
    // ObjectId conversion utilities
    private static objectIdCache = new Map<string, any>();
    private static readonly OBJECTID_CACHE_TTL = 300000; // 5 minutes
    
    /**
     * Initialize background processor
     */
    static {
        this.startBackgroundProcessor();
    }
    
    /**
     * Track a new simulation
     */
    static async trackSimulation(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const userId = (req as any).user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const {
            sessionId,
            originalUsageId,
            simulationType,
            originalModel,
            originalPrompt,
            originalCost,
            originalTokens,
            parameters,
            optimizationOptions,
            recommendations,
            potentialSavings,
            confidence,
            projectId
        } = req.body;

        try {
            loggingService.info('Simulation tracking initiated', {
                userId,
                requestId,
                sessionId,
                simulationType,
                originalModel,
                originalCost,
                originalTokens,
                potentialSavings,
                confidence
            });

            if (!userId) {
                loggingService.warn('Simulation tracking failed - user not authenticated', {
                    requestId,
                    sessionId,
                    simulationType
                });
                return res.status(401).json({ 
                    success: false, 
                    message: 'User authentication required' 
                });
            }

            // Validate required fields using optimized validation
            const validationError = this.validateSimulationData({
                sessionId, simulationType, originalModel, originalPrompt,
                originalCost, originalTokens, potentialSavings, confidence
            });
            
            if (validationError) {
                loggingService.warn('Simulation tracking failed - missing required fields', {
                    userId,
                    requestId,
                    error: validationError
                });
                return res.status(400).json({
                    success: false,
                    message: validationError
                });
            }

            const trackingData: SimulationTrackingData = {
                userId,
                sessionId,
                originalUsageId,
                simulationType,
                originalModel,
                originalPrompt,
                originalCost,
                originalTokens,
                parameters,
                optimizationOptions: optimizationOptions || [],
                recommendations: recommendations || [],
                potentialSavings,
                confidence,
                userAgent: req.get('User-Agent'),
                ipAddress: req.ip,
                projectId
            };

            const trackingId = await SimulationTrackingService.trackSimulation(trackingData);
            const duration = Date.now() - startTime;

            loggingService.info('Simulation tracked successfully', {
                userId,
                duration,
                trackingId,
                sessionId,
                simulationType,
                requestId
            });

            // Queue background business event logging
            this.queueBackgroundOperation(async () => {
                loggingService.logBusiness({
                    event: 'simulation_tracked',
                    category: 'simulation',
                    value: duration,
                    metadata: {
                        userId,
                        trackingId,
                        simulationType,
                        originalModel,
                        potentialSavings,
                        confidence
                    }
                });
            });

            return res.status(201).json({
                success: true,
                message: 'Simulation tracked successfully',
                data: { trackingId }
            });
        } catch (error: any) {
            SimulationTrackingController.recordDbFailure();
            const duration = Date.now() - startTime;
            
            loggingService.error('Simulation tracking failed', {
                userId,
                requestId,
                sessionId,
                simulationType,
                error: error.message || 'Unknown error',
                duration
            });
            
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Track optimization application
     */
    static async trackOptimizationApplication(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const { trackingId } = req.params;
        const {
            optionIndex,
            type,
            estimatedSavings,
            userFeedback
        } = req.body;

        try {
            loggingService.info('Optimization application tracking initiated', {
                requestId,
                trackingId,
                optionIndex,
                type,
                estimatedSavings
            });

            if (!trackingId || optionIndex === undefined || !type || estimatedSavings === undefined) {
                loggingService.warn('Optimization application tracking failed - missing required fields', {
                    requestId,
                    trackingId,
                    optionIndex,
                    type,
                    estimatedSavings
                });
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields'
                });
            }

            const application: OptimizationApplication = {
                optionIndex,
                type,
                estimatedSavings,
                userFeedback
            };

            await SimulationTrackingService.trackOptimizationApplication(trackingId, application);
            const duration = Date.now() - startTime;

            loggingService.info('Optimization application tracked successfully', {
                requestId,
                duration,
                trackingId,
                optionIndex,
                type,
                estimatedSavings
            });

            // Queue background business event logging
            this.queueBackgroundOperation(async () => {
                loggingService.logBusiness({
                    event: 'optimization_application_tracked',
                    category: 'simulation',
                    value: duration,
                    metadata: {
                        trackingId,
                        optionIndex,
                        type,
                        estimatedSavings,
                        hasUserFeedback: !!userFeedback
                    }
                });
            });

            return res.status(200).json({
                success: true,
                message: 'Optimization application tracked successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Optimization application tracking failed', {
                requestId,
                trackingId,
                optionIndex,
                type,
                estimatedSavings,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Update viewing metrics
     */
    static async updateViewingMetrics(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const { trackingId } = req.params;
        const { timeSpent, optionsViewed } = req.body;

        try {
            loggingService.info('Viewing metrics update initiated', {
                requestId,
                trackingId,
                hasTrackingId: !!trackingId,
                timeSpent,
                hasTimeSpent: timeSpent !== undefined,
                hasOptionsViewed: !!optionsViewed,
                optionsViewedCount: Array.isArray(optionsViewed) ? optionsViewed.length : 0
            });

            if (!trackingId || timeSpent === undefined) {
                loggingService.warn('Viewing metrics update failed - missing required fields', {
                    requestId,
                    trackingId,
                    timeSpent
                });
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields'
                });
            }

            await SimulationTrackingService.updateViewingMetrics(
                trackingId, 
                timeSpent, 
                optionsViewed || []
            );
            const duration = Date.now() - startTime;

            loggingService.info('Viewing metrics updated successfully', {
                requestId,
                duration,
                trackingId,
                timeSpent,
                hasOptionsViewed: !!optionsViewed,
                optionsViewedCount: Array.isArray(optionsViewed) ? optionsViewed.length : 0
            });

            // Log business event
            loggingService.logBusiness({
                event: 'viewing_metrics_updated',
                category: 'simulation',
                value: duration,
                metadata: {
                    trackingId,
                    timeSpent,
                    hasOptionsViewed: !!optionsViewed,
                    optionsViewedCount: Array.isArray(optionsViewed) ? optionsViewed.length : 0
                }
            });

            return res.status(200).json({
                success: true,
                message: 'Viewing metrics updated successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Viewing metrics update failed', {
                requestId,
                trackingId,
                timeSpent,
                hasOptionsViewed: !!optionsViewed,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Get simulation statistics
     */
    static async getSimulationStats(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const userId = (req as any).user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const { global, startDate, endDate } = req.query;

        try {
            loggingService.info('Simulation statistics retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                global,
                hasGlobal: !!global,
                startDate,
                hasStartDate: !!startDate,
                endDate,
                hasEndDate: !!endDate
            });

            let timeRange;
            if (startDate && endDate) {
                timeRange = {
                    startDate: new Date(startDate as string),
                    endDate: new Date(endDate as string)
                };
            }

            const stats = await SimulationTrackingService.getSimulationStats(
                global === 'true' ? undefined : userId,
                timeRange
            );
            const duration = Date.now() - startTime;

            loggingService.info('Simulation statistics retrieved successfully', {
                userId,
                duration,
                global,
                startDate,
                endDate,
                hasTimeRange: !!timeRange,
                hasStats: !!stats,
                requestId
            });

            return res.status(200).json({
                success: true,
                data: stats
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Simulation statistics retrieval failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                global,
                startDate,
                endDate,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Get top optimization wins leaderboard
     */
    static async getTopOptimizationWins(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const { startDate, endDate, limit = 10 } = req.query;

        try {
            loggingService.info('Top optimization wins retrieval initiated', {
                requestId,
                startDate,
                hasStartDate: !!startDate,
                endDate,
                hasEndDate: !!endDate,
                limit,
                hasLimit: !!limit
            });

            let timeRange;
            if (startDate && endDate) {
                timeRange = {
                    startDate: new Date(startDate as string),
                    endDate: new Date(endDate as string)
                };
            }

            const wins = await SimulationTrackingService.getTopOptimizationWins(
                timeRange,
                parseInt(limit as string)
            );
            const duration = Date.now() - startTime;

            loggingService.info('Top optimization wins retrieved successfully', {
                requestId,
                duration,
                startDate,
                endDate,
                limit,
                hasTimeRange: !!timeRange,
                hasWins: !!wins,
                winsCount: Array.isArray(wins) ? wins.length : 0
            });

            return res.status(200).json({
                success: true,
                data: wins
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Top optimization wins retrieval failed', {
                requestId,
                startDate,
                endDate,
                limit,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Get user simulation history
     */
    static async getUserSimulationHistory(req: Request, res: Response): Promise<Response> {
        const startTime = Date.now();
        const userId = (req as any).user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const { limit = 20, offset = 0 } = req.query;

        try {
            loggingService.info('User simulation history retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                limit,
                hasLimit: !!limit,
                offset,
                hasOffset: !!offset
            });

            if (!userId) {
                loggingService.warn('User simulation history retrieval failed - user not authenticated', {
                    requestId
                });
                return res.status(401).json({
                    success: false,
                    message: 'User authentication required'
                });
            }

            const history = await SimulationTrackingService.getUserSimulationHistory(
                userId,
                parseInt(limit as string),
                parseInt(offset as string)
            );
            const duration = Date.now() - startTime;

            loggingService.info('User simulation history retrieved successfully', {
                userId,
                duration,
                limit,
                offset,
                hasHistory: !!history,
                historyCount: Array.isArray(history) ? history.length : 0,
                requestId
            });

            return res.status(200).json({
                success: true,
                data: history
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('User simulation history retrieval failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                limit,
                offset,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });
            
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }

    /**
     * Optimized validation for simulation data
     */
    private static validateSimulationData(data: any): string | null {
        const required = [
            { field: 'sessionId', value: data.sessionId },
            { field: 'simulationType', value: data.simulationType },
            { field: 'originalModel', value: data.originalModel },
            { field: 'originalPrompt', value: data.originalPrompt },
            { field: 'originalCost', value: data.originalCost },
            { field: 'originalTokens', value: data.originalTokens },
            { field: 'potentialSavings', value: data.potentialSavings },
            { field: 'confidence', value: data.confidence }
        ];

        for (const { field, value } of required) {
            if (value === undefined || value === null || value === '') {
                return `Missing required field: ${field}`;
            }
        }

        return null;
    }

    /**
     * Circuit breaker utilities for database operations
     */
    private static isDbCircuitBreakerOpen(): boolean {
        if (this.dbFailureCount >= this.MAX_DB_FAILURES) {
            const timeSinceLastFailure = Date.now() - this.lastDbFailureTime;
            if (timeSinceLastFailure < this.CIRCUIT_BREAKER_RESET_TIME) {
                return true;
            } else {
                // Reset circuit breaker
                this.dbFailureCount = 0;
                return false;
            }
        }
        return false;
    }

    private static recordDbFailure(): void {
        this.dbFailureCount++;
        this.lastDbFailureTime = Date.now();
    }

    /**
     * Background processing utilities
     */
    private static queueBackgroundOperation(operation: () => Promise<void>): void {
        this.backgroundQueue.push(operation);
    }

    private static startBackgroundProcessor(): void {
        this.backgroundProcessor = setInterval(async () => {
            if (this.backgroundQueue.length > 0) {
                const operation = this.backgroundQueue.shift();
                if (operation) {
                    try {
                        await operation();
                    } catch (error) {
                        loggingService.error('Background operation failed:', {
                            error: error instanceof Error ? error.message : String(error)
                        });
                    }
                }
            }
        }, 1000);
    }

    /**
     * ObjectId conversion utilities
     */
    private static getOptimizedObjectId(id: string): any {
        const cached = this.objectIdCache.get(id);
        if (cached && Date.now() - cached.timestamp < this.OBJECTID_CACHE_TTL) {
            return cached.objectId;
        }

        const mongoose = require('mongoose');
        const objectId = new mongoose.Types.ObjectId(id);
        this.objectIdCache.set(id, {
            objectId,
            timestamp: Date.now()
        });

        return objectId;
    }

    /**
     * Cleanup method for graceful shutdown
     */
    static cleanup(): void {
        if (this.backgroundProcessor) {
            clearInterval(this.backgroundProcessor);
            this.backgroundProcessor = undefined;
        }
        
        // Process remaining queue items
        while (this.backgroundQueue.length > 0) {
            const operation = this.backgroundQueue.shift();
            if (operation) {
                operation().catch(error => {
                    loggingService.error('Cleanup operation failed:', {
                        error: error instanceof Error ? error.message : String(error)
                    });
                });
            }
        }
        
        // Clear caches
        this.objectIdCache.clear();
    }
}

export default SimulationTrackingController;