import { Request, Response } from 'express';
import { SimulationTrackingService, SimulationTrackingData, OptimizationApplication } from '../services/simulationTracking.service';
import { loggingService } from '../services/logging.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

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
    static async trackSimulation(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return res;
        const userId = req.userId!;
        
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

        ControllerHelper.logRequestStart('trackSimulation', req, {
            sessionId,
            simulationType,
            originalModel
        });

        try {

            // Validate required fields using optimized validation
            const validationError = this.validateSimulationData({
                sessionId, simulationType, originalModel, originalPrompt,
                originalCost, originalTokens, potentialSavings, confidence
            });
            
            if (validationError) {
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

            ControllerHelper.logRequestSuccess('trackSimulation', req, startTime, {
                trackingId,
                simulationType
            });

            return res.status(201).json({
                success: true,
                message: 'Simulation tracked successfully',
                data: { trackingId }
            });
        } catch (error: any) {
            SimulationTrackingController.recordDbFailure();
            ControllerHelper.handleError('trackSimulation', error, req, res, startTime);
            return res;
        }
    }

    /**
     * Track optimization application
     */
    static async trackOptimizationApplication(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        const { trackingId } = req.params;
        const {
            optionIndex,
            type,
            estimatedSavings,
            userFeedback
        } = req.body;

        ControllerHelper.logRequestStart('trackOptimizationApplication', req, {
            trackingId,
            optionIndex,
            type
        });

        try {
            if (!trackingId || optionIndex === undefined || !type || estimatedSavings === undefined) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields'
                });
            }

            ServiceHelper.validateObjectId(trackingId, 'trackingId');

            const application: OptimizationApplication = {
                optionIndex,
                type,
                estimatedSavings,
                userFeedback
            };

            await SimulationTrackingService.trackOptimizationApplication(trackingId, application);
            const duration = Date.now() - startTime;

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

            ControllerHelper.logRequestSuccess('trackOptimizationApplication', req, startTime, {
                trackingId,
                optionIndex
            });

            return res.status(200).json({
                success: true,
                message: 'Optimization application tracked successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('trackOptimizationApplication', error, req, res, startTime);
            return res;
        }
    }

    /**
     * Update viewing metrics
     */
    static async updateViewingMetrics(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        const { trackingId } = req.params;
        const { timeSpent, optionsViewed } = req.body;

        ControllerHelper.logRequestStart('updateViewingMetrics', req, {
            trackingId,
            timeSpent
        });

        try {
            if (!trackingId || timeSpent === undefined) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields'
                });
            }

            ServiceHelper.validateObjectId(trackingId, 'trackingId');

            await SimulationTrackingService.updateViewingMetrics(
                trackingId, 
                timeSpent, 
                optionsViewed || []
            );
            const duration = Date.now() - startTime;

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

            ControllerHelper.logRequestSuccess('updateViewingMetrics', req, startTime, {
                trackingId
            });

            return res.status(200).json({
                success: true,
                message: 'Viewing metrics updated successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('updateViewingMetrics', error, req, res, startTime);
            return res;
        }
    }

    /**
     * Get simulation statistics
     */
    static async getSimulationStats(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        const { global, startDate, endDate } = req.query;

        ControllerHelper.logRequestStart('getSimulationStats', req, {
            global,
            startDate,
            endDate
        });

        try {
            const userId = global === 'true' ? undefined : req.userId;

            let timeRange;
            if (startDate && endDate) {
                timeRange = {
                    startDate: new Date(startDate as string),
                    endDate: new Date(endDate as string)
                };
            }

            const stats = await SimulationTrackingService.getSimulationStats(
                userId,
                timeRange
            );

            ControllerHelper.logRequestSuccess('getSimulationStats', req, startTime);

            return res.status(200).json({
                success: true,
                data: stats
            });
        } catch (error: any) {
            ControllerHelper.handleError('getSimulationStats', error, req, res, startTime);
            return res;
        }
    }

    /**
     * Get top optimization wins leaderboard
     */
    static async getTopOptimizationWins(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        const { startDate, endDate, limit = 10 } = req.query;

        ControllerHelper.logRequestStart('getTopOptimizationWins', req, {
            startDate,
            endDate,
            limit
        });

        try {

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

            ControllerHelper.logRequestSuccess('getTopOptimizationWins', req, startTime, {
                winsCount: Array.isArray(wins) ? wins.length : 0
            });

            return res.status(200).json({
                success: true,
                data: wins
            });
        } catch (error: any) {
            ControllerHelper.handleError('getTopOptimizationWins', error, req, res, startTime);
            return res;
        }
    }

    /**
     * Get user simulation history
     */
    static async getUserSimulationHistory(req: AuthenticatedRequest, res: Response): Promise<Response> {
        const startTime = Date.now();
        const { limit = 20, offset = 0 } = req.query;

        if (!ControllerHelper.requireAuth(req, res)) return res;
        const userId = req.userId!;

        ControllerHelper.logRequestStart('getUserSimulationHistory', req, {
            limit,
            offset
        });

        try {

            const history = await SimulationTrackingService.getUserSimulationHistory(
                userId,
                parseInt(limit as string),
                parseInt(offset as string)
            );

            ControllerHelper.logRequestSuccess('getUserSimulationHistory', req, startTime, {
                historyCount: Array.isArray(history) ? history.length : 0
            });

            return res.status(200).json({
                success: true,
                data: history
            });
        } catch (error: any) {
            ControllerHelper.handleError('getUserSimulationHistory', error, req, res, startTime);
            return res;
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