import { Response, NextFunction } from 'express';
import { TrackingService } from '../services/tracking.service';
import { loggingService } from '../services/logging.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

export class TrackingController {
  static async trackManualRequest(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();
    try {
      if (!ControllerHelper.requireAuth(req, res)) return;
      const userId = req.userId!;
      ControllerHelper.logRequestStart('trackManualRequest', req);

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

      const requestId = req.headers['x-request-id'] as string;

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
      ControllerHelper.handleError('trackManualRequest', error, req, res, startTime);
    }
  }
}
