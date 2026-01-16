/**
 * Template Execution Service
 * Handles AI-powered execution of prompt templates with cost tracking
 */

import { PromptTemplate, IPromptTemplate } from '../models/PromptTemplate';
import { TemplateExecution, ITemplateExecution } from '../models/TemplateExecution';
import { TracedAIService } from './tracedAI.service';
import { ModelRecommendationService, ModelRecommendation } from './modelRecommendation.service';
import { AICostTrackerService } from './aiCostTracker.service';
import { estimateTokens } from '../utils/tokenCounter';
import { AIProvider } from '../types';
import { loggingService } from './logging.service';
import { ActivityService } from './activity.service';

export interface TemplateExecutionRequest {
    templateId: string;
    userId: string;
    variables: Record<string, any>;
    executionMode: 'single' | 'comparison' | 'recommended';
    modelId?: string; // User-selected model (overrides recommendation)
    compareWith?: string[]; // Additional models for comparison
    enableOptimization?: boolean; // Future Cortex integration
}

export interface TemplateExecutionResult {
    executionId: string;
    templateId: string;
    aiResponse: string;
    
    // Token usage
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    
    // Cost tracking
    actualCost: number;
    baselineCost: number;
    savingsAmount: number;
    savingsPercentage: number;
    
    // Model information
    modelUsed: string;
    modelProvider: string;
    modelRecommended?: string;
    recommendationFollowed: boolean;
    recommendationReasoning?: string;
    
    // Performance
    latencyMs: number;
    executedAt: Date;
    
    // Quality metrics (future enhancement)
    qualityScore?: number;
}

export interface ComparisonExecutionResult {
    results: TemplateExecutionResult[];
    bestCostModel: string;
    bestQualityModel?: string;
    summary: {
        totalCost: number;
        averageCost: number;
        costRange: { min: number; max: number };
    };
}

export class TemplateExecutionService {
    // 🎯 P1: Semantic cache for template execution (70-80% cost savings)
    private static templateCache = new Map<string, { 
        result: any; 
        timestamp: number; 
        variables: any;
        hash: string;
    }>();
    private static readonly CACHE_TTL = 3600000; // 1 hour

    /**
     * Execute a prompt template with AI
     */
    static async executeTemplate(
        request: TemplateExecutionRequest
    ): Promise<TemplateExecutionResult | ComparisonExecutionResult> {
        try {
            // Get template
            const template = await PromptTemplate.findById(request.templateId);
            if (!template) {
                throw new Error('Template not found');
            }

            // Check access
            if (template.createdBy.toString() !== request.userId) {
                // Check if user has access through sharing
                const hasAccess = 
                    template.sharing.visibility === 'public' ||
                    template.sharing.sharedWith.some(id => id.toString() === request.userId);
                
                if (!hasAccess) {
                    throw new Error('Unauthorized: Cannot access this template');
                }
            }

            // 🎯 P1: Check semantic cache before execution
            const cacheKey = this.generateCacheKey(request);
            const cached = this.templateCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
                loggingService.info('✅ Template execution cache HIT', {
                    templateId: request.templateId,
                    userId: request.userId,
                    cacheAge: Math.round((Date.now() - cached.timestamp) / 1000) + 's'
                });
                return {
                    ...cached.result,
                    metadata: {
                        ...cached.result.metadata,
                        cacheHit: true,
                        cacheAge: Date.now() - cached.timestamp
                    }
                };
            }

            loggingService.info('Executing template', {
                templateId: request.templateId,
                userId: request.userId,
                executionMode: request.executionMode
            });

            // Handle different execution modes
            let result;
            if (request.executionMode === 'comparison') {
                result = await this.executeComparison(template, request);
            } else {
                result = await this.executeSingle(template, request);
            }

            // 🎯 P1: Cache the result
            this.templateCache.set(cacheKey, {
                result,
                timestamp: Date.now(),
                variables: request.variables,
                hash: cacheKey
            });

            // Cleanup old cache entries periodically
            this.cleanupCache();

            return result;
        } catch (error) {
            loggingService.error('Template execution failed', {
                error: error instanceof Error ? error.message : String(error),
                templateId: request.templateId,
                userId: request.userId
            });
            throw error;
        }
    }

    /**
     * Generate cache key for template execution
     */
    private static generateCacheKey(request: TemplateExecutionRequest): string {
        const crypto = require('crypto');
        const data = JSON.stringify({
            templateId: request.templateId,
            variables: request.variables,
            modelId: request.modelId,
            executionMode: request.executionMode
        });
        return crypto.createHash('sha256').update(data).digest('hex');
    }

    /**
     * Cleanup old cache entries
     */
    private static cleanupCache(): void {
        const now = Date.now();
        for (const [key, entry] of this.templateCache.entries()) {
            if (now - entry.timestamp > this.CACHE_TTL) {
                this.templateCache.delete(key);
            }
        }
    }

    /**
     * Execute template with a single model
     */
    private static async executeSingle(
        template: IPromptTemplate,
        request: TemplateExecutionRequest
    ): Promise<TemplateExecutionResult> {
        const startTime = Date.now();

        // Get model recommendation if not specified
        let modelId = request.modelId;
        let recommendation: ModelRecommendation | undefined;
        let recommendationFollowed = false;

        if (!modelId || request.executionMode === 'recommended') {
            recommendation = await ModelRecommendationService.recommendModel(template);
            modelId = recommendation.modelId;
            recommendationFollowed = true;

            loggingService.debug('Model recommended', {
                templateId: template._id,
                recommendedModel: modelId,
                reasoning: recommendation.reasoning
            });
        }

        // Process variables and fill template
        const filledPrompt = this.fillTemplate(template, request.variables);

        // Execute with AI
        const aiResponse = await TracedAIService.invokeModel(
            filledPrompt,
            modelId!
        );

        const latencyMs = Date.now() - startTime;

        // Calculate token usage
        const promptTokens = await estimateTokens(filledPrompt, AIProvider.Anthropic);
        const completionTokens = await estimateTokens(aiResponse, AIProvider.Anthropic);
        const totalTokens = promptTokens + completionTokens;

        // Calculate costs
        const actualCost = await this.calculateActualCost(
            promptTokens,
            completionTokens,
            modelId!
        );

        const analysis = await ModelRecommendationService.analyzeTemplate(template);
        const baselineCost = ModelRecommendationService.calculateBaselineCost(
            analysis.estimatedTokens,
            analysis.requiresVision
        );

        const savingsAmount = baselineCost - actualCost;
        const savingsPercentage = baselineCost > 0 
            ? (savingsAmount / baselineCost) * 100 
            : 0;

        // Save execution record
        const execution = new TemplateExecution({
            templateId: template._id,
            userId: request.userId,
            variables: request.variables,
            modelUsed: modelId,
            modelRecommended: recommendation?.modelId,
            recommendationFollowed,
            aiResponse,
            promptTokens,
            completionTokens,
            totalTokens,
            actualCost,
            baselineCost,
            savingsAmount,
            savingsPercentage,
            latencyMs,
            executedAt: new Date()
        });

        await execution.save();

        // Track usage in main Usage collection
        await this.trackUsage(
            request.userId,
            modelId!,
            filledPrompt,
            aiResponse,
            promptTokens,
            completionTokens,
            actualCost,
        );

        // Update template statistics
        await this.updateTemplateStats(template._id, actualCost, savingsAmount, modelId!);

        // Track activity
        await this.trackActivity(request.userId, template, execution);

        loggingService.info('Template execution completed', {
            executionId: execution._id,
            templateId: template._id,
            modelUsed: modelId,
            savingsPercentage: savingsPercentage.toFixed(2)
        });

        return {
            executionId: execution._id.toString(),
            templateId: template._id.toString(),
            aiResponse,
            promptTokens,
            completionTokens,
            totalTokens,
            actualCost,
            baselineCost,
            savingsAmount,
            savingsPercentage,
            modelUsed: modelId!,
            modelProvider: ModelRecommendationService['getProviderForModel'](modelId!),
            modelRecommended: recommendation?.modelId,
            recommendationFollowed,
            recommendationReasoning: recommendation?.reasoning,
            latencyMs,
            executedAt: execution.executedAt
        };
    }

    /**
     * Execute template with multiple models for comparison
     */
    private static async executeComparison(
        template: IPromptTemplate,
        request: TemplateExecutionRequest
    ): Promise<ComparisonExecutionResult> {
        // Get models to compare
        const modelsToCompare = request.compareWith || [];
        
        // Add recommended model if not already in list
        if (modelsToCompare.length === 0) {
            const recommendation = await ModelRecommendationService.recommendModel(template);
            modelsToCompare.push(recommendation.modelId);
            
            // Add a couple more models from different tiers for comparison
            const allModels = ModelRecommendationService.getAllModels();
            const cheapModel = allModels.find(m => m.tier === 'ultra-cheap');
            const premiumModel = allModels.find(m => m.tier === 'premium');
            
            if (cheapModel && cheapModel.modelId !== recommendation.modelId) {
                modelsToCompare.push(cheapModel.modelId);
            }
            if (premiumModel && premiumModel.modelId !== recommendation.modelId) {
                modelsToCompare.push(premiumModel.modelId);
            }
        }

        // Execute with each model
        const results: TemplateExecutionResult[] = [];
        
        for (const modelId of modelsToCompare) {
            try {
                const result = await this.executeSingle(template, {
                    ...request,
                    modelId,
                    executionMode: 'single'
                });
                results.push(result);
            } catch (error) {
                loggingService.error('Comparison execution failed for model', {
                    error: error instanceof Error ? error.message : String(error),
                    modelId,
                    templateId: template._id
                });
            }
        }

        // Calculate comparison summary
        const costs = results.map(r => r.actualCost);
        const totalCost = costs.reduce((sum, cost) => sum + cost, 0);
        const averageCost = totalCost / results.length;
        const minCost = Math.min(...costs);
        const maxCost = Math.max(...costs);

        const bestCostModel = results.find(r => r.actualCost === minCost)?.modelUsed || '';

        return {
            results,
            bestCostModel,
            summary: {
                totalCost,
                averageCost,
                costRange: { min: minCost, max: maxCost }
            }
        };
    }

    /**
     * Fill template with variables
     */
    private static fillTemplate(
        template: IPromptTemplate,
        variables: Record<string, any>
    ): string {
        let filledContent = template.content;

        // Replace variables
        if (template.variables && template.variables.length > 0) {
            for (const variable of template.variables) {
                const value = variables[variable.name] || variable.defaultValue || '';
                
                if (variable.required && !value) {
                    throw new Error(`Required variable missing: ${variable.name}`);
                }

                const regex = new RegExp(`{{${variable.name}}}`, 'g');
                filledContent = filledContent.replace(regex, value);
            }
        }

        return filledContent;
    }

    /**
     * Calculate actual cost based on token usage and model
     */
    private static async calculateActualCost(
        promptTokens: number,
        completionTokens: number,
        modelId: string
    ): Promise<number> {
        // Get model pricing from ModelRecommendationService
        const allModels = ModelRecommendationService.getAllModels();
        const modelPricing = allModels.find(m => m.modelId === modelId);

        if (!modelPricing) {
            loggingService.warn('Model pricing not found, using default', { modelId });
            return 0.001; // Default minimal cost
        }

        // Calculate cost (pricing is per 1M tokens)
        const inputCost = (promptTokens / 1_000_000) * modelPricing.pricing.input;
        const outputCost = (completionTokens / 1_000_000) * modelPricing.pricing.output;

        return inputCost + outputCost;
    }

    /**
     * Track usage in main Usage collection
     */
    private static async trackUsage(
        userId: string,
        modelId: string,
        prompt: string,
        completion: string,
        promptTokens: number,
        completionTokens: number,
        templateExecutionId: any
    ): Promise<void> {
        try {
            await AICostTrackerService.trackRequestInternal(
                {
                    prompt,
                    promptTokens,
                    model: modelId
                },
                {
                    content: completion,
                    usage: {
                        promptTokens,
                        completionTokens,
                        totalTokens: promptTokens + completionTokens
                    }
                },
                userId,
                {
                    service: this.getServiceForModel(modelId),
                    endpoint: 'template-execution'
                }
            );
        } catch (error) {
            loggingService.error('Failed to track usage', {
                error: error instanceof Error ? error.message : String(error),
                templateExecutionId
            });
        }
    }

    /**
     * Get service name for model
     */
    private static getServiceForModel(modelId: string): string {
        if (modelId.startsWith('gpt-')) return 'openai';
        if (modelId.startsWith('anthropic.')) return 'anthropic';
        if (modelId.startsWith('amazon.')) return 'bedrock';
        if (modelId.startsWith('gemini')) return 'gemini';
        return 'unknown';
    }

    /**
     * Update template execution statistics
     */
    private static async updateTemplateStats(
        templateId: any,
        actualCost: number,
        savingsAmount: number,
        modelUsed: string
    ): Promise<void> {
        try {
            await PromptTemplate.findByIdAndUpdate(
                templateId,
                {
                    $inc: {
                        'executionStats.totalExecutions': 1,
                        'executionStats.totalCostSavings': savingsAmount
                    },
                    $set: {
                        'executionStats.lastExecutedAt': new Date(),
                        'executionStats.mostUsedModel': modelUsed,
                        'executionStats.averageCost': actualCost // Will be recalculated properly later
                    }
                },
                { upsert: true }
            );
        } catch (error) {
            loggingService.error('Failed to update template stats', {
                error: error instanceof Error ? error.message : String(error),
                templateId
            });
        }
    }

    /**
     * Track activity for template execution
     */
    private static async trackActivity(
        userId: string,
        template: IPromptTemplate,
        execution: ITemplateExecution
    ): Promise<void> {
        try {
            await ActivityService.trackActivity(userId, {
                type: 'template_used',
                title: 'Template Executed',
                description: `Executed template "${template.name}" with ${execution.modelUsed}. Saved $${execution.savingsAmount.toFixed(4)} (${execution.savingsPercentage.toFixed(1)}%)`,
                metadata: {
                    templateId: template._id,
                    templateName: template.name,
                    executionId: execution._id,
                    modelUsed: execution.modelUsed,
                    savingsAmount: execution.savingsAmount,
                    savingsPercentage: execution.savingsPercentage
                }
            });
        } catch (error) {
            loggingService.warn('Failed to track activity', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Get execution history for a template
     */
    static async getExecutionHistory(
        templateId: string,
        userId: string,
        limit: number = 10
    ): Promise<any[]> {
        try {
            const executions = await TemplateExecution.find({
                templateId,
                userId
            })
                .sort({ executedAt: -1 })
                .limit(limit)
                .lean();

            return executions;
        } catch (error) {
            loggingService.error('Failed to get execution history', {
                error: error instanceof Error ? error.message : String(error),
                templateId,
                userId
            });
            return [];
        }
    }

    /**
     * Get execution statistics for a template
     */
    static async getExecutionStats(templateId: string): Promise<{
        totalExecutions: number;
        totalCostSavings: number;
        averageCost: number;
        averageSavings: number;
        mostUsedModel: string;
        modelDistribution: Record<string, number>;
    }> {
        try {
            const executions = await TemplateExecution.find({ templateId }).lean();

            if (executions.length === 0) {
                return {
                    totalExecutions: 0,
                    totalCostSavings: 0,
                    averageCost: 0,
                    averageSavings: 0,
                    mostUsedModel: '',
                    modelDistribution: {}
                };
            }

            const totalCostSavings = executions.reduce((sum, e) => sum + e.savingsAmount, 0);
            const averageCost = executions.reduce((sum, e) => sum + e.actualCost, 0) / executions.length;
            const averageSavings = totalCostSavings / executions.length;

            // Model distribution
            const modelCounts: Record<string, number> = {};
            for (const execution of executions) {
                modelCounts[execution.modelUsed] = (modelCounts[execution.modelUsed] || 0) + 1;
            }

            const mostUsedModel = Object.entries(modelCounts)
                .sort(([, a], [, b]) => b - a)[0]?.[0] || '';

            return {
                totalExecutions: executions.length,
                totalCostSavings,
                averageCost,
                averageSavings,
                mostUsedModel,
                modelDistribution: modelCounts
            };
        } catch (error) {
            loggingService.error('Failed to get execution stats', {
                error: error instanceof Error ? error.message : String(error),
                templateId
            });
            throw error;
        }
    }
}

