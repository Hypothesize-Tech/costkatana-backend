import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
    triggerIngestion,
    uploadDocument,
    getJobStatus,
    getStats,
    listDocuments,
    deleteDocument,
    reindexAll,
    getUserDocuments,
    getDocumentPreview
} from '../controllers/ingestion.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Manual ingestion trigger (could add admin check middleware here)
router.post('/trigger', triggerIngestion);

// Upload custom document (expects base64 encoded file in body)
router.post('/upload', uploadDocument);

// Get ingestion job status
router.get('/status/:jobId', getJobStatus);

// Get ingestion statistics
router.get('/stats', getStats);

// List user's documents
router.get('/documents', listDocuments);

// Get user's uploaded documents with metadata (for chat)
router.get('/user-documents', getUserDocuments);

// Get document preview
router.get('/documents/:documentId/preview', getDocumentPreview);

// Delete document
router.delete('/documents/:id', deleteDocument);

// Reindex all (admin only - could add admin middleware)
router.post('/reindex', reindexAll);

export default router;

