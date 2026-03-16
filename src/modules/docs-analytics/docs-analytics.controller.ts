import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  Req,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { DocsAnalyticsService } from './docs-analytics.service';
import { SubmitRatingDto } from './dto/submit-rating.dto';
import { SubmitFeedbackDto } from './dto/submit-feedback.dto';
import { TrackPageViewDto } from './dto/track-page-view.dto';
import { UpdatePageViewMetricsDto } from './dto/update-page-view-metrics.dto';
import { AISearchDto } from './dto/ai-search.dto';

@Controller('api/docs-analytics')
@Public()
export class DocsAnalyticsController {
  constructor(private readonly docsAnalyticsService: DocsAnalyticsService) {}

  // ==================== RATINGS ====================

  /**
   * POST /docs-analytics/ratings
   * Submit a page rating (thumbs up/down, optional star rating)
   */
  @Post('ratings')
  async submitRating(
    @Body() dto: SubmitRatingDto,
    @Req() req: any,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const result = await this.docsAnalyticsService.submitRating({
        pageId: dto.pageId,
        pagePath: dto.pagePath,
        rating: dto.rating,
        starRating: dto.starRating,
        sessionId: dto.sessionId,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });

      res.status(HttpStatus.CREATED).json({ success: true, data: result });
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to submit rating',
      });
    }
  }

  /**
   * GET /docs-analytics/ratings/:pageId
   * Get rating statistics for a page
   */
  @Get('ratings/:pageId')
  async getRatingStats(
    @Param('pageId') pageId: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const stats = await this.docsAnalyticsService.getRatingStats(pageId);
      res.json({ success: true, data: stats });
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get rating stats',
      });
    }
  }

  // ==================== FEEDBACK ====================

  /**
   * POST /docs-analytics/feedback
   * Submit detailed feedback for a page
   */
  @Post('feedback')
  async submitFeedback(
    @Body() dto: SubmitFeedbackDto,
    @Req() req: any,
    @Res() res: Response,
  ): Promise<void> {
    try {
      if (
        !['bug', 'improvement', 'question', 'other'].includes(dto.feedbackType)
      ) {
        res
          .status(HttpStatus.BAD_REQUEST)
          .json({ error: 'Invalid feedback type' });
        return;
      }

      if (dto.message.length > 2000) {
        res.status(HttpStatus.BAD_REQUEST).json({
          error: 'Message too long (max 2000 characters)',
        });
        return;
      }

      const result = await this.docsAnalyticsService.submitFeedback({
        pageId: dto.pageId,
        pagePath: dto.pagePath,
        feedbackType: dto.feedbackType,
        message: dto.message,
        email: dto.email,
        sessionId: dto.sessionId,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });

      res.status(HttpStatus.CREATED).json({ success: true, data: result });
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to submit feedback',
      });
    }
  }

  // ==================== PAGE VIEWS ====================

  /**
   * POST /docs-analytics/views
   * Track a page view
   */
  @Post('views')
  async trackPageView(
    @Body() dto: TrackPageViewDto,
    @Req() req: any,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const result = await this.docsAnalyticsService.trackPageView({
        pageId: dto.pageId,
        pagePath: dto.pagePath,
        sessionId: dto.sessionId,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        referrer: dto.referrer,
        deviceType: dto.deviceType,
      });

      res.status(HttpStatus.CREATED).json({ success: true, data: result });
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to track page view',
      });
    }
  }

  /**
   * PATCH /docs-analytics/views
   * Update page view metrics (time on page, scroll depth)
   */
  @Patch('views')
  async updatePageViewMetrics(
    @Body() dto: UpdatePageViewMetricsDto,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const result = await this.docsAnalyticsService.updatePageViewMetrics({
        pageId: dto.pageId,
        sessionId: dto.sessionId,
        timeOnPage: dto.timeOnPage,
        scrollDepth: dto.scrollDepth,
        sectionsViewed: dto.sectionsViewed,
      });

      res.json({ success: true, data: result });
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to update metrics',
      });
    }
  }

  /**
   * GET /docs-analytics/views/:pageId/stats
   * Get view statistics for a page
   */
  @Get('views/:pageId/stats')
  async getPageViewStats(
    @Param('pageId') pageId: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const stats = await this.docsAnalyticsService.getPageViewStats(pageId);
      res.json({ success: true, data: stats });
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get view stats',
      });
    }
  }

  // ==================== RECOMMENDATIONS ====================

  /**
   * GET /docs-analytics/recommendations
   * Get personalized content recommendations
   */
  @Get('recommendations')
  async getRecommendations(
    @Query('sessionId') sessionId: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      if (!sessionId) {
        res
          .status(HttpStatus.BAD_REQUEST)
          .json({ error: 'Missing sessionId query parameter' });
        return;
      }

      const recommendations =
        await this.docsAnalyticsService.getRecommendations(sessionId);
      res.json({ success: true, data: recommendations });
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get recommendations',
      });
    }
  }

  // ==================== AI SEARCH ====================

  /**
   * POST /docs-analytics/ai-search
   * AI-powered semantic search for documentation
   */
  @Post('ai-search')
  async aiSearch(
    @Body() dto: AISearchDto,
    @Res() res: Response,
  ): Promise<void> {
    try {
      if (
        !dto.query ||
        typeof dto.query !== 'string' ||
        dto.query.trim().length === 0
      ) {
        res
          .status(HttpStatus.BAD_REQUEST)
          .json({ error: 'Missing or invalid query parameter' });
        return;
      }

      if (dto.query.length < 2) {
        res.status(HttpStatus.BAD_REQUEST).json({
          error: 'Query must be at least 2 characters long',
        });
        return;
      }

      const result = await this.docsAnalyticsService.aiSearch(dto.query.trim());
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to perform AI search',
      });
    }
  }

  // ==================== PAGE META ====================

  /**
   * GET /docs-analytics/page-meta/:pageId
   * Get page metadata (last updated, views, helpfulness)
   */
  @Get('page-meta/:pageId')
  async getPageMeta(
    @Param('pageId') pageId: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const meta = await this.docsAnalyticsService.getPageMeta(pageId);
      res.json({ success: true, data: meta });
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get page meta',
      });
    }
  }

  // ==================== OVERALL STATS ====================

  /**
   * GET /docs-analytics/stats
   * Get overall documentation analytics
   */
  @Get('stats')
  async getOverallStats(@Res() res: Response): Promise<void> {
    try {
      const stats = await this.docsAnalyticsService.getOverallStats();
      res.json({ success: true, data: stats });
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        error: 'Failed to get stats',
      });
    }
  }
}
