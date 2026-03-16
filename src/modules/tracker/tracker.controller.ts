import {
  Controller,
  Post,
  Body,
  UseGuards,
  Logger,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { TrackerService } from './tracker.service';
import { TrackerRequestDto } from './dto/tracker-request.dto';
import { SyncHistoricalDto } from './dto/sync-historical.dto';

@Controller('api/tracker')
@UseGuards(JwtAuthGuard)
export class TrackerController {
  private readonly logger = new Logger(TrackerController.name);

  constructor(private readonly trackerService: TrackerService) {}

  @Post('request')
  async makeTrackedRequest(
    @Body() body: TrackerRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const userId = user.id;
    const response = await this.trackerService.makeTrackedRequest(
      {
        model: body.model,
        prompt: body.prompt,
        maxTokens: body.maxTokens,
        temperature: body.temperature,
      },
      userId,
      {
        source: 'api',
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      },
    );
    return {
      success: true,
      data: response,
    };
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  async syncHistorical(
    @Body() body: SyncHistoricalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const userId = user.id;
    const days = body.days ?? 30;

    this.trackerService.syncHistoricalData(userId, days).catch((err: any) => {
      this.logger.error('Background sync failed', err);
    });

    return {
      success: true,
      message: 'Historical data sync started',
    };
  }
}
