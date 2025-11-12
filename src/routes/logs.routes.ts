import { Router } from 'express';
import { LogsController } from '../controllers/logs.controller';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';
import { initAILogContext } from '../middleware/aiLogging.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Initialize AI log context for all routes
router.use(initAILogContext);

/**
 * @route GET /api/logs/ai
 * @desc Query AI logs with filtering and pagination
 * @access Private (User's own logs + project logs they have access to)
 */
router.get('/ai', asyncHandler(LogsController.queryLogs));

/**
 * @route GET /api/logs/ai/stream
 * @desc Real-time log streaming via SSE
 * @access Private
 */
router.get('/ai/stream', asyncHandler(LogsController.streamLogs));

/**
 * @route GET /api/logs/ai/stats
 * @desc Get aggregated log statistics
 * @access Private
 */
router.get('/ai/stats', asyncHandler(LogsController.getStats));

/**
 * @route GET /api/logs/ai/export
 * @desc Export logs in various formats (JSON, CSV, JSONL)
 * @access Private
 */
router.get('/ai/export', asyncHandler(LogsController.exportLogs));

/**
 * @route GET /api/logs/ai/:logId
 * @desc Get single log entry with full details
 * @access Private
 */
router.get('/ai/:logId', asyncHandler(LogsController.getLogById));

export default router;

