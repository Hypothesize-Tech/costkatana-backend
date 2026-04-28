import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AxiosResponse } from 'axios';
import { BedrockService } from '../../bedrock/bedrock.service';
import { ProxyRequestConfig } from '../interfaces/gateway.interfaces';
import {
  buildBedrockAnthropicMessagesPayload,
  mapAnthropicApiModelToBedrockId,
} from '../utils/gateway-anthropic-bedrock.util';

/**
 * Serves Anthropic-shaped `POST /v1/messages` via AWS Bedrock when the gateway has no
 * Anthropic API key (neither `ANTHROPIC_API_KEY` nor a resolved provider key). Uses the
 * backend’s existing AWS credentials — no separate client env for this path.
 */
@Injectable()
export class GatewayAnthropicBedrockService {
  private readonly logger = new Logger(GatewayAnthropicBedrockService.name);

  /**
   * Returns an Axios-shaped response so the existing gateway pipeline (moderation, analytics) works.
   * Uses the incoming HTTP request object as the source of the JSON body.
   * For `stream: true`, use {@link executeStream} instead.
   */
  async execute(
    request: Request,
    proxyRequest: ProxyRequestConfig,
  ): Promise<AxiosResponse> {
    const rawBody = request.body as Record<string, unknown> | undefined;
    if (!rawBody || typeof rawBody !== 'object') {
      throw new BadRequestException({
        error: 'Invalid request body',
        message: 'Anthropic Messages API requires a JSON object body.',
      });
    }

    const body = rawBody;
    if (body.stream === true) {
      throw new BadRequestException({
        error: 'Invalid streaming invocation',
        message:
          'Streaming requests must use the gateway SSE path (handled in GatewayService).',
      });
    }

    const clientModel = typeof body.model === 'string' ? body.model : undefined;
    const bedrockModelId = mapAnthropicApiModelToBedrockId(clientModel);
    const payload = buildBedrockAnthropicMessagesPayload(body, {
      bedrockModelId,
      modelMaxTokens: BedrockService.getMaxTokensForModel(bedrockModelId),
      outputPricePer1M:
        BedrockService.getBedrockOutputPricePer1M(bedrockModelId),
    });

    this.logger.log('Routing Anthropic Messages request to Bedrock', {
      clientModel: clientModel ?? '(default)',
      bedrockModelId,
    });

    try {
      const result = await BedrockService.invokeClaudeMessagesOnBedrock(
        bedrockModelId,
        payload,
      );

      const responseBody: Record<string, unknown> = {
        ...result.body,
        ...(clientModel ? { model: clientModel } : {}),
      };

      return {
        data: responseBody,
        status: result.status,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        config: proxyRequest as AxiosResponse['config'],
      } as AxiosResponse;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error('Bedrock Anthropic gateway invocation failed', {
        message,
        bedrockModelId,
      });
      throw new ServiceUnavailableException({
        error: 'Bedrock invocation failed',
        message:
          'Cost Katana could not run this Claude request on AWS Bedrock. Ensure AWS credentials and Bedrock access are configured, or set ANTHROPIC_API_KEY for direct Anthropic.',
        details: message,
      });
    }
  }

  /**
   * Stream Anthropic Messages-compatible SSE: forwards each Bedrock stream chunk as
   * `data: {json}\\n\\n` (Anthropic-style event payloads). Output moderation is not applied
   * mid-stream; input firewall/budget still run in GatewayService before this runs.
   */
  async executeStream(
    request: Request,
    response: Response,
    _proxyRequest: ProxyRequestConfig,
  ): Promise<{
    fullText: string;
    inputTokens: number;
    outputTokens: number;
    mockResponseBody: Record<string, unknown>;
  }> {
    const rawBody = request.body as Record<string, unknown> | undefined;
    if (!rawBody || typeof rawBody !== 'object') {
      throw new BadRequestException({
        error: 'Invalid request body',
        message: 'Anthropic Messages API requires a JSON object body.',
      });
    }

    const body = rawBody;
    if (body.stream !== true) {
      throw new BadRequestException({
        error: 'Stream required',
        message: 'executeStream requires body.stream === true.',
      });
    }

    const clientModel = typeof body.model === 'string' ? body.model : undefined;
    const bedrockModelId = mapAnthropicApiModelToBedrockId(clientModel);
    const payload = buildBedrockAnthropicMessagesPayload(body, {
      bedrockModelId,
      modelMaxTokens: BedrockService.getMaxTokensForModel(bedrockModelId),
      outputPricePer1M:
        BedrockService.getBedrockOutputPricePer1M(bedrockModelId),
    });

    this.logger.log('Routing Anthropic Messages stream to Bedrock', {
      clientModel: clientModel ?? '(default)',
      bedrockModelId,
    });

    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');

    const resAny = response as Response & { flushHeaders?: () => void };
    if (typeof resAny.flushHeaders === 'function') {
      resAny.flushHeaders();
    }

    try {
      const stats = await BedrockService.invokeClaudeMessagesOnBedrockSse(
        bedrockModelId,
        payload,
        (line) => {
          if (!response.writableEnded) {
            response.write(line);
          }
        },
      );

      const mockResponseBody: Record<string, unknown> = {
        content: [{ type: 'text', text: stats.fullText }],
        usage: {
          input_tokens: stats.inputTokens,
          output_tokens: stats.outputTokens,
        },
        ...(clientModel ? { model: clientModel } : {}),
      };

      if (!response.writableEnded) {
        response.end();
      }

      return {
        fullText: stats.fullText,
        inputTokens: stats.inputTokens,
        outputTokens: stats.outputTokens,
        mockResponseBody,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error('Bedrock Anthropic gateway stream failed', {
        message,
        bedrockModelId,
      });
      if (!response.writableEnded) {
        const errPayload = JSON.stringify({
          type: 'error',
          error: {
            type: 'api_error',
            message,
          },
        });
        response.write(`data: ${errPayload}\n\n`);
        response.end();
      }
      throw new ServiceUnavailableException({
        error: 'Bedrock stream failed',
        message:
          'Cost Katana could not stream this Claude request on AWS Bedrock. Ensure AWS credentials and Bedrock access are configured, or set ANTHROPIC_API_KEY for direct Anthropic.',
        details: message,
      });
    }
  }
}
