import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  Logger,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  OnModuleInit,
  OnModuleDestroy,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { RequestFeedbackService } from './request-feedback.service';
import {
  SubmitFeedbackDto,
  UpdateImplicitSignalsDto,
  RequestIdParamDto,
} from './dto';

@Controller('api/request-feedback')
@UseGuards(JwtAuthGuard)
export class RequestFeedbackController
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RequestFeedbackController.name);

  private backgroundQueue: Array<() => Promise<void>> = [];
  private backgroundProcessor?: NodeJS.Timeout;

  constructor(
    private readonly requestFeedbackService: RequestFeedbackService,
  ) {}

  onModuleInit() {
    this.startBackgroundProcessor();
  }

  onModuleDestroy() {
    if (this.backgroundProcessor) {
      clearInterval(this.backgroundProcessor);
      this.backgroundProcessor = undefined;
    }
    while (this.backgroundQueue.length > 0) {
      const op = this.backgroundQueue.shift();
      if (op) {
        op().catch((err) =>
          this.logger.error('Cleanup operation failed', {
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
  }

  @Post(':requestId/feedback')
  async submitFeedback(
    @Param() params: RequestIdParamDto,
    @Body() body: SubmitFeedbackDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const { requestId } = params;
    const userId = user.id;

    const feedbackData = {
      rating: body.rating,
      comment: body.comment,
      implicitSignals: body.implicitSignals,
      userAgent: req.headers['user-agent'],
      ipAddress: (req as any).ip ?? (req as any).connection?.remoteAddress,
    };

    try {
      await this.requestFeedbackService.submitFeedback(
        requestId,
        userId,
        feedbackData,
      );
    } catch (error: any) {
      this.requestFeedbackService.recordDbFailure();
      if (error?.message === 'Feedback already exists for this request') {
        throw new ConflictException(
          'Feedback already submitted for this request',
        );
      }
      throw error;
    }

    this.queueBackgroundOperation(async () => {
      this.logger.log('Business event: feedback_submitted', {
        category: 'request_feedback',
        metadata: {
          userId,
          feedbackRequestId: requestId,
          rating: body.rating,
          hasComment: !!body.comment,
          hasImplicitSignals: !!body.implicitSignals,
        },
      });
    });

    return { success: true, message: 'Feedback submitted successfully' };
  }

  @Get('analytics')
  async getFeedbackAnalytics(@CurrentUser() user: AuthenticatedUser) {
    const userId = user.id;
    const analytics =
      await this.requestFeedbackService.getFeedbackAnalytics(userId);
    return { success: true, data: analytics };
  }

  @Get('analytics/global')
  async getGlobalFeedbackAnalytics(@CurrentUser() user: AuthenticatedUser) {
    const userId = user.id;
    const role = user.role;
    if (role !== 'admin' && role !== 'owner') {
      throw new ForbiddenException('Admin access required');
    }

    const analytics =
      await this.requestFeedbackService.getGlobalFeedbackAnalytics();

    this.logger.log('Business event: global_feedback_analytics_retrieved', {
      category: 'request_feedback',
      metadata: { userId, userRole: role },
    });

    return { success: true, data: analytics };
  }

  @Get(':requestId/feedback')
  async getFeedbackByRequestId(
    @Param() params: RequestIdParamDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const { requestId } = params;
    const userId = user.id;

    const feedback =
      await this.requestFeedbackService.getFeedbackByRequestId(requestId);

    if (!feedback) {
      throw new NotFoundException('Feedback not found for this request');
    }

    if ((feedback as any).userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return { success: true, data: feedback };
  }

  @Put(':requestId/implicit-signals')
  async updateImplicitSignals(
    @Param() params: RequestIdParamDto,
    @Body() body: UpdateImplicitSignalsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const { requestId } = params;
    const userId = user.id;

    const signals: {
      copied?: boolean;
      conversationContinued?: boolean;
      immediateRephrase?: boolean;
      sessionDuration?: number;
      codeAccepted?: boolean;
    } = {};
    if (typeof body.copied === 'boolean') signals.copied = body.copied;
    if (typeof body.conversationContinued === 'boolean')
      signals.conversationContinued = body.conversationContinued;
    if (typeof body.immediateRephrase === 'boolean')
      signals.immediateRephrase = body.immediateRephrase;
    if (typeof body.sessionDuration === 'number' && body.sessionDuration >= 0)
      signals.sessionDuration = body.sessionDuration;
    if (typeof body.codeAccepted === 'boolean')
      signals.codeAccepted = body.codeAccepted;

    if (Object.keys(signals).length === 0) {
      throw new BadRequestException(
        'At least one valid implicit signal must be provided',
      );
    }

    await this.requestFeedbackService.updateImplicitSignals(requestId, signals);

    this.logger.log('Business event: implicit_signals_updated', {
      category: 'request_feedback',
      metadata: {
        userId,
        feedbackRequestId: requestId,
        signalsCount: Object.keys(signals).length,
        signals: Object.keys(signals),
      },
    });

    return {
      success: true,
      message: 'Implicit signals updated successfully',
    };
  }

  private queueBackgroundOperation(operation: () => Promise<void>): void {
    this.backgroundQueue.push(operation);
  }

  private startBackgroundProcessor(): void {
    this.backgroundProcessor = setInterval(async () => {
      if (this.backgroundQueue.length > 0) {
        const op = this.backgroundQueue.shift();
        if (op) {
          try {
            await op();
          } catch (err) {
            this.logger.error('Background operation failed', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    }, 1000);
  }
}
