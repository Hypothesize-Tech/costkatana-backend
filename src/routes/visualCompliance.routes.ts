import { Router } from 'express';
import { VisualComplianceController } from '../controllers/visualCompliance.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Single compliance check (ultra-optimized)
router.post('/check-optimized', VisualComplianceController.checkComplianceOptimized);

// Batch compliance checks
router.post('/batch', VisualComplianceController.batchCheck);

// Get available quality presets
router.get('/presets', VisualComplianceController.getPresets);

// Get cost comparison dashboard data
router.get('/cost-comparison', VisualComplianceController.getCostComparison);

// Get meta prompt presets (list)
router.get('/meta-prompt-presets', VisualComplianceController.getMetaPromptPresets);

// Get specific meta prompt preset by ID
router.get('/meta-prompt-presets/:id', VisualComplianceController.getMetaPromptPresetById);

export default router;

