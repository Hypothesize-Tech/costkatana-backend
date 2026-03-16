import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpStatus,
  HttpCode,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import {
  RequestScoringService,
  ScoreRequestData,
} from './request-scoring.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('api/training')
export class RequestScoringController {
  constructor(private readonly requestScoringService: RequestScoringService) {}

  /**
   * Score a request for training quality
   * POST /api/training/score
   */
  @Post('score')
  @HttpCode(HttpStatus.OK)
  async scoreRequest(
    @Body() scoreData: ScoreRequestData,
    @CurrentUser() user: any,
  ) {
    const userId = user.id || user._id?.toString();
    if (!userId) {
      throw new BadRequestException('User ID not found');
    }

    // Validate input
    if (!scoreData.requestId || !scoreData.score) {
      throw new BadRequestException('Request ID and score are required');
    }

    if (scoreData.score < 1 || scoreData.score > 5) {
      throw new BadRequestException('Score must be between 1 and 5');
    }

    const requestScore = await this.requestScoringService.scoreRequest(
      userId,
      scoreData,
    );

    return {
      success: true,
      data: requestScore,
      message: 'Request scored successfully',
    };
  }

  /**
   * Get score for a specific request
   * GET /api/training/score/:requestId
   */
  @Get('score/:requestId')
  async getRequestScore(
    @Param('requestId') requestId: string,
    @CurrentUser() user: any,
  ) {
    const userId = user.id || user._id?.toString();
    if (!userId) {
      throw new BadRequestException('User ID not found');
    }

    const requestScore = await this.requestScoringService.getRequestScore(
      userId,
      requestId,
    );

    if (!requestScore) {
      throw new NotFoundException('Request score not found');
    }

    return {
      success: true,
      data: requestScore,
    };
  }

  /**
   * Get all scores for the authenticated user
   * GET /api/training/scores
   */
  @Get('scores')
  async getUserScores(
    @Query()
    query: {
      minScore?: string;
      maxScore?: string;
      isTrainingCandidate?: string;
      trainingTags?: string;
      limit?: string;
      offset?: string;
    },
    @CurrentUser() user: any,
  ) {
    const userId = user.id || user._id?.toString();
    if (!userId) {
      throw new BadRequestException('User ID not found');
    }

    const filters = {
      minScore: query.minScore ? parseInt(query.minScore, 10) : undefined,
      maxScore: query.maxScore ? parseInt(query.maxScore, 10) : undefined,
      isTrainingCandidate: query.isTrainingCandidate === 'true',
      trainingTags: query.trainingTags
        ? query.trainingTags.split(',')
        : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    };

    const scores = await this.requestScoringService.getUserScores(
      userId,
      filters,
    );

    return {
      success: true,
      data: scores,
      pagination: {
        limit: filters.limit,
        offset: filters.offset,
        total: scores.length,
      },
    };
  }

  /**
   * Get training candidates (high-scoring requests)
   * GET /api/training/candidates
   */
  @Get('candidates')
  async getTrainingCandidates(
    @Query()
    query: {
      minScore?: string;
      maxTokens?: string;
      maxCost?: string;
      providers?: string;
      models?: string;
      features?: string;
      limit?: string;
    },
    @CurrentUser() user: any,
  ) {
    const userId = user.id || user._id?.toString();
    if (!userId) {
      throw new BadRequestException('User ID not found');
    }

    const filters = {
      minScore: query.minScore ? parseInt(query.minScore, 10) : 4,
      maxTokens: query.maxTokens ? parseInt(query.maxTokens, 10) : undefined,
      maxCost: query.maxCost ? parseFloat(query.maxCost) : undefined,
      providers: query.providers ? query.providers.split(',') : undefined,
      models: query.models ? query.models.split(',') : undefined,
      features: query.features ? query.features.split(',') : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : 100,
    };

    const candidates = await this.requestScoringService.getTrainingCandidates(
      userId,
      filters,
    );

    return {
      success: true,
      data: candidates,
      message: `Found ${candidates.length} training candidates`,
    };
  }

  /**
   * Get scoring analytics
   * GET /api/training/analytics
   */
  @Get('analytics')
  async getScoringAnalytics(@CurrentUser() user: any) {
    const userId = user.id || user._id?.toString();
    if (!userId) {
      throw new BadRequestException('User ID not found');
    }

    const analytics =
      await this.requestScoringService.getScoringAnalytics(userId);

    return {
      success: true,
      data: analytics,
    };
  }

  /**
   * Bulk score multiple requests
   * POST /api/training/score/bulk
   */
  @Post('score/bulk')
  @HttpCode(HttpStatus.OK)
  async bulkScoreRequests(
    @Body() body: { scores: ScoreRequestData[] },
    @CurrentUser() user: any,
  ) {
    const userId = user.id || user._id?.toString();
    if (!userId) {
      throw new BadRequestException('User ID not found');
    }

    const { scores } = body;

    if (!Array.isArray(scores) || scores.length === 0) {
      throw new BadRequestException('Scores array is required');
    }

    // Validate each score
    for (const scoreData of scores) {
      if (!scoreData.requestId || !scoreData.score) {
        throw new BadRequestException(
          'Each score must have requestId and score',
        );
      }
      if (scoreData.score < 1 || scoreData.score > 5) {
        throw new BadRequestException('All scores must be between 1 and 5');
      }
    }

    const results = await this.requestScoringService.bulkScoreRequests(
      userId,
      scores,
    );

    return {
      success: true,
      data: results,
      message: `Successfully scored ${results.length} requests`,
    };
  }

  /**
   * Delete a request score
   * DELETE /api/training/score/:requestId
   */
  @Delete('score/:requestId')
  async deleteScore(
    @Param('requestId') requestId: string,
    @CurrentUser() user: any,
  ) {
    const userId = user.id || user._id?.toString();
    if (!userId) {
      throw new BadRequestException('User ID not found');
    }

    const deleted = await this.requestScoringService.deleteScore(
      userId,
      requestId,
    );

    if (!deleted) {
      throw new NotFoundException('Request score not found');
    }

    return {
      success: true,
      message: 'Request score deleted successfully',
    };
  }
}
