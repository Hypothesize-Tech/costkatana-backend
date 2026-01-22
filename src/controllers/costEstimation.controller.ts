import { Request, Response } from 'express';
import { loggingService } from '@services/logging.service';
import { TokenEstimator } from '@utils/tokenEstimator';
import { 
    getModelPricing, 
    estimateCost, 
    formatCurrency
} from '@utils/pricing';
import { ControllerHelper } from '@utils/controllerHelper';

export class CostEstimationController {
    // Cost Calculator Tool
    static async calculateCosts(req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            const { 
                provider, 
                model, 
                inputTokens, 
                outputTokens, 
                requestsPerDay = 1,
                daysPerMonth = 30 
            } = req.body;

            if (!provider || !model || !inputTokens || !outputTokens) {
                res.status(400).json({
                    success: false,
                    error: 'Provider, model, inputTokens, and outputTokens are required'
                });
                return;
            }

            const modelPricing = getModelPricing(provider, model);
            if (!modelPricing) {
                res.status(404).json({
                    success: false,
                    error: `Model ${model} not found for provider ${provider}`
                });
                return;
            }

            const singleRequestCost = estimateCost(inputTokens, outputTokens, provider, model);
            const dailyCost = singleRequestCost.totalCost * requestsPerDay;
            const monthlyCost = dailyCost * daysPerMonth;
            const yearlyCost = monthlyCost * 12;

            // Cost breakdown by token type
            const tokenBreakdown = {
                inputCostPerToken: modelPricing.inputPrice / 1_000_000,
                outputCostPerToken: modelPricing.outputPrice / 1_000_000,
                inputCostPerRequest: singleRequestCost.inputCost,
                outputCostPerRequest: singleRequestCost.outputCost
            };

            // Volume discounts
            const volumeDiscounts = [];
            if (monthlyCost > 1000) {
                volumeDiscounts.push({ threshold: 1000, discount: 5, savings: monthlyCost * 0.05 });
            }
            if (monthlyCost > 10000) {
                volumeDiscounts.push({ threshold: 10000, discount: 10, savings: monthlyCost * 0.10 });
            }

            loggingService.info('Costs calculated successfully', {
                duration: Date.now() - startTime,
                model: `${provider}/${model}`,
                monthlyCost
            });

            res.json({
                success: true,
                data: {
                    model: {
                        provider,
                        modelId: model,
                        modelName: modelPricing.modelName,
                        inputPrice: modelPricing.inputPrice,
                        outputPrice: modelPricing.outputPrice
                    },
                    usage: {
                        inputTokens,
                        outputTokens,
                        requestsPerDay,
                        daysPerMonth
                    },
                    costs: {
                        perRequest: {
                            input: singleRequestCost.inputCost,
                            output: singleRequestCost.outputCost,
                            total: singleRequestCost.totalCost,
                            formatted: {
                                input: formatCurrency(singleRequestCost.inputCost),
                                output: formatCurrency(singleRequestCost.outputCost),
                                total: formatCurrency(singleRequestCost.totalCost)
                            }
                        },
                        daily: {
                            total: dailyCost,
                            formatted: formatCurrency(dailyCost)
                        },
                        monthly: {
                            total: monthlyCost,
                            formatted: formatCurrency(monthlyCost)
                        },
                        yearly: {
                            total: yearlyCost,
                            formatted: formatCurrency(yearlyCost)
                        }
                    },
                    tokenBreakdown,
                    volumeDiscounts,
                    lastUpdated: new Date()
                }
            });
        } catch (error) {
            ControllerHelper.handleError('calculateCosts', error, req as any, res, startTime);
        }
    }

    // Token Analyzer Tool
    static async analyzeTokens(req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            const { text, models = [] } = req.body;

            if (!text) {
                res.status(400).json({
                    success: false,
                    error: 'Text is required for token analysis'
                });
                return;
            }

            // Token estimation using centralized utility
            const estimatedTokens = TokenEstimator.estimate(text);
            const wordCount = text.split(/\s+/).length;
            const charCount = text.length;

            // Analyze costs across different models
            const modelAnalysis = [];
            
            for (const modelInfo of models) {
                const { provider, modelId, outputTokens = estimatedTokens } = modelInfo;
                const modelPricing = getModelPricing(provider, modelId);
                
                if (modelPricing) {
                    const costs = estimateCost(estimatedTokens, outputTokens, provider, modelId);
                    modelAnalysis.push({
                        provider,
                        modelId,
                        modelName: modelPricing.modelName,
                        inputTokens: estimatedTokens,
                        outputTokens,
                        costs: {
                            input: costs.inputCost,
                            output: costs.outputCost,
                            total: costs.totalCost,
                            formatted: {
                                input: formatCurrency(costs.inputCost),
                                output: formatCurrency(costs.outputCost),
                                total: formatCurrency(costs.totalCost)
                            }
                        },
                        efficiency: {
                            costPerToken: costs.totalCost / (estimatedTokens + outputTokens),
                            costPerWord: costs.totalCost / wordCount,
                            costPerChar: costs.totalCost / charCount
                        }
                    });
                }
            }

            // Find most cost-effective model
            const sortedByEfficiency = modelAnalysis.sort((a, b) => a.costs.total - b.costs.total);
            const mostEfficient = sortedByEfficiency[0];
            const leastEfficient = sortedByEfficiency[sortedByEfficiency.length - 1];

            // Token optimization suggestions
            const suggestions = [];
            if (estimatedTokens > 1000) {
                suggestions.push("Consider breaking down large texts into smaller chunks for better cost efficiency");
            }
            if (wordCount / estimatedTokens < 0.6) {
                suggestions.push("Text appears to have many technical terms or special characters - actual token count may be higher");
            }
            suggestions.push("Use prompt engineering to reduce output tokens needed");
            suggestions.push("Consider caching responses for repeated similar inputs");

            loggingService.info('Token analysis completed', {
                duration: Date.now() - startTime,
                estimatedTokens,
                modelsAnalyzed: modelAnalysis.length
            });

            res.json({
                success: true,
                data: {
                    textAnalysis: {
                        charCount,
                        wordCount,
                        estimatedTokens,
                        averageTokensPerWord: estimatedTokens / wordCount,
                        averageCharsPerToken: charCount / estimatedTokens
                    },
                    modelAnalysis,
                    comparison: {
                        mostEfficient: mostEfficient ? {
                            model: `${mostEfficient.provider} ${mostEfficient.modelName}`,
                            cost: mostEfficient.costs.formatted.total
                        } : null,
                        leastEfficient: leastEfficient ? {
                            model: `${leastEfficient.provider} ${leastEfficient.modelName}`,
                            cost: leastEfficient.costs.formatted.total
                        } : null,
                        potentialSavings: mostEfficient && leastEfficient ? 
                            formatCurrency(leastEfficient.costs.total - mostEfficient.costs.total) : null
                    },
                    suggestions,
                    lastUpdated: new Date()
                }
            });
        } catch (error) {
            ControllerHelper.handleError('analyzeTokens', error, req as any, res, startTime);
        }
    }
}
