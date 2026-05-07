/**
 * Google Workspace OAuth refresher.
 *
 * Endpoint:
 *   POST https://oauth2.googleapis.com/token
 *   body: grant_type=refresh_token&refresh_token=...&client_id=...&client_secret=...
 *
 * Reconnection signals: Google returns HTTP 400 with
 *   { error: "invalid_grant" }
 * when the refresh token has been revoked, expired due to inactivity
 * (180 days for unverified apps, 6 months for inactive accounts), or
 * the user changed their password / signed out everywhere. In all
 * those cases we cannot recover and must ask the user to reconnect.
 */
import {
  OAuthConnection,
  OAuthRefresher,
  RefreshedTokens,
} from '../oauth-token-manager';

interface GoogleRefreshResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string; // Google sometimes rotates refresh tokens; sometimes not.
  scope?: string; // space-separated
  token_type?: string;
  error?: string;
  error_description?: string;
}

const RECONNECT_ERRORS = new Set([
  'invalid_grant',
  'invalid_token',
  'unauthorized_client',
]);

export class GoogleRefresher implements OAuthRefresher {
  readonly provider = 'google';

  constructor(
    private readonly clientId = process.env.GOOGLE_CLIENT_ID,
    private readonly clientSecret = process.env.GOOGLE_CLIENT_SECRET,
    private readonly endpoint = 'https://oauth2.googleapis.com/token',
  ) {}

  async refresh(connection: OAuthConnection): Promise<RefreshedTokens> {
    if (!connection.refreshToken) {
      const err = new Error(
        'No Google refresh token on file — user must reconnect',
      );
      (err as { requiresReconnection?: boolean }).requiresReconnection = true;
      throw err;
    }
    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET must be set for OAuth refresh',
      );
    }
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: connection.refreshToken,
    });
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json()) as GoogleRefreshResponse;
    if (data.error || !data.access_token) {
      const err = new Error(
        data.error_description || data.error || 'Google refresh failed',
      );
      (err as { requiresReconnection?: boolean }).requiresReconnection =
        !!(data.error && RECONNECT_ERRORS.has(data.error));
      throw err;
    }
    return {
      accessToken: data.access_token,
      // Google may or may not rotate the refresh token. If it returns
      // one, use it; otherwise the existing refresh token stays valid.
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : undefined,
      grantedScopes: data.scope
        ? data.scope.split(/\s+/).filter(Boolean)
        : undefined,
    };
  }
}
