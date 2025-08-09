import { Router } from 'express';
import { PromptTemplateController } from '../controllers/promptTemplate.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { body, param, query } from 'express-validator';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Create a new prompt template
router.post(
    '/',
    [
        body('name').notEmpty().withMessage('Template name is required'),
        body('content').notEmpty().withMessage('Template content is required'),
        body('category').optional().isIn(['general', 'coding', 'writing', 'analysis', 'creative', 'business', 'custom']),
        body('projectId').optional().isMongoId(),
        body('variables').optional().isArray(),
        body('variables.*.name').optional().notEmpty(),
        body('variables.*.required').optional().isBoolean(),
        body('sharing.visibility').optional().isIn(['private', 'project', 'organization', 'public']),
        body('sharing.sharedWith').optional().isArray(),
        body('sharing.allowFork').optional().isBoolean()
    ],
    validateRequest,
    PromptTemplateController.createTemplate
);

// Get templates with filters
router.get(
    '/',
    [
        query('projectId').optional().isMongoId(),
        query('category').optional().isIn(['general', 'coding', 'writing', 'analysis', 'creative', 'business', 'custom']),
        query('tags').optional().isString(),
        query('visibility').optional().isIn(['private', 'project', 'organization', 'public']),
        query('search').optional().isString(),
        query('page').optional().isInt({ min: 1 }),
        query('limit').optional().isInt({ min: 1, max: 100 })
    ],
    validateRequest,
    (req: any, _res: any, next: any) => {
        console.log('=== ROUTE HANDLER REACHED ===');
        console.log('Request path:', req.path);
        console.log('Request method:', req.method);
        console.log('Request query:', req.query);
        console.log('Request user:', req.user);
        next();
    },
    PromptTemplateController.getTemplates
);

// Get popular templates
router.get(
    '/popular',
    [
        query('category').optional().isIn(['general', 'coding', 'writing', 'analysis', 'creative', 'business', 'custom']),
        query('limit').optional().isInt({ min: 1, max: 50 })
    ],
    validateRequest,
    PromptTemplateController.getPopularTemplates
);

// Get specific template
router.get(
    '/:templateId',
    [
        param('templateId').isMongoId()
    ],
    validateRequest,
    PromptTemplateController.getTemplate
);

// Use a template
router.post(
    '/:templateId/use',
    [
        param('templateId').isMongoId(),
        body('variables').optional().isObject()
    ],
    validateRequest,
    PromptTemplateController.useTemplate
);

// Update template
router.put(
    '/:templateId',
    [
        param('templateId').isMongoId(),
        body('name').optional().notEmpty(),
        body('description').optional(),
        body('content').optional().notEmpty(),
        body('category').optional().isIn(['general', 'coding', 'writing', 'analysis', 'creative', 'business', 'custom']),
        body('variables').optional().isArray(),
        body('metadata').optional().isObject(),
        body('sharing').optional().isObject()
    ],
    validateRequest,
    PromptTemplateController.updateTemplate
);

// Delete template
router.delete(
    '/:templateId',
    [
        param('templateId').isMongoId()
    ],
    validateRequest,
    PromptTemplateController.deleteTemplate
);

// Fork template
router.post(
    '/:templateId/fork',
    [
        param('templateId').isMongoId(),
        body('projectId').optional().isMongoId()
    ],
    validateRequest,
    PromptTemplateController.forkTemplate
);

// Add feedback
router.post(
    '/:templateId/feedback',
    [
        param('templateId').isMongoId(),
        body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
        body('comment').optional().isString().isLength({ max: 500 })
    ],
    validateRequest,
    PromptTemplateController.addFeedback
);

// Get template analytics
router.get(
    '/:templateId/analytics',
    [
        param('templateId').isMongoId()
    ],
    validateRequest,
    PromptTemplateController.getTemplateAnalytics
);

export default router; 