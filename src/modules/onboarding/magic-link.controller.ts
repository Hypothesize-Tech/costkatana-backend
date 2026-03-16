import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Res,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { MagicLinkService } from './magic-link.service';
import { RequestMagicLinkDto } from './dto';

@Controller('api/onboarding')
export class MagicLinkController {
  private readonly logger = new Logger(MagicLinkController.name);

  constructor(private readonly magicLinkService: MagicLinkService) {}

  /**
   * Request a magic link for onboarding
   * POST /magic-link
   */
  @Post('magic-link')
  @HttpCode(HttpStatus.OK)
  async requestMagicLink(@Body() dto: RequestMagicLinkDto) {
    try {
      await this.magicLinkService.requestMagicLink(dto.email, dto.redirectUrl);
      return {
        success: true,
        message: 'Magic link sent to your email',
      };
    } catch (error) {
      this.logger.error('Failed to request magic link', {
        email: dto.email,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Verify magic link token
   * GET /verify/:token
   */
  @Get('verify/:token')
  async verifyMagicLink(
    @Param('token') token: string,
    @Res() response: Response,
  ) {
    try {
      const result = await this.magicLinkService.verifyMagicLink(token);

      if (!result.valid) {
        throw new BadRequestException('Invalid or expired magic link');
      }

      // Redirect to completion page with token
      const redirectUrl = result.redirectUrl || '/onboarding/complete';
      const fullUrl = `${redirectUrl}?token=${token}&email=${encodeURIComponent(result.email!)}`;

      response.redirect(302, fullUrl);
    } catch (error) {
      this.logger.error('Failed to verify magic link', {
        token,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Complete magic link onboarding
   * GET /complete
   */
  @Get('complete')
  async completeMagicLinkOnboarding(@Res() response: Response) {
    try {
      const queryToken = response.req.query.token as string;
      const email = response.req.query.email as string;

      if (!queryToken || !email) {
        throw new BadRequestException('Missing token or email parameter');
      }

      const result = await this.magicLinkService.completeMagicLinkOnboarding(
        queryToken,
        email,
      );

      if (!result.success) {
        throw new BadRequestException(
          result.message || 'Failed to complete onboarding',
        );
      }

      // Redirect to dashboard or success page
      const successUrl = process.env.MAGIC_LINK_SUCCESS_URL || '/dashboard';
      response.redirect(302, successUrl);
    } catch (error) {
      this.logger.error('Failed to complete magic link onboarding', {
        error: error.message,
      });

      // Redirect to error page
      const errorUrl =
        process.env.MAGIC_LINK_ERROR_URL || '/login?error=magic-link-failed';
      response.redirect(302, errorUrl);
    }
  }
}
