import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { GatewayContext } from '../interfaces/gateway.interfaces';

/** Express Request extended with gateway context (set by middleware/guard) */
type RequestWithGateway = Request & { gatewayContext?: GatewayContext };

@Injectable()
export class GatewayHeadersMiddleware implements NestMiddleware {
  private readonly logger = new Logger(GatewayHeadersMiddleware.name);

  async use(req: RequestWithGateway, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const requestId = (req.headers['x-request-id'] as string) || 'unknown';

    try {
      this.logger.log('=== GATEWAY HEADERS MIDDLEWARE STARTED ===', {
        component: 'GatewayHeadersMiddleware',
        operation: 'use',
        type: 'gateway_headers_processing',
        requestId,
        path: req.originalUrl,
        method: req.method,
      });

      // Initialize gateway context if not already present
      if (!req.gatewayContext) {
        req.gatewayContext = {
          startTime,
          requestId,
        } as GatewayContext;
      }

      const context = req.gatewayContext;

      // Process all CostKatana headers
      this.processCostKatanaHeaders(req, context);

      // Process custom CostKatana-Property-* headers
      this.processCustomProperties(req, context);

      this.logger.log('Gateway headers processed successfully', {
        component: 'GatewayHeadersMiddleware',
        operation: 'use',
        type: 'gateway_headers_processed',
        requestId,
        headerCount: Object.keys(context.properties || {}).length,
        processingTime: `${Date.now() - startTime}ms`,
      });

      this.logger.log('=== GATEWAY HEADERS MIDDLEWARE COMPLETED ===', {
        component: 'GatewayHeadersMiddleware',
        operation: 'use',
        type: 'gateway_headers_completed',
        requestId,
        processingTime: `${Date.now() - startTime}ms`,
      });

      next();
    } catch (error) {
      this.logger.error('Gateway headers middleware error', {
        component: 'GatewayHeadersMiddleware',
        operation: 'use',
        type: 'gateway_headers_error',
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTime: `${Date.now() - startTime}ms`,
      });

      // Don't block on header processing errors
      next();
    }
  }

  private processCostKatanaHeaders(
    req: RequestWithGateway,
    context: GatewayContext,
  ): void {
    // Core routing headers
    context.targetUrl = req.headers['costkatana-target-url'] as string;
    context.projectId = req.headers['costkatana-project-id'] as string;
    context.workspaceId = req.headers['costkatana-workspace-id'] as string;

    // Authentication method override
    const authMethodOverride = req.headers['costkatana-auth-method'] as string;
    if (
      authMethodOverride &&
      (authMethodOverride === 'gateway' ||
        authMethodOverride === 'standard' ||
        authMethodOverride === 'agent')
    ) {
      context.authMethodOverride = authMethodOverride;
    }

    // Feature flags
    context.cacheEnabled = req.headers['costkatana-cache-enabled'] !== 'false';
    context.retryEnabled = req.headers['costkatana-retry-enabled'] !== 'false';
    context.securityEnabled =
      req.headers['costkatana-llm-security-enabled'] !== 'false';
    context.omitRequest = req.headers['costkatana-omit-request'] === 'true';
    context.omitResponse = req.headers['costkatana-omit-response'] === 'true';

    // Rate limiting
    context.rateLimitPolicy =
      (req.headers['costkatana-ratelimit-policy'] as string) || 'default';

    // Firewall configuration
    context.firewallEnabled =
      req.headers['costkatana-firewall-enabled'] === 'true';
    context.firewallAdvanced =
      req.headers['costkatana-firewall-advanced'] === 'true';

    // Firewall thresholds
    const promptThreshold = req.headers[
      'costkatana-firewall-prompt-threshold'
    ] as string;
    if (promptThreshold) {
      const threshold = parseFloat(promptThreshold);
      if (!isNaN(threshold) && threshold >= 0 && threshold <= 1) {
        context.firewallPromptThreshold = threshold;
      }
    }

    const llamaThreshold = req.headers[
      'costkatana-firewall-llama-threshold'
    ] as string;
    if (llamaThreshold) {
      const threshold = parseFloat(llamaThreshold);
      if (!isNaN(threshold) && threshold >= 0 && threshold <= 1) {
        context.firewallLlamaThreshold = threshold;
      }
    }

    // Tracing and logging
    context.traceId =
      (req.headers['costkatana-trace-id'] as string) ||
      (req.headers['costkatana-property-trace-id'] as string);
    context.traceName = req.headers['costkatana-trace-name'] as string;
    context.traceStep = req.headers['costkatana-trace-step'] as string;

    const traceSequence = req.headers['costkatana-trace-sequence'] as string;
    if (traceSequence) {
      context.traceSequence = parseInt(traceSequence, 10) || 0;
    }

    // User and authentication context
    context.userId = req.headers['costkatana-user-id'] as string;
    context.budgetId = req.headers['costkatana-budget-id'] as string;
    context.sessionId = req.headers['costkatana-session-id'] as string;
    context.modelOverride = req.headers['costkatana-model-override'] as string;

    // Request ID for feedback tracking
    const requestIdHeader = req.headers['costkatana-request-id'] as string;
    if (requestIdHeader) {
      context.requestId = requestIdHeader;
    }

    // Caching configuration
    context.cacheUserScope = req.headers[
      'costkatana-cache-user-scope'
    ] as string;

    const cacheBucketSize = req.headers[
      'costkatana-cache-bucket-max-size'
    ] as string;
    if (cacheBucketSize) {
      const size = parseInt(cacheBucketSize);
      if (!isNaN(size) && size > 0 && size <= 10) {
        context.cacheBucketMaxSize = size;
      }
    }

    // Cache-Control header for TTL
    const cacheControl = req.headers['cache-control'] as string;
    if (cacheControl && cacheControl.includes('max-age=')) {
      const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
      if (maxAgeMatch) {
        context.cacheTTL = parseInt(maxAgeMatch[1]) * 1000; // Convert seconds to milliseconds
      }
    }

    // Retry configuration
    const retryCount = req.headers['costkatana-retry-count'] as string;
    if (retryCount) {
      const count = parseInt(retryCount);
      if (!isNaN(count) && count >= 0 && count <= 10) {
        context.retryCount = count;
      }
    }

    const retryFactor = req.headers['costkatana-retry-factor'] as string;
    if (retryFactor) {
      const factor = parseFloat(retryFactor);
      if (!isNaN(factor) && factor >= 1 && factor <= 5) {
        context.retryFactor = factor;
      }
    }

    const retryMinTimeout = req.headers[
      'costkatana-retry-min-timeout'
    ] as string;
    if (retryMinTimeout) {
      const timeout = parseInt(retryMinTimeout);
      if (!isNaN(timeout) && timeout >= 100 && timeout <= 60000) {
        context.retryMinTimeout = timeout;
      }
    }

    const retryMaxTimeout = req.headers[
      'costkatana-retry-max-timeout'
    ] as string;
    if (retryMaxTimeout) {
      const timeout = parseInt(retryMaxTimeout);
      if (!isNaN(timeout) && timeout >= 1000 && timeout <= 300000) {
        context.retryMaxTimeout = timeout;
      }
    }

    // Provider configuration
    context.provider = req.headers['costkatana-provider'] as string;
    context.providerKey = req.headers['costkatana-provider-key'] as string;
    context.proxyKeyId = req.headers['costkatana-proxy-key-id'] as string;

    // Failover configuration
    context.failoverEnabled =
      req.headers['costkatana-failover-enabled'] === 'true';
    context.failoverPolicy = req.headers[
      'costkatana-failover-policy'
    ] as string;
    context.isFailoverRequest =
      req.headers['costkatana-is-failover-request'] === 'true';

    // Semantic caching
    context.semanticCacheEnabled =
      req.headers['costkatana-semantic-cache-enabled'] !== 'false';
    context.deduplicationEnabled =
      req.headers['costkatana-deduplication-enabled'] !== 'false';

    const similarityThreshold = req.headers[
      'costkatana-similarity-threshold'
    ] as string;
    if (similarityThreshold) {
      const threshold = parseFloat(similarityThreshold);
      if (!isNaN(threshold) && threshold >= 0 && threshold <= 1) {
        context.similarityThreshold = threshold;
      } else {
        context.similarityThreshold = 0.85; // Default
      }
    } else {
      context.similarityThreshold = 0.85; // Default
    }

    // Usage tracking
    const inputTokens = req.headers['costkatana-input-tokens'] as string;
    if (inputTokens) {
      context.inputTokens = parseInt(inputTokens);
    }

    const outputTokens = req.headers['costkatana-output-tokens'] as string;
    if (outputTokens) {
      context.outputTokens = parseInt(outputTokens);
    }

    const cost = req.headers['costkatana-cost'] as string;
    if (cost) {
      context.cost = parseFloat(cost);
    }

    const estimatedCost = req.headers['costkatana-estimated-cost'] as string;
    if (estimatedCost) {
      context.estimatedCost = parseFloat(estimatedCost);
    }

    const simulationId = req.headers['costkatana-simulation-id'] as string;
    if (simulationId) {
      context.simulationId = simulationId;
    }

    // CORTEX PROCESSING PROPERTIES
    context.cortexEnabled = req.headers['costkatana-enable-cortex'] === 'true';
    context.cortexCoreModel =
      (req.headers['costkatana-cortex-core-model'] as string) ||
      'anthropic.claude-sonnet-4-5-20250929-v1:0';
    context.cortexEncodingModel =
      (req.headers['costkatana-cortex-encoding-model'] as string) ||
      'amazon.nova-pro-v1:0';
    context.cortexDecodingModel =
      (req.headers['costkatana-cortex-decoding-model'] as string) ||
      'amazon.nova-pro-v1:0';

    const cortexOperation = req.headers[
      'costkatana-cortex-operation'
    ] as string;
    if (
      cortexOperation &&
      ['optimize', 'compress', 'analyze', 'transform', 'sast'].includes(
        cortexOperation,
      )
    ) {
      context.cortexOperation = cortexOperation as
        | 'optimize'
        | 'compress'
        | 'analyze'
        | 'transform'
        | 'sast';
    } else {
      context.cortexOperation = 'optimize'; // Default
    }

    const cortexOutputStyle = req.headers[
      'costkatana-cortex-output-style'
    ] as string;
    if (
      cortexOutputStyle &&
      ['formal', 'casual', 'technical', 'conversational'].includes(
        cortexOutputStyle,
      )
    ) {
      context.cortexOutputStyle = cortexOutputStyle as
        | 'formal'
        | 'casual'
        | 'technical'
        | 'conversational';
    } else {
      context.cortexOutputStyle = 'conversational'; // Default
    }

    const cortexOutputFormat = req.headers[
      'costkatana-cortex-output-format'
    ] as string;
    if (
      cortexOutputFormat &&
      ['plain', 'markdown', 'structured'].includes(cortexOutputFormat)
    ) {
      context.cortexOutputFormat = cortexOutputFormat as
        | 'plain'
        | 'markdown'
        | 'structured';
    } else {
      context.cortexOutputFormat = 'plain'; // Default
    }

    context.cortexPreserveSemantics =
      req.headers['costkatana-cortex-preserve-semantics'] !== 'false';
    context.cortexSemanticCache =
      req.headers['costkatana-cortex-semantic-cache'] !== 'false';

    const cortexPriority = req.headers['costkatana-cortex-priority'] as string;
    if (
      cortexPriority &&
      ['cost', 'speed', 'quality', 'balanced'].includes(cortexPriority)
    ) {
      context.cortexPriority = cortexPriority as
        | 'cost'
        | 'speed'
        | 'quality'
        | 'balanced';
    } else {
      context.cortexPriority = 'balanced'; // Default
    }

    // Binary serialization
    context.cortexBinaryEnabled =
      req.headers['costkatana-cortex-binary-enabled'] === 'true';

    const cortexBinaryCompression = req.headers[
      'costkatana-cortex-binary-compression'
    ] as string;
    if (
      cortexBinaryCompression &&
      ['basic', 'standard', 'aggressive'].includes(cortexBinaryCompression)
    ) {
      context.cortexBinaryCompression = cortexBinaryCompression as
        | 'basic'
        | 'standard'
        | 'aggressive';
    } else {
      context.cortexBinaryCompression = 'standard'; // Default
    }

    // Schema validation
    context.cortexSchemaValidation =
      req.headers['costkatana-cortex-schema-validation'] !== 'false';
    context.cortexStrictValidation =
      req.headers['costkatana-cortex-strict-validation'] === 'true';

    // Advanced Cortex features
    context.cortexControlFlowEnabled =
      req.headers['costkatana-cortex-control-flow'] !== 'false';
    context.cortexHybridExecution =
      req.headers['costkatana-cortex-hybrid-execution'] !== 'false';
    context.cortexFragmentCache =
      req.headers['costkatana-cortex-fragment-cache'] !== 'false';

    // Cortex metadata
    const cortexMetadata = req.headers['costkatana-cortex-metadata'] as string;
    if (cortexMetadata) {
      try {
        context.cortexMetadata = JSON.parse(cortexMetadata);
      } catch (error) {
        this.logger.warn('Failed to parse cortex metadata header', {
          error: error instanceof Error ? error.message : 'Unknown error',
          metadata: cortexMetadata.substring(0, 100) + '...',
        });
      }
    }

    // Budget management
    const budgetReservationId = req.headers[
      'costkatana-budget-reservation-id'
    ] as string;
    if (budgetReservationId) {
      context.budgetReservationId = budgetReservationId;
    }

    // Agent configuration
    context.isAgentRequest =
      req.headers['costkatana-is-agent-request'] === 'true';

    const agentId = req.headers['costkatana-agent-id'] as string;
    if (agentId) {
      context.agentId = agentId;
    }

    const agentIdentityId = req.headers[
      'costkatana-agent-identity-id'
    ] as string;
    if (agentIdentityId) {
      context.agentIdentityId = agentIdentityId;
    }

    const agentToken = req.headers['costkatana-agent-token'] as string;
    if (agentToken) {
      context.agentToken = agentToken;
    }

    const agentType = req.headers['costkatana-agent-type'] as string;
    if (agentType) {
      context.agentType = agentType;
    }

    this.logger.debug('CostKatana headers processed', {
      component: 'GatewayHeadersMiddleware',
      operation: 'processCostKatanaHeaders',
      type: 'costkatana_headers_processed',
      requestId: context.requestId,
      cortexEnabled: context.cortexEnabled,
      failoverEnabled: context.failoverEnabled,
      firewallEnabled: context.firewallEnabled,
    });
  }

  private processCustomProperties(
    req: RequestWithGateway,
    context: GatewayContext,
  ): void {
    // Initialize properties object
    if (!context.properties) {
      context.properties = {};
    }

    // Process CostKatana-Property-* headers
    Object.keys(req.headers).forEach((header) => {
      if (header.toLowerCase().startsWith('costkatana-property-')) {
        const propertyName = header.substring('costkatana-property-'.length);
        context.properties![propertyName] = req.headers[header] as string;
      }
    });

    // Add user-id if provided as separate header
    const userIdHeader = req.headers['costkatana-user-id'] as string;
    if (userIdHeader) {
      context.properties['user-id'] = userIdHeader;
    }

    this.logger.debug('Custom properties processed', {
      component: 'GatewayHeadersMiddleware',
      operation: 'processCustomProperties',
      type: 'custom_properties_processed',
      requestId: context.requestId,
      propertyCount: Object.keys(context.properties).length,
    });
  }
}
