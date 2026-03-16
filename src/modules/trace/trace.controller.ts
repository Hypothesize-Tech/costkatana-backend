import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Logger,
  ServiceUnavailableException,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { TraceService } from './trace.service';
import { ListSessionsQueryDto } from './dto/list-sessions-query.dto';
import { IngestTraceDto } from './dto/ingest-trace.dto';

const SUMMARY_TIMEOUT_MS = 15_000;

@Controller('api/v1')
@UseGuards(JwtAuthGuard)
export class TraceController {
  private readonly logger = new Logger(TraceController.name);

  constructor(private readonly traceService: TraceService) {}

  @Get('sessions')
  async listSessions(
    @Query() query: ListSessionsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const userId = user.id;
    const filters = {
      userId,
      label: query.label,
      from: query.from,
      to: query.to,
      status: query.status,
      source: query.source,
      minCost: query.minCost,
      maxCost: query.maxCost,
      minSpans: query.minSpans,
      maxSpans: query.maxSpans,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    };
    const result = await this.traceService.listSessions(filters);
    return { success: true, data: result };
  }

  @Get('sessions/summary')
  async getSessionsSummary(@CurrentUser() user: AuthenticatedUser) {
    const userId = user.id;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error('Summary calculation timeout')),
        SUMMARY_TIMEOUT_MS,
      );
    });
    const summaryPromise = this.traceService.getSessionsSummary(userId);
    try {
      const summary = await Promise.race([summaryPromise, timeoutPromise]);
      return { success: true, data: summary };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'Service temporarily unavailable') {
        throw new ServiceUnavailableException(message);
      }
      this.logger.error('getSessionsSummary failed', err);
      throw err;
    }
  }

  @Get('sessions/:id/graph')
  async getSessionGraph(
    @Param('id') sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    try {
      const graph = await this.traceService.getSessionGraph(sessionId, user.id);
      return { success: true, data: graph };
    } catch (err) {
      if (err instanceof Error && err.message === 'Session not found') {
        throw new NotFoundException('Session not found');
      }
      throw err;
    }
  }

  @Get('sessions/:id/details')
  async getSessionDetails(
    @Param('id') sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const details = await this.traceService.getSessionDetails(
      sessionId,
      user.id,
    );
    if (!details.session) {
      throw new NotFoundException('Session not found');
    }
    return { success: true, data: details };
  }

  @Post('sessions/:id/end')
  async endSession(
    @Param('id') sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const session = await this.traceService.endSession(sessionId, user.id);
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    return { success: true, data: session };
  }

  @Post('traces/ingest')
  async ingestTrace(
    @Body() body: IngestTraceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const userId = user.id;
    const result = await this.traceService.ingestTrace(
      {
        sessionId: body.sessionId,
        parentId: body.parentId,
        name: body.name,
        type: body.type,
        status: body.status,
        startedAt: body.startedAt,
        endedAt: body.endedAt,
        error: body.error,
        aiModel: body.aiModel,
        tokens: body.tokens,
        costUSD: body.costUSD,
        tool: body.tool,
        resourceIds: body.resourceIds,
        metadata: body.metadata,
      },
      userId,
    );
    return { success: true, data: result };
  }
}
