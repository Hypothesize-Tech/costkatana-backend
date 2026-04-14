import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TopActionService } from './services/top-action.service';
import {
  DecisionContext,
  DecisionListFilters,
  SavingsSummary,
} from './types/decision-context';

@Controller('api/decisions')
@UseGuards(JwtAuthGuard)
export class DecisionLayerController {
  private readonly logger = new Logger(DecisionLayerController.name);

  constructor(private readonly topActionService: TopActionService) {}

  // Decision responses reflect rapidly-changing state. Disable HTTP caching
  // so a browser 304 never masks a just-applied/dismissed transition.
  @Get('top')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  @Header('Pragma', 'no-cache')
  @Header('Expires', '0')
  async getTop(
    @CurrentUser('id') userId: string,
  ): Promise<{ decision: DecisionContext | null }> {
    const decision = await this.topActionService.getTop(userId);
    return { decision };
  }

  @Get()
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  @Header('Pragma', 'no-cache')
  @Header('Expires', '0')
  async list(
    @CurrentUser('id') userId: string,
    @Query('urgency') urgency?: string,
    @Query('state') state?: string,
    @Query('team') team?: string,
    @Query('limit') limit?: string,
  ): Promise<{ decisions: DecisionContext[] }> {
    const filters: DecisionListFilters = {
      urgency: urgency as DecisionListFilters['urgency'],
      state: state as DecisionListFilters['state'],
      team,
      limit: limit ? Number(limit) : undefined,
    };
    const decisions = await this.topActionService.list(userId, filters);
    return { decisions };
  }

  @Get('savings-summary')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  async savingsSummary(
    @CurrentUser('id') userId: string,
    @Query('sinceDays') sinceDays?: string,
  ): Promise<SavingsSummary> {
    return this.topActionService.savingsSummary(
      userId,
      sinceDays ? Number(sinceDays) : 30,
    );
  }

  @Post(':id/apply')
  @HttpCode(HttpStatus.OK)
  async apply(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ): Promise<{ success: boolean; appliedAt: Date }> {
    return this.topActionService.apply(userId, id);
  }

  @Post(':id/dismiss')
  @HttpCode(HttpStatus.OK)
  async dismiss(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() body?: { reason?: string },
  ): Promise<{ success: boolean }> {
    return this.topActionService.dismiss(userId, id, body?.reason);
  }

  @Post(':id/snooze')
  @HttpCode(HttpStatus.OK)
  async snooze(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() body?: { durationMs?: number },
  ): Promise<{ success: boolean; expiresAt: Date }> {
    const duration =
      body?.durationMs && body.durationMs > 0
        ? body.durationMs
        : 7 * 24 * 60 * 60 * 1000;
    return this.topActionService.snooze(userId, id, duration);
  }
}
