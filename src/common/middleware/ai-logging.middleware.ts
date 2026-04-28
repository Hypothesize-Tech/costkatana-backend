import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';
import { PricingRegistryService } from '../../modules/pricing/services/pricing-registry.service';

/**
 * AI Logging Middleware
 * Specialized logging for AI requests and responses
 * Captures AI-specific metrics and debugging information
 */
@Injectable()
export class AiLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AiLoggingMiddleware.name);
  private aiLoggingEnabled: boolean;

  constructor(
    private configService: ConfigService,
    private pricingRegistryService: PricingRegistryService,
  ) {
    this.aiLoggingEnabled =
      this.configService.get('AI_LOGGING_ENABLED', 'true') === 'true';
  }

  async use(req: Request, res: Response, next: NextFunction) {
    // Defensive: if `this` was lost (e.g. middleware not bound), skip without throwing
    if (!this?.aiLoggingEnabled) {
      return next();
    }

    const startTime = Date.now();
    const isAiRequest = this.isAiRequest(req);

    if (isAiRequest) {
      const requestId =
        (req.headers['x-request-id'] as string) || this.generateRequestId();
      const userId = (req as any).user?.id;

      // Log AI request details
      this.logger.log('AI Request Started', {
        requestId,
        userId,
        endpoint: req.path,
        method: req.method,
        model: req.body?.model,
        promptLength:
          req.body?.messages?.reduce(
            (acc: number, msg: any) => acc + (msg.content?.length || 0),
            0,
          ) ||
          req.body?.prompt?.length ||
          0,
        hasAttachments: !!req.body?.attachments?.length,
        temperature: req.body?.temperature,
        maxTokens: req.body?.max_tokens || req.body?.maxTokens,
        stream: req.body?.stream,
        timestamp: new Date().toISOString(),
      });

      // Capture response for AI logging
      const originalSend = res.send;
      let responseBody: any = null;

      res.send = function (body: any) {
        responseBody = body;
        return originalSend.call(this, body);
      };

      res.on('finish', async () => {
        const duration = Date.now() - startTime;
        const statusCode = res.statusCode;

        if (statusCode < 400 && responseBody) {
          try {
            const responseData =
              typeof responseBody === 'string'
                ? JSON.parse(responseBody)
                : responseBody;

            // Log AI response metrics
            const u = responseData.usage;
            this.logger.log('AI Request Completed', {
              requestId,
              userId,
              endpoint: req.path,
              statusCode,
              duration,
              model: responseData.model || req.body?.model,
              tokensUsed:
                u?.total_tokens ||
                (u?.prompt_tokens || u?.input_tokens || 0) +
                  (u?.completion_tokens || u?.output_tokens || 0),
              promptTokens: u?.prompt_tokens ?? u?.input_tokens,
              completionTokens: u?.completion_tokens ?? u?.output_tokens,
              cacheReadInputTokens: u?.cache_read_input_tokens,
              cacheCreationInputTokens: u?.cache_creation_input_tokens,
              reasoningTokens: u?.completion_tokens_details?.reasoning_tokens,
              cost: this.calculateEstimatedCost(
                u,
                responseData.model || req.body?.model,
              ),
              finishReason: responseData.choices?.[0]?.finish_reason,
              responseLength:
                responseData.choices?.[0]?.message?.content?.length || 0,
              hasToolCalls:
                !!responseData.choices?.[0]?.message?.tool_calls?.length,
              timestamp: new Date().toISOString(),
            });
          } catch (parseError) {
            this.logger.warn('Failed to parse AI response for logging', {
              requestId,
              error:
                parseError instanceof Error
                  ? parseError.message
                  : String(parseError),
            });
          }
        } else if (statusCode >= 400) {
          // Log AI request failures
          this.logger.warn('AI Request Failed', {
            requestId,
            userId,
            endpoint: req.path,
            statusCode,
            duration,
            error: responseBody?.error || 'Unknown error',
            timestamp: new Date().toISOString(),
          });
        }
      });
    }

    next();
  }

  private isAiRequest(req: Request): boolean {
    const aiEndpoints = [
      '/api/chat',
      '/api/gateway',
      '/api/agent',
      '/api/optimization',
    ];

    return (
      aiEndpoints.some((endpoint) => req.path.startsWith(endpoint)) &&
      (req.method === 'POST' || req.method === 'PUT')
    );
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private calculateEstimatedCost(usage: any, model: string): number {
    if (!usage) return 0;

    try {
      const costResult = this.pricingRegistryService.calculateCost({
        modelId: model,
        inputTokens: usage.prompt_tokens ?? usage.input_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? usage.output_tokens ?? 0,
      });

      return costResult ? costResult.totalCost : 0;
    } catch (error) {
      this.logger.warn(
        `Failed to calculate cost for model ${model} in AI logging`,
        error,
      );
      // Fallback estimation
      const inputT = usage.prompt_tokens ?? usage.input_tokens ?? 0;
      const outputT = usage.completion_tokens ?? usage.output_tokens ?? 0;
      return (inputT + outputT) * 0.0001;
    }
  }
}
