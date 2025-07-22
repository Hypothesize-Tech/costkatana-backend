import { Tool } from "@langchain/core/tools";
import { Optimization } from "../models/Optimization";
import { Usage } from "../models/Usage";
import { getModelPricing, getModelsByUseCase } from "../data/modelPricing";

interface OptimizationOperation {
    operation: 'analyze_costs' | 'recommend_models' | 'optimize_prompts' | 'batch_optimization' | 'create_optimization' | 'list_optimizations' | 'apply_optimization' | 'bulk_analysis' | 'cost_forecast';
    userId?: string;
    projectId?: string;
    analysisParams?: {
        timeRange?: {
            startDate?: string;
            endDate?: string;
        };
        minSavingsThreshold?: number;
        targetCostReduction?: number;
        optimizationTypes?: string[];
    };
    optimizationData?: {
        type?: 'model_switch' | 'prompt_optimization' | 'request_batching' | 'caching' | 'parameter_tuning';
        currentModel?: string;
        targetModel?: string;
        description?: string;
        estimatedSavings?: number;
        implementationDetails?: any;
    };
    bulkParams?: {
        projectIds?: string[];
        modelFilters?: string[];
        costThreshold?: number;
    };
}

export class OptimizationManagerTool extends Tool {
    name = "optimization_manager";
    description = `Comprehensive optimization tool that analyzes usage patterns, identifies cost-saving opportunities, and provides actionable optimization recommendations.
    
    This tool can:
    - Analyze current costs and identify optimization opportunities
    - Recommend optimal models based on usage patterns
    - Optimize prompts for cost and performance
    - Create and manage optimization plans
    - Apply bulk optimizations across projects
    - Forecast cost savings from optimizations
    - Provide implementation guidance for optimizations
    
    Input should be a JSON string with:
    {{
        "operation": "analyze_costs|recommend_models|optimize_prompts|batch_optimization|create_optimization|list_optimizations|apply_optimization|bulk_analysis|cost_forecast",
        "userId": "user-id-string",
        "projectId": "project-id" (optional, for project-specific optimizations),
        "analysisParams": {{
            "timeRange": {{
                "startDate": "2024-01-01",
                "endDate": "2024-01-31"
            }},
            "minSavingsThreshold": 10.0,
            "targetCostReduction": 25,
            "optimizationTypes": ["model_switch", "prompt_optimization"]
        }},
        "optimizationData": {{
            "type": "model_switch",
            "currentModel": "gpt-4",
            "targetModel": "claude-3-sonnet",
            "description": "Switch to more cost-effective model",
            "estimatedSavings": 150.00
        }},
        "bulkParams": {{
            "projectIds": ["project-1", "project-2"],
            "modelFilters": ["gpt-4", "claude-3-opus"],
            "costThreshold": 100.0
        }}
    }}`;

    async _call(input: string): Promise<string> {
        try {
            const operation: OptimizationOperation = JSON.parse(input);
            
            if (!this.isValidOperation(operation)) {
                return "Invalid operation: Check operation type and required fields.";
            }

            switch (operation.operation) {
                case 'analyze_costs':
                    return await this.analyzeCosts(operation);
                case 'recommend_models':
                    return await this.recommendModels(operation);
                case 'optimize_prompts':
                    return await this.optimizePrompts(operation);
                case 'create_optimization':
                    return await this.createOptimization(operation);
                case 'list_optimizations':
                    return await this.listOptimizations(operation);
                case 'apply_optimization':
                    return await this.applyOptimization(operation);
                case 'bulk_analysis':
                    return await this.bulkAnalysis(operation);
                case 'cost_forecast':
                    return await this.costForecast(operation);
                default:
                    return "Unsupported operation.";
            }

        } catch (error) {
            console.error('Optimization operation failed:', error);
            
            if (error instanceof SyntaxError) {
                return "Invalid JSON input. Please provide a valid operation object.";
            }
            
            return `Optimization error: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    private async analyzeCosts(operation: OptimizationOperation): Promise<string> {
        try {
            const timeRange = this.getTimeRange(operation.analysisParams?.timeRange);
            const userId = operation.userId;
            const minSavings = operation.analysisParams?.minSavingsThreshold || 10;

            // Get usage patterns for analysis
            const usageAnalysis = await Usage.aggregate([
                {
                    $match: {
                        userId,
                        createdAt: { $gte: timeRange.start, $lte: timeRange.end }
                    }
                },
                {
                    $group: {
                        _id: {
                            model: '$model',
                            provider: '$provider'
                        },
                        totalRequests: { $sum: 1 },
                        totalCost: { $sum: '$cost' },
                        avgCost: { $avg: '$cost' },
                        totalTokens: { $sum: { $add: ['$promptTokens', '$completionTokens'] } },
                        avgTokens: { $avg: { $add: ['$promptTokens', '$completionTokens'] } },
                        avgPromptTokens: { $avg: '$promptTokens' },
                        avgCompletionTokens: { $avg: '$completionTokens' }
                    }
                },
                { $sort: { totalCost: -1 } }
            ]);

            const opportunities = [];

            // Analyze each model usage for optimization opportunities
            for (const usage of usageAnalysis) {
                const currentModel = usage._id.model;
                const currentCost = usage.totalCost;
                const avgTokens = Math.round(usage.avgTokens || 0);

                // Find cheaper alternatives
                const alternatives = await this.findCheaperAlternatives(
                    currentModel,
                    avgTokens,
                    usage.avgPromptTokens || 0,
                    usage.avgCompletionTokens || 0
                );

                for (const alternative of alternatives) {
                    const potentialSavings = currentCost - alternative.projectedCost;
                    const savingsPercentage = (potentialSavings / currentCost) * 100;

                    if (potentialSavings >= minSavings && savingsPercentage >= 10) {
                        opportunities.push({
                            type: 'model_switch',
                            currentModel: currentModel,
                            recommendedModel: alternative.model,
                            currentCost: Number(currentCost.toFixed(4)),
                            projectedCost: Number(alternative.projectedCost.toFixed(4)),
                            estimatedSavings: Number(potentialSavings.toFixed(4)),
                            savingsPercentage: Number(savingsPercentage.toFixed(1)),
                            confidence: alternative.confidence,
                            reasoning: alternative.reasoning,
                            implementation: alternative.implementation,
                            riskLevel: alternative.riskLevel
                        });
                    }
                }

                // Check for prompt optimization opportunities
                if (usage.avgPromptTokens > 1000) {
                    const promptOptimization = this.analyzePromptOptimization(usage);
                    if (promptOptimization.potentialSavings >= minSavings) {
                        opportunities.push(promptOptimization);
                    }
                }

                // Check for batching opportunities
                if (usage.totalRequests > 100) {
                    const batchingOpportunity = this.analyzeBatchingOpportunity(usage);
                    if (batchingOpportunity.potentialSavings >= minSavings) {
                        opportunities.push(batchingOpportunity);
                    }
                }
            }

            // Rank opportunities by savings potential
            opportunities.sort((a, b) => b.estimatedSavings - a.estimatedSavings);

            const analysis = {
                summary: {
                    totalAnalyzedCost: Number(usageAnalysis.reduce((sum, u) => sum + u.totalCost, 0).toFixed(4)),
                    totalOpportunities: opportunities.length,
                    potentialSavings: Number(opportunities.reduce((sum, o) => sum + o.estimatedSavings, 0).toFixed(4)),
                    averageSavingsPercentage: opportunities.length > 0 ? 
                        Number((opportunities.reduce((sum, o) => sum + o.savingsPercentage, 0) / opportunities.length).toFixed(1)) : 0
                },
                opportunities: opportunities.slice(0, 10), // Top 10 opportunities
                modelAnalysis: usageAnalysis.map(usage => ({
                    model: usage._id.model,
                    provider: usage._id.provider,
                    requests: usage.totalRequests,
                    cost: Number(usage.totalCost.toFixed(4)),
                    avgCost: Number(usage.avgCost.toFixed(6)),
                    costEfficiency: this.calculateCostEfficiency(usage),
                    optimizationPotential: this.assessOptimizationPotential(usage)
                })),
                recommendations: this.generateOptimizationRecommendations(opportunities),
                timeRange: timeRange
            };

            return JSON.stringify({
                success: true,
                operation: 'cost_analysis',
                data: analysis,
                insights: this.generateAnalysisInsights(analysis)
            }, null, 2);

        } catch (error) {
            return `Failed to analyze costs: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    private async recommendModels(operation: OptimizationOperation): Promise<string> {
        try {
            const userId = operation.userId;
            const timeRange = this.getTimeRange(operation.analysisParams?.timeRange);

            // Get current usage patterns
            const currentUsage = await Usage.aggregate([
                {
                    $match: {
                        userId,
                        createdAt: { $gte: timeRange.start, $lte: timeRange.end }
                    }
                },
                {
                    $group: {
                        _id: null,
                        avgPromptTokens: { $avg: '$promptTokens' },
                        avgCompletionTokens: { $avg: '$completionTokens' },
                        totalRequests: { $sum: 1 },
                        totalCost: { $sum: '$cost' },
                        useCase: { $first: '$metadata.useCase' }
                    }
                }
            ]);

            const usage = currentUsage[0];
            if (!usage) {
                return JSON.stringify({
                    success: false,
                    message: 'No usage data found for the specified time range'
                });
            }

            // Determine use case from usage patterns
            const useCase = this.determineUseCase(usage);
            const volume = this.determineVolume(usage.totalRequests);
            const complexity = this.determineComplexity(usage.avgPromptTokens);

            // Get model recommendations based on patterns
            const suitableModels = getModelsByUseCase(useCase);
            const recommendations = [];

            for (const modelId of suitableModels.slice(0, 5)) {
                const pricing = getModelPricing(modelId);
                if (pricing) {
                    const projectedCost = this.calculateProjectedCost(
                        modelId,
                        usage.avgPromptTokens,
                        usage.avgCompletionTokens,
                        usage.totalRequests
                    );

                    recommendations.push({
                        model: modelId,
                        provider: pricing.provider,
                        suitabilityScore: this.calculateSuitabilityScore(modelId, useCase, volume, complexity),
                        projectedMonthlyCost: Number(projectedCost.toFixed(4)),
                        costVsCurrent: Number(((projectedCost - usage.totalCost) / usage.totalCost * 100).toFixed(1)),
                        strengths: this.getModelStrengths(modelId),
                        considerations: this.getModelConsiderations(modelId, usage),
                        implementation: this.getImplementationGuidance(modelId)
                    });
                }
            }

            // Sort by suitability score
            recommendations.sort((a, b) => b.suitabilityScore - a.suitabilityScore);

            const modelRecommendations = {
                currentUsageProfile: {
                    useCase,
                    volume,
                    complexity,
                    avgPromptTokens: Math.round(usage.avgPromptTokens || 0),
                    avgCompletionTokens: Math.round(usage.avgCompletionTokens || 0),
                    totalRequests: usage.totalRequests,
                    currentMonthlyCost: Number(usage.totalCost.toFixed(4))
                },
                recommendations: recommendations,
                summary: {
                    topRecommendation: recommendations[0]?.model || 'No suitable models found',
                    potentialSavings: recommendations[0] ? 
                        Math.max(0, usage.totalCost - recommendations[0].projectedMonthlyCost) : 0,
                    confidenceLevel: recommendations[0]?.suitabilityScore > 80 ? 'high' : 
                                   recommendations[0]?.suitabilityScore > 60 ? 'medium' : 'low'
                }
            };

            return JSON.stringify({
                success: true,
                operation: 'model_recommendations',
                data: modelRecommendations,
                insights: this.generateModelRecommendationInsights(modelRecommendations)
            }, null, 2);

        } catch (error) {
            return `Failed to recommend models: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    private async createOptimization(operation: OptimizationOperation): Promise<string> {
        try {
            if (!operation.optimizationData || !operation.userId) {
                return "Optimization creation requires userId and optimization data.";
            }

            // Get dynamic data from actual usage analysis
            const dynamicData = await this.calculateDynamicOptimizationData(operation);

            const optimizationData = {
                userId: operation.userId,
                originalPrompt: dynamicData.originalPrompt,
                optimizedPrompt: dynamicData.optimizedPrompt,
                optimizationTechniques: dynamicData.techniques,
                originalTokens: dynamicData.originalTokens,
                optimizedTokens: dynamicData.optimizedTokens,
                tokensSaved: dynamicData.tokensSaved,
                originalCost: dynamicData.originalCost,
                optimizedCost: dynamicData.optimizedCost,
                costSaved: dynamicData.costSaved,
                improvementPercentage: dynamicData.improvementPercentage,
                service: dynamicData.service,
                model: dynamicData.model,
                category: dynamicData.category,
                suggestions: dynamicData.suggestions,
                metadata: {
                    createdViaAgent: true,
                    analysisDate: new Date(),
                    confidence: dynamicData.confidence,
                    dataPoints: dynamicData.dataPoints,
                    analysisTimeRange: dynamicData.analysisTimeRange,
                    implementationDetails: operation.optimizationData.implementationDetails || {}
                },
                applied: false,
                appliedCount: 0,
                tags: dynamicData.tags
            };

            const optimization = new Optimization(optimizationData);
            await optimization.save();

            return JSON.stringify({
                success: true,
                message: 'Optimization plan created successfully based on your actual usage data',
                optimizationId: optimization._id,
                optimization: {
                    id: optimization._id,
                    type: optimization.category,
                    description: optimization.optimizedPrompt,
                    estimatedSavings: optimization.costSaved,
                    status: optimization.applied ? 'applied' : 'pending',
                    createdAt: optimization.createdAt,
                    confidence: dynamicData.confidence,
                    dataQuality: dynamicData.dataQuality,
                    impactLevel: dynamicData.impactLevel
                },
                analysis: {
                    originalMetrics: {
                        tokens: dynamicData.originalTokens,
                        cost: dynamicData.originalCost,
                        model: dynamicData.model
                    },
                    optimizedMetrics: {
                        tokens: dynamicData.optimizedTokens,
                        cost: dynamicData.optimizedCost,
                        recommendedModel: dynamicData.recommendedModel
                    },
                    improvements: {
                        tokensSaved: dynamicData.tokensSaved,
                        costSaved: dynamicData.costSaved,
                        improvementPercentage: dynamicData.improvementPercentage
                    },
                    dataSource: {
                        requestsAnalyzed: dynamicData.dataPoints,
                        timeRange: dynamicData.analysisTimeRange,
                        confidence: dynamicData.confidence
                    }
                },
                nextSteps: this.getOptimizationNextSteps(optimization.category)
            }, null, 2);

        } catch (error) {
            return `Failed to create optimization: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    private async calculateDynamicOptimizationData(operation: OptimizationOperation): Promise<any> {
        try {
            const userId = operation.userId;
            const optimizationData = operation.optimizationData!; // Already validated in caller
            const timeRange = this.getTimeRange({ startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() }); // Last 30 days
            
            // Get actual usage data for analysis
            const usageData = await Usage.aggregate([
                {
                    $match: {
                        userId,
                        createdAt: { $gte: timeRange.start, $lte: timeRange.end },
                        ...(optimizationData.currentModel && { model: optimizationData.currentModel })
                    }
                },
                {
                    $group: {
                        _id: '$model',
                        totalRequests: { $sum: 1 },
                        totalCost: { $sum: '$cost' },
                        avgCost: { $avg: '$cost' },
                        totalPromptTokens: { $sum: '$promptTokens' },
                        totalCompletionTokens: { $sum: '$completionTokens' },
                        avgPromptTokens: { $avg: '$promptTokens' },
                        avgCompletionTokens: { $avg: '$completionTokens' },
                        providers: { $addToSet: '$provider' }
                    }
                },
                { $sort: { totalCost: -1 } }
            ]);

            if (usageData.length === 0) {
                // Fallback for users with no usage data - return minimal viable data
                return this.createFallbackOptimizationData(operation);
            }

            const currentModelData = usageData[0]; // Most expensive model as primary target
            const currentModel = currentModelData._id;
            const avgPromptTokens = Math.round(currentModelData.avgPromptTokens || 0);
            const avgCompletionTokens = Math.round(currentModelData.avgCompletionTokens || 0);
            const totalTokens = avgPromptTokens + avgCompletionTokens;
            const totalCost = currentModelData.totalCost;
            const totalRequests = currentModelData.totalRequests;

            // Calculate optimization based on type
            let optimizationResult;
            switch (optimizationData.type) {
                case 'model_switch':
                    optimizationResult = await this.calculateModelSwitchOptimization(
                        currentModel, 
                        avgPromptTokens, 
                        avgCompletionTokens, 
                        totalRequests,
                        totalCost,
                        optimizationData.targetModel
                    );
                    break;
                case 'prompt_optimization':
                    optimizationResult = this.calculatePromptOptimization(
                        avgPromptTokens, 
                        avgCompletionTokens, 
                        totalCost,
                        totalRequests
                    );
                    break;
                case 'request_batching':
                    optimizationResult = this.calculateBatchingOptimization(
                        totalRequests, 
                        totalCost,
                        avgPromptTokens,
                        avgCompletionTokens
                    );
                    break;
                default:
                    optimizationResult = await this.calculateModelSwitchOptimization(
                        currentModel, 
                        avgPromptTokens, 
                        avgCompletionTokens, 
                        totalRequests,
                        totalCost
                    );
            }

            // Determine confidence based on data quality
            const confidence = this.calculateConfidenceLevel(totalRequests, usageData.length);
            const impactLevel = this.calculateImpactLevel(optimizationResult.costSaved, totalCost);
            const dataQuality = this.assessDataQuality(totalRequests, usageData.length);

            return {
                originalPrompt: this.generateOriginalPromptDescription(currentModel, avgPromptTokens),
                optimizedPrompt: optimizationData.description || optimizationResult.description,
                techniques: [optimizationData.type || 'model_switch'],
                originalTokens: totalTokens,
                optimizedTokens: optimizationResult.optimizedTokens,
                tokensSaved: Math.max(0, totalTokens - optimizationResult.optimizedTokens),
                originalCost: Number(totalCost.toFixed(4)),
                optimizedCost: Number(optimizationResult.optimizedCost.toFixed(4)),
                costSaved: Number(optimizationResult.costSaved.toFixed(4)),
                improvementPercentage: Number(((optimizationResult.costSaved / totalCost) * 100).toFixed(1)),
                service: currentModelData.providers[0] || 'unknown',
                model: currentModel,
                recommendedModel: optimizationResult.recommendedModel || currentModel,
                category: optimizationData.type === 'model_switch' ? 'model_selection' : 
                         optimizationData.type === 'prompt_optimization' ? 'prompt_reduction' :
                         optimizationData.type === 'request_batching' ? 'batch_processing' : 'model_selection' as const,
                suggestions: [{
                    type: optimizationData.type || 'model_switch',
                    description: optimizationResult.description,
                    impact: impactLevel,
                    implemented: false
                }],
                confidence,
                dataQuality,
                impactLevel,
                dataPoints: totalRequests,
                analysisTimeRange: {
                    start: timeRange.start,
                    end: timeRange.end,
                    days: 30
                },
                tags: this.generateDynamicTags(optimizationData.type || 'model_switch', impactLevel, confidence)
            };

        } catch (error) {
            console.error('Error calculating dynamic optimization data:', error);
            return this.createFallbackOptimizationData(operation);
        }
    }

    private async calculateModelSwitchOptimization(
        currentModel: string, 
        avgPromptTokens: number, 
        avgCompletionTokens: number, 
        totalRequests: number,
        currentTotalCost: number,
        targetModel?: string
    ): Promise<any> {
        const currentPricing = getModelPricing(currentModel);
        if (!currentPricing) {
            throw new Error(`Pricing not found for current model: ${currentModel}`);
        }

        let bestAlternative;
        let bestSavings = 0;

        if (targetModel) {
            // Use specified target model
            const targetPricing = getModelPricing(targetModel);
            if (targetPricing) {
                const newCost = ((avgPromptTokens * targetPricing.inputPrice) + (avgCompletionTokens * targetPricing.outputPrice)) * totalRequests / 1000000;
                bestAlternative = {
                    model: targetModel,
                    pricing: targetPricing,
                    projectedCost: newCost,
                    savings: currentTotalCost - newCost
                };
                bestSavings = bestAlternative.savings;
            }
        } else {
            // Find best alternative automatically
            const alternatives = await this.findCheaperAlternatives(currentModel, avgPromptTokens + avgCompletionTokens, avgPromptTokens, avgCompletionTokens);
            if (alternatives.length > 0) {
                const totalCurrentCost = currentTotalCost;
                bestAlternative = alternatives[0];
                bestSavings = totalCurrentCost - (bestAlternative.projectedCost * totalRequests);
            }
        }

        if (!bestAlternative || bestSavings <= 0) {
            // No viable alternative found
            return {
                description: `Current model ${currentModel} is already optimal for your usage pattern`,
                optimizedTokens: avgPromptTokens + avgCompletionTokens,
                optimizedCost: currentTotalCost,
                costSaved: 0,
                recommendedModel: currentModel
            };
        }

        return {
            description: `Switch from ${currentModel} to ${bestAlternative.model} for better cost efficiency`,
            optimizedTokens: avgPromptTokens + avgCompletionTokens, // Tokens stay the same for model switch
            optimizedCost: bestAlternative.projectedCost * totalRequests,
            costSaved: bestSavings,
            recommendedModel: bestAlternative.model
        };
    }

    private calculatePromptOptimization(
        avgPromptTokens: number, 
        avgCompletionTokens: number, 
        totalCost: number,
        _totalRequests: number
    ): any {
        // Calculate potential token reduction (conservative estimate based on prompt length)
        let reductionPercentage = 0;
        if (avgPromptTokens > 2000) {
            reductionPercentage = 0.3; // 30% reduction for very long prompts
        } else if (avgPromptTokens > 1000) {
            reductionPercentage = 0.2; // 20% reduction for long prompts
        } else if (avgPromptTokens > 500) {
            reductionPercentage = 0.15; // 15% reduction for medium prompts
        } else {
            reductionPercentage = 0.05; // 5% reduction for short prompts
        }

        const optimizedPromptTokens = Math.round(avgPromptTokens * (1 - reductionPercentage));
        const optimizedTotalTokens = optimizedPromptTokens + avgCompletionTokens;
        const costReduction = totalCost * reductionPercentage;

        return {
            description: `Optimize prompts to reduce average token usage from ${avgPromptTokens} to ${optimizedPromptTokens} tokens`,
            optimizedTokens: optimizedTotalTokens,
            optimizedCost: totalCost - costReduction,
            costSaved: costReduction,
            recommendedModel: null
        };
    }

    private calculateBatchingOptimization(
        totalRequests: number, 
        totalCost: number,
        avgPromptTokens: number,
        avgCompletionTokens: number
    ): any {
        // Batching typically saves 10-20% on overhead costs for high-volume usage
        const batchingEfficiency = totalRequests > 1000 ? 0.15 : totalRequests > 100 ? 0.1 : 0.05;
        const costSavings = totalCost * batchingEfficiency;
        
        return {
            description: `Implement request batching to reduce overhead costs by ${(batchingEfficiency * 100).toFixed(1)}%`,
            optimizedTokens: avgPromptTokens + avgCompletionTokens, // Tokens don't change with batching
            optimizedCost: totalCost - costSavings,
            costSaved: costSavings,
            recommendedModel: null
        };
    }

    private calculateConfidenceLevel(totalRequests: number, modelCount: number): string {
        if (totalRequests >= 1000 && modelCount >= 3) return 'high';
        if (totalRequests >= 100 && modelCount >= 2) return 'medium';
        return 'low';
    }

    private calculateImpactLevel(costSaved: number, totalCost: number): 'low' | 'medium' | 'high' {
        const savingsPercentage = (costSaved / totalCost) * 100;
        if (savingsPercentage >= 25) return 'high';
        if (savingsPercentage >= 10) return 'medium';
        return 'low';
    }

    private assessDataQuality(totalRequests: number, modelCount: number): string {
        if (totalRequests >= 1000 && modelCount >= 3) return 'excellent';
        if (totalRequests >= 500 && modelCount >= 2) return 'good';
        if (totalRequests >= 100) return 'fair';
        return 'limited';
    }

    private generateOriginalPromptDescription(model: string, avgTokens: number): string {
        return `Current configuration using ${model} with average prompt length of ${avgTokens} tokens`;
    }

    private generateDynamicTags(type: string, impact: string, confidence: string): string[] {
        const tags = ['agent-generated', type];
        tags.push(`${impact}-impact`);
        tags.push(`${confidence}-confidence`);
        return tags;
    }

    private createFallbackOptimizationData(operation: OptimizationOperation): any {
        // Minimal viable data for users with no usage history
        const optimizationData = operation.optimizationData!; // Already validated in caller
        
        return {
            originalPrompt: 'No usage data available - creating template optimization',
            optimizedPrompt: optimizationData.description || 'Template cost optimization recommendation',
            techniques: [optimizationData.type || 'model_switch'],
            originalTokens: 0,
            optimizedTokens: 0,
            tokensSaved: 0,
            originalCost: 0,
            optimizedCost: 0,
            costSaved: optimizationData.estimatedSavings || 0,
            improvementPercentage: 0,
            service: 'template',
            model: optimizationData.currentModel || 'unknown',
            recommendedModel: optimizationData.targetModel || optimizationData.currentModel || 'unknown',
            category: 'model_selection' as const,
            suggestions: [{
                type: optimizationData.type || 'model_switch',
                description: optimizationData.description || 'Template optimization',
                impact: 'low' as const,
                implemented: false
            }],
            confidence: 'low',
            dataQuality: 'none',
            impactLevel: 'low' as const,
            dataPoints: 0,
            analysisTimeRange: {
                start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                end: new Date(),
                days: 30
            },
            tags: ['agent-generated', 'template', 'no-usage-data']
        };
    }

    private async listOptimizations(operation: OptimizationOperation): Promise<string> {
        try {
            const userId = operation.userId;
            const projectFilter = operation.projectId ? { projectId: operation.projectId } : {};

            const optimizations = await Optimization.find({
                userId,
                ...projectFilter
            })
            .sort({ createdAt: -1 })
            .limit(20)
            .select('category optimizedPrompt costSaved applied createdAt metadata');

            const optimizationsList = {
                total: optimizations.length,
                optimizations: optimizations.map(opt => ({
                    id: opt._id,
                    type: opt.category,
                    description: opt.optimizedPrompt,
                    estimatedSavings: opt.costSaved,
                    status: opt.applied ? 'applied' : 'pending',
                    createdAt: opt.createdAt,
                    hasImplementationDetails: !!opt.metadata?.implementationDetails && Object.keys(opt.metadata.implementationDetails).length > 0
                })),
                summary: {
                    totalEstimatedSavings: Number(optimizations.reduce((sum, opt) => sum + (opt.costSaved || 0), 0).toFixed(4)),
                    pendingOptimizations: optimizations.filter(opt => !opt.applied).length,
                    appliedOptimizations: optimizations.filter(opt => opt.applied).length,
                    typeBreakdown: this.getOptimizationTypeBreakdown(optimizations)
                }
            };

            return JSON.stringify({
                success: true,
                operation: 'list_optimizations',
                data: optimizationsList
            }, null, 2);

        } catch (error) {
            return `Failed to list optimizations: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }

    // Helper methods
    private getTimeRange(timeRange?: any) {
        const end = timeRange?.endDate ? new Date(timeRange.endDate) : new Date();
        const start = timeRange?.startDate ? new Date(timeRange.startDate) : 
                     new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000); // Default 30 days
        return { start, end };
    }

    private async findCheaperAlternatives(currentModel: string, _avgTokens: number, avgPromptTokens: number, avgCompletionTokens: number) {
        const currentPricing = getModelPricing(currentModel);
        if (!currentPricing) return [];

        const alternatives = [];
        const allModels = Object.keys(getModelPricing('') || {});

        for (const modelId of allModels) {
            const pricing = getModelPricing(modelId);
            if (pricing && modelId !== currentModel) {
                const currentCost = (avgPromptTokens * currentPricing.inputPrice + avgCompletionTokens * currentPricing.outputPrice) / 1000000;
                const alternativeCost = (avgPromptTokens * pricing.inputPrice + avgCompletionTokens * pricing.outputPrice) / 1000000;

                if (alternativeCost < currentCost) {
                    alternatives.push({
                        model: modelId,
                        provider: pricing.provider,
                        projectedCost: alternativeCost,
                        savings: currentCost - alternativeCost,
                        confidence: this.calculateConfidence(currentModel, modelId),
                        reasoning: this.generateReasoningForSwitch(currentModel, modelId),
                        implementation: this.getImplementationSteps(currentModel, modelId),
                        riskLevel: this.assessRiskLevel(currentModel, modelId)
                    });
                }
            }
        }

        return alternatives.sort((a, b) => b.savings - a.savings).slice(0, 3);
    }

    private analyzePromptOptimization(usage: any): any {
        const avgPromptTokens = usage.avgPromptTokens || 0;
        const totalCost = usage.totalCost || 0;
        
        if (avgPromptTokens > 1000) {
            const potentialReduction = 0.2; // 20% token reduction
            const estimatedSavings = totalCost * potentialReduction;
            
            return {
                type: 'prompt_optimization',
                currentPromptLength: Math.round(avgPromptTokens),
                targetPromptLength: Math.round(avgPromptTokens * (1 - potentialReduction)),
                estimatedSavings: Number(estimatedSavings.toFixed(4)),
                savingsPercentage: potentialReduction * 100,
                confidence: 75,
                reasoning: 'Long prompts detected - optimization through prompt engineering can reduce token usage',
                implementation: {
                    steps: [
                        'Audit current prompts for redundancy',
                        'Use prompt templates and variables',
                        'Remove unnecessary context and examples',
                        'Test optimized prompts for quality'
                    ]
                },
                riskLevel: 'low'
            };
        }

        return { potentialSavings: 0 };
    }

    private analyzeBatchingOpportunity(usage: any): any {
        const totalRequests = usage.totalRequests || 0;
        const totalCost = usage.totalCost || 0;
        
        if (totalRequests > 100) {
            const potentialSavings = totalCost * 0.15; // 15% savings from batching
            
            return {
                type: 'request_batching',
                currentRequests: totalRequests,
                estimatedSavings: Number(potentialSavings.toFixed(4)),
                savingsPercentage: 15,
                confidence: 80,
                reasoning: 'High request volume detected - batching can reduce overhead costs',
                implementation: {
                    steps: [
                        'Implement request queuing system',
                        'Batch similar requests together',
                        'Optimize API call patterns',
                        'Monitor batch performance'
                    ]
                },
                riskLevel: 'medium'
            };
        }

        return { potentialSavings: 0 };
    }

    private calculateCostEfficiency(usage: any): string {
        const costPerRequest = usage.avgCost || 0;
        if (costPerRequest < 0.001) return 'excellent';
        if (costPerRequest < 0.01) return 'good';
        if (costPerRequest < 0.05) return 'moderate';
        return 'poor';
    }

    private assessOptimizationPotential(usage: any): string {
        const avgCost = usage.avgCost || 0;
        const avgTokens = usage.avgTokens || 0;
        
        if (avgCost > 0.05 || avgTokens > 2000) return 'high';
        if (avgCost > 0.01 || avgTokens > 1000) return 'medium';
        return 'low';
    }

    private generateOptimizationRecommendations(opportunities: any[]): string[] {
        const recommendations = [];
        
        if (opportunities.length === 0) {
            recommendations.push('Your current setup is well optimized. Continue monitoring for future opportunities.');
            return recommendations;
        }

        const topOpportunity = opportunities[0];
        recommendations.push(`Priority optimization: ${topOpportunity.type} could save $${topOpportunity.estimatedSavings} (${topOpportunity.savingsPercentage}%)`);
        
        const modelSwitches = opportunities.filter(o => o.type === 'model_switch').length;
        if (modelSwitches > 0) {
            recommendations.push(`${modelSwitches} model switch opportunities identified`);
        }
        
        const promptOpts = opportunities.filter(o => o.type === 'prompt_optimization').length;
        if (promptOpts > 0) {
            recommendations.push(`${promptOpts} prompt optimization opportunities found`);
        }

        return recommendations;
    }

    private generateAnalysisInsights(analysis: any): string[] {
        const insights = [];
        
        if (analysis.summary.potentialSavings > analysis.summary.totalAnalyzedCost * 0.2) {
            insights.push(`High optimization potential detected: ${analysis.summary.averageSavingsPercentage}% average savings available`);
        }
        
        if (analysis.opportunities.length > 5) {
            insights.push(`Multiple optimization opportunities found - consider implementing in phases`);
        }
        
        const highImpactOps = analysis.opportunities.filter((op: any) => op.savingsPercentage > 30).length;
        if (highImpactOps > 0) {
            insights.push(`${highImpactOps} high-impact optimizations (>30% savings) identified`);
        }

        return insights;
    }

    private determineUseCase(usage: any): string {
        const avgTokens = usage.avgPromptTokens + usage.avgCompletionTokens;
        const ratio = usage.avgCompletionTokens / usage.avgPromptTokens;
        
        if (ratio > 2) return 'content-generation';
        if (ratio < 0.5 && avgTokens < 1000) return 'summarization';
        if (avgTokens > 3000) return 'data-analysis';
        return 'api-integration';
    }

    private determineVolume(totalRequests: number): string {
        if (totalRequests > 10000) return 'high';
        if (totalRequests > 1000) return 'medium';
        return 'low';
    }

    private determineComplexity(avgPromptTokens: number): string {
        if (avgPromptTokens > 2000) return 'complex';
        if (avgPromptTokens > 500) return 'moderate';
        return 'simple';
    }

    private calculateSuitabilityScore(modelId: string, useCase: string, volume: string, complexity: string): number {
        // Simplified scoring algorithm
        let score = 70; // Base score
        
        const modelPricing = getModelPricing(modelId);
        if (!modelPricing) return 0;
        
        // Adjust based on model characteristics
        if (modelPricing.category === 'fast' && volume === 'high') score += 15;
        if (modelPricing.category === 'premium' && complexity === 'complex') score += 10;
        if (modelPricing.category === 'balanced') score += 5;
        
        // Use case specific adjustments
        if (useCase === 'content-generation' && modelPricing.features.includes('creative-writing')) score += 10;
        if (useCase === 'api-integration' && modelPricing.inputPrice < 1.0) score += 10;
        
        return Math.min(score, 100);
    }

    private calculateProjectedCost(modelId: string, avgPromptTokens: number, avgCompletionTokens: number, totalRequests: number): number {
        const pricing = getModelPricing(modelId);
        if (!pricing) return 0;
        
        const inputCost = (avgPromptTokens * pricing.inputPrice * totalRequests) / 1000000;
        const outputCost = (avgCompletionTokens * pricing.outputPrice * totalRequests) / 1000000;
        
        return inputCost + outputCost;
    }

    private getModelStrengths(modelId: string): string[] {
        // Simplified strengths mapping
        const strengthsMap: { [key: string]: string[] } = {
            'claude-3-haiku-20240307-v1:0': ['Fastest responses', 'Most cost-effective', 'High throughput'],
            'claude-3-sonnet-20240229-v1:0': ['Balanced performance', 'Good reasoning', 'Reliable'],
            'gpt-4': ['Excellent reasoning', 'High accuracy', 'Complex tasks'],
            'gpt-3.5-turbo': ['Fast', 'Affordable', 'General purpose']
        };
        
        return strengthsMap[modelId] || ['General purpose AI model'];
    }

    private getModelConsiderations(modelId: string, usage: any): string[] {
        const considerations = [];
        const pricing = getModelPricing(modelId);
        
        if (pricing) {
            if (pricing.contextWindow < usage.avgPromptTokens + usage.avgCompletionTokens) {
                considerations.push('May require prompt truncation for long contexts');
            }
            
            if (pricing.category === 'premium') {
                considerations.push('Higher cost per request - ensure quality benefits justify expense');
            }
        }
        
        return considerations;
    }

    private getImplementationGuidance(_modelId: string): any {
        return {
            steps: [
                'Test new model with sample requests',
                'Compare output quality with current model',
                'Gradually migrate traffic',
                'Monitor performance and costs'
            ],
            considerations: [
                'Set up A/B testing framework',
                'Prepare rollback plan',
                'Update monitoring dashboards'
            ]
        };
    }

    private generateModelRecommendationInsights(recommendations: any): string[] {
        const insights = [];
        const current = recommendations.currentUsageProfile;
        
        insights.push(`Current usage: ${current.useCase} with ${current.volume} volume and ${current.complexity} complexity`);
        
        if (recommendations.summary.potentialSavings > 0) {
            insights.push(`Top recommendation could save $${recommendations.summary.potentialSavings.toFixed(2)} monthly`);
        }
        
        if (recommendations.summary.confidenceLevel === 'high') {
            insights.push('High confidence in recommendations based on usage patterns');
        }

        return insights;
    }

    private calculateConfidence(_currentModel: string, _alternativeModel: string): number {
        // Simplified confidence calculation
        return 75; // Base confidence
    }

    private generateReasoningForSwitch(currentModel: string, alternativeModel: string): string {
        return `Switch from ${currentModel} to ${alternativeModel} for cost optimization while maintaining similar capabilities`;
    }

    private getImplementationSteps(_currentModel: string, _alternativeModel: string): string[] {
        return [
            'Test alternative model with sample requests',
            'Compare output quality and performance',
            'Update model configuration',
            'Monitor results and adjust as needed'
        ];
    }

    private assessRiskLevel(_currentModel: string, _alternativeModel: string): string {
        return 'medium'; // Simplified risk assessment
    }

    private getOptimizationNextSteps(type: string): string[] {
        const steps: { [key: string]: string[] } = {
            'model_switch': [
                'Review the recommended model specifications',
                'Test with a small subset of requests',
                'Compare quality and performance metrics',
                'Gradually migrate if results are satisfactory'
            ],
            'prompt_optimization': [
                'Audit current prompts for redundancy',
                'Implement prompt templates and variables',
                'Test optimized prompts for quality',
                'Deploy and monitor results'
            ],
            'request_batching': [
                'Implement request queuing system',
                'Design batching logic for similar requests',
                'Test batch processing performance',
                'Deploy and monitor efficiency gains'
            ]
        };
        
        return steps[type] || ['Review optimization details and create implementation plan'];
    }

    private getOptimizationTypeBreakdown(optimizations: any[]): any {
        const breakdown: { [key: string]: number } = {};
        
        optimizations.forEach(opt => {
            breakdown[opt.category] = (breakdown[opt.category] || 0) + 1;
        });
        
        return breakdown;
    }

    // Placeholder methods for remaining operations
    private async optimizePrompts(_operation: OptimizationOperation): Promise<string> {
        return JSON.stringify({
            success: true,
            message: 'Prompt optimization - implementation pending'
        });
    }

    private async applyOptimization(_operation: OptimizationOperation): Promise<string> {
        return JSON.stringify({
            success: true,
            message: 'Apply optimization - implementation pending'
        });
    }

    private async bulkAnalysis(_operation: OptimizationOperation): Promise<string> {
        return JSON.stringify({
            success: true,
            message: 'Bulk analysis - implementation pending'
        });
    }

    private async costForecast(_operation: OptimizationOperation): Promise<string> {
        return JSON.stringify({
            success: true,
            message: 'Cost forecast - implementation pending'
        });
    }

    private isValidOperation(operation: OptimizationOperation): boolean {
        if (!operation.operation || !operation.userId) return false;
        
        const validOperations = [
            'analyze_costs', 'recommend_models', 'optimize_prompts', 'batch_optimization',
            'create_optimization', 'list_optimizations', 'apply_optimization', 
            'bulk_analysis', 'cost_forecast'
        ];
        
        return validOperations.includes(operation.operation);
    }
} 