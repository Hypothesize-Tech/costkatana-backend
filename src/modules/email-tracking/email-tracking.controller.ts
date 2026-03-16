/**
 * Email Tracking Controller (NestJS)
 *
 * Public endpoints for email open tracking (transparent pixel) and link click
 * tracking with redirect. Prefix is set on this controller only (no global API prefix).
 * Production-ready: returns real 1x1 GIF and performs redirects.
 */

import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { EmailTrackingService } from './email-tracking.service';

@Controller('api/email')
export class EmailTrackingController {
  constructor(private readonly emailTrackingService: EmailTrackingService) {}

  /**
   * Track email open via transparent pixel.
   * GET /email/track/open/:userId/:emailId
   * Returns 1x1 transparent GIF. On error still returns 200 with empty body so pixel loads.
   */
  @Public()
  @Get('track/open/:userId/:emailId')
  async trackOpen(
    @Param('userId') userId: string,
    @Param('emailId') emailId: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.emailTrackingService.recordOpen(userId, emailId);
    const pixel = this.emailTrackingService.getTrackingPixel();
    res.writeHead(200, {
      'Content-Type': 'image/gif',
      'Content-Length': pixel.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    });
    res.end(pixel);
  }

  /**
   * Track email link click and redirect to target URL.
   * GET /email/track/click/:userId/:emailId?url=<redirect_url>
   * If url is missing or invalid, redirects to FRONTEND_URL or https://costkatana.com.
   */
  @Public()
  @Get('track/click/:userId/:emailId')
  async trackClick(
    @Param('userId') userId: string,
    @Param('emailId') emailId: string,
    @Query('url') url: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const { redirectUrl } = await this.emailTrackingService.recordClick(
      userId,
      emailId,
      url,
    );
    res.redirect(redirectUrl);
  }
}
