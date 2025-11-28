import { Router, Request, Response } from 'express';
import { docsAnalyticsService } from '../services/docsAnalytics.service';
import { loggingService } from '../services/logging.service';

const router = Router();

// ==================== RATINGS ====================

/**
 * POST /docs-analytics/ratings
 * Submit a page rating (thumbs up/down, optional star rating)
 */
router.post('/ratings', async (req: Request, res: Response): Promise<void> => {
    try {
        const { pageId, pagePath, rating, starRating, sessionId } = req.body;

        if (!pageId || !pagePath || !rating || !sessionId) {
            res.status(400).json({ error: 'Missing required fields: pageId, pagePath, rating, sessionId' });
            return;
        }

        if (!['up', 'down'].includes(rating)) {
            res.status(400).json({ error: 'Rating must be "up" or "down"' });
            return;
        }

        if (starRating !== undefined && (starRating < 1 || starRating > 5)) {
            res.status(400).json({ error: 'Star rating must be between 1 and 5' });
            return;
        }

        const result = await docsAnalyticsService.submitRating({
            pageId,
            pagePath,
            rating,
            starRating,
            sessionId,
            ip: req.ip,
            userAgent: req.get('user-agent'),
        });

        res.status(201).json({ success: true, data: result });
    } catch (error) {
        loggingService.error('Error submitting rating', { error });
        res.status(500).json({ error: 'Failed to submit rating' });
    }
});

/**
 * GET /docs-analytics/ratings/:pageId
 * Get rating statistics for a page
 */
router.get('/ratings/:pageId', async (req: Request, res: Response): Promise<void> => {
    try {
        const { pageId } = req.params;
        const stats = await docsAnalyticsService.getRatingStats(pageId);
        res.json({ success: true, data: stats });
    } catch (error) {
        loggingService.error('Error getting rating stats', { error });
        res.status(500).json({ error: 'Failed to get rating stats' });
    }
});

// ==================== FEEDBACK ====================

/**
 * POST /docs-analytics/feedback
 * Submit detailed feedback for a page
 */
router.post('/feedback', async (req: Request, res: Response): Promise<void> => {
    try {
        const { pageId, pagePath, feedbackType, message, email, sessionId } = req.body;

        if (!pageId || !pagePath || !feedbackType || !message || !sessionId) {
            res.status(400).json({ error: 'Missing required fields: pageId, pagePath, feedbackType, message, sessionId' });
            return;
        }

        if (!['bug', 'improvement', 'question', 'other'].includes(feedbackType)) {
            res.status(400).json({ error: 'Invalid feedback type' });
            return;
        }

        if (message.length > 2000) {
            res.status(400).json({ error: 'Message too long (max 2000 characters)' });
            return;
        }

        const result = await docsAnalyticsService.submitFeedback({
            pageId,
            pagePath,
            feedbackType,
            message,
            email,
            sessionId,
            ip: req.ip,
            userAgent: req.get('user-agent'),
        });

        res.status(201).json({ success: true, data: result });
    } catch (error) {
        loggingService.error('Error submitting feedback', { error });
        res.status(500).json({ error: 'Failed to submit feedback' });
    }
});

// ==================== PAGE VIEWS ====================

/**
 * POST /docs-analytics/views
 * Track a page view
 */
router.post('/views', async (req: Request, res: Response): Promise<void> => {
    try {
        const { pageId, pagePath, sessionId, referrer, deviceType } = req.body;

        if (!pageId || !pagePath || !sessionId) {
            res.status(400).json({ error: 'Missing required fields: pageId, pagePath, sessionId' });
            return;
        }

        const result = await docsAnalyticsService.trackPageView({
            pageId,
            pagePath,
            sessionId,
            ip: req.ip,
            userAgent: req.get('user-agent'),
            referrer,
            deviceType,
        });

        res.status(201).json({ success: true, data: result });
    } catch (error) {
        loggingService.error('Error tracking page view', { error });
        res.status(500).json({ error: 'Failed to track page view' });
    }
});

/**
 * PATCH /docs-analytics/views
 * Update page view metrics (time on page, scroll depth)
 */
router.patch('/views', async (req: Request, res: Response): Promise<void> => {
    try {
        const { pageId, sessionId, timeOnPage, scrollDepth, sectionsViewed } = req.body;

        if (!pageId || !sessionId) {
            res.status(400).json({ error: 'Missing required fields: pageId, sessionId' });
            return;
        }

        const result = await docsAnalyticsService.updatePageViewMetrics({
            pageId,
            sessionId,
            timeOnPage,
            scrollDepth,
            sectionsViewed,
        });

        res.json({ success: true, data: result });
    } catch (error) {
        loggingService.error('Error updating page view metrics', { error });
        res.status(500).json({ error: 'Failed to update metrics' });
    }
});

/**
 * GET /docs-analytics/views/:pageId/stats
 * Get view statistics for a page
 */
router.get('/views/:pageId/stats', async (req: Request, res: Response): Promise<void> => {
    try {
        const { pageId } = req.params;
        const stats = await docsAnalyticsService.getPageViewStats(pageId);
        res.json({ success: true, data: stats });
    } catch (error) {
        loggingService.error('Error getting view stats', { error });
        res.status(500).json({ error: 'Failed to get view stats' });
    }
});

// ==================== RECOMMENDATIONS ====================

/**
 * GET /docs-analytics/recommendations
 * Get personalized content recommendations
 */
router.get('/recommendations', async (req: Request, res: Response): Promise<void> => {
    try {
        const sessionId = req.query.sessionId as string;

        if (!sessionId) {
            res.status(400).json({ error: 'Missing sessionId query parameter' });
            return;
        }

        const recommendations = await docsAnalyticsService.getRecommendations(sessionId);
        res.json({ success: true, data: recommendations });
    } catch (error) {
        loggingService.error('Error getting recommendations', { error });
        res.status(500).json({ error: 'Failed to get recommendations' });
    }
});

// ==================== AI SEARCH ====================

/**
 * POST /docs-analytics/ai-search
 * AI-powered semantic search for documentation
 */
router.post('/ai-search', async (req: Request, res: Response): Promise<void> => {
    try {
        const { query } = req.body;

        if (!query || typeof query !== 'string' || query.trim().length === 0) {
            res.status(400).json({ error: 'Missing or invalid query parameter' });
            return;
        }

        if (query.length < 2) {
            res.status(400).json({ error: 'Query must be at least 2 characters long' });
            return;
        }

        const result = await docsAnalyticsService.aiSearch(query.trim());
        res.json({ success: true, data: result });
    } catch (error) {
        loggingService.error('Error performing AI search', { error });
        res.status(500).json({ error: 'Failed to perform AI search' });
    }
});

// ==================== PAGE META ====================

/**
 * GET /docs-analytics/page-meta/:pageId
 * Get page metadata (last updated, views, helpfulness)
 */
router.get('/page-meta/:pageId', async (req: Request, res: Response): Promise<void> => {
    try {
        const { pageId } = req.params;
        const meta = await docsAnalyticsService.getPageMeta(pageId);
        res.json({ success: true, data: meta });
    } catch (error) {
        loggingService.error('Error getting page meta', { error });
        res.status(500).json({ error: 'Failed to get page meta' });
    }
});

// ==================== OVERALL STATS ====================

/**
 * GET /docs-analytics/stats
 * Get overall documentation analytics
 */
router.get('/stats', async (_req: Request, res: Response): Promise<void> => {
    try {
        const stats = await docsAnalyticsService.getOverallStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        loggingService.error('Error getting overall stats', { error });
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

export default router;

