import { Request, Response, NextFunction } from 'express';
import { FineTuneJobService, CreateFineTuneJobData } from '../services/fineTuneJob.service';
import { logger } from '../utils/logger';

export class FineTuneJobController {
    /**
     * Create a new fine-tune job
     * POST /api/fine-tune/jobs
     */
    static async createFineTuneJob(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const jobData: CreateFineTuneJobData = req.body;

            // Validate required fields
            if (!jobData.name || !jobData.datasetId || !jobData.baseModel || !jobData.provider) {
                res.status(400).json({ 
                    success: false, 
                    message: 'Name, dataset ID, base model, and provider are required' 
                });
                return;
            }

            const fineTuneJob = await FineTuneJobService.createFineTuneJob(userId, jobData);

            res.status(201).json({
                success: true,
                data: fineTuneJob,
                message: 'Fine-tune job created successfully'
            });
        } catch (error) {
            logger.error('Create fine-tune job error:', error);
            next(error);
        }
    }

    /**
     * Get all fine-tune jobs for the authenticated user
     * GET /api/fine-tune/jobs
     */
    static async getUserFineTuneJobs(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const jobs = await FineTuneJobService.getUserFineTuneJobs(userId);

            res.json({
                success: true,
                data: jobs
            });
        } catch (error) {
            logger.error('Get user fine-tune jobs error:', error);
            next(error);
        }
    }

    /**
     * Get a specific fine-tune job
     * GET /api/fine-tune/jobs/:jobId
     */
    static async getFineTuneJob(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const { jobId } = req.params;
            const job = await FineTuneJobService.getFineTuneJob(userId, jobId);

            if (!job) {
                res.status(404).json({ 
                    success: false, 
                    message: 'Fine-tune job not found' 
                });
                return;
            }

            res.json({
                success: true,
                data: job
            });
        } catch (error) {
            logger.error('Get fine-tune job error:', error);
            next(error);
        }
    }

    /**
     * Cancel a fine-tune job
     * POST /api/fine-tune/jobs/:jobId/cancel
     */
    static async cancelFineTuneJob(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const { jobId } = req.params;
            const job = await FineTuneJobService.cancelFineTuneJob(userId, jobId);

            res.json({
                success: true,
                data: job,
                message: 'Fine-tune job cancelled successfully'
            });
        } catch (error) {
            logger.error('Cancel fine-tune job error:', error);
            next(error);
        }
    }

    /**
     * Get job status and progress
     * GET /api/fine-tune/jobs/:jobId/status
     */
    static async getJobStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const { jobId } = req.params;
            const job = await FineTuneJobService.getFineTuneJob(userId, jobId);

            if (!job) {
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

            res.json({
                success: true,
                data: statusData
            });
        } catch (error) {
            logger.error('Get job status error:', error);
            next(error);
        }
    }

    /**
     * Get job metrics and training progress
     * GET /api/fine-tune/jobs/:jobId/metrics
     */
    static async getJobMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const { jobId } = req.params;
            const job = await FineTuneJobService.getFineTuneJob(userId, jobId);

            if (!job) {
                res.status(404).json({ 
                    success: false, 
                    message: 'Fine-tune job not found' 
                });
                return;
            }

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
        } catch (error) {
            logger.error('Get job metrics error:', error);
            next(error);
        }
    }

    /**
     * Delete a fine-tune job
     * DELETE /api/fine-tune/jobs/:jobId
     */
    static async deleteFineTuneJob(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const { jobId } = req.params;
            const deleted = await FineTuneJobService.deleteFineTuneJob(userId, jobId);

            if (!deleted) {
                res.status(404).json({ 
                    success: false, 
                    message: 'Fine-tune job not found' 
                });
                return;
            }

            res.json({
                success: true,
                message: 'Fine-tune job deleted successfully'
            });
        } catch (error) {
            logger.error('Delete fine-tune job error:', error);
            next(error);
        }
    }

    /**
     * Get supported providers and models
     * GET /api/fine-tune/providers
     */
    static async getSupportedProviders(_req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
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
                        { id: 'anthropic.claude-3-haiku-20240307-v1:0', name: 'Claude 3 Haiku', baseModel: true },
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

            res.json({
                success: true,
                data: providers
            });
        } catch (error) {
            logger.error('Get supported providers error:', error);
            next(error);
        }
    }

    /**
     * Estimate fine-tuning cost
     * POST /api/fine-tune/estimate-cost
     */
    static async estimateCost(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { provider, baseModel, datasetId } = req.body;

            if (!provider || !baseModel || !datasetId) {
                res.status(400).json({
                    success: false,
                    message: 'Provider, base model, and dataset ID are required'
                });
                return;
            }

            // Get dataset to calculate tokens
            const userId = (req as any).user?.id;
            const { TrainingDataset } = await import('../models/TrainingDataset');
            const dataset = await TrainingDataset.findOne({
                _id: datasetId,
                userId: userId
            });
            
            if (!dataset) {
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
        } catch (error) {
            logger.error('Estimate cost error:', error);
            next(error);
        }
    }
}
