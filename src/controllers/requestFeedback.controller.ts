import { Response, NextFunction } from 'express';
import { RequestFeedbackService, FeedbackData } from '../services/requestFeedback.service';
import { logger } from '../utils/logger';

export class RequestFeedbackController {

    /**
     * Submit feedback for a specific request
     * POST /api/v1/request/:requestId/feedback
     */
    static async submitFeedback(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const { requestId } = req.params;
            const userId = req.user?.id;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
                return;
            }

            if (!requestId) {
                res.status(400).json({
                    success: false,
                    error: 'any ID is required'
                });
                return;
            }

            const { rating, comment, implicitSignals } = req.body;

            if (typeof rating !== 'boolean') {
                res.status(400).json({
                    success: false,
                    error: 'Rating must be a boolean (true for positive, false for negative)'
                });
                return;
            }

            const feedbackData: FeedbackData = {
                rating,
                comment,
                implicitSignals,
                userAgent: req.headers['user-agent'] as string,
                ipAddress: (req as any).ip || (req as any).connection?.remoteAddress
            };

            await RequestFeedbackService.submitFeedback(requestId, userId, feedbackData);

            res.json({
                success: true,
                message: 'Feedback submitted successfully'
            });

        } catch (error: any) {
            logger.error('Submit feedback error:', error);

            if (error.message === 'Feedback already exists for this request') {
                res.status(409).json({
                    success: false,
                    error: 'Feedback already submitted for this request'
                });
                return;
            }

            next(error);
        }
    }

    /**
     * Get feedback analytics for the authenticated user
     * GET /api/v1/feedback/analytics
     */
    static async getFeedbackAnalytics(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
                return;
            }

            const analytics = await RequestFeedbackService.getFeedbackAnalytics(userId);

            res.json({
                success: true,
                data: analytics
            });

        } catch (error) {
            logger.error('Get feedback analytics error:', error);
            next(error);
        }
    }

    /**
     * Get global feedback analytics (admin only)
     * GET /api/v1/feedback/analytics/global
     */
    static async getGlobalFeedbackAnalytics(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
                return;
            }

            // TODO: Add admin role check here
            // For now, allow all authenticated users to access global analytics

            const analytics = await RequestFeedbackService.getGlobalFeedbackAnalytics();

            res.json({
                success: true,
                data: analytics
            });

        } catch (error) {
            logger.error('Get global feedback analytics error:', error);
            next(error);
        }
    }

    /**
     * Get feedback for a specific request
     * GET /api/v1/request/:requestId/feedback
     */
    static async getFeedbackByRequestId(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const { requestId } = req.params;
            const userId = req.user?.id;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
                return;
            }

            if (!requestId) {
                res.status(400).json({
                    success: false,
                    error: 'any ID is required'
                });
                return;
            }

            const feedback = await RequestFeedbackService.getFeedbackByRequestId(requestId);

            if (!feedback) {
                res.status(404).json({
                    success: false,
                    error: 'Feedback not found for this request'
                });
                return;
            }

            // Only allow users to see their own feedback
            if (feedback.userId !== userId) {
                res.status(403).json({
                    success: false,
                    error: 'Access denied'
                });
                return;
            }

            res.json({
                success: true,
                data: feedback
            });

        } catch (error) {
            logger.error('Get feedback by request ID error:', error);
            next(error);
        }
    }

    /**
     * Update implicit signals for a request
     * PUT /api/v1/request/:requestId/implicit-signals
     */
    static async updateImplicitSignals(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const { requestId } = req.params;
            const userId = req.user?.id;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
                return;
            }

            if (!requestId) {
                res.status(400).json({
                    success: false,
                    error: 'any ID is required'
                });
                return;
            }

            const { copied, conversationContinued, immediateRephrase, sessionDuration, codeAccepted } = req.body;

            // Validate the signals
            const signals: any = {};
            if (typeof copied === 'boolean') signals.copied = copied;
            if (typeof conversationContinued === 'boolean') signals.conversationContinued = conversationContinued;
            if (typeof immediateRephrase === 'boolean') signals.immediateRephrase = immediateRephrase;
            if (typeof sessionDuration === 'number' && sessionDuration >= 0) signals.sessionDuration = sessionDuration;
            if (typeof codeAccepted === 'boolean') signals.codeAccepted = codeAccepted;

            if (Object.keys(signals).length === 0) {
                res.status(400).json({
                    success: false,
                    error: 'At least one valid implicit signal must be provided'
                });
                return;
            }

            await RequestFeedbackService.updateImplicitSignals(requestId, signals);

            res.json({
                success: true,
                message: 'Implicit signals updated successfully'
            });

        } catch (error) {
            logger.error('Update implicit signals error:', error);
            next(error);
        }
    }
}