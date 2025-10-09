import { loggingService } from './logging.service';

interface SmartRecommendation {
    type: 'prompt_optimization' | 'model_switch' | 'cost_reduction' | 'timing' | 'limit_warning' | 'personalized_coaching';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    title: string;
    message: string;
    suggestedAction: string;
    potentialSavings?: {
        tokens: number;
        cost: number;
        percentage: number;
    };
    costKatanaUrl?: string;
    aiGenerated: boolean;
    personalized: boolean;
    confidence: number;
}

interface UsagePattern {
    averageTokensPerRequest: number;
    mostUsedModels: string[];
    peakUsageHours: number[];
    commonTopics: string[];
    inefficiencyScore: number;
}

interface ChatGPTPlan {
    name: string;
    cost: number;
    monthlyLimit?: number;
    dailyLimit?: number;
}

export class RecommendationRulesService {
    /**
     * Generate rule-based recommendations
     */
    static generateRecommendations(
        userId: string,
        monthlyUsage: any[],
        pattern: UsagePattern,
        plan: ChatGPTPlan
    ): SmartRecommendation[] {
        const recommendations: SmartRecommendation[] = [];
        
        // Run all rule checks
        const ruleChecks = [
            this.checkHighGPT4Usage,
            this.checkLargePrompts,
            this.checkRepetitivePatterns,
            this.checkPeakHourUsage,
            this.checkModelMismatch,
            this.checkLimitApproaching,
            this.checkInefficiency
        ];
        
        for (const ruleCheck of ruleChecks) {
            const result = ruleCheck.call(this, userId, monthlyUsage, pattern, plan);
            if (result) {
                if (Array.isArray(result)) {
                    recommendations.push(...result);
                } else {
                    recommendations.push(result);
                }
            }
        }
        
        // Sort by priority and potential savings
        return recommendations.sort((a, b) => {
            const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
            const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
            if (priorityDiff !== 0) return priorityDiff;
            
            const aSavings = a.potentialSavings?.cost || 0;
            const bSavings = b.potentialSavings?.cost || 0;
            return bSavings - aSavings;
        });
    }
    
    /**
     * Check for high GPT-4 usage
     */
    private static checkHighGPT4Usage(
        userId: string,
        monthlyUsage: any[],
        _pattern: UsagePattern,
        _plan: ChatGPTPlan
    ): SmartRecommendation | null {
        const gpt4Usage = monthlyUsage.filter(u => 
            u.model.includes('gpt-4') || u.model.includes('gpt4')
        );
        
        if (gpt4Usage.length === 0) return null;
        
        const gpt4Cost = gpt4Usage.reduce((sum, u) => sum + u.cost, 0);
        const totalCost = monthlyUsage.reduce((sum, u) => sum + u.cost, 0);
        const percentage = (gpt4Cost / totalCost) * 100;
        
        if (percentage > 70) {
            const potentialSavings = gpt4Cost * 0.4; // 40% savings by switching 50% to GPT-3.5
            
            return {
                type: 'model_switch',
                priority: 'high',
                title: 'High GPT-4 Costs Detected',
                message: `GPT-4 accounts for ${percentage.toFixed(1)}% ($${gpt4Cost.toFixed(2)}) of your monthly costs. Many queries could use GPT-3.5-turbo at 1/10th the cost.`,
                suggestedAction: 'Review your GPT-4 requests and identify simple queries that can be handled by GPT-3.5-turbo. This could save you up to 90% on those requests.',
                potentialSavings: {
                    tokens: 0,
                    cost: potentialSavings,
                    percentage: 40
                },
                costKatanaUrl: `${process.env.FRONTEND_URL}/model-optimizer?user=${userId.substring(0, 8)}`,
                aiGenerated: false,
                personalized: true,
                confidence: 95
            };
        }
        
        return null;
    }
    
    /**
     * Check for large prompts
     */
    private static checkLargePrompts(
        userId: string,
        monthlyUsage: any[],
        pattern: UsagePattern,
        _plan: ChatGPTPlan
    ): SmartRecommendation | null {
        if (pattern.averageTokensPerRequest > 1000) {
            const largePrompts = monthlyUsage.filter(u => u.promptTokens > 1500);
            const avgCost = monthlyUsage.reduce((sum, u) => sum + u.cost, 0) / monthlyUsage.length;
            const potentialSavings = largePrompts.length * avgCost * 0.3;
            
            return {
                type: 'prompt_optimization',
                priority: 'medium',
                title: 'Large Prompts Detected',
                message: `Your average prompt uses ${Math.round(pattern.averageTokensPerRequest)} tokens. ${largePrompts.length} prompts exceed 1,500 tokens.`,
                suggestedAction: 'Optimize your prompts by removing unnecessary context, using more concise language, and leveraging summarization for long inputs.',
                potentialSavings: {
                    tokens: largePrompts.length * 500,
                    cost: potentialSavings,
                    percentage: 30
                },
                costKatanaUrl: `${process.env.FRONTEND_URL}/prompt-optimizer?user=${userId.substring(0, 8)}`,
                aiGenerated: false,
                personalized: true,
                confidence: 90
            };
        }
        
        return null;
    }
    
    /**
     * Check for repetitive patterns
     */
    private static checkRepetitivePatterns(
        userId: string,
        monthlyUsage: any[],
        pattern: UsagePattern,
        _plan: ChatGPTPlan
    ): SmartRecommendation | null {
        // Simple repetition detection based on similar prompts
        const promptMap = new Map<string, number>();
        
        monthlyUsage.forEach(u => {
            const normalizedPrompt = (u.prompt || '').toLowerCase().substring(0, 50);
            promptMap.set(normalizedPrompt, (promptMap.get(normalizedPrompt) || 0) + 1);
        });
        
        const repetitivePrompts = Array.from(promptMap.values()).filter(count => count > 3);
        const repetitivePercentage = (repetitivePrompts.length / monthlyUsage.length) * 100;
        
        if (repetitivePercentage > 20) {
            const avgCost = monthlyUsage.reduce((sum, u) => sum + u.cost, 0) / monthlyUsage.length;
            const repetitiveCount = repetitivePrompts.reduce((sum, count) => sum + count, 0);
            const potentialSavings = repetitiveCount * avgCost * 0.8; // 80% savings with caching
            
            return {
                type: 'cost_reduction',
                priority: 'high',
                title: 'Repetitive Queries Detected',
                message: `${repetitivePercentage.toFixed(1)}% of your queries are repetitive. Implementing response caching could dramatically reduce costs.`,
                suggestedAction: 'Enable semantic caching in Cost Katana to reuse responses for similar queries without making new API calls.',
                potentialSavings: {
                    tokens: repetitiveCount * pattern.averageTokensPerRequest,
                    cost: potentialSavings,
                    percentage: 80
                },
                costKatanaUrl: `${process.env.FRONTEND_URL}/caching-setup?user=${userId.substring(0, 8)}`,
                aiGenerated: false,
                personalized: true,
                confidence: 85
            };
        }
        
        return null;
    }
    
    /**
     * Check peak hour usage
     */
    private static checkPeakHourUsage(
        userId: string,
        monthlyUsage: any[],
        pattern: UsagePattern,
        _plan: ChatGPTPlan
    ): SmartRecommendation | null {
        // Check if usage is concentrated in peak hours
        const peakHours = pattern.peakUsageHours;
        const peakUsage = monthlyUsage.filter(u => {
            const hour = new Date(u.createdAt).getHours();
            return peakHours.includes(hour);
        });
        
        const peakPercentage = (peakUsage.length / monthlyUsage.length) * 100;
        
        // If more than 70% of usage is in 3 or fewer hours, suggest batch processing
        if (peakPercentage > 70 && peakHours.length <= 3) {
            return {
                type: 'timing',
                priority: 'low',
                title: 'Concentrated Peak Hour Usage',
                message: `${peakPercentage.toFixed(1)}% of your requests occur during ${peakHours.length} peak hours. Consider batch processing for non-urgent tasks.`,
                suggestedAction: 'Implement batch processing for non-urgent queries to distribute load and potentially use batch API endpoints with lower costs.',
                potentialSavings: {
                    tokens: 0,
                    cost: 0,
                    percentage: 0
                },
                costKatanaUrl: `${process.env.FRONTEND_URL}/batch-processing?user=${userId.substring(0, 8)}`,
                aiGenerated: false,
                personalized: true,
                confidence: 75
            };
        }
        
        return null;
    }
    
    /**
     * Check for model mismatch (expensive model for simple tasks)
     */
    private static checkModelMismatch(
        userId: string,
        monthlyUsage: any[],
        _pattern: UsagePattern,
        _plan: ChatGPTPlan
    ): SmartRecommendation | null {
        // Find GPT-4 requests with short responses (likely simple tasks)
        const simpleGPT4Tasks = monthlyUsage.filter(u => 
            (u.model.includes('gpt-4') || u.model.includes('gpt4')) &&
            u.completionTokens < 150
        );
        
        if (simpleGPT4Tasks.length > 10) {
            const wastedCost = simpleGPT4Tasks.reduce((sum, u) => sum + u.cost, 0);
            const potentialSavings = wastedCost * 0.9; // 90% savings switching to GPT-3.5
            
            return {
                type: 'model_switch',
                priority: 'medium',
                title: 'Using GPT-4 for Simple Tasks',
                message: `${simpleGPT4Tasks.length} GPT-4 requests returned short responses (<150 tokens), suggesting simple tasks that don't need advanced capabilities.`,
                suggestedAction: 'Use GPT-3.5-turbo for simple tasks like classification, extraction, or short-form content. Reserve GPT-4 for complex reasoning.',
                potentialSavings: {
                    tokens: 0,
                    cost: potentialSavings,
                    percentage: 90
                },
                costKatanaUrl: `${process.env.FRONTEND_URL}/model-selector?user=${userId.substring(0, 8)}`,
                aiGenerated: false,
                personalized: true,
                confidence: 88
            };
        }
        
        return null;
    }
    
    /**
     * Check if approaching limits
     */
    private static checkLimitApproaching(
        userId: string,
        monthlyUsage: any[],
        _pattern: UsagePattern,
        plan: ChatGPTPlan
    ): SmartRecommendation | null {
        if (!plan.monthlyLimit || plan.monthlyLimit <= 0) return null;
        
        const currentCount = monthlyUsage.length;
        const percentage = (currentCount / plan.monthlyLimit) * 100;
        
        if (percentage >= 80) {
            return {
                type: 'limit_warning',
                priority: percentage >= 90 ? 'urgent' : 'high',
                title: `Approaching ${plan.name} Plan Limit`,
                message: `You've used ${percentage.toFixed(1)}% (${currentCount}/${plan.monthlyLimit}) of your monthly limit.`,
                suggestedAction: percentage >= 90 
                    ? 'Switch to Cost Katana API immediately to avoid hitting limits.'
                    : 'Monitor your usage closely or switch to Cost Katana API for unlimited access.',
                costKatanaUrl: `${process.env.FRONTEND_URL}/upgrade?source=limit_warning`,
                aiGenerated: false,
                personalized: false,
                confidence: 100
            };
        }
        
        return null;
    }
    
    /**
     * Check inefficiency score
     */
    private static checkInefficiency(
        userId: string,
        _monthlyUsage: any[],
        pattern: UsagePattern,
        _plan: ChatGPTPlan
    ): SmartRecommendation | null {
        if (pattern.inefficiencyScore > 60) {
            return {
                type: 'personalized_coaching',
                priority: 'medium',
                title: 'High Inefficiency Score Detected',
                message: `Your usage has an inefficiency score of ${pattern.inefficiencyScore}/100. This suggests opportunities for optimization.`,
                suggestedAction: 'Review the What-If Simulator to identify specific optimizations for your usage patterns.',
                costKatanaUrl: `${process.env.FRONTEND_URL}/what-if-simulator?user=${userId.substring(0, 8)}`,
                aiGenerated: false,
                personalized: true,
                confidence: 80
            };
        }
        
        return null;
    }
}

