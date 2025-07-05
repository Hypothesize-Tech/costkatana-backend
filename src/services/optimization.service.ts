import { Optimization, IOptimization } from '../models/Optimization';
import { Usage } from '../models/Usage';
import { User } from '../models/User';
import { Alert } from '../models/Alert';
import { logger } from '../utils/logger';
import { PaginationOptions, paginate } from '../utils/helpers';
import { AIProvider, CostEstimate, OptimizationResult } from '../types/aiCostTracker.types';
import { estimateCost } from '../utils/pricing';
import { estimateTokens } from '../utils/tokenCounter';
import { generateOptimizationSuggestions } from '../utils/optimizationUtils';
import mongoose from 'mongoose';
import { ActivityService } from './activity.service';

interface OptimizationRequest {
    userId: string;
    prompt: string;
    service: string;
    model: string;
    context?: string;
    conversationHistory?: Array<{
        role: 'user' | 'assistant' | 'system';
        content: string;
        timestamp?: Date;
    }>;
    options?: {
        targetReduction?: number;
        preserveIntent?: boolean;
        suggestAlternatives?: boolean;
        enableCompression?: boolean;
        enableContextTrimming?: boolean;
        enableRequestFusion?: boolean;
    };
}

interface BatchOptimizationRequest {
    userId: string;
    requests: Array<{
        id: string;
        prompt: string;
        timestamp: number;
        model: string;
        provider: string;
    }>;
    enableFusion?: boolean;
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
            const provider = this.getAIProviderFromString(request.service);

            // Get token count and cost for original prompt
            const originalTokens = estimateTokens(request.prompt, provider);
            const originalEstimate: CostEstimate = estimateCost(
                provider,
                request.model,
                originalTokens,
                150 // Expected completion tokens
            );

            // Run the enhanced optimization using internal utilities
            const optimizationResult: OptimizationResult = generateOptimizationSuggestions(
                request.prompt,
                provider,
                request.model,
                request.conversationHistory
            );

            // Get the best optimization suggestion
            const bestSuggestion = optimizationResult.suggestions[0];
            if (!bestSuggestion) {
                throw new Error('No optimization suggestions available');
            }

            // Get token count and cost for optimized prompt
            const optimizedTokens = estimateTokens(bestSuggestion.optimizedPrompt || request.prompt, provider);
            const optimizedEstimate: CostEstimate = estimateCost(
                provider,
                request.model,
                optimizedTokens,
                150 // Expected completion tokens
            );

            // Calculate savings
            const totalOriginalTokens = originalEstimate.breakdown?.promptTokens + originalEstimate.breakdown?.completionTokens;
            const totalOptimizedTokens = optimizedEstimate.breakdown?.promptTokens + optimizedEstimate.breakdown?.completionTokens;
            const tokensSaved = totalOriginalTokens - totalOptimizedTokens;
            const costSaved = originalEstimate.totalCost - optimizedEstimate.totalCost;
            const improvementPercentage = totalOriginalTokens > 0 ? (tokensSaved / totalOriginalTokens) * 100 : 0;

            // Determine category based on optimization type
            const category = this.determineCategoryFromType(bestSuggestion.type);

            // Build metadata based on optimization type
            const metadata: any = {
                analysisTime: optimizationResult.metadata.processingTime,
                confidence: bestSuggestion.confidence,
                optimizationType: bestSuggestion.type,
                appliedTechniques: optimizationResult.appliedOptimizations,
            };

            // Add type-specific metadata
            if (bestSuggestion.compressionDetails) {
                metadata.compressionDetails = bestSuggestion.compressionDetails;
            }
            if (bestSuggestion.contextTrimDetails) {
                metadata.contextTrimDetails = bestSuggestion.contextTrimDetails;
            }
            if (bestSuggestion.fusionDetails) {
                metadata.fusionDetails = bestSuggestion.fusionDetails;
            }

            // Create optimization record
            const optimization = await Optimization.create({
                userId: request.userId,
                originalPrompt: request.prompt,
                optimizedPrompt: bestSuggestion.optimizedPrompt || request.prompt,
                optimizationTechniques: optimizationResult.appliedOptimizations,
                originalTokens: totalOriginalTokens,
                optimizedTokens: totalOptimizedTokens,
                tokensSaved,
                originalCost: originalEstimate.totalCost,
                optimizedCost: optimizedEstimate.totalCost,
                costSaved,
                improvementPercentage,
                service: request.service,
                model: request.model,
                category,
                suggestions: optimizationResult.suggestions.map((suggestion, index) => ({
                    type: suggestion.type,
                    description: suggestion.explanation,
                    impact: suggestion.estimatedSavings > 30 ? 'high' : suggestion.estimatedSavings > 15 ? 'medium' : 'low',
                    implemented: index === 0,
                })),
                metadata,
            });

            // Update user's optimization count
            await User.findByIdAndUpdate(request.userId, {
                $inc: {
                    'usage.currentMonth.optimizationsSaved': costSaved,
                },
            });

            // Track activity
            await ActivityService.trackActivity(request.userId, {
                type: 'optimization_created',
                title: 'Created Optimization',
                description: `Saved $${costSaved.toFixed(4)} (${improvementPercentage.toFixed(1)}% improvement)`,
                metadata: {
                    optimizationId: optimization._id,
                    service: request.service,
                    model: request.model,
                    cost: originalEstimate.totalCost,
                    saved: costSaved,
                    techniques: optimizationResult.appliedOptimizations
                }
            });

            // Create alert if significant savings
            if (improvementPercentage > 30) {
                await Alert.create({
                    userId: request.userId,
                    type: 'optimization_available',
                    title: 'Significant Optimization Available',
                    message: `You can save ${improvementPercentage.toFixed(1)}% on tokens using ${bestSuggestion.type} optimization.`,
                    severity: 'medium',
                    data: {
                        optimizationId: optimization._id,
                        savings: costSaved,
                        percentage: improvementPercentage,
                        optimizationType: bestSuggestion.type,
                    },
                });
            }

            logger.info('Optimization created', {
                userId: request.userId,
                originalTokens: totalOriginalTokens,
                optimizedTokens: totalOptimizedTokens,
                savings: improvementPercentage,
                type: bestSuggestion.type,
            });

            return optimization;
        } catch (error) {
            logger.error('Error creating optimization:', error);
            throw error;
        }
    }

    static async createBatchOptimization(request: BatchOptimizationRequest): Promise<IOptimization[]> {
        try {
            // Use internal optimization utilities instead of external tracker
            const { generateOptimizationSuggestions } = require('../utils/optimizationUtils');

            // Convert requests to FusionRequest format
            const fusionRequests = request.requests.map(r => ({
                id: r.id,
                prompt: r.prompt,
                timestamp: r.timestamp,
                model: r.model,
                provider: this.getAIProviderFromString(r.provider),
                metadata: {}
            }));

            // Run request fusion optimization
            const optimizationResult: OptimizationResult = generateOptimizationSuggestions(fusionRequests);

            const optimizations: IOptimization[] = [];

            // Create optimization records for each suggestion
            for (const suggestion of optimizationResult.suggestions) {
                if (suggestion.type === 'request_fusion' && suggestion.fusionDetails) {
                    // Calculate costs for all fused requests
                    let originalTotalCost = 0;
                    let originalTotalTokens = 0;

                    for (const req of request.requests) {
                        const estimate = estimateCost(
                            this.getAIProviderFromString(req.provider),
                            req.model,
                            estimateTokens(req.prompt, this.getAIProviderFromString(req.provider)),
                            150
                        );
                        originalTotalCost += estimate.totalCost;
                        originalTotalTokens += estimate.breakdown.promptTokens + estimate.breakdown.completionTokens;
                    }

                    // Calculate optimized cost
                    const optimizedEstimate = estimateCost(
                        this.getAIProviderFromString(request.requests[0].provider),
                        request.requests[0].model,
                        estimateTokens(suggestion.optimizedPrompt!, this.getAIProviderFromString(request.requests[0].provider)),
                        150
                    );

                    const optimizedTokens = (optimizedEstimate.breakdown?.promptTokens ?? 0) + (optimizedEstimate.breakdown?.completionTokens ?? 0);
                    const tokensSaved = originalTotalTokens - optimizedTokens;
                    const costSaved = originalTotalCost - optimizedEstimate.totalCost;
                    const improvementPercentage = originalTotalTokens > 0 ? (tokensSaved / originalTotalTokens) * 100 : 0;

                    const optimization = await Optimization.create({
                        userId: request.userId,
                        originalPrompt: request.requests.map(r => r.prompt).join('\n\n---\n\n'),
                        optimizedPrompt: suggestion.optimizedPrompt!,
                        optimizationTechniques: ['request_fusion', suggestion.fusionDetails.fusionStrategy],
                        originalTokens: originalTotalTokens,
                        optimizedTokens,
                        tokensSaved,
                        originalCost: originalTotalCost,
                        optimizedCost: optimizedEstimate.totalCost,
                        costSaved,
                        improvementPercentage,
                        service: request.requests[0].provider,
                        model: request.requests[0].model,
                        category: 'batch_processing',
                        suggestions: [{
                            type: 'request_fusion',
                            description: suggestion.explanation,
                            impact: improvementPercentage > 30 ? 'high' : improvementPercentage > 15 ? 'medium' : 'low',
                            implemented: true,
                        }],
                        metadata: {
                            fusionDetails: suggestion.fusionDetails,
                            originalRequestCount: request.requests.length,
                            fusionStrategy: suggestion.fusionDetails.fusionStrategy,
                        },
                    });

                    optimizations.push(optimization);
                }
            }

            return optimizations;
        } catch (error) {
            logger.error('Error creating batch optimization:', error);
            throw error;
        }
    }

    private static determineCategoryFromType(type: string): string {
        const typeMap: Record<string, string> = {
            'prompt': 'prompt_reduction',
            'compression': 'prompt_reduction',
            'context_trimming': 'context_optimization',
            'request_fusion': 'batch_processing',
            'model': 'model_selection',
            'caching': 'response_formatting',
            'batching': 'batch_processing',
        };

        return typeMap[type] || 'prompt_reduction';
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

            // Track activity
            await ActivityService.trackActivity(userId, {
                type: 'optimization_applied',
                title: 'Applied Optimization',
                description: `Applied optimization saving $${optimization.costSaved.toFixed(4)}`,
                metadata: {
                    optimizationId: optimization._id,
                    service: optimization.service,
                    model: optimization.model,
                    saved: optimization.costSaved
                }
            });

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
            // Get recent high-cost usage patterns for the user
            const recentUsage = await Usage.find({ userId })
                .sort({ createdAt: -1 })
                .limit(50);

            const suggestions = recentUsage
                .filter(usage => usage.cost > 0.01) // High cost threshold
                .map(usage => ({
                    id: usage._id.toString(),
                    type: 'prompt_optimization',
                    originalPrompt: usage.prompt,
                    estimatedSavings: usage.cost * 0.2, // Estimate 20% savings
                    confidence: 0.8,
                    explanation: `This prompt could be optimized to reduce token usage and costs.`,
                    implementation: 'Consider simplifying the prompt or using a more efficient model.'
                }))
                .slice(0, 10); // Top 10 opportunities

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
                totalPotentialSavings: suggestions.reduce((sum: number, s: any) => sum + s.estimatedSavings, 0),
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

    static async getPromptsForBulkOptimization(
        userId: string,
        filters: {
            service?: string;
            minCalls?: number;
            timeframe?: string;
        }
    ) {
        try {
            const { service, minCalls = 5, timeframe = '30d' } = filters;

            // Calculate date range
            const startDate = new Date();
            const days = timeframe === '7d' ? 7 : timeframe === '30d' ? 30 : 90;
            startDate.setDate(startDate.getDate() - days);

            // Build aggregation pipeline
            const matchStage: any = {
                userId: new mongoose.Types.ObjectId(userId),
                createdAt: { $gte: startDate }
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
                        totalCost: { $sum: '$cost' },
                        avgTokens: { $avg: '$totalTokens' },
                        models: { $addToSet: '$model' },
                        services: { $addToSet: '$service' }
                    }
                },
                { $match: { count: { $gte: minCalls } } },
                { $sort: { count: -1 } },
                { $limit: 50 },
                {
                    $project: {
                        prompt: '$_id',
                        count: 1,
                        promptId: { $toString: '$_id' },
                        totalCost: 1,
                        avgTokens: 1,
                        models: 1,
                        services: 1
                    }
                }
            ]);

            return prompts;
        } catch (error: any) {
            logger.error('Get prompts for bulk optimization error:', error);
            throw new Error('Failed to get prompts for bulk optimization');
        }
    }

    static async getOptimizationTemplates(category?: string) {
        try {
            // Get real optimization templates from database
            const matchStage: any = {};
            if (category) {
                matchStage.category = category;
            }

            const templates = await Optimization.aggregate([
                { $match: matchStage },
                {
                    $group: {
                        _id: '$category',
                        count: { $sum: 1 },
                        avgImprovement: { $avg: '$improvementPercentage' },
                        totalSaved: { $sum: '$costSaved' },
                        examples: {
                            $push: {
                                before: '$originalPrompt',
                                after: '$optimizedPrompt',
                                savings: '$improvementPercentage'
                            }
                        }
                    }
                },
                {
                    $project: {
                        id: '$_id',
                        name: {
                            $switch: {
                                branches: [
                                    { case: { $eq: ['$_id', 'prompt_optimization'] }, then: 'Prompt Optimization' },
                                    { case: { $eq: ['$_id', 'context_trimming'] }, then: 'Context Trimming' },
                                    { case: { $eq: ['$_id', 'compression'] }, then: 'Compression' },
                                    { case: { $eq: ['$_id', 'model_switching'] }, then: 'Model Switching' }
                                ],
                                default: 'General Optimization'
                            }
                        },
                        category: '$_id',
                        description: {
                            $switch: {
                                branches: [
                                    { case: { $eq: ['$_id', 'prompt_optimization'] }, then: 'Optimize prompts for better efficiency and cost reduction' },
                                    { case: { $eq: ['$_id', 'context_trimming'] }, then: 'Reduce context length while maintaining quality' },
                                    { case: { $eq: ['$_id', 'compression'] }, then: 'Compress prompts using various techniques' },
                                    { case: { $eq: ['$_id', 'model_switching'] }, then: 'Switch to more cost-effective models' }
                                ],
                                default: 'General optimization techniques'
                            }
                        },
                        examples: { $slice: ['$examples', 3] },
                        techniques: {
                            $switch: {
                                branches: [
                                    { case: { $eq: ['$_id', 'prompt_optimization'] }, then: ['rewriting', 'simplification', 'structure_optimization'] },
                                    { case: { $eq: ['$_id', 'context_trimming'] }, then: ['sliding_window', 'relevance_filtering', 'summarization'] },
                                    { case: { $eq: ['$_id', 'compression'] }, then: ['json_compression', 'pattern_replacement', 'abbreviation'] },
                                    { case: { $eq: ['$_id', 'model_switching'] }, then: ['cost_analysis', 'performance_comparison', 'capability_matching'] }
                                ],
                                default: ['general_optimization']
                            }
                        },
                        avgImprovement: { $round: ['$avgImprovement', 2] }
                    }
                }
            ]);

            return templates;
        } catch (error: any) {
            logger.error('Get optimization templates error:', error);
            throw new Error('Failed to get optimization templates');
        }
    }

    static async getOptimizationHistory(promptHash: string, userId: string) {
        try {
            // Get optimization history for a specific prompt
            const history = await Optimization.find({
                userId: new mongoose.Types.ObjectId(userId),
                $or: [
                    { originalPrompt: { $regex: promptHash, $options: 'i' } },
                    { optimizedPrompt: { $regex: promptHash, $options: 'i' } }
                ]
            })
                .sort({ createdAt: -1 })
                .limit(10)
                .select('originalPrompt optimizedPrompt tokensSaved costSaved improvementPercentage applied appliedAt createdAt')
                .lean();

            const formattedHistory = history.map((opt, index) => ({
                id: opt._id,
                version: history.length - index, // Calculate version based on order
                prompt: opt.optimizedPrompt || opt.originalPrompt,
                tokens: opt.tokensSaved || 0,
                cost: opt.costSaved || 0,
                createdAt: opt.createdAt,
                appliedAt: opt.appliedAt
            }));

            return {
                history: formattedHistory,
                currentVersion: formattedHistory.length > 0 ? formattedHistory[0].version : 1
            };
        } catch (error: any) {
            logger.error('Get optimization history error:', error);
            throw new Error('Failed to get optimization history');
        }
    }

    static async revertOptimization(optimizationId: string, userId: string, version?: number) {
        try {
            // Find the optimization to revert
            const optimization = await Optimization.findOne({
                _id: new mongoose.Types.ObjectId(optimizationId),
                userId: new mongoose.Types.ObjectId(userId)
            });

            if (!optimization) {
                throw new Error('Optimization not found');
            }

            // Mark as not applied (revert)
            optimization.applied = false;
            optimization.appliedAt = undefined;

            // Add metadata about the reversion
            if (!optimization.metadata) {
                optimization.metadata = {};
            }
            optimization.metadata.revertedAt = new Date();
            optimization.metadata.revertedVersion = version || 1;

            await optimization.save();

            // Log the reversion
            logger.info('Optimization reverted:', {
                optimizationId,
                userId,
                revertedAt: optimization.metadata.revertedAt
            });

            return {
                message: 'Optimization reverted successfully',
                revertedAt: optimization.metadata.revertedAt
            };
        } catch (error: any) {
            logger.error('Revert optimization error:', error);
            throw new Error('Failed to revert optimization');
        }
    }
}