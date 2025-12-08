import { Router } from 'express';
import { GoogleController } from '../controllers/google.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// OAuth & Connection Management
router.get('/auth', GoogleController.initiateOAuth);
router.get('/connections', GoogleController.listConnections);
router.get('/connections/:id', GoogleController.getConnection);
router.delete('/connections/:id', GoogleController.disconnectConnection);
router.get('/connections/:id/health', GoogleController.checkConnectionHealth);

// Drive
router.get('/connections/:id/drive', GoogleController.listDriveFiles);
router.get('/connections/:id/drive/:fileId', GoogleController.getDriveFile);

// Export
router.post('/export/cost-data', GoogleController.exportCostData);
router.post('/export/report', GoogleController.createCostReport);
router.get('/export/audits', GoogleController.getExportAudits);

// Calendar
router.post('/connections/:id/calendar/budget-review', GoogleController.createBudgetReviewEvent);

// Gmail
router.get('/connections/:id/gmail/alerts', GoogleController.getGmailAlerts);

// Slides
router.post('/connections/:id/slides/qbr', GoogleController.createQBRSlides);

// Forms
router.post('/connections/:id/forms/create', GoogleController.createFeedbackForm);
router.get('/connections/:id/forms/:formId/responses', GoogleController.getFormResponses);

// Gemini AI Intelligence
router.post('/gemini/analyze', GoogleController.analyzeCostTrends);
router.post('/gemini/explain-anomaly', GoogleController.explainCostAnomaly);
router.post('/gemini/suggest-strategy', GoogleController.generateOptimizationStrategy);

export default router;

