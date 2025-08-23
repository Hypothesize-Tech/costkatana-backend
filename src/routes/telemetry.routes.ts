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
router.get('/query', TelemetryController.getTelemetry);

// Get trace details
router.get('/traces/:traceId', TelemetryController.getTraceDetails);

// Get performance metrics
router.get('/metrics', TelemetryController.getMetrics);

// Get service dependencies
router.get('/dependencies', TelemetryController.getServiceDependencies);

// Enhanced telemetry endpoints with AI enrichment
router.get('/enrichment/stats', TelemetryController.getEnrichmentStats);
router.get('/enrichment/spans', TelemetryController.getEnrichedSpans);
router.get('/enrichment/health', TelemetryController.getProcessorHealth);
router.get('/enrichment/trigger', TelemetryController.triggerEnrichment);
router.get('/dashboard/enhanced', TelemetryController.getEnhancedDashboard);

export default router;