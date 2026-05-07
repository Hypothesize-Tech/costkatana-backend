/**
 * Verifies that the OAuth-aware wrapper variant pre-flights the token
 * before each call, hands the refreshed connection to the function,
 * and short-circuits cleanly on auth errors (no retries, no breaker
 * bumps for what is an auth problem).
 */
import {
  resetAllBreakers,
  withOAuthIntegrationGuards,
} from '../integration-call-wrapper';
import {
  OAuthConnection,
  OAuthScopeError,
  OAuthTokenManager,
} from '../oauth-token-manager';

function makeConnection(over: Partial<OAuthConnection> = {}): OAuthConnection {
  return {
    provider: 'github',
    connectionId: 'c1',
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    grantedScopes: ['repo'],
    ...over,
  };
}

describe('withOAuthIntegrationGuards', () => {
  beforeEach(() => resetAllBreakers());

  it('passes the refreshed connection to the function', async () => {
    const tokenManager = new OAuthTokenManager(async () => undefined);
    tokenManager.registerRefresher({
      provider: 'github',
      refresh: async () => ({
        accessToken: 'fresh-access',
        expiresAt: new Date(Date.now() + 3600_000),
      }),
    });
    const conn = makeConnection({
      expiresAt: new Date(Date.now() + 30_000), // about to expire
    });
    let seen = '';
    await withOAuthIntegrationGuards(
      { name: 'github:test', tokenManager, connection: conn, retries: 1 },
      async (c) => {
        seen = c.accessToken;
        return 'ok';
      },
    );
    expect(seen).toBe('fresh-access');
  });

  it('skips the refresh when the token is still valid', async () => {
    const tokenManager = new OAuthTokenManager(async () => undefined);
    const refresh = jest.fn();
    tokenManager.registerRefresher({ provider: 'github', refresh });
    const conn = makeConnection(); // valid for 1h
    const out = await withOAuthIntegrationGuards(
      { name: 'github:test', tokenManager, connection: conn, retries: 1 },
      async (c) => `seen:${c.accessToken}`,
    );
    expect(out).toBe('seen:old-access');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('surfaces OAuthScopeError without retries (non-retryable auth error)', async () => {
    const tokenManager = new OAuthTokenManager(async () => undefined);
    const callCount = { n: 0 };
    const conn = makeConnection({ grantedScopes: [] });
    await expect(
      withOAuthIntegrationGuards(
        {
          name: 'github:test',
          tokenManager,
          connection: conn,
          requiredScopes: ['repo'],
          retries: 3,
        },
        async () => {
          callCount.n += 1;
          return 'never';
        },
      ),
    ).rejects.toBeInstanceOf(OAuthScopeError);
    // The handler must NEVER run if scopes are insufficient — we don't
    // want a partially-permissioned call hitting the provider's API.
    expect(callCount.n).toBe(0);
  });
});
