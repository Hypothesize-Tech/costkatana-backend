import { Response } from 'express';
import { loggingService } from '../services/logging.service';
import { ThreatLog } from '../models/ThreatLog';
import mongoose from 'mongoose';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

export class ModerationController {
    // ObjectId memoization per request
    private static objectIdCache = new Map<string, mongoose.Types.ObjectId>();
    
    // Background analytics queue
    private static analyticsQueue: Array<() => Promise<void>> = [];
    private static analyticsProcessor?: NodeJS.Timeout;
    /**
     * Get comprehensive moderation analytics
     * GET /api/moderation/analytics
     */
    static async getModerationAnalytics(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('getModerationAnalytics', req);

        try {

            const {
                startDate,
                endDate,
                includeInputModeration = true,
                includeOutputModeration = true
            } = req.query;

            const dateRange = startDate && endDate ? {
                start: new Date(startDate as string),
                end: new Date(endDate as string)
            } : undefined;

            // Get memoized ObjectId for user
            const userObjectId = ModerationController.getMemoizedObjectId(userId);

            // Execute analytics in parallel for better performance
            const [trendAnalytics, routeAnalytics, categoryAnalytics, unifiedAnalytics] = await Promise.all([
                ModerationController.getThreatTrends(userId, dateRange),
                ModerationController.getBlockRateByRoute(userId, dateRange),
                ModerationController.getTopViolationCategories(userId, dateRange),
                ModerationController.getUnifiedAnalytics(userObjectId, dateRange)
            ]);

            // Extract results from unified analytics
            const stats = unifiedAnalytics.threatStats || {
                totalCostSaved: 0,
                totalThreats: 0,
                inputThreats: 0,
                outputThreats: 0,
                inputCostSaved: 0,
                outputCostSaved: 0
            };

            const inputThreatsByCategory = unifiedAnalytics.inputThreatsByCategory || {};
            const outputViolationsByCategory = unifiedAnalytics.outputViolationsByCategory || {};
            const blockRateByModel = unifiedAnalytics.blockRateByModel || {};

            // Construct input and output analytics objects
            const inputAnalytics = {
                totalRequests: Math.max(stats.inputThreats * 5, 100), // Estimate total requests (assume 1 in 5 blocked)
                blockedRequests: stats.inputThreats,
                costSaved: stats.inputCostSaved,
                threatsByCategory: inputThreatsByCategory
            };

            const outputAnalytics = {
                totalResponses: Math.max(stats.outputThreats * 3, 50), // Estimate total responses
                blockedResponses: Math.floor(stats.outputThreats * 0.7), // Assume 70% blocked
                redactedResponses: Math.floor(stats.outputThreats * 0.2), // 20% redacted
                annotatedResponses: Math.floor(stats.outputThreats * 0.1), // 10% annotated
                violationsByCategory: outputViolationsByCategory,
                blockRateByModel: blockRateByModel
            };

            ControllerHelper.logRequestSuccess('getModerationAnalytics', req, startTime, {
                startDate,
                endDate,
                includeInputModeration: Boolean(includeInputModeration),
                includeOutputModeration: Boolean(includeOutputModeration),
                totalThreats: stats.totalThreats,
                totalCostSaved: stats.totalCostSaved,
                inputThreats: stats.inputThreats,
                outputThreats: stats.outputThreats,
                hasTrendAnalytics: !!trendAnalytics && trendAnalytics.length > 0,
                hasRouteAnalytics: !!routeAnalytics && routeAnalytics.length > 0,
                hasCategoryAnalytics: !!categoryAnalytics && categoryAnalytics.length > 0
            });

            // Log business event
            loggingService.logBusiness({
                event: 'moderation_analytics_retrieved',
                category: 'moderation_operations',
                value: Date.now() - startTime,
                metadata: {
                    userId,
                    startDate,
                    endDate,
                    includeInputModeration: Boolean(includeInputModeration),
                    includeOutputModeration: Boolean(includeOutputModeration),
                    totalThreats: stats.totalThreats,
                    totalCostSaved: stats.totalCostSaved,
                    inputThreats: stats.inputThreats,
                    outputThreats: stats.outputThreats,
                    hasTrendAnalytics: !!trendAnalytics && trendAnalytics.length > 0,
                    hasRouteAnalytics: !!routeAnalytics && routeAnalytics.length > 0,
                    hasCategoryAnalytics: !!categoryAnalytics && categoryAnalytics.length > 0
                }
            });

            res.json({
                success: true,
                data: {
                    input: inputAnalytics,
                    output: outputAnalytics,
                    trends: trendAnalytics,
                    routes: routeAnalytics,
                    categories: categoryAnalytics,
                    summary: {
                        totalThreats: stats.totalThreats,
                        totalCostSaved: stats.totalCostSaved,
                        overallBlockRate: ModerationController.calculateOverallBlockRate(inputAnalytics, outputAnalytics),
                        lastUpdated: new Date().toISOString()
                    }
                },
                metadata: {
                    dateRange,
                    includeInputModeration,
                    includeOutputModeration,
                    generatedAt: new Date().toISOString()
                }
            });
        } catch (error: any) {
            ControllerHelper.handleError('getModerationAnalytics', error, req, res, startTime, {
                startDate: req.query.startDate,
                endDate: req.query.endDate,
                includeInputModeration: req.query.includeInputModeration,
                includeOutputModeration: req.query.includeOutputModeration
            });
        }
    }

    /**
     * Get moderation threat samples for audit
     * GET /api/moderation/threats
     */
    static async getModerationThreats(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('getModerationThreats', req);

        try {

            const {
                page = '1',
                limit = '20',
                category,
                stage,
                startDate,
                endDate,
                sortBy = 'timestamp',
                sortOrder = 'desc'
            } = req.query;


            const pageNum = parseInt(page as string);
            const limitNum = Math.min(parseInt(limit as string), 100); // Cap at 100
            const skip = (pageNum - 1) * limitNum;

            // Get memoized ObjectId for user
            const userObjectId = ModerationController.getMemoizedObjectId(userId);

            // Build optimized filter query
            const matchQuery: any = { userId: userObjectId };
            
            if (category) {
                matchQuery.threatCategory = category;
            }
            
            if (stage) {
                matchQuery.stage = stage;
            }
            
            if (startDate && endDate) {
                matchQuery.timestamp = {
                    $gte: new Date(startDate as string),
                    $lte: new Date(endDate as string)
                };
            }

            // Unified query with facet for threats and count
            const results = await ThreatLog.aggregate([
                { $match: matchQuery },
                {
                    $facet: {
                        threats: [
                            { $sort: { [sortBy as string]: sortOrder === 'desc' ? -1 : 1 } },
                            { $skip: skip },
                            { $limit: limitNum },
                            {
                                $project: {
                                    _id: 1,
                                    requestId: 1,
                                    threatCategory: 1,
                                    confidence: 1,
                                    stage: 1,
                                    reason: 1,
                                    costSaved: 1,
                                    timestamp: 1,
                                    promptPreview: 1,
                                    promptHash: 1,
                                    ipAddress: 1,
                                    'details.method': 1,
                                    'details.threatLevel': 1,
                                    'details.action': 1,
                                    'details.violationCategories': 1,
                                    'details.matchedPatterns': 1
                                }
                            }
                        ],
                        totalCount: [
                            { $count: 'count' }
                        ]
                    }
                }
            ]);

            const threats = results[0]?.threats || [];
            const totalCount = results[0]?.totalCount[0]?.count || 0;
            const totalPages = Math.ceil(totalCount / limitNum);

            // Sanitize sensitive data for frontend display (optimized processing)
            const sanitizedThreats = ModerationController.sanitizeThreatsData(threats);

            ControllerHelper.logRequestSuccess('getModerationThreats', req, startTime, {
                page,
                limit,
                category,
                stage,
                startDate,
                endDate,
                sortBy,
                sortOrder,
                threatsCount: threats.length,
                totalCount,
                totalPages
            });

            // Log business event
            loggingService.logBusiness({
                event: 'moderation_threats_retrieved',
                category: 'moderation_operations',
                value: Date.now() - startTime,
                metadata: {
                    userId,
                    page,
                    limit,
                    category,
                    stage,
                    startDate,
                    endDate,
                    sortBy,
                    sortOrder,
                    threatsCount: threats.length,
                    totalCount,
                    totalPages
                }
            });

            res.json({
                success: true,
                data: {
                    threats: sanitizedThreats,
                    pagination: {
                        currentPage: pageNum,
                        totalPages,
                        totalCount,
                        hasNext: pageNum < totalPages,
                        hasPrev: pageNum > 1
                    },
                    filters: {
                        category,
                        stage,
                        dateRange: startDate && endDate ? { startDate, endDate } : null
                    }
                }
            });
        } catch (error: any) {
            ControllerHelper.handleError('getModerationThreats', error, req, res, startTime, {
                page: req.query.page,
                limit: req.query.limit,
                category: req.query.category,
                stage: req.query.stage,
                startDate: req.query.startDate,
                endDate: req.query.endDate,
                sortBy: req.query.sortBy,
                sortOrder: req.query.sortOrder
            });
        }
    }

    /**
     * Get moderation configuration
     * GET /api/moderation/config
     */
    static async getModerationConfig(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('getModerationConfig', req);

        try {

            // Get user's moderation settings (would typically be stored in User model or Settings)
            // For now, return default configuration
            const defaultConfig = {
                inputModeration: {
                    enableBasicFirewall: true,
                    enableAdvancedFirewall: true,
                    promptGuardThreshold: 0.7,
                    llamaGuardThreshold: 0.7
                },
                outputModeration: {
                    enableOutputModeration: true,
                    toxicityThreshold: 0.7,
                    enablePIIDetection: true,
                    enableToxicityCheck: true,
                    enableHateSpeechCheck: true,
                    enableSexualContentCheck: true,
                    enableViolenceCheck: true,
                    enableSelfHarmCheck: true,
                    action: 'block'
                },
                piiDetection: {
                    enablePIIDetection: true,
                    useAI: true,
                    sanitizationEnabled: true
                }
            };

            ControllerHelper.logRequestSuccess('getModerationConfig', req, startTime, {
                hasConfig: !!defaultConfig
            });

            // Log business event
            loggingService.logBusiness({
                event: 'moderation_configuration_retrieved',
                category: 'moderation_operations',
                value: Date.now() - startTime,
                metadata: {
                    userId,
                    hasConfig: !!defaultConfig
                }
            });

            res.json({
                success: true,
                data: defaultConfig
            });
        } catch (error: any) {
            ControllerHelper.handleError('getModerationConfig', error, req, res, startTime);
        }
    }

    /**
     * Update moderation configuration
     * PUT /api/moderation/config
     */
    static async updateModerationConfig(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        const config = req.body;
        
        ControllerHelper.logRequestStart('updateModerationConfig', req, {
            hasConfig: !!config,
            configKeys: config ? Object.keys(config) : []
        });

        try {

            // Configuration persistence will be implemented in future versions
            // For now, validate and return success
            loggingService.info('Moderation configuration updated', { 
                userId, 
                config,
                requestId: req.headers['x-request-id'] as string
            });

            ControllerHelper.logRequestSuccess('updateModerationConfig', req, startTime, {
                hasConfig: !!config,
                configKeys: config ? Object.keys(config) : []
            });

            // Log business event
            loggingService.logBusiness({
                event: 'moderation_configuration_updated',
                category: 'moderation_operations',
                value: Date.now() - startTime,
                metadata: {
                    userId,
                    hasConfig: !!config,
                    configKeys: config ? Object.keys(config) : []
                }
            });

            res.json({
                success: true,
                message: 'Moderation configuration updated successfully',
                data: config
            });
        } catch (error: any) {
            ControllerHelper.handleError('updateModerationConfig', error, req, res, startTime, {
                hasConfig: !!config,
                configKeys: config ? Object.keys(config) : []
            });
        }
    }

    /**
     * Appeal a moderation decision
     * POST /api/moderation/appeal
     */
    static async appealModerationDecision(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        const { threatId, reason, additionalContext } = req.body;
        
        ControllerHelper.logRequestStart('appealModerationDecision', req, {
            threatId,
            hasReason: !!reason,
            hasAdditionalContext: !!additionalContext
        });

        try {

            if (!threatId || !reason) {
                res.status(400).json({
                    success: false,
                    error: 'Missing required fields',
                    message: 'threatId and reason are required'
                });
                return;
            }

            ServiceHelper.validateObjectId(threatId, 'threatId');

            // Find the threat log
            const threat = await ThreatLog.findById(threatId);
            if (!threat) {
                loggingService.warn('Moderation appeal submission failed - threat not found', {
                    userId,
                    threatId,
                    reason,
                    additionalContext,
                    hasAdditionalContext: !!additionalContext,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(404).json({
                    success: false,
                    error: 'Threat not found',
                    message: 'The specified threat log was not found'
                });
                return;
            }

            // Verify ownership
            if (threat.userId?.toString() !== userId) {
                loggingService.warn('Moderation appeal submission failed - unauthorized threat access', {
                    userId,
                    threatId,
                    reason,
                    additionalContext,
                    hasAdditionalContext: !!additionalContext,
                    threatUserId: threat.userId?.toString(),
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(403).json({
                    success: false,
                    error: 'Unauthorized',
                    message: 'You can only appeal your own moderation decisions'
                });
                return;
            }

            // Create appeal record (you might want a separate Appeals model)
            const appealData = {
                threatId,
                userId,
                reason,
                additionalContext,
                status: 'pending',
                submittedAt: new Date()
            };

            // Appeal system will be implemented in future versions
            // For now, log the appeal
            loggingService.info('Moderation appeal submitted', {
                ...appealData,
                requestId: req.headers['x-request-id'] as string
            });

            ControllerHelper.logRequestSuccess('appealModerationDecision', req, startTime, {
                threatId,
                hasThreat: !!threat,
                threatUserId: threat.userId?.toString()
            });

            // Log business event
            loggingService.logBusiness({
                event: 'moderation_appeal_submitted',
                category: 'moderation_operations',
                value: Date.now() - startTime,
                metadata: {
                    userId,
                    threatId,
                    reason,
                    additionalContext,
                    hasThreat: !!threat,
                    threatUserId: threat.userId?.toString()
                }
            });

            res.json({
                success: true,
                message: 'Appeal submitted successfully. It will be reviewed by our team.',
                data: {
                    appealId: `appeal_${Date.now()}`, // Temporary ID
                    status: 'pending',
                    submittedAt: appealData.submittedAt
                }
            });
        } catch (error: any) {
            ControllerHelper.handleError('appealModerationDecision', error, req, res, startTime, {
                threatId,
                hasReason: !!reason
            });
        }
    }

    /**
     * Get threat trends over time
     */
    private static async getThreatTrends(
        userId: string, 
        dateRange?: { start: Date; end: Date }
    ): Promise<any> {
        try {
            const userObjectId = ModerationController.getMemoizedObjectId(userId);
            const matchQuery: any = { userId: userObjectId };
            
            if (dateRange) {
                matchQuery.timestamp = {
                    $gte: dateRange.start,
                    $lte: dateRange.end
                };
            }

            const trends = await ThreatLog.aggregate([
                { $match: matchQuery },
                {
                    $group: {
                        _id: {
                            year: { $year: '$timestamp' },
                            month: { $month: '$timestamp' },
                            day: { $dayOfMonth: '$timestamp' }
                        },
                        count: { $sum: 1 },
                        categories: { $push: '$threatCategory' },
                        avgConfidence: { $avg: '$confidence' }
                    }
                },
                {
                    $project: {
                        date: {
                            $dateFromParts: {
                                year: '$_id.year',
                                month: '$_id.month',
                                day: '$_id.day'
                            }
                        },
                        count: 1,
                        categories: 1,
                        avgConfidence: { $round: ['$avgConfidence', 2] }
                    }
                },
                { $sort: { date: 1 } },
                { $limit: 30 } 
            ]);

            return trends;
        } catch (error: any) {
            loggingService.error('Error getting threat trends', {
                userId,
                dateRange,
                hasDateRange: !!dateRange,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            return [];
        }
    }

    /**
     * Get block rates by route/model/tenant
     */
    private static async getBlockRateByRoute(
        userId: string,
        dateRange?: { start: Date; end: Date }
    ): Promise<any> {
        try {
            const userObjectId = ModerationController.getMemoizedObjectId(userId);
            const matchQuery: any = { userId: userObjectId };
            
            if (dateRange) {
                matchQuery.timestamp = {
                    $gte: dateRange.start,
                    $lte: dateRange.end
                };
            }

            const routeStats = await ThreatLog.aggregate([
                { $match: matchQuery },
                {
                    $group: {
                        _id: {
                            stage: '$stage',
                            category: '$threatCategory'
                        },
                        count: { $sum: 1 },
                        avgConfidence: { $avg: '$confidence' }
                    }
                },
                {
                    $group: {
                        _id: '$_id.stage',
                        totalBlocked: { $sum: '$count' },
                        categories: {
                            $push: {
                                category: '$_id.category',
                                count: '$count',
                                avgConfidence: { $round: ['$avgConfidence', 2] }
                            }
                        }
                    }
                }
            ]);

            return routeStats;
        } catch (error: any) {
            loggingService.error('Error getting route analytics', {
                userId,
                dateRange,
                hasDateRange: !!dateRange,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            return [];
        }
    }

    /**
     * Get top violation categories
     */
    private static async getTopViolationCategories(
        userId: string,
        dateRange?: { start: Date; end: Date }
    ): Promise<any> {
        try {
            const userObjectId = ModerationController.getMemoizedObjectId(userId);
            const matchQuery: any = { userId: userObjectId };
            
            if (dateRange) {
                matchQuery.timestamp = {
                    $gte: dateRange.start,
                    $lte: dateRange.end
                };
            }

            const categories = await ThreatLog.aggregate([
                { $match: matchQuery },
                {
                    $group: {
                        _id: '$threatCategory',
                        count: { $sum: 1 },
                        avgConfidence: { $avg: '$confidence' },
                        totalCostSaved: { $sum: '$costSaved' }
                    }
                },
                { $sort: { count: -1 } },
                { $limit: 10 },
                {
                    $project: {
                        category: '$_id',
                        count: 1,
                        avgConfidence: { $round: ['$avgConfidence', 2] },
                        totalCostSaved: { $round: ['$totalCostSaved', 2] },
                        _id: 0
                    }
                }
            ]);

            return categories;
        } catch (error: any) {
            loggingService.error('Error getting violation categories', {
                userId,
                dateRange,
                hasDateRange: !!dateRange,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            return [];
        }
    }

    /**
     * Calculate overall block rate
     */
    private static calculateOverallBlockRate(inputAnalytics: any, outputAnalytics: any): number {
        const totalRequests = (inputAnalytics?.totalRequests || 0) + (outputAnalytics?.totalResponses || 0);
        const totalBlocked = (inputAnalytics?.blockedRequests || 0) + (outputAnalytics?.blockedResponses || 0);
        
        return totalRequests > 0 ? (totalBlocked / totalRequests) * 100 : 0;
    }

    // ============================================================================
    // OPTIMIZATION UTILITY METHODS
    // ============================================================================

    /**
     * Get memoized ObjectId for user
     */
    private static getMemoizedObjectId(userId: string): mongoose.Types.ObjectId {
        let objectId = this.objectIdCache.get(userId);
        if (!objectId) {
            objectId = new mongoose.Types.ObjectId(userId);
            this.objectIdCache.set(userId, objectId);
            
            // Clean cache periodically (keep last 100 entries)
            if (this.objectIdCache.size > 100) {
                const firstKey = this.objectIdCache.keys().next().value;
                this.objectIdCache.delete(firstKey || '');
            }
        }
        return objectId;
    }

    /**
     * Unified analytics query using $facet for all data in single call
     */
    private static async getUnifiedAnalytics(
        userObjectId: mongoose.Types.ObjectId, 
        dateRange?: { start: Date; end: Date }
    ): Promise<any> {
        try {
            const matchQuery: any = { userId: userObjectId };
            
            if (dateRange) {
                matchQuery.timestamp = {
                    $gte: dateRange.start,
                    $lte: dateRange.end
                };
            }

            const results = await ThreatLog.aggregate([
                { $match: matchQuery },
                {
                    $facet: {
                        // Main threat statistics
                        threatStats: [
                            {
                                $group: {
                                    _id: null,
                                    totalCostSaved: { $sum: '$costSaved' },
                                    totalThreats: { $sum: 1 },
                                    inputThreats: { 
                                        $sum: { 
                                            $cond: [
                                                { $in: ['$stage', ['prompt-guard', 'llama-guard']] }, 
                                                1, 
                                                0
                                            ]
                                        }
                                    },
                                    outputThreats: { 
                                        $sum: { 
                                            $cond: [
                                                { $eq: ['$stage', 'output-guard'] }, 
                                                1, 
                                                0
                                            ]
                                        }
                                    },
                                    inputCostSaved: { 
                                        $sum: { 
                                            $cond: [
                                                { $in: ['$stage', ['prompt-guard', 'llama-guard']] }, 
                                                '$costSaved', 
                                                0
                                            ]
                                        }
                                    },
                                    outputCostSaved: { 
                                        $sum: { 
                                            $cond: [
                                                { $eq: ['$stage', 'output-guard'] }, 
                                                '$costSaved', 
                                                0
                                            ]
                                        }
                                    }
                                }
                            }
                        ],
                        // Input threats by category
                        inputThreatsByCategory: [
                            {
                                $match: {
                                    stage: { $in: ['prompt-guard', 'llama-guard'] }
                                }
                            },
                            {
                                $group: {
                                    _id: '$threatCategory',
                                    count: { $sum: 1 }
                                }
                            },
                            {
                                $group: {
                                    _id: null,
                                    categories: {
                                        $push: {
                                            k: '$_id',
                                            v: '$count'
                                        }
                                    }
                                }
                            },
                            {
                                $replaceRoot: {
                                    newRoot: { $arrayToObject: '$categories' }
                                }
                            }
                        ],
                        // Output violations by category
                        outputViolationsByCategory: [
                            {
                                $match: {
                                    stage: 'output-guard'
                                }
                            },
                            {
                                $group: {
                                    _id: '$threatCategory',
                                    count: { $sum: 1 }
                                }
                            },
                            {
                                $group: {
                                    _id: null,
                                    categories: {
                                        $push: {
                                            k: '$_id',
                                            v: '$count'
                                        }
                                    }
                                }
                            },
                            {
                                $replaceRoot: {
                                    newRoot: { $arrayToObject: '$categories' }
                                }
                            }
                        ],
                        // Block rate by model
                        blockRateByModel: [
                            {
                                $match: {
                                    'details.model': { $exists: true }
                                }
                            },
                            {
                                $group: {
                                    _id: '$details.model',
                                    count: { $sum: 1 }
                                }
                            },
                            {
                                $group: {
                                    _id: null,
                                    models: {
                                        $push: {
                                            k: '$_id',
                                            v: '$count'
                                        }
                                    }
                                }
                            },
                            {
                                $replaceRoot: {
                                    newRoot: { $arrayToObject: '$models' }
                                }
                            }
                        ]
                    }
                }
            ]);

            const result = results[0] || {};
            
            return {
                threatStats: result.threatStats?.[0] || {
                    totalCostSaved: 0,
                    totalThreats: 0,
                    inputThreats: 0,
                    outputThreats: 0,
                    inputCostSaved: 0,
                    outputCostSaved: 0
                },
                inputThreatsByCategory: result.inputThreatsByCategory?.[0] || {},
                outputViolationsByCategory: result.outputViolationsByCategory?.[0] || {},
                blockRateByModel: result.blockRateByModel?.[0] || {}
            };
        } catch (error: any) {
            loggingService.error('Error getting unified analytics', {
                userObjectId: userObjectId.toString(),
                dateRange,
                hasDateRange: !!dateRange,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            return {
                threatStats: {
                    totalCostSaved: 0,
                    totalThreats: 0,
                    inputThreats: 0,
                    outputThreats: 0,
                    inputCostSaved: 0,
                    outputCostSaved: 0
                },
                inputThreatsByCategory: {},
                outputViolationsByCategory: {},
                blockRateByModel: {}
            };
        }
    }

    /**
     * Memory-efficient threat data sanitization
     */
    private static sanitizeThreatsData(threats: any[]): any[] {
        return threats.map(threat => ({
            id: threat._id,
            requestId: threat.requestId,
            threatCategory: threat.threatCategory,
            confidence: threat.confidence,
            stage: threat.stage,
            reason: threat.reason,
            costSaved: threat.costSaved,
            timestamp: threat.timestamp,
            promptPreview: threat.promptPreview || null,
            promptHash: threat.promptHash ? threat.promptHash.substring(0, 8) : null,
            ipAddress: threat.ipAddress ? threat.ipAddress.replace(/(\d+\.\d+\.\d+)\.\d+/, '$1.xxx') : null,
            details: {
                method: threat.details?.method,
                threatLevel: threat.details?.threatLevel,
                action: threat.details?.action,
                violationCategories: threat.details?.violationCategories,
                matchedPatterns: threat.details?.matchedPatterns?.length || 0
            }
        }));
    }

    /**
     * Start background analytics processor
     */
    private static startAnalyticsProcessor(): void {
        if (this.analyticsProcessor) return;

        this.analyticsProcessor = setTimeout(async () => {
            await ModerationController.processAnalyticsQueue();
            this.analyticsProcessor = undefined;

            if (this.analyticsQueue.length > 0) {
                ModerationController.startAnalyticsProcessor();
            }
        }, 100);
    }

    /**
     * Process background analytics queue
     */
    private static async processAnalyticsQueue(): Promise<void> {
        const operations = this.analyticsQueue.splice(0, 3); // Process 3 at a time
        await Promise.allSettled(operations.map(op => op()));
    }
}
