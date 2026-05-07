/**
 * GitHub OAuth refresher.
 *
 * Note: classic GitHub OAuth Apps do NOT issue refresh tokens — they
 * mint a non-expiring access token. The refresh path here is for the
 * newer "GitHub App user-to-server token expiration" feature (must be
 * enabled at the App level), where access tokens are short-lived (8h)
 * and a refresh token rotates on each refresh.
 *
 * Endpoint:
 *   POST https://github.com/login/oauth/access_token
 *   body: grant_type=refresh_token&refresh_token=...&client_id=...&client_secret=...
 *
 * Detection of a revoked refresh token: GitHub returns
 *   { error: "bad_refresh_token" }
 * with HTTP 200. We map that to `requiresReconnection`.
 */
import {
  OAuthConnection,
  OAuthRefresher,
  RefreshedTokens,
} from '../oauth-token-manager';

interface GithubRefreshResponse {
  access_token?: string;
  expires_in?: number; // seconds
  refresh_token?: string;
  refresh_token_expires_in?: number; // seconds
  scope?: string; // space-separated
  token_type?: string;
  error?: string;
  error_description?: string;
}

export class GithubRefresher implements OAuthRefresher {
  readonly provider = 'github';

  constructor(
    // Reuse the same OAuth credentials the existing GitHub integration
    // uses to obtain tokens. A separate _OAUTH_ prefix would just be
    // another env var to keep in sync.
    private readonly clientId = process.env.GITHUB_CLIENT_ID,
    private readonly clientSecret = process.env.GITHUB_CLIENT_SECRET,
    private readonly endpoint = 'https://github.com/login/oauth/access_token',
  ) {}

  async refresh(connection: OAuthConnection): Promise<RefreshedTokens> {
    if (!connection.refreshToken) {
      // Classic OAuth App (or token never expires). Surface the
      // requires-reconnect signal so the caller can prompt the user.
      const err = new Error('No refresh token on file for this GitHub connection');
      (err as { requiresReconnection?: boolean }).requiresReconnection = true;
      throw err;
    }
    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        'GITHUB_OAUTH_CLIENT_ID / GITHUB_OAUTH_CLIENT_SECRET must be set',
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
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json()) as GithubRefreshResponse;
    if (data.error || !data.access_token) {
      const err = new Error(
        data.error_description || data.error || 'GitHub refresh failed',
      );
      // Both `bad_refresh_token` and `expired_token` mean we cannot
      // recover server-side — the user must reconnect.
      (err as { requiresReconnection?: boolean }).requiresReconnection =
        data.error === 'bad_refresh_token' ||
        data.error === 'expired_token' ||
        data.error === 'invalid_grant';
      throw err;
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : undefined,
      grantedScopes: data.scope ? data.scope.split(/\s+/).filter(Boolean) : undefined,
    };
  }
}
