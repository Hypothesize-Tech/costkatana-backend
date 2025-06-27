import { Optimization, IOptimization } from '../models/Optimization';
import { Usage } from '../models/Usage';
import { User } from '../models/User';
import { Alert } from '../models/Alert';
import { BedrockService } from './bedrock.service';
import { logger } from '../utils/logger';
import { PaginationOptions, paginate } from '../utils/helpers';
import { AICostTrackerService } from './aiCostTracker.service';
import { AIProvider, CostEstimate } from 'ai-cost-tracker';
import mongoose from 'mongoose';

interface OptimizationRequest {
    userId: string;
    prompt: string;
    service: string;
    model: string;
    context?: string;
    options?: {
        targetReduction?: number;
        preserveIntent?: boolean;
        suggestAlternatives?: boolean;
    };
}

interface OptimizationFilters {
    userId?: string;
    applied?: boolean;
    category?: string;
    minSavings?: number;
    startDate?: Date;
    endDate?: Date;
}

export class OptimizationService {
    // Helper to get the tracker instance
    private static async getTracker() {
        return await AICostTrackerService.getTracker();
    }

    // Helper to map string to AIProvider enum
    private static getAIProviderFromString(provider: string): AIProvider {
        switch (provider.toLowerCase()) {
            case 'openai':
                return AIProvider.OpenAI;
            case 'aws-bedrock':
            case 'awsbedrock':
                return AIProvider.AWSBedrock;
            case 'anthropic':
                return AIProvider.Anthropic;
            case 'google':
                return AIProvider.Google;
            case 'cohere':
                return AIProvider.Cohere;
            case 'azure':
            case 'azure-openai':
                return AIProvider.Azure;
            case 'deepseek':
                return AIProvider.DeepSeek;
            case 'groq':
                return AIProvider.Groq;
            case 'huggingface':
                return AIProvider.HuggingFace;
            case 'ollama':
                return AIProvider.Ollama;
            case 'replicate':
                return AIProvider.Replicate;
            default:
                throw new Error(`Unknown AI provider: ${provider}`);
        }
    }

    static async createOptimization(request: OptimizationRequest): Promise<IOptimization> {
        try {
            const tracker = await this.getTracker();

            // Get token count and cost for original prompt
            const originalEstimate: CostEstimate = await tracker.estimateCost(
                request.prompt,
                request.model,
                this.getAIProviderFromString(request.service)
            );

            // Use Bedrock to optimize the prompt (external service)
            const optimizationResult = await BedrockService.optimizePrompt({
                prompt: request.prompt,
                model: request.model,
                service: request.service,
                context: request.context,
                targetReduction: request.options?.targetReduction,
                preserveIntent: request.options?.preserveIntent,
            });

            // Get token count and cost for optimized prompt
            const optimizedEstimate: CostEstimate = await tracker.estimateCost(
                optimizationResult.optimizedPrompt,
                request.model,
                this.getAIProviderFromString(request.service)
            );

            // Calculate savings
            const originalTokens = (originalEstimate.breakdown?.promptTokens ?? 0) + (originalEstimate.breakdown?.completionTokens ?? 0);
            const optimizedTokens = (optimizedEstimate.breakdown?.promptTokens ?? 0) + (optimizedEstimate.breakdown?.completionTokens ?? 0);
            const tokensSaved = originalTokens - optimizedTokens;
            const costSaved = originalEstimate.totalCost - optimizedEstimate.totalCost;
            const improvementPercentage = originalTokens > 0 ? (tokensSaved / originalTokens) * 100 : 0;

            // Determine category based on optimization techniques
            const category = this.determineCategory(optimizationResult.techniques);

            // Create optimization record
            const optimization = await Optimization.create({
                userId: request.userId,
                originalPrompt: request.prompt,
                optimizedPrompt: optimizationResult.optimizedPrompt,
                optimizationTechniques: optimizationResult.techniques,
                originalTokens,
                optimizedTokens,
                tokensSaved,
                originalCost: originalEstimate.totalCost,
                optimizedCost: optimizedEstimate.totalCost,
                costSaved,
                improvementPercentage,
                service: request.service,
                model: request.model,
                category,
                suggestions: (optimizationResult.suggestions || []).map((suggestion: string, index: number) => ({
                    type: 'general',
                    description: suggestion,
                    impact: index === 0 ? 'high' : index < 3 ? 'medium' : 'low',
                    implemented: false,
                })),
                metadata: {
                    analysisTime: Date.now(),
                    confidence: 0.85,
                    alternatives: request.options?.suggestAlternatives
                        ? (optimizationResult.alternatives || []).map((alt: string) => ({
                            prompt: alt,
                            tokens: 0, // Will be calculated below
                            cost: 0,   // Will be calculated below
                        }))
                        : undefined,
                },
            });

            // If alternatives are present, estimate tokens and cost for each
            if (optimization.metadata?.alternatives) {
                for (const alt of optimization.metadata.alternatives) {
                    const altEstimate: CostEstimate = await tracker.estimateCost(
                        alt.prompt,
                        request.model,
                        this.getAIProviderFromString(request.service)
                    );
                    alt.tokens = (altEstimate.breakdown?.promptTokens ?? 0) + (altEstimate.breakdown?.completionTokens ?? 0);
                    alt.cost = altEstimate.totalCost;
                }
            }

            // Update user's optimization count
            await User.findByIdAndUpdate(request.userId, {
                $inc: {
                    'usage.currentMonth.optimizationsSaved': costSaved,
                },
            });

            // Create alert if significant savings
            if (improvementPercentage > 30) {
                await Alert.create({
                    userId: request.userId,
                    type: 'optimization_available',
                    title: 'Significant Optimization Available',
                    message: `You can save ${improvementPercentage.toFixed(1)}% on tokens for a frequently used prompt.`,
                    severity: 'medium',
                    data: {
                        optimizationId: optimization._id,
                        savings: costSaved,
                        percentage: improvementPercentage,
                    },
                });
            }

            logger.info('Optimization created', {
                userId: request.userId,
                originalTokens,
                optimizedTokens,
                savings: improvementPercentage,
            });

            return optimization;
        } catch (error) {
            logger.error('Error creating optimization:', error);
            throw error;
        }
    }

    static async getOptimizations(
        filters: OptimizationFilters,
        options: PaginationOptions
    ) {
        try {
            const query: any = {};

            if (filters.userId) query.userId = filters.userId;
            if (filters.applied !== undefined) query.applied = filters.applied;
            if (filters.category) query.category = filters.category;
            if (filters.minSavings !== undefined) query.costSaved = { $gte: filters.minSavings };
            if (filters.startDate || filters.endDate) {
                query.createdAt = {};
                if (filters.startDate) query.createdAt.$gte = filters.startDate;
                if (filters.endDate) query.createdAt.$lte = filters.endDate;
            }

            const page = options.page || 1;
            const limit = options.limit || 10;
            const skip = (page - 1) * limit;
            const sort: any = {};

            if (options.sort) {
                sort[options.sort] = options.order === 'asc' ? 1 : -1;
            } else {
                sort.costSaved = -1; // Default to highest savings first
            }

            const [data, total] = await Promise.all([
                Optimization.find(query)
                    .sort(sort)
                    .skip(skip)
                    .limit(limit)
                    .populate('userId', 'name email')
                    .lean(),
                Optimization.countDocuments(query),
            ]);

            return paginate(data, total, options);
        } catch (error) {
            logger.error('Error fetching optimizations:', error);
            throw error;
        }
    }

    static async applyOptimization(optimizationId: string, userId: string): Promise<void> {
        try {
            const optimization = await Optimization.findOne({
                _id: optimizationId,
                userId,
            });

            if (!optimization) {
                throw new Error('Optimization not found');
            }

            optimization.applied = true;
            optimization.appliedAt = new Date();
            optimization.appliedCount = (optimization.appliedCount || 0) + 1;
            await optimization.save();

            logger.info('Optimization applied', {
                optimizationId,
                userId,
            });
        } catch (error) {
            logger.error('Error applying optimization:', error);
            throw error;
        }
    }

    static async provideFeedback(
        optimizationId: string,
        userId: string,
        feedback: {
            helpful: boolean;
            rating?: number;
            comment?: string;
        }
    ): Promise<void> {
        try {
            const optimization = await Optimization.findOne({
                _id: optimizationId,
                userId,
            });

            if (!optimization) {
                throw new Error('Optimization not found');
            }

            optimization.feedback = {
                ...feedback,
                submittedAt: new Date(),
            };
            await optimization.save();

            logger.info('Optimization feedback provided', {
                optimizationId,
                helpful: feedback.helpful,
                rating: feedback.rating,
            });
        } catch (error) {
            logger.error('Error providing optimization feedback:', error);
            throw error;
        }
    }

    static async analyzeOptimizationOpportunities(userId: string) {
        try {
            const tracker = await this.getTracker();
            const suggestions = await tracker.getOptimizationSuggestions(undefined, undefined, userId);

            // Create alerts for top opportunities
            if (suggestions.length > 0) {
                const topOpportunity = suggestions[0];
                await Alert.create({
                    userId,
                    type: 'optimization_available',
                    title: 'Optimization Opportunities Found',
                    message: `You have ${suggestions.length} prompts that could be optimized. The top opportunity could save approximately ${topOpportunity.estimatedSavings.toFixed(2)}%.`,
                    severity: 'low',
                    data: {
                        opportunitiesCount: suggestions.length,
                        topOpportunity,
                    },
                });
            }

            return {
                opportunities: suggestions,
                totalPotentialSavings: suggestions.reduce((sum, s) => sum + s.estimatedSavings, 0),
            };
        } catch (error) {
            logger.error('Error analyzing optimization opportunities:', error);
            throw error;
        }
    }

    static async generateBulkOptimizations(userId: string, promptIds: string[]) {
        try {
            const prompts = await Usage.find({
                userId,
                _id: { $in: promptIds },
            }).select('prompt service model');

            const optimizations: IOptimization[] = [];

            for (const promptData of prompts) {
                try {
                    const optimization = await this.createOptimization({
                        userId,
                        prompt: promptData.prompt,
                        service: promptData.service,
                        model: promptData.model,
                    });
                    optimizations.push(optimization);
                } catch (error) {
                    logger.error(`Error optimizing prompt ${promptData._id}:`, error);
                }
            }

            return {
                total: promptIds.length,
                successful: optimizations.length,
                failed: promptIds.length - optimizations.length,
                optimizations,
            };
        } catch (error) {
            logger.error('Error generating bulk optimizations:', error);
            throw error;
        }
    }

    private static determineCategory(techniques: string[]): string {
        const techniqueMap: Record<string, string> = {
            'prompt reduction': 'prompt_reduction',
            'context optimization': 'context_optimization',
            'response formatting': 'response_formatting',
            'batch processing': 'batch_processing',
            'model selection': 'model_selection',
        };

        for (const technique of techniques) {
            const lowerTechnique = technique.toLowerCase();
            for (const [key, value] of Object.entries(techniqueMap)) {
                if (lowerTechnique.includes(key)) {
                    return value;
                }
            }
        }

        return 'prompt_reduction'; // Default category
    }

    static async getPromptsForBulkOptimization(
        userId: string,
        filters: {
            service?: string;
            minCalls?: number;
            timeframe?: string;
        }
    ) {
        try {
            const { service, minCalls = 1, timeframe = '30d' } = filters;

            let startDate: Date;
            const endDate = new Date();

            switch (timeframe) {
                case '1d':
                    startDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
                    break;
                case '7d':
                    startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                    break;
                case '30d':
                    startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                    break;
                case 'all':
                    startDate = new Date(0);
                    break;
                default:
                    startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            }

            const matchStage: any = {
                userId: new mongoose.Types.ObjectId(userId),
                createdAt: { $gte: startDate, $lte: endDate },
            };

            if (service) {
                matchStage.service = service;
            }

            const prompts = await Usage.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: '$prompt',
                        count: { $sum: 1 },
                        usageIds: { $push: '$_id' },
                    },
                },
                { $match: { count: { $gte: minCalls } } },
                { $sort: { count: -1 } },
                { $limit: 10 },
                {
                    $project: {
                        _id: 0,
                        prompt: '$_id',
                        count: 1,
                        usageId: { $first: '$usageIds' },
                    },
                },
            ]);

            // We only need one usageId to get the model and service info
            const usageIds = prompts.map(p => p.usageId);
            const usageDocs = await Usage.find({ _id: { $in: usageIds } }).select('_id prompt');
            const usageIdToPromptId = new Map(usageDocs.map(u => [u._id.toString(), u._id.toString()]));

            return prompts.map(p => ({
                prompt: p.prompt,
                count: p.count,
                promptId: usageIdToPromptId.get(p.usageId.toString()),
            })).filter(p => p.promptId);

        } catch (error) {
            logger.error('Error fetching prompts for bulk optimization:', error);
            throw error;
        }
    }

}