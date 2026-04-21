import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import {
  ProxyRequestConfig,
  ConversationMessage,
  ToolCallExtractionResult,
} from '../interfaces/gateway.interfaces';
import https from 'https';
import { LazySummarizationService } from './lazy-summarization.service';
import {
  inferGatewayTargetUrlForRequest,
  stripGatewayPrefixFromPath,
} from '../utils/gateway-target-url.util';
import { isOfficialAnthropicGatewayTarget } from '../utils/gateway-anthropic-bedrock.util';
import { applyClaudePromptCachingToBody } from '../utils/claude-prompt-cache-enricher.util';

/**
 * Request Processing Service - Handles request validation, transformation, and routing logic
 * Integrates with Cortex for AI optimization and includes lazy summarization and prompt compilation
 */
@Injectable()
export class RequestProcessingService {
  private readonly logger = new Logger(RequestProcessingService.name);

  // Create a connection pool for better performance
  private readonly httpsAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 30000,
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 60000,
  });

  constructor(
    private readonly lazySummarizationService: LazySummarizationService,
  ) {}

  /**
   * Prepare the proxy request to the AI provider with all necessary headers and configuration
   */
  async prepareProxyRequest(request: Request): Promise<ProxyRequestConfig> {
    const context = (request as any).gatewayContext;

    const headerTarget =
      typeof context.targetUrl === 'string' ? context.targetUrl.trim() : '';
    if (!headerTarget) {
      const inferred = inferGatewayTargetUrlForRequest(request);
      if (inferred) {
        context.targetUrl = inferred;
        this.logger.debug('Inferred CostKatana-Target-Url from path', {
          path: request.path,
          inferred,
        });
      }
    }

    const rawTarget =
      typeof context.targetUrl === 'string' ? context.targetUrl.trim() : '';
    if (!rawTarget) {
      throw new BadRequestException({
        error: 'CostKatana-Target-Url is required',
        message:
          'Could not infer upstream URL from this path. Send the CostKatana-Target-Url header (provider origin) or use a supported route such as /v1/messages, /v1/chat/completions, or /v1/models/:model/generateContent.',
        details: { path: request.path },
      });
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(rawTarget);
    } catch {
      throw new BadRequestException({
        error: 'Invalid CostKatana-Target-Url',
        message:
          'CostKatana-Target-Url must be a valid absolute URL (example: https://api.anthropic.com).',
        details: { value: rawTarget },
      });
    }

    const providerPath = stripGatewayPrefixFromPath(request.path || '');
    const fullUrl = `${targetUrl.origin}${providerPath}`;

    let body = request.body;
    if (context.modelOverride && body && typeof body === 'object') {
      body = { ...body, model: context.modelOverride };
    }

    // Add provider API key - check if we have a resolved proxy key first
    let providerApiKey: string | null = null;

    if (context.providerKey) {
      providerApiKey = context.providerKey;
      this.logger.log('Using resolved proxy key for provider', {
        hostname: targetUrl.hostname,
        provider: context.provider,
        proxyKeyId: context.proxyKeyId,
      });
    } else {
      providerApiKey = this.getProviderApiKey(targetUrl.hostname);
      this.logger.log('Using environment API key for provider', {
        hostname: targetUrl.hostname,
        hasKey: !!providerApiKey,
      });
    }

    const providerPathLower = providerPath.toLowerCase();
    const isAnthropicMessagesPost =
      request.method?.toUpperCase() === 'POST' &&
      /\/v1\/messages(\/|$|\?)/.test(providerPathLower);

    // Claude via gateway: if there is no Anthropic API key (env ANTHROPIC_API_KEY or resolved
    // provider key), Nest serves POST /v1/messages through AWS Bedrock using the same AWS
    // credentials already configured for the backend. No extra gateway env vars — clients only
    // authenticate to Cost Katana; they never send ANTHROPIC_API_KEY.
    if (
      isAnthropicMessagesPost &&
      isOfficialAnthropicGatewayTarget(targetUrl.hostname) &&
      !providerApiKey
    ) {
      context.useBedrockAnthropicFallback = true;
      this.logger.log(
        'Anthropic Messages: no Anthropic key → AWS Bedrock (Nest)',
        { path: providerPath },
      );
      return {
        internalBedrockAnthropic: true,
        method: request.method,
        headers: {},
        data: body,
        timeout: 120000,
        validateStatus: () => true,
        httpsAgent: this.httpsAgent,
        maxRedirects: 0,
        decompress: true,
      };
    }

    // Prepare headers - remove gateway-specific headers
    const headers = { ...request.headers };
    Object.keys(headers).forEach((key) => {
      if (key.toLowerCase().startsWith('costkatana-')) {
        delete headers[key];
      }
    });

    if (!headers['content-type']) {
      headers['content-type'] = 'application/json';
    }

    const hostLower = targetUrl.hostname.toLowerCase();
    const isAnthropic = hostLower.includes('anthropic.com');

    if (providerApiKey) {
      if (isAnthropic) {
        headers['x-api-key'] = providerApiKey;
        headers['anthropic-version'] =
          (headers['anthropic-version'] as string) || '2023-06-01';
        delete headers['authorization'];
      } else {
        headers['authorization'] = `Bearer ${providerApiKey}`;
      }
    } else {
      this.logger.warn('No API key found for provider', {
        hostname: targetUrl.hostname,
      });
    }

    // Add headers to bypass Cloudflare detection
    headers['User-Agent'] =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    headers['Accept'] = 'application/json, text/plain, */*';
    headers['Accept-Language'] = 'en-US,en;q=0.9';
    headers['Accept-Encoding'] = 'gzip, deflate, br';
    headers['Connection'] = 'keep-alive';
    headers['Sec-Fetch-Dest'] = 'empty';
    headers['Sec-Fetch-Mode'] = 'cors';
    headers['Sec-Fetch-Site'] = 'cross-site';

    // Add proper Host header to bypass Cloudflare
    headers['Host'] = targetUrl.hostname;

    return {
      method: request.method,
      url: fullUrl,
      headers,
      data: body,
      timeout: 120000, // 2 minutes timeout
      validateStatus: () => true, // Don't throw on HTTP error status
      httpsAgent: this.httpsAgent, // Use shared connection pool
      maxRedirects: 5,
      decompress: true,
    };
  }

  /**
   * Apply lazy summarization to compress large conversation contexts
   */
  async applyLazySummarization(
    request: Request,
    proxyRequest: ProxyRequestConfig,
  ): Promise<ProxyRequestConfig> {
    const context = (request as any).gatewayContext;

    try {
      if (
        request.body &&
        request.body.messages &&
        Array.isArray(request.body.messages)
      ) {
        const messages: ConversationMessage[] = request.body.messages.map(
          (m: any) => ({
            role: m.role || 'user',
            content: m.content || '',
            timestamp: m.timestamp ? new Date(m.timestamp) : undefined,
          }),
        );

        const totalTokens = messages.reduce(
          (sum, m) => sum + m.content.length / 4,
          0,
        );

        const shouldSummarize =
          this.lazySummarizationService.shouldApplySummarization(totalTokens);

        if (shouldSummarize.shouldApply) {
          const summarizationResult =
            await this.lazySummarizationService.compressConversationHistory(
              messages,
            );

          if (summarizationResult.reductionPercentage > 20) {
            this.logger.log('🗜️ Lazy summarization applied', {
              userId: context.userId,
              originalMessages: summarizationResult.original.length,
              compressedMessages: summarizationResult.compressed.length,
              reduction: `${summarizationResult.reductionPercentage.toFixed(1)}%`,
            });

            // Update request body with compressed messages
            proxyRequest.data = {
              ...proxyRequest.data,
              messages: summarizationResult.compressed,
            };
            request.body.messages = summarizationResult.compressed;

            // Push proactive suggestion notification
            try {
              const suggestionService = await this.getSuggestionService();
              const createSuggestion = (
                suggestionService as {
                  createProactiveSuggestion?: (
                    opts: unknown,
                  ) => Promise<unknown>;
                }
              ).createProactiveSuggestion;
              if (typeof createSuggestion === 'function') {
                await createSuggestion.call(suggestionService, {
                  userId: context.userId,
                  type: 'COMPRESSION_APPLIED',
                  title: 'Conversation Compressed',
                  message: `Your conversation was automatically compressed, saving ${summarizationResult.reductionPercentage.toFixed(1)}% in token usage.`,
                  metadata: {
                    originalLength: summarizationResult.original.length,
                    compressedLength: summarizationResult.compressed.length,
                    reductionPercentage:
                      summarizationResult.reductionPercentage,
                    gatewayRequestId: context.requestId,
                  },
                  priority: 'low',
                  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
                });
              }

              this.logger.log('✅ Proactive suggestion notification sent', {
                userId: context.userId,
                reduction:
                  summarizationResult.reductionPercentage.toFixed(1) + '%',
                requestId: context.requestId,
              });
            } catch (suggestionError) {
              this.logger.warn(
                '⚠️ Failed to send proactive suggestion notification',
                {
                  error:
                    suggestionError instanceof Error
                      ? suggestionError.message
                      : String(suggestionError),
                  userId: context.userId,
                  requestId: context.requestId,
                },
              );
              // Don't fail the request if suggestion fails
            }
          }
        }
      }
    } catch (error) {
      this.logger.warn('Lazy summarization failed, continuing with original', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return proxyRequest;
  }

  /**
   * Apply prompt compiler optimizations to reduce token usage
   */
  async applyPromptCompiler(
    request: Request,
    proxyRequest: ProxyRequestConfig,
  ): Promise<ProxyRequestConfig> {
    const context = (request as any).gatewayContext;
    const enableCompiler =
      request.headers['x-costkatana-enable-compiler'] === 'true';
    const optimizationLevel =
      parseInt(request.headers['x-costkatana-optimization-level'] as string) ||
      2;

    if (!enableCompiler) {
      return proxyRequest;
    }

    try {
      const prompt =
        request.body.prompt ||
        request.body.messages?.map((m: any) => m.content).join('\n') ||
        '';

      if (prompt && prompt.length > 200) {
        // Only optimize prompts > 200 chars
        const compilerMod =
          await import('../../compiler/services/prompt-compiler.service');
        const PromptCompilerService = compilerMod.PromptCompilerService;
        const compilerInstance =
          (
            PromptCompilerService as {
              getInstance?: () => {
                compile: (
                  source: string,
                  options?: unknown,
                ) => Promise<unknown>;
              };
            }
          ).getInstance?.() ??
          new (PromptCompilerService as new () => {
            compile: (source: string, options?: unknown) => Promise<unknown>;
          })();
        const compilationResult = (await compilerInstance.compile(prompt, {
          optimizationLevel: optimizationLevel as 0 | 1 | 2 | 3,
          preserveQuality: true,
          enableParallelization: true,
        })) as {
          success: boolean;
          metrics: {
            tokenReduction: number;
            originalTokens: number;
            optimizedTokens: number;
            optimizationPasses: unknown[];
          };
          optimizedPrompt: string;
        };

        if (
          compilationResult.success &&
          compilationResult.metrics.tokenReduction > 10
        ) {
          this.logger.log('🔧 Prompt compiler applied optimizations', {
            userId: context.userId,
            originalTokens: compilationResult.metrics.originalTokens,
            optimizedTokens: compilationResult.metrics.optimizedTokens,
            reduction: `${compilationResult.metrics.tokenReduction.toFixed(1)}%`,
            passes: compilationResult.metrics.optimizationPasses.length,
          });

          // Update request with optimized prompt
          if (request.body.prompt) {
            proxyRequest.data = {
              ...proxyRequest.data,
              prompt: compilationResult.optimizedPrompt,
            };
            request.body.prompt = compilationResult.optimizedPrompt;
          } else if (request.body.messages) {
            // Update last message with optimized content
            const messages = [...request.body.messages];
            messages[messages.length - 1] = {
              ...messages[messages.length - 1],
              content: compilationResult.optimizedPrompt,
            };
            proxyRequest.data = {
              ...proxyRequest.data,
              messages,
            };
            request.body.messages = messages;
          }

          // Analyze parallelization opportunities and push suggestions
          try {
            const parallelizationOpportunities =
              await this.analyzeParallelizationOpportunities(
                compilationResult,
                request.body,
              );

            if (parallelizationOpportunities.length > 0) {
              const suggestionService = await this.getSuggestionService();
              const createSuggestion = (
                suggestionService as {
                  createProactiveSuggestion?: (
                    opts: unknown,
                  ) => Promise<unknown>;
                }
              ).createProactiveSuggestion;
              if (typeof createSuggestion === 'function') {
                await createSuggestion.call(suggestionService, {
                  userId: context.userId,
                  type: 'PARALLELIZATION_AVAILABLE',
                  title: 'Parallel Processing Available',
                  message: `Found ${parallelizationOpportunities.length} opportunities to run tasks in parallel, potentially reducing response time.`,
                  metadata: {
                    opportunities: parallelizationOpportunities,
                    originalTokens: compilationResult.metrics.originalTokens,
                    optimizedTokens: compilationResult.metrics.optimizedTokens,
                    gatewayRequestId: context.requestId,
                  },
                  priority: 'medium',
                  expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days
                });
              }

              this.logger.log(
                '✅ Parallelization opportunities identified and suggested',
                {
                  userId: context.userId,
                  opportunities: parallelizationOpportunities.length,
                  requestId: context.requestId,
                },
              );
            }
          } catch (analysisError) {
            this.logger.warn(
              '⚠️ Failed to analyze parallelization opportunities',
              {
                error:
                  analysisError instanceof Error
                    ? analysisError.message
                    : String(analysisError),
                userId: context.userId,
                requestId: context.requestId,
              },
            );
            // Don't fail the request if analysis fails
          }
        }
      }
    } catch (error) {
      this.logger.warn('Prompt compilation failed, continuing with original', {
        userId: context.userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return proxyRequest;
  }

  /**
   * Apply Gateway Cortex processing for memory-efficient request transformation
   */
  async applyCortexProcessing(
    request: Request,
    proxyRequest: ProxyRequestConfig,
  ): Promise<ProxyRequestConfig> {
    const context = (request as any).gatewayContext;

    if (!context.cortexEnabled) {
      return proxyRequest;
    }

    this.logger.log('🔄 Processing request through Gateway Cortex', {
      requestId: context.requestId,
      coreModel: context.cortexCoreModel,
      operation: context.cortexOperation,
    });

    try {
      // Import GatewayCortexService dynamically
      const { GatewayCortexService } = await import('./gateway-cortex.service');

      const cortexService = new GatewayCortexService();
      const cortexResult = await cortexService.processGatewayRequest(
        request,
        request.body,
      );

      if (!cortexResult.shouldBypass) {
        proxyRequest.data = cortexResult.processedBody;

        this.logger.log('✅ Gateway Cortex processing completed', {
          requestId: context.requestId,
          tokensSaved: cortexResult.cortexMetadata.tokensSaved,
          reductionPercentage:
            cortexResult.cortexMetadata.reductionPercentage?.toFixed(1),
          processingTime: cortexResult.cortexMetadata.processingTime,
        });
      }
    } catch (cortexError) {
      this.logger.warn(
        '⚠️ Gateway Cortex processing failed, continuing with original request',
        {
          requestId: context.requestId,
          error:
            cortexError instanceof Error
              ? cortexError.message
              : String(cortexError),
        },
      );
    }

    return proxyRequest;
  }

  /**
   * Apply Anthropic/Bedrock-compatible prompt caching breakpoints to the final Claude
   * Messages body. Runs after summarization / compiler / Cortex so breakpoints match
   * the payload actually sent upstream.
   */
  applyClaudePromptCachingIfApplicable(
    request: Request,
    proxyRequest: ProxyRequestConfig,
  ): ProxyRequestConfig {
    const providerPath = stripGatewayPrefixFromPath(request.path || '');
    const providerPathLower = providerPath.toLowerCase();
    const isAnthropicMessagesPost =
      request.method?.toUpperCase() === 'POST' &&
      /\/v1\/messages(\/|$|\?)/.test(providerPathLower);

    if (!isAnthropicMessagesPost) {
      return proxyRequest;
    }

    const headerOptOut =
      String(
        request.headers['costkatana-prompt-caching'] ??
          request.headers['CostKatana-Prompt-Caching'] ??
          '',
      ).toLowerCase() === 'off';
    if (headerOptOut) {
      return proxyRequest;
    }

    const raw =
      proxyRequest.data && typeof proxyRequest.data === 'object'
        ? (proxyRequest.data as Record<string, unknown>)
        : request.body && typeof request.body === 'object'
          ? (request.body as Record<string, unknown>)
          : null;
    if (!raw) {
      return proxyRequest;
    }

    const result = applyClaudePromptCachingToBody(raw);
    if (result.appliedBreakpoints === 0) {
      return proxyRequest;
    }

    request.body = result.body;
    proxyRequest.data = result.body;

    if (result.outboundAnthropicBeta && !proxyRequest.internalBedrockAnthropic) {
      const prev = proxyRequest.headers as Record<string, string> | undefined;
      const h: Record<string, string> = { ...(prev || {}) };
      const key = 'anthropic-beta';
      const existing = h[key] ?? h['Anthropic-Beta'];
      if (existing && !String(existing).includes(result.outboundAnthropicBeta)) {
        h[key] = `${existing},${result.outboundAnthropicBeta}`;
      } else if (!existing) {
        h[key] = result.outboundAnthropicBeta;
      }
      proxyRequest.headers = h as ProxyRequestConfig['headers'];

      this.logger.debug('Claude prompt caching: direct Anthropic beta header set', {
        breakpoints: result.appliedBreakpoints,
      });
    } else {
      this.logger.debug('Claude prompt caching breakpoints applied (Bedrock path)', {
        breakpoints: result.appliedBreakpoints,
      });
    }

    return proxyRequest;
  }

  /**
   * Extract tool calls from various request formats
   */
  extractToolCallsFromRequest(requestBody: any): ToolCallExtractionResult {
    if (!requestBody) {
      return { toolCalls: undefined, format: 'unknown' };
    }

    try {
      // OpenAI format - tools can be in different places
      if (requestBody.tools && Array.isArray(requestBody.tools)) {
        return { toolCalls: requestBody.tools, format: 'openai' };
      }

      // Function calling in messages
      if (requestBody.messages && Array.isArray(requestBody.messages)) {
        const toolCalls: any[] = [];

        requestBody.messages.forEach((msg: any) => {
          if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
            toolCalls.push(...msg.tool_calls);
          }
        });

        return toolCalls.length > 0
          ? { toolCalls, format: 'openai' }
          : { toolCalls: undefined, format: 'openai' };
      }

      // Anthropic function calling
      if (requestBody.tools && Array.isArray(requestBody.tools)) {
        return { toolCalls: requestBody.tools, format: 'anthropic' };
      }

      // Google AI function calling
      if (
        requestBody.function_declarations &&
        Array.isArray(requestBody.function_declarations)
      ) {
        return {
          toolCalls: requestBody.function_declarations,
          format: 'google',
        };
      }

      return { toolCalls: undefined, format: 'unknown' };
    } catch (error: any) {
      this.logger.warn('Error extracting tool calls from request', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error.stack,
      });
      return { toolCalls: undefined, format: 'unknown' };
    }
  }

  /**
   * Infer service name from target URL
   */
  inferServiceFromUrl(url: string): string {
    const hostname = new URL(url).hostname.toLowerCase();

    if (hostname.includes('openai.com')) return 'openai';
    if (hostname.includes('anthropic.com')) return 'anthropic';
    if (hostname.includes('googleapis.com')) return 'google-ai';
    if (hostname.includes('cohere.ai')) return 'cohere';
    if (hostname.includes('amazonaws.com')) return 'aws-bedrock';
    if (hostname.includes('azure.com')) return 'azure';
    if (hostname.includes('deepseek.com')) return 'deepseek';
    if (hostname.includes('groq.com')) return 'groq';
    if (hostname.includes('huggingface.co')) return 'huggingface';

    return 'openai'; // Default to openai instead of unknown
  }

  /**
   * Infer model from request for tracking purposes
   */
  inferModelFromRequest(request: Request): string | undefined {
    try {
      if (request.body?.model) {
        return request.body.model;
      }

      // Try to infer from URL path
      const url = (request as any).gatewayContext?.targetUrl || '';
      if (url.includes('claude')) return 'claude';
      if (url.includes('gpt-4')) return 'gpt-4';
      if (url.includes('gpt-3.5')) return 'gpt-3.5';
      if (url.includes('llama')) return 'llama';

      return 'unknown';
    } catch (error: any) {
      return 'unknown';
    }
  }

  /**
   * Get the appropriate API key for the target provider
   */
  private getProviderApiKey(hostname: string): string | null {
    const host = hostname.toLowerCase();

    if (host.includes('openai.com')) {
      return process.env.OPENAI_API_KEY || null;
    }

    if (host.includes('anthropic.com')) {
      const key = process.env.ANTHROPIC_API_KEY?.trim();
      return key || null;
    }

    if (host.includes('googleapis.com')) {
      return process.env.GOOGLE_API_KEY || null;
    }

    if (host.includes('amazonaws.com')) {
      // AWS Bedrock uses AWS credentials, not API key
      return null;
    }

    if (host.includes('cohere.ai')) {
      return process.env.COHERE_API_KEY || null;
    }

    if (host.includes('deepseek.com')) {
      return process.env.DEEPSEEK_API_KEY || null;
    }

    if (host.includes('groq.com')) {
      return process.env.GROQ_API_KEY || null;
    }

    if (host.includes('huggingface.co')) {
      return process.env.HUGGINGFACE_API_KEY || null;
    }

    this.logger.warn(`No API key configured for provider: ${hostname}`, {
      hostname,
    });
    return null;
  }

  /**
   * Get suggestion service for proactive notifications
   */
  private async getSuggestionService() {
    const { ProactiveSuggestionsService } =
      await import('../../proactive-suggestions/services/proactive-suggestions.service');
    return ProactiveSuggestionsService;
  }

  /**
   * Analyze parallelization opportunities in the prompt
   */
  private async analyzeParallelizationOpportunities(
    compilationResult: any,
    originalRequest: any,
  ): Promise<
    Array<{ type: string; description: string; potentialSavings: number }>
  > {
    const opportunities: Array<{
      type: string;
      description: string;
      potentialSavings: number;
    }> = [];

    try {
      // Analyze the compilation result for parallelizable components
      const optimizations = compilationResult.metrics?.optimizationPasses || [];

      for (const optimization of optimizations) {
        if (optimization.type === 'independent_tasks') {
          opportunities.push({
            type: 'independent_tasks',
            description: `Found ${optimization.taskCount} independent tasks that can run in parallel`,
            potentialSavings: optimization.estimatedTimeSavings || 0,
          });
        } else if (optimization.type === 'batch_operations') {
          opportunities.push({
            type: 'batch_operations',
            description: `Multiple similar operations can be batched together`,
            potentialSavings: optimization.estimatedTimeSavings || 0,
          });
        } else if (optimization.type === 'concurrent_api_calls') {
          opportunities.push({
            type: 'concurrent_api_calls',
            description: `API calls can be made concurrently instead of sequentially`,
            potentialSavings: optimization.estimatedTimeSavings || 0,
          });
        }
      }

      // Analyze original request structure
      if (originalRequest.messages && originalRequest.messages.length > 1) {
        // Check for multiple user messages that might be independent
        const userMessages = originalRequest.messages.filter(
          (m: any) => m.role === 'user',
        );
        if (userMessages.length > 1) {
          opportunities.push({
            type: 'multiple_queries',
            description: `${userMessages.length} separate user queries detected - consider processing individually`,
            potentialSavings: userMessages.length * 0.5, // Rough estimate
          });
        }
      }
    } catch (error) {
      this.logger.warn('Failed to analyze parallelization opportunities', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return opportunities;
  }
}
