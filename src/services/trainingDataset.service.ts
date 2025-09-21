import { TrainingDataset, ITrainingDataset } from '../models/TrainingDataset';
import { RequestScore } from '../models/RequestScore';
import { Usage } from '../models/Usage';
import { loggingService } from './logging.service';
import { PIIDetectionService } from './piiDetection.service';
import mongoose from 'mongoose';

export interface CreateDatasetData {
    name: string;
    description?: string;
    targetUseCase: string;
    targetModel: string;
    minScore?: number;
    maxTokens?: number;
    maxCost?: number;
    version?: string;
    parentDatasetId?: string;
    versionNotes?: string;
    filters?: {
        dateRange?: { start: Date; end: Date };
        providers?: string[];
        models?: string[];
        features?: string[];
        costRange?: { min: number; max: number };
        tokenRange?: { min: number; max: number };
    };
    splitConfig?: {
        trainPercentage?: number;
        devPercentage?: number;
        testPercentage?: number;
    };
}

export interface DatasetExportFormat {
    format: 'openai-jsonl' | 'anthropic-jsonl' | 'huggingface-jsonl' | 'custom';
    includeMetadata?: boolean;
    customTemplate?: string;
}

export class TrainingDatasetService {
    // Circuit breaker for database operations
    private static dbFailureCount: number = 0;
    private static readonly MAX_DB_FAILURES = 5;
    private static readonly CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minutes
    private static lastDbFailureTime: number = 0;
    
    // Batch processing configuration
    private static readonly PII_BATCH_SIZE = 10;
    private static readonly STATS_BATCH_SIZE = 100;
    /**
     * Create a new training dataset
     */
    static async createDataset(userId: string, datasetData: CreateDatasetData): Promise<ITrainingDataset> {
        try {
            // Handle versioning
            let version = datasetData.version || '1.0.0';
            let parentDatasetId = datasetData.parentDatasetId ? 
                new mongoose.Types.ObjectId(datasetData.parentDatasetId) : undefined;

            // If creating a new version, validate parent exists
            if (parentDatasetId) {
                const parentDataset = await TrainingDataset.findOne({
                    _id: parentDatasetId,
                    userId: new mongoose.Types.ObjectId(userId)
                });
                if (!parentDataset) {
                    throw new Error('Parent dataset not found or access denied');
                }
            }

            // Configure splits
            const splitConfig = datasetData.splitConfig || {};
            const trainPercentage = splitConfig.trainPercentage || 80;
            const devPercentage = splitConfig.devPercentage || 10;
            const testPercentage = splitConfig.testPercentage || 10;

            // Validate split percentages
            if (trainPercentage + devPercentage + testPercentage !== 100) {
                throw new Error('Split percentages must sum to 100');
            }

            const dataset = new TrainingDataset({
                ...datasetData,
                userId: new mongoose.Types.ObjectId(userId),
                version,
                parentDatasetId,
                minScore: datasetData.minScore || 4,
                requestIds: [],
                items: [],
                splits: {
                    train: { percentage: trainPercentage, count: 0, itemIds: [] },
                    dev: { percentage: devPercentage, count: 0, itemIds: [] },
                    test: { percentage: testPercentage, count: 0, itemIds: [] }
                },
                stats: {
                    totalRequests: 0,
                    averageScore: 0,
                    totalTokens: 0,
                    totalCost: 0,
                    averageTokensPerRequest: 0,
                    averageCostPerRequest: 0,
                    providerBreakdown: {},
                    modelBreakdown: {},
                    piiStats: {
                        totalWithPII: 0,
                        piiTypeBreakdown: {}
                    }
                },
                lineage: {
                    derivedDatasets: [],
                    relatedFineTuneJobs: []
                },
                status: 'draft'
            });

            const savedDataset = await dataset.save();

            // Update parent dataset's lineage if this is a new version
            if (parentDatasetId) {
                await TrainingDataset.findByIdAndUpdate(parentDatasetId, {
                    $push: { 'lineage.derivedDatasets': (savedDataset._id as any).toString() }
                });
            }

            loggingService.info(`Created training dataset: ${savedDataset.name} v${version} for user ${userId}`);
            
            return savedDataset;
        } catch (error) {
            loggingService.error('Error creating training dataset:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get all datasets for a user
     */
    static async getUserDatasets(userId: string): Promise<ITrainingDataset[]> {
        try {
            return await TrainingDataset.find({
                userId: new mongoose.Types.ObjectId(userId)
            }).sort({ updatedAt: -1 });
        } catch (error) {
            loggingService.error('Error getting user datasets:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get a specific dataset
     */
    static async getDataset(userId: string, datasetId: string): Promise<ITrainingDataset | null> {
        try {
            return await TrainingDataset.findOne({
                _id: new mongoose.Types.ObjectId(datasetId),
                userId: new mongoose.Types.ObjectId(userId)
            });
        } catch (error) {
            loggingService.error('Error getting dataset:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Add items to dataset with ground truth labels and PII detection
     */
    static async addDatasetItems(
        userId: string, 
        datasetId: string, 
        items: Array<{
            requestId: string;
            input: string;
            expectedOutput?: string;
            criteria?: string[];
            tags?: string[];
        }>
    ): Promise<ITrainingDataset> {
        try {
            const dataset = await this.getDataset(userId, datasetId);
            if (!dataset) {
                throw new Error('Dataset not found');
            }

            loggingService.info(`Processing ${items.length} items for PII detection and validation`);

            // Check circuit breaker
            if (this.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            // Process items with batch PII detection for better performance
            const processedItems = [];
            const texts = items.map(item => item.input);
            
            // Use batch PII detection
            const batchPiiResults = await PIIDetectionService.detectPIIBatch(texts, true);
            
            // Create dataset items with PII results
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const piiResult = batchPiiResults.results[i];

                const datasetItem = {
                    requestId: item.requestId,
                    input: item.input,
                    expectedOutput: item.expectedOutput,
                    criteria: item.criteria || [],
                    tags: item.tags || [],
                    piiFlags: {
                        hasPII: piiResult.hasPII,
                        piiTypes: piiResult.piiTypes,
                        confidence: piiResult.confidence
                    },
                    metadata: {
                        piiDetectionResult: piiResult,
                        addedAt: new Date(),
                        riskLevel: piiResult.riskLevel
                    }
                };

                processedItems.push(datasetItem);
            }

            // Add items to dataset
            dataset.items.push(...processedItems);

            // Assign items to splits
            await this.assignItemsToSplits(dataset, processedItems);

            // Recalculate statistics
            await this.recalculateDatasetStats(dataset);

            const updatedDataset = await dataset.save();
            loggingService.info(`Added ${items.length} items to dataset ${datasetId}`);

            return updatedDataset;
        } catch (error) {
            loggingService.error('Error adding dataset items:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Create a new version of an existing dataset
     */
    static async createDatasetVersion(
        userId: string, 
        parentDatasetId: string, 
        versionData: {
            version: string;
            versionNotes?: string;
            description?: string;
        }
    ): Promise<ITrainingDataset> {
        try {
            const parentDataset = await this.getDataset(userId, parentDatasetId);
            if (!parentDataset) {
                throw new Error('Parent dataset not found');
            }

            // Create new dataset as a version
            const newDatasetData: CreateDatasetData = {
                name: parentDataset.name,
                description: versionData.description || parentDataset.description,
                targetUseCase: parentDataset.targetUseCase,
                targetModel: parentDataset.targetModel,
                version: versionData.version,
                parentDatasetId: parentDatasetId,
                versionNotes: versionData.versionNotes,
                minScore: parentDataset.minScore,
                maxTokens: parentDataset.maxTokens,
                maxCost: parentDataset.maxCost,
                filters: parentDataset.filters,
                splitConfig: {
                    trainPercentage: parentDataset.splits.train.percentage,
                    devPercentage: parentDataset.splits.dev.percentage,
                    testPercentage: parentDataset.splits.test.percentage
                }
            };

            return await this.createDataset(userId, newDatasetData);
        } catch (error) {
            loggingService.error('Error creating dataset version:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Assign items to train/dev/test splits (optimized)
     */
    private static async assignItemsToSplits(
        dataset: ITrainingDataset, 
        items: any[]
    ): Promise<void> {
        // Use optimized Fisher-Yates shuffle for better randomization
        const shuffledItems = this.shuffleArray(items);
        
        const totalItems = shuffledItems.length;
        const trainCount = Math.floor(totalItems * dataset.splits.train.percentage / 100);
        const devCount = Math.floor(totalItems * dataset.splits.dev.percentage / 100);

        // Assign splits
        shuffledItems.forEach((item, index) => {
            if (index < trainCount) {
                item.split = 'train';
                dataset.splits.train.itemIds.push(item.requestId);
            } else if (index < trainCount + devCount) {
                item.split = 'dev';
                dataset.splits.dev.itemIds.push(item.requestId);
            } else {
                item.split = 'test';
                dataset.splits.test.itemIds.push(item.requestId);
            }
        });

        // Update counts
        dataset.splits.train.count = dataset.splits.train.itemIds.length;
        dataset.splits.dev.count = dataset.splits.dev.itemIds.length;
        dataset.splits.test.count = dataset.splits.test.itemIds.length;
    }

    /**
     * Auto-populate dataset with high-scoring requests
     */
    static async populateDataset(userId: string, datasetId: string): Promise<ITrainingDataset> {
        try {
            const dataset = await this.getDataset(userId, datasetId);
            if (!dataset) {
                throw new Error('Dataset not found');
            }

            // Build query for finding suitable requests
            const scoreQuery: any = {
                userId: new mongoose.Types.ObjectId(userId),
                score: { $gte: dataset.minScore },
                isTrainingCandidate: true
            };

            // Get high-scoring requests
            const scores = await RequestScore.find(scoreQuery).sort({ score: -1, tokenEfficiency: -1 });
            const requestIds = scores.map(score => score.requestId);

            if (requestIds.length === 0) {
                throw new Error('No suitable requests found. Try lowering the minimum score or score more requests.');
            }

            // Build usage query with filters
            // Try both metadata.requestId and _id for compatibility
            const usageQuery: any = {
                $or: [
                    { 'metadata.requestId': { $in: requestIds } },
                    { _id: { $in: requestIds.map(id => new mongoose.Types.ObjectId(id)) } }
                ],
                userId: new mongoose.Types.ObjectId(userId)
            };

            // Apply dataset filters
            if (dataset.filters) {
                if (dataset.filters.dateRange) {
                    usageQuery.createdAt = {
                        $gte: dataset.filters.dateRange.start,
                        $lte: dataset.filters.dateRange.end
                    };
                }
                if (dataset.filters.providers && dataset.filters.providers.length > 0) {
                    usageQuery.service = { $in: dataset.filters.providers };
                }
                if (dataset.filters.models && dataset.filters.models.length > 0) {
                    usageQuery.model = { $in: dataset.filters.models };
                }
                if (dataset.filters.costRange) {
                    usageQuery.cost = {
                        $gte: dataset.filters.costRange.min,
                        $lte: dataset.filters.costRange.max
                    };
                }
                if (dataset.filters.tokenRange) {
                    usageQuery.totalTokens = {
                        $gte: dataset.filters.tokenRange.min,
                        $lte: dataset.filters.tokenRange.max
                    };
                }
                if (dataset.filters.features && dataset.filters.features.length > 0) {
                    const featureQueries = dataset.filters.features.map(feature => ({
                        [`metadata.CostKatana-Property-Feature`]: feature
                    }));
                    usageQuery.$or = featureQueries;
                }
            }

            // Apply dataset limits
            if (dataset.maxTokens) {
                usageQuery.totalTokens = { ...usageQuery.totalTokens, $lte: dataset.maxTokens };
            }
            if (dataset.maxCost) {
                usageQuery.cost = { ...usageQuery.cost, $lte: dataset.maxCost };
            }

            const usageRecords = await Usage.find(usageQuery);
            const validRequestIds = usageRecords
                .map(usage => usage.metadata?.requestId)
                .filter((id): id is string => Boolean(id));

            // Convert usage records to dataset items
            const datasetItems = await Promise.all(usageRecords.map(async (usage) => {
                const score = scores.find(s => s.requestId === usage.metadata?.requestId);
                
                // Run PII detection
                const piiResult = await PIIDetectionService.detectPII(usage.prompt, true);

                return {
                    requestId: usage.metadata?.requestId || usage._id.toString(),
                    input: usage.prompt,
                    expectedOutput: usage.completion || '',
                    criteria: [],
                    tags: [],
                    piiFlags: {
                        hasPII: piiResult.hasPII,
                        piiTypes: piiResult.piiTypes,
                        confidence: piiResult.confidence
                    },
                    metadata: {
                        originalUsageId: usage._id.toString(),
                        score: score?.score,
                        piiDetectionResult: piiResult,
                        addedAt: new Date(),
                        riskLevel: piiResult.riskLevel
                    }
                };
            }));

            // Add items to dataset
            dataset.items = datasetItems;
            dataset.requestIds = validRequestIds;
            dataset.status = 'ready';

            // Assign items to splits
            await this.assignItemsToSplits(dataset, datasetItems);

            // Calculate statistics
            await this.calculateDatasetStats(dataset, usageRecords, scores);

            const updatedDataset = await dataset.save();
            loggingService.info(`Populated dataset ${datasetId} with ${validRequestIds.length} requests`);

            return updatedDataset;
        } catch (error) {
            loggingService.error('Error populating dataset:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Add requests to dataset manually
     */
    static async addRequestsToDataset(
        userId: string, 
        datasetId: string, 
        requestIds: string[]
    ): Promise<ITrainingDataset> {
        try {
            const dataset = await this.getDataset(userId, datasetId);
            if (!dataset) {
                throw new Error('Dataset not found');
            }

            // Add new request IDs (avoid duplicates)
            const newRequestIds = requestIds.filter(id => !dataset.requestIds.includes(id));
            dataset.requestIds.push(...newRequestIds);

            // Recalculate stats
            await this.recalculateDatasetStats(dataset);

            const updatedDataset = await dataset.save();
            loggingService.info(`Added ${newRequestIds.length} requests to dataset ${datasetId}`);

            return updatedDataset;
        } catch (error) {
            loggingService.error('Error adding requests to dataset:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Remove requests from dataset
     */
    static async removeRequestsFromDataset(
        userId: string, 
        datasetId: string, 
        requestIds: string[]
    ): Promise<ITrainingDataset> {
        try {
            const dataset = await this.getDataset(userId, datasetId);
            if (!dataset) {
                throw new Error('Dataset not found');
            }

            // Remove request IDs
            dataset.requestIds = dataset.requestIds.filter(id => !requestIds.includes(id));

            // Recalculate stats
            await this.recalculateDatasetStats(dataset);

            const updatedDataset = await dataset.save();
            loggingService.info(`Removed ${requestIds.length} requests from dataset ${datasetId}`);

            return updatedDataset;
        } catch (error) {
            loggingService.error('Error removing requests from dataset:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Export dataset in specified format
     */
    static async exportDataset(
        userId: string, 
        datasetId: string, 
        exportFormat: DatasetExportFormat
    ): Promise<{ data: string; filename: string; contentType: string }> {
        try {
            const dataset = await this.getDataset(userId, datasetId);
            if (!dataset) {
                throw new Error('Dataset not found');
            }

            if (dataset.requestIds.length === 0) {
                throw new Error('Dataset is empty. Add some requests first.');
            }

            // Get usage records and scores
            const usageRecords = await Usage.find({
                'metadata.requestId': { $in: dataset.requestIds },
                userId: new mongoose.Types.ObjectId(userId)
            });

            const scores = await RequestScore.find({
                requestId: { $in: dataset.requestIds },
                userId: new mongoose.Types.ObjectId(userId)
            });

            // Create lookup maps
            const scoreMap = new Map(scores.map(score => [score.requestId, score]));

            // Generate export data based on format
            let exportData: string;
            let filename: string;
            let contentType: string;

            switch (exportFormat.format) {
                case 'openai-jsonl':
                    exportData = this.generateOpenAIJSONL(usageRecords, scoreMap, exportFormat.includeMetadata);
                    filename = `${dataset.name.replace(/[^a-zA-Z0-9]/g, '_')}_openai_training.jsonl`;
                    contentType = 'application/jsonl';
                    break;

                case 'anthropic-jsonl':
                    exportData = this.generateAnthropicJSONL(usageRecords, scoreMap, exportFormat.includeMetadata);
                    filename = `${dataset.name.replace(/[^a-zA-Z0-9]/g, '_')}_anthropic_training.jsonl`;
                    contentType = 'application/jsonl';
                    break;

                case 'huggingface-jsonl':
                    exportData = this.generateHuggingFaceJSONL(usageRecords, scoreMap, exportFormat.includeMetadata);
                    filename = `${dataset.name.replace(/[^a-zA-Z0-9]/g, '_')}_hf_training.jsonl`;
                    contentType = 'application/jsonl';
                    break;

                case 'custom':
                    exportData = this.generateCustomFormat(usageRecords, scoreMap, exportFormat.customTemplate);
                    filename = `${dataset.name.replace(/[^a-zA-Z0-9]/g, '_')}_custom.json`;
                    contentType = 'application/json';
                    break;

                default:
                    throw new Error('Unsupported export format');
            }

            // Update dataset export info
            dataset.lastExportedAt = new Date();
            dataset.exportCount += 1;
            dataset.status = 'exported';
            await dataset.save();

            loggingService.info(`Exported dataset ${datasetId} in ${exportFormat.format} format`);

            return {
                data: exportData,
                filename,
                contentType
            };
        } catch (error) {
            loggingService.error('Error exporting dataset:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Delete a dataset
     */
    static async deleteDataset(userId: string, datasetId: string): Promise<boolean> {
        try {
            const result = await TrainingDataset.deleteOne({
                _id: new mongoose.Types.ObjectId(datasetId),
                userId: new mongoose.Types.ObjectId(userId)
            });

            loggingService.info(`Deleted dataset ${datasetId} for user ${userId}`);
            return result.deletedCount > 0;
        } catch (error) {
            loggingService.error('Error deleting dataset:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Calculate dataset statistics using optimized aggregation
     */
    private static async calculateDatasetStats(
        dataset: ITrainingDataset, 
        usageRecords: any[], 
        scores: any[]
    ): Promise<void> {
        // Check circuit breaker
        if (this.isDbCircuitBreakerOpen()) {
            throw new Error('Database circuit breaker is open');
        }

        try {
            // Use MongoDB aggregation for usage statistics
            const requestIds = dataset.requestIds;
            if (requestIds.length === 0) {
                dataset.stats = this.getEmptyStats();
                return;
            }

            const [usageStats, scoreStats] = await Promise.all([
                Usage.aggregate([
                    { $match: { 'metadata.requestId': { $in: requestIds } } },
                    {
                        $group: {
                            _id: null,
                            totalRequests: { $sum: 1 },
                            totalTokens: { $sum: '$totalTokens' },
                            totalCost: { $sum: '$cost' },
                            providerBreakdown: {
                                $push: { service: '$service', model: '$model' }
                            }
                        }
                    }
                ]),
                RequestScore.aggregate([
                    { $match: { requestId: { $in: requestIds } } },
                    {
                        $group: {
                            _id: null,
                            averageScore: { $avg: '$score' },
                            totalScores: { $sum: 1 }
                        }
                    }
                ])
            ]);

            // Process aggregation results
            const usageResult = usageStats[0] || {};
            const scoreResult = scoreStats[0] || {};

            // Calculate provider and model breakdowns
            const providerBreakdown: Record<string, number> = {};
            const modelBreakdown: Record<string, number> = {};
            
            (usageResult.providerBreakdown || []).forEach((item: any) => {
                providerBreakdown[item.service] = (providerBreakdown[item.service] || 0) + 1;
                modelBreakdown[item.model] = (modelBreakdown[item.model] || 0) + 1;
            });

            // Calculate PII statistics efficiently
            const piiStats = this.calculatePiiStats(dataset.items);

            const totalRequests = usageResult.totalRequests || 0;
            const totalTokens = usageResult.totalTokens || 0;
            const totalCost = usageResult.totalCost || 0;

            dataset.stats = {
                totalRequests,
                averageScore: scoreResult.averageScore || 0,
                totalTokens,
                totalCost,
                averageTokensPerRequest: totalRequests > 0 ? totalTokens / totalRequests : 0,
                averageCostPerRequest: totalRequests > 0 ? totalCost / totalRequests : 0,
                providerBreakdown,
                modelBreakdown,
                piiStats
            };

            // Reset failure count on success
            this.dbFailureCount = 0;
        } catch (error) {
            this.recordDbFailure();
            loggingService.error('Error calculating dataset stats:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Recalculate dataset statistics
     */
    private static async recalculateDatasetStats(dataset: ITrainingDataset): Promise<void> {
        if (dataset.items.length === 0) {
            dataset.stats = {
                totalRequests: 0,
                averageScore: 0,
                totalTokens: 0,
                totalCost: 0,
                averageTokensPerRequest: 0,
                averageCostPerRequest: 0,
                providerBreakdown: {},
                modelBreakdown: {},
                piiStats: {
                    totalWithPII: 0,
                    piiTypeBreakdown: {}
                }
            };
            return;
        }

        const usageRecords = await Usage.find({
            'metadata.requestId': { $in: dataset.requestIds }
        });

        const scores = await RequestScore.find({
            requestId: { $in: dataset.requestIds }
        });

        await this.calculateDatasetStats(dataset, usageRecords, scores);
    }

    /**
     * Generate OpenAI JSONL format
     */
    private static generateOpenAIJSONL(usageRecords: any[], scoreMap: Map<string, any>, includeMetadata = false): string {
        const lines = usageRecords.map(usage => {
            const score = scoreMap.get(usage.metadata?.requestId);
            
            const trainingExample = {
                messages: [
                    {
                        role: "user",
                        content: usage.prompt
                    },
                    {
                        role: "assistant", 
                        content: usage.completion || ""
                    }
                ]
            };

            if (includeMetadata) {
                (trainingExample as any).metadata = {
                    requestId: usage.metadata?.requestId,
                    score: score?.score,
                    cost: usage.cost,
                    tokens: usage.totalTokens,
                    model: usage.model,
                    provider: usage.service
                };
            }

            return JSON.stringify(trainingExample);
        });

        return lines.join('\n');
    }

    /**
     * Generate Anthropic JSONL format
     */
    private static generateAnthropicJSONL(usageRecords: any[], scoreMap: Map<string, any>, includeMetadata = false): string {
        const lines = usageRecords.map(usage => {
            const score = scoreMap.get(usage.metadata?.requestId);
            
            const trainingExample = {
                prompt: `Human: ${usage.prompt}\n\nAssistant:`,
                completion: ` ${usage.completion || ""}`
            };

            if (includeMetadata) {
                (trainingExample as any).metadata = {
                    requestId: usage.metadata?.requestId,
                    score: score?.score,
                    cost: usage.cost,
                    tokens: usage.totalTokens
                };
            }

            return JSON.stringify(trainingExample);
        });

        return lines.join('\n');
    }

    /**
     * Generate HuggingFace JSONL format
     */
    private static generateHuggingFaceJSONL(usageRecords: any[], scoreMap: Map<string, any>, includeMetadata = false): string {
        const lines = usageRecords.map(usage => {
            const score = scoreMap.get(usage.metadata?.requestId);
            
            const trainingExample = {
                text: `<|user|>${usage.prompt}<|assistant|>${usage.completion || ""}<|end|>`,
                input: usage.prompt,
                output: usage.completion || ""
            };

            if (includeMetadata) {
                (trainingExample as any).metadata = {
                    requestId: usage.metadata?.requestId,
                    score: score?.score,
                    cost: usage.cost,
                    tokens: usage.totalTokens
                };
            }

            return JSON.stringify(trainingExample);
        });

        return lines.join('\n');
    }

    /**
     * Generate custom format
     */
    private static generateCustomFormat(usageRecords: any[], scoreMap: Map<string, any>, _template?: string): string {
        const data = usageRecords.map(usage => {
            const score = scoreMap.get(usage.metadata?.requestId);
            return {
                requestId: usage.metadata?.requestId,
                prompt: usage.prompt,
                completion: usage.completion,
                score: score?.score,
                cost: usage.cost,
                tokens: usage.totalTokens,
                model: usage.model,
                provider: usage.service,
                timestamp: usage.createdAt
            };
        });

        return JSON.stringify(data, null, 2);
    }

    /**
     * Get empty statistics object
     */
    private static getEmptyStats() {
        return {
            totalRequests: 0,
            averageScore: 0,
            totalTokens: 0,
            totalCost: 0,
            averageTokensPerRequest: 0,
            averageCostPerRequest: 0,
            providerBreakdown: {},
            modelBreakdown: {},
            piiStats: {
                totalWithPII: 0,
                piiTypeBreakdown: {}
            }
        };
    }

    /**
     * Calculate PII statistics efficiently
     */
    private static calculatePiiStats(items: any[]) {
        const piiStats = {
            totalWithPII: 0,
            piiTypeBreakdown: {} as Record<string, number>
        };

        // Single pass calculation
        for (const item of items) {
            if (item.piiFlags?.hasPII) {
                piiStats.totalWithPII++;
                item.piiFlags.piiTypes.forEach((type: string) => {
                    piiStats.piiTypeBreakdown[type] = (piiStats.piiTypeBreakdown[type] || 0) + 1;
                });
            }
        }

        return piiStats;
    }

    /**
     * Optimized Fisher-Yates shuffle algorithm
     */
    private static shuffleArray<T>(array: T[]): T[] {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    /**
     * Circuit breaker utilities for database operations
     */
    private static isDbCircuitBreakerOpen(): boolean {
        if (this.dbFailureCount >= this.MAX_DB_FAILURES) {
            const timeSinceLastFailure = Date.now() - this.lastDbFailureTime;
            if (timeSinceLastFailure < this.CIRCUIT_BREAKER_RESET_TIME) {
                return true;
            } else {
                // Reset circuit breaker
                this.dbFailureCount = 0;
                return false;
            }
        }
        return false;
    }

    private static recordDbFailure(): void {
        this.dbFailureCount++;
        this.lastDbFailureTime = Date.now();
    }

    /**
     * Cleanup method for graceful shutdown
     */
    static cleanup(): void {
        // Reset circuit breaker state
        this.dbFailureCount = 0;
        this.lastDbFailureTime = 0;
    }
}