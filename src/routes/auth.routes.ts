import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { UserSessionController } from '../controllers/userSession.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { registerSchema, loginSchema } from '../utils/validators';
import { asyncHandler } from '../middleware/error.middleware';

const router = Router();

// Public routes
router.post('/register', validate(registerSchema), asyncHandler(AuthController.register));
router.post('/login', validate(loginSchema), asyncHandler(AuthController.login));
router.post('/refresh', asyncHandler(AuthController.refreshTokens));
router.post('/logout', asyncHandler(AuthController.logout));
router.post('/forgot-password', asyncHandler(AuthController.forgotPassword));
router.post('/reset-password/:token', asyncHandler(AuthController.resetPassword));
router.get('/verify-email/:token', asyncHandler(AuthController.verifyEmail));

// Public route for email-based session revocation
router.post('/user-sessions/revoke/:userSessionId/:revokeToken', asyncHandler(UserSessionController.revokeUserSessionFromEmail));

// Protected routes
router.post('/change-password', authenticate, asyncHandler(AuthController.changePassword));

// Protected user session routes
router.get('/user-sessions', authenticate, asyncHandler(UserSessionController.getActiveUserSessions));
router.delete('/user-sessions/:userSessionId', authenticate, asyncHandler(UserSessionController.revokeUserSession));
router.delete('/user-sessions/others', authenticate, asyncHandler(UserSessionController.revokeAllOtherUserSessions));

export default router;