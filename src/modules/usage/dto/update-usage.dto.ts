import { z } from 'zod';

// Update usage DTO - mirrors update schema from Express controller
export const UpdateUsageDto = z
  .object({
    // Basic usage fields that can be updated
    service: z
      .enum([
        'openai',
        'aws-bedrock',
        'google-ai',
        'anthropic',
        'huggingface',
        'cohere',
      ])
      .optional(),
    model: z.string().min(1).optional(),
    prompt: z.string().min(1).optional(),
    completion: z.string().optional(),
    promptTokens: z.number().int().nonnegative().optional(),
    completionTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
    cost: z.number().nonnegative().optional(),
    responseTime: z.number().nonnegative().optional(),

    // Metadata and tags
    metadata: z.record(z.any()).optional(),
    tags: z.array(z.string()).optional(),

    // Project association
    projectId: z.string().optional(),

    // Error tracking
    errorOccurred: z.boolean().optional(),
    errorMessage: z.string().optional(),
    httpStatusCode: z.number().min(100).max(599).optional(),
    errorType: z
      .enum([
        'client_error',
        'server_error',
        'network_error',
        'auth_error',
        'rate_limit',
        'timeout',
        'validation_error',
        'integration_error',
      ])
      .optional(),
    errorDetails: z.record(z.any()).optional(),

    // Optimization
    optimizationApplied: z.boolean().optional(),

    // Workflow tracking
    workflowId: z.string().optional(),
    workflowName: z.string().optional(),
    workflowStep: z.string().optional(),
    workflowSequence: z.number().min(0).optional(),

    // Email tracking
    userEmail: z.string().email().optional(),
    customerEmail: z.string().email().optional(),

    // Cost allocation
    costAllocation: z
      .object({
        department: z.string().optional(),
        team: z.string().optional(),
        purpose: z.string().optional(),
        client: z.string().optional(),
      })
      .optional(),

    // Automation
    automationPlatform: z.enum(['zapier', 'make', 'n8n']).optional(),
    automationConnectionId: z.string().optional(),
    orchestrationCost: z.number().min(0).optional(),
    orchestrationOverheadPercentage: z.number().min(0).max(100).optional(),

    // Template usage
    templateUsage: z
      .object({
        templateId: z.string(),
        templateName: z.string(),
        templateCategory: z.enum([
          'general',
          'coding',
          'writing',
          'analysis',
          'creative',
          'business',
          'custom',
          'visual-compliance',
        ]),
        variablesResolved: z.array(
          z.object({
            variableName: z.string(),
            value: z.string(),
            confidence: z.number().min(0).max(1),
            source: z.enum([
              'user_provided',
              'context_inferred',
              'default',
              'missing',
            ]),
            reasoning: z.string().optional(),
          }),
        ),
        context: z.enum([
          'chat',
          'optimization',
          'visual-compliance',
          'agent_trace',
          'api',
        ]),
        templateVersion: z.number().optional(),
      })
      .optional(),

    // Request tracking
    requestTracking: z
      .object({
        clientInfo: z.object({
          ip: z.string(),
          port: z.number().optional(),
          forwardedIPs: z.array(z.string()),
          userAgent: z.string(),
          geoLocation: z
            .object({
              country: z.string(),
              region: z.string(),
              city: z.string(),
            })
            .optional(),
          sdkVersion: z.string().optional(),
          environment: z.string().optional(),
        }),
        headers: z.object({
          request: z.record(z.string()),
          response: z.record(z.string()),
        }),
        networking: z.object({
          serverEndpoint: z.string(),
          serverFullUrl: z.string().optional(),
          clientOrigin: z.string().optional(),
          serverIP: z.string(),
          serverPort: z.number(),
          routePattern: z.string(),
          protocol: z.string(),
          secure: z.boolean(),
          dnsLookupTime: z.number().optional(),
          tcpConnectTime: z.number().optional(),
          tlsHandshakeTime: z.number().optional(),
        }),
        payload: z.object({
          requestBody: z.any().optional(),
          responseBody: z.any().optional(),
          requestSize: z.number().min(0),
          responseSize: z.number().min(0),
          contentType: z.string(),
          encoding: z.string().optional(),
          compressionRatio: z.number().optional(),
        }),
        performance: z.object({
          clientSideTime: z.number().optional(),
          networkTime: z.number().min(0),
          serverProcessingTime: z.number().min(0),
          totalRoundTripTime: z.number().min(0),
          dataTransferEfficiency: z.number().min(0),
        }),
      })
      .optional(),

    // Optimization opportunities
    optimizationOpportunities: z
      .object({
        costOptimization: z.object({
          potentialSavings: z.number().min(0),
          recommendedModel: z.string().optional(),
          reasonCode: z.enum([
            'model_downgrade',
            'prompt_optimization',
            'caching',
            'batch_processing',
          ]),
          confidence: z.number().min(0).max(1),
          estimatedImpact: z.string(),
        }),
        performanceOptimization: z.object({
          currentPerformanceScore: z.number().min(0).max(100),
          bottleneckIdentified: z.enum([
            'network',
            'processing',
            'payload_size',
            'model_complexity',
          ]),
          recommendation: z.string(),
          estimatedImprovement: z.string(),
        }),
        dataEfficiency: z.object({
          compressionRecommendation: z.boolean().optional(),
          payloadOptimization: z.string().optional(),
          headerOptimization: z.string().optional(),
        }),
      })
      .optional(),

    // Prompt caching
    promptCaching: z
      .object({
        enabled: z.boolean(),
        type: z.enum(['automatic', 'explicit', 'none']),
        provider: z.enum(['anthropic', 'openai', 'google', 'auto']),
        model: z.string(),
        cacheCreationTokens: z.number().min(0),
        cacheReadTokens: z.number().min(0),
        regularTokens: z.number().min(0),
        totalTokens: z.number().min(0),
        cacheHits: z.number().min(0),
        cacheMisses: z.number().min(0),
        hitRate: z.number().min(0).max(1),
        savingsFromCaching: z.number().min(0),
        estimatedSavings: z.number().min(0),
        cacheKey: z.string().optional(),
        cacheTTL: z.number().min(0),
        breakpointsUsed: z.number().min(0),
        prefixRatio: z.number().min(0).max(1),
        cacheLookupTime: z.number().min(0),
        cacheProcessingTime: z.number().min(0),
        anthropicBreakpoints: z
          .array(
            z.object({
              position: z.number(),
              tokenCount: z.number(),
              contentType: z.string(),
            }),
          )
          .optional(),
        openaiPrefixLength: z.number().optional(),
        geminiCacheName: z.string().optional(),
      })
      .optional(),
  })
  .strict(); // No additional properties allowed

export type UpdateUsageDtoType = z.infer<typeof UpdateUsageDto>;
