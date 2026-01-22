import { Response, NextFunction } from 'express';
import { intelligenceService } from '../services/intelligence.service';
import { qualityService } from '../services/quality.service';
import { Usage, User } from '../models';
import { loggingService } from '../services/logging.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

export class IntelligenceController {
    /**
     * Get personalized tips for dashboard
     */
    static async getPersonalizedTips(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const limit = parseInt(req.query.limit as string) || 3;

        try {
            loggingService.info('Personalized tips retrieval initiated', {
                userId,
                hasUserId: !!userId,
                limit,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Personalized tips retrieval failed - authentication required', {
                    limit,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    error: 'Unauthorized'
                });
                return; 
            }

            loggingService.info('Personalized tips retrieval processing started', {
                userId,
                limit,
                requestId: req.headers['x-request-id'] as string
            });

            const tips = await intelligenceService.getPersonalizedTips(userId, limit);

            const duration = Date.now() - startTime;

            loggingService.info('Personalized tips retrieved successfully', {
                userId,
                limit,
                duration,
                tipsCount: tips.length,
                hasTips: !!tips && tips.length > 0,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'personalized_tips_retrieved',
                category: 'intelligence_operations',
                value: duration,
                metadata: {
                    userId,
                    limit,
                    tipsCount: tips.length,
                    hasTips: !!tips && tips.length > 0
                }
            });

            res.json({
                success: true,
                data: tips
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Personalized tips retrieval failed', {
                userId,
                limit,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            next(error);
        }
    }

    /**
     * Get tips for a specific usage
     */
    static async getTipsForUsage(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getTipsForUsage', req);

            const { usageId } = req.params;
            ServiceHelper.validateObjectId(usageId, 'usageId');

            // Parallel database queries for better performance
            const [usage, user] = await Promise.all([
                Usage.findOne({ _id: usageId, userId }).lean(),
                User.findById(userId).select('subscription preferences').lean()
            ]);

            if (!usage) {
                res.status(404).json({
                    success: false,
                    error: 'Usage not found'
                });
                return;
            }

            const tips = await intelligenceService.analyzeAndRecommendTips({
                usage: usage as any,
                user: user as any
            });

            ControllerHelper.logRequestSuccess('getTipsForUsage', req, startTime, {
                usageId,
                tipsCount: tips.length
            });

            // Log business event
            loggingService.logBusiness({
                event: 'usage_specific_tips_retrieved',
                category: 'intelligence_operations',
                value: Date.now() - startTime,
                metadata: {
                    userId,
                    usageId,
                    tipsCount: tips.length,
                    hasTips: !!tips && tips.length > 0,
                    hasUser: !!user
                }
            });

            res.json({
                success: true,
                data: tips
            });
        } catch (error: any) {
            ControllerHelper.handleError('getTipsForUsage', error, req, res, startTime);
        }
    }

    /**
     * Track tip interaction
     */
    static async trackTipInteraction(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('trackTipInteraction', req);

            const { tipId } = req.params;
            const { interaction } = req.body;

            if (!['display', 'click', 'dismiss', 'success'].includes(interaction)) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid interaction type'
                });
                return;
            }

            await intelligenceService.trackTipInteraction(tipId, interaction, userId);

            ControllerHelper.logRequestSuccess('trackTipInteraction', req, startTime, {
                tipId,
                interaction
            });

            // Log business event
            loggingService.logBusiness({
                event: 'tip_interaction_tracked',
                category: 'intelligence_operations',
                value: Date.now() - startTime,
                metadata: {
                    userId,
                    tipId,
                    interaction
                }
            });

            res.json({
                success: true,
                message: 'Interaction tracked'
            });
        } catch (error: any) {
            ControllerHelper.handleError('trackTipInteraction', error, req, res, startTime);
        }
    }

    /**
     * Score response quality
     */
    static async scoreResponseQuality(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('scoreResponseQuality', req);

            const { prompt, response, expectedOutput, method } = req.body;

            if (!prompt || !response) {
                res.status(400).json({
                    success: false,
                    error: 'Prompt and response are required'
                });
                return;
            }

            const assessment = await qualityService.scoreResponse(
                prompt,
                response,
                expectedOutput,
                method || 'hybrid'
            );

            ControllerHelper.logRequestSuccess('scoreResponseQuality', req, startTime);

            // Log business event
            loggingService.logBusiness({
                event: 'response_quality_scored',
                category: 'intelligence_operations',
                value: Date.now() - startTime,
                metadata: {
                    userId,
                    hasPrompt: !!prompt,
                    hasResponse: !!response,
                    hasExpectedOutput: !!expectedOutput,
                    method: method || 'hybrid',
                    hasAssessment: !!assessment
                }
            });

            res.json({
                success: true,
                data: assessment
            });
        } catch (error: any) {
            ControllerHelper.handleError('scoreResponseQuality', error, req, res, startTime);
        }
    }

    /**
     * Compare quality of original vs optimized response
     */
    static async compareQuality(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('compareQuality', req);

            const { prompt, originalResponse, optimizedResponse, costSavings } = req.body;

            if (!prompt || !originalResponse || !optimizedResponse || !costSavings) {
                res.status(400).json({
                    success: false,
                    error: 'All fields are required'
                });
                return;
            }

            const comparison = await qualityService.compareQuality(
                prompt,
                originalResponse,
                optimizedResponse,
                costSavings
            );

            // Save to database
            const qualityScore = await qualityService.saveQualityScore({
                userId,
                originalScore: comparison.originalScore,
                optimizedScore: comparison.optimizedScore,
                scoringMethod: 'hybrid',
                costSavings,
                optimizationType: ['manual_comparison']
            });

            ControllerHelper.logRequestSuccess('compareQuality', req, startTime, {
                originalScore: comparison.originalScore,
                optimizedScore: comparison.optimizedScore
            });

            // Log business event
            loggingService.logBusiness({
                event: 'quality_comparison_completed',
                category: 'intelligence_operations',
                value: Date.now() - startTime,
                metadata: {
                    userId,
                    hasPrompt: !!prompt,
                    hasOriginalResponse: !!originalResponse,
                    hasOptimizedResponse: !!optimizedResponse,
                    hasCostSavings: !!costSavings,
                    hasComparison: !!comparison,
                    hasQualityScore: !!qualityScore,
                    originalScore: comparison.originalScore,
                    optimizedScore: comparison.optimizedScore
                }
            });

            res.json({
                success: true,
                data: {
                    comparison,
                    scoreId: qualityScore._id
                }
            });
        } catch (error: any) {
            ControllerHelper.handleError('compareQuality', error, req, res, startTime);
        }
    }

    /**
     * Get quality statistics for user
     */
    static async getQualityStats(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getQualityStats', req);

            const stats = await qualityService.getUserQualityStats(userId);

            ControllerHelper.logRequestSuccess('getQualityStats', req, startTime);

            // Log business event
            loggingService.logBusiness({
                event: 'quality_statistics_retrieved',
                category: 'intelligence_operations',
                value: Date.now() - startTime,
                metadata: {
                    userId,
                    hasStats: !!stats
                }
            });

            res.json({
                success: true,
                data: stats
            });
        } catch (error: any) {
            ControllerHelper.handleError('getQualityStats', error, req, res, startTime);
        }
    }

    /**
     * Update user feedback for quality score
     */
    static async updateQualityFeedback(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('updateQualityFeedback', req);

            const { scoreId } = req.params;
            ServiceHelper.validateObjectId(scoreId, 'scoreId');
            const { rating, isAcceptable, comment } = req.body;

            if (typeof isAcceptable !== 'boolean') {
                res.status(400).json({
                    success: false,
                    error: 'isAcceptable is required'
                });
                return;
            }

            await qualityService.updateUserFeedback(scoreId, {
                rating,
                isAcceptable,
                comment
            });

            ControllerHelper.logRequestSuccess('updateQualityFeedback', req, startTime, {
                scoreId
            });

            // Log business event
            loggingService.logBusiness({
                event: 'quality_feedback_updated',
                category: 'intelligence_operations',
                value: Date.now() - startTime,
                metadata: {
                    userId,
                    scoreId,
                    rating,
                    isAcceptable,
                    hasComment: !!comment
                }
            });

            res.json({
                success: true,
                message: 'Feedback updated'
            });
        } catch (error: any) {
            ControllerHelper.handleError('updateQualityFeedback', error, req, res, startTime);
        }
    }

    /**
     * Initialize default tips (admin only)
     */
    static async initializeTips(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('initializeTips', req);

            // This should be restricted to admin users in production
            await intelligenceService.initializeDefaultTips();

            ControllerHelper.logRequestSuccess('initializeTips', req, startTime);

            // Log business event
            loggingService.logBusiness({
                event: 'default_tips_initialized',
                category: 'intelligence_operations',
                value: Date.now() - startTime,
                metadata: {
                    userId,
                    userRole: req.user?.role
                }
            });

            res.json({
                success: true,
                message: 'Default tips initialized'
            });
        } catch (error: any) {
            ControllerHelper.handleError('initializeTips', error, req, res, startTime);
        }
    }
}

export const intelligenceController = new IntelligenceController(); 