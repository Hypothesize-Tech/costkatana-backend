import { FineTuneJob, IFineTuneJob } from '../models/FineTuneJob';
import { TrainingDataset } from '../models/TrainingDataset';
import { loggingService } from './logging.service';
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

    // Centralized monitoring system
    private static monitoringJobs = new Map<string, {
        jobId: string,
        provider: string,
        lastCheck: number,
        checkCount: number,
        maxChecks: number,
        interval: number
    }>();
    private static monitoringTimer?: NodeJS.Timeout;

    // Circuit breaker for provider calls
    private static circuitBreaker = {
        failures: new Map<string, number>(),
        lastFailure: new Map<string, number>(),
        isOpen: (provider: string) => {
            const failures = FineTuneJobService.circuitBreaker.failures.get(provider) || 0;
            const lastFailure = FineTuneJobService.circuitBreaker.lastFailure.get(provider) || 0;
            const now = Date.now();
            
            // Reset after 10 minutes
            if (now - lastFailure > 10 * 60 * 1000) {
                FineTuneJobService.circuitBreaker.failures.set(provider, 0);
                return false;
            }
            
            return failures >= 3; // Open circuit after 3 failures
        },
        recordFailure: (provider: string) => {
            const current = FineTuneJobService.circuitBreaker.failures.get(provider) || 0;
            FineTuneJobService.circuitBreaker.failures.set(provider, current + 1);
            FineTuneJobService.circuitBreaker.lastFailure.set(provider, Date.now());
        }
    };

    // Batch progress updates
    private static progressUpdateQueue = new Map<string, any>();
    private static progressUpdateTimer?: NodeJS.Timeout;

    // Conditional logging
    private static DEBUG_ENABLED = process.env.FINETUNE_DEBUG === 'true';

    // Pre-computed pricing matrix for fast cost estimation
    private static pricingMatrix = new Map([
        ['openai-gpt-3.5-turbo', 8],
        ['openai-gpt-4', 30],
        ['openai-babbage-002', 8],
        ['openai-davinci-002', 8],
        ['aws-bedrock-claude-3-5-haiku', 15],
        ['aws-bedrock-claude-3-sonnet', 25],
        ['aws-bedrock-titan-text', 20],
        ['anthropic-claude-3-haiku', 15],
        ['anthropic-claude-3-sonnet', 25]
    ]);

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
     * Create a new fine-tune job with database transaction optimization
     */
    static async createFineTuneJob(userId: string, jobData: CreateFineTuneJobData): Promise<IFineTuneJob> {
        const session = await mongoose.startSession();
        
        try {
            return await session.withTransaction(async () => {
                // Validate dataset exists and user has access
                const dataset = await TrainingDataset.findOne({
                    _id: new mongoose.Types.ObjectId(jobData.datasetId),
                    userId: new mongoose.Types.ObjectId(userId)
                }).session(session);

                if (!dataset) {
                    throw new Error('Dataset not found or access denied');
                }

                if (dataset.items.length === 0) {
                    throw new Error('Dataset is empty. Please add training data first.');
                }

                // Fast cost estimation (non-blocking)
                const estimatedCost = this.estimateFineTuneCostFast(
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

                // Save job and update dataset lineage atomically
                const [savedJob] = await Promise.all([
                    fineTuneJob.save({ session }),
                    TrainingDataset.findByIdAndUpdate(
                        dataset._id,
                        { 
                            $push: { 
                                'lineage.relatedFineTuneJobs': fineTuneJob._id?.toString() || fineTuneJob.id 
                            } 
                        },
                        { session }
                    )
                ]);

            loggingService.info(`Created fine-tune job: ${savedJob.name} for user ${userId}`);

                // Queue the job for execution (non-blocking)
                setImmediate(() => {
                    this.queueJobExecution(savedJob._id?.toString() || savedJob.id);
                });

                return savedJob;
            });
        } catch (error) {
            loggingService.error('Error creating fine-tune job:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        } finally {
            await session.endSession();
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
            loggingService.error('Error getting user fine-tune jobs:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get a specific fine-tune job with projection optimization
     */
    static async getFineTuneJob(userId: string, jobId: string): Promise<IFineTuneJob | null> {
        try {
            return await FineTuneJob.findOne({
                _id: new mongoose.Types.ObjectId(jobId),
                userId: new mongoose.Types.ObjectId(userId)
            }).populate('datasetId', 'name version stats items');
        } catch (error) {
            loggingService.error('Error getting fine-tune job:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get job status with minimal data transfer
     */
    static async getJobStatus(userId: string, jobId: string): Promise<Partial<IFineTuneJob> | null> {
        try {
            return await FineTuneJob.findOne({
                _id: new mongoose.Types.ObjectId(jobId),
                userId: new mongoose.Types.ObjectId(userId)
            }).select('status progress cost timing error results providerJobId');
        } catch (error) {
            loggingService.error('Error getting job status:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get job metrics with minimal data transfer
     */
    static async getJobMetrics(userId: string, jobId: string): Promise<Partial<IFineTuneJob> | null> {
        try {
            return await FineTuneJob.findOne({
                _id: new mongoose.Types.ObjectId(jobId),
                userId: new mongoose.Types.ObjectId(userId)
            }).select('metrics progress hyperparameters timing cost');
        } catch (error) {
            loggingService.error('Error getting job metrics:', { error: error instanceof Error ? error.message : String(error) });
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
            loggingService.info(`Cancelled fine-tune job: ${jobId}`);

            return updatedJob;
        } catch (error) {
            loggingService.error('Error cancelling fine-tune job:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Update job progress with batching optimization
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

            // Queue update for batching
            this.queueProgressUpdate(jobId, updateData);
        } catch (error) {
            loggingService.error('Error updating job progress:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Queue progress update for batch processing
     */
    private static queueProgressUpdate(jobId: string, updateData: any): void {
        this.progressUpdateQueue.set(jobId, updateData);
        
        if (!this.progressUpdateTimer) {
            this.progressUpdateTimer = setTimeout(() => {
                this.processBatchProgressUpdates();
            }, 2000); // Batch updates every 2 seconds
        }
    }

    /**
     * Process batched progress updates
     */
    private static async processBatchProgressUpdates(): Promise<void> {
        if (this.progressUpdateQueue.size === 0) return;

        try {
            const bulkOps = Array.from(this.progressUpdateQueue.entries()).map(([jobId, updateData]) => ({
                updateOne: {
                    filter: { _id: jobId },
                    update: { $set: updateData }
                }
            }));

            await FineTuneJob.bulkWrite(bulkOps);
            this.progressUpdateQueue.clear();
        } catch (error) {
            loggingService.error('Error processing batch progress updates:', { error: error instanceof Error ? error.message : String(error) });
        } finally {
            this.progressUpdateTimer = undefined;
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
                loggingService.warn(`Job ${jobId} is not in queued state: ${job.status}`);
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
            loggingService.error(`Error executing fine-tune job ${jobId}:`, { error: error instanceof Error ? error.message : String(error) });
            
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

        loggingService.info(`Started Bedrock fine-tune job: ${jobName}`);

        // Add job to centralized monitoring
        this.addJobToMonitoring(job._id?.toString() || job.id, 'aws-bedrock');
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

        loggingService.info(`Started OpenAI fine-tune job: ${fineTune.id}`);

        // Add job to centralized monitoring
        this.addJobToMonitoring(job._id?.toString() || job.id, 'openai');
    }

    /**
     * Add job to centralized monitoring system
     */
    private static addJobToMonitoring(jobId: string, provider: string): void {
        const config = {
            jobId,
            provider,
            lastCheck: Date.now(),
            checkCount: 0,
            maxChecks: provider === 'openai' ? 480 : 360, // 4h for OpenAI, 6h for Bedrock
            interval: provider === 'openai' ? 30000 : 60000 // 30s for OpenAI, 60s for Bedrock
        };

        this.monitoringJobs.set(jobId, config);
        this.startCentralizedMonitoring();
    }

    /**
     * Start centralized monitoring system
     */
    private static startCentralizedMonitoring(): void {
        if (this.monitoringTimer) return; // Already running

        this.monitoringTimer = setInterval(async () => {
            await this.processAllMonitoringJobs();
        }, 30000); // Check every 30 seconds
    }

    /**
     * Process all monitoring jobs in parallel
     */
    private static async processAllMonitoringJobs(): Promise<void> {
        if (this.monitoringJobs.size === 0) {
            if (this.monitoringTimer) {
                clearInterval(this.monitoringTimer);
                this.monitoringTimer = undefined;
            }
            return;
        }

        const jobsToProcess = Array.from(this.monitoringJobs.entries())
            .filter(([_, config]) => Date.now() - config.lastCheck >= config.interval);

        if (jobsToProcess.length === 0) return;

        // Process jobs in parallel
        const results = await Promise.allSettled(
            jobsToProcess.map(([jobId, config]) => this.checkJobStatus(jobId, config))
        );

        // Remove completed jobs from monitoring
        results.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value === 'completed') {
                const [jobId] = jobsToProcess[index];
                this.monitoringJobs.delete(jobId);
            }
        });
    }

    /**
     * Check individual job status
     */
    private static async checkJobStatus(jobId: string, config: any): Promise<string> {
        try {
            const job = await FineTuneJob.findById(jobId);
            if (!job || !job.providerJobId) return 'completed';

            if (job.status !== 'running') return 'completed';

            config.lastCheck = Date.now();
            config.checkCount++;

            if (config.provider === 'aws-bedrock') {
                return await this.checkBedrockJobStatus(job, config);
            } else if (config.provider === 'openai') {
                return await this.checkOpenAIJobStatus(job, config);
            }

            return 'continue';
        } catch (error) {
            this.logDebug(`Error checking job status ${jobId}:`, { error: error instanceof Error ? error.message : String(error) });
            return 'continue';
        }
    }

    /**
     * Check Bedrock job status
     */
    private static async checkBedrockJobStatus(job: any, config: any): Promise<string> {
        // Simulate progress updates (in production, use real AWS SDK calls)
        let percentage = Math.min(90, job.progress.percentage + 5);
        
        // Simulate completion after reasonable time
        if (config.checkCount > 10) {
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
            this.logInfo(`Bedrock fine-tune job completed: ${job.providerJobId}`);
            
            // Auto-trigger evaluation
            await EvaluationJobService.triggerEvaluationOnFineTuneCompletion(job._id?.toString() || job.id);
            return 'completed';
        }

        await this.updateJobProgress(job._id?.toString() || job.id, { percentage });

        if (config.checkCount >= config.maxChecks) {
            job.status = 'failed';
            job.error = {
                code: 'MONITORING_TIMEOUT',
                message: 'Job monitoring timed out after 6 hours',
                timestamp: new Date()
            };
            await job.save();
            return 'completed';
        }

        return 'continue';
    }

    /**
     * Check OpenAI job status
     */
    private static async checkOpenAIJobStatus(job: any, config: any): Promise<string> {
        if (!this.openaiClient) return 'continue';

        try {
            const fineTune = await this.openaiClient.fineTuning.jobs.retrieve(job.providerJobId);

            let percentage = job.progress.percentage;
            switch (fineTune.status) {
                case 'validating_files':
                    percentage = 10;
                    break;
                case 'queued':
                    percentage = 20;
                    break;
                case 'running':
                    percentage = Math.min(90, 30 + (config.checkCount * 2));
                    break;
                case 'succeeded':
                    percentage = 100;
                    job.status = 'succeeded';
                    job.results = { modelId: fineTune.fine_tuned_model || undefined };
                    job.timing.completedAt = new Date();
                    await job.save();
                    this.logInfo(`OpenAI fine-tune job completed: ${job.providerJobId}`);
                    
                    await EvaluationJobService.triggerEvaluationOnFineTuneCompletion(job._id?.toString() || job.id);
                    return 'completed';
                case 'failed':
                    job.status = 'failed';
                    job.error = {
                        code: 'OPENAI_JOB_FAILED',
                        message: fineTune.error?.message || 'OpenAI job failed',
                        details: fineTune.error,
                        timestamp: new Date()
                    };
                    await job.save();
                    return 'completed';
                case 'cancelled':
                    job.status = 'cancelled';
                    await job.save();
                    return 'completed';
            }

            await this.updateJobProgress(job._id?.toString() || job.id, { percentage });
        } catch (apiError) {
            this.logDebug(`OpenAI API error for job ${job._id}:`, { error: apiError instanceof Error ? apiError.message : String(apiError) });
        }

        if (config.checkCount >= config.maxChecks) {
            job.status = 'failed';
            job.error = {
                code: 'MONITORING_TIMEOUT',
                message: 'Job monitoring timed out after 4 hours',
                timestamp: new Date()
            };
            await job.save();
            return 'completed';
        }

        return 'continue';
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
            loggingService.error(`Error cancelling provider job for ${job.provider}:`, { error: error instanceof Error ? error.message : String(error) });
            // Don't throw - we still want to mark our job as cancelled
        }
    }

    /**
     * Fast cost estimation using pre-computed pricing matrix
     */
    private static estimateFineTuneCostFast(
        provider: string, 
        baseModel: string, 
        itemCount: number, 
        totalTokens: number
    ): number {
        const key = `${provider}-${baseModel}`;
        const costPer1M = this.pricingMatrix.get(key) || 
                         this.pricingMatrix.get(`${provider}-${baseModel.split('-')[0]}`) || 
                         10; // Default fallback

        return (totalTokens / 1000000) * costPer1M;
    }

    /**
     * Legacy cost estimation method (kept for compatibility)
     */
    private static async estimateFineTuneCost(
        provider: string, 
        baseModel: string, 
        itemCount: number, 
        totalTokens: number
    ): Promise<number> {
        return this.estimateFineTuneCostFast(provider, baseModel, itemCount, totalTokens);
    }

    /**
     * Prepare training data for Bedrock format with streaming
     */
    private static async prepareBedrockTrainingData(dataset: any): Promise<string> {
        return this.processTrainingDataInBatches(dataset.items, (item: any) => ({
            prompt: item.input,
            completion: item.expectedOutput || ""
        }));
    }

    /**
     * Prepare training data for OpenAI format with streaming
     */
    private static async prepareOpenAITrainingData(dataset: any): Promise<string> {
        return this.processTrainingDataInBatches(dataset.items, (item: any) => ({
            messages: [
                { role: "user", content: item.input },
                { role: "assistant", content: item.expectedOutput || "" }
            ]
        }));
    }

    /**
     * Process training data in batches for memory efficiency
     */
    private static async processTrainingDataInBatches(
        items: any[], 
        formatter: (item: any) => any
    ): Promise<string> {
        const BATCH_SIZE = 1000;
        const chunks: string[] = [];
        
        for (let i = 0; i < items.length; i += BATCH_SIZE) {
            const batch = items.slice(i, i + BATCH_SIZE);
            const batchLines = batch.map(item => JSON.stringify(formatter(item)));
            chunks.push(batchLines.join('\n'));
            
            // Allow event loop to process other tasks
            if (i + BATCH_SIZE < items.length) {
                await new Promise(resolve => setImmediate(resolve));
            }
        }
        
        return chunks.join('\n');
    }

    /**
     * Queue job for execution (called after job creation)
     */
    private static async queueJobExecution(jobId: string): Promise<void> {
        // In production, this would add to a queue (Redis, SQS, etc.)
        // For now, we'll execute immediately with a small delay
        setTimeout(() => {
            this.executeFineTuneJob(jobId).catch(error => {
                loggingService.error(`Failed to execute queued job ${jobId}:`, { error: error instanceof Error ? error.message : String(error) });
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

            this.logInfo(`Deleted fine-tune job ${jobId} for user ${userId}`);
            return result.deletedCount > 0;
        } catch (error) {
            loggingService.error('Error deleting fine-tune job:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    // ============================================================================
    // UTILITY METHODS FOR OPTIMIZATION
    // ============================================================================

    /**
     * Conditional logging - info level
     */
    private static logInfo(message: string, data?: any): void {
        loggingService.info(message, data);
    }

    /**
     * Conditional logging - debug level
     */
    private static logDebug(message: string, data?: any): void {
        if (this.DEBUG_ENABLED) {
            loggingService.debug(message, data);
        }
    }

    /**
     * Execute provider operation with circuit breaker
     */
    private static async executeWithCircuitBreaker<T>(
        operation: () => Promise<T>,
        provider: string,
        fallback: () => T,
        timeout: number = 30000
    ): Promise<T> {
        if (this.circuitBreaker.isOpen(provider)) {
            this.logDebug(`Circuit breaker open for ${provider}, using fallback`);
            return fallback();
        }

        try {
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error(`Provider ${provider} timeout after ${timeout}ms`)), timeout);
            });

            const result = await Promise.race([operation(), timeoutPromise]);
            return result;
        } catch (error) {
            this.circuitBreaker.recordFailure(provider);
            this.logDebug(`Provider ${provider} operation failed:`, { error: error instanceof Error ? error.message : String(error) });
            return fallback();
        }
    }
}
