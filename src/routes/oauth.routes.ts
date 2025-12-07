import { Router } from 'express';
import { OAuthController } from '../controllers/oauth.controller';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';

const router = Router();

/**
 * OAuth Routes
 */

// Public routes - OAuth initiation and callback
router.get('/:provider', asyncHandler(OAuthController.initiateOAuth));
router.get('/:provider/callback', asyncHandler(OAuthController.handleOAuthCallback));

// Protected routes - Linking and managing OAuth providers
router.post('/:provider/link', authenticate, asyncHandler(OAuthController.linkOAuthProvider));
router.get('/linked', authenticate, asyncHandler(OAuthController.getLinkedProviders));
router.delete('/:provider/unlink', authenticate, asyncHandler(OAuthController.unlinkOAuthProvider));

export default router;

