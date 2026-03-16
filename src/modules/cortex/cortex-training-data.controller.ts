/**
 * Cortex Training Data Controller (NestJS)
 *
 * Production API for Cortex training data: stats, export, feedback, insights.
 * Path: api/cortex-training-data (per-controller prefix, no global api prefix).
 * Full parity with Express cortexTrainingData.controller and cortexTrainingData.routes.
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CortexTrainingDataPersistenceService } from './services/cortex-training-data-persistence.service';
import type { ExportFilters } from './services/cortex-training-data-persistence.service';
import { ExportTrainingDataQueryDto } from './dto/export-training-data-query.dto';
import { AddUserFeedbackDto } from './dto/add-user-feedback.dto';
import { TrainingInsightsQueryDto } from './dto/training-insights-query.dto';

@Controller('api/cortex-training-data')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class CortexTrainingDataController {
  constructor(
    private readonly persistence: CortexTrainingDataPersistenceService,
  ) {}

  /**
   * Get training data statistics
   * GET /api/cortex-training-data/stats
   */
  @Get('stats')
  getTrainingStats() {
    const stats = this.persistence.getStats();
    return { success: true, data: stats };
  }

  /**
   * Export training data for model training (with filters)
   * GET /api/cortex-training-data/export
   */
  @Get('export')
  async exportTrainingData(
    @CurrentUser('id') userId: string,
    @Query() query: ExportTrainingDataQueryDto,
    @CurrentUser() user?: { role?: string },
  ) {
    const filters: ExportFilters = {
      limit: query.limit ?? 1000,
    };
    if (query.startDate) filters.startDate = new Date(query.startDate);
    if (query.endDate) filters.endDate = new Date(query.endDate);
    if (query.complexity) filters.complexity = query.complexity;
    if (query.minTokenReduction != null)
      filters.minTokenReduction = query.minTokenReduction;
    if (user?.role !== 'admin') filters.userId = userId;

    const data = await this.persistence.exportTrainingData(filters);
    return {
      success: true,
      data,
      count: data.length,
      filters,
    };
  }

  /**
   * Add user feedback to training data
   * POST /api/cortex-training-data/feedback/:sessionId
   */
  @Post('feedback/:sessionId')
  async addUserFeedback(
    @Param('sessionId') sessionId: string,
    @Body() body: AddUserFeedbackDto,
  ) {
    if (!sessionId || String(sessionId).trim() === '') {
      throw new BadRequestException('Session ID is required');
    }
    if (body.rating != null && (body.rating < 1 || body.rating > 5)) {
      throw new BadRequestException('Rating must be between 1 and 5');
    }

    const feedback = {
      rating: body.rating,
      isSuccessful: body.isSuccessful ?? true,
      improvementSuggestions: body.improvementSuggestions ?? [],
    };
    await this.persistence.addUserFeedback(sessionId, feedback);
    return { success: true, message: 'Feedback added successfully' };
  }

  /**
   * Get training insights and analytics (basic stats immediately, detailed in background)
   * GET /api/cortex-training-data/insights
   */
  @Get('insights')
  async getTrainingInsights(
    @CurrentUser('id') userId: string,
    @Query() query: TrainingInsightsQueryDto,
    @CurrentUser() user?: { role?: string },
  ) {
    const filters: ExportFilters = {};
    if (query.startDate) filters.startDate = new Date(query.startDate);
    if (query.endDate) filters.endDate = new Date(query.endDate);
    if (query.complexity) filters.complexity = query.complexity;

    const isAdmin = user?.role === 'admin';
    this.persistence.triggerDetailedInsightsAsync(filters, userId, isAdmin);

    const basicInsights = await this.persistence.getBasicInsights(
      filters,
      userId,
      isAdmin,
    );

    return {
      success: true,
      data: basicInsights,
      filters: {
        startDate: query.startDate,
        endDate: query.endDate,
        complexity: query.complexity,
      },
      processing: true,
      message: 'Detailed insights are being generated in the background',
    };
  }
}
