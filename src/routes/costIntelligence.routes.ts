/**
 * Cost Intelligence Routes
 * 
 * Endpoints for accessing cost intelligence insights and recommendations
 */

import { Router, Request, Response } from 'express';
import { costIntelligenceService } from '../services/costIntelligence.service';
import { loggingService } from '../services/logging.service';

const router = Router();

/**
 * Get recent cost intelligence insights
 * GET /api/cost-intelligence/insights
 */
router.get('/insights', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || req.query.userId as string;
    const workspaceId = req.query.workspaceId as string;
    const type = req.query.type as any;
    const severity = req.query.severity as any;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;

    const insights = costIntelligenceService.getRecentIntelligence({
      userId,
      workspaceId,
      type,
      severity,
      limit
    });

    res.json({
      success: true,
      data: {
        insights,
        count: insights.length
      }
    });
  } catch (error) {
    loggingService.error('Failed to get cost intelligence insights', {
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve cost intelligence insights'
    });
  }
});

/**
 * Get cost intelligence statistics
 * GET /api/cost-intelligence/stats
 */
router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const stats = costIntelligenceService.getStats();

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    loggingService.error('Failed to get cost intelligence stats', {
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve cost intelligence statistics'
    });
  }
});

/**
 * Start continuous analysis
 * POST /api/cost-intelligence/analysis/start
 */
router.post("/analysis/start", async (_req: Request, res: Response) => {
  try {
    costIntelligenceService.startContinuousAnalysis();

    res.json({
      success: true,
      message: 'Continuous cost intelligence analysis started'
    });
  } catch (error) {
    loggingService.error('Failed to start cost intelligence analysis', {
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      success: false,
      error: 'Failed to start continuous analysis'
    });
  }
});

/**
 * Stop continuous analysis
 * POST /api/cost-intelligence/analysis/stop
 */
router.post("/analysis/stop", async (_req: Request, res: Response) => {
  try {
    costIntelligenceService.stopContinuousAnalysis();

    res.json({
      success: true,
      message: 'Continuous cost intelligence analysis stopped'
    });
  } catch (error) {
    loggingService.error('Failed to stop cost intelligence analysis', {
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      success: false,
      error: 'Failed to stop continuous analysis'
    });
  }
});

export default router;

