import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { AICostTrackerService } from '../services/aiCostTracker.service';
import { UsageService } from '../services/usage.service';
import { logger } from '../utils/logger';

const router = Router();

// Get AI Cost Tracker analytics
router.get('/analytics', authenticate, async (req, res, next) => {
    try {
        const { startDate, endDate } = req.query;
        const userId = (req as any).user.id;

        const analytics = await AICostTrackerService.getAnalytics(
            startDate ? new Date(startDate as string) : undefined,
            endDate ? new Date(endDate as string) : undefined,
            userId
        );

        res.json({
            success: true,
            data: analytics
        });
    } catch (error) {
        next(error);
    }
});

// Get optimization suggestions from AI Cost Tracker
router.get('/suggestions', authenticate, async (req, res, next) => {
    try {
        const { startDate, endDate } = req.query;
        const userId = (req as any).user.id;
        const suggestions = await AICostTrackerService.getOptimizationSuggestions(
            startDate ? new Date(startDate as string) : undefined,
            endDate ? new Date(endDate as string) : undefined,
            userId
        );

        res.json({
            success: true,
            data: suggestions
        });
    } catch (error) {
        next(error);
    }
});

// Make a tracked AI request
router.post('/request', authenticate, async (req, res, next) => {
    try {
        const { model, prompt, maxTokens, temperature } = req.body;
        const userId = (req as any).user.id;

        const response = await AICostTrackerService.makeTrackedRequest(
            {
                model,
                messages: [{ role: 'user', content: prompt }],
                maxTokens,
                temperature
            },
            userId,
            {
                source: 'api',
                ip: req.ip,
                userAgent: req.headers['user-agent']
            }
        );

        res.json({
            success: true,
            data: response
        });
    } catch (error) {
        next(error);
    }
});

// Sync historical data
router.post('/sync', authenticate, async (req, res, next) => {
    try {
        const { days = 30 } = req.body;
        const userId = (req as any).user.id;

        // Run sync in background
        UsageService.syncHistoricalData(userId, days).catch((err: any) => {
            logger.error('Background sync failed:', err);
        });

        res.json({
            success: true,
            message: 'Historical data sync started'
        });
    } catch (error) {
        next(error);
    }
});

export const trackerRouter = router; 