import { Request, Response, NextFunction } from 'express';
import { costKatanaBrain } from '../services/costKatanaBrain.service';
import { InterventionLog } from '../models/InterventionLog';
import { OptimizationOutcome } from '../models/OptimizationOutcome';
import { optimizationFeedbackLoop } from '../services/optimizationFeedbackLoop.service';
import { loggingService } from '../services/logging.service';
import mongoose from 'mongoose';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

// ============================================================================
// BRAIN CONTROLLER
// ============================================================================

export class BrainController {
    /**
     * Get all active flows
     * GET /api/brain/active-flows
     */
    static async getActiveFlows(req: Request, res: Response): Promise<void> {
        try {
            // Optional: Filter by userId or projectId from query params
            const userId = req.query.userId as string;
            const projectId = req.query.projectId as string;
            
            let flows = costKatanaBrain.getAllActiveFlows();
            
            // Apply filters if provided
            if (userId) {
                flows = flows.filter(f => f.userId === userId);
            }
            if (projectId) {
                flows = flows.filter(f => f.projectId === projectId);
            }
            
            res.json({
                success: true,
                data: {
                    flows,
                    total: flows.length,
                    timestamp: new Date(),
                    filters: {
                        userId: userId || null,
                        projectId: projectId || null
                    }
                }
            });

        } catch (error) {
            loggingService.error('Failed to get active flows', {
                component: 'BrainController',
                error: error instanceof Error ? error.message : String(error)
            });
            
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve active flows'
            });
        }
    }

    /**
     * Get global resource metrics
     * GET /api/brain/global-metrics
     */
    static async getGlobalMetrics(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('getGlobalMetrics', req);

        try {
            const state = costKatanaBrain.getGlobalResourceState();
            
            // Calculate additional metrics
            const flows = costKatanaBrain.getAllActiveFlows();
            const activeUsers = new Set(flows.map(f => f.userId)).size;
            const activeProjects = new Set(flows.filter(f => f.projectId).map(f => f.projectId)).size;
            
            // Calculate cost burn rate ($/minute)
            const totalEstimatedDuration = flows.reduce((sum, f) => sum + (f.estimatedDuration ?? 60000), 0);
            const avgDurationMinutes = (totalEstimatedDuration / flows.length / 60000) || 1;
            const costBurnRate = state.totalEstimatedCost / avgDurationMinutes;

            // Optional: Filter by user if provided in query
            const userId = req.query.userId as string;
            const filteredFlows = userId 
                ? flows.filter(f => f.userId === userId)
                : flows;

            ControllerHelper.logRequestSuccess('getGlobalMetrics', req, startTime, {
                activeUsers,
                activeProjects,
                totalFlows: flows.length,
                filteredByUserId: !!userId
            });

            res.json({
                success: true,
                data: {
                    ...state,
                    activeUsers,
                    activeProjects,
                    costBurnRate: costBurnRate.toFixed(4),
                    costBurnRatePerMinute: costBurnRate,
                    budgetUtilizationPercent: (state.totalReservedBudget / 1000 * 100).toFixed(2), // Assuming $1000 total budget
                    filteredFlowCount: userId ? filteredFlows.length : undefined
                }
            });

        } catch (error) {
            ControllerHelper.handleError('getGlobalMetrics', error, req, res, startTime);
        }
    }

    /**
     * Get recent interventions
     * GET /api/brain/interventions
     */
    static async getInterventions(req: Request, res: Response): Promise<void> {
        try {
            const limit = parseInt(req.query.limit as string) || 50;
            const userId = req.query.userId as string;

            const query: any = {};
            if (userId) {
                query.userId = new mongoose.Types.ObjectId(userId);
            }

            const interventions = await InterventionLog.find(query)
                .sort({ timestamp: -1 })
                .limit(limit)
                .populate('userId', 'name email')
                .lean();

            // Calculate statistics
            const stats = {
                total: interventions.length,
                byType: {} as Record<string, number>,
                totalCostSaved: 0,
                avgCostSaved: 0
            };

            interventions.forEach(intervention => {
                stats.byType[intervention.interventionType] = 
                    (stats.byType[intervention.interventionType] || 0) + 1;
                stats.totalCostSaved += intervention.costSaved;
            });

            stats.avgCostSaved = stats.totalCostSaved / (interventions.length || 1);

            res.json({
                success: true,
                data: {
                    interventions,
                    stats,
                    timestamp: new Date()
                }
            });

        } catch (error) {
            loggingService.error('Failed to get interventions', {
                component: 'BrainController',
                error: error instanceof Error ? error.message : String(error)
            });
            
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve interventions'
            });
        }
    }

    /**
     * Get user-specific interventions
     * GET /api/brain/interventions/:userId
     */
    static async getUserInterventions(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { userId } = req.params;
        ControllerHelper.logRequestStart('getUserInterventions', req);

        try {
            ServiceHelper.validateObjectId(userId, 'User ID');
            const limit = parseInt(req.query.limit as string) || 20;

            const interventions = await InterventionLog.find({ 
                userId: new mongoose.Types.ObjectId(userId) 
            })
                .sort({ timestamp: -1 })
                .limit(limit)
                .lean();

            ControllerHelper.logRequestSuccess('getUserInterventions', req, startTime, {
                userId,
                interventionsCount: interventions.length
            });

            res.json({
                success: true,
                data: {
                    interventions,
                    total: interventions.length
                }
            });

        } catch (error) {
            ControllerHelper.handleError('getUserInterventions', error, req, res, startTime);
        }
    }

    /**
     * Get budget forecast for user
     * GET /api/brain/budget/forecast/:userId
     */
    static async getBudgetForecast(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { userId } = req.params;
        ControllerHelper.logRequestStart('getBudgetForecast', req);

        try {
            ServiceHelper.validateObjectId(userId, 'User ID');

            // Get user's active flows
            const userFlows = costKatanaBrain.getActiveFlowsByUser(userId);
            const currentReserved = userFlows.reduce((sum, f) => sum + f.resourceReservation.budget, 0);

            // Simple forecast (in production, use predictiveBudget service)
            const userBudgetLimit = 100; // $100 default
            const utilizationPercent = (currentReserved / userBudgetLimit) * 100;
            const remaining = userBudgetLimit - currentReserved;
            
            // Estimate hours until exhaustion based on current burn rate
            const avgFlowCost = userFlows.length > 0 
                ? currentReserved / userFlows.length 
                : 1;
            const estimatedFlowsRemaining = Math.floor(remaining / (avgFlowCost || 1));
            const hoursUntilExhaustion = estimatedFlowsRemaining * 0.5; // Assume 30 min per flow

            ControllerHelper.logRequestSuccess('getBudgetForecast', req, startTime, {
                userId,
                activeFlows: userFlows.length,
                utilizationPercent: parseFloat(utilizationPercent.toFixed(2))
            });

            res.json({
                success: true,
                data: {
                    userId,
                    budgetLimit: userBudgetLimit,
                    currentSpend: currentReserved,
                    remaining,
                    utilizationPercent: utilizationPercent.toFixed(2),
                    estimatedFlowsRemaining,
                    hoursUntilExhaustion: hoursUntilExhaustion.toFixed(1),
                    alert: utilizationPercent > 80 ? 'critical' : utilizationPercent > 60 ? 'warning' : 'normal',
                    recommendation: utilizationPercent > 80 
                        ? 'Consider increasing budget or pausing non-critical flows'
                        : 'Budget utilization healthy',
                    timestamp: new Date()
                }
            });

        } catch (error) {
            ControllerHelper.handleError('getBudgetForecast', error, req, res, startTime);
        }
    }

    /**
     * Get burn rate for user
     * GET /api/brain/budget/burn-rate/:userId
     */
    static async getBurnRate(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const { userId } = req.params;
        ControllerHelper.logRequestStart('getBurnRate', req);

        try {
            ServiceHelper.validateObjectId(userId, 'User ID');

            // Get user's active flows
            const userFlows = costKatanaBrain.getActiveFlowsByUser(userId);
            const totalCost = userFlows.reduce((sum, f) => sum + f.estimatedCost, 0);
            const totalDuration = userFlows.reduce((sum, f) => {
                const duration = Date.now() - f.startTime.getTime();
                return sum + duration;
            }, 0);

            const avgDurationMinutes = (totalDuration / userFlows.length / 60000) || 1;
            const burnRatePerMinute = totalCost / avgDurationMinutes;
            const burnRatePerHour = burnRatePerMinute * 60;
            const burnRatePerDay = burnRatePerHour * 24;

            ControllerHelper.logRequestSuccess('getBurnRate', req, startTime, {
                userId,
                activeFlows: userFlows.length,
                totalCost
            });

            res.json({
                success: true,
                data: {
                    userId,
                    activeFlows: userFlows.length,
                    totalCost,
                    burnRate: {
                        perMinute: burnRatePerMinute.toFixed(4),
                        perHour: burnRatePerHour.toFixed(2),
                        perDay: burnRatePerDay.toFixed(2)
                    },
                    projection: {
                        next1Hour: burnRatePerHour.toFixed(2),
                        next24Hours: burnRatePerDay.toFixed(2),
                        next7Days: (burnRatePerDay * 7).toFixed(2),
                        next30Days: (burnRatePerDay * 30).toFixed(2)
                    },
                    timestamp: new Date()
                }
            });

        } catch (error) {
            ControllerHelper.handleError('getBurnRate', error, req, res, startTime);
        }
    }

    /**
     * Get learning statistics
     * GET /api/brain/learning/stats
     */
    static async getLearningStats(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('getLearningStats', req);

        try {
            // Get optimization outcomes from last 30 days
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            
            // Allow filtering by user if provided
            const userId = req.query.userId as string;
            const matchStage: any = { timestamp: { $gte: thirtyDaysAgo } };
            if (userId) {
                ServiceHelper.validateObjectId(userId, 'User ID');
                matchStage.userId = new mongoose.Types.ObjectId(userId);
            }
            
            const outcomes = await OptimizationOutcome.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: '$optimizationType',
                        total: { $sum: 1 },
                        applied: { $sum: { $cond: ['$outcome.applied', 1, 0] } },
                        approved: { $sum: { $cond: ['$outcome.userApproved', 1, 0] } },
                        totalSavings: { $sum: '$outcome.costSaved' },
                        avgQuality: { $avg: '$outcome.qualityScore' }
                    }
                }
            ]);

            interface AggregationResult {
                _id: string;
                total: number;
                applied: number;
                approved: number;
                totalSavings: number;
                avgQuality: number;
            }

            const stats = (outcomes as AggregationResult[]).map(o => ({
                optimizationType: o._id,
                total: o.total,
                applied: o.applied,
                approved: o.approved,
                acceptanceRate: ((o.approved / o.total) * 100).toFixed(1),
                applicationRate: ((o.applied / o.total) * 100).toFixed(1),
                totalSavings: o.totalSavings.toFixed(2),
                avgQuality: (o.avgQuality * 100).toFixed(1)
            }));

            const overall = {
                totalOptimizations: (outcomes as AggregationResult[]).reduce((sum, o) => sum + o.total, 0),
                totalApplied: (outcomes as AggregationResult[]).reduce((sum, o) => sum + o.applied, 0),
                totalApproved: (outcomes as AggregationResult[]).reduce((sum, o) => sum + o.approved, 0),
                totalSavings: (outcomes as AggregationResult[]).reduce((sum, o) => sum + o.totalSavings, 0),
                avgAcceptanceRate: stats.length > 0
                    ? (stats.reduce((sum, s) => sum + parseFloat(s.acceptanceRate), 0) / stats.length).toFixed(1)
                    : '0.0'
            };

            ControllerHelper.logRequestSuccess('getLearningStats', req, startTime, {
                totalOptimizations: overall.totalOptimizations,
                filteredByUserId: !!userId
            });

            res.json({
                success: true,
                data: {
                    byType: stats,
                    overall,
                    period: {
                        start: thirtyDaysAgo,
                        end: new Date()
                    },
                    ...(userId && { userId })
                }
            });

        } catch (error) {
            ControllerHelper.handleError('getLearningStats', error, req, res, startTime);
        }
    }

    /**
     * Get optimization recommendations
     * GET /api/brain/learning/recommendations/:context
     */
    static async getRecommendations(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('getRecommendations', req);

        try {
            const context = {
                promptComplexity: parseFloat(req.query.complexity as string) || 0.5,
                userTier: (req.query.tier as any) || 'pro',
                costBudget: (req.query.budget as any) || 'medium',
                taskType: (req.query.taskType as string) || 'general'
            };

            const recommendation = await optimizationFeedbackLoop.getOptimizationRecommendation(context);

            if (!recommendation) {
                ControllerHelper.logRequestSuccess('getRecommendations', req, startTime, {
                    hasRecommendation: false
                });
                res.json({
                    success: true,
                    data: null,
                    message: 'No recommendation available for given context'
                });
                return;
            }

            ControllerHelper.logRequestSuccess('getRecommendations', req, startTime, {
                hasRecommendation: true,
                taskType: context.taskType
            });

            res.json({
                success: true,
                data: {
                    recommendation,
                    context,
                    timestamp: new Date()
                }
            });

        } catch (error) {
            ControllerHelper.handleError('getRecommendations', error, req, res, startTime);
        }
    }

    /**
     * Submit feedback for optimization
     * POST /api/brain/learning/feedback
     */
    static async submitFeedback(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('submitFeedback', req);

        try {
            const {
                optimizationId,
                userId,
                action,
                context,
                suggestedModel,
                signals
            } = req.body;

            if (!userId || !action) {
                res.status(400).json({
                    success: false,
                    error: 'Missing required fields: userId, action'
                });
                return;
            }

            if (userId) {
                ServiceHelper.validateObjectId(userId, 'User ID');
            }
            if (optimizationId) {
                ServiceHelper.validateObjectId(optimizationId, 'Optimization ID');
            }

            // Record the optimization outcome with all signals
            if (optimizationId && signals) {
                await optimizationFeedbackLoop.recordOptimizationOutcome(
                    optimizationId,
                    userId,
                    context,
                    context?.originalModel || 'unknown',
                    suggestedModel,
                    signals
                );
            }

            // Learn from user action
            await optimizationFeedbackLoop.learnFromUserAction(
                userId,
                action,
                context,
                suggestedModel
            );

            ControllerHelper.logRequestSuccess('submitFeedback', req, startTime, {
                userId,
                action,
                hasOptimizationId: !!optimizationId
            });

            res.json({
                success: true,
                message: 'Feedback recorded successfully',
                data: {
                    optimizationId,
                    userId,
                    action,
                    timestamp: new Date()
                }
            });

        } catch (error) {
            ControllerHelper.handleError('submitFeedback', error, req, res, startTime);
        }
    }

    // ========================================================================
    // USER-SPECIFIC METHODS (Can only access their own data)
    // ========================================================================

    /**
     * Get user's own active flows
     * GET /api/brain/user/active-flows
     */
    static async getUserActiveFlows(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getUserActiveFlows', req);

        try {
            const flows = costKatanaBrain.getActiveFlowsByUser(userId);
            
            ControllerHelper.logRequestSuccess('getUserActiveFlows', req, startTime, {
                flowsCount: flows.length
            });
            
            res.json({
                success: true,
                data: {
                    flows,
                    total: flows.length,
                    timestamp: new Date()
                }
            });

        } catch (error) {
            ControllerHelper.handleError('getUserActiveFlows', error, req, res, startTime);
        }
    }

    /**
     * Get user's own metrics
     * GET /api/brain/user/metrics
     */
    static async getUserMetrics(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getUserMetrics', req);

        try {
            const userFlows = costKatanaBrain.getActiveFlowsByUser(userId);
            
            // Calculate user-specific metrics
            const totalEstimatedCost = userFlows.reduce((sum, f) => sum + f.estimatedCost, 0);
            const totalReservedBudget = userFlows.reduce((sum, f) => sum + f.resourceReservation.budget, 0);
            
            const flowsByType: any = {};
            const flowsByPriority: any = {};
            
            userFlows.forEach(flow => {
                flowsByType[flow.type] = (flowsByType[flow.type] || 0) + 1;
                flowsByPriority[flow.priority] = (flowsByPriority[flow.priority] || 0) + 1;
            });

            // Calculate burn rate
            const totalDuration = userFlows.reduce((sum, f) => {
                const duration = Date.now() - f.startTime.getTime();
                return sum + duration;
            }, 0);
            const avgDurationMinutes = (totalDuration / userFlows.length / 60000) || 1;
            const costBurnRate = totalEstimatedCost / avgDurationMinutes;

            ControllerHelper.logRequestSuccess('getUserMetrics', req, startTime, {
                totalActiveFlows: userFlows.length,
                totalEstimatedCost
            });

            res.json({
                success: true,
                data: {
                    totalActiveFlows: userFlows.length,
                    totalEstimatedCost,
                    totalReservedBudget,
                    flowsByType,
                    flowsByPriority,
                    costBurnRate: costBurnRate.toFixed(4),
                    costBurnRatePerMinute: costBurnRate,
                    timestamp: new Date()
                }
            });

        } catch (error) {
            ControllerHelper.handleError('getUserMetrics', error, req, res, startTime);
        }
    }

    /**
     * Get user's budget forecast
     * GET /api/brain/user/budget/forecast
     */
    static async getUserBudgetForecast(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getUserBudgetForecast', req);

        try {
            // Use existing getBudgetForecast logic
            req.params.userId = userId;
            await BrainController.getBudgetForecast(req, res);

        } catch (error) {
            ControllerHelper.handleError('getUserBudgetForecast', error, req, res, startTime);
        }
    }

    /**
     * Get user's burn rate
     * GET /api/brain/user/budget/burn-rate
     */
    static async getUserBurnRate(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getUserBurnRate', req);

        try {
            // Use existing getBurnRate logic
            req.params.userId = userId;
            await BrainController.getBurnRate(req, res);

        } catch (error) {
            ControllerHelper.handleError('getUserBurnRate', error, req, res, startTime);
        }
    }

    /**
     * Get user's learning stats
     * GET /api/brain/user/learning/stats
     */
    static async getUserLearningStats(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getUserLearningStats', req);

        try {
            // Add userId filter to query
            req.query.userId = userId;
            await BrainController.getLearningStats(req, res);

        } catch (error) {
            ControllerHelper.handleError('getUserLearningStats', error, req, res, startTime);
        }
    }

    /**
     * SSE stream for user's events only
     * GET /api/brain/user/stream
     */
    static async streamUserEvents(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        ControllerHelper.logRequestStart('streamUserEvents', req);

        try {
            // Set SSE headers
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');

            // Send initial connection message
            res.write(`data: ${JSON.stringify({
                type: 'connected',
                timestamp: new Date(),
                message: 'Connected to your Cost Katana Brain stream'
            })}\n\n`);

            // Listen to Brain events and filter for this user
            const brainEventListener = (event: any) => {
                // Only send events relevant to this user
                if (event.userId === userId || event.data?.userId === userId) {
                    res.write(`data: ${JSON.stringify({
                        ...event,
                        timestamp: new Date()
                    })}\n\n`);
                }
            };

            const metricsListener = () => {
                // Send user-specific metrics
                const userFlows = costKatanaBrain.getActiveFlowsByUser(userId);
                const userMetrics = {
                    totalActiveFlows: userFlows.length,
                    totalEstimatedCost: userFlows.reduce((sum, f) => sum + f.estimatedCost, 0)
                };

                res.write(`data: ${JSON.stringify({
                    type: 'user-metrics-update',
                    data: userMetrics,
                    timestamp: new Date()
                })}\n\n`);
            };

            // Register listeners
            costKatanaBrain.on('brain-event', brainEventListener);
            costKatanaBrain.on('metrics-update', metricsListener);

            // Send periodic heartbeat
            const heartbeatInterval = setInterval(() => {
                res.write(`data: ${JSON.stringify({
                    type: 'heartbeat',
                    timestamp: new Date()
                })}\n\n`);
            }, 30000);

            // Cleanup on client disconnect
            req.on('close', () => {
                clearInterval(heartbeatInterval);
                costKatanaBrain.off('brain-event', brainEventListener);
                costKatanaBrain.off('metrics-update', metricsListener);
                
                loggingService.debug('User SSE client disconnected', {
                    component: 'BrainController',
                    userId
                });
            });

            loggingService.info('User SSE client connected', {
                component: 'BrainController',
                userId
            });

        } catch (error) {
            ControllerHelper.handleError('streamUserEvents', error, req, res, startTime);
            next(error);
        }
    }

    // ========================================================================
    // ADMIN METHODS (Global system view)
    // ========================================================================

    /**
     * Server-Sent Events stream for real-time Brain updates (Admin only)
     * GET /api/brain/admin/stream
     */
    static async streamBrainEvents(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        ControllerHelper.logRequestStart('streamBrainEvents', req);

        try {
            // Set SSE headers
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

            // Send initial connection message
            res.write(`data: ${JSON.stringify({
                type: 'connected',
                timestamp: new Date(),
                message: 'Connected to Cost Katana Brain stream'
            })}\n\n`);

            // Listen to Brain events
            const brainEventListener = (event: any) => {
                res.write(`data: ${JSON.stringify({
                    ...event,
                    timestamp: new Date()
                })}\n\n`);
            };

            const metricsListener = (metrics: any) => {
                res.write(`data: ${JSON.stringify({
                    type: 'metrics-update',
                    data: metrics,
                    timestamp: new Date()
                })}\n\n`);
            };

            // Register listeners
            costKatanaBrain.on('brain-event', brainEventListener);
            costKatanaBrain.on('metrics-update', metricsListener);

            // Send periodic heartbeat
            const heartbeatInterval = setInterval(() => {
                res.write(`data: ${JSON.stringify({
                    type: 'heartbeat',
                    timestamp: new Date()
                })}\n\n`);
            }, 30000); // Every 30 seconds

            // Cleanup on client disconnect
            req.on('close', () => {
                clearInterval(heartbeatInterval);
                costKatanaBrain.off('brain-event', brainEventListener);
                costKatanaBrain.off('metrics-update', metricsListener);
                
                loggingService.debug('SSE client disconnected', {
                    component: 'BrainController'
                });
            });

            loggingService.info('SSE client connected', {
                component: 'BrainController'
            });

        } catch (error) {
            ControllerHelper.handleError('streamBrainEvents', error, req, res, startTime);
            next(error);
        }
    }
}

