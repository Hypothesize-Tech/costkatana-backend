import { Router } from 'express';
import { NotebookController } from '../controllers/notebook.controller';
import { authenticate } from '../middleware/auth.middleware';
import { rateLimitMiddleware } from '../middleware/rateLimit.middleware';

const router = Router();

// Apply authentication to all routes
router.use(authenticate);

// Apply rate limiting for AI-powered endpoints
const aiRateLimit = rateLimitMiddleware({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 20, // 20 requests per minute for AI insights
  message: 'Too many AI requests, please try again later'
});

// Notebook Management
router.get('/notebooks', NotebookController.getNotebooks);
router.get('/notebooks/templates', NotebookController.getTemplates);
router.get('/notebooks/:id', NotebookController.getNotebook);
router.post('/notebooks', NotebookController.createNotebook);
router.put('/notebooks/:id', NotebookController.updateNotebook);
router.delete('/notebooks/:id', NotebookController.deleteNotebook);

// Notebook Execution
router.post('/notebooks/:id/execute', aiRateLimit, NotebookController.executeNotebook);
router.get('/executions/:executionId', NotebookController.getExecution);

// AI Insights
router.get('/insights', aiRateLimit, NotebookController.getAIInsights);
router.get('/insights/anomalies', aiRateLimit, NotebookController.getAnomalies);
router.get('/insights/optimizations', aiRateLimit, NotebookController.getOptimizations);
router.get('/insights/forecasts', aiRateLimit, NotebookController.getForecasts);

export default router;

