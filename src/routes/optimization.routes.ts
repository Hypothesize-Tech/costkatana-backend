import { Router } from 'express';
import { OptimizationController } from '../controllers/optimization.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validate, validateQuery } from '../middleware/validation.middleware';
import { optimizationRequestSchema, paginationSchema } from '../utils/validators';
import { asyncHandler } from '../middleware/error.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Create optimization
router.post('/', validate(optimizationRequestSchema), asyncHandler(OptimizationController.createOptimization));

// Get optimizations
router.get('/', validateQuery(paginationSchema), asyncHandler(OptimizationController.getOptimizations));

// Get optimization summary
router.get('/summary', asyncHandler(OptimizationController.getOptimizationSummary));

// Analyze optimization opportunities
router.get('/opportunities', asyncHandler(OptimizationController.analyzeOpportunities));

// Get single optimization
router.get('/:id', asyncHandler(OptimizationController.getOptimization));

// Apply optimization
router.post('/:id/apply', asyncHandler(OptimizationController.applyOptimization));

// Provide feedback
router.post('/:id/feedback', asyncHandler(OptimizationController.provideFeedback));

// Bulk optimize
router.post('/bulk', asyncHandler(OptimizationController.bulkOptimize));

export default router;