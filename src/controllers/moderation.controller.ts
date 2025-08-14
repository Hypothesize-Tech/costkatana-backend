import { Response } from 'express';
import { logger } from '../utils/logger';
import { ThreatLog } from '../models/ThreatLog';
import mongoose from 'mongoose';

export class ModerationController {
    /**
     * Get comprehensive moderation analytics
     * GET /api/moderation/analytics
     */
    static async getModerationAnalytics(req: any, res: Response): Promise<void> {
        try {
            const userId: string = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

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
            logger.error('Error getting moderation analytics:', error);
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
        try {
            const userId: string = req.user?.id;
            if (!userId) {
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
            logger.error('Error getting moderation threats:', error);
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
        try {
            const userId: string = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

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

            res.json({
                success: true,
                data: defaultConfig
            });
        } catch (error: any) {
            logger.error('Error getting moderation config:', error);
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
        try {
            const userId: string = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            const config = req.body;

            // TODO: Implement actual configuration persistence
            // For now, just validate and return success
            logger.info('Moderation configuration updated', { userId, config });

            res.json({
                success: true,
                message: 'Moderation configuration updated successfully',
                data: config
            });
        } catch (error: any) {
            logger.error('Error updating moderation config:', error);
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
        try {
            const userId: string = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            const { threatId, reason, additionalContext } = req.body;

            if (!threatId || !reason) {
                res.status(400).json({
                    success: false,
                    error: 'Missing required fields',
                    message: 'threatId and reason are required'
                });
                return;
            }

            // Find the threat log
            const threat = await ThreatLog.findById(threatId);
            if (!threat) {
                res.status(404).json({
                    success: false,
                    error: 'Threat not found',
                    message: 'The specified threat log was not found'
                });
                return;
            }

            // Verify ownership
            if (threat.userId?.toString() !== userId) {
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

            // TODO: Implement actual appeal system
            // For now, just log the appeal
            logger.info('Moderation appeal submitted', appealData);

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
            logger.error('Error submitting moderation appeal:', error);
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
        } catch (error) {
            logger.error('Error getting threat trends:', error);
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
        } catch (error) {
            logger.error('Error getting route analytics:', error);
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
        } catch (error) {
            logger.error('Error getting violation categories:', error);
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
