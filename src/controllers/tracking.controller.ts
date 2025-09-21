import { Response, NextFunction } from 'express';
import { TrackingService } from '../services/tracking.service';
import { loggingService } from '../services/logging.service';

export class TrackingController {
  static async trackManualRequest(req: any, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] as string;
    const userId = req.user?.id || req.userId;

    try {
      loggingService.info('Manual request tracking initiated', {
        requestId,
        userId,
        hasUserId: !!userId,
        userSource: req.user?.id ? 'req.user.id' : 'req.userId'
      });

      if (!userId) {
        
        loggingService.warn('Manual request tracking failed - authentication required', {
          requestId
        });

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

      loggingService.info('Manual request tracking parameters received', {
        requestId,
        userId,
        model,
        hasModel: !!model,
        tokens,
        hasTokens: tokens !== undefined,
        tokensType: typeof tokens,
        project,
        hasProject: !!project,
        user,
        hasUser: !!user,
        feedback,
        hasFeedback: !!feedback,
        cost,
        hasCost: cost !== undefined,
        description,
        hasDescription: !!description,
        provider,
        hasProvider: !!provider,
        hasPrompt: !!prompt,
        promptLength: prompt ? (prompt as string).length : 0,
        hasResponse: !!response,
        responseLength: response ? (response as string).length : 0
      });

      // Validate required fields
      if (!model || !tokens) {
        loggingService.warn('Manual request tracking failed - missing required fields', {
          requestId,
          userId,
          model,
          hasModel: !!model,
          tokens,
          hasTokens: tokens !== undefined
        });

        res.status(400).json({
          success: false,
          message: 'Model and tokens are required',
        });
        return;
      }

      // Validate tokens is a positive number
      if (typeof tokens !== 'number' || tokens <= 0) {
        loggingService.warn('Manual request tracking failed - invalid tokens', {
          requestId,
          userId,
          tokens,
          tokensType: typeof tokens,
          tokensValid: typeof tokens === 'number' && tokens > 0
        });

        res.status(400).json({
          success: false,
          message: 'Tokens must be a positive number',
        });
        return;
      }

      // Validate feedback if provided
      if (feedback && !['positive', 'negative', 'neutral'].includes(feedback)) {
        loggingService.warn('Manual request tracking failed - invalid feedback', {
          requestId,
          userId,
          feedback,
          feedbackValid: ['positive', 'negative', 'neutral'].includes(feedback)
        });

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
      const duration = Date.now() - startTime;

      loggingService.info('Manual request tracked successfully', {
        requestId,
        duration,
        userId,
        model,
        tokens,
        project,
        user,
        feedback,
        cost,
        description,
        provider,
        hasPrompt: !!prompt,
        promptLength: prompt ? (prompt as string).length : 0,
        hasResponse: !!response,
        responseLength: response ? (response as string).length : 0,
        hasTrackingResult: !!trackingResult
      });

      // Log business event
      loggingService.logBusiness({
        event: 'manual_request_tracked',
        category: 'tracking',
        value: duration,
        metadata: {
          userId,
          model,
          tokens,
          project,
          user,
          feedback,
          cost,
          description,
          provider,
          hasPrompt: !!prompt,
          hasResponse: !!response,
          hasTrackingResult: !!trackingResult
        }
      });

      res.json({
        success: true,
        message: 'Request tracked successfully',
        data: trackingResult,
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Manual request tracking failed', {
        requestId,
        userId,
        hasUserId: !!userId,
        model: req.body?.model,
        tokens: req.body?.tokens,
        project: req.body?.project,
        user: req.body?.user,
        feedback: req.body?.feedback,
        cost: req.body?.cost,
        description: req.body?.description,
        provider: req.body?.provider,
        hasPrompt: !!req.body?.prompt,
        hasResponse: !!req.body?.response,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration
      });
      
      next(error);
    }
  }
}
