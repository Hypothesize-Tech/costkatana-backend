import { Response, NextFunction } from 'express';
import { EvaluationJobService, CreateEvaluationJobData } from '../services/evaluationJob.service';
import { logger } from '../utils/logger';

export class EvaluationJobController {
    /**
     * Create a new evaluation job
     * POST /api/evaluations/jobs
     */
    static async createEvaluationJob(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'User not authenticated' });
                return;
            }

            const jobData: CreateEvaluationJobData = req.body;
            const job = await EvaluationJobService.createEvaluationJob(userId, jobData);

            res.status(201).json({
                success: true,
                message: 'Evaluation job created successfully',
                data: job
            });
        } catch (error) {
            logger.error('Error creating evaluation job:', error);
            next(error);
        }
    }

    /**
     * Get all evaluation jobs for the authenticated user
     * GET /api/evaluations/jobs
     */
    static async getUserEvaluationJobs(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'User not authenticated' });
                return;
            }

            const jobs = await EvaluationJobService.getUserEvaluationJobs(userId);

            res.json({
                success: true,
                data: jobs
            });
        } catch (error) {
            logger.error('Error fetching user evaluation jobs:', error);
            next(error);
        }
    }

    /**
     * Get evaluation jobs for a specific fine-tune job
     * GET /api/evaluations/jobs/fine-tune/:fineTuneJobId
     */
    static async getEvaluationsByFineTuneJob(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'User not authenticated' });
                return;
            }

            const { fineTuneJobId } = req.params;
            const evaluations = await EvaluationJobService.getEvaluationsByFineTuneJob(userId, fineTuneJobId);

            res.json({
                success: true,
                data: evaluations
            });
        } catch (error) {
            logger.error('Error fetching evaluations by fine-tune job:', error);
            next(error);
        }
    }

    /**
     * Get a specific evaluation job
     * GET /api/evaluations/jobs/:jobId
     */
    static async getEvaluationJob(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'User not authenticated' });
                return;
            }

            const { jobId } = req.params;
            const job = await EvaluationJobService.getEvaluationJob(userId, jobId);

            if (!job) {
                res.status(404).json({ success: false, message: 'Evaluation job not found' });
                return;
            }

            res.json({
                success: true,
                data: job
            });
        } catch (error) {
            logger.error('Error fetching evaluation job:', error);
            next(error);
        }
    }

    /**
     * Delete an evaluation job
     * DELETE /api/evaluations/jobs/:jobId
     */
    static async deleteEvaluationJob(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'User not authenticated' });
                return;
            }

            const { jobId } = req.params;
            const deleted = await EvaluationJobService.deleteEvaluationJob(userId, jobId);

            if (!deleted) {
                res.status(404).json({ success: false, message: 'Evaluation job not found' });
                return;
            }

            res.json({
                success: true,
                message: 'Evaluation job deleted successfully'
            });
        } catch (error) {
            logger.error('Error deleting evaluation job:', error);
            next(error);
        }
    }
}
