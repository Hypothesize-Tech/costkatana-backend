export interface TokenTrendAnalysis {
  averagePromptLength: number;
  promptLengthGrowthRate: number;
  tokenEfficiencyTrend: 'increasing' | 'stable' | 'decreasing';
  peakUsageHours: number[];
  seasonalityFactors: {
    hourly: number[];
    daily: number[];
    weekly: number[];
  };
  projectedTokensNextMonth: number;
  confidenceLevel: number;
}

export interface PromptLengthGrowthAnalysis {
  currentAverageLength: number;
  growthRatePerWeek: number;
  projectedLengthIn30Days: number;
  lengthDistribution: Array<{
    range: string;
    percentage: number;
    averageCost: number;
  }>;
  complexityTrend: 'increasing' | 'stable' | 'decreasing';
  impactOnCosts: {
    currentMonthly: number;
    projectedMonthly: number;
    potentialSavings: number;
  };
}

export interface ModelSwitchPatternAnalysis {
  switchFrequency: number;
  commonSwitchPatterns: Array<{
    from: string;
    to: string;
    frequency: number;
    reason: string;
    costImpact: number;
  }>;
  modelPreferences: Array<{
    model: string;
    usagePercentage: number;
    averageCost: number;
    performanceRating: number;
  }>;
  predictedSwitches: Array<{
    date: Date;
    fromModel: string;
    toModel: string;
    reason: string;
    confidenceScore: number;
  }>;
}

export interface ProactiveAlert {
  id: string;
  type:
    | 'budget_exceed'
    | 'cost_spike'
    | 'inefficiency_detected'
    | 'optimization_opportunity';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  projectedDate: Date;
  daysUntilImpact: number;
  estimatedImpact: number;
  actionableInsights: Array<{
    action: string;
    expectedSaving: number;
    difficulty: 'easy' | 'medium' | 'hard';
    timeToImplement: string;
  }>;
  affectedResources: Array<{
    type: 'project' | 'team' | 'model' | 'user';
    id: string;
    name: string;
  }>;
  autoOptimizationAvailable: boolean;
  createdAt: Date;
}

export interface BudgetExceedanceProjection {
  scopeType: 'user' | 'project' | 'team';
  scopeId: string;
  scopeName: string;
  budgetLimit: number;
  currentSpend: number;
  projectedSpend: number;
  exceedanceAmount: number;
  projectedExceedDate: Date;
  daysUntilExceedance: number;
  exceedanceProbability: number;
  mitigationStrategies: Array<{
    strategy: string;
    potentialSaving: number;
    implementationComplexity: 'low' | 'medium' | 'high';
    timeframe: string;
  }>;
}

export interface IntelligentOptimizationRecommendation {
  type:
    | 'model_switch'
    | 'prompt_optimization'
    | 'caching'
    | 'batch_processing'
    | 'parameter_tuning';
  title: string;
  description: string;
  currentCost: number;
  optimizedCost: number;
  potentialSavings: number;
  savingsPercentage: number;
  implementationDifficulty: 'easy' | 'medium' | 'hard';
  timeToSeeResults: string;
  confidenceLevel: number;
  affectedRequests: number;
  steps: string[];
  riskAssessment: {
    performanceImpact: 'none' | 'minimal' | 'moderate' | 'significant';
    qualityImpact: 'none' | 'minimal' | 'moderate' | 'significant';
    riskMitigation: string[];
  };
}

export interface ScenarioSimulation {
  scenarioId: string;
  name: string;
  description: string;
  timeframe: '1_month' | '3_months' | '6_months' | '1_year';
  variables: {
    usageGrowth: number;
    modelMix: Record<string, number>;
    promptComplexity: number;
    optimizationLevel: number;
  };
  projectedCosts: {
    baseline: number;
    optimized: number;
    savings: number;
  };
  keyInsights: string[];
  recommendedActions: string[];
  probabilityOfSuccess: number;
}

export interface CrossPlatformInsight {
  platform: 'chatgpt' | 'claude' | 'gemini' | 'perplexity' | 'api_direct';
  usageShare: number;
  costShare: number;
  efficiencyRating: number;
  redundantUsage: number;
  consolidationOpportunities: Array<{
    description: string;
    potentialSaving: number;
  }>;
}

export interface PredictiveIntelligenceData {
  projectId?: string;
  teamId?: string;
  userId: string;
  timeHorizon: number;
  historicalTokenTrends: TokenTrendAnalysis;
  promptLengthGrowth: PromptLengthGrowthAnalysis;
  modelSwitchPatterns: ModelSwitchPatternAnalysis;
  proactiveAlerts: ProactiveAlert[];
  budgetExceedanceProjections: BudgetExceedanceProjection[];
  optimizationRecommendations: IntelligentOptimizationRecommendation[];
  scenarioSimulations: ScenarioSimulation[];
  crossPlatformInsights: CrossPlatformInsight[];
  confidenceScore: number;
  lastUpdated: Date;
}
