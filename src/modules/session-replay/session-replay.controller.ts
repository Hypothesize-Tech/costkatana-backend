import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { SessionReplayService } from './session-replay.service';
import {
  ListSessionsQueryDto,
  AddSnapshotDto,
  ExportSessionDto,
  ShareSessionDto,
  StartRecordingDto,
} from './dto';

@Controller('api/session-replay')
@UseGuards(JwtAuthGuard)
export class SessionReplayController {
  private readonly logger = new Logger(SessionReplayController.name);

  constructor(private readonly sessionReplayService: SessionReplayService) {}

  @Get('stats')
  async getStats(@CurrentUser() user: AuthenticatedUser) {
    const userId = user.id;
    if (this.sessionReplayService.isCircuitBreakerOpen()) {
      throw new ServiceUnavailableException(
        'Service temporarily unavailable. Please try again later.',
      );
    }
    const stats = await this.sessionReplayService.getSessionStats(userId);
    return { success: true, data: stats };
  }

  @Get('list')
  async listSessionReplays(
    @Query() query: ListSessionsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const userId = query.userId ?? user.id;
    const filters = {
      userId,
      workspaceId: query.workspaceId,
      source: query.source,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      status: query.status,
      hasErrors: query.hasErrors,
      minCost: query.minCost,
      maxCost: query.maxCost,
      minTokens: query.minTokens,
      maxTokens: query.maxTokens,
      minDuration: query.minDuration,
      maxDuration: query.maxDuration,
      aiModel: query.aiModel,
      searchQuery: query.searchQuery,
      appFeature: query.appFeature,
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    };
    const result = await this.sessionReplayService.listSessionReplays(filters);
    return {
      success: true,
      data: result.sessions,
      meta: {
        total: result.total,
        page: result.page,
        totalPages: result.totalPages,
      },
    };
  }

  @Post('recording/start')
  async startRecording(
    @Body() dto: StartRecordingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const userId = dto.userId || user.id;
    const sessionId = await this.sessionReplayService.startRecording(
      userId,
      dto.feature,
      { ...dto.metadata, label: dto.label },
    );
    this.logger.log('In-app recording started', {
      sessionId,
      userId,
      feature: dto.feature,
    });
    return {
      success: true,
      sessionId,
      message: 'Recording session started',
    };
  }

  @Get(':sessionId/player')
  async getSessionPlayer(@Param('sessionId') sessionId: string) {
    const session = await this.sessionReplayService.getSessionReplay(sessionId);
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    const replayData = session.replayData ?? {};
    const playerData = {
      sessionId: session.sessionId,
      userId: session.userId,
      workspaceId: session.workspaceId,
      label: session.label,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      status: session.status,
      source: session.source,
      trackingEnabled: session.trackingEnabled,
      sessionReplayEnabled: session.sessionReplayEnabled,
      duration: session.endedAt
        ? session.endedAt.getTime() - session.startedAt.getTime()
        : Date.now() - session.startedAt.getTime(),
      summary: session.summary,
      timeline: {
        aiInteractions: replayData.aiInteractions ?? [],
        userActions: replayData.userActions ?? [],
        systemMetrics: replayData.systemMetrics ?? [],
      },
      codeSnapshots: replayData.codeContext ?? [],
      trackingHistory: session.trackingHistory ?? [],
    };
    return { success: true, data: playerData };
  }

  @Post(':sessionId/snapshot')
  async addSnapshot(
    @Param('sessionId') sessionId: string,
    @Body()
    dto: AddSnapshotDto & {
      latency?: number;
      provider?: string;
      requestMetadata?: Record<string, unknown>;
      responseMetadata?: Record<string, unknown>;
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (dto.aiInteraction) {
      await this.sessionReplayService.recordInteraction(sessionId, {
        model: dto.aiInteraction.model,
        prompt: dto.aiInteraction.prompt,
        response: dto.aiInteraction.response,
        parameters: dto.aiInteraction.parameters,
        tokens: dto.aiInteraction.tokens,
        cost: dto.aiInteraction.cost,
        latency: dto.latency,
        provider: dto.provider,
        requestMetadata: dto.requestMetadata,
        responseMetadata: dto.responseMetadata,
      });
    }
    if (dto.userAction) {
      await this.sessionReplayService.recordUserAction(sessionId, {
        action: dto.userAction.action,
        details: dto.userAction.details,
      });
    }
    if (dto.codeContext) {
      await this.sessionReplayService.recordCodeContext(sessionId, {
        filePath: dto.codeContext.filePath,
        content: dto.codeContext.content,
        language: dto.codeContext.language,
      });
    }
    if (dto.captureSystemMetrics) {
      await this.sessionReplayService.captureSystemMetrics(sessionId);
    }
    return { success: true, message: 'Snapshot added successfully' };
  }

  @Post(':sessionId/export')
  async exportSession(
    @Param('sessionId') sessionId: string,
    @Body() dto: ExportSessionDto,
  ) {
    const data = await this.sessionReplayService.exportSession(
      sessionId,
      dto.format,
    );
    return { success: true, data, format: dto.format };
  }

  @Post(':sessionId/share')
  async shareSession(
    @Param('sessionId') sessionId: string,
    @Body() dto: ShareSessionDto,
  ) {
    const shareInfo = await this.sessionReplayService.shareSession(sessionId, {
      accessLevel: dto.accessLevel,
      expiresIn: dto.expiresIn,
      password: dto.password,
    });
    return { success: true, data: shareInfo };
  }

  @Get(':sessionId')
  async getSessionReplay(@Param('sessionId') sessionId: string) {
    const session = await this.sessionReplayService.getSessionReplay(sessionId);
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    return { success: true, data: session };
  }
}
