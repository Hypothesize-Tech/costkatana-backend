import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { TraceService } from './trace.service';
import { IngestTraceDto } from './dto/ingest-trace.dto';

@Controller('api/traces')
@UseGuards(JwtAuthGuard)
export class TracesIngestController {
  constructor(private readonly traceService: TraceService) {}

  @Post('ingest')
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
