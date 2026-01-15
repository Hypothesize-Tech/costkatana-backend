import { Request, Response, NextFunction } from 'express';
import { TemplateAnalyticsService } from '../services/templateAnalytics.service';
import { loggingService } from '../services/logging.service';

export interface AuthenticatedRequest extends Request {
    userId?: string;
}

/**
 * Get template usage overview statistics
 */
export const getTemplateUsageOverview = async (
    req: AuthenticatedRequest,
    res: Response,
    _next: NextFunction
): Promise<void> => {
    const startTime = Date.now();
    const userId = req.userId;

    try {
        if (!userId) {
            res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
            return;
        }

        const { startDate, endDate, category, context, templateId } = req.query;

        const filters: any = {};
        if (startDate) filters.startDate = new Date(startDate as string);
        if (endDate) filters.endDate = new Date(endDate as string);
        if (category) filters.category = category as string;
        if (context) filters.context = context as string;
        if (templateId) filters.templateId = templateId as string;

        const stats = await TemplateAnalyticsService.getTemplateUsageStats(userId, filters);

        const duration = Date.now() - startTime;

        loggingService.info('Template usage overview retrieved', {
            userId,
            duration,
            totalTemplatesUsed: stats.totalTemplatesUsed,
            totalUsageCount: stats.totalUsageCount
        });

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        const duration = Date.now() - startTime;
        loggingService.error('Error getting template usage overview:', {
            userId,
            error: error instanceof Error ? error.message : String(error),
            duration
        });

        res.status(500).json({
            success: false,
            message: 'Failed to get template usage overview',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get detailed breakdown for a specific template
 */
export const getTemplateBreakdown = async (
    req: AuthenticatedRequest,
    res: Response,
    _next: NextFunction
): Promise<void> => {
    const startTime = Date.now();
    const userId = req.userId;
    const { templateId } = req.params;

    try {
        if (!userId) {
            res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
            return;
        }

        if (!templateId) {
            res.status(400).json({
                success: false,
                message: 'Template ID is required'
            });
            return;
        }

        const { startDate, endDate, category, context } = req.query;

        const filters: any = {};
        if (startDate) filters.startDate = new Date(startDate as string);
        if (endDate) filters.endDate = new Date(endDate as string);
        if (category) filters.category = category as string;
        if (context) filters.context = context as string;

        const breakdown = await TemplateAnalyticsService.getTemplateBreakdown(
            templateId,
            userId,
            filters
        );

        const duration = Date.now() - startTime;

        loggingService.info('Template breakdown retrieved', {
            userId,
            templateId,
            duration,
            usageCount: breakdown.usageCount
        });

        res.json({
            success: true,
            data: breakdown
        });
    } catch (error) {
        const duration = Date.now() - startTime;
        loggingService.error('Error getting template breakdown:', {
            userId,
            templateId,
            error: error instanceof Error ? error.message : String(error),
            duration
        });

        res.status(500).json({
            success: false,
            message: 'Failed to get template breakdown',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get top templates by usage
 */
export const getTopTemplates = async (
    req: AuthenticatedRequest,
    res: Response,
    _next: NextFunction
): Promise<void> => {
    const startTime = Date.now();
    const userId = req.userId;

    try {
        if (!userId) {
            res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
            return;
        }

        const period = (req.query.period as '24h' | '7d' | '30d' | '90d') || '30d';
        const limit = parseInt(req.query.limit as string) || 10;

        const topTemplates = await TemplateAnalyticsService.getTopTemplates(
            userId,
            period,
            limit
        );

        const duration = Date.now() - startTime;

        loggingService.info('Top templates retrieved', {
            userId,
            period,
            duration,
            count: topTemplates.length
        });

        res.json({
            success: true,
            data: topTemplates
        });
    } catch (error) {
        const duration = Date.now() - startTime;
        loggingService.error('Error getting top templates:', {
            userId,
            error: error instanceof Error ? error.message : String(error),
            duration
        });

        res.status(500).json({
            success: false,
            message: 'Failed to get top templates',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get cost savings report
 */
export const getCostSavingsReport = async (
    req: AuthenticatedRequest,
    res: Response,
    _next: NextFunction
): Promise<void> => {
    const startTime = Date.now();
    const userId = req.userId;

    try {
        if (!userId) {
            res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
            return;
        }

        const period = (req.query.period as '24h' | '7d' | '30d' | '90d') || '30d';

        const savingsReport = await TemplateAnalyticsService.getTemplateCostSavings(
            userId,
            period
        );

        const duration = Date.now() - startTime;

        loggingService.info('Cost savings report retrieved', {
            userId,
            period,
            duration,
            totalSavings: savingsReport.totalSavings
        });

        res.json({
            success: true,
            data: savingsReport
        });
    } catch (error) {
        const duration = Date.now() - startTime;
        loggingService.error('Error getting cost savings report:', {
            userId,
            error: error instanceof Error ? error.message : String(error),
            duration
        });

        res.status(500).json({
            success: false,
            message: 'Failed to get cost savings report',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get templates by context
 */
export const getTemplatesByContext = async (
    req: AuthenticatedRequest,
    res: Response,
    _next: NextFunction
): Promise<void> => {
    const startTime = Date.now();
    const userId = req.userId;
    const { context } = req.params;

    try {
        if (!userId) {
            res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
            return;
        }

        if (!context) {
            res.status(400).json({
                success: false,
                message: 'Context is required'
            });
            return;
        }

        const validContexts = ['chat', 'optimization', 'visual-compliance', 'workflow', 'api'];
        if (!validContexts.includes(context)) {
            res.status(400).json({
                success: false,
                message: 'Invalid context. Must be one of: ' + validContexts.join(', ')
            });
            return;
        }

        const { startDate, endDate, category } = req.query;

        const filters: any = {};
        if (startDate) filters.startDate = new Date(startDate as string);
        if (endDate) filters.endDate = new Date(endDate as string);
        if (category) filters.category = category as string;

        const templates = await TemplateAnalyticsService.getTemplatesByContext(
            userId,
            context as any,
            filters
        );

        const duration = Date.now() - startTime;

        loggingService.info('Templates by context retrieved', {
            userId,
            context,
            duration,
            count: templates.length
        });

        res.json({
            success: true,
            data: templates
        });
    } catch (error) {
        const duration = Date.now() - startTime;
        loggingService.error('Error getting templates by context:', {
            userId,
            context,
            error: error instanceof Error ? error.message : String(error),
            duration
        });

        res.status(500).json({
            success: false,
            message: 'Failed to get templates by context',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

