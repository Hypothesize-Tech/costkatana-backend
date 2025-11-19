import { loggingService } from './logging.service';
import { TelemetryService } from './telemetry.service';
import { AIRouterService } from './aiRouter.service';


export interface CostDriver {
  driver_type: 'system_prompt' | 'tool_calls' | 'context_window' | 'retries' | 'cache_miss' | 'model_switching' | 'network' | 'database';
  cost_impact: number;
  percentage_of_total: number;
  explanation: string;
  optimization_potential: number;
}

export interface CostAnalysis {
  total_cost: number;
  expected_cost: number;
  deviation_percentage: number;
  deviation_reason: string;
  cost_drivers: CostDriver[];
  cost_story: string;
  optimization_recommendations: Array<{
    type: 'immediate' | 'short_term' | 'long_term';
    description: string;
    potential_savings: number;
    implementation_effort: 'low' | 'medium' | 'high';
  }>;
  anomaly_score: number;
}

export interface DailyCostReport {
  date: string;
  total_cost: number;
  baseline_cost: number;
  cost_increase: number;
  cost_increase_percentage: number;
  top_cost_drivers: CostDriver[];
  anomalies: Array<{
    type: string;
    description: string;
    cost_impact: number;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }>;
  recommendations: Array<{
    priority: 'high' | 'medium' | 'low';
    description: string;
    potential_savings: number;
    effort: 'low' | 'medium' | 'high';
  }>;
  cost_story: string;
}

export interface CostAnomaly {
  type: string;
  description: string;
  cost_impact: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  optimization_potential: number;
}

export interface CostTrends {
  period: string;
  trends: {
    daily_average: number;
    weekly_growth: number;
    monthly_growth: number;
    cost_drivers_trend: Array<{
      driver: string;
      trend: 'increasing' | 'decreasing' | 'stable';
      rate: number;
    }>;
  };
  predictions: {
    next_week: number;
    next_month: number;
    confidence: number;
  };
}

export class UnexplainedCostService {
  private static instance: UnexplainedCostService;
  
  // Circuit breaker for AI operations
  private static aiFailureCount: number = 0;
  private static readonly MAX_AI_FAILURES = 3;
  private static readonly AI_CIRCUIT_BREAKER_RESET_TIME = 180000; // 3 minutes
  private static lastAiFailureTime: number = 0;
  
  // Circuit breaker for database operations
  private static dbFailureCount: number = 0;
  private static readonly MAX_DB_FAILURES = 5;
  private static readonly DB_CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minutes
  private static lastDbFailureTime: number = 0;

  static getInstance(): UnexplainedCostService {
    if (!UnexplainedCostService.instance) {
      UnexplainedCostService.instance = new UnexplainedCostService();
    }
    return UnexplainedCostService.instance;
  }

  /**
   * Analyze unexplained costs for a specific timeframe
   */
  async analyzeUnexplainedCosts(
    userId: string,
    workspaceId: string,
    timeframe: string = '24h'
  ): Promise<CostAnalysis> {
    try {
      loggingService.info(`Analyzing unexplained costs for user ${userId} in timeframe ${timeframe}`);

      // Add timeout handling for the entire operation
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Analysis timeout after 30 seconds')), 30000);
      });

      const analysisPromise = this.performAnalysis(userId, workspaceId, timeframe);
      
      // Race between analysis and timeout
      const result = await Promise.race([analysisPromise, timeoutPromise]);
      return result as CostAnalysis;
    } catch (error) {
      loggingService.error(`Failed to analyze unexplained costs for user ${userId}:`, { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Perform the actual analysis with timeout protection
   */
  private async performAnalysis(
    userId: string,
    workspaceId: string,
    timeframe: string
  ): Promise<CostAnalysis> {
    try {
      // Get telemetry data for the timeframe
      const telemetryData = await TelemetryService.getPerformanceMetrics({
        tenant_id: 'default',
        workspace_id: workspaceId,
        timeframe
      });

      if (!telemetryData) {
        throw new Error('No telemetry data found for the specified timeframe');
      }

      // Calculate baseline costs from historical data
      const baselineCosts = await this.calculateBaselineCosts(userId, workspaceId, timeframe);
      
      // Check circuit breakers
      if (UnexplainedCostService.isDbCircuitBreakerOpen()) {
        throw new Error('Database service temporarily unavailable');
      }
      if (UnexplainedCostService.isAiCircuitBreakerOpen()) {
        throw new Error('AI service temporarily unavailable');
      }

      // Analyze cost drivers
      const costDrivers = await this.analyzeCostDrivers(telemetryData, baselineCosts);
      
      // Calculate anomaly score (non-AI operation, can be done immediately)
      const anomalyScore = this.calculateAnomalyScore(costDrivers, telemetryData, baselineCosts);
      
      // Execute AI operations in parallel for better performance
      const [costStory, recommendations] = await Promise.allSettled([
        this.generateCostStoryWithTimeout(costDrivers, telemetryData, baselineCosts),
        this.generateOptimizationRecommendationsWithTimeout(costDrivers, telemetryData)
      ]);

      // Extract results from settled promises with fallbacks
      const finalCostStory = costStory.status === 'fulfilled' 
        ? costStory.value 
        : this.generateFallbackCostStory(costDrivers, telemetryData, baselineCosts);
      
      const finalRecommendations = recommendations.status === 'fulfilled' 
        ? recommendations.value 
        : this.generateFallbackRecommendations(costDrivers);

      const totalCost = costDrivers.reduce((sum, driver) => sum + driver.cost_impact, 0);
      const expectedCost = baselineCosts.expected_daily_cost;
      const deviationPercentage = expectedCost > 0 ? ((totalCost - expectedCost) / expectedCost) * 100 : 0;
      const deviationReason = this.determineDeviationReason(deviationPercentage, costDrivers);

      return {
        total_cost: totalCost,
        expected_cost: expectedCost,
        deviation_percentage: deviationPercentage,
        deviation_reason: deviationReason,
        cost_drivers: costDrivers,
        cost_story: finalCostStory,
        optimization_recommendations: finalRecommendations,
        anomaly_score: anomalyScore
      };
    } catch (error) {
      loggingService.error(`Failed to analyze unexplained costs for user ${userId}:`, { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Generate daily cost report with explanations
   */
  async generateDailyCostReport(
    userId: string,
    workspaceId: string,
    date: string
  ): Promise<DailyCostReport> {
    try {
      loggingService.info(`Generating daily cost report for user ${userId} on ${date}`);

      // Get telemetry data for the specific date
      const telemetryData = await TelemetryService.getPerformanceMetrics({
        tenant_id: 'default',
        workspace_id: workspaceId,
        timeframe: '24h'
      });

      if (!telemetryData) {
        throw new Error('No telemetry data found for the specified date');
      }

      // Calculate baseline from historical data
      const baselineCosts = await this.calculateBaselineCosts(userId, workspaceId, '7d');
      
      // Analyze cost drivers for the day
      const costDrivers = await this.analyzeCostDrivers(telemetryData, baselineCosts);
      
      // Identify anomalies
      const anomalies = this.identifyAnomalies({
        total_cost: telemetryData.total_cost_usd,
        expected_cost: baselineCosts.expected_daily_cost,
        deviation_percentage: 0,
        deviation_reason: '',
        cost_drivers: costDrivers,
        cost_story: '',
        optimization_recommendations: [],
        anomaly_score: 0
      });

      // Generate recommendations
      const recommendations = await this.generateOptimizationRecommendations(costDrivers, telemetryData);
      const prioritizedRecommendations = this.prioritizeRecommendations(recommendations);

      // Generate cost story
      const costStory = await this.generateCostStory(costDrivers, telemetryData, baselineCosts);

      const totalCost = telemetryData.total_cost_usd;
      const baselineCost = baselineCosts.expected_daily_cost;
      const costIncrease = totalCost - baselineCost;
      const costIncreasePercentage = baselineCost > 0 ? (costIncrease / baselineCost) * 100 : 0;

      return {
        date,
        total_cost: totalCost,
        baseline_cost: baselineCost,
        cost_increase: costIncrease,
        cost_increase_percentage: costIncreasePercentage,
        top_cost_drivers: costDrivers.slice(0, 5),
        anomalies,
        recommendations: prioritizedRecommendations,
        cost_story: costStory
      };
    } catch (error) {
      loggingService.error(`Failed to generate daily cost report for user ${userId}:`, { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Get cost attribution breakdown for a specific trace
   */
  async getTraceCostAttribution(
    userId: string,
    traceId: string,
    workspaceId: string
  ): Promise<{
    trace_id: string;
    cost_attribution: {
      system_prompt_cost: number;
      tool_calls_cost: number;
      context_window_cost: number;
      retry_cost: number;
      total_explained_cost: number;
      unexplained_cost: number;
    };
    cost_story: string;
  }> {
    try {
      loggingService.info(`Getting cost attribution for trace ${traceId} for user ${userId}`);

      // Get telemetry data for the specific trace
      const traceData = await TelemetryService.getTraceDetails(traceId);
      
      if (!traceData) {
        throw new Error(`Trace ${traceId} not found`);
      }

      // Calculate cost attribution from trace data dynamically
      const totalCost = traceData.summary.total_cost_usd;
      const costAttribution = this.calculateDynamicCostAttribution(totalCost, traceData);

      // Generate cost story using AI
      const costStory = await this.generateTraceCostStory(traceData, costAttribution);

      return {
        trace_id: traceId,
        cost_attribution: costAttribution,
        cost_story: costStory
      };
    } catch (error) {
      loggingService.error(`Failed to get trace cost attribution for ${traceId}:`, { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Get historical cost trends and patterns
   */
  async getCostTrends(
    userId: string,
    period: string = '30d',
    workspaceId: string = 'default'
  ): Promise<CostTrends> {
    try {
      loggingService.info(`Getting cost trends for user ${userId} for period ${period}`);

      // Get historical telemetry data for trend analysis
      const historicalData = await TelemetryService.getPerformanceMetrics({
        tenant_id: 'default',
        workspace_id: workspaceId,
        timeframe: period
      });

      if (!historicalData) {
        throw new Error('No historical data found for trend analysis');
      }

      // Calculate trends from historical data
      const trends = await this.calculateCostTrends(historicalData, period);
      
      // Generate predictions using AI
      const predictions = await this.generateCostPredictions(historicalData, trends);

      return {
        period,
        trends,
        predictions
      };
    } catch (error) {
      loggingService.error(`Failed to get cost trends for user ${userId}:`, { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Calculate baseline costs from historical data
   */
  private async calculateBaselineCosts(
    userId: string,
    workspaceId: string,
    timeframe: string
  ): Promise<{
    expected_daily_cost: number;
    historical_average: number;
    confidence_level: number;
  }> {
    try {
      // Get historical data for baseline calculation
      const historicalData = await TelemetryService.getPerformanceMetrics({
        tenant_id: 'default',
        workspace_id: workspaceId,
        timeframe: timeframe // Use provided timeframe for baseline
      });

      if (!historicalData) {
        return {
          expected_daily_cost: 0,
          historical_average: 0,
          confidence_level: 0
        };
      }

      const historicalAverage = historicalData.total_cost_usd / 7;
      const confidenceLevel = 0.8; // Base confidence

      return {
        expected_daily_cost: historicalAverage,
        historical_average: historicalAverage,
        confidence_level: confidenceLevel
      };
    } catch (error) {
      loggingService.error('Failed to calculate baseline costs:', { error: error instanceof Error ? error.message : String(error) });
      return {
        expected_daily_cost: 0,
        historical_average: 0,
        confidence_level: 0
      };
    }
  }

  /**
   * Analyze cost drivers from telemetry data
   */
  private async analyzeCostDrivers(
    telemetryData: any,
    baselineCosts: any
  ): Promise<CostDriver[]> {
    try {
      const totalCost = telemetryData.total_cost_usd;
      if (totalCost <= 0) {
        return [];
      }

      // Single-pass cost driver analysis for better performance
      const costDrivers: CostDriver[] = [];

      // Calculate cost breakdown based on actual data
      const costAttribution = this.calculateDynamicCostAttribution(totalCost, telemetryData);
      
      // Define cost driver configurations for single-pass processing
      const driverConfigs = [
        {
          type: 'system_prompt' as const,
          cost: costAttribution.system_prompt_cost,
          efficiencyCalc: () => this.calculateSystemPromptEfficiency(telemetryData.total_tokens, costAttribution.system_prompt_cost),
          description: 'System prompt token usage contributing to costs'
        },
        {
          type: 'tool_calls' as const,
          cost: costAttribution.tool_calls_cost,
          efficiencyCalc: () => this.calculateToolCallEfficiency(telemetryData.total_tokens, costAttribution.tool_calls_cost),
          description: 'API tool calls and external service usage'
        },
        {
          type: 'context_window' as const,
          cost: costAttribution.context_window_cost,
          efficiencyCalc: () => this.calculateContextWindowEfficiency(telemetryData.total_tokens, costAttribution.context_window_cost),
          description: 'Large context windows and memory usage'
        },
        {
          type: 'retries' as const,
          cost: costAttribution.retry_cost,
          efficiencyCalc: () => this.calculateRetryEfficiency(telemetryData.total_tokens, costAttribution.retry_cost),
          description: 'Failed request retries and error handling'
        }
      ];

      // Process all drivers in a single loop
      for (const config of driverConfigs) {
        if (config.cost > 0 || config.type === 'system_prompt') {
          const efficiency = config.efficiencyCalc();
          const baselineComparison = baselineCosts.expected_daily_cost > 0 ? 
            ` (${((config.cost / baselineCosts.expected_daily_cost) * 100).toFixed(1)}% of daily baseline)` : '';
          
          costDrivers.push({
            driver_type: config.type,
            cost_impact: config.cost,
            percentage_of_total: (config.cost / totalCost) * 100,
            explanation: `${config.description}${baselineComparison}`,
            optimization_potential: config.cost * efficiency
          });
        }
      }

      return costDrivers;
    } catch (error) {
      loggingService.error('Failed to analyze cost drivers:', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  /**
   * Generate cost story using AI
   */
  private async generateCostStory(
    costDrivers: CostDriver[],
    telemetryData: any,
    baselineCosts: any
  ): Promise<string> {
    try {
      const totalCost = costDrivers.reduce((sum, driver) => sum + driver.cost_impact, 0);
      const baselineCost = baselineCosts.expected_daily_cost;
      const deviation = baselineCost > 0 ? ((totalCost - baselineCost) / baselineCost) * 100 : 0;

      const prompt = `Analyze this AI cost data and explain why costs changed.

COST SUMMARY:
- Total Cost: $${totalCost.toFixed(4)}
- Baseline Cost: $${baselineCost.toFixed(4)}
- Deviation: ${deviation > 0 ? '+' : ''}${deviation.toFixed(1)}%

COST DRIVERS:
${costDrivers.map(d => `- ${d.driver_type.replace('_', ' ')}: $${d.cost_impact.toFixed(4)} (${d.percentage_of_total.toFixed(1)}%)`).join('\n')}

INSTRUCTIONS:
1. Explain in simple, clear terms why these costs occurred
2. Identify the main contributing factors
3. Provide context about what this means for the user
4. Use bullet points and clear structure

FORMAT: Return a clear, structured explanation with bullet points and sections.`;

      try {
        // Use Bedrock service to generate AI-powered cost story
        const modelId = process.env.AWS_BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0';
        const aiResponse = await AIRouterService.invokeModel(prompt, modelId);
        
        if (aiResponse && typeof aiResponse === 'string' && aiResponse.trim().length > 0) {
          return aiResponse.trim();
        } else {
          throw new Error('Empty or invalid AI response');
        }
      } catch (aiError) {
        loggingService.warn('AI generation failed, falling back to dynamic analysis:', { error: aiError instanceof Error ? aiError.message : String(aiError) });
        
        // Fallback to dynamic analysis if AI fails
        const topDriver = costDrivers[0];
        if (deviation > 0) {
          return `Your costs today are ${deviation.toFixed(1)}% higher than your baseline. The main contributor is ${topDriver?.driver_type.replace('_', ' ') || 'system usage'}, which added $${topDriver?.cost_impact.toFixed(4) || '0'} to your bill.`;
        } else {
          return `Great news! Your costs today are ${Math.abs(deviation).toFixed(1)}% below your baseline. This suggests efficient usage patterns.`;
        }
      }
    } catch (error) {
      loggingService.error('Failed to generate cost story:', { error: error instanceof Error ? error.message : String(error) });
      return 'Cost analysis unavailable.';
    }
  }

  /**
   * Generate optimization recommendations
   */
  private async generateOptimizationRecommendations(
    costDrivers: CostDriver[],
    telemetryData: any
  ): Promise<Array<{
    type: 'immediate' | 'short_term' | 'long_term';
    description: string;
    potential_savings: number;
    implementation_effort: 'low' | 'medium' | 'high';
  }>> {
    try {
      // Create AI prompt for intelligent recommendations with telemetry context
      const totalTokens = telemetryData.total_tokens || 0;
      const totalDuration = telemetryData.avg_duration_ms || 0;
      const requestCount = telemetryData.total_requests || 1;
      
      const prompt = `Generate cost optimization recommendations based on the following data.

COST DRIVERS:
${costDrivers.map(d => `- ${d.driver_type.replace('_', ' ')}: $${d.cost_impact.toFixed(4)} (${d.percentage_of_total.toFixed(1)}% of total, optimization potential: $${d.optimization_potential.toFixed(4)})`).join('\n')}

TOTAL COST: $${costDrivers.reduce((sum, driver) => sum + driver.cost_impact, 0).toFixed(4)}

CONTEXT:
- Total Tokens: ${totalTokens.toLocaleString()}
- Total Duration: ${totalDuration}ms
- Request Count: ${requestCount}
- Average Cost per Request: $${(costDrivers.reduce((sum, driver) => sum + driver.cost_impact, 0) / requestCount).toFixed(6)}
- Average Tokens per Request: ${requestCount > 0 ? (totalTokens / requestCount).toFixed(0) : 0}

INSTRUCTIONS:
1. Analyze the cost drivers and generate 3-5 specific recommendations
2. Categorize each as immediate (quick wins), short_term (1-2 weeks), or long_term (1+ months)
3. Assign implementation effort as low, medium, or high
4. Calculate realistic potential savings based on the optimization potential

RESPONSE FORMAT - ONLY JSON, NO OTHER TEXT:
{
  "recommendations": [
    {
      "type": "immediate",
      "description": "Specific actionable recommendation",
      "potential_savings": 0.001,
      "implementation_effort": "low"
    }
  ]
}

CRITICAL: Return ONLY the JSON object above. No explanations, no markdown, no additional text.`;

      try {
        // Use Bedrock service to generate AI-powered recommendations
        const modelId = process.env.AWS_BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0';
        const aiResponse = await AIRouterService.invokeModel(prompt, modelId);
        
        if (aiResponse && typeof aiResponse === 'string' && aiResponse.trim().length > 0) {
          // Try to parse AI response as JSON
          try {
            const parsedResponse = JSON.parse(aiResponse.trim());
            if (parsedResponse.recommendations && Array.isArray(parsedResponse.recommendations)) {
              return parsedResponse.recommendations;
            }
          } catch (parseError) {
            loggingService.warn('Failed to parse AI response as JSON:', { error: parseError instanceof Error ? parseError.message : String(parseError) });
            // Try to extract JSON from the response if it contains other text
            const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              try {
                const extractedJson = JSON.parse(jsonMatch[0]);
                if (extractedJson.recommendations && Array.isArray(extractedJson.recommendations)) {
                  return extractedJson.recommendations;
                }
              } catch (extractError) {
                loggingService.warn('Failed to extract JSON from AI response:', { error: extractError instanceof Error ? extractError.message : String(extractError) });
              }
            }
          }
        }
        
        // If we get here, AI didn't return valid JSON, so fall back to rule-based recommendations
        loggingService.warn('AI response format invalid, using fallback recommendations');
        
      } catch (aiError) {
        loggingService.warn('AI generation failed, falling back to rule-based recommendations:', { error: aiError instanceof Error ? aiError.message : String(aiError) });
      }
      
      // Fallback to rule-based recommendations if AI fails or returns invalid format
      const recommendations: Array<{
        type: 'immediate' | 'short_term' | 'long_term';
        description: string;
        potential_savings: number;
        implementation_effort: 'low' | 'medium' | 'high';
      }> = [];

      // Generate comprehensive fallback recommendations
      if (costDrivers.length === 0) {
        // Default recommendations if no cost drivers available
        recommendations.push(
          {
            type: 'immediate',
            description: 'Review and optimize system prompts to reduce token usage',
            potential_savings: 0.001,
            implementation_effort: 'low'
          },
          {
            type: 'short_term',
            description: 'Implement request caching to reduce duplicate API calls',
            potential_savings: 0.002,
            implementation_effort: 'medium'
          },
          {
            type: 'long_term',
            description: 'Analyze usage patterns and implement cost optimization strategies',
            potential_savings: 0.005,
            implementation_effort: 'high'
          }
        );
      } else {
        // Generate recommendations based on actual cost drivers
        costDrivers.forEach(driver => {
          if (driver.driver_type === 'system_prompt') {
            recommendations.push({
              type: 'immediate',
              description: 'Optimize system prompts to reduce token usage',
              potential_savings: driver.optimization_potential || 0.001,
              implementation_effort: 'low'
            });
          } else if (driver.driver_type === 'tool_calls') {
            recommendations.push({
              type: 'short_term',
              description: 'Implement caching for tool calls to reduce API costs',
              potential_savings: driver.optimization_potential || 0.002,
              implementation_effort: 'medium'
            });
          } else if (driver.driver_type === 'context_window') {
            recommendations.push({
              type: 'long_term',
              description: 'Implement context window optimization strategies',
              potential_savings: driver.optimization_potential || 0.003,
              implementation_effort: 'high'
            });
          } else if (driver.driver_type === 'retries') {
            recommendations.push({
              type: 'immediate',
              description: 'Implement better error handling to reduce retries',
              potential_savings: driver.optimization_potential || 0.001,
              implementation_effort: 'low'
            });
          } else if (driver.driver_type === 'cache_miss') {
            recommendations.push({
              type: 'short_term',
              description: 'Improve cache hit rates to reduce redundant processing',
              potential_savings: driver.optimization_potential || 0.002,
              implementation_effort: 'medium'
            });
          } else if (driver.driver_type === 'model_switching') {
            recommendations.push({
              type: 'long_term',
              description: 'Standardize model selection to reduce switching costs',
              potential_savings: driver.optimization_potential || 0.004,
              implementation_effort: 'high'
            });
          } else if (driver.driver_type === 'network') {
            recommendations.push({
              type: 'short_term',
              description: 'Optimize network requests and implement connection pooling',
              potential_savings: driver.optimization_potential || 0.001,
              implementation_effort: 'medium'
            });
          } else if (driver.driver_type === 'database') {
            recommendations.push({
              type: 'long_term',
              description: 'Optimize database queries and implement indexing strategies',
              potential_savings: driver.optimization_potential || 0.003,
              implementation_effort: 'high'
            });
          }
        });
      }

      // Ensure we always return at least some recommendations
      if (recommendations.length === 0) {
        recommendations.push({
          type: 'immediate',
          description: 'Review current AI usage patterns for optimization opportunities',
          potential_savings: 0.001,
          implementation_effort: 'low'
        });
      }

      return recommendations;
    } catch (error) {
      loggingService.error('Failed to generate optimization recommendations:', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  /**
   * Calculate anomaly score
   */
  private calculateAnomalyScore(
    costDrivers: CostDriver[],
    telemetryData: any,
    baselineCosts: any
  ): number {
    try {
      const totalCost = costDrivers.reduce((sum, driver) => sum + driver.cost_impact, 0);
      const baselineCost = baselineCosts.expected_daily_cost;
      
      if (baselineCost <= 0) return 0;

      const deviation = Math.abs((totalCost - baselineCost) / baselineCost);
      const maxDriverPercentage = Math.max(...costDrivers.map(d => d.percentage_of_total));
      
      // Calculate anomaly score based on deviation and cost driver distribution
      let score = 0;
      
      // Dynamic deviation scoring based on baseline cost magnitude
      const deviationThreshold = Math.max(0.1, Math.min(0.8, baselineCost / 1000)); // Scale with baseline
      if (deviation > deviationThreshold * 2.5) score += 40; // High deviation
      else if (deviation > deviationThreshold) score += 20; // Medium deviation
      
      // Dynamic cost driver scoring based on distribution
      const driverThreshold = Math.max(30, Math.min(70, 100 / costDrivers.length)); // Scale with driver count
      if (maxDriverPercentage > driverThreshold * 1.5) score += 30; // Dominant cost driver
      else if (maxDriverPercentage > driverThreshold) score += 15; // Significant cost driver
      
      // Dynamic complexity scoring based on driver count
      const complexityThreshold = Math.max(2, Math.min(8, Math.sqrt(baselineCost * 100))); // Scale with baseline
      if (costDrivers.length > complexityThreshold * 1.5) score += 20; // Many cost drivers
      else if (costDrivers.length > complexityThreshold) score += 10; // Several cost drivers
      
      // Consider telemetry data for additional scoring
      if (telemetryData && telemetryData.total_tokens) {
        const tokenEfficiency = telemetryData.total_tokens / totalCost;
        if (tokenEfficiency < 1000) score += 10; // Low token efficiency
        else if (tokenEfficiency > 10000) score += 5; // High token efficiency
      }
      
      if (telemetryData && telemetryData.total_duration_ms) {
        const costPerSecond = totalCost / (telemetryData.total_duration_ms / 1000);
        if (costPerSecond > 0.1) score += 10; // High cost per second
        else if (costPerSecond < 0.001) score += 5; // Low cost per second
      }
      
      return Math.min(score, 100);
    } catch (error) {
      loggingService.error('Failed to calculate anomaly score:', { error: error instanceof Error ? error.message : String(error) });
      return 0;
    }
  }

  /**
   * Determine deviation reason
   */
  private determineDeviationReason(deviationPercentage: number, costDrivers: CostDriver[]): string {
    // Dynamic thresholds based on cost driver complexity and baseline
    const baselineThreshold = Math.max(3, Math.min(15, costDrivers.length * 2));
    const minorThreshold = Math.max(10, Math.min(30, baselineThreshold * 2));
    const significantThreshold = Math.max(25, Math.min(60, minorThreshold * 2));
    const majorThreshold = Math.max(50, Math.min(120, significantThreshold * 2));
    
    if (deviationPercentage <= baselineThreshold) return 'Normal variation';
    if (deviationPercentage <= minorThreshold) return 'Minor cost increase';
    if (deviationPercentage <= significantThreshold) return 'Significant cost increase';
    if (deviationPercentage <= majorThreshold) return 'Major cost spike';
    return 'Critical cost anomaly';
  }

  /**
   * Identify specific anomalies
   */
  private identifyAnomalies(analysis: CostAnalysis): Array<{
    type: string;
    description: string;
    cost_impact: number;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }> {
    const anomalies: Array<{
      type: string;
      description: string;
      cost_impact: number;
      severity: 'low' | 'medium' | 'high' | 'critical';
    }> = [];

    // Dynamic deviation anomaly detection
    const deviationThreshold = Math.max(30, Math.min(80, analysis.cost_drivers.length * 10));
    if (analysis.deviation_percentage > deviationThreshold) {
      anomalies.push({
        type: 'cost_spike',
        description: `Costs ${analysis.deviation_percentage.toFixed(1)}% higher than baseline`,
        cost_impact: analysis.total_cost - analysis.expected_cost,
        severity: analysis.deviation_percentage > deviationThreshold * 1.5 ? 'critical' : 'high'
      });
    }

    // Dynamic anomaly score detection
    const scoreThreshold = Math.max(60, Math.min(85, 70 + (analysis.cost_drivers.length * 2)));
    if (analysis.anomaly_score > scoreThreshold) {
      anomalies.push({
        type: 'anomaly_detected',
        description: `High anomaly score (${analysis.anomaly_score.toFixed(0)}) indicating unusual patterns`,
        cost_impact: analysis.total_cost - analysis.expected_cost,
        severity: analysis.anomaly_score > scoreThreshold * 1.2 ? 'critical' : 'high'
      });
    }

    // Dynamic dominant cost driver detection
    const driverThreshold = Math.max(35, Math.min(65, 100 / analysis.cost_drivers.length));
    analysis.cost_drivers.forEach(driver => {
      if (driver.percentage_of_total > driverThreshold) {
        anomalies.push({
          type: 'dominant_cost_driver',
          description: `${driver.driver_type.replace('_', ' ')} is ${driver.percentage_of_total.toFixed(1)}% of total cost`,
          cost_impact: driver.cost_impact,
          severity: driver.percentage_of_total > driverThreshold * 1.5 ? 'high' : 'medium'
        });
      }
    });

    return anomalies;
  }

  /**
   * Prioritize recommendations
   */
  private prioritizeRecommendations(recommendations: Array<{
    type: 'immediate' | 'short_term' | 'long_term';
    description: string;
    potential_savings: number;
    implementation_effort: 'low' | 'medium' | 'high';
  }>): Array<{
    priority: 'high' | 'medium' | 'low';
    description: string;
    potential_savings: number;
    effort: 'low' | 'medium' | 'high';
  }> {
    return recommendations.map(rec => {
      let priority: 'high' | 'medium' | 'low' = 'medium';
      
      // Dynamic thresholds based on recommendation type and potential savings
      const highSavingsThreshold = Math.max(0.005, Math.min(0.05, rec.potential_savings * 0.1));
      const lowSavingsThreshold = Math.max(0.0005, Math.min(0.005, rec.potential_savings * 0.01));
      
      if (rec.type === 'immediate' && rec.potential_savings > highSavingsThreshold) {
        priority = 'high';
      } else if (rec.type === 'long_term' || rec.potential_savings < lowSavingsThreshold) {
        priority = 'low';
      }

      return {
        priority,
        description: rec.description,
        potential_savings: rec.potential_savings,
        effort: rec.implementation_effort
      };
    }).sort((a, b) => {
      // Sort by priority (high > medium > low) then by potential savings
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      }
      return b.potential_savings - a.potential_savings;
    });
  }

  /**
   * Generate cost story for a specific trace using AI
   */
  private async generateTraceCostStory(
    traceData: any,
    costAttribution: any
  ): Promise<string> {
    try {
      // Extract comprehensive trace information
      const totalCost = traceData.summary.total_cost_usd;
      const duration = traceData.summary.total_duration_ms;
      const tokens = traceData.summary.total_tokens;
      const spans = traceData.spans || [];
      
      // Analyze trace characteristics dynamically using actual data
      const toolCallCount = spans.filter((span: any) => span.operation_name?.includes('tool_call')).length;
      const retryCount = spans.filter((span: any) => span.operation_name?.includes('retry') || span.retry_count > 0).length;
      const errorCount = spans.filter((span: any) => span.status === 'error' || span.status === 'failed').length;
      const slowSpanCount = spans.filter((span: any) => (span.duration_ms || 0) > 1000).length;
      const avgSpanDuration = spans.length > 0 ? spans.reduce((sum: number, span: any) => sum + (span.duration_ms || 0), 0) / spans.length : 0;
      const maxSpanDuration = spans.length > 0 ? Math.max(...spans.map((span: any) => span.duration_ms || 0)) : 0;
      
      // Get comprehensive efficiency metrics using all parameters
      const efficiencyMetrics = this.getDetailedEfficiencyMetrics(totalCost, tokens, duration);
      
      // Create comprehensive prompt using all available data
      const prompt = `Analyze this AI request trace comprehensively and explain the cost breakdown with actionable insights:

Trace Details:
- Trace ID: ${traceData.summary.trace_id}
- Total Cost: $${totalCost.toFixed(6)}
- Duration: ${duration}ms (${efficiencyMetrics.performanceRating})
- Total Tokens: ${tokens.toLocaleString()}

Cost Attribution:
- System Prompt: $${costAttribution.system_prompt_cost.toFixed(6)} (${((costAttribution.system_prompt_cost / totalCost) * 100).toFixed(1)}%)
- Tool Calls: $${costAttribution.tool_calls_cost.toFixed(6)} (${((costAttribution.tool_calls_cost / totalCost) * 100).toFixed(1)}%)
- Context Window: $${costAttribution.context_window_cost.toFixed(6)} (${((costAttribution.context_window_cost / totalCost) * 100).toFixed(1)}%)
- Retries: $${costAttribution.retry_cost.toFixed(6)} (${((costAttribution.retry_cost / totalCost) * 100).toFixed(1)}%)

Trace Analysis:
- Tool Call Operations: ${toolCallCount} (${toolCallCount > 0 ? 'Complex workflow' : 'Simple request'})
- Retry Attempts: ${retryCount} (${retryCount > 0 ? 'Reliability issues detected' : 'Stable execution'})
- Error Spans: ${errorCount} (${errorCount > 0 ? 'Execution failures present' : 'Clean execution'})
- Slow Operations: ${slowSpanCount} spans > 1s (${slowSpanCount > 0 ? 'Performance bottlenecks' : 'Efficient processing'})
- Average Span Duration: ${avgSpanDuration.toFixed(0)}ms
- Max Span Duration: ${maxSpanDuration}ms

Efficiency Metrics:
- Overall Cost Efficiency: ${efficiencyMetrics.overallEfficiency}
- Context Efficiency: ${efficiencyMetrics.contextEfficiency} (tokens per dollar)
- Cost per Second: $${efficiencyMetrics.costPerSecond}/s
- Cost per Token: $${efficiencyMetrics.costPerToken}/token
- Processing Speed: ${efficiencyMetrics.tokensPerSecond} tokens/second

Please provide:
1. A detailed explanation of why this request cost what it did
2. Identify the primary cost drivers and their impact
3. Suggest specific optimization opportunities based on the data
4. Explain any unusual patterns, anomalies, or inefficiencies
5. Provide actionable recommendations for cost reduction

Write in a professional but accessible tone, suitable for developers and cost analysts. Include specific metrics and actionable insights.`;

      try {
        // Use Bedrock service to generate AI-powered cost story
        const modelId = process.env.AWS_BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0';
        const aiResponse = await AIRouterService.invokeModel(prompt, modelId);
        
        if (aiResponse && typeof aiResponse === 'string' && aiResponse.trim().length > 0) {
          return aiResponse.trim();
        } else {
          throw new Error('Empty or invalid AI response');
        }
      } catch (aiError) {
        loggingService.warn('AI generation failed, falling back to dynamic analysis:', { error: aiError instanceof Error ? aiError.message : String(aiError) });
        
        // Fallback to dynamic analysis if AI fails
        return this.generateFallbackCostStory(traceData, costAttribution);
      }
    } catch (error) {
      loggingService.error('Failed to generate trace cost story:', { error: error instanceof Error ? error.message : String(error) });
      return 'Cost analysis unavailable for this trace.';
    }
  }

  /**
   * Calculate performance percentile based on duration and average
   */
  private calculatePerformancePercentile(duration: number, avgSpanDuration: number): string {
    if (avgSpanDuration <= 0) return 'Unknown';
    
    const ratio = duration / avgSpanDuration;
    if (ratio < 0.5) return 'Excellent';
    if (ratio < 1.0) return 'Good';
    if (ratio < 2.0) return 'Average';
    if (ratio < 5.0) return 'Slow';
    return 'Very Slow';
  }

  /**
   * Calculate context efficiency (tokens per dollar) with dynamic thresholds
   */
  private calculateContextEfficiency(tokens: number, totalCost: number): string {
    if (totalCost <= 0 || tokens <= 0) return 'N/A';
    
    const efficiency = tokens / totalCost; // Tokens per dollar
    
    // Dynamic thresholds based on cost magnitude
    const costMagnitude = Math.log10(totalCost);
    const baseThreshold = Math.pow(10, Math.max(2, costMagnitude - 1)); // Scale with cost
    
    if (efficiency > baseThreshold * 10) return 'Exceptional';
    if (efficiency > baseThreshold * 5) return 'Very High';
    if (efficiency > baseThreshold * 2) return 'High';
    if (efficiency > baseThreshold) return 'Good';
    if (efficiency > baseThreshold * 0.5) return 'Average';
    if (efficiency > baseThreshold * 0.2) return 'Low';
    return 'Very Low';
  }

  /**
   * Calculate comprehensive cost efficiency using all parameters
   */
  private calculateCostEfficiency(totalCost: number, tokens: number, duration: number): string {
    if (duration <= 0 || totalCost <= 0 || tokens <= 0) return 'N/A';
    
    // Calculate multiple efficiency metrics
    const costPerSecond = totalCost / (duration / 1000); // Dollars per second
    const costPerToken = totalCost / tokens; // Dollars per token
    const tokensPerSecond = tokens / (duration / 1000); // Processing speed
    
    // Normalize metrics for comparison
    const normalizedCostPerSecond = Math.min(1, costPerSecond / 0.1); // Normalize to $0.1/s
    const normalizedCostPerToken = Math.min(1, costPerToken / 0.001); // Normalize to $0.001/token
    const normalizedTokensPerSecond = Math.min(1, tokensPerSecond / 1000); // Normalize to 1000 tokens/s
    
    // Calculate overall efficiency score (0-1, higher is better)
    const efficiencyScore = (
      (1 - normalizedCostPerSecond) * 0.4 + // Lower cost per second is better
      (1 - normalizedCostPerToken) * 0.4 +   // Lower cost per token is better
      normalizedTokensPerSecond * 0.2        // Higher processing speed is better
    );
    
    // Determine efficiency rating based on comprehensive score
    if (efficiencyScore > 0.8) return 'Excellent';
    if (efficiencyScore > 0.6) return 'Good';
    if (efficiencyScore > 0.4) return 'Average';
    if (efficiencyScore > 0.2) return 'Poor';
    return 'Very Poor';
  }

  /**
   * Get context description based on token count
   */
  private getContextDescription(tokenCount: number): string {
    if (tokenCount <= 0) return 'empty';
    if (tokenCount < 1000) return 'very short';
    if (tokenCount < 3000) return 'short';
    if (tokenCount < 8000) return 'moderate';
    if (tokenCount < 15000) return 'long';
    if (tokenCount < 30000) return 'very long';
    return 'extremely long';
  }

  /**
   * Get performance description based on duration
   */
  private getPerformanceDescription(duration: number): string {
    if (duration <= 0) return 'instant';
    if (duration < 500) return 'very fast';
    if (duration < 1500) return 'fast';
    if (duration < 3000) return 'moderate';
    if (duration < 8000) return 'slow';
    if (duration < 15000) return 'very slow';
    return 'extremely slow';
  }

  /**
   * Get performance insight based on duration
   */
  private getPerformanceInsight(duration: number): string {
    if (duration < 500) return 'showing excellent performance';
    if (duration < 1500) return 'showing good performance';
    if (duration < 3000) return 'within normal performance range';
    if (duration < 8000) return 'indicating potential optimization opportunities';
    if (duration < 15000) return 'showing significant performance issues';
    return 'indicating critical performance problems requiring immediate attention';
  }

  /**
   * Get context insight based on token count
   */
  private getContextInsight(tokenCount: number): string {
    if (tokenCount < 1000) return 'kept costs minimal';
    if (tokenCount < 3000) return 'had low cost impact';
    if (tokenCount < 8000) return 'had moderate cost impact';
    if (tokenCount < 15000) return 'contributed significantly to costs';
    if (tokenCount < 30000) return 'was a major cost driver';
    return 'was the primary cost contributor';
  }

  /**
   * Calculate system prompt optimization efficiency
   */
  private calculateSystemPromptEfficiency(totalTokens: number, systemPromptCost: number): number {
    if (systemPromptCost <= 0) return 0.3; // Default fallback
    
    // Higher efficiency for longer prompts (more room for optimization)
    const tokenRatio = Math.min(1, totalTokens / 10000);
    return Math.max(0.2, Math.min(0.6, 0.3 + (tokenRatio * 0.3)));
  }

  /**
   * Calculate tool call optimization efficiency
   */
  private calculateToolCallEfficiency(totalTokens: number, toolCallCost: number): number {
    if (toolCallCost <= 0) return 0.4; // Default fallback
    
    // Higher efficiency for tool-heavy workflows
    const costRatio = Math.min(1, toolCallCost / 0.1); // Normalize to $0.1
    
    // Consider token complexity for tool calls
    const tokenComplexity = Math.min(1, totalTokens / 15000); // Higher complexity for longer requests
    
    return Math.max(0.3, Math.min(0.7, 0.4 + (costRatio * 0.2) + (tokenComplexity * 0.1)));
  }

  /**
   * Calculate context window optimization efficiency
   */
  private calculateContextWindowEfficiency(totalTokens: number, contextWindowCost: number): number {
    if (contextWindowCost <= 0) return 0.5; // Default fallback
    
    // Higher efficiency for very long contexts
    const tokenRatio = Math.min(1, totalTokens / 20000);
    return Math.max(0.4, Math.min(0.8, 0.5 + (tokenRatio * 0.3)));
  }

  /**
   * Calculate retry optimization efficiency
   */
  private calculateRetryEfficiency(totalTokens: number, retryCost: number): number {
    if (retryCost <= 0) return 0.8; // Default fallback
    
    // Higher efficiency for retry-heavy requests
    const costRatio = Math.min(1, retryCost / 0.05); // Normalize to $0.05
    
    // Consider token context for retry analysis
    const contextFactor = Math.min(1, totalTokens / 10000); // Longer contexts may have more retry opportunities
    
    return Math.max(0.7, Math.min(0.95, 0.8 + (costRatio * 0.1) + (contextFactor * 0.05)));
  }

  /**
   * Get detailed efficiency metrics for AI analysis
   */
  private getDetailedEfficiencyMetrics(totalCost: number, tokens: number, duration: number): {
    costPerSecond: number;
    costPerToken: number;
    tokensPerSecond: number;
    overallEfficiency: string;
    contextEfficiency: string;
    performanceRating: string;
  } {
    const costPerSecond = duration > 0 ? totalCost / (duration / 1000) : 0;
    const costPerToken = tokens > 0 ? totalCost / tokens : 0;
    const tokensPerSecond = duration > 0 ? tokens / (duration / 1000) : 0;
    
    return {
      costPerSecond: parseFloat(costPerSecond.toFixed(6)),
      costPerToken: parseFloat(costPerToken.toFixed(6)),
      tokensPerSecond: parseFloat(tokensPerSecond.toFixed(2)),
      overallEfficiency: this.calculateCostEfficiency(totalCost, tokens, duration),
      contextEfficiency: this.calculateContextEfficiency(tokens, totalCost),
      performanceRating: duration > 0 ? this.calculatePerformancePercentile(duration, duration) : 'Unknown'
    };
  }

  /**
   * Generate fallback cost story when AI is unavailable
   */


  /**
   * Calculate cost trends from historical data
   */
  private async calculateCostTrends(
    historicalData: any,
    period: string
  ): Promise<{
    daily_average: number;
    weekly_growth: number;
    monthly_growth: number;
    cost_drivers_trend: Array<{
      driver: string;
      trend: 'increasing' | 'decreasing' | 'stable';
      rate: number;
    }>;
  }> {
    try {
      // Calculate daily average from historical data based on period
      const daysInPeriod = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 7;
      const dailyAverage = historicalData.total_cost_usd / daysInPeriod;
      
      // Calculate growth rates from actual data based on period
      const weeklyGrowth = this.calculateWeeklyGrowth(historicalData);
      const monthlyGrowth = this.calculateMonthlyGrowth(historicalData);
      
      // Analyze cost driver trends from actual data
      const costDriversTrend = this.calculateCostDriverTrends(historicalData);

      return {
        daily_average: dailyAverage,
        weekly_growth: weeklyGrowth,
        monthly_growth: monthlyGrowth,
        cost_drivers_trend: costDriversTrend
      };
    } catch (error) {
      loggingService.error('Failed to calculate cost trends:', { error: error instanceof Error ? error.message : String(error) });
      return {
        daily_average: 0,
        weekly_growth: 0,
        monthly_growth: 0,
        cost_drivers_trend: []
      };
    }
  }

  /**
   * Calculate dynamic cost attribution based on trace data
   */
  private calculateDynamicCostAttribution(totalCost: number, data: any): {
    system_prompt_cost: number;
    tool_calls_cost: number;
    context_window_cost: number;
    retry_cost: number;
    total_explained_cost: number;
    unexplained_cost: number;
  } {
    try {
      // Check if this is trace data (has spans) or aggregated telemetry data
      const isTraceData = data.spans && Array.isArray(data.spans);
      const spans = isTraceData ? data.spans : [];
      
      // Handle both trace data and aggregated telemetry data safely
      let contextLength = 0;
      if (isTraceData && data.summary?.total_tokens) {
        contextLength = data.summary.total_tokens;
      } else if (data.total_tokens) {
        contextLength = data.total_tokens;
      }
      
      // Analyze actual trace characteristics to determine dynamic percentages
      const toolCallCount = spans.filter((span: any) => span.operation_name?.includes('tool_call')).length;
      const retryCount = spans.filter((span: any) => span.operation_name?.includes('retry') || span.retry_count > 0).length;
      const avgSpanDuration = spans.length > 0 ? spans.reduce((sum: number, span: any) => sum + (span.duration_ms || 0), 0) / spans.length : 0;
      
      // Calculate percentages based on actual trace characteristics
      let systemPromptPercentage = 0.4; // Default for basic requests
      let toolCallsPercentage = 0.0; // Start at 0, increase based on actual usage
      let contextWindowPercentage = 0.0; // Start at 0, increase based on actual usage
      let retryPercentage = 0.0; // Start at 0, increase based on actual usage
      
      // Adjust based on actual trace data
      if (toolCallCount > 0) {
        toolCallsPercentage = Math.min(0.6, toolCallCount * 0.1); // 10% per tool call, max 60%
        systemPromptPercentage = Math.max(0.2, 0.4 - (toolCallCount * 0.05));
      }
      
      if (retryCount > 0) {
        retryPercentage = Math.min(0.3, retryCount * 0.08); // 8% per retry, max 30%
        systemPromptPercentage = Math.max(0.15, systemPromptPercentage - (retryCount * 0.03));
      }
      
      if (contextLength > 0) {
        // Scale context percentage based on actual token count
        const contextRatio = Math.min(1, contextLength / 50000); // Normalize to 50k tokens
        contextWindowPercentage = contextRatio * 0.4; // Max 40% for very long contexts
        systemPromptPercentage = Math.max(0.1, systemPromptPercentage - (contextRatio * 0.2));
      }
      
      if (avgSpanDuration > 0) {
        // Scale based on actual performance characteristics
        const performanceRatio = Math.min(1, avgSpanDuration / 5000); // Normalize to 5s
        toolCallsPercentage = Math.min(0.7, toolCallsPercentage + (performanceRatio * 0.2));
        systemPromptPercentage = Math.max(0.05, systemPromptPercentage - (performanceRatio * 0.1));
      }
      
      // Normalize percentages to ensure they sum to 1.0
      const totalPercentage = systemPromptPercentage + toolCallsPercentage + contextWindowPercentage + retryPercentage;
      systemPromptPercentage /= totalPercentage;
      toolCallsPercentage /= totalPercentage;
      contextWindowPercentage /= totalPercentage;
      retryPercentage /= totalPercentage;
      
      const systemPromptCost = totalCost * systemPromptPercentage;
      const toolCallsCost = totalCost * toolCallsPercentage;
      const contextWindowCost = totalCost * contextWindowPercentage;
      const retryCost = totalCost * retryPercentage;
      
      return {
        system_prompt_cost: systemPromptCost,
        tool_calls_cost: toolCallsCost,
        context_window_cost: contextWindowCost,
        retry_cost: retryCost,
        total_explained_cost: systemPromptCost + toolCallsCost + contextWindowCost + retryCost,
        unexplained_cost: Math.max(0, totalCost - (systemPromptCost + toolCallsCost + contextWindowCost + retryCost))
      };
    } catch (error) {
      loggingService.error('Failed to calculate dynamic cost attribution:', { error: error instanceof Error ? error.message : String(error) });
      // Fallback to intelligent analysis based on available data
      const spans = data.spans || [];
      const hasAnyToolCalls = spans.some((span: any) => span.operation_name?.includes('tool_call'));
      const hasAnyRetries = spans.some((span: any) => span.operation_name?.includes('retry') || span.retry_count > 0);
      
      // Intelligent fallback based on what we can detect
      let fallbackSystemPrompt = 0.4;
      let fallbackToolCalls = 0.3;
      let fallbackContext = 0.2;
      let fallbackRetries = 0.1;
      
      if (hasAnyToolCalls) {
        fallbackToolCalls = 0.4;
        fallbackSystemPrompt = 0.35;
        fallbackContext = 0.15;
        fallbackRetries = 0.1;
      }
      
      if (hasAnyRetries) {
        fallbackRetries = 0.15;
        fallbackSystemPrompt = 0.35;
        fallbackToolCalls = 0.3;
        fallbackContext = 0.2;
      }
      
      return {
        system_prompt_cost: totalCost * fallbackSystemPrompt,
        tool_calls_cost: totalCost * fallbackToolCalls,
        context_window_cost: totalCost * fallbackContext,
        retry_cost: totalCost * fallbackRetries,
        total_explained_cost: totalCost * (fallbackSystemPrompt + fallbackToolCalls + fallbackContext + fallbackRetries),
        unexplained_cost: totalCost * (1 - (fallbackSystemPrompt + fallbackToolCalls + fallbackContext + fallbackRetries))
      };
    }
  }

  /**
   * Calculate weekly growth rate from historical data
   */
  private calculateWeeklyGrowth(historicalData: any): number {
    try {
      // Calculate weekly growth based on actual data
      if (!historicalData || !historicalData.weekly_data || historicalData.weekly_data.length < 2) {
        return 0; // No data to calculate growth
      }
      
      const weeklyData = historicalData.weekly_data;
      const currentWeek = weeklyData[weeklyData.length - 1];
      const previousWeek = weeklyData[weeklyData.length - 2];
      
      if (previousWeek.total_cost_usd === 0) {
        return currentWeek.total_cost_usd > 0 ? 1 : 0; // 100% growth if going from 0 to positive
      }
      
      return (currentWeek.total_cost_usd - previousWeek.total_cost_usd) / previousWeek.total_cost_usd;
    } catch (error) {
      loggingService.error('Failed to calculate weekly growth:', { error: error instanceof Error ? error.message : String(error) });
      return 0;
    }
  }

  /**
   * Calculate monthly growth rate from historical data
   */
  private calculateMonthlyGrowth(historicalData: any): number {
    try {
      // Calculate monthly growth based on actual data
      if (!historicalData || !historicalData.monthly_data || historicalData.monthly_data.length < 2) {
        return 0; // No data to calculate growth
      }
      
      const monthlyData = historicalData.monthly_data;
      const currentMonth = monthlyData[monthlyData.length - 1];
      const previousMonth = monthlyData[monthlyData.length - 2];
      
      if (previousMonth.total_cost_usd === 0) {
        return currentMonth.total_cost_usd > 0 ? 1 : 0; // 100% growth if going from 0 to positive
      }
      
      return (currentMonth.total_cost_usd - previousMonth.total_cost_usd) / previousMonth.total_cost_usd;
    } catch (error) {
      loggingService.error('Failed to calculate monthly growth:', { error: error instanceof Error ? error.message : String(error) });
      return 0;
    }
  }

  /**
   * Calculate cost driver trends from historical data
   */
  private calculateCostDriverTrends(historicalData: any): Array<{
    driver: string;
    trend: 'increasing' | 'decreasing' | 'stable';
    rate: number;
  }> {
    try {
      // Calculate trends based on actual data
      if (!historicalData || !historicalData.daily_data || historicalData.daily_data.length < 7) {
        return []; // Need at least a week of data
      }
      
      const dailyData = historicalData.daily_data;
      const recentDays = dailyData.slice(-7); // Last 7 days
      const previousDays = dailyData.slice(-14, -7); // Previous 7 days
      
      if (recentDays.length === 0 || previousDays.length === 0) {
        return [];
      }
      
      const trends: Array<{
        driver: string;
        trend: 'increasing' | 'decreasing' | 'stable';
        rate: number;
      }> = [];
      
      // Calculate system prompt trend
      const recentSystemPrompt = recentDays.reduce((sum: number, day: any) => sum + (day.system_prompt_cost || 0), 0);
      const previousSystemPrompt = previousDays.reduce((sum: number, day: any) => sum + (day.system_prompt_cost || 0), 0);
      const systemPromptRate = previousSystemPrompt > 0 ? (recentSystemPrompt - previousSystemPrompt) / previousSystemPrompt : 0;
      trends.push({
        driver: 'system_prompt',
        trend: systemPromptRate > Math.max(0.03, Math.abs(systemPromptRate) * 0.1) ? 'increasing' : systemPromptRate < -Math.max(0.03, Math.abs(systemPromptRate) * 0.1) ? 'decreasing' : 'stable',
        rate: systemPromptRate
      });
      
      // Calculate tool calls trend
      const recentToolCalls = recentDays.reduce((sum: number, day: any) => sum + (day.tool_calls_cost || 0), 0);
      const previousToolCalls = previousDays.reduce((sum: number, day: any) => sum + (day.tool_calls_cost || 0), 0);
      const toolCallsRate = previousToolCalls > 0 ? (recentToolCalls - previousToolCalls) / previousToolCalls : 0;
      trends.push({
        driver: 'tool_calls',
        trend: toolCallsRate > Math.max(0.03, Math.abs(toolCallsRate) * 0.1) ? 'increasing' : toolCallsRate < -Math.max(0.03, Math.abs(toolCallsRate) * 0.1) ? 'decreasing' : 'stable',
        rate: toolCallsRate
      });
      
      // Calculate context window trend
      const recentContext = recentDays.reduce((sum: number, day: any) => sum + (day.context_window_cost || 0), 0);
      const previousContext = previousDays.reduce((sum: number, day: any) => sum + (day.context_window_cost || 0), 0);
      const contextRate = previousContext > 0 ? (recentContext - previousContext) / previousContext : 0;
      trends.push({
        driver: 'context_window',
        trend: contextRate > Math.max(0.03, Math.abs(contextRate) * 0.1) ? 'increasing' : contextRate < -Math.max(0.03, Math.abs(contextRate) * 0.1) ? 'decreasing' : 'stable',
        rate: contextRate
      });
      
      return trends;
    } catch (error) {
      loggingService.error('Failed to calculate cost driver trends:', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  /**
   * Generate cost predictions using AI
   */
  private async generateCostPredictions(
    historicalData: any,
    trends: any
  ): Promise<{
    next_week: number;
    next_month: number;
    confidence: number;
  }> {
    try {
      // Extract historical context for better predictions
      const totalHistoricalCost = historicalData.total_cost_usd || 0;
      const historicalDays = historicalData.daily_data?.length || 7;
      const costVolatility = historicalData.daily_data ? 
        Math.sqrt(historicalData.daily_data.reduce((sum: number, day: any) => 
          sum + Math.pow((day.total_cost_usd || 0) - (totalHistoricalCost / historicalDays), 2), 0) / historicalDays) : 0;
      
      const prompt = `Based on this cost trend data and historical context, predict future costs:

Current Daily Average: $${trends.daily_average}
Weekly Growth Rate: ${(trends.weekly_growth * 100).toFixed(1)}%
Monthly Growth Rate: ${(trends.monthly_growth * 100).toFixed(1)}%

Historical Context:
- Total Historical Cost: $${totalHistoricalCost.toFixed(4)}
- Historical Days Analyzed: ${historicalDays}
- Cost Volatility: $${costVolatility.toFixed(6)} (standard deviation)

Predict:
1. Next week's daily average cost
2. Next month's daily average cost
3. Confidence level (0-1) for these predictions

Consider the trends, historical volatility, and provide realistic estimates. Higher volatility should reduce confidence.`;

      try {
        // Use Bedrock service to generate AI-powered cost predictions
        const modelId = process.env.AWS_BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0';
        const aiResponse = await AIRouterService.invokeModel(prompt, modelId);
        
        if (aiResponse && typeof aiResponse === 'string' && aiResponse.trim().length > 0) {
          // Try to parse AI response for predictions
          try {
            // Look for numbers in the response that could be predictions
            const numbers = aiResponse.match(/\$?(\d+\.?\d*)/g);
            if (numbers && numbers.length >= 2) {
              const nextWeek = parseFloat(numbers[0].replace('$', ''));
              const nextMonth = parseFloat(numbers[1].replace('$', ''));
              const confidence = numbers.length >= 3 ? parseFloat(numbers[2]) : 0.8;
              
              return {
                next_week: nextWeek,
                next_month: nextMonth,
                confidence: Math.min(Math.max(confidence, 0), 1) // Ensure confidence is between 0 and 1
              };
            }
          } catch (parseError) {
            loggingService.warn('Failed to parse AI response for predictions:', { error: parseError instanceof Error ? parseError.message : String(parseError) });
          }
        }
        
        throw new Error('Invalid AI response format');
      } catch (aiError) {
        loggingService.warn('AI generation failed, falling back to trend-based calculations:', { error: aiError instanceof Error ? aiError.message : String(aiError) });
        
        // Fallback to trend-based calculations if AI fails
        const nextWeek = trends.daily_average * (1 + trends.weekly_growth);
        const nextMonth = trends.daily_average * (1 + trends.monthly_growth);
        const confidence = 0.8; // Base confidence, adjust based on data quality

        return {
          next_week: nextWeek,
          next_month: nextMonth,
          confidence
        };
      }
    } catch (error) {
      loggingService.error('Failed to generate cost predictions:', { error: error instanceof Error ? error.message : String(error) });
      
      // Fallback to simple calculations
      const nextWeek = trends.daily_average * (1 + trends.weekly_growth);
      const nextMonth = trends.daily_average * (1 + trends.monthly_growth);
      
      return {
        next_week: nextWeek,
        next_month: nextMonth,
        confidence: 0.6
      };
    }
  }

  /**
   * Generate cost story with timeout protection
   */
  private async generateCostStoryWithTimeout(
    costDrivers: CostDriver[],
    telemetryData: any,
    baselineCosts: any
  ): Promise<string> {
    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Cost story generation timeout after 15 seconds')), 15000);
      });

      const storyPromise = this.generateCostStory(costDrivers, telemetryData, baselineCosts);
      return await Promise.race([storyPromise, timeoutPromise]) as string;
    } catch (error) {
      loggingService.warn('Cost story generation timed out, using fallback:', { error: error instanceof Error ? error.message : String(error) });
      return this.generateFallbackCostStory(costDrivers, telemetryData, baselineCosts);
    }
  }

  /**
   * Generate optimization recommendations with timeout protection
   */
  private async generateOptimizationRecommendationsWithTimeout(
    costDrivers: CostDriver[],
    telemetryData: any
  ): Promise<Array<{
    type: 'immediate' | 'short_term' | 'long_term';
    description: string;
    potential_savings: number;
    implementation_effort: 'low' | 'medium' | 'high';
  }>> {
    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Recommendations generation timeout after 15 seconds')), 15000);
      });

      const recommendationsPromise = this.generateOptimizationRecommendations(costDrivers, telemetryData);
      return await Promise.race([recommendationsPromise, timeoutPromise]) as Array<{
        type: 'immediate' | 'short_term' | 'long_term';
        description: string;
        potential_savings: number;
        implementation_effort: 'low' | 'medium' | 'high';
      }>;
    } catch (error) {
      loggingService.warn('Recommendations generation timed out, using fallback:', { error: error instanceof Error ? error.message : String(error) });
      return this.generateFallbackRecommendations(costDrivers);
    }
  }

  /**
   * Generate fallback cost story when AI fails - handles both trace data and cost drivers
   */
  private generateFallbackCostStory(
    data: any,
    costAttributionOrDrivers: any,
    baselineCosts?: any
  ): string {
    try {
      // Check if this is trace data (has summary) or cost drivers array
      if (data.summary && data.summary.total_cost_usd) {
        // This is trace data - use existing logic
        return this.generateTraceFallbackCostStory(data, costAttributionOrDrivers);
      } else {
        // This is cost drivers array - generate analysis story
        return this.generateAnalysisFallbackCostStory(data, costAttributionOrDrivers, baselineCosts);
      }
    } catch (error) {
      loggingService.error('Failed to generate fallback cost story:', { error: error instanceof Error ? error.message : String(error) });
      return 'Cost analysis unavailable due to processing errors.';
    }
  }

  /**
   * Generate fallback cost story for trace data
   */
  private generateTraceFallbackCostStory(traceData: any, costAttribution: any): string {
    try {
      const totalCost = traceData.summary.total_cost_usd;
      const duration = traceData.summary.total_duration_ms;
      const tokens = traceData.summary.total_tokens;
      
      // Analyze trace characteristics dynamically
      const spans = traceData.spans || [];
      const hasToolCalls = spans.some((span: any) => span.operation_name?.includes('tool_call'));
      const hasRetries = spans.some((span: any) => span.operation_name?.includes('retry') || span.retry_count > 0);
      const contextLength = tokens || 0;
      
      // Generate dynamic cost story based on actual trace analysis
      let costStory = `Trace ${traceData.summary.trace_id} incurred $${totalCost.toFixed(4)} in costs`;
      
      // Analyze primary cost drivers
      const costDrivers = [];
      if (costAttribution.system_prompt_cost > 0) {
        const percentage = ((costAttribution.system_prompt_cost / totalCost) * 100).toFixed(1);
        costDrivers.push(`system prompt usage (${percentage}%)`);
      }
      
      if (costAttribution.tool_calls_cost > 0 && hasToolCalls) {
        const percentage = ((costAttribution.tool_calls_cost / totalCost) * 100).toFixed(1);
        costDrivers.push(`tool calls (${percentage}%)`);
      }
      
      if (costAttribution.context_window_cost > 0 && contextLength > 0) {
        const percentage = ((costAttribution.context_window_cost / totalCost) * 100).toFixed(1);
        const contextDescription = this.getContextDescription(contextLength);
        costDrivers.push(`${contextDescription} context window (${percentage}%)`);
      }
      
      if (costAttribution.retry_cost > 0 && hasRetries) {
        const percentage = ((costAttribution.retry_cost / totalCost) * 100).toFixed(1);
        costDrivers.push(`retry attempts (${percentage}%)`);
      }
      
      // Build the story dynamically
      if (costDrivers.length > 0) {
        costStory += `, primarily from ${costDrivers.join(' and ')}`;
      }
      
      // Add performance insights based on actual data analysis
      if (duration > 0) {
        const performanceDescription = this.getPerformanceDescription(duration);
        costStory += `. The request took ${duration}ms (${performanceDescription}), `;
        
        const performanceInsight = this.getPerformanceInsight(duration);
        costStory += performanceInsight;
      }
      
      if (contextLength > 0) {
        const contextDescription = this.getContextDescription(contextLength);
        costStory += `. ${contextDescription.charAt(0).toUpperCase() + contextDescription.slice(1)} context window (${contextLength} tokens) `;
        
        const contextInsight = this.getContextInsight(contextLength);
        costStory += contextInsight;
      }
      
      costStory += '.';
      
      return costStory;
    } catch (error) {
      loggingService.error('Failed to generate trace fallback cost story:', { error: error instanceof Error ? error.message : String(error) });
      return 'Cost analysis unavailable for this trace.';
    }
  }

  /**
   * Generate fallback cost story for cost analysis
   */
  private generateAnalysisFallbackCostStory(
    costDrivers: CostDriver[],
    telemetryData: any,
    baselineCosts: any
  ): string {
    try {
      const totalCost = costDrivers.reduce((sum, driver) => sum + driver.cost_impact, 0);
      const baselineCost = baselineCosts?.expected_daily_cost || 0;
      const deviation = baselineCost > 0 ? ((totalCost - baselineCost) / baselineCost) * 100 : 0;
      
      const topDriver = costDrivers[0];
      const driverType = topDriver ? topDriver.driver_type.replace('_', ' ') : 'unknown';
      
      return `Cost analysis shows ${deviation > 0 ? 'an increase' : 'a decrease'} of ${Math.abs(deviation).toFixed(1)}% from the expected baseline of $${baselineCost.toFixed(4)}. The primary cost driver is ${driverType}, contributing $${topDriver?.cost_impact.toFixed(4) || '0.00'} to the total cost of $${totalCost.toFixed(4)}. This suggests ${deviation > 0 ? 'increased usage or inefficiencies' : 'improved optimization or reduced usage'} in the AI operations.`;
    } catch (error) {
      loggingService.error('Failed to generate analysis fallback cost story:', { error: error instanceof Error ? error.message : String(error) });
      return 'Cost analysis unavailable due to processing errors.';
    }
  }

  /**
   * Generate fallback recommendations when AI fails
   */
  private generateFallbackRecommendations(costDrivers: CostDriver[]): Array<{
    type: 'immediate' | 'short_term' | 'long_term';
    description: string;
    potential_savings: number;
    implementation_effort: 'low' | 'medium' | 'high';
  }> {
    try {
      const recommendations: Array<{
        type: 'immediate' | 'short_term' | 'long_term';
        description: string;
        potential_savings: number;
        implementation_effort: 'low' | 'medium' | 'high';
      }> = [];

      costDrivers.forEach(driver => {
        if (driver.driver_type === 'system_prompt') {
          recommendations.push({
            type: 'immediate',
            description: 'Optimize system prompts to reduce token usage',
            potential_savings: driver.optimization_potential,
            implementation_effort: 'low'
          });
        } else if (driver.driver_type === 'tool_calls') {
          recommendations.push({
            type: 'short_term',
            description: 'Implement caching for tool calls to reduce API costs',
            potential_savings: driver.optimization_potential,
            implementation_effort: 'medium'
          });
        } else if (driver.driver_type === 'context_window') {
          recommendations.push({
            type: 'long_term',
            description: 'Implement context window optimization strategies',
            potential_savings: driver.optimization_potential,
            implementation_effort: 'high'
          });
        } else if (driver.driver_type === 'retries') {
          recommendations.push({
            type: 'immediate',
            description: 'Implement better error handling to reduce retries',
            potential_savings: driver.optimization_potential,
            implementation_effort: 'low'
          });
        }
      });

      return recommendations;
    } catch (error) {
      loggingService.error('Failed to generate fallback recommendations:', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  /**
   * Circuit breaker utilities for AI operations
   */
  private static isAiCircuitBreakerOpen(): boolean {
    if (this.aiFailureCount >= this.MAX_AI_FAILURES) {
      const timeSinceLastFailure = Date.now() - this.lastAiFailureTime;
      if (timeSinceLastFailure < this.AI_CIRCUIT_BREAKER_RESET_TIME) {
        return true;
      } else {
        // Reset circuit breaker
        this.aiFailureCount = 0;
        return false;
      }
    }
    return false;
  }

  /**
   * Circuit breaker utilities for database operations
   */
  private static isDbCircuitBreakerOpen(): boolean {
    if (this.dbFailureCount >= this.MAX_DB_FAILURES) {
      const timeSinceLastFailure = Date.now() - this.lastDbFailureTime;
      if (timeSinceLastFailure < this.DB_CIRCUIT_BREAKER_RESET_TIME) {
        return true;
      } else {
        // Reset circuit breaker
        this.dbFailureCount = 0;
        return false;
      }
    }
    return false;
  }

  /**
   * Cleanup method for graceful shutdown
   */
  static cleanup(): void {
    // Reset circuit breaker state
    this.aiFailureCount = 0;
    this.lastAiFailureTime = 0;
    this.dbFailureCount = 0;
    this.lastDbFailureTime = 0;
  }
}

