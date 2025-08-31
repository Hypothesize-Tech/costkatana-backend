import { Response, NextFunction } from 'express';
import { BudgetService } from '../services/budget.service';
import { loggingService } from '../services/logging.service';

export class BudgetController {
  static async getBudgetStatus(req: any, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    const userId = req.user?.id || req.userId;
    const { project } = req.query;

    try {
      loggingService.info('Budget status request initiated', {
        userId,
        project: project as string || 'all',
        requestId: req.headers['x-request-id'] as string
      });

      if (!userId) {
        loggingService.warn('Budget status request failed - no user authentication', {
          requestId: req.headers['x-request-id'] as string
        });

        res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
        return;
      }

      const budgetStatus = await BudgetService.getBudgetStatus(userId, project as string);

      const duration = Date.now() - startTime;

      loggingService.info('Budget status retrieved successfully', {
        userId,
        project: project as string || 'all',
        duration,
        hasBudgetData: !!budgetStatus,
        requestId: req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'budget_status_retrieved',
        category: 'budget_management',
        value: duration,
        metadata: {
          userId,
          project: project as string || 'all',
          hasBudgetData: !!budgetStatus
        }
      });

      res.json({
        success: true,
        message: 'Budget status retrieved successfully',
        data: budgetStatus,
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Budget status retrieval failed', {
        userId,
        project: project as string || 'all',
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

      next(error);
    }
  }
}
