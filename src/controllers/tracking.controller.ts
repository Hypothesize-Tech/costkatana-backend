import { Response, NextFunction } from 'express';
import { TrackingService } from '../services/tracking.service';
import { logger } from '../utils/logger';

export class TrackingController {
  static async trackManualRequest(req: any, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id || req.userId;
      if (!userId) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
        return;
      }

      const {
        model,
        tokens,
        project,
        user,
        feedback,
        cost,
        description,
        provider,
        prompt,
        response,
      } = req.body;

      // Validate required fields
      if (!model || !tokens) {
        res.status(400).json({
          success: false,
          message: 'Model and tokens are required',
        });
        return;
      }

      // Validate tokens is a positive number
      if (typeof tokens !== 'number' || tokens <= 0) {
        res.status(400).json({
          success: false,
          message: 'Tokens must be a positive number',
        });
        return;
      }

      // Validate feedback if provided
      if (feedback && !['positive', 'negative', 'neutral'].includes(feedback)) {
        res.status(400).json({
          success: false,
          message: 'Feedback must be one of: positive, negative, neutral',
        });
        return;
      }

      const trackingResult = await TrackingService.trackManualRequest(userId, {
        model,
        tokens,
        project,
        user,
        feedback,
        cost,
        description,
        provider,
        prompt,
        response,
      });

      res.json({
        success: true,
        message: 'Request tracked successfully',
        data: trackingResult,
      });
    } catch (error: any) {
      logger.error('Manual tracking error:', error);
      next(error);
    }
  }
}
