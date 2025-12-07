import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { ProactiveSuggestionsService } from '../services/proactiveSuggestions.service';
import { loggingService } from '../services/logging.service';

const auth = authenticate;

const router = Router();

/**
 * @route   POST /api/proactive-suggestions/accept/:suggestionId
 * @desc    Accept a proactive suggestion
 * @access  Private
 */
router.post('/accept/:suggestionId', auth, async (req: Request, res: Response): Promise<void> => {
    try {
        const { suggestionId } = req.params;
        const userId = (req as any).user!.id;

        await ProactiveSuggestionsService.trackSuggestionAcceptance(suggestionId, userId);

        loggingService.info('Proactive suggestion accepted', {
            suggestionId,
            userId,
            requestId: req.headers['x-request-id'] as string
        });

        res.status(200).json({
            success: true,
            message: 'Suggestion accepted successfully',
            suggestionId
        });
    } catch (error) {
        loggingService.error('Error accepting proactive suggestion', {
            error: error instanceof Error ? error.message : String(error),
            suggestionId: req.params.suggestionId,
            userId: (req as any).user?.id,
            requestId: req.headers['x-request-id'] as string
        });

        res.status(500).json({
            success: false,
            error: 'Failed to accept suggestion',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * @route   POST /api/proactive-suggestions/reject/:suggestionId
 * @desc    Reject a proactive suggestion
 * @access  Private
 */
router.post('/reject/:suggestionId', auth, async (req: Request, res: Response): Promise<void> => {
    try {
        const { suggestionId } = req.params;
        const userId = (req as any).user!.id;
        const { reason } = req.body;

        await ProactiveSuggestionsService.trackSuggestionRejection(suggestionId, userId, reason);

        loggingService.info('Proactive suggestion rejected', {
            suggestionId,
            userId,
            reason,
            requestId: req.headers['x-request-id'] as string
        });

        res.status(200).json({
            success: true,
            message: 'Suggestion rejected successfully',
            suggestionId
        });
    } catch (error) {
        loggingService.error('Error rejecting proactive suggestion', {
            error: error instanceof Error ? error.message : String(error),
            suggestionId: req.params.suggestionId,
            userId: (req as any).user?.id,
            requestId: req.headers['x-request-id'] as string
        });

        res.status(500).json({
            success: false,
            error: 'Failed to reject suggestion',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router;

