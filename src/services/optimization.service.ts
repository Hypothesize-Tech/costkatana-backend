import { Optimization, IOptimization } from '../models/Optimization';
import { Usage } from '../models/Usage';
import { User } from '../models/User';
import { Alert } from '../models/Alert';
import { loggingService } from './logging.service';
import { PaginationOptions, paginate } from '../utils/helpers';
import { AIProvider, CostEstimate, OptimizationResult } from '../types/aiCostTracker.types';
import { estimateCost, getModelPricing } from '../utils/pricing';
import { estimateTokens } from '../utils/tokenCounter';
import { generateOptimizationSuggestions } from '../utils/optimizationUtils';
import mongoose from 'mongoose';
import { ActivityService } from './activity.service';
import { cortexService } from './cortexService';

/**
 * Convert AIProvider enum to string for pricing functions
 */
function providerEnumToString(provider: AIProvider): string {
    const providerMap: Record<AIProvider, string> = {
        [AIProvider.OpenAI]: 'OpenAI',
        [AIProvider.Anthropic]: 'Anthropic',
        [AIProvider.Google]: 'Google AI',
        [AIProvider.Gemini]: 'Google AI',
        [AIProvider.AWSBedrock]: 'AWS Bedrock',
        [AIProvider.Cohere]: 'Cohere',
        [AIProvider.DeepSeek]: 'DeepSeek',
        [AIProvider.Groq]: 'Groq',
        [AIProvider.HuggingFace]: 'Hugging Face',
        [AIProvider.Ollama]: 'Ollama',
        [AIProvider.Replicate]: 'Replicate',
        [AIProvider.Azure]: 'Azure OpenAI'
    };
    return providerMap[provider] || 'OpenAI';
}

/**
 * Convert simple cost estimate to CostEstimate interface
 */
function convertToCostEstimate(
    simpleEstimate: { inputCost: number; outputCost: number; totalCost: number },
    promptTokens: number,
    completionTokens: number,
    provider: AIProvider,
    model: string
): CostEstimate {
    const modelPricing = getModelPricing(providerEnumToString(provider), model);
    const inputPricePerToken = modelPricing ? modelPricing.inputPrice / 1000000 : 0;
    const outputPricePerToken = modelPricing ? modelPricing.outputPrice / 1000000 : 0;

    return {
        promptCost: simpleEstimate.inputCost,
        completionCost: simpleEstimate.outputCost,
        totalCost: simpleEstimate.totalCost,
        currency: 'USD',
        breakdown: {
            promptTokens,
            completionTokens,
            pricePerPromptToken: inputPricePerToken,
            pricePerCompletionToken: outputPricePerToken
        }
    };
}

interface OptimizationRequest {
    userId: string;
    prompt: string;
    service: string;
    model: string;
    context?: string;
    useCortex?: boolean;  // Enable Cortex meta-language optimization
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
            let originalTokens;
            try {
                originalTokens = estimateTokens(request.prompt, provider);
            } catch (error) {
                loggingService.warn(`Failed to estimate tokens for original prompt, using fallback: ${error}`);
                originalTokens = request.prompt.length / 4; // Rough estimate
            }
            
            let originalSimpleEstimate;
            try {
                originalSimpleEstimate = estimateCost(
                    originalTokens,
                    150, // Expected completion tokens
                    providerEnumToString(provider),
                    request.model
                );
            } catch (error) {
                loggingService.warn(`No pricing data found for ${providerEnumToString(provider)}/${request.model}, using fallback pricing`);
                // Use fallback pricing (GPT-4o-mini rates as default)
                originalSimpleEstimate = {
                    inputCost: (originalTokens / 1_000_000) * 0.15,
                    outputCost: (150 / 1_000_000) * 0.60,
                    totalCost: (originalTokens / 1_000_000) * 0.15 + (150 / 1_000_000) * 0.60
                };
            }
            
            const originalEstimate: CostEstimate = convertToCostEstimate(
                originalSimpleEstimate,
                originalTokens,
                150,
                provider,
                request.model
            );

            // Use Cortex optimization if enabled
            let optimizationResult: OptimizationResult;
            
            // Check if Cortex is enabled for optimization
            const useCortex = process.env.CORTEX_ENABLED === 'true' && 
                            (process.env.CORTEX_MODE === 'mandatory' || 
                             request.useCortex === true);
            
            if (useCortex) {
                try {
                    // Process with Cortex for maximum optimization
                    const cortexResult = await cortexService.process(request.prompt);
                    
                    // Create optimization result from Cortex metrics
                    optimizationResult = {
                        id: 'cortex-optimization',
                        suggestions: [{
                            id: 'cortex-semantic-compression',
                            type: 'compression' as const,
                            originalPrompt: request.prompt,
                            optimizedPrompt: cortexResult.response,
                            estimatedSavings: cortexResult.metrics.costSavings * 100,
                            confidence: 0.95,
                            explanation: `Cortex Meta-Language optimization achieved ${(cortexResult.metrics.tokenReduction * 100).toFixed(1)}% token reduction and ${(cortexResult.metrics.costSavings * 100).toFixed(1)}% cost savings using ${cortexResult.metrics.modelUsed}`,
                            implementation: 'Applied Cortex semantic compression, neural optimization, and intelligent model routing',
                            compressionDetails: {
                                technique: 'pattern_replacement' as const,
                                originalSize: originalTokens,
                                compressedSize: cortexResult.metrics.optimizedTokens,
                                compressionRatio: cortexResult.metrics.tokenReduction,
                                reversible: false
                            }
                        }],
                        totalSavings: cortexResult.metrics.costSavings * 100,
                        appliedOptimizations: ['cortex-semantic-compression'],
                        metadata: {
                            processingTime: cortexResult.metrics.processingTime,
                            originalTokens,
                            optimizedTokens: cortexResult.metrics.optimizedTokens,
                            techniques: ['Cortex Semantic Compression', 'Cortex Neural Optimization', 'Cortex Model Routing'],
                            cortexOptimized: true,
                            cortexMetrics: {
                                encodingReduction: cortexResult.metrics.tokenReduction * 100,
                                semanticCompression: cortexResult.metrics.tokenReduction * 100,
                                processingTime: cortexResult.metrics.processingTime,
                                cacheUtilization: cortexResult.metrics.cacheHit ? 100 : 0,
                                tokenReduction: cortexResult.metrics.tokenReduction * 100,
                                costReduction: cortexResult.metrics.costSavings * 100
                            }
                        }
                    };
                    
                    loggingService.info('Optimization completed with Cortex', {
                        tokenReduction: `${(cortexResult.metrics.tokenReduction * 100).toFixed(1)}%`,
                        costSavings: `${(cortexResult.metrics.costSavings * 100).toFixed(1)}%`,
                        modelUsed: cortexResult.metrics.modelUsed
                    });
                } catch (cortexError) {
                    loggingService.warn('Cortex optimization failed, falling back to standard', { error: cortexError });
                    // Fall back to standard optimization
                    optimizationResult = generateOptimizationSuggestions(
                        request.prompt,
                        provider,
                        request.model,
                        request.conversationHistory
                    );
                }
            } else {
                // Use standard optimization when Cortex is not enabled
                try {
                    optimizationResult = generateOptimizationSuggestions(
                        request.prompt,
                        provider,
                        request.model,
                        request.conversationHistory
                    );
                } catch (error) {
                    loggingService.error('Failed to generate optimization suggestions:', { error: error instanceof Error ? error.message : String(error) });
                    // Create a fallback optimization result
                    optimizationResult = {
                    id: 'fallback-optimization',
                    totalSavings: 10,
                    suggestions: [{
                        id: 'fallback-compression',
                        type: 'compression',
                        explanation: 'Basic prompt compression applied',
                        estimatedSavings: 10,
                        confidence: 0.7,
                        optimizedPrompt: request.prompt.replace(/\s+/g, ' ').trim(),
                        compressionDetails: {
                            technique: 'pattern_replacement',
                            originalSize: request.prompt.length,
                            compressedSize: request.prompt.replace(/\s+/g, ' ').trim().length,
                            compressionRatio: 0.9,
                            reversible: false
                        }
                    }],
                    appliedOptimizations: ['compression'],
                    metadata: {
                        processingTime: 1,
                        originalTokens: request.prompt.length / 4,
                        optimizedTokens: request.prompt.replace(/\s+/g, ' ').trim().length / 4,
                        techniques: ['compression']
                    }
                };
                }
            }

            // Apply the optimizations to get the actual optimized prompt
            let optimizedPrompt = request.prompt;
            let appliedOptimizations: string[] = [];
            
            if (optimizationResult.suggestions.length > 0) {
                // Apply the best suggestion (usually compression)
                const bestSuggestion = optimizationResult.suggestions[0];
                if (bestSuggestion.optimizedPrompt) {
                    optimizedPrompt = bestSuggestion.optimizedPrompt;
                    appliedOptimizations.push(bestSuggestion.id);
                } else if (bestSuggestion.type === 'compression') {
                    // Apply basic compression if no optimized prompt is provided
                    optimizedPrompt = request.prompt.replace(/\s+/g, ' ').trim();
                    appliedOptimizations.push('compression');
                }
            }

            // Get token count and cost for optimized prompt
            let optimizedTokens;
            try {
                optimizedTokens = estimateTokens(optimizedPrompt, provider);
            } catch (error) {
                loggingService.warn(`Failed to estimate tokens for optimized prompt, using fallback: ${error}`);
                optimizedTokens = optimizedPrompt.length / 4; // Rough estimate
            }
            
            let optimizedSimpleEstimate;
            try {
                optimizedSimpleEstimate = estimateCost(
                    optimizedTokens,
                    150, // Expected completion tokens
                    providerEnumToString(provider),
                    request.model
                );
            } catch (error) {
                loggingService.warn(`No pricing data found for ${providerEnumToString(provider)}/${request.model}, using fallback pricing for optimized prompt`);
                // Use fallback pricing (GPT-4o-mini rates as default)
                optimizedSimpleEstimate = {
                    inputCost: (optimizedTokens / 1_000_000) * 0.15,
                    outputCost: (150 / 1_000_000) * 0.60,
                    totalCost: (optimizedTokens / 1_000_000) * 0.15 + (150 / 1_000_000) * 0.60
                };
            }
            
            const optimizedEstimate: CostEstimate = convertToCostEstimate(
                optimizedSimpleEstimate,
                optimizedTokens,
                150,
                provider,
                request.model
            );

            // Calculate savings
            const totalOriginalTokens = originalEstimate.breakdown?.promptTokens + originalEstimate.breakdown?.completionTokens;
            const totalOptimizedTokens = optimizedEstimate.breakdown?.promptTokens + optimizedEstimate.breakdown?.completionTokens;
            const tokensSaved = totalOriginalTokens - totalOptimizedTokens;
            const costSaved = originalEstimate.totalCost - optimizedEstimate.totalCost;
            const improvementPercentage = totalOriginalTokens > 0 ? (tokensSaved / totalOriginalTokens) * 100 : 0;

            // Determine category based on optimization type
            const optimizationType = optimizationResult.suggestions.length > 0 ? optimizationResult.suggestions[0].type : 'compression';
            const category = this.determineCategoryFromType(optimizationType);

            // Build metadata based on optimization type
            const metadata: any = {
                analysisTime: optimizationResult.metadata.processingTime,
                confidence: optimizationResult.suggestions.length > 0 ? optimizationResult.suggestions[0].confidence : 0.5,
                optimizationType: optimizationType,
                appliedTechniques: appliedOptimizations,
            };

            // Add type-specific metadata
            if (optimizationResult.suggestions.length > 0) {
                const bestSuggestion = optimizationResult.suggestions[0];
                if (bestSuggestion.compressionDetails) {
                    metadata.compressionDetails = bestSuggestion.compressionDetails;
                }
                if (bestSuggestion.contextTrimDetails) {
                    metadata.contextTrimDetails = bestSuggestion.contextTrimDetails;
                }
                if (bestSuggestion.fusionDetails) {
                    metadata.fusionDetails = bestSuggestion.fusionDetails;
                }
            }

            // Create optimization record
            const optimization = await Optimization.create({
                userId: request.userId,
                originalPrompt: request.prompt,
                optimizedPrompt: optimizedPrompt,
                optimizationTechniques: appliedOptimizations,
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
                    message: `You can save ${improvementPercentage.toFixed(1)}% on tokens using ${optimizationType} optimization.`,
                    severity: 'medium',
                    data: {
                        optimizationId: optimization._id,
                        savings: costSaved,
                        percentage: improvementPercentage,
                        optimizationType: optimizationType,
                    },
                });
            }

            loggingService.info('Optimization created', { value:  { 
                userId: request.userId,
                originalTokens: totalOriginalTokens,
                optimizedTokens: totalOptimizedTokens,
                savings: improvementPercentage,
                type: optimizationType,
             } });

            return optimization;
        } catch (error) {
            loggingService.error('Error creating optimization:', { error: error instanceof Error ? error.message : String(error) });
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
                        const provider = this.getAIProviderFromString(req.provider);
                        const promptTokens = estimateTokens(req.prompt, provider);
                        
                        let estimate;
                        try {
                            estimate = estimateCost(
                                promptTokens,
                                150,
                                providerEnumToString(provider),
                                req.model
                            );
                        } catch (error) {
                            loggingService.warn(`No pricing data found for ${providerEnumToString(provider)}/${req.model}, using fallback pricing`);
                            // Use fallback pricing (GPT-4o-mini rates as default)
                            estimate = {
                                inputCost: (promptTokens / 1_000_000) * 0.15,
                                outputCost: (150 / 1_000_000) * 0.60,
                                totalCost: (promptTokens / 1_000_000) * 0.15 + (150 / 1_000_000) * 0.60
                            };
                        }
                        
                        originalTotalCost += estimate.totalCost;
                        originalTotalTokens += promptTokens + 150;
                    }

                    // Calculate optimized cost
                    const firstProvider = this.getAIProviderFromString(request.requests[0].provider);
                    const optimizedPromptTokens = estimateTokens(suggestion.optimizedPrompt!, firstProvider);
                    
                    let optimizedEstimate;
                    try {
                        optimizedEstimate = estimateCost(
                            optimizedPromptTokens,
                            150,
                            providerEnumToString(firstProvider),
                            request.requests[0].model
                        );
                    } catch (error) {
                        loggingService.warn(`No pricing data found for ${providerEnumToString(firstProvider)}/${request.requests[0].model}, using fallback pricing`);
                        // Use fallback pricing (GPT-4o-mini rates as default)
                        optimizedEstimate = {
                            inputCost: (optimizedPromptTokens / 1_000_000) * 0.15,
                            outputCost: (150 / 1_000_000) * 0.60,
                            totalCost: (optimizedPromptTokens / 1_000_000) * 0.15 + (150 / 1_000_000) * 0.60
                        };
                    }

                    const optimizedTokens = optimizedPromptTokens + 150;
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
            loggingService.error('Error creating batch optimization:', { error: error instanceof Error ? error.message : String(error) });
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
                sort.createdAt = -1; // Default to most recent first
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
            loggingService.error('Error fetching optimizations:', { error: error instanceof Error ? error.message : String(error) });
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

            loggingService.info('Optimization applied', { value:  { 
                optimizationId,
                userId,
             } });
        } catch (error) {
            loggingService.error('Error applying optimization:', { error: error instanceof Error ? error.message : String(error) });
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

            loggingService.info('Optimization feedback provided', { value:  { 
                optimizationId,
                helpful: feedback.helpful,
                rating: feedback.rating,
             } });
        } catch (error) {
            loggingService.error('Error providing optimization feedback:', { error: error instanceof Error ? error.message : String(error) });
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
            loggingService.error('Error analyzing optimization opportunities:', { error: error instanceof Error ? error.message : String(error) });
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
                    loggingService.error(`Error optimizing prompt ${promptData._id}:`, { error: error instanceof Error ? error.message : String(error) });
                }
            }

            return {
                total: promptIds.length,
                successful: optimizations.length,
                failed: promptIds.length - optimizations.length,
                optimizations,
            };
        } catch (error) {
            loggingService.error('Error generating bulk optimizations:', { error: error instanceof Error ? error.message : String(error) });
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
            loggingService.error('Get prompts for bulk optimization error:', { error: error instanceof Error ? error.message : String(error) });
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
            loggingService.error('Get optimization templates error:', { error: error instanceof Error ? error.message : String(error) });
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
            loggingService.error('Get optimization history error:', { error: error instanceof Error ? error.message : String(error) });
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
            loggingService.info('Optimization reverted:', { value:  { 
                optimizationId,
                userId,
                revertedAt: optimization.metadata.revertedAt
             } });

            return {
                message: 'Optimization reverted successfully',
                revertedAt: optimization.metadata.revertedAt
            };
        } catch (error: any) {
            loggingService.error('Revert optimization error:', { error: error instanceof Error ? error.message : String(error) });
            throw new Error('Failed to revert optimization');
        }
    }
}