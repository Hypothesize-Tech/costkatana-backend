import { Response } from 'express';
import { UnexplainedCostService } from '../services/unexplainedCost.service';
import { logger } from '../utils/logger';

export class UnexplainedCostController {
  private static service = UnexplainedCostService.getInstance();

  /**
   * Analyze unexplained costs for a specific timeframe
   * GET /api/unexplained-costs/analyze
   */
  static async analyzeUnexplainedCosts(req: any, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const { timeframe = '24h', workspaceId = 'default' } = req.query;

      const analysis = await UnexplainedCostController.service.analyzeUnexplainedCosts(
        userId,
        workspaceId as string,
        timeframe as string
      );

      res.json({
        success: true,
        data: analysis,
        message: 'Unexplained cost analysis completed successfully'
      });
    } catch (error) {
      logger.error('Failed to analyze unexplained costs:', error);
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
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const { date, workspaceId = 'default' } = req.query;
      const reportDate = date ? (date as string) : new Date().toISOString().split('T')[0];

      const report = await UnexplainedCostController.service.generateDailyCostReport(
        userId,
        workspaceId as string,
        reportDate
      );

      res.json({
        success: true,
        data: report,
        message: 'Daily cost report generated successfully'
      });
    } catch (error) {
      logger.error('Failed to generate daily cost report:', error);
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
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const { traceId } = req.params;
      const { workspaceId = 'default' } = req.query;

      const traceData = await UnexplainedCostController.service.getTraceCostAttribution(
        userId,
        traceId,
        workspaceId as string
      );

      res.json({
        success: true,
        data: traceData,
        message: 'Trace cost attribution retrieved successfully'
      });
    } catch (error) {
      logger.error('Failed to get trace cost attribution:', error);
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
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const { timeframe = '7d', workspaceId = 'default' } = req.query;

      const analysis = await UnexplainedCostController.service.analyzeUnexplainedCosts(
        userId,
        workspaceId as string,
        timeframe as string
      );

      res.json({
        success: true,
        data: {
          recommendations: analysis.optimization_recommendations,
          total_potential_savings: analysis.optimization_recommendations.reduce(
            (sum, rec) => sum + rec.potential_savings, 0
          ),
          timeframe: timeframe,
          cost_drivers: analysis.cost_drivers
        },
        message: 'Cost optimization recommendations retrieved successfully'
      });
    } catch (error) {
      logger.error('Failed to get cost optimization recommendations:', error);
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
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const { timeframe = '24h', workspaceId = 'default' } = req.query;

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
    } catch (error) {
      logger.error('Failed to get cost anomalies:', error);
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
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const { period = '30d', workspaceId = 'default' } = req.query;

      const trendsData = await UnexplainedCostController.service.getCostTrends(
        userId,
        period as string,
        workspaceId as string
      );

      res.json({
        success: true,
        data: trendsData,
        message: 'Cost trends retrieved successfully'
      });
    } catch (error) {
      logger.error('Failed to get cost trends:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get cost trends',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

