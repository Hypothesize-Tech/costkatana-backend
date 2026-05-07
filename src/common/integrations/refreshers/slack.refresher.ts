/**
 * Slack OAuth refresher.
 *
 * Slack only issues refresh tokens for apps where the workspace admin
 * has enabled "token rotation". Apps without rotation get a long-lived
 * `xoxb-...` bot token that doesn't expire — this refresher will throw
 * `requiresReconnection` for those, prompting the user to reauth if a
 * call ever does fail with 401.
 *
 * Endpoint:
 *   POST https://slack.com/api/oauth.v2.access
 *   body: grant_type=refresh_token&refresh_token=...&client_id=...&client_secret=...
 *
 * Reconnect signals: `error: "invalid_refresh_token" | "token_expired"`.
 */
import {
  OAuthConnection,
  OAuthRefresher,
  RefreshedTokens,
} from '../oauth-token-manager';

interface SlackRefreshResponse {
  ok: boolean;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
}

const RECONNECT_ERRORS = new Set([
  'invalid_refresh_token',
  'token_expired',
  'token_revoked',
  'invalid_grant',
]);

export class SlackRefresher implements OAuthRefresher {
  readonly provider = 'slack';

  constructor(
    private readonly clientId = process.env.SLACK_CLIENT_ID,
    private readonly clientSecret = process.env.SLACK_CLIENT_SECRET,
    private readonly endpoint = 'https://slack.com/api/oauth.v2.access',
  ) {}

  async refresh(connection: OAuthConnection): Promise<RefreshedTokens> {
    if (!connection.refreshToken) {
      const err = new Error(
        'No Slack refresh token — token rotation is not enabled for this workspace',
      );
      (err as { requiresReconnection?: boolean }).requiresReconnection = true;
      throw err;
    }
    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        'SLACK_CLIENT_ID / SLACK_CLIENT_SECRET must be set for OAuth refresh',
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
    const data = (await res.json()) as SlackRefreshResponse;
    if (!data.ok || !data.access_token) {
      const err = new Error(data.error || 'Slack refresh failed');
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
        ? data.scope.split(',').filter(Boolean)
        : undefined,
    };
  }
}
