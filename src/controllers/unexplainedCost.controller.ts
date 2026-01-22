import { Response } from 'express';
import { UnexplainedCostService } from '../services/unexplainedCost.service';
import { loggingService } from '../services/logging.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

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
  static async analyzeUnexplainedCosts(req: AuthenticatedRequest, res: Response): Promise<void> {
    const startTime = Date.now();
    
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('analyzeUnexplainedCosts', req, { query: req.query });

    try {

      // Check circuit breakers
      if (UnexplainedCostController.isAiCircuitBreakerOpen() || UnexplainedCostController.isDbCircuitBreakerOpen()) {
        throw new Error('Service temporarily unavailable');
      }

      const { timeframe = '24h', workspaceId = 'default' } = req.query;

      // Check for cached analysis result
      const cacheKey = `${userId}-${workspaceId}-${timeframe}`;
      const cachedResult = UnexplainedCostController.getCachedAnalysis(cacheKey);
      if (cachedResult) {
        ControllerHelper.logRequestSuccess('analyzeUnexplainedCosts', req, startTime, {
          cached: true
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

      // Cache the result for reuse
      UnexplainedCostController.setCachedAnalysis(cacheKey, analysis);

      const duration = Date.now() - startTime;

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

      ControllerHelper.logRequestSuccess('analyzeUnexplainedCosts', req, startTime, {
        totalCost: analysis.total_cost,
        deviationPercentage: analysis.deviation_percentage
      });

      res.json({
        success: true,
        data: analysis,
        message: 'Unexplained cost analysis completed successfully'
      });
    } catch (error: any) {
      UnexplainedCostController.recordAiFailure();
      UnexplainedCostController.recordDbFailure();
      
      if (error.message === 'Service temporarily unavailable' || error.message === 'Analysis timeout') {
        res.status(503).json({
          success: false,
          error: 'Service temporarily unavailable',
          message: 'Please try again later'
        });
        return;
      }
      
      ControllerHelper.handleError('analyzeUnexplainedCosts', error, req, res, startTime);
    }
  }

  /**
   * Generate daily cost report with explanations
   * GET /api/unexplained-costs/daily-report
   */
  static async generateDailyCostReport(req: AuthenticatedRequest, res: Response): Promise<void> {
    const startTime = Date.now();
    
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('generateDailyCostReport', req, { query: req.query });

    try {

      const { date, workspaceId = 'default' } = req.query;
      const reportDate = date ? (date as string) : new Date().toISOString().split('T')[0];

      // Daily cost report generation parameters received

      const report = await UnexplainedCostController.service.generateDailyCostReport(
        userId,
        workspaceId as string,
        reportDate
      );
      const duration = Date.now() - startTime;

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

      ControllerHelper.logRequestSuccess('generateDailyCostReport', req, startTime, {
        date: reportDate,
        workspaceId
      });

      res.json({
        success: true,
        data: report,
        message: 'Daily cost report generated successfully'
      });
    } catch (error: any) {
      ControllerHelper.handleError('generateDailyCostReport', error, req, res, startTime);
    }
  }

  /**
   * Get cost attribution breakdown for a specific trace
   * GET /api/unexplained-costs/trace/:traceId
   */
  static async getTraceCostAttribution(req: AuthenticatedRequest, res: Response): Promise<void> {
    const startTime = Date.now();
    const { traceId } = req.params;
    
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('getTraceCostAttribution', req, { traceId });

    try {
      if (traceId) {
        ServiceHelper.validateObjectId(traceId, 'traceId');
      }
      const { workspaceId = 'default' } = req.query;

      // Trace cost attribution retrieval parameters received

      const traceData = await UnexplainedCostController.service.getTraceCostAttribution(
        userId,
        traceId,
      );
      const duration = Date.now() - startTime;

      // Log business event
      loggingService.logBusiness({
        event: 'trace_cost_attribution_retrieved',
        category: 'cost_optimization',
        value: duration,
        metadata: {
          userId,
          traceId,
          workspaceId: req.query?.workspaceId,
          hasTraceData: !!traceData
        }
      });

      ControllerHelper.logRequestSuccess('getTraceCostAttribution', req, startTime, { traceId });

      res.json({
        success: true,
        data: traceData,
        message: 'Trace cost attribution retrieved successfully'
      });
    } catch (error: any) {
      ControllerHelper.handleError('getTraceCostAttribution', error, req, res, startTime, { traceId });
    }
  }

  /**
   * Get cost optimization recommendations
   * GET /api/unexplained-costs/recommendations
   */
  static async getCostOptimizationRecommendations(req: AuthenticatedRequest, res: Response): Promise<void> {
    const startTime = Date.now();
    
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('getCostOptimizationRecommendations', req, { query: req.query });

    try {

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

      const totalPotentialSavings = analysis.optimization_recommendations?.reduce(
        (sum: number, rec: any) => sum + rec.potential_savings, 0
      ) || 0;

      // Log business event
      loggingService.logBusiness({
        event: 'cost_optimization_recommendations_retrieved',
        category: 'cost_optimization',
        value: Date.now() - startTime,
        metadata: {
          userId,
          timeframe,
          workspaceId,
          recommendationCount: analysis.optimization_recommendations?.length || 0,
          totalPotentialSavings,
          costDriverCount: analysis.cost_drivers?.length || 0
        }
      });

      ControllerHelper.logRequestSuccess('getCostOptimizationRecommendations', req, startTime, {
        recommendationCount: analysis.optimization_recommendations?.length || 0,
        totalPotentialSavings
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
      ControllerHelper.handleError('getCostOptimizationRecommendations', error, req, res, startTime);
    }
  }

  /**
   * Get cost anomaly alerts
   * GET /api/unexplained-costs/anomalies
   */
  static async getCostAnomalies(req: AuthenticatedRequest, res: Response): Promise<void> {
    const startTime = Date.now();
    
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('getCostAnomalies', req, { query: req.query });

    try {

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

      ControllerHelper.logRequestSuccess('getCostAnomalies', req, startTime, {
        anomalyCount: anomalies.length,
        totalAnomalyScore: analysis.anomaly_score
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
      ControllerHelper.handleError('getCostAnomalies', error, req, res, startTime);
    }
  }

  /**
   * Get historical cost trends and patterns
   * GET /api/unexplained-costs/trends
   */
  static async getCostTrends(req: AuthenticatedRequest, res: Response): Promise<void> {
    const startTime = Date.now();
    
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    
    ControllerHelper.logRequestStart('getCostTrends', req, { query: req.query });

    try {

      const { period = '30d', workspaceId = 'default' } = req.query;

      // Cost trends retrieval parameters received

      const trendsData = await UnexplainedCostController.service.getCostTrends(
        userId,
        period as string,
        workspaceId as string
      );
      const duration = Date.now() - startTime;

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

      ControllerHelper.logRequestSuccess('getCostTrends', req, startTime, { period, workspaceId });

      res.json({
        success: true,
        data: trendsData,
        message: 'Cost trends retrieved successfully'
      });
    } catch (error: any) {
      ControllerHelper.handleError('getCostTrends', error, req, res, startTime);
    }
  }

  /**
   * Authentication validation utility
   */
  private static validateAuthentication(userId: string, requestId: string, res: Response): boolean {
    if (!userId) {
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

