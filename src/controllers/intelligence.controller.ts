import { Response, NextFunction } from 'express';
import { intelligenceService } from '../services/intelligence.service';
import { qualityService } from '../services/quality.service';
import { Usage, User } from '../models';
import { loggingService } from '../services/logging.service';

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
    static async getTipsForUsage(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const { usageId } = req.params;
        const userId = req.user?.id;

        try {
            loggingService.info('Usage-specific tips retrieval initiated', {
                userId,
                hasUserId: !!userId,
                usageId,
                hasUsageId: !!usageId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Usage-specific tips retrieval failed - authentication required', {
                    usageId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    error: 'Unauthorized'
                });
                return;
            }

            loggingService.info('Usage-specific tips retrieval processing started', {
                userId,
                usageId,
                requestId: req.headers['x-request-id'] as string
            });

            // Parallel database queries for better performance
            const [usage, user] = await Promise.all([
                Usage.findOne({ _id: usageId, userId }).lean(),
                User.findById(userId).select('subscription preferences').lean()
            ]);

            if (!usage) {
                loggingService.warn('Usage-specific tips retrieval failed - usage not found', {
                    userId,
                    usageId,
                    requestId: req.headers['x-request-id'] as string
                });

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

            const duration = Date.now() - startTime;

            loggingService.info('Usage-specific tips retrieved successfully', {
                userId,
                usageId,
                duration,
                tipsCount: tips.length,
                hasTips: !!tips && tips.length > 0,
                hasUser: !!user,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'usage_specific_tips_retrieved',
                category: 'intelligence_operations',
                value: duration,
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Usage-specific tips retrieval failed', {
                userId,
                usageId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            next(error);
        }
    }

    /**
     * Track tip interaction
     */
    static async trackTipInteraction(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const { tipId } = req.params;
        const { interaction } = req.body;
        const userId = req.user?.id;

        try {
            loggingService.info('Tip interaction tracking initiated', {
                userId,
                hasUserId: !!userId,
                tipId,
                hasTipId: !!tipId,
                interaction,
                hasInteraction: !!interaction,
                requestId: req.headers['x-request-id'] as string
            });

            if (!['display', 'click', 'dismiss', 'success'].includes(interaction)) {
                loggingService.warn('Tip interaction tracking failed - invalid interaction type', {
                    userId,
                    tipId,
                    interaction,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'Invalid interaction type'
                });
                return;
            }

            loggingService.info('Tip interaction tracking processing started', {
                userId,
                tipId,
                interaction,
                requestId: req.headers['x-request-id'] as string
            });

            await intelligenceService.trackTipInteraction(tipId, interaction, userId);

            const duration = Date.now() - startTime;

            loggingService.info('Tip interaction tracked successfully', {
                userId,
                tipId,
                interaction,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'tip_interaction_tracked',
                category: 'intelligence_operations',
                value: duration,
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Tip interaction tracking failed', {
                userId,
                tipId,
                interaction,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            next(error);
        }
    }

    /**
     * Score response quality
     */
    static async scoreResponseQuality(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const { prompt, response, expectedOutput, method } = req.body;
        const userId = req.user?.id;

        try {
            loggingService.info('Response quality scoring initiated', {
                userId,
                hasUserId: !!userId,
                hasPrompt: !!prompt,
                hasResponse: !!response,
                hasExpectedOutput: !!expectedOutput,
                method: method || 'hybrid',
                requestId: req.headers['x-request-id'] as string
            });

            if (!prompt || !response) {
                loggingService.warn('Response quality scoring failed - missing required fields', {
                    userId,
                    hasPrompt: !!prompt,
                    hasResponse: !!response,
                    expectedOutput,
                    method: method || 'hybrid',
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'Prompt and response are required'
                });
                return;
            }

            loggingService.info('Response quality scoring processing started', {
                userId,
                hasPrompt: !!prompt,
                hasResponse: !!response,
                hasExpectedOutput: !!expectedOutput,
                method: method || 'hybrid',
                requestId: req.headers['x-request-id'] as string
            });

            const assessment = await qualityService.scoreResponse(
                prompt,
                response,
                expectedOutput,
                method || 'hybrid'
            );

            const duration = Date.now() - startTime;

            loggingService.info('Response quality scoring completed successfully', {
                userId,
                hasPrompt: !!prompt,
                hasResponse: !!response,
                hasExpectedOutput: !!expectedOutput,
                method: method || 'hybrid',
                duration,
                hasAssessment: !!assessment,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'response_quality_scored',
                category: 'intelligence_operations',
                value: duration,
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Response quality scoring failed', {
                userId,
                hasPrompt: !!prompt,
                hasResponse: !!response,
                hasExpectedOutput: !!expectedOutput,
                method: method || 'hybrid',
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            next(error);
        }
    }

    /**
     * Compare quality of original vs optimized response
     */
    static async compareQuality(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const { prompt, originalResponse, optimizedResponse, costSavings } = req.body;
        const userId = req.user?.id;

        try {
            loggingService.info('Quality comparison initiated', {
                userId,
                hasUserId: !!userId,
                hasPrompt: !!prompt,
                hasOriginalResponse: !!originalResponse,
                hasOptimizedResponse: !!optimizedResponse,
                hasCostSavings: !!costSavings,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Quality comparison failed - authentication required', {
                    hasPrompt: !!prompt,
                    hasOriginalResponse: !!originalResponse,
                    hasOptimizedResponse: !!optimizedResponse,
                    hasCostSavings: !!costSavings,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    error: 'Unauthorized'
                });
                return;
            }

            if (!prompt || !originalResponse || !optimizedResponse || !costSavings) {
                loggingService.warn('Quality comparison failed - missing required fields', {
                    userId,
                    hasPrompt: !!prompt,
                    hasOriginalResponse: !!originalResponse,
                    hasOptimizedResponse: !!optimizedResponse,
                    hasCostSavings: !!costSavings,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'All fields are required'
                });
                return;
            }

            loggingService.info('Quality comparison processing started', {
                userId,
                hasPrompt: !!prompt,
                hasOriginalResponse: !!originalResponse,
                hasOptimizedResponse: !!optimizedResponse,
                hasCostSavings: !!costSavings,
                requestId: req.headers['x-request-id'] as string
            });

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

            const duration = Date.now() - startTime;

            loggingService.info('Quality comparison completed successfully', {
                userId,
                hasPrompt: !!prompt,
                hasOriginalResponse: !!originalResponse,
                hasOptimizedResponse: !!optimizedResponse,
                hasCostSavings: !!costSavings,
                duration,
                hasComparison: !!comparison,
                hasQualityScore: !!qualityScore,
                originalScore: comparison.originalScore,
                optimizedScore: comparison.optimizedScore,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'quality_comparison_completed',
                category: 'intelligence_operations',
                value: duration,
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Quality comparison failed', {
                userId,
                hasPrompt: !!prompt,
                hasOriginalResponse: !!originalResponse,
                hasOptimizedResponse: !!optimizedResponse,
                hasCostSavings: !!costSavings,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            next(error);
        }
    }

    /**
     * Get quality statistics for user
     */
    static async getQualityStats(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;

        try {
            loggingService.info('Quality statistics retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Quality statistics retrieval failed - authentication required', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    error: 'Unauthorized'
                });
                return;
            }

            loggingService.info('Quality statistics retrieval processing started', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            const stats = await qualityService.getUserQualityStats(userId);

            const duration = Date.now() - startTime;

            loggingService.info('Quality statistics retrieved successfully', {
                userId,
                duration,
                hasStats: !!stats,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'quality_statistics_retrieved',
                category: 'intelligence_operations',
                value: duration,
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Quality statistics retrieval failed', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            next(error);
        }
    }

    /**
     * Update user feedback for quality score
     */
    static async updateQualityFeedback(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const { scoreId } = req.params;
        const { rating, isAcceptable, comment } = req.body;
        const userId = req.user?.id;

        try {
            loggingService.info('Quality feedback update initiated', {
                userId,
                hasUserId: !!userId,
                scoreId,
                hasScoreId: !!scoreId,
                rating,
                hasRating: !!rating,
                isAcceptable,
                hasIsAcceptable: typeof isAcceptable === 'boolean',
                hasComment: !!comment,
                requestId: req.headers['x-request-id'] as string
            });

            if (typeof isAcceptable !== 'boolean') {
                loggingService.warn('Quality feedback update failed - invalid isAcceptable field', {
                    userId,
                    scoreId,
                    rating,
                    isAcceptable,
                    hasComment: !!comment,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'isAcceptable is required'
                });
                return;
            }

            loggingService.info('Quality feedback update processing started', {
                userId,
                scoreId,
                rating,
                isAcceptable,
                hasComment: !!comment,
                requestId: req.headers['x-request-id'] as string
            });

            await qualityService.updateUserFeedback(scoreId, {
                rating,
                isAcceptable,
                comment
            });

            const duration = Date.now() - startTime;

            loggingService.info('Quality feedback updated successfully', {
                userId,
                scoreId,
                rating,
                isAcceptable,
                hasComment: !!comment,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'quality_feedback_updated',
                category: 'intelligence_operations',
                value: duration,
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Quality feedback update failed', {
                userId,
                scoreId,
                rating,
                isAcceptable,
                hasComment: !!comment,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            next(error);
        }
    }

    /**
     * Initialize default tips (admin only)
     */
    static async initializeTips(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;

        try {
            loggingService.info('Default tips initialization initiated', {
                userId,
                hasUserId: !!userId,
                userRole: req.user?.role,
                requestId: req.headers['x-request-id'] as string
            });

            // This should be restricted to admin users in production
            loggingService.info('Default tips initialization processing started', {
                userId,
                userRole: req.user?.role,
                requestId: req.headers['x-request-id'] as string
            });

            await intelligenceService.initializeDefaultTips();

            const duration = Date.now() - startTime;

            loggingService.info('Default tips initialized successfully', {
                userId,
                userRole: req.user?.role,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'default_tips_initialized',
                category: 'intelligence_operations',
                value: duration,
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Default tips initialization failed', {
                userId,
                userRole: req.user?.role,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            next(error);
        }
    }
}

export const intelligenceController = new IntelligenceController(); 