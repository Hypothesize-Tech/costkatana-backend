/**
 * Discord OAuth 2.0 refresher.
 *
 * Endpoint:
 *   POST https://discord.com/api/v10/oauth2/token
 *   body: grant_type=refresh_token&refresh_token=...&client_id=...&client_secret=...
 *
 * Reconnect signal: HTTP 4xx with `error: "invalid_grant"`. Discord
 * also issues a NEW refresh_token on each refresh, so the manager
 * persists it.
 */
import {
  OAuthConnection,
  OAuthRefresher,
  RefreshedTokens,
} from '../oauth-token-manager';

interface DiscordRefreshResponse {
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
  'invalid_token',
  'unauthorized_client',
]);

export class DiscordRefresher implements OAuthRefresher {
  readonly provider = 'discord';

  constructor(
    private readonly clientId = process.env.DISCORD_CLIENT_ID,
    private readonly clientSecret = process.env.DISCORD_CLIENT_SECRET,
    private readonly endpoint = 'https://discord.com/api/v10/oauth2/token',
  ) {}

  async refresh(connection: OAuthConnection): Promise<RefreshedTokens> {
    if (!connection.refreshToken) {
      const err = new Error('No Discord refresh token on file — user must reconnect');
      (err as { requiresReconnection?: boolean }).requiresReconnection = true;
      throw err;
    }
    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        'DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET must be set for OAuth refresh',
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
    const data = (await res.json()) as DiscordRefreshResponse;
    if (!res.ok || data.error || !data.access_token) {
      const err = new Error(
        data.error_description ||
          data.error ||
          `Discord refresh HTTP ${res.status}`,
      );
      (err as { requiresReconnection?: boolean }).requiresReconnection =
        !!(data.error && RECONNECT_ERRORS.has(data.error));
      throw err;
    }
    return {
      accessToken: data.access_token,
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
