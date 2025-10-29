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
    getDocumentPreview,
    getUploadProgress
} from '../controllers/ingestion.controller';

const router = Router();

// Handle CORS preflight requests BEFORE authentication
// This must come before router.use(authenticate) to work properly
router.options('*', (req, res) => {
    // Get origin from request or use default
    const origin = req.headers.origin || 'http://localhost:3000';
    
    // Must use specific origin when credentials are true (cannot use '*')
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, User-Agent, Accept, Cache-Control, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
    res.status(204).end();
});

// All other routes require authentication
router.use(authenticate);

// Manual ingestion trigger (could add admin check middleware here)
router.post('/trigger', triggerIngestion);

// Upload custom document (expects base64 encoded file in body)
router.post('/upload', uploadDocument);

// SSE endpoint for upload progress tracking
router.get('/upload-progress/:uploadId', getUploadProgress);

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

