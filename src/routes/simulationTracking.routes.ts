import { Router } from 'express';
import { SimulationTrackingController } from '../controllers/simulationTracking.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticate);

// Track a new simulation
router.post('/track', SimulationTrackingController.trackSimulation);

// Track optimization application
router.post('/:trackingId/apply', SimulationTrackingController.trackOptimizationApplication);

// Update viewing metrics
router.put('/:trackingId/metrics', SimulationTrackingController.updateViewingMetrics);

// Get simulation statistics
router.get('/stats', SimulationTrackingController.getSimulationStats);

// Get top optimization wins leaderboard
router.get('/leaderboard', SimulationTrackingController.getTopOptimizationWins);

// Get user simulation history
router.get('/history', SimulationTrackingController.getUserSimulationHistory);

export default router;