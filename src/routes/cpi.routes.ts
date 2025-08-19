/**
 * CPI Routes
 * API routes for Cost-Performance Index system
 */

import { Router } from 'express';
import { CPIController } from '../controllers/cpi.controller';
import { authenticate } from '../middleware/auth.middleware';
import { rateLimit } from 'express-rate-limit';

const router = Router();

// Rate limiting for CPI endpoints
const cpiRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: {
        success: false,
        error: 'Too many requests from this IP, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Apply rate limiting to all CPI routes
router.use(cpiRateLimit);

// Health check endpoint (no auth required)
router.get('/health', CPIController.healthCheck);

// Protected routes (require authentication)
router.use(authenticate);

/**
 * @route POST /api/cpi/metrics
 * @desc Calculate CPI metrics for a specific provider and model
 * @access Private
 */
router.post('/metrics', CPIController.calculateCPIMetrics);

/**
 * @route POST /api/cpi/routing
 * @desc Get intelligent routing decision for a request
 * @access Private
 */
router.post('/routing', CPIController.getRoutingDecision);

/**
 * @route POST /api/cpi/compare
 * @desc Compare CPI scores across multiple providers and models
 * @access Private
 */
router.post('/compare', CPIController.compareProviders);

/**
 * @route GET /api/cpi/recommendations
 * @desc Get optimization recommendations based on usage patterns
 * @access Private
 */
router.get('/recommendations', CPIController.getOptimizationRecommendations);

/**
 * @route GET /api/cpi/analytics
 * @desc Get CPI analytics and insights
 * @access Private
 */
router.get('/analytics', CPIController.getCPIAnalytics);

/**
 * @route POST /api/cpi/cache/clear
 * @desc Clear CPI service caches
 * @access Private (Admin only in production)
 */
router.post('/cache/clear', CPIController.clearCache);

export default router;
