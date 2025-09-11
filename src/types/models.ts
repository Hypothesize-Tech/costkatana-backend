export interface ITokenUsage {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
}

export interface IUsageData {
    userId: string;
    service: 'openai' | 'aws-bedrock' | 'google-ai' | 'anthropic';
    model: string;
    prompt: string;
    completion?: string;
    tokenUsage: ITokenUsage;
    cost: number;
    timestamp: Date;
    metadata?: Record<string, any>;
    optimizationSuggestions?: string[];
    tags?: string[];
}

export interface IOptimization {
    userId: string;
    userQuery: string; // Changed from originalPrompt
    generatedAnswer: string; // Changed from optimizedPrompt
    originalTokens: number;
    optimizedTokens: number;
    tokensSaved: number;
    costSaved: number;
    improvementPercentage: number;
    suggestions: string[];
    createdAt: Date;
}

export interface IAlert {
    userId: string;
    type: 'cost_threshold' | 'usage_spike' | 'optimization_available' | 'weekly_summary';
    title: string;
    message: string;
    severity: 'low' | 'medium' | 'high';
    data?: Record<string, any>;
    sent: boolean;
    sentAt?: Date;
    createdAt: Date;
}

export interface IAnalytics {
    userId: string;
    period: 'daily' | 'weekly' | 'monthly';
    startDate: Date;
    endDate: Date;
    totalCost: number;
    totalTokens: number;
    serviceBreakdown: Record<string, {
        cost: number;
        tokens: number;
        count: number;
    }>;
    modelBreakdown: Record<string, {
        cost: number;
        tokens: number;
        count: number;
    }>;
    topPrompts: Array<{
        prompt: string;
        count: number;
        totalCost: number;
    }>;
    optimizationOpportunities: number;
    potentialSavings: number;
}