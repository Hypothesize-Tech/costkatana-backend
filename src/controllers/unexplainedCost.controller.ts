import { Response } from 'express';
import { UnexplainedCostService } from '../services/unexplainedCost.service';
import { loggingService } from '../services/logging.service';

export class UnexplainedCostController {
  private static service = UnexplainedCostService.getInstance();
  
  // Background processing queue
  private static backgroundQueue: Array<() => Promise<void>> = [];
  private static backgroundProcessor?: NodeJS.Timeout;
  
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
  
  // Request timeout configuration
  private static readonly DEFAULT_TIMEOUT = 15000; // 15 seconds
  private static readonly ANALYSIS_TIMEOUT = 30000; // 30 seconds for analysis
  private static readonly TRENDS_TIMEOUT = 20000; // 20 seconds for trends
  
  // Analysis result sharing within request scope
  private static analysisCache = new Map<string, { result: any; timestamp: number }>();
  private static readonly CACHE_TTL = 30000; // 30 seconds
  
  /**
   * Initialize background processor
   */
  static {
    this.startBackgroundProcessor();
  }

  /**
   * Analyze unexplained costs for a specific timeframe
   * GET /api/unexplained-costs/analyze
   */
  static async analyzeUnexplainedCosts(req: any, res: Response): Promise<void> {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] as string;
    const userId = req.user?.id;

    try {
      loggingService.info('Unexplained cost analysis initiated', {
        requestId,
        userId
      });

      // Validate authentication
      if (!userId) {
        loggingService.warn('Unexplained cost analysis failed - authentication required', {
          requestId
        });
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      // Check circuit breakers
      if (UnexplainedCostController.isAiCircuitBreakerOpen() || UnexplainedCostController.isDbCircuitBreakerOpen()) {
        throw new Error('Service temporarily unavailable');
      }

      const { timeframe = '24h', workspaceId = 'default' } = req.query;

      // Check for cached analysis result
      const cacheKey = `${userId}-${workspaceId}-${timeframe}`;
      const cachedResult = UnexplainedCostController.getCachedAnalysis(cacheKey);
      if (cachedResult) {
        const duration = Date.now() - startTime;
        loggingService.info('Unexplained cost analysis completed from cache', {
          requestId,
          duration,
          userId
        });

        res.json({
          success: true,
          data: cachedResult,
          message: 'Unexplained cost analysis completed successfully'
        });
        return;
      }

      // Use timeout handling for analysis
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Analysis timeout')), UnexplainedCostController.ANALYSIS_TIMEOUT);
      });

      const analysisPromise = UnexplainedCostController.service.analyzeUnexplainedCosts(
        userId,
        workspaceId as string,
        timeframe as string
      );

      const analysis = await Promise.race([analysisPromise, timeoutPromise]);
      const duration = Date.now() - startTime;

      // Cache the result for reuse
      UnexplainedCostController.setCachedAnalysis(cacheKey, analysis);

      loggingService.info('Unexplained cost analysis completed successfully', {
        requestId,
        duration,
        userId,
        totalCost: analysis.total_cost,
        deviationPercentage: analysis.deviation_percentage
      });

      // Queue background business event logging
      UnexplainedCostController.queueBackgroundOperation(async () => {
        loggingService.logBusiness({
          event: 'unexplained_cost_analysis_completed',
          category: 'cost_optimization',
          value: duration,
          metadata: {
            userId,
            timeframe,
            workspaceId,
            totalCost: analysis.total_cost,
            expectedCost: analysis.expected_cost,
            deviationPercentage: analysis.deviation_percentage,
            anomalyScore: analysis.anomaly_score,
            costDriverCount: analysis.cost_drivers?.length || 0
          }
        });
      });

      res.json({
        success: true,
        data: analysis,
        message: 'Unexplained cost analysis completed successfully'
      });
    } catch (error: any) {
      UnexplainedCostController.recordAiFailure();
      UnexplainedCostController.recordDbFailure();
      const duration = Date.now() - startTime;
      
      if (error.message === 'Service temporarily unavailable' || error.message === 'Analysis timeout') {
        loggingService.warn('Unexplained cost service unavailable', {
          requestId,
          duration,
          error: error.message
        });
        
        res.status(503).json({
          success: false,
          error: 'Service temporarily unavailable',
          message: 'Please try again later'
        });
        return;
      }
      
      loggingService.error('Unexplained cost analysis failed', {
        requestId,
        userId,
        error: error.message || 'Unknown error',
        duration
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to analyze unexplained costs',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Generate daily cost report with explanations
   * GET /api/unexplained-costs/daily-report
   */
  static async generateDailyCostReport(req: any, res: Response): Promise<void> {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] as string;
    const userId = req.user?.id;

    try {
      loggingService.info('Daily cost report generation initiated', {
        requestId,
        userId,
        hasUserId: !!userId
      });

      if (!userId) {
        loggingService.warn('Daily cost report generation failed - authentication required', {
          requestId
        });

        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const { date, workspaceId = 'default' } = req.query;
      const reportDate = date ? (date as string) : new Date().toISOString().split('T')[0];

      loggingService.info('Daily cost report generation parameters received', {
        requestId,
        userId,
        date,
        reportDate,
        workspaceId,
        hasDate: !!date,
        hasWorkspaceId: !!workspaceId,
        isDefaultDate: !date
      });

      const report = await UnexplainedCostController.service.generateDailyCostReport(
        userId,
        workspaceId as string,
        reportDate
      );
      const duration = Date.now() - startTime;

      loggingService.info('Daily cost report generated successfully', {
        requestId,
        duration,
        userId,
        date,
        reportDate,
        workspaceId,
        hasReport: !!report,
        reportType: typeof report,
        reportKeys: report ? Object.keys(report) : []
      });

      // Log business event
      loggingService.logBusiness({
        event: 'daily_cost_report_generated',
        category: 'cost_optimization',
        value: duration,
        metadata: {
          userId,
          date: reportDate,
          workspaceId,
          hasReport: !!report,
          reportType: typeof report
        }
      });

      res.json({
        success: true,
        data: report,
        message: 'Daily cost report generated successfully'
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Daily cost report generation failed', {
        requestId,
        userId,
        hasUserId: !!userId,
        date: req.query?.date,
        workspaceId: req.query?.workspaceId,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to generate daily cost report',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get cost attribution breakdown for a specific trace
   * GET /api/unexplained-costs/trace/:traceId
   */
  static async getTraceCostAttribution(req: any, res: Response): Promise<void> {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] as string;
    const userId = req.user?.id;

    try {
      loggingService.info('Trace cost attribution retrieval initiated', {
        requestId,
        userId,
        hasUserId: !!userId,
        traceId: req.params.traceId
      });

      if (!userId) {
        loggingService.warn('Trace cost attribution retrieval failed - authentication required', {
          requestId,
          traceId: req.params.traceId
        });

        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const { traceId } = req.params;
      const { workspaceId = 'default' } = req.query;

      loggingService.info('Trace cost attribution retrieval parameters received', {
        requestId,
        userId,
        traceId,
        workspaceId,
        hasTraceId: !!traceId,
        hasWorkspaceId: !!workspaceId
      });

      const traceData = await UnexplainedCostController.service.getTraceCostAttribution(
        userId,
        traceId,
      );
      const duration = Date.now() - startTime;

      loggingService.info('Trace cost attribution retrieved successfully', {
        requestId,
        duration,
        userId,
        traceId,
        workspaceId,
        hasTraceData: !!traceData,
        traceDataType: typeof traceData,
        traceDataKeys: traceData ? Object.keys(traceData) : []
      });

      // Log business event
      loggingService.logBusiness({
        event: 'trace_cost_attribution_retrieved',
        category: 'cost_optimization',
        value: duration,
        metadata: {
          userId,
          traceId,
          workspaceId,
          hasTraceData: !!traceData
        }
      });

      res.json({
        success: true,
        data: traceData,
        message: 'Trace cost attribution retrieved successfully'
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Trace cost attribution retrieval failed', {
        requestId,
        userId,
        hasUserId: !!userId,
        traceId: req.params.traceId,
        workspaceId: req.query?.workspaceId,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to get trace cost attribution',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get cost optimization recommendations
   * GET /api/unexplained-costs/recommendations
   */
  static async getCostOptimizationRecommendations(req: any, res: Response): Promise<void> {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] as string;
    const userId = req.user?.id;

    try {
      loggingService.info('Cost optimization recommendations retrieval initiated', {
        requestId,
        userId,
        hasUserId: !!userId
      });

      if (!userId) {
        loggingService.warn('Cost optimization recommendations retrieval failed - authentication required', {
          requestId
        });

        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const { timeframe = '7d', workspaceId = 'default' } = req.query;

      // Check for cached analysis result to avoid redundant calls
      const cacheKey = `${userId}-${workspaceId}-${timeframe}`;
      let analysis = UnexplainedCostController.getCachedAnalysis(cacheKey);
      
      if (!analysis) {
        // Use timeout handling for analysis
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Analysis timeout')), UnexplainedCostController.ANALYSIS_TIMEOUT);
        });

        const analysisPromise = UnexplainedCostController.service.analyzeUnexplainedCosts(
          userId,
          workspaceId as string,
          timeframe as string
        );

        analysis = await Promise.race([analysisPromise, timeoutPromise]);
        UnexplainedCostController.setCachedAnalysis(cacheKey, analysis);
      }
      const duration = Date.now() - startTime;

      const totalPotentialSavings = analysis.optimization_recommendations?.reduce(
        (sum: number, rec: any) => sum + rec.potential_savings, 0
      ) || 0;

      loggingService.info('Cost optimization recommendations retrieved successfully', {
        requestId,
        duration,
        userId,
        timeframe,
        workspaceId,
        recommendationCount: analysis.optimization_recommendations?.length || 0,
        totalPotentialSavings,
        costDriverCount: analysis.cost_drivers?.length || 0,
        hasRecommendations: !!(analysis.optimization_recommendations?.length),
        hasCostDrivers: !!(analysis.cost_drivers?.length)
      });

      // Log business event
      loggingService.logBusiness({
        event: 'cost_optimization_recommendations_retrieved',
        category: 'cost_optimization',
        value: duration,
        metadata: {
          userId,
          timeframe,
          workspaceId,
          recommendationCount: analysis.optimization_recommendations?.length || 0,
          totalPotentialSavings,
          costDriverCount: analysis.cost_drivers?.length || 0
        }
      });

      res.json({
        success: true,
        data: {
          recommendations: analysis.optimization_recommendations,
          total_potential_savings: totalPotentialSavings,
          timeframe: timeframe,
          cost_drivers: analysis.cost_drivers
        },
        message: 'Cost optimization recommendations retrieved successfully'
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Cost optimization recommendations retrieval failed', {
        requestId,
        userId,
        hasUserId: !!userId,
        timeframe: req.query?.timeframe,
        workspaceId: req.query?.workspaceId,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to get cost optimization recommendations',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get cost anomaly alerts
   * GET /api/unexplained-costs/anomalies
   */
  static async getCostAnomalies(req: any, res: Response): Promise<void> {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] as string;
    const userId = req.user?.id;

    try {
      loggingService.info('Cost anomalies retrieval initiated', {
        requestId,
        userId,
        hasUserId: !!userId
      });

      if (!userId) {
        loggingService.warn('Cost anomalies retrieval failed - authentication required', {
          requestId
        });

        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const { timeframe = '24h', workspaceId = 'default' } = req.query;

      // Check for cached analysis result to avoid redundant calls
      const cacheKey = `${userId}-${workspaceId}-${timeframe}`;
      let analysis = UnexplainedCostController.getCachedAnalysis(cacheKey);
      
      if (!analysis) {
        // Use timeout handling for analysis
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Analysis timeout')), UnexplainedCostController.ANALYSIS_TIMEOUT);
        });

        const analysisPromise = UnexplainedCostController.service.analyzeUnexplainedCosts(
          userId,
          workspaceId as string,
          timeframe as string
        );

        analysis = await Promise.race([analysisPromise, timeoutPromise]);
        UnexplainedCostController.setCachedAnalysis(cacheKey, analysis);
      }

      const anomalies = analysis.cost_drivers
        .filter((driver: any) => driver.cost_impact > 0.01) // Filter significant cost drivers
        .map((driver: any) => ({
          type: driver.driver_type,
          description: driver.explanation,
          cost_impact: driver.cost_impact,
          severity: driver.percentage_of_total > 50 ? 'high' : 
                   driver.percentage_of_total > 25 ? 'medium' : 'low',
          optimization_potential: driver.optimization_potential
        }));
      const duration = Date.now() - startTime;

      loggingService.info('Cost anomalies retrieved successfully', {
        requestId,
        duration,
        userId,
        timeframe,
        workspaceId,
        anomalyCount: anomalies.length,
        totalAnomalyScore: analysis.anomaly_score,
        totalCost: analysis.total_cost,
        expectedCost: analysis.expected_cost,
        deviationPercentage: analysis.deviation_percentage,
        hasAnomalies: anomalies.length > 0,
        highSeverityCount: anomalies.filter((a: any) => a.severity === 'high').length,
        mediumSeverityCount: anomalies.filter((a: any) => a.severity === 'medium').length,
        lowSeverityCount: anomalies.filter((a: any) => a.severity === 'low').length
      });

      // Log business event
      loggingService.logBusiness({
        event: 'cost_anomalies_retrieved',
        category: 'cost_optimization',
        value: duration,
        metadata: {
          userId,
          timeframe,
          workspaceId,
          anomalyCount: anomalies.length,
          totalAnomalyScore: analysis.anomaly_score,
          totalCost: analysis.total_cost,
          expectedCost: analysis.expected_cost,
          deviationPercentage: analysis.deviation_percentage,
          highSeverityCount: anomalies.filter((a: any) => a.severity === 'high').length
        }
      });

      res.json({
        success: true,
        data: {
          anomalies,
          total_anomaly_score: analysis.anomaly_score,
          timeframe: timeframe,
          total_cost: analysis.total_cost,
          expected_cost: analysis.expected_cost,
          deviation_percentage: analysis.deviation_percentage
        },
        message: 'Cost anomalies retrieved successfully'
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Cost anomalies retrieval failed', {
        requestId,
        userId,
        hasUserId: !!userId,
        timeframe: req.query?.timeframe,
        workspaceId: req.query?.workspaceId,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to get cost anomalies',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get historical cost trends and patterns
   * GET /api/unexplained-costs/trends
   */
  static async getCostTrends(req: any, res: Response): Promise<void> {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] as string;
    const userId = req.user?.id;

    try {
      loggingService.info('Cost trends retrieval initiated', {
        requestId,
        userId,
        hasUserId: !!userId
      });

      if (!userId) {
        loggingService.warn('Cost trends retrieval failed - authentication required', {
          requestId
        });

        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const { period = '30d', workspaceId = 'default' } = req.query;

      loggingService.info('Cost trends retrieval parameters received', {
        requestId,
        userId,
        period,
        workspaceId,
        hasPeriod: !!period,
        hasWorkspaceId: !!workspaceId
      });

      const trendsData = await UnexplainedCostController.service.getCostTrends(
        userId,
        period as string,
        workspaceId as string
      );
      const duration = Date.now() - startTime;

      loggingService.info('Cost trends retrieved successfully', {
        requestId,
        duration,
        userId,
        period,
        workspaceId,
        hasTrendsData: !!trendsData,
        trendsDataType: typeof trendsData,
        trendsDataKeys: trendsData ? Object.keys(trendsData) : []
      });

      // Log business event
      loggingService.logBusiness({
        event: 'cost_trends_retrieved',
        category: 'cost_optimization',
        value: duration,
        metadata: {
          userId,
          period,
          workspaceId,
          hasTrendsData: !!trendsData
        }
      });

      res.json({
        success: true,
        data: trendsData,
        message: 'Cost trends retrieved successfully'
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Cost trends retrieval failed', {
        requestId,
        userId,
        hasUserId: !!userId,
        period: req.query?.period,
        workspaceId: req.query?.workspaceId,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration
      });
      
      res.status(500).json({
        success: false,
        message: 'Failed to get cost trends',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Authentication validation utility
   */
  private static validateAuthentication(userId: string, requestId: string, res: Response): boolean {
    if (!userId) {
      loggingService.warn('Authentication required', { requestId });
      res.status(401).json({ message: 'Unauthorized' });
      return false;
    }
    return true;
  }

  /**
   * Analysis result management utilities
   */
  private static getCachedAnalysis(cacheKey: string): any | null {
    const cached = this.analysisCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
      return cached.result;
    }
    if (cached) {
      this.analysisCache.delete(cacheKey);
    }
    return null;
  }

  private static setCachedAnalysis(cacheKey: string, result: any): void {
    this.analysisCache.set(cacheKey, {
      result,
      timestamp: Date.now()
    });
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

  private static recordAiFailure(): void {
    this.aiFailureCount++;
    this.lastAiFailureTime = Date.now();
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

  private static recordDbFailure(): void {
    this.dbFailureCount++;
    this.lastDbFailureTime = Date.now();
  }

  /**
   * Background processing utilities
   */
  private static queueBackgroundOperation(operation: () => Promise<void>): void {
    this.backgroundQueue.push(operation);
  }

  private static startBackgroundProcessor(): void {
    this.backgroundProcessor = setInterval(async () => {
      if (this.backgroundQueue.length > 0) {
        const operation = this.backgroundQueue.shift();
        if (operation) {
          try {
            await operation();
          } catch (error) {
            loggingService.error('Background operation failed:', {
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }
    }, 1000);
  }

  /**
   * Cleanup method for graceful shutdown
   */
  static cleanup(): void {
    if (this.backgroundProcessor) {
      clearInterval(this.backgroundProcessor);
      this.backgroundProcessor = undefined;
    }
    
    // Process remaining queue items
    while (this.backgroundQueue.length > 0) {
      const operation = this.backgroundQueue.shift();
      if (operation) {
        operation().catch(error => {
          loggingService.error('Cleanup operation failed:', {
            error: error instanceof Error ? error.message : String(error)
          });
        });
      }
    }

    // Clear analysis cache
    this.analysisCache.clear();
  }
}

