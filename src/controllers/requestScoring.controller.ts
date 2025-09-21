import { Request, Response, NextFunction } from 'express';
import { RequestScoringService, ScoreRequestData } from '../services/requestScoring.service';
import { loggingService } from '../services/logging.service';

export class RequestScoringController {
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
     * Score a request for training quality
     * POST /api/training/score
     */
    static async scoreRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = (req as any).user?.id;
        const requestId = req.headers['x-request-id'] as string;

        try {
            loggingService.info('Request scoring initiated', {
                userId,
                requestId,
                scoreRequestId: req.body?.requestId,
                score: req.body?.score
            });

            if (!userId) {
                loggingService.warn('Request scoring failed - user not authenticated', {
                    requestId
                });
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const scoreData: ScoreRequestData = req.body;

            // Validate input
            if (!scoreData.requestId || !scoreData.score) {
                loggingService.warn('Request scoring failed - missing required fields', {
                    userId,
                    requestId,
                    hasRequestId: !!scoreData.requestId,
                    hasScore: !!scoreData.score
                });
                res.status(400).json({ 
                    success: false, 
                    message: 'Request ID and score are required' 
                });
                return;
            }

            if (scoreData.score < 1 || scoreData.score > 5) {
                loggingService.warn('Request scoring failed - invalid score range', {
                    userId,
                    requestId,
                    score: scoreData.score,
                    scoreValid: scoreData.score >= 1 && scoreData.score <= 5
                });
                res.status(400).json({ 
                    success: false, 
                    message: 'Score must be between 1 and 5' 
                });
                return;
            }

            const requestScore = await RequestScoringService.scoreRequest(userId, scoreData);
            const duration = Date.now() - startTime;

            loggingService.info('Request scored successfully', {
                userId,
                duration,
                scoreRequestId: scoreData.requestId,
                score: scoreData.score,
                requestId
            });

            // Queue background business event logging
            this.queueBackgroundOperation(async () => {
                loggingService.logBusiness({
                    event: 'request_scored',
                    category: 'request_scoring',
                    value: duration,
                    metadata: {
                        userId,
                        scoreRequestId: scoreData.requestId,
                        score: scoreData.score
                    }
                });
            });

            res.json({
                success: true,
                data: requestScore,
                message: 'Request scored successfully'
            });
        } catch (error: any) {
            this.recordDbFailure();
            const duration = Date.now() - startTime;
            
            loggingService.error('Request scoring failed', {
                userId,
                requestId,
                scoreRequestId: req.body?.requestId,
                score: req.body?.score,
                error: error.message || 'Unknown error',
                duration
            });

            next(error);
        }
    }

    /**
     * Get score for a specific request
     * GET /api/training/score/:requestId
     */
    static async getRequestScore(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = (req as any).user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const { requestId: scoreRequestId } = req.params;

        try {
            loggingService.info('Request score retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                scoreRequestId,
                hasScoreRequestId: !!scoreRequestId
            });

            if (!userId) {
                loggingService.warn('Request score retrieval failed - user not authenticated', {
                    requestId,
                    scoreRequestId
                });
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const requestScore = await RequestScoringService.getRequestScore(userId, scoreRequestId);

            if (!requestScore) {
                loggingService.warn('Request score retrieval failed - score not found', {
                    userId,
                    requestId,
                    scoreRequestId
                });
                res.status(404).json({ 
                    success: false, 
                    message: 'Request score not found' 
                });
                return;
            }

            const duration = Date.now() - startTime;

            loggingService.info('Request score retrieved successfully', {
                userId,
                duration,
                scoreRequestId,
                hasRequestScore: !!requestScore,
                requestId
            });

            res.json({
                success: true,
                data: requestScore
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Request score retrieval failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                scoreRequestId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });

            next(error);
        }
    }

    /**
     * Get all scores for the authenticated user
     * GET /api/training/scores
     */
    static async getUserScores(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = (req as any).user?.id;
        const requestId = req.headers['x-request-id'] as string;

        try {
            loggingService.info('User scores retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                minScore: req.query.minScore,
                hasMinScore: !!req.query.minScore,
                maxScore: req.query.maxScore,
                hasMaxScore: !!req.query.maxScore,
                isTrainingCandidate: req.query.isTrainingCandidate,
                hasTrainingTags: !!req.query.trainingTags,
                limit: req.query.limit,
                hasLimit: !!req.query.limit,
                offset: req.query.offset,
                hasOffset: !!req.query.offset
            });

            if (!userId) {
                loggingService.warn('User scores retrieval failed - user not authenticated', {
                    requestId
                });
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const filters = {
                minScore: req.query.minScore ? parseInt(req.query.minScore as string) : undefined,
                maxScore: req.query.maxScore ? parseInt(req.query.maxScore as string) : undefined,
                isTrainingCandidate: req.query.isTrainingCandidate === 'true',
                trainingTags: req.query.trainingTags ? (req.query.trainingTags as string).split(',') : undefined,
                limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
                offset: req.query.offset ? parseInt(req.query.offset as string) : 0
            };

            const scores = await RequestScoringService.getUserScores(userId, filters);
            const duration = Date.now() - startTime;

            loggingService.info('User scores retrieved successfully', {
                userId,
                duration,
                scoresCount: scores.length,
                hasScores: !!scores && scores.length > 0,
                filters,
                requestId
            });

            res.json({
                success: true,
                data: scores,
                pagination: {
                    limit: filters.limit,
                    offset: filters.offset,
                    total: scores.length
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('User scores retrieval failed', {
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
     * Get training candidates (high-scoring requests)
     * GET /api/training/candidates
     */
    static async getTrainingCandidates(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = (req as any).user?.id;
        const requestId = req.headers['x-request-id'] as string;

        try {
            loggingService.info('Training candidates retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                minScore: req.query.minScore,
                hasMinScore: !!req.query.minScore,
                maxTokens: req.query.maxTokens,
                hasMaxTokens: !!req.query.maxTokens,
                maxCost: req.query.maxCost,
                hasMaxCost: !!req.query.maxCost,
                providers: req.query.providers,
                hasProviders: !!req.query.providers,
                models: req.query.models,
                hasModels: !!req.query.models,
                features: req.query.features,
                hasFeatures: !!req.query.features,
                limit: req.query.limit,
                hasLimit: !!req.query.limit
            });

            if (!userId) {
                loggingService.warn('Training candidates retrieval failed - user not authenticated', {
                    requestId
                });
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const filters = {
                minScore: req.query.minScore ? parseInt(req.query.minScore as string) : 4,
                maxTokens: req.query.maxTokens ? parseInt(req.query.maxTokens as string) : undefined,
                maxCost: req.query.maxCost ? parseFloat(req.query.maxCost as string) : undefined,
                providers: req.query.providers ? (req.query.providers as string).split(',') : undefined,
                models: req.query.models ? (req.query.models as string).split(',') : undefined,
                features: req.query.features ? (req.query.features as string).split(',') : undefined,
                limit: req.query.limit ? parseInt(req.query.limit as string) : 100
            };

            const candidates = await RequestScoringService.getTrainingCandidates(userId, filters);
            const duration = Date.now() - startTime;

            loggingService.info('Training candidates retrieved successfully', {
                userId,
                duration,
                candidatesCount: candidates.length,
                hasCandidates: !!candidates && candidates.length > 0,
                filters,
                requestId
            });

            res.json({
                success: true,
                data: candidates,
                message: `Found ${candidates.length} training candidates`
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Training candidates retrieval failed', {
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
     * Get scoring analytics
     * GET /api/training/analytics
     */
    static async getScoringAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = (req as any).user?.id;
        const requestId = req.headers['x-request-id'] as string;

        try {
            loggingService.info('Scoring analytics retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId
            });

            if (!userId) {
                loggingService.warn('Scoring analytics retrieval failed - user not authenticated', {
                    requestId
                });
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const analytics = await RequestScoringService.getScoringAnalytics(userId);
            const duration = Date.now() - startTime;

            loggingService.info('Scoring analytics retrieved successfully', {
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
            
            loggingService.error('Scoring analytics retrieval failed', {
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
     * Bulk score multiple requests
     * POST /api/training/score/bulk
     */
    static async bulkScoreRequests(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = (req as any).user?.id;
        const requestId = req.headers['x-request-id'] as string;

        try {
            loggingService.info('Bulk score requests initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                scoresCount: Array.isArray(req.body?.scores) ? req.body.scores.length : 0,
                hasScores: Array.isArray(req.body?.scores) && req.body.scores.length > 0
            });

            if (!userId) {
                loggingService.warn('Bulk score requests failed - user not authenticated', {
                    requestId
                });
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const { scores } = req.body;

            if (!Array.isArray(scores) || scores.length === 0) {
                loggingService.warn('Bulk score requests failed - scores array is required', {
                    userId,
                    requestId,
                    scoresType: typeof scores,
                    scoresLength: Array.isArray(scores) ? scores.length : 0
                });
                res.status(400).json({ 
                    success: false, 
                    message: 'Scores array is required' 
                });
                return;
            }

            // Validate each score
            for (const scoreData of scores) {
                if (!scoreData.requestId || !scoreData.score) {
                    loggingService.warn('Bulk score requests failed - missing required fields in score data', {
                        userId,
                        requestId,
                        hasRequestId: !!scoreData.requestId,
                        hasScore: !!scoreData.score
                    });
                    res.status(400).json({ 
                        success: false, 
                        message: 'Each score must have requestId and score' 
                    });
                    return;
                }
                if (scoreData.score < 1 || scoreData.score > 5) {
                    loggingService.warn('Bulk score requests failed - invalid score range', {
                        userId,
                        requestId,
                        score: scoreData.score,
                        scoreValid: scoreData.score >= 1 && scoreData.score <= 5
                    });
                    res.status(400).json({ 
                        success: false, 
                        message: 'All scores must be between 1 and 5' 
                    });
                    return;
                }
            }

            const results = await RequestScoringService.bulkScoreRequests(userId, scores);
            const duration = Date.now() - startTime;

            loggingService.info('Bulk score requests completed successfully', {
                userId,
                duration,
                scoresCount: scores.length,
                resultsCount: results.length,
                hasResults: !!results && results.length > 0,
                requestId
            });

            // Log business event
            loggingService.logBusiness({
                event: 'bulk_score_requests_completed',
                category: 'request_scoring',
                value: duration,
                metadata: {
                    userId,
                    scoresCount: scores.length,
                    resultsCount: results.length
                }
            });

            res.json({
                success: true,
                data: results,
                message: `Successfully scored ${results.length} requests`
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Bulk score requests failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                scoresCount: Array.isArray(req.body?.scores) ? req.body.scores.length : 0,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });

            next(error);
        }
    }

    /**
     * Delete a request score
     * DELETE /api/training/score/:requestId
     */
    static async deleteScore(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = (req as any).user?.id;
        const requestId = req.headers['x-request-id'] as string;
        const { requestId: scoreRequestId } = req.params;

        try {
            loggingService.info('Request score deletion initiated', {
                userId,
                hasUserId: !!userId,
                requestId,
                scoreRequestId,
                hasScoreRequestId: !!scoreRequestId
            });

            if (!userId) {
                loggingService.warn('Request score deletion failed - user not authenticated', {
                    requestId,
                    scoreRequestId
                });
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const deleted = await RequestScoringService.deleteScore(userId, scoreRequestId);

            if (!deleted) {
                loggingService.warn('Request score deletion failed - score not found', {
                    userId,
                    requestId,
                    scoreRequestId
                });
                res.status(404).json({ 
                    success: false, 
                    message: 'Request score not found' 
                });
                return;
            }

            const duration = Date.now() - startTime;

            loggingService.info('Request score deleted successfully', {
                userId,
                duration,
                scoreRequestId,
                requestId
            });

            // Log business event
            loggingService.logBusiness({
                event: 'request_score_deleted',
                category: 'request_scoring',
                value: duration,
                metadata: {
                    userId,
                    scoreRequestId
                }
            });

            res.json({
                success: true,
                message: 'Request score deleted successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Request score deletion failed', {
                userId,
                hasUserId: !!userId,
                requestId,
                scoreRequestId,
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