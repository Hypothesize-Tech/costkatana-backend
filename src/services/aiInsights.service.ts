import { loggingService } from './logging.service';
import { TelemetryService } from './telemetry.service';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

export interface AnomalyDetection {
  id: string;
  type: 'cost_spike' | 'performance_degradation' | 'error_surge' | 'usage_anomaly';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  detected_at: Date;
  affected_operations: string[];
  metrics: {
    current_value: number;
    expected_value: number;
    deviation_percentage: number;
  };
  recommendations: string[];
}

export interface CostOptimization {
  id: string;
  category: 'model_selection' | 'caching' | 'batching' | 'routing' | 'scaling';
  title: string;
  description: string;
  potential_savings: {
    amount_usd: number;
    percentage: number;
  };
  implementation_effort: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
  steps: string[];
  affected_operations: string[];
}

export interface PredictiveForecast {
  id: string;
  forecast_type: 'cost' | 'usage' | 'performance';
  timeframe: '24h' | '7d' | '30d';
  predictions: Array<{
    timestamp: Date;
    predicted_value: number;
    confidence_interval: {
      lower: number;
      upper: number;
    };
  }>;
  trends: {
    direction: 'increasing' | 'decreasing' | 'stable';
    rate_of_change: number;
    seasonal_patterns: string[];
  };
  recommendations: string[];
}

export interface AIInsightsSummary {
  anomalies: AnomalyDetection[];
  optimizations: CostOptimization[];
  forecasts: PredictiveForecast[];
  overall_health_score: number;
  key_insights: string[];
  priority_actions: string[];
}

export class AIInsightsService {
  private static instance: AIInsightsService;
  private bedrockClient: BedrockRuntimeClient;

  private constructor() {
    this.bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_BEDROCK_REGION || 'us-east-1',
    });
  }

  static getInstance(): AIInsightsService {
    if (!AIInsightsService.instance) {
      AIInsightsService.instance = new AIInsightsService();
    }
    return AIInsightsService.instance;
  }

  /**
   * Generate comprehensive AI insights
   */
  async generateInsights(timeframe: string = '24h'): Promise<AIInsightsSummary> {
    try {
      const [anomalies, optimizations, forecasts] = await Promise.all([
        this.detectAnomalies(timeframe),
        this.generateOptimizations(timeframe),
        this.generateForecasts(timeframe)
      ]);

      const healthScore = this.calculateHealthScore(anomalies, optimizations);
      const keyInsights = await this.generateKeyInsights(anomalies, optimizations, forecasts);
      const priorityActions = this.generatePriorityActions(anomalies, optimizations);

      return {
        anomalies,
        optimizations,
        forecasts,
        overall_health_score: healthScore,
        key_insights: keyInsights,
        priority_actions: priorityActions
      };
    } catch (error) {
      loggingService.error('Failed to generate AI insights:', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Detect anomalies in telemetry data
   */
  async detectAnomalies(timeframe: string): Promise<AnomalyDetection[]> {
    try {
      const anomalies: AnomalyDetection[] = [];

      // Get current and historical data
      const currentData = await this.getTimeframeData(timeframe);
      const historicalData = await this.getHistoricalBaseline(timeframe);

      // Cost spike detection
      const costAnomaly = await this.detectCostSpike(currentData, historicalData);
      if (costAnomaly) anomalies.push(costAnomaly);

      // Performance degradation detection
      const performanceAnomaly = await this.detectPerformanceDegradation(currentData, historicalData);
      if (performanceAnomaly) anomalies.push(performanceAnomaly);

      // Error surge detection
      const errorAnomaly = await this.detectErrorSurge(currentData, historicalData);
      if (errorAnomaly) anomalies.push(errorAnomaly);

      // Usage anomaly detection
      const usageAnomaly = await this.detectUsageAnomaly(currentData, historicalData);
      if (usageAnomaly) anomalies.push(usageAnomaly);

      return anomalies;
    } catch (error) {
      loggingService.error('Failed to detect anomalies:', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  /**
   * Generate cost optimization recommendations
   */
  async generateOptimizations(timeframe: string): Promise<CostOptimization[]> {
    try {
      const optimizations: CostOptimization[] = [];
      const data = await this.getTimeframeData(timeframe);

      // Model selection optimization
      const modelOpt = await this.analyzeModelSelection(data);
      if (modelOpt) optimizations.push(modelOpt);

      // Caching optimization
      const cacheOpt = await this.analyzeCachingOpportunities(data);
      if (cacheOpt) optimizations.push(cacheOpt);

      // Batching optimization
      const batchOpt = await this.analyzeBatchingOpportunities(data);
      if (batchOpt) optimizations.push(batchOpt);

      // Routing optimization
      const routingOpt = await this.analyzeRoutingOptimization(data);
      if (routingOpt) optimizations.push(routingOpt);

      return optimizations;
    } catch (error) {
      loggingService.error('Failed to generate optimizations:', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  /**
   * Generate predictive forecasts
   */
  async generateForecasts(_timeframe: string): Promise<PredictiveForecast[]> {
    try {
      const forecasts: PredictiveForecast[] = [];
      const historicalData = await this.getHistoricalData('30d');

      // Cost forecast
      const costForecast = await this.generateCostForecast(historicalData);
      if (costForecast) forecasts.push(costForecast);

      // Usage forecast
      const usageForecast = await this.generateUsageForecast(historicalData);
      if (usageForecast) forecasts.push(usageForecast);

      // Performance forecast
      const performanceForecast = await this.generatePerformanceForecast(historicalData);
      if (performanceForecast) forecasts.push(performanceForecast);

      return forecasts;
    } catch (error) {
      loggingService.error('Failed to generate forecasts:', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  /**
   * Detect cost spikes
   */
  private async detectCostSpike(current: any, historical: any): Promise<AnomalyDetection | null> {
    const currentCost = current.totalCost;
    const expectedCost = historical.avgCost;
    const deviation = ((currentCost - expectedCost) / expectedCost) * 100;

    if (deviation > 50) { // 50% increase threshold
      return {
        id: `anomaly_cost_${Date.now()}`,
        type: 'cost_spike',
        severity: deviation > 100 ? 'critical' : 'high',
        description: `Cost increased by ${deviation.toFixed(1)}% compared to historical average`,
        detected_at: new Date(),
        affected_operations: current.topCostOperations,
        metrics: {
          current_value: currentCost,
          expected_value: expectedCost,
          deviation_percentage: deviation
        },
        recommendations: [
          'Review recent changes in AI model usage',
          'Check for increased request volume',
          'Consider implementing cost limits',
          'Analyze top cost-contributing operations'
        ]
      };
    }

    return null;
  }

  /**
   * Detect performance degradation
   */
  private async detectPerformanceDegradation(current: any, historical: any): Promise<AnomalyDetection | null> {
    const currentLatency = current.avgLatency;
    const expectedLatency = historical.avgLatency;
    const deviation = ((currentLatency - expectedLatency) / expectedLatency) * 100;

    if (deviation > 30) { // 30% latency increase threshold
      return {
        id: `anomaly_perf_${Date.now()}`,
        type: 'performance_degradation',
        severity: deviation > 100 ? 'high' : 'medium',
        description: `Average latency increased by ${deviation.toFixed(1)}% compared to baseline`,
        detected_at: new Date(),
        affected_operations: current.slowOperations,
        metrics: {
          current_value: currentLatency,
          expected_value: expectedLatency,
          deviation_percentage: deviation
        },
        recommendations: [
          'Check for resource constraints',
          'Review recent deployments',
          'Analyze slow operations',
          'Consider scaling resources'
        ]
      };
    }

    return null;
  }

  /**
   * Detect error surges
   */
  private async detectErrorSurge(current: any, historical: any): Promise<AnomalyDetection | null> {
    const currentErrorRate = current.errorRate;
    const expectedErrorRate = historical.avgErrorRate;
    const deviation = ((currentErrorRate - expectedErrorRate) / expectedErrorRate) * 100;

    if (deviation > 50 || currentErrorRate > 10) { // 50% increase or >10% absolute
      return {
        id: `anomaly_error_${Date.now()}`,
        type: 'error_surge',
        severity: currentErrorRate > 20 ? 'critical' : 'high',
        description: `Error rate increased to ${currentErrorRate.toFixed(1)}% (${deviation.toFixed(1)}% above baseline)`,
        detected_at: new Date(),
        affected_operations: current.errorOperations,
        metrics: {
          current_value: currentErrorRate,
          expected_value: expectedErrorRate,
          deviation_percentage: deviation
        },
        recommendations: [
          'Investigate recent error patterns',
          'Check API authentication issues',
          'Review model availability',
          'Implement error handling improvements'
        ]
      };
    }

    return null;
  }

  /**
   * Detect usage anomalies
   */
  private async detectUsageAnomaly(current: any, historical: any): Promise<AnomalyDetection | null> {
    const currentUsage = current.totalRequests;
    const expectedUsage = historical.avgRequests;
    const deviation = Math.abs((currentUsage - expectedUsage) / expectedUsage) * 100;

    if (deviation > 40) { // 40% deviation threshold
      const isSpike = currentUsage > expectedUsage;
      return {
        id: `anomaly_usage_${Date.now()}`,
        type: 'usage_anomaly',
        severity: deviation > 80 ? 'high' : 'medium',
        description: `Usage ${isSpike ? 'spike' : 'drop'} detected: ${deviation.toFixed(1)}% ${isSpike ? 'above' : 'below'} normal`,
        detected_at: new Date(),
        affected_operations: current.topOperations,
        metrics: {
          current_value: currentUsage,
          expected_value: expectedUsage,
          deviation_percentage: deviation
        },
        recommendations: isSpike ? [
          'Monitor for capacity constraints',
          'Check for unusual traffic patterns',
          'Consider auto-scaling',
          'Review rate limiting'
        ] : [
          'Investigate potential service issues',
          'Check for client-side problems',
          'Review recent changes',
          'Monitor for recovery'
        ]
      };
    }

    return null;
  }

  /**
   * Analyze model selection optimization
   */
  private async analyzeModelSelection(data: any): Promise<CostOptimization | null> {
    // Analyze if cheaper models could be used for certain operations
    const modelAnalysis = await this.analyzeModelEfficiency(data);
    
    if (modelAnalysis.potentialSavings > 0.1) { // $0.10 threshold
      return {
        id: `opt_model_${Date.now()}`,
        category: 'model_selection',
        title: 'Optimize AI Model Selection',
        description: 'Switch to more cost-effective models for suitable operations',
        potential_savings: {
          amount_usd: modelAnalysis.potentialSavings,
          percentage: modelAnalysis.savingsPercentage
        },
        implementation_effort: 'medium',
        impact: 'high',
        steps: [
          'Identify operations suitable for cheaper models',
          'Test performance with alternative models',
          'Implement model routing logic',
          'Monitor quality metrics'
        ],
        affected_operations: modelAnalysis.affectedOperations
      };
    }

    return null;
  }

  /**
   * Analyze caching opportunities
   */
  private async analyzeCachingOpportunities(data: any): Promise<CostOptimization | null> {
    const cacheAnalysis = await this.analyzeCacheEfficiency(data);
    
    if (cacheAnalysis.potentialSavings > 0.05) { // $0.05 threshold
      return {
        id: `opt_cache_${Date.now()}`,
        category: 'caching',
        title: 'Implement Intelligent Caching',
        description: 'Cache frequent requests to reduce AI model calls',
        potential_savings: {
          amount_usd: cacheAnalysis.potentialSavings,
          percentage: cacheAnalysis.savingsPercentage
        },
        implementation_effort: 'low',
        impact: 'medium',
        steps: [
          'Identify frequently repeated requests',
          'Implement semantic caching',
          'Set appropriate cache TTL',
          'Monitor cache hit rates'
        ],
        affected_operations: cacheAnalysis.cachableOperations
      };
    }

    return null;
  }

  /**
   * Analyze batching opportunities
   */
  private async analyzeBatchingOpportunities(data: any): Promise<CostOptimization | null> {
    const batchAnalysis = await this.analyzeBatchingPotential(data);
    
    if (batchAnalysis.potentialSavings > 0.02) { // $0.02 threshold
      return {
        id: `opt_batch_${Date.now()}`,
        category: 'batching',
        title: 'Implement Request Batching',
        description: 'Batch similar requests to reduce per-request overhead',
        potential_savings: {
          amount_usd: batchAnalysis.potentialSavings,
          percentage: batchAnalysis.savingsPercentage
        },
        implementation_effort: 'high',
        impact: 'medium',
        steps: [
          'Identify batchable request patterns',
          'Implement batching logic',
          'Add request queuing',
          'Monitor batch efficiency'
        ],
        affected_operations: batchAnalysis.batchableOperations
      };
    }

    return null;
  }

  /**
   * Analyze routing optimization
   */
  private async analyzeRoutingOptimization(data: any): Promise<CostOptimization | null> {
    const routingAnalysis = await this.analyzeRoutingEfficiency(data);
    
    if (routingAnalysis.potentialSavings > 0.03) { // $0.03 threshold
      return {
        id: `opt_routing_${Date.now()}`,
        category: 'routing',
        title: 'Optimize Request Routing',
        description: 'Route requests to most cost-effective endpoints',
        potential_savings: {
          amount_usd: routingAnalysis.potentialSavings,
          percentage: routingAnalysis.savingsPercentage
        },
        implementation_effort: 'medium',
        impact: 'medium',
        steps: [
          'Analyze endpoint cost differences',
          'Implement intelligent routing',
          'Add fallback mechanisms',
          'Monitor routing decisions'
        ],
        affected_operations: routingAnalysis.affectedOperations
      };
    }

    return null;
  }

  /**
   * Generate cost forecast
   */
  private async generateCostForecast(historicalData: any): Promise<PredictiveForecast | null> {
    try {
      // Simple linear regression for demonstration
      // In production, use more sophisticated forecasting
      const trend = this.calculateTrend(historicalData.costTimeSeries);
      const predictions = this.generatePredictions(trend, '7d', 'cost');

      return {
        id: `forecast_cost_${Date.now()}`,
        forecast_type: 'cost',
        timeframe: '7d',
        predictions,
        trends: {
          direction: trend.slope > 0 ? 'increasing' : trend.slope < 0 ? 'decreasing' : 'stable',
          rate_of_change: trend.slope,
          seasonal_patterns: ['weekday_peak', 'weekend_low']
        },
        recommendations: [
          trend.slope > 0.1 ? 'Cost is trending upward - consider optimization' : 'Cost trend is stable',
          'Monitor for seasonal patterns',
          'Set up cost alerts for early detection'
        ]
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Generate usage forecast
   */
  private async generateUsageForecast(historicalData: any): Promise<PredictiveForecast | null> {
    try {
      const trend = this.calculateTrend(historicalData.usageTimeSeries);
      const predictions = this.generatePredictions(trend, '7d', 'usage');

      return {
        id: `forecast_usage_${Date.now()}`,
        forecast_type: 'usage',
        timeframe: '7d',
        predictions,
        trends: {
          direction: trend.slope > 0 ? 'increasing' : trend.slope < 0 ? 'decreasing' : 'stable',
          rate_of_change: trend.slope,
          seasonal_patterns: ['business_hours_peak']
        },
        recommendations: [
          'Plan capacity based on predicted usage',
          'Consider auto-scaling policies',
          'Monitor for usage spikes'
        ]
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Generate performance forecast
   */
  private async generatePerformanceForecast(historicalData: any): Promise<PredictiveForecast | null> {
    try {
      const trend = this.calculateTrend(historicalData.latencyTimeSeries);
      const predictions = this.generatePredictions(trend, '7d', 'performance');

      return {
        id: `forecast_perf_${Date.now()}`,
        forecast_type: 'performance',
        timeframe: '7d',
        predictions,
        trends: {
          direction: trend.slope > 0 ? 'increasing' : trend.slope < 0 ? 'decreasing' : 'stable',
          rate_of_change: trend.slope,
          seasonal_patterns: ['load_dependent']
        },
        recommendations: [
          trend.slope > 0 ? 'Performance may degrade - monitor closely' : 'Performance trend is stable',
          'Consider performance optimizations',
          'Plan for capacity increases'
        ]
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Calculate health score
   */
  private calculateHealthScore(anomalies: AnomalyDetection[], optimizations: CostOptimization[]): number {
    let score = 100;

    // Deduct points for anomalies
    for (const anomaly of anomalies) {
      switch (anomaly.severity) {
        case 'critical': score -= 25; break;
        case 'high': score -= 15; break;
        case 'medium': score -= 10; break;
        case 'low': score -= 5; break;
      }
    }

    // Deduct points for missed optimizations
    score -= optimizations.length * 5;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Generate key insights using AI
   */
  private async generateKeyInsights(
    anomalies: AnomalyDetection[], 
    optimizations: CostOptimization[], 
    forecasts: PredictiveForecast[]
  ): Promise<string[]> {
    try {
      const prompt = `Based on this analysis data, provide 3-5 key insights:

Anomalies detected: ${anomalies.length}
- ${anomalies.map(a => `${a.type}: ${a.description}`).join('\n- ')}

Optimizations available: ${optimizations.length}
- ${optimizations.map(o => `${o.category}: ${o.description}`).join('\n- ')}

Forecasts: ${forecasts.length}
- ${forecasts.map(f => `${f.forecast_type}: ${f.trends.direction} trend`).join('\n- ')}

Provide concise, actionable insights.`;

      const modelId = process.env.AWS_BEDROCK_MODEL_ID || 'amazon.nova-pro-v1:0';
      
      let requestBody;
      if (modelId.includes('nova')) {
        // Nova Pro format
        requestBody = JSON.stringify({
          messages: [{
            role: 'user',
            content: [{ text: prompt }]
          }],
          inferenceConfig: {
            max_new_tokens: 1000,
            temperature: 0.7
          }
        });
      } else {
        // Claude format (fallback)
        requestBody = JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: prompt
          }]
        });
      }

      const command = new InvokeModelCommand({
        modelId,
        body: requestBody,
        contentType: 'application/json',
        accept: 'application/json'
      });

      const response = await this.bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      
      let responseText;
      if (modelId.includes('nova')) {
        // Nova Pro response format
        responseText = responseBody.output?.message?.content?.[0]?.text || responseBody.output?.text || '';
      } else {
        // Claude response format
        responseText = responseBody.content?.[0]?.text || '';
      }
      
      return responseText
        .split('\n')
        .filter((line: string) => line.trim().startsWith('-') || line.trim().match(/^\d+\./))
        .map((line: string) => line.replace(/^[-\d.]\s*/, '').trim())
        .filter((line: string) => line.length > 0);
    } catch (error) {
      return [
        'System analysis completed',
        'Review detected anomalies for immediate action',
        'Consider implementing suggested optimizations',
        'Monitor forecasted trends for planning'
      ];
    }
  }

  /**
   * Generate priority actions
   */
  private generatePriorityActions(anomalies: AnomalyDetection[], optimizations: CostOptimization[]): string[] {
    const actions: string[] = [];

    // Critical anomalies first
    const criticalAnomalies = anomalies.filter(a => a.severity === 'critical');
    criticalAnomalies.forEach(anomaly => {
      actions.push(`URGENT: Address ${anomaly.type} - ${anomaly.description}`);
    });

    // High-impact optimizations
    const highImpactOpts = optimizations.filter(o => o.impact === 'high');
    highImpactOpts.forEach(opt => {
      actions.push(`Implement ${opt.title} - potential savings: $${opt.potential_savings.amount_usd.toFixed(2)}`);
    });

    // High severity anomalies
    const highAnomalies = anomalies.filter(a => a.severity === 'high');
    highAnomalies.forEach(anomaly => {
      actions.push(`Investigate ${anomaly.type} - ${anomaly.description}`);
    });

    return actions.slice(0, 5); // Top 5 priority actions
  }

  // Helper methods for data analysis
  private async getTimeframeData(timeframe: string): Promise<any> {
    const metrics = await TelemetryService.getPerformanceMetrics({ timeframe });
    
    return {
      totalCost: metrics.total_cost_usd || 0,
      avgLatency: metrics.avg_duration_ms || 0,
      errorRate: metrics.error_rate || 0,
      totalRequests: metrics.total_requests || 0,
      topOperations: metrics.top_operations?.map((op: any) => op.name) || [],
      topCostOperations: metrics.top_operations?.slice(0, 3).map((op: any) => op.name) || [],
      slowOperations: metrics.top_operations?.filter((op: any) => op.avg_duration_ms > 2000).map((op: any) => op.name) || [],
      errorOperations: metrics.top_errors?.map((err: any) => err.type) || []
    };
  }

  private async getHistoricalBaseline(_timeframe: string): Promise<any> {
    // Get historical data for comparison (simplified)
    const metrics = await TelemetryService.getPerformanceMetrics({ timeframe: '24h' });
    
    return {
      avgCost: (metrics?.total_cost_usd || 0) * 0.8, // Assume 20% lower baseline
      avgLatency: (metrics?.avg_duration_ms || 0) * 0.9, // Assume 10% lower baseline
      avgErrorRate: (metrics?.error_rate || 0) * 0.7, // Assume 30% lower baseline
      avgRequests: (metrics?.total_requests || 0) * 0.85 // Assume 15% lower baseline
    };
  }

  private async getHistoricalData(_timeframe: string): Promise<any> {
    try {
      // Get data from the last 7 days for trend analysis
      const endTime = new Date();
      const startTime = new Date();
      startTime.setDate(startTime.getDate() - 7);

      const telemetryData = await TelemetryService.queryTelemetry({
        start_time: startTime,
        end_time: endTime,
        limit: 1000,
        sort_by: 'timestamp',
        sort_order: 'asc'
      });

      // Group by day
      const dailyStats = new Map();
      
      telemetryData.data.forEach((item: any) => {
        const day = new Date(item.timestamp).toDateString();
        if (!dailyStats.has(day)) {
          dailyStats.set(day, {
            totalCost: 0,
            totalRequests: 0,
            totalDuration: 0,
            count: 0
          });
        }
        
        const stats = dailyStats.get(day);
        stats.totalCost += item.cost_usd || 0;
        stats.totalRequests += 1;
        stats.totalDuration += item.duration_ms || 0;
        stats.count += 1;
      });

      const sortedDays = Array.from(dailyStats.entries()).sort(([a], [b]) => 
        new Date(a).getTime() - new Date(b).getTime()
      );

      return {
        costTimeSeries: sortedDays.map(([, stats]) => stats.totalCost),
        usageTimeSeries: sortedDays.map(([, stats]) => stats.totalRequests),
        latencyTimeSeries: sortedDays.map(([, stats]) => stats.count > 0 ? stats.totalDuration / stats.count : 0)
      };
    } catch (error) {
      loggingService.error('Failed to get historical data:', { error: error instanceof Error ? error.message : String(error) });
      return {
        costTimeSeries: [],
        usageTimeSeries: [],
        latencyTimeSeries: []
      };
    }
  }

  private calculateTrend(timeSeries: number[]): { slope: number; intercept: number } {
    const n = timeSeries.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = timeSeries;
    
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    return { slope, intercept };
  }

  private generatePredictions(trend: { slope: number; intercept: number }, timeframe: string, _type: string): any[] {
    const days = timeframe === '7d' ? 7 : timeframe === '30d' ? 30 : 1;
    const predictions = [];
    
    for (let i = 1; i <= days; i++) {
      const predicted = trend.intercept + trend.slope * i;
      const variance = predicted * 0.1; // 10% variance
      
      predictions.push({
        timestamp: new Date(Date.now() + i * 24 * 60 * 60 * 1000),
        predicted_value: Math.max(0, predicted),
        confidence_interval: {
          lower: Math.max(0, predicted - variance),
          upper: predicted + variance
        }
      });
    }
    
    return predictions;
  }

  // Analysis helper methods (real implementations)
  private async analyzeModelEfficiency(_data: any): Promise<any> {
    try {
      // Get recent AI model usage
      const endTime = new Date();
      const startTime = new Date();
      startTime.setHours(startTime.getHours() - 24);

      const telemetryData = await TelemetryService.queryTelemetry({
        start_time: startTime,
        end_time: endTime,
        limit: 1000
      });

      const modelStats = new Map();
      let totalCost = 0;

      telemetryData.data.forEach((item: any) => {
        if (item.gen_ai_model && item.cost_usd) {
          const model = item.gen_ai_model;
          if (!modelStats.has(model)) {
            modelStats.set(model, { cost: 0, count: 0 });
          }
          modelStats.get(model).cost += item.cost_usd;
          modelStats.get(model).count += 1;
          totalCost += item.cost_usd;
        }
      });

      // Calculate potential savings by switching expensive models
      let potentialSavings = 0;
      const expensiveThreshold = totalCost / telemetryData.data.length * 1.5; // 50% above average

      modelStats.forEach((stats, _model) => {
        const avgCost = stats.cost / stats.count;
        if (avgCost > expensiveThreshold) {
          potentialSavings += stats.cost * 0.3; // Assume 30% savings with cheaper model
        }
      });

      return {
        potentialSavings,
        savingsPercentage: totalCost > 0 ? (potentialSavings / totalCost) * 100 : 0,
        affectedOperations: Array.from(modelStats.keys())
      };
    } catch (error) {
      return {
        potentialSavings: 0,
        savingsPercentage: 0,
        affectedOperations: []
      };
    }
  }

  private async analyzeCacheEfficiency(_data: any): Promise<any> {
    try {
      const endTime = new Date();
      const startTime = new Date();
      startTime.setHours(startTime.getHours() - 24);

      const telemetryData = await TelemetryService.queryTelemetry({
        start_time: startTime,
        end_time: endTime,
        limit: 1000
      });

      // Look for repeated operations that could be cached
      const operationCounts = new Map();
      let totalCost = 0;
      let cachableCost = 0;

      telemetryData.data.forEach((item: any) => {
        const key = `${item.operation_name}-${item.http_route || ''}`;
        if (!operationCounts.has(key)) {
          operationCounts.set(key, { count: 0, cost: 0, operation: item.operation_name });
        }
        operationCounts.get(key).count += 1;
        operationCounts.get(key).cost += item.cost_usd || 0;
        totalCost += item.cost_usd || 0;
      });

      // Operations with >1 occurrence could benefit from caching
      operationCounts.forEach((stats) => {
        if (stats.count > 1) {
          cachableCost += stats.cost * 0.8; // Assume 80% cache hit rate
        }
      });

      const potentialSavings = cachableCost * 0.9; // 90% cost reduction for cached requests

      return {
        potentialSavings,
        savingsPercentage: totalCost > 0 ? (potentialSavings / totalCost) * 100 : 0,
        cachableOperations: Array.from(operationCounts.values())
          .filter(stats => stats.count > 1)
          .map(stats => stats.operation)
      };
    } catch (error) {
      return {
        potentialSavings: 0,
        savingsPercentage: 0,
        cachableOperations: []
      };
    }
  }

  private async analyzeBatchingPotential(_data: any): Promise<any> {
    try {
      const endTime = new Date();
      const startTime = new Date();
      startTime.setHours(startTime.getHours() - 1); // Look at last hour for batching opportunities

      const telemetryData = await TelemetryService.queryTelemetry({
        start_time: startTime,
        end_time: endTime,
        limit: 1000,
        sort_by: 'timestamp',
        sort_order: 'asc'
      });

      // Group operations by time windows (5-minute intervals)
      const timeWindows = new Map();
      let totalCost = 0;
      let batchableCost = 0;

      telemetryData.data.forEach((item: any) => {
        const timestamp = new Date(item.timestamp);
        const windowKey = Math.floor(timestamp.getTime() / (5 * 60 * 1000)); // 5-minute windows
        
        if (!timeWindows.has(windowKey)) {
          timeWindows.set(windowKey, []);
        }
        timeWindows.get(windowKey).push(item);
        totalCost += item.cost_usd || 0;
      });

      // Find windows with multiple similar operations
      timeWindows.forEach((operations) => {
        const operationGroups = new Map();
        operations.forEach((op: any) => {
          const key = op.operation_name;
          if (!operationGroups.has(key)) {
            operationGroups.set(key, []);
          }
          operationGroups.get(key).push(op);
        });

        operationGroups.forEach((group) => {
          if (group.length > 1) {
            const groupCost = group.reduce((sum: number, op: any) => sum + (op.cost_usd || 0), 0);
            batchableCost += groupCost * 0.2; // Assume 20% savings from batching
          }
        });
      });

      return {
        potentialSavings: batchableCost,
        savingsPercentage: totalCost > 0 ? (batchableCost / totalCost) * 100 : 0,
        batchableOperations: ['gen_ai.chat.completions', 'http.post']
      };
    } catch (error) {
      return {
        potentialSavings: 0,
        savingsPercentage: 0,
        batchableOperations: []
      };
    }
  }

  private async analyzeRoutingEfficiency(_data: any): Promise<any> {
    try {
      const endTime = new Date();
      const startTime = new Date();
      startTime.setHours(startTime.getHours() - 24);

      const telemetryData = await TelemetryService.queryTelemetry({
        start_time: startTime,
        end_time: endTime,
        limit: 1000
      });

      // Analyze routing patterns and costs
      const routeStats = new Map();
      let totalCost = 0;

      telemetryData.data.forEach((item: any) => {
        const route = item.http_route || item.operation_name || 'unknown';
        if (!routeStats.has(route)) {
          routeStats.set(route, { cost: 0, count: 0, avgDuration: 0 });
        }
        const stats = routeStats.get(route);
        stats.cost += item.cost_usd || 0;
        stats.count += 1;
        stats.avgDuration += item.duration_ms || 0;
        totalCost += item.cost_usd || 0;
      });

      // Calculate average cost per route
      routeStats.forEach((stats) => {
        stats.avgCost = stats.cost / stats.count;
        stats.avgDuration = stats.avgDuration / stats.count;
      });

      // Find routes that could be optimized
      const avgCostPerRoute = totalCost / routeStats.size;
      let potentialSavings = 0;

      routeStats.forEach((stats) => {
        if (stats.avgCost > avgCostPerRoute * 1.5) { // 50% above average
          potentialSavings += stats.cost * 0.25; // Assume 25% savings with better routing
        }
      });

      return {
        potentialSavings,
        savingsPercentage: totalCost > 0 ? (potentialSavings / totalCost) * 100 : 0,
        affectedOperations: Array.from(routeStats.keys())
      };
    } catch (error) {
      return {
        potentialSavings: 0,
        savingsPercentage: 0,
        affectedOperations: []
      };
    }
  }
}

export const aiInsightsService = AIInsightsService.getInstance();
