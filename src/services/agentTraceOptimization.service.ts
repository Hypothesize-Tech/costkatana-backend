import mongoose from 'mongoose';
import { Usage } from '../models/Usage';
import { loggingService } from './logging.service';
import { AIRouterService } from './aiRouter.service';

export interface WorkflowOptimizationRecommendation {
    type: 'immediate' | 'short_term' | 'long_term';
    category: 'model_switch' | 'caching' | 'redundancy' | 'batching' | 'prompt_optimization' | 'workflow_design';
    title: string;
    description: string;
    workflowId?: string;
    workflowName?: string;
    step?: string;
    currentModel?: string;
    recommendedModel?: string;
    potentialSavings: number;
    potentialSavingsPercentage: number;
    implementationEffort: 'low' | 'medium' | 'high';
    estimatedTimeToImplement?: string;
    steps: string[];
    metadata?: Record<string, any>;
}

export interface WorkflowPerformanceMetrics {
    workflowId: string;
    workflowName: string;
    platform: string;
    totalCost: number;
    totalExecutions: number;
    totalTokens: number;
    averageCostPerExecution: number;
    averageTokensPerExecution: number;
    averageResponseTime: number;
    costPerStep: Array<{
        step: string;
        sequence: number;
        cost: number;
        tokens: number;
        executions: number;
        averageCost: number;
    }>;
    modelUsage: Array<{
        model: string;
        service: string;
        cost: number;
        tokens: number;
        executions: number;
        percentageOfTotal: number;
    }>;
    timeSeries: Array<{
        date: string;
        cost: number;
        executions: number;
        tokens: number;
    }>;
}

export class WorkflowOptimizationService {
    /**
     * Get workflow performance metrics
     */
    static async getWorkflowPerformanceMetrics(
        userId: string,
        workflowId: string,
        startDate?: Date,
        endDate?: Date
    ): Promise<WorkflowPerformanceMetrics | null> {
        try {
            const match: any = {
                userId: new mongoose.Types.ObjectId(userId),
                workflowId: workflowId,
                automationPlatform: { $exists: true, $ne: null }
            };

            if (startDate || endDate) {
                match.createdAt = {};
                if (startDate) match.createdAt.$gte = startDate;
                if (endDate) match.createdAt.$lte = endDate;
            }

            // Get workflow usage data
            const workflowData = await Usage.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: null,
                        totalCost: { $sum: '$cost' },
                        totalTokens: { $sum: '$totalTokens' },
                        totalExecutions: { $sum: 1 },
                        averageResponseTime: { $avg: '$responseTime' },
                        workflowName: { $first: '$workflowName' },
                        platform: { $first: '$automationPlatform' },
                        steps: {
                            $push: {
                                step: '$workflowStep',
                                sequence: '$workflowSequence',
                                cost: '$cost',
                                tokens: '$totalTokens',
                                responseTime: '$responseTime'
                            }
                        },
                        models: {
                            $push: {
                                model: '$model',
                                service: '$service',
                                cost: '$cost',
                                tokens: '$totalTokens'
                            }
                        }
                    }
                }
            ]);

            if (!workflowData || workflowData.length === 0) {
                return null;
            }

            const data = workflowData[0];
            const totalExecutions = data.totalExecutions || 1;

            // Calculate cost per step
            const stepMap = new Map<string, {
                step: string;
                sequence: number;
                cost: number;
                tokens: number;
                executions: number;
            }>();

            data.steps.forEach((s: any) => {
                const key = `${s.step}_${s.sequence}`;
                if (!stepMap.has(key)) {
                    stepMap.set(key, {
                        step: s.step || 'Unknown',
                        sequence: s.sequence || 0,
                        cost: 0,
                        tokens: 0,
                        executions: 0
                    });
                }
                const entry = stepMap.get(key)!;
                entry.cost += s.cost || 0;
                entry.tokens += s.tokens || 0;
                entry.executions += 1;
            });

            const costPerStep = Array.from(stepMap.values()).map(entry => ({
                ...entry,
                averageCost: entry.executions > 0 ? entry.cost / entry.executions : 0
            })).sort((a, b) => a.sequence - b.sequence);

            // Calculate model usage
            const modelMap = new Map<string, {
                model: string;
                service: string;
                cost: number;
                tokens: number;
                executions: number;
            }>();

            data.models.forEach((m: any) => {
                const key = `${m.service}_${m.model}`;
                if (!modelMap.has(key)) {
                    modelMap.set(key, {
                        model: m.model || 'Unknown',
                        service: m.service || 'Unknown',
                        cost: 0,
                        tokens: 0,
                        executions: 0
                    });
                }
                const entry = modelMap.get(key)!;
                entry.cost += m.cost || 0;
                entry.tokens += m.tokens || 0;
                entry.executions += 1;
            });

            const totalCost = data.totalCost || 0;
            const modelUsage = Array.from(modelMap.values()).map(entry => ({
                ...entry,
                percentageOfTotal: totalCost > 0 ? (entry.cost / totalCost) * 100 : 0
            })).sort((a, b) => b.cost - a.cost);

            // Get time series data
            const timeSeriesData = await Usage.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: {
                            $dateToString: {
                                format: '%Y-%m-%d',
                                date: '$createdAt'
                            }
                        },
                        cost: { $sum: '$cost' },
                        executions: { $sum: 1 },
                        tokens: { $sum: '$totalTokens' }
                    }
                },
                { $sort: { _id: 1 } }
            ]);

            return {
                workflowId,
                workflowName: data.workflowName || 'Unknown Workflow',
                platform: data.platform || 'unknown',
                totalCost,
                totalExecutions,
                totalTokens: data.totalTokens || 0,
                averageCostPerExecution: totalExecutions > 0 ? totalCost / totalExecutions : 0,
                averageTokensPerExecution: totalExecutions > 0 ? (data.totalTokens || 0) / totalExecutions : 0,
                averageResponseTime: data.averageResponseTime || 0,
                costPerStep,
                modelUsage,
                timeSeries: timeSeriesData.map((item: any) => ({
                    date: item._id,
                    cost: item.cost,
                    executions: item.executions,
                    tokens: item.tokens
                }))
            };
        } catch (error) {
            loggingService.error('Error getting workflow performance metrics', {
                component: 'WorkflowOptimizationService',
                operation: 'getWorkflowPerformanceMetrics',
                error: error instanceof Error ? error.message : String(error),
                userId,
                workflowId
            });
            throw error;
        }
    }

    /**
     * Get optimization recommendations for a workflow
     */
    static async getWorkflowOptimizationRecommendations(
        userId: string,
        workflowId: string,
        startDate?: Date,
        endDate?: Date
    ): Promise<WorkflowOptimizationRecommendation[]> {
        try {
            const metrics = await this.getWorkflowPerformanceMetrics(userId, workflowId, startDate, endDate);
            if (!metrics) {
                return [];
            }

            const recommendations: WorkflowOptimizationRecommendation[] = [];

            // 1. Model switching recommendations
            const modelRecommendations = this.analyzeModelUsage(metrics);
            recommendations.push(...modelRecommendations);

            // 2. Caching opportunities
            const cachingRecommendations = await this.analyzeCachingOpportunities(metrics);
            recommendations.push(...cachingRecommendations);

            // 3. Redundancy detection
            const redundancyRecommendations = this.analyzeRedundancy(metrics);
            recommendations.push(...redundancyRecommendations);

            // 4. Batching opportunities
            const batchingRecommendations = this.analyzeBatchingOpportunities(metrics);
            recommendations.push(...batchingRecommendations);

            // 5. Prompt optimization
            const promptRecommendations = await this.analyzePromptOptimization(userId, workflowId, startDate, endDate);
            recommendations.push(...promptRecommendations);

            // Sort by potential savings
            return recommendations.sort((a, b) => b.potentialSavings - a.potentialSavings);
        } catch (error) {
            loggingService.error('Error getting workflow optimization recommendations', {
                component: 'WorkflowOptimizationService',
                operation: 'getWorkflowOptimizationRecommendations',
                error: error instanceof Error ? error.message : String(error),
                userId,
                workflowId
            });
            throw error;
        }
    }

    /**
     * Analyze model usage and suggest cheaper alternatives
     */
    private static analyzeModelUsage(metrics: WorkflowPerformanceMetrics): WorkflowOptimizationRecommendation[] {
        const recommendations: WorkflowOptimizationRecommendation[] = [];

        // Find expensive models that could be replaced
        // Dynamic threshold: consider models that are above average cost per execution
        const avgCostPerExecution = metrics.totalExecutions > 0 ? metrics.totalCost / metrics.totalExecutions : 0;
        const costThreshold = Math.max(avgCostPerExecution * 1.5, 0.005); // 1.5x average or $0.005 minimum
        const percentageThreshold = Math.max(100 / metrics.modelUsage.length, 5); // At least 5% or 1/n of models
        
        const expensiveModels = metrics.modelUsage.filter(m => {
            const modelAvgCostPerExecution = metrics.totalExecutions > 0 ? m.cost / metrics.totalExecutions : 0;
            return modelAvgCostPerExecution > costThreshold && m.percentageOfTotal > percentageThreshold;
        });

        for (const model of expensiveModels) {
            // Suggest cheaper alternatives based on model tier
            const cheaperAlternatives = this.getCheaperModelAlternatives(model.model, model.service);
            
            if (cheaperAlternatives.length > 0) {
                const alternative = cheaperAlternatives[0];
                const potentialSavings = model.cost * (alternative.savingsPercentage / 100);
                
                recommendations.push({
                    type: 'immediate',
                    category: 'model_switch',
                    title: `Switch from ${model.model} to ${alternative.model}`,
                    description: `${model.model} is expensive for this workflow. Switching to ${alternative.model} could save ${alternative.savingsPercentage}% with similar quality.`,
                    workflowId: metrics.workflowId,
                    workflowName: metrics.workflowName,
                    currentModel: model.model,
                    recommendedModel: alternative.model,
                    potentialSavings,
                    potentialSavingsPercentage: alternative.savingsPercentage,
                    implementationEffort: 'low',
                    estimatedTimeToImplement: '5-10 minutes',
                    steps: [
                        `Identify steps using ${model.model} in your ${metrics.platform} workflow`,
                        `Replace ${model.model} with ${alternative.model} in those steps`,
                        `Test the workflow to ensure quality is maintained`,
                        `Monitor cost savings over the next week`
                    ],
                    metadata: {
                        currentService: model.service,
                        recommendedService: alternative.service,
                        currentCost: model.cost,
                        estimatedNewCost: model.cost - potentialSavings
                    }
                });
            }
        }

        return recommendations;
    }

    /**
     * Get cheaper model alternatives
     */
    private static getCheaperModelAlternatives(currentModel: string, _service: string): Array<{
        model: string;
        service: string;
        savingsPercentage: number;
    }> {
        const alternatives: Array<{ model: string; service: string; savingsPercentage: number }> = [];

        // Model tier mapping - cheaper alternatives
        const modelTiers: Record<string, Array<{ model: string; service: string; savingsPercentage: number }>> = {
            'gpt-4': [
                { model: 'gpt-3.5-turbo', service: 'openai', savingsPercentage: 80 },
                { model: 'gpt-4o-mini', service: 'openai', savingsPercentage: 60 }
            ],
            'gpt-4-turbo': [
                { model: 'gpt-3.5-turbo', service: 'openai', savingsPercentage: 85 },
                { model: 'gpt-4o-mini', service: 'openai', savingsPercentage: 70 }
            ],
            'gpt-4o': [
                { model: 'gpt-4o-mini', service: 'openai', savingsPercentage: 75 },
                { model: 'gpt-3.5-turbo', service: 'openai', savingsPercentage: 90 }
            ],
            'claude-3-5-sonnet': [
                { model: 'claude-3-5-haiku', service: 'anthropic', savingsPercentage: 70 },
                { model: 'claude-3-haiku', service: 'anthropic', savingsPercentage: 80 }
            ],
            'claude-3-opus': [
                { model: 'claude-3-5-sonnet', service: 'anthropic', savingsPercentage: 50 },
                { model: 'claude-3-5-haiku', service: 'anthropic', savingsPercentage: 85 }
            ],
            'gemini-1.5-pro': [
                { model: 'gemini-1.5-flash', service: 'google-ai', savingsPercentage: 75 },
                { model: 'gemini-2.5-flash', service: 'google-ai', savingsPercentage: 80 }
            ]
        };

        const modelKey = currentModel.toLowerCase();
        if (modelTiers[modelKey]) {
            alternatives.push(...modelTiers[modelKey]);
        }

        return alternatives;
    }

    /**
     * Analyze caching opportunities with AI-powered savings estimation
     */
    private static async analyzeCachingOpportunities(metrics: WorkflowPerformanceMetrics): Promise<WorkflowOptimizationRecommendation[]> {
        const recommendations: WorkflowOptimizationRecommendation[] = [];

        // Find steps with high execution frequency
        const minExecutions = Math.max(5, Math.floor(metrics.totalExecutions * 0.1)); // At least 10% of total executions or 5, whichever is higher
        const frequentSteps = metrics.costPerStep.filter(step => step.executions >= minExecutions);
        
        if (frequentSteps.length > 0) {
            const totalCacheableCost = frequentSteps.reduce((sum, step) => sum + step.cost, 0);
            
            // Use AI to estimate realistic cache hit rate based on execution patterns
            const estimatedHitRate = await this.estimateCacheHitRate(metrics, frequentSteps);
            const potentialSavings = totalCacheableCost * (estimatedHitRate / 100);
            
            // Only recommend if savings is meaningful (at least 1% of total workflow cost or $0.10)
            const minSavingsThreshold = Math.max(metrics.totalCost * 0.01, 0.10);
            
            if (potentialSavings >= minSavingsThreshold) {
                recommendations.push({
                    type: 'short_term',
                    category: 'caching',
                    title: 'Enable caching for frequently executed steps',
                    description: `${frequentSteps.length} steps are executed frequently (${frequentSteps.reduce((sum, s) => sum + s.executions, 0)} total executions). Enabling semantic caching could save approximately ${estimatedHitRate.toFixed(0)}% on these steps based on execution patterns.`,
                    workflowId: metrics.workflowId,
                    workflowName: metrics.workflowName,
                    potentialSavings,
                    potentialSavingsPercentage: estimatedHitRate,
                    implementationEffort: 'medium',
                    estimatedTimeToImplement: '30-60 minutes',
                    steps: [
                        'Identify steps with similar inputs/outputs',
                        'Enable semantic caching in Cost Katana dashboard',
                        'Configure cache TTL based on data freshness requirements',
                        'Monitor cache hit rates and adjust as needed'
                    ],
                    metadata: {
                        cacheableSteps: frequentSteps.length,
                        estimatedCacheHitRate: estimatedHitRate,
                        steps: frequentSteps.map(s => s.step),
                        totalCacheableCost
                    }
                });
            }
        }

        return recommendations;
    }

    /**
     * Use AI to estimate realistic cache hit rate based on workflow execution patterns
     */
    private static async estimateCacheHitRate(
        metrics: WorkflowPerformanceMetrics,
        frequentSteps: Array<{ step: string; executions: number; cost: number }>
    ): Promise<number> {
        try {
            const prompt = `Analyze the following workflow execution patterns and estimate a realistic cache hit rate percentage for semantic caching.

WORKFLOW CONTEXT:
- Workflow: ${metrics.workflowName}
- Total Executions: ${metrics.totalExecutions}
- Total Cost: $${metrics.totalCost.toFixed(2)}
- Platform: ${metrics.platform}

FREQUENT STEPS (candidates for caching):
${frequentSteps.map((s, idx) => `
${idx + 1}. ${s.step}
   - Executions: ${s.executions}
   - Total Cost: $${s.cost.toFixed(2)}
   - Avg Cost/Execution: $${(s.cost / s.executions).toFixed(4)}
`).join('')}

EXECUTION PATTERNS:
- Average Executions Per Day: ${metrics.timeSeries.length > 0 ? (metrics.totalExecutions / metrics.timeSeries.length).toFixed(1) : 'N/A'}
- Execution Frequency: ${metrics.totalExecutions > 1000 ? 'Very High' : metrics.totalExecutions > 100 ? 'High' : 'Moderate'}

INSTRUCTIONS:
1. Analyze the execution frequency and patterns
2. Consider that semantic caching works best for:
   - High-frequency executions
   - Similar inputs/outputs
   - Stable data patterns
3. Estimate a realistic cache hit rate percentage (0-100)
4. Be conservative - use industry benchmarks:
   - Very high frequency (>1000 executions): 60-80%
   - High frequency (100-1000): 50-70%
   - Moderate frequency (<100): 30-50%
5. Adjust based on execution consistency patterns

RESPONSE FORMAT - ONLY JSON, NO OTHER TEXT:
{
  "estimatedHitRate": 65,
  "reasoning": "Brief explanation of the estimate"
}

Return ONLY the JSON object. No markdown, no explanations outside JSON.`;

            const modelId = 'amazon.nova-pro-v1:0';
            const aiResponse = await AIRouterService.invokeModel(prompt, modelId);
            
            if (aiResponse && typeof aiResponse === 'string') {
                try {
                    const parsed = JSON.parse(aiResponse);
                    const hitRate = parsed.estimatedHitRate ?? parsed.hitRate ?? parsed.cacheHitRate;
                    if (typeof hitRate === 'number' && hitRate >= 0 && hitRate <= 100) {
                        return hitRate;
                    }
                } catch {
                    // Fall through to default calculation
                }
            }
        } catch (error) {
            loggingService.error('Error estimating cache hit rate with AI', {
                component: 'WorkflowOptimizationService',
                operation: 'estimateCacheHitRate',
                error: error instanceof Error ? error.message : String(error)
            });
        }
        
        // Fallback: Calculate based on execution frequency patterns
        const avgExecutionsPerStep = frequentSteps.reduce((sum, s) => sum + s.executions, 0) / frequentSteps.length;
        if (avgExecutionsPerStep > 1000) {
            return 70; // Very high frequency
        } else if (avgExecutionsPerStep > 100) {
            return 60; // High frequency
        } else if (avgExecutionsPerStep > 20) {
            return 45; // Moderate frequency
        } else {
            return 30; // Low frequency
        }
    }

    /**
     * Analyze redundancy in workflow
     */
    private static analyzeRedundancy(metrics: WorkflowPerformanceMetrics): WorkflowOptimizationRecommendation[] {
        const recommendations: WorkflowOptimizationRecommendation[] = [];

        // Find steps with very similar costs (potential duplicates)
        const stepCosts = metrics.costPerStep.map(s => s.averageCost).sort();
        const similarSteps: number[] = [];

        for (let i = 0; i < stepCosts.length - 1; i++) {
            const diff = Math.abs(stepCosts[i] - stepCosts[i + 1]);
            const avg = (stepCosts[i] + stepCosts[i + 1]) / 2;
            if (avg > 0 && (diff / avg) < 0.1) { // Less than 10% difference
                similarSteps.push(i);
            }
        }

        if (similarSteps.length > 0) {
            const redundantCost = similarSteps.reduce((sum, idx) => sum + stepCosts[idx], 0);
            // Calculate elimination percentage based on similarity: more similar = higher elimination potential
            const avgSimilarity = similarSteps.length > 0 
                ? similarSteps.reduce((sum, idx) => {
                    const diff = Math.abs(stepCosts[idx] - stepCosts[idx + 1]);
                    const avg = (stepCosts[idx] + stepCosts[idx + 1]) / 2;
                    return sum + (avg > 0 ? 1 - (diff / avg) : 0);
                  }, 0) / similarSteps.length
                : 0;
            const eliminationPercentage = Math.min(avgSimilarity * 100, 60); // Cap at 60% for safety
            const potentialSavings = redundantCost * (eliminationPercentage / 100);
            
            // Minimum savings threshold: at least 2% of total workflow cost or $0.10
            const minSavingsThreshold = Math.max(metrics.totalCost * 0.02, 0.10);

            if (potentialSavings >= minSavingsThreshold) {
                recommendations.push({
                    type: 'long_term',
                    category: 'redundancy',
                    title: 'Consolidate redundant workflow steps',
                    description: `Found ${similarSteps.length} steps with similar costs. These may be redundant and could be consolidated.`,
                    workflowId: metrics.workflowId,
                    workflowName: metrics.workflowName,
                    potentialSavings,
                    potentialSavingsPercentage: Math.round(eliminationPercentage),
                    implementationEffort: 'high',
                    estimatedTimeToImplement: '2-4 hours',
                    steps: [
                        'Review workflow steps with similar costs',
                        'Identify which steps can be combined',
                        'Test consolidated workflow',
                        'Monitor for quality and cost improvements'
                    ]
                });
            }
        }

        return recommendations;
    }

    /**
     * Analyze batching opportunities
     */
    private static analyzeBatchingOpportunities(metrics: WorkflowPerformanceMetrics): WorkflowOptimizationRecommendation[] {
        const recommendations: WorkflowOptimizationRecommendation[] = [];

        // If workflow executes frequently with small costs, batching could help
        // Dynamic thresholds based on execution patterns
        const executionThreshold = Math.max(50, metrics.totalExecutions * 0.1); // At least 50 or 10% of total
        const costPerExecutionThreshold = metrics.totalCost / metrics.totalExecutions * 0.5; // Half of average
        
        if (metrics.totalExecutions >= executionThreshold && metrics.averageCostPerExecution < costPerExecutionThreshold) {
            // Estimate batching savings: higher for more frequent, smaller executions
            const frequencyFactor = Math.min(metrics.totalExecutions / 1000, 1); // Normalize to 0-1
            const overheadReduction = 10 + (frequencyFactor * 10); // 10-20% savings range
            const batchSavings = metrics.totalCost * (overheadReduction / 100);
            
            // Minimum savings threshold: at least 1% of total workflow cost or $0.10
            const minSavingsThreshold = Math.max(metrics.totalCost * 0.01, 0.10);

            if (batchSavings >= minSavingsThreshold) {
                recommendations.push({
                    type: 'short_term',
                    category: 'batching',
                    title: 'Batch similar workflow executions',
                    description: `This workflow executes frequently (${metrics.totalExecutions} executions) with small average costs ($${metrics.averageCostPerExecution.toFixed(4)}/execution). Batching similar executions could reduce overhead by approximately ${overheadReduction.toFixed(0)}%.`,
                    workflowId: metrics.workflowId,
                    workflowName: metrics.workflowName,
                    potentialSavings: batchSavings,
                    potentialSavingsPercentage: Math.round(overheadReduction),
                    implementationEffort: 'medium',
                    estimatedTimeToImplement: '1-2 hours',
                    steps: [
                        'Identify workflow executions that can be batched',
                        'Modify workflow to collect similar requests',
                        'Process batches together',
                        'Monitor batch processing efficiency'
                    ]
                });
            }
        }

        return recommendations;
    }

    /**
     * Analyze prompt optimization opportunities
     */
    private static async analyzePromptOptimization(
        userId: string,
        workflowId: string,
        startDate?: Date,
        endDate?: Date
    ): Promise<WorkflowOptimizationRecommendation[]> {
        const recommendations: WorkflowOptimizationRecommendation[] = [];

        try {
            const match: any = {
                userId: new mongoose.Types.ObjectId(userId),
                workflowId: workflowId,
                automationPlatform: { $exists: true, $ne: null }
            };

            if (startDate || endDate) {
                match.createdAt = {};
                if (startDate) match.createdAt.$gte = startDate;
                if (endDate) match.createdAt.$lte = endDate;
            }

            // Get average prompt length
            const promptStats = await Usage.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: null,
                        avgPromptLength: { $avg: { $strLenCP: '$prompt' } },
                        avgPromptTokens: { $avg: '$promptTokens' },
                        totalCost: { $sum: '$cost' },
                        count: { $sum: 1 }
                    }
                }
            ]);

            if (promptStats && promptStats.length > 0) {
                const stats = promptStats[0];
                const avgPromptTokens = stats.avgPromptTokens || 0;

                // Dynamic threshold: consider prompts larger than 1.5x the median prompt size
                // Or if average is > 500 tokens (industry benchmark for optimization opportunity)
                const promptOptimizationThreshold = Math.max(500, avgPromptTokens * 0.3); // At least 30% reduction possible
                
                if (avgPromptTokens > promptOptimizationThreshold) {
                    // Estimate savings based on potential token reduction
                    // Typical prompt optimization can reduce tokens by 20-40% depending on verbosity
                    const tokenReductionPercentage = Math.min(Math.max((avgPromptTokens - 300) / avgPromptTokens, 0.15), 0.35);
                    const potentialSavings = (stats.totalCost || 0) * tokenReductionPercentage;

                    recommendations.push({
                        type: 'short_term',
                        category: 'prompt_optimization',
                        title: 'Optimize workflow prompts',
                        description: `Average prompt size is ${Math.round(avgPromptTokens)} tokens (${Math.round(avgPromptTokens - avgPromptTokens * (1 - tokenReductionPercentage))} tokens could potentially be reduced). Optimizing prompts could reduce costs by approximately ${Math.round(tokenReductionPercentage * 100)}%.`,
                        workflowId: workflowId,
                        potentialSavings,
                        potentialSavingsPercentage: Math.round(tokenReductionPercentage * 100),
                        implementationEffort: 'medium',
                        estimatedTimeToImplement: '1-2 hours',
                        steps: [
                            'Review prompts in workflow steps',
                            'Remove unnecessary context and instructions',
                            'Use Cost Katana prompt optimization tools',
                            'Test optimized prompts for quality',
                            'Deploy optimized version'
                        ],
                        metadata: {
                            averagePromptTokens: avgPromptTokens,
                            currentTotalCost: stats.totalCost
                        }
                    });
                }
            }
        } catch (error) {
            loggingService.error('Error analyzing prompt optimization', {
                component: 'WorkflowOptimizationService',
                operation: 'analyzePromptOptimization',
                error: error instanceof Error ? error.message : String(error)
            });
        }

        return recommendations;
    }

    /**
     * Get optimization recommendations for all workflows
     */
    static async getAllWorkflowRecommendations(
        userId: string,
        startDate?: Date,
        endDate?: Date
    ): Promise<Array<{
        workflowId: string;
        workflowName: string;
        platform: string;
        recommendations: WorkflowOptimizationRecommendation[];
        totalPotentialSavings: number;
    }>> {
        try {
            const match: any = {
                userId: new mongoose.Types.ObjectId(userId),
                automationPlatform: { $exists: true, $ne: null },
                workflowId: { $exists: true, $ne: null }
            };

            if (startDate || endDate) {
                match.createdAt = {};
                if (startDate) match.createdAt.$gte = startDate;
                if (endDate) match.createdAt.$lte = endDate;
            }

            // Get all unique workflows
            const workflows = await Usage.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: '$workflowId',
                        workflowName: { $first: '$workflowName' },
                        platform: { $first: '$automationPlatform' }
                    }
                }
            ]);

            const results = await Promise.all(
                workflows.map(async (wf: any) => {
                    const recommendations = await this.getWorkflowOptimizationRecommendations(
                        userId,
                        wf._id,
                        startDate,
                        endDate
                    );
                    const totalPotentialSavings = recommendations.reduce((sum, r) => sum + r.potentialSavings, 0);

                    return {
                        workflowId: wf._id,
                        workflowName: wf.workflowName || 'Unknown',
                        platform: wf.platform || 'unknown',
                        recommendations,
                        totalPotentialSavings
                    };
                })
            );

            return results.sort((a, b) => b.totalPotentialSavings - a.totalPotentialSavings);
        } catch (error) {
            loggingService.error('Error getting all workflow recommendations', {
                component: 'WorkflowOptimizationService',
                operation: 'getAllWorkflowRecommendations',
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            throw error;
        }
    }
}

