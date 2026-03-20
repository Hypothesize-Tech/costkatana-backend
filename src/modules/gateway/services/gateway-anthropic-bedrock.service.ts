import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Request } from 'express';
import { AxiosResponse } from 'axios';
import { BedrockService } from '../../bedrock/bedrock.service';
import { ProxyRequestConfig } from '../interfaces/gateway.interfaces';
import {
  buildBedrockAnthropicMessagesPayload,
  mapAnthropicApiModelToBedrockId,
} from '../utils/gateway-anthropic-bedrock.util';

/**
 * Handles Anthropic Messages API requests via AWS Bedrock when the gateway has no
 * Anthropic API key (Cost Katana–hosted Claude).
 */
@Injectable()
export class GatewayAnthropicBedrockService {
  private readonly logger = new Logger(GatewayAnthropicBedrockService.name);

  /**
   * Returns an Axios-shaped response so the existing gateway pipeline (moderation, analytics) works.
   * Uses the incoming HTTP request object as the source of the JSON body.
   */
  async execute(
    request: Request,
    proxyRequest: ProxyRequestConfig,
  ): Promise<AxiosResponse> {
    // Use the request body directly, instead of proxyRequest.data
    const rawBody = request.body;
    if (!rawBody || typeof rawBody !== 'object') {
      throw new BadRequestException({
        error: 'Invalid request body',
        message: 'Anthropic Messages API requires a JSON object body.',
      });
    }

    const body = rawBody as Record<string, unknown>;
    if (body.stream === true) {
      throw new BadRequestException({
        error: 'Streaming unsupported',
        message:
          'Bedrock Anthropic fallback does not support stream: true. Omit stream or configure ANTHROPIC_API_KEY for direct Anthropic.',
      });
    }

    const clientModel =
      typeof body.model === 'string' ? body.model : undefined;
    const bedrockModelId = mapAnthropicApiModelToBedrockId(clientModel);
    const payload = buildBedrockAnthropicMessagesPayload(body);

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
        headers: {},
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
}
