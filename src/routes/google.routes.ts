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
router.post('/connections/:id/drive/upload', GoogleController.uploadFile);
router.post('/connections/:id/drive/share/:fileId', GoogleController.shareDriveFile);
router.post('/connections/:id/drive/folder', GoogleController.createDriveFolder);
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
router.post('/connections/:id/calendar/budget-review', GoogleController.createBudgetReviewEvent);
router.post('/connections/:id/calendar/events', GoogleController.createEvent);
router.get('/connections/:id/calendar/events', GoogleController.listEvents);
router.patch('/connections/:id/calendar/events/:eventId', GoogleController.updateEvent);
router.delete('/connections/:id/calendar/events/:eventId', GoogleController.deleteEvent);

// Gmail
router.get('/connections/:id/gmail/alerts', GoogleController.getGmailAlerts);
router.post('/connections/:id/gmail/send', GoogleController.sendEmail);
router.get('/connections/:id/gmail/search', GoogleController.searchEmails);
router.get('/gmail/inbox', GoogleController.getGmailInbox);
router.get('/gmail/:messageId', GoogleController.getGmailMessage);

// Sheets
router.post('/connections/:id/sheets', GoogleController.createSpreadsheet);

// Docs
router.post('/connections/:id/docs', GoogleController.createDocument);

// List APIs
router.get('/docs/list', GoogleController.listDocuments);
router.get('/sheets/list', GoogleController.listSpreadsheets);

// Gemini AI Intelligence
router.post('/gemini/analyze', GoogleController.analyzeCostTrends);
router.post('/gemini/explain-anomaly', GoogleController.explainCostAnomaly);
router.post('/gemini/suggest-strategy', GoogleController.generateOptimizationStrategy);

export default router;

