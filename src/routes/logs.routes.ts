import { Router } from 'express';
import { LogsController } from '../controllers/logs.controller';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';
import { initAILogContext } from '../middleware/aiLogging.middleware';
import rateLimit from 'express-rate-limit';

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

// Rate limiter for AI chat endpoints (30 requests per minute per user)
const chatRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute
    message: 'Too many AI chat requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req as any).user?.id || req.ip || 'anonymous'
});

/**
 * @route POST /api/logs/ai/chat
 * @desc Natural language query for AI logs
 * @access Private (with rate limiting)
 */
router.post(
    '/ai/chat',
    chatRateLimiter,
    asyncHandler(LogsController.naturalLanguageQuery)
);

/**
 * @route GET /api/logs/ai/chat/history
 * @desc Get user's chat history
 * @access Private
 */
router.get('/ai/chat/history', asyncHandler(LogsController.getChatHistory));

/**
 * @route DELETE /api/logs/ai/chat/:conversationId
 * @desc Delete a conversation
 * @access Private
 */
router.delete('/ai/chat/:conversationId', asyncHandler(LogsController.deleteChatConversation));

export default router;

