import { Controller, Get, Logger, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { EvalsDashboardService } from './services/evals-dashboard.service';

@Controller('api/evals')
@UseGuards(JwtAuthGuard)
export class EvalsDashboardController {
  private readonly logger = new Logger(EvalsDashboardController.name);

  constructor(
    private readonly evalsDashboardService: EvalsDashboardService,
  ) {}

  @Get('dashboard')
  async getDashboard(
    @CurrentUser('id') userId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('modelName') modelName?: string,
    @Query('promptVersionId') promptVersionId?: string,
  ) {
    const dashboard = await this.evalsDashboardService.getDashboard({
      userId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      modelName,
      promptVersionId,
    });
    return { success: true, dashboard };
  }
}
