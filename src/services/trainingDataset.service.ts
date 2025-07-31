import { TrainingDataset, ITrainingDataset } from '../models/TrainingDataset';
import { RequestScore } from '../models/RequestScore';
import { Usage } from '../models/Usage';
import { logger } from '../utils/logger';
import mongoose from 'mongoose';

export interface CreateDatasetData {
    name: string;
    description?: string;
    targetUseCase: string;
    targetModel: string;
    minScore?: number;
    maxTokens?: number;
    maxCost?: number;
    filters?: {
        dateRange?: { start: Date; end: Date };
        providers?: string[];
        models?: string[];
        features?: string[];
        costRange?: { min: number; max: number };
        tokenRange?: { min: number; max: number };
    };
}

export interface DatasetExportFormat {
    format: 'openai-jsonl' | 'anthropic-jsonl' | 'huggingface-jsonl' | 'custom';
    includeMetadata?: boolean;
    customTemplate?: string;
}

export class TrainingDatasetService {
    /**
     * Create a new training dataset
     */
    static async createDataset(userId: string, datasetData: CreateDatasetData): Promise<ITrainingDataset> {
        try {
            const dataset = new TrainingDataset({
                ...datasetData,
                userId: new mongoose.Types.ObjectId(userId),
                minScore: datasetData.minScore || 4,
                requestIds: [],
                stats: {
                    totalRequests: 0,
                    averageScore: 0,
                    totalTokens: 0,
                    totalCost: 0,
                    averageTokensPerRequest: 0,
                    averageCostPerRequest: 0,
                    providerBreakdown: {},
                    modelBreakdown: {}
                },
                status: 'draft'
            });

            const savedDataset = await dataset.save();
            logger.info(`Created training dataset: ${savedDataset.name} for user ${userId}`);
            
            return savedDataset;
        } catch (error) {
            logger.error('Error creating training dataset:', error);
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
            logger.error('Error getting user datasets:', error);
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
            logger.error('Error getting dataset:', error);
            throw error;
        }
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

            // Update dataset with selected requests
            dataset.requestIds = validRequestIds;
            dataset.status = 'ready';

            // Calculate statistics
            await this.calculateDatasetStats(dataset, usageRecords, scores);

            const updatedDataset = await dataset.save();
            logger.info(`Populated dataset ${datasetId} with ${validRequestIds.length} requests`);

            return updatedDataset;
        } catch (error) {
            logger.error('Error populating dataset:', error);
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
            logger.info(`Added ${newRequestIds.length} requests to dataset ${datasetId}`);

            return updatedDataset;
        } catch (error) {
            logger.error('Error adding requests to dataset:', error);
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
            logger.info(`Removed ${requestIds.length} requests from dataset ${datasetId}`);

            return updatedDataset;
        } catch (error) {
            logger.error('Error removing requests from dataset:', error);
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

            logger.info(`Exported dataset ${datasetId} in ${exportFormat.format} format`);

            return {
                data: exportData,
                filename,
                contentType
            };
        } catch (error) {
            logger.error('Error exporting dataset:', error);
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

            logger.info(`Deleted dataset ${datasetId} for user ${userId}`);
            return result.deletedCount > 0;
        } catch (error) {
            logger.error('Error deleting dataset:', error);
            throw error;
        }
    }

    /**
     * Calculate dataset statistics
     */
    private static async calculateDatasetStats(
        dataset: ITrainingDataset, 
        usageRecords: any[], 
        scores: any[]
    ): Promise<void> {
        const scoreMap = new Map(scores.map(score => [score.requestId, score]));

        const totalRequests = usageRecords.length;
        const totalTokens = usageRecords.reduce((sum, usage) => sum + usage.totalTokens, 0);
        const totalCost = usageRecords.reduce((sum, usage) => sum + usage.cost, 0);
        
        const validScores = usageRecords
            .map(usage => scoreMap.get(usage.metadata?.requestId)?.score)
            .filter(Boolean);
        const averageScore = validScores.length > 0 
            ? validScores.reduce((sum, score) => sum + score, 0) / validScores.length 
            : 0;

        // Provider and model breakdowns
        const providerBreakdown: Record<string, number> = {};
        const modelBreakdown: Record<string, number> = {};

        usageRecords.forEach(usage => {
            providerBreakdown[usage.service] = (providerBreakdown[usage.service] || 0) + 1;
            modelBreakdown[usage.model] = (modelBreakdown[usage.model] || 0) + 1;
        });

        dataset.stats = {
            totalRequests,
            averageScore,
            totalTokens,
            totalCost,
            averageTokensPerRequest: totalRequests > 0 ? totalTokens / totalRequests : 0,
            averageCostPerRequest: totalRequests > 0 ? totalCost / totalRequests : 0,
            providerBreakdown,
            modelBreakdown
        };
    }

    /**
     * Recalculate dataset statistics
     */
    private static async recalculateDatasetStats(dataset: ITrainingDataset): Promise<void> {
        if (dataset.requestIds.length === 0) {
            dataset.stats = {
                totalRequests: 0,
                averageScore: 0,
                totalTokens: 0,
                totalCost: 0,
                averageTokensPerRequest: 0,
                averageCostPerRequest: 0,
                providerBreakdown: {},
                modelBreakdown: {}
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
}