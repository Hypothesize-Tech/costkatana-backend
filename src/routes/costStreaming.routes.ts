/**
 * Cost Streaming Routes
 * 
 * Provides SSE endpoints for real-time cost telemetry streaming
 */

import { Router, Request, Response } from 'express';
import { costStreamingService, CostTelemetryEvent } from '../services/costStreaming.service';
import { loggingService } from '../services/logging.service';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

/**
 * SSE endpoint for cost telemetry streaming
 * GET /api/cost-streaming/stream
 */
router.get('/stream', (req: Request, res: Response) => {
  try {
    const clientId = uuidv4();
    const userId = (req as { user?: { id?: string } }).user?.id || (req.query.userId as string | undefined);
    const workspaceId = req.query.workspaceId as string | undefined;

    // Parse filters from query parameters
    const filters: {
      eventTypes?: string[];
      minCost?: number;
      operations?: string[];
    } = {};
    
    if (req.query.eventTypes) {
      filters.eventTypes = (req.query.eventTypes as string).split(',');
    }
    
    if (req.query.minCost) {
      filters.minCost = parseFloat(req.query.minCost as string);
    }
    
    if (req.query.operations) {
      filters.operations = (req.query.operations as string).split(',');
    }

    // Register client for streaming
    costStreamingService.registerClient(
      clientId,
      res,
      userId,
      workspaceId,
      Object.keys(filters).length > 0 ? filters : undefined
    );

    loggingService.info('Cost streaming client connected', {
      clientId,
      userId,
      workspaceId,
      filters
    });
  } catch (error) {
    loggingService.error('Failed to initiate cost streaming', {
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      success: false,
      error: 'Failed to initiate streaming connection'
    });
  }
});

/**
 * Get streaming statistics
 * GET /api/cost-streaming/stats
 */
router.get("/stats", (_req: Request, res: Response) => {
  try {
    const stats = costStreamingService.getStats();
    
    res.json({
      success: true,
      data: {
        activeClients: stats.activeClients,
        clientsByUser: Object.fromEntries(stats.clientsByUser),
        clientsByWorkspace: Object.fromEntries(stats.clientsByWorkspace),
        bufferedEvents: stats.bufferedEvents,
        oldestConnection: stats.oldestConnection
      }
    });
  } catch (error) {
    loggingService.error('Failed to get streaming stats', {
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve streaming statistics'
    });
  }
});

/**
 * Test endpoint to emit a sample cost event
 * POST /api/cost-streaming/test-event
 */
router.post('/test-event', (req: Request, res: Response) => {
  try {
    const body = req.body as {
      eventType?: string;
      userId?: string;
      workspaceId?: string;
      data?: CostTelemetryEvent['data'];
    };

    const event: CostTelemetryEvent = {
      eventType: (body.eventType as CostTelemetryEvent['eventType']) || 'cost_tracked',
      timestamp: new Date(),
      userId: body.userId,
      workspaceId: body.workspaceId,
      data: body.data || {
        model: 'gpt-4',
        cost: 0.03,
        tokens: 1500,
        latency: 1200,
        operation: 'chat.completion'
      }
    };

    costStreamingService.emitCostEvent(event);

    res.json({
      success: true,
      message: 'Test event emitted',
      event
    });
  } catch (error) {
    loggingService.error('Failed to emit test event', {
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      success: false,
      error: 'Failed to emit test event'
    });
  }
});

export default router;

