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
        body('category').optional().isIn(['general', 'coding', 'writing', 'analysis', 'creative', 'business', 'custom', 'visual-compliance']),
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
        query('category').optional().isIn(['general', 'coding', 'writing', 'analysis', 'creative', 'business', 'custom', 'visual-compliance']),
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

// Get trending templates
router.get(
    '/trending',
    [
        query('period').optional().isIn(['day', 'week', 'month']),
        query('category').optional().isIn(['general', 'coding', 'writing', 'analysis', 'creative', 'business', 'custom']),
        query('limit').optional().isInt({ min: 1, max: 50 })
    ],
    validateRequest,
    PromptTemplateController.getTrendingTemplates
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
        body('category').optional().isIn(['general', 'coding', 'writing', 'analysis', 'creative', 'business', 'custom', 'visual-compliance']),
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

// Duplicate template
router.post(
    '/:templateId/duplicate',
    [
        param('templateId').isMongoId(),
        body('name').optional().notEmpty().withMessage('Name must not be empty if provided'),
        body('description').optional().isString(),
        body('category').optional().isIn(['general', 'coding', 'writing', 'analysis', 'creative', 'business', 'custom', 'visual-compliance']),
        body('projectId').optional().isMongoId(),
        body('metadata').optional().isObject(),
        body('metadata.tags').optional().isArray(),
        body('sharing').optional().isObject(),
        body('sharing.visibility').optional().isIn(['private', 'project', 'organization', 'public']),
        body('sharing.sharedWith').optional().isArray(),
        body('sharing.allowFork').optional().isBoolean()
    ],
    validateRequest,
    PromptTemplateController.duplicateTemplate
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

// ============ AI-POWERED ENDPOINTS ============

// AI: Generate template from intent
router.post(
    '/ai/generate',
    [
        body('intent').notEmpty().withMessage('Intent is required'),
        body('category').optional().isIn(['general', 'coding', 'writing', 'analysis', 'creative', 'business', 'custom', 'visual-compliance']),
        body('context').optional().isObject(),
        body('constraints').optional().isObject()
    ],
    validateRequest,
    PromptTemplateController.generateFromIntent
);

// AI: Detect variables in content
router.post(
    '/ai/detect-variables',
    [
        body('content').notEmpty().withMessage('Content is required'),
        body('autoFillDefaults').optional().isBoolean(),
        body('validateTypes').optional().isBoolean()
    ],
    validateRequest,
    PromptTemplateController.detectVariables
);

// AI: Get template recommendations
router.get(
    '/ai/recommendations',
    [
        query('currentProject').optional().isMongoId(),
        query('taskType').optional().isString()
    ],
    validateRequest,
    PromptTemplateController.getRecommendations
);

// AI: Semantic search
router.get(
    '/ai/search',
    [
        query('query').notEmpty().withMessage('Search query is required'),
        query('limit').optional().isInt({ min: 1, max: 50 })
    ],
    validateRequest,
    PromptTemplateController.searchSemantic
);

// AI: Optimize template
router.post(
    '/:templateId/ai/optimize',
    [
        param('templateId').isMongoId(),
        body('optimizationType').optional().isIn(['token', 'cost', 'quality', 'model-specific']),
        body('targetModel').optional().isString(),
        body('preserveIntent').optional().isBoolean()
    ],
    validateRequest,
    PromptTemplateController.optimizeTemplate
);

// AI: Predict effectiveness
router.post(
    '/:templateId/ai/predict-effectiveness',
    [
        param('templateId').isMongoId(),
        body('variables').optional().isObject()
    ],
    validateRequest,
    PromptTemplateController.predictEffectiveness
);

// AI: Get insights
router.get(
    '/:templateId/ai/insights',
    [
        param('templateId').isMongoId()
    ],
    validateRequest,
    PromptTemplateController.getInsights
);

// AI: Personalize template
router.post(
    '/:templateId/ai/personalize',
    [
        param('templateId').isMongoId()
    ],
    validateRequest,
    PromptTemplateController.personalizeTemplate
);

// AI: Apply optimization
router.post(
    '/:templateId/ai/apply-optimization',
    [
        param('templateId').isMongoId(),
        body('optimizedContent').notEmpty().withMessage('Optimized content is required'),
        body('metadata').optional().isObject()
    ],
    validateRequest,
    PromptTemplateController.applyOptimization
);

// ============ VISUAL COMPLIANCE TEMPLATE ENDPOINTS ============

// Create visual compliance template
router.post(
    '/visual-compliance',
    [
        body('name').notEmpty().withMessage('Template name is required'),
        body('complianceCriteria').isArray({ min: 1 }).withMessage('Compliance criteria must be a non-empty array'),
        body('imageVariables').isArray({ min: 1 }).withMessage('Image variables must be a non-empty array'),
        body('imageVariables.*.name').notEmpty().withMessage('Image variable name is required'),
        body('imageVariables.*.imageRole').isIn(['reference', 'evidence']).withMessage('Image role must be reference or evidence'),
        body('imageVariables.*.required').isBoolean(),
        body('industry').isIn(['jewelry', 'grooming', 'retail', 'fmcg', 'documents']).withMessage('Invalid industry'),
        body('mode').optional().isIn(['optimized', 'standard']),
        body('metaPromptPresetId').optional().isString(),
        body('projectId').optional().isMongoId()
    ],
    validateRequest,
    PromptTemplateController.createVisualComplianceTemplate
);

// Use visual compliance template
router.post(
    '/:templateId/use-visual',
    [
        param('templateId').isMongoId(),
        body('textVariables').optional().isObject(),
        body('imageVariables').isObject().withMessage('Image variables are required'),
        body('projectId').optional().isMongoId()
    ],
    validateRequest,
    PromptTemplateController.useVisualTemplate
);

// Upload image for template variable
router.post(
    '/:templateId/upload-image',
    [
        param('templateId').isMongoId(),
        body('variableName').notEmpty().withMessage('Variable name is required'),
        body('imageData').notEmpty().withMessage('Image data is required'),
        body('mimeType').notEmpty().withMessage('MIME type is required')
    ],
    validateRequest,
    PromptTemplateController.uploadTemplateImage
);

// ============ TEMPLATE EXECUTION ENDPOINTS ============

// Execute template with AI
router.post(
    '/:templateId/execute',
    [
        param('templateId').isMongoId(),
        body('variables').optional().isObject(),
        body('executionMode').optional().isIn(['single', 'comparison', 'recommended']),
        body('modelId').optional().isString(),
        body('compareWith').optional().isArray(),
        body('enableOptimization').optional().isBoolean()
    ],
    validateRequest,
    PromptTemplateController.executeTemplate
);

// Get model recommendation for template
router.get(
    '/:templateId/recommendation',
    [
        param('templateId').isMongoId()
    ],
    validateRequest,
    PromptTemplateController.getModelRecommendation
);

// Get execution history for template
router.get(
    '/:templateId/executions',
    [
        param('templateId').isMongoId(),
        query('limit').optional().isInt({ min: 1, max: 50 })
    ],
    validateRequest,
    PromptTemplateController.getExecutionHistory
);

// Get execution statistics for template
router.get(
    '/:templateId/execution-stats',
    [
        param('templateId').isMongoId()
    ],
    validateRequest,
    PromptTemplateController.getExecutionStats
);

export default router; 