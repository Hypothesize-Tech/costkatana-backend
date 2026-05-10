/**
 * OAuthTokenManager — provider-agnostic token freshness + scope check.
 *
 * Every integration service today checks "is this token expired?" with
 * its own ad-hoc logic, and most of them return generic 401 errors when
 * the answer is yes. That's a poor UX (the user has no idea what to
 * reconnect) and a poor security story (no central place to rotate or
 * scope-check tokens).
 *
 * This service centralises three things:
 *
 *   1. **Freshness** — `ensureFresh(connection)` returns either the
 *      same connection (token still valid) or a refreshed copy (token
 *      was about to expire and we got a new one from the provider).
 *
 *   2. **Refresh-failure handling** — when the provider rejects the
 *      refresh token entirely (revoked / superseded / 30-day idle
 *      expiry), we throw `OAuthTokenRefreshError` with
 *      `requiresReconnection: true` so the caller can surface "please
 *      reconnect <provider>" instead of a stack trace.
 *
 *   3. **Scope enforcement** — `assertScopes(connection, required)`
 *      blocks tool calls that need scopes the user never granted. If
 *      the user reconnected with a narrower scope set, this catches
 *      it before the integration call goes out and produces an
 *      ambiguous 403.
 *
 * Per-provider details live in `refreshers/<provider>.refresher.ts`.
 * The manager picks the right refresher by `connection.provider` and
 * never speaks the provider's protocol itself.
 */
import { Logger } from '@nestjs/common';

export interface OAuthConnection {
  /** Provider id, e.g. 'github', 'google', 'slack'. */
  provider: string;
  /** Mongo document id (for logs / re-fetches). */
  connectionId: string;
  /** OAuth access token currently believed to be valid. */
  accessToken: string;
  /** Refresh token, when the provider supports rotation. */
  refreshToken?: string;
  /** Absolute expiry. `undefined` means "non-expiring or unknown". */
  expiresAt?: Date;
  /** Granted scopes returned at the last successful auth. */
  grantedScopes: string[];
  /** Free-form provider-specific metadata. */
  metadata?: Record<string, unknown>;
}

export interface RefreshedTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  grantedScopes?: string[];
}

export interface OAuthRefresher {
  readonly provider: string;
  refresh(connection: OAuthConnection): Promise<RefreshedTokens>;
}

export class OAuthTokenRefreshError extends Error {
  constructor(
    public readonly provider: string,
    public readonly connectionId: string,
    public readonly cause: unknown,
    public readonly requiresReconnection: boolean,
  ) {
    super(
      `OAuth token refresh failed for ${provider}/${connectionId}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = 'OAuthTokenRefreshError';
  }
}

export class OAuthScopeError extends Error {
  constructor(
    public readonly provider: string,
    public readonly missingScopes: string[],
    public readonly requiresReconnection = true,
  ) {
    super(
      `OAuth connection for ${provider} is missing required scopes: ` +
        missingScopes.join(', '),
    );
    this.name = 'OAuthScopeError';
  }
}

export class OAuthTokenManager {
  private readonly logger = new Logger(OAuthTokenManager.name);
  private readonly refreshersByProvider = new Map<string, OAuthRefresher>();

  /** TTL of "still considered fresh enough not to refresh" (seconds). */
  private readonly refreshSkewSeconds = 60;

  /** Persist the new tokens to the connection record. Provided by caller. */
  constructor(
    private readonly persistTokens: (
      conn: OAuthConnection,
      tokens: RefreshedTokens,
    ) => Promise<void>,
  ) {}

  registerRefresher(refresher: OAuthRefresher): void {
    this.refreshersByProvider.set(refresher.provider, refresher);
  }

  /**
   * Return either the same connection (still fresh) or a connection
   * with refreshed tokens. NEVER returns a connection with an expired
   * token — if refresh isn't possible, throws.
   */
  async ensureFresh(
    connection: OAuthConnection,
    requiredScopes?: string[],
  ): Promise<OAuthConnection> {
    if (requiredScopes?.length) {
      this.assertScopes(connection, requiredScopes);
    }
    if (!this.isExpiring(connection)) return connection;

    const refresher = this.refreshersByProvider.get(connection.provider);
    if (!refresher) {
      this.logger.warn(
        `No refresher registered for provider=${connection.provider}; cannot refresh`,
      );
      throw new OAuthTokenRefreshError(
        connection.provider,
        connection.connectionId,
        new Error('no refresher registered'),
        true,
      );
    }

    let refreshed: RefreshedTokens;
    try {
      refreshed = await refresher.refresh(connection);
    } catch (err) {
      // Heuristic: the refresh-token-revoked case usually surfaces as
      // an HTTP 400 / 401 from the provider, sometimes wrapped. The
      // refresher modules should set `requiresReconnection` on the
      // error explicitly when they can detect this; otherwise we
      // assume yes (safer to ask the user to reconnect than to keep
      // retrying a dead refresh token).
      const requiresReconnection =
        (err as { requiresReconnection?: boolean }).requiresReconnection ??
        true;
      throw new OAuthTokenRefreshError(
        connection.provider,
        connection.connectionId,
        err,
        requiresReconnection,
      );
    }

    await this.persistTokens(connection, refreshed);

    const newConn: OAuthConnection = {
      ...connection,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? connection.refreshToken,
      expiresAt: refreshed.expiresAt ?? connection.expiresAt,
      grantedScopes: refreshed.grantedScopes ?? connection.grantedScopes,
    };
    if (requiredScopes?.length) {
      // If the provider returned a narrower scope set after refresh
      // (rare but possible), the call still must not proceed.
      this.assertScopes(newConn, requiredScopes);
    }
    return newConn;
  }

  /**
   * Throws `OAuthScopeError` if any of `required` is missing from the
   * connection's granted scopes. Granted-scope strings are exact-match;
   * provider-specific synonyms (e.g. `repo` covering `repo:status`)
   * should be expanded by the caller before reaching this method.
   */
  assertScopes(connection: OAuthConnection, required: string[]): void {
    const granted = new Set(connection.grantedScopes);
    const missing = required.filter((s) => !granted.has(s));
    if (missing.length) {
      throw new OAuthScopeError(connection.provider, missing);
    }
  }

  private isExpiring(connection: OAuthConnection): boolean {
    if (!connection.expiresAt) return false;
    const expiresInSeconds =
      (connection.expiresAt.getTime() - Date.now()) / 1000;
    return expiresInSeconds < this.refreshSkewSeconds;
  }
}
