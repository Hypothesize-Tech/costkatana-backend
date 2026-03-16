import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomBytes } from 'crypto';
import {
  MagicLinkToken,
  MagicLinkTokenDocument,
} from '../../schemas/user/magic-link-token.schema';
import { User } from '../../schemas/user/user.schema';
import { EmailService } from '../email/email.service';
import { OnboardingService } from './onboarding.service';

@Injectable()
export class MagicLinkService {
  private readonly logger = new Logger(MagicLinkService.name);

  constructor(
    @InjectModel(MagicLinkToken.name)
    private magicLinkTokenModel: Model<MagicLinkTokenDocument>,
    @InjectModel(User.name)
    private userModel: Model<User>,
    private emailService: EmailService,
    private onboardingService: OnboardingService,
  ) {}

  /**
   * Request a magic link for onboarding
   */
  async requestMagicLink(email: string, redirectUrl?: string): Promise<void> {
    try {
      // Check if user exists
      const existingUser = await this.userModel.findOne({ email }).exec();
      if (!existingUser) {
        throw new BadRequestException('User not found. Please register first.');
      }

      // Generate secure token
      const token = this.generateSecureToken();

      // Create magic link token record
      const magicLinkToken = new this.magicLinkTokenModel({
        email,
        token,
        used: false,
        metadata: {
          redirectUrl,
        },
      });

      await magicLinkToken.save();

      // Send email with magic link
      await this.sendMagicLinkEmail(email, token, redirectUrl);

      this.logger.log('Magic link requested', {
        email,
        token: token.substring(0, 8) + '...',
      });
    } catch (error) {
      this.logger.error('Failed to request magic link', {
        email,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Verify magic link token
   */
  async verifyMagicLink(token: string): Promise<{
    valid: boolean;
    email?: string;
    redirectUrl?: string;
    userId?: string;
  }> {
    try {
      const magicLinkToken = await this.magicLinkTokenModel
        .findOne({ token, used: false })
        .exec();

      if (!magicLinkToken) {
        return { valid: false };
      }

      // Check if token is expired (24 hours)
      const tokenAge = Date.now() - magicLinkToken.createdAt.getTime();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

      if (tokenAge > maxAge) {
        return { valid: false };
      }

      // Find user
      const user = await this.userModel
        .findOne({ email: magicLinkToken.email })
        .exec();
      if (!user) {
        return { valid: false };
      }

      return {
        valid: true,
        email: magicLinkToken.email,
        redirectUrl: magicLinkToken.metadata?.redirectUrl,
        userId: user._id.toString(),
      };
    } catch (error) {
      this.logger.error('Failed to verify magic link', {
        token,
        error: error.message,
      });
      return { valid: false };
    }
  }

  /**
   * Complete magic link onboarding
   */
  async completeMagicLinkOnboarding(
    token: string,
    email: string,
  ): Promise<{ success: boolean; message?: string; userId?: string }> {
    try {
      // Verify token
      const verification = await this.verifyMagicLink(token);
      if (!verification.valid || verification.email !== email) {
        throw new BadRequestException('Invalid magic link token');
      }

      // Mark token as used
      await this.magicLinkTokenModel.updateOne(
        { token },
        {
          used: true,
          usedAt: new Date(),
        },
      );

      await this.onboardingService.initializeOnboarding(verification.userId!);

      this.logger.log('Magic link onboarding completed', {
        email,
        userId: verification.userId,
      });

      return {
        success: true,
        userId: verification.userId,
      };
    } catch (error) {
      this.logger.error('Failed to complete magic link onboarding', {
        token,
        email,
        error: error.message,
      });
      return {
        success: false,
        message: error.message || 'Failed to complete onboarding',
      };
    }
  }

  /**
   * Generate a secure random token
   */
  private generateSecureToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Send magic link email
   */
  private async sendMagicLinkEmail(
    email: string,
    token: string,
    redirectUrl?: string,
  ): Promise<void> {
    try {
      const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      // Use redirectUrl as a query parameter if provided, otherwise build normal magic link
      const url = new URL(`${baseUrl}/magic-link/verify/${token}`);
      if (redirectUrl) {
        url.searchParams.append('redirectUrl', encodeURIComponent(redirectUrl));
      }
      const magicLinkUrl = url.toString();

      const subject = 'Complete your Cost Katana onboarding';
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Welcome to Cost Katana!</h2>
          <p>Click the link below to complete your onboarding and start optimizing your AI costs:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${magicLinkUrl}"
               style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
              Complete Onboarding
            </a>
          </div>
          <p>This link will expire in 24 hours for security reasons.</p>
          <p>If you didn't request this link, please ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #666; font-size: 12px;">
            Cost Katana - AI Cost Optimization Platform
          </p>
        </div>
      `;

      await this.emailService.sendEmail({
        to: email,
        subject,
        html,
      });

      this.logger.log('Magic link email sent', { email });
    } catch (error: any) {
      this.logger.error('Failed to send magic link email', {
        email,
        error: error?.message,
      });
      throw error;
    }
  }
}
