import { Request, Response, NextFunction } from 'express';
import { FineTuneJobService, CreateFineTuneJobData } from '../services/fineTuneJob.service';
import { loggingService } from '../services/logging.service';

export class FineTuneJobController {
    /**
     * Create a new fine-tune job
     * POST /api/fine-tune/jobs
     */
    static async createFineTuneJob(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = (req as any).user?.id;
        const jobData: CreateFineTuneJobData = req.body;

        try {
            loggingService.info('Fine-tune job creation initiated', {
                userId,
                hasUserId: !!userId,
                hasJobData: !!jobData,
                jobName: jobData.name,
                datasetId: jobData.datasetId,
                baseModel: jobData.baseModel,
                provider: jobData.provider,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Fine-tune job creation failed - authentication required', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            // Validate required fields
            if (!jobData.name || !jobData.datasetId || !jobData.baseModel || !jobData.provider) {
                loggingService.warn('Fine-tune job creation failed - missing required fields', {
                    userId,
                    hasName: !!jobData.name,
                    hasDatasetId: !!jobData.datasetId,
                    hasBaseModel: !!jobData.baseModel,
                    hasProvider: !!jobData.provider,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({ 
                    success: false, 
                    message: 'Name, dataset ID, base model, and provider are required' 
                });
                return;
            }

            loggingService.info('Fine-tune job creation processing started', {
                userId,
                jobName: jobData.name,
                datasetId: jobData.datasetId,
                baseModel: jobData.baseModel,
                provider: jobData.provider,
                hasHyperparameters: !!jobData.hyperparameters,
                hasProviderConfig: !!jobData.providerConfig,
                requestId: req.headers['x-request-id'] as string
            });

            const fineTuneJob = await FineTuneJobService.createFineTuneJob(userId, jobData);

            const duration = Date.now() - startTime;

            loggingService.info('Fine-tune job created successfully', {
                userId,
                jobId: fineTuneJob.id || fineTuneJob._id,
                jobName: fineTuneJob.name,
                duration,
                hasJob: !!fineTuneJob,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'fine_tune_job_created',
                category: 'fine_tune_operations',
                value: duration,
                metadata: {
                    userId,
                    jobId: fineTuneJob.id || fineTuneJob._id,
                    jobName: fineTuneJob.name,
                    datasetId: fineTuneJob.datasetId,
                    baseModel: fineTuneJob.baseModel,
                    provider: fineTuneJob.provider,
                    hasHyperparameters: !!fineTuneJob.hyperparameters
                }
            });

            res.status(201).json({
                success: true,
                data: fineTuneJob,
                message: 'Fine-tune job created successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Fine-tune job creation failed', {
                userId,
                hasJobData: !!jobData,
                jobName: jobData.name,
                datasetId: jobData.datasetId,
                baseModel: jobData.baseModel,
                provider: jobData.provider,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            next(error);
        }
    }

    /**
     * Get all fine-tune jobs for the authenticated user
     * GET /api/fine-tune/jobs
     */
    static async getUserFineTuneJobs(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = (req as any).user?.id;

        try {
            loggingService.info('User fine-tune jobs retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('User fine-tune jobs retrieval failed - authentication required', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            loggingService.info('User fine-tune jobs retrieval processing started', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            const jobs = await FineTuneJobService.getUserFineTuneJobs(userId);

            const duration = Date.now() - startTime;

            loggingService.info('User fine-tune jobs retrieved successfully', {
                userId,
                duration,
                jobsCount: jobs.length,
                hasJobs: !!jobs && jobs.length > 0,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'user_fine_tune_jobs_retrieved',
                category: 'fine_tune_operations',
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
            
            loggingService.error('User fine-tune jobs retrieval failed', {
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
     * Get a specific fine-tune job
     * GET /api/fine-tune/jobs/:jobId
     */
    static async getFineTuneJob(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = (req as any).user?.id;
        const { jobId } = req.params;

        try {
            loggingService.info('Specific fine-tune job retrieval initiated', {
                userId,
                hasUserId: !!userId,
                jobId,
                hasJobId: !!jobId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Specific fine-tune job retrieval failed - authentication required', {
                    jobId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            loggingService.info('Specific fine-tune job retrieval processing started', {
                userId,
                jobId,
                requestId: req.headers['x-request-id'] as string
            });

            const job = await FineTuneJobService.getFineTuneJob(userId, jobId);

            if (!job) {
                loggingService.warn('Specific fine-tune job not found', {
                    userId,
                    jobId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(404).json({ 
                    success: false, 
                    message: 'Fine-tune job not found' 
                });
                return;
            }

            const duration = Date.now() - startTime;

            loggingService.info('Specific fine-tune job retrieved successfully', {
                userId,
                jobId,
                duration,
                jobName: job.name,
                jobStatus: job.status,
                hasJob: !!job,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'specific_fine_tune_job_retrieved',
                category: 'fine_tune_operations',
                value: duration,
                metadata: {
                    userId,
                    jobId,
                    jobName: job.name,
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
            
            loggingService.error('Specific fine-tune job retrieval failed', {
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
     * Cancel a fine-tune job
     * POST /api/fine-tune/jobs/:jobId/cancel
     */
    static async cancelFineTuneJob(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = (req as any).user?.id;
        const { jobId } = req.params;

        try {
            loggingService.info('Fine-tune job cancellation initiated', {
                userId,
                hasUserId: !!userId,
                jobId,
                hasJobId: !!jobId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Fine-tune job cancellation failed - authentication required', {
                    jobId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            loggingService.info('Fine-tune job cancellation processing started', {
                userId,
                jobId,
                requestId: req.headers['x-request-id'] as string
            });

            const job = await FineTuneJobService.cancelFineTuneJob(userId, jobId);

            const duration = Date.now() - startTime;

            loggingService.info('Fine-tune job cancelled successfully', {
                userId,
                jobId,
                duration,
                jobStatus: job.status,
                hasJob: !!job,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'fine_tune_job_cancelled',
                category: 'fine_tune_operations',
                value: duration,
                metadata: {
                    userId,
                    jobId,
                    jobStatus: job.status,
                    hasJob: !!job
                }
            });

            res.json({
                success: true,
                data: job,
                message: 'Fine-tune job cancelled successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Fine-tune job cancellation failed', {
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
     * Get job status and progress
     * GET /api/fine-tune/jobs/:jobId/status
     */
    static async getJobStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = (req as any).user?.id;
        const { jobId } = req.params;

        try {
            loggingService.info('Fine-tune job status retrieval initiated', {
                userId,
                hasUserId: !!userId,
                jobId,
                hasJobId: !!jobId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Fine-tune job status retrieval failed - authentication required', {
                    jobId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            loggingService.info('Fine-tune job status retrieval processing started', {
                userId,
                jobId,
                requestId: req.headers['x-request-id'] as string
            });

            const job = await FineTuneJobService.getFineTuneJob(userId, jobId);

            if (!job) {
                loggingService.warn('Fine-tune job not found for status retrieval', {
                    userId,
                    jobId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(404).json({ 
                    success: false, 
                    message: 'Fine-tune job not found' 
                });
                return;
            }

            const statusData = {
                status: job.status,
                progress: job.progress,
                cost: job.cost,
                timing: job.timing,
                error: job.error,
                results: job.results,
                providerJobId: job.providerJobId
            };

            const duration = Date.now() - startTime;

            loggingService.info('Fine-tune job status retrieved successfully', {
                userId,
                jobId,
                duration,
                jobStatus: job.status,
                hasProgress: !!job.progress,
                hasCost: !!job.cost,
                hasResults: !!job.results,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'fine_tune_job_status_retrieved',
                category: 'fine_tune_operations',
                value: duration,
                metadata: {
                    userId,
                    jobId,
                    jobStatus: job.status,
                    hasProgress: !!job.progress,
                    hasCost: !!job.cost,
                    hasResults: !!job.results
                }
            });

            res.json({
                success: true,
                data: statusData
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Fine-tune job status retrieval failed', {
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
     * Get job metrics and training progress
     * GET /api/fine-tune/jobs/:jobId/metrics
     */
    static async getJobMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = (req as any).user?.id;
        const { jobId } = req.params;

        try {
            loggingService.info('Fine-tune job metrics retrieval initiated', {
                userId,
                hasUserId: !!userId,
                jobId,
                hasJobId: !!jobId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Fine-tune job metrics retrieval failed - authentication required', {
                    jobId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            loggingService.info('Fine-tune job metrics retrieval processing started', {
                userId,
                jobId,
                requestId: req.headers['x-request-id'] as string
            });

            const job = await FineTuneJobService.getFineTuneJob(userId, jobId);

            if (!job) {
                loggingService.warn('Fine-tune job not found for metrics retrieval', {
                    userId,
                    jobId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(404).json({ 
                    success: false, 
                    message: 'Fine-tune job not found' 
                });
                return;
            }

            const duration = Date.now() - startTime;

            loggingService.info('Fine-tune job metrics retrieved successfully', {
                userId,
                jobId,
                duration,
                hasMetrics: !!job.metrics,
                hasProgress: !!job.progress,
                hasHyperparameters: !!job.hyperparameters,
                hasTiming: !!job.timing,
                hasCost: !!job.cost,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'fine_tune_job_metrics_retrieved',
                category: 'fine_tune_operations',
                value: duration,
                metadata: {
                    userId,
                    jobId,
                    hasMetrics: !!job.metrics,
                    hasProgress: !!job.progress,
                    hasHyperparameters: !!job.hyperparameters,
                    hasTiming: !!job.timing,
                    hasCost: !!job.cost
                }
            });

            res.json({
                success: true,
                data: {
                    metrics: job.metrics,
                    progress: job.progress,
                    hyperparameters: job.hyperparameters,
                    timing: job.timing,
                    cost: job.cost
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Fine-tune job metrics retrieval failed', {
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
     * Delete a fine-tune job
     * DELETE /api/fine-tune/jobs/:jobId
     */
    static async deleteFineTuneJob(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = (req as any).user?.id;
        const { jobId } = req.params;

        try {
            loggingService.info('Fine-tune job deletion initiated', {
                userId,
                hasUserId: !!userId,
                jobId,
                hasJobId: !!jobId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Fine-tune job deletion failed - authentication required', {
                    jobId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            loggingService.info('Fine-tune job deletion processing started', {
                userId,
                jobId,
                requestId: req.headers['x-request-id'] as string
            });

            const deleted = await FineTuneJobService.deleteFineTuneJob(userId, jobId);

            if (!deleted) {
                loggingService.warn('Fine-tune job not found for deletion', {
                    userId,
                    jobId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(404).json({ 
                    success: false, 
                    message: 'Fine-tune job not found' 
                });
                return;
            }

            const duration = Date.now() - startTime;

            loggingService.info('Fine-tune job deleted successfully', {
                userId,
                jobId,
                duration,
                wasDeleted: !!deleted,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'fine_tune_job_deleted',
                category: 'fine_tune_operations',
                value: duration,
                metadata: {
                    userId,
                    jobId,
                    wasDeleted: !!deleted
                }
            });

            res.json({
                success: true,
                message: 'Fine-tune job deleted successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Fine-tune job deletion failed', {
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
     * Get supported providers and models
     * GET /api/fine-tune/providers
     */
    static async getSupportedProviders(_req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();

        try {
            loggingService.info('Supported providers retrieval initiated', {
                requestId: _req.headers['x-request-id'] as string
            });

            const providers = {
                'openai': {
                    name: 'OpenAI',
                    models: [
                        { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', baseModel: true },
                        { id: 'gpt-4', name: 'GPT-4', baseModel: true },
                        { id: 'babbage-002', name: 'Babbage-002', baseModel: true },
                        { id: 'davinci-002', name: 'Davinci-002', baseModel: true }
                    ],
                    hyperparameters: ['learningRate', 'batchSize', 'epochs'],
                    costEstimate: '$8-30 per 1M tokens'
                },
                'aws-bedrock': {
                    name: 'AWS Bedrock',
                    models: [
                        { id: 'anthropic.claude-3-5-haiku-20241022-v1:0', name: 'Claude 3.5 Haiku', baseModel: true },
                        { id: 'anthropic.claude-3-sonnet-20240229-v1:0', name: 'Claude 3 Sonnet', baseModel: true },
                        { id: 'amazon.titan-text-express-v1', name: 'Titan Text Express', baseModel: true }
                    ],
                    hyperparameters: ['learningRate', 'batchSize', 'epochs', 'maxTokens'],
                    costEstimate: '$10-50 per 1M tokens',
                    requirements: ['AWS credentials', 'S3 bucket', 'IAM role']
                },
                'anthropic': {
                    name: 'Anthropic',
                    models: [
                        { id: 'claude-3-haiku', name: 'Claude 3 Haiku', baseModel: true },
                        { id: 'claude-3-sonnet', name: 'Claude 3 Sonnet', baseModel: true }
                    ],
                    hyperparameters: ['learningRate', 'batchSize', 'epochs'],
                    costEstimate: '$15-25 per 1M tokens',
                    status: 'coming_soon'
                }
            };

            const duration = Date.now() - startTime;

            loggingService.info('Supported providers retrieved successfully', {
                duration,
                providersCount: Object.keys(providers).length,
                providers: Object.keys(providers),
                requestId: _req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'fine_tune_supported_providers_retrieved',
                category: 'fine_tune_operations',
                value: duration,
                metadata: {
                    providersCount: Object.keys(providers).length,
                    providers: Object.keys(providers)
                }
            });

            res.json({
                success: true,
                data: providers
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Supported providers retrieval failed', {
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: _req.headers['x-request-id'] as string
            });

            next(error);
        }
    }

    /**
     * Estimate fine-tuning cost
     * POST /api/fine-tune/estimate-cost
     */
    static async estimateCost(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const { provider, baseModel, datasetId } = req.body;
        const userId = (req as any).user?.id;

        try {
            loggingService.info('Fine-tune cost estimation initiated', {
                userId,
                hasUserId: !!userId,
                provider,
                baseModel,
                datasetId,
                hasProvider: !!provider,
                hasBaseModel: !!baseModel,
                hasDatasetId: !!datasetId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!provider || !baseModel || !datasetId) {
                loggingService.warn('Fine-tune cost estimation failed - missing required fields', {
                    userId,
                    hasProvider: !!provider,
                    hasBaseModel: !!baseModel,
                    hasDatasetId: !!datasetId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    message: 'Provider, base model, and dataset ID are required'
                });
                return;
            }

            loggingService.info('Fine-tune cost estimation processing started', {
                userId,
                provider,
                baseModel,
                datasetId,
                requestId: req.headers['x-request-id'] as string
            });

            // Get dataset to calculate tokens
            const { TrainingDataset } = await import('../models/TrainingDataset');
            const dataset = await TrainingDataset.findOne({
                _id: datasetId,
                userId: userId
            });
            
            if (!dataset) {
                loggingService.warn('Fine-tune cost estimation failed - dataset not found', {
                    userId,
                    datasetId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(404).json({
                    success: false,
                    message: 'Dataset not found'
                });
                return;
            }

            // Calculate estimated cost
            let estimatedCost = 0;
            let estimatedDuration = 0; // in minutes
            
            const itemCount = dataset.items?.length || 0;
            const totalTokens = dataset.items ? dataset.items.reduce((sum, item) => {
                // Rough token estimate: 4 characters per token
                return sum + Math.ceil((item.input.length + (item.expectedOutput?.length || 0)) / 4);
            }, 0) : 0;

            switch (provider) {
                case 'openai':
                    estimatedCost = (totalTokens / 1000000) * (baseModel.includes('gpt-4') ? 30 : 8);
                    estimatedDuration = Math.max(30, itemCount * 0.1); // Minimum 30 minutes
                    break;
                case 'aws-bedrock':
                    estimatedCost = (totalTokens / 1000000) * 20;
                    estimatedDuration = Math.max(60, itemCount * 0.2); // Minimum 1 hour
                    break;
                case 'anthropic':
                    estimatedCost = (totalTokens / 1000000) * 20;
                    estimatedDuration = Math.max(45, itemCount * 0.15); // Minimum 45 minutes
                    break;
                default:
                    estimatedCost = itemCount * 0.01; // $0.01 per item fallback
                    estimatedDuration = Math.max(30, itemCount * 0.1);
            }

            const duration = Date.now() - startTime;

            loggingService.info('Fine-tune cost estimation completed successfully', {
                userId,
                provider,
                baseModel,
                datasetId,
                duration,
                itemCount,
                totalTokens,
                estimatedCost,
                estimatedDuration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'fine_tune_cost_estimated',
                category: 'fine_tune_operations',
                value: duration,
                metadata: {
                    userId,
                    provider,
                    baseModel,
                    datasetId,
                    itemCount,
                    totalTokens,
                    estimatedCost,
                    estimatedDuration
                }
            });

            res.json({
                success: true,
                data: {
                    provider,
                    baseModel,
                    itemCount,
                    totalTokens,
                    estimatedCost,
                    estimatedDuration,
                    currency: 'USD',
                    breakdown: {
                        trainingCost: estimatedCost * 0.8,
                        storageCost: estimatedCost * 0.1,
                        computeCost: estimatedCost * 0.1
                    },
                    recommendations: [
                        itemCount < 100 ? 'Consider adding more training examples for better results' : null,
                        totalTokens > 1000000 ? 'Large dataset - consider sampling for faster training' : null,
                        'Review hyperparameters to optimize cost vs. performance trade-off'
                    ].filter(Boolean)
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Fine-tune cost estimation failed', {
                userId,
                provider,
                baseModel,
                datasetId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            next(error);
        }
    }
}
