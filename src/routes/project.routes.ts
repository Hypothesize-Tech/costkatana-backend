import { Router } from 'express';
import { ProjectController } from '../controllers/project.controller';
import { authenticate, optionalAuth, requirePermission } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { body, param, query } from 'express-validator';
import { loggingService } from '../services/logging.service';

const router = Router();

// Request logging middleware
router.use((req: any, _res: any, next: any) => {
    loggingService.info('=== PROJECT ROUTE REQUEST ===', {
        method: req.method,
        path: req.path,
        query: req.query,
        bodySize: JSON.stringify(req.body).length,
        hasAuth: !!req.headers.authorization,
        timestamp: new Date().toISOString()
    });
    next();
});

// Routes that support optional authentication (API key access)
// Get all projects (read-only, supports API key)
router.get(
    '/',
    optionalAuth,
    ProjectController.getUserProjects
);

// Get single project (read-only, supports API key)
router.get(
    '/:projectId',
    [
        param('projectId').isMongoId()
    ],
    validateRequest,
    optionalAuth,
    ProjectController.getProject
);

// Get project analytics (read-only, supports API key)
router.get(
    '/:projectId/analytics',
    [
        param('projectId').isMongoId(),
        query('period').optional().isIn(['monthly', 'quarterly', 'yearly'])
    ],
    validateRequest,
    optionalAuth,
    ProjectController.getProjectAnalytics
);

// Get cost allocation (read-only, supports API key)
router.get(
    '/:projectId/cost-allocation',
    [
        param('projectId').isMongoId(),
        query('groupBy').optional().isIn(['department', 'team', 'client', 'purpose']),
        query('startDate').optional().isISO8601(),
        query('endDate').optional().isISO8601()
    ],
    validateRequest,
    optionalAuth,
    ProjectController.getCostAllocation
);

// Export project data (read-only, supports API key)
router.get(
    '/:projectId/export',
    [
        param('projectId').isMongoId(),
        query('format').optional().isIn(['csv', 'json', 'excel']).withMessage('Invalid export format'),
        query('startDate').optional().isISO8601(),
        query('endDate').optional().isISO8601()
    ],
    validateRequest,
    optionalAuth,
    ProjectController.exportProjectData
);

// Recalculate project spending
router.post(
    '/:projectId/recalculate-spending',
    [
        param('projectId').isMongoId()
    ],
    validateRequest,
    authenticate,
    requirePermission('write', 'admin'),
    ProjectController.recalculateProjectSpending
);

// Recalculate all user project spending
router.post(
    '/recalculate-all-spending',
    validateRequest,
    authenticate,
    requirePermission('write', 'admin'),
    ProjectController.recalculateUserProjectSpending
);

// Routes that require full authentication (write operations)
// Create project
router.post(
    '/',
    [
        body('name').notEmpty().withMessage('Project name is required'),
        body('description').optional().isString(),
        body('budget.amount').isNumeric().withMessage('Budget amount must be a number'),
        body('budget.period').isIn(['monthly', 'quarterly', 'yearly', 'one-time']).withMessage('Invalid budget period'),
        body('budget.currency').optional().isString(),
        body('tags').optional().isArray(),
        body('settings').optional().isObject()
    ],
    validateRequest,
    authenticate,
    requirePermission('write', 'admin'),
    ProjectController.createProject
);

// Update project
router.put(
    '/:projectId',
    [
        param('projectId').isMongoId(),
        body('name').optional().notEmpty(),
        body('description').optional().isString(),
        body('budget').optional().isObject(),
        body('tags').optional().isArray(),
        body('settings').optional().isObject()
    ],
    validateRequest,
    authenticate,
    requirePermission('write', 'admin'),
    ProjectController.updateProject
);

// Delete project
router.delete(
    '/:projectId',
    [
        param('projectId').isMongoId()
    ],
    validateRequest,
    authenticate,
    requirePermission('admin'),
    ProjectController.deleteProject
);

// Handle approval request (needs to come before /:projectId)
router.post(
    '/approvals/:requestId',
    [
        param('requestId').isMongoId(),
        body('action').isIn(['approve', 'reject']).withMessage('Action must be approve or reject'),
        body('comments').optional().isString(),
        body('conditions').optional().isArray()
    ],
    validateRequest,
    authenticate,
    requirePermission('write', 'admin'),
    ProjectController.handleApprovalRequest
);

// Get approval requests
router.get(
    '/:projectId/approvals',
    [
        param('projectId').isMongoId(),
        query('status').optional().isIn(['pending', 'approved', 'rejected', 'expired'])
    ],
    validateRequest,
    optionalAuth,
    ProjectController.getApprovalRequests
);

export default router; 