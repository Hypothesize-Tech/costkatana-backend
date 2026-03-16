import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GuardrailsService } from '../guardrails.service';

/**
 * Guard that enforces usage guardrails on the request.
 * Use on routes that should be blocked or throttled when limits are exceeded.
 * Runs after JwtAuthGuard so request.user is set.
 */
@Injectable()
export class GuardrailsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly guardrailsService: GuardrailsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const userId =
      request.user?.id ?? request.user?._id ?? request.gatewayContext?.userId;
    if (!userId) return true;

    const estimatedTokens = this.guardrailsService.estimateRequestTokens(
      request.body ?? {},
    );
    const [requestViolation, tokenViolation] = await Promise.all([
      this.guardrailsService.checkRequestGuardrails(
        userId,
        'request',
        1,
        request.body?.model,
      ),
      this.guardrailsService.checkRequestGuardrails(
        userId,
        'token',
        estimatedTokens,
        request.body?.model,
      ),
    ]);

    if (requestViolation) {
      response.setHeader('X-Guardrail-Status', requestViolation.type);
      response.setHeader('X-Guardrail-Metric', requestViolation.metric);
      response.setHeader(
        'X-Guardrail-Percentage',
        requestViolation.percentage.toFixed(2),
      );
      if (requestViolation.action === 'block') {
        throw new HttpException(
          {
            success: false,
            error: 'Usage limit exceeded',
            violation: requestViolation,
            upgradeUrl: 'https://www.costkatana.com/#pricing',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (requestViolation.action === 'throttle') {
        const delay = Math.min(5000, requestViolation.percentage * 50);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    if (tokenViolation?.action === 'block') {
      throw new HttpException(
        {
          success: false,
          error: 'Token limit exceeded',
          violation: tokenViolation,
          upgradeUrl: 'https://www.costkatana.com/#pricing',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.guardrailsService
      .trackUsage(userId, { requests: 1, tokens: estimatedTokens })
      .catch(() => {});
    return true;
  }
}
