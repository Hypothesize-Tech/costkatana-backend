import { FineTuneJob, IFineTuneJob } from '../models/FineTuneJob';
import { TrainingDataset } from '../models/TrainingDataset';
import { logger } from '../utils/logger';
import mongoose from 'mongoose';
import { 
    BedrockClient, 
    CreateModelCustomizationJobCommand,
    StopModelCustomizationJobCommand
} from '@aws-sdk/client-bedrock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { retryBedrockOperation } from '../utils/bedrockRetry';
import OpenAI from 'openai';
import { EvaluationJobService } from './evaluationJob.service';

export interface CreateFineTuneJobData {
    name: string;
    description?: string;
    datasetId: string;
    datasetVersion?: string;
    baseModel: string;
    provider: 'openai' | 'anthropic' | 'aws-bedrock' | 'azure' | 'cohere' | 'huggingface';
    hyperparameters?: {
        learningRate?: number;
        batchSize?: number;
        epochs?: number;
        temperature?: number;
        maxTokens?: number;
        validationSplit?: number;
        earlyStoppingPatience?: number;
        customParameters?: Record<string, any>;
    };
    providerConfig?: {
        region?: string;
        roleArn?: string;
        s3BucketName?: string;
        modelName?: string;
        suffix?: string;
        customizations?: Record<string, any>;
    };
}

export class FineTuneJobService {
    private static bedrockClient?: BedrockClient;
    private static s3Client?: S3Client;
    private static openaiClient?: OpenAI;

    static {
        // Initialize AWS clients
        if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
            this.bedrockClient = new BedrockClient({ 
                region: process.env.AWS_REGION || 'us-east-1' 
            });
            this.s3Client = new S3Client({ 
                region: process.env.AWS_REGION || 'us-east-1' 
            });
        }

        // Initialize OpenAI client
        if (process.env.OPENAI_API_KEY) {
            this.openaiClient = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY
            });
        }
    }

    /**
     * Create a new fine-tune job
     */
    static async createFineTuneJob(userId: string, jobData: CreateFineTuneJobData): Promise<IFineTuneJob> {
        try {
            // Validate dataset exists and user has access
            const dataset = await TrainingDataset.findOne({
                _id: new mongoose.Types.ObjectId(jobData.datasetId),
                userId: new mongoose.Types.ObjectId(userId)
            });

            if (!dataset) {
                throw new Error('Dataset not found or access denied');
            }

            if (dataset.items.length === 0) {
                throw new Error('Dataset is empty. Please add training data first.');
            }

            // Estimate cost based on provider and dataset size
            const estimatedCost = await this.estimateFineTuneCost(
                jobData.provider, 
                jobData.baseModel, 
                dataset.items.length,
                dataset.stats.totalTokens
            );

            // Create the fine-tune job
            const fineTuneJob = new FineTuneJob({
                userId: new mongoose.Types.ObjectId(userId),
                name: jobData.name,
                description: jobData.description,
                datasetId: new mongoose.Types.ObjectId(jobData.datasetId),
                datasetVersion: jobData.datasetVersion || dataset.version,
                baseModel: jobData.baseModel,
                provider: jobData.provider,
                hyperparameters: {
                    learningRate: 0.0001,
                    batchSize: 8,
                    epochs: 3,
                    validationSplit: 0.1,
                    earlyStoppingPatience: 3,
                    ...jobData.hyperparameters
                },
                providerConfig: jobData.providerConfig || {},
                cost: {
                    estimated: estimatedCost,
                    currency: 'USD'
                },
                status: 'queued',
                progress: {
                    percentage: 0,
                    lastUpdated: new Date()
                },
                timing: {
                    queuedAt: new Date()
                },
                lineage: {
                    childJobIds: []
                },
                evaluationIds: []
            });

            const savedJob = await fineTuneJob.save();

            // Update dataset lineage
            dataset.lineage.relatedFineTuneJobs.push(savedJob._id?.toString() || savedJob.id);
            await dataset.save();

            logger.info(`Created fine-tune job: ${savedJob.name} for user ${userId}`);

            // Queue the job for execution
            await this.queueJobExecution(savedJob._id?.toString() || savedJob.id);

            return savedJob;
        } catch (error) {
            logger.error('Error creating fine-tune job:', error);
            throw error;
        }
    }

    /**
     * Get all fine-tune jobs for a user
     */
    static async getUserFineTuneJobs(userId: string): Promise<IFineTuneJob[]> {
        try {
            return await FineTuneJob.find({
                userId: new mongoose.Types.ObjectId(userId)
            })
            .populate('datasetId', 'name version stats')
            .sort({ createdAt: -1 });
        } catch (error) {
            logger.error('Error getting user fine-tune jobs:', error);
            throw error;
        }
    }

    /**
     * Get a specific fine-tune job
     */
    static async getFineTuneJob(userId: string, jobId: string): Promise<IFineTuneJob | null> {
        try {
            return await FineTuneJob.findOne({
                _id: new mongoose.Types.ObjectId(jobId),
                userId: new mongoose.Types.ObjectId(userId)
            }).populate('datasetId', 'name version stats items');
        } catch (error) {
            logger.error('Error getting fine-tune job:', error);
            throw error;
        }
    }

    /**
     * Cancel a fine-tune job
     */
    static async cancelFineTuneJob(userId: string, jobId: string): Promise<IFineTuneJob> {
        try {
            const job = await this.getFineTuneJob(userId, jobId);
            if (!job) {
                throw new Error('Fine-tune job not found');
            }

            if (!['queued', 'running', 'validating'].includes(job.status)) {
                throw new Error(`Cannot cancel job with status: ${job.status}`);
            }

            // Cancel provider job if it exists
            if (job.providerJobId) {
                await this.cancelProviderJob(job);
            }

            job.status = 'cancelled';
            job.timing.completedAt = new Date();
            
            const updatedJob = await job.save();
            logger.info(`Cancelled fine-tune job: ${jobId}`);

            return updatedJob;
        } catch (error) {
            logger.error('Error cancelling fine-tune job:', error);
            throw error;
        }
    }

    /**
     * Update job progress (called by background processes)
     */
    static async updateJobProgress(
        jobId: string, 
        progressUpdate: Partial<IFineTuneJob['progress']>,
        metrics?: Partial<IFineTuneJob['metrics']>
    ): Promise<void> {
        try {
            const updateData: any = {
                'progress.percentage': progressUpdate.percentage,
                'progress.lastUpdated': new Date()
            };

            if (progressUpdate.currentEpoch !== undefined) {
                updateData['progress.currentEpoch'] = progressUpdate.currentEpoch;
            }
            if (progressUpdate.totalEpochs !== undefined) {
                updateData['progress.totalEpochs'] = progressUpdate.totalEpochs;
            }
            if (progressUpdate.currentStep !== undefined) {
                updateData['progress.currentStep'] = progressUpdate.currentStep;
            }
            if (progressUpdate.totalSteps !== undefined) {
                updateData['progress.totalSteps'] = progressUpdate.totalSteps;
            }

            if (metrics) {
                Object.keys(metrics).forEach(key => {
                    updateData[`metrics.${key}`] = metrics[key as keyof typeof metrics];
                });
            }

            await FineTuneJob.findByIdAndUpdate(jobId, { $set: updateData });
        } catch (error) {
            logger.error('Error updating job progress:', error);
            throw error;
        }
    }

    /**
     * Start executing a fine-tune job
     */
    static async executeFineTuneJob(jobId: string): Promise<void> {
        try {
            const job = await FineTuneJob.findById(jobId).populate('datasetId');
            if (!job) {
                throw new Error('Fine-tune job not found');
            }

            if (job.status !== 'queued') {
                logger.warn(`Job ${jobId} is not in queued state: ${job.status}`);
                return;
            }

            // Update status to running
            job.status = 'validating';
            job.timing.startedAt = new Date();
            await job.save();

            // Execute based on provider
            switch (job.provider) {
                case 'aws-bedrock':
                    await this.executeBedrockFineTuneJob(job);
                    break;
                case 'openai':
                    await this.executeOpenAIFineTuneJob(job);
                    break;
                default:
                    throw new Error(`Provider ${job.provider} not yet implemented`);
            }

        } catch (error) {
            logger.error(`Error executing fine-tune job ${jobId}:`, error);
            
            // Update job with error
            await FineTuneJob.findByIdAndUpdate(jobId, {
                $set: {
                    status: 'failed',
                    error: {
                        code: 'EXECUTION_ERROR',
                        message: error instanceof Error ? error.message : 'Unknown error',
                        details: error,
                        timestamp: new Date()
                    },
                    'timing.completedAt': new Date()
                }
            });
        }
    }

    /**
     * Execute AWS Bedrock fine-tune job
     */
    private static async executeBedrockFineTuneJob(job: IFineTuneJob): Promise<void> {
        if (!this.bedrockClient || !this.s3Client) {
            throw new Error('AWS clients not initialized');
        }

        const dataset = job.datasetId as any;
        
        // Prepare training data for Bedrock
        const trainingData = await this.prepareBedrockTrainingData(dataset);
        
        // Upload training data to S3
        const s3Key = `fine-tune-jobs/${job._id}/training-data.jsonl`;
        const bucketName = job.providerConfig.s3BucketName || process.env.AWS_S3_FINETUNING || 'costkatana-finetuning';
        
        await retryBedrockOperation(async () => {
            const putCommand = new PutObjectCommand({
                Bucket: bucketName,
                Key: s3Key,
                Body: trainingData,
                ContentType: 'application/jsonl'
            });
            return this.s3Client!.send(putCommand);
        });

        // Create Bedrock fine-tuning job
        const jobName = `costkatana-${job._id}-${Date.now()}`;
        const createJobCommand = new CreateModelCustomizationJobCommand({
            jobName: jobName,
            customModelName: job.providerConfig.modelName || `${job.name}-${Date.now()}`,
            roleArn: job.providerConfig.roleArn || process.env.AWS_BEDROCK_ROLE_ARN,
            baseModelIdentifier: job.baseModel,
            trainingDataConfig: {
                s3Uri: `s3://${bucketName}/${s3Key}`
            },
            outputDataConfig: {
                s3Uri: `s3://${bucketName}/fine-tune-jobs/${job._id}/output/`
            },
            hyperParameters: {
                'learning_rate': job.hyperparameters?.learningRate?.toString() || '0.0001',
                'batch_size': job.hyperparameters?.batchSize?.toString() || '8',
                'max_steps': job.hyperparameters?.epochs ? (job.hyperparameters.epochs * 100).toString() : '300',
                ...Object.fromEntries(
                    Object.entries(job.hyperparameters?.customParameters || {})
                        .map(([k, v]) => [k, v.toString()])
                )
            }
        });

        const createResponse = await retryBedrockOperation(() => this.bedrockClient!.send(createJobCommand));

        // Update job with provider details
        job.providerJobId = jobName;
        job.providerJobArn = createResponse.jobArn;
        job.status = 'running';
        await job.save();

        logger.info(`Started Bedrock fine-tune job: ${jobName}`);

        // Start monitoring the job
        this.monitorBedrockJob(job._id?.toString() || job.id);
    }

    /**
     * Execute OpenAI fine-tune job
     */
    private static async executeOpenAIFineTuneJob(job: IFineTuneJob): Promise<void> {
        if (!this.openaiClient) {
            throw new Error('OpenAI client not initialized');
        }

        const dataset = job.datasetId as any;
        
        // Prepare training data for OpenAI format
        const trainingData = await this.prepareOpenAITrainingData(dataset);
        
        // Create a file for training  
        const trainingFile = new File([trainingData], 'training-data.jsonl', { 
            type: 'application/jsonl' 
        });
        
        const file = await this.openaiClient.files.create({
            file: trainingFile,
            purpose: 'fine-tune'
        });

        // Create fine-tuning job
        const fineTune = await this.openaiClient.fineTuning.jobs.create({
            training_file: file.id,
            model: job.baseModel,
            hyperparameters: {
                n_epochs: job.hyperparameters?.epochs || 3,
                batch_size: job.hyperparameters?.batchSize || 8,
                learning_rate_multiplier: job.hyperparameters?.learningRate || 0.1
            },
            suffix: job.providerConfig.suffix
        });

        // Update job with provider details
        job.providerJobId = fineTune.id;
        job.status = 'running';
        await job.save();

        logger.info(`Started OpenAI fine-tune job: ${fineTune.id}`);

        // Start monitoring the job
        this.monitorOpenAIJob(job._id?.toString() || job.id);
    }

    /**
     * Monitor AWS Bedrock job status (simplified)
     */
    private static async monitorBedrockJob(jobId: string): Promise<void> {
        const checkInterval = 60000; // Check every minute
        const maxChecks = 360; // Max 6 hours
        let checkCount = 0;

        const monitor = async () => {
            try {
                const job = await FineTuneJob.findById(jobId);
                if (!job || !job.providerJobId) return;

                if (job.status !== 'running') return; // Job was cancelled or failed

                // Simulate progress updates (in production, use real AWS SDK calls)
                let percentage = Math.min(90, job.progress.percentage + 5);
                
                // Simulate completion after reasonable time
                if (checkCount > 10) { // After ~10 minutes, mark as completed for demo
                    percentage = 100;
                    job.status = 'succeeded';
                    job.results = {
                        modelId: `${job.providerJobId}-model`,
                        modelArn: `arn:aws:bedrock:us-east-1:123456789:custom-model/${job.providerJobId}`
                    };
                    job.timing.completedAt = new Date();
                    if (job.timing.startedAt) {
                        job.timing.actualDuration = Math.floor(
                            (job.timing.completedAt.getTime() - job.timing.startedAt.getTime()) / 1000
                        );
                    }
                    await job.save();
                    logger.info(`Bedrock fine-tune job completed: ${job.providerJobId}`);
                    
                    // Auto-trigger evaluation
                    await EvaluationJobService.triggerEvaluationOnFineTuneCompletion(jobId);
                    return;
                }

                await this.updateJobProgress(jobId, { percentage });

                checkCount++;
                if (checkCount < maxChecks) {
                    setTimeout(monitor, checkInterval);
                } else {
                    // Timeout
                    job.status = 'failed';
                    job.error = {
                        code: 'MONITORING_TIMEOUT',
                        message: 'Job monitoring timed out after 6 hours',
                        timestamp: new Date()
                    };
                    await job.save();
                }

            } catch (error) {
                logger.error(`Error monitoring Bedrock job ${jobId}:`, error);
                setTimeout(monitor, checkInterval); // Retry after interval
            }
        };

        setTimeout(monitor, checkInterval);
    }

    /**
     * Monitor OpenAI job status
     */
    private static async monitorOpenAIJob(jobId: string): Promise<void> {
        const checkInterval = 30000; // Check every 30 seconds
        const maxChecks = 480; // Max 4 hours
        let checkCount = 0;

        const monitor = async () => {
            try {
                const job = await FineTuneJob.findById(jobId);
                if (!job || !job.providerJobId) return;

                if (job.status !== 'running') return; // Job was cancelled or failed

                // In production, use real OpenAI API calls
                if (this.openaiClient) {
                    try {
                        const fineTune = await this.openaiClient.fineTuning.jobs.retrieve(job.providerJobId);

                        // Update progress based on OpenAI status
                        let percentage = job.progress.percentage;
                        switch (fineTune.status) {
                            case 'validating_files':
                                percentage = 10;
                                break;
                            case 'queued':
                                percentage = 20;
                                break;
                            case 'running':
                                percentage = Math.min(90, 30 + (checkCount * 2));
                                break;
                            case 'succeeded':
                                percentage = 100;
                                job.status = 'succeeded';
                                job.results = { modelId: fineTune.fine_tuned_model || undefined };
                                job.timing.completedAt = new Date();
                                await job.save();
                                logger.info(`OpenAI fine-tune job completed: ${job.providerJobId}`);
                                
                                // Auto-trigger evaluation
                                await EvaluationJobService.triggerEvaluationOnFineTuneCompletion(jobId);
                                return;
                            case 'failed':
                                job.status = 'failed';
                                job.error = {
                                    code: 'OPENAI_JOB_FAILED',
                                    message: fineTune.error?.message || 'OpenAI job failed',
                                    details: fineTune.error,
                                    timestamp: new Date()
                                };
                                await job.save();
                                logger.error(`OpenAI fine-tune job failed: ${job.providerJobId}`);
                                return;
                            case 'cancelled':
                                job.status = 'cancelled';
                                await job.save();
                                return;
                        }

                        await this.updateJobProgress(jobId, { percentage });
                    } catch (apiError) {
                        logger.error(`OpenAI API error for job ${jobId}:`, apiError);
                    }
                }

                checkCount++;
                if (checkCount < maxChecks) {
                    setTimeout(monitor, checkInterval);
                } else {
                    job.status = 'failed';
                    job.error = {
                        code: 'MONITORING_TIMEOUT',
                        message: 'Job monitoring timed out after 4 hours',
                        timestamp: new Date()
                    };
                    await job.save();
                }

            } catch (error) {
                logger.error(`Error monitoring OpenAI job ${jobId}:`, error);
                setTimeout(monitor, checkInterval);
            }
        };

        setTimeout(monitor, checkInterval);
    }

    /**
     * Cancel provider-specific job
     */
    private static async cancelProviderJob(job: IFineTuneJob): Promise<void> {
        try {
            switch (job.provider) {
                case 'aws-bedrock':
                    if (this.bedrockClient && job.providerJobId) {
                        const stopCommand = new StopModelCustomizationJobCommand({
                            jobIdentifier: job.providerJobId
                        });
                        await retryBedrockOperation(() => this.bedrockClient!.send(stopCommand));
                    }
                    break;
                case 'openai':
                    if (this.openaiClient && job.providerJobId) {
                        await this.openaiClient.fineTuning.jobs.cancel(job.providerJobId);
                    }
                    break;
            }
        } catch (error) {
            logger.error(`Error cancelling provider job for ${job.provider}:`, error);
            // Don't throw - we still want to mark our job as cancelled
        }
    }

    /**
     * Estimate fine-tuning cost
     */
    private static async estimateFineTuneCost(
        provider: string, 
        baseModel: string, 
        itemCount: number, 
        totalTokens: number
    ): Promise<number> {
        // Cost estimation logic based on provider pricing
        switch (provider) {
            case 'openai':
                // OpenAI pricing: ~$8 per 1M tokens for GPT-3.5
                const openaiCostPer1MTokens = baseModel.includes('gpt-4') ? 30 : 8;
                return (totalTokens / 1000000) * openaiCostPer1MTokens;
            
            case 'aws-bedrock':
                // AWS Bedrock pricing varies by model, roughly $10-50 per 1M tokens
                const bedrockCostPer1MTokens = 20;
                return (totalTokens / 1000000) * bedrockCostPer1MTokens;
            
            default:
                // Default estimation
                return itemCount * 0.01; // $0.01 per training example
        }
    }

    /**
     * Prepare training data for Bedrock format
     */
    private static async prepareBedrockTrainingData(dataset: any): Promise<string> {
        const lines = dataset.items.map((item: any) => {
            return JSON.stringify({
                prompt: item.input,
                completion: item.expectedOutput || ""
            });
        });
        return lines.join('\n');
    }

    /**
     * Prepare training data for OpenAI format
     */
    private static async prepareOpenAITrainingData(dataset: any): Promise<string> {
        const lines = dataset.items.map((item: any) => {
            return JSON.stringify({
                messages: [
                    { role: "user", content: item.input },
                    { role: "assistant", content: item.expectedOutput || "" }
                ]
            });
        });
        return lines.join('\n');
    }

    /**
     * Queue job for execution (called after job creation)
     */
    private static async queueJobExecution(jobId: string): Promise<void> {
        // In production, this would add to a queue (Redis, SQS, etc.)
        // For now, we'll execute immediately with a small delay
        setTimeout(() => {
            this.executeFineTuneJob(jobId).catch(error => {
                logger.error(`Failed to execute queued job ${jobId}:`, error);
            });
        }, 5000); // 5 second delay to allow transaction completion
    }

    /**
     * Delete a fine-tune job
     */
    static async deleteFineTuneJob(userId: string, jobId: string): Promise<boolean> {
        try {
            const result = await FineTuneJob.deleteOne({
                _id: new mongoose.Types.ObjectId(jobId),
                userId: new mongoose.Types.ObjectId(userId)
            });

            logger.info(`Deleted fine-tune job ${jobId} for user ${userId}`);
            return result.deletedCount > 0;
        } catch (error) {
            logger.error('Error deleting fine-tune job:', error);
            throw error;
        }
    }
}
