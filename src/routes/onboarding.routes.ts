import { Router } from 'express';
import { OnboardingController } from '../controllers/onboarding.controller';
import { asyncHandler } from '../middleware/error.middleware';
import { body, query } from 'express-validator';
import { validateRequest } from '../middleware/validation.middleware';

const router = Router();

/**
 * Onboarding Routes for Seamless ChatGPT Integration
 * These routes handle the magic link flow for zero-friction user onboarding
 */

// Generate magic link for ChatGPT integration
router.post(
    '/magic-link',
    [
        body('email')
            .isEmail()
            .withMessage('Valid email is required')
            .normalizeEmail(),
        body('source')
            .optional()
            .isIn(['chatgpt', 'claude', 'gemini', 'perplexity'])
            .withMessage('Invalid source')
    ],
    validateRequest,
    asyncHandler(OnboardingController.generateMagicLink)
);

// Handle magic link completion (user clicks the link)
router.get(
    '/complete',
    [
        query('token')
            .notEmpty()
            .withMessage('Token is required'),
        query('data')
            .notEmpty()
            .withMessage('Data is required')
    ],
    validateRequest,
    asyncHandler(OnboardingController.completeMagicLink)
);

// Verify magic link token
router.get(
    '/verify/:token',
    asyncHandler(OnboardingController.verifyMagicLink)
);

export { router as onboardingRoutes }; 