import { Router } from 'express';
import { ApiKeyController } from '../controllers/apiKey.controller';
import { authenticate, requirePermission } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';
import { body, param } from 'express-validator';
import { validateRequest } from '../middleware/validation.middleware';

const router = Router();

/**
 * API Key Management Routes
 * These routes handle ChatGPT integration API key generation and management
 */

// Generate new API key
router.post(
    '/',
    authenticate,
    requirePermission('write'),
    [
        body('name')
            .notEmpty()
            .withMessage('API key name is required')
            .isLength({ min: 1, max: 50 })
            .withMessage('API key name must be between 1 and 50 characters')
            .trim()
    ],
    validateRequest,
    asyncHandler(ApiKeyController.generateApiKey)
);

// List user's API keys
router.get(
    '/',
    authenticate,
    requirePermission('read'),
    asyncHandler(ApiKeyController.listApiKeys)
);

// Deactivate API key
router.patch(
    '/:keyId/deactivate',
    authenticate,
    requirePermission('write'),
    [
        param('keyId')
            .notEmpty()
            .withMessage('Key ID is required')
            .isLength({ min: 1, max: 32 })
            .withMessage('Invalid key ID format')
    ],
    validateRequest,
    asyncHandler(ApiKeyController.deactivateApiKey)
);

// Regenerate API key
router.patch(
    '/:keyId/regenerate',
    authenticate,
    requirePermission('write'),
    [
        param('keyId')
            .notEmpty()
            .withMessage('Key ID is required')
            .isLength({ min: 1, max: 32 })
            .withMessage('Invalid key ID format')
    ],
    validateRequest,
    asyncHandler(ApiKeyController.regenerateApiKey)
);

export { router as apiKeyRoutes }; 