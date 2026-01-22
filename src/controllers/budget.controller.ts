import { Response, NextFunction } from 'express';
import { BudgetService } from '../services/budget.service';
import { loggingService } from '../services/logging.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

export class BudgetController {
  static async getBudgetStatus(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    if (!ControllerHelper.requireAuth(req, res)) return;
    const userId = req.userId!;
    const { project } = req.query;
    ControllerHelper.logRequestStart('getBudgetStatus', req, {
      project: project as string || 'all'
    });

    try {
      const budgetStatus = await BudgetService.getBudgetStatus(userId, project as string);

      ControllerHelper.logRequestSuccess('getBudgetStatus', req, startTime, {
        project: project as string || 'all',
        hasBudgetData: !!budgetStatus
      });

      // Log business event
      loggingService.logBusiness({
        event: 'budget_status_retrieved',
        category: 'budget_management',
        value: Date.now() - startTime,
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
      ControllerHelper.handleError('getBudgetStatus', error, req, res, startTime, {
        project: project as string || 'all'
      });
    }
  }
}
