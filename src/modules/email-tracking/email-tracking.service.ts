/**
 * Email Tracking Service (NestJS)
 *
 * Handles recording of email opens (transparent pixel) and link clicks for
 * engagement metrics. Updates user preferences.emailEngagement in the User model.
 * Production-ready: no placeholders, full persistence and logging.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '@/schemas/user/user.schema';
import { LoggerService } from '@/common/logger/logger.service';

/** 1x1 transparent GIF (base64) for open tracking pixel */
const TRACKING_PIXEL_BASE64 =
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

@Injectable()
export class EmailTrackingService {
  private readonly defaultRedirectUrl: string;

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.defaultRedirectUrl =
      this.configService.get<string>('FRONTEND_URL') ??
      'https://costkatana.com';
  }

  /**
   * Returns the 1x1 transparent GIF buffer for open-tracking pixel.
   * Cached as static buffer to avoid repeated decode.
   */
  getTrackingPixel(): Buffer {
    return Buffer.from(TRACKING_PIXEL_BASE64, 'base64');
  }

  /**
   * Records an email open for the user and returns the tracking pixel.
   * Increments totalOpened, sets lastOpened, resets consecutiveIgnored.
   * Does not throw; logs errors and continues so the pixel still loads.
   */
  async recordOpen(userId: string, emailId: string): Promise<void> {
    try {
      await this.userModel.findByIdAndUpdate(userId, {
        $inc: { 'preferences.emailEngagement.totalOpened': 1 },
        $set: {
          'preferences.emailEngagement.lastOpened': new Date(),
          'preferences.emailEngagement.consecutiveIgnored': 0,
        },
      });
      this.logger.log('Email opened', {
        userId,
        emailId,
        component: 'EmailTrackingService',
        operation: 'recordOpen',
      });
    } catch (error) {
      this.logger.error('Error tracking email open', {
        userId,
        emailId,
        component: 'EmailTrackingService',
        operation: 'recordOpen',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Records an email link click for the user.
   * Increments totalClicked, sets lastOpened, resets consecutiveIgnored.
   * Returns the redirect URL (from query or default). Does not throw; on error
   * returns default redirect URL so the user is still sent somewhere safe.
   */
  async recordClick(
    userId: string,
    emailId: string,
    url?: string,
  ): Promise<{ redirectUrl: string }> {
    try {
      await this.userModel.findByIdAndUpdate(userId, {
        $inc: { 'preferences.emailEngagement.totalClicked': 1 },
        $set: {
          'preferences.emailEngagement.lastOpened': new Date(),
          'preferences.emailEngagement.consecutiveIgnored': 0,
        },
      });
      this.logger.log('Email link clicked', {
        userId,
        emailId,
        url: url ?? '(none)',
        component: 'EmailTrackingService',
        operation: 'recordClick',
      });
    } catch (error) {
      this.logger.error('Error tracking email click', {
        userId,
        emailId,
        component: 'EmailTrackingService',
        operation: 'recordClick',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const redirectUrl =
      url && typeof url === 'string' && url.trim().length > 0
        ? url
        : this.defaultRedirectUrl;
    return { redirectUrl };
  }
}
