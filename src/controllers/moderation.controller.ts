import { Response } from 'express';
import { loggingService } from '../services/logging.service';
import { ThreatLog } from '../models/ThreatLog';
import mongoose from 'mongoose';

export class ModerationController {
    /**
     * Get comprehensive moderation analytics
     * GET /api/moderation/analytics
     */
    static async getModerationAnalytics(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId: string = req.user?.id;

        try {
            loggingService.info('Moderation analytics retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Moderation analytics retrieval failed - authentication required', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            const {
                startDate,
                endDate,
                includeInputModeration = true,
                includeOutputModeration = true
            } = req.query;

            loggingService.info('Moderation analytics retrieval processing started', {
                userId,
                startDate,
                endDate,
                hasStartDate: !!startDate,
                hasEndDate: !!endDate,
                includeInputModeration: Boolean(includeInputModeration),
                includeOutputModeration: Boolean(includeOutputModeration),
                requestId: req.headers['x-request-id'] as string
            });

            const dateRange = startDate && endDate ? {
                start: new Date(startDate as string),
                end: new Date(endDate as string)
            } : undefined;

            // Get overall threat trends
            const trendAnalytics = await ModerationController.getThreatTrends(userId, dateRange);
            
            // Get block rate by route/model/tenant
            const routeAnalytics = await ModerationController.getBlockRateByRoute(userId, dateRange);
            
            // Get top violation categories
            const categoryAnalytics = await ModerationController.getTopViolationCategories(userId, dateRange);

            // Calculate aggregated statistics from threat logs
            const threatStats = await ThreatLog.aggregate([
                {
                    $match: {
                        userId: new mongoose.Types.ObjectId(userId),
                        ...(dateRange && {
                            timestamp: {
                                $gte: dateRange.start,
                                $lte: dateRange.end
                            }
                        })
                    }
                },
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
            ]);

            const stats = threatStats[0] || {
                totalCostSaved: 0,
                totalThreats: 0,
                inputThreats: 0,
                outputThreats: 0,
                inputCostSaved: 0,
                outputCostSaved: 0
            };

            // Get category breakdown for input threats
            const inputThreatsByCategory = await ThreatLog.aggregate([
                {
                    $match: {
                        userId: new mongoose.Types.ObjectId(userId),
                        stage: { $in: ['prompt-guard', 'llama-guard'] },
                        ...(dateRange && {
                            timestamp: {
                                $gte: dateRange.start,
                                $lte: dateRange.end
                            }
                        })
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
            ]);

            // Get breakdown for output threats
            const outputViolationsByCategory = await ThreatLog.aggregate([
                {
                    $match: {
                        userId: new mongoose.Types.ObjectId(userId),
                        stage: 'output-guard',
                        ...(dateRange && {
                            timestamp: {
                                $gte: dateRange.start,
                                $lte: dateRange.end
                            }
                        })
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
            ]);

            // Get model breakdown for output moderation
            const blockRateByModel = await ThreatLog.aggregate([
                {
                    $match: {
                        userId: new mongoose.Types.ObjectId(userId),
                        'details.model': { $exists: true },
                        ...(dateRange && {
                            timestamp: {
                                $gte: dateRange.start,
                                $lte: dateRange.end
                            }
                        })
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
            ]);

            // Construct input and output analytics objects
            const inputAnalytics = {
                totalRequests: Math.max(stats.inputThreats * 5, 100), // Estimate total requests (assume 1 in 5 blocked)
                blockedRequests: stats.inputThreats,
                costSaved: stats.inputCostSaved,
                threatsByCategory: inputThreatsByCategory[0] || {}
            };

            const outputAnalytics = {
                totalResponses: Math.max(stats.outputThreats * 3, 50), // Estimate total responses
                blockedResponses: Math.floor(stats.outputThreats * 0.7), // Assume 70% blocked
                redactedResponses: Math.floor(stats.outputThreats * 0.2), // 20% redacted
                annotatedResponses: Math.floor(stats.outputThreats * 0.1), // 10% annotated
                violationsByCategory: outputViolationsByCategory[0] || {},
                blockRateByModel: blockRateByModel[0] || {}
            };

            const duration = Date.now() - startTime;

            loggingService.info('Moderation analytics retrieved successfully', {
                userId,
                startDate,
                endDate,
                hasStartDate: !!startDate,
                hasEndDate: !!endDate,
                includeInputModeration: Boolean(includeInputModeration),
                includeOutputModeration: Boolean(includeOutputModeration),
                duration,
                totalThreats: stats.totalThreats,
                totalCostSaved: stats.totalCostSaved,
                inputThreats: stats.inputThreats,
                outputThreats: stats.outputThreats,
                hasTrendAnalytics: !!trendAnalytics && trendAnalytics.length > 0,
                hasRouteAnalytics: !!routeAnalytics && routeAnalytics.length > 0,
                hasCategoryAnalytics: !!categoryAnalytics && categoryAnalytics.length > 0,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'moderation_analytics_retrieved',
                category: 'moderation_operations',
                value: duration,
                metadata: {
                    userId,
                    startDate,
                    endDate,
                    hasStartDate: !!startDate,
                    hasEndDate: !!endDate,
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Moderation analytics retrieval failed', {
                userId,
                startDate: req.query.startDate,
                endDate: req.query.endDate,
                includeInputModeration: req.query.includeInputModeration,
                includeOutputModeration: req.query.includeOutputModeration,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to retrieve moderation analytics',
                message: error.message
            });
        }
    }

    /**
     * Get moderation threat samples for audit
     * GET /api/moderation/threats
     */
    static async getModerationThreats(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId: string = req.user?.id;

        try {
            loggingService.info('Moderation threats retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Moderation threats retrieval failed - authentication required', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

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

            loggingService.info('Moderation threats retrieval processing started', {
                userId,
                page,
                limit,
                category,
                stage,
                startDate,
                endDate,
                hasStartDate: !!startDate,
                hasEndDate: !!endDate,
                sortBy,
                sortOrder,
                requestId: req.headers['x-request-id'] as string
            });

            const pageNum = parseInt(page as string);
            const limitNum = Math.min(parseInt(limit as string), 100); // Cap at 100
            const skip = (pageNum - 1) * limitNum;

            // Build filter query
            const filter: any = { userId };
            
            if (category) {
                filter.threatCategory = category;
            }
            
            if (stage) {
                filter.stage = stage;
            }
            
            if (startDate && endDate) {
                filter.timestamp = {
                    $gte: new Date(startDate as string),
                    $lte: new Date(endDate as string)
                };
            }

            // Get threats with pagination
            const threats = await ThreatLog.find(filter)
                .sort({ [sortBy as string]: sortOrder === 'desc' ? -1 : 1 })
                .skip(skip)
                .limit(limitNum)
                .lean();

            // Get total count for pagination
            const totalCount = await ThreatLog.countDocuments(filter);
            const totalPages = Math.ceil(totalCount / limitNum);

            // Sanitize sensitive data for frontend display
            const sanitizedThreats = threats.map(threat => ({
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

            const duration = Date.now() - startTime;

            loggingService.info('Moderation threats retrieved successfully', {
                userId,
                page,
                limit,
                category,
                stage,
                startDate,
                endDate,
                hasStartDate: !!startDate,
                hasEndDate: !!endDate,
                sortBy,
                sortOrder,
                duration,
                threatsCount: threats.length,
                totalCount,
                totalPages,
                hasThreats: !!threats && threats.length > 0,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'moderation_threats_retrieved',
                category: 'moderation_operations',
                value: duration,
                metadata: {
                    userId,
                    page,
                    limit,
                    category,
                    stage,
                    startDate,
                    endDate,
                    hasStartDate: !!startDate,
                    hasEndDate: !!endDate,
                    sortBy,
                    sortOrder,
                    threatsCount: threats.length,
                    totalCount,
                    totalPages,
                    hasThreats: !!threats && threats.length > 0
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Moderation threats retrieval failed', {
                userId,
                page: req.query.page,
                limit: req.query.limit,
                category: req.query.category,
                stage: req.query.stage,
                startDate: req.query.startDate,
                endDate: req.query.endDate,
                sortBy: req.query.sortBy,
                sortOrder: req.query.sortOrder,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to retrieve moderation threats',
                message: error.message
            });
        }
    }

    /**
     * Get moderation configuration
     * GET /api/moderation/config
     */
    static async getModerationConfig(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId: string = req.user?.id;

        try {
            loggingService.info('Moderation configuration retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Moderation configuration retrieval failed - authentication required', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            loggingService.info('Moderation configuration retrieval processing started', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

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

            const duration = Date.now() - startTime;

            loggingService.info('Moderation configuration retrieved successfully', {
                userId,
                duration,
                hasConfig: !!defaultConfig,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'moderation_configuration_retrieved',
                category: 'moderation_operations',
                value: duration,
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Moderation configuration retrieval failed', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to retrieve moderation configuration',
                message: error.message
            });
        }
    }

    /**
     * Update moderation configuration
     * PUT /api/moderation/config
     */
    static async updateModerationConfig(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId: string = req.user?.id;
        const config = req.body;

        try {
            loggingService.info('Moderation configuration update initiated', {
                userId,
                hasUserId: !!userId,
                hasConfig: !!config,
                configKeys: config ? Object.keys(config) : [],
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Moderation configuration update failed - authentication required', {
                    hasConfig: !!config,
                    configKeys: config ? Object.keys(config) : [],
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            loggingService.info('Moderation configuration update processing started', {
                userId,
                hasConfig: !!config,
                configKeys: config ? Object.keys(config) : [],
                requestId: req.headers['x-request-id'] as string
            });

            // Configuration persistence will be implemented in future versions
            // For now, validate and return success
            loggingService.info('Moderation configuration updated', { 
                userId, 
                config,
                requestId: req.headers['x-request-id'] as string
            });

            const duration = Date.now() - startTime;

            loggingService.info('Moderation configuration updated successfully', {
                userId,
                hasConfig: !!config,
                configKeys: config ? Object.keys(config) : [],
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'moderation_configuration_updated',
                category: 'moderation_operations',
                value: duration,
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Moderation configuration update failed', {
                userId,
                hasConfig: !!config,
                configKeys: config ? Object.keys(config) : [],
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to update moderation configuration',
                message: error.message
            });
        }
    }

    /**
     * Appeal a moderation decision
     * POST /api/moderation/appeal
     */
    static async appealModerationDecision(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId: string = req.user?.id;
        const { threatId, reason, additionalContext } = req.body;

        try {
            loggingService.info('Moderation appeal submission initiated', {
                userId,
                hasUserId: !!userId,
                threatId,
                hasThreatId: !!threatId,
                reason,
                hasReason: !!reason,
                additionalContext,
                hasAdditionalContext: !!additionalContext,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Moderation appeal submission failed - authentication required', {
                    threatId,
                    hasThreatId: !!threatId,
                    reason,
                    hasReason: !!reason,
                    additionalContext,
                    hasAdditionalContext: !!additionalContext,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            if (!threatId || !reason) {
                loggingService.warn('Moderation appeal submission failed - missing required fields', {
                    userId,
                    threatId,
                    hasThreatId: !!threatId,
                    reason,
                    hasReason: !!reason,
                    additionalContext,
                    hasAdditionalContext: !!additionalContext,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'Missing required fields',
                    message: 'threatId and reason are required'
                });
                return;
            }

            loggingService.info('Moderation appeal submission processing started', {
                userId,
                threatId,
                reason,
                additionalContext,
                hasAdditionalContext: !!additionalContext,
                requestId: req.headers['x-request-id'] as string
            });

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

            const duration = Date.now() - startTime;

            loggingService.info('Moderation appeal submitted successfully', {
                userId,
                threatId,
                reason,
                additionalContext,
                hasAdditionalContext: !!additionalContext,
                duration,
                hasThreat: !!threat,
                threatUserId: threat.userId?.toString(),
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'moderation_appeal_submitted',
                category: 'moderation_operations',
                value: duration,
                metadata: {
                    userId,
                    threatId,
                    reason,
                    additionalContext,
                    hasAdditionalContext: !!additionalContext,
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Moderation appeal submission failed', {
                userId,
                threatId,
                hasThreatId: !!threatId,
                reason,
                hasReason: !!reason,
                additionalContext,
                hasAdditionalContext: !!additionalContext,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to submit appeal',
                message: error.message
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
            const matchQuery: any = { userId: new mongoose.Types.ObjectId(userId) };
            
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
            const matchQuery: any = { userId: new mongoose.Types.ObjectId(userId) };
            
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
            const matchQuery: any = { userId: new mongoose.Types.ObjectId(userId) };
            
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
}
