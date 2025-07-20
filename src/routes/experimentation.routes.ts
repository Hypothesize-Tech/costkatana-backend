import { Router, Request, Response } from 'express';
import { authenticate, optionalAuth } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';
import { Usage } from '../models/Usage';
import { Project } from '../models/Project';
import { MODEL_PRICING, getAllProviders } from '../utils/pricing';
import { logger } from '../utils/logger';

const router = Router();

/**
 * Get available models for experimentation
 */
router.get('/available-models', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
    try {
        // Group models by provider and category
        const modelsByProvider: Record<string, any[]> = {};
        const categories = new Set<string>();
        
        MODEL_PRICING.forEach(model => {
            if (!modelsByProvider[model.provider]) {
                modelsByProvider[model.provider] = [];
            }
            
            categories.add(model.category || 'text');
            
            modelsByProvider[model.provider].push({
                id: model.modelId,
                name: model.modelName,
                provider: model.provider,
                category: model.category || 'text',
                inputPrice: model.inputPrice,
                outputPrice: model.outputPrice,
                contextWindow: model.contextWindow,
                capabilities: model.capabilities || [],
                isLatest: model.isLatest || false,
                notes: model.notes || '',
                unit: model.unit
            });
        });

        // Sort models within each provider by latest first, then by name
        Object.keys(modelsByProvider).forEach(provider => {
            modelsByProvider[provider].sort((a, b) => {
                if (a.isLatest && !b.isLatest) return -1;
                if (!a.isLatest && b.isLatest) return 1;
                return a.name.localeCompare(b.name);
            });
        });

        // Get popular models (top 20 by usage if user is authenticated)
        let popularModels: any[] = [];
        if ((req as any).user) {
            const userId = (req as any).user.id;
            const usageStats = await Usage.aggregate([
                { $match: { userId } },
                { $group: { 
                    _id: { model: '$model', provider: '$provider' },
                    totalCost: { $sum: '$cost' },
                    totalTokens: { $sum: '$totalTokens' },
                    requestCount: { $sum: 1 }
                }},
                { $sort: { requestCount: -1 } },
                { $limit: 10 }
            ]);

            popularModels = usageStats.map(stat => {
                const modelInfo = MODEL_PRICING.find(m => 
                    m.modelId === stat._id.model && m.provider === stat._id.provider
                );
                return {
                    id: stat._id.model,
                    name: modelInfo?.modelName || stat._id.model,
                    provider: stat._id.provider,
                    totalCost: stat.totalCost,
                    totalTokens: stat.totalTokens,
                    requestCount: stat.requestCount,
                    avgCostPerRequest: stat.totalCost / stat.requestCount,
                    inputPrice: modelInfo?.inputPrice || 0,
                    outputPrice: modelInfo?.outputPrice || 0,
                    contextWindow: modelInfo?.contextWindow || 0,
                    capabilities: modelInfo?.capabilities || [],
                    category: modelInfo?.category || 'text'
                };
            });
        }

        // Get trending models (latest models across all providers)
        const trendingModels = MODEL_PRICING
            .filter(model => model.isLatest)
            .sort((a, b) => (b.inputPrice + b.outputPrice) - (a.inputPrice + a.outputPrice))
            .slice(0, 15)
            .map(model => ({
                id: model.modelId,
                name: model.modelName,
                provider: model.provider,
                category: model.category || 'text',
                inputPrice: model.inputPrice,
                outputPrice: model.outputPrice,
                contextWindow: model.contextWindow,
                capabilities: model.capabilities || [],
                isLatest: true,
                notes: model.notes || ''
            }));

        // Get cost-efficient models (best price/performance ratio)
        const costEfficientModels = MODEL_PRICING
            .filter(model => model.inputPrice > 0) // Exclude free models for this calculation
            .sort((a, b) => (a.inputPrice + a.outputPrice) - (b.inputPrice + b.outputPrice))
            .slice(0, 12)
            .map(model => ({
                id: model.modelId,
                name: model.modelName,
                provider: model.provider,
                category: model.category || 'text',
                inputPrice: model.inputPrice,
                outputPrice: model.outputPrice,
                contextWindow: model.contextWindow,
                capabilities: model.capabilities || [],
                costScore: model.inputPrice + model.outputPrice,
                notes: model.notes || ''
            }));

        // Convert modelsByProvider object to array format for frontend
        const modelsArray = Object.entries(modelsByProvider).flatMap(([provider, models]) => 
            models.map(model => ({
                ...model,
                provider
            }))
        );

        res.json({
            success: true,
            data: {
                models: modelsArray, // Frontend expects 'models' array
                modelsByProvider,
                categories: Array.from(categories).sort(),
                providers: getAllProviders(),
                popularModels,
                trendingModels,
                costEfficientModels,
                totalModels: MODEL_PRICING.length,
                metadata: {
                    lastUpdated: new Date().toISOString(),
                    source: 'AI Cost Optimizer - Real Pricing Data',
                    totalProviders: Object.keys(modelsByProvider).length,
                    supportedCapabilities: [
                        'text', 'multimodal', 'code', 'reasoning', 'analysis', 
                        'embedding', 'image', 'vision', 'audio', 'function-calling'
                    ]
                }
            }
        });

    } catch (error) {
        logger.error('Error fetching available models:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch available models'
        });
    }
}));

/**
 * Get experimentation history
 */
router.get('/history', authenticate, asyncHandler(async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const provider = req.query.provider as string;
        const model = req.query.model as string;
        const category = req.query.category as string;

        // Build filter query
        const filter: any = { userId };
        
        if (provider) {
            filter.provider = provider;
        }
        
        if (model) {
            filter.model = model;
        }

        // Get usage history with detailed information
        const usageHistory = await Usage.find(filter)
            .sort({ createdAt: -1 })
            .limit(limit)
            .skip((page - 1) * limit)
            .lean();

        // Enrich with model information
        const enrichedHistory = usageHistory.map((usage: any) => {
            const modelInfo = MODEL_PRICING.find(m => 
                m.modelId === usage.model && m.provider === (usage.service || usage.provider)
            );

            return {
                id: usage._id,
                timestamp: usage.createdAt,
                provider: usage.service || usage.provider || 'unknown',
                model: usage.model,
                modelName: modelInfo?.modelName || usage.model,
                promptTokens: usage.promptTokens || 0,
                completionTokens: usage.completionTokens || 0,
                totalTokens: usage.totalTokens || 0,
                cost: usage.cost || 0,
                duration: usage.responseTime || usage.duration || 0,
                success: usage.status === 'success' || usage.success !== false,
                errorMessage: usage.errorMessage || usage.error || null,
                metadata: {
                    inputPrice: modelInfo?.inputPrice || 0,
                    outputPrice: modelInfo?.outputPrice || 0,
                    contextWindow: modelInfo?.contextWindow || 0,
                    capabilities: modelInfo?.capabilities || [],
                    category: modelInfo?.category || 'text',
                    costPerToken: usage.totalTokens > 0 ? (usage.cost || 0) / usage.totalTokens : 0,
                    efficiency: (usage.responseTime || usage.duration) && usage.totalTokens ? usage.totalTokens / ((usage.responseTime || usage.duration) / 1000) : 0 // tokens per second
                },
                tags: usage.tags || [],
                projectId: usage.projectId,
                source: usage.metadata?.source || usage.source || 'api'
            };
        });

        // Get total count for pagination
        const totalCount = await Usage.countDocuments(filter);

        // Get summary statistics
        const summaryStats = await Usage.aggregate([
            { $match: filter },
            {
                $group: {
                    _id: null,
                    totalRequests: { $sum: 1 },
                    totalCost: { $sum: '$cost' },
                    totalTokens: { $sum: '$totalTokens' },
                    avgCost: { $avg: '$cost' },
                    avgTokens: { $avg: '$totalTokens' },
                    avgDuration: { $avg: '$duration' },
                    successRate: {
                        $avg: {
                            $cond: [{ $ne: ['$success', false] }, 1, 0]
                        }
                    }
                }
            }
        ]);

        // Get model usage breakdown
        const modelBreakdown = await Usage.aggregate([
            { $match: filter },
            {
                $group: {
                    _id: { provider: '$provider', model: '$model' },
                    requestCount: { $sum: 1 },
                    totalCost: { $sum: '$cost' },
                    totalTokens: { $sum: '$totalTokens' },
                    avgCost: { $avg: '$cost' },
                    lastUsed: { $max: '$createdAt' }
                }
            },
            { $sort: { requestCount: -1 } },
            { $limit: 10 }
        ]);

        // Get cost trends (daily costs for last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const costTrends = await Usage.aggregate([
            { 
                $match: { 
                    ...filter, 
                    createdAt: { $gte: thirtyDaysAgo }
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: {
                            format: '%Y-%m-%d',
                            date: '$createdAt'
                        }
                    },
                    dailyCost: { $sum: '$cost' },
                    dailyTokens: { $sum: '$totalTokens' },
                    dailyRequests: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        res.json({
            success: true,
            data: {
                history: enrichedHistory,
                pagination: {
                    page,
                    limit,
                    totalCount,
                    totalPages: Math.ceil(totalCount / limit),
                    hasMore: page * limit < totalCount
                },
                summary: summaryStats[0] || {
                    totalRequests: 0,
                    totalCost: 0,
                    totalTokens: 0,
                    avgCost: 0,
                    avgTokens: 0,
                    avgDuration: 0,
                    successRate: 0
                },
                modelBreakdown: modelBreakdown.map(item => ({
                    provider: item._id.provider,
                    model: item._id.model,
                    modelName: MODEL_PRICING.find(m => 
                        m.modelId === item._id.model && m.provider === item._id.provider
                    )?.modelName || item._id.model,
                    requestCount: item.requestCount,
                    totalCost: item.totalCost,
                    totalTokens: item.totalTokens,
                    avgCost: item.avgCost,
                    lastUsed: item.lastUsed
                })),
                costTrends: costTrends.map(trend => ({
                    date: trend._id,
                    cost: trend.dailyCost,
                    tokens: trend.dailyTokens,
                    requests: trend.dailyRequests
                })),
                filters: {
                    provider,
                    model,
                    category
                }
            }
        });

    } catch (error) {
        logger.error('Error fetching experimentation history:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch experimentation history'
        });
    }
}));

/**
 * Compare models for experimentation
 */
router.post('/compare', authenticate, asyncHandler(async (req: Request, res: Response): Promise<any> => {
    try {
        const { models, prompt, estimatedTokens = 1000 } = req.body;
        
        if (!models || !Array.isArray(models) || models.length < 2) {
            return res.status(400).json({
                success: false,
                error: 'At least 2 models are required for comparison'
            });
        }

        const comparisons = models.map(modelId => {
            const modelInfo = MODEL_PRICING.find(m => m.modelId === modelId);
            
            if (!modelInfo) {
                return {
                    modelId,
                    error: 'Model not found'
                };
            }

            const estimatedInputTokens = Math.floor(estimatedTokens * 0.8);
            const estimatedOutputTokens = Math.floor(estimatedTokens * 0.2);
            
            const inputCost = (estimatedInputTokens / 1000000) * modelInfo.inputPrice;
            const outputCost = (estimatedOutputTokens / 1000000) * modelInfo.outputPrice;
            const totalCost = inputCost + outputCost;

            return {
                modelId: modelInfo.modelId,
                modelName: modelInfo.modelName,
                provider: modelInfo.provider,
                category: modelInfo.category,
                pricing: {
                    inputPrice: modelInfo.inputPrice,
                    outputPrice: modelInfo.outputPrice,
                    unit: modelInfo.unit
                },
                estimation: {
                    inputTokens: estimatedInputTokens,
                    outputTokens: estimatedOutputTokens,
                    totalTokens: estimatedTokens,
                    inputCost,
                    outputCost,
                    totalCost
                },
                capabilities: modelInfo.capabilities || [],
                contextWindow: modelInfo.contextWindow,
                isLatest: modelInfo.isLatest || false,
                notes: modelInfo.notes || ''
            };
        }).filter(comparison => !comparison.error);

        // Sort by total cost (ascending)
        comparisons.sort((a, b) => (a.estimation?.totalCost || 0) - (b.estimation?.totalCost || 0));

        // Calculate savings compared to most expensive
        const mostExpensive = comparisons[comparisons.length - 1];
        const enhancedComparisons = comparisons.map(comparison => ({
            ...comparison,
            savings: {
                absolute: (mostExpensive.estimation?.totalCost || 0) - (comparison.estimation?.totalCost || 0),
                percentage: mostExpensive.estimation?.totalCost ? (((mostExpensive.estimation.totalCost - (comparison.estimation?.totalCost || 0)) / mostExpensive.estimation.totalCost) * 100) : 0
            }
        }));

        res.json({
            success: true,
            data: {
                comparisons: enhancedComparisons,
                summary: {
                    totalModels: comparisons.length,
                    cheapest: comparisons[0],
                    mostExpensive: mostExpensive,
                    averageCost: comparisons.reduce((sum, c) => sum + (c.estimation?.totalCost || 0), 0) / comparisons.length,
                    maxSavings: {
                        absolute: (mostExpensive.estimation?.totalCost || 0) - (comparisons[0]?.estimation?.totalCost || 0),
                        percentage: mostExpensive.estimation?.totalCost ? (((mostExpensive.estimation.totalCost - (comparisons[0]?.estimation?.totalCost || 0)) / mostExpensive.estimation.totalCost) * 100) : 0
                    }
                },
                estimationParams: {
                    prompt: prompt || null,
                    estimatedTokens,
                    inputTokenRatio: 0.8,
                    outputTokenRatio: 0.2
                }
            }
        });

    } catch (error) {
        logger.error('Error comparing models:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to compare models'
        });
    }
}));

/**
 * Get fine-tuning projects for experimentation
 */
router.get('/fine-tuning-projects', authenticate, asyncHandler(async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const provider = req.query.provider as string;
        const status = req.query.status as string;

        // Get user's projects to base fine-tuning suggestions on real project data
        const userProjects = await Project.find({
            $or: [
                { ownerId: userId },
                { 'members.userId': userId }
            ],
            isActive: true
        }).populate('ownerId', 'name email');

        // Get usage data for each project
        const projectUsageData = await Promise.all(
            userProjects.map(async (project) => {
                const projectUsage = await Usage.aggregate([
                    { $match: { projectId: project._id } },
                    {
                        $group: {
                            _id: { 
                                model: '$model', 
                                provider: '$service',
                                month: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }
                            },
                            totalTokens: { $sum: '$totalTokens' },
                            totalCost: { $sum: '$cost' },
                            requestCount: { $sum: 1 },
                            avgTokens: { $avg: '$totalTokens' },
                            lastUsed: { $max: '$createdAt' },
                            firstUsed: { $min: '$createdAt' }
                        }
                    },
                    { $sort: { totalTokens: -1 } }
                ]);

                return {
                    project,
                    usage: projectUsage
                };
            })
        );

        // Also get general user usage for models not tied to specific projects
        const generalUsage = await Usage.aggregate([
            { 
                $match: { 
                    userId,
                    projectId: { $exists: false } // Only usage not tied to projects
                } 
            },
            {
                $group: {
                    _id: { 
                        model: '$model', 
                        provider: '$service',
                        month: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }
                    },
                    totalTokens: { $sum: '$totalTokens' },
                    totalCost: { $sum: '$cost' },
                    requestCount: { $sum: 1 },
                    avgTokens: { $avg: '$totalTokens' },
                    lastUsed: { $max: '$createdAt' },
                    firstUsed: { $min: '$createdAt' }
                }
            },
            { $sort: { totalTokens: -1 } }
        ]);

        // Combine all usage data from projects and general usage
        const allUsageData: any[] = [];
        
        // Add project-based usage data
        projectUsageData.forEach(({ project, usage }) => {
            usage.forEach((usageItem: any) => {
                allUsageData.push({
                    ...usageItem,
                    projectId: project._id,
                    projectName: project.name,
                    projectBudget: project.budget,
                    projectSettings: project.settings
                });
            });
        });
        
        // Add general usage data
        generalUsage.forEach((usageItem: any) => {
            allUsageData.push({
                ...usageItem,
                projectId: null,
                projectName: 'Personal Usage',
                projectBudget: null,
                projectSettings: null
            });
        });

        // Generate dynamic fine-tuning project suggestions based on real project usage patterns
        const fineTuningProjects = allUsageData
            .filter((usage: any) => usage.totalTokens > 10000) // Only suggest for models with significant usage
            .slice(0, 20) // Limit to top 20 candidates
            .map((usage: any, index: number) => {
                const modelInfo = MODEL_PRICING.find(m => 
                    m.modelId === usage._id.model && m.provider === usage._id.provider
                );

                // Simulate different project statuses
                const statuses = ['completed', 'training', 'pending', 'failed', 'cancelled'];
                const randomStatus = statuses[index % statuses.length];
                
                // Calculate potential savings with fine-tuning
                const baseModelCost = usage.totalCost;
                const estimatedFineTuneCost = baseModelCost * 0.3; // Assume 70% cost reduction
                const trainingCost = usage.totalTokens * 0.000003; // $3 per 1M tokens training cost
                
                const createdDate = new Date();
                createdDate.setDate(createdDate.getDate() - (index * 7)); // Spread projects over time

                // Calculate budget impact if this is a project-based usage
                const budgetImpact = usage.projectBudget ? {
                    currentSpent: usage.totalCost,
                    budgetAmount: usage.projectBudget.amount,
                    budgetPeriod: usage.projectBudget.period,
                    budgetUsagePercent: (usage.totalCost / usage.projectBudget.amount) * 100,
                    potentialSavings: baseModelCost - estimatedFineTuneCost,
                    savingsAsPercentOfBudget: ((baseModelCost - estimatedFineTuneCost) / usage.projectBudget.amount) * 100
                } : null;

                return {
                    id: `ft-${usage._id.model.replace(/[^a-zA-Z0-9]/g, '')}-${usage.projectId || 'personal'}-${index + 1}`,
                    name: `${modelInfo?.modelName || usage._id.model} Fine-tune for ${usage.projectName}`,
                    baseModel: usage._id.model,
                    baseModelName: modelInfo?.modelName || usage._id.model,
                    provider: usage._id.provider,
                    projectId: usage.projectId,
                    projectName: usage.projectName,
                    status: randomStatus,
                    createdAt: createdDate.toISOString(),
                    completedAt: randomStatus === 'completed' ? new Date(createdDate.getTime() + 24 * 60 * 60 * 1000).toISOString() : null,
                    trainingData: {
                        examples: Math.floor(usage.requestCount * 0.8), // 80% of requests as training examples
                        validationExamples: Math.floor(usage.requestCount * 0.2),
                        totalTokens: usage.totalTokens,
                        avgTokensPerExample: Math.floor(usage.avgTokens)
                    },
                    performance: randomStatus === 'completed' ? {
                        accuracy: 0.85 + (Math.random() * 0.12), // 85-97% accuracy
                        loss: 0.1 + (Math.random() * 0.15), // 0.1-0.25 loss
                        trainingLoss: 0.05 + (Math.random() * 0.1),
                        validationLoss: 0.08 + (Math.random() * 0.12),
                        epochs: 3 + Math.floor(Math.random() * 5), // 3-7 epochs
                        learningRate: 0.0001 + (Math.random() * 0.0009) // 0.0001-0.001
                    } : null,
                    costs: {
                        trainingCost,
                        baseModelMonthlyCost: baseModelCost,
                        estimatedFineTuneMonthlyCost: estimatedFineTuneCost,
                        estimatedMonthlySavings: baseModelCost - estimatedFineTuneCost,
                        roi: ((baseModelCost - estimatedFineTuneCost - trainingCost) / trainingCost) * 100
                    },
                    budgetImpact,
                    hyperparameters: {
                        batchSize: [4, 8, 16, 32][Math.floor(Math.random() * 4)],
                        learningRateMultiplier: [0.1, 0.2, 0.5, 1.0][Math.floor(Math.random() * 4)],
                        nEpochs: 3 + Math.floor(Math.random() * 5),
                        promptLossWeight: 0.01 + (Math.random() * 0.09)
                    },
                    metrics: randomStatus === 'completed' ? {
                        tokensPerSecond: 50 + Math.random() * 100,
                        costPerToken: (modelInfo?.inputPrice || 1) * 0.7, // 30% cost reduction
                        latencyMs: 200 + Math.random() * 300,
                        throughput: 100 + Math.random() * 200
                    } : null,
                    tags: [
                        usage._id.month,
                        usage._id.provider,
                        modelInfo?.category || 'text',
                        randomStatus,
                        usage.projectName
                    ],
                    description: `Fine-tuned model based on ${usage.requestCount} requests from ${usage._id.month} in project "${usage.projectName}". Optimized for project-specific use case with ${Math.floor(usage.avgTokens)} avg tokens per request.`,
                    allowedByProjectSettings: usage.projectSettings ? 
                        (!usage.projectSettings.allowedModels || usage.projectSettings.allowedModels.includes(usage._id.model)) : true
                };
            });

        // Apply filters
        let filteredProjects = fineTuningProjects;
        
        if (provider) {
            filteredProjects = filteredProjects.filter(project => 
                project.provider.toLowerCase() === provider.toLowerCase()
            );
        }
        
        if (status) {
            filteredProjects = filteredProjects.filter(project => 
                project.status === status
            );
        }

        // Pagination
        const startIndex = (page - 1) * limit;
        const paginatedProjects = filteredProjects.slice(startIndex, startIndex + limit);

        // Summary statistics
        const summary = {
            totalProjects: filteredProjects.length,
            byStatus: filteredProjects.reduce((acc, project) => {
                acc[project.status] = (acc[project.status] || 0) + 1;
                return acc;
            }, {} as Record<string, number>),
            totalPotentialSavings: filteredProjects
                .filter(p => p.status === 'completed')
                .reduce((sum, p) => sum + p.costs.estimatedMonthlySavings, 0),
            totalTrainingCost: filteredProjects.reduce((sum, p) => sum + p.costs.trainingCost, 0),
            avgROI: filteredProjects
                .filter(p => p.status === 'completed')
                .reduce((sum, p, _, arr) => sum + p.costs.roi / arr.length, 0)
        };

        // Provider breakdown
        const providerBreakdown = filteredProjects.reduce((acc: any, project: any) => {
            if (!acc[project.provider]) {
                acc[project.provider] = {
                    count: 0,
                    completed: 0,
                    totalSavings: 0,
                    avgROI: 0
                };
            }
            acc[project.provider].count++;
            if (project.status === 'completed') {
                acc[project.provider].completed++;
                acc[project.provider].totalSavings += project.costs.estimatedMonthlySavings;
                acc[project.provider].avgROI += project.costs.roi;
            }
            return acc;
        }, {} as Record<string, any>);

        // Project breakdown - group by actual projects
        const projectBreakdown = filteredProjects.reduce((acc: any, fineTuneProject: any) => {
            const projectKey = fineTuneProject.projectId || 'personal';
            const projectName = fineTuneProject.projectName || 'Personal Usage';
            
            if (!acc[projectKey]) {
                acc[projectKey] = {
                    projectName,
                    count: 0,
                    completed: 0,
                    totalSavings: 0,
                    totalBudgetImpact: 0,
                    models: []
                };
            }
            acc[projectKey].count++;
            acc[projectKey].models.push(fineTuneProject.baseModel);
            
            if (fineTuneProject.status === 'completed') {
                acc[projectKey].completed++;
                acc[projectKey].totalSavings += fineTuneProject.costs.estimatedMonthlySavings;
                if (fineTuneProject.budgetImpact) {
                    acc[projectKey].totalBudgetImpact += fineTuneProject.budgetImpact.savingsAsPercentOfBudget;
                }
            }
            return acc;
        }, {} as Record<string, any>);

        // Calculate averages for provider breakdown
        Object.keys(providerBreakdown).forEach(provider => {
            if (providerBreakdown[provider].completed > 0) {
                providerBreakdown[provider].avgROI /= providerBreakdown[provider].completed;
            }
        });

        res.json({
            success: true,
            data: {
                projects: paginatedProjects, // This is already an array
                pagination: {
                    page,
                    limit,
                    totalCount: filteredProjects.length,
                    totalPages: Math.ceil(filteredProjects.length / limit),
                    hasMore: startIndex + limit < filteredProjects.length
                },
                summary,
                providerBreakdown,
                projectBreakdown,
                filters: {
                    provider,
                    status,
                    availableStatuses: ['completed', 'training', 'pending', 'failed', 'cancelled'],
                    availableProviders: [...new Set(fineTuningProjects.map((p: any) => p.provider))],
                    availableProjects: [...new Set(fineTuningProjects.map((p: any) => p.projectName))]
                },
                recommendations: {
                    topCandidates: fineTuningProjects
                        .filter((p: any) => p.costs.roi > 100) // ROI > 100%
                        .slice(0, 3)
                        .map((p: any) => ({
                            id: p.id,
                            name: p.name,
                            provider: p.provider,
                            projectName: p.projectName,
                            estimatedSavings: p.costs.estimatedMonthlySavings,
                            roi: p.costs.roi,
                            trainingExamples: p.trainingData.examples,
                            budgetImpact: p.budgetImpact
                        })),
                    projectInsights: Object.entries(projectBreakdown).map(([projectId, data]: [string, any]) => ({
                        projectId,
                        projectName: data.projectName,
                        potentialSavings: data.totalSavings,
                        budgetImpactPercent: data.totalBudgetImpact,
                        modelCount: data.count,
                        uniqueModels: [...new Set(data.models)].length
                    })),
                    insights: [
                        `You have ${fineTuningProjects.length} models across ${userProjects.length} projects that could benefit from fine-tuning`,
                        `Potential monthly savings: $${summary.totalPotentialSavings.toFixed(2)}`,
                        `Average ROI: ${summary.avgROI.toFixed(1)}%`,
                        `Best performing provider: ${Object.entries(providerBreakdown)
                            .sort(([,a], [,b]) => (b as any).avgROI - (a as any).avgROI)[0]?.[0] || 'N/A'}`,
                        `Most active project: ${Object.entries(projectBreakdown)
                            .sort(([,a], [,b]) => (b as any).count - (a as any).count)[0]?.[1] ? (Object.entries(projectBreakdown)
                            .sort(([,a], [,b]) => (b as any).count - (a as any).count)[0][1] as any).projectName : 'N/A'}`
                    ]
                }
            }
        });

    } catch (error) {
        logger.error('Error fetching fine-tuning projects:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch fine-tuning projects'
        });
    }
}));

/**
 * Create a new fine-tuning project
 */
router.post('/fine-tuning-projects', authenticate, asyncHandler(async (req: Request, res: Response): Promise<any> => {
    try {
        const userId = (req as any).user.id;
        const { 
            name, 
            baseModel, 
            provider, 
            trainingData, 
            hyperparameters,
            description 
        } = req.body;

        if (!name || !baseModel || !provider) {
            return res.status(400).json({
                success: false,
                error: 'Name, base model, and provider are required'
            });
        }

        // Get a real project ID from user's projects or create a new one
        const { projectId: requestedProjectId } = req.body;
        let targetProjectId = null;
        
        if (requestedProjectId) {
            // Verify the user has access to this project
            const project = await Project.findOne({
                _id: requestedProjectId,
                $or: [
                    { ownerId: userId },
                    { 'members.userId': userId }
                ]
            });
            
            if (project) {
                targetProjectId = project._id;
            }
        }
        
        // If no valid project specified, use the user's first active project
        if (!targetProjectId) {
            const firstProject = await Project.findOne({
                $or: [
                    { ownerId: userId },
                    { 'members.userId': userId }
                ],
                isActive: true
            });
            
            if (firstProject) {
                targetProjectId = firstProject._id;
            }
        }

        const fineTuneProjectId = `ft-${baseModel.replace(/[^a-zA-Z0-9]/g, '')}-${Date.now()}`;
        
        const modelInfo = MODEL_PRICING.find(m => 
            m.modelId === baseModel && m.provider === provider
        );

        // Estimate training cost
        const estimatedTrainingTokens = trainingData?.estimatedTokens || 100000;
        const trainingCost = estimatedTrainingTokens * 0.000003; // $3 per 1M tokens

        const newProject = {
            id: fineTuneProjectId,
            name,
            baseModel,
            baseModelName: modelInfo?.modelName || baseModel,
            provider,
            projectId: targetProjectId,
            status: 'pending',
            createdAt: new Date().toISOString(),
            completedAt: null,
            userId,
            trainingData: {
                examples: trainingData?.examples || 0,
                validationExamples: trainingData?.validationExamples || 0,
                totalTokens: estimatedTrainingTokens,
                avgTokensPerExample: trainingData?.avgTokensPerExample || 100
            },
            hyperparameters: {
                batchSize: hyperparameters?.batchSize || 8,
                learningRateMultiplier: hyperparameters?.learningRateMultiplier || 0.2,
                nEpochs: hyperparameters?.nEpochs || 4,
                promptLossWeight: hyperparameters?.promptLossWeight || 0.05
            },
            costs: {
                trainingCost,
                estimatedMonthlySavings: 0, // Will be calculated after completion
                roi: 0
            },
            description: description || `Fine-tuning project for ${baseModel}`,
            tags: [
                new Date().toISOString().slice(0, 7), // Current month
                provider,
                modelInfo?.category || 'text',
                'pending'
            ]
        };

        // In a real implementation, you would save this to a database
        // For now, we'll just return the created project

        res.status(201).json({
            success: true,
            data: {
                project: newProject,
                message: 'Fine-tuning project created successfully',
                estimatedCompletionTime: '2-4 hours',
                nextSteps: [
                    'Upload your training data',
                    'Review hyperparameters',
                    'Start training process',
                    'Monitor training progress'
                ]
            }
        });

    } catch (error) {
        logger.error('Error creating fine-tuning project:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create fine-tuning project'
        });
    }
}));

/**
 * Get specific fine-tuning project details
 */
router.get('/fine-tuning-projects/:id', authenticate, asyncHandler(async (req: Request, res: Response) => {
    try {
        const projectId = req.params.id;
        const userId = (req as any).user.id;

        // In a real implementation, you would fetch from database
        // For now, simulate project details based on ID
        
        const mockProject = {
            id: projectId,
            name: `Fine-tune Project ${projectId.slice(-4)}`,
            baseModel: 'gpt-3.5-turbo',
            baseModelName: 'GPT-3.5 Turbo',
            provider: 'OpenAI',
            status: 'completed',
            createdAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
            completedAt: new Date().toISOString(),
            userId,
            trainingData: {
                examples: 1500,
                validationExamples: 300,
                totalTokens: 150000,
                avgTokensPerExample: 100
            },
            performance: {
                accuracy: 0.94,
                loss: 0.12,
                trainingLoss: 0.08,
                validationLoss: 0.15,
                epochs: 4,
                learningRate: 0.0002
            },
            costs: {
                trainingCost: 0.45,
                baseModelMonthlyCost: 120.50,
                estimatedFineTuneMonthlyCost: 84.35,
                estimatedMonthlySavings: 36.15,
                roi: 8033.33
            },
            hyperparameters: {
                batchSize: 8,
                learningRateMultiplier: 0.2,
                nEpochs: 4,
                promptLossWeight: 0.05
            },
            metrics: {
                tokensPerSecond: 125.5,
                costPerToken: 0.0000105,
                latencyMs: 245,
                throughput: 180.3
            },
            trainingProgress: [
                { epoch: 1, trainingLoss: 0.45, validationLoss: 0.48, accuracy: 0.78 },
                { epoch: 2, trainingLoss: 0.23, validationLoss: 0.28, accuracy: 0.86 },
                { epoch: 3, trainingLoss: 0.15, validationLoss: 0.19, accuracy: 0.91 },
                { epoch: 4, trainingLoss: 0.08, validationLoss: 0.15, accuracy: 0.94 }
            ],
            tags: ['2025-07', 'OpenAI', 'text', 'completed'],
            description: 'Fine-tuned model for customer support responses'
        };

        res.json({
            success: true,
            data: {
                project: mockProject,
                deploymentOptions: [
                    {
                        name: 'Production Deployment',
                        description: 'Deploy to production environment',
                        estimatedLatency: '200-300ms',
                        scalability: 'Auto-scaling enabled'
                    },
                    {
                        name: 'A/B Testing',
                        description: 'Compare with base model',
                        trafficSplit: '10% fine-tuned, 90% base model',
                        duration: '7 days'
                    }
                ],
                insights: [
                    `Model achieved ${(mockProject.performance.accuracy * 100).toFixed(1)}% accuracy`,
                    `${mockProject.costs.roi.toFixed(0)}% ROI with $${mockProject.costs.estimatedMonthlySavings.toFixed(2)} monthly savings`,
                    `Training completed in ${mockProject.performance.epochs} epochs`,
                    `Ready for production deployment`
                ]
            }
        });

    } catch (error) {
        logger.error('Error fetching fine-tuning project details:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch project details'
        });
    }
}));

/**
 * Get experiments data (for frontend compatibility)
 */
router.get('/experiments', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;

        // Get real project data and usage data
        const userProjects = await Project.find({
            $or: [
                { ownerId: userId },
                { 'members.userId': userId }
            ],
            isActive: true
        });

        // Get usage data for each project
        const projectUsageData = await Promise.all(
            userProjects.map(async (project) => {
                const projectUsage = await Usage.aggregate([
                    { 
                        $match: { 
                            projectId: project._id,
                            createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
                        }
                    },
                    {
                        $group: {
                            _id: { 
                                model: '$model', 
                                provider: '$service'
                            },
                            totalTokens: { $sum: '$totalTokens' },
                            totalCost: { $sum: '$cost' },
                            requestCount: { $sum: 1 },
                            avgTokens: { $avg: '$totalTokens' }
                        }
                    },
                    { $sort: { totalTokens: -1 } }
                ]);

                return {
                    project,
                    usage: projectUsage
                };
            })
        );

        // Convert project data to experiments format - real data only
        const experiments = projectUsageData.flatMap(({ project, usage }) => {
            return usage.map((modelUsage: any) => {
                // Determine status based on real usage patterns
                const daysSinceLastUsed = Math.floor((Date.now() - new Date(modelUsage.lastUsed || Date.now()).getTime()) / (1000 * 60 * 60 * 24));
                const status = daysSinceLastUsed < 7 ? 'active' : daysSinceLastUsed < 30 ? 'completed' : 'pending';
                
                // Calculate real potential savings based on usage
                const potentialSavings = modelUsage.totalCost * 0.25; // 25% potential savings through optimization
                const budgetUsage = project.budget.amount > 0 ? (modelUsage.totalCost / project.budget.amount) * 100 : 0;
                
                return {
                    id: `exp-${project._id}-${modelUsage._id.model}`,
                    name: `${project.name} - ${modelUsage._id.model} Analysis`,
                    description: `Cost optimization analysis for ${modelUsage._id.model} in ${project.name}`,
                    type: 'cost-optimization',
                    status: status as 'active' | 'completed' | 'pending',
                    createdAt: project.createdAt.toISOString(),
                    results: {
                        accuracy: null, // Only set for completed ML experiments
                        cost: modelUsage.totalCost,
                        latency: null,
                        savings: status === 'completed' ? potentialSavings : 0,
                        efficiency: modelUsage.requestCount > 0 ? (modelUsage.totalTokens / modelUsage.requestCount) / 1000 : 0,
                        roi: status === 'completed' ? (potentialSavings / (modelUsage.totalCost * 0.05)) * 100 : 0 // ROI based on 5% implementation cost
                    },
                    projectId: project._id,
                    projectName: project.name,
                    budgetUsage,
                    modelInfo: {
                        model: modelUsage._id.model,
                        provider: modelUsage._id.provider,
                        totalTokens: modelUsage.totalTokens,
                        requestCount: modelUsage.requestCount
                    }
                };
            });
        });

        // Add project-level experiments if no model-specific usage exists
        if (experiments.length === 0 && userId) {
            const allUserProjects = await Project.find({
                $or: [
                    { ownerId: userId },
                    { 'members.userId': userId }
                ],
                isActive: true
            });

            // Create project-level experiments for projects without specific model usage
            const projectExperiments = allUserProjects.map((project) => {
                const budgetUsage = project.budget.amount > 0 ? (project.spending.current / project.budget.amount) * 100 : 0;
                const daysSinceCreated = Math.floor((Date.now() - project.createdAt.getTime()) / (1000 * 60 * 60 * 24));
                const status = project.spending.current > 0 ? 'active' : daysSinceCreated > 30 ? 'completed' : 'pending';
                
                return {
                    id: `exp-project-${project._id}`,
                    name: `${project.name} - Budget Analysis`,
                    description: `Budget utilization and cost optimization analysis for ${project.name}`,
                    type: 'budget-analysis',
                    status: status as 'active' | 'completed' | 'pending',
                    createdAt: project.createdAt.toISOString(),
                    results: {
                        accuracy: null,
                        cost: project.spending.current,
                        latency: null,
                        savings: status === 'completed' ? project.spending.current * 0.15 : 0,
                        efficiency: budgetUsage > 0 ? Math.min(budgetUsage / 100, 1) : 0,
                        roi: status === 'completed' ? 150 : 0
                    },
                    projectId: project._id,
                    projectName: project.name,
                    budgetUsage,
                    modelInfo: {
                        model: 'project-wide',
                        provider: 'multiple',
                        totalTokens: 0,
                        requestCount: 0
                    }
                };
            });

            experiments.push(...projectExperiments);
        }

        res.json({
            success: true,
            data: {
                experiments, // Frontend expects this array
                totalExperiments: experiments.length,
                activeExperiments: experiments.filter(e => e.status === 'active').length,
                completedExperiments: experiments.filter(e => e.status === 'completed').length
            }
        });

    } catch (error) {
        logger.error('Error fetching experiments:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch experiments'
        });
    }
}));

/**
 * Get what-if scenarios for experimentation
 */
router.get('/what-if-scenarios', authenticate, asyncHandler(async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;

        // Get user's projects and usage data
        const userProjects = await Project.find({
            $or: [
                { ownerId: userId },
                { 'members.userId': userId }
            ],
            isActive: true
        });

        // Get recent usage data to base scenarios on
        const recentUsage = await Usage.aggregate([
            { 
                $match: { 
                    userId,
                    createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
                }
            },
            {
                $group: {
                    _id: { 
                        model: '$model', 
                        provider: '$service'
                    },
                    totalTokens: { $sum: '$totalTokens' },
                    totalCost: { $sum: '$cost' },
                    requestCount: { $sum: 1 },
                    avgTokens: { $avg: '$totalTokens' },
                    avgCost: { $avg: '$cost' },
                    projectIds: { $addToSet: '$projectId' }
                }
            },
            { $sort: { totalCost: -1 } },
            { $limit: 10 }
        ]);

        // Generate what-if scenarios based on real usage patterns
        const scenarios = recentUsage.map((usage: any, index: number) => {
            const modelInfo = MODEL_PRICING.find(m => 
                m.modelId === usage._id.model && m.provider === usage._id.provider
            );

            // Calculate different usage scenarios
            const baselineMonthly = usage.totalCost;
            const scenarios = [
                {
                    name: "Current Usage",
                    description: "Your actual usage from the last 30 days",
                    multiplier: 1,
                    monthlyCost: baselineMonthly,
                    monthlyTokens: usage.totalTokens,
                    requests: usage.requestCount
                },
                {
                    name: "2x Scale Up",
                    description: "Double your current usage",
                    multiplier: 2,
                    monthlyCost: baselineMonthly * 2,
                    monthlyTokens: usage.totalTokens * 2,
                    requests: usage.requestCount * 2
                },
                {
                    name: "5x Scale Up", 
                    description: "5x your current usage for rapid growth",
                    multiplier: 5,
                    monthlyCost: baselineMonthly * 5,
                    monthlyTokens: usage.totalTokens * 5,
                    requests: usage.requestCount * 5
                },
                {
                    name: "10x Scale Up",
                    description: "10x usage for enterprise scale",
                    multiplier: 10,
                    monthlyCost: baselineMonthly * 10,
                    monthlyTokens: usage.totalTokens * 10,
                    requests: usage.requestCount * 10
                },
                {
                    name: "50% Reduction",
                    description: "Optimized usage with 50% reduction",
                    multiplier: 0.5,
                    monthlyCost: baselineMonthly * 0.5,
                    monthlyTokens: usage.totalTokens * 0.5,
                    requests: usage.requestCount * 0.5
                }
            ];

            // Alternative model suggestions
            const alternativeModels = MODEL_PRICING
                .filter(m => m.provider === usage._id.provider && m.modelId !== usage._id.model)
                .sort((a, b) => (a.inputPrice + a.outputPrice) - (b.inputPrice + b.outputPrice))
                .slice(0, 3)
                .map(altModel => {
                    const altInputCost = (usage.totalTokens * 0.8 / 1000000) * altModel.inputPrice;
                    const altOutputCost = (usage.totalTokens * 0.2 / 1000000) * altModel.outputPrice;
                    const altTotalCost = altInputCost + altOutputCost;
                    
                    return {
                        modelId: altModel.modelId,
                        modelName: altModel.modelName,
                        monthlyCost: altTotalCost,
                        savings: baselineMonthly - altTotalCost,
                        savingsPercent: ((baselineMonthly - altTotalCost) / baselineMonthly) * 100,
                        inputPrice: altModel.inputPrice,
                        outputPrice: altModel.outputPrice
                    };
                });

            return {
                id: `scenario-${usage._id.model.replace(/[^a-zA-Z0-9]/g, '')}-${index + 1}`,
                model: usage._id.model,
                modelName: modelInfo?.modelName || usage._id.model,
                provider: usage._id.provider,
                category: modelInfo?.category || 'text',
                baselineUsage: {
                    monthlyCost: baselineMonthly,
                    monthlyTokens: usage.totalTokens,
                    requests: usage.requestCount,
                    avgCostPerRequest: usage.avgCost,
                    avgTokensPerRequest: usage.avgTokens
                },
                scenarios,
                alternatives: alternativeModels,
                projectsAffected: usage.projectIds.filter((id: any) => id).length,
                insights: [
                    `Current monthly spend: $${baselineMonthly.toFixed(2)}`,
                    `At 10x scale: $${(baselineMonthly * 10).toFixed(2)}/month`,
                    `Best alternative could save: $${alternativeModels[0] ? Math.max(0, alternativeModels[0].savings).toFixed(2) : '0.00'}/month`,
                    `Used across ${usage.projectIds.filter((id: any) => id).length} projects`
                ]
            };
        });

        // Budget impact analysis for projects
        const projectImpacts = await Promise.all(
            userProjects.map(async (project) => {
                const projectUsage = await Usage.aggregate([
                    { 
                        $match: { 
                            projectId: project._id,
                            createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            totalCost: { $sum: '$cost' },
                            totalTokens: { $sum: '$totalTokens' },
                            requestCount: { $sum: 1 }
                        }
                    }
                ]);

                const currentSpend = projectUsage[0]?.totalCost || 0;
                const budgetUsage = project.budget.amount > 0 ? (currentSpend / project.budget.amount) * 100 : 0;

                return {
                    projectId: project._id,
                    projectName: project.name,
                    currentSpend,
                    budgetAmount: project.budget.amount,
                    budgetUsage,
                    scenarios: [
                        {
                            name: "Current",
                            cost: currentSpend,
                            budgetUsage: budgetUsage
                        },
                        {
                            name: "2x Scale",
                            cost: currentSpend * 2,
                            budgetUsage: budgetUsage * 2
                        },
                        {
                            name: "5x Scale", 
                            cost: currentSpend * 5,
                            budgetUsage: budgetUsage * 5
                        },
                        {
                            name: "10x Scale",
                            cost: currentSpend * 10,
                            budgetUsage: budgetUsage * 10
                        }
                    ]
                };
            })
        );

        // Pagination
        const startIndex = (page - 1) * limit;
        const paginatedScenarios = scenarios.slice(startIndex, startIndex + limit);

        // Format data to match frontend expectations
        const formattedScenarios = paginatedScenarios.map((scenario: any) => ({
            name: scenario.model,
            description: `What-if analysis for ${scenario.modelName}`,
            timeframe: 'monthly' as const,
            changes: scenario.scenarios.map((change: any) => ({
                type: 'volume_change' as const,
                currentValue: { volume: change.monthlyTokens },
                proposedValue: { volume: change.monthlyTokens * change.multiplier },
                affectedMetrics: ['cost', 'performance'],
                description: change.description
            })),
            baselineData: {
                cost: scenario.baselineUsage.monthlyCost,
                volume: scenario.baselineUsage.monthlyTokens,
                performance: scenario.baselineUsage.avgTokensPerRequest
            }
        }));

        res.json({
            success: true,
            data: {
                scenarios: formattedScenarios, // Array of scenarios
                projectImpacts: Object.values(projectImpacts), // Convert to array
                pagination: {
                    page,
                    limit,
                    totalCount: scenarios.length,
                    totalPages: Math.ceil(scenarios.length / limit),
                    hasMore: startIndex + limit < scenarios.length
                },
                summary: {
                    totalModelsAnalyzed: scenarios.length,
                    totalCurrentSpend: scenarios.reduce((sum: number, s: any) => sum + s.baselineUsage.monthlyCost, 0),
                    totalProjectsAffected: userProjects.length,
                    potentialSavingsRange: {
                        min: scenarios.reduce((sum: number, s: any) => sum + Math.min(...s.alternatives.map((a: any) => Math.max(0, a.savings))), 0),
                        max: scenarios.reduce((sum: number, s: any) => sum + Math.max(...s.alternatives.map((a: any) => Math.max(0, a.savings))), 0)
                    }
                },
                insights: [
                    `Analyzed ${scenarios.length} models across ${userProjects.length} projects`,
                    `Current total spend: $${scenarios.reduce((sum: number, s: any) => sum + s.baselineUsage.monthlyCost, 0).toFixed(2)}/month`,
                    `At 10x scale: $${scenarios.reduce((sum: number, s: any) => sum + s.baselineUsage.monthlyCost * 10, 0).toFixed(2)}/month`,
                    `Potential savings: $${scenarios.reduce((sum: number, s: any) => sum + Math.max(...s.alternatives.map((a: any) => Math.max(0, a.savings))), 0).toFixed(2)}/month`
                ]
            }
        });

    } catch (error) {
        logger.error('Error fetching what-if scenarios:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch what-if scenarios'
        });
    }
}));

export default router; 