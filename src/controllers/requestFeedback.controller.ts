import { Response, NextFunction } from 'express';
import { RequestFeedbackService, FeedbackData } from '../services/requestFeedback.service';
import { loggingService } from '../services/logging.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

export class RequestFeedbackController {
    // Background processing queue
    private static backgroundQueue: Array<() => Promise<void>> = [];
    private static backgroundProcessor?: NodeJS.Timeout;
    
    // Circuit breaker for database operations
    private static dbFailureCount: number = 0;
    private static readonly MAX_DB_FAILURES = 5;
    private static readonly CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minutes
    private static lastDbFailureTime: number = 0;
    
    /**
     * Initialize background processor
     */
    static {
        this.startBackgroundProcessor();
    }

    /**
     * Submit feedback for a specific request
     * POST /api/v1/request/:requestId/feedback
     */
    static async submitFeedback(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('submitFeedback', req);

            const { requestId: feedbackRequestId } = req.params;

            if (!feedbackRequestId) {
                res.status(400).json({
                    success: false,
                    error: 'Request ID is required'
                });
                return;
            }

            ServiceHelper.validateObjectId(feedbackRequestId, 'requestId');

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

            await RequestFeedbackService.submitFeedback(feedbackRequestId, userId, feedbackData);

            ControllerHelper.logRequestSuccess('submitFeedback', req, startTime, {
                feedbackRequestId,
                rating
            });

            // Queue background business event logging
            this.queueBackgroundOperation(async () => {
                loggingService.logBusiness({
                    event: 'feedback_submitted',
                    category: 'request_feedback',
                    value: Date.now() - startTime,
                    metadata: {
                        userId,
                        feedbackRequestId,
                        rating,
                        hasComment: !!comment,
                        hasImplicitSignals: !!implicitSignals
                    }
                });
            });

            res.json({
                success: true,
                message: 'Feedback submitted successfully'
            });

        } catch (error: any) {
            RequestFeedbackController.recordDbFailure();

            if (error.message === 'Feedback already exists for this request') {
                res.status(409).json({
                    success: false,
                    error: 'Feedback already submitted for this request'
                });
                return;
            }

            ControllerHelper.handleError('submitFeedback', error, req, res, startTime);
        }
    }

    /**
     * Get feedback analytics for the authenticated user
     * GET /api/v1/feedback/analytics
     */
    static async getFeedbackAnalytics(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getFeedbackAnalytics', req);

            const analytics = await RequestFeedbackService.getFeedbackAnalytics(userId);

            ControllerHelper.logRequestSuccess('getFeedbackAnalytics', req, startTime);

            res.json({
                success: true,
                data: analytics
            });

        } catch (error: any) {
            ControllerHelper.handleError('getFeedbackAnalytics', error, req, res, startTime);
        }
    }

    /**
     * Get global feedback analytics (admin only)
     * GET /api/v1/feedback/analytics/global
     */
    static async getGlobalFeedbackAnalytics(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getGlobalFeedbackAnalytics', req);

            // Check if user has admin role
            const user = req.user;
            if (user?.role !== 'admin' && user?.role !== 'owner') {
                res.status(403).json({
                    success: false,
                    error: 'Admin access required'
                });
                return;
            }

            const analytics = await RequestFeedbackService.getGlobalFeedbackAnalytics();

            ControllerHelper.logRequestSuccess('getGlobalFeedbackAnalytics', req, startTime);

            // Log business event
            loggingService.logBusiness({
                event: 'global_feedback_analytics_retrieved',
                category: 'request_feedback',
                value: Date.now() - startTime,
                metadata: {
                    userId,
                    userRole: user?.role
                }
            });

            res.json({
                success: true,
                data: analytics
            });

        } catch (error: any) {
            ControllerHelper.handleError('getGlobalFeedbackAnalytics', error, req, res, startTime);
        }
    }

    /**
     * Get feedback for a specific request
     * GET /api/v1/request/:requestId/feedback
     */
    static async getFeedbackByRequestId(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getFeedbackByRequestId', req);

            const { requestId: feedbackRequestId } = req.params;

            if (!feedbackRequestId) {
                res.status(400).json({
                    success: false,
                    error: 'Request ID is required'
                });
                return;
            }

            ServiceHelper.validateObjectId(feedbackRequestId, 'requestId');

            const feedback = await RequestFeedbackService.getFeedbackByRequestId(feedbackRequestId);

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

            ControllerHelper.logRequestSuccess('getFeedbackByRequestId', req, startTime, {
                feedbackRequestId
            });

            res.json({
                success: true,
                data: feedback
            });

        } catch (error: any) {
            ControllerHelper.handleError('getFeedbackByRequestId', error, req, res, startTime);
        }
    }

    /**
     * Update implicit signals for a request
     * PUT /api/v1/request/:requestId/implicit-signals
     */
    static async updateImplicitSignals(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('updateImplicitSignals', req);

            const { requestId: feedbackRequestId } = req.params;

            if (!feedbackRequestId) {
                res.status(400).json({
                    success: false,
                    error: 'Request ID is required'
                });
                return;
            }

            ServiceHelper.validateObjectId(feedbackRequestId, 'requestId');

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

            await RequestFeedbackService.updateImplicitSignals(feedbackRequestId, signals);

            ControllerHelper.logRequestSuccess('updateImplicitSignals', req, startTime, {
                feedbackRequestId,
                signalsCount: Object.keys(signals).length
            });

            // Log business event
            loggingService.logBusiness({
                event: 'implicit_signals_updated',
                category: 'request_feedback',
                value: Date.now() - startTime,
                metadata: {
                    userId,
                    feedbackRequestId,
                    signalsCount: Object.keys(signals).length,
                    signals: Object.keys(signals)
                }
            });

            res.json({
                success: true,
                message: 'Implicit signals updated successfully'
            });

        } catch (error: any) {
            ControllerHelper.handleError('updateImplicitSignals', error, req, res, startTime);
        }
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
     * Conditional logging utility
     */
    private static conditionalLog(level: 'info' | 'warn' | 'error', message: string, metadata?: any): void {
        // Only log if it's an error or if we're in development mode
        if (level === 'error') {
            loggingService[level](message, metadata);
        }
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
    }
}