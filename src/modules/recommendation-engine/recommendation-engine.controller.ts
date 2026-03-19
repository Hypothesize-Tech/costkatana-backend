import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RecommendationEngineService } from './recommendation-engine.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('api/recommendations')
@UseGuards(JwtAuthGuard)
export class RecommendationEngineController {
  constructor(
    private readonly recommendationEngineService: RecommendationEngineService,
  ) {}

  /**
   * Generate scaling and cost optimization recommendations for the user's usage
   */
  @Get()
  async getRecommendations(
    @CurrentUser('id') userId: string,
    @Query('hoursAhead') hoursAhead?: number,
  ) {
    const recommendations =
      await this.recommendationEngineService.generateRecommendations(
        userId,
        hoursAhead ?? 4,
      );
    const summary =
      this.recommendationEngineService.getRecommendationSummary(
        recommendations,
      );
    const alerts =
      this.recommendationEngineService.generateAlerts(recommendations);

    return {
      success: true,
      data: {
        recommendations,
        summary,
        alerts,
      },
    };
  }

  /**
   * Execute a recommendation (dry run by default)
   */
  @Post(':id/execute')
  async executeRecommendation(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: { dryRun?: boolean },
  ) {
    const result = await this.recommendationEngineService.executeRecommendation(
      id,
      userId,
      body.dryRun ?? true,
    );

    return {
      success: result.success,
      message: result.message,
      data: result.changes,
    };
  }
}
