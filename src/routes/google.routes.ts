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
// Removed uploadFile, shareDriveFile, createDriveFolder - not compatible with drive.file scope
router.get('/drive/files', GoogleController.listDriveFiles);
// Removed getDriveFilePreview - requires full drive access

// Export to NEW files (works with drive.file scope)
router.post('/export/cost-data', GoogleController.exportCostData);
router.post('/export/report', GoogleController.createCostReport);
router.get('/export/audits', GoogleController.getExportAudits);

// Sheets & Docs Read APIs (for user-selected files via Picker)
// Removed getSheetData, getDocContent - will be handled differently
router.get('/docs/:docId/content', GoogleController.getDocumentContent);

// Sheets & Docs Creation (creates NEW files with drive.file scope)
router.post('/connections/:id/sheets', GoogleController.createSpreadsheet);
router.post('/connections/:id/docs', GoogleController.createDocument);

// List user-accessible Docs/Sheets (via Picker selections cached)
router.get('/connections/:id/documents', GoogleController.listDocuments);
router.get('/connections/:id/spreadsheets', GoogleController.listSpreadsheets);

// Backward compatibility routes for frontend
router.get('/docs/list', GoogleController.listDocuments);
router.get('/sheets/list', GoogleController.listSpreadsheets);

// Gemini AI Intelligence
router.post('/gemini/analyze', GoogleController.analyzeCostTrends);
router.post('/gemini/explain-anomaly', GoogleController.explainCostAnomaly);
router.post('/gemini/suggest-strategy', GoogleController.generateOptimizationStrategy);

// File Access Cache (for Picker API integration and Drive link access)
router.post('/file-from-link', GoogleController.getFileFromLink);
router.get('/file-access/check/:fileId', GoogleController.checkFileAccess);

export default router;

