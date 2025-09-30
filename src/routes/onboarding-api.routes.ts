import { Router } from 'express';
import { OnboardingApiController } from '../controllers/onboarding-api.controller';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';
import { body } from 'express-validator';
import { validateRequest } from '../middleware/validation.middleware';

const router = Router();

/**
 * Onboarding API Routes
 * These routes handle the onboarding flow for users with zero projects
 */

// All onboarding routes require authentication
router.use(authenticate);

/**
 * Get onboarding status
 * GET /api/onboarding/status
 */
router.get(
    '/status',
    asyncHandler(OnboardingApiController.getOnboardingStatus)
);

/**
 * Initialize onboarding
 * POST /api/onboarding/initialize
 */
router.post(
    '/initialize',
    asyncHandler(OnboardingApiController.initializeOnboarding)
);

/**
 * Complete onboarding step
 * POST /api/onboarding/complete-step
 */
router.post(
    '/complete-step',
    [
        body('stepId')
            .isString()
            .notEmpty()
            .withMessage('Step ID is required')
            .isIn(['welcome', 'project_creation', 'project_pricing', 'llm_query', 'completion'])
            .withMessage('Invalid step ID')
    ],
    validateRequest,
    asyncHandler(OnboardingApiController.completeStep)
);

/**
 * Create project during onboarding
 * POST /api/onboarding/create-project
 */
router.post(
    '/create-project',
    [
        body('name')
            .isString()
            .notEmpty()
            .withMessage('Project name is required')
            .isLength({ min: 1, max: 100 })
            .withMessage('Project name must be between 1 and 100 characters'),
        body('description')
            .optional()
            .isString()
            .isLength({ max: 500 })
            .withMessage('Description must be less than 500 characters'),
        body('budget')
            .optional()
            .isObject()
            .withMessage('Budget must be an object'),
        body('budget.amount')
            .optional()
            .isNumeric()
            .withMessage('Budget amount must be a number'),
        body('budget.period')
            .optional()
            .isIn(['monthly', 'quarterly', 'yearly', 'one-time'])
            .withMessage('Invalid budget period'),
        body('budget.currency')
            .optional()
            .isString()
            .isLength({ min: 3, max: 3 })
            .withMessage('Currency must be a 3-letter code')
    ],
    validateRequest,
    asyncHandler(OnboardingApiController.createProject)
);

/**
 * Execute LLM query during onboarding
 * POST /api/onboarding/llm-query
 */
router.post(
    '/llm-query',
    [
        body('query')
            .isString()
            .notEmpty()
            .withMessage('Query is required')
            .isLength({ min: 1, max: 1000 })
            .withMessage('Query must be between 1 and 1000 characters'),
        body('model')
            .isString()
            .notEmpty()
            .withMessage('Model is required')
            .isIn(['gpt-3.5-turbo', 'gpt-4', 'claude-3-sonnet', 'claude-3-opus', 'gemini-pro'])
            .withMessage('Invalid model')
    ],
    validateRequest,
    asyncHandler(OnboardingApiController.executeLlmQuery)
);

/**
 * Complete onboarding
 * POST /api/onboarding/complete
 */
router.post(
    '/complete',
    asyncHandler(OnboardingApiController.completeOnboarding)
);

export { router as onboardingApiRoutes };
