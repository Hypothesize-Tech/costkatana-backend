import { Response, NextFunction } from 'express';
import { EvaluationJobService, CreateEvaluationJobData } from '../services/evaluationJob.service';
import { loggingService } from '../services/logging.service';

export class EvaluationJobController {
    /**
     * Create a new evaluation job
     * POST /api/evaluations/jobs
     */
    static async createEvaluationJob(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;

        try {
            loggingService.info('Evaluation job creation initiated', {
                userId,
                hasUserId: !!userId,
                hasJobData: !!req.body,
                jobDataName: req.body?.name,
                jobDataEvaluationType: req.body?.evaluationType,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Evaluation job creation failed - user not authenticated', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ success: false, message: 'User not authenticated' });
                return;
            }

            const jobData: CreateEvaluationJobData = req.body;

            loggingService.info('Evaluation job creation processing started', {
                userId,
                jobDataName: jobData.name,
                jobDataEvaluationType: jobData.evaluationType,
                hasModelId: !!jobData.modelId,
                hasDatasetId: !!jobData.datasetId,
                requestId: req.headers['x-request-id'] as string
            });

            const job = await EvaluationJobService.createEvaluationJob(userId, jobData);

            const duration = Date.now() - startTime;

            loggingService.info('Evaluation job created successfully', {
                userId,
                jobId: job.id || job._id,
                jobName: job.name,
                jobEvaluationType: job.evaluationType,
                jobStatus: job.status,
                duration,
                hasJob: !!job,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'evaluation_job_created',
                category: 'evaluation_operations',
                value: duration,
                metadata: {
                    userId,
                    jobId: job.id || job._id,
                    jobName: job.name,
                    jobEvaluationType: job.evaluationType,
                    jobStatus: job.status,
                    hasModelId: !!jobData.modelId,
                    hasDatasetId: !!jobData.datasetId
                }
            });

            res.status(201).json({
                success: true,
                message: 'Evaluation job created successfully',
                data: job
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Evaluation job creation failed', {
                userId,
                hasJobData: !!req.body,
                jobDataType: req.body?.type,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            next(error);
        }
    }

    /**
     * Get all evaluation jobs for the authenticated user
     * GET /api/evaluations/jobs
     */
    static async getUserEvaluationJobs(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;

        try {
            loggingService.info('User evaluation jobs retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('User evaluation jobs retrieval failed - user not authenticated', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ success: false, message: 'User not authenticated' });
                return;
            }

            loggingService.info('User evaluation jobs retrieval processing started', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            const jobs = await EvaluationJobService.getUserEvaluationJobs(userId);

            const duration = Date.now() - startTime;

            loggingService.info('User evaluation jobs retrieved successfully', {
                userId,
                duration,
                jobsCount: jobs.length,
                hasJobs: !!jobs && jobs.length > 0,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'user_evaluation_jobs_retrieved',
                category: 'evaluation_operations',
                value: duration,
                metadata: {
                    userId,
                    jobsCount: jobs.length,
                    hasJobs: !!jobs && jobs.length > 0
                }
            });

            res.json({
                success: true,
                data: jobs
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('User evaluation jobs retrieval failed', {
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
     * Get evaluation jobs for a specific fine-tune job
     * GET /api/evaluations/jobs/fine-tune/:fineTuneJobId
     */
    static async getEvaluationsByFineTuneJob(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const { fineTuneJobId } = req.params;

        try {
            loggingService.info('Fine-tune job evaluations retrieval initiated', {
                userId,
                hasUserId: !!userId,
                fineTuneJobId,
                hasFineTuneJobId: !!fineTuneJobId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Fine-tune job evaluations retrieval failed - user not authenticated', {
                    fineTuneJobId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ success: false, message: 'User not authenticated' });
                return;
            }

            loggingService.info('Fine-tune job evaluations retrieval processing started', {
                userId,
                fineTuneJobId,
                requestId: req.headers['x-request-id'] as string
            });

            const evaluations = await EvaluationJobService.getEvaluationsByFineTuneJob(userId, fineTuneJobId);

            const duration = Date.now() - startTime;

            loggingService.info('Fine-tune job evaluations retrieved successfully', {
                userId,
                fineTuneJobId,
                duration,
                evaluationsCount: evaluations.length,
                hasEvaluations: !!evaluations && evaluations.length > 0,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'fine_tune_evaluations_retrieved',
                category: 'evaluation_operations',
                value: duration,
                metadata: {
                    userId,
                    fineTuneJobId,
                    evaluationsCount: evaluations.length,
                    hasEvaluations: !!evaluations && evaluations.length > 0
                }
            });

            res.json({
                success: true,
                data: evaluations
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Fine-tune job evaluations retrieval failed', {
                userId,
                fineTuneJobId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            next(error);
        }
    }

    /**
     * Get a specific evaluation job
     * GET /api/evaluations/jobs/:jobId
     */
    static async getEvaluationJob(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const { jobId } = req.params;

        try {
            loggingService.info('Specific evaluation job retrieval initiated', {
                userId,
                hasUserId: !!userId,
                jobId,
                hasJobId: !!jobId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Specific evaluation job retrieval failed - user not authenticated', {
                    jobId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ success: false, message: 'User not authenticated' });
                return;
            }

            loggingService.info('Specific evaluation job retrieval processing started', {
                userId,
                jobId,
                requestId: req.headers['x-request-id'] as string
            });

            const job = await EvaluationJobService.getEvaluationJob(userId, jobId);

            if (!job) {
                loggingService.warn('Specific evaluation job not found', {
                    userId,
                    jobId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(404).json({ success: false, message: 'Evaluation job not found' });
                return;
            }

            const duration = Date.now() - startTime;

            loggingService.info('Specific evaluation job retrieved successfully', {
                userId,
                jobId,
                duration,
                jobName: job.name,
                jobEvaluationType: job.evaluationType,
                jobStatus: job.status,
                hasJob: !!job,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'specific_evaluation_job_retrieved',
                category: 'evaluation_operations',
                value: duration,
                metadata: {
                    userId,
                    jobId,
                    jobName: job.name,
                    jobEvaluationType: job.evaluationType,
                    jobStatus: job.status,
                    hasJob: !!job
                }
            });

            res.json({
                success: true,
                data: job
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Specific evaluation job retrieval failed', {
                userId,
                jobId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            next(error);
        }
    }

    /**
     * Delete an evaluation job
     * DELETE /api/evaluations/jobs/:jobId
     */
    static async deleteEvaluationJob(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const { jobId } = req.params;

        try {
            loggingService.info('Evaluation job deletion initiated', {
                userId,
                hasUserId: !!userId,
                jobId,
                hasJobId: !!jobId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Evaluation job deletion failed - user not authenticated', {
                    jobId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ success: false, message: 'User not authenticated' });
                return;
            }

            loggingService.info('Evaluation job deletion processing started', {
                userId,
                jobId,
                requestId: req.headers['x-request-id'] as string
            });

            const deleted = await EvaluationJobService.deleteEvaluationJob(userId, jobId);

            if (!deleted) {
                loggingService.warn('Evaluation job deletion failed - job not found', {
                    userId,
                    jobId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(404).json({ success: false, message: 'Evaluation job not found' });
                return;
            }

            const duration = Date.now() - startTime;

            loggingService.info('Evaluation job deleted successfully', {
                userId,
                jobId,
                duration,
                wasDeleted: !!deleted,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'evaluation_job_deleted',
                category: 'evaluation_operations',
                value: duration,
                metadata: {
                    userId,
                    jobId,
                    wasDeleted: !!deleted
                }
            });

            res.json({
                success: true,
                message: 'Evaluation job deleted successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Evaluation job deletion failed', {
                userId,
                jobId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            next(error);
        }
    }
}
