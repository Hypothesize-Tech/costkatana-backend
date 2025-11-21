import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import * as templateAnalyticsController from '../controllers/templateAnalytics.controller';

const router = Router();

/**
 * @route   GET /api/templates/analytics/overview
 * @desc    Get template usage overview statistics
 * @access  Private
 */
router.get('/overview', authenticate, templateAnalyticsController.getTemplateUsageOverview);

/**
 * @route   GET /api/templates/analytics/template/:templateId
 * @desc    Get detailed breakdown for a specific template
 * @access  Private
 */
router.get('/template/:templateId', authenticate, templateAnalyticsController.getTemplateBreakdown);

/**
 * @route   GET /api/templates/analytics/top
 * @desc    Get top templates by usage
 * @access  Private
 */
router.get('/top', authenticate, templateAnalyticsController.getTopTemplates);

/**
 * @route   GET /api/templates/analytics/cost-savings
 * @desc    Get cost savings report from template usage
 * @access  Private
 */
router.get('/cost-savings', authenticate, templateAnalyticsController.getCostSavingsReport);

/**
 * @route   GET /api/templates/analytics/context/:context
 * @desc    Get templates by context (chat, optimization, visual-compliance, workflow, api)
 * @access  Private
 */
router.get('/context/:context', authenticate, templateAnalyticsController.getTemplatesByContext);

export default router;

