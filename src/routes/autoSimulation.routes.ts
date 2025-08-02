import { Router } from 'express';
import { AutoSimulationController } from '../controllers/autoSimulation.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticate);

// Get user's auto-simulation settings
router.get('/settings', AutoSimulationController.getUserSettings);

// Update user's auto-simulation settings
router.put('/settings', AutoSimulationController.updateUserSettings);

// Get user's simulation queue
router.get('/queue', AutoSimulationController.getUserQueue);

// Handle optimization approval/rejection
router.post('/queue/:queueItemId/approve', AutoSimulationController.handleOptimizationApproval);

// Manually trigger simulation for a usage
router.post('/trigger/:usageId', AutoSimulationController.triggerSimulation);

// Process queue manually (could be restricted to admin)
router.post('/process-queue', AutoSimulationController.processQueue);

export default router;