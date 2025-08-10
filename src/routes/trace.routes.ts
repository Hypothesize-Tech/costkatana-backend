import { Router } from 'express';
import { traceController } from '../controllers/trace.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Session endpoints
router.get('/sessions', authenticate, traceController.listSessions);
router.get('/sessions/summary', authenticate, traceController.getSessionsSummary);
router.get('/sessions/:id/graph', authenticate, traceController.getSessionGraph);
router.get('/sessions/:id/details', authenticate, traceController.getSessionDetails);
router.post('/sessions/:id/end', authenticate, traceController.endSession);

// Trace endpoints
router.post('/traces/ingest', authenticate, traceController.ingestTrace);

export default router;
