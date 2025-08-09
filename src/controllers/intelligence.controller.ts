import { Response, NextFunction } from 'express';
import { intelligenceService } from '../services/intelligence.service';
import { qualityService } from '../services/quality.service';
import { Usage, User } from '../models';

export class IntelligenceController {
    /**
     * Get personalized tips for dashboard
     */
    static async getPersonalizedTips(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({
                    success: false,
                    error: 'Unauthorized'
                });
                return;
            }

            const limit = parseInt(req.query.limit as string) || 3;

            const tips = await intelligenceService.getPersonalizedTips(userId, limit);

            res.json({
                success: true,
                data: tips
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get tips for a specific usage
     */
    static async getTipsForUsage(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const { usageId } = req.params;
            const userId = req.user?.id;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    error: 'Unauthorized'
                });
                return;
            }

            const usage = await Usage.findOne({ _id: usageId, userId });
            if (!usage) {
                res.status(404).json({
                    success: false,
                    error: 'Usage not found'
                });
                return;
            }

            const user = await User.findById(userId);

            const tips = await intelligenceService.analyzeAndRecommendTips({
                usage: usage.toObject(),
                user: user?.toObject()
            });

            res.json({
                success: true,
                data: tips
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Track tip interaction
     */
    static async trackTipInteraction(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const { tipId } = req.params;
            const { interaction } = req.body;

            if (!['display', 'click', 'dismiss', 'success'].includes(interaction)) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid interaction type'
                });
                return;
            }

            await intelligenceService.trackTipInteraction(tipId, interaction, req.user?.id);

            res.json({
                success: true,
                message: 'Interaction tracked'
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Score response quality
     */
    static async scoreResponseQuality(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
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

            res.json({
                success: true,
                data: assessment
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Compare quality of original vs optimized response
     */
    static async compareQuality(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const { prompt, originalResponse, optimizedResponse, costSavings } = req.body;
            const userId = req.user?.id;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    error: 'Unauthorized'
                });
                return;
            }

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

            res.json({
                success: true,
                data: {
                    comparison,
                    scoreId: qualityScore._id
                }
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Get quality statistics for user
     */
    static async getQualityStats(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    error: 'Unauthorized'
                });
                return;
            }

            const stats = await qualityService.getUserQualityStats(userId);

            res.json({
                success: true,
                data: stats
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Update user feedback for quality score
     */
    static async updateQualityFeedback(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const { scoreId } = req.params;
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

            res.json({
                success: true,
                message: 'Feedback updated'
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * Initialize default tips (admin only)
     */
    static async initializeTips(_req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            // This should be restricted to admin users in production
            await intelligenceService.initializeDefaultTips();

            res.json({
                success: true,
                message: 'Default tips initialized'
            });
        } catch (error) {
            next(error);
        }
    }
}

export const intelligenceController = new IntelligenceController(); 