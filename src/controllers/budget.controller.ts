import { Response, NextFunction } from 'express';
import { BudgetService } from '../services/budget.service';
import { logger } from '../utils/logger';

export class BudgetController {
  static async getBudgetStatus(req: any, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id || req.userId;
      if (!userId) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
        return;
      }

      const { project } = req.query;

      const budgetStatus = await BudgetService.getBudgetStatus(userId, project as string);

      res.json({
        success: true,
        message: 'Budget status retrieved successfully',
        data: budgetStatus,
      });
    } catch (error: any) {
      logger.error('Budget status error:', error);
      next(error);
    }
  }
}
