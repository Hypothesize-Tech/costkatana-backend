import { Router } from 'express';
import { TelemetryController } from '../controllers/telemetry.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Health check (no auth required for monitoring tools)
router.get('/health', TelemetryController.checkTelemetryHealth);

// Protected routes
router.use(authenticate);

// Dashboard endpoint
router.get('/dashboard', TelemetryController.getDashboard);

// Query telemetry data
router.get('/', TelemetryController.getTelemetry);

// Get trace details
router.get('/traces/:traceId', TelemetryController.getTraceDetails);

// Get performance metrics
router.get('/metrics', TelemetryController.getMetrics);

// Get service dependencies
router.get('/dependencies', TelemetryController.getServiceDependencies);

export default router;