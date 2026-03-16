import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { CortexService } from '../../modules/cortex/services/cortex.service';

@Injectable()
export class CortexGatewayMiddleware implements NestMiddleware {
  private readonly logger = new Logger(CortexGatewayMiddleware.name);
  private config: ReturnType<CortexService['getConfiguration']>;

  constructor(private readonly cortexService: CortexService) {
    this.config = this.cortexService.getConfiguration();
  }

  /**
   * Main middleware handler
   */
  use(req: Request, res: Response, next: NextFunction): void {
    try {
      // Check if Cortex should be enabled for this request
      const cortexEnabled = this.checkCortexEnabled(req);

      if (cortexEnabled) {
        // Extract Cortex options from request
        const options = this.extractCortexOptions(req);

        // Attach Cortex context to request
        req.cortex = {
          enabled: true,
          options,
          process: async (input: string) => {
            return this.cortexService.process(input, {
              useCache: options.useCache,
              modelOverride: options.modelOverride,
              coreModel: options.coreModel,
              encoderModel: options.encoderModel,
              decoderModel: options.decoderModel,
              encodeOptions: {
                compressionLevel: options.compressionLevel || 'aggressive',
                preserveContext: true,
              },
              decodeOptions: {
                format: options.format || 'plain',
                style: options.style || 'formal',
              },
            });
          },
        };

        // Log Cortex activation
        this.logger.debug('Cortex enabled for request', {
          path: req.path,
          method: req.method,
          options,
        });
      } else {
        req.cortex = {
          enabled: false,
        };
      }

      next();
    } catch (error) {
      this.logger.error('Cortex gateway middleware error', { error });
      // Continue without Cortex on error
      req.cortex = { enabled: false };
      next();
    }
  }

  /**
   * Check if Cortex should be enabled for this request
   */
  private checkCortexEnabled(req: Request): boolean {
    // If Cortex is globally disabled, return false
    if (!this.cortexService.isEnabled()) {
      return false;
    }

    // If mode is mandatory, always enable
    if (this.config.mode === 'mandatory') {
      return true;
    }

    // Check various sources for Cortex enablement

    // 1. Check headers (supporting multiple header names)
    const headerName =
      this.config.gateway?.headerName ?? 'x-costkatana-enable-cortex';
    const headerValue =
      req.headers[headerName] ||
      req.headers[headerName.toLowerCase()] ||
      req.headers['x-costkatana-enable-cortex'] ||
      req.headers['x-costkatana-enable-cortex'.toLowerCase()];
    if (headerValue === 'true' || headerValue === '1') {
      return true;
    }
    if (headerValue === 'false' || headerValue === '0') {
      return false;
    }

    // 2. Check query parameters
    const queryParam = this.config.gateway?.queryParam ?? 'cortex-enabled';
    const queryValue = req.query[queryParam] || req.query['cortex-enabled'];
    if (queryValue === 'true' || queryValue === '1') {
      return true;
    }
    if (queryValue === 'false' || queryValue === '0') {
      return false;
    }

    // 3. Check cookies if configured
    const cookieName = this.config.gateway?.cookieName;
    if (cookieName && req.cookies) {
      const cookieValue = req.cookies[cookieName];
      if (cookieValue === 'true' || cookieValue === '1') {
        return true;
      }
      if (cookieValue === 'false' || cookieValue === '0') {
        return false;
      }
    }

    // 4. Check route-specific configuration
    if (this.isOptimizationRoute(req.path)) {
      return true; // Always enable for optimization routes
    }

    // 5. Use default configuration
    return this.config.gateway?.defaultEnabled ?? false;
  }

  /**
   * Extract Cortex options from request
   */
  private extractCortexOptions(req: Request): any {
    const options: any = {};

    // Extract model overrides - now supporting individual model selection
    // Core model (for main reasoning)
    const coreModelHeader =
      req.headers['x-cortex-core-model'] ||
      req.headers['x-costkatana-cortex-core-model'] ||
      req.headers['x-cortex-model'] ||
      req.headers['x-costkatana-cortex-encoding-model'];
    if (coreModelHeader && typeof coreModelHeader === 'string') {
      options.coreModel = coreModelHeader;
      options.modelOverride = coreModelHeader; // Backward compatibility
    }

    // Encoder model (for NL to Cortex)
    const encoderModelHeader =
      req.headers['x-cortex-encoder-model'] ||
      req.headers['x-costkatana-cortex-encoding-model'];
    if (encoderModelHeader && typeof encoderModelHeader === 'string') {
      options.encoderModel = encoderModelHeader;
    }

    // Decoder model (for Cortex to NL)
    const decoderModelHeader =
      req.headers['x-cortex-decoder-model'] ||
      req.headers['x-costkatana-cortex-decoding-model'];
    if (decoderModelHeader && typeof decoderModelHeader === 'string') {
      options.decoderModel = decoderModelHeader;
    }

    // Extract cache preference
    const cacheHeader =
      req.headers['x-cortex-cache'] ||
      req.headers['x-costkatana-cortex-semantic-cache'];
    if (cacheHeader === 'false' || cacheHeader === '0') {
      options.useCache = false;
    }

    // Extract compression level
    const compressionHeader =
      req.headers['x-cortex-compression'] ||
      req.headers['x-costkatana-cortex-optimization-level'];
    if (
      compressionHeader &&
      ['none', 'basic', 'aggressive', 'neural'].includes(
        compressionHeader as string,
      )
    ) {
      options.compressionLevel = compressionHeader as
        | 'none'
        | 'basic'
        | 'aggressive'
        | 'neural';
    }

    // Extract format preference
    const formatHeader = req.headers['x-cortex-format'];
    if (
      formatHeader &&
      ['plain', 'markdown', 'html', 'json'].includes(formatHeader as string)
    ) {
      options.format = formatHeader as 'plain' | 'markdown' | 'html' | 'json';
    }

    // Extract style preference
    const styleHeader = req.headers['x-cortex-style'];
    if (
      styleHeader &&
      ['formal', 'casual', 'technical', 'simple'].includes(
        styleHeader as string,
      )
    ) {
      options.style = styleHeader as
        | 'formal'
        | 'casual'
        | 'technical'
        | 'simple';
    }

    // Also check query parameters as fallback
    if (req.query['cortex-core-model'] || req.query['cortex-model']) {
      options.coreModel = (req.query['cortex-core-model'] ||
        req.query['cortex-model']) as string;
      options.modelOverride = options.coreModel; // Backward compatibility
    }
    if (req.query['cortex-encoder-model']) {
      options.encoderModel = req.query['cortex-encoder-model'] as string;
    }
    if (req.query['cortex-decoder-model']) {
      options.decoderModel = req.query['cortex-decoder-model'] as string;
    }

    // Support for predefined model presets
    const modelPreset =
      req.headers['x-cortex-preset'] || req.query['cortex-preset'];
    if (modelPreset) {
      const presets = this.getModelPresets();
      if (presets[modelPreset as string]) {
        Object.assign(options, presets[modelPreset as string]);
      }
    }
    if (req.query['cortex-cache'] === 'false') {
      options.useCache = false;
    }
    if (req.query['cortex-compression']) {
      options.compressionLevel = req.query['cortex-compression'] as any;
    }

    return options;
  }

  /**
   * Check if this is an optimization route
   */
  private isOptimizationRoute(path: string): boolean {
    const optimizationRoutes = [
      '/api/optimize',
      '/api/ai/optimize',
      '/api/cost/optimize',
      '/api/requests/optimize',
      '/api/optimizations',
    ];

    return optimizationRoutes.some((route) => path.startsWith(route));
  }

  /**
   * Get predefined model presets for common scenarios
   */
  private getModelPresets(): Record<string, any> {
    return {
      'ultra-fast': {
        encoderModel: 'amazon.nova-micro-v1:0',
        decoderModel: 'amazon.nova-micro-v1:0',
        coreModel: 'amazon.nova-lite-v1:0',
      },
      balanced: {
        encoderModel: 'amazon.nova-lite-v1:0',
        decoderModel: 'amazon.nova-lite-v1:0',
        coreModel: 'amazon.nova-pro-v1:0',
      },
      'high-quality': {
        encoderModel: 'amazon.nova-pro-v1:0',
        decoderModel: 'amazon.nova-pro-v1:0',
        coreModel: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
      },
      'maximum-power': {
        encoderModel: 'amazon.nova-pro-v1:0',
        decoderModel: 'amazon.nova-pro-v1:0',
        coreModel: 'anthropic.claude-sonnet-4-5-20250929-v1:0', // Requires special access
      },
      'cost-optimized': {
        encoderModel: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
        decoderModel: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
        coreModel: 'amazon.nova-lite-v1:0',
      },
    };
  }
}
