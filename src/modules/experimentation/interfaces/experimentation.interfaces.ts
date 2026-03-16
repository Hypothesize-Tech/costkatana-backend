/**
 * Experimentation Module Interfaces
 *
 * Contains all shared TypeScript interfaces used throughout the experimentation module.
 */

export interface ExperimentResult {
  id: string;
  name: string;
  type: 'model_comparison' | 'what_if' | 'fine_tuning';
  status: 'running' | 'completed' | 'failed';
  startTime: string;
  endTime?: string;
  results: any;
  metadata: {
    duration: number;
    iterations: number;
    confidence: number;
  };
  userId: string;
  createdAt: Date;
}

export interface ModelComparisonRequest {
  prompt: string;
  models: Array<{
    provider: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
  }>;
  evaluationCriteria: string[];
  iterations?: number;
}

export interface ModelComparisonResult {
  id: string;
  provider: string;
  model: string;
  response: string;
  metrics: {
    cost: number;
    latency: number;
    tokenCount: number;
    qualityScore: number;
    errorRate: number;
  };
  performance: {
    responseTime: number;
    throughput: number;
    reliability: number;
  };
  costBreakdown: {
    inputTokens: number;
    outputTokens: number;
    inputCost: number;
    outputCost: number;
    totalCost: number;
  };
  timestamp: string;
}

export interface RealTimeComparisonRequest extends ModelComparisonRequest {
  sessionId: string;
  executeOnBedrock: boolean;
  evaluationPrompt?: string;
  comparisonMode: 'quality' | 'cost' | 'speed' | 'comprehensive';
}

export interface RealTimeComparisonResult extends ModelComparisonResult {
  bedrockOutput?: string;
  aiEvaluation?: {
    overallScore: number;
    criteriaScores: Record<string, number>;
    reasoning: string;
    recommendation: string;
  };
  executionTime: number;
  actualCost: number;
}

export interface ComparisonProgress {
  sessionId: string;
  stage: 'starting' | 'executing' | 'evaluating' | 'completed' | 'failed';
  progress: number; // 0-100
  currentModel?: string;
  message: string;
  results?: any[];
  error?: string;
  analysis?: {
    winner?: { model: string; reason: string };
    costPerformanceAnalysis?: string;
    useCaseRecommendations?: string[];
  };
}

export interface WhatIfSimulationRequest {
  prompt?: string;
  currentModel?: string;
  simulationType:
    | 'prompt_optimization'
    | 'context_trimming'
    | 'model_comparison'
    | 'real_time_analysis';
  options?: {
    trimPercentage?: number;
    alternativeModels?: string[];
    optimizationGoals?: ('cost' | 'speed' | 'quality')[];
  };
}

export interface WhatIfSimulationResult {
  currentCost: any;
  optimizedOptions: any[];
  recommendations: any[];
  potentialSavings: number;
  confidence: number;
}

export interface ExperimentHistoryFilters {
  type?: string;
  status?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}

export interface CreateWhatIfScenarioRequest {
  name: string;
  description: string;
  changes: any;
  timeframe: any;
  baselineData: any;
}

export interface WhatIfScenario {
  id: string;
  name: string;
  description: string;
  changes: any;
  timeframe: any;
  baselineData: any;
  status: string;
  isUserCreated: boolean;
  createdAt: Date;
  analysis?: any;
}

export interface EstimateExperimentCostRequest {
  type: string;
  parameters: any;
}

export interface ExperimentCostEstimate {
  estimatedCost: number;
  breakdown: Record<string, number>;
  duration: number;
}
