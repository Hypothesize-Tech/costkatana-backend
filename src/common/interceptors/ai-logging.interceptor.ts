import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap, catchError } from 'rxjs';
import { AILoggerService } from '../services/ai-logger.service';
import { LoggingService } from '../services/logging.service';

interface AILogContext {
  startTime: number;
  requestId: string;
  userId?: string;
  projectId?: string;
}

/**
 * AI Logging Interceptor
 * Automatically captures AI-related API endpoint calls
 */
@Injectable()
export class AILoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AILoggingInterceptor.name);

  constructor(
    private readonly aiLoggerService: AILoggerService,
    private readonly loggingService: LoggingService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startTime = Date.now();

    // Create AI logging context
    const requestId =
      (request.headers['x-request-id'] as string) ||
      (request.headers['x-correlation-id'] as string) ||
      `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    const aiLogContext: AILogContext = {
      startTime,
      requestId,
      userId: (request as any).user?.id || (request as any).userId,
      projectId:
        (request as any).projectId ||
        request.body?.projectId ||
        request.query?.projectId,
    };

    // Add request ID to response headers for tracing
    response.setHeader('X-Request-ID', requestId);

    // Store context in request for potential downstream use
    (request as any).aiLogContext = aiLogContext;

    return next.handle().pipe(
      tap(async (data) => {
        await this.logSuccessfulAICall(request, response, aiLogContext, data);
      }),
      catchError(async (error) => {
        await this.logErrorAICall(request, aiLogContext, error);
        throw error;
      }),
    );
  }

  private async logSuccessfulAICall(
    request: Request,
    response: Response,
    context: AILogContext,
    responseData: any,
  ): Promise<void> {
    try {
      const responseTime = Date.now() - context.startTime;
      const statusCode = response.statusCode;
      const success = statusCode < 400;

      // Extract model info
      const model = this.extractModel(request);

      // Extract tokens
      const {
        inputTokens,
        outputTokens,
        cacheReadInputTokens,
        cacheCreationInputTokens,
        reasoningTokens,
      } = this.extractTokens(request, responseData);
      const tokensEstimated = !responseData?.usage;

      // Extract cost
      const cost = responseData?.cost || responseData?.metadata?.cost || 0;

      // Extract error info
      let errorMessage: string | undefined;
      let errorType: string | undefined;

      if (!success) {
        errorMessage =
          responseData?.error?.message ||
          responseData?.message ||
          `HTTP ${statusCode}`;
        errorType = this.categorizeError(statusCode);
      }

      // Log the AI call
      await this.aiLoggerService.logAICall({
        userId: context.userId || 'anonymous',
        projectId: context.projectId,
        requestId: context.requestId,
        service: this.extractServiceFromPath(request.path),
        operation: this.extractOperationFromPath(request.path, request.method),
        aiModel: model,
        endpoint: request.path,
        method: request.method,
        statusCode,
        success,
        responseTime,
        inputTokens,
        outputTokens,
        cacheReadInputTokens,
        cacheCreationInputTokens,
        reasoningTokens,
        tokensEstimated,
        cost,
        prompt: request.body?.prompt || request.body?.messages?.[0]?.content,
        parameters: {
          temperature: request.body?.temperature,
          maxTokens: request.body?.max_tokens || request.body?.maxTokens,
          topP: request.body?.top_p || request.body?.topP,
          ...request.body?.parameters,
        },
        result:
          responseData?.text || responseData?.content || responseData?.response,
        errorMessage,
        errorType,
        ipAddress: request.ip || (request.headers['x-forwarded-for'] as string),
        userAgent: request.headers['user-agent'] as string,
        traceId: request.body?.traceId || (request.query?.traceId as string),
        experimentId:
          request.body?.experimentId || (request.query?.experimentId as string),
        sessionId:
          request.body?.sessionId || (request.query?.sessionId as string),
        cortexEnabled: request.body?.cortex?.enabled || false,
        cacheHit: responseData?.cached || false,
        tags: request.body?.tags || [],
        logSource: 'http-interceptor',
      });
    } catch (error) {
      this.logger.error('Failed to log AI endpoint call', {
        component: 'AILoggingInterceptor',
        error: error instanceof Error ? error.message : String(error),
        path: request.path,
      });
    }
  }

  private async logErrorAICall(
    request: Request,
    context: AILogContext,
    error: any,
  ): Promise<void> {
    try {
      const responseTime = Date.now() - context.startTime;

      await this.aiLoggerService.logAICall({
        userId: context.userId || 'anonymous',
        projectId: context.projectId,
        requestId: context.requestId,
        service: 'api',
        operation: request.path,
        aiModel: 'unknown',
        endpoint: request.path,
        method: request.method,
        statusCode: 500,
        success: false,
        responseTime,
        inputTokens: 0,
        outputTokens: 0,
        errorMessage: error.message || 'Unknown error',
        errorType: 'server_error',
        errorStack: error.stack,
        ipAddress: request.ip || (request.headers['x-forwarded-for'] as string),
        userAgent: request.headers['user-agent'] as string,
        logLevel: 'ERROR',
        logSource: 'error-interceptor',
      });
    } catch (err) {
      this.logger.error('Failed to log error AI call', {
        component: 'AILoggingInterceptor',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private extractModel(request: Request): string {
    return request.body?.model || (request.query?.model as string) || 'unknown';
  }

  private extractTokens(
    request: Request,
    responseData: any,
  ): {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
    reasoningTokens?: number;
  } {
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadInputTokens: number | undefined;
    let cacheCreationInputTokens: number | undefined;
    let reasoningTokens: number | undefined;

    if (responseData) {
      const u = responseData.usage;
      inputTokens =
        u?.prompt_tokens ||
        u?.input_tokens ||
        responseData.inputTokens ||
        0;
      outputTokens =
        u?.completion_tokens ||
        u?.output_tokens ||
        responseData.outputTokens ||
        0;

      if (typeof u?.cache_read_input_tokens === 'number') {
        cacheReadInputTokens = u.cache_read_input_tokens;
      }
      if (typeof u?.cache_creation_input_tokens === 'number') {
        cacheCreationInputTokens = u.cache_creation_input_tokens;
      }
      if (typeof u?.completion_tokens_details?.reasoning_tokens === 'number') {
        reasoningTokens = u.completion_tokens_details.reasoning_tokens;
      }
    }

    return {
      inputTokens,
      outputTokens,
      cacheReadInputTokens,
      cacheCreationInputTokens,
      reasoningTokens,
    };
  }

  private extractServiceFromPath(path: string): string {
    if (path.includes('bedrock')) return 'aws-bedrock';
    if (path.includes('openai')) return 'openai';
    if (path.includes('anthropic')) return 'anthropic';
    if (path.includes('cortex')) return 'cortex';
    if (path.includes('experimentation')) return 'experimentation';
    return 'api';
  }

  private extractOperationFromPath(path: string, method: string): string {
    if (path.includes('chat')) return 'chat';
    if (path.includes('completion')) return 'completion';
    if (path.includes('embedding')) return 'embedding';
    if (path.includes('invoke')) return 'invokeModel';
    if (path.includes('optimize')) return 'optimize';
    if (path.includes('experiment')) return 'experiment';
    return method.toLowerCase();
  }

  private categorizeError(statusCode: number): string {
    if (statusCode === 401 || statusCode === 403) return 'auth_error';
    if (statusCode === 429) return 'rate_limit';
    if (statusCode === 408 || statusCode === 504) return 'timeout';
    if (statusCode >= 400 && statusCode < 500) return 'client_error';
    if (statusCode >= 500) return 'server_error';
    return 'unknown';
  }
}
