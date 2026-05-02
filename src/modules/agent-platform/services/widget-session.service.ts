import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../../../common/cache/cache.service';
import { randomBytes, createHash } from 'crypto';

interface WidgetSessionPayload {
  sessionId: string;
  deploymentId: string;
  originHash: string;
  iat: number;
  exp: number;
}

const SESSION_TTL_SECONDS = 60 * 60 * 24; // 24h
const RATE_WINDOW_SECONDS = 60;

@Injectable()
export class WidgetSessionService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Mint a new session token for a (deploymentId, origin) pair. Tokens are
   * scoped — a token issued for origin A can't be used by origin B.
   */
  issueSession(deploymentId: string, origin: string): {
    sessionId: string;
    sessionToken: string;
  } {
    const sessionId = `wgs_${randomBytes(12).toString('hex')}`;
    const originHash = hashOrigin(origin);
    const secret = this.requireSecret();
    const sessionToken = this.jwtService.sign(
      { sessionId, deploymentId, originHash } satisfies Pick<
        WidgetSessionPayload,
        'sessionId' | 'deploymentId' | 'originHash'
      >,
      { secret, expiresIn: SESSION_TTL_SECONDS },
    );
    return { sessionId, sessionToken };
  }

  /**
   * Verify a session token. Throws if the token is invalid, expired, or
   * mismatched against the request's deployment / origin.
   */
  verifySession(
    token: string,
    expectedDeploymentId?: string,
    expectedOrigin?: string,
  ): WidgetSessionPayload {
    let payload: WidgetSessionPayload;
    try {
      payload = this.jwtService.verify<WidgetSessionPayload>(token, {
        secret: this.requireSecret(),
      });
    } catch (err) {
      throw new UnauthorizedException(
        `Invalid widget session: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
    if (
      expectedDeploymentId &&
      payload.deploymentId !== expectedDeploymentId
    ) {
      throw new UnauthorizedException('Widget session deployment mismatch');
    }
    if (expectedOrigin && payload.originHash !== hashOrigin(expectedOrigin)) {
      throw new UnauthorizedException('Widget session origin mismatch');
    }
    return payload;
  }

  /**
   * Increment a counter under `key` and return whether it's still under the
   * given limit. Counter resets every `RATE_WINDOW_SECONDS` seconds.
   *
   * Backed by the existing CacheService — falls back gracefully if cache
   * is not configured (lets v1 ship without Redis blocking the public API).
   */
  async checkRateLimit(key: string, limit: number): Promise<boolean> {
    if (limit <= 0) return true;
    try {
      const fullKey = `agent-platform:widget-rl:${key}`;
      const current = (await this.cacheService.get<number>(fullKey)) ?? 0;
      if (current >= limit) return false;
      await this.cacheService.set(
        fullKey,
        current + 1,
        RATE_WINDOW_SECONDS,
      );
      return true;
    } catch {
      // Don't block traffic if cache is misbehaving; surface in logs.
      return true;
    }
  }

  private requireSecret(): string {
    const secret =
      this.configService.get<string>('WIDGET_JWT_SECRET') ??
      this.configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error(
        'WIDGET_JWT_SECRET (or JWT_SECRET) must be set for the widget session service.',
      );
    }
    return secret;
  }
}

function hashOrigin(origin: string): string {
  return createHash('sha256').update(origin.replace(/\/$/, '')).digest('hex');
}
