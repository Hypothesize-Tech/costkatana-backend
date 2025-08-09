import { Router } from 'express';
import { PredictiveIntelligenceController } from '../controllers/predictiveIntelligence.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticate);

/**
 * @swagger
 * /api/predictive-intelligence:
 *   get:
 *     summary: Get comprehensive predictive intelligence analysis
 *     description: Generate predictive cost intelligence with forecasting, alerts, and optimization recommendations
 *     tags: [Predictive Intelligence]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: scope
 *         schema:
 *           type: string
 *           enum: [user, project, team]
 *           default: user
 *         description: Scope of analysis
 *       - in: query
 *         name: scopeId
 *         schema:
 *           type: string
 *         description: ID for project or team scope (required for project/team scope)
 *       - in: query
 *         name: timeHorizon
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 365
 *           default: 30
 *         description: Analysis time horizon in days
 *       - in: query
 *         name: includeScenarios
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include scenario simulations
 *       - in: query
 *         name: includeCrossPlatform
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include cross-platform insights
 *     responses:
 *       200:
 *         description: Predictive intelligence data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/PredictiveIntelligenceData'
 *                 message:
 *                   type: string
 *       401:
 *         description: Authentication required
 *       400:
 *         description: Invalid parameters
 *       500:
 *         description: Internal server error
 */
router.get('/', PredictiveIntelligenceController.getPredictiveIntelligence);

/**
 * @swagger
 * /api/predictive-intelligence/dashboard:
 *   get:
 *     summary: Get predictive intelligence dashboard summary
 *     description: Executive summary of predictive intelligence for dashboard display
 *     tags: [Predictive Intelligence]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: scope
 *         schema:
 *           type: string
 *           enum: [user, project, team]
 *           default: user
 *         description: Scope of analysis
 *       - in: query
 *         name: scopeId
 *         schema:
 *           type: string
 *         description: ID for project or team scope
 *     responses:
 *       200:
 *         description: Dashboard summary retrieved successfully
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Internal server error
 */
router.get('/dashboard', PredictiveIntelligenceController.getDashboardSummary);

/**
 * @swagger
 * /api/predictive-intelligence/alerts:
 *   get:
 *     summary: Get proactive cost alerts
 *     description: Retrieve proactive alerts about upcoming cost issues and opportunities
 *     tags: [Predictive Intelligence]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: scope
 *         schema:
 *           type: string
 *           enum: [user, project, team]
 *           default: user
 *         description: Scope of analysis
 *       - in: query
 *         name: scopeId
 *         schema:
 *           type: string
 *         description: ID for project or team scope
 *       - in: query
 *         name: severity
 *         schema:
 *           type: string
 *           enum: [low, medium, high, critical]
 *         description: Filter by alert severity
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Maximum number of alerts to return
 *     responses:
 *       200:
 *         description: Proactive alerts retrieved successfully
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Internal server error
 */
router.get('/alerts', PredictiveIntelligenceController.getProactiveAlerts);

/**
 * @swagger
 * /api/predictive-intelligence/budget-projections:
 *   get:
 *     summary: Get budget exceedance projections
 *     description: Predict when and by how much budgets will be exceeded
 *     tags: [Predictive Intelligence]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: scope
 *         schema:
 *           type: string
 *           enum: [user, project, team]
 *           default: user
 *         description: Scope of analysis
 *       - in: query
 *         name: scopeId
 *         schema:
 *           type: string
 *         description: ID for project or team scope
 *       - in: query
 *         name: daysAhead
 *         schema:
 *           type: integer
 *           default: 30
 *         description: Days to project ahead
 *     responses:
 *       200:
 *         description: Budget projections retrieved successfully
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Internal server error
 */
router.get('/budget-projections', PredictiveIntelligenceController.getBudgetProjections);

/**
 * @swagger
 * /api/predictive-intelligence/optimizations:
 *   get:
 *     summary: Get intelligent optimization recommendations
 *     description: AI-powered optimization recommendations with detailed implementation steps
 *     tags: [Predictive Intelligence]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: scope
 *         schema:
 *           type: string
 *           enum: [user, project, team]
 *           default: user
 *         description: Scope of analysis
 *       - in: query
 *         name: scopeId
 *         schema:
 *           type: string
 *         description: ID for project or team scope
 *       - in: query
 *         name: minSavings
 *         schema:
 *           type: number
 *           default: 50
 *         description: Minimum savings threshold
 *       - in: query
 *         name: difficulty
 *         schema:
 *           type: string
 *           enum: [easy, medium, hard]
 *         description: Filter by implementation difficulty
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [model_switch, prompt_optimization, caching, batch_processing, parameter_tuning]
 *         description: Filter by optimization type
 *     responses:
 *       200:
 *         description: Intelligence optimizations retrieved successfully
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Internal server error
 */
router.get('/optimizations', PredictiveIntelligenceController.getIntelligentOptimizations);

/**
 * @swagger
 * /api/predictive-intelligence/scenarios:
 *   get:
 *     summary: Get scenario simulations for cost planning
 *     description: Simulate different cost scenarios for strategic planning
 *     tags: [Predictive Intelligence]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: scope
 *         schema:
 *           type: string
 *           enum: [user, project, team]
 *           default: user
 *         description: Scope of analysis
 *       - in: query
 *         name: scopeId
 *         schema:
 *           type: string
 *         description: ID for project or team scope
 *       - in: query
 *         name: timeHorizon
 *         schema:
 *           type: integer
 *           default: 90
 *         description: Scenario time horizon in days
 *       - in: query
 *         name: timeframe
 *         schema:
 *           type: string
 *           enum: [1_month, 3_months, 6_months, 1_year]
 *         description: Filter by scenario timeframe
 *     responses:
 *       200:
 *         description: Scenario simulations retrieved successfully
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Internal server error
 */
router.get('/scenarios', PredictiveIntelligenceController.getScenarioSimulations);

/**
 * @swagger
 * /api/predictive-intelligence/token-trends:
 *   get:
 *     summary: Get token usage trends and prompt growth analysis
 *     description: Analyze historical token trends and predict future usage patterns
 *     tags: [Predictive Intelligence]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: scope
 *         schema:
 *           type: string
 *           enum: [user, project, team]
 *           default: user
 *         description: Scope of analysis
 *       - in: query
 *         name: scopeId
 *         schema:
 *           type: string
 *         description: ID for project or team scope
 *     responses:
 *       200:
 *         description: Token trends retrieved successfully
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Internal server error
 */
router.get('/token-trends', PredictiveIntelligenceController.getTokenTrends);

/**
 * @swagger
 * /api/predictive-intelligence/model-patterns:
 *   get:
 *     summary: Get model switching patterns and predictions
 *     description: Analyze model usage patterns and predict future model switches
 *     tags: [Predictive Intelligence]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: scope
 *         schema:
 *           type: string
 *           enum: [user, project, team]
 *           default: user
 *         description: Scope of analysis
 *       - in: query
 *         name: scopeId
 *         schema:
 *           type: string
 *         description: ID for project or team scope
 *     responses:
 *       200:
 *         description: Model patterns retrieved successfully
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Internal server error
 */
router.get('/model-patterns', PredictiveIntelligenceController.getModelPatterns);

/**
 * @swagger
 * /api/predictive-intelligence/cross-platform:
 *   get:
 *     summary: Get cross-platform usage insights
 *     description: Analyze usage across different AI platforms and identify consolidation opportunities
 *     tags: [Predictive Intelligence]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: scope
 *         schema:
 *           type: string
 *           enum: [user, project, team]
 *           default: user
 *         description: Scope of analysis
 *       - in: query
 *         name: scopeId
 *         schema:
 *           type: string
 *         description: ID for project or team scope
 *     responses:
 *       200:
 *         description: Cross-platform insights retrieved successfully
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Internal server error
 */
router.get('/cross-platform', PredictiveIntelligenceController.getCrossPlatformInsights);

/**
 * @swagger
 * /api/predictive-intelligence/auto-optimize/{alertId}:
 *   post:
 *     summary: Auto-optimize an alert or optimization opportunity
 *     tags: [Predictive Intelligence]
 *     parameters:
 *       - in: path
 *         name: alertId
 *         required: true
 *         schema:
 *           type: string
 *         description: Alert or optimization ID to auto-implement
 *     responses:
 *       200:
 *         description: Auto-optimization completed successfully
 *       401:
 *         description: Authentication required
 *       404:
 *         description: Alert not found
 *       500:
 *         description: Internal server error
 */
router.post('/auto-optimize/:alertId', PredictiveIntelligenceController.autoOptimize);

export default router;