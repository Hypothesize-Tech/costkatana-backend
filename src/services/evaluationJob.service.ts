import { EvaluationJob, IEvaluationJob } from '../models/EvaluationJob';
import { FineTuneJob } from '../models/FineTuneJob';
import { TrainingDataset } from '../models/TrainingDataset';
import { logger } from '../utils/logger';
import mongoose from 'mongoose';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { retryBedrockOperation } from '../utils/bedrockRetry';

export interface CreateEvaluationJobData {
    name: string;
    description?: string;
    fineTuneJobId?: string;
    modelId: string;
    datasetId: string;
    datasetVersion?: string;
    evaluationType?: 'accuracy' | 'quality' | 'cost-effectiveness' | 'comprehensive';
    metrics?: string[];
    benchmarks?: string[];
}

export class EvaluationJobService {
    private static bedrockClient = new BedrockRuntimeClient({ 
        region: process.env.AWS_REGION || 'us-east-1' 
    });

    /**
     * Create a new evaluation job
     */
    static async createEvaluationJob(userId: string, jobData: CreateEvaluationJobData): Promise<IEvaluationJob> {
        try {
            // Validate dataset exists
            const dataset = await TrainingDataset.findOne({
                _id: new mongoose.Types.ObjectId(jobData.datasetId),
                userId: new mongoose.Types.ObjectId(userId)
            });

            if (!dataset) {
                throw new Error('Dataset not found or access denied');
            }

            // Validate fine-tune job if provided
            let fineTuneJob = null;
            if (jobData.fineTuneJobId) {
                fineTuneJob = await FineTuneJob.findOne({
                    _id: new mongoose.Types.ObjectId(jobData.fineTuneJobId),
                    userId: new mongoose.Types.ObjectId(userId)
                });

                if (!fineTuneJob) {
                    throw new Error('Fine-tune job not found or access denied');
                }
            }

            // Estimate cost
            const estimatedCost = await this.estimateEvaluationCost(
                jobData.evaluationType || 'comprehensive',
                dataset.items.length
            );

            // Create evaluation job
            const evaluationJob = new EvaluationJob({
                userId: new mongoose.Types.ObjectId(userId),
                name: jobData.name,
                description: jobData.description,
                fineTuneJobId: jobData.fineTuneJobId ? new mongoose.Types.ObjectId(jobData.fineTuneJobId) : undefined,
                modelId: jobData.modelId,
                datasetId: new mongoose.Types.ObjectId(jobData.datasetId),
                datasetVersion: jobData.datasetVersion || dataset.version,
                evaluationType: jobData.evaluationType || 'comprehensive',
                metrics: jobData.metrics || ['accuracy', 'bleu', 'rouge', 'cost-per-token'],
                benchmarks: jobData.benchmarks || [],
                cost: {
                    estimated: estimatedCost,
                    currency: 'USD'
                },
                progress: {
                    percentage: 0,
                    currentStep: 'Initializing evaluation',
                    totalSteps: 5,
                    completedSteps: 0,
                    lastUpdated: new Date()
                },
                integration: {
                    triggeredBy: fineTuneJob ? 'fine-tune-completion' : 'manual',
                    parentJobId: fineTuneJob ? fineTuneJob._id?.toString() : undefined,
                    childEvaluations: []
                }
            });

            const savedJob = await evaluationJob.save();

            // Link to fine-tune job if exists
            if (fineTuneJob) {
                fineTuneJob.evaluationIds.push(savedJob._id?.toString() || savedJob.id);
                await fineTuneJob.save();
            }

            logger.info(`Created evaluation job: ${savedJob.name} for user ${userId}`);

            // Queue the evaluation for execution
            await this.queueEvaluationExecution(savedJob._id?.toString() || savedJob.id);

            return savedJob;
        } catch (error) {
            logger.error('Error creating evaluation job:', error);
            throw error;
        }
    }

    /**
     * Get all evaluation jobs for a user
     */
    static async getUserEvaluationJobs(userId: string): Promise<IEvaluationJob[]> {
        try {
            return await EvaluationJob.find({
                userId: new mongoose.Types.ObjectId(userId)
            })
            .populate('fineTuneJobId', 'name status')
            .populate('datasetId', 'name version')
            .sort({ createdAt: -1 });
        } catch (error) {
            logger.error('Error getting user evaluation jobs:', error);
            throw error;
        }
    }

    /**
     * Get evaluation jobs for a specific fine-tune job
     */
    static async getEvaluationsByFineTuneJob(userId: string, fineTuneJobId: string): Promise<IEvaluationJob[]> {
        try {
            return await EvaluationJob.find({
                userId: new mongoose.Types.ObjectId(userId),
                fineTuneJobId: new mongoose.Types.ObjectId(fineTuneJobId)
            })
            .populate('datasetId', 'name version')
            .sort({ createdAt: -1 });
        } catch (error) {
            logger.error('Error getting evaluations by fine-tune job:', error);
            throw error;
        }
    }

    /**
     * Get a specific evaluation job
     */
    static async getEvaluationJob(userId: string, jobId: string): Promise<IEvaluationJob | null> {
        try {
            return await EvaluationJob.findOne({
                _id: new mongoose.Types.ObjectId(jobId),
                userId: new mongoose.Types.ObjectId(userId)
            })
            .populate('fineTuneJobId', 'name status baseModel provider')
            .populate('datasetId', 'name version items stats');
        } catch (error) {
            logger.error('Error getting evaluation job:', error);
            throw error;
        }
    }

    /**
     * Execute evaluation job
     */
    static async executeEvaluationJob(jobId: string): Promise<void> {
        try {
            const job = await EvaluationJob.findById(jobId).populate('datasetId');
            if (!job) {
                throw new Error('Evaluation job not found');
            }

            if (job.status !== 'queued') {
                logger.warn(`Job ${jobId} is not in queued state: ${job.status}`);
                return;
            }

            // Update status to running
            job.status = 'running';
            job.timing.startedAt = new Date();
            job.progress.currentStep = 'Preparing evaluation data';
            job.progress.percentage = 10;
            await job.save();

            // Execute evaluation based on type
            await this.runEvaluation(job);

        } catch (error) {
            logger.error(`Error executing evaluation job ${jobId}:`, error);
            
            // Update job with error
            await EvaluationJob.findByIdAndUpdate(jobId, {
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
     * Run the actual evaluation
     */
    private static async runEvaluation(job: IEvaluationJob): Promise<void> {
        const dataset = job.datasetId as any;
        
        // Step 1: Prepare test data
        job.progress.currentStep = 'Preparing test data';
        job.progress.percentage = 20;
        await job.save();

        const testItems = dataset.items.filter((item: any) => item.split === 'test');
        if (testItems.length === 0) {
            throw new Error('No test data available in dataset');
        }

        // Step 2: Run model predictions
        job.progress.currentStep = 'Running model predictions';
        job.progress.percentage = 40;
        await job.save();

        const predictions = await this.generatePredictions(job.modelId, testItems);

        // Step 3: Calculate metrics
        job.progress.currentStep = 'Calculating metrics';
        job.progress.percentage = 60;
        await job.save();

        const metrics = await this.calculateMetrics(testItems, predictions, job.metrics);

        // Step 4: Analyze quality
        job.progress.currentStep = 'Analyzing quality';
        job.progress.percentage = 80;
        await job.save();

        const qualityAnalysis = await this.analyzeQuality(testItems, predictions);

        // Step 5: Generate final results
        job.progress.currentStep = 'Generating final results';
        job.progress.percentage = 90;
        await job.save();

        const overallScore = this.calculateOverallScore(metrics, qualityAnalysis);
        const costAnalysis = this.calculateCostAnalysis(testItems, predictions);
        const recommendations = this.generateRecommendations(metrics, qualityAnalysis, costAnalysis);

        // Complete the job
        job.status = 'completed';
        job.results.overallScore = overallScore;
        job.results.metrics = metrics;
        job.results.costAnalysis = costAnalysis;
        job.results.qualityAnalysis = qualityAnalysis;
        job.results.recommendations = recommendations;
        job.progress.percentage = 100;
        job.progress.currentStep = 'Completed';
        job.timing.completedAt = new Date();
        
        // Calculate actual duration
        if (job.timing.startedAt) {
            job.timing.actualDuration = Math.floor(
                (job.timing.completedAt.getTime() - job.timing.startedAt.getTime()) / 1000
            );
        }
        
        await job.save();

        logger.info(`Completed evaluation job: ${job.name}`);
    }

    /**
     * Generate predictions using the model
     */
    private static async generatePredictions(modelId: string, testItems: any[]): Promise<string[]> {
        const predictions: string[] = [];

        for (const item of testItems) {
            try {
                // For demo purposes, generate AI predictions using Bedrock
                const prompt = `Given the input: "${item.input}", provide a response:`;
                
                const response = await retryBedrockOperation(async () => {
                    const command = new InvokeModelCommand({
                        modelId: modelId || process.env.AWS_BEDROCK_MODEL_ID ,
                        body: JSON.stringify({
                            anthropic_version: "bedrock-2023-05-31",
                            max_tokens: 200,
                            messages: [{ role: "user", content: prompt }]
                        }),
                        contentType: 'application/json'
                    });
                    return this.bedrockClient.send(command);
                });

                const responseBody = JSON.parse(new TextDecoder().decode(response.body));
                predictions.push(responseBody.content[0].text);

            } catch (error) {
                logger.warn(`Failed to generate prediction for item ${item.requestId}:`, error);
                predictions.push(''); // Empty prediction for failed cases
            }
        }

        return predictions;
    }

    /**
     * Calculate evaluation metrics
     */
    private static async calculateMetrics(testItems: any[], predictions: string[], metricNames: string[]): Promise<Record<string, number>> {
        const metrics: Record<string, number> = {};

        for (const metricName of metricNames) {
            switch (metricName) {
                case 'accuracy':
                    metrics.accuracy = this.calculateAccuracy(testItems, predictions);
                    break;
                case 'bleu':
                    metrics.bleu = this.calculateBLEU(testItems, predictions);
                    break;
                case 'rouge':
                    metrics.rouge = this.calculateROUGE(testItems, predictions);
                    break;
                case 'cost-per-token':
                    metrics.costPerToken = this.calculateCostPerToken(predictions);
                    break;
                default:
                    metrics[metricName] = Math.random() * 100; // Demo metric
            }
        }

        return metrics;
    }

    /**
     * Analyze response quality
     */
    private static async analyzeQuality(_testItems: any[], _predictions: string[]): Promise<IEvaluationJob['results']['qualityAnalysis']> {
        // For demo purposes, generate quality scores
        // In production, use more sophisticated analysis
        
        return {
            humanLikenessScore: 70 + Math.random() * 20, // 70-90
            coherenceScore: 75 + Math.random() * 20,     // 75-95
            relevanceScore: 65 + Math.random() * 25,     // 65-90
            safetyScore: 85 + Math.random() * 15         // 85-100
        };
    }

    /**
     * Calculate overall performance score
     */
    private static calculateOverallScore(metrics: Record<string, number>, quality: any): number {
        const metricAverage = Object.values(metrics).reduce((a, b) => a + b, 0) / Object.values(metrics).length;
        const qualityAverage = (quality.humanLikenessScore + quality.coherenceScore + quality.relevanceScore + quality.safetyScore) / 4;
        
        return (metricAverage + qualityAverage) / 2;
    }

    /**
     * Calculate cost analysis
     */
    private static calculateCostAnalysis(testItems: any[], predictions: string[]): IEvaluationJob['results']['costAnalysis'] {
        const totalTokens = predictions.reduce((sum, pred) => sum + pred.length / 4, 0); // Rough token estimate
        const totalCost = totalTokens * 0.00001; // $0.01 per 1K tokens
        
        return {
            averageCostPerRequest: totalCost / testItems.length,
            totalEvaluationCost: totalCost,
            costEfficiencyScore: Math.max(0, 100 - (totalCost * 1000)) // Lower cost = higher score
        };
    }

    /**
     * Generate recommendations based on results
     */
    private static generateRecommendations(metrics: Record<string, number>, quality: any, cost: any): string[] {
        const recommendations: string[] = [];

        // Metric-based recommendations
        if (metrics.accuracy && metrics.accuracy < 70) {
            recommendations.push('Consider additional training data or hyperparameter tuning to improve accuracy');
        }

        if (metrics.bleu && metrics.bleu < 0.3) {
            recommendations.push('BLEU score suggests room for improvement in text generation quality');
        }

        // Quality-based recommendations
        if (quality.humanLikenessScore < 70) {
            recommendations.push('Responses may benefit from more natural language patterns in training data');
        }

        if (quality.relevanceScore < 70) {
            recommendations.push('Consider fine-tuning with more task-specific examples to improve relevance');
        }

        // Cost-based recommendations
        if (cost.costEfficiencyScore < 50) {
            recommendations.push('High cost per request - consider optimizing model size or using a more efficient architecture');
        }

        if (recommendations.length === 0) {
            recommendations.push('Model performance is satisfactory across all evaluated metrics');
        }

        return recommendations;
    }

    // Simplified metric calculations for demo
    private static calculateAccuracy(testItems: any[], predictions: string[]): number {
        let correct = 0;
        for (let i = 0; i < testItems.length; i++) {
            if (testItems[i].expectedOutput && predictions[i]) {
                // Simple similarity check
                const similarity = this.calculateSimilarity(testItems[i].expectedOutput, predictions[i]);
                if (similarity > 0.7) correct++;
            }
        }
        return (correct / testItems.length) * 100;
    }

    private static calculateBLEU(_testItems: any[], _predictions: string[]): number {
        // Simplified BLEU calculation
        return 0.4 + Math.random() * 0.4; // Demo: 0.4-0.8
    }

    private static calculateROUGE(_testItems: any[], _predictions: string[]): number {
        // Simplified ROUGE calculation
        return 0.3 + Math.random() * 0.5; // Demo: 0.3-0.8
    }

    private static calculateCostPerToken(predictions: string[]): number {
        const totalTokens = predictions.reduce((sum, pred) => sum + pred.length / 4, 0);
        return totalTokens > 0 ? 0.00001 : 0; // $0.01 per 1K tokens
    }

    private static calculateSimilarity(str1: string, str2: string): number {
        // Simple similarity based on word overlap
        const words1 = str1.toLowerCase().split(' ');
        const words2 = str2.toLowerCase().split(' ');
        const overlap = words1.filter(word => words2.includes(word)).length;
        return overlap / Math.max(words1.length, words2.length);
    }

    /**
     * Estimate evaluation cost
     */
    private static async estimateEvaluationCost(evaluationType: string, itemCount: number): Promise<number> {
        const baseCostPerItem = 0.01; // $0.01 per item
        
        const multipliers = {
            'accuracy': 1.0,
            'quality': 1.5,
            'cost-effectiveness': 1.2,
            'comprehensive': 2.0
        };

        const multiplier = multipliers[evaluationType as keyof typeof multipliers] || 1.0;
        return itemCount * baseCostPerItem * multiplier;
    }

    /**
     * Queue evaluation for execution
     */
    private static async queueEvaluationExecution(jobId: string): Promise<void> {
        // In production, add to queue (Redis, SQS, etc.)
        setTimeout(() => {
            this.executeEvaluationJob(jobId).catch(error => {
                logger.error(`Failed to execute queued evaluation ${jobId}:`, error);
            });
        }, 3000); // 3 second delay
    }

    /**
     * Auto-trigger evaluation when fine-tune job completes
     */
    static async triggerEvaluationOnFineTuneCompletion(fineTuneJobId: string): Promise<void> {
        try {
            const fineTuneJob = await FineTuneJob.findById(fineTuneJobId).populate('datasetId');
            if (!fineTuneJob || fineTuneJob.status !== 'succeeded') {
                return;
            }

            const dataset = fineTuneJob.datasetId as any;
            if (!dataset) {
                logger.warn(`No dataset found for fine-tune job ${fineTuneJobId}`);
                return;
            }

            // Create automatic evaluation
            const evaluationData: CreateEvaluationJobData = {
                name: `Auto-Eval: ${fineTuneJob.name}`,
                description: `Automatic evaluation triggered by fine-tune job completion`,
                fineTuneJobId: fineTuneJobId,
                modelId: fineTuneJob.results?.modelId || fineTuneJob.providerJobId || 'unknown',
                datasetId: dataset._id.toString(),
                datasetVersion: dataset.version,
                evaluationType: 'comprehensive',
                metrics: ['accuracy', 'bleu', 'cost-per-token']
            };

            await this.createEvaluationJob(fineTuneJob.userId.toString(), evaluationData);
            logger.info(`Auto-triggered evaluation for fine-tune job: ${fineTuneJobId}`);

        } catch (error) {
            logger.error(`Error auto-triggering evaluation for fine-tune job ${fineTuneJobId}:`, error);
        }
    }

    /**
     * Delete an evaluation job
     */
    static async deleteEvaluationJob(userId: string, jobId: string): Promise<boolean> {
        try {
            const result = await EvaluationJob.deleteOne({
                _id: new mongoose.Types.ObjectId(jobId),
                userId: new mongoose.Types.ObjectId(userId)
            });

            logger.info(`Deleted evaluation job ${jobId} for user ${userId}`);
            return result.deletedCount > 0;
        } catch (error) {
            logger.error('Error deleting evaluation job:', error);
            throw error;
        }
    }
}
