import { Router } from 'express';
import { MemoryController } from '../controllers/memory.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { body, param, query } from 'express-validator';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticate);

/**
 * @route GET /api/memory/:userId/insights
 * @desc Get user memory insights
 * @access Private
 */
router.get(
    '/:userId/insights',
    [
        param('userId').isString().notEmpty().withMessage('Valid user ID is required')
    ],
    validateRequest,
    MemoryController.getMemoryInsights
);

/**
 * @route GET /api/memory/:userId/preferences
 * @desc Get user preferences
 * @access Private
 */
router.get(
    '/:userId/preferences',
    [
        param('userId').isString().notEmpty().withMessage('Valid user ID is required')
    ],
    validateRequest,
    MemoryController.getUserPreferences
);

/**
 * @route PUT /api/memory/:userId/preferences
 * @desc Update user preferences
 * @access Private
 */
router.put(
    '/:userId/preferences',
    [
        param('userId').isString().notEmpty().withMessage('Valid user ID is required'),
        body('preferredModel').optional().isString().withMessage('Preferred model must be a string'),
        body('preferredChatMode').optional().isIn(['fastest', 'cheapest', 'balanced']).withMessage('Invalid chat mode'),
        body('preferredStyle').optional().isString().withMessage('Preferred style must be a string'),
        body('responseLength').optional().isIn(['concise', 'detailed', 'comprehensive']).withMessage('Invalid response length'),
        body('technicalLevel').optional().isIn(['beginner', 'intermediate', 'expert']).withMessage('Invalid technical level'),
        body('commonTopics').optional().isArray().withMessage('Common topics must be an array'),
        body('costPreference').optional().isIn(['cheap', 'balanced', 'premium']).withMessage('Invalid cost preference')
    ],
    validateRequest,
    MemoryController.updateUserPreferences
);

/**
 * @route GET /api/memory/:userId/conversations
 * @desc Get conversation history with memory context
 * @access Private
 */
router.get(
    '/:userId/conversations',
    [
        param('userId').isString().notEmpty().withMessage('Valid user ID is required'),
        query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
        query('page').optional().isInt({ min: 1 }).withMessage('Page must be at least 1'),
        query('includeArchived').optional().isBoolean().withMessage('Include archived must be boolean')
    ],
    validateRequest,
    MemoryController.getConversationHistory
);

/**
 * @route GET /api/memory/:userId/similar
 * @desc Get similar conversations
 * @access Private
 */
router.get(
    '/:userId/similar',
    [
        param('userId').isString().notEmpty().withMessage('Valid user ID is required'),
        query('query').isString().notEmpty().withMessage('Query is required'),
        query('limit').optional().isInt({ min: 1, max: 20 }).withMessage('Limit must be between 1 and 20')
    ],
    validateRequest,
    MemoryController.getSimilarConversations
);

/**
 * @route GET /api/memory/:userId/recommendations
 * @desc Get personalized recommendations
 * @access Private
 */
router.get(
    '/:userId/recommendations',
    [
        param('userId').isString().notEmpty().withMessage('Valid user ID is required'),
        query('query').isString().notEmpty().withMessage('Query is required')
    ],
    validateRequest,
    MemoryController.getPersonalizedRecommendations
);

/**
 * @route PUT /api/memory/conversations/:conversationId/archive
 * @desc Archive a conversation
 * @access Private
 */
router.put(
    '/conversations/:conversationId/archive',
    [
        param('conversationId').isMongoId().withMessage('Valid conversation ID is required'),
        body('userId').isString().notEmpty().withMessage('User ID is required')
    ],
    validateRequest,
    MemoryController.archiveConversation
);

/**
 * @route DELETE /api/memory/conversations/:conversationId
 * @desc Delete a conversation
 * @access Private
 */
router.delete(
    '/conversations/:conversationId',
    [
        param('conversationId').isMongoId().withMessage('Valid conversation ID is required'),
        body('userId').isString().notEmpty().withMessage('User ID is required')
    ],
    validateRequest,
    MemoryController.deleteConversation
);

/**
 * @route DELETE /api/memory/:userId/preferences
 * @desc Reset user preferences
 * @access Private
 */
router.delete(
    '/:userId/preferences',
    [
        param('userId').isString().notEmpty().withMessage('Valid user ID is required')
    ],
    validateRequest,
    MemoryController.resetPreferences
);

/**
 * @route DELETE /api/memory/:userId/clear
 * @desc Clear all user memory (GDPR compliance)
 * @access Private
 */
router.delete(
    '/:userId/clear',
    [
        param('userId').isString().notEmpty().withMessage('Valid user ID is required')
    ],
    validateRequest,
    MemoryController.clearUserMemory
);

/**
 * @route GET /api/memory/:userId/export
 * @desc Export user memory data (GDPR compliance)
 * @access Private
 */
router.get(
    '/:userId/export',
    [
        param('userId').isString().notEmpty().withMessage('Valid user ID is required')
    ],
    validateRequest,
    MemoryController.exportUserData
);

/**
 * @route GET /api/memory/:userId/stats
 * @desc Get memory storage statistics
 * @access Private
 */
router.get(
    '/:userId/stats',
    [
        param('userId').isString().notEmpty().withMessage('Valid user ID is required')
    ],
    validateRequest,
    MemoryController.getStorageStats
);

export default router;