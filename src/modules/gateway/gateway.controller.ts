import {
  Controller,
  Get,
  Post,
  Delete,
  All,
  UseGuards,
  Query,
  Req,
  Res,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { GatewayAuthGuard } from './guards/gateway-auth.guard';
import { GatewayService } from './services/gateway.service';
import { GatewayAnalyticsService } from './services/gateway-analytics.service';

@Controller('api/gateway')
@UseGuards(GatewayAuthGuard)
export class GatewayController {
  private readonly logger = new Logger(GatewayController.name);

  constructor(
    private gatewayService: GatewayService,
    private analyticsService: GatewayAnalyticsService,
  ) {}

  /**
   * Gateway Health Check
   */
  @Get('health')
  async healthCheck(@Res() res: Response) {
    const result = await this.gatewayService.getHealthStatus();
    res.status(200).json({ success: true, data: result });
  }

  /**
   * Gateway Statistics (requires authentication)
   */
  @Get('stats')
  async getStats(@Res() res: Response) {
    const result = await this.gatewayService.getGatewayStats();
    res.status(200).json({
      success: true,
      data: result,
    });
  }

  /**
   * Cache Management Routes (requires authentication)
   */
  @Get('cache/stats')
  async getCacheStats(@Res() res: Response) {
    const data = await this.gatewayService.getCacheStats();
    res.status(200).json({
      success: true,
      data,
    });
  }

  @Delete('cache')
  async clearCache(
    @Res() res: Response,
    @Query('userScope') userScope?: string,
    @Query('model') model?: string,
    @Query('provider') provider?: string,
  ) {
    const result = await this.gatewayService.clearCache({
      userId: userScope,
      model,
      provider,
    });
    res.status(result.success ? 200 : 500).json(result);
  }

  /**
   * Priority Queue Status (requires authentication)
   */
  @Get('queue/status')
  async getQueueStatus(@Res() res: Response) {
    const result = await this.gatewayService.getQueueStatus();
    res.status(result.success ? 200 : 500).json(result);
  }

  /**
   * Failover Analytics Routes (requires authentication)
   */
  @Get('failover/analytics')
  async getFailoverAnalytics(@Res() res: Response) {
    const result = await this.gatewayService.getFailoverAnalytics();
    res.status(result.success ? 200 : 500).json(result);
  }

  /**
   * Firewall Analytics Routes (requires authentication)
   */
  @Get('firewall/analytics')
  async getFirewallAnalytics(
    @Res() res: Response,
    @Query('userId') userId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const dateRange =
      startDate && endDate
        ? {
            start: new Date(startDate),
            end: new Date(endDate),
          }
        : undefined;

    const result = await this.gatewayService.getFirewallAnalytics(
      userId,
      dateRange,
    );
    res.status(result.success ? 200 : 500).json(result);
  }

  /**
   * OpenAI Compatible Routes
   * These routes are commonly used by OpenAI SDK and similar clients
   */
  @Post('v1/chat/completions')
  async openAIChatCompletions(@Req() req: Request, @Res() res: Response) {
    await this.gatewayService.processGatewayRequest(req, res);
  }

  @Post('v1/completions')
  async openAICompletions(@Req() req: Request, @Res() res: Response) {
    await this.gatewayService.processGatewayRequest(req, res);
  }

  @Post('v1/embeddings')
  async openAIEmbeddings(@Req() req: Request, @Res() res: Response) {
    await this.gatewayService.processGatewayRequest(req, res);
  }

  @Post('v1/images/generations')
  async openAIImages(@Req() req: Request, @Res() res: Response) {
    await this.gatewayService.processGatewayRequest(req, res);
  }

  @Post('v1/audio/transcriptions')
  async openAIAudioTranscriptions(@Req() req: Request, @Res() res: Response) {
    await this.gatewayService.processGatewayRequest(req, res);
  }

  @Post('v1/audio/translations')
  async openAIAudioTranslations(@Req() req: Request, @Res() res: Response) {
    await this.gatewayService.processGatewayRequest(req, res);
  }

  @Get('v1/models')
  async openAIModels(@Req() req: Request, @Res() res: Response) {
    await this.gatewayService.processGatewayRequest(req, res);
  }

  @Get('v1/models/:model')
  async openAIModelDetails(@Req() req: Request, @Res() res: Response) {
    await this.gatewayService.processGatewayRequest(req, res);
  }

  /**
   * Anthropic Compatible Routes
   */
  @Post('v1/messages')
  async anthropicMessages(@Req() req: Request, @Res() res: Response) {
    await this.gatewayService.processGatewayRequest(req, res);
  }

  @Post('v1/models/:model/generateContent')
  async googleGenerateContent(@Req() req: Request, @Res() res: Response) {
    await this.gatewayService.processGatewayRequest(req, res);
  }

  @Post('v1/models/:model/streamGenerateContent')
  async googleStreamGenerateContent(@Req() req: Request, @Res() res: Response) {
    await this.gatewayService.processGatewayRequest(req, res);
  }

  /**
   * AWS Bedrock Compatible Routes
   */
  @Post('model/:model/invoke')
  async bedrockInvoke(@Req() req: Request, @Res() res: Response) {
    await this.gatewayService.processGatewayRequest(req, res);
  }

  @Post('model/:model/invoke-with-response-stream')
  async bedrockInvokeWithStream(@Req() req: Request, @Res() res: Response) {
    await this.gatewayService.processGatewayRequest(req, res);
  }

  /**
   * Cohere Compatible Routes
   */
  @Post('v1/generate')
  async cohereGenerate(@Req() req: Request, @Res() res: Response) {
    await this.gatewayService.processGatewayRequest(req, res);
  }

  @Post('v1/embed')
  async cohereEmbed(@Req() req: Request, @Res() res: Response) {
    await this.gatewayService.processGatewayRequest(req, res);
  }

  @Post('v1/rerank')
  async cohereRerank(@Req() req: Request, @Res() res: Response) {
    await this.gatewayService.processGatewayRequest(req, res);
  }

  /**
   * Generic catch-all route for any other endpoints.
   * This allows the gateway to proxy any API endpoint.
   */
  @All('*')
  async catchAllProxy(@Req() req: Request, @Res() res: Response) {
    // Log that we're hitting the catch-all route with full request details
    this.logger.debug('Catch-all proxy route matched', {
      method: req.method,
      path: req.path,
      originalUrl: req.originalUrl,
      routeParams: req.params,
      query: req.query,
      headers: req.headers,
    });

    try {
      await this.gatewayService.processGatewayRequest(req, res);
    } catch (error) {
      this.logger.error('Error processing catch-all proxy route', {
        method: req.method,
        path: req.path,
        error: (error as Error)?.message,
      });
      // If response isn't already sent, send generic error
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Gateway processing failed',
          message: (error as Error)?.message ?? 'Unknown error',
        });
      }
    }
  }
}
