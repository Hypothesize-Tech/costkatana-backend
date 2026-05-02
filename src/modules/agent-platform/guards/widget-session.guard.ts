import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WidgetSessionService } from '../services/widget-session.service';

export const WIDGET_SESSION_PUBLIC = 'agent-platform.widget.public';

/**
 * Guard for `/api/public/widget/*` routes. Two modes:
 *
 *  - Routes decorated with `@WidgetSessionPublic()` are origin-checked but
 *    don't require a session token (used by the session-creation endpoint).
 *  - All other routes require a valid `Authorization: Bearer <session>`
 *    header AND the request `Origin` to match what the token was issued for.
 *
 * Per-IP rate limiting is enforced for both modes.
 */
@Injectable()
export class WidgetSessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly widgetSessionService: WidgetSessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      WIDGET_SESSION_PUBLIC,
      [context.getHandler(), context.getClass()],
    );

    const ip = extractIp(request);
    const ipOk = await this.widgetSessionService.checkRateLimit(
      `ip:${ip}`,
      120,
    );
    if (!ipOk) {
      throw new ForbiddenException('Rate limit exceeded');
    }

    if (isPublic) {
      // Session-creation endpoint — guard returns true; the controller
      // checks the deployment's origin allowlist.
      return true;
    }

    const token = extractBearer(request);
    if (!token) {
      throw new UnauthorizedException('Missing widget session token');
    }
    const origin = request.headers['origin'] as string | undefined;
    const payload = this.widgetSessionService.verifySession(
      token,
      undefined,
      origin,
    );
    request.widgetSession = payload;

    const sessionOk = await this.widgetSessionService.checkRateLimit(
      `sess:${payload.sessionId}`,
      30,
    );
    if (!sessionOk) {
      throw new ForbiddenException('Session rate limit exceeded');
    }
    return true;
  }
}

function extractBearer(request: any): string | null {
  const auth = request.headers?.authorization;
  if (auth && typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.substring(7);
  }
  return null;
}

function extractIp(request: any): string {
  const fwd = request.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  return request.ip || request.connection?.remoteAddress || 'unknown';
}
