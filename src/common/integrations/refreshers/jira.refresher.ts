/**
 * Atlassian (Jira / Confluence) OAuth 2.0 (3LO) refresher.
 *
 * Endpoint:
 *   POST https://auth.atlassian.com/oauth/token
 *   body (JSON): { grant_type, client_id, client_secret, refresh_token }
 *
 * Atlassian uses **rotating refresh tokens**: every successful refresh
 * returns a new refresh token and invalidates the old one. We must
 * persist the new refresh_token immediately (the OAuthTokenManager
 * `persistTokens` callback handles that).
 *
 * Reconnect signal: HTTP 4xx with `error: "invalid_grant"` or text
 * `error: "unauthorized_client"` means the refresh token is dead.
 */
import {
  OAuthConnection,
  OAuthRefresher,
  RefreshedTokens,
} from '../oauth-token-manager';

interface AtlassianRefreshResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

const RECONNECT_ERRORS = new Set([
  'invalid_grant',
  'unauthorized_client',
  'invalid_token',
]);

export class JiraRefresher implements OAuthRefresher {
  readonly provider = 'jira';

  constructor(
    private readonly clientId = process.env.JIRA_CLIENT_ID,
    private readonly clientSecret = process.env.JIRA_CLIENT_SECRET,
    private readonly endpoint = 'https://auth.atlassian.com/oauth/token',
  ) {}

  async refresh(connection: OAuthConnection): Promise<RefreshedTokens> {
    if (!connection.refreshToken) {
      const err = new Error('No Jira refresh token on file — user must reconnect');
      (err as { requiresReconnection?: boolean }).requiresReconnection = true;
      throw err;
    }
    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        'JIRA_CLIENT_ID / JIRA_CLIENT_SECRET must be set for OAuth refresh',
      );
    }
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: connection.refreshToken,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json()) as AtlassianRefreshResponse;
    if (!res.ok || data.error || !data.access_token) {
      const err = new Error(
        data.error_description || data.error || `Jira refresh HTTP ${res.status}`,
      );
      (err as { requiresReconnection?: boolean }).requiresReconnection =
        !!(data.error && RECONNECT_ERRORS.has(data.error));
      throw err;
    }
    return {
      accessToken: data.access_token,
      // Atlassian ALWAYS returns a new refresh token (rotation).
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
