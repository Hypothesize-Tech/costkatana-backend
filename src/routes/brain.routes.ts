import { Router } from 'express';
import { BrainController } from '../controllers/brain.controller';
import { authenticate } from '../middleware/auth.middleware';
import { Response, NextFunction } from 'express';

const router = Router();

// ============================================================================
// MIDDLEWARE: Admin Authorization
// ============================================================================

const requireAdmin = (req: any, res: Response, next: NextFunction): void => {
    const user = req.user;
    
    if (!user) {
        res.status(401).json({
            success: false,
            error: 'Unauthorized'
        });
        return;
    }

    // Check if user is admin
    if (user.role !== 'admin') {
        res.status(403).json({
            success: false,
            error: 'Forbidden: Admin access required'
        });
        return;
    }

    next();
};

// ============================================================================
// MIDDLEWARE: User Authorization (can only access their own data)
// ============================================================================

const requireSelfOrAdmin = (req: any, res: Response, next: NextFunction): void => {
    const user = req.user;
    const requestedUserId = (req.params.userId as string) ?? (req.query.userId as string) ?? (req.body?.userId as string);
    
    if (!user) {
        res.status(401).json({
            success: false,
            error: 'Unauthorized'
        });
        return;
    }

    // Allow if admin or requesting own data
    if (user.role === 'admin' || user.id === requestedUserId || req.userId === requestedUserId) {
        next();
        return;
    }

    res.status(403).json({
        success: false,
        error: 'Forbidden: You can only access your own data'
    });
};

// ============================================================================
// ADMIN-ONLY ROUTES (Global System View)
// ============================================================================

// All routes require authentication
router.use(authenticate);

// Global metrics - Admin only
router.get('/admin/global-metrics', requireAdmin, BrainController.getGlobalMetrics);

// All active flows - Admin only
router.get('/admin/active-flows', requireAdmin, BrainController.getActiveFlows);

// All interventions - Admin only
router.get('/admin/interventions', requireAdmin, BrainController.getInterventions);

// Learning stats - Admin only
router.get('/admin/learning/stats', requireAdmin, BrainController.getLearningStats);

// Admin SSE stream - Admin only
router.get('/admin/stream', requireAdmin, BrainController.streamBrainEvents);

// ============================================================================
// USER ROUTES (Personal Data Only)
// ============================================================================

// User's own active flows
router.get('/user/active-flows', BrainController.getUserActiveFlows);

// User's own metrics
router.get('/user/metrics', BrainController.getUserMetrics);

// User's own interventions
router.get('/user/interventions', BrainController.getUserInterventions);

// User's budget forecast
router.get('/user/budget/forecast', BrainController.getUserBudgetForecast);

// User's burn rate
router.get('/user/budget/burn-rate', BrainController.getUserBurnRate);

// User's learning stats
router.get('/user/learning/stats', BrainController.getUserLearningStats);

// User's recommendations
router.get('/user/learning/recommendations', BrainController.getRecommendations);

// Submit feedback (user can only submit for themselves)
router.post('/user/learning/feedback', BrainController.submitFeedback);

// User SSE stream (only their events)
router.get('/user/stream', BrainController.streamUserEvents);

// ============================================================================
// LEGACY ROUTES (With proper authorization)
// ============================================================================

// These check if user is accessing their own data or is admin
router.get('/interventions/:userId', requireSelfOrAdmin, BrainController.getUserInterventions);
router.get('/budget/forecast/:userId', requireSelfOrAdmin, BrainController.getBudgetForecast);
router.get('/budget/burn-rate/:userId', requireSelfOrAdmin, BrainController.getBurnRate);

export default router;

