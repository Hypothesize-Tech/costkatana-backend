import { Response } from 'express';
import { UnexplainedCostService } from '../services/unexplainedCost.service';
import { loggingService } from '../services/logging.service';

export class UnexplainedCostController {
  private static service = UnexplainedCostService.getInstance();

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
        userId,
        hasUserId: !!userId
      });

      if (!userId) {
        loggingService.warn('Unexplained cost analysis failed - authentication required', {
          requestId
        });

        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const { timeframe = '24h', workspaceId = 'default' } = req.query;

      loggingService.info('Unexplained cost analysis parameters received', {
        requestId,
        userId,
        timeframe,
        workspaceId,
        hasTimeframe: !!timeframe,
        hasWorkspaceId: !!workspaceId
      });

      const analysis = await UnexplainedCostController.service.analyzeUnexplainedCosts(
        userId,
        workspaceId as string,
        timeframe as string
      );
      const duration = Date.now() - startTime;

      loggingService.info('Unexplained cost analysis completed successfully', {
        requestId,
        duration,
        userId,
        timeframe,
        workspaceId,
        totalCost: analysis.total_cost,
        expectedCost: analysis.expected_cost,
        deviationPercentage: analysis.deviation_percentage,
        anomalyScore: analysis.anomaly_score,
        costDriverCount: analysis.cost_drivers?.length || 0,
        hasOptimizationRecommendations: !!(analysis.optimization_recommendations?.length)
      });

      // Log business event
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

      res.json({
        success: true,
        data: analysis,
        message: 'Unexplained cost analysis completed successfully'
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Unexplained cost analysis failed', {
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
        workspaceId as string
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

      loggingService.info('Cost optimization recommendations retrieval parameters received', {
        requestId,
        userId,
        timeframe,
        workspaceId,
        hasTimeframe: !!timeframe,
        hasWorkspaceId: !!workspaceId
      });

      const analysis = await UnexplainedCostController.service.analyzeUnexplainedCosts(
        userId,
        workspaceId as string,
        timeframe as string
      );
      const duration = Date.now() - startTime;

      const totalPotentialSavings = analysis.optimization_recommendations?.reduce(
        (sum, rec) => sum + rec.potential_savings, 0
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

      loggingService.info('Cost anomalies retrieval parameters received', {
        requestId,
        userId,
        timeframe,
        workspaceId,
        hasTimeframe: !!timeframe,
        hasWorkspaceId: !!workspaceId
      });

      const analysis = await UnexplainedCostController.service.analyzeUnexplainedCosts(
        userId,
        workspaceId as string,
        timeframe as string
      );

      const anomalies = analysis.cost_drivers
        .filter(driver => driver.cost_impact > 0.01) // Filter significant cost drivers
        .map(driver => ({
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
        highSeverityCount: anomalies.filter(a => a.severity === 'high').length,
        mediumSeverityCount: anomalies.filter(a => a.severity === 'medium').length,
        lowSeverityCount: anomalies.filter(a => a.severity === 'low').length
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
          highSeverityCount: anomalies.filter(a => a.severity === 'high').length
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
}

