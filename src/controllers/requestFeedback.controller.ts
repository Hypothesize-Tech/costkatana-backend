import { Response, NextFunction } from 'express';
import { RequestFeedbackService, FeedbackData } from '../services/requestFeedback.service';
import { loggingService } from '../services/logging.service';

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
    static async submitFeedback(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const { requestId: feedbackRequestId } = req.params;

        try {
            this.conditionalLog('info', 'Feedback submission initiated', {
                userId,
                requestId,
                feedbackRequestId,
                rating: req.body?.rating
            });

            if (!userId) {
                this.conditionalLog('warn', 'Feedback submission failed - user not authenticated', {
                    requestId,
                    feedbackRequestId
                });
                res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
                return;
            }

            if (!feedbackRequestId) {
                this.conditionalLog('warn', 'Feedback submission failed - request ID is required', {
                    userId,
                    requestId
                });
                res.status(400).json({
                    success: false,
                    error: 'Request ID is required'
                });
                return;
            }

            const { rating, comment, implicitSignals } = req.body;

            if (typeof rating !== 'boolean') {
                this.conditionalLog('warn', 'Feedback submission failed - invalid rating type', {
                    userId,
                    requestId,
                    feedbackRequestId,
                    ratingType: typeof rating
                });
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
            const duration = Date.now() - startTime;

            this.conditionalLog('info', 'Feedback submitted successfully', {
                userId,
                duration,
                feedbackRequestId,
                rating
            });

            // Queue background business event logging
            this.queueBackgroundOperation(async () => {
                loggingService.logBusiness({
                    event: 'feedback_submitted',
                    category: 'request_feedback',
                    value: duration,
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
            const duration = Date.now() - startTime;
            
            this.conditionalLog('error', 'Feedback submission failed', {
                userId,
                requestId,
                feedbackRequestId,
                error: error.message || 'Unknown error',
                duration
            });

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
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;

        try {
            this.conditionalLog('info', 'Feedback analytics retrieval initiated', {
                userId,
                requestId
            });

            if (!userId) {
                loggingService.warn('Feedback analytics retrieval failed - user not authenticated', {
                    requestId
                });
                res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
                return;
            }

            const analytics = await RequestFeedbackService.getFeedbackAnalytics(userId);
            const duration = Date.now() - startTime;

            loggingService.info('Feedback analytics retrieved successfully', {
                userId,
                duration,
                hasAnalytics: !!analytics,
                requestId
            });

            res.json({
                success: true,
                data: analytics
            });

        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Feedback analytics retrieval failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });

            next(error);
        }
    }

    /**
     * Get global feedback analytics (admin only)
     * GET /api/v1/feedback/analytics/global
     */
    static async getGlobalFeedbackAnalytics(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;

        try {
            loggingService.info('Global feedback analytics retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId
            });

            if (!userId) {
                loggingService.warn('Global feedback analytics retrieval failed - user not authenticated', {
                    requestId
                });
                res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
                return;
            }

            // Check if user has admin role
            const user = (req as any).user;
            if (user.role !== 'admin' && user.role !== 'owner') {
                loggingService.warn('Global feedback analytics retrieval failed - insufficient permissions', {
                    userId,
                    requestId,
                    userRole: user.role,
                    hasAdminRole: user.role === 'admin' || user.role === 'owner'
                });
                res.status(403).json({
                    success: false,
                    error: 'Admin access required'
                });
                return;
            }

            const analytics = await RequestFeedbackService.getGlobalFeedbackAnalytics();
            const duration = Date.now() - startTime;

            loggingService.info('Global feedback analytics retrieved successfully', {
                userId,
                duration,
                userRole: user.role,
                hasAnalytics: !!analytics,
                requestId
            });

            // Log business event
            loggingService.logBusiness({
                event: 'global_feedback_analytics_retrieved',
                category: 'request_feedback',
                value: duration,
                metadata: {
                    userId,
                    userRole: user.role
                }
            });

            res.json({
                success: true,
                data: analytics
            });

        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Global feedback analytics retrieval failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });

            next(error);
        }
    }

    /**
     * Get feedback for a specific request
     * GET /api/v1/request/:requestId/feedback
     */
    static async getFeedbackByRequestId(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const { requestId: feedbackRequestId } = req.params;

        try {
            loggingService.info('Feedback by request ID retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                feedbackRequestId,
                hasFeedbackRequestId: !!feedbackRequestId
            });

            if (!userId) {
                loggingService.warn('Feedback by request ID retrieval failed - user not authenticated', {
                    requestId,
                    feedbackRequestId
                });
                res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
                return;
            }

            if (!feedbackRequestId) {
                loggingService.warn('Feedback by request ID retrieval failed - request ID is required', {
                    userId,
                    requestId
                });
                res.status(400).json({
                    success: false,
                    error: 'Request ID is required'
                });
                return;
            }

            const feedback = await RequestFeedbackService.getFeedbackByRequestId(feedbackRequestId);

            if (!feedback) {
                loggingService.warn('Feedback by request ID retrieval failed - feedback not found', {
                    userId,
                    requestId,
                    feedbackRequestId
                });
                res.status(404).json({
                    success: false,
                    error: 'Feedback not found for this request'
                });
                return;
            }

            // Only allow users to see their own feedback
            if (feedback.userId !== userId) {
                loggingService.warn('Feedback by request ID retrieval failed - access denied', {
                    userId,
                    requestId,
                    feedbackRequestId,
                    feedbackUserId: feedback.userId,
                    hasAccess: feedback.userId === userId
                });
                res.status(403).json({
                    success: false,
                    error: 'Access denied'
                });
                return;
            }

            const duration = Date.now() - startTime;

            loggingService.info('Feedback by request ID retrieved successfully', {
                userId,
                duration,
                feedbackRequestId,
                hasFeedback: !!feedback,
                requestId
            });

            res.json({
                success: true,
                data: feedback
            });

        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Feedback by request ID retrieval failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                feedbackRequestId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });

            next(error);
        }
    }

    /**
     * Update implicit signals for a request
     * PUT /api/v1/request/:requestId/implicit-signals
     */
    static async updateImplicitSignals(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const { requestId: feedbackRequestId } = req.params;

        try {
            loggingService.info('Implicit signals update initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                feedbackRequestId,
                hasFeedbackRequestId: !!feedbackRequestId,
                copied: req.body?.copied,
                hasCopied: typeof req.body?.copied === 'boolean',
                conversationContinued: req.body?.conversationContinued,
                hasConversationContinued: typeof req.body?.conversationContinued === 'boolean',
                immediateRephrase: req.body?.immediateRephrase,
                hasImmediateRephrase: typeof req.body?.immediateRephrase === 'boolean',
                sessionDuration: req.body?.sessionDuration,
                hasSessionDuration: typeof req.body?.sessionDuration === 'number',
                codeAccepted: req.body?.codeAccepted,
                hasCodeAccepted: typeof req.body?.codeAccepted === 'boolean'
            });

            if (!userId) {
                loggingService.warn('Implicit signals update failed - user not authenticated', {
                    requestId,
                    feedbackRequestId
                });
                res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
                return;
            }

            if (!feedbackRequestId) {
                loggingService.warn('Implicit signals update failed - request ID is required', {
                    userId,
                    requestId
                });
                res.status(400).json({
                    success: false,
                    error: 'Request ID is required'
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
                loggingService.warn('Implicit signals update failed - no valid signals provided', {
                    userId,
                    requestId,
                    feedbackRequestId,
                    signalsCount: Object.keys(signals).length,
                    hasValidSignals: Object.keys(signals).length > 0
                });
                res.status(400).json({
                    success: false,
                    error: 'At least one valid implicit signal must be provided'
                });
                return;
            }

            await RequestFeedbackService.updateImplicitSignals(feedbackRequestId, signals);
            const duration = Date.now() - startTime;

            loggingService.info('Implicit signals updated successfully', {
                userId,
                duration,
                feedbackRequestId,
                signalsCount: Object.keys(signals).length,
                signals: Object.keys(signals),
                requestId
            });

            // Log business event
            loggingService.logBusiness({
                event: 'implicit_signals_updated',
                category: 'request_feedback',
                value: duration,
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Implicit signals update failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                feedbackRequestId,
                signalsCount: Object.keys(req.body || {}),
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });

            next(error);
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