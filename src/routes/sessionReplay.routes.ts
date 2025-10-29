import { Router } from 'express';
import { sessionReplayController } from '../controllers/sessionReplay.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Apply auth middleware to all routes
router.use(authenticate);

/**
 * @route   GET /api/session-replay/stats
 * @desc    Get session statistics for authenticated user
 * @access  Private
 * @note    Must come before /:sessionId to avoid being caught as a param
 */
router.get('/stats', (req, res) => sessionReplayController.getStats(req, res));

/**
 * @route   GET /api/session-replay/list
 * @desc    List session replays with filters
 * @access  Private
 * @note    Must come before /:sessionId to avoid being caught as a param
 */
router.get('/list', (req, res) => sessionReplayController.listSessionReplays(req, res));

/**
 * @route   POST /api/session-replay/recording/start
 * @desc    Start a new in-app recording session
 * @access  Private
 * @note    Must come before /:sessionId to avoid being caught as a param
 */
router.post('/recording/start', (req, res) => sessionReplayController.startRecording(req, res));

/**
 * @route   GET /api/session-replay/:sessionId/player
 * @desc    Get session player data (optimized for frontend playback)
 * @access  Private
 * @note    Must come before /:sessionId to avoid conflicts
 */
router.get('/:sessionId/player', (req, res) => sessionReplayController.getSessionPlayer(req, res));

/**
 * @route   POST /api/session-replay/:sessionId/snapshot
 * @desc    Add snapshot to session
 * @access  Private
 */
router.post('/:sessionId/snapshot', (req, res) => sessionReplayController.addSnapshot(req, res));

/**
 * @route   POST /api/session-replay/:sessionId/export
 * @desc    Export session data in specified format (json/csv)
 * @access  Private
 */
router.post('/:sessionId/export', (req, res) => sessionReplayController.exportSession(req, res));

/**
 * @route   POST /api/session-replay/:sessionId/share
 * @desc    Generate shareable link for session
 * @access  Private
 */
router.post('/:sessionId/share', (req, res) => sessionReplayController.shareSession(req, res));

/**
 * @route   GET /api/session-replay/:sessionId
 * @desc    Get session replay by ID
 * @access  Private
 * @note    Keep this last to avoid catching specific routes above
 */
router.get('/:sessionId', (req, res) => sessionReplayController.getSessionReplay(req, res));

export default router;

