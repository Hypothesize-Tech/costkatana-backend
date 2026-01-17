import express from 'express';
import { ModelDiscoveryController } from '../controllers/modelDiscovery.controller';
import { authenticate } from '../middleware';

const router = express.Router();

/**
 * Model Discovery Routes
 * All routes require authentication (add middleware as needed)
 */
router.use(authenticate);

// Trigger discovery for all providers
router.post('/trigger', ModelDiscoveryController.triggerDiscovery);

// Trigger discovery for specific provider
router.post('/trigger/:provider', ModelDiscoveryController.triggerProviderDiscovery);

// Get discovery job status
router.get('/status', ModelDiscoveryController.getStatus);

// Get all discovered models
router.get('/models', ModelDiscoveryController.getAllModels);

// Get models by provider
router.get('/models/:provider', ModelDiscoveryController.getModelsByProvider);

// Update a model manually
router.put('/models/:modelId', ModelDiscoveryController.updateModel);

// Validate a model
router.post('/validate/:modelId', ModelDiscoveryController.validateModel);

export default router;
