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
router.get('/connections/:connectionId/drive', GoogleController.listDriveFiles);
router.get('/connections/:connectionId/drive/:fileId', GoogleController.getDriveFile);
router.post('/connections/:connectionId/drive/upload', GoogleController.uploadFile);
router.post('/connections/:connectionId/drive/share/:fileId', GoogleController.shareDriveFile);
router.post('/connections/:connectionId/drive/folder', GoogleController.createDriveFolder);
router.get('/drive/files', GoogleController.listDriveFiles);
router.get('/drive/file/:fileId/preview', GoogleController.getDriveFilePreview);

// Export
router.post('/export/cost-data', GoogleController.exportCostData);
router.post('/export/report', GoogleController.createCostReport);
router.get('/export/audits', GoogleController.getExportAudits);

// Sheets & Docs Read APIs
router.get('/sheets/:sheetId/data', GoogleController.getSheetData);
router.get('/docs/:docId/content', GoogleController.getDocContent);

// Calendar
router.post('/connections/:connectionId/calendar/budget-review', GoogleController.createBudgetReviewEvent);
router.get('/connections/:connectionId/calendar/events', GoogleController.listEvents);
router.patch('/connections/:connectionId/calendar/events/:eventId', GoogleController.updateEvent);
router.delete('/connections/:connectionId/calendar/events/:eventId', GoogleController.deleteEvent);

// Gmail
router.get('/connections/:connectionId/gmail/alerts', GoogleController.getGmailAlerts);
router.post('/connections/:connectionId/gmail/send', GoogleController.sendEmail);
router.get('/connections/:connectionId/gmail/search', GoogleController.searchEmails);
router.get('/gmail/inbox', GoogleController.getGmailInbox);
router.get('/gmail/:messageId', GoogleController.getGmailMessage);

// Slides
router.post('/connections/:connectionId/slides/qbr', GoogleController.createQBRSlides);
router.post('/connections/:connectionId/slides/:presentationId/export', GoogleController.exportPresentationPDF);
router.get('/slides/:presentationId/thumbnails', GoogleController.getSlideThumbnails);

// Forms
router.post('/connections/:connectionId/forms/create', GoogleController.createFeedbackForm);
router.get('/connections/:connectionId/forms/:formId/responses', GoogleController.getFormResponses);
router.post('/connections/:connectionId/forms/:formId/question', GoogleController.addQuestion);
router.get('/forms/:formId/responses', GoogleController.getFormResponsesAlt);

// Gemini AI Intelligence
router.post('/gemini/analyze', GoogleController.analyzeCostTrends);
router.post('/gemini/explain-anomaly', GoogleController.explainCostAnomaly);
router.post('/gemini/suggest-strategy', GoogleController.generateOptimizationStrategy);

export default router;

