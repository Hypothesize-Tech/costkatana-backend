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

// Create batch optimization with request fusion
router.post('/batch', asyncHandler(OptimizationController.createBatchOptimization));

// Optimize conversation with context trimming
router.post('/conversation', asyncHandler(OptimizationController.optimizeConversation));

// Get optimization preview (without saving)
router.post('/preview', asyncHandler(OptimizationController.getOptimizationPreview));

// Get optimizations
router.get('/', validateQuery(paginationSchema), asyncHandler(OptimizationController.getOptimizations));

// Get prompts for bulk optimization
router.get('/bulk-prompts', asyncHandler(OptimizationController.getPromptsForBulkOptimization));

// Get optimization summary
router.get('/summary', asyncHandler(OptimizationController.getOptimizationSummary));

// Get optimization configuration
router.get('/config', asyncHandler(OptimizationController.getOptimizationConfig));

// Update optimization configuration
router.put('/config', asyncHandler(OptimizationController.updateOptimizationConfig));

// Get optimization templates
router.get('/templates', asyncHandler(OptimizationController.getOptimizationTemplates));

// Get optimization history
router.get('/history/:promptHash', asyncHandler(OptimizationController.getOptimizationHistory));

// Analyze optimization opportunities
router.get('/opportunities', asyncHandler(OptimizationController.analyzeOpportunities));

// Get optimization network details (lazy load; must be before /:id)
router.get('/:id/network-details', asyncHandler(OptimizationController.getOptimizationNetworkDetails));

// Get single optimization
router.get('/:id', asyncHandler(OptimizationController.getOptimization));

// Apply optimization
router.post('/:id/apply', asyncHandler(OptimizationController.applyOptimization));

// Revert optimization
router.post('/:id/revert', asyncHandler(OptimizationController.revertOptimization));

// Provide feedback
router.post('/:id/feedback', asyncHandler(OptimizationController.provideFeedback));

// Legacy bulk optimize endpoint
router.post('/bulk-legacy', asyncHandler(OptimizationController.bulkOptimize));

// 🎯 Cortex cache management endpoints
router.get('/cortex/cache/stats', asyncHandler(OptimizationController.getCortexCacheStats));
router.delete('/cortex/cache', asyncHandler(OptimizationController.clearCortexCache));


export default router;