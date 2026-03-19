import * as crypto from 'crypto';
import {
  Controller,
  Post,
  Body,
  UseGuards,
  Logger,
  ValidationPipe,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { TrackingService, TrackingResult } from './tracking.service';
import { TrackManualRequestDto } from './dto/track-manual-request.dto';
import { OptionalJwtAuthGuard } from '@/common/guards/optional-jwt-auth.guard';
import { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@Controller('api/tracking')
@UseGuards(OptionalJwtAuthGuard)
export class TrackingController {
  private readonly logger = new Logger(TrackingController.name);

  constructor(private readonly trackingService: TrackingService) {}

  @Post('manual')
  async trackManualRequest(
    @Body(ValidationPipe) body: TrackManualRequestDto,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<{ success: boolean; message: string; data: TrackingResult }> {
    const startTime = Date.now();

    try {
      if (!user) {
        throw new HttpException(
          'Authentication required',
          HttpStatus.UNAUTHORIZED,
        );
      }

      const userId = user.id;
      this.logger.log(`Manual request tracking initiated`, { userId });

      const requestId = crypto.randomUUID();

      this.logger.log('Manual request tracking parameters received', {
        requestId,
        userId,
        model: body.model,
        hasModel: !!body.model,
        tokens: body.tokens,
        hasTokens: body.tokens !== undefined,
        tokensType: typeof body.tokens,
        project: body.project,
        hasProject: !!body.project,
        user: body.user,
        hasUser: !!body.user,
        feedback: body.feedback,
        hasFeedback: !!body.feedback,
        cost: body.cost,
        hasCost: body.cost !== undefined,
        description: body.description,
        hasDescription: !!body.description,
        provider: body.provider,
        hasProvider: !!body.provider,
        hasPrompt: !!body.prompt,
        promptLength: body.prompt ? body.prompt.length : 0,
        hasResponse: !!body.response,
        responseLength: body.response ? body.response.length : 0,
      });

      // Validate required fields (additional validation beyond DTO)
      if (!body.model || !body.tokens) {
        this.logger.warn(
          'Manual request tracking failed - missing required fields',
          {
            requestId,
            userId,
            model: body.model,
            hasModel: !!body.model,
            tokens: body.tokens,
            hasTokens: body.tokens !== undefined,
          },
        );

        throw new HttpException(
          {
            success: false,
            message: 'Model and tokens are required',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // Validate tokens is a positive number
      if (typeof body.tokens !== 'number' || body.tokens <= 0) {
        this.logger.warn('Manual request tracking failed - invalid tokens', {
          requestId,
          userId,
          tokens: body.tokens,
          tokensType: typeof body.tokens,
          tokensValid: typeof body.tokens === 'number' && body.tokens > 0,
        });

        throw new HttpException(
          {
            success: false,
            message: 'Tokens must be a positive number',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // Validate feedback if provided
      if (
        body.feedback &&
        !['positive', 'negative', 'neutral'].includes(body.feedback)
      ) {
        this.logger.warn('Manual request tracking failed - invalid feedback', {
          requestId,
          userId,
          feedback: body.feedback,
          feedbackValid: ['positive', 'negative', 'neutral'].includes(
            body.feedback,
          ),
        });

        throw new HttpException(
          {
            success: false,
            message: 'Feedback must be one of: positive, negative, neutral',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const trackingResult = await this.trackingService.trackManualRequest(
        userId,
        body,
      );
      const duration = Date.now() - startTime;

      this.logger.log('Manual request tracked successfully', {
        requestId,
        duration,
        userId,
        model: body.model,
        tokens: body.tokens,
        project: body.project,
        user: body.user,
        feedback: body.feedback,
        cost: body.cost,
        description: body.description,
        provider: body.provider,
        hasPrompt: !!body.prompt,
        promptLength: body.prompt ? body.prompt.length : 0,
        hasResponse: !!body.response,
        responseLength: body.response ? body.response.length : 0,
        hasTrackingResult: !!trackingResult,
      });

      // Log business event
      this.logger.log('Business event: manual_request_tracked', {
        event: 'manual_request_tracked',
        category: 'tracking',
        value: duration,
        metadata: {
          userId,
          model: body.model,
          tokens: body.tokens,
          project: body.project,
          user: body.user,
          feedback: body.feedback,
          cost: body.cost,
          description: body.description,
          provider: body.provider,
          hasPrompt: !!body.prompt,
          hasResponse: !!body.response,
          hasTrackingResult: !!trackingResult,
        },
      });

      return {
        success: true,
        message: 'Request tracked successfully',
        data: trackingResult,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;

      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(`Failed to track manual request: ${error.message}`, {
        error: error.message,
        stack: error.stack,
        duration,
      });

      throw new HttpException(
        {
          success: false,
          message: 'Failed to track manual request',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
