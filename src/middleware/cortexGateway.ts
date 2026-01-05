/**
 * Cortex Gateway Middleware
 * Enables optional Cortex processing in the API gateway
 */

import { Request, Response, NextFunction } from 'express';
import { cortexService } from '../services/cortexService';
import { loggingService } from '../services/logging.service';

declare global {
  namespace Express {
    interface Request {
      cortex?: {
        enabled: boolean;
        options?: {
          modelOverride?: string;
          coreModel?: string;
          encoderModel?: string;
          decoderModel?: string;
          useCache?: boolean;
          compressionLevel?: 'none' | 'basic' | 'aggressive' | 'neural';
          format?: 'plain' | 'markdown' | 'html' | 'json';
          style?: 'formal' | 'casual' | 'technical' | 'simple';
        };
        process?: (input: string) => Promise<{
          response: string;
          metrics: any;
          optimized: boolean;
        }>;
      };
    }
  }
}

export class CortexGatewayMiddleware {
  private config = cortexService.getConfiguration();
  
  /**
   * Main middleware handler
   */
  public handle = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
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
            return cortexService.process(input, {
              useCache: options.useCache,
              modelOverride: options.modelOverride,
              coreModel: options.coreModel,
              encoderModel: options.encoderModel,
              decoderModel: options.decoderModel,
              encodeOptions: {
                compressionLevel: options.compressionLevel || 'aggressive',
                preserveContext: true
              },
              decodeOptions: {
                format: options.format || 'plain',
                style: options.style || 'formal'
              }
            });
          }
        };
        
        // Log Cortex activation
        loggingService.debug('Cortex enabled for request', {
          path: req.path,
          method: req.method,
          options
        });
      } else {
        req.cortex = {
          enabled: false
        };
      }
      
      next();
    } catch (error) {
      loggingService.error('Cortex gateway middleware error', { error });
      // Continue without Cortex on error
      req.cortex = { enabled: false };
      next();
    }
  };
  
  /**
   * Check if Cortex should be enabled for this request
   */
  private checkCortexEnabled(req: Request): boolean {
    // If Cortex is globally disabled, return false
    if (!cortexService.isEnabled()) {
      return false;
    }
    
    // If mode is mandatory, always enable
    if (this.config.mode === 'mandatory') {
      return true;
    }
    
    // Check various sources for Cortex enablement
    
    // 1. Check headers
    const headerValue = req.headers[this.config.gateway.headerName] || 
                       req.headers[this.config.gateway.headerName.toLowerCase()];
    if (headerValue === 'true' || headerValue === '1') {
      return true;
    }
    if (headerValue === 'false' || headerValue === '0') {
      return false;
    }
    
    // 2. Check query parameters
    const queryValue = req.query[this.config.gateway.queryParam];
    if (queryValue === 'true' || queryValue === '1') {
      return true;
    }
    if (queryValue === 'false' || queryValue === '0') {
      return false;
    }
    
    // 3. Check cookies if configured
    if (this.config.gateway.cookieName && req.cookies) {
      const cookieValue = req.cookies[this.config.gateway.cookieName];
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
    return this.config.gateway.defaultEnabled;
  }
  
  /**
   * Extract Cortex options from request
   */
  private extractCortexOptions(req: Request): any {
    const options: any = {};
    
    // Extract model overrides - now supporting individual model selection
    // Core model (for main reasoning)
    const coreModelHeader = req.headers['x-cortex-core-model'] || req.headers['x-cortex-model'];
    if (coreModelHeader && typeof coreModelHeader === 'string') {
      options.coreModel = coreModelHeader;
      options.modelOverride = coreModelHeader; // Backward compatibility
    }
    
    // Encoder model (for NL to Cortex)
    const encoderModelHeader = req.headers['x-cortex-encoder-model'];
    if (encoderModelHeader && typeof encoderModelHeader === 'string') {
      options.encoderModel = encoderModelHeader;
    }
    
    // Decoder model (for Cortex to NL)
    const decoderModelHeader = req.headers['x-cortex-decoder-model'];
    if (decoderModelHeader && typeof decoderModelHeader === 'string') {
      options.decoderModel = decoderModelHeader;
    }
    
    // Extract cache preference
    const cacheHeader = req.headers['x-cortex-cache'];
    if (cacheHeader === 'false' || cacheHeader === '0') {
      options.useCache = false;
    }
    
    // Extract compression level
    const compressionHeader = req.headers['x-cortex-compression'];
    if (compressionHeader && ['none', 'basic', 'aggressive', 'neural'].includes(compressionHeader as string)) {
      options.compressionLevel = compressionHeader as 'none' | 'basic' | 'aggressive' | 'neural';
    }
    
    // Extract format preference
    const formatHeader = req.headers['x-cortex-format'];
    if (formatHeader && ['plain', 'markdown', 'html', 'json'].includes(formatHeader as string)) {
      options.format = formatHeader as 'plain' | 'markdown' | 'html' | 'json';
    }
    
    // Extract style preference
    const styleHeader = req.headers['x-cortex-style'];
    if (styleHeader && ['formal', 'casual', 'technical', 'simple'].includes(styleHeader as string)) {
      options.style = styleHeader as 'formal' | 'casual' | 'technical' | 'simple';
    }
    
    // Also check query parameters as fallback
    if (req.query['cortex-core-model'] || req.query['cortex-model']) {
      options.coreModel = (req.query['cortex-core-model'] || req.query['cortex-model']) as string;
      options.modelOverride = options.coreModel; // Backward compatibility
    }
    if (req.query['cortex-encoder-model']) {
      options.encoderModel = req.query['cortex-encoder-model'] as string;
    }
    if (req.query['cortex-decoder-model']) {
      options.decoderModel = req.query['cortex-decoder-model'] as string;
    }
    
    // Support for predefined model presets
    const modelPreset = req.headers['x-cortex-preset'] || req.query['cortex-preset'];
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
      '/api/requests/optimize'
    ];
    
    return optimizationRoutes.some(route => path.startsWith(route));
  }
  
  /**
   * Get predefined model presets for common scenarios
   */
  private getModelPresets(): Record<string, any> {
    return {
      'ultra-fast': {
        encoderModel: 'amazon.nova-micro-v1:0',
        decoderModel: 'amazon.nova-micro-v1:0',
        coreModel: 'amazon.nova-lite-v1:0'
      },
      'balanced': {
        encoderModel: 'amazon.nova-lite-v1:0',
        decoderModel: 'amazon.nova-lite-v1:0',
        coreModel: 'amazon.nova-pro-v1:0'
      },
      'high-quality': {
        encoderModel: 'amazon.nova-pro-v1:0',
        decoderModel: 'amazon.nova-pro-v1:0',
        coreModel: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0'
      },
      'maximum-power': {
        encoderModel: 'amazon.nova-pro-v1:0',
        decoderModel: 'amazon.nova-pro-v1:0',
        coreModel: 'anthropic.claude-3-opus-20240229-v1:0' // Requires special access
      },
      'cost-optimized': {
        encoderModel: 'anthropic.claude-3-5-haiku-20241022-v1:0',
        decoderModel: 'anthropic.claude-3-5-haiku-20241022-v1:0',
        coreModel: 'amazon.nova-lite-v1:0'
      }
    };
  }
  
  /**
   * Create response middleware to add Cortex metrics to response
   */
  public responseHandler = (req: Request, res: Response, next: NextFunction): void => {
    if (req.cortex?.enabled) {
      // Override res.json to add Cortex metadata
      const originalJson = res.json.bind(res);
      
      res.json = function(data: any) {
        // Add Cortex metadata if available
        if (req.cortex && req.cortex.enabled && data) {
          // Add metadata to response headers
          res.setHeader('X-Cortex-Optimized', 'true');
          
          // If the response has metrics, add them
          if (data._cortexMetrics) {
            res.setHeader('X-Cortex-Token-Reduction', data._cortexMetrics.tokenReduction || '0');
            res.setHeader('X-Cortex-Cost-Savings', data._cortexMetrics.costSavings || '0');
            res.setHeader('X-Cortex-Model-Used', data._cortexMetrics.modelUsed || 'none');
            res.setHeader('X-Cortex-Cache-Hit', data._cortexMetrics.cacheHit || 'false');
            
            // Remove internal metrics from response body unless debug mode
            if (process.env.NODE_ENV !== 'development') {
              delete data._cortexMetrics;
            }
          }
        }
        
        return originalJson(data);
      };
    }
    
    next();
  };
  
  /**
   * Error handler for Cortex-specific errors
   */
  public errorHandler = (err: Error, req: Request, res: Response, next: NextFunction): void => {
    if (req.cortex?.enabled && err.message?.includes('Cortex')) {
      loggingService.error('Cortex processing error', {
        error: err,
        path: req.path,
        method: req.method
      });
      
      // Continue without Cortex optimization on error
      res.setHeader('X-Cortex-Error', 'true');
      res.setHeader('X-Cortex-Error-Message', err.message);
      
      // Don't expose internal errors to client
      if (process.env.NODE_ENV === 'production') {
        err.message = 'Request processing failed';
      }
    }
    
    next(err);
  };
}

// Export singleton instance
export const cortexGatewayMiddleware = new CortexGatewayMiddleware();

// Export convenience middleware functions
export const enableCortex = cortexGatewayMiddleware.handle;
export const cortexResponse = cortexGatewayMiddleware.responseHandler;
export const cortexError = cortexGatewayMiddleware.errorHandler;



