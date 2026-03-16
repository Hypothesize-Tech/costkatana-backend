import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BusinessEventLoggingService } from '../../common/services/business-event-logging.service';
import { IntelligenceService } from './services/intelligence.service';
import { QualityService } from './services/quality.service';
import { ScoreQualityDto } from './dto/score-quality.dto';
import { CompareQualityDto } from './dto/compare-quality.dto';
import { TrackTipInteractionDto } from './dto/track-tip-interaction.dto';
import { UpdateQualityFeedbackDto } from './dto/update-quality-feedback.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Usage } from '../../schemas/core/usage.schema';
import { User } from '../../schemas/user/user.schema';

@Controller('api/intelligence')
@UseGuards(JwtAuthGuard)
export class IntelligenceController {
  constructor(
    private readonly intelligenceService: IntelligenceService,
    private readonly qualityService: QualityService,
    private readonly businessEventLoggingService: BusinessEventLoggingService,
    @InjectModel(Usage.name) private usageModel: Model<Usage>,
    @InjectModel(User.name) private userModel: Model<User>,
  ) {}

  @Get('tips/personalized')
  @HttpCode(HttpStatus.OK)
  async getPersonalizedTips(
    @CurrentUser('id') userId: string,
    @Query('limit') limit?: string,
  ) {
    const startTime = Date.now();
    const limitNum = limit ? parseInt(limit, 10) : 3;
    const tips = await this.intelligenceService.getPersonalizedTips(
      userId,
      isNaN(limitNum) ? 3 : limitNum,
    );

    this.businessEventLoggingService.logBusiness({
      event: 'personalized_tips_retrieved',
      category: 'intelligence_operations',
      value: Date.now() - startTime,
      metadata: {
        userId,
        limit: limitNum,
        tipsCount: tips.length,
        hasTips: tips.length > 0,
      },
    });

    return { success: true, data: tips };
  }

  @Get('tips/usage/:usageId')
  @HttpCode(HttpStatus.OK)
  async getTipsForUsage(
    @CurrentUser('id') userId: string,
    @Param('usageId') usageId: string,
  ) {
    const startTime = Date.now();
    const [usage, user] = await Promise.all([
      this.usageModel
        .findOne({
          _id: new Types.ObjectId(usageId),
          userId: new Types.ObjectId(userId),
        })
        .lean()
        .exec(),
      this.userModel
        .findById(userId)
        .select('subscription preferences')
        .lean()
        .exec(),
    ]);

    if (!usage) {
      throw new NotFoundException('Usage not found');
    }

    const tips = await this.intelligenceService.analyzeAndRecommendTips({
      usage: usage as any,
      user: user as any,
    });

    this.businessEventLoggingService.logBusiness({
      event: 'usage_specific_tips_retrieved',
      category: 'intelligence_operations',
      value: Date.now() - startTime,
      metadata: {
        userId,
        usageId,
        tipsCount: tips.length,
        hasTips: tips.length > 0,
        hasUser: !!user,
      },
    });

    return { success: true, data: tips };
  }

  @Post('tips/:tipId/interaction')
  @HttpCode(HttpStatus.OK)
  async trackTipInteraction(
    @CurrentUser('id') userId: string,
    @Param('tipId') tipId: string,
    @Body() dto: TrackTipInteractionDto,
  ) {
    const startTime = Date.now();
    await this.intelligenceService.trackTipInteraction(
      tipId,
      dto.interaction,
      userId,
    );

    this.businessEventLoggingService.logBusiness({
      event: 'tip_interaction_tracked',
      category: 'intelligence_operations',
      value: Date.now() - startTime,
      metadata: { userId, tipId, interaction: dto.interaction },
    });

    return { success: true, message: 'Interaction tracked' };
  }

  @Post('quality/score')
  @HttpCode(HttpStatus.OK)
  async scoreResponseQuality(
    @CurrentUser('id') userId: string,
    @Body() dto: ScoreQualityDto,
  ) {
    const startTime = Date.now();
    const assessment = await this.qualityService.scoreResponse(
      dto.prompt,
      dto.response,
      dto.expectedOutput,
      dto.method ?? 'hybrid',
    );

    this.businessEventLoggingService.logBusiness({
      event: 'response_quality_scored',
      category: 'intelligence_operations',
      value: Date.now() - startTime,
      metadata: {
        userId,
        hasPrompt: !!dto.prompt,
        hasResponse: !!dto.response,
        hasExpectedOutput: !!dto.expectedOutput,
        method: dto.method ?? 'hybrid',
        hasAssessment: !!assessment,
      },
    });

    return { success: true, data: assessment };
  }

  @Post('quality/compare')
  @HttpCode(HttpStatus.OK)
  async compareQuality(
    @CurrentUser('id') userId: string,
    @Body() dto: CompareQualityDto,
  ) {
    const startTime = Date.now();
    const comparison = await this.qualityService.compareQuality(
      dto.prompt,
      dto.originalResponse,
      dto.optimizedResponse,
      dto.costSavings,
    );

    const qualityScore = await this.qualityService.saveQualityScore({
      userId,
      originalScore: comparison.originalScore,
      optimizedScore: comparison.optimizedScore,
      scoringMethod: 'hybrid',
      costSavings: dto.costSavings,
      optimizationType: ['manual_comparison'],
    });

    this.businessEventLoggingService.logBusiness({
      event: 'quality_comparison_completed',
      category: 'intelligence_operations',
      value: Date.now() - startTime,
      metadata: {
        userId,
        hasPrompt: !!dto.prompt,
        hasOriginalResponse: !!dto.originalResponse,
        hasOptimizedResponse: !!dto.optimizedResponse,
        hasCostSavings: !!dto.costSavings,
        originalScore: comparison.originalScore,
        optimizedScore: comparison.optimizedScore,
        hasQualityScore: !!qualityScore,
      },
    });

    return {
      success: true,
      data: {
        comparison,
        scoreId: (qualityScore as any)._id,
      },
    };
  }

  @Get('quality/stats')
  @HttpCode(HttpStatus.OK)
  async getQualityStats(@CurrentUser('id') userId: string) {
    const startTime = Date.now();
    const stats = await this.qualityService.getUserQualityStats(userId);

    this.businessEventLoggingService.logBusiness({
      event: 'quality_statistics_retrieved',
      category: 'intelligence_operations',
      value: Date.now() - startTime,
      metadata: { userId, hasStats: !!stats },
    });

    return { success: true, data: stats };
  }

  @Put('quality/:scoreId/feedback')
  @HttpCode(HttpStatus.OK)
  async updateQualityFeedback(
    @CurrentUser('id') userId: string,
    @Param('scoreId') scoreId: string,
    @Body() dto: UpdateQualityFeedbackDto,
  ) {
    const startTime = Date.now();
    await this.qualityService.updateUserFeedback(scoreId, {
      rating: dto.rating,
      isAcceptable: dto.isAcceptable,
      comment: dto.comment,
    });

    this.businessEventLoggingService.logBusiness({
      event: 'quality_feedback_updated',
      category: 'intelligence_operations',
      value: Date.now() - startTime,
      metadata: {
        userId,
        scoreId,
        rating: dto.rating,
        isAcceptable: dto.isAcceptable,
        hasComment: !!dto.comment,
      },
    });

    return { success: true, message: 'Feedback updated' };
  }

  @Post('tips/initialize')
  @HttpCode(HttpStatus.OK)
  async initializeTips(@CurrentUser('id') userId: string) {
    const startTime = Date.now();
    await this.intelligenceService.initializeDefaultTips();

    this.businessEventLoggingService.logBusiness({
      event: 'default_tips_initialized',
      category: 'intelligence_operations',
      value: Date.now() - startTime,
      metadata: { userId },
    });

    return { success: true, message: 'Default tips initialized' };
  }
}
