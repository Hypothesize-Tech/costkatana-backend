import { Router } from 'express';
import { SecurityController } from '../controllers/security.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { body, query, param } from 'express-validator';

const router = Router();

// All security routes require authentication
router.use(authenticate);

// Security Analytics Routes
router.get('/analytics', 
    [
        query('startDate').optional().isISO8601().withMessage('Start date must be a valid ISO date'),
        query('endDate').optional().isISO8601().withMessage('End date must be a valid ISO date'),
    ],
    validateRequest,
    SecurityController.getSecurityAnalytics
);

router.get('/metrics', 
    SecurityController.getSecurityMetrics
);

// Firewall Management Routes
router.get('/firewall/config', 
    SecurityController.getFirewallConfig
);

router.put('/firewall/config',
    [
        body('enableBasicFirewall').optional().isBoolean().withMessage('enableBasicFirewall must be boolean'),
        body('enableAdvancedFirewall').optional().isBoolean().withMessage('enableAdvancedFirewall must be boolean'),
        body('enableRAGSecurity').optional().isBoolean().withMessage('enableRAGSecurity must be boolean'),
        body('enableToolSecurity').optional().isBoolean().withMessage('enableToolSecurity must be boolean'),
        body('promptGuardThreshold').optional().isFloat({ min: 0, max: 1 }).withMessage('promptGuardThreshold must be between 0 and 1'),
        body('llamaGuardThreshold').optional().isFloat({ min: 0, max: 1 }).withMessage('llamaGuardThreshold must be between 0 and 1'),
        body('ragSecurityThreshold').optional().isFloat({ min: 0, max: 1 }).withMessage('ragSecurityThreshold must be between 0 and 1'),
        body('toolSecurityThreshold').optional().isFloat({ min: 0, max: 1 }).withMessage('toolSecurityThreshold must be between 0 and 1'),
        body('sandboxHighRisk').optional().isBoolean().withMessage('sandboxHighRisk must be boolean'),
        body('requireHumanApproval').optional().isBoolean().withMessage('requireHumanApproval must be boolean')
    ],
    validateRequest,
    SecurityController.updateFirewallConfig
);

router.get('/firewall/analytics',
    [
        query('startDate').optional().isISO8601().withMessage('Start date must be a valid ISO date'),
        query('endDate').optional().isISO8601().withMessage('End date must be a valid ISO date'),
    ],
    validateRequest,
    SecurityController.getFirewallAnalytics
);

// Security Testing Routes
router.post('/test',
    [
        body('prompt').notEmpty().withMessage('Prompt is required for security testing'),
        body('retrievedChunks').optional().isArray().withMessage('retrievedChunks must be an array'),
        body('toolCalls').optional().isArray().withMessage('toolCalls must be an array'),
        body('provenanceSource').optional().isString().withMessage('provenanceSource must be a string')
    ],
    validateRequest,
    SecurityController.testSecurityCheck
);

// Human Review Routes
router.get('/reviews/pending', 
    SecurityController.getPendingReviews
);

router.post('/reviews/:reviewId/decision',
    [
        param('reviewId').isUUID().withMessage('Review ID must be a valid UUID'),
        body('decision').isIn(['approved', 'denied']).withMessage('Decision must be approved or denied'),
        body('comments').optional().isString().withMessage('Comments must be a string')
    ],
    validateRequest,
    SecurityController.reviewSecurityRequest
);

// Risk Analysis Routes
router.get('/risks/top-patterns',
    [
        query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    ],
    validateRequest,
    SecurityController.getTopRiskyPrompts
);

// Report Export Routes
router.get('/reports/export',
    [
        query('format').optional().isIn(['json', 'csv']).withMessage('Format must be json or csv'),
        query('startDate').optional().isISO8601().withMessage('Start date must be a valid ISO date'),
        query('endDate').optional().isISO8601().withMessage('End date must be a valid ISO date'),
    ],
    validateRequest,
    SecurityController.exportSecurityReport
);

export { router as securityRoutes };
