import express from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';
import {
    getUserTelemetryConfigs,
    getTelemetryConfig,
    createTelemetryConfig,
    updateTelemetryConfig,
    deleteTelemetryConfig,
    testTelemetryEndpoint,
    triggerManualSync
} from '../controllers/userTelemetryConfig.controller';

const router = express.Router();

// All routes require authentication
router.use(authenticate as express.RequestHandler);

/**
 * @route   GET /api/telemetry-config
 * @desc    Get all telemetry configurations for the authenticated user
 * @access  Private
 */
router.get('/', asyncHandler(getUserTelemetryConfigs));

/**
 * @route   GET /api/telemetry-config/:configId
 * @desc    Get a specific telemetry configuration
 * @access  Private
 */
router.get('/:configId', asyncHandler(getTelemetryConfig));

/**
 * @route   POST /api/telemetry-config/test
 * @desc    Test connectivity to a telemetry endpoint
 * @access  Private
 * @body    { endpointType, endpoint, authToken? }
 */
router.post('/test', asyncHandler(testTelemetryEndpoint));

/**
 * @route   POST /api/telemetry-config
 * @desc    Create a new telemetry configuration
 * @access  Private
 * @body    { endpointType, endpoint, authType?, authToken?, syncIntervalMinutes? }
 */
router.post('/', asyncHandler(createTelemetryConfig));

/**
 * @route   PUT /api/telemetry-config/:configId
 * @desc    Update a telemetry configuration
 * @access  Private
 * @body    { endpoint?, authToken?, syncIntervalMinutes?, isActive? }
 */
router.put('/:configId', asyncHandler(updateTelemetryConfig));

/**
 * @route   DELETE /api/telemetry-config/:configId
 * @desc    Delete a telemetry configuration (soft delete)
 * @access  Private
 */
router.delete('/:configId', asyncHandler(deleteTelemetryConfig));

/**
 * @route   POST /api/telemetry-config/:configId/sync
 * @desc    Trigger a manual sync for a specific configuration
 * @access  Private
 */
router.post('/:configId/sync', asyncHandler(triggerManualSync));

export default router;

