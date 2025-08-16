import { Router } from 'express';
import { CKQLController } from '../controllers/ckql.controller';
import { authenticate } from '../middleware/auth.middleware';
import { rateLimitMiddleware } from '../middleware/rateLimit.middleware';

const router = Router();

// Apply authentication to all routes
router.use(authenticate);

// Apply rate limiting for AI-powered endpoints
const aiRateLimit = rateLimitMiddleware({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 30, // 30 requests per minute for AI queries
  message: 'Too many AI queries, please try again later'
});

// CKQL Query Execution
router.post('/query', aiRateLimit, CKQLController.executeQuery);

// Query Suggestions
router.get('/suggestions', CKQLController.getSuggestions);

// Example Queries
router.get('/examples', CKQLController.getExampleQueries);

// Vectorization Management
router.post('/vectorization/start', CKQLController.startVectorization);
router.get('/vectorization/status', CKQLController.getVectorizationStatus);
router.post('/vectorization/cancel', CKQLController.cancelVectorization);

// Cost Narratives
router.post('/narratives', CKQLController.getCostNarratives);

export default router;


