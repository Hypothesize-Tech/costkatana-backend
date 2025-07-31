import { Request, Response, NextFunction } from 'express';
import { RequestScoringService, ScoreRequestData } from '../services/requestScoring.service';
import { logger } from '../utils/logger';

export class RequestScoringController {
    /**
     * Score a request for training quality
     * POST /api/training/score
     */
    static async scoreRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const scoreData: ScoreRequestData = req.body;

            // Validate input
            if (!scoreData.requestId || !scoreData.score) {
                res.status(400).json({ 
                    success: false, 
                    message: 'Request ID and score are required' 
                });
                return;
            }

            if (scoreData.score < 1 || scoreData.score > 5) {
                res.status(400).json({ 
                    success: false, 
                    message: 'Score must be between 1 and 5' 
                });
                return;
            }

            const requestScore = await RequestScoringService.scoreRequest(userId, scoreData);

            res.json({
                success: true,
                data: requestScore,
                message: 'Request scored successfully'
            });
        } catch (error) {
            logger.error('Score request error:', error);
            next(error);
        }
    }

    /**
     * Get score for a specific request
     * GET /api/training/score/:requestId
     */
    static async getRequestScore(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const { requestId } = req.params;
            const requestScore = await RequestScoringService.getRequestScore(userId, requestId);

            if (!requestScore) {
                res.status(404).json({ 
                    success: false, 
                    message: 'Request score not found' 
                });
                return;
            }

            res.json({
                success: true,
                data: requestScore
            });
        } catch (error) {
            logger.error('Get request score error:', error);
            next(error);
        }
    }

    /**
     * Get all scores for the authenticated user
     * GET /api/training/scores
     */
    static async getUserScores(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
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

            res.json({
                success: true,
                data: scores,
                pagination: {
                    limit: filters.limit,
                    offset: filters.offset,
                    total: scores.length
                }
            });
        } catch (error) {
            logger.error('Get user scores error:', error);
            next(error);
        }
    }

    /**
     * Get training candidates (high-scoring requests)
     * GET /api/training/candidates
     */
    static async getTrainingCandidates(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
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

            res.json({
                success: true,
                data: candidates,
                message: `Found ${candidates.length} training candidates`
            });
        } catch (error) {
            logger.error('Get training candidates error:', error);
            next(error);
        }
    }

    /**
     * Get scoring analytics
     * GET /api/training/analytics
     */
    static async getScoringAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const analytics = await RequestScoringService.getScoringAnalytics(userId);

            res.json({
                success: true,
                data: analytics
            });
        } catch (error) {
            logger.error('Get scoring analytics error:', error);
            next(error);
        }
    }

    /**
     * Bulk score multiple requests
     * POST /api/training/score/bulk
     */
    static async bulkScoreRequests(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const { scores } = req.body;

            if (!Array.isArray(scores) || scores.length === 0) {
                res.status(400).json({ 
                    success: false, 
                    message: 'Scores array is required' 
                });
                return;
            }

            // Validate each score
            for (const scoreData of scores) {
                if (!scoreData.requestId || !scoreData.score) {
                    res.status(400).json({ 
                        success: false, 
                        message: 'Each score must have requestId and score' 
                    });
                    return;
                }
                if (scoreData.score < 1 || scoreData.score > 5) {
                    res.status(400).json({ 
                        success: false, 
                        message: 'All scores must be between 1 and 5' 
                    });
                    return;
                }
            }

            const results = await RequestScoringService.bulkScoreRequests(userId, scores);

            res.json({
                success: true,
                data: results,
                message: `Successfully scored ${results.length} requests`
            });
        } catch (error) {
            logger.error('Bulk score requests error:', error);
            next(error);
        }
    }

    /**
     * Delete a request score
     * DELETE /api/training/score/:requestId
     */
    static async deleteScore(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const { requestId } = req.params;
            const deleted = await RequestScoringService.deleteScore(userId, requestId);

            if (!deleted) {
                res.status(404).json({ 
                    success: false, 
                    message: 'Request score not found' 
                });
                return;
            }

            res.json({
                success: true,
                message: 'Request score deleted successfully'
            });
        } catch (error) {
            logger.error('Delete score error:', error);
            next(error);
        }
    }
}