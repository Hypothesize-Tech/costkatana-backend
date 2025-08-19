import { Router } from 'express';
import { UnexplainedCostController } from '../controllers/unexplainedCost.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticate);

/**
 * @route GET /api/unexplained-costs/analyze
 * @desc Analyze unexplained costs for a specific timeframe
 * @access Private
 */
router.get('/analyze', UnexplainedCostController.analyzeUnexplainedCosts);

/**
 * @route GET /api/unexplained-costs/daily-report
 * @desc Generate daily cost report with explanations
 * @access Private
 */
router.get('/daily-report', UnexplainedCostController.generateDailyCostReport);

/**
 * @route GET /api/unexplained-costs/trace/:traceId
 * @desc Get cost attribution breakdown for a specific trace
 * @access Private
 */
router.get('/trace/:traceId', UnexplainedCostController.getTraceCostAttribution);

/**
 * @route GET /api/unexplained-costs/recommendations
 * @desc Get cost optimization recommendations
 * @access Private
 */
router.get('/recommendations', UnexplainedCostController.getCostOptimizationRecommendations);

/**
 * @route GET /api/unexplained-costs/anomalies
 * @desc Get cost anomaly alerts
 * @access Private
 */
router.get('/anomalies', UnexplainedCostController.getCostAnomalies);

/**
 * @route GET /api/unexplained-costs/trends
 * @desc Get historical cost trends and patterns
 * @access Private
 */
router.get('/trends', UnexplainedCostController.getCostTrends);

export default router;



