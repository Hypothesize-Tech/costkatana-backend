/**
 * Main Cortex Service (NestJS)
 *
 * Entry point for Cortex functionality, providing the same interface
 * as the Express cortexService for compatibility with middleware.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CortexCoreService } from './cortex-core.service';
import { CortexEncoderService } from './cortex-encoder.service';
import { CortexDecoderService } from './cortex-decoder.service';
import { CortexModelRouterService } from './cortex-model-router.service';
import { PricingRegistryService } from '../../pricing/services/pricing-registry.service';
import type {
  CortexServiceConfig,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- used in method param types
  CortexQuery,
  CortexResponse,
  ResponseMetrics,
  EncodeOptions,
  DecodeOptions,
  ModelSelection,
  CortexFrame,
  CortexProcessingRequest,
  CortexDecodingRequest,
} from '../types/cortex.types';

@Injectable()
export class CortexService {
  private readonly logger = new Logger(CortexService.name);
  private config: CortexServiceConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly cortexCoreService: CortexCoreService,
    private readonly cortexEncoderService: CortexEncoderService,
    private readonly cortexDecoderService: CortexDecoderService,
    private readonly cortexModelRouterService: CortexModelRouterService,
    private readonly pricingRegistryService: PricingRegistryService,
  ) {
    this.config = this.loadConfiguration();
  }

  /**
   * Load Cortex configuration from environment variables
   */
  private loadConfiguration(): CortexServiceConfig {
    return {
      enabled: this.configService.get<string>('CORTEX_ENABLED') !== 'false',
      mode:
        (this.configService.get<string>('CORTEX_MODE') as
          | 'mandatory'
          | 'optional'
          | 'disabled') || 'optional',

      optimization: {
        tokenReduction:
          this.configService.get<string>('CORTEX_TOKEN_REDUCTION') !== 'false',
        semanticCaching:
          this.configService.get<string>('CORTEX_SEMANTIC_CACHING') !== 'false',
      },

      models: {
        core:
          this.configService.get<string>('CORTEX_CORE_MODEL') ||
          'amazon.nova-pro-v1:0',
        encoder:
          this.configService.get<string>('CORTEX_ENCODER_MODEL') ||
          'amazon.nova-lite-v1:0',
        decoder:
          this.configService.get<string>('CORTEX_DECODER_MODEL') ||
          'amazon.nova-lite-v1:0',
      },

      gateway: {
        headerName:
          this.configService.get<string>('CORTEX_GATEWAY_HEADER') ||
          'x-cortex-enabled',
        queryParam:
          this.configService.get<string>('CORTEX_GATEWAY_QUERY_PARAM') ||
          'cortex',
        cookieName: this.configService.get<string>('CORTEX_GATEWAY_COOKIE'),
        defaultEnabled:
          this.configService.get<string>('CORTEX_GATEWAY_DEFAULT_ENABLED') ===
          'true',
      },

      performance: {
        maxConcurrentRequests: parseInt(
          this.configService.get<string>('CORTEX_MAX_CONCURRENT_REQUESTS') ||
            '10',
        ),
        requestTimeout: parseInt(
          this.configService.get<string>('CORTEX_REQUEST_TIMEOUT') || '30000',
        ),
        cacheTtl: parseInt(
          this.configService.get<string>('CORTEX_CACHE_TTL') || '3600000',
        ), // 1 hour
      },

      limits: {
        maxInputTokens: parseInt(
          this.configService.get<string>('CORTEX_MAX_INPUT_TOKENS') || '128000',
        ),
        maxOutputTokens: parseInt(
          this.configService.get<string>('CORTEX_MAX_OUTPUT_TOKENS') || '4096',
        ),
        maxRequestsPerMinute: parseInt(
          this.configService.get<string>('CORTEX_MAX_REQUESTS_PER_MINUTE') ||
            '60',
        ),
      },
    };
  }

  /**
   * Check if Cortex is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get Cortex configuration
   */
  getConfiguration(): CortexServiceConfig {
    return this.config;
  }

  /**
   * Process input through Cortex pipeline
   */
  async process(
    input: string,
    options: {
      useCache?: boolean;
      modelOverride?: string;
      coreModel?: string;
      encoderModel?: string;
      decoderModel?: string;
      encodeOptions?: EncodeOptions;
      decodeOptions?: DecodeOptions;
    } = {},
  ): Promise<{
    response: string;
    metrics: ResponseMetrics;
    optimized: boolean;
  }> {
    const startTime = Date.now();
    try {
      const coreModel =
        options.coreModel || this.config.models?.core || 'amazon.nova-pro-v1:0';
      const encoderModel =
        options.encoderModel ||
        this.config.models?.encoder ||
        'amazon.nova-lite-v1:0';
      const decoderModel =
        options.decoderModel ||
        this.config.models?.decoder ||
        'amazon.nova-lite-v1:0';

      // Encode: natural language -> Cortex frame
      const encodeResult = await this.cortexEncoderService.encode({
        text: input,
        language: 'en',
        config: {
          encoding: { model: encoderModel, strategy: 'balanced' },
          decoding: { model: decoderModel, style: 'formal' },
        },
      });

      const cortexFrame: CortexFrame = encodeResult.cortexFrame;

      // Process: Cortex frame -> optimized frame
      const processRequest: CortexProcessingRequest = {
        input: cortexFrame,
        operation: 'optimize',
        options: { preserveSemantics: true },
        metadata: { model: coreModel },
      };

      const processResult =
        await this.cortexCoreService.process(processRequest);
      const cortexResponse: CortexResponse = {
        output: processResult.output,
        modelUsed: coreModel,
        processingTime: processResult.processingTime,
        metadata: processResult.metadata as CortexResponse['metadata'],
      };

      // Decode: Cortex frame -> natural language
      const decodeRequest: CortexDecodingRequest = {
        cortexStructure: processResult.output,
        format: options.decodeOptions?.format || 'plain',
        style: options.decodeOptions?.style || 'formal',
      };

      const decodedResult =
        await this.cortexDecoderService.decode(decodeRequest);
      const responseText = decodedResult.text;

      const cacheHit = !!(
        this.config.optimization?.semanticCaching &&
        cortexResponse.metadata?.cacheHit === true
      );

      const metrics: ResponseMetrics = {
        inputTokens: this.estimateTokens(input),
        outputTokens: this.estimateTokens(responseText),
        processingTime: Date.now() - startTime,
        modelUsed: coreModel,
        cacheHit,
        costSavings: this.calculateCostSavings(input, responseText, {
          coreModel,
          encoderModel,
          decoderModel,
          reasoning: 'balanced-performance-cost',
        }),
        tokenReduction: this.calculateTokenReduction(input, responseText),
      };

      return {
        response: responseText,
        metrics,
        optimized: true,
      };
    } catch (error: unknown) {
      this.logger.error('Cortex processing error', {
        error,
        input: input.substring(0, 100),
      });

      return {
        response: input,
        metrics: {
          inputTokens: this.estimateTokens(input),
          outputTokens: this.estimateTokens(input),
          processingTime: 0,
          modelUsed: 'none',
          cacheHit: false,
          costSavings: 0,
          tokenReduction: 0,
        },
        optimized: false,
      };
    }
  }

  /**
   * Estimate token count for a string
   */
  private estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Calculate cost savings from Cortex optimization
   */
  private calculateCostSavings(
    input: string,
    output: string,
    modelSelection: ModelSelection,
  ): number {
    const inputTokens = this.estimateTokens(input);
    const outputTokens = this.estimateTokens(output);
    const originalCost = this.estimateCost(
      inputTokens + outputTokens,
      modelSelection.coreModel,
    );
    const optimizedCost = this.estimateCost(
      outputTokens,
      modelSelection.coreModel,
    );

    return Math.max(0, originalCost - optimizedCost);
  }

  /**
   * Calculate token reduction percentage
   */
  private calculateTokenReduction(input: string, output: string): number {
    const inputTokens = this.estimateTokens(input);
    const outputTokens = this.estimateTokens(output);

    if (inputTokens === 0) return 0;

    return Math.round(((inputTokens - outputTokens) / inputTokens) * 100);
  }

  /**
   * Estimate cost for tokens and model
   */
  private estimateCost(tokenCount: number, model: string): number {
    try {
      // Assume 70% input tokens, 30% output tokens for estimation
      const inputTokens = Math.round(tokenCount * 0.7);
      const outputTokens = Math.round(tokenCount * 0.3);

      const costResult = this.pricingRegistryService.calculateCost({
        modelId: model,
        inputTokens,
        outputTokens,
      });

      return costResult ? costResult.totalCost : 0;
    } catch (error) {
      this.logger.warn(
        `Failed to calculate cost for model ${model}, using fallback`,
        error,
      );
      // Fallback estimation if pricing registry fails
      return tokenCount * 0.0001; // Rough fallback rate
    }
  }
}
