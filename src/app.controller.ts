import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { AppService } from './app.service';
import { checkSentryHealth, getSentryConfig } from './config/sentry';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { SecurityDashboardGuard } from './common/guards/security-dashboard.guard';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getRoot(): { status: string; message: string } {
    return {
      status: 'ok',
      message: 'Cost Katana API Server',
    };
  }

  @Get('health')
  getHealthCheck(): { status: string } {
    return this.appService.getHealth();
  }

  @Get('api/health')
  getApiHealth(): { status: string } {
    return this.appService.getHealth();
  }

  @Get('api/version')
  getVersion(): { version: string } {
    return this.appService.getVersion();
  }

  /**
   * Sentry status endpoint for observability monitoring
   */
  @Get('sentry-status')
  getSentryStatus(): Record<string, unknown> {
    try {
      const sentryHealth = checkSentryHealth();
      const sentryConfig = getSentryConfig();

      return {
        service: 'sentry',
        status: sentryHealth.enabled ? 'operational' : 'disabled',
        configured: sentryHealth.configured,
        environment: sentryHealth.environment,
        release: sentryHealth.release,
        sampleRate: sentryConfig.sampleRate,
        tracesSampleRate: sentryConfig.tracesSampleRate,
        profilesSampleRate: sentryConfig.profilesSampleRate,
        enablePerformanceMonitoring: sentryConfig.enablePerformanceMonitoring,
        enableProfiling: sentryConfig.enableProfiling,
        timestamp: new Date().toISOString(),
        ...(sentryHealth.lastError && { lastError: sentryHealth.lastError }),
      };
    } catch (error) {
      throw new HttpException(
        {
          service: 'sentry',
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString(),
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Security monitoring dashboard (admin/security_monitoring only)
   */
  @Get('security-dashboard')
  @UseGuards(JwtAuthGuard, SecurityDashboardGuard)
  getSecurityDashboard(): {
    success: boolean;
    data: Record<string, never>;
    timestamp: string;
  } {
    return {
      success: true,
      data: {},
      timestamp: new Date().toISOString(),
    };
  }
}
