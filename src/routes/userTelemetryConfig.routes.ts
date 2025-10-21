import express from 'express';
import { authenticate } from '../middleware/auth.middleware';
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
router.use(authenticate);

/**
 * @route   GET /api/telemetry-config
 * @desc    Get all telemetry configurations for the authenticated user
 * @access  Private
 */
router.get('/', (req, res) => void getUserTelemetryConfigs(req, res));

/**
 * @route   GET /api/telemetry-config/:configId
 * @desc    Get a specific telemetry configuration
 * @access  Private
 */
router.get('/:configId', (req, res) => void getTelemetryConfig(req, res));

/**
 * @route   POST /api/telemetry-config/test
 * @desc    Test connectivity to a telemetry endpoint
 * @access  Private
 * @body    { endpointType, endpoint, authToken? }
 */
router.post('/test', (req, res) => void testTelemetryEndpoint(req, res));

/**
 * @route   POST /api/telemetry-config
 * @desc    Create a new telemetry configuration
 * @access  Private
 * @body    { endpointType, endpoint, authType?, authToken?, syncIntervalMinutes? }
 */
router.post('/', (req, res) => void createTelemetryConfig(req, res));

/**
 * @route   PUT /api/telemetry-config/:configId
 * @desc    Update a telemetry configuration
 * @access  Private
 * @body    { endpoint?, authToken?, syncIntervalMinutes?, isActive? }
 */
router.put('/:configId', (req, res) => void updateTelemetryConfig(req, res));

/**
 * @route   DELETE /api/telemetry-config/:configId
 * @desc    Delete a telemetry configuration (soft delete)
 * @access  Private
 */
router.delete('/:configId', (req, res) => void deleteTelemetryConfig(req, res));

/**
 * @route   POST /api/telemetry-config/:configId/sync
 * @desc    Trigger a manual sync for a specific configuration
 * @access  Private
 */
router.post('/:configId/sync', (req, res) => void triggerManualSync(req, res));

export default router;

